/**
 * Session-adjusted daily MAs: prior completed daily closes + today's live snapshot bar.
 */

import { and, desc, gte, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { historicalBars } from "@shared/schema";
import {
  computeTickerMasFromClosesNewestFirst,
  MIN_BARS_FOR_SESSION_MA,
  type TickerMaLevels,
} from "../shared/daily-ma-from-bars";
import { shouldRunHeavyBackgroundWork, trackJob } from "../infra/memory-gate";

export type MaDataEntry = {
  ema10d: number | null;
  ema20d: number | null;
  sma20d: number | null;
  sma50d: number | null;
  sma200d: number | null;
  /** 20-session average daily range (high−low), dollars. Used by scanner adr_blowout. */
  adr20: number | null;
};

export type MaMode = "session_adjusted" | "eod_db";

export interface SessionMaCache {
  data: Map<string, MaDataEntry>;
  asOf: Date;
  mode: MaMode;
}

/** Minimal snapshot fields needed to build today's developing daily bar. */
export interface SessionMaSnapshotInput {
  open: number;
  high: number;
  low: number;
  price: number;
  volume: number;
  vwap?: number;
}

let sessionMaCache: SessionMaCache | null = null;

/**
 * Full-universe MA cycle: 5 batches of ceil(N/5), 2s pause between batches,
 * kicked at most once per minute (full pass finishes inside the first minute).
 */
export const MA_SHARD_COUNT = 5;
export const MA_BATCH_PAUSE_MS = 2_000;
export const MA_SHARD_INTERVAL_MS = 60_000;

/** @deprecated Prefer shard cadence; kept for single-symbol helpers. */
const SESSION_MA_REFRESH_MS = 5 * 60 * 1000;

let maRefreshInFlight = false;
let maIsPausing = false;
let nextShardIndex = 0;
let lastShardKickAt: Date | null = null;
let lastShardStartedAt: Date | null = null;
let lastShardFinishedAt: Date | null = null;
let lastShardElapsedMs: number | null = null;
let lastShardIndex = -1;
let lastShardRequested = 0;
let lastShardComputed = 0;
let lastUniverseSize = 0;
let lastBatchSize = 0;
let lastChainElapsedMs: number | null = null;

export interface MaShardProgress {
  inFlight: boolean;
  isPausing: boolean;
  shardCount: number;
  shardIntervalMs: number;
  batchPauseMs: number;
  nextShardIndex: number;
  lastShardIndex: number;
  lastShardStartedAt: string | null;
  lastShardFinishedAt: string | null;
  lastShardElapsedMs: number | null;
  lastChainElapsedMs: number | null;
  lastShardRequested: number;
  lastShardComputed: number;
  universeSize: number;
  batchSize: number;
  coveredCount: number;
  msUntilNextShard: number | null;
}

export type MaBatchMergedCallback = (cache: SessionMaCache) => void;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getSessionMaCache(): SessionMaCache | null {
  return sessionMaCache;
}

export function shouldRefreshSessionMa(): boolean {
  if (!sessionMaCache) return true;
  return Date.now() - sessionMaCache.asOf.getTime() >= SESSION_MA_REFRESH_MS;
}

export function getMaShardProgress(): MaShardProgress {
  const coveredCount = sessionMaCache?.data.size ?? 0;
  let msUntilNextShard: number | null = null;
  if (lastShardKickAt) {
    msUntilNextShard = Math.max(0, MA_SHARD_INTERVAL_MS - (Date.now() - lastShardKickAt.getTime()));
  }
  return {
    inFlight: maRefreshInFlight,
    isPausing: maIsPausing,
    shardCount: MA_SHARD_COUNT,
    shardIntervalMs: MA_SHARD_INTERVAL_MS,
    batchPauseMs: MA_BATCH_PAUSE_MS,
    nextShardIndex,
    lastShardIndex,
    lastShardStartedAt: lastShardStartedAt?.toISOString() ?? null,
    lastShardFinishedAt: lastShardFinishedAt?.toISOString() ?? null,
    lastShardElapsedMs,
    lastChainElapsedMs,
    lastShardRequested,
    lastShardComputed,
    universeSize: lastUniverseSize,
    batchSize: lastBatchSize,
    coveredCount,
    msUntilNextShard: maRefreshInFlight ? 0 : msUntilNextShard,
  };
}

/**
 * Prior daily bars per symbol, read from historical_bars and kept (compact) between MA chains.
 *
 * The chain runs every minute in market hours over the whole universe (about 1,750 names). It used to read every
 * name's last ~440 calendar days of bars (all columns, ~300 rows a name, ~500k rows a minute) from Postgres on every
 * pass, although only today's live bar changes during the day: that was the largest steady allocation in the process
 * (pg row objects, numeric strings and Dates, freed a minute later). Now the prior bars are read once and kept for
 * PRIOR_BARS_TTL_MS as three Float64Arrays a name (close, high, low; ~6 KB a name, ~11 MB for 1,750), and each pass
 * puts today's live bar on top exactly as before. The cache is dropped when the date changes, when the daily bar job
 * writes bars (invalidateSessionMaPriorBars), and is capped at PRIOR_BARS_MAX names.
 */
interface PriorBars {
  loadedAt: number;
  /** Newest stored bar date, or null when the name has no bar in the lookback. */
  mostRecentDbDate: string | null;
  /** Fewer than MIN_BARS_FOR_SESSION_MA bars in the lookback: no MA (as before). */
  tooFew: boolean;
  /** A gap of more than 7 days between two of the newest days+5 bars: skipped as stale (as before). */
  hasLargeGap: boolean;
  /** Newest first, at most days+5 bars. */
  closes: Float64Array;
  highs: Float64Array;
  lows: Float64Array;
}

const PRIOR_BARS_TTL_MS = 30 * 60 * 1000;
const PRIOR_BARS_MAX = 6_000;
const priorBars = new Map<string, PriorBars>();
let priorBarsDays = 0;
let priorBarsDate = "";

/** Drop the kept prior bars (all, or the given names): the next pass reads them again from the database. */
export function invalidateSessionMaPriorBars(symbols?: string[]): void {
  if (!symbols) {
    priorBars.clear();
    return;
  }
  for (const s of symbols) priorBars.delete(s.toUpperCase());
}

/** For the repro script and tests: how many names have prior bars kept. */
export function sessionMaPriorBarsSize(): number {
  return priorBars.size;
}

async function ensurePriorBars(upperSymbols: string[], days: number, today: string): Promise<void> {
  const db = getDb();
  if (!db) return;
  if (priorBarsDate !== today || priorBarsDays !== days) {
    priorBars.clear();
    priorBarsDate = today;
    priorBarsDays = days;
  }
  const now = Date.now();
  const missing = upperSymbols.filter((s) => {
    const e = priorBars.get(s);
    return !e || now - e.loadedAt >= PRIOR_BARS_TTL_MS;
  });
  if (missing.length === 0) return;
  if (priorBars.size + missing.length > PRIOR_BARS_MAX) priorBars.clear();

  // Calendar lookback must cover ~days trading sessions (weekends/holidays).
  // 250 calendar days ≈ 170 sessions — too short for SMA200. Use ~1.6× + buffer.
  const calendarLookbackDays = Math.ceil(days * 1.65) + 30;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - calendarLookbackDays);
  const cutoffStr = cutoffDate.toISOString().split("T")[0];

  // Chunks of 50 names; each chunk's rows are reduced to arrays at once and dropped.
  const DB_CHUNK_SIZE = 50;
  for (let i = 0; i < missing.length; i += DB_CHUNK_SIZE) {
    const chunk = missing.slice(i, i + DB_CHUNK_SIZE);
    const chunkBars = await db
      .select({
        symbol: historicalBars.symbol,
        barDate: historicalBars.barDate,
        high: historicalBars.high,
        low: historicalBars.low,
        close: historicalBars.close,
      })
      .from(historicalBars)
      .where(
        and(
          inArray(historicalBars.symbol, chunk),
          gte(historicalBars.barDate, cutoffStr)
        )
      )
      .orderBy(historicalBars.symbol, desc(historicalBars.barDate));

    const barsBySymbol = new Map<string, typeof chunkBars>();
    for (const bar of chunkBars) {
      const existing = barsBySymbol.get(bar.symbol) || [];
      existing.push(bar);
      barsBySymbol.set(bar.symbol, existing);
    }

    const loadedAt = Date.now();
    for (const symbol of chunk) {
      const symbolBars = barsBySymbol.get(symbol) || [];
      const mostRecentDbDate = symbolBars[0]?.barDate ?? null;
      const tooFew = symbolBars.length < MIN_BARS_FOR_SESSION_MA;
      const barSlice = tooFew ? [] : symbolBars.slice(0, days + 5);
      let hasLargeGap = false;
      for (let j = 0; j < barSlice.length - 1; j++) {
        const d1 = new Date(barSlice[j]!.barDate + "T00:00:00Z").getTime();
        const d2 = new Date(barSlice[j + 1]!.barDate + "T00:00:00Z").getTime();
        if (d1 - d2 > 7 * 86_400_000) {
          hasLargeGap = true;
          break;
        }
      }
      const keep = hasLargeGap ? [] : barSlice;
      priorBars.set(symbol, {
        loadedAt,
        mostRecentDbDate,
        tooFew,
        hasLargeGap,
        closes: Float64Array.from(keep, (b) => Number(b.close)),
        highs: Float64Array.from(keep, (b) => Number(b.high)),
        lows: Float64Array.from(keep, (b) => Number(b.low)),
      });
    }

    // Yield between chunks so GC can reclaim the chunk's rows
    if (i + DB_CHUNK_SIZE < missing.length) {
      await new Promise((r) => setTimeout(r, 5));
    }
  }
}

