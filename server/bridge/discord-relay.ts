/**
 * Discord relay: the LOCAL capture's room messages, sent on to Live so Live's Discord panels (and Anima's reads
 * through its gateway) see the room while the capture runs on Don's PC.
 *
 * - Sender (LOCAL, next to discord-bridge): every SEND_MS while capturing (IDLE_MS otherwise) it posts the messages
 *   captured since the last accepted push, the last RESEND again (a notification later filled in by its channel copy
 *   keeps its seq), the bridge status and the last AI summary, to DISCORD_RELAY_URL + /api/discord-stream/relay with
 *   X-Relay-Token. Off unless DISCORD_RELAY_URL (https) and DISCORD_RELAY_TOKEN (32+ chars) are both set.
 * - Receiver (Live): keeps what it is sent in memory only, capped like the bridge. Nothing goes to disk or a database,
 *   so a restart starts empty until the next push. The token is compared in constant time; a wrong or missing one
 *   gets a plain 404.
 * Control (start, stop, clear, a new AI summary) stays LOCAL.
 */

import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { analyze, type RoomAnalysis } from "./discord-analysis";
import type { DiscordMessage } from "./discord-bridge";
import type { RoomSummary } from "./discord-summary";

const MAX_MESSAGES = 5000;
const BATCH = 400;
const RESEND = 20;
const SEND_MS = 5_000;
const IDLE_MS = 60_000;
const TIMEOUT_MS = 15_000;
/** No push for this long: Live says the capture isn't reaching it. */
export const STALE_MS = 2 * 60_000;
const DEFAULT_TRADERS = ["Nick Drendel", "RealSimpleAriel"];

function relayToken(): string {
  const t = (process.env.DISCORD_RELAY_TOKEN || "").trim();
  return t.length >= 32 ? t : "";
}

function sameToken(given: string, want: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(want).digest();
  return timingSafeEqual(a, b);
}

// ---------------------------------------------------------------- receiver (Live)

type BridgeStatus = Record<string, unknown> & { running?: boolean; latestSeq?: number };

let bootId = "";
let received: DiscordMessage[] = [];
let localStatus: BridgeStatus | null = null;
let localSummary: RoomSummary | null = null;
let lastPushAt = 0;

export function hasData(): boolean {
  return lastPushAt > 0;
}

export function accept(req: Request, res: Response): void {
  const want = relayToken();
  const given = String(req.get("x-relay-token") || "");
  if (!want || !given || !sameToken(given, want)) {
    res.status(404).end();
    return;
  }
  const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
  const boot = String(body.bootId || "");
  if (boot && boot !== bootId) {
    bootId = boot;
    received = [];
  }
  const oldest = Number(body.oldestSeq);
  if (Number.isFinite(oldest)) received = received.filter((m) => m.seq >= oldest);
  const incoming = Array.isArray(body.messages) ? (body.messages as DiscordMessage[]) : [];
  const bySeq = new Map(received.map((m, i) => [m.seq, i]));
  let appended = false;
  for (const m of incoming.slice(0, BATCH + RESEND)) {
    if (!m || typeof m !== "object" || !Number.isFinite(Number(m.seq))) continue;
    const i = bySeq.get(m.seq);
    if (i !== undefined) {
      received[i] = m;
    } else {
      bySeq.set(m.seq, received.length);
      received.push(m);
      appended = true;
    }
  }
  if (appended) received.sort((a, b) => a.seq - b.seq);
  if (received.length > MAX_MESSAGES) received.splice(0, received.length - MAX_MESSAGES);
  if (body.status && typeof body.status === "object") localStatus = body.status as BridgeStatus;
  if (body.summary === null || (body.summary && typeof body.summary === "object")) {
    localSummary = body.summary as RoomSummary | null;
  }
  lastPushAt = Date.now();
  res.json({ ok: true, buffered: received.length, latestSeq: received.at(-1)?.seq ?? 0 });
}

export function getStatus() {
  const age = Date.now() - lastPushAt;
  const stale = age > STALE_MS;
  return {
    ...(localStatus ?? {}),
    available: true,
    relayed: true,
    running: !stale && localStatus?.running === true,
    relayAt: new Date(lastPushAt).toISOString(),
    relayStale: stale,
    buffered: received.length,
    latestSeq: received.at(-1)?.seq ?? 0,
    maxBuffered: MAX_MESSAGES,
  };
}

export function getMessages(afterSeq = 0, limit = MAX_MESSAGES): DiscordMessage[] {
  const out = afterSeq > 0 ? received.filter((m) => m.seq > afterSeq) : received.slice();
  return out.slice(-Math.max(1, Math.min(limit, MAX_MESSAGES)));
}

export function getAnalysis(opts: { windowMin: number | null; traders?: string[]; weights?: Record<string, number> }): RoomAnalysis {
  return analyze(received, {
    windowMin: opts.windowMin,
    traders: opts.traders?.length ? opts.traders : DEFAULT_TRADERS,
    weights: opts.weights,
  });
}

export function getLastSummary(): RoomSummary | null {
  return localSummary;
}

// ---------------------------------------------------------------- sender (LOCAL)

type Bridge = {
  getStatus(): BridgeStatus;
  getMessages(afterSeq?: number, limit?: number): DiscordMessage[];
  getLastSummary(): RoomSummary | null;
};

let senderStarted = false;

export function startSender(bridge: Bridge): void {
  const base = (process.env.DISCORD_RELAY_URL || "").trim().replace(/\/+$/, "");
  const token = relayToken();
  if (senderStarted || !base || !token) return;
  if (!/^https:\/\//i.test(base)) {
    console.warn("[Discord Relay] DISCORD_RELAY_URL must be https; relay off");
    return;
  }
  senderStarted = true;
  const url = `${base}/api/discord-stream/relay`;
  const boot = randomUUID();
  let sent = 0;
  let lastAt = 0;
  let failing = false;

  const tick = async () => {
    const status = bridge.getStatus();
    if (!status.running && Date.now() - lastAt < IDLE_MS) return;
    const all = bridge.getMessages(0, MAX_MESSAGES);
    const fresh = all.filter((m) => m.seq > sent).slice(0, BATCH);
    const again = all.filter((m) => m.seq <= sent).slice(-RESEND);
    const body = {
      bootId: boot,
      status,
      summary: bridge.getLastSummary(),
      oldestSeq: all.length ? all[0].seq : Number(status.latestSeq ?? 0) + 1,
      messages: [...again, ...fresh],
    };
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Relay-Token": token },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      if (fresh.length) sent = fresh[fresh.length - 1].seq;
      lastAt = Date.now();
      if (failing) console.log("[Discord Relay] reaching Live again");
      failing = false;
    } catch (e) {
      if (!failing) console.warn("[Discord Relay] push to Live failed:", e instanceof Error ? e.message : e);
      failing = true;
    }
  };

  let busy = false;
  setInterval(() => {
    if (busy) return;
    busy = true;
    tick().finally(() => {
      busy = false;
    });
  }, SEND_MS).unref();
  console.log(`[Discord Relay] sending the room to ${base}`);
}
