/**
 * Gap and go on hand-made daily and 5-minute series: the gap-day rule, held / failed, the n-day window, the GO
 * trigger (day 3 and day 0 without a double fire with orb_breakout), the stop choice and the 5% refusal, the repeat
 * rule and its cap, the short mirror, the earnings fact, and the precompute cost. No network, no database.
 */
import assert from "node:assert/strict";
import { buildDailyContext } from "./daily";
import { earningsGapFact, gapAndGo, gapDay, precomputeGapGo, type PriorFire } from "./gap";
import { bars, ctx, DATE, noRotation, regime } from "./fixtures";
import { Dedupe, runPass } from "./scan";
import { buildSession } from "./session";
import { DEFAULTS } from "./settings";
import type { DailyBar, GapGo } from "./types";

type D = [number, number, number, number, number]; // open, high, low, close, volume
type Row = [number, number, number, number, number];
const st = DEFAULTS;

/** 60 quiet sessions at ~100 (high 101, low 99: ADR ~2%), then the given sessions, dated as weekdays. */
function series(tail: D[], base = 60): DailyBar[] {
  const rows: D[] = [...Array.from({ length: base }, () => [100, 101, 99, 100, 1_000_000] as D), ...tail];
  const dates: string[] = [];
  for (let d = new Date("2026-11-23T12:00:00Z"); dates.length < rows.length; d.setUTCDate(d.getUTCDate() - 1)) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) dates.unshift(d.toISOString().slice(0, 10));
  }
  return rows.map(([open, high, low, close, volume], k) => ({ date: dates[k], open, high, low, close, volume }));
}
const GAP: D = [106, 109, 105.5, 108, 3_000_000]; // open 4.95% and ~2.5 ADR over the prior high 101; 3x volume
const CONS: D[] = [[108, 108.5, 106, 107, 1_200_000], [107, 108, 106.2, 107.2, 1_100_000]];

// ---- the gap day ----------------------------------------------------------------------------------------------------
{
  const b = series([GAP]);
  const g = gapDay(b, b.length - 1, st)!;
  assert.equal(g.dir, "up");
  assert.equal(g.edge, 101, "edge = the prior session's HIGH");
  assert.ok(Math.abs(g.gapPct - 4.95) < 0.01 && g.gapAdr > 2 && Math.abs(g.volMult - 3) < 1e-9);
  assert.equal(gapDay(series([[106, 109, 105.5, 108, 1_500_000]]), 60, st), null, "weak volume: ignored");
  assert.equal(gapDay(series([[106, 109, 105.5, 106.5, 3_000_000]]), 60, st), null, "closed in the lower half");
  assert.equal(gapDay(series([[104, 106, 103.5, 105.5, 3_000_000]]), 60, st), null, "under 4%");
  // open above the prior close but below the prior high: no gap by default; a gap with gapFrom = prior_close
  const pc = series([[100, 105, 99, 100, 1_000_000], [104.5, 107, 104, 106.5, 3_000_000]]);
  assert.equal(gapDay(pc, 61, st), null, "under the prior high (105): not a true gap");
  const byClose = gapDay(pc, 61, { ...st, gapFrom: "prior_close" })!;
  assert.deepEqual([byClose.dir, byClose.edge], ["up", 100], "measured from the prior close when set");
  const dn = gapDay(series([[94, 94.5, 91, 91.8, 3_000_000]]), 60, st)!;
  assert.deepEqual([dn.dir, dn.edge], ["down", 99], "gap down under the prior LOW");
}

// ---- still valid: held, within goMaxDays (the gap day is day 0) -----------------------------------------------------------
{
  const held = precomputeGapGo(series([GAP, ...CONS]), st, { adrNow: 2.2 }).up!;
  assert.deepEqual([held.day, held.edge, held.goLevel, held.goFrom, held.consLow, held.consHigh, held.consDays], [3, 101, 109, "gap_day_high", 106, 108.5, 2]);
  assert.ok(Math.abs(held.consRangeAdr! - 2.5 / 2.2) < 1e-9, "range of the days since the gap, in ADR");
  assert.ok(Math.abs(held.pullbackAdr - 3 / 2.2) < 1e-9, "from the high since the gap (109) to the low after it (106)");
  const quiet = (n: number): D[] => Array.from({ length: n }, () => [107, 108, 106, 107, 1_000_000] as D);
  assert.equal(precomputeGapGo(series([GAP, ...quiet(9)]), st, { adrNow: 2.2 }).up!.day, 10, "day goMaxDays: allowed");
  assert.equal(precomputeGapGo(series([GAP, ...quiet(10)]), st, { adrNow: 2.2 }).up, null, "day goMaxDays + 1: not");
  assert.equal(precomputeGapGo(series([GAP, [107, 107.5, 100, 100.5, 2e6], [101, 106, 100.8, 105, 1e6]]), st, { adrNow: 2.2 }).up, null,
    "a close back through the edge killed it, and it is not raised again from that gap");
  assert.equal(precomputeGapGo(series([GAP, [107, 107.5, 100.8, 101.5, 2e6], ...CONS]), st, { adrNow: 2.2 }).up!.day, 4, "a dip under the edge that CLOSED above it held");
  const higher = precomputeGapGo(series([GAP, [108, 110.5, 107, 110, 2e6], [110, 110.2, 108.4, 108.8, 1e6]]), st, { adrNow: 2.2 }).up!;
  assert.deepEqual([higher.goLevel, higher.goFrom], [110.5, "consolidation_high"]);
}

