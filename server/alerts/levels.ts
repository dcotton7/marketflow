import { calculateAtr, calculateEMA, calculateSMA } from "@shared/chart-indicators";

/**
 * Logical support levels under price: where a stop belongs. A stop is "at" a level when it sits from atBelowAtr ATRs
 * under the level to atAboveAtr ATRs over it (just under support is where stops go). The 5% cap is only the most
 * Don will lose; a stop in empty space is flagged with the nearest levels instead, never a % suggestion.
 */
export const LEVELS = {
  swingLookback: 60,
  swingSide: 3,
  baseDays: 15,
  atBelowAtr: 0.5,
  atAboveAtr: 0.25,
  nearest: 6,
  mergeAtr: 0.1,
  breakKinds: ["swing_low", "base_low", "sma20", "sma50", "sma200", "ema20"] as string[],
};

export interface LevelBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface Level {
  kind: string;
  /** Levels within mergeAtr of each other are one level. */
  kinds: string[];
  label: string;
  price: number;
  pctBelow: number;
  atrBelow: number | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Pivot lows: a low under the `side` bars on each side of it. Newest first. */
export function swingLows(bars: LevelBar[], lookback = LEVELS.swingLookback, side = LEVELS.swingSide) {
  const out: Array<{ price: number; date: string }> = [];
  const end = bars.length - 1 - side;
  for (let i = end; i >= Math.max(side, bars.length - 1 - lookback); i--) {
    const low = bars[i].low;
    let pivot = true;
    for (let k = 1; k <= side && pivot; k++) pivot = low < bars[i - k].low && low <= bars[i + k].low;
    if (pivot) out.push({ price: low, date: bars[i].date });
  }
  return out;
}

/** Supports under `price`, nearest first. Today's bar is the last one (its low is the low of day). */
export function supportLevels(bars: LevelBar[], price: number, vwap: number | null = null, params = LEVELS): Level[] {
  const n = bars.length;
  if (!n || !(price > 0)) return [];
  const atr = calculateAtr(bars, 14)[n - 1];
  const raw: Array<{ kind: string; label: string; price: number }> = [];
  const swings = swingLows(bars, params.swingLookback, params.swingSide).filter((s) => s.price < price).slice(0, 3);
  for (const s of swings) raw.push({ kind: "swing_low", label: `swing low ${s.date.slice(0, 10)}`, price: s.price });
  if (n > params.baseDays + 1) {
    const base = bars.slice(n - 1 - params.baseDays, n - 1);
    raw.push({ kind: "base_low", label: `${params.baseDays}-day base low`, price: Math.min(...base.map((b) => b.low)) });
  }
  for (const p of [5, 10, 20, 50, 200]) {
    const v = calculateSMA(bars, p)[n - 1];
    if (v != null) raw.push({ kind: `sma${p}`, label: `${p}-day SMA`, price: v });
  }
  for (const p of [10, 20]) {
    const v = calculateEMA(bars, p)[n - 1];
    if (v != null) raw.push({ kind: `ema${p}`, label: `${p} EMA`, price: v });
  }
  raw.push({ kind: "low_of_day", label: "low of day", price: bars[n - 1].low });
  if (vwap != null && vwap > 0) raw.push({ kind: "vwap", label: "VWAP", price: vwap });
  const sorted = raw
    .filter((l) => Number.isFinite(l.price) && l.price > 0 && l.price < price)
    .sort((a, b) => b.price - a.price);
  const merged: Level[] = [];
  for (const l of sorted) {
    const prev = merged[merged.length - 1];
    if (prev && atr && Math.abs(prev.price - l.price) <= params.mergeAtr * atr) {
      prev.kinds.push(l.kind);
      prev.label += ` / ${l.label}`;
      continue;
    }
    merged.push({
      kind: l.kind,
      kinds: [l.kind],
      label: l.label,
      price: r2(l.price),
      pctBelow: r2(((price - l.price) / price) * 100),
      atrBelow: atr && atr > 0 ? r2((price - l.price) / atr) : null,
    });
  }
  return merged.slice(0, params.nearest);
}

export function levelAt(stop: number, levels: Level[], atr: number | null, params = LEVELS): Level | null {
  if (!atr || atr <= 0) return null;
  return levels.find((l) => stop >= l.price - params.atBelowAtr * atr && stop <= l.price + params.atAboveAtr * atr) ?? null;
}

export type StopFlag = "no_planned_stop" | "planned_stop_not_at_level" | "cap_in_empty_space" | "cap_tighter_than_plan";

/** Is the stop at structure? Levels are measured from the stop's side: all supports above the cap count. */
export function assessStop(opts: {
  entry: number;
  stopPlan: number | null | undefined;
  cap: number;
  levels: Level[];
  atr: number | null;
}) {
  const { stopPlan, cap, levels, atr } = opts;
  const flags: StopFlag[] = [];
  const planned = stopPlan != null && stopPlan > 0 ? stopPlan : null;
  const plannedAt = planned != null ? levelAt(planned, levels, atr) : null;
  const capAt = levelAt(cap, levels, atr);
  if (planned == null) flags.push("no_planned_stop");
  else if (!plannedAt) flags.push("planned_stop_not_at_level");
  if (planned != null && planned < cap) flags.push("cap_tighter_than_plan");
  if ((planned == null || planned < cap) && !capAt) flags.push("cap_in_empty_space");
  const candidates = levels.filter((l) => l.price >= cap).slice(0, 3);
  const words = (l: Level) => `${l.label} $${l.price.toFixed(2)}`;
  let note = "";
  if (flags.includes("planned_stop_not_at_level")) {
    note = `The planned stop $${planned!.toFixed(2)} isn't at a level` +
      (candidates.length ? `; nearby: ${candidates.map(words).join(", ")}.` : "; no support between it and the cap.");
  } else if (flags.includes("no_planned_stop")) {
    note = "No planned stop" + (candidates.length ? `; logical levels above the cap: ${candidates.map(words).join(", ")}.` :
      flags.includes("cap_in_empty_space") ? "; no support between price and the cap, and the cap sits in empty space." : ".");
  } else if (flags.includes("cap_in_empty_space")) {
    note = `The cap $${cap.toFixed(2)} is tighter than the plan and sits in empty space.`;
  }
  return { flags, plannedAt: plannedAt?.label ?? null, capAt: capAt?.label ?? null, candidates, note };
}

/** Logical levels (LEVELS.breakKinds) above the stop that price is under now after yesterday's close held above. */
export function brokenLevels(bars: LevelBar[], price: number, stop: number, params = LEVELS) {
  const n = bars.length;
  if (n < 2) return [];
  const prevClose = bars[n - 2].close;
  const prior = bars.slice(0, n - 1);
  return supportLevels(prior, prevClose, null, { ...params, nearest: 20 })
    .filter((l) => l.kinds.some((k) => params.breakKinds.includes(k)) && l.price > stop && price < l.price)
    .map((l) => ({ ...l, kind: l.kinds.find((k) => params.breakKinds.includes(k))! }));
}
