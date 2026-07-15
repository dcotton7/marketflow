// ---------------------------------------------------------------------------
// Scanner Configuration — admin-tunable parameters
//
// All scanner signal thresholds, cooldowns, and windows are defined here.
// The server loads from DB on startup, falls back to these defaults.
// Admin UI reads/writes via /api/scanner/config.
// ---------------------------------------------------------------------------

export interface ScannerConfig {
  // ── Volume Spike ──────────────────────────────────────────────────────
  volumeSpikeThreshold: number;
  volumeSpikeCooldownMin: number;

  // ── Velocity Move ─────────────────────────────────────────────────────
  velocityThresholdPct: number;
  velocityWindowFrames: number;
  velocityCooldownMin: number;

  // ── ADR Blowout ───────────────────────────────────────────────────────
  adrBlowoutThreshold: number;
  adrBlowoutCooldownMin: number;

  // ── Gap ────────────────────────────────────────────────────────────────
  gapThresholdPct: number;
  gapCooldownMin: number;

  // ── Breadth Shift ─────────────────────────────────────────────────────
  breadthShiftThreshold: number;
  breadthShiftWindowFrames: number;
  breadthShiftCooldownMin: number;

  // ── Theme Acceleration ────────────────────────────────────────────────
  themeAccelThreshold: number;
  themeAccelCooldownMin: number;

  // ── RAI Shift ─────────────────────────────────────────────────────────
  raiShiftThreshold: number;
  raiShiftWindowFrames: number;
  raiShiftCooldownMin: number;

  // ── Broad Move ────────────────────────────────────────────────────────
  broadMoveThemeCount: number;
  broadMoveCooldownMin: number;

  // ── LOD Bounce ────────────────────────────────────────────────────────
  lodBounceTier1Pct: number;
  lodBounceTier2Pct: number;
  lodBounceMaxAtrExt: number;
  lodBounceCooldownMin: number;

  // ── U&R MA Reclaim (50d + 200d) ──────────────────────────────────────
  maReclaim200dMaxExtPct: number;
  maReclaim50dMaxExtPct: number;
  maReclaimCooldownMin: number;

  // ── 20d MA Proximity Watch ─────────────────────────────────────────
  maProximityThresholdPct: number;
  maProximityCooldownMin: number;

  // ── Break Signals (prev day + 5-day) ──────────────────────────────────
  breakClearancePct: number;
  breakConfirmFrames: number;
  breakCooldownMin: number;
  breakFreshnessRequired: boolean;
  breakFreshnessWindowFrames: number;

  // ── Failed Breakout ────────────────────────────────────────────────────
  failedBreakoutReversalPct: number;
  failedBreakoutLookbackMin: number;
  failedBreakoutLookbackMax: number;
  failedBreakoutCooldownMin: number;

  // ── HOD Fade ───────────────────────────────────────────────────────────
  hodFadeMinPct: number;
  hodFadeMinFramesSinceHod: number;
  hodFadeCooldownMin: number;

  // ── Gap Down Continuation ──────────────────────────────────────────────
  gapDownContinuationMinGapPct: number;
  gapDownContinuationMinFadePct: number;
  gapDownContinuationMinFrames: number;
  gapDownContinuationCooldownMin: number;

  // ── IPO Detection ───────────────────────────────────────────────────────
  ipoDetectionEnabled: boolean;
  ipoMinMarketCapM: number;
}

export const DEFAULT_SCANNER_CONFIG: ScannerConfig = {
  volumeSpikeThreshold: 3.0,
  volumeSpikeCooldownMin: 5,

  velocityThresholdPct: 2.0,
  velocityWindowFrames: 8,
  velocityCooldownMin: 5,

  adrBlowoutThreshold: 2.5,
  adrBlowoutCooldownMin: 60,

  gapThresholdPct: 3.0,
  gapCooldownMin: 240,

  breadthShiftThreshold: 0.25,
  breadthShiftWindowFrames: 8,
  breadthShiftCooldownMin: 15,

  themeAccelThreshold: 6.0,
  themeAccelCooldownMin: 10,

  raiShiftThreshold: 5,
  raiShiftWindowFrames: 8,
  raiShiftCooldownMin: 10,

  broadMoveThemeCount: 8,
  broadMoveCooldownMin: 15,

  lodBounceTier1Pct: 1.0,
  lodBounceTier2Pct: 2.0,
  lodBounceMaxAtrExt: 6.0,
  lodBounceCooldownMin: 30,

  maReclaim200dMaxExtPct: 4.0,
  maReclaim50dMaxExtPct: 2.0,
  maReclaimCooldownMin: 60,

  maProximityThresholdPct: 2.0,
  maProximityCooldownMin: 30,

  breakClearancePct: 0.25,
  breakConfirmFrames: 5,
  breakCooldownMin: 45,
  breakFreshnessRequired: true,
  breakFreshnessWindowFrames: 6,

  failedBreakoutReversalPct: 0.25,
  failedBreakoutLookbackMin: 5,
  failedBreakoutLookbackMax: 20,
  failedBreakoutCooldownMin: 45,

  hodFadeMinPct: 1.5,
  hodFadeMinFramesSinceHod: 60,
  hodFadeCooldownMin: 60,

  gapDownContinuationMinGapPct: 1.0,
  gapDownContinuationMinFadePct: 0.5,
  gapDownContinuationMinFrames: 120,
  gapDownContinuationCooldownMin: 60,

  ipoDetectionEnabled: true,
  ipoMinMarketCapM: 100,
};

