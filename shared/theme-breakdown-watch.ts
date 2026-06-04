export type BreakdownWatchTier = "none" | "weak_laggard" | "breakdown_watch" | "avoid_long";

export interface BreakdownWatchAssessment {
  /** 0–100: higher = more structural breakdown concern (theme layer). */
  score: number;
  tier: BreakdownWatchTier;
  themeStructureScore: number;
  /** Short labels for badges / tooltips (max ~4). */
  reasons: string[];
}

export interface ThemeBreakdownInput {
  trendState?: "Bull" | "Transition" | "Bear";
  pctAbove50d?: number;
  pctAbove200d?: number;
  breadthPct: number;
  medianPct: number;
  rsVsBenchmark: number;
  deltaRank: number;
  acceleration: number;
  accDistDays?: number;
  bearCount?: number;
  totalCount?: number;
  rank?: number;
  totalThemes?: number;
  distributionPct?: number;
}

export interface EtfStructureFlags {
  below50Sma?: boolean;
  belowVwap?: boolean;
  sessionRed?: boolean;
}

function clamp(n: number, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, n));
}

function pushReason(reasons: string[], label: string, max = 4) {
  if (reasons.length < max && !reasons.includes(label)) reasons.push(label);
}

/**
 * Theme-structure breakdown radar from MarketFlow member aggregates.
 * Computed on the server for theme tracker; Live Theme Charts reads the same payload.
 */
export function computeThemeBreakdownWatch(input: ThemeBreakdownInput): BreakdownWatchAssessment {
  let score = 0;
  const reasons: string[] = [];

  const pct50 = input.pctAbove50d ?? 50;
  const pct200 = input.pctAbove200d ?? 50;
  const totalMembers = input.totalCount ?? 0;
  const bearPct =
    totalMembers > 0 && input.bearCount != null ? input.bearCount / totalMembers : 0;

  if (input.trendState === "Bear") {
    score += 22;
    pushReason(reasons, "Bear trend");
  } else if (input.trendState === "Transition") {
    score += 8;
  }

  if (pct50 < 35) {
    score += 18;
    pushReason(reasons, `${pct50.toFixed(0)}% above 50d`);
  } else if (pct50 < 50) {
    score += 10;
    pushReason(reasons, `${pct50.toFixed(0)}% above 50d`);
  }

  if (pct200 < 30) {
    score += 12;
    pushReason(reasons, `${pct200.toFixed(0)}% above 200d`);
  }

  if (input.breadthPct < 40) {
    score += 14;
    pushReason(reasons, `Breadth ${input.breadthPct.toFixed(0)}%`);
  } else if (input.breadthPct < 50) {
    score += 7;
  }

  if (input.medianPct < -0.5) {
    score += 10;
    pushReason(reasons, `Median ${input.medianPct.toFixed(1)}%`);
  }

  if (input.rsVsBenchmark < -0.3) {
    score += 12;
    pushReason(reasons, `RS ${input.rsVsBenchmark.toFixed(2)}`);
  } else if (input.rsVsBenchmark < 0) {
    score += 6;
  }

  if (input.deltaRank <= -2) {
    score += 10;
    pushReason(reasons, `Rank ↓${Math.abs(input.deltaRank)}`);
  } else if (input.deltaRank < 0) {
    score += 5;
  }

  if (input.acceleration < -0.15) {
    score += 6;
  }

  if ((input.accDistDays ?? 0) <= -3) {
    score += 10;
    pushReason(reasons, `A/D ${input.accDistDays}d`);
  } else if ((input.accDistDays ?? 0) < 0) {
    score += 5;
  }

  if (bearPct >= 0.55) {
    score += 10;
    pushReason(reasons, `${Math.round(bearPct * 100)}% bear members`);
  }

  if (input.distributionPct != null && input.distributionPct >= 35) {
    score += 8;
    pushReason(reasons, `Dist ${input.distributionPct.toFixed(0)}%`);
  }

  const themeStructureScore = clamp(Math.round(score));

  const totalThemes = input.totalThemes ?? 0;
  const rank = input.rank ?? 0;
  const inBottomThird =
    totalThemes > 0 && rank > 0 && rank >= Math.ceil((totalThemes * 2) / 3);

  let tier: BreakdownWatchTier = "none";
  if (themeStructureScore >= 68) {
    tier = "avoid_long";
  } else if (themeStructureScore >= 42) {
    tier = "breakdown_watch";
  } else if (inBottomThird && themeStructureScore >= 22) {
    tier = "weak_laggard";
    pushReason(reasons, "Bottom rank");
  }

  return {
    score: themeStructureScore,
    tier,
    themeStructureScore,
    reasons: reasons.slice(0, 4),
  };
}

/** Merge live ETF chart flags (Live Theme Charts) into the server theme assessment. */
export function mergeEtfBreakdownFlags(
  base: BreakdownWatchAssessment | null | undefined,
  etf: EtfStructureFlags | null | undefined
): BreakdownWatchAssessment {
  const seed: BreakdownWatchAssessment = base ?? {
    score: 0,
    tier: "none",
    themeStructureScore: 0,
    reasons: [],
  };

  if (!etf) return seed;

  let boost = 0;
  const reasons = [...seed.reasons];

  if (etf.belowVwap) {
    boost += 12;
    pushReason(reasons, "Below VWAP");
  }
  if (etf.below50Sma) {
    boost += 14;
    pushReason(reasons, "ETF below 50 SMA");
  }
  if (etf.sessionRed) {
    boost += 6;
    pushReason(reasons, "Red session");
  }

  const score = clamp(seed.score + boost);
  let tier = seed.tier;

  if (score >= 68) tier = "avoid_long";
  else if (score >= 42) tier = "breakdown_watch";
  else if (tier === "none" && score >= 22 && seed.tier === "weak_laggard") tier = "weak_laggard";
  else if (tier === "none" && score >= 28) tier = "weak_laggard";

  return {
    score,
    tier,
    themeStructureScore: seed.themeStructureScore,
    reasons: reasons.slice(0, 4),
  };
}

export const BREAKDOWN_WATCH_TIER_LABELS: Record<BreakdownWatchTier, string> = {
  none: "",
  weak_laggard: "Weak laggard",
  breakdown_watch: "Breakdown watch",
  avoid_long: "Avoid long",
};

export function breakdownWatchTierClass(tier: BreakdownWatchTier): string {
  switch (tier) {
    case "avoid_long":
      return "bg-red-500/15 text-red-300 border-red-500/40";
    case "breakdown_watch":
      return "bg-orange-500/15 text-orange-300 border-orange-500/40";
    case "weak_laggard":
      return "bg-amber-500/15 text-amber-300 border-amber-500/40";
    default:
      return "";
  }
}