/** Session bars newest first (today's live bar on top when there is a snapshot), as close/high/low arrays. */
interface SessionSeries {
  closes: number[];
  highs: number[];
  lows: number[];
}

async function loadDailyBarsForSymbols(
  symbols: string[],
  snapshots: Map<string, SessionMaSnapshotInput>,
  days = 250
): Promise<Map<string, SessionSeries>> {
  const result = new Map<string, SessionSeries>();
  if (!getDb() || symbols.length === 0) return result;

  const upperSymbols = Array.from(new Set(symbols.map((s) => s.toUpperCase())));
  const today = new Date().toISOString().split("T")[0];
  await ensurePriorBars(upperSymbols, days, today);

  const MAX_STALE_DAYS = 5;
  let staleSkipCount = 0;

  for (const symbol of upperSymbols) {
    const prior = priorBars.get(symbol);
    if (!prior || prior.tooFew) continue;

    const mostRecentDbDate = prior.mostRecentDbDate;
    if (mostRecentDbDate) {
      const dbDate = new Date(mostRecentDbDate + "T00:00:00Z");
      const ageDays = (Date.now() - dbDate.getTime()) / (1000 * 60 * 60 * 24);
      if (ageDays > MAX_STALE_DAYS) {
        staleSkipCount++;
        continue;
      }
    }
    if (prior.hasLargeGap) {
      staleSkipCount++;
      continue;
    }

    const closes = Array.from(prior.closes);
    const highs = Array.from(prior.highs);
    const lows = Array.from(prior.lows);

    const snapshot = snapshots.get(symbol);
    if (snapshot && snapshot.open > 0) {
      if (!mostRecentDbDate || today > mostRecentDbDate) {
        closes.unshift(snapshot.price);
        highs.unshift(snapshot.high);
        lows.unshift(snapshot.low);
      } else if (mostRecentDbDate === today) {
        closes[0] = snapshot.price;
        highs[0] = snapshot.high;
        lows[0] = snapshot.low;
      }
    }

    result.set(symbol, {
      closes: closes.slice(0, days),
      highs: highs.slice(0, days),
      lows: lows.slice(0, days),
    });
  }

  if (staleSkipCount > 0) {
    console.warn(`[SessionMA] Skipped ${staleSkipCount} symbols with stale DB data (>${MAX_STALE_DAYS} days old). Run refreshDailyBars.ts to update.`);
  }

  return result;
}

