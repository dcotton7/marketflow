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

const SESSION_MA_REFRESH_MS = 5 * 60 * 1000;

export function getSessionMaCache(): SessionMaCache | null {
  return sessionMaCache;
}

export function shouldRefreshSessionMa(): boolean {
  if (!sessionMaCache) return true;
  return Date.now() - sessionMaCache.asOf.getTime() >= SESSION_MA_REFRESH_MS;
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

  const dbBars = await db
    .select()
    .from(historicalBars)
    .where(
      and(
        inArray(historicalBars.symbol, upperSymbols),
        gte(historicalBars.barDate, cutoffStr)
      )
    )
    .orderBy(historicalBars.symbol, desc(historicalBars.barDate));

  const barsBySymbol = new Map<string, typeof dbBars>();
  for (const bar of dbBars) {
    const existing = barsBySymbol.get(bar.symbol) || [];
    existing.push(bar);
    barsBySymbol.set(bar.symbol, existing);
  }

  const MAX_STALE_DAYS = 5;
  let staleSkipCount = 0;

  for (const symbol of upperSymbols) {
    const symbolBars = barsBySymbol.get(symbol) || [];
    if (symbolBars.length < MIN_BARS_FOR_SESSION_MA) continue;

    // Reject stale data — if newest DB bar is more than MAX_STALE_DAYS old,
    // the MA would be garbage (averaging today's price with month-old closes).
    const mostRecentDbDate = symbolBars[0]?.barDate;
    if (mostRecentDbDate) {
      const dbDate = new Date(mostRecentDbDate + "T00:00:00Z");
      const ageDays = (Date.now() - dbDate.getTime()) / (1000 * 60 * 60 * 24);
      if (ageDays > MAX_STALE_DAYS) {
        staleSkipCount++;
        continue;
      }
    }

    const candles: DailyBar[] = symbolBars.slice(0, days + 5).map((b) => ({
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

  if (staleSkipCount > 0) {
    console.warn(`[SessionMA] Skipped ${staleSkipCount} symbols with stale DB data (>${MAX_STALE_DAYS} days old). Run refreshDailyBars.ts to update.`);
  }

  return result;
}

/**
 * Recompute session-adjusted MAs for the given symbols using live snapshot prices.
 */
export async function computeSessionAdjustedMADataForSymbols(
  symbols: string[],
  snapshots: Map<string, SessionMaSnapshotInput>
): Promise<SessionMaCache> {
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

  const cache: SessionMaCache = {
    data: result,
    asOf: new Date(),
    mode: "session_adjusted",
  };
  sessionMaCache = cache;
  return cache;
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
  if (sessionMaCache && !shouldRefreshSessionMa()) {
    const cached = sessionMaCache.data.get(upper);
    if (cached) return cached;
  }
  if (!snapshot) return null;
  const snapMap = new Map<string, SessionMaSnapshotInput>([[upper, snapshot]]);
  const cache = await computeSessionAdjustedMADataForSymbols([upper], snapMap);
  return cache.data.get(upper) ?? null;
}