/** Config field metadata for rendering the admin UI */
export interface ConfigFieldMeta {
  key: keyof ScannerConfig;
  label: string;
  group: string;
  type: "number" | "boolean";
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}

export const SCANNER_CONFIG_FIELDS: ConfigFieldMeta[] = [
  { key: "volumeSpikeThreshold", label: "Volume Spike Threshold", group: "Volume", type: "number", min: 1, max: 20, step: 0.5, unit: "x avg" },
  { key: "volumeSpikeCooldownMin", label: "Cooldown", group: "Volume", type: "number", min: 1, max: 120, step: 1, unit: "min" },

  { key: "velocityThresholdPct", label: "Velocity Threshold", group: "Velocity", type: "number", min: 0.5, max: 10, step: 0.25, unit: "%" },
  { key: "velocityWindowFrames", label: "Window", group: "Velocity", type: "number", min: 2, max: 40, step: 1, unit: "frames" },
  { key: "velocityCooldownMin", label: "Cooldown", group: "Velocity", type: "number", min: 1, max: 60, step: 1, unit: "min" },

  { key: "adrBlowoutThreshold", label: "ADR Blowout Threshold", group: "ADR", type: "number", min: 1, max: 10, step: 0.5, unit: "x" },
  { key: "adrBlowoutCooldownMin", label: "Cooldown", group: "ADR", type: "number", min: 5, max: 240, step: 5, unit: "min" },

  { key: "gapThresholdPct", label: "Gap Threshold", group: "Gap", type: "number", min: 1, max: 15, step: 0.5, unit: "%" },
  { key: "gapCooldownMin", label: "Cooldown", group: "Gap", type: "number", min: 30, max: 480, step: 30, unit: "min" },

  { key: "breadthShiftThreshold", label: "Breadth Shift Threshold", group: "Breadth", type: "number", min: 0.05, max: 0.5, step: 0.05, unit: "ratio" },
  { key: "breadthShiftWindowFrames", label: "Window", group: "Breadth", type: "number", min: 2, max: 40, step: 1, unit: "frames" },
  { key: "breadthShiftCooldownMin", label: "Cooldown", group: "Breadth", type: "number", min: 5, max: 60, step: 5, unit: "min" },

  { key: "themeAccelThreshold", label: "Theme Accel Threshold", group: "Theme", type: "number", min: 1, max: 20, step: 0.5, unit: "score" },
  { key: "themeAccelCooldownMin", label: "Cooldown", group: "Theme", type: "number", min: 5, max: 60, step: 5, unit: "min" },

  { key: "raiShiftThreshold", label: "RAI Shift Threshold", group: "RAI", type: "number", min: 1, max: 20, step: 1, unit: "pts" },
  { key: "raiShiftWindowFrames", label: "Window", group: "RAI", type: "number", min: 2, max: 40, step: 1, unit: "frames" },
  { key: "raiShiftCooldownMin", label: "Cooldown", group: "RAI", type: "number", min: 5, max: 60, step: 5, unit: "min" },

  { key: "broadMoveThemeCount", label: "Broad Move Theme Count", group: "Broad", type: "number", min: 3, max: 20, step: 1, unit: "themes" },
  { key: "broadMoveCooldownMin", label: "Cooldown", group: "Broad", type: "number", min: 5, max: 60, step: 5, unit: "min" },

  { key: "lodBounceTier1Pct", label: "LOD Bounce Tier 1", group: "LOD Bounce", type: "number", min: 0.5, max: 5, step: 0.25, unit: "%" },
  { key: "lodBounceTier2Pct", label: "LOD Bounce Tier 2", group: "LOD Bounce", type: "number", min: 1, max: 10, step: 0.25, unit: "%" },
  { key: "lodBounceMaxAtrExt", label: "Max ATR Extension", group: "LOD Bounce", type: "number", min: 1, max: 15, step: 0.5, unit: "x" },
  { key: "lodBounceCooldownMin", label: "Cooldown", group: "LOD Bounce", type: "number", min: 5, max: 120, step: 5, unit: "min" },

  { key: "maReclaim200dMaxExtPct", label: "200d Max Extension", group: "MA Reclaim", type: "number", min: 0.5, max: 10, step: 0.5, unit: "%" },
  { key: "maReclaim50dMaxExtPct", label: "50d Max Extension", group: "MA Reclaim", type: "number", min: 0.5, max: 10, step: 0.5, unit: "%" },
  { key: "maReclaimCooldownMin", label: "Cooldown", group: "MA Reclaim", type: "number", min: 15, max: 240, step: 15, unit: "min" },

  { key: "maProximityThresholdPct", label: "20d Proximity Band", group: "MA Proximity", type: "number", min: 0.5, max: 5, step: 0.25, unit: "%" },
  { key: "maProximityCooldownMin", label: "Repeat Interval", group: "MA Proximity", type: "number", min: 10, max: 120, step: 5, unit: "min" },

  { key: "breakClearancePct", label: "Break Clearance", group: "Breaks", type: "number", min: 0.1, max: 2, step: 0.05, unit: "%" },
  { key: "breakConfirmFrames", label: "Confirm Frames", group: "Breaks", type: "number", min: 1, max: 15, step: 1, unit: "frames" },
  { key: "breakCooldownMin", label: "Cooldown", group: "Breaks", type: "number", min: 5, max: 120, step: 5, unit: "min" },
  { key: "breakFreshnessRequired", label: "Freshness Required", group: "Breaks", type: "boolean" },
  { key: "breakFreshnessWindowFrames", label: "Freshness Window", group: "Breaks", type: "number", min: 2, max: 20, step: 1, unit: "frames" },

  { key: "failedBreakoutReversalPct", label: "Reversal Threshold", group: "Failed Breakout", type: "number", min: 0.1, max: 2, step: 0.05, unit: "%" },
  { key: "failedBreakoutLookbackMin", label: "Lookback Min", group: "Failed Breakout", type: "number", min: 2, max: 10, step: 1, unit: "frames" },
  { key: "failedBreakoutLookbackMax", label: "Lookback Max", group: "Failed Breakout", type: "number", min: 5, max: 40, step: 1, unit: "frames" },
  { key: "failedBreakoutCooldownMin", label: "Cooldown", group: "Failed Breakout", type: "number", min: 5, max: 120, step: 5, unit: "min" },

  { key: "hodFadeMinPct", label: "Min Fade from HOD", group: "HOD Fade", type: "number", min: 0.5, max: 5, step: 0.25, unit: "%" },
  { key: "hodFadeMinFramesSinceHod", label: "Min Frames Since HOD", group: "HOD Fade", type: "number", min: 20, max: 200, step: 10, unit: "frames" },
  { key: "hodFadeCooldownMin", label: "Cooldown", group: "HOD Fade", type: "number", min: 15, max: 240, step: 15, unit: "min" },

  { key: "gapDownContinuationMinGapPct", label: "Min Gap Down", group: "Gap Down Cont.", type: "number", min: 0.5, max: 5, step: 0.25, unit: "%" },
  { key: "gapDownContinuationMinFadePct", label: "Min Fade Below Open", group: "Gap Down Cont.", type: "number", min: 0.25, max: 3, step: 0.25, unit: "%" },
  { key: "gapDownContinuationMinFrames", label: "Min Frames (1st hour)", group: "Gap Down Cont.", type: "number", min: 30, max: 240, step: 10, unit: "frames" },
  { key: "gapDownContinuationCooldownMin", label: "Cooldown", group: "Gap Down Cont.", type: "number", min: 15, max: 240, step: 15, unit: "min" },

  { key: "ipoDetectionEnabled", label: "IPO Detection Enabled", group: "IPO", type: "boolean" },
  { key: "ipoMinMarketCapM", label: "Min Market Cap", group: "IPO", type: "number", min: 0, max: 5000, step: 50, unit: "$M" },
];
