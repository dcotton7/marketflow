import type { SymbolFacts } from "../facts";
import { swingsAsOf } from "../facts";
import type { EntrySetup } from "./types";
import { maxHigh, meanVolume, minLow, num, round, stopBelow } from "./helpers";

/** Daily setups from spec section 4 (drafts for Don to confirm). Each is parameterized; thresholds are `defaults`. */

function smaOf(f: SymbolFacts, period: 10 | 20 | 50) {
  return period === 10 ? f.sma10 : period === 20 ? f.sma20 : f.sma50;
}

export function maReclaim(period: 10 | 20 | 50): EntrySetup<{ minBelow: number; minRelVol: number; stopBufferAtr: number }> {
  return {
    id: `ma_reclaim_${period}`,
    label: `MA reclaim (${period} SMA)`,
    kind: "entry",
    source: "library",
    allowedStages: null,
    defaults: { minBelow: 3, minRelVol: 1.0, stopBufferAtr: 0.1 },
    detect(ctx, p) {
      const { f, i } = ctx;
      const ma = smaOf(f, period);
      const b = f.bars[i];
      const m = num(ma[i]);
      const atr = num(f.atr14[i]);
      const relVol = num(f.relVol[i]);
      if (m == null || atr == null || relVol == null || relVol < p.minRelVol || b.close <= m || i < 6) return null;
      let below = 0;
      for (let k = i - 1; k >= 0; k--) {
        const mk = num(ma[k]);
        if (mk == null || f.bars[k].close >= mk) break;
        below++;
      }
      if (below < p.minBelow) return null;
      const m5 = num(ma[i - 5]);
      if (m5 == null || m < m5) return null;
      if (period === 50) {
        const s200 = num(f.sma200[i]);
        const s200p = i >= 20 ? num(f.sma200[i - 20]) : null;
        if (s200 == null || s200p == null || s200 <= s200p) return null;
      }
      const undercut = minLow(f, i - below, i);
      return {
        order: { type: "next_open" },
        stop: stopBelow(undercut.value, atr, p.stopBufferAtr, "undercut_low", "undercut low"),
        details: { closesBelow: below, relVol: round(relVol) },
      };
    },
  };
}

export const baseBreakout: EntrySetup<{ minLen: number; maxLookback: number; minDepth: number; maxDepth: number; maxFrom52High: number; minRelVol: number; maxDryUp: number; maxAbovePivot: number; stopBufferAtr: number }> = {
  id: "base_breakout",
  label: "Base breakout",
  kind: "entry",
  source: "library",
  allowedStages: null,
  defaults: { minLen: 25, maxLookback: 130, minDepth: 0.08, maxDepth: 0.35, maxFrom52High: 0.15, minRelVol: 1.5, maxDryUp: 0.8, maxAbovePivot: 0.05, stopBufferAtr: 0.1 },
  detect(ctx, p) {
    const { f, i } = ctx;
    const b = f.bars[i];
    const relVol = num(f.relVol[i]);
    const atr = num(f.atr14[i]);
    const avg = num(f.avgVol50[i]);
    if (relVol == null || atr == null || avg == null || relVol < p.minRelVol || i < p.minLen + 2) return null;
    const pivot = maxHigh(f, i - p.maxLookback, i - 1);
    if (i - pivot.index < p.minLen || b.close <= pivot.value || f.bars[i - 1].close > pivot.value) return null;
    if (b.close > pivot.value * (1 + p.maxAbovePivot)) return null;
    const low = minLow(f, pivot.index, i - 1);
    const depth = (pivot.value - low.value) / pivot.value;
    if (depth < p.minDepth || depth > p.maxDepth) return null;
    const h52 = num(f.high52[i - 1]);
    if (h52 == null || pivot.value < h52 * (1 - p.maxFrom52High)) return null;
    if (meanVolume(f, i - 5, i - 1) >= p.maxDryUp * avg) return null;
    const lastSwingLow = swingsAsOf(f.swingLows, i, pivot.index).pop();
    const stopLevel = lastSwingLow != null ? f.bars[lastSwingLow].low : minLow(f, i - 10, i - 1).value;
    return {
      order: { type: "next_open" },
      stop: stopBelow(stopLevel, atr, p.stopBufferAtr, "contraction_low", "last contraction low"),
      details: { pivot: round(pivot.value), baseLen: i - pivot.index, depth: round(depth), relVol: round(relVol) },
    };
  },
};