// ---- the earnings fact -------------------------------------------------------------------------------------------------
{
  const b = series([GAP]);
  const gd = b[60].date, before = b[59].date, wayBefore = b[55].date;
  const sessions = b.map((x) => x.date);
  assert.equal(earningsGapFact(gd, sessions, [gd], 1), true, "the gap is the reaction session");
  assert.equal(earningsGapFact(gd, sessions, [before], 1), true, "one session after it");
  assert.equal(earningsGapFact(gd, sessions, [wayBefore], 1), false);
  assert.equal(earningsGapFact(gd, sessions, [], 1), false, "a fresh calendar with no report");
  assert.equal(earningsGapFact(gd, sessions, null, 1), "unknown", "calendar not fresh");
  assert.equal(buildDailyContext("X", b, { earningsReactions: null })!.earningsToday, "unknown");
}

// ---- the GO trigger on day 3 -----------------------------------------------------------------------------------------
const G = (over: Partial<GapGo> = {}): GapGo => ({
  dir: "up", date: "2026-11-19", day: 3, edge: 101, gapPct: 4.95, gapAdr: 2.5, volMult: 3, goLevel: 109, goFrom: "gap_day_high",
  consLow: 106, consHigh: 108.5, consDays: 2, consRangeAdr: 1.14, pullbackAdr: 1.4, earningsGap: "unknown", fires: 0, repeatOk: true, repeatWhy: null, ...over,
});
const gctx = (g: GapGo | null, down: GapGo | null = null) => ctx({ adr: 2.2, adrPct: 2.1, prevClose: 107.2, prevHigh: 108, prevLow: 106.2, sma5: null, sma10: null, gapGo: { up: g, down } });
const pre: Row[] = [[108.9, 109, 108.85, 108.95, 60000], [108.95, 109.05, 108.9, 109, 30000], [109, 109.05, 108.9, 108.95, 30000], [108.95, 109.05, 108.9, 109, 20000]];
const go: Row = [109, 109.4, 108.95, 109.3, 80000];
const fire = (c: ReturnType<typeof gctx>, rows: Row[]) => {
  const s = buildSession(DATE, bars(rows));
  return gapAndGo({ ctx: c, s, i: s.bars.length - 1, settings: st });
};
{
  const hits = fire(gctx(G()), [...pre, go]);
  assert.deepEqual(hits.map((h) => [h.setupKey, h.side, h.variant]), [["gap_and_go", "long", "gap:2026-11-19"]]);
  assert.deepEqual([hits[0].facts.daysSinceGap, hits[0].facts.goLevel, hits[0].facts.goFrom, hits[0].facts.gapEdge, hits[0].facts.tight], [3, 109, "gap_day_high", 101, 1]);
  assert.deepEqual(fire(gctx(G()), [...pre, [109, 109.2, 108.95, 109.08, 80000]]), [], "not by 0.05 ADR");
  assert.deepEqual(fire(gctx(G()), [...pre, [109, 109.4, 108.95, 109.3, 15000]]), [], "thin volume");
  assert.deepEqual(fire(gctx(G()), [...pre, go, [109.3, 109.6, 109.2, 109.5, 80000]]), [], "only the first close over it today");
  assert.deepEqual(fire(gctx(G({ repeatOk: false, repeatWhy: "cap" })), [...pre, go]), [], "repeat not allowed");

  // the stop: VWAP and today's low are inside the 0.25 ADR noise; the tight flag's low (106) beats the far gap edge (101)
  const res = runPass({ date: DATE, contexts: new Map([["GAPG", gctx(G())]]), bars: new Map([["GAPG", bars([...pre, go])]]), watch: new Map(), regime: regime(), rotation: noRotation, settings: st, dedupe: new Dedupe(), evaluated: new Map() });
  const c = res.candidates.find((x) => x.setupKey === "gap_and_go")!;
  assert.equal(c.stopLevel, "consolidation_low");
  assert.equal(c.stopLevelPrice, 106);
  assert.ok(c.riskPct < 5 && c.riskPct > 3);
  assert.equal(c.facts.company, "tight consolidation", "a tight flag's low earns the company point");
  assert.equal(c.gradeComponents.exitLogic, 1);
  // a loose consolidation: no point
  const loose = runPass({ date: DATE, contexts: new Map([["GAPG", gctx(G({ consRangeAdr: 2.5 }))]]), bars: new Map([["GAPG", bars([...pre, go])]]), watch: new Map(), regime: regime(), rotation: noRotation, settings: st, dedupe: new Dedupe(), evaluated: new Map() });
  assert.equal(loose.candidates.find((x) => x.setupKey === "gap_and_go")!.facts.company, null);
  // nothing valid within 5%: the consolidation low under the edge is not a level, the edge is 7.6% away -> refused
  const far = runPass({ date: DATE, contexts: new Map([["GAPG", gctx(G({ consLow: 100.5 }))]]), bars: new Map([["GAPG", bars([...pre, go])]]), watch: new Map(), regime: regime(), rotation: noRotation, settings: st, dedupe: new Dedupe(), evaluated: new Map() });
  assert.equal(far.candidates.filter((x) => x.setupKey === "gap_and_go").length, 0);
  assert.equal(far.refused["gap_and_go:no_level_inside_max"], 1);
  // once per gap per day
  const d = new Dedupe();
  const once = (rows: Row[]) => runPass({ date: DATE, contexts: new Map([["GAPG", gctx(G())]]), bars: new Map([["GAPG", bars(rows)]]), watch: new Map(), regime: regime(), rotation: noRotation, settings: st, dedupe: d, evaluated: new Map() });
  assert.equal(once([...pre, go]).candidates.filter((x) => x.setupKey === "gap_and_go").length, 1);
  assert.equal(once([...pre, go]).candidates.filter((x) => x.setupKey === "gap_and_go").length, 0);
}