/** Average (high−low) over the newest `period` sessions. Bars are newest-first. */
function computeAdr20(highs: number[], lows: number[], period = 20): number | null {
  if (highs.length < period) return null;
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += Math.max(0, highs[i]! - lows[i]!);
  }
  const adr = sum / period;
  return adr > 0 ? adr : null;
}

/** Compute MA entries for symbols without replacing the shared cache. */
async function computeMaEntriesForSymbols(
  symbols: string[],
  snapshots: Map<string, SessionMaSnapshotInput>
): Promise<Map<string, MaDataEntry>> {
  const unique = Array.from(new Set(symbols.map((s) => s.toUpperCase())));
  const barsMap = await loadDailyBarsForSymbols(unique, snapshots);
  const result = new Map<string, MaDataEntry>();

  for (const symbol of unique) {
    const bars = barsMap.get(symbol);
    if (!bars || bars.closes.length < MIN_BARS_FOR_SESSION_MA) continue;

    const levels = computeTickerMasFromClosesNewestFirst(bars.closes);
    if (!levels) continue;

    result.set(symbol, levelsToEntry(levels, computeAdr20(bars.highs, bars.lows, 20)));
  }

  return result;
}

function mergeIntoSessionMaCache(entries: Map<string, MaDataEntry>): SessionMaCache {
  const asOf = new Date();
  if (!sessionMaCache) {
    sessionMaCache = { data: new Map(entries), asOf, mode: "session_adjusted" };
  } else {
    for (const [sym, entry] of entries) {
      sessionMaCache.data.set(sym, entry);
    }
    sessionMaCache.asOf = asOf;
    sessionMaCache.mode = "session_adjusted";
  }
  return sessionMaCache;
}

