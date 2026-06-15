export type {
  SetupStage,
  SetupPatternKind,
  SetupBar,
  SetupTechnicals,
  SetupDetectionResult,
  PatternHit,
} from "./types";

export {
  normalizeSetupBars,
  sortBarsChronological,
  latestBar,
  priorBar,
  avgVolume,
  toDailyBarLike,
} from "./bars";

export { detectHvcFromDailyBars, detectHvc } from "./hvc";
export { detectVcp } from "./vcp";
export { detectBreakout } from "./breakout";
export {
  detectUndercutAndRally,
  detectMaUrReclaimOnLastBar,
  detectUrFromMaSeries,
  detectBestUndercutRally,
} from "./ur";
export { detectGapAndGo } from "./gap-and-go";
export {
  detectLongBase,
  detectRecentCoilBase,
  detectTightConsolidationBase,
} from "./long-base";
export { detectOrb } from "./orb";
export {
  enrichTickerReviewMember,
  patternHitFor,
  optionalFromPattern,
} from "./enrich-member";

export { emptyResult, hitResult } from "./result-helpers";
