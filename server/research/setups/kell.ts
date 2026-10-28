import type { EntrySetup, SignalSetup, SetupContext } from "./types";
import { findWedge, maxHigh, meanVolume, minLow, num, round, stopBelow } from "./helpers";

/** Kell's setups (spec section 3), drafts for Don to confirm. Thresholds are each detector's `defaults`. */

function core(ctx: SetupContext) {
  const { f, i } = ctx;
  const b = f.bars[i];
  return {
    b,
    prev: i > 0 ? f.bars[i - 1] : null,
    atr: num(f.atr14[i]),
    e10: num(f.ema10[i]),
    e20: num(f.ema20[i]),
    relVol: num(f.relVol[i]),
  };
}

export const reversalExtension: EntrySetup<{ ext10: number; ext20: number; minRangeAtr: number; minRelVol: number; stopBufferAtr: number }> = {
  id: "kell_reversal_extension",
  label: "Reversal Extension",
  kind: "entry",
  source: "kell",
  allowedStages: ["4C"],
  counterTrend: true,
  defaults: { ext10: -3, ext20: -5, minRangeAtr: 1.5, minRelVol: 1.5, stopBufferAtr: 0.1 },
  detect(ctx, p) {
    const { f, i } = ctx;
    const { b, prev, atr, e10, e20, relVol } = core(ctx);
    if (!prev || atr == null || e10 == null || e20 == null || relVol == null || relVol < p.minRelVol) return null;
    const pe10 = num(f.ext10[i - 1]);
    const pe20 = num(f.ext20[i - 1]);
    const extendedPrev = pe10 != null && pe20 != null && pe10 <= p.ext10 && pe20 <= p.ext20;
    const extendedLow = (b.low - e10) / atr <= p.ext10 && (b.low - e20) / atr <= p.ext20;
    if (!extendedPrev && !extendedLow) return null;
    const range = b.high - b.low;
    const reversal = b.close > prev.high || (range >= p.minRangeAtr * atr && b.close >= b.low + (2 / 3) * range);
    if (!reversal) return null;
    return {
      order: { type: "buy_stop", price: b.high + 0.01, validSessions: 1 },
      stop: stopBelow(b.low, atr, p.stopBufferAtr, "reversal_low", "reversal bar low"),
      details: { ext10Prev: round(pe10), ext20Prev: round(pe20), rangeAtr: round(range / atr), relVol: round(relVol), closeAbovePriorHigh: b.close > prev.high },
    };
  },
};

export const wedgePop: EntrySetup<{ minLen: number; maxLen: number; contraction: number; minRelVol: number; stopBufferAtr: number; maxStopPctForWedgeLow: number }> = {
  id: "kell_wedge_pop",
  label: "Wedge Pop",
  kind: "entry",
  source: "kell",
  allowedStages: ["1B", "2A"],
  defaults: { minLen: 8, maxLen: 30, contraction: 0.5, minRelVol: 1.3, stopBufferAtr: 0.1, maxStopPctForWedgeLow: 0.05 },
  detect(ctx, p) {
    const { f, i } = ctx;
    const { b, atr, e10, e20, relVol } = core(ctx);
    if (atr == null || e10 == null || e20 == null || relVol == null || relVol < p.minRelVol) return null;
    if (!(b.close > e10 && b.close > e20)) return null;
    const pe10 = num(f.ema10[i - 1]);
    const pe20 = num(f.ema20[i - 1]);
    if (pe10 == null || pe20 == null || f.bars[i - 1].close > Math.max(pe10, pe20)) return null;
    const w = findWedge(f, i - 1, i, i, "falling", p.minLen, p.maxLen, p.contraction);
    if (!w || b.close <= w.lineAt) return null;
    const useWedgeLow = w.low >= b.close * (1 - p.maxStopPctForWedgeLow);
    return {
      order: { type: "next_open" },
      stop: useWedgeLow
        ? stopBelow(w.low, atr, p.stopBufferAtr, "wedge_low", "wedge low")
        : stopBelow(b.low, atr, p.stopBufferAtr, "pop_day_low", "pop day low"),
      details: { wedgeLen: w.end - w.start + 1, wedgeLine: round(w.lineAt), wedgeLow: round(w.low), relVol: round(relVol) },
    };
  },
};

