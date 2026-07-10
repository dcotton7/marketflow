// ---------------------------------------------------------------------------
// Catalyst Detector — shared type definitions
// ---------------------------------------------------------------------------

// ── Catalyst entry (persisted in DB) ────────────────────────────────────────

export type CatalystType =
  | "earnings_beat"
  | "earnings_miss"
  | "earnings_flat"
  | "gap_up"
  | "gap_down"
  | "fda_decision"
  | "government_policy"
  | "macro_news"
  | "analyst_upgrade"
  | "analyst_downgrade"
  | "contract_award"
  | "acquisition_merger"
  | "insider_activity"
  | "volume_anomaly"
  | "news_keyword"
  | "manual";

export type CatalystSubjectKind = "ticker" | "theme" | "sector";

export type InitialReaction = "positive" | "negative" | "flat" | "contrary";

export type ExpectedDirection = "up" | "down" | "volatile";

export interface CatalystEntry {
  id: number;
  subject: string;
  subjectKind: CatalystSubjectKind;
  catalystType: CatalystType;
  headline: string;
  source: "finnhub" | "fmp" | "system" | "manual" | "ai_inferred";
  firedAt: string;
  expiresAt: string;
  initialReaction: InitialReaction;
  expectedDirection: ExpectedDirection;
  decayWeight: number;
  resolved: boolean;
  resolvedAt: string | null;
  resolutionMagnitude: number | null;
  ruleId: string | null;
  ownerId: number | null;
  notes: string | null;
  createdAt: string;
}

// ── Catalyst rule (admin-editable) ──────────────────────────────────────────

export type DecayShape = "linear" | "slow" | "fast" | "step";

export interface CatalystRuleDefinition {
  id: string;
  name: string;
  enabled: boolean;
  catalystType: CatalystType;
  description: string;

  /** Number of trading days before expiry */
  windowDays: number;
  decayShape: DecayShape;

  /** Score boost multiplied by decayWeight when a signal matches a catalyzed ticker */
  boostMultiplier: number;

  /** Minimum news severity score (1-10) to trigger, or null for non-news rules */
  minNewsSeverity: number | null;

  /** Keywords that trigger this rule (for news-based rules) */
  keywords: string[];

  /** Condition for initial reaction classification */
  contraryThresholdPct: number;

  ownerId: number | null;
  createdAt: string;
  updatedAt: string;
}

// ── Decay computation ───────────────────────────────────────────────────────

export function computeDecayWeight(
  shape: DecayShape,
  daysSinceFired: number,
  windowDays: number
): number {
  if (daysSinceFired >= windowDays) return 0;
  const progress = daysSinceFired / windowDays;

  switch (shape) {
    case "linear":
      return Math.max(0, 1 - progress);
    case "slow":
      return Math.max(0, 1 - progress * 0.5);
    case "fast":
      return Math.max(0, Math.pow(1 - progress, 2));
    case "step":
      // Full weight for 60% of window, then drops
      return progress < 0.6 ? 1.0 : Math.max(0, (1 - progress) / 0.4);
    default:
      return Math.max(0, 1 - progress);
  }
}

// ── News severity keywords ──────────────────────────────────────────────────

export const NEWS_SEVERITY_TIERS: Record<number, string[]> = {
  10: ["crash", "explosion", "fraud", "recall", "bankruptcy", "sec investigation", "default"],
  9: ["fda reject", "sanctions", "war", "indictment", "delisted"],
  8: ["earnings", "acquisition", "merger", "guidance raise", "guidance cut", "fda approval", "tariff", "layoffs", "revenue beat", "revenue miss", "eps beat", "eps miss"],
  7: ["contract", "partnership", "stock split", "buyback", "government policy", "rate decision"],
  6: ["upgrade", "downgrade", "analyst", "cfo", "ceo", "executive", "overweight", "underweight", "outperform", "underperform"],
  5: ["partnership", "expansion", "new product", "price target", "raises", "lowers", "initiates", "reiterates"],
  4: ["hire", "coo", "board", "share offering", "maintains", "keeps"],
  3: ["conference", "presentation", "filing", "market", "sector", "industry", "trade", "tariff", "regulation"],
  2: ["dividend", "routine"],
  1: ["mention", "coverage"],
};

export function scoreHeadlineSeverity(headline: string): number {
  const lower = headline.toLowerCase();
  for (let score = 10; score >= 1; score--) {
    const keywords = NEWS_SEVERITY_TIERS[score];
    if (keywords?.some((kw) => lower.includes(kw))) return score;
  }
  return 1;
}

// ── Session segment types (for multi-day pattern tracking) ──────────────────

export type SessionSegment = "pre_market" | "am" | "midday" | "pm" | "close" | "full_day";

export interface SessionSegmentReturn {
  date: string;
  segment: SessionSegment;
  spyReturn: number;
  qqqReturn: number;
  iwmReturn: number;
  avgThemeScore: number;
  themesUp: number;
  themesDown: number;
}

export interface SessionPattern {
  pattern: string;
  description: string;
  frequency: number;
  occurrences: number;
  totalDays: number;
  avgMagnitude: number;
  lastOccurrence: string;
  confidence: "high" | "medium" | "low";
}
