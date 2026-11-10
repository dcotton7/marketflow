import type pg from "pg";
import WebSocket from "ws";
import { getPool } from "../db";
import { getMarketSession } from "../market-condition/universe";
import { setAlertWatchHook } from "./alert-price";
import { SchwabSignedOut, TokenManager } from "./auth";
import { isConfigured, loadSchwabConfig, type SchwabConfig } from "./config";
import { lastQuoteAgeSec } from "./quote-cache";
import { SchwabRest } from "./rest";
import { buildHealth } from "./status";
import { ensureSchwabSchema, PgStore, type SchwabStore } from "./store";
import { SchwabStreamer, type WsLike } from "./streamer";
import { runSync } from "./sync";

/**
 * Wires the Schwab pieces together at boot when SCHWAB_ENABLED is on and the keys are set. Nothing runs until Don
 * has signed in: then the stream starts (on the one instance holding the stream lock) and the positions sync runs
 * every 5 minutes in market hours, every 30 otherwise.
 */
const STREAM_LOCK_KEY = 74_337_002; // arbitrary, fixed: "schwab streamer" (74_337_001 is the alert worker)
const SYNC_MARKET_MS = 5 * 60_000;
const SYNC_OTHER_MS = 30 * 60_000;

export class SchwabService {
  cfg: SchwabConfig = loadSchwabConfig();
  store: SchwabStore | null = null;
  tokens: TokenManager | null = null;
  streamer: SchwabStreamer | null = null;
  userId: number | null = null;
  realtime: boolean | null = null;
  lastSync: { at: number; inserted: number; updated: number; removed: number; skipped: string[] } | null = null;
  private syncTimer: NodeJS.Timeout | null = null;
  private lockClient: pg.PoolClient | null = null;

  get ready(): boolean {
    return !!(this.cfg.enabled && isConfigured(this.cfg) && this.store && this.tokens);
  }

  async init(): Promise<void> {
    if (!this.cfg.enabled || !isConfigured(this.cfg)) return;
    const pool = getPool();
    if (!pool) return;
    await ensureSchwabSchema(pool);
    this.store = new PgStore(pool, this.cfg.tokenKey!);
    this.tokens = new TokenManager(this.cfg, this.store);
    const users = await this.store.connectedUsers();
    if (users.length) this.begin(users[0]);
    console.log(`[Schwab] link on; ${users.length ? "signed in" : "waiting for Connect in Settings"}`);
  }

  rest(userId: number): SchwabRest {
    if (!this.tokens) throw new SchwabSignedOut("disconnected");
    return new SchwabRest(this.tokens, userId);
  }

  private async holdsStreamLock(): Promise<boolean> {
    if (this.lockClient) return true;
    const pool = getPool();
    if (!pool) return false;
    let c: pg.PoolClient | null = null;
    try {
      c = await pool.connect();
      const r = await c.query("select pg_try_advisory_lock($1) as ok", [STREAM_LOCK_KEY]);
      if (r.rows[0]?.ok) {
        c.on("error", () => { this.lockClient = null; });
        this.lockClient = c;
        return true;
      }
      c.release();
      return false;
    } catch {
      c?.release();
      return false;
    }
  }

  /** After sign-in (or at boot when already signed in). */
  begin(userId: number): void {
    this.userId = userId;
    if (!this.streamer) {
      const rest = this.rest(userId);
      this.streamer = new SchwabStreamer({
        accessToken: () => this.tokens!.accessToken(userId),
        streamerInfo: async () => {
          const pref = await rest.userPreference();
          const info = pref.streamerInfo?.[0];
          if (!info?.streamerSocketUrl) throw new Error("Schwab sent no streamer address");
          return info;
        },
        openSocket: (url) => new WebSocket(url) as unknown as WsLike,
        holdsLock: () => this.holdsStreamLock(),
        maxSymbols: this.cfg.maxStreamSymbols,
        log: (m) => console.log(`[Schwab] ${m}`),
      });
      setAlertWatchHook((owner, symbols) => this.streamer?.setSymbols(owner, symbols));
    }
    this.streamer.start();
    void this.checkRealtime(userId);
    this.scheduleSync(1_000);
  }

  stop(): void {
    this.streamer?.stop();
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = null;
  }

  private async checkRealtime(userId: number) {
    try {
      const [q] = await this.rest(userId).quotes(["SPY"]);
      this.realtime = q?.realtime ?? null;
    } catch {
      /* status shows null */
    }
  }

  private scheduleSync(ms: number) {
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(async () => {
      try {
        await this.sync();
      } catch (err) {
        if (err instanceof SchwabSignedOut) return this.stop();
        console.warn("[Schwab] positions sync failed:", (err as Error)?.message ?? err);
      }
      this.scheduleSync(getMarketSession() === "MARKET_HOURS" ? SYNC_MARKET_MS : SYNC_OTHER_MS);
    }, ms);
  }

  async sync() {
    const userId = this.userId;
    const pool = getPool();
    if (!userId || !pool || !this.store) throw new SchwabSignedOut("disconnected");
    const { positionsFrom } = await import("./rest");
    const positions = positionsFrom(await this.rest(userId).accounts());
    const conn = await this.store.load(userId);
    const { listId, plan } = await runSync(pool, userId, conn?.syncWatchlistId ?? null, positions);
    const at = Date.now();
    await this.store.setSync(userId, listId, at);
    this.lastSync = { at, inserted: plan.inserts.length, updated: plan.updates.length, removed: plan.deletes.length, skipped: plan.skipped };
    return { listId, ...this.lastSync };
  }

  async health(userId?: number) {
    const id = userId ?? this.userId;
    const conn = this.store && id ? await this.store.load(id) : null;
    const s = this.streamer;
    return buildHealth({
      cfg: this.cfg, conn,
      stream: s ? { state: s.state, symbols: s.symbols.length, lastMessageAt: s.lastMessageAt, reconnects: s.reconnects } : null,
      lastQuoteAgeSec: lastQuoteAgeSec(), realtime: this.realtime,
    });
  }
}

export const schwab = new SchwabService();
