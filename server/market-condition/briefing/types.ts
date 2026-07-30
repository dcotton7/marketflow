import type { ClusterId } from "../universe";
import type { RaceTerminalState } from "../utils/theme-tracker-time";

import type { CategorizedNewsItem } from "./macro-news";

export type BriefingMode = "pre" | "post";

export type CatalystConfidence = "high" | "medium" | "low" | "speculative";

export type MarketDirection = "risk_on" | "risk_off" | "mixed" | "choppy_sell" | "choppy_buy";

export type StoryAtomCategory =
  | "market_direction"
  | "rotation_why"
  | "theme_pattern"
  | "session_arc"
  | "macro_link"
  | "caution"
  | "catalyst_watch"
  | "session_pattern"
  | "scanner_insight";

export interface StoryAtom {
  id: string;
  category: StoryAtomCategory;
  headline: string;
  detail: string;
  confidence: CatalystConfidence;
  evidence: string[];
}

export interface BriefingStoryContext {
  marketDirection: MarketDirection;
  directionLabel: string;
  rotationSummary: string;
  atoms: StoryAtom[];
  macroNews: CategorizedNewsItem[];
  /** Active catalyst entries injected from scanner (if available) */
  activeCatalysts?: import("@shared/catalyst-types").CatalystEntry[];
  /** Multi-day session patterns (AM/PM trends) */
  sessionPatterns?: import("@shared/catalyst-types").SessionPattern[];
}

export interface BriefingDataQuality {
  intradaySlots: { available: number; expected: number; complete: boolean };
  dailyCloseAvailable: boolean;
  openBaselineAvailable: boolean;
  lateBaselineAvailable: boolean;
  extendedQuotesAvailable: boolean;
  synthesisAvailable: boolean;
  warnings: string[];
}

export interface BriefingBenchmark {
  symbol: string;
  changePct: number;
  price?: number;
}

export interface BriefingThemeRow {
  id: ClusterId;
  name: string;
  rank: number;
  score: number;
  medianPct: number;
  rsVsBenchmark: number;
  breadthPct: number;
  deltaRankFromOpen: number;
  deltaRankLate: number;
  isNarrowLeadership: boolean;
  breakdownTier: string | null;
  trendState: string;
}

export interface BriefingMemberMove {
  symbol: string;
  themeId: ClusterId;
  themeName: string;
  pctChange: number;
  rsVsBenchmark: number;
  /** Live cumulative volume divided by 20-day average volume. */
  volExp?: number;
  role: "leader" | "dragger";
}

export interface BriefingCatalyst {
  themeId: ClusterId;
  themeName: string;
  symbols: string[];
  type: "earnings" | "news" | "macro" | "peer_contagion" | "rotation";
  headline: string;
  confidence: CatalystConfidence;
  direction: "supports_strength" | "supports_weakness" | "mixed" | "context";
}

export interface BriefingNarrativeSection {
  id: string;
  title: string;
  body: string;
}

export interface BriefingNarrative {
  executiveSummary: string;
  sections: BriefingNarrativeSection[];
  watchList: Array<{ themeId: string; themeName: string; reason: string }>;
  source: "template" | "llm";
}

export interface ThemeBriefingDossier {
  mode: BriefingMode;
  referenceSession: string;
  priorSession: string | null;
  generatedAt: string;
  terminalState: RaceTerminalState;
  rotationCharacter: string;
  benchmarks: BriefingBenchmark[];
  comparisonTimeOpen: string | null;
  comparisonTimeLate: string | null;
  themes: BriefingThemeRow[];
  leaders: BriefingThemeRow[];
  laggards: BriefingThemeRow[];
  lateRotators: BriefingThemeRow[];
  openRotators: BriefingThemeRow[];
  topMembers: BriefingMemberMove[];
  catalysts: BriefingCatalyst[];
  dataQuality: BriefingDataQuality;
}

export interface BriefingPreview {
  mode: BriefingMode;
  label: string;
  referenceSession: string;
  description: string;
  recommended: boolean;
}

export interface ThemeBriefingResponse {
  mode: BriefingMode;
  referenceSession: string;
  generatedAt: string;
  terminalState: RaceTerminalState;
  dataQuality: BriefingDataQuality;
  dossier: ThemeBriefingDossier;
  storyContext: BriefingStoryContext;
  narrative: BriefingNarrative;
  preview?: BriefingPreview[];
  synthesisModel?: string;
  /** True when served from post-market cache within TTL. */
  cached?: boolean;
  cachedAt?: string;
}

export const EXPECTED_INTRADAY_SLOTS = 26;
