/**
 * The session read from one symbol's 5-minute bars (regular session only; pre-market never enters): VWAP, the opening range, the day's high and low, and volume
 * against the time-of-day norm. Pure: the same bars always give the same answer.
 *
 * Time-of-day volume norm: MarketFlow keeps no intraday volume history, so the norm is the 20-day average daily
 * volume spread over the 78 five-minute slots by a fixed U-shaped profile (heavy open, light midday, heavier close;
 * VOLUME_PROFILE below, a setting). Relative volume = the bar's volume / (avgVol20 x the slot's share). Once the
 * scanner's own bars have collected a few weeks, a measured per-symbol curve can replace it (docs/trigger-scanner.md).
 */
import { getEtClock } from "@shared/usEquityMarketSession";
import type { Bar } from "./types";

export const BAR_MS = 5 * 60_000;
export const SLOTS = 78;

/** Share of the day's volume in each 5-minute slot (sums to 1). */
export const VOLUME_PROFILE: number[] = (() => {
  const w = Array.from({ length: SLOTS }, (_, s) => 1 + 3 * Math.exp(-s / 3) + 1.5 * Math.exp(-(SLOTS - 1 - s) / 4));
  const total = w.reduce((a, b) => a + b, 0);
  return w.map((x) => x / total);
})();
const CUM_PROFILE: number[] = VOLUME_PROFILE.reduce<number[]>((a, x, i) => (a.push((a[i - 1] ?? 0) + x), a), []);

/** 9:30 ET on that date, in epoch ms (DST-safe: tries both UTC offsets). */
export function sessionOpenMs(date: string): number {
  for (const h of [13, 14]) {
    const ms = Date.parse(`${date}T${String(h).padStart(2, "0")}:30:00Z`);
    const c = getEtClock(new Date(ms));
    if (c.dateKey === date && c.minuteOfDay === 9 * 60 + 30) return ms;
  }
  return Date.parse(`${date}T14:30:00Z`);
}

export interface SessionState {
  date: string;
  openMs: number;
  bars: Bar[];
  slot: number[];
  vwap: number[];
  cumVol: number[];
  /** Highest high / lowest low through each bar (inclusive). */
  hod: number[];
  lod: number[];
  orBars: number;
  /** The opening range, once its bars are in (null before). */
  orHigh: number | null;
  orLow: number | null;
  /** Index of the first bar after the range. */
  orEnd: number;
}

/** Keep regular-session bars of `date` only, sorted, one per start time. */
export function sessionBars(date: string, bars: Bar[], closeMinute = 16 * 60): Bar[] {
  const open = sessionOpenMs(date);
  const end = open + (closeMinute - (9 * 60 + 30)) * 60_000;
  const seen = new Set<number>();
  return bars
    .map((b) => ({ b, ms: Date.parse(b.t) }))
    .filter(({ ms }) => ms >= open && ms < end)
    .sort((x, y) => x.ms - y.ms)
    .filter(({ ms }) => (seen.has(ms) ? false : (seen.add(ms), true)))
    .map(({ b }) => b);
}

export function buildSession(date: string, bars: Bar[], orMinutes = 15): SessionState {
  const openMs = sessionOpenMs(date);
  const orBars = Math.max(1, Math.round(orMinutes / 5));
  const slot: number[] = [], vwap: number[] = [], cumVol: number[] = [], hod: number[] = [], lod: number[] = [];
  let pv = 0, v = 0, hi = -Infinity, lo = Infinity;
  for (const b of bars) {
    const s = Math.round((Date.parse(b.t) - openMs) / BAR_MS);
    slot.push(Math.min(SLOTS - 1, Math.max(0, s)));
    // Session VWAP exactly as shared/chart-indicators.ts calculateSessionVwap (the one the alerts' vwap_reclaim uses;
    // the test checks they agree): typical price x volume from 9:30, a bar with no volume adds nothing. Not called
    // directly because it formats an ET date per bar, too slow for 1,700 names x 78 bars every pass.
    if (b.v > 0 && [b.h, b.l, b.c].every(Number.isFinite)) {
      pv += ((b.h + b.l + b.c) / 3) * b.v;
      v += b.v;
    }
    vwap.push(v > 0 ? pv / v : (b.h + b.l + b.c) / 3);
    cumVol.push(v);
    hi = Math.max(hi, b.h);
    lo = Math.min(lo, b.l);
    hod.push(hi);
    lod.push(lo);
  }
  // The range needs its bars by slot (a slot with no trades has no bar; the range still ends at slot orBars).
  const inRange = bars.filter((_, i) => slot[i] < orBars);
  const orEnd = bars.findIndex((_, i) => slot[i] >= orBars);
  const complete = orEnd >= 0 && inRange.length > 0;
  return {
    date,
    openMs,
    bars,
    slot,
    vwap,
    cumVol,
    hod,
    lod,
    orBars,
    orHigh: complete ? Math.max(...inRange.map((b) => b.h)) : null,
    orLow: complete ? Math.min(...inRange.map((b) => b.l)) : null,
    orEnd: complete ? orEnd : bars.length,
  };
}

/** The bar's volume against its slot's norm; null without a 20-day average. */
export function relVol(s: SessionState, i: number, avgVol20: number): number | null {
  if (!(avgVol20 > 0)) return null;
  return s.bars[i].v / (avgVol20 * VOLUME_PROFILE[s.slot[i]]);
}

/** Volume so far today against the norm for this time of day. */
export function cumRelVol(s: SessionState, i: number, avgVol20: number): number | null {
  if (!(avgVol20 > 0)) return null;
  return s.cumVol[i] / (avgVol20 * CUM_PROFILE[s.slot[i]]);
}

/** When the bar closed (its start + 5 minutes), ISO. */
export function barCloseIso(b: Bar): string {
  return new Date(Date.parse(b.t) + BAR_MS).toISOString();
}

/** Minutes since 9:30 at the bar's close. */
export function minutesAtClose(s: SessionState, i: number): number {
  return (s.slot[i] + 1) * 5;
}
