/**
 * Intraday Bars Data Layer
 * 
 * Provides intraday bars (5min, 15min, 30min) from Alpaca API
 * with an in-memory LRU cache and adaptive TTL.
 * 
 * Cache Strategy:
 * - Historical base cache stays warm longer for fast chart loads
 * - The trailing bars are refreshed from Alpaca on live requests
 * - The current last bar is still snapshot-patched between bar closes
 * 
 * Memory Budget: ~100MB for 50 hot tickers × 3 timeframes
 */

import { getAlpacaIntradayData } from "../alpaca";
import { getTickerSnapshot } from "../market-condition/engine/snapshot";
import { getMarketSession } from "../market-condition/universe";
import { IntradayBar } from "./types";

interface IntradayCacheValue {
  bars: IntradayBar[];
  fetchedAt: Date;
  lastTailRefreshAt: Date;
  interval: string;
}

const intradayCache = new Map<string, IntradayCacheValue>();
const MAX_CACHE_ENTRIES = 150;

function getTTLMs(): number {
  const session = getMarketSession();
  
  if (session === "MARKET_HOURS") {
    return 15 * 60_000; // keep the full history warm, refresh the tail separately
  } else if (session === "AFTER_HOURS") {
    return 30 * 60_000;
  } else {
    return 2 * 60 * 60_000;
  }
}

function shouldRefreshTail(): boolean {
  const session = getMarketSession();
  return session === "MARKET_HOURS" || session === "AFTER_HOURS";
}

