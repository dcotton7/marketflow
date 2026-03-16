/**
 * Data Layer Types
 */

export interface DailyBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap?: number;
}

export interface TickerMAs {
  symbol: string;
  ema10d: number | null;
  ema20d: number | null;
  sma50d: number | null;
  sma200d: number | null;
  updatedAt: Date;
}

export interface Quote {
  symbol: string;
  price: number;
  prevClose: number;
  open: number;
  high: number;
  low: number;
  change: number;
  changePct: number;
  volume: number;
  vwap: number;
  timestamp: Date;
}

export interface IntradayBar {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap?: number;
}

export interface CacheEntry<T> {
  data: T;
  fetchedAt: Date;
}
