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
import type { DailyBar } from "./types";

export type MaDataEntry = {
  ema10d: number | null;
  ema20d: number | null;
  sma20d: number | null;
  sma50d: number | null;
  sma200d: number | null;
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

/** Full-universe MA cycle = 5 shards × 1 minute. */
export const MA_SHARD_COUNT = 5;
export const MA_SHARD_INTERVAL_MS = 60_000;

/** @deprecated Prefer shard cadence; kept for single-symbol helpers. */
const SESSION_MA_REFRESH_MS = 5 * 60 * 1000;

let maRefreshInFlight = false;
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

export interface MaShardProgress {
  inFlight: boolean;
  shardCount: number;
  shardIntervalMs: number;
  nextShardIndex: number;
  lastShardIndex: number;
  lastShardStartedAt: string | null;
  lastShardFinishedAt: string | null;
  lastShardElapsedMs: number | null;
  lastShardRequested: number;
  lastShardComputed: number;
  universeSize: number;
  batchSize: number;
  coveredCount: number;
  msUntilNextShard: number | null;
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
    shardCount: MA_SHARD_COUNT,
    shardIntervalMs: MA_SHARD_INTERVAL_MS,
    nextShardIndex,
    lastShardIndex,
    lastShardStartedAt: lastShardStartedAt?.toISOString() ?? null,
    lastShardFinishedAt: lastShardFinishedAt?.toISOString() ?? null,
    lastShardElapsedMs,
    lastShardRequested,
    lastShardComputed,
    universeSize: lastUniverseSize,
    batchSize: lastBatchSize,
    coveredCount,
    msUntilNextShard: maRefreshInFlight ? 0 : msUntilNextShard,
  };
}