export const cupHandle: EntrySetup<{ minCup: number; maxCup: number; minDepth: number; maxDepth: number; minLowerThirdBars: number; minPriorRise: number; minHandle: number; maxHandle: number; maxHandleDepth: number; minRelVol: number; triggerAbove: number; stopBufferAtr: number }> = {
  id: "cup_handle",
  label: "Cup and handle",
  kind: "entry",
  source: "library",
  allowedStages: null,
  defaults: { minCup: 35, maxCup: 325, minDepth: 0.12, maxDepth: 0.35, minLowerThirdBars: 15, minPriorRise: 0.3, minHandle: 5, maxHandle: 25, maxHandleDepth: 0.12, minRelVol: 1.4, triggerAbove: 0.1, stopBufferAtr: 0.1 },
  detect(ctx, p) {
    const { f, i } = ctx;
    const b = f.bars[i];
    const relVol = num(f.relVol[i]);
    const atr = num(f.atr14[i]);
    if (relVol == null || atr == null || relVol < p.minRelVol || b.close <= f.bars[i - 1].high) return null;
    for (let h = p.minHandle; h <= p.maxHandle; h++) {
      const hs = i - h;
      const handleHigh = maxHigh(f, hs, i - 1).value;
      const trigger = handleHigh + p.triggerAbove;
      if (b.close < trigger || f.bars[i - 1].close >= trigger) continue;
      const handleLow = minLow(f, hs, i - 1).value;
      if ((handleHigh - handleLow) / handleHigh > p.maxHandleDepth) continue;
      const avgH = num(f.avgVol50[hs]);
      if (avgH == null || meanVolume(f, hs, i - 1) >= avgH) continue;
      const lip = maxHigh(f, hs - p.maxCup, hs - p.minCup);
      if (lip.index < 0) continue;
      if (handleHigh < lip.value * 0.9 || handleHigh > lip.value * 1.05) continue;
      const cupLow = minLow(f, lip.index, hs - 1);
      const depth = (lip.value - cupLow.value) / lip.value;
      if (depth < p.minDepth || depth > p.maxDepth) continue;
      const third = cupLow.value + (lip.value - cupLow.value) / 3;
      let lower = 0;
      for (let k = lip.index; k < hs; k++) if (f.bars[k].close <= third) lower++;
      if (lower < p.minLowerThirdBars) continue;
      if (handleLow < cupLow.value + (lip.value - cupLow.value) / 2) continue;
      const priorFrom = lip.index - 120;
      if (priorFrom < 0) continue;
      const priorLow = minLow(f, priorFrom, lip.index).value;
      if (lip.value < priorLow * (1 + p.minPriorRise)) continue;
      return {
        order: { type: "next_open" },
        stop: stopBelow(handleLow, atr, p.stopBufferAtr, "handle_low", "handle low"),
        details: { cupLen: hs - lip.index, cupDepth: round(depth), handleLen: h, handleDepth: round((handleHigh - handleLow) / handleHigh), relVol: round(relVol) },
      };
    }
    return null;
  },
};

export const vcp: EntrySetup<{ lookback: number; minContractions: number; maxContractions: number; maxLastDepth: number; minRelVol: number; stopBufferAtr: number }> = {
  id: "vcp",
  label: "VCP",
  kind: "entry",
  source: "library",
  allowedStages: null,
  defaults: { lookback: 80, minContractions: 2, maxContractions: 4, maxLastDepth: 0.1, minRelVol: 1.5, stopBufferAtr: 0.1 },
  detect(ctx, p) {
    const { f, i } = ctx;
    const b = f.bars[i];
    const relVol = num(f.relVol[i]);
    const atr = num(f.atr14[i]);
    if (relVol == null || atr == null || relVol < p.minRelVol) return null;
    const highs = swingsAsOf(f.swingHighs, i, i - p.lookback);
    const lows = swingsAsOf(f.swingLows, i, i - p.lookback);
    const cons: { hi: number; lo: number; hiIdx: number; loIdx: number; depth: number; vol: number }[] = [];
    for (const h of highs) {
      const l = lows.find((j) => j > h);
      if (l == null) continue;
      const nextHigh = highs.find((j) => j > h);
      if (nextHigh != null && nextHigh < l) continue;
      const hi = f.bars[h].high;
      const lo = f.bars[l].low;
      cons.push({ hi, lo, hiIdx: h, loIdx: l, depth: (hi - lo) / hi, vol: meanVolume(f, h, l) });
    }
    const seq = cons.slice(-p.maxContractions);
    let start = seq.length - 1;
    while (start > 0 && seq[start - 1].depth > seq[start].depth) start--;
    const run = seq.slice(start);
    if (run.length < p.minContractions) return null;
    const last = run[run.length - 1];
    if (last.depth > p.maxLastDepth || run[run.length - 1].vol >= run[0].vol) return null;
    const pivot = maxHigh(f, last.hiIdx, i - 1).value;
    if (b.close <= pivot || f.bars[i - 1].close > pivot) return null;
    return {
      order: { type: "next_open" },
      stop: stopBelow(last.lo, atr, p.stopBufferAtr, "contraction_low", "last contraction low"),
      details: { contractions: run.length, depths: run.map((c) => (c.depth * 100).toFixed(1)).join("/"), pivot: round(pivot), relVol: round(relVol) },
    };
  },
};

