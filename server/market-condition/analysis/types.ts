/**
 * MarketFlow Analysis Module Types
 * Unified schema for all modules and synthesis
 */

export type ModuleId =
  | "marketContext"
  | "keyLevels"
  | "volume"
  | "setupDetection"
  | "wyckoffStage"
  | "news"
  | "earnings"
  | "riskCalendar"
  | "fundFlow"
  | "sentiment"
  | "positionSizing";

export type Signal = "bullish" | "bearish" | "neutral" | "warning" | "informational";

export type Action = "strong_buy" | "buy" | "watch" | "avoid" | "short";

export interface ModuleResponse<T = unknown> {
  module_id: ModuleId;
  ticker: string;
  signal: Signal;
  summary: string;
  confidence: number; // 0-100
  data: T;
  flags?: string[];
  executionMs?: number;
}

// =============================================================================
// Module-specific data types
// =============================================================================

export interface MarketContextData {
  companyName: string;
  sector: string;
  industry: string;
  themes: Array<{ id: string; name: string }>;
  sectorRank: number;
  sectorChangePct: number;
  sectorPerformance: Array<{ sector: string; etf: string; changePct: number; rank: number }>;
  regime: "RISK_ON" | "NEUTRAL" | "RISK_OFF";
  raiScore: number;
  raiLabel: "AGGRESSIVE" | "NEUTRAL" | "DEFENSIVE";
  spyChangePct: number;
  rsVsSpy: number;
}

export interface KeyLevelData {
  levels: Array<{
    price: number;
    type: "support" | "resistance" | "ma" | "vwap_anchor" | "gap";
    label: string;
    significance: "major" | "moderate" | "minor";
    distancePct: number;
    source: string;
  }>;
  nearestSupport: number | null;
  nearestResistance: number | null;
  currentPrice: number;
}

export interface VolumeData {
  currentPrice: number;
  changePct: number;
  rvol: number; // relative volume vs 20-day avg
  avgVolume20: number;
  todayVolume: number;
  volumeTrend: "accumulation" | "distribution" | "neutral";
  dryUpDetected: boolean;
  atr14: number;
  adr20: number;
}

export interface SetupDetectionData {
  patterns: Array<{
    name: string;
    confidence: number;
    stage: "forming" | "ready" | "triggered" | "extended";
    entry: number | null;
    stop: number | null;
    target: number | null;
  }>;
  primaryPattern: string | null;
  rubricAutofill: Record<string, unknown>;
}

export interface NewsData {
  items: Array<{
    headline: string;
    source: string;
    datetime: string;
    sentiment: "positive" | "negative" | "neutral";
    impactLevel: "high" | "medium" | "low";
  }>;
  overallSentiment: "positive" | "negative" | "neutral";
  sentimentScore: number; // -100 to 100
}

export interface EarningsData {
  nextEarnings: {
    date: string;
    quarter: number;
    year: number;
    epsEstimate: number | null;
    revenueEstimate: number | null;
  } | null;
  daysUntilEarnings: number | null;
  impliedMovePct: number | null;
  recentSurprises: Array<{
    quarter: string;
    epsActual: number;
    epsEstimate: number;
    surprisePct: number;
  }>;
  beatRate: number; // % of recent beats
}

export interface RiskCalendarData {
  events: Array<{
    date: string;
    event: string;
    impact: "high" | "medium" | "low";
    daysAway: number;
  }>;
  nextMajorEvent: string | null;
  daysUntilMajorEvent: number | null;
}

export interface FundFlowData {
  themeFlow: "inflow" | "outflow" | "neutral";
  sectorFlow: "inflow" | "outflow" | "neutral";
  accDistStreak: number;
  institutionalActivity: "accumulation" | "distribution" | "neutral";
}

export interface SentimentData {
  analystConsensus: {
    strongBuy: number;
    buy: number;
    hold: number;
    sell: number;
    strongSell: number;
    rating: "strong_buy" | "buy" | "hold" | "sell" | "strong_sell";
  };
  priceTarget: {
    mean: number;
    high: number;
    low: number;
    upside: number;
  } | null;
  shortInterest: number | null;
  putCallRatio: number | null;
}

export interface PositionSizingData {
  suggestedShares: number;
  suggestedDollars: number;
  riskPerShare: number;
  riskDollars: number;
  riskPct: number;
  rrRatio: number | null;
  stopDistance: number;
  targetDistance: number | null;
}

export type WyckoffStage = "accumulation" | "markup" | "distribution" | "markdown" | "unknown";
export type WyckoffPhase = "A" | "B" | "C" | "D" | "E" | null;

export interface WyckoffEvent {
  type: "spring" | "upthrust" | "sign_of_strength" | "sign_of_weakness" | "test" | "shakeout" | "breakout" | "breakdown";
  date: string;
  price: number;
  description: string;
}

export interface WyckoffStageData {
  stage: WyckoffStage;
  phase: WyckoffPhase;
  stageLabel: string; // Human-readable label like "Stage 1: Accumulation (Phase C)"
  
  // Prior trend context
  priorTrend: "uptrend" | "downtrend" | "sideways";
  priorTrendPct: number;
  priorTrendDays: number;
  
  // Current trading range
  tradingRange: {
    high: number;
    low: number;
    midpoint: number;
    widthPct: number;
    daysInRange: number;
    isValid: boolean;
  };
  
  // Volume character analysis
  volumeCharacter: "accumulation" | "distribution" | "neutral";
  upVolumeRatio: number; // Ratio of up-day volume to down-day volume
  
  // Key levels
  breakoutLevel: number | null;  // Level to watch for markup confirmation
  breakdownLevel: number | null; // Level to watch for markdown confirmation
  
  // Wyckoff events detected
  events: WyckoffEvent[];
  
  // Position relative to range
  pricePosition: "above_range" | "in_range" | "below_range";
  distanceFromBreakout: number | null;
  distanceFromBreakdown: number | null;
}

// =============================================================================
// Synthesis output
// =============================================================================

export interface SynthesisOutput {
  company_description: string;
  executive_summary: string;
  conviction_score: number; // 0-100
  action: Action;
  action_rationale: string;
  key_bullish: string[];
  key_bearish: string[];
  conflicts: string[];
  rubric_autofill: Record<string, unknown>;
  model_used: string;
}

// =============================================================================
// Full analysis payload
// =============================================================================

export interface AnalysisResult {
  symbol: string;
  moduleResponses: ModuleResponse[];
  synthesis: SynthesisOutput;
  generated_at: string;
  execution_ms: number;
  version: string;
}
