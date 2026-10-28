import { atrMultipleFromMa, atrxFrom50, calculateAtr, calculateEMA } from "@shared/chart-indicators";

/**
 * Oliver Kell's Cycle of Price Action, as draft checks on daily bars (oldest first; the last bar is today's, live
 * during the session). EMA 10/20 throughout. Each check is named and takes its thresholds from KELL so the research
 * loop can score and tune them; every alert that cites one stores its name and numbers in position_alerts.payload.
 * During the session today's bar is still forming: a check that needs a close reports confirmed=false until then.
 */
export const KELL = {
  exhaustionExtension: { atrx50: 7, emaPeriod: 10, emaAtr: 3 },
  wedgeDrop: { lookback: 5, stallAtr: 0.5, aboveDaysBefore: 3 },
  emaCrossback: { risingDays: 5, touchAtr: 0.25, aboveDaysBefore: 3 },
  wedgePop: { lookback: 5, belowDays: 3, contraction: 0.8 },
  baseNBreak: { baseDays: 15, maxDepthPct: 15, maxDepthAtr: 5, volumeX: 1.5, volumeDays: 50 },
};
export type KellParams = typeof KELL;

export type KellSetupName = "exhaustion_extension" | "wedge_drop" | "ema_crossback" | "wedge_pop" | "base_n_break";
export type KellStage = KellSetupName | "uptrend" | "pullback" | "below_emas" | "downtrend" | "unknown";

