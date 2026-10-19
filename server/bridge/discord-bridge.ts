/**
 * Discord Watch bridge — runs discord-watch.ps1 (read-only UI Automation capture of one
 * channel in the Discord desktop app) and keeps the captured messages in memory.
 *
 * Nothing is written to disk or a database: a restart starts empty.
 * Starts only when asked (POST /api/discord-stream/start); never auto-starts on boot.
 * Kill switch: server/bridge/DISCORD_WATCH_OFF.txt blocks start and stops a running watcher.
 *
 * LOCAL Windows only. Live / production returns 501 and never loads this module.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import readline from "readline";
import fs from "fs";
import path from "path";
import { analyze, loadFullSymbolList, tagMessage, TRADE_CHANNELS, type RoomAnalysis, type Side, type TradeAction } from "./discord-analysis";
import { aiAvailable, summarizeRoom, type RoomSummary } from "./discord-summary";

const BRIDGE_DIR = path.join(process.cwd(), "server", "bridge");
const PS_SCRIPT = path.join(BRIDGE_DIR, "discord-watch.ps1");
const KILL_FILE = path.join(BRIDGE_DIR, "DISCORD_WATCH_OFF.txt");
/** Present while capture is switched on, so it resumes after a server restart. Holds no messages. */
const RESUME_FILE = path.join(BRIDGE_DIR, "DISCORD_WATCH_RESUME.json");
/** A busy 6.5h session is ~3-4k messages. */
const MAX_MESSAGES = 5000;
export const DEFAULT_TRADERS = ["Nick Drendel", "RealSimpleAriel"];
const DEFAULT_CHANNEL = "live-stream-chat";
const RESTART_DELAY_MS = 5000;

export interface DiscordReaction {
  emoji: string;
  count: number;
}

export interface DiscordMessage {
  seq: number;
  id: string;
  channelId: string;
  channel: string;
  server: string;
  author: string;
  tag: string;
  time: string;
  text: string;
  mentions: string[];
  links: string[];
  replyTo: string;
  replyPreview: string;
  reactions: DiscordReaction[];
  media: string[];
  extras: string[];
  edited: boolean;
  initial: boolean;
  label: string;
  capturedAt: string;
  /** Message time as epoch ms (from Discord's displayed time). */
  ts: number;
  tickers: string[];
  side: Side;
  action: TradeAction | null;
  /** "chat" = read from the open channel; "toast" = Discord Windows notification. */
  source: "chat" | "toast";
}

/** "9:56 AM" / "Today at 9:56 AM" / "Yesterday at 4:01 PM" / "10/2/2026 12:22 PM" → epoch ms; falls back to capture time. */
function messageTs(time: string, capturedAt: number): number {
  const m = /^(Today at |Yesterday at |(\d{1,2})\/(\d{1,2})\/(\d{4}),? )?(\d{1,2}):(\d{2})\s?([AP]M)$/i.exec(time.trim());
  if (!m) return capturedAt;
  let h = Number(m[5]) % 12;
  if (m[7].toUpperCase() === "PM") h += 12;
  const d = new Date(capturedAt);
  if (m[4]) d.setFullYear(Number(m[4]), Number(m[2]) - 1, Number(m[3]));
  d.setHours(h, Number(m[6]), 0, 0);
  if (m[4]) return d.getTime();
  if (m[1]?.toLowerCase().startsWith("yesterday")) d.setDate(d.getDate() - 1);
  else if (d.getTime() - capturedAt > 5 * 60_000) d.setDate(d.getDate() - 1);
  return d.getTime();
}

const normText = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Same post seen twice: once as a notification, once in the channel. */
function findTwin(author: string, text: string, ts: number): DiscordMessage | undefined {
  const a = author.toLowerCase();
  const t = normText(text);
  if (!t) return undefined;
  for (let i = messages.length - 1; i >= 0 && i >= messages.length - 400; i--) {
    const m = messages[i];
    if (Math.abs(m.ts - ts) > 15 * 60_000) continue;
    if (m.author.toLowerCase() !== a) continue;
    const mt = normText(m.text);
    if (mt === t || mt.startsWith(t) || t.startsWith(mt)) return m;
  }
  return undefined;
}

/**
 * Discord notification texts: [title, body...]. Server channel posts are titled
 * "Author (#channel, Server)"; DMs are just "Author".
 */
