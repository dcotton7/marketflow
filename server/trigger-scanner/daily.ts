/**
 * Daily context and the gap rule, from finished daily bars (oldest first, today's session NOT included).
 *
 * Averages: simple averages of closes and EMAs seeded with the simple average of the first `n` closes, all through
 * the last finished session (so today's levels are fixed all day). ADR: the 20-session average of (high/low - 1).
 *
 * Gaps (Don, 26 Nov: "Filled (green) is support tested and failed (red) is resistance"; "support becomes resistance
 * and vice versa"), over the last `lookback` sessions:
 *   gap up at session k:   low[k] > high[k-1]. edge = high[k-1] (the gap's lower edge), far = low[k].
 *     failed       a later session CLOSED below the edge          -> resistance (broken support flips)
 *     filled_held  a later session traded into the gap (low <= far) and none closed below the edge -> support
 *     open         never revisited                                 -> support
 *   gap down mirrors it: edge = low[k-1] (the upper edge), far = high[k]; failed = a later close above the edge ->
 *   support; filled_held / open -> resistance.
 */
import { smaAt } from "../setups/daily-math";
import { precomputeGapGo, type PriorFire } from "./gap";
import { DEFAULTS, type ScannerSettings } from "./settings";
import { dailyTrend } from "./trend";
import type { DailyBar, DailyContext, GapLevel } from "./types";


function ema(closes: number[], n: number): number | null {
  if (closes.length < n) return null;
  const k = 2 / (n + 1);
  let e = 0;
  for (let i = 0; i < n; i++) e += closes[i];
  e /= n;
  for (let i = n; i < closes.length; i++) e = closes[i] * k + e * (1 - k);
  return e;
}

export function classifyGaps(b: DailyBar[], lookback = 60): GapLevel[] {
  const out: GapLevel[] = [];
  const start = Math.max(1, b.length - lookback);
  for (let k = start; k < b.length; k++) {
    const prev = b[k - 1], day = b[k];
    if (day.low > prev.high) {
      const edge = prev.high, far = day.low;
      let entered = false, failed = false;
      for (let j = k + 1; j < b.length; j++) {
        if (b[j].close < edge) { failed = true; break; }
        if (b[j].low <= far) entered = true;
      }
      out.push({ date: day.date, dir: "up", edge, far, state: failed ? "failed" : entered ? "filled_held" : "open", role: failed ? "resistance" : "support" });
    } else if (day.high < prev.low) {
      const edge = prev.low, far = day.high;
      let entered = false, failed = false;
      for (let j = k + 1; j < b.length; j++) {
        if (b[j].close > edge) { failed = true; break; }
        if (b[j].high >= far) entered = true;
      }
      out.push({ date: day.date, dir: "down", edge, far, state: failed ? "failed" : entered ? "filled_held" : "open", role: failed ? "support" : "resistance" });
    }
  }
  return out;
}

export interface ContextExtras {
  capSize?: string | null;
  sector?: string | null;
  nextEarnings?: string | null;
  earningsKnown?: boolean;
  /** Earnings reaction sessions of this name (recent), or null when the calendar is not fresh. */
  earningsReactions?: string[] | null;
  /** Today's date, to say whether today is a reaction session (a day-0 gap's earnings fact). */
  today?: string;
  /** Earlier gap-and-go fires of this name (the repeat rule). */
  gapFires?: PriorFire[];
}

/** null when there are too few bars (21) to know the ADR and the 20-day volume. */
export function buildDailyContext(symbol: string, bars: DailyBar[], extras: ContextExtras = {}, gapLookback = 60, settings: ScannerSettings = DEFAULTS): DailyContext | null {
  const b = bars.filter((x) => x.high > 0 && x.low > 0 && x.close > 0);
  if (b.length < 21) return null;
  const closes = b.map((x) => x.close);
  // the setups' own SMA (server/setups/daily-math.ts smaAt: simple average of closes through the bar)
  const sma = (n: number) => { const v = smaAt(b, b.length - 1, n); return Number.isFinite(v) ? v : null; };
  const last = b[b.length - 1];
  const w = b.slice(-20);
  const adrPct = (w.reduce((s, x) => s + (x.high / x.low - 1), 0) / w.length) * 100;
  const avgVol20 = w.reduce((s, x) => s + x.volume, 0) / w.length;
  const dollarVol20 = w.reduce((s, x) => s + x.volume * x.close, 0) / w.length;
  const w50 = b.slice(-50);
  const avgVol50 = w50.reduce((s, x) => s + x.volume, 0) / w50.length;
  const adr = (adrPct / 100) * last.close;
  const reactions = extras.earningsReactions === undefined ? null : extras.earningsReactions;
  return {
    symbol: symbol.toUpperCase(),
    asOf: last.date,
    prevClose: last.close,
    prevHigh: last.high,
    prevLow: last.low,
    sma5: sma(5),
    sma10: sma(10),
    sma20: sma(20),
    sma50: sma(50),
    ema10: ema(closes, 10),
    ema20: ema(closes, 20),
    adrPct,
    adr,
    avgVol20,
    avgVol50,
    gapGo: precomputeGapGo(b, settings, { adrNow: adr, fires: extras.gapFires ?? [], earningsReactions: reactions }),
    earningsToday: reactions === null || !extras.today ? "unknown" : reactions.includes(extras.today),
    dollarVol20,
    close5dAgo: b.length >= 6 ? b[b.length - 6].close : null,
    gaps: classifyGaps(b, gapLookback),
    capSize: extras.capSize ?? null,
    sector: extras.sector ?? null,
    nextEarnings: extras.nextEarnings ?? null,
    earningsKnown: !!extras.earningsKnown,
    trend: dailyTrend(b, adr, settings),
  };
}

/** Floor: price and 20-day dollar volume. Returns the reason when the name is out. */
export function floorReason(ctx: DailyContext, s: { minPrice: number; minDollarVol: number }): string | null {
  if (!(ctx.prevClose >= s.minPrice)) return "price";
  if (!(ctx.dollarVol20 >= s.minDollarVol)) return "dollar_volume";
  return null;
}
