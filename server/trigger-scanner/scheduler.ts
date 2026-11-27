/**
 * The always-on loop, regular session only, behind TRIGGER_SCANNER=on (startTriggerScanner does nothing otherwise).
 *
 * Every 30 s it checks the clock; just after each 5-minute bar closes (barSettleSec later) it fetches the new bars,
 * runs one pass (scan.ts), writes the candidates and a run row, and updates the status the route serves.
 * It pauses, and says why in its status (and a run row), when:
 *   - night mode or the weekend (server/infra/memory-gate isNightMode), or outside the regular session: "closed";
 *   - memory pressure (memory-gate isMemoryPressureHigh: heap > 70% of HEAP_LIMIT_MB or RSS > 72% of RSS_BUDGET_MB);
 *   - a heavy data job hit the RSS limit today (infra/job-guard guardTrippedToday): paused until tomorrow.
 * A paused pass fetches nothing; the next pass after the pause fetches every bar since the last fetch, so nothing is
 * lost, only late. Two failed bar fetches in a day drop it to the shortlist tier (shortlist.ts) for the rest of the day.
 */
import { getEtClock, getUsEquityMarketSession } from "@shared/usEquityMarketSession";
import { BarBook, type BarsFetcher } from "./bars-feed";
import type { DayData } from "./day-data";
import { readRotation, ROTATION_SYMBOLS, type EtfMove } from "./rotation";
import { Dedupe, runPass } from "./scan";
import { BAR_MS, sessionOpenMs } from "./session";
import { promoteShortlist, type QuoteRow } from "./shortlist";
import { RULE_VERSION, type ScannerSettings, type Tier } from "./settings";
import type { RunRow, TriggerStore } from "./store";
import type { Regime, Rotation } from "./types";

export interface SchedulerDeps {
  now(): Date;
  store: TriggerStore;
  settings: ScannerSettings;
  loadDay(date: string): Promise<DayData>;
  fetchBars: BarsFetcher;
  regime(): Regime;
  /** A reason to pause now, or null. */
  pauseReason(now: Date): string | null;
  quotes?(): Map<string, QuoteRow>;
  rssMb?(): number;
}

export interface ScannerStatus {
  enabled: boolean;
  state: "starting" | "closed" | "loading" | "running" | "paused" | "error";
  why: string | null;
  tier: Tier;
  tierWhy: string | null;
  marketDate: string | null;
  universeSize: number;
  dayLoadedAt: string | null;
  dayLoadSkipped: Record<string, number>;
  userSetups: DayData["userSetups"];
  watching: number;
  lastPassAt: string | null;
  lastBarClose: string | null;
  barsLagSec: number | null;
  lastPass: Omit<RunRow, "passAt" | "marketDate" | "ruleVersion"> | null;
  barsInMemory: number;
  requestsToday: number;
  storedToday: number;
  overCapToday: number;
  fetchFailuresToday: number;
  lastError: string | null;
  rotation: Rotation | null;
  regime: Regime | null;
  ruleVersion: string;
  asOf: string;
}

export class TriggerScanner {
  status: ScannerStatus;
  private day: DayData | null = null;
  private book: BarBook | null = null;
  private dedupe = new Dedupe();
  private evaluated = new Map<string, number>();
  private busy = false;
  private pausedSlot = 0;

  constructor(private deps: SchedulerDeps) {
    this.status = {
      enabled: true, state: "starting", why: null, tier: deps.settings.tier, tierWhy: deps.settings.tier === "shortlist" ? "set by TRIGGER_SCANNER_TIER" : null,
      marketDate: null, universeSize: 0, dayLoadedAt: null, dayLoadSkipped: {}, userSetups: [], watching: 0, lastPassAt: null,
      lastBarClose: null, barsLagSec: null, lastPass: null, barsInMemory: 0, requestsToday: 0, storedToday: 0, overCapToday: 0, fetchFailuresToday: 0,
      lastError: null, rotation: null, regime: null, ruleVersion: RULE_VERSION, asOf: new Date(0).toISOString(),
    };
  }

