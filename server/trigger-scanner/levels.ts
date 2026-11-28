/**
 * Logical levels and the stop rule (Don: "Stops are ALWAYS at an area of resistance, 5d, 10d, 20d, drendel gap, prev
 * LOD etc"; "5% is the MAX ... lower the risk the better").
 *
 * Levels at a bar: the 5/10/20/50-day SMA, the 10/20-day EMA, the previous day's low and high, every classified gap
 * edge (daily.ts), and the session's VWAP, opening-range low/high and low/high of day through that bar.
 *
 * The stop for a long is under the NEAREST level below the entry that is support (for a gap: its role must be
 * support; any other level below the price is support by position, so a broken level has flipped), skipping
 * levels closer than minStopAdr (inside the day's noise). The stop sits just past the level: level - min(stopBufferAdr
 * x ADR, stopBufferMaxPct % of the level). Risk = entry to stop, in % and in ADR. When the nearest usable level
 * puts the risk past maxRiskPct the candidate is refused: no logical level inside 5%. A short mirrors it.
 */
import type { DailyContext, Level, LevelName, Side, StopPick } from "./types";
import type { SessionState } from "./session";

export function dailyLevels(ctx: DailyContext): Level[] {
  const out: Level[] = [];
  const add = (name: LevelName, price: number | null) => {
    if (price !== null && Number.isFinite(price) && price > 0) out.push({ name, price });
  };
  add("sma5", ctx.sma5);
  add("sma10", ctx.sma10);
  add("sma20", ctx.sma20);
  add("sma50", ctx.sma50);
  add("ema10", ctx.ema10);
  add("ema20", ctx.ema20);
  add("prev_low", ctx.prevLow);
  add("prev_high", ctx.prevHigh);
  for (const g of ctx.gaps) out.push({ name: "gap", price: g.edge, gap: { date: g.date, dir: g.dir, state: g.state, role: g.role } });
  return out;
}

/** Daily levels plus the session's own, as of bar i (inclusive). */
export function levelsAt(ctx: DailyContext, s: SessionState, i: number): Level[] {
  const out = dailyLevels(ctx);
  out.push({ name: "vwap", price: s.vwap[i] });
  if (s.orHigh !== null && s.orLow !== null && i >= s.orEnd) {
    out.push({ name: "range_low", price: s.orLow });
    out.push({ name: "range_high", price: s.orHigh });
  }
  out.push({ name: "low_of_day", price: s.lod[i] });
  out.push({ name: "high_of_day", price: s.hod[i] });
  return out;
}

/**
 * How much a level matters (Don: "a very logical exit at an sma, vwap etc"; the brief: weigh the 20/50-day, the
 * prior day's high/low and gap edges over the 5 and 10-day). heavy 2: the 20 and 50-day SMA, the 20-day EMA, the
 * previous high/low, a gap edge, a post-gap consolidation edge; intraday 1: VWAP, the opening range, the day's
 * low/high; light 0: the 5 and 10-day SMA and the 10-day EMA (they sit inside a few days' noise).
 */
const HEAVY = new Set<string>(["sma20", "sma50", "ema20", "prev_low", "prev_high", "gap", "consolidation_low", "consolidation_high"]);
const INTRADAY = new Set<string>(["vwap", "range_low", "range_high", "low_of_day", "high_of_day"]);
export function levelWeight(name: string): 0 | 1 | 2 {
  return HEAVY.has(name) ? 2 : INTRADAY.has(name) ? 1 : 0;
}

export interface StopRule {
  maxRiskPct: number;
  minStopAdr: number;
  stopBufferAdr: number;
  stopBufferMaxPct: number;
  companyAdr: number;
}

/** Whether a level can hold a stop for this side at this entry (right side, and a gap's role fits). */
export function rightSide(l: Level, side: Side, entry: number): boolean {
  if (side === "long") return l.price < entry && (!l.gap || l.gap.role === "support");
  return l.price > entry && (!l.gap || l.gap.role === "resistance");
}

export function pickStop(side: Side, entry: number, levels: Level[], adr: number, r: StopRule): StopPick {
  const sign = side === "long" ? 1 : -1;
  const below = levels.filter((l) => (side === "long" ? l.price < entry : l.price > entry));
  const ranked = below.sort((a, b) => sign * (b.price - a.price)); // nearest first
  const considered: StopPick["considered"] = [];
  let pick: Level | undefined;
  let stop = NaN;
  for (const l of ranked) {
    const distPct = (Math.abs(entry - l.price) / entry) * 100;
    if (!rightSide(l, side, entry)) { considered.push({ name: l.name, price: l.price, distPct, skipped: "wrong_role" }); continue; }
    if (adr > 0 && Math.abs(entry - l.price) < r.minStopAdr * adr) { considered.push({ name: l.name, price: l.price, distPct, skipped: "too_close" }); continue; }
    const buffer = Math.min(r.stopBufferAdr * adr, (r.stopBufferMaxPct / 100) * l.price);
    const s = l.price - sign * Math.max(0, buffer);
    const risk = (Math.abs(entry - s) / entry) * 100;
    if (risk > r.maxRiskPct) { considered.push({ name: l.name, price: l.price, distPct, skipped: "too_far" }); break; }
    considered.push({ name: l.name, price: l.price, distPct });
    pick = l;
    stop = s;
    break;
  }
  if (!pick) {
    const usable = considered.some((c) => c.skipped !== "wrong_role");
    return { ok: false, refused: usable ? "no_level_inside_max" : "no_level", company: [], considered };
  }
  const p = pick;
  const company = levels
    .filter((l) => l !== p && Math.abs(l.price - p.price) <= r.companyAdr * adr && Math.abs(l.price - p.price) / p.price > 1e-4 && rightSide(l, side, entry))
    .map((l) => l.name);
  return {
    ok: true,
    level: pick,
    stop,
    riskPct: (Math.abs(entry - stop) / entry) * 100,
    riskAdr: adr > 0 ? Math.abs(entry - stop) / adr : NaN,
    company: [...new Set(company)],
    considered,
  };
}
