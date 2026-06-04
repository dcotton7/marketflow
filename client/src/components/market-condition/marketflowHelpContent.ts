/**
 * Pro-facing MarketFlow help copy (? icons and tooltips).
 * Long-form reference: docs/marketflow-help/
 */

export const MARKETFLOW_MA_HELP = {
  title: "Theme Members MA columns",
  summary:
    "Shows how far price is above or below a daily moving average, using session-adjusted levels during market hours.",
  formula: "((price − MA) / MA) × 100",
  ma1Default: "MA1 default: 20-day SMA",
  ma2Default: "MA2 default: 50-day SMA",
  sessionAdjusted:
    "Session-adjusted: prior completed daily closes plus today's developing bar (live snapshot OHLCV). MA levels refresh at least every 5 minutes; the % distance updates every snapshot as price moves.",
  eodFallback:
    "EOD fallback: when session-adjusted data is unavailable, levels come from the nightly ticker_ma table (yesterday's close only).",
  whiteBox:
    "White box: |distance| ≤ MA bold threshold (admin setting, default 0.5%). Indicates price is near the selected MA.",
  precision:
    "Display shows one decimal; hover a cell for two decimals. Large moves can look identical at one decimal when values cluster.",
};

export const ACTIONABLE_HELP = {
  rotation: {
    label: "Rotation",
    detail:
      "Heuristic score from delta rank (position change vs prior snapshot) and RS acceleration. Negative delta rank = theme fading in the leaderboard.",
    formula: "score ≈ 50 + (deltaRank × 10) + (acceleration × 4), clamped 0–100",
  },
  participation: {
    label: "Participation",
    detail: "Breadth: percent of theme members trading green today. Not the same as core-member count.",
    formula: "score = breadthPct (% members with pctChange > 0)",
  },
  leadership: {
    label: "Leadership",
    detail: "Median member relative strength vs SPY today.",
    formula: "score ≈ 50 + (median RS vs SPY × 10), clamped 0–100",
  },
  confirmation: {
    label: "Confirmation",
    detail:
      "Volume expansion (median member vol vs 20-day average) plus A/D accumulation vs distribution bias from theme members.",
    formula: "score ≈ 40 + (volExp − 1) × 22 + A/D bias",
  },
  durability: {
    label: "Durability",
    detail:
      "Inverse of narrow leadership: how much of the theme's positive move comes from the top 3 names only.",
    formula: "score = 100 − (top3Contribution × 100)",
  },
};

export const THEME_SCORE_HELP =
  "ThemeScore (0–100) uses cross-theme percentile ranks: median return (40%), breadth above 50d/200d (20%), RS vs SPY (20%), RS acceleration (20%), then a narrow-leadership penalty if top-3 names dominate positive returns.";

export function formatMaAsOfLabel(maAsOf: string | null | undefined, maMode: string | null | undefined): string {
  if (maMode === "eod_db") {
    if (maAsOf) {
      const d = new Date(maAsOf);
      const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
      return `MA levels: EOD database (snapshot ${time})`;
    }
    return "MA levels: EOD database (nightly ticker_ma)";
  }
  if (!maAsOf) return "MA levels: loading…";
  const d = new Date(maAsOf);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `MA levels session-adjusted as of ${time}`;
}