  /** One check; safe to call as often as wanted (it does work only once per bar). Returns what it did. */
  async tick(): Promise<string> {
    if (this.busy) return "busy";
    this.busy = true;
    try {
      return await this.step();
    } catch (err: any) {
      this.status.state = "error";
      this.status.lastError = String(err?.message ?? err).slice(0, 300);
      console.warn("[TriggerScanner] pass failed:", this.status.lastError);
      return "error";
    } finally {
      this.status.asOf = this.deps.now().toISOString();
      this.busy = false;
    }
  }

  private async step(): Promise<string> {
    const now = this.deps.now();
    const nowMs = now.getTime();
    const { dateKey } = getEtClock(now);
    if (getUsEquityMarketSession(now) !== "regular") {
      this.status.state = "closed";
      this.status.why = "outside the regular session";
      return "closed";
    }
    if (this.status.marketDate !== dateKey) this.resetDay(dateKey);
    const boundary = Math.floor(nowMs / BAR_MS) * BAR_MS;
    const pause = this.deps.pauseReason(now);
    if (pause) {
      this.status.state = "paused";
      this.status.why = pause;
      if (this.pausedSlot !== boundary) {
        this.pausedSlot = boundary;
        await this.writeRun(now, { paused: pause, symbolsScanned: 0, barsEvaluated: 0, requests: 0, triggers: 0, candidates: 0, deduped: 0, refused: {}, skipped: {}, durationMs: 0 });
      }
      return "paused";
    }
    if (!this.day) {
      this.status.state = "loading";
      this.status.why = "loading the day's daily context";
      this.day = await this.deps.loadDay(dateKey);
      this.book = new BarBook(dateKey);
      const seeds = await this.deps.store.dedupeSeeds(dateKey);
      this.status.storedToday = seeds.length;
      for (const s of seeds) {
        const base = s.dedupeKey.slice(0, s.dedupeKey.lastIndexOf("|"));
        this.dedupe.seed(base, Date.parse(s.triggerAt));
      }
      this.status.universeSize = this.day.universe.length;
      this.status.dayLoadedAt = this.day.loadedAt;
      this.status.dayLoadSkipped = this.day.skipped;
      this.status.userSetups = this.day.userSetups;
      this.status.watching = [...this.day.watch.values()].reduce((n, w) => n + w.length, 0);
    }
    if (nowMs - boundary < this.deps.settings.barSettleSec * 1000) return "settling";
    const book = this.book!;
    if (book.fetchedThroughMs !== null && boundary <= book.fetchedThroughMs) {
      this.status.state = "running";
      this.status.why = null;
      return "up_to_date";
    }
    const started = Date.now();
    const day = this.day;
    const symbols = this.fetchList(day, boundary);
    const from = new Date(book.fetchedThroughMs !== null ? book.fetchedThroughMs - BAR_MS : sessionOpenMs(dateKey));
    // The first check after the open: the last closed boundary is the open itself, so no bar of this session has
    // closed. Asking Alpaca for an end before the start answered 400 twice on 27 Nov (the first live session) and
    // dropped the scanner to the shortlist tier for the day. Nothing to fetch is not a failure.
    if (boundary - 1000 <= from.getTime()) {
      this.status.state = "running";
      this.status.why = "no bar of this session has closed yet";
      return "no_closed_bar";
    }
    let fetched;
    try {
      fetched = await this.deps.fetchBars(symbols, from, new Date(boundary - 1000));
    } catch (err: any) {
      this.status.fetchFailuresToday++;
      this.status.lastError = String(err?.message ?? err).slice(0, 300);
      if (this.status.fetchFailuresToday >= 2 && this.status.tier === "bars") {
        this.status.tier = "shortlist";
        this.status.tierWhy = `two failed bar fetches today (${this.status.lastError.slice(0, 80)})`;
      }
      this.status.state = "error";
      this.status.why = "bar fetch failed; retrying next check";
      return "fetch_failed";
    }
    this.status.requestsToday += fetched.requests;
    book.add(fetched.bars, boundary);
    const regime = this.deps.regime();
    const rotation = this.rotationNow(day, book);
    const only = this.status.tier === "shortlist" ? new Set(symbols) : undefined;
    const res = runPass({
      date: dateKey, contexts: day.contexts, bars: book.bySymbol, watch: day.watch, regime, rotation,
      settings: this.deps.settings, dedupe: this.dedupe, evaluated: this.evaluated, only, earningsAsOf: day.earningsAsOf,
    });
    // the daily cap: A first, then B, then C, lowest risk first inside a grade
    const room = Math.max(0, this.deps.settings.maxStoredPerDay - this.status.storedToday);
    const ranked = [...res.candidates].sort((a, b) => a.grade.localeCompare(b.grade) || a.riskPct - b.riskPct);
    const keep = ranked.slice(0, room);
    const over = ranked.length - keep.length;
    if (over > 0) {
      this.status.overCapToday += over;
      res.skipped.over_daily_cap = over;
    }
    const written = await this.deps.store.insertCandidates(keep);
    this.status.storedToday += written;
    const lastBarClose = book.newestClose();
    this.status.lastBarClose = lastBarClose;
    this.status.barsLagSec = lastBarClose ? Math.round((nowMs - Date.parse(lastBarClose)) / 1000) : null;
    this.status.lastPassAt = now.toISOString();
    this.status.barsInMemory = book.barCount();
    this.status.rotation = rotation;
    this.status.regime = regime;
    this.status.state = "running";
    this.status.why = null;
    await this.writeRun(now, {
      paused: null, symbolsScanned: res.symbolsScanned, barsEvaluated: res.barsEvaluated, requests: fetched.requests,
      triggers: res.triggers, candidates: written, deduped: res.deduped, refused: res.refused, skipped: res.skipped,
      durationMs: Date.now() - started,
    });
    return `pass:${written}`;
  }