function parseToast(texts: string[]): { author: string; channel: string; server: string; text: string } {
  const title = (texts[0] ?? "").trim();
  const body = texts.slice(1).join("\n").trim();
  const m = /^(.+?)\s*\((#?[^,()]+?)(?:,\s*([^()]+))?\)\s*$/.exec(title);
  if (!m) return { author: title, channel: "", server: "", text: body };
  return {
    author: m[1].trim(),
    channel: m[2].replace(/^#/, "").replace(/[^A-Za-z0-9_-]/g, "").toLowerCase(),
    server: (m[3] ?? "").trim(),
    text: body,
  };
}

export interface WatcherStatus {
  window: boolean;
  title: string;
  openChannel: string;
  server: string;
  watching: string;
  channels?: string[];
  capturing?: string;
  listFound: boolean;
  visible: number;
  seen: number;
  toastAccess?: string;
  toasts?: number;
  lastError: string;
  at: string;
}

let child: ChildProcessWithoutNullStreams | null = null;
let wantRunning = false;
let channel = DEFAULT_CHANNEL;
let startedAt: string | null = null;
let lastWatcher: WatcherStatus | null = null;
let lastExit: { code: number | null; reason: string; at: string } | null = null;
let restartTimer: NodeJS.Timeout | null = null;
let seq = 0;
const messages: DiscordMessage[] = [];
const stderrTail: string[] = [];

export function isAvailable(): boolean {
  return process.platform === "win32" && process.env.NODE_ENV !== "production";
}

function killSwitchOn(): boolean {
  return fs.existsSync(KILL_FILE);
}

function asStrings(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x ?? "")).filter(Boolean);
  if (typeof v === "string" && v) return [v];
  return [];
}

function asReactions(v: unknown): DiscordReaction[] {
  const arr = Array.isArray(v) ? v : v && typeof v === "object" ? [v] : [];
  return arr
    .map((r) => ({ emoji: String((r as any)?.emoji ?? ""), count: Number((r as any)?.count ?? 0) }))
    .filter((r) => r.emoji);
}

function handleLine(line: string): void {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return;
  }
  if (obj.type === "status") {
    lastWatcher = obj as unknown as WatcherStatus;
    return;
  }
  if (obj.type === "stopped") {
    lastExit = { code: 0, reason: String(obj.reason ?? "stopped"), at: new Date().toISOString() };
    return;
  }
  if (obj.type === "toast") {
    handleToast(obj);
    return;
  }
  if (obj.type !== "msg") return;
  const capturedAt = String(obj.capturedAt ?? new Date().toISOString());
  const text = String(obj.text ?? "");
  const time = String(obj.time ?? "");
  const msg: DiscordMessage = {
    seq: ++seq,
    id: String(obj.id ?? ""),
    channelId: String(obj.channelId ?? ""),
    channel: String(obj.channel ?? ""),
    server: String(obj.server ?? ""),
    author: String(obj.author ?? ""),
    tag: String(obj.tag ?? ""),
    time,
    text,
    mentions: asStrings(obj.mentions),
    links: asStrings(obj.links),
    replyTo: String(obj.replyTo ?? ""),
    replyPreview: String(obj.replyPreview ?? ""),
    reactions: asReactions(obj.reactions),
    media: asStrings(obj.media),
    extras: asStrings(obj.extras),
    edited: obj.edited === true,
    initial: obj.initial === true,
    label: String(obj.label ?? ""),
    capturedAt,
    ts: messageTs(time, Date.parse(capturedAt) || Date.now()),
    ...tagMessage(text, String(obj.channel ?? "")),
    source: "chat",
  };
  if (!msg.id || messages.some((m) => m.id === msg.id)) return;
  const twin = findTwin(msg.author, msg.text, msg.ts);
  if (twin?.source === "toast") {
    // The channel copy has the full text, mentions and media: keep its data, keep the toast's place.
    Object.assign(twin, { ...msg, seq: twin.seq, initial: twin.initial });
    return;
  }
  push(msg);
}

function push(msg: DiscordMessage): void {
  messages.push(msg);
  if (messages.length > MAX_MESSAGES) messages.splice(0, messages.length - MAX_MESSAGES);
}

function handleToast(obj: Record<string, unknown>): void {
  const texts = asStrings(obj.texts);
  if (!texts.length) return;
  const at = String(obj.at ?? new Date().toISOString());
  const ts = Date.parse(at) || Date.now();
  const p = parseToast(texts);
  if (!p.text) return;
  const id = `toast-${String(obj.nid ?? ts)}`;
  if (messages.some((m) => m.id === id) || findTwin(p.author, p.text, ts)) return;
  const time = new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  push({
    seq: ++seq,
    id,
    channelId: "",
    channel: p.channel,
    server: p.server,
    author: p.author,
    tag: "",
    time,
    text: p.text,
    mentions: [],
    links: [],
    replyTo: "",
    replyPreview: "",
    reactions: [],
    media: [],
    extras: [],
    edited: false,
    initial: obj.initial === true,
    label: texts.join(" | "),
    capturedAt: new Date().toISOString(),
    ts,
    ...tagMessage(p.text, p.channel),
    source: "toast",
  });
}

