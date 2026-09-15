import { getEtClock } from "./usEquityMarketSession";

export type IntradayOhlcvBar = {
  date: string | Date;
  high: number;
  low: number;
  volume: number;
};

/**
 * Some feeds occasionally append a session-to-date aggregate as though it were
 * one intraday interval. It is identifiable because its H/L equal the entire
 * session and its volume repeats the sum of all preceding bars.
 */
export function removeInjectedSessionAggregateBars<T extends IntradayOhlcvBar>(
  bars: readonly T[]
): T[] {
  const accepted: T[] = [];
  const dayStats = new Map<
    string,
    { count: number; high: number; low: number; volume: number }
  >();

  for (const bar of bars) {
    const date = bar.date instanceof Date ? bar.date : new Date(bar.date);
    if (Number.isNaN(date.getTime())) {
      accepted.push(bar);
      continue;
    }

    const dayKey = getEtClock(date).dateKey;
    const prior = dayStats.get(dayKey);
    const priceTolerance = Math.max(0.0001, Math.abs(bar.high) * 0.000001);
    const repeatsSessionRange =
      !!prior &&
      Math.abs(bar.high - prior.high) <= priceTolerance &&
      Math.abs(bar.low - prior.low) <= priceTolerance;
    const volumeRatio =
      prior && prior.volume > 0 ? bar.volume / prior.volume : Number.NaN;
    const repeatsCumulativeVolume =
      Number.isFinite(volumeRatio) && volumeRatio >= 0.98 && volumeRatio <= 1.02;

    if (prior && prior.count >= 10 && repeatsSessionRange && repeatsCumulativeVolume) {
      continue;
    }

    accepted.push(bar);
    if (!prior) {
      dayStats.set(dayKey, {
        count: 1,
        high: bar.high,
        low: bar.low,
        volume: Math.max(0, bar.volume),
      });
    } else {
      prior.count += 1;
      prior.high = Math.max(prior.high, bar.high);
      prior.low = Math.min(prior.low, bar.low);
      prior.volume += Math.max(0, bar.volume);
    }
  }

  return accepted;
}
