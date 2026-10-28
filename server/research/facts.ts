import { calculateAtr, calculateEMA, calculateSMA, EXTENSION_ATR_PERIOD } from "@shared/chart-indicators";
import type { DailyBar } from "./types";

/**
 * Layer A facts for one symbol as series over its daily bars (oldest first). Every value at index i uses bars 0..i
 * only, so a backtest reading index i sees exactly what was known at that close; the lookahead test enforces this.
 * SMA, EMA and ATR(14) come from the shared chart module, so research numbers match the charts and alerts.
 * ATR there is a simple average of true range (not Wilder).
 */

export type Series = (number | null)[];

export interface SymbolFacts {
  bars: DailyBar[];
  dates: string[];
  sma5: Series;
  sma10: Series;
  sma20: Series;
  sma50: Series;
  sma150: Series;
  sma200: Series;
  ema10: Series;
  ema20: Series;
  atr14: Series;
  atr5: Series;
  atr50: Series;
  rsi14: Series;
  macd: Series;
  macdSignal: Series;
  macdHist: Series;
  /** Average volume of the 50 sessions before this one. */
  avgVol50: Series;
  relVol: Series;
  /** 20-session average of close × volume, including this session. */
  dollarVol20: Series;
  high52: Series;
  distFrom52High: Series;
  ret63: Series;
  ret126: Series;
  /** Don's extension, the chart's ATRx: (close − SMA) ÷ ATR(14); extSma50 equals the shared atrxFrom50. */
  extSma5: Series;
  extSma10: Series;
  extSma20: Series;
  extSma50: Series;
  /** Kell cycle extension: (close − EMA) ÷ ATR(14). */
  ext10: Series;
  ext20: Series;
  /** EMA change over 5 sessions ÷ ATR(14). */
  slope10: Series;
  slope20: Series;
  rsVsSpy63: Series;
  rsVsSpy126: Series;
  rsVsQqq63: Series;
  /** Stock ÷ SPY close ratio. */
  rsLine: Series;
  rsLineDistFrom52High: Series;
  /** Mansfield RS: (RS line ÷ its 252-session average − 1) × 100. */
  mansfield: Series;
  /** Universe-relative score used for the RS percentile (filled in by the engine across symbols). */
  rsScore: Series;
  /** Confirmed 5-bar swing pivots (2 bars each side): index j is usable from index j + 2. */
  swingHighs: number[];
  swingLows: number[];
}

export function rollingMax(values: number[], window: number): Series {
  const out: Series = new Array(values.length).fill(null);
  for (let i = window - 1; i < values.length; i++) {
    let m = -Infinity;
    for (let k = i - window + 1; k <= i; k++) m = Math.max(m, values[k]);
    out[i] = m;
  }
  return out;
}

export function rollingMeanPrior(values: number[], window: number): Series {
  const out: Series = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    if (i >= window) {
      out[i] = sum / window;
      sum -= values[i - window];
    }
    sum += values[i];
  }
  return out;
}

export function rollingMean(values: (number | null)[], window: number): Series {
  const out: Series = new Array(values.length).fill(null);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) {
      sum = 0;
      count = 0;
      continue;
    }
    sum += v;
    count++;
    if (count > window) {
      sum -= values[i - window] as number;
      count = window;
    }
    if (count === window) out[i] = sum / window;
  }
  return out;
}

export function emaOf(values: (number | null)[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let prev: number | null = null;
  let seed: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) continue;
    if (prev == null) {
      seed.push(v);
      if (seed.length === period) {
        prev = seed.reduce((a, b) => a + b, 0) / period;
        out[i] = prev;
        seed = [];
      }
      continue;
    }
    prev = (v - prev) * k + prev;
    out[i] = prev;
  }
  return out;
}

