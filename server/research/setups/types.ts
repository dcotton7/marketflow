import type { SymbolFacts } from "../facts";
import type { SubStage } from "../types";

export interface SetupContext {
  f: SymbolFacts;
  /** Index of the signal bar; detectors read bars 0..i only. */
  i: number;
  stages: (SubStage | null)[];
}

/** How the entry fills, decided at the signal close: market at the next open, or a buy stop for the next N sessions. */
export type EntryOrder = { type: "next_open" } | { type: "buy_stop"; price: number; validSessions: number };

/**
 * Don's rule: a stop is always a logical level from structure (base/handle low, wedge low, pullback or swing low, the
 * low of the signal bar, the MA it bounced from), minus a small ATR buffer. Never a percentage picked in space.
 */
export interface LogicalStop {
  price: number;
  /** The structural level before the buffer. */
  level: number;
  basis: "base_low" | "handle_low" | "wedge_low" | "pop_day_low" | "pullback_low" | "undercut_low" | "contraction_low" | "reversal_low" | "gap_day_low" | "ma_bounce";
  bufferAtr: number;
  /** e.g. "handle low 142.10 - 0.1 ATR". */
  reason: string;
}

export type SignalDetails = Record<string, number | string | boolean | null>;

export interface EntrySignal {
  order: EntryOrder;
  stop: LogicalStop;
  details: SignalDetails;
}

export interface EntrySetup<P = any> {
  id: string;
  label: string;
  kind: "entry";
  source: "kell" | "library";
  /** Kell sub-stages the setup belongs to (checked as `stage_fit`); null = any. */
  allowedStages: SubStage[] | null;
  counterTrend?: boolean;
  defaults: P;
  detect(ctx: SetupContext, p: P): EntrySignal | null;
}

/** Exit, trim and avoid signals: they act on held positions or block new entries; they never open trades. */
export interface SignalSetup<P = any> {
  id: string;
  label: string;
  kind: "exit" | "trim" | "avoid";
  source: "kell" | "library";
  allowedStages: SubStage[] | null;
  defaults: P;
  detect(ctx: SetupContext, p: P): SignalDetails | null;
}

export type AnySetup = EntrySetup | SignalSetup;
