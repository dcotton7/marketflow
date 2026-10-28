import type { SymbolFacts } from "./facts";
import { swingsAsOf } from "./facts";
import type { SubStage } from "./types";

/**
 * Kell price cycle (spec section 3): Weinstein's four stages split into 1A–4C, read from the 10/20 EMA. A state
 * machine, so labels don't flicker: a move needs its conditions on `hysteresis` consecutive closes (2C and 4C are set
 * on the day), and only the transitions in ALLOWED_TRANSITIONS exist.
 *
 * Deviations from the draft, for Don to confirm: when a label falls behind a clear trend (e.g. still "1A" during a
 * strong uptrend) it may advance one step along the normal path on trend conditions alone; and 3B → 3A exists, so a
 * distribution that reclaims the EMAs isn't forced through stage 4.
 */

export const CYCLE_VERSION = "kell-cycle-v0";

export interface CycleParams {
  slopeFlat: number;
  slopeFallingSlowly: number;
  gap1A: number;
  ext2C10: number;
  ext2C20: number;
  ext4C10: number;
  ext4C20: number;
  ext2BMax: number;
  hysteresis: number;
  climaxRangeAtr: number;
  climaxRelVol4C: number;
  wideSwingsRatio: number;
  contractionRangeAtr: number;
  contractionAtrRatio: number;
}

export const DEFAULT_CYCLE_PARAMS: CycleParams = {
  slopeFlat: 0.1,
  slopeFallingSlowly: -0.3,
  gap1A: 0.5,
  ext2C10: 3,
  ext2C20: 5,
  ext4C10: -3,
  ext4C20: -5,
  ext2BMax: 3,
  hysteresis: 2,
  climaxRangeAtr: 2,
  climaxRelVol4C: 2.5,
  wideSwingsRatio: 1.2,
  contractionRangeAtr: 4,
  contractionAtrRatio: 0.8,
};

export const ALLOWED_TRANSITIONS: Record<SubStage, SubStage[]> = {
  "1A": ["1B"],
  "1B": ["2A", "1A"],
  "2A": ["2B", "1B"],
  "2B": ["2C", "3A"],
  "2C": ["2B", "3A"],
  "3A": ["3B", "2B"],
  "3B": ["4A", "3A"],
  "4A": ["4B", "3B"],
  "4B": ["4C", "1A"],
  "4C": ["4B", "1A"],
};

export interface CycleMeasures {
  ext10: number;
  ext20: number;
  slope10: number;
  slope20: number;
  emaOrder: "10>20" | "10<20";
  emaGap: number;
  emaCrosses20: number;
  closesAbove20Of10: number;
  higherHighs: boolean | null;
  higherLows: boolean | null;
  range10Atr: number;
  atr5Over50: number | null;
  relVol: number | null;
}

export function cycleMeasures(f: SymbolFacts, i: number): CycleMeasures | null {
  const e10 = f.ema10[i];
  const e20 = f.ema20[i];
  const atr = f.atr14[i];
  const s10 = f.slope10[i];
  const s20 = f.slope20[i];
  if (e10 == null || e20 == null || atr == null || atr <= 0 || s10 == null || s20 == null || i < 20) return null;
  const b = f.bars;
  let crosses = 0;
  for (let k = i - 19; k <= i; k++) {
    const a = f.ema20[k - 1];
    const c = f.ema20[k];
    if (a == null || c == null) continue;
    if (Math.sign(b[k].close - c) !== Math.sign(b[k - 1].close - a)) crosses++;
  }
  let above = 0;
  for (let k = i - 9; k <= i; k++) if (f.ema20[k] != null && b[k].close > (f.ema20[k] as number)) above++;
  let hi = -Infinity;
  let lo = Infinity;
  for (let k = i - 9; k <= i; k++) {
    hi = Math.max(hi, b[k].high);
    lo = Math.min(lo, b[k].low);
  }
  const sh = swingsAsOf(f.swingHighs, i);
  const sl = swingsAsOf(f.swingLows, i);
  const hh = sh.length >= 2 ? b[sh[sh.length - 1]].high > b[sh[sh.length - 2]].high : null;
  const hl = sl.length >= 2 ? b[sl[sl.length - 1]].low > b[sl[sl.length - 2]].low : null;
  const a50 = f.atr50[i];
  return {
    ext10: (b[i].close - e10) / atr,
    ext20: (b[i].close - e20) / atr,
    slope10: s10,
    slope20: s20,
    emaOrder: e10 > e20 ? "10>20" : "10<20",
    emaGap: Math.abs(e10 - e20) / atr,
    emaCrosses20: crosses,
    closesAbove20Of10: above,
    higherHighs: hh,
    higherLows: hl,
    range10Atr: (hi - lo) / atr,
    atr5Over50: a50 && f.atr5[i] != null ? (f.atr5[i] as number) / a50 : null,
    relVol: f.relVol[i],
  };
}