async function loadDailyBarsForSymbols(
  symbols: string[],
  snapshots: Map<string, SessionMaSnapshotInput>,
  days = 250
): Promise<Map<string, DailyBar[]>> {
  const db = getDb();
  const result = new Map<string, DailyBar[]>();
  if (!db || symbols.length === 0) return result;

  const upperSymbols = Array.from(new Set(symbols.map((s) => s.toUpperCase())));
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days - 10);
  const cutoffStr = cutoffDate.toISOString().split("T")[0];
  const today = new Date().toISOString().split("T")[0];

  const MAX_STALE_DAYS = 5;
  let staleSkipCount = 0;

  // Process DB in chunks — critically, process each chunk's bars immediately
  // and discard the raw DB rows so they can be GC'd, instead of accumulating
  // 170K+ rows in a single array.
  const DB_CHUNK_SIZE = 50;
  for (let i = 0; i < upperSymbols.length; i += DB_CHUNK_SIZE) {
    const chunk = upperSymbols.slice(i, i + DB_CHUNK_SIZE);
    const chunkBars = await db
      .select()
      .from(historicalBars)
      .where(
        and(
          inArray(historicalBars.symbol, chunk),
          gte(historicalBars.barDate, cutoffStr)
        )
      )
      .orderBy(historicalBars.symbol, desc(historicalBars.barDate));

    // Group by symbol within this chunk only
    const barsBySymbol = new Map<string, typeof chunkBars>();
    for (const bar of chunkBars) {
      const existing = barsBySymbol.get(bar.symbol) || [];
      existing.push(bar);
      barsBySymbol.set(bar.symbol, existing);
    }

    for (const symbol of chunk) {
      const symbolBars = barsBySymbol.get(symbol) || [];
      if (symbolBars.length < MIN_BARS_FOR_SESSION_MA) continue;

      const mostRecentDbDate = symbolBars[0]?.barDate;
      if (mostRecentDbDate) {
        const dbDate = new Date(mostRecentDbDate + "T00:00:00Z");
        const ageDays = (Date.now() - dbDate.getTime()) / (1000 * 60 * 60 * 24);
        if (ageDays > MAX_STALE_DAYS) {
          staleSkipCount++;
          continue;
        }
      }

      const barSlice = symbolBars.slice(0, days + 5);
      let hasLargeGap = false;
      for (let j = 0; j < barSlice.length - 1; j++) {
        const d1 = new Date(barSlice[j]!.barDate + "T00:00:00Z").getTime();
        const d2 = new Date(barSlice[j + 1]!.barDate + "T00:00:00Z").getTime();
        if (d1 - d2 > 7 * 86_400_000) {
          hasLargeGap = true;
          break;
        }
      }
      if (hasLargeGap) {
        staleSkipCount++;
        continue;
      }

      const candles: DailyBar[] = barSlice.map((b) => ({
        date: b.barDate,
        open: Number(b.open),
        high: Number(b.high),
        low: Number(b.low),
        close: Number(b.close),
        volume: Number(b.volume),
        vwap: b.vwap ? Number(b.vwap) : undefined,
      }));

      const snapshot = snapshots.get(symbol);
      if (snapshot && snapshot.open > 0) {
        if (!mostRecentDbDate || today > mostRecentDbDate) {
          candles.unshift({
            date: today,
            open: snapshot.open,
            high: snapshot.high,
            low: snapshot.low,
            close: snapshot.price,
            volume: snapshot.volume,
            vwap: snapshot.vwap,
          });
        } else if (mostRecentDbDate === today) {
          candles[0] = {
            date: today,
            open: snapshot.open,
            high: snapshot.high,
            low: snapshot.low,
            close: snapshot.price,
            volume: snapshot.volume,
            vwap: snapshot.vwap,
          };
        }
      }

      result.set(symbol, candles.slice(0, days));
    }

    // Yield between chunks so GC can reclaim the chunkBars memory
    if (i + DB_CHUNK_SIZE < upperSymbols.length) {
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  if (staleSkipCount > 0) {
    console.warn(`[SessionMA] Skipped ${staleSkipCount} symbols with stale DB data (>${MAX_STALE_DAYS} days old). Run refreshDailyBars.ts to update.`);
  }

  return result;
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
    if (!bars || bars.length < MIN_BARS_FOR_SESSION_MA) continue;

    const closes = bars.map((b) => b.close);
    const levels = computeTickerMasFromClosesNewestFirst(closes);
    if (!levels) continue;

    result.set(symbol, levelsToEntry(levels));
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
 * (legacy full-replace path). Prefer refreshNextSessionMaShard for MC polling.
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
 * Refresh the next universe shard (ceil(N/5) symbols) at most once per minute.
 * Merges into the shared cache so coverage accumulates across the full cycle.
 */
export async function refreshNextSessionMaShard(
  allSymbols: string[],
  snapshots: Map<string, SessionMaSnapshotInput>
): Promise<SessionMaCache> {
  const universe = Array.from(new Set(allSymbols.map((s) => s.toUpperCase())));
  lastUniverseSize = universe.length;
  lastBatchSize = universe.length > 0 ? Math.ceil(universe.length / MA_SHARD_COUNT) : 0;

  if (universe.length === 0) {
    return sessionMaCache ?? { data: new Map(), asOf: new Date(), mode: "session_adjusted" };
  }

  if (maRefreshInFlight) {
    return sessionMaCache ?? { data: new Map(), asOf: new Date(), mode: "session_adjusted" };
  }

  const now = Date.now();
  if (
    sessionMaCache &&
    lastShardKickAt &&
    now - lastShardKickAt.getTime() < MA_SHARD_INTERVAL_MS
  ) {
    return sessionMaCache;
  }

  if (nextShardIndex >= MA_SHARD_COUNT) nextShardIndex = 0;
  const batchSize = lastBatchSize;
  const start = nextShardIndex * batchSize;
  if (start >= universe.length) {
    nextShardIndex = 0;
  }
  const shardStart = nextShardIndex * batchSize;
  const shard = universe.slice(shardStart, shardStart + batchSize);
  const shardIndex = nextShardIndex;

  maRefreshInFlight = true;
  lastShardKickAt = new Date();
  lastShardStartedAt = lastShardKickAt;
  lastShardRequested = shard.length;
  lastShardComputed = 0;

  try {
    const entries = await computeMaEntriesForSymbols(shard, snapshots);
    lastShardComputed = entries.size;
    const merged = mergeIntoSessionMaCache(entries);
    lastShardIndex = shardIndex;
    nextShardIndex = (shardIndex + 1) % MA_SHARD_COUNT;
    lastShardFinishedAt = new Date();
    lastShardElapsedMs = lastShardFinishedAt.getTime() - lastShardStartedAt.getTime();
    console.log(
      `[SessionMA] Shard ${shardIndex + 1}/${MA_SHARD_COUNT}: ` +
        `${lastShardComputed}/${lastShardRequested} computed, ` +
        `coverage ${merged.data.size}/${universe.length}, ` +
        `${lastShardElapsedMs}ms`
    );
    return merged;
  } finally {
    maRefreshInFlight = false;
  }
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

function levelsToEntry(levels: TickerMaLevels): MaDataEntry {
  return {
    ema10d: levels.ema10d,
    ema20d: levels.ema20d,
    sma20d: levels.sma20d,
    sma50d: levels.sma50d,
    sma200d: levels.sma200d,
  };
}

export function clearSessionMaCache(): void {
  sessionMaCache = null;
  nextShardIndex = 0;
  lastShardKickAt = null;
  lastShardStartedAt = null;
  lastShardFinishedAt = null;
  lastShardElapsedMs = null;
  lastShardIndex = -1;
  lastShardRequested = 0;
  lastShardComputed = 0;
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
