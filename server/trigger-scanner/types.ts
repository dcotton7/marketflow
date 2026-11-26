/** Shared shapes for the trigger scanner. Bars are oldest first. Times are ISO strings (UTC). */

export type Side = "long" | "short";

/** One regular-session 5-minute bar. `t` is the bar's START (Alpaca's convention); it closes at t + 5 minutes. */
export interface Bar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface DailyBar {
  date: string; // YYYY-MM-DD, ET session
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type GapState = "open" | "filled_held" | "failed";

/**
 * A daily gap edge, classified by what price did after it (Don, 26 Nov): a gap that was filled and held is support
 * (green), one that was tested and failed is resistance (red), and a broken level flips its role.
 */
export interface GapLevel {
  date: string; // the gap session
  dir: "up" | "down";
  edge: number; // gap up: the previous session's high; gap down: the previous session's low
  far: number; // gap up: the gap session's low; gap down: the gap session's high
  state: GapState;
  role: "support" | "resistance";
}

/** What the scanner knows about a symbol from its finished daily bars (loaded once a day). */
export interface DailyContext {
  symbol: string;
  asOf: string; // date of the newest finished session used
  prevClose: number;
  prevHigh: number;
  prevLow: number;
  sma5: number | null;
  sma10: number | null;
  sma20: number | null;
  sma50: number | null;
  ema10: number | null;
  ema20: number | null;
  /** 20-day average daily range, % of price ((high/low - 1) x 100), and in dollars at the last close. */
  adrPct: number;
  adr: number;
  avgVol20: number;
  dollarVol20: number;
  close5dAgo: number | null;
  gaps: GapLevel[];
  capSize: string | null;
  sector: string | null;
  /** The ET session date of the next report, when the earnings calendar has one within the horizon. */
  nextEarnings: string | null;
  earningsKnown: boolean;
}

export type LevelName =
  | "sma5" | "sma10" | "sma20" | "sma50" | "ema10" | "ema20"
  | "prev_low" | "prev_high" | "gap" | "vwap" | "range_low" | "range_high" | "low_of_day" | "high_of_day";

export interface Level {
  name: LevelName;
  price: number;
  /** For gaps: its classification. */
  gap?: { date: string; dir: "up" | "down"; state: GapState; role: "support" | "resistance" };
}

/** A trigger firing on a bar close, before the stop rule and the grade. */
export interface TriggerHit {
  setupKey: string;
  side: Side;
  /** Which level / variant fired, part of the dedupe key ("sma20", "range_high", the hit date, ...). */
  variant: string;
  why: string;
  facts: Record<string, number | string | null>;
}

export interface StopPick {
  ok: boolean;
  refused?: "no_level_inside_max" | "no_level";
  level?: Level;
  stop?: number;
  riskPct?: number;
  riskAdr?: number;
  /** Other levels within companyAdr of the stop level. */
  company: LevelName[];
  /** Levels on the right side that were looked at, nearest first (for the reader and the refusal reason). */
  considered: { name: LevelName; price: number; distPct: number; skipped?: "too_close" | "wrong_role" | "too_far" }[];
}

export interface GradeComponents {
  risk: number;
  exitLogic: number;
  setup: number;
  regime: number;
  rotation: number;
  liquidity: number;
  earnings: number;
  notes: string[];
}

export interface Rotation {
  asOf: string | null;
  leadingSize: string[]; // e.g. ["MID", "SMALL"]
  leadingSectors: string[]; // sector ETF symbols, top 3
  size: Record<string, { todayVsSpy: number | null; d5VsSpy: number | null }>;
  sectors: Record<string, { todayVsSpy: number | null; d5VsSpy: number | null }>;
}

export interface Regime {
  label: "AGGRESSIVE" | "NEUTRAL" | "DEFENSIVE" | null;
  score: number | null;
  asOf: string | null;
}

/** A graded candidate, as stored and served. */
export interface Candidate {
  marketDate: string;
  symbol: string;
  side: Side;
  setupKey: string;
  setupOwner: string; // "builtin" or "user:<id>"
  ownerUserId: number | null;
  variant: string;
  why: string;
  triggerAt: string; // the trigger bar's close time
  bar: Bar;
  entryRef: number;
  stopLevel: LevelName;
  stopLevelPrice: number;
  stopPrice: number;
  stopGap: Level["gap"] | null;
  riskPct: number;
  riskAdr: number;
  adrPct: number;
  levels: { name: LevelName; price: number; role: "support" | "resistance" }[];
  relVolume: number | null;
  liquidity: { price: number; avgVol20: number; dollarVol20: number; asOf: string };
  regime: Regime;
  capSize: string | null;
  sector: string | null;
  groupLeading: boolean;
  /** The rotation read at the trigger, compact (the full per-ETF read is in the status). */
  rotation: Pick<Rotation, "asOf" | "leadingSize" | "leadingSectors">;
  grade: "A" | "B" | "C";
  gradePoints: number;
  gradeComponents: GradeComponents;
  dataAsOf: { bars: string; daily: string; regime: string | null; rotation: string | null; earnings: string | null };
  facts: Record<string, number | string | null>;
  dedupeKey: string;
  ruleVersion: string;
}
