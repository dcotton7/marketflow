/**
 * Intraday Bars Data Layer
 * 
 * Provides intraday bars (5min, 15min, 30min) from Alpaca API
 * with an in-memory LRU cache and adaptive TTL.
 * 
 * Cache Strategy:
 * - Market hours: 1 minute TTL (bars updating)
 * - Pre/post market: 5 minutes TTL (slower activity)
 * - Market closed: 30 minutes TTL (data won't change)
 * 
 * Memory Budget: ~100MB for 50 hot tickers × 3 timeframes
 */

import { getAlpacaIntradayData } from "../alpaca";
import { getTickerSnapshot } from "../market-condition/engine/snapshot";
import { isMarketHours, getMarketSession } from "../market-condition/universe";
import { IntradayBar, CacheEntry } from "./types";

interface IntradayCacheValue {
  bars: IntradayBar[];
  fetchedAt: Date;
  interval: string;
}

const intradayCache = new Map<string, IntradayCacheValue>();
const MAX_CACHE_ENTRIES = 150;

function getTTLMs(): number {
  const session = getMarketSession();
  
  if (session === "market") {
    return 60_000; // 1 minute during market hours
  } else if (session === "pre-market" || session === "post-market") {
    return 300_000; // 5 minutes pre/post
  } else {
    return 1800_000; // 30 minutes when closed
  }
}

function evictOldest(): void {
  if (intradayCache.size >= MAX_CACHE_ENTRIES) {
    let oldestKey: string | null = null;
    let oldestTime = Date.now();

    for (const [key, value] of intradayCache) {
      if (value.fetchedAt.getTime() < oldestTime) {
        oldestTime = value.fetchedAt.getTime();
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
  const intervalMs = parseIntervalMs(interval);
  const now = Date.now();
  
  if (now - lastBarTime < intervalMs * 2) {
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
  
  if (cached) {
    const ageMs = Date.now() - cached.fetchedAt.getTime();
    
    if (ageMs < ttlMs) {
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

    const bars: IntradayBar[] = alpacaBars.map((b) => ({
      timestamp: b.date,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
      vwap: b.vwap,
    }));

    evictOldest();

    intradayCache.set(cacheKey, {
      bars,
      fetchedAt: new Date(),
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

  for (const [key, value] of intradayCache) {
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

  for (const key of intradayCache.keys()) {
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