// ---- end to end from daily bars: the precompute feeds the trigger ---------------------------------------------------------------
{
  const c = buildDailyContext("GAPE", series([GAP, ...CONS]))!;
  assert.equal(c.gapGo.up!.day, 3);
  const res = runPass({ date: DATE, contexts: new Map([["GAPE", c]]), bars: new Map([["GAPE", bars([...pre, [109, 109.6, 108.95, 109.5, 90000]])]]), watch: new Map(), regime: regime(), rotation: noRotation, settings: st, dedupe: new Dedupe(), evaluated: new Map() });
  assert.ok(res.candidates.some((x) => x.setupKey === "gap_and_go" && x.facts.daysSinceGap === 3), "a day-3 go from daily bars");
}

// ---- day 0: today's own gap; the go level is the opening-range high; no double fire with orb_breakout ------------------------
{
  const c0 = ctx({ adr: 2, adrPct: 2, prevClose: 100, prevHigh: 101, prevLow: 99, avgVol50: 1_000_000 });
  const day0: Row[] = [[106, 107, 105.8, 106.8, 150000], [106.8, 107.5, 106.5, 107.2, 150000], [107.2, 107.4, 106.6, 107, 150000], [107, 107.9, 106.9, 107.8, 150000]];
  const res = runPass({ date: DATE, contexts: new Map([["GAP0", c0]]), bars: new Map([["GAP0", bars(day0)]]), watch: new Map(), regime: regime(), rotation: noRotation, settings: st, dedupe: new Dedupe(), evaluated: new Map() });
  const keys = res.candidates.map((x) => x.setupKey);
  assert.ok(keys.includes("gap_and_go"), keys.join());
  assert.ok(!keys.includes("orb_breakout"), "only gap_and_go is raised on that bar");
  const g0 = res.candidates.find((x) => x.setupKey === "gap_and_go")!;
  assert.deepEqual([g0.facts.daysSinceGap, g0.facts.goFrom, g0.facts.goLevel, g0.facts.also], [0, "opening_range_high", 107.5, "orb_breakout"]);
  const noGap = ctx({ adr: 2, adrPct: 2, prevClose: 105.5, prevHigh: 106, prevLow: 104, avgVol50: 1_000_000 });
  const plain = runPass({ date: DATE, contexts: new Map([["NOGP", noGap]]), bars: new Map([["NOGP", bars(day0)]]), watch: new Map(), regime: regime(), rotation: noRotation, settings: st, dedupe: new Dedupe(), evaluated: new Map() });
  assert.ok(plain.candidates.some((x) => x.setupKey === "orb_breakout") && !plain.candidates.some((x) => x.setupKey === "gap_and_go"), "no gap: ORB as usual");
  const quietVol = day0.map((r) => [r[0], r[1], r[2], r[3], 20000] as Row);
  assert.ok(!fire(c0 as any, quietVol).length, "day 0 on thin volume: no gap");
}