export const emaCrossback: EntrySetup<{ minPriorExtAtr: number; lookback: number; touchAboveAtr: number; undercutAtr: number; stopBufferAtr: number }> = {
  id: "kell_ema_crossback",
  label: "EMA Crossback",
  kind: "entry",
  source: "kell",
  allowedStages: ["2A", "2B"],
  defaults: { minPriorExtAtr: 1.5, lookback: 10, touchAboveAtr: 0.25, undercutAtr: 0.5, stopBufferAtr: 0.1 },
  detect(ctx, p) {
    const { f, i } = ctx;
    const { b, atr, e10, e20 } = core(ctx);
    const avg = num(f.avgVol50[i]);
    if (atr == null || e10 == null || e20 == null || avg == null || b.volume >= avg || b.close <= e20) return null;
    let peak = -Infinity;
    let peakIdx = -1;
    for (let k = i - p.lookback; k < i; k++) {
      const x = num(f.ext10[k]);
      if (x != null && x > peak) {
        peak = x;
        peakIdx = k;
      }
    }
    if (peak < p.minPriorExtAtr) return null;
    let touched: "ema10" | "ema20" | null = null;
    for (const [name, ema, slope] of [["ema10", e10, f.slope10[i]], ["ema20", e20, f.slope20[i]]] as const) {
      if (slope == null || slope <= 0) continue;
      const d = (b.low - ema) / atr;
      if (d <= p.touchAboveAtr && d >= -p.undercutAtr) {
        touched = name;
        break;
      }
    }
    if (!touched) return null;
    const pull = minLow(f, peakIdx, i);
    return {
      order: { type: "buy_stop", price: b.high + 0.01, validSessions: 1 },
      stop: stopBelow(pull.value, atr, p.stopBufferAtr, "pullback_low", "pullback low"),
      details: { touched, priorExt10: round(peak), volVsAvg: round(b.volume / avg) },
    };
  },
};

/** Tight bases ending the session before i, longest first. */
function tightBases(ctx: SetupContext, minLen: number, maxLen: number, maxRangeAtr: number, maxRangePct: number) {
  const { f, i } = ctx;
  const atr = num(f.atr14[i - 1]);
  const out: { from: number; hi: number; lo: number; len: number; atr: number }[] = [];
  if (atr == null) return out;
  for (let len = maxLen; len >= minLen; len--) {
    const from = i - len;
    if (from < 1) continue;
    const hi = maxHigh(f, from, i - 1).value;
    const lo = minLow(f, from, i - 1).value;
    if (hi - lo <= maxRangeAtr * atr || (hi - lo) / hi <= maxRangePct) out.push({ from, hi, lo, len, atr });
  }
  return out;
}

export const baseNBreak: EntrySetup<{ minLen: number; maxLen: number; maxRangeAtr: number; maxRangePct: number; maxAboveEmaAtr: number; minRelVol: number; stopBufferAtr: number }> = {
  id: "kell_base_n_break",
  label: "Base 'n Break",
  kind: "entry",
  source: "kell",
  allowedStages: ["2A", "2B"],
  defaults: { minLen: 5, maxLen: 20, maxRangeAtr: 2.5, maxRangePct: 0.1, maxAboveEmaAtr: 1.5, minRelVol: 1.5, stopBufferAtr: 0.1 },
  detect(ctx, p) {
    const { f, i } = ctx;
    const { b, atr, relVol } = core(ctx);
    if (atr == null || relVol == null || relVol < p.minRelVol || i < 2 || b.close <= f.bars[i - 1].high) return null;
    const pe10 = num(f.ema10[i - 1]);
    const pe20 = num(f.ema20[i - 1]);
    const ps20 = num(f.slope20[i - 1]);
    if (pe10 == null || pe20 == null || ps20 == null || ps20 <= 0) return null;
    const base = tightBases(ctx, p.minLen, p.maxLen, p.maxRangeAtr, p.maxRangePct).find((x) => {
      const avg = num(f.avgVol50[x.from]);
      return (
        b.close > x.hi &&
        avg != null &&
        x.lo >= Math.min(pe10, pe20) - 0.5 * x.atr &&
        x.lo <= Math.max(pe10, pe20) + p.maxAboveEmaAtr * x.atr &&
        meanVolume(f, x.from, i - 1) < avg
      );
    });
    if (!base) return null;
    return {
      order: { type: "next_open" },
      stop: stopBelow(base.lo, atr, p.stopBufferAtr, "base_low", "base low"),
      details: { baseLen: base.len, baseHigh: round(base.hi), baseLow: round(base.lo), baseRangeAtr: round((base.hi - base.lo) / base.atr), relVol: round(relVol) },
    };
  },
};