/** Wilder RSI. */
export function rsi(closes: number[], period = 14): Series {
  const out: Series = new Array(closes.length).fill(null);
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    const g = Math.max(ch, 0);
    const l = Math.max(-ch, 0);
    if (i <= period) {
      avgGain += g / period;
      avgLoss += l / period;
      if (i === period) out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
      continue;
    }
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export function findSwings(bars: DailyBar[]): { highs: number[]; lows: number[] } {
  const highs: number[] = [];
  const lows: number[] = [];
  for (let j = 2; j < bars.length - 2; j++) {
    const h = bars[j].high;
    const l = bars[j].low;
    if (h > bars[j - 1].high && h > bars[j - 2].high && h >= bars[j + 1].high && h >= bars[j + 2].high) highs.push(j);
    if (l < bars[j - 1].low && l < bars[j - 2].low && l <= bars[j + 1].low && l <= bars[j + 2].low) lows.push(j);
  }
  return { highs, lows };
}

/** Confirmed pivot indices as of bar i (pivot j needs bars j+1, j+2 to exist, so j <= i − 2). */
export function swingsAsOf(pivots: number[], i: number, since = 0): number[] {
  const out: number[] = [];
  for (const j of pivots) {
    if (j > i - 2) break;
    if (j >= since) out.push(j);
  }
  return out;
}

function pctReturn(closes: number[], i: number, n: number): number | null {
  return i >= n && closes[i - n] > 0 ? closes[i] / closes[i - n] - 1 : null;
}

export interface IndexCloses {
  spy: Map<string, number>;
  qqq: Map<string, number>;
}

export function computeFacts(bars: DailyBar[], index: IndexCloses): SymbolFacts {
  const n = bars.length;
  const closes = bars.map((b) => b.close);
  const vols = bars.map((b) => b.volume);
  const dates = bars.map((b) => b.date);
  const sma = (p: number) => calculateSMA(bars, p);
  const sma5 = sma(5);
  const sma10 = sma(10);
  const sma20 = sma(20);
  const sma50 = sma(50);
  const ema10 = calculateEMA(bars, 10);
  const ema20 = calculateEMA(bars, 20);
  const atr14 = calculateAtr(bars, 14);
  const atr5 = calculateAtr(bars, 5);
  const atr50 = calculateAtr(bars, 50);
  const ema12 = calculateEMA(bars, 12);
  const ema26 = calculateEMA(bars, 26);
  const macd: Series = closes.map((_, i) => (ema12[i] != null && ema26[i] != null ? (ema12[i] as number) - (ema26[i] as number) : null));
  const macdSignal = emaOf(macd, 9);
  const avgVol50 = rollingMeanPrior(vols, 50);
  const high52 = rollingMax(bars.map((b) => b.high), 252);

  const atrExt = calculateAtr(bars, EXTENSION_ATR_PERIOD);
  const extSma = (ma: Series): Series =>
    closes.map((c, i) => {
      const m = ma[i];
      const a = atrExt[i];
      return m != null && a != null && a > 0 ? (c - m) / a : null;
    });
  const extEma = (ma: Series): Series =>
    closes.map((c, i) => (ma[i] != null && atr14[i] ? (c - (ma[i] as number)) / (atr14[i] as number) : null));
  const slope = (ma: Series): Series =>
    closes.map((_, i) => (i >= 5 && ma[i] != null && ma[i - 5] != null && atr14[i] ? ((ma[i] as number) - (ma[i - 5] as number)) / (atr14[i] as number) : null));

  const spyAt = dates.map((d) => index.spy.get(d) ?? null);
  const qqqAt = dates.map((d) => index.qqq.get(d) ?? null);
  const idxRet = (arr: (number | null)[], i: number, k: number) =>
    i >= k && arr[i] != null && arr[i - k] != null && (arr[i - k] as number) > 0 ? (arr[i] as number) / (arr[i - k] as number) - 1 : null;
  const diff = (a: number | null, b: number | null) => (a != null && b != null ? a - b : null);
  const rsLine: Series = closes.map((c, i) => (spyAt[i] ? c / (spyAt[i] as number) : null));
  const rsHigh = rollingMax(rsLine.map((v) => v ?? -Infinity), 252);
  const rsAvg = rollingMean(rsLine, 252);
  const { highs, lows } = findSwings(bars);

  return {
    bars,
    dates,
    sma5,
    sma10,
    sma20,
    sma50,
    sma150: sma(150),
    sma200: sma(200),
    ema10,
    ema20,
    atr14,
    atr5,
    atr50,
    rsi14: rsi(closes, 14),
    macd,
    macdSignal,
    macdHist: macd.map((m, i) => (m != null && macdSignal[i] != null ? m - (macdSignal[i] as number) : null)),
    avgVol50,
    relVol: vols.map((v, i) => (avgVol50[i] ? v / (avgVol50[i] as number) : null)),
    dollarVol20: rollingMean(bars.map((b) => b.close * b.volume), 20),
    high52,
    distFrom52High: closes.map((c, i) => (high52[i] ? c / (high52[i] as number) - 1 : null)),
    ret63: closes.map((_, i) => pctReturn(closes, i, 63)),
    ret126: closes.map((_, i) => pctReturn(closes, i, 126)),
    extSma5: extSma(sma5),
    extSma10: extSma(sma10),
    extSma20: extSma(sma20),
    extSma50: extSma(sma50),
    ext10: extEma(ema10),
    ext20: extEma(ema20),
    slope10: slope(ema10),
    slope20: slope(ema20),
    rsVsSpy63: closes.map((_, i) => diff(pctReturn(closes, i, 63), idxRet(spyAt, i, 63))),
    rsVsSpy126: closes.map((_, i) => diff(pctReturn(closes, i, 126), idxRet(spyAt, i, 126))),
    rsVsQqq63: closes.map((_, i) => diff(pctReturn(closes, i, 63), idxRet(qqqAt, i, 63))),
    rsLine,
    rsLineDistFrom52High: rsLine.map((v, i) => (v != null && rsHigh[i] != null && Number.isFinite(rsHigh[i] as number) ? v / (rsHigh[i] as number) - 1 : null)),
    mansfield: rsLine.map((v, i) => (v != null && rsAvg[i] ? (v / (rsAvg[i] as number) - 1) * 100 : null)),
    rsScore: closes.map((_, i) => {
      const a = pctReturn(closes, i, 63);
      const b = pctReturn(closes, i, 126);
      return a != null && b != null ? 0.6 * a + 0.4 * b : null;
    }),
    swingHighs: highs,
    swingLows: lows,
  };
}
