import type { SymbolFacts } from "../facts";
import { swingsAsOf } from "../facts";
import type { LogicalStop } from "./types";

export function num(v: number | null | undefined): number | null {
  return v == null || !Number.isFinite(v) ? null : v;
}

export function maxHigh(f: SymbolFacts, from: number, to: number): { value: number; index: number } {
  let value = -Infinity;
  let index = -1;
  for (let k = Math.max(0, from); k <= to; k++) {
    if (f.bars[k].high > value) {
      value = f.bars[k].high;
      index = k;
    }
  }
  return { value, index };
}

export function minLow(f: SymbolFacts, from: number, to: number): { value: number; index: number } {
  let value = Infinity;
  let index = -1;
  for (let k = Math.max(0, from); k <= to; k++) {
    if (f.bars[k].low < value) {
      value = f.bars[k].low;
      index = k;
    }
  }
  return { value, index };
}

export function meanVolume(f: SymbolFacts, from: number, to: number): number {
  let s = 0;
  let n = 0;
  for (let k = Math.max(0, from); k <= to; k++) {
    s += f.bars[k].volume;
    n++;
  }
  return n ? s / n : 0;
}

export function stopBelow(level: number, atr: number, bufferAtr: number, basis: LogicalStop["basis"], label: string): LogicalStop {
  return {
    price: level - bufferAtr * atr,
    level,
    basis,
    bufferAtr,
    reason: `${label} ${level.toFixed(2)} - ${bufferAtr} ATR`,
  };
}

export function round(v: number | null, dp = 4): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  const m = 10 ** dp;
  return Math.round(v * m) / m;
}

export interface Wedge {
  start: number;
  end: number;
  /** Upper (falling wedge) or lower (rising wedge) line value projected to index `at`. */
  lineAt: number;
  low: number;
  high: number;
  highSlope: number;
  lowSlope: number;
}

function lineSlope(f: SymbolFacts, idx: number[], pick: "high" | "low"): number {
  const a = idx[0];
  const b = idx[idx.length - 1];
  return (f.bars[b][pick] - f.bars[a][pick]) / (b - a);
}

function halvesSlope(f: SymbolFacts, start: number, end: number, pick: "high" | "low"): number {
  const mid = Math.floor((start + end) / 2);
  const a = pick === "low" ? minLow(f, start, mid) : maxHigh(f, start, mid);
  const b = pick === "low" ? minLow(f, mid + 1, end) : maxHigh(f, mid + 1, end);
  return (b.value - a.value) / Math.max(1, b.index - a.index);
}

function rangeOf(f: SymbolFacts, from: number, to: number): number {
  return maxHigh(f, from, to).value - minLow(f, from, to).value;
}

/**
 * Falling (`dir` = "falling") or rising wedge over `minLen`..`maxLen` sessions ending at `end`, using pivots confirmed
 * by `asOf`. Falling: at least 2 lower swing highs, lows flatter than highs, last 5-session range at most
 * `contraction` × the first 5-session range. Rising: at least 2 higher swing highs, lows rising faster than highs.
 * Returns the longest wedge found.
 */
export function findWedge(
  f: SymbolFacts,
  end: number,
  asOf: number,
  at: number,
  dir: "falling" | "rising",
  minLen: number,
  maxLen: number,
  contraction: number,
): Wedge | null {
  for (let len = maxLen; len >= minLen; len--) {
    const start = end - len + 1;
    if (start < 2) continue;
    const highs = swingsAsOf(f.swingHighs, asOf, start).filter((j) => j <= end);
    if (highs.length < 2) continue;
    const lastTwo = highs.slice(-2);
    const hA = f.bars[lastTwo[0]].high;
    const hB = f.bars[lastTwo[1]].high;
    if (dir === "falling" ? !(hB < hA) : !(hB > hA)) continue;
    const highSlope = lineSlope(f, highs, "high");
    const lows = swingsAsOf(f.swingLows, asOf, start).filter((j) => j <= end);
    const lowSlope = lows.length >= 2 ? lineSlope(f, lows, "low") : halvesSlope(f, start, end, "low");
    if (dir === "falling" && !(highSlope < 0 && lowSlope > highSlope)) continue;
    if (dir === "rising" && !(highSlope > 0 && lowSlope > highSlope)) continue;
    if (rangeOf(f, end - 4, end) > contraction * rangeOf(f, start, start + 4)) continue;
    const lastH = highs[highs.length - 1];
    let lineAt: number;
    if (dir === "falling") lineAt = f.bars[lastH].high + highSlope * (at - lastH);
    else {
      const anchor = lows.length ? lows[lows.length - 1] : minLow(f, Math.floor((start + end) / 2), end).index;
      lineAt = f.bars[anchor].low + lowSlope * (at - anchor);
    }
    return { start, end, lineAt, low: minLow(f, start, end).value, high: maxHigh(f, start, end).value, highSlope, lowSlope };
  }
  return null;
}
