/** Shared shapes for the trigger scanner. Bars are oldest first. Times are ISO strings (UTC). */
import type { CandidateTrend, TrendDaily } from "./trend";

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

/** A gap that can still GO (gap.ts): found on the finished daily bars, held since, within goMaxDays. */
export interface GapGo {
  dir: "up" | "down";
  date: string; // the gap session (day 0)
  day: number; // today's day number: sessions after the gap day, today included
  edge: number; // up: the prior session's high (or close, per gapFrom); down: the prior low (or close)
  gapPct: number; // open beyond the edge, %
  gapAdr: number; // open beyond the edge, in the ADR before the gap
  volMult: number; // gap-day volume / the 50-session average before it
  /** The post-gap consolidation pivot (null before consolMinDays sessions: then today's opening range or the gap-day high). */
  pivot: number | null;
  pivotKind: "consolidation" | "shelf" | "early";
  /** Up: the gap day's high; down: its low (the overhead the AI should see). */
  gapExtreme: number;
  /** Sessions after the gap day through yesterday: their low and high (null on day 1), count and range in ADR. */
  consLow: number | null;
  consHigh: number | null;
  consDays: number;
  consRangeAdr: number | null;
  /** From the best price since the gap back to the worst after it, through yesterday, in ADR. */
  pullbackAdr: number;
  /** The post-gap range is tight and every low held the upper half of the gap day's range (down: highs, lower half). */
  holdsUpperHalf: boolean;
  /** The base before the gap: sessions, its top (down: its bottom), and whether the gap opened beyond it. */
  baseDays: number;
  baseTop: number;
  gapClearedBase: boolean;
  earningsGap: boolean | "unknown";
  /** Earlier fires of this gap (from the store) and whether another is allowed today. */
  fires: number;
  firedPivot: boolean;
  firedGapHigh: boolean;
  repeatOk: boolean;
  repeatWhy: string | null;
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
  /** 50-session average volume (the gap-day volume test). */
  avgVol50: number;
  /** Gap and go state from the finished sessions (gap.ts), one per direction; null when no live gap. */
  gapGo: { up: GapGo | null; down: GapGo | null };
  /** Today is an earnings reaction session (for a day-0 gap); "unknown" when the calendar is not fresh. */
  earningsToday: boolean | "unknown";
  /** The ET session date of the next report, when the earnings calendar has one within the horizon. */
  nextEarnings: string | null;
  earningsKnown: boolean;
  /** Trend facts from the same bars (trend.ts), measured, never a filter; absent in hand-made contexts. */
  trend?: TrendDaily | null;
}

export type LevelName =
  | "sma5" | "sma10" | "sma20" | "sma50" | "ema10" | "ema20"
  | "prev_low" | "prev_high" | "gap" | "vwap" | "range_low" | "range_high" | "low_of_day" | "high_of_day"
  | "consolidation_low" | "consolidation_high";

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
  /** The levels this setup's stop may use (gap and go names its own set); all levels at the bar when absent. */
  stopLevels?: Level[];
  /** A stop at this level earns the "has company" grade point for the given reason (a tight flag's low). */
  companyIf?: { level: LevelName; reason: string };
  /** Another setup's hit on the same bar and side that this one replaces (noted in facts.also). */
  replaces?: string;
  /** The trigger saw its pattern but the bar failed a noise test (level hold: no real test): counted in the run row
   *  as `<setup>:<reason>`, never raised. */
  refused?: string;
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
  /** The weight of the level the trade is about (v3): heavy 2, intraday 1, light 0. Absent on rows before v3. */
  level?: number;
  /** The trigger bar's relative volume (v3): 0-2. Absent on rows before v3. */
  volume?: number;
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
  /** Trend facts at the trigger (trend.ts): measured, never a filter; null on rows stored before it existed. */
  trend?: CandidateTrend | null;
}
