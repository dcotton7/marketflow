/**
 * Shared contract for `/api/sentinel/chart-data` payloads (Sentinel + Beta Charts).
 * Keep in sync with `server/sentinel/chartDataEngine.ts` and `TradingChart` indicator fields.
 */

export type SentinelChartSessionBasis = "rth" | "extended";

export interface SentinelChartIndicators {
  ema5: (number | null)[];
  ema10: (number | null)[];
  sma21: (number | null)[];
  sma50: (number | null)[];
  sma200: (number | null)[];
  vwap?: (number | null)[];
  avwapHigh?: (number | null)[];
  avwapLow?: (number | null)[];
}

export interface SentinelChartIndicatorsMeta {
  includeExtendedHours: boolean;
  /** What `indicators` represents for intraday when ETH candles are present. */
  primarySession: SentinelChartSessionBasis;
}
