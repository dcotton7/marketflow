/**
 * Daily-bar arithmetic shared by the research-backed setups (Leader Shakeout, earnings gap up, the market card).
 * Every function is the definition used in the research branch (research/bounce/build_events.cjs and
 * research/harness/harness.cjs), ported line for line; a value at index i uses bars 0..i only.
 *
 * Bars are oldest first.
 */

export interface DBar {
  date: string; // YYYY-MM-DD (ET session)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** True range; the first bar has no prior close, so it is high - low (as in the research). */
export function trueRanges(b: DBar[]): number[] {
  return b.map((x, i) =>
    i ? Math.max(x.high - x.low, Math.abs(x.high - b[i - 1].close), Math.abs(x.low - b[i - 1].close)) : x.high - x.low,
  );
}

/**
 * Wilder RSI with period 2 on closes, including today, started from the first bar with zero averages (the research's
 * seed). With period 2 the seed has decayed by 2^-n after n bars, so any series of 20+ bars gives the research value.
 */
export function rsi2Series(b: DBar[]): number[] {
  const out = new Array<number>(b.length);
  let up = 0, dn = 0;
  for (let i = 0; i < b.length; i++) {
    if (i) {
      const ch = b[i].close - b[i - 1].close;
      up = (up + Math.max(ch, 0)) / 2;
      dn = (dn + Math.max(-ch, 0)) / 2;
    }
    out[i] = dn === 0 ? 100 : 100 - 100 / (1 + up / dn);
  }
  return out;
}

/** Wilder RSI for any period (seeded with the simple average of the first `period` changes). Used by the scanner. */
export function wilderRsi(closes: number[], period: number): number | null {
  if (closes.length < period + 1) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= period; i++) {
    const ch = closes[i] - closes[i - 1];
    if (ch > 0) g += ch; else l -= ch;
  }
  g /= period; l /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    g = (g * (period - 1) + Math.max(ch, 0)) / period;
    l = (l * (period - 1) + Math.max(-ch, 0)) / period;
  }
  if (l === 0) return 100;
  return 100 - 100 / (1 + g / l);
}

/** Average true range of the 14 sessions BEFORE i (i-14..i-1), so the day itself does not dilute its baseline. */
export function atrPrev(tr: number[], i: number, n = 14): number {
  if (i < n) return NaN;
  let s = 0;
  for (let j = i - n; j < i; j++) s += tr[j];
  return s / n;
}

/** Average share volume and average dollar volume (close x volume) of the 20 sessions before i. */
export function volumePrev(b: DBar[], i: number, n = 20): { avgVol: number; dollarVol: number } {
  if (i < n) return { avgVol: NaN, dollarVol: NaN };
  let v = 0, d = 0;
  for (let j = i - n; j < i; j++) { v += b[j].volume; d += b[j].volume * b[j].close; }
  return { avgVol: v / n, dollarVol: d / n };
}

/** Run20 = close yesterday / close 21 sessions ago - 1 (the 20 sessions before today). */
export function run20(b: DBar[], i: number): number {
  if (i < 21) return NaN;
  return b[i - 1].close / b[i - 21].close - 1;
}

export function smaAt(b: DBar[], i: number, n: number): number {
  if (i < n - 1) return NaN;
  let s = 0;
  for (let j = i - n + 1; j <= i; j++) s += b[j].close;
  return s / n;
}

/** Simple moving average of closes for every index (NaN before n-1). */
export function smaSeries(b: DBar[], n: number): number[] {
  const a = new Array<number>(b.length).fill(NaN);
  let s = 0;
  for (let i = 0; i < b.length; i++) {
    s += b[i].close;
    if (i >= n) s -= b[i - n].close;
    if (i >= n - 1) a[i] = s / n;
  }
  return a;
}

/**
 * True when bars[i-k..i] are exactly the k+1 market sessions ending on bars[i].date (no missing day in the stored
 * history). `sessionIndex` maps each session date to its position in the market calendar.
 */
export function contiguous(b: DBar[], i: number, k: number, sessionIndex: Map<string, number>): boolean {
  if (i < k) return false;
  const end = sessionIndex.get(b[i].date);
  const start = sessionIndex.get(b[i - k].date);
  return end !== undefined && start !== undefined && end - start === k;
}

const SPLIT_RATIOS = [1.5, 2, 3, 4, 5, 6, 7, 8, 10, 15, 20, 25, 30, 40, 50];

/**
 * A stored history cliff from a split that came after the older bars were saved (the bars are split-adjusted when
 * fetched, then kept). The open sits within 1.5% of prev_close / k and the close within 10% of it for a common split
 * ratio k. Data guard only, not part of any research rule.
 */
export function looksLikeSplit(prevClose: number, open: number, close: number): boolean {
  if (!(prevClose > 0)) return false;
  return SPLIT_RATIOS.some((k) => Math.abs((open / prevClose) * k - 1) < 0.015 && Math.abs((close / prevClose) * k - 1) < 0.1);
}

/** The ETFs the research kept out of stock events and breadth. */
export const RESEARCH_ETFS = new Set([
  "SPY", "QQQ", "IWM", "DIA", "RSP", "VIXY", "XLK", "XLF", "XLE", "XLV", "XLI", "XLY", "XLP", "XLU", "XLB", "XLRE",
  "XLC", "SMH", "ARKK", "IWO", "HYG", "TLT",
]);