function maxHigh(f: SymbolFacts, from: number, to: number): number {
  let m = -Infinity;
  for (let k = Math.max(0, from); k <= to; k++) m = Math.max(m, f.bars[k].high);
  return m;
}

function minLow(f: SymbolFacts, from: number, to: number): number {
  let m = Infinity;
  for (let k = Math.max(0, from); k <= to; k++) m = Math.min(m, f.bars[k].low);
  return m;
}

interface Ctx {
  f: SymbolFacts;
  i: number;
  m: CycleMeasures;
  p: CycleParams;
  daysInState: number;
}

const up = ({ m, f, i }: Ctx) => m.emaOrder === "10>20" && m.slope10 > 0.1 && m.slope20 > 0.1 && f.bars[i].close > (f.ema20[i] as number) && m.ext10 > 0;
const down = ({ m, f, i }: Ctx) => m.emaOrder === "10<20" && m.slope10 < -0.1 && m.slope20 < -0.1 && f.bars[i].close < (f.ema20[i] as number) && m.ext10 < 0;

function accelUp({ f, i, p }: Ctx): boolean {
  const b = f.bars;
  const atr = f.atr14[i] as number;
  if (i > 0 && b[i].open > b[i - 1].high) return true;
  if (b[i].high - b[i].low >= p.climaxRangeAtr * atr) return true;
  if (i >= 3) {
    let ok = true;
    for (let k = i - 2; k <= i; k++) if (!(b[k].close > b[k - 1].close && b[k].volume > b[k - 1].volume)) ok = false;
    if (ok) return true;
  }
  return false;
}

const COND: Record<SubStage, (c: Ctx) => boolean> = {
  "1A": (c) => {
    const { m, f, i, p } = c;
    let newLow = false;
    for (let k = i - 9; k <= i; k++) if (f.bars[k].low <= minLow(f, k - 19, k - 1)) newLow = true;
    return m.emaGap < p.gap1A && m.slope20 <= p.slopeFlat && m.slope20 >= p.slopeFallingSlowly && m.emaCrosses20 >= 2 && !newLow;
  },
  "1B": ({ m, p }) =>
    m.slope20 >= -p.slopeFlat &&
    m.closesAbove20Of10 >= 6 &&
    m.higherLows === true &&
    (m.range10Atr < p.contractionRangeAtr || (m.atr5Over50 != null && m.atr5Over50 < p.contractionAtrRatio)),
  "2A": (c) => up(c) && maxHigh(c.f, c.i - 9, c.i) >= maxHigh(c.f, c.i - 59, c.i - 10),
  "2B": (c) => {
    const { f, i, m, p } = c;
    for (let k = i - 9; k <= i; k++) {
      const a = f.ema10[k];
      const b = f.ema20[k];
      const s = f.slope20[k];
      if (a == null || b == null || s == null || !(a > b && s > 0)) return false;
    }
    return 10 - m.closesAbove20Of10 <= 1 && m.higherHighs === true && m.higherLows === true && m.ext10 >= 0 && m.ext10 <= p.ext2BMax;
  },
  "2C": (c) => {
    const { m, p } = c;
    return m.emaOrder === "10>20" && m.slope20 > p.slopeFlat && (m.ext10 >= p.ext2C10 || m.ext20 >= p.ext2C20) && accelUp(c);
  },
  "3A": ({ m, f, i, p }) =>
    f.bars[i].close < (f.ema20[i] as number) &&
    (m.higherHighs === false || (m.atr5Over50 != null && m.atr5Over50 > p.wideSwingsRatio) || m.slope10 <= p.slopeFlat),
  "3B": ({ m, p }) => m.emaOrder === "10<20" && m.slope20 <= p.slopeFlat && 10 - m.closesAbove20Of10 >= 6,
  "4A": (c) => down(c) && c.f.bars[c.i].close < minLow(c.f, c.i - 20, c.i - 1),
  "4B": ({ m, p }) => m.higherHighs === false && m.higherLows === false && m.emaOrder === "10<20" && m.slope20 < -p.slopeFlat && m.ext10 >= -3 && m.ext10 <= 0.5,
  "4C": ({ m, f, i, p }) => {
    const atr = f.atr14[i] as number;
    const climax = f.bars[i].high - f.bars[i].low >= p.climaxRangeAtr * atr || (m.relVol != null && m.relVol >= p.climaxRelVol4C);
    return m.emaOrder === "10<20" && m.slope20 < -p.slopeFlat && (m.ext10 <= p.ext4C10 || m.ext20 <= p.ext4C20) && climax;
  },
};

