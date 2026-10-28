import type { SymbolFacts } from "./facts";
import type { RegimeRow } from "./regime";
import type { CheckResult, SubStage } from "./types";

/** Layer B filters (spec section 2) as named checks. Which are required is per strategy version. */

export interface RuleThresholds {
  priceMin: number;
  dollarVolumeMin: number;
  rsRankMin: number;
  rsLineWithinPct: number;
  avoidLookback: number;
}

export const DEFAULT_THRESHOLDS: RuleThresholds = {
  priceMin: 10,
  dollarVolumeMin: 20_000_000,
  rsRankMin: 80,
  rsLineWithinPct: 0.05,
  avoidLookback: 5,
};

export const RULE_NAMES = [
  "price_min",
  "dollar_volume_min",
  "stage_fit",
  "cycle_not_2c",
  "no_avoid_flag",
  "rs_rank",
  "rs_line_high",
  "rs_vs_qqq",
  "market_trend",
  "earnings_gap",
] as const;
export type RuleName = (typeof RULE_NAMES)[number];

export interface RuleInputs {
  f: SymbolFacts;
  i: number;
  stage: SubStage | null;
  allowedStages: SubStage[] | null;
  rsRank: number | null;
  regime: RegimeRow | undefined;
  /** Most recent avoid/exit signal on this symbol at or before i (index), if any. */
  lastAvoidIndex: number | null;
  lastAvoidId: string | null;
}

const r2 = (v: number | null) => (v == null ? null : Math.round(v * 100) / 100);

export function evaluateRules(x: RuleInputs, t: RuleThresholds): Record<RuleName, CheckResult> {
  const { f, i } = x;
  const close = f.bars[i].close;
  const dv = f.dollarVol20[i];
  const rsLine = f.rsLineDistFrom52High[i];
  const vsQqq = f.rsVsQqq63[i];
  const spy = x.regime?.spy;
  const avoidAge = x.lastAvoidIndex != null ? i - x.lastAvoidIndex : null;
  return {
    price_min: { name: "price_min", pass: close >= t.priceMin, value: r2(close), threshold: `close >= ${t.priceMin}` },
    dollar_volume_min: { name: "dollar_volume_min", pass: dv != null && dv >= t.dollarVolumeMin, value: dv == null ? null : Math.round(dv), threshold: `20d avg $vol >= ${t.dollarVolumeMin / 1e6}M` },
    stage_fit: {
      name: "stage_fit",
      pass: x.allowedStages == null || (x.stage != null && x.allowedStages.includes(x.stage)),
      value: x.stage,
      threshold: x.allowedStages ? `stage in ${x.allowedStages.join("/")}` : "any stage",
    },
    cycle_not_2c: { name: "cycle_not_2c", pass: x.stage !== "2C", value: x.stage, threshold: "no new longs in 2C" },
    no_avoid_flag: {
      name: "no_avoid_flag",
      pass: avoidAge == null || avoidAge > t.avoidLookback,
      value: avoidAge == null ? null : `${x.lastAvoidId} ${avoidAge}d ago`,
      threshold: `no Wedge Drop / bearish Base 'n Break / failed crossback in ${t.avoidLookback} sessions`,
    },
    rs_rank: { name: "rs_rank", pass: x.rsRank != null && x.rsRank >= t.rsRankMin, value: r2(x.rsRank), threshold: `RS percentile >= ${t.rsRankMin}` },
    rs_line_high: { name: "rs_line_high", pass: rsLine != null && rsLine >= -t.rsLineWithinPct, value: r2(rsLine == null ? null : rsLine * 100), threshold: `RS line within ${t.rsLineWithinPct * 100}% of 52w high` },
    rs_vs_qqq: { name: "rs_vs_qqq", pass: vsQqq != null && vsQqq > 0, value: r2(vsQqq == null ? null : vsQqq * 100), threshold: "63d return above QQQ" },
    market_trend: {
      name: "market_trend",
      pass: spy?.above200 === true && spy.slope200 !== "falling",
      value: spy ? `SPY ${spy.above200 ? "above" : "below"} 200SMA, 200SMA ${spy.slope200 ?? "?"}` : null,
      threshold: "SPY above a non-falling 200 SMA",
    },
    earnings_gap: { name: "earnings_gap", pass: false, value: "unknown", threshold: "no entry within 5 sessions before earnings (no point-in-time dates yet)" },
  };
}
