/** Ticker Review — criteria UI config (types live in @shared). */

import type {
  OptionalCriterionId,
  RequiredCriterionId,
  TickerReviewScanMode,
} from "@shared/ticker-review-types";

export type {
  OptionalCriterionId,
  RequiredCriterionId,
  TickerReviewScanMode,
} from "@shared/ticker-review-types";

export { SCAN_MODE_LABELS } from "@shared/ticker-review-engine";

export interface CriterionDef {
  id: RequiredCriterionId | OptionalCriterionId;
  label: string;
  shortLabel: string;
  description: string;
  group: "required" | "optional";
  defaultOn: boolean;
  locked?: boolean;
}

export const REQUIRED_CRITERIA: CriterionDef[] = [
  {
    id: "R3",
    label: "Not deeply broken",
    shortLabel: "Not broken",
    description: "Exclude >8% below 200d and bear trend unless U&R repair fires",
    group: "required",
    defaultOn: true,
  },
  {
    id: "R4",
    label: "Not extended",
    shortLabel: "Not extended",
    description: "Hide names >18% above 50d SMA (chase filter)",
    group: "required",
    defaultOn: true,
  },
  {
    id: "R5",
    label: "Min sponsorship",
    shortLabel: "Sponsorship",
    description: "Volume / A-D not dead",
    group: "required",
    defaultOn: true,
  },
  {
    id: "R6",
    label: "RS floor (mode)",
    shortLabel: "RS floor",
    description: "Context RS gate from scan mode",
    group: "required",
    defaultOn: true,
  },
];

export const OPTIONAL_CRITERIA: CriterionDef[] = [
  {
    id: "O1",
    label: "Strong RS",
    shortLabel: "Strong RS",
    description: "Top 40% theme rank and RS vs SPY > 0",
    group: "optional",
    defaultOn: true,
  },
  {
    id: "O2",
    label: "Emerging RS",
    shortLabel: "Emerging RS",
    description: "RS rank / theme-relative RS improving",
    group: "optional",
    defaultOn: true,
  },
  {
    id: "O3",
    label: "Laggard coil",
    shortLabel: "Laggard coil",
    description: "Not extended laggard in hot theme with coil",
    group: "optional",
    defaultOn: true,
  },
  {
    id: "O4",
    label: "Tight MAs",
    shortLabel: "Tight MAs",
    description: "≥2 of 10/20/50/200 within 2% — more stacked = stronger",
    group: "optional",
    defaultOn: true,
  },
  {
    id: "O5",
    label: "U&R",
    shortLabel: "U&R",
    description: "Reclaim 20d / 50d / 200d SMA",
    group: "optional",
    defaultOn: true,
  },
  {
    id: "O6",
    label: "Tight base",
    shortLabel: "Tight base",
    description: "Base / VCP forming proxy",
    group: "optional",
    defaultOn: true,
  },
  {
    id: "O7",
    label: "HVC",
    shortLabel: "HVC",
    description: "High volume close prior session",
    group: "optional",
    defaultOn: true,
  },
  {
    id: "O8",
    label: "Gap + go",
    shortLabel: "Gap+go",
    description: "Gap up 1–5 sessions, holding",
    group: "optional",
    defaultOn: true,
  },
  {
    id: "O9",
    label: "ORB",
    shortLabel: "ORB",
    description: "Opening range setup — AM action",
    group: "optional",
    defaultOn: true,
  },
  {
    id: "O10",
    label: "Breakout",
    shortLabel: "Breakout",
    description: "Activating / volume expansion",
    group: "optional",
    defaultOn: true,
  },
  {
    id: "O11",
    label: "Leader / A-D",
    shortLabel: "Leader",
    description: "Leader flag or strong A/D streak",
    group: "optional",
    defaultOn: false,
  },
];

export type TickerReviewPresetId =
  | "premarket"
  | "postclose"
  | "laggard"
  | "emerging"
  | "full";

export interface TickerReviewPreset {
  id: TickerReviewPresetId;
  label: string;
  mode: TickerReviewScanMode;
  required: RequiredCriterionId[];
  optional: OptionalCriterionId[];
}

export const TICKER_REVIEW_PRESETS: TickerReviewPreset[] = [
  {
    id: "premarket",
    label: "Pre-market action",
    mode: "auto",
    required: ["R3", "R4", "R5", "R6"],
    optional: ["O7", "O9", "O4", "O8", "O2"],
  },
  {
    id: "postclose",
    label: "Post-close ideas",
    mode: "auto",
    required: ["R3", "R4", "R5", "R6"],
    optional: ["O6", "O5", "O7", "O3", "O1"],
  },
  {
    id: "laggard",
    label: "Hot theme — who's next",
    mode: "laggard",
    required: ["R3", "R4", "R5", "R6"],
    optional: ["O3", "O4", "O5", "O6", "O7"],
  },
  {
    id: "emerging",
    label: "Risk-off — emerging",
    mode: "emerging",
    required: ["R3", "R5", "R6"],
    optional: ["O2", "O5", "O4", "O7"],
  },
  {
    id: "full",
    label: "Full tape",
    mode: "auto",
    required: ["R5"],
    optional: ["O1", "O2", "O3", "O4", "O5", "O6", "O7", "O8", "O9", "O10", "O11"],
  },
];

export function defaultEnabledRequired(): Set<RequiredCriterionId> {
  return new Set(REQUIRED_CRITERIA.filter((c) => c.defaultOn).map((c) => c.id as RequiredCriterionId));
}

export function defaultEnabledOptional(): Set<OptionalCriterionId> {
  return new Set(OPTIONAL_CRITERIA.filter((c) => c.defaultOn).map((c) => c.id as OptionalCriterionId));
}
