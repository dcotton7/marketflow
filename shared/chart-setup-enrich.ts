/**
 * Chart Setup Enrich — on-demand analysis from chart viewer (structured dossier + optional vision).
 */

import type { ChartSetupStructureMeta } from "./chart-setup-structure-meta";
import type { ChartSetupBaseMeta } from "./chart-setup-base-meta";
import type { ChartSetupUrMeta } from "./chart-setup-ur-meta";

export const CHART_ENRICH_PATTERN_LABELS = [
  "cup_and_handle",
  "high_tight_flag",
  "vcp",
  "undercut_rally",
  "breakout",
  "pullback",
  "gap_and_go",
  "orb",
  "none_unclear",
] as const;

export type ChartEnrichPatternLabel = (typeof CHART_ENRICH_PATTERN_LABELS)[number];

export const CHART_ENRICH_LIFECYCLE_STAGES = [
  "pre_setup",
  "triggering",
  "post_rally",
  "extended",
  "watch_pullback",
  "unclear",
] as const;

export type ChartEnrichLifecycleStage = (typeof CHART_ENRICH_LIFECYCLE_STAGES)[number];

export const CHART_ENRICH_PATTERN_CLEANLINESS = ["clean", "messy", "unclear"] as const;
export type ChartEnrichPatternCleanliness = (typeof CHART_ENRICH_PATTERN_CLEANLINESS)[number];

export const CHART_ENRICH_MODEL_TIERS = ["gold", "silver", "bronze"] as const;
export type ChartEnrichModelTier = (typeof CHART_ENRICH_MODEL_TIERS)[number];

export const CHART_ENRICH_MODEL_SCOPES = [
  "full_read",
  "lifecycle",
  "pattern",
  "invalidation",
  "visual",
] as const;

export type ChartEnrichModelScope = (typeof CHART_ENRICH_MODEL_SCOPES)[number];

export const CHART_ENRICH_CORRECTION_KINDS = [
  "wrong_timing",
  "wrong_pattern",
  "too_generic",
  "other",
] as const;

export type ChartEnrichCorrectionKind = (typeof CHART_ENRICH_CORRECTION_KINDS)[number];

export interface ChartEnrichBarSummary {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ChartSetupEnrichDossier {
  symbol: string;
  intradayTimeframe: string;
  includeVisual: boolean;
  dailyBars: ChartEnrichBarSummary[];
  intradayBars: ChartEnrichBarSummary[];
  metrics?: Record<string, unknown> | null;
  scanRow?: Record<string, unknown> | null;
  themeId?: string | null;
  themeRank?: number | null;
  /** MA slopes, long negatives, short-watch ideas, theme breakdown context. */
  structureMeta?: ChartSetupStructureMeta | null;
  /** Gap-forward long base detection from full daily history. */
  baseMeta?: ChartSetupBaseMeta | null;
  /** 20d / 21d / 50d undercut-and-rally from full daily history. */
  urMeta?: ChartSetupUrMeta | null;
}

export interface ChartSetupEnrichResult {
  recommendation: string;
  invalidation: string;
  lifecycleStage: ChartEnrichLifecycleStage;
  patternLabel: ChartEnrichPatternLabel;
  patternCleanliness: ChartEnrichPatternCleanliness;
  patternConfidencePct: number | null;
  source: "llm" | "rules";
  structureMeta?: ChartSetupStructureMeta | null;
  baseMeta?: ChartSetupBaseMeta | null;
  urMeta?: ChartSetupUrMeta | null;
}

export interface ChartEnrichFeedbackInput {
  enrichRunId?: number | null;
  symbol: string;
  helpful: "up" | "down";
  correctionKind?: ChartEnrichCorrectionKind | null;
  correctedLifecycle?: ChartEnrichLifecycleStage | null;
  correctedPattern?: ChartEnrichPatternLabel | null;
  note?: string | null;
  enrichSnapshot?: ChartSetupEnrichResult | null;
  dossier?: ChartSetupEnrichDossier | null;
}

export interface ChartEnrichModelInput {
  enrichRunId?: number | null;
  feedbackId?: number | null;
  symbol: string;
  tier: ChartEnrichModelTier;
  scopes: ChartEnrichModelScope[];
  patternLabel?: ChartEnrichPatternLabel | null;
  patternCleanliness?: ChartEnrichPatternCleanliness | null;
  lifecycleStage?: ChartEnrichLifecycleStage | null;
  note?: string | null;
  enrichSnapshot?: ChartSetupEnrichResult | null;
  dossier?: ChartSetupEnrichDossier | null;
}

export const CHART_ENRICH_PATTERN_DISPLAY: Record<ChartEnrichPatternLabel, string> = {
  cup_and_handle: "Cup & Handle",
  high_tight_flag: "High Tight Flag",
  vcp: "VCP",
  undercut_rally: "U&R",
  breakout: "Breakout",
  pullback: "Pullback",
  gap_and_go: "Gap & Go",
  orb: "ORB",
  none_unclear: "None / unclear",
};

export const CHART_ENRICH_LIFECYCLE_DISPLAY: Record<ChartEnrichLifecycleStage, string> = {
  pre_setup: "Pre-setup",
  triggering: "Triggering",
  post_rally: "Post-rally",
  extended: "Extended",
  watch_pullback: "Watch pullback",
  unclear: "Unclear",
};

export function formatEnrichConfidencePct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${Number(v).toFixed(2)}%`;
}
