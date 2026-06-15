import type { OptionalCriterionId } from "../ticker-review-types";
import type { SetupDetectionResult, SetupPatternKind, SetupStage } from "./types";

export function emptyResult(
  pattern: SetupPatternKind,
  criterionId?: OptionalCriterionId
): SetupDetectionResult {
  return {
    detected: false,
    pattern,
    criterionId,
    stage: "forming",
    confidence: 0,
    entry: null,
    stop: null,
    target: null,
  };
}

export function hitResult(
  pattern: SetupPatternKind,
  criterionId: OptionalCriterionId,
  stage: SetupStage,
  confidence: number,
  entry: number | null,
  stop: number | null,
  target: number | null,
  diagnostics?: Record<string, unknown>
): SetupDetectionResult {
  return {
    detected: true,
    pattern,
    criterionId,
    stage,
    confidence,
    entry,
    stop,
    target,
    diagnostics,
  };
}
