/**
 * Alpaca Market Data Provider for Market Condition Terminal
 * 
 * Implements batched snapshot fetching for efficient universe polling.
 * Uses Alpaca's multi-symbol snapshot endpoint to minimize API calls.
 */

import {
  MarketDataProvider,
  TickerSnapshot,
  HistoricalBar,
  BenchmarkData,
  ProviderHealth,
  CacheEntry,
  isCacheValid,
  createCacheEntry,
} from "./types";

const ALPACA_DATA_URL = "https://data.alpaca.markets";

// =============================================================================
// Alpaca API Helpers
// =============================================================================

function getApiKey(): string {
  return process.env.ALPACA_API_KEY || "";
}

function getApiSecret(): string {
  return process.env.ALPACA_API_SECRET || "";
}

function alpacaHeaders(): Record<string, string> {
  return {
    "APCA-API-KEY-ID": getApiKey(),
    "APCA-API-SECRET-KEY": getApiSecret(),
  };
}

async function alpacaFetch(url: string): Promise<any> {
  const resp = await fetch(url, { headers: alpacaHeaders() });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Alpaca API error ${resp.status}: ${text}`);
  }
  return resp.json();
}

async function alpacaFetchWithRetry(url: string, retries = 3, delay = 1000): Promise<any> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await alpacaFetch(url);
    } catch (error: any) {
      const msg = error.message?.toLowerCase() || "";
      const isRetryable =
        msg.includes("429") ||
        msg.includes("too many") ||
        msg.includes("timeout") ||
        msg.includes("500") ||
        msg.includes("502") ||
        msg.includes("503") ||
        msg.includes("fetch failed");

      if (attempt < retries - 1 && isRetryable) {
        console.log(`[MC-Alpaca] Retry ${attempt + 1}/${retries} after ${delay * (attempt + 1)}ms`);
        await new Promise((r) => setTimeout(r, delay * (attempt + 1)));
      } else {
        throw error;
      }
    }
  }
  throw new Error("Max retries exceeded");
}

// =============================================================================
// Alpaca Response Types
// =============================================================================

interface AlpacaSnapshot {
  latestTrade?: {
    t: string;  // timestamp
    p: number;  // price
    s: number;  // size
  };
  latestQuote?: {
    t: string;
    ap: number; // ask price
    as: number; // ask size
    bp: number; // bid price
    bs: number; // bid size
  };
  minuteBar?: {
    t: string;
    o: number;
    h: number;
    l: number;
    c: number;
    v: number;
    vw: number;
  };
  dailyBar?: {
    t: string;
    o: number;
    h: number;
    l: number;
    c: number;
    v: number;
    vw: number;
  };
  prevDailyBar?: {
    t: string;
    o: number;
    h: number;
    l: number;
    c: number;
    v: number;
    vw: number;
  };
}

interface AlpacaBar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  vw?: number;
}

// =============================================================================
// Alpaca Provider Implementation
// =============================================================================

export class AlpacaProvider implements MarketDataProvider {
  readonly name = "Alpaca";
  
  private health: ProviderHealth = {
    isConnected: true,
    errorCount: 0,
  };
  
  // In-memory cache for snapshots
  private snapshotCache: CacheEntry<Map<string, TickerSnapshot>> | undefined;
  private historicalCache: Map<string, CacheEntry<HistoricalBar[]>> = new Map();
  
  // Default cache TTL (can be overridden)
  private snapshotTtlMs: number = 15000; // 15 seconds
  private historicalTtlMs: number = 5 * 60 * 1000; // 5 minutes
  
  constructor(options?: { snapshotTtlMs?: number; historicalTtlMs?: number }) {
    if (options?.snapshotTtlMs) this.snapshotTtlMs = options.snapshotTtlMs;
    if (options?.historicalTtlMs) this.historicalTtlMs = options.historicalTtlMs;
  }
  
  /**
   * Set snapshot cache TTL (for admin-configurable refresh rates)
   */
  setSnapshotTtl(ttlMs: number): void {
    this.snapshotTtlMs = ttlMs;
  }
  
  /**
   * Get snapshots for multiple symbols using batched API call
   * Alpaca supports up to 200 symbols per request
   */
  async getSnapshots(symbols: string[]): Promise<Map<string, TickerSnapshot>> {
    // Check cache first
    if (isCacheValid(this.snapshotCache)) {
      // Return cached data, but only for requested symbols
      const cached = this.snapshotCache!.data;
      const result = new Map<string, TickerSnapshot>();
      
      // Check if all requested symbols are in cache
      let allCached = true;
      for (const symbol of symbols) {
        if (cached.has(symbol)) {
          result.set(symbol, cached.get(symbol)!);
        } else {
          allCached = false;
        }
      }
      
      if (allCached) {
        return result;
      }
    }
    
    try {
      const result = new Map<string, TickerSnapshot>();
      
      // Batch into chunks of 200 (Alpaca limit)
      const chunks = this.chunkArray(symbols, 200);
      
      for (const chunk of chunks) {
        const symbolList = chunk.join(",");
        const url = `${ALPACA_DATA_URL}/v2/stocks/snapshots?symbols=${encodeURIComponent(symbolList)}&feed=sip`;
        
        console.log(`[MC-Alpaca] Fetching snapshots for ${chunk.length} symbols`);
        const data = await alpacaFetchWithRetry(url);
        
        // Parse response  
        if (data && typeof data === "object") {
          for (const [symbol, snapshot] of Object.entries(data)) {
            const parsed = this.parseSnapshot(symbol, snapshot as AlpacaSnapshot);
            if (parsed) {
              result.set(symbol, parsed);
            }
          }
        }
      }
      
      // Update cache
      this.snapshotCache = createCacheEntry(result, this.snapshotTtlMs);
      this.health.lastSuccessfulCall = new Date();
      this.health.isConnected = true;
      this.health.errorCount = 0;
      
      console.log(`[MC-Alpaca] Successfully fetched ${result.size} snapshots`);
      return result;
      
    } catch (error) {
      console.error("[MC-Alpaca] Failed to fetch snapshots:", error);
      this.health.errorCount++;
      this.health.isConnected = false;
      
      // Return cached data if available (stale is better than nothing)
      if (this.snapshotCache) {
        console.log("[MC-Alpaca] Returning stale cache due to error");
        return this.snapshotCache.data;
      }
      
      return new Map();
    }
  }
  
  /**
   * Get historical daily bars for a symbol
   */
  async getHistoricalBars(symbol: string, days: number): Promise<HistoricalBar[]> {
    const cacheKey = `${symbol}-${days}`;
    const cached = this.historicalCache.get(cacheKey);
    
    if (isCacheValid(cached)) {
      return cached!.data;
    }
    
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days - 5); // Extra buffer for weekends/holidays
      
      const params = new URLSearchParams({
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        timeframe: "1Day",
        feed: "sip",
        limit: String(days + 10),
        sort: "asc",
      });
      
      const url = `${ALPACA_DATA_URL}/v2/stocks/${encodeURIComponent(symbol)}/bars?${params}`;
      const data = await alpacaFetchWithRetry(url);
      
      const bars: HistoricalBar[] = [];
      const rawBars = data?.bars || [];
      
      for (const bar of rawBars) {
        bars.push({
          timestamp: new Date(bar.t),
          open: bar.o,
          high: bar.h,
          low: bar.l,
          close: bar.c,
          volume: bar.v,
          vwap: bar.vw,
        });
      }
      
      // Take only the most recent 'days' bars
      const result = bars.slice(-days);
      
      // Cache the result
      this.historicalCache.set(cacheKey, createCacheEntry(result, this.historicalTtlMs));
      
      return result;
      
    } catch (error) {
      console.error(`[MC-Alpaca] Failed to fetch historical bars for ${symbol}:`, error);
      return cached?.data || [];
    }
  }
  
  /**
   * Get SPY benchmark data
   */
  async getSPYBenchmark(): Promise<BenchmarkData> {
    const benchmarks = await this.getBenchmarks(["SPY"]);
    const spy = benchmarks.get("SPY");
    
    if (!spy) {
      throw new Error("Failed to fetch SPY benchmark");
    }
    
    return spy;
  }
  
  /**
   * Get multiple benchmark ETFs
   */
  async getBenchmarks(symbols: string[]): Promise<Map<string, BenchmarkData>> {
    const snapshots = await this.getSnapshots(symbols);
    const result = new Map<string, BenchmarkData>();
    
    const entries = Array.from(snapshots.entries());
    for (const [symbol, snapshot] of entries) {
      result.set(symbol, {
        symbol,
        price: snapshot.price,
        prevClose: snapshot.prevClose,
        changePct: snapshot.changePct,
        volume: snapshot.volume,
        timestamp: snapshot.timestamp,
      });
    }
    
    return result;
  }
  
  /**
   * Get provider health status
   */
  getHealth(): ProviderHealth {
    return { ...this.health };
  }
  
  /**
   * Clear all caches (useful for testing or forced refresh)
   */
  clearCache(): void {
    this.snapshotCache = undefined;
    this.historicalCache.clear();
  }
  
  // =============================================================================
  // Private Helpers
  // =============================================================================
  
  private parseSnapshot(symbol: string, snapshot: AlpacaSnapshot): TickerSnapshot | null {
    if (!snapshot) return null;
    
    const dailyBar = snapshot.dailyBar;
    const prevBar = snapshot.prevDailyBar;
    const trade = snapshot.latestTrade;
    const quote = snapshot.latestQuote;
    
    // Get current price from latest trade, quote, or daily bar
    const price = trade?.p || quote?.bp || dailyBar?.c || 0;
    if (price === 0) return null;
    
    // Get previous close (always use yesterday's close as baseline)
    const prevClose = prevBar?.c || dailyBar?.o || price;
    
    // Calculate change vs previous close
    const change = price - prevClose;
    const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;
    
    return {
      symbol,
      price,
      prevClose,
      open: dailyBar?.o || price,
      high: dailyBar?.h || price,
      low: dailyBar?.l || price,
      volume: dailyBar?.v || 0,
      prevDayVolume: prevBar?.v || 0,  // Previous full session volume for D-Close split
      vwap: dailyBar?.vw || price,
      change,
      changePct,
      timestamp: new Date(trade?.t || quote?.t || dailyBar?.t || Date.now()),
    };
  }

  /**
   * Get historical daily bars for multiple symbols in one batched request
   * Uses Alpaca's multi-symbol bars endpoint
   * @param symbols Array of ticker symbols
   * @param days Number of trading days of history to fetch
   * @returns Map of symbol -> HistoricalBar[]
   */
  async getMultiSymbolBars(symbols: string[], days: number): Promise<Map<string, HistoricalBar[]>> {
    const result = new Map<string, HistoricalBar[]>();
    if (symbols.length === 0) return result;

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days - 7); // Buffer for weekends/holidays

    const params = new URLSearchParams({
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      timeframe: "1Day",
      feed: "sip",
      sort: "asc",
    });

    // Alpaca multi-bar endpoint supports up to 200 symbols per request
    const chunks = this.chunkArray(symbols, 200);

    for (const chunk of chunks) {
      params.set("symbols", chunk.join(","));
      const url = `${ALPACA_DATA_URL}/v2/stocks/bars?${params}`;

      try {
        const data = await alpacaFetchWithRetry(url);
        const barsData = data?.bars || {};

        for (const [sym, rawBars] of Object.entries(barsData)) {
          const bars: HistoricalBar[] = [];
          for (const bar of (rawBars as any[])) {
            bars.push({
              timestamp: new Date(bar.t),
              open: bar.o,
              high: bar.h,
              low: bar.l,
              close: bar.c,
              volume: bar.v,
              vwap: bar.vw,
            });
          }
          // Keep only the most recent N days
          result.set(sym, bars.slice(-days));
        }
      } catch (error) {
        console.error(`[MC-Alpaca] Failed to fetch multi-symbol bars for chunk:`, error);
      }
    }

    return result;
  }

  /**
   * Get intraday bars (5Min or 15Min) for multiple symbols in one batched request.
   * Used for ticker-level price/pct comparison on 15M, 30M, 1H time slices.
   */
  async getMultiSymbolIntradayBars(
    symbols: string[],
    startDate: Date,
    endDate: Date,
    timeframe: "5Min" | "15Min" = "5Min"
  ): Promise<Map<string, HistoricalBar[]>> {
    const result = new Map<string, HistoricalBar[]>();
    if (symbols.length === 0) return result;

    const params = new URLSearchParams({
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      timeframe,
      feed: "sip",
      sort: "asc",
    });

    const chunks = this.chunkArray(symbols, 200);

    for (const chunk of chunks) {
      params.set("symbols", chunk.join(","));
      const url = `${ALPACA_DATA_URL}/v2/stocks/bars?${params}`;

      try {
        const data = await alpacaFetchWithRetry(url);
        const barsData = data?.bars || {};

        for (const [sym, rawBars] of Object.entries(barsData)) {
          const bars: HistoricalBar[] = [];
          for (const bar of (rawBars as any[])) {
            bars.push({
              timestamp: new Date(bar.t),
              open: bar.o,
              high: bar.h,
              low: bar.l,
              close: bar.c,
              volume: bar.v,
              vwap: bar.vw,
            });
          }
          result.set(sym, bars);
        }
      } catch (error) {
        console.error(`[MC-Alpaca] Failed to fetch multi-symbol intraday bars (${timeframe}):`, error);
      }
    }

    return result;
  }
  
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let providerInstance: AlpacaProvider | null = null;

/**
 * Get the singleton Alpaca provider instance
 */
export function getAlpacaProvider(): AlpacaProvider {
  if (!providerInstance) {
    providerInstance = new AlpacaProvider();
  }
  return providerInstance;
}

/**
 * Create a new provider instance with custom options
 */
export function createAlpacaProvider(options?: {
  snapshotTtlMs?: number;
  historicalTtlMs?: number;
}): AlpacaProvider {
  return new AlpacaProvider(options);
}