// ---- the repeat rule and its cap ----------------------------------------------------------------------------------------
{
  const b = series([GAP, ...CONS, [107.5, 112, 107.4, 111.5, 2e6], [111.5, 112, 109.6, 110, 1e6], [110, 110.5, 109.4, 110.2, 1e6]]);
  const fired: PriorFire[] = [{ gapDate: b[60].date, marketDate: b[63].date, goLevel: 109, side: "long" }];
  const after = precomputeGapGo(b, st, { adrNow: 2.2, fires: fired }).up!;
  assert.deepEqual([after.fires, after.repeatOk, after.goLevel], [1, true, 112], "a 1 ADR pullback and a higher go level: may fire again");
  const noPull = series([GAP, ...CONS, [107.5, 112, 107.4, 111.5, 2e6], [111.5, 112.5, 111.4, 112.4, 1e6]]);
  const np = precomputeGapGo(noPull, st, { adrNow: 2.2, fires: [{ ...fired[0], gapDate: noPull[60].date, marketDate: noPull[63].date }] }).up!;
  assert.equal(np.repeatOk, false, "no pullback since the fire");
  const capped = precomputeGapGo(b, st, { adrNow: 2.2, fires: [...fired, { ...fired[0], marketDate: b[64].date, goLevel: 112 }] }).up!;
  assert.deepEqual([capped.repeatOk, capped.repeatWhy], [false, "fired 2 times (max 2)"]);
}

// ---- the short mirror --------------------------------------------------------------------------------------------------
{
  const GD: D = [94, 94.5, 91, 91.8, 3_000_000]; // under the prior low 99
  const g = precomputeGapGo(series([GD, [92, 94, 91.4, 93, 1.2e6], [93, 93.8, 91.5, 92.8, 1.1e6]]), st, { adrNow: 2.2 }).down!;
  assert.deepEqual([g.dir, g.edge, g.goLevel, g.goFrom, g.consHigh], ["down", 99, 91, "gap_day_low", 94]);
  assert.equal(precomputeGapGo(series([GD, [92, 99.5, 91.5, 99.2, 2e6]]), st, { adrNow: 2.2 }).down, null, "closed back above the edge: failed");
  const down: GapGo = { ...G(), dir: "down", edge: 99, goLevel: 91, goFrom: "gap_day_low", consLow: 91.4, consHigh: 94, consRangeAdr: 1.2 };
  const dpre: Row[] = [[91.1, 91.15, 91, 91.05, 60000], [91.05, 91.1, 90.95, 91, 30000], [91, 91.1, 90.95, 91.05, 30000], [91.05, 91.1, 90.95, 91, 20000]];
  const res = runPass({ date: DATE, contexts: new Map([["GAPD", ctx({ adr: 2.2, adrPct: 2.4, prevClose: 92.8, prevHigh: 93.8, prevLow: 91.5, sma5: null, sma10: null, gapGo: { up: null, down } })]]), bars: new Map([["GAPD", bars([...dpre, [91, 91.05, 90.6, 90.7, 80000]])]]), watch: new Map(), regime: regime("DEFENSIVE"), rotation: noRotation, settings: st, dedupe: new Dedupe(), evaluated: new Map() });
  const c = res.candidates.find((x) => x.setupKey === "gap_down_and_go")!;
  assert.ok(c, "short go under the lowest low");
  assert.deepEqual([c.side, c.stopLevel, c.facts.company], ["short", "consolidation_high", "tight consolidation"]);
  assert.ok(c.stopPrice > 94);
}

// ---- the precompute stays inside the daily budget (one pass over the recent daily bars per name) ---------------------------
{
  const b = series([GAP, ...CONS], 72);
  const t0 = performance.now();
  for (let k = 0; k < 1750; k++) buildDailyContext("S" + k, b);
  const ms = performance.now() - t0;
  assert.ok(ms < 2000, `1,750 daily contexts with the gap precompute in ${ms.toFixed(0)} ms`);
  console.log(`gap precompute: 1,750 names x 75 sessions in ${ms.toFixed(0)} ms`);
}

console.log("trigger scanner gap and go ok");