/**
 * Recompute session-adjusted MAs for the given symbols and replace the cache
 * (legacy full-replace path). Prefer kickSessionMaBatchChain for MC polling.
 */
export async function computeSessionAdjustedMADataForSymbols(
  symbols: string[],
  snapshots: Map<string, SessionMaSnapshotInput>
): Promise<SessionMaCache> {
  const result = await computeMaEntriesForSymbols(symbols, snapshots);
  sessionMaCache = {
    data: result,
    asOf: new Date(),
    mode: "session_adjusted",
  };
  return sessionMaCache;
}

export async function getSessionAdjustedMADataForSymbols(
  symbols: string[],
  snapshots: Map<string, SessionMaSnapshotInput>,
  forceRefresh = false
): Promise<SessionMaCache> {
  if (!forceRefresh && sessionMaCache && !shouldRefreshSessionMa()) {
    return sessionMaCache;
  }
  return computeSessionAdjustedMADataForSymbols(symbols, snapshots);
}

/**
 * Run all 5 × ceil(N/5) batches with MA_BATCH_PAUSE_MS between them.
 * Full universe completes inside the first minute of each cycle.
 */
async function runSessionMaBatchChain(
  universe: string[],
  snapshots: Map<string, SessionMaSnapshotInput>,
  onBatchMerged?: MaBatchMergedCallback
): Promise<SessionMaCache> {
  const batchSize = Math.ceil(universe.length / MA_SHARD_COUNT);
  lastBatchSize = batchSize;
  lastUniverseSize = universe.length;
  const chainStartedAt = Date.now();
  let merged =
    sessionMaCache ?? { data: new Map<string, MaDataEntry>(), asOf: new Date(), mode: "session_adjusted" as MaMode };

  for (let shardIndex = 0; shardIndex < MA_SHARD_COUNT; shardIndex++) {
    if (!shouldRunHeavyBackgroundWork()) {
      console.warn(
        `[SessionMA] Stopping chain at batch ${shardIndex + 1}/${MA_SHARD_COUNT} — night mode or memory pressure.`
      );
      break;
    }
    const shardStart = shardIndex * batchSize;
    if (shardStart >= universe.length) break;
    const shard = universe.slice(shardStart, shardStart + batchSize);
    const batchStartedAt = Date.now();
    lastShardStartedAt = new Date(batchStartedAt);
    lastShardIndex = shardIndex;
    nextShardIndex = shardIndex;
    lastShardRequested = shard.length;
    lastShardComputed = 0;
    maIsPausing = false;

    const entries = await computeMaEntriesForSymbols(shard, snapshots);
    lastShardComputed = entries.size;
    merged = mergeIntoSessionMaCache(entries);
    lastShardFinishedAt = new Date();
    lastShardElapsedMs = lastShardFinishedAt.getTime() - batchStartedAt;
    onBatchMerged?.(merged);

    console.log(
      `[SessionMA] Batch ${shardIndex + 1}/${MA_SHARD_COUNT}: ` +
        `${lastShardComputed}/${lastShardRequested} computed, ` +
        `coverage ${merged.data.size}/${universe.length}, ` +
        `${lastShardElapsedMs}ms`
    );

    if (shardIndex < MA_SHARD_COUNT - 1 && shardStart + batchSize < universe.length) {
      maIsPausing = true;
      await sleep(MA_BATCH_PAUSE_MS);
      maIsPausing = false;
    }
  }

  nextShardIndex = 0;
  lastChainElapsedMs = Date.now() - chainStartedAt;
  console.log(
    `[SessionMA] Chain complete: coverage ${merged.data.size}/${universe.length} in ${lastChainElapsedMs}ms`
  );
  return merged;
}

/**
 * Kick a full 5-batch MA chain at most once per minute (fire-and-forget friendly).
 * Returns current cache immediately; chain updates merge in the background.
 */
