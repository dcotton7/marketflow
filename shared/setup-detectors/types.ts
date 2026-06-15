import type { OptionalCriterionId } from "../ticker-review-types";

export type SetupStage = "forming" | "ready" | "triggered" | "extended";

export type SetupPatternKind =
  | "hvc"
  | "vcp"
  | "htf"
  | "pullback"
  | "breakout"
  | "undercut_rally"
  | "gap_and_go"
  | "long_base"
  | "orb";

export interface SetupBar {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp?: string | number;
}

export interface SetupTechnicals {
  sma21?: number;
  sma50?: number;
  high52Week?: number;
}

export interface SetupDetectionResult {
  detected: boolean;
  pattern: SetupPatternKind;
  criterionId?: OptionalCriterionId;
  stage: SetupStage;
  confidence: number;
  entry: number | null;
  stop: number | null;
  target: number | null;
  diagnostics?: Record<string, unknown>;
}

export interface PatternHit {
  criterionId: OptionalCriterionId;
  stage: SetupStage;
  confidence: number;
  pattern: SetupPatternKind;
  diagnostics?: Record<string, unknown>;
}
