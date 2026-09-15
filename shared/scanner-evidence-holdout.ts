// ---------------------------------------------------------------------------
// Evidence holdout helpers — chronological stability + cost/liquidity sensitivity
// Pure functions for validating provisional cohort rankings before promotion.
// ---------------------------------------------------------------------------

import {
  classifyEvidenceTier,
  sampleConfidence,
  shrinkRate,
  type EvidenceTier,
} from "./scanner-outcome-v3";

export type HoldoutWeek = {
  week: string;
  episodes: number;
  hits: number;
  edgeSum: number;
};

export type HoldoutSummary = {
  weeks: number;
  totalEpisodes: number;
  hitRate: number | null;
  edgePct: number | null;
  weeksPositiveEdge: number;
  weeksHitAbove28: number;
  stable: boolean;
  tier: EvidenceTier;
  notes: string[];
};

/** Aggregate weekly episode stats into a holdout verdict. */
export function summarizeHoldout(weeks: readonly HoldoutWeek[]): HoldoutSummary {
  const notes: string[] = [];
  const usable = weeks.filter((w) => w.episodes > 0);
  const totalEpisodes = usable.reduce((s, w) => s + w.episodes, 0);
  const totalHits = usable.reduce((s, w) => s + w.hits, 0);
  const edgeSum = usable.reduce((s, w) => s + w.edgeSum, 0);

  const hitRate = totalEpisodes > 0 ? totalHits / totalEpisodes : null;
  const edgePct = totalEpisodes > 0 ? edgeSum / totalEpisodes : null;
  const confidence = sampleConfidence(totalEpisodes);
  const tier = classifyEvidenceTier({
    episodes: totalEpisodes,
    hitRate,
    edgePct,
    confidence,
  });

  let weeksPositiveEdge = 0;
  let weeksHitAbove28 = 0;
  for (const w of usable) {
    const wEdge = w.edgeSum / w.episodes;
    const wHit = w.hits / w.episodes;
    if (wEdge > 0) weeksPositiveEdge++;
    if (wHit >= 0.28) weeksHitAbove28++;
  }

  if (usable.length < 3) notes.push("Need ≥3 weekly buckets for stability.");
  if (totalEpisodes < 40) notes.push("Thin sample — keep provisional.");

  const majorityPositive =
    usable.length >= 3 && weeksPositiveEdge >= Math.ceil(usable.length * 0.6);
  const majorityHit =
    usable.length >= 3 && weeksHitAbove28 >= Math.ceil(usable.length * 0.6);
  const stable = majorityPositive && majorityHit && totalEpisodes >= 40 && (edgePct ?? 0) > 0;

  if (!majorityPositive) notes.push("Edge not positive in ≥60% of weeks.");
  if (!majorityHit) notes.push("Hit rate <28% in too many weeks.");

  return {
    weeks: usable.length,
    totalEpisodes,
    hitRate,
    edgePct,
    weeksPositiveEdge,
    weeksHitAbove28,
    stable,
    tier,
    notes,
  };
}

export type CostSensitivityInput = {
  edgePct: number;
  /** Round-trip cost in percent (spread + fees + slippage), e.g. 0.15 = 15 bps. */
  roundTripCostPct: number;
  /** Prior-day dollar volume; null = unknown. */
  priorDayDollarVol: number | null;
  minLiquidity?: number;
};

export type CostSensitivityResult = {
  netEdgePct: number;
  passesCost: boolean;
  passesLiquidity: boolean;
  passes: boolean;
  reason: string;
};

/** Require positive net edge after costs and optional liquidity floor. */
export function evaluateCostSensitivity(input: CostSensitivityInput): CostSensitivityResult {
  const minLiq = input.minLiquidity ?? 10_000_000;
  const netEdgePct = input.edgePct - input.roundTripCostPct;
  const passesCost = netEdgePct > 0;
  const passesLiquidity =
    input.priorDayDollarVol == null || input.priorDayDollarVol >= minLiq;

  let reason = "ok";
  if (!passesCost) reason = `Net edge ${netEdgePct.toFixed(3)}% ≤ 0 after ${input.roundTripCostPct}% costs`;
  else if (!passesLiquidity) reason = `Liquidity below $${(minLiq / 1e6).toFixed(0)}M prior-day $ vol`;

  return {
    netEdgePct,
    passesCost,
    passesLiquidity,
    passes: passesCost && passesLiquidity,
    reason,
  };
}

/** Provisional candidate cohorts from the Aug–Sep 2026 research pass (not production truth). */
export const PROVISIONAL_CANDIDATE_COHORTS = [
  {
    id: "failed_breakout_score_75",
    signalType: "failed_breakout",
    label: "Failed breakout · score 75+",
    note: "Best among broad failed-breakout class; weekly edge mixed — provisional.",
  },
  {
    id: "hod_fade_75_weak_theme",
    signalType: "hod_fade",
    label: "HOD fade · score 75+ · weak theme",
    note: "Strong in some weeks, soft in others — needs V3 clocks + holdout.",
  },
  {
    id: "lod_bounce_75_strong_theme",
    signalType: "lod_bounce",
    label: "LOD bounce · score 75+ · strong theme",
    note: "Positive episode edge but flood/repeats — episode dedupe mandatory.",
  },
  {
    id: "gap_down_60_bearish_stack",
    signalType: "gap_down_continuation",
    label: "Gap-down continuation · score 60+ · bearish MA",
    note: "Smaller n; 4h follow-through looked better than 1h — provisional.",
  },
] as const;

export function shrunkHit(hits: number, n: number): number {
  return shrinkRate(hits, n);
}
