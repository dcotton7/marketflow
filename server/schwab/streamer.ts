import { SchwabSignedOut } from "./auth";
import { mergeTick, setBar, type SchwabTick } from "./quote-cache";
import type { StreamerInfo } from "./rest";

/**
 * Schwab streamer: one WebSocket per user, held by one MarketFlow instance (the caller passes a lock check).
 * ADMIN LOGIN with the bare access token, then LEVELONE_EQUITIES (quotes) and CHART_EQUITY (one-minute bars) for the
 * union of every caller's symbols, capped. Drops and a silent minute reconnect with backoff (1 s doubling to 60 s),
 * logging in again with a fresh token and resubscribing. Read only: the streamer has no order service.
 */
export const LEVELONE_FIELDS = "0,1,2,3,8,10,11,12,17,18,33,34,35";
export const CHART_FIELDS = "0,1,2,3,4,5,6,7,8";
export const HEARTBEAT_GAP_MS = 60_000;
export const MAX_BACKOFF_MS = 60_000;
const STANDBY_RETRY_MS = 60_000;

export type StreamState = "off" | "standby" | "connecting" | "streaming" | "reconnecting";

export interface WsLike {
  send(data: string): void;
  close(): void;
  on(event: "open" | "message" | "close" | "error", fn: (arg?: any) => void): void;
}

