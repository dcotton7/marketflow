import type { BreakdownWatchAssessment } from "./theme-breakdown-watch";

export const MA_SLOPE_LOOKBACK_DAYS = 10;
const SLOPE_RISING_PCT = 0.15;
const SLOPE_FALLING_PCT = -0.15;

export type MaSlopeDirection = "rising" | "flat" | "falling" | "unknown";

export type ChartSetupPostureHint =
  | "long_friendly"
  | "caution"
  | "repair_only"
  | "short_watch"
  | "unclear";

/** Binary-event risk for swing longs — red ≤2 trading-calendar days, yellow ≤7. */
export type EarningsRiskSeverity = "red" | "yellow";

export interface ChartSetupEarningsRisk {
  date: string;
  daysUntil: number;
  time: string | null;
  severity: EarningsRiskSeverity;
  /** One-line trader label for UI + LLM. */
  label: string;
}

export interface MaSlopeReading {
  slopePct10d: number | null;
  direction: MaSlopeDirection;
}

export interface ChartSetupStructureMeta {
  maSlopes: {
    sma20: MaSlopeReading;
    sma50: MaSlopeReading;
    sma200: MaSlopeReading;
  };
  position: {
    pctVs20: number | null;
    pctVs50: number | null;
    pctVs200: number | null;
    below50d: boolean;
    below200d: boolean;
  };
  /** Headwinds for long / swing-long setups. */
  longSetupNegatives: string[];
  /** Actionable short-thesis bullets when structure + theme weaken together. */
  shortSetupIdeas: string[];
  /** 0–100: higher = more short-watch posture (not a trade signal). */
  shortSetupScore: number;
  themeBreakdown: {
    tier: BreakdownWatchAssessment["tier"];
    score: number;
    reasons: string[];
  } | null;
  /** Upcoming earnings binary risk — null when none in window / N/A. */
  earningsRisk: ChartSetupEarningsRisk | null;
  postureHint: ChartSetupPostureHint;
}

