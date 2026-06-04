/**
 * Compute daily MAs from close prices (newest bar first).
 * Matches calculateTickerMAs.ts / ticker_ma nightly script for consistency.
 */

export interface TickerMaLevels {
  ema10d: number | null;
  ema20d: number | null;
  sma20d: number | null;
  sma50d: number | null;
  sma200d: number | null;
}

/** SMA over the newest `period` closes (closes[0] = most recent). */
function smaNewestFirst(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const sum = closes.slice(0, period).reduce((a, b) => a + b, 0);
  return sum / period;
}

/** EMA seeded from oldest `period` bars in the newest-first array, iterated toward index 0. */
function emaNewestFirst(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let ema = closes.slice(closes.length - period).reduce((a, b) => a + b, 0) / period;
  for (let i = closes.length - period - 1; i >= 0; i--) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

export const MIN_BARS_FOR_SESSION_MA = 50;

/**
 * @param closesNewestFirst - Daily closes, index 0 = today / most recent session bar
 */
export function computeTickerMasFromClosesNewestFirst(
  closesNewestFirst: number[]
): TickerMaLevels | null {
  if (closesNewestFirst.length < MIN_BARS_FOR_SESSION_MA) return null;

  const ema10 = emaNewestFirst(closesNewestFirst, 10);
  const ema20 = emaNewestFirst(closesNewestFirst, 20);
  const sma20 = smaNewestFirst(closesNewestFirst, 20);
  const sma50 = smaNewestFirst(closesNewestFirst, 50);
  const sma200 =
    closesNewestFirst.length >= 200 ? smaNewestFirst(closesNewestFirst, 200) : null;

  return {
    ema10d: ema10,
    ema20d: ema20,
    sma20d: sma20,
    sma50d: sma50,
    sma200d: sma200,
  };
}