export const exhaustionExtension: SignalSetup<{ ext10: number; ext20: number; climaxRangeAtr: number; climaxRelVol: number; upDays: number }> = {
  id: "kell_exhaustion_extension",
  label: "Exhaustion Extension",
  kind: "trim",
  source: "kell",
  allowedStages: null,
  defaults: { ext10: 3, ext20: 5, climaxRangeAtr: 2, climaxRelVol: 2, upDays: 3 },
  detect(ctx, p) {
    const { f, i } = ctx;
    const { b, prev, atr, relVol } = core(ctx);
    const x10 = num(f.ext10[i]);
    const x20 = num(f.ext20[i]);
    if (!prev || atr == null || x10 == null || x20 == null || !(x10 >= p.ext10 || x20 >= p.ext20)) return null;
    const gap = b.open > prev.high;
    const wide = b.high - b.low >= p.climaxRangeAtr * atr;
    let ups = 0;
    for (let k = i - 1; k >= 1 && f.bars[k].close > f.bars[k - 1].close; k--) ups++;
    const volClimax = relVol != null && relVol >= p.climaxRelVol && ups >= p.upDays;
    if (!gap && !wide && !volClimax) return null;
    return { ext10: round(x10), ext20: round(x20), gapUp: gap, wideRange: wide, volumeClimax: volClimax };
  },
};

export const wedgeDrop: SignalSetup<{ minLen: number; maxLen: number; contraction: number; minRelVol: number }> = {
  id: "kell_wedge_drop",
  label: "Wedge Drop",
  kind: "exit",
  source: "kell",
  allowedStages: ["3A", "3B"],
  defaults: { minLen: 8, maxLen: 30, contraction: 0.7, minRelVol: 1.2 },
  detect(ctx, p) {
    const { f, i } = ctx;
    const { b, e10, e20, relVol } = core(ctx);
    if (e10 == null || e20 == null || relVol == null || relVol < p.minRelVol || !(b.close < e10 && b.close < e20)) return null;
    const w = findWedge(f, i - 1, i, i, "rising", p.minLen, p.maxLen, p.contraction);
    if (!w || b.close >= w.lineAt) return null;
    return { wedgeLen: w.end - w.start + 1, wedgeLine: round(w.lineAt), relVol: round(relVol) };
  },
};

export const bearishBaseNBreak: SignalSetup<{ minLen: number; maxLen: number; maxRangeAtr: number; maxRangePct: number }> = {
  id: "kell_bearish_base_n_break",
  label: "Bearish Base 'n Break",
  kind: "exit",
  source: "kell",
  allowedStages: ["4A"],
  defaults: { minLen: 5, maxLen: 20, maxRangeAtr: 2.5, maxRangePct: 0.1 },
  detect(ctx, p) {
    const { f, i } = ctx;
    const { b } = core(ctx);
    const ps20 = num(f.slope20[i - 1]);
    const pe10 = num(f.ema10[i - 1]);
    const pe20 = num(f.ema20[i - 1]);
    if (ps20 == null || pe10 == null || pe20 == null || ps20 >= 0 || i < 2 || b.close >= f.bars[i - 1].low) return null;
    const base = tightBases(ctx, p.minLen, p.maxLen, p.maxRangeAtr, p.maxRangePct).find((x) => b.close < x.lo && x.hi <= Math.max(pe10, pe20) + 0.5 * x.atr);
    if (!base) return null;
    return { baseLen: base.len, baseLow: round(base.lo) };
  },
};

export const failedCrossback: SignalSetup<{ touchAtr: number }> = {
  id: "kell_failed_crossback",
  label: "Failed EMA Crossback (bearish)",
  kind: "avoid",
  source: "kell",
  allowedStages: ["3B"],
  defaults: { touchAtr: 0.25 },
  detect(ctx, p) {
    const { f, i } = ctx;
    const { b, atr, e20 } = core(ctx);
    const s20 = num(f.slope20[i]);
    if (atr == null || e20 == null || s20 == null || s20 >= 0) return null;
    if (ctx.stages[i] !== "3B") return null;
    if (b.high >= e20 - p.touchAtr * atr && b.close < e20) return { highVsEma20Atr: round((b.high - e20) / atr) };
    return null;
  },
};