  private fetchList(day: DayData, boundary: number): string[] {
    if (this.status.tier === "bars" || !this.deps.quotes) {
      if (this.status.tier === "shortlist" && !this.deps.quotes) this.status.tierWhy = (this.status.tierWhy ?? "") + "; no quotes, full universe";
      return day.universe;
    }
    const slot = Math.max(0, Math.round((boundary - sessionOpenMs(day.date)) / BAR_MS) - 1);
    const picked = promoteShortlist(this.deps.quotes(), day.contexts, { max: this.deps.settings.shortlistMax, slot, watched: new Set(day.watch.keys()) });
    // names already shortlisted today stay, so their bar history is not cut
    const kept = [...(this.book?.bySymbol.keys() ?? [])];
    return [...new Set([...ROTATION_SYMBOLS, ...kept, ...picked])];
  }

  private rotationNow(day: DayData, book: BarBook): Rotation {
    const moves = new Map<string, EtfMove>();
    for (const sym of ROTATION_SYMBOLS) {
      const ctx = day.contexts.get(sym);
      const bars = book.bySymbol.get(sym);
      const last = bars?.[bars.length - 1]?.c ?? null;
      moves.set(sym, {
        todayPct: ctx && last ? (last / ctx.prevClose - 1) * 100 : null,
        d5Pct: ctx?.close5dAgo && last ? (last / ctx.close5dAgo - 1) * 100 : null,
      });
    }
    return readRotation(moves, this.deps.settings, book.newestClose());
  }

  private async writeRun(now: Date, r: Omit<RunRow, "marketDate" | "passAt" | "tier" | "universeSize" | "barsLagSec" | "rssMb" | "ruleVersion">) {
    const row: RunRow = {
      ...r, marketDate: this.status.marketDate ?? getEtClock(now).dateKey, passAt: now, tier: this.status.tier,
      universeSize: this.status.universeSize, barsLagSec: this.status.barsLagSec, rssMb: this.deps.rssMb?.() ?? null, ruleVersion: RULE_VERSION,
    };
    const { marketDate: _d, passAt: _p, ruleVersion: _v, ...rest } = row;
    this.status.lastPass = rest;
    try {
      await this.deps.store.insertRun(row);
    } catch (err) {
      console.warn("[TriggerScanner] run row write failed:", String(err).slice(0, 120));
    }
  }