function spawnWatcher(): void {
  const proc = spawn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", PS_SCRIPT, "-Channel", channel, "-Also", TRADE_CHANNELS.join(",")],
    { windowsHide: true },
  );
  child = proc;
  proc.stdout.setEncoding("utf8");
  proc.stderr.setEncoding("utf8");
  readline.createInterface({ input: proc.stdout }).on("line", handleLine);
  proc.stderr.on("data", (chunk: string) => {
    stderrTail.push(...chunk.split(/\r?\n/).filter(Boolean));
    if (stderrTail.length > 20) stderrTail.splice(0, stderrTail.length - 20);
  });
  proc.on("exit", (code) => {
    if (child === proc) child = null;
    if (!lastExit || lastExit.code !== 0) {
      lastExit = { code, reason: stderrTail.slice(-3).join(" | ") || "exited", at: new Date().toISOString() };
    }
    if (wantRunning && !killSwitchOn()) {
      console.warn(`[Discord Watch] watcher exited (code ${code}); restarting in ${RESTART_DELAY_MS / 1000}s`);
      restartTimer = setTimeout(() => {
        restartTimer = null;
        if (wantRunning && !child) spawnWatcher();
      }, RESTART_DELAY_MS);
    } else {
      wantRunning = false;
    }
  });
  console.log(`[Discord Watch] watching #${channel} (pid ${proc.pid})`);
}

export function start(opts: { channel?: string } = {}): void {
  if (!isAvailable()) throw new Error("Discord Watch only runs on LOCAL Windows");
  if (killSwitchOn()) throw new Error("Kill switch is on (server/bridge/DISCORD_WATCH_OFF.txt)");
  const wanted = (opts.channel ?? channel).trim().replace(/^#/, "") || DEFAULT_CHANNEL;
  if (child && wanted === channel) {
    wantRunning = true;
    return;
  }
  if (child) stop();
  channel = wanted;
  wantRunning = true;
  lastExit = null;
  lastWatcher = null;
  startedAt = new Date().toISOString();
  try {
    fs.writeFileSync(RESUME_FILE, JSON.stringify({ channel, since: startedAt }));
  } catch {}
  spawnWatcher();
  loadFullSymbolList()
    .then((n) => {
      for (const m of messages) Object.assign(m, tagMessage(m.text, m.channel));
      console.log(`[Discord Watch] ticker list ready (${n} symbols)`);
    })
    .catch(() => {});
}

export function stop(): void {
  wantRunning = false;
  try {
    fs.rmSync(RESUME_FILE, { force: true });
  } catch {}
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  if (child) {
    const proc = child;
    child = null;
    proc.kill();
    lastExit = { code: 0, reason: "stopped by user", at: new Date().toISOString() };
  }
  startedAt = null;
}

export function clear(): void {
  messages.length = 0;
}

export function getMessages(afterSeq = 0, limit = MAX_MESSAGES): DiscordMessage[] {
  const out = afterSeq > 0 ? messages.filter((m) => m.seq > afterSeq) : messages.slice();
  return out.slice(-Math.max(1, Math.min(limit, MAX_MESSAGES)));
}

export function getAnalysis(opts: { windowMin: number | null; traders?: string[]; weights?: Record<string, number> }): RoomAnalysis {
  return analyze(messages, {
    windowMin: opts.windowMin,
    traders: opts.traders?.length ? opts.traders : DEFAULT_TRADERS,
    weights: opts.weights,
  });
}

let lastSummary: RoomSummary | null = null;
let summaryInFlight: Promise<RoomSummary> | null = null;

export function getLastSummary(): RoomSummary | null {
  return lastSummary;
}

export function summarize(opts: { minutes: number; traders?: string[]; weights?: Record<string, number> }): Promise<RoomSummary> {
  if (summaryInFlight) return summaryInFlight;
  summaryInFlight = summarizeRoom(messages, {
    minutes: opts.minutes,
    traders: opts.traders?.length ? opts.traders : DEFAULT_TRADERS,
    weights: opts.weights ?? {},
  })
    .then((s) => {
      lastSummary = s;
      return s;
    })
    .finally(() => {
      summaryInFlight = null;
    });
  return summaryInFlight;
}

export { aiAvailable };

export function getStatus() {
  return {
    available: isAvailable(),
    running: child !== null,
    channel,
    startedAt,
    killSwitch: killSwitchOn(),
    watcher: lastWatcher,
    lastExit,
    buffered: messages.length,
    latestSeq: seq,
    maxBuffered: MAX_MESSAGES,
  };
}

process.once("exit", () => {
  if (child) child.kill();
});

if (isAvailable() && fs.existsSync(RESUME_FILE)) {
  try {
    const saved = JSON.parse(fs.readFileSync(RESUME_FILE, "utf8")) as { channel?: string };
    start({ channel: saved.channel });
    console.log("[Discord Watch] resumed after restart");
  } catch (e) {
    console.warn("[Discord Watch] could not resume:", e instanceof Error ? e.message : e);
  }
}
