/**
 * Don's hard trade rules (spec section 5) and the parameterized exit policy. The hard rules are harness constants:
 * no strategy version or critic proposal can change them.
 */

export const HARD_RULES = {
  /** Most a trade may lose from entry. A maximum, never the stop itself: wider logical stops skip the trade. */
  maxLossPct: 0.05,
  /** A trim is due when the chart's ATRx from 50MA, (close − SMA50) ÷ ATR(14), reaches this. */
  trimExtension: 7,
  /** Trims together never exceed this share of the original position, so a trailing piece is always kept. */
  maxTrimCap: 0.7,
} as const;

export type VixBucket = "<15" | "15-20" | "20-30" | ">30" | "unknown";

export interface ExitPolicy {
  style: "dynamic_trail" | "fixed_10sma";
  /** Trim size (share of the original position) by VIX bucket at the close the trim became due. */
  vixTrimTable: Record<Exclude<VixBucket, "unknown">, number>;
  /** Used when VIX for the date is unavailable. */
  unknownVixTrim: number;
  trimCap: number;
  /** Trail MA choice (dynamic_trail): 5 SMA when extension above the 10 SMA ≥ xFar. */
  xFar: number;
  /** 20 SMA when open profit ≥ pLargeR and extension above the 20 SMA ≤ yModerate. */
  pLargeR: number;
  yModerate: number;
  /** Closes in a new trail state before switching. */
  hysteresis: number;
  /** The trail only acts once a close has been above the chosen MA since entry (counter-trend entries start below it). */
  armTrailAfterCloseAbove: boolean;
  breakEvenAfterFirstTrim: boolean;
  kell: {
    exhaustionTrim: "same" | "double" | "off";
    wedgeDrop: "whole" | "trailing_only" | "off";
    bearishBaseNBreak: boolean;
  };
  /** Market-on-open exits after a trail close; the 15:55 variant needs minute bars on every exit day (not built yet). */
  exitFill: "next_open";
}

export const DYNAMIC_EXIT: ExitPolicy = {
  style: "dynamic_trail",
  vixTrimTable: { "<15": 0.05, "15-20": 0.1, "20-30": 0.15, ">30": 0.25 },
  unknownVixTrim: 0.1,
  trimCap: 0.5,
  xFar: 3,
  pLargeR: 5,
  yModerate: 2,
  hysteresis: 1,
  armTrailAfterCloseAbove: true,
  breakEvenAfterFirstTrim: false,
  kell: { exhaustionTrim: "same", wedgeDrop: "whole", bearishBaseNBreak: true },
  exitFill: "next_open",
};

export const BASELINE_EXIT: ExitPolicy = {
  ...DYNAMIC_EXIT,
  style: "fixed_10sma",
  vixTrimTable: { "<15": 0.1, "15-20": 0.1, "20-30": 0.1, ">30": 0.1 },
  unknownVixTrim: 0.1,
  kell: { exhaustionTrim: "off", wedgeDrop: "off", bearishBaseNBreak: false },
};

export function assertExitPolicy(p: ExitPolicy) {
  if (p.trimCap > HARD_RULES.maxTrimCap) throw new Error(`trimCap ${p.trimCap} exceeds the hard cap ${HARD_RULES.maxTrimCap}`);
  for (const v of [...Object.values(p.vixTrimTable), p.unknownVixTrim]) if (v < 0.05 || v > 0.25) throw new Error(`trim size ${v} outside 5%–25%`);
}

export interface CostModel {
  /** Per-side slippage by 20-day average dollar volume tier. */
  slippageBpsLiquid: number;
  slippageBpsThin: number;
  liquidDollarVolume: number;
  commissionPerTrade: number;
}

export const DEFAULT_COSTS: CostModel = { slippageBpsLiquid: 10, slippageBpsThin: 25, liquidDollarVolume: 50_000_000, commissionPerTrade: 0 };