export function pullbackMa(period: 10 | 20): EntrySetup<{ nearPct: number; nearAtr: number; minAdvance: number; touchWindow: number; stopBufferAtr: number }> {
  return {
    id: `pullback_${period}sma`,
    label: `Pullback to ${period} SMA`,
    kind: "entry",
    source: "library",
    allowedStages: null,
    defaults: { nearPct: 0.01, nearAtr: 0.5, minAdvance: 0.1, touchWindow: 3, stopBufferAtr: 0.1 },
    detect(ctx, p) {
      const { f, i } = ctx;
      const b = f.bars[i];
      const atr = num(f.atr14[i]);
      if (atr == null || i < 65 || b.close <= f.bars[i - 1].high) return null;
      const s10 = num(f.sma10[i]);
      const s20 = num(f.sma20[i]);
      const s50 = num(f.sma50[i]);
      if (s10 == null || s20 == null || s50 == null || !(s10 > s20 && s20 > s50)) return null;
      for (const s of [f.sma10, f.sma20, f.sma50]) {
        const a = num(s[i]);
        const z = num(s[i - 5]);
        if (a == null || z == null || a <= z) return null;
      }
      const ma = smaOf(f, period);
      const touches: number[] = [];
      for (let k = i - p.touchWindow; k < i; k++) {
        const m = num(ma[k]);
        const a = num(f.atr14[k]);
        if (m == null || a == null) continue;
        const tol = Math.max(m * p.nearPct, p.nearAtr * a);
        if (f.bars[k].low <= m + tol && f.bars[k].close >= m - tol) touches.push(k);
      }
      if (!touches.length) return null;
      if (period === 10) {
        const m20 = num(f.sma20[touches[0]]);
        if (m20 != null && f.bars[touches[0]].low <= m20) return null;
      }
      const adv = maxHigh(f, i - 25, i - 1).value / minLow(f, i - 60, i - 20).value - 1;
      if (adv < p.minAdvance) return null;
      const avg = num(f.avgVol50[touches[0]]);
      if (avg == null || meanVolume(f, touches[0], touches[touches.length - 1]) >= avg) return null;
      const pull = minLow(f, touches[0], i);
      return {
        order: { type: "next_open" },
        stop: stopBelow(pull.value, atr, p.stopBufferAtr, "pullback_low", "pullback low"),
        details: { touchDays: touches.length, advance: round(adv) },
      };
    },
  };
}

export const gapEpisodicPivot: EntrySetup<{ minGap: number; minRelVol: number; maxPriorRunup: number; stopBufferAtr: number }> = {
  id: "gap_episodic_pivot",
  label: "Earnings gap / episodic pivot",
  kind: "entry",
  source: "library",
  allowedStages: null,
  defaults: { minGap: 0.08, minRelVol: 3, maxPriorRunup: 0.3, stopBufferAtr: 0.1 },
  detect(ctx, p) {
    const { f, i } = ctx;
    const b = f.bars[i];
    const prev = f.bars[i - 1];
    const relVol = num(f.relVol[i]);
    const atr = num(f.atr14[i]);
    if (!prev || relVol == null || atr == null || relVol < p.minRelVol || b.open < prev.close * (1 + p.minGap)) return null;
    if (b.close < b.low + (b.high - b.low) / 2 || i < 64) return null;
    const runup = prev.close / f.bars[i - 63].close - 1;
    if (runup > p.maxPriorRunup) return null;
    return {
      order: { type: "buy_stop", price: b.high + 0.01, validSessions: 1 },
      stop: stopBelow(b.low, atr, p.stopBufferAtr, "gap_day_low", "gap day low"),
      details: { gapPct: round(b.open / prev.close - 1), relVol: round(relVol), priorRunup63: round(runup), catalyst: "unknown (no point-in-time earnings dates; phase 3 judge)" },
    };
  },
};