/** Condition for moving from `from` to `to` (beyond the target's own definition). */
function transitionHolds(from: SubStage, to: SubStage, c: Ctx): boolean {
  const { f, i, m } = c;
  const close = f.bars[i].close;
  const e10 = f.ema10[i] as number;
  const e20 = f.ema20[i] as number;
  switch (`${from}>${to}`) {
    case "1A>1B":
      return COND["1B"](c) || up(c);
    case "1B>2A":
      return COND["2A"](c) || (up(c) && close > maxHigh(f, i - 20, i - 1));
    case "1B>1A":
      return f.bars[i].low < minLow(f, i - 20, i - 1);
    case "2A>2B":
      return COND["2B"](c) || (up(c) && c.daysInState >= 10);
    case "2A>1B":
      return close < e20 && m.slope10 <= 0.1;
    case "2B>2C":
      return COND["2C"](c);
    case "2B>3A":
      return COND["3A"](c) || down(c);
    case "2C>2B":
      return m.emaOrder === "10>20" && close > e20 && m.ext10 <= 1;
    case "2C>3A":
      return close < e20;
    case "3A>3B":
      return COND["3B"](c) || down(c);
    case "3A>2B":
      return close > e10 && close > e20 && m.emaOrder === "10>20" && f.bars[i].high >= maxHigh(f, i - 20, i - 1);
    case "3B>4A":
      return COND["4A"](c);
    case "3B>3A":
      return up(c);
    case "4A>4B":
      return COND["4B"](c) || (down(c) && c.daysInState >= 5);
    case "4A>3B":
      return close > e20 && m.slope20 >= -0.1;
    case "4B>4C":
      return COND["4C"](c);
    case "4B>1A":
    case "4C>1A":
      return COND["1A"](c) || (m.emaGap < c.p.gap1A && Math.abs(m.slope20) <= c.p.slopeFlat && close > e20) || up(c);
    case "4C>4B":
      return m.emaOrder === "10<20" && m.ext10 >= -1.5;
    default:
      return false;
  }
}

const IMMEDIATE = new Set<SubStage>(["2C", "4C"]);

function initialLabel(c: Ctx): SubStage {
  const { f, i, m } = c;
  const close = f.bars[i].close;
  const e20 = f.ema20[i] as number;
  if (up(c)) return m.higherHighs && m.higherLows ? "2B" : "2A";
  if (down(c)) return m.higherHighs === false && m.higherLows === false ? "4B" : "4A";
  const r60 = i >= 60 ? close / f.bars[i - 60].close - 1 : 0;
  if (r60 > 0.1) return close > e20 ? "2B" : "3A";
  if (r60 < -0.1) return close < e20 ? "4B" : "1A";
  return close > e20 ? "1B" : "1A";
}

/** One label per bar (null until the measures exist). Label at i uses bars 0..i only. */
export function classifyCycle(f: SymbolFacts, p: CycleParams = DEFAULT_CYCLE_PARAMS): (SubStage | null)[] {
  const out: (SubStage | null)[] = new Array(f.bars.length).fill(null);
  let state: SubStage | null = null;
  let daysInState = 0;
  let pending: SubStage | null = null;
  let pendingCount = 0;
  for (let i = 0; i < f.bars.length; i++) {
    const m = i >= 60 && f.atr50[i] != null ? cycleMeasures(f, i) : null;
    if (!m) continue;
    const c: Ctx = { f, i, m, p, daysInState };
    if (state == null) {
      state = initialLabel(c);
      daysInState = 1;
      out[i] = state;
      continue;
    }
    let target: SubStage | null = null;
    for (const to of ALLOWED_TRANSITIONS[state]) {
      if (transitionHolds(state, to, c)) {
        target = to;
        break;
      }
    }
    if (target && target === pending) pendingCount++;
    else {
      pending = target;
      pendingCount = target ? 1 : 0;
    }
    if (target && (IMMEDIATE.has(target) || pendingCount >= p.hysteresis)) {
      state = target;
      daysInState = 1;
      pending = null;
      pendingCount = 0;
    } else daysInState++;
    out[i] = state;
  }
  return out;
}