export function kickSessionMaBatchChain(
  allSymbols: string[],
  snapshots: Map<string, SessionMaSnapshotInput>,
  onBatchMerged?: MaBatchMergedCallback
): SessionMaCache {
  const universe = Array.from(new Set(allSymbols.map((s) => s.toUpperCase())));
  lastUniverseSize = universe.length;
  lastBatchSize = universe.length > 0 ? Math.ceil(universe.length / MA_SHARD_COUNT) : 0;
  const empty: SessionMaCache = { data: new Map(), asOf: new Date(), mode: "session_adjusted" };

  if (universe.length === 0) {
    return sessionMaCache ?? empty;
  }

  if (maRefreshInFlight) {
    return sessionMaCache ?? empty;
  }

  if (!shouldRunHeavyBackgroundWork()) {
    if (!sessionMaCache) {
      console.log("[SessionMA] Skipping chain kick — night mode or memory pressure (no cache yet).");
    }
    return sessionMaCache ?? empty;
  }

  const now = Date.now();
  if (
    sessionMaCache &&
    lastShardKickAt &&
    now - lastShardKickAt.getTime() < MA_SHARD_INTERVAL_MS
  ) {
    return sessionMaCache;
  }

  maRefreshInFlight = true;
  lastShardKickAt = new Date();
  lastShardStartedAt = lastShardKickAt;
  lastChainElapsedMs = null;

  void (async () => {
    const untrack = trackJob("session MA chain");
    try {
      await runSessionMaBatchChain(universe, snapshots, onBatchMerged);
    } catch (err) {
      console.error("[SessionMA] Batch chain failed:", err);
    } finally {
      untrack();
      maRefreshInFlight = false;
      maIsPausing = false;
    }
  })();

  return sessionMaCache ?? empty;
}

/**
 * @deprecated Prefer kickSessionMaBatchChain (non-blocking). Kept for callers that await.
 * Starts the batch chain and returns the cache immediately (chain continues in background).
 */
export async function refreshNextSessionMaShard(
  allSymbols: string[],
  snapshots: Map<string, SessionMaSnapshotInput>
): Promise<SessionMaCache> {
  return kickSessionMaBatchChain(allSymbols, snapshots);
}

export function maEntryToTickerMas(symbol: string, entry: MaDataEntry) {
  return {
    symbol,
    ema10d: entry.ema10d,
    ema20d: entry.ema20d,
    sma20d: entry.sma20d,
    sma50d: entry.sma50d,
    sma200d: entry.sma200d,
    updatedAt: sessionMaCache?.asOf ?? new Date(),
  };
}

function levelsToEntry(levels: TickerMaLevels, adr20: number | null = null): MaDataEntry {
  return {
    ema10d: levels.ema10d,
    ema20d: levels.ema20d,
    sma20d: levels.sma20d,
    sma50d: levels.sma50d,
    sma200d: levels.sma200d,
    adr20,
  };
}

export function clearSessionMaCache(): void {
  sessionMaCache = null;
  nextShardIndex = 0;
  lastShardKickAt = null;
  lastShardStartedAt = null;
  lastShardFinishedAt = null;
  lastShardElapsedMs = null;
  lastChainElapsedMs = null;
  lastShardIndex = -1;
  lastShardRequested = 0;
  lastShardComputed = 0;
  maIsPausing = false;
}

/** Prefer MC poll cache when fresh; otherwise compute from live snapshot OHLC. */
export async function resolveSessionMaLevelsForSymbol(
  symbol: string,
  livePrice: number,
  snapshot?: SessionMaSnapshotInput | null
): Promise<MaDataEntry | null> {
  const upper = symbol.toUpperCase();
  if (livePrice <= 0) return null;

  if (sessionMaCache && !shouldRefreshSessionMa()) {
    const cached = sessionMaCache.data.get(upper);
    if (cached) return cached;
  }

  const snap: SessionMaSnapshotInput = snapshot ?? {
    open: livePrice,
    high: livePrice,
    low: livePrice,
    price: livePrice,
    volume: 0,
  };
  if (snap.open <= 0) snap.open = livePrice;
  if (snap.high <= 0) snap.high = livePrice;
  if (snap.low <= 0) snap.low = livePrice;
  snap.price = livePrice;

  return getSessionAdjustedMAsForSymbol(upper, snap);
}

/** Single-symbol helper for Alerts (uses cached session MA when fresh). */
export async function getSessionAdjustedMAsForSymbol(
  symbol: string,
  snapshot?: SessionMaSnapshotInput | null
): Promise<MaDataEntry | null> {
  const upper = symbol.toUpperCase();
  const cached = sessionMaCache?.data.get(upper);
  if (cached && sessionMaCache && !shouldRefreshSessionMa()) {
    return cached;
  }
  if (!snapshot) return cached ?? null;
  const snapMap = new Map<string, SessionMaSnapshotInput>([[upper, snapshot]]);
  const entries = await computeMaEntriesForSymbols([upper], snapMap);
  const merged = mergeIntoSessionMaCache(entries);
  return merged.data.get(upper) ?? null;
}