  private resetDay(date: string) {
    this.status.marketDate = date;
    this.day = null;
    this.book = null;
    this.dedupe.clear();
    this.evaluated.clear();
    this.status.tier = this.deps.settings.tier;
    this.status.tierWhy = this.deps.settings.tier === "shortlist" ? "set by TRIGGER_SCANNER_TIER" : null;
    this.status.requestsToday = 0;
    this.status.storedToday = 0;
    this.status.overCapToday = 0;
    this.status.fetchFailuresToday = 0;
    this.status.barsInMemory = 0;
    this.status.lastError = null;
  }
}

// ---- the process's one scanner ----------------------------------------------------------------------------------

let instance: TriggerScanner | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

export function getScanner(): TriggerScanner | null {
  return instance;
}

/** Pause reasons from the app's own guards. */
export async function livePauseReason(): Promise<(now: Date) => string | null> {
  const { isNightMode, isMemoryPressureHigh } = await import("../infra/memory-gate");
  const { guardTrippedToday, guardState } = await import("../infra/job-guard");
  return (now: Date) => {
    if (isNightMode(now)) return "night mode";
    if (guardTrippedToday()) return `memory guard tripped today (${guardState()?.where ?? "a data job"}); paused until tomorrow`;
    if (isMemoryPressureHigh()) return "memory pressure";
    return null;
  };
}

/** Start the loop. Does nothing (no timer, no query) unless TRIGGER_SCANNER=on. */
export async function startTriggerScanner(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const { scannerEnabled, loadSettings } = await import("./settings");
  if (!scannerEnabled(env) || instance) return;
  const { getDb } = await import("../db");
  const db = getDb();
  if (!db) {
    console.warn("[TriggerScanner] TRIGGER_SCANNER=on but no database; not started");
    return;
  }
  const { pgTriggerStore } = await import("./store");
  const { loadDayFromDb } = await import("./day-data");
  const { alpacaBarsFetcher } = await import("./bars-feed");
  const { getCachedRAI } = await import("../market-condition/engine/rai");
  const { getRawSnapshotsForScanner } = await import("../market-condition/engine/snapshot");
  const settings = loadSettings(env);
  const store = pgTriggerStore(db as any);
  const pauseReason = await livePauseReason();
  instance = new TriggerScanner({
    now: () => new Date(),
    store,
    settings,
    loadDay: (date) => loadDayFromDb(db as any, store, date, settings),
    fetchBars: alpacaBarsFetcher({ feed: settings.feed, batch: settings.barsBatch }),
    regime: () => {
      const r = getCachedRAI();
      return r ? { label: r.label, score: r.score, asOf: new Date(r.calculatedAt).toISOString() } : { label: null, score: null, asOf: null };
    },
    pauseReason,
    quotes: () => {
      const m = new Map<string, QuoteRow>();
      for (const [sym, s] of getRawSnapshotsForScanner()) {
        if (s && s.price > 0) m.set(String(sym).toUpperCase(), { price: s.price, open: s.open, high: s.high, low: s.low, volume: s.volume, vwap: s.vwap });
      }
      return m;
    },
    rssMb: () => Math.round(process.memoryUsage().rss / 1048576),
  });
  const { trackJob } = await import("../infra/memory-gate");
  timer = setInterval(() => {
    if (!instance) return;
    const untrack = trackJob("trigger scanner");
    void instance.tick().finally(untrack);
  }, 30_000);
  console.log(`[TriggerScanner] started (tier ${settings.tier}, ${RULE_VERSION})`);
}

export function stopTriggerScannerForTests(): void {
  if (timer) clearInterval(timer);
  timer = null;
  instance = null;
}
