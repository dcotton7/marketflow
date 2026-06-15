/** Ticker Review — shared criterion IDs and scan modes. */

import type { PatternHit } from "./setup-detectors/types";

export type { PatternHit } from "./setup-detectors/types";

export type TickerReviewScanMode =
  | "auto"
  | "leadership"
  | "emerging"
  | "laggard"
  | "repair";

export type RequiredCriterionId = "R3" | "R4" | "R5" | "R6";
export type OptionalCriterionId =
  | "O1"
  | "O2"
  | "O3"
  | "O4"
  | "O5"
  | "O6"
  | "O7"
  | "O8"
  | "O9"
  | "O10"
  | "O11";

export type RaiLabel = "AGGRESSIVE" | "NEUTRAL" | "DEFENSIVE";

export interface TickerReviewMember {
  symbol: string;
  pct: number;
  rsVsSpy: number;
  volExp?: number;
  prevDayVolExp?: number;
  accDistDays?: number;
  trendState?: "Bull" | "Transition" | "Bear";
  rsRank?: number;
  pctVsEma10d?: number | null;
  pctVsSma20d?: number | null;
  pctVsSma50d?: number | null;
  pctVsSma200d?: number | null;
  /** Last completed daily session % change (from bar enrichment). */
  lastSessionPct?: number | null;
  /** When set by server bar analysis, overrides O7 vol proxy. */
  hvcPriorSession?: boolean;
  /** Bar-backed pattern detections from server enrichment. */
  patternHits?: PatternHit[];
}

export interface DailyBarLike {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
