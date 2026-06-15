/**
 * Client adapter — maps Theme Members TickerRow to shared scan engine.
 */

import type { TickerRow } from "@/data/mockThemeData";
import type {
  OptionalCriterionId,
  RequiredCriterionId,
  TickerReviewScanMode,
} from "@shared/ticker-review-types";
import {
  runTickerReviewScan as runSharedScan,
  type TickerReviewMember,
  type TickerReviewResultRow,
  type TickerReviewScanInput as SharedScanInput,
} from "@shared/ticker-review-engine";

export type {
  TickerReviewBucket,
  TickerReviewResultRow,
  TightMaResult,
} from "@shared/ticker-review-engine";

export { BUCKET_LABELS, computeTightMa, runTickerReviewScan as runSharedTickerReviewScan } from "@shared/ticker-review-engine";

function toMember(t: TickerRow): TickerReviewMember {
  return {
    symbol: t.symbol,
    pct: t.pct ?? 0,
    rsVsSpy: t.rsVsSpy ?? 0,
    volExp: t.volExp,
    prevDayVolExp: t.prevDayVolExp,
    accDistDays: t.accDistDays,
    trendState: t.trendState,
    rsRank: t.rsRank,
    pctVsEma10d: t.pctVsEma10d,
    pctVsSma20d: t.pctVsSma20d,
    pctVsSma50d: t.pctVsSma50d,
    pctVsSma200d: t.pctVsSma200d,
  };
}

export interface TickerReviewScanInput {
  tickers: TickerRow[];
  themeMedianPct?: number;
  mode: TickerReviewScanMode;
  enabledRequired: Set<RequiredCriterionId>;
  enabledOptional: Set<OptionalCriterionId>;
  raiLabel?: "AGGRESSIVE" | "NEUTRAL" | "DEFENSIVE";
  themeRank?: number;
  maxResults?: number;
}

export function runTickerReviewScan(input: TickerReviewScanInput): {
  results: TickerReviewResultRow[];
  hiddenCount: number;
  effectiveMode: Exclude<TickerReviewScanMode, "auto">;
} {
  const sharedInput: SharedScanInput = {
    ...input,
    tickers: input.tickers.map(toMember),
  };
  return runSharedScan(sharedInput);
}
