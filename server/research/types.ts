/** Shared types for the strategy research backtester (docs/specs/strategy-research-loop.md). */

export interface DailyBar {
  /** Session date in ET, YYYY-MM-DD. */
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MinuteBar {
  /** ISO timestamp of the bar start. */
  t: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type SubStage = "1A" | "1B" | "2A" | "2B" | "2C" | "3A" | "3B" | "4A" | "4B" | "4C";

export type WeinsteinStage = 1 | 2 | 3 | 4;

export interface RuleCheck {
  name: string;
  pass: boolean;
  /** Measured value; null when the fact is missing (not enough history or no data source). */
  value: number | string | boolean | null;
  threshold: string;
  required: boolean;
}

export type CheckResult = Omit<RuleCheck, "required">;