export interface StreamerDeps {
  accessToken: () => Promise<string>;
  streamerInfo: () => Promise<StreamerInfo>;
  openSocket: (url: string) => WsLike;
  holdsLock?: () => Promise<boolean>;
  maxSymbols: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
  log?: (msg: string) => void;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export class SchwabStreamer {
  state: StreamState = "off";
  reconnects = 0;
  lastMessageAt: number | null = null;
  lastError: string | null = null;
  private ws: WsLike | null = null;
  private info: StreamerInfo | null = null;
  private wanted = new Map<string, string[]>();
  private subscribed: string[] = [];
  private requestId = 0;
  private attempt = 0;
  private stopped = true;
  private retryTimer: unknown = null;
  private watchTimer: unknown = null;
  private listeners: Array<(t: SchwabTick) => void> = [];
  private now: () => number;
  private setTimer: (fn: () => void, ms: number) => unknown;
  private clearTimer: (t: unknown) => void;

  constructor(private deps: StreamerDeps) {
    this.now = deps.now ?? Date.now;
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((t) => clearTimeout(t as NodeJS.Timeout));
  }

  onTick(fn: (t: SchwabTick) => void): void {
    this.listeners.push(fn);
  }

  /** Each caller names its own set; the union is subscribed in caller order, capped at maxSymbols. */
  setSymbols(owner: string, symbols: string[]): void {
    this.wanted.set(owner, symbols.map((s) => s.toUpperCase()));
    if (this.state === "streaming") this.subscribe();
  }

  desiredSymbols(): string[] {
    const out: string[] = [];
    for (const list of this.wanted.values()) for (const s of list) if (!out.includes(s)) out.push(s);
    return out.slice(0, this.deps.maxSymbols);
  }

  get symbols(): string[] {
    return [...this.subscribed];
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.attempt = 0;
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.subscribed = [];
    this.state = "off";
  }

  private clearTimers() {
    if (this.retryTimer) this.clearTimer(this.retryTimer);
    if (this.watchTimer) this.clearTimer(this.watchTimer);
    this.retryTimer = this.watchTimer = null;
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    if (this.deps.holdsLock && !(await this.deps.holdsLock())) {
      this.state = "standby"; // the other instance streams
      this.retryTimer = this.setTimer(() => void this.connect(), STANDBY_RETRY_MS);
      return;
    }
    this.state = this.attempt === 0 ? "connecting" : "reconnecting";
    try {
      this.info = await this.deps.streamerInfo();
      const ws = this.deps.openSocket(this.info.streamerSocketUrl);
      this.ws = ws;
      ws.on("open", () => void this.login(ws));
      ws.on("message", (data) => this.handle(ws, String(data)));
      ws.on("close", () => this.dropped(ws, "closed"));
      ws.on("error", (err) => this.dropped(ws, String(err?.message ?? err ?? "error")));
    } catch (err) {
      if (err instanceof SchwabSignedOut) {
        this.lastError = err.message;
        this.stop();
        return;
      }
      this.lastError = String((err as Error)?.message ?? err);
      this.scheduleReconnect();
    }
  }

  private send(ws: WsLike, service: string, command: string, parameters: Record<string, string>) {
    const info = this.info!;
    ws.send(JSON.stringify({ requests: [{
      service, command, requestid: String(this.requestId++),
      SchwabClientCustomerId: info.schwabClientCustomerId, SchwabClientCorrelId: info.schwabClientCorrelId, parameters,
    }] }));
  }

  private async login(ws: WsLike) {
    try {
      const token = await this.deps.accessToken();
      this.send(ws, "ADMIN", "LOGIN", {
        Authorization: token, SchwabClientChannel: this.info!.schwabClientChannel, SchwabClientFunctionId: this.info!.schwabClientFunctionId,
      });
    } catch (err) {
      this.lastError = String((err as Error)?.message ?? err);
      if (err instanceof SchwabSignedOut) this.stop();
      else ws.close();
    }
  }

  private subscribe() {
    const ws = this.ws;
    if (!ws) return;
    const want = this.desiredSymbols();
    if (want.join(",") === this.subscribed.join(",")) return;
    if (want.length) {
      // SUBS replaces the service's whole subscription.
      this.send(ws, "LEVELONE_EQUITIES", "SUBS", { keys: want.join(","), fields: LEVELONE_FIELDS });
      this.send(ws, "CHART_EQUITY", "SUBS", { keys: want.join(","), fields: CHART_FIELDS });
    } else if (this.subscribed.length) {
      this.send(ws, "LEVELONE_EQUITIES", "UNSUBS", { keys: this.subscribed.join(",") });
      this.send(ws, "CHART_EQUITY", "UNSUBS", { keys: this.subscribed.join(",") });
    }
    this.subscribed = want;
  }

  private handle(ws: WsLike, text: string) {
    if (ws !== this.ws) return;
    this.lastMessageAt = this.now();
    let msg: any;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    for (const r of msg.response ?? []) {
      if (r.service === "ADMIN" && r.command === "LOGIN") {
        if (r.content?.code === 0) {
          this.state = "streaming";
          this.attempt = 0;
          this.lastError = null;
          this.subscribed = [];
          this.subscribe();
          this.watch();
        } else {
          this.lastError = `Schwab stream login refused (${r.content?.code}): ${r.content?.msg ?? ""}`.trim();
          ws.close();
        }
      }
    }
    for (const d of msg.data ?? []) {
      for (const c of d.content ?? []) {
        const symbol = String(c.key ?? c["0"] ?? "");
        if (!symbol) continue;
        if (d.service === "LEVELONE_EQUITIES") {
          const tick = mergeTick(symbol, {
            bid: num(c["1"]), ask: num(c["2"]), last: num(c["3"]), volume: num(c["8"]), high: num(c["10"]),
            low: num(c["11"]), prevClose: num(c["12"]), open: num(c["17"]), netChange: num(c["18"]), tradeTime: num(c["35"]),
          }, this.now());
          if (tick) for (const fn of this.listeners) fn(tick);
        } else if (d.service === "CHART_EQUITY") {
          const [o, h, l, cl, v, t] = ["2", "3", "4", "5", "6", "7"].map((k) => num(c[k]));
          if (o !== undefined && h !== undefined && l !== undefined && cl !== undefined && t !== undefined) {
            setBar({ symbol, open: o, high: h, low: l, close: cl, volume: v ?? 0, time: t });
          }
        }
      }
    }
  }

  /** A minute with nothing (no data, no heartbeat) counts as a drop. */
  private watch() {
    if (this.watchTimer) this.clearTimer(this.watchTimer);
    this.watchTimer = this.setTimer(() => {
      this.watchTimer = null;
      if (this.stopped || this.state !== "streaming") return;
      if (this.now() - (this.lastMessageAt ?? 0) > HEARTBEAT_GAP_MS) {
        this.dropped(this.ws!, "no heartbeat for a minute");
        return;
      }
      this.watch();
    }, 15_000);
  }

  private dropped(ws: WsLike, why: string) {
    if (ws !== this.ws) return; // an old socket
    this.ws = null;
    try {
      ws.close();
    } catch {
      /* already closed */
    }
    this.subscribed = [];
    if (this.stopped) return;
    this.lastError = this.lastError ?? why;
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.stopped) return;
    if (this.watchTimer) this.clearTimer(this.watchTimer);
    this.watchTimer = null;
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.attempt);
    this.attempt++;
    this.reconnects++;
    this.state = "reconnecting";
    this.retryTimer = this.setTimer(() => {
      this.retryTimer = null;
      void this.connect();
    }, delay);
  }
}