/** Red ≤2d, yellow ≤7d. Past / missing / ETF → null. */
export function resolveEarningsRisk(input: {
  nextEarningsDate?: string | null;
  nextEarningsDays?: number | null;
  earningsTime?: string | null;
  earningsApplicable?: boolean | null;
}): ChartSetupEarningsRisk | null {
  if (input.earningsApplicable === false) return null;
  const date = (input.nextEarningsDate ?? "").trim();
  if (!date || date === "N/A") return null;

  let daysUntil =
    typeof input.nextEarningsDays === "number" && Number.isFinite(input.nextEarningsDays)
      ? Math.floor(input.nextEarningsDays)
      : null;

  if (daysUntil == null) {
    const next = new Date(`${date}T00:00:00`);
    if (Number.isNaN(next.getTime())) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    daysUntil = Math.round((next.getTime() - today.getTime()) / 86_400_000);
  }

  if (daysUntil < 0 || daysUntil > 7) return null;

  const time =
    input.earningsTime === "bmo" || input.earningsTime === "amc" ? input.earningsTime : null;
  const timeTag = time === "bmo" ? " BMO" : time === "amc" ? " AMC" : "";
  const when =
    daysUntil === 0 ? "TODAY" : daysUntil === 1 ? "tomorrow" : `in ${daysUntil}d`;
  const severity: EarningsRiskSeverity = daysUntil <= 2 ? "red" : "yellow";
  const label =
    severity === "red"
      ? `Earnings ${when} (${date}${timeTag}) — RED binary risk; size down or wait`
      : `Earnings ${when} (${date}${timeTag}) — YELLOW event risk within 7d`;

  return { date, daysUntil, time, severity, label };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function slopeDirection(pct: number | null): MaSlopeDirection {
  if (pct == null || !Number.isFinite(pct)) return "unknown";
  if (pct >= SLOPE_RISING_PCT) return "rising";
  if (pct <= SLOPE_FALLING_PCT) return "falling";
  return "flat";
}

/** Slope % change of an MA series over `lookback` bars (oldest→newest arrays). */
export function maSlopePctFromSeries(
  series: (number | null)[] | undefined,
  lookback = MA_SLOPE_LOOKBACK_DAYS
): number | null {
  if (!series?.length) return null;
  const end = series.length - 1;
  const start = end - lookback;
  if (start < 0) return null;
  const now = series[end];
  const then = series[start];
  if (now == null || then == null || then === 0) return null;
  return round2(((now - then) / then) * 100);
}

function smaAtBar(closes: number[], period: number, barIndex: number): number | null {
  if (barIndex < period - 1 || barIndex >= closes.length) return null;
  const slice = closes.slice(barIndex - period + 1, barIndex + 1);
  if (slice.length < period) return null;
  return slice.reduce((s, v) => s + v, 0) / period;
}

function maSlopeFromCloses(
  closes: number[],
  period: number,
  lookback = MA_SLOPE_LOOKBACK_DAYS
): number | null {
  if (closes.length < period + lookback) return null;
  const end = closes.length - 1;
  const start = end - lookback;
  const now = smaAtBar(closes, period, end);
  const then = smaAtBar(closes, period, start);
  if (now == null || then == null || then === 0) return null;
  return round2(((now - then) / then) * 100);
}

function pctVsMa(price: number | null | undefined, ma: number | null | undefined): number | null {
  if (price == null || ma == null || ma === 0 || !Number.isFinite(price) || !Number.isFinite(ma)) {
    return null;
  }
  return round2(((price - ma) / ma) * 100);
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function computeChartSetupStructureMeta(input: {
  dailyCloses?: number[];
  sma20Series?: (number | null)[];
  sma50Series?: (number | null)[];
  sma200Series?: (number | null)[];
  currentPrice?: number | null;
  pctVs20?: number | null;
  pctVs50?: number | null;
  pctVs200?: number | null;
  rsVsSpy?: number | null;
  lastSessionPct?: number | null;
  urReclaimInPlay?: boolean;
  themeBreakdownWatch?: BreakdownWatchAssessment | null;
  /** Base built under 200d — do not treat current reclaim as a blind negative. */
  baseBelow200dBuilt?: boolean;
  reclaim200dOnLastBar?: boolean;
  powerSetup?: boolean;
  nextEarningsDate?: string | null;
  nextEarningsDays?: number | null;
  earningsTime?: string | null;
  earningsApplicable?: boolean | null;
}): ChartSetupStructureMeta {
  const closes = input.dailyCloses ?? [];

  const slope20Pct =
    maSlopePctFromSeries(input.sma20Series) ??
    (closes.length ? maSlopeFromCloses(closes, 20) : null);
  const slope50Pct =
    maSlopePctFromSeries(input.sma50Series) ??
    (closes.length ? maSlopeFromCloses(closes, 50) : null);
  const slope200Pct =
    maSlopePctFromSeries(input.sma200Series) ??
    (closes.length ? maSlopeFromCloses(closes, 200) : null);

  const sma20Dir = slopeDirection(slope20Pct);
  const sma50Dir = slopeDirection(slope50Pct);
  const sma200Dir = slopeDirection(slope200Pct);

  const price = input.currentPrice ?? (closes.length ? closes[closes.length - 1]! : null);

  let pctVs20 = input.pctVs20 ?? null;
  let pctVs50 = input.pctVs50 ?? null;
  let pctVs200 = input.pctVs200 ?? null;

  if (price != null && input.sma20Series?.length) {
    const ma20 = input.sma20Series[input.sma20Series.length - 1];
    if (pctVs20 == null) pctVs20 = pctVsMa(price, ma20);
  }
  if (price != null && input.sma50Series?.length) {
    const ma50 = input.sma50Series[input.sma50Series.length - 1];
    if (pctVs50 == null) pctVs50 = pctVsMa(price, ma50);
  }
  if (price != null && input.sma200Series?.length) {
    const ma200 = input.sma200Series[input.sma200Series.length - 1];
    if (pctVs200 == null) pctVs200 = pctVsMa(price, ma200);
  }

  const below50d = pctVs50 != null && pctVs50 < 0;
  const below200d = pctVs200 != null && pctVs200 < 0;

  const longSetupNegatives: string[] = [];
  const shortSetupIdeas: string[] = [];
  let shortSetupScore = 0;

  const addNegative = (label: string) => {
    if (!longSetupNegatives.includes(label)) longSetupNegatives.push(label);
  };

  if (sma20Dir === "falling") {
    addNegative(`20 SMA declining (${slope20Pct!.toFixed(2)}% / 10d)`);
    shortSetupScore += 8;
  }
  if (sma50Dir === "falling") {
    addNegative(`50 SMA declining (${slope50Pct!.toFixed(2)}% / 10d)`);
    shortSetupScore += 14;
  }
  if (sma200Dir === "falling") {
    addNegative(`200 SMA declining (${slope200Pct!.toFixed(2)}% / 10d)`);
    shortSetupScore += 10;
  }

  if (below200d) {
    const ur = input.urReclaimInPlay;
    if (input.powerSetup || input.reclaim200dOnLastBar) {
      /* reclaim + base context handled in baseMeta — not a headwind here */
    } else if (ur) {
      addNegative(
        `Below 200d (${Math.abs(pctVs200!).toFixed(1)}%) — U&R reclaim in play; still a long headwind until hold`
      );
    } else {
      addNegative(
        `Below 200d SMA (${Math.abs(pctVs200!).toFixed(1)}%) — negative for long setups; repair/mean-reversion only`
      );
      shortSetupScore += 22;
    }
  } else if (pctVs200 != null && pctVs200 < 3 && !input.reclaim200dOnLastBar) {
    addNegative(`Living near 200d (+${pctVs200.toFixed(1)}%) — fragile long structure`);
    shortSetupScore += 6;
  }

  if (below50d) {
    shortSetupScore += 16;
    if (!below200d) {
      addNegative(`Below 50d SMA (${Math.abs(pctVs50!).toFixed(1)}%) — intermediate trend damaged`);
    }
  }

  const rs = num(input.rsVsSpy);
  if (rs != null && rs < -1) {
    addNegative(`RS vs SPY ${rs >= 0 ? "+" : ""}${rs.toFixed(2)}% — lagging benchmark`);
    shortSetupScore += 10;
  } else if (rs != null && rs < 0) {
    shortSetupScore += 5;
  }

  const session = num(input.lastSessionPct);
  if (session != null && session <= -2) {
    shortSetupScore += 8;
  }
  if (below50d && below200d && sma50Dir === "falling") {
    shortSetupIdeas.push("Breakdown posture: below 50d & 200d with a declining 50 SMA — watch for continuation shorts / failed-bounce fades");
  }
  if (below200d && sma200Dir === "falling" && !input.urReclaimInPlay) {
    shortSetupIdeas.push("Longer-term repair short: price under a falling 200d — rallies into declining MAs may be sell-the-bounce candidates");
  }
  if (sma20Dir === "falling" && sma50Dir === "falling" && sma200Dir === "falling") {
    shortSetupIdeas.push("Full MA stack rolling over (20/50/200 declining) — trend short / laggard fade framework if RS stays weak");
    shortSetupScore += 12;
  }
  if (session != null && session <= -3 && below50d) {
    shortSetupIdeas.push(`Distribution session (${session.toFixed(1)}%) under 50d — breakdown continuation risk`);
    shortSetupScore += 10;
  }

  const themeBreakdown = input.themeBreakdownWatch
    ? {
        tier: input.themeBreakdownWatch.tier,
        score: input.themeBreakdownWatch.score,
        reasons: input.themeBreakdownWatch.reasons.slice(0, 4),
      }
    : null;

  if (themeBreakdown) {
    if (themeBreakdown.tier === "avoid_long" || themeBreakdown.tier === "breakdown_watch") {
      shortSetupScore += themeBreakdown.tier === "avoid_long" ? 20 : 14;
      const reasonBit =
        themeBreakdown.reasons.length > 0 ? ` (${themeBreakdown.reasons.join(" · ")})` : "";
      shortSetupIdeas.push(
        `Theme ${themeBreakdown.tier.replace(/_/g, " ")}${reasonBit} — pair stock breakdown with weak theme for relative-short / avoid-long ideas`
      );
      addNegative(`Theme structural weakness: ${themeBreakdown.tier.replace(/_/g, " ")}`);
    } else if (themeBreakdown.tier === "weak_laggard") {
      shortSetupScore += 8;
      addNegative("Theme weak laggard — long setups need extra confirmation");
    }
  }

  if (shortSetupScore >= 40 && shortSetupIdeas.length === 0) {
    shortSetupIdeas.push("Structure leans defensive — consider short-watch / avoid-long rather than fresh swing-long entries");
  }

  const earningsRisk = resolveEarningsRisk({
    nextEarningsDate: input.nextEarningsDate,
    nextEarningsDays: input.nextEarningsDays,
    earningsTime: input.earningsTime,
    earningsApplicable: input.earningsApplicable,
  });
  if (earningsRisk) {
    addNegative(earningsRisk.label);
    shortSetupScore += earningsRisk.severity === "red" ? 18 : 10;
  }

  shortSetupScore = Math.min(100, shortSetupScore);

  let postureHint: ChartSetupPostureHint = "unclear";
  if (input.powerSetup) postureHint = "long_friendly";
  else if (shortSetupScore >= 55) postureHint = "short_watch";
  else if (below200d && !input.urReclaimInPlay && !input.reclaim200dOnLastBar) postureHint = "repair_only";
  else if (input.reclaim200dOnLastBar && input.baseBelow200dBuilt) postureHint = "long_friendly";
  else if (longSetupNegatives.length >= 2 || below50d) postureHint = "caution";
  else if (
    !below200d &&
    !below50d &&
    sma50Dir !== "falling" &&
    sma200Dir !== "falling" &&
    (rs == null || rs >= 0)
  ) {
    postureHint = "long_friendly";
  }

  // Earnings inside 7d blocks a clean "long_friendly" stamp — setup can still be
  // constructive, but binary risk must downgrade posture to caution (or worse).
  if (earningsRisk) {
    if (earningsRisk.severity === "red") {
      if (postureHint === "long_friendly" || postureHint === "unclear") {
        postureHint = "caution";
      }
    } else if (postureHint === "long_friendly") {
      postureHint = "caution";
    }
  }

  return {
    maSlopes: {
      sma20: { slopePct10d: slope20Pct, direction: sma20Dir },
      sma50: { slopePct10d: slope50Pct, direction: sma50Dir },
      sma200: { slopePct10d: slope200Pct, direction: sma200Dir },
    },
    position: {
      pctVs20,
      pctVs50,
      pctVs200,
      below50d,
      below200d,
    },
    longSetupNegatives: longSetupNegatives.slice(0, 8),
    shortSetupIdeas: shortSetupIdeas.slice(0, 4),
    shortSetupScore,
    themeBreakdown,
    earningsRisk,
    postureHint,
  };
}

export const CHART_SETUP_POSTURE_LABELS: Record<ChartSetupPostureHint, string> = {
  long_friendly: "Long-friendly structure",
  caution: "Caution — mixed structure",
  repair_only: "Repair / mean-reversion only",
  short_watch: "Short-watch posture",
  unclear: "Structure unclear",
};
