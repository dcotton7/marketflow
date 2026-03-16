/**
 * Market Data Provider Interface
 * 
 * Abstraction layer for market data sources.
 * Currently implemented: Alpaca
 * Easy to add: Polygon, IEX, etc.
 */

export interface TickerSnapshot {
  symbol: string;
  price: number;
  prevClose: number;
  open: number;
  high: number;
  low: number;
  volume: number;          // Today's session volume
  prevDayVolume: number;   // Previous full session volume (for D-Close / Today split)
  vwap: number;
  change: number;       // Price change from prev close
  changePct: number;    // Percent change from prev close
  avgVolume20D?: number; // 20-day average volume (if available)
  timestamp: Date;
}

export interface HistoricalBar {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap?: number;
}

export interface BenchmarkData {
  symbol: string;
  price: number;
  prevClose: number;
  changePct: number;
  volume: number;
  timestamp: Date;
}

export interface ProviderHealth {
  isConnected: boolean;
  lastSuccessfulCall?: Date;
  errorCount: number;
  rateLimitRemaining?: number;
}

/**
 * Market Data Provider Interface
 * All providers must implement this interface for consistency
 */
export interface MarketDataProvider {
  readonly name: string;
  
  /**
   * Get snapshot quotes for multiple symbols (batched)
   * @param symbols Array of ticker symbols
   * @param useIntradayBaseline If true during market hours, uses 9:30 AM open as baseline
   * @returns Map of symbol -> snapshot
   */
  getSnapshots(symbols: string[], useIntradayBaseline?: boolean): Promise<Map<string, TickerSnapshot>>;
  
  /**
   * Get historical daily bars for a symbol
   * @param symbol Ticker symbol
   * @param days Number of days of history
   */
  getHistoricalBars(symbol: string, days: number): Promise<HistoricalBar[]>;
  
  /**
   * Get SPY benchmark data for relative strength calculations
   */
  getSPYBenchmark(): Promise<BenchmarkData>;
  
  /**
   * Get multiple benchmark ETFs (for RAI calculation)
   * @param symbols ETF symbols (QQQ, IWM, ARKK, etc.)
   */
  getBenchmarks(symbols: string[]): Promise<Map<string, BenchmarkData>>;
  
  /**
   * Check provider health/connectivity
   */
  getHealth(): ProviderHealth;
}

/**
 * Cache entry with TTL support
 */
export interface CacheEntry<T> {
  data: T;
  timestamp: Date;
  ttlMs: number;
}

/**
 * Check if cache entry is still valid
 */
export function isCacheValid<T>(entry: CacheEntry<T> | undefined): boolean {
  if (!entry) return false;
  const age = Date.now() - entry.timestamp.getTime();
  return age < entry.ttlMs;
}

/**
 * Create a cache entry
 */
export function createCacheEntry<T>(data: T, ttlMs: number): CacheEntry<T> {
  return {
    data,
    timestamp: new Date(),
    ttlMs,
  };
}
