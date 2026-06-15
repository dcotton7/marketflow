import type { SetupBar } from "./types";
import { avgVolume } from "./bars";
import { emptyResult, hitResult } from "./result-helpers";

export interface LongBaseOptions {
  minGapPct?: number;
  minBaseDays?: number;
  maxBaseDays?: number;
  searchLookbackDays?: number;
  breakoutClosePct?: number;
}

function maxRangePctForLength(days: number): number {
  if (days >= 90) return 35;
  if (days >= 45) return 28;
  if (days >= 20) return 22;
  return 18;
}

function formatBarDate(bar: SetupBar): string | null {
  if (bar.timestamp == null) return null;
  const raw = bar.timestamp;
  if (typeof raw === "number") {
    const d = new Date(raw > 1e12 ? raw : raw * 1000);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return String(raw).slice(0, 10);
}

function gapUpPct(gapBar: SetupBar, priorClose: number): number {
  if (priorClose <= 0) return 0;
  const openPct = ((gapBar.open - priorClose) / priorClose) * 100;
  const closePct = ((gapBar.close - priorClose) / priorClose) * 100;
  const highPct = ((gapBar.high - priorClose) / priorClose) * 100;
  return Math.max(openPct, closePct, highPct);
}

/**
 * Consolidation box from gap day forward — box high excludes gap-day wick spike.
 */
function consolidationBoxFromGap(
  bars: SetupBar[],
  gapIdx: number,
  priorClose: number,
  breakoutClosePct: number
): {
  baseEndIdx: number;
  baseDays: number;
  ceiling: number;
  floor: number;
  rangePct: number;
  brokeOut: boolean;
  breakoutIdx: number | null;
} | null {
  const last = bars.length - 1;
  const gapBar = bars[gapIdx]!;
  if (gapIdx >= last) return null;

  let consHigh = Math.max(gapBar.open, gapBar.close, priorClose);
  let consLow = Math.min(gapBar.low, priorClose);
  let breakoutIdx: number | null = null;

  for (let i = gapIdx + 1; i <= last; i++) {
    const b = bars[i]!;
    const priorCeiling = consHigh;
    if (b.close > priorCeiling * (1 + breakoutClosePct / 100)) {
      breakoutIdx = i;
      break;
    }
    consHigh = Math.max(consHigh, b.high);
    consLow = Math.min(consLow, b.low);
  }

  const baseEndIdx = breakoutIdx != null ? breakoutIdx - 1 : last;
  const baseDays = baseEndIdx - gapIdx + 1;
  if (baseDays < 1) return null;

  const baseBars = bars.slice(gapIdx, baseEndIdx + 1);
  const ceiling = Math.max(...baseBars.map((b) => b.high));
  const floor = Math.min(...baseBars.map((b) => b.low));
  if (ceiling <= 0) return null;

  return {
    baseEndIdx,
    baseDays,
    ceiling,
    floor,
    rangePct: ((ceiling - floor) / ceiling) * 100,
    brokeOut: breakoutIdx != null,
    breakoutIdx,
  };
}

/**
 * Gap-forward long base (e.g. Apr 1 gap → weeks/months of consolidation).
 */
export function detectLongBase(bars: SetupBar[], opts?: LongBaseOptions) {
  const minGapPct = opts?.minGapPct ?? 2;
  const minBaseDays = opts?.minBaseDays ?? 15;
  const maxBaseDays = opts?.maxBaseDays ?? 150;
  const searchLookback = opts?.searchLookbackDays ?? maxBaseDays;
  const breakoutClosePct = opts?.breakoutClosePct ?? 2;
  const maxStaleBreakoutBars = 25;

  if (bars.length < minBaseDays + 2) return emptyResult("long_base", "O7");

  const last = bars.length - 1;
  const today = bars[last]!;
  const searchStart = Math.max(1, last - searchLookback);

  type Candidate = {
    gapIdx: number;
    gapPct: number;
    gapDate: string | null;
    /** Trading bars from gap session through today (user-facing span). */
    daysSinceGap: number;
    /** Pre-breakout coil length inside the box. */
    consolidationDays: number;
    ceiling: number;
    floor: number;
    rangePct: number;
    volContracting: boolean;
    brokeOut: boolean;
    stage: "forming" | "ready" | "triggered" | "extended";
    score: number;
  };

  let best: Candidate | null = null;

  for (let gapIdx = searchStart; gapIdx <= last - minBaseDays + 1; gapIdx++) {
    const gapBar = bars[gapIdx]!;
    const priorClose = bars[gapIdx - 1]!.close;
    if (priorClose <= 0) continue;

    const gapPct = gapUpPct(gapBar, priorClose);
    if (gapPct < minGapPct) continue;

    const daysSinceGap = last - gapIdx + 1;
    if (daysSinceGap < minBaseDays || daysSinceGap > maxBaseDays) continue;

    const box = consolidationBoxFromGap(bars, gapIdx, priorClose, breakoutClosePct);
    if (!box || box.baseDays < minBaseDays) continue;

    if (box.brokeOut && box.breakoutIdx != null) {
      const barsSinceBreakout = last - box.breakoutIdx;
      if (barsSinceBreakout > maxStaleBreakoutBars) continue;
    }

    const maxRange = maxRangePctForLength(box.baseDays);
    if (box.rangePct > maxRange) continue;
    if (box.floor < priorClose * 0.95) continue;
    if (!box.brokeOut && today.close < box.floor * 0.97) continue;

    const baseBars = bars.slice(gapIdx, box.baseEndIdx + 1);
    const third = Math.max(1, Math.floor(baseBars.length / 3));
    const firstVol = avgVolume(baseBars.slice(0, third), third);
    const lastVol = avgVolume(baseBars.slice(-third), third);
    const volContracting = lastVol > 0 && firstVol > 0 && lastVol <= firstVol * 1.35;

    const distToCeilingPct =
      box.ceiling > 0 ? ((box.ceiling - today.close) / box.ceiling) * 100 : 0;
    const extAboveCeilingPct =
      box.ceiling > 0 ? ((today.close - box.ceiling) / box.ceiling) * 100 : 0;

    let stage: Candidate["stage"] = "forming";
    if (box.brokeOut) {
      stage = extAboveCeilingPct > 6 ? "extended" : "triggered";
    } else if (distToCeilingPct <= 3 && volContracting) {
      stage = "ready";
    }

    const recencyBoost = (gapIdx / Math.max(1, last)) * 50;
    let score =
      Math.min(40, daysSinceGap * 0.35) +
      Math.max(0, 35 * (1 - box.rangePct / maxRange)) +
      (volContracting ? 12 : 0) +
      Math.min(12, gapPct * 0.4) +
      (box.brokeOut ? 8 : 0) +
      recencyBoost;

    if (daysSinceGap > 60) score -= (daysSinceGap - 60) * 0.55;
    if (box.rangePct > 12) score -= (box.rangePct - 12) * 2.5;
    if (daysSinceGap <= 55 && box.rangePct <= 10) score += 28;

    if (!best || score > best.score) {
      best = {
        gapIdx,
        gapPct,
        gapDate: formatBarDate(gapBar),
        daysSinceGap,
        consolidationDays: box.baseDays,
        ceiling: box.ceiling,
        floor: box.floor,
        rangePct: box.rangePct,
        volContracting,
        brokeOut: box.brokeOut,
        stage,
        score,
      };
    }
  }

  if (!best) return emptyResult("long_base", "O7");

  const confidence = Math.min(92, Math.round(48 + best.score * 0.45));

  return hitResult(
    "long_base",
    "O7",
    best.stage,
    confidence,
    best.ceiling,
    best.floor,
    best.ceiling * 1.08,
    {
      gapPct: best.gapPct.toFixed(2),
      gapDate: best.gapDate,
      baseDays: best.daysSinceGap,
      consolidationDays: best.consolidationDays,
      baseRangePct: best.rangePct.toFixed(2),
      ceiling: best.ceiling,
      floor: best.floor,
      volContracting: best.volContracting,
      brokeOut: best.brokeOut,
      anchor: "gap_forward",
    }
  );
}

/**
 * Recent mid-chart coil (e.g. ~20–50d tight base since mid-April) — preferred over stale gap anchors.
 */
export function detectRecentCoilBase(bars: SetupBar[]) {
  const minDays = 18;
  const maxDays = 55;
  const lookback = 72;
  if (bars.length < minDays + 5) return emptyResult("long_base", "O7");

  const last = bars.length - 1;
  const searchStart = Math.max(0, last - lookback);
  let best: {
    start: number;
    days: number;
    ceiling: number;
    floor: number;
    rangePct: number;
    score: number;
    volContracting: boolean;
  } | null = null;

  for (let start = searchStart; start <= last - minDays + 1; start++) {
    const slice = bars.slice(start, last + 1);
    const days = slice.length;
    if (days < minDays || days > maxDays) continue;

    const ceiling = Math.max(...slice.map((b) => b.high));
    const floor = Math.min(...slice.map((b) => b.low));
    if (ceiling <= 0) continue;

    const rangePct = ((ceiling - floor) / ceiling) * 100;
    if (rangePct > 14) continue;
    if (bars[last]!.close < floor * 0.96) continue;

    const third = Math.max(1, Math.floor(slice.length / 3));
    const firstVol = avgVolume(slice.slice(0, third), third);
    const lastVol = avgVolume(slice.slice(-third), third);
    const volContracting = lastVol > 0 && firstVol > 0 && lastVol <= firstVol * 1.4;

    const distToCeiling =
      ceiling > 0 ? ((ceiling - bars[last]!.close) / ceiling) * 100 : 0;
    const tightness = 1 - rangePct / 14;
    const score =
      tightness * 55 +
      (days >= 20 ? 18 : 8) +
      (rangePct <= 8 ? 22 : rangePct <= 11 ? 12 : 0) +
      (volContracting ? 10 : 0) +
      (distToCeiling <= 4 ? 8 : 0);

    if (!best || score > best.score) {
      best = { start, days, ceiling, floor, rangePct, score, volContracting };
    }
  }

  if (!best) return emptyResult("long_base", "O7");

  const distToCeilingPct =
    best.ceiling > 0 ? ((best.ceiling - bars[last]!.close) / best.ceiling) * 100 : 0;
  let stage: "forming" | "ready" | "triggered" | "extended" = "forming";
  if (distToCeilingPct <= 3 && best.volContracting) stage = "ready";
  else if (bars[last]!.close > best.ceiling * 1.02) stage = "triggered";

  const startBar = bars[best.start]!;
  const priorClose = best.start > 0 ? bars[best.start - 1]!.close : startBar.open;
  const gapPct = best.start > 0 ? gapUpPct(startBar, priorClose) : 0;

  return hitResult(
    "long_base",
    "O7",
    stage,
    Math.min(92, Math.round(52 + best.score * 0.42)),
    best.ceiling,
    best.floor,
    best.ceiling * 1.06,
    {
      gapPct: gapPct >= 2 ? gapPct.toFixed(2) : null,
      gapDate: formatBarDate(startBar),
      baseDays: best.days,
      consolidationDays: best.days,
      baseRangePct: best.rangePct.toFixed(2),
      ceiling: best.ceiling,
      floor: best.floor,
      volContracting: best.volContracting,
      brokeOut: false,
      anchor: "recent_coil",
    }
  );
}

/**
 * Fallback: tight horizontal box without requiring a gap anchor.
 */
export function detectTightConsolidationBase(bars: SetupBar[]) {
  const minDays = 20;
  const maxDays = 130;
  if (bars.length < minDays) return emptyResult("long_base", "O7");

  const last = bars.length - 1;
  let best: {
    start: number;
    end: number;
    days: number;
    ceiling: number;
    floor: number;
    rangePct: number;
    score: number;
    brokeOut: boolean;
  } | null = null;

  const searchStart = Math.max(0, last - 160);

  for (let start = searchStart; start <= last - minDays; start++) {
    for (let end = last; end >= start + minDays - 1; end--) {
      const slice = bars.slice(start, end + 1);
      const days = slice.length;
      if (days > maxDays) continue;

      const ceiling = Math.max(...slice.map((b) => b.high));
      const floor = Math.min(...slice.map((b) => b.low));
      if (ceiling <= 0) continue;

      const rangePct = ((ceiling - floor) / ceiling) * 100;
      const maxRange = maxRangePctForLength(days);
      if (rangePct > maxRange) continue;

      const endClose = bars[end]!.close;
      if (endClose < floor * 0.96) continue;

      const brokeOut = end < last && bars[last]!.close > ceiling * 1.02;
      const tightness = 1 - rangePct / maxRange;
      const recency = (end - start) / days;
      const score = days * 0.6 + tightness * 35 + recency * 10 + (brokeOut ? 6 : 0);

      if (!best || score > best.score) {
        best = { start, end, days, ceiling, floor, rangePct, score, brokeOut };
      }
    }
  }

  if (!best) return emptyResult("long_base", "O7");

  const extAbove =
    best.ceiling > 0 ? ((bars[last]!.close - best.ceiling) / best.ceiling) * 100 : 0;
  let stage: "forming" | "ready" | "triggered" | "extended" = "forming";
  if (best.brokeOut) stage = extAbove > 6 ? "extended" : "triggered";
  else if (((best.ceiling - bars[last]!.close) / best.ceiling) * 100 <= 3) stage = "ready";

  const anchorBar = bars[best.start]!;
  const priorClose = best.start > 0 ? bars[best.start - 1]!.close : anchorBar.open;
  const gapPct = best.start > 0 ? gapUpPct(anchorBar, priorClose) : 0;

  return hitResult(
    "long_base",
    "O7",
    stage,
    Math.min(88, Math.round(44 + best.score * 0.4)),
    best.ceiling,
    best.floor,
    best.ceiling * 1.08,
    {
      gapPct: gapPct >= 2 ? gapPct.toFixed(2) : null,
      gapDate: gapPct >= 2 ? formatBarDate(anchorBar) : null,
      baseDays: best.days,
      baseRangePct: best.rangePct.toFixed(2),
      ceiling: best.ceiling,
      floor: best.floor,
      volContracting: false,
      brokeOut: best.brokeOut,
      anchor: gapPct >= 2 ? "gap_forward" : "tight_box",
    }
  );
}
