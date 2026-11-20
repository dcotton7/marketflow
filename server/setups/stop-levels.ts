/**
 * Logical stop levels under a hit's close (Don, 20 Nov 2026: "We ONLY take a trade where a logical level can
 * trigger the stop", within 5% of the price, "the lower the better"). Levels and distances only.
 *
 * His order: 50-day average, 20-day average, low of day, previous day's low, 5-day average, 10-day average, and
 * the tightest, VWAP. For each level that sits below the close: the level and its distance from the close in
 * percent (3.1 = 3.1%). `first` = the first level in his order within 5% of the close, or null; then
 * noStopInside5 = true. Averages are simple averages of closes including the hit day. VWAP is the day's VWAP from
 * MarketFlow's Alpaca daily bar (historical_bars keeps none); null when it was not available.
 */
import { smaAt, type DBar } from "./daily-math";

export const STOP_ORDER = ["sma50", "sma20", "lowOfDay", "prevDayLow", "sma5", "sma10", "vwap"] as const;
export type StopKey = (typeof STOP_ORDER)[number];
export const MAX_STOP_PCT = 5;

export interface StopLevels {
  levels: Record<StopKey, { level: number; distPct: number } | null>;
  first: StopKey | null;
  firstDistPct: number | null;
  noStopInside5: boolean;
}

export function stopLevels(b: DBar[], i: number, vwap: number | null): StopLevels {
  const close = b[i].close;
  const raw: Record<StopKey, number> = {
    sma50: smaAt(b, i, 50),
    sma20: smaAt(b, i, 20),
    lowOfDay: b[i].low,
    prevDayLow: i > 0 ? b[i - 1].low : NaN,
    sma5: smaAt(b, i, 5),
    sma10: smaAt(b, i, 10),
    vwap: vwap ?? NaN,
  };
  const levels = {} as StopLevels["levels"];
  for (const k of STOP_ORDER) {
    const v = raw[k];
    levels[k] = Number.isFinite(v) && v < close ? { level: v, distPct: ((close - v) / close) * 100 } : null;
  }
  const first = STOP_ORDER.find((k) => levels[k] !== null && levels[k]!.distPct <= MAX_STOP_PCT) ?? null;
  return { levels, first, firstDistPct: first ? levels[first]!.distPct : null, noStopInside5: first === null };
}
