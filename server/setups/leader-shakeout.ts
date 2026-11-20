/**
 * Leader Shakeout (research/bounce/03-scan-definitions.md, scan S1, with Don's liquidity floor of 20 Nov 2026).
 *
 * On the drop day ("today", index i), using bars before today for every baseline:
 *   close >= $6 and 20-day average dollar volume (prior 20 sessions) >= $30M        (the file says $5 / $20M)
 *   prev_close - close >= 2 x ATR14_prev  and  close / prev_close - 1 <= -4%
 *   volume >= 2 x the prior 20-day average volume
 *   Run20 = close yesterday / close 21 sessions ago - 1 > 10%
 *   Wilder RSI(2) on closes, including today, < 5
 * Variant flags on the same row: liquid = 20-day average dollar volume >= $100M (S1-L);
 * gapped = (open - prev_close) <= -1 x ATR14_prev (S1-G).
 */
import { atrPrev, run20, rsi2Series, trueRanges, volumePrev, type DBar } from "./daily-math";

// The rule is S1 at Don's floor; "-g1" = rows carry the A/B/C grade and the stop levels (Don, 20 Nov). Rows
// written under the first version stay as they were, beside these.
export const RULE_VERSION = "S1-2026-11-20-g1";
export const LS = {
  minPrice: 6,
  minDollarVol: 30e6,
  minDropAtr: 2,
  maxRet: -0.04,
  minRelVol: 2,
  minRun20: 0.1,
  maxRsi2: 5,
  liquidDollarVol: 100e6,
  gapAtr: -1,
} as const;

/** Bars needed before the drop day: 21 for Run20 (and the 20-day volume window, the 14-day ATR). */
export const LOOKBACK = 21;

export type Condition = "price" | "dollarVol" | "dropAtr" | "dropPct" | "relVol" | "run20" | "rsi2";

export interface ShakeoutNumbers {
  date: string;
  close: number;
  prevClose: number;
  open: number;
  volume: number;
  ret: number; // close / prev_close - 1 (negative on a drop)
  dropAtr: number; // (prev_close - close) / ATR14_prev
  atr14Prev: number;
  relVol: number; // volume / prior 20-day average volume
  avgVol20Prev: number;
  run20: number;
  rsi2: number;
  dollarVol20Prev: number;
  gapAtr: number; // (open - prev_close) / ATR14_prev
  liquid: boolean;
  gapped: boolean;
}

export interface ShakeoutResult extends ShakeoutNumbers {
  hit: boolean;
  failed: Condition[];
}

/** Indicator series for one symbol, computed once and reused for every day (the backfill walks all of them). */
export function prepare(b: DBar[]) {
  return { b, tr: trueRanges(b), rsi2: rsi2Series(b) };
}

export function evaluateAt(
  p: ReturnType<typeof prepare>,
  i: number,
  grades: { liquidDollarVol: number; gapAtr: number } = { liquidDollarVol: LS.liquidDollarVol, gapAtr: -LS.gapAtr },
): ShakeoutResult | null {
  const { b, tr, rsi2 } = p;
  if (i < LOOKBACK || i >= b.length) return null;
  const t = b[i], prev = b[i - 1].close;
  const atr = atrPrev(tr, i);
  const { avgVol, dollarVol } = volumePrev(b, i);
  if (!(atr > 0) || !(avgVol > 0) || !(prev > 0)) return null;
  const n: ShakeoutNumbers = {
    date: t.date,
    close: t.close,
    prevClose: prev,
    open: t.open,
    volume: t.volume,
    ret: t.close / prev - 1,
    dropAtr: (prev - t.close) / atr,
    atr14Prev: atr,
    relVol: t.volume / avgVol,
    avgVol20Prev: avgVol,
    run20: run20(b, i),
    rsi2: rsi2[i],
    dollarVol20Prev: dollarVol,
    gapAtr: (t.open - prev) / atr,
    liquid: dollarVol >= grades.liquidDollarVol,
    gapped: (t.open - prev) <= -grades.gapAtr * atr,
  };
  const failed: Condition[] = [];
  if (!(n.close >= LS.minPrice)) failed.push("price");
  if (!(n.dollarVol20Prev >= LS.minDollarVol)) failed.push("dollarVol");
  if (!(n.dropAtr >= LS.minDropAtr)) failed.push("dropAtr");
  if (!(n.ret <= LS.maxRet)) failed.push("dropPct");
  if (!(n.relVol >= LS.minRelVol)) failed.push("relVol");
  if (!(n.run20 > LS.minRun20)) failed.push("run20");
  if (!(n.rsi2 < LS.maxRsi2)) failed.push("rsi2");
  return { ...n, hit: failed.length === 0, failed };
}

/** The verdict for the last bar of a series (the daily job's case). */
export function evaluateLast(b: DBar[]): ShakeoutResult | null {
  return evaluateAt(prepare(b), b.length - 1);
}
