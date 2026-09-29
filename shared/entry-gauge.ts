/**
 * Live entry gauges for session VWAP and the 5-minute 6/20 EMA.
 *
 * One color means the same thing on both readings:
 *   entry — bright cyan, open for entry
 *   safe  — deep green, safety is in and the early entry has passed
 *   fail  — red, wrong side
 *
 * The percent is how far. A fresh 6/20 cross keeps the color and adds ×+ or ×−.
 * EMA math matches server/shared/ma-math.ts (SMA seed, then standard EMA).
 */

export type EntryGaugeTone = "entry" | "safe" | "fail";
export type Ema620Cross = "up" | "down";

export interface VwapGauge {
  pct: number | null;
  tone: EntryGaugeTone | null;
}

export interface Ema620Gauge {
  pct: number | null;
  cross: Ema620Cross | null;
  tone: EntryGaugeTone | null;
}

export interface EntryGauge {
  vwapPct: number | null;
  vwapTone: EntryGaugeTone | null;
  ema620Pct: number | null;
  ema620Cross: Ema620Cross | null;
  ema620Tone: EntryGaugeTone | null;
}

/** Fraction of ADR that still counts as "at the level" — the early entry. */
const EARLY_ADR_FRACTION = 0.15;
/** Used when ADR is missing, in percent of price. */
const EARLY_PCT_FALLBACK = 0.25;

export function earlyBandPct(adrPct: number | null | undefined): number {
  if (adrPct != null && Number.isFinite(adrPct) && adrPct > 0) {
    return EARLY_ADR_FRACTION * adrPct;
  }
  return EARLY_PCT_FALLBACK;
}

/** ADR in dollars → percent of price. */
export function adrPctFromDollars(price: number, adrDollars: number | null | undefined): number | null {
  if (adrDollars == null || !Number.isFinite(adrDollars) || adrDollars <= 0) return null;
  if (!Number.isFinite(price) || price <= 0) return null;
  return (adrDollars / price) * 100;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function readVwapGauge(
  price: number,
  vwap: number | null | undefined,
  adrPct: number | null | undefined
): VwapGauge {
  if (!Number.isFinite(price) || price <= 0 || vwap == null || !Number.isFinite(vwap) || vwap <= 0) {
    return { pct: null, tone: null };
  }
  const pct = round2(((price - vwap) / vwap) * 100);
  const band = earlyBandPct(adrPct);
  if (Math.abs(pct) <= band) return { pct, tone: "entry" };
  if (pct > 0) return { pct, tone: "safe" };
  return { pct, tone: "fail" };
}

function calculateEMA(values: number[], period: number): number | null {
  if (values.length < period || period <= 0) return null;
  const multiplier = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((sum, v) => sum + v, 0) / period;
  for (let i = period; i < values.length; i++) {
    ema = (values[i] - ema) * multiplier + ema;
  }
  return ema;
}

function spreadPct(closes: number[]): number | null {
  const ema6 = calculateEMA(closes, 6);
  const ema20 = calculateEMA(closes, 20);
  if (ema6 == null || ema20 == null || ema20 === 0) return null;
  return round2(((ema6 - ema20) / ema20) * 100);
}

export function readEma620Gauge(
  closes: number[],
  adrPct: number | null | undefined
): Ema620Gauge {
  const pct = spreadPct(closes);
  if (pct == null) return { pct: null, cross: null, tone: null };
  const prev = closes.length > 20 ? spreadPct(closes.slice(0, -1)) : null;
  let cross: Ema620Cross | null = null;
  if (prev != null) {
    if (prev <= 0 && pct > 0) cross = "up";
    else if (prev >= 0 && pct < 0) cross = "down";
  }
  const band = earlyBandPct(adrPct);
  if (pct < 0 || cross === "down") return { pct, cross, tone: "fail" };
  if (cross === "up" || pct <= band) return { pct, cross, tone: "entry" };
  return { pct, cross, tone: "safe" };
}

export function formatEntryGauge(pct: number | null | undefined, cross?: Ema620Cross | null): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  const abs = Math.abs(pct);
  const body = abs >= 10 ? abs.toFixed(0) : abs >= 1 ? abs.toFixed(1) : abs.toFixed(2);
  if (cross === "up") return `×+${body}`;
  if (cross === "down") return `×−${body}`;
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
  return `${sign}${body}`;
}

export function vwapGaugeTitle(tone: EntryGaugeTone | null): string {
  if (tone === "entry") return "At VWAP. Open for entry.";
  if (tone === "safe") return "Above VWAP. Safety is in. The early entry has passed.";
  if (tone === "fail") return "Under VWAP. Not a long.";
  return "Session VWAP unavailable";
}

export function ema620GaugeTitle(tone: EntryGaugeTone | null, cross: Ema620Cross | null): string {
  if (cross === "up") return "5-minute 6 EMA just crossed above 20. Open for entry.";
  if (cross === "down") return "5-minute 6 EMA just crossed under 20. Not a long.";
  if (tone === "entry") return "5-minute 6/20 still tight. Open for entry.";
  if (tone === "safe") return "5-minute 6 is above 20. Safety is in. The early entry has passed.";
  if (tone === "fail") return "5-minute 6 is under 20. Not a long.";
  return "5-minute 6/20 unavailable";
}

export function emptyEntryGauge(): EntryGauge {
  return {
    vwapPct: null,
    vwapTone: null,
    ema620Pct: null,
    ema620Cross: null,
    ema620Tone: null,
  };
}

function numOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function toneOrNull(value: unknown): EntryGaugeTone | null {
  return value === "entry" || value === "safe" || value === "fail" ? value : null;
}

export function entryGaugeFromUnknown(row: Record<string, unknown> | null | undefined): EntryGauge {
  if (!row) return emptyEntryGauge();
  const cross = row.ema620Cross;
  return {
    vwapPct: numOrNull(row.vwapPct),
    vwapTone: toneOrNull(row.vwapTone),
    ema620Pct: numOrNull(row.ema620Pct),
    ema620Cross: cross === "up" || cross === "down" ? cross : null,
    ema620Tone: toneOrNull(row.ema620Tone),
  };
}