export interface KellBar {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface KellHit {
  name: KellSetupName;
  confirmed: boolean;
  detail: Record<string, number | string>;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function series(bars: KellBar[]) {
  return { e10: calculateEMA(bars, 10), e20: calculateEMA(bars, 20), atr: calculateAtr(bars, 14) };
}

export function exhaustionExtension(bars: KellBar[], price: number, p = KELL.exhaustionExtension): KellHit | null {
  const x50 = atrxFrom50(price, bars);
  const xEma = atrMultipleFromMa(price, bars, p.emaPeriod, "ema");
  if (x50 == null || xEma == null || x50 < p.atrx50 || xEma < p.emaAtr) return null;
  return { name: "exhaustion_extension", confirmed: true, detail: { atrx50: r2(x50), atrOverEma10: r2(xEma) } };
}

/** Highs stalled over `lookback` days while lows held or rose (rising wedge), the stock was above the 20 EMA on one of
 *  the `aboveDaysBefore` days before today, and today is below both the 10 and 20 EMA. */
export function wedgeDrop(bars: KellBar[], confirmed: boolean, p = KELL.wedgeDrop): KellHit | null {
  const n = bars.length;
  if (n < Math.max(30, p.lookback * 2 + 2)) return null;
  const { e10, e20, atr } = series(bars);
  const a = atr[n - 2], t10 = e10[n - 1], t20 = e20[n - 1];
  if (t10 == null || t20 == null || a == null || a <= 0) return null;
  const close = bars[n - 1].close;
  if (!(close < t10 && close < t20)) return null;
  const wasAbove = bars.slice(n - 1 - p.aboveDaysBefore, n - 1).some((b, i) => {
    const e = e20[n - 1 - p.aboveDaysBefore + i];
    return e != null && b.close > e;
  });
  if (!wasAbove) return null;
  const recent = bars.slice(n - 1 - p.lookback, n - 1);
  const prior = bars.slice(n - 1 - 2 * p.lookback, n - 1 - p.lookback);
  const highGain = Math.max(...recent.map((b) => b.high)) - Math.max(...prior.map((b) => b.high));
  const lowsHold = Math.min(...recent.map((b) => b.low)) >= Math.min(...prior.map((b) => b.low));
  if (!(highGain <= p.stallAtr * a && lowsHold)) return null;
  return { name: "wedge_drop", confirmed, detail: { ema10: r2(t10), ema20: r2(t20), highGainAtr: r2(highGain / a) } };
}

/** Pullback to a rising 10 or 20 EMA: today's low reached the EMA (within touchAtr above it, or under it), today closed
 *  back above it and above its open, and the stock closed above the 20 EMA on each of the days before. */
export function emaCrossback(bars: KellBar[], confirmed: boolean, p = KELL.emaCrossback): KellHit | null {
  const n = bars.length;
  if (n < 30) return null;
  const { e10, e20, atr } = series(bars);
  const a = atr[n - 2];
  if (a == null || a <= 0) return null;
  const today = bars[n - 1];
  for (const [period, e] of [[10, e10], [20, e20]] as const) {
    const now = e[n - 1], before = e[n - 1 - p.risingDays];
    if (now == null || before == null || now <= before) continue;
    const touched = today.low <= now + p.touchAtr * a;
    const held = today.close > now && today.close > today.open;
    const trend = bars.slice(n - 1 - p.aboveDaysBefore, n - 1).every((b, i) => {
      const v = e20[n - 1 - p.aboveDaysBefore + i];
      return v != null && b.close > v;
    });
    if (touched && held && trend) {
      return { name: "ema_crossback", confirmed, detail: { ema: period, emaValue: r2(now), lowToEmaAtr: r2((today.low - now) / a) } };
    }
  }
  return null;
}

/** Break up out of a contraction: at least `belowDays` of the last `lookback` closes were under the 20 EMA, the
 *  average daily range of those days shrank to `contraction` × the prior ones (or highs fell), and today is back above
 *  both the 10 and 20 EMA. */
export function wedgePop(bars: KellBar[], confirmed: boolean, p = KELL.wedgePop): KellHit | null {
  const n = bars.length;
  if (n < Math.max(30, p.lookback * 3 + 1)) return null;
  const { e10, e20 } = series(bars);
  const t10 = e10[n - 1], t20 = e20[n - 1];
  const close = bars[n - 1].close;
  if (t10 == null || t20 == null || !(close > t10 && close > t20)) return null;
  const recent = bars.slice(n - 1 - p.lookback, n - 1);
  const below = recent.filter((b, i) => {
    const e = e20[n - 1 - p.lookback + i];
    return e != null && b.close < e;
  }).length;
  if (below < p.belowDays) return null;
  const prior = bars.slice(n - 1 - 3 * p.lookback, n - 1 - p.lookback);
  const avgRange = (bs: KellBar[]) => bs.reduce((s, b) => s + (b.high - b.low), 0) / bs.length;
  const contracting = avgRange(recent) <= p.contraction * avgRange(prior);
  const fallingHighs = Math.max(...recent.map((b) => b.high)) < Math.max(...prior.slice(-p.lookback).map((b) => b.high));
  if (!contracting && !fallingHighs) return null;
  return { name: "wedge_pop", confirmed, detail: { ema10: r2(t10), ema20: r2(t20), daysBelow: below } };
}

/** A tight base of `baseDays` (depth ≤ maxDepthPct and ≤ maxDepthAtr ATRs), then today above the base's high on
 *  ≥ volumeX × the average volume (today's volume scaled by how much of the session has passed). */
export function baseNBreak(bars: KellBar[], confirmed: boolean, sessionFraction = 1, p = KELL.baseNBreak): KellHit | null {
  const n = bars.length;
  if (n < p.volumeDays + 2 || n < p.baseDays + 15) return null;
  const base = bars.slice(n - 1 - p.baseDays, n - 1);
  const top = Math.max(...base.map((b) => b.high));
  const bottom = Math.min(...base.map((b) => b.low));
  const a = calculateAtr(bars, 14)[n - 2];
  if (a == null || a <= 0 || bottom <= 0) return null;
  const depthPct = ((top - bottom) / bottom) * 100;
  if (depthPct > p.maxDepthPct || (top - bottom) / a > p.maxDepthAtr) return null;
  const today = bars[n - 1];
  if (!(today.close > top)) return null;
  const avgVol = bars.slice(n - 1 - p.volumeDays, n - 1).reduce((s, b) => s + b.volume, 0) / p.volumeDays;
  const relVol = avgVol > 0 ? today.volume / (avgVol * Math.max(0.05, Math.min(1, sessionFraction))) : 0;
  if (relVol < p.volumeX) return null;
  return { name: "base_n_break", confirmed, detail: { baseHigh: r2(top), depthPct: r2(depthPct), relVolume: r2(relVol) } };
}

export function kellSetups(bars: KellBar[], price: number, confirmed: boolean, sessionFraction = 1, params = KELL): KellHit[] {
  if (!bars.length) return [];
  const last = bars[bars.length - 1];
  const live = price > 0
    ? [...bars.slice(0, -1), { ...last, close: price, high: Math.max(last.high, price), low: Math.min(last.low, price) }]
    : bars;
  return [
    exhaustionExtension(live, price, params.exhaustionExtension),
    wedgeDrop(live, confirmed, params.wedgeDrop),
    emaCrossback(live, confirmed, params.emaCrossback),
    wedgePop(live, confirmed, params.wedgePop),
    baseNBreak(live, confirmed, sessionFraction, params.baseNBreak),
  ].filter((h): h is KellHit => h != null);
}

export function kellStage(bars: KellBar[], price: number, hits: KellHit[]): KellStage {
  const order: KellSetupName[] = ["exhaustion_extension", "wedge_drop", "base_n_break", "wedge_pop", "ema_crossback"];
  const top = order.find((name) => hits.some((h) => h.name === name));
  if (top) return top;
  const n = bars.length;
  const { e10, e20 } = series(bars);
  const t10 = e10[n - 1], t20 = e20[n - 1], b20 = e20[n - 6];
  if (t10 == null || t20 == null || b20 == null) return "unknown";
  if (price > t10 && t10 > t20 && t20 > b20) return "uptrend";
  if (price > t20 && t20 > b20) return "pullback";
  if (t10 < t20 && t20 < b20) return "downtrend";
  return "below_emas";
}
