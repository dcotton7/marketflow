/** Made-up bars and contexts for the trigger scanner's tests and the replay tool. No vendor data. */
import { DEFAULTS, type ScannerSettings } from "./settings";
import { BAR_MS, sessionOpenMs } from "./session";
import type { Bar, DailyContext, Regime, Rotation } from "./types";

export const DATE = "2026-11-24"; // a Tuesday

/** Session bars from [open, high, low, close, volume] rows, one per 5-minute slot from 9:30 ET (slot offset optional). */
export function bars(rows: [number, number, number, number, number][], date = DATE, firstSlot = 0): Bar[] {
  const open = sessionOpenMs(date);
  return rows.map(([o, h, l, c, v], k) => ({ t: new Date(open + (firstSlot + k) * BAR_MS).toISOString(), o, h, l, c, v }));
}

/** A daily context at ~$100 with a 3% ADR ($3), 1M shares a day ($100M), daily levels far away unless given. */
export function ctx(over: Partial<DailyContext> = {}): DailyContext {
  return {
    symbol: "TEST", asOf: "2026-11-23", prevClose: 100, prevHigh: 120, prevLow: 80,
    sma5: null, sma10: null, sma20: null, sma50: null, ema10: null, ema20: null,
    adrPct: 3, adr: 3, avgVol20: 1_000_000, avgVol50: 1_000_000, dollarVol20: 100e6, gapGo: { up: null, down: null }, earningsToday: "unknown", close5dAgo: 100, gaps: [],
    capSize: "MID", sector: "Technology", nextEarnings: null, earningsKnown: true,
    ...over,
  };
}

export const settings: ScannerSettings = { ...DEFAULTS };
export const regime = (label: Regime["label"] = "NEUTRAL"): Regime => ({ label, score: 50, asOf: "2026-11-24T15:00:00.000Z" });
export const noRotation: Rotation = { asOf: null, leadingSize: [], leadingSectors: [], size: {}, sectors: {} };