function evictOldest(): void {
  if (intradayCache.size >= MAX_CACHE_ENTRIES) {
    let oldestKey: string | null = null;
    let oldestTime = Date.now();

    for (const [key, value] of Array.from(intradayCache.entries())) {
      const activityTime = Math.max(
        value.fetchedAt.getTime(),
        value.lastTailRefreshAt.getTime()
      );
      if (activityTime < oldestTime) {
        oldestTime = activityTime;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      intradayCache.delete(oldestKey);
    }
  }
}

function mergeCurrentBar(
  bars: IntradayBar[],
  symbol: string,
  interval: string
): IntradayBar[] {
  if (bars.length === 0) return bars;
  
  const snapshot = getTickerSnapshot(symbol.toUpperCase());
  if (!snapshot || snapshot.open <= 0) return bars;
  
  const lastBar = bars[bars.length - 1];
  const lastBarTime = new Date(lastBar.timestamp).getTime();
  const snapshotTime = snapshot.timestamp instanceof Date
    ? snapshot.timestamp.getTime()
    : new Date(snapshot.timestamp).getTime();
  const intervalMs = parseIntervalMs(interval);
  const now = Date.now();
  const currentBucketStart = Math.floor(snapshotTime / intervalMs) * intervalMs;

  if (!Number.isFinite(snapshotTime) || !Number.isFinite(currentBucketStart)) {
    return bars;
  }

  if (currentBucketStart > lastBarTime) {
    bars.push({
      timestamp: new Date(currentBucketStart).toISOString(),
      open: lastBar.close,
      high: Math.max(lastBar.close, snapshot.price, snapshot.high),
      low: Math.min(lastBar.close, snapshot.price, snapshot.low),
      close: snapshot.price,
      volume: snapshot.volume,
      vwap: snapshot.vwap,
    });
    return bars;
  }
  
  if (currentBucketStart === lastBarTime || now - lastBarTime < intervalMs * 2) {
    bars[bars.length - 1] = {
      ...lastBar,
      close: snapshot.price,
      high: Math.max(lastBar.high, snapshot.high),
      low: Math.min(lastBar.low, snapshot.low),
      volume: snapshot.volume,
    };
  }
  
  return bars;
}

function parseIntervalMs(interval: string): number {
  const match = interval.match(/(\d+)(m|min|h|hour)/i);
  if (!match) return 5 * 60 * 1000;
  
  const num = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  
  if (unit === "h" || unit === "hour") {
    return num * 60 * 60 * 1000;
  }
  return num * 60 * 1000;
}

function normalizeBars(bars: Array<{
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap?: number;
}>): IntradayBar[] {
  return bars.map((b) => ({
    timestamp: b.date,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume,
    vwap: b.vwap,
  }));
}

function mergeBarsByTimestamp(existingBars: IntradayBar[], freshBars: IntradayBar[]): IntradayBar[] {
  const byTimestamp = new Map<string, IntradayBar>();

  for (const bar of existingBars) {
    byTimestamp.set(bar.timestamp, bar);
  }
  for (const bar of freshBars) {
    byTimestamp.set(bar.timestamp, bar);
  }

  return Array.from(byTimestamp.values()).sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
}

function getTailLookbackMs(interval: string): number {
  const intervalMs = parseIntervalMs(interval);
  return Math.max(60 * 60 * 1000, Math.min(6 * 60 * 60 * 1000, intervalMs * 12));
}

async function fetchFreshTailBars(
  symbol: string,
  interval: string,
  startDate: Date,
  endDate: Date,
  includeExtendedHours: boolean,
  cachedBars: IntradayBar[]
): Promise<IntradayBar[]> {
  const intervalMs = parseIntervalMs(interval);
  const tailLookbackMs = getTailLookbackMs(interval);
  const lastCachedBar = cachedBars[cachedBars.length - 1];
  const lastCachedMs = lastCachedBar ? new Date(lastCachedBar.timestamp).getTime() : endDate.getTime();
  const tailStartMs = Math.max(
    startDate.getTime(),
    Math.min(endDate.getTime(), lastCachedMs - intervalMs * 2, endDate.getTime() - tailLookbackMs)
  );
  const tailStart = new Date(tailStartMs);

  const freshTail = await getAlpacaIntradayData(
    symbol,
    tailStart,
    endDate,
    interval,
    includeExtendedHours
  );

  return normalizeBars(freshTail);
}

/**
 * Get intraday bars with LRU caching.
 * 
 * @param symbol - Stock symbol
 * @param interval - Interval string (e.g., "5Min", "15Min", "30Min")
 * @param startDate - Start date for historical data
 * @param endDate - End date for historical data
 * @param includeExtendedHours - Include pre/post market bars
 * @returns Array of intraday bars
 */
export async function getIntradayBars(
  symbol: string,
  interval: string,
  startDate: Date,
  endDate: Date,
  includeExtendedHours: boolean = false
): Promise<IntradayBar[]> {
  const upperSymbol = symbol.toUpperCase();
  const cacheKey = `${upperSymbol}:${interval}:${includeExtendedHours}`;
  
  const cached = intradayCache.get(cacheKey);
  const ttlMs = getTTLMs();
  const now = new Date();
  
  if (cached) {
    const ageMs = Date.now() - cached.fetchedAt.getTime();
    
    if (ageMs < ttlMs) {
      if (!shouldRefreshTail()) {
        return mergeCurrentBar([...cached.bars], upperSymbol, interval);
      }

      try {
        const freshTailBars = await fetchFreshTailBars(
          upperSymbol,
          interval,
          startDate,
          endDate,
          includeExtendedHours,
          cached.bars
        );

        if (freshTailBars.length > 0) {
          const mergedBars = mergeBarsByTimestamp(cached.bars, freshTailBars);
          intradayCache.set(cacheKey, {
            ...cached,
            bars: mergedBars,
            lastTailRefreshAt: now,
          });
          return mergeCurrentBar([...mergedBars], upperSymbol, interval);
        }
      } catch (error) {
        console.warn(
          `[DataLayer] tail refresh failed for ${upperSymbol} ${interval}, using cached bars`,
          error
        );
      }

      return mergeCurrentBar([...cached.bars], upperSymbol, interval);
    }
  }

  try {
    const alpacaBars = await getAlpacaIntradayData(
      upperSymbol,
      startDate,
      endDate,
      interval,
      includeExtendedHours
    );

    const bars = normalizeBars(alpacaBars);

    evictOldest();

    intradayCache.set(cacheKey, {
      bars,
      fetchedAt: now,
      lastTailRefreshAt: now,
      interval,
    });

    return mergeCurrentBar(bars, upperSymbol, interval);
  } catch (error) {
    console.error(
      `[DataLayer] getIntradayBars error for ${symbol} ${interval}:`,
      error
    );

    if (cached) {
      console.log(`[DataLayer] Returning stale cache for ${symbol} ${interval}`);
      return mergeCurrentBar([...cached.bars], upperSymbol, interval);
    }

    return [];
  }
}

/**
 * Get cache statistics for monitoring.
 */
export function getIntradayCacheStats(): {
  entries: number;
  maxEntries: number;
  symbols: string[];
  memoryEstimateMB: number;
} {
  const symbols = new Set<string>();
  let totalBars = 0;

  for (const [key, value] of Array.from(intradayCache.entries())) {
    const symbol = key.split(":")[0];
    symbols.add(symbol);
    totalBars += value.bars.length;
  }

  const bytesPerBar = 80;
  const memoryEstimateMB = (totalBars * bytesPerBar) / (1024 * 1024);

  return {
    entries: intradayCache.size,
    maxEntries: MAX_CACHE_ENTRIES,
    symbols: Array.from(symbols),
    memoryEstimateMB: Math.round(memoryEstimateMB * 100) / 100,
  };
}

/**
 * Clear the intraday cache (for testing or forced refresh).
 */
export function clearIntradayCache(): void {
  intradayCache.clear();
  console.log("[DataLayer] Intraday cache cleared");
}

/**
 * Invalidate cache for a specific symbol.
 */
export function invalidateIntradayCache(symbol: string): void {
  const upperSymbol = symbol.toUpperCase();
  const keysToDelete: string[] = [];

  for (const key of Array.from(intradayCache.keys())) {
    if (key.startsWith(`${upperSymbol}:`)) {
      keysToDelete.push(key);
    }
  }

  for (const key of keysToDelete) {
    intradayCache.delete(key);
  }

  if (keysToDelete.length > 0) {
    console.log(
      `[DataLayer] Invalidated ${keysToDelete.length} cache entries for ${symbol}`
    );
  }
}
