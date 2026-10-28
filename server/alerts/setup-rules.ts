import { calculateSessionVwap, sessionDateKeyEt } from "@shared/chart-indicators";
import { detectIntradayCrossOfDailyMa } from "../shared/intraday-daily-ma-cross";
import { KELL, kellSetups, type KellBar, type KellParams } from "./kell";

/**
 * Entry setups for the starred (isDefault) watchlist: three intraday checks on today's regular-session 5-minute bars
 * and Kell's three entry setups on daily bars. Each is named and takes its thresholds from SETUPS (Kell's from KELL) so
 * a fired alert can store exactly what it saw.
 */
export const SETUPS = {
  vwapReclaim: { lookbackBars: 6, belowBars: 2 },
  openingRange: { bars: 3, minBreakoutPct: 0.1 },
  maReclaim: { periods: [10, 20, 50], lookbackMinutes: 30 },
  kell: ["ema_crossback", "wedge_pop", "base_n_break"] as const,
};
export type SetupParams = typeof SETUPS;

export type SetupName = "vwap_reclaim" | "orb_breakout" | "ma_reclaim" | (typeof SETUPS.kell)[number];

export interface FiveMinBar {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SetupHit {
  name: SetupName;
  confirmed: boolean;
  message: string;
  detail: Record<string, number | string>;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => `$${n.toFixed(2)}`;

export function todaysBars(bars: FiveMinBar[], day: string): FiveMinBar[] {
  return bars.filter((b) => sessionDateKeyEt(b.timestamp) === day);
}

/** Price back above session VWAP after at least `belowBars` of the previous `lookbackBars` 5-minute closes were under
 *  their VWAP. */
export function vwapReclaim(symbol: string, bars: FiveMinBar[], price: number, p = SETUPS.vwapReclaim): SetupHit | null {
  if (bars.length < p.belowBars + 1 || !(price > 0)) return null;
  const vwap = calculateSessionVwap(bars.map((b) => ({ ...b, date: b.timestamp })));
  const now = vwap[vwap.length - 1];
  if (now == null || !(price > now)) return null;
  const from = Math.max(0, bars.length - 1 - p.lookbackBars);
  let below = 0;
  for (let i = from; i < bars.length - 1; i++) if (vwap[i] != null && bars[i].close < vwap[i]!) below++;
  if (below < p.belowBars) return null;
  return {
    name: "vwap_reclaim",
    confirmed: true,
    message: `${symbol}: back above VWAP ${money(now)} (${below} of the last ${p.lookbackBars} 5-minute bars closed under it).`,
    detail: { vwap: r2(now), pctAbove: r2(((price - now) / now) * 100), barsBelow: below },
  };
}

/** Price above the high of the first `bars` 5-minute bars by at least `minBreakoutPct`, once that range is complete. */
export function openingRangeBreakout(symbol: string, bars: FiveMinBar[], price: number, p = SETUPS.openingRange): SetupHit | null {
  if (bars.length <= p.bars || !(price > 0)) return null;
  const range = bars.slice(0, p.bars);
  const high = Math.max(...range.map((b) => b.high));
  const low = Math.min(...range.map((b) => b.low));
  if (!(price > high * (1 + p.minBreakoutPct / 100))) return null;
  return {
    name: "orb_breakout",
    confirmed: true,
    message: `${symbol}: broke out above its ${p.bars * 5}-minute opening range high ${money(high)}.`,
    detail: { rangeHigh: r2(high), rangeLow: r2(low), minutes: p.bars * 5, breakoutPct: r2(((price - high) / high) * 100) },
  };
}

/** A 5-minute close crossed up through a daily SMA in the last `lookbackMinutes`; the highest such SMA is reported. */
export function maReclaim(symbol: string, daily: KellBar[], bars: FiveMinBar[], price: number, p = SETUPS.maReclaim): SetupHit | null {
  if (bars.length < 2 || !(price > 0)) return null;
  const intradayCloses = [...bars.slice(0, -1).map((b) => b.close), price];
  const dailyCloses = daily.map((b) => b.close);
  const hits = p.periods
    .map((period) => ({
      period,
      cross: detectIntradayCrossOfDailyMa({
        dailyCloses, intradayCloses, maPeriod: period, maType: "sma", lookbackMinutes: p.lookbackMinutes,
        intradayTimeframe: "5min", crossType: "above",
      }),
    }))
    .filter((h) => h.cross.pass && h.cross.maLevel != null && price > h.cross.maLevel);
  const top = hits[hits.length - 1];
  if (!top) return null;
  return {
    name: "ma_reclaim",
    confirmed: true,
    message: `${symbol}: reclaimed the ${top.period}-day SMA ${money(top.cross.maLevel!)} in the last ${p.lookbackMinutes} minutes.`,
    detail: { sma: top.period, smaValue: r2(top.cross.maLevel!), barsAgo: top.cross.crossBarOffset ?? 0 },
  };
}

const KELL_TEXT: Record<(typeof SETUPS.kell)[number], string> = {
  ema_crossback: "EMA Crossback (pulled back to a rising EMA and held)",
  wedge_pop: "Wedge Pop (back above the 10 and 20 EMA out of a contraction)",
  base_n_break: "Base 'n Break (out of a tight base on volume)",
};

/** Daily bars oldest first with today's bar last (live during the session); `bars` are today's 5-minute bars. */
export function setupHits(input: {
  symbol: string;
  daily: KellBar[];
  bars: FiveMinBar[];
  price: number;
  confirmed: boolean;
  sessionFraction: number;
  params?: SetupParams;
  kellParams?: KellParams;
}): SetupHit[] {
  const p = input.params ?? SETUPS;
  const sym = input.symbol.toUpperCase();
  const kell = kellSetups(input.daily, input.price, input.confirmed, input.sessionFraction, input.kellParams ?? KELL)
    .filter((h): h is typeof h & { name: (typeof SETUPS.kell)[number] } => (p.kell as readonly string[]).includes(h.name))
    .map((h) => ({
      name: h.name,
      confirmed: h.confirmed,
      message: `${sym}: ${KELL_TEXT[h.name]}${h.confirmed ? "" : ", still forming until the close"}.`,
      detail: h.detail,
    }));
  return [
    vwapReclaim(sym, input.bars, input.price, p.vwapReclaim),
    openingRangeBreakout(sym, input.bars, input.price, p.openingRange),
    maReclaim(sym, input.daily, input.bars, input.price, p.maReclaim),
    ...kell,
  ].filter((h): h is SetupHit => h != null);
}

const KELL_KEY = { ema_crossback: "emaCrossback", wedge_pop: "wedgePop", base_n_break: "baseNBreak" } as const;

export function setupParamsFor(name: SetupName, params = SETUPS, kellParams = KELL): Record<string, unknown> {
  if (name === "vwap_reclaim") return params.vwapReclaim;
  if (name === "orb_breakout") return params.openingRange;
  if (name === "ma_reclaim") return params.maReclaim;
  return kellParams[KELL_KEY[name]];
}
