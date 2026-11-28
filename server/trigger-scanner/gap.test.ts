/**
 * Gap and go on hand-made daily and 5-minute series: the gap-day rule, held / failed, the n-day window, the pivot
 * (Don's own example; the shelf and the poke; days 1-2), the GO trigger (day 3 and day 0 without a double fire with
 * orb_breakout), the second gap-high variant and the cap, the stop choice and the 5% refusal, the repeat rule, the
 * short mirror, the earnings fact, and the precompute cost. No network, no database.
 */
import assert from "node:assert/strict";
import { buildDailyContext } from "./daily";
import { earningsGapFact, gapAndGo, gapDay, postGapPivot, precomputeGapGo, preGapBase, type PriorFire } from "./gap";
import { bars, ctx, DATE, noRotation, regime } from "./fixtures";
import { Dedupe, runPass } from "./scan";
import { buildSession } from "./session";
import { DEFAULTS, type ScannerSettings } from "./settings";
import type { DailyBar, DailyContext, GapGo } from "./types";

type D = [number, number, number, number, number]; // open, high, low, close, volume
type Row = [number, number, number, number, number];
const st = DEFAULTS;

/** `base` quiet sessions (default at ~100: high 101, low 99, ADR ~2%), then the given sessions, dated as weekdays. */
function series(tail: D[], base = 60, quiet: D = [100, 101, 99, 100, 1_000_000]): DailyBar[] {
  const rows: D[] = [...Array.from({ length: base }, () => quiet), ...tail];
  const dates: string[] = [];
  for (let d = new Date("2026-11-23T12:00:00Z"); dates.length < rows.length; d.setUTCDate(d.getUTCDate() - 1)) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) dates.unshift(d.toISOString().slice(0, 10));
  }
  return rows.map(([open, high, low, close, volume], k) => ({ date: dates[k], open, high, low, close, volume }));
}
const pass = (c: DailyContext, rows: Row[], s: ScannerSettings = st, label = regime()) =>
  runPass({ date: DATE, contexts: new Map([[c.symbol, c]]), bars: new Map([[c.symbol, bars(rows)]]), watch: new Map(), regime: label, rotation: noRotation, settings: s, dedupe: new Dedupe(), evaluated: new Map() });
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

// ---- still valid: held, within goMaxDays (the gap day is day 0); the post-gap pivot -------------------------------------------
{
  const held = precomputeGapGo(series([GAP, ...CONS]), st, { adrNow: 2.2 }).up!;
  assert.deepEqual([held.day, held.edge, held.pivot, held.pivotKind, held.gapExtreme, held.consLow, held.consHigh, held.consDays], [3, 101, 108.5, "consolidation", 109, 106, 108.5, 2],
    "the pivot is the top of the post-gap range (108.5), not the gap-day high (109)");
  assert.ok(Math.abs(held.consRangeAdr! - 2.5 / 2.2) < 1e-9);
  assert.ok(Math.abs(held.pullbackAdr - 3 / 2.2) < 1e-9, "from the high since the gap (109) to the low after it (106)");
  assert.deepEqual([held.baseDays, held.baseTop, held.gapClearedBase], [60, 101, true], "60 sessions of base under 101, cleared");
  const quiet = (n: number): D[] => Array.from({ length: n }, () => [107, 108, 106, 107, 1_000_000] as D);
  assert.equal(precomputeGapGo(series([GAP, ...quiet(9)]), st, { adrNow: 2.2 }).up!.day, 10, "day goMaxDays: allowed");
  assert.equal(precomputeGapGo(series([GAP, ...quiet(10)]), st, { adrNow: 2.2 }).up, null, "day goMaxDays + 1: not");
  assert.equal(precomputeGapGo(series([GAP, [107, 107.5, 100, 100.5, 2e6], [101, 106, 100.8, 105, 1e6]]), st, { adrNow: 2.2 }).up, null,
    "a close back through the edge killed it, and it is not raised again from that gap");
  assert.equal(precomputeGapGo(series([GAP, [107, 107.5, 100.8, 101.5, 2e6], ...CONS]), st, { adrNow: 2.2 }).up!.day, 4, "a dip under the edge that CLOSED above it held");
  const higher = precomputeGapGo(series([GAP, [108, 110.5, 107, 110, 2e6], [110, 110.2, 108.4, 108.8, 1e6]]), st, { adrNow: 2.2 }).up!;
  assert.deepEqual([higher.pivot, higher.pivotKind], [110.5, "consolidation"], "a post-gap top over the gap-day high is the pivot too");
  const early = precomputeGapGo(series([GAP, CONS[0]]), st, { adrNow: 2.2 }).up!;
  assert.deepEqual([early.day, early.pivot, early.pivotKind], [2, null, "early"], "fewer than consolMinDays sessions: no pivot yet");
}

// ---- the shelf and the poke -----------------------------------------------------------------------------------------------
{
  const d = (h: number, c: number): DailyBar => ({ date: "x", open: c, high: h, low: c - 1, close: c, volume: 1 });
  assert.deepEqual(postGapPivot([d(102, 101.5), d(101.9, 101.6), d(103.2, 101.7)], true, 0.3), { pivot: 102, kind: "shelf" },
    "a single poke to 103.2 that closed back under the 102 shelf does not move the pivot");
  assert.deepEqual(postGapPivot([d(102, 101.5), d(101.9, 101.6), d(103.2, 103)], true, 0.3), { pivot: 103.2, kind: "consolidation" }, "a poke that closed above it is the new top");
  assert.deepEqual(postGapPivot([d(102, 101.5), d(101, 100.6), d(103.2, 101.7)], true, 0.3), { pivot: 103.2, kind: "consolidation" }, "no shelf of two: the top stands");
  const lo = (l: number, c: number): DailyBar => ({ date: "x", open: c, high: c + 1, low: l, close: c, volume: 1 });
  assert.deepEqual(postGapPivot([lo(98, 98.5), lo(98.1, 98.6), lo(96.9, 98.4)], false, 0.3), { pivot: 98, kind: "shelf" }, "the short mirror");
}

// ---- Don's example: "basing for weeks at 100 and peaked on gap day at 105, then a 102 break" ---------------------------------
{
  // weeks at ~100 (high 100.5, low 99.5); gap day open 102 high 105 close 103 on 3x volume; three tight sessions 100.8-102
  const s14: ScannerSettings = { ...st, gapMinPct: 1.4 }; // his open is 1.5% over the prior high: under the 4% default
  const b = series([[102, 105, 101, 103, 3_000_000], [102, 102, 100.8, 101.5, 1.2e6], [101.5, 101.9, 101, 101.6, 1.1e6], [101.6, 102, 101.2, 101.8, 1e6]], 60, [100, 100.5, 99.5, 100, 1_000_000]);
  assert.equal(gapDay(b, 60, st), null, "with the 4% default his gap does not qualify");
  const c = buildDailyContext("DON", b, {}, 60, s14)!;
  const g = c.gapGo.up!;
  assert.deepEqual([g.day, g.edge, g.pivot, g.pivotKind, g.gapExtreme, g.baseDays, g.baseTop, g.gapClearedBase], [4, 100.5, 102, "consolidation", 105, 60, 100.5, true]);
  const intraday: Row[] = [[101.8, 101.95, 101.7, 101.9, 40000], [101.9, 101.98, 101.8, 101.85, 25000], [101.85, 101.95, 101.75, 101.9, 20000], [101.9, 101.97, 101.8, 101.92, 20000], [101.92, 102.3, 101.9, 102.2, 80000]];
  const res = pass(c, intraday, s14);
  const go = res.candidates.find((x) => x.setupKey === "gap_and_go")!;
  assert.ok(go, "a 5-minute close at 102.2 on volume fires");
  assert.deepEqual([go.variant, go.facts.pivot, go.facts.pivot_kind, go.facts.gap_day_high, go.facts.from_base, go.facts.cons_low], [`gap:${b[60].date}`, 102, "consolidation", 105, 1, 100.8]);
  assert.ok(Number(go.facts.distance_to_gap_high_adr) > 2, "the gap-day high is carried as overhead, in ADR");
  assert.ok(go.why.includes("overhead"), go.why);
  assert.ok(Number(go.facts.risk_to_cons_low_pct) > 1 && Number(go.facts.risk_to_cons_low_pct) < 1.5, "risk from the entry to the consolidation low ~1.37%");
  assert.ok(go.riskPct <= Number(go.facts.risk_to_cons_low_pct) + 0.3, "the stop is the nearest valid level, at or tighter than the consolidation low");
}

// ---- the GO trigger on day 3 (pivot given) ---------------------------------------------------------------------------------
const G = (over: Partial<GapGo> = {}): GapGo => ({
  dir: "up", date: "2026-11-19", day: 3, edge: 101, gapPct: 4.95, gapAdr: 2.5, volMult: 3, pivot: 109, pivotKind: "consolidation", gapExtreme: 109,
  consLow: 106, consHigh: 108.5, consDays: 2, consRangeAdr: 1.14, pullbackAdr: 1.4, holdsUpperHalf: false, baseDays: 60, baseTop: 101, gapClearedBase: true,
  earningsGap: "unknown", fires: 0, firedPivot: false, firedGapHigh: false, repeatOk: true, repeatWhy: null, ...over,
});
const gctx = (g: GapGo | null, down: GapGo | null = null) => ctx({ symbol: "GAPG", adr: 2.2, adrPct: 2.1, prevClose: 107.2, prevHigh: 108, prevLow: 106.2, sma5: null, sma10: null, gapGo: { up: g, down } });
const pre: Row[] = [[108.9, 109, 108.85, 108.95, 60000], [108.95, 109.05, 108.9, 109, 30000], [109, 109.05, 108.9, 108.95, 30000], [108.95, 109.05, 108.9, 109, 20000]];
const go: Row = [109, 109.4, 108.95, 109.3, 80000];
const fire = (c: DailyContext, rows: Row[]) => {
  const s = buildSession(DATE, bars(rows));
  return gapAndGo({ ctx: c, s, i: s.bars.length - 1, settings: st });
};
{
  const hits = fire(gctx(G()), [...pre, go]);
  assert.deepEqual(hits.map((h) => [h.setupKey, h.side, h.variant]), [["gap_and_go", "long", "gap:2026-11-19"]]);
  assert.deepEqual([hits[0].facts.days_since_gap, hits[0].facts.pivot, hits[0].facts.pivot_kind, hits[0].facts.gap_edge, hits[0].facts.tight], [3, 109, "consolidation", 101, 1]);
  assert.deepEqual(fire(gctx(G()), [...pre, [109, 109.2, 108.95, 109.08, 80000]]), [], "not by 0.05 ADR");
  assert.deepEqual(fire(gctx(G()), [...pre, [109, 109.4, 108.95, 109.3, 15000]]), [], "thin volume");
  assert.deepEqual(fire(gctx(G()), [...pre, go, [109.3, 109.6, 109.2, 109.5, 80000]]), [], "only the first close over it today");
  assert.deepEqual(fire(gctx(G({ repeatOk: false, repeatWhy: "cap" })), [...pre, go]), [], "repeat not allowed");

  // the stop: VWAP and today's low are inside the 0.25 ADR noise; the tight flag's low (106) beats the far gap edge (101)
  const c = pass(gctx(G()), [...pre, go]).candidates.find((x) => x.setupKey === "gap_and_go")!;
  assert.equal(c.stopLevel, "consolidation_low");
  assert.equal(c.stopLevelPrice, 106);
  assert.ok(c.riskPct < 5 && c.riskPct > 3);
  assert.equal(c.facts.company, "tight consolidation", "a tight flag's low earns the company point");
  assert.equal(c.gradeComponents.exitLogic, 1);
  assert.equal(pass(gctx(G({ consRangeAdr: 2.5 })), [...pre, go]).candidates.find((x) => x.setupKey === "gap_and_go")!.facts.company, null, "a loose range: no point");
  // nothing valid within 5%: a consolidation low under the edge is not a level, the edge is 7.6% away -> refused
  const far = pass(gctx(G({ consLow: 100.5 })), [...pre, go]);
  assert.equal(far.candidates.filter((x) => x.setupKey === "gap_and_go").length, 0);
  assert.equal(far.refused["gap_and_go:no_level_inside_max"], 1);
  // once per gap per day
  const d = new Dedupe();
  const once = () => runPass({ date: DATE, contexts: new Map([["GAPG", gctx(G())]]), bars: new Map([["GAPG", bars([...pre, go])]]), watch: new Map(), regime: regime(), rotation: noRotation, settings: st, dedupe: d, evaluated: new Map() });
  assert.equal(once().candidates.filter((x) => x.setupKey === "gap_and_go").length, 1);
  assert.equal(once().candidates.filter((x) => x.setupKey === "gap_and_go").length, 0);
}

// ---- the gap-day high as a second, later level ------------------------------------------------------------------------------
{
  const atHigh: Row[] = [[104.6, 104.8, 104.5, 104.7, 60000], [104.7, 104.9, 104.6, 104.8, 30000], [104.8, 104.95, 104.7, 104.85, 30000], [104.85, 104.9, 104.7, 104.8, 20000], [104.8, 105.4, 104.8, 105.3, 80000]];
  const after = G({ pivot: 102, gapExtreme: 105, consLow: 100.8, consHigh: 102, fires: 1, firedPivot: true });
  const h = fire(gctx(after), atHigh);
  assert.deepEqual(h.map((x) => [x.setupKey, x.variant, x.facts.pivot_kind, x.facts.fire_no]), [["gap_and_go", "gap_high_break:2026-11-19", "gap_high", 2]], "the later 105 break: the second variant");
  assert.deepEqual(fire(gctx({ ...after, fires: 2 }), atHigh), [], "goMaxFires reached");
  assert.deepEqual(fire(gctx({ ...after, firedGapHigh: true }), atHigh), [], "the gap high fires once");
  assert.deepEqual(fire(gctx({ ...after, pivot: 104.8 }), atHigh).map((x) => x.variant), ["gap:2026-11-19"], "a pivot within 0.5 ADR of the gap high: one level, it fires as the pivot, no second variant");
  assert.deepEqual(fire(gctx({ ...after, fires: 0, firedPivot: false, repeatOk: false }), atHigh), [], "never fired on the pivot: the gap high alone is not a second variant");
  // the pivot fired earlier today (a bar closed over 102), then the 105 break: the second variant the same day
  const same: Row[] = [[101.8, 101.95, 101.7, 101.9, 40000], [101.9, 102.4, 101.85, 102.3, 80000], [102.3, 104.9, 102.2, 104.8, 60000], [104.8, 105.5, 104.7, 105.4, 90000]];
  assert.deepEqual(fire(gctx(G({ pivot: 102, gapExtreme: 105, consLow: 100.8, consHigh: 102 })), same).map((x) => [x.variant, x.facts.fire_no]), [["gap_high_break:2026-11-19", 2]]);
}

// ---- days 1 and 2: today's opening-range high under the gap-day high, else the gap-day high (a weaker read) ---------------
{
  const early = G({ day: 1, pivot: null, pivotKind: "early", gapExtreme: 105, consLow: null, consHigh: null, consDays: 0, consRangeAdr: null });
  const or: Row[] = [[103, 103.5, 102.8, 103.2, 60000], [103.2, 103.4, 103, 103.1, 40000], [103.1, 103.3, 102.9, 103, 40000]];
  const h1 = fire(gctx(early), [...or, [103.1, 103.8, 103.05, 103.7, 90000]]);
  assert.deepEqual(h1.map((x) => [x.facts.pivot, x.facts.pivot_kind, x.facts.days_since_gap]), [[103.5, "opening_range", 1]]);
  const orOver: Row[] = [[104.8, 105.6, 104.6, 105, 60000], [105, 105.3, 104.8, 104.9, 40000], [104.9, 105.1, 104.7, 105, 40000]];
  const h2 = fire(gctx(early), [...orOver, [105, 105.3, 104.95, 105.2, 90000]]);
  assert.deepEqual(h2.map((x) => [x.facts.pivot, x.facts.pivot_kind]), [[105, "gap_high"]], "range over the gap-day high: the gap-day high is the level");
  assert.deepEqual(fire(gctx(early), or), [], "not before the opening range is complete");
}

// ---- end to end from daily bars: the precompute feeds the trigger ---------------------------------------------------------------
{
  const c = buildDailyContext("GAPE", series([GAP, ...CONS]))!;
  assert.deepEqual([c.gapGo.up!.day, c.gapGo.up!.pivot], [3, 108.5]);
  const low: Row[] = [[108.2, 108.35, 108.1, 108.3, 60000], [108.3, 108.4, 108.2, 108.3, 30000], [108.3, 108.4, 108.2, 108.35, 30000], [108.35, 108.4, 108.25, 108.3, 20000]];
  const res = pass(c, [...low, [108.3, 108.9, 108.3, 108.8, 90000]]);
  assert.ok(res.candidates.some((x) => x.setupKey === "gap_and_go" && x.facts.days_since_gap === 3 && x.facts.pivot === 108.5), "a day-3 go over the post-gap pivot, under the gap-day high");
}

// ---- day 0: today's own gap; the pivot is the opening-range high; no double fire with orb_breakout ------------------------
{
  const c0 = ctx({ symbol: "GAP0", adr: 2, adrPct: 2, prevClose: 100, prevHigh: 101, prevLow: 99, avgVol50: 1_000_000 });
  const day0: Row[] = [[106, 107, 105.8, 106.8, 150000], [106.8, 107.5, 106.5, 107.2, 150000], [107.2, 107.4, 106.6, 107, 150000], [107, 107.9, 106.9, 107.8, 150000]];
  const res = pass(c0, day0);
  const keys = res.candidates.map((x) => x.setupKey);
  assert.ok(keys.includes("gap_and_go"), keys.join());
  assert.ok(!keys.includes("orb_breakout"), "only gap_and_go is raised on that bar");
  const g0 = res.candidates.find((x) => x.setupKey === "gap_and_go")!;
  assert.deepEqual([g0.facts.days_since_gap, g0.facts.pivot_kind, g0.facts.pivot, g0.facts.also], [0, "opening_range", 107.5, "orb_breakout,new_high_volume"], "v3: the new high on the same bar is one candidate too");
  const noGap = ctx({ symbol: "NOGP", adr: 2, adrPct: 2, prevClose: 105.5, prevHigh: 106, prevLow: 104, avgVol50: 1_000_000 });
  const plain = pass(noGap, day0);
  assert.ok(plain.candidates.some((x) => x.setupKey === "orb_breakout") && !plain.candidates.some((x) => x.setupKey === "gap_and_go"), "no gap: ORB as usual");
  assert.ok(!fire(c0, day0.map((r) => [r[0], r[1], r[2], r[3], 20000] as Row)).length, "day 0 on thin volume: no gap");
}

// ---- the repeat rule and its cap ----------------------------------------------------------------------------------------
{
  const b = series([GAP, ...CONS, [107.5, 112, 107.4, 111.5, 2e6], [111.5, 112, 109.6, 110, 1e6], [110, 110.5, 109.4, 110.2, 1e6]]);
  const fired: PriorFire[] = [{ gapDate: b[60].date, marketDate: b[63].date, goLevel: 108.5, side: "long", variant: `gap:${b[60].date}` }];
  const after = precomputeGapGo(b, st, { adrNow: 2.2, fires: fired }).up!;
  assert.deepEqual([after.fires, after.firedPivot, after.repeatOk, after.pivot], [1, true, true, 112], "a 1 ADR pullback and a higher pivot: may fire again");
  const noPull = series([GAP, ...CONS, [107.5, 112, 107.4, 111.5, 2e6], [111.5, 112.5, 111.4, 112.4, 1e6]]);
  const np = precomputeGapGo(noPull, st, { adrNow: 2.2, fires: [{ ...fired[0], gapDate: noPull[60].date, marketDate: noPull[63].date }] }).up!;
  assert.equal(np.repeatOk, false, "no pullback since the fire");
  const capped = precomputeGapGo(b, st, { adrNow: 2.2, fires: [...fired, { ...fired[0], marketDate: b[64].date, goLevel: 109, variant: `gap_high_break:${b[60].date}` }] }).up!;
  assert.deepEqual([capped.repeatOk, capped.repeatWhy, capped.firedGapHigh], [false, "fired 2 times (max 2)", true], "both variants count toward the cap");
}

// ---- the short mirror: base at 100, gap-down day low 95, post-gap range 98-99.4, break of 98 ------------------------------
{
  const s14: ScannerSettings = { ...st, gapMinPct: 1.4 };
  const b = series([[98, 98.5, 95, 96.5, 3_000_000], [97, 99.4, 98, 98.6, 1.2e6], [98.6, 99.3, 98.1, 98.9, 1.1e6], [98.9, 99.2, 98, 98.4, 1e6]], 60, [100, 100.5, 99.5, 100, 1_000_000]);
  const c = buildDailyContext("SHRT", b, {}, 60, s14)!;
  const g = c.gapGo.down!;
  assert.deepEqual([g.dir, g.edge, g.pivot, g.pivotKind, g.gapExtreme, g.baseTop], ["down", 99.5, 98, "consolidation", 95, 99.5]);
  assert.equal(precomputeGapGo(series([[98, 98.5, 95, 96.5, 3e6], [97, 99.8, 98, 99.7, 2e6]], 60, [100, 100.5, 99.5, 100, 1e6]), s14, { adrNow: 1.2 }).down, null, "closed back above the edge: failed");
  const intraday: Row[] = [[98.3, 98.4, 98.15, 98.2, 40000], [98.2, 98.3, 98.12, 98.18, 25000], [98.18, 98.28, 98.1, 98.15, 20000], [98.15, 98.25, 98.1, 98.12, 20000], [98.12, 98.15, 97.7, 97.8, 80000]];
  const res = pass(c, intraday, s14, regime("DEFENSIVE"));
  const sh = res.candidates.find((x) => x.setupKey === "gap_down_and_go")!;
  assert.ok(sh, "short go under the 98 pivot");
  assert.deepEqual([sh.side, sh.facts.pivot, sh.facts.pivot_kind, sh.facts.gap_day_high], ["short", 98, "consolidation", 95]);
  assert.ok(sh.stopPrice > sh.entryRef && sh.riskPct <= 5);
  assert.ok(Number(sh.facts.distance_to_gap_high_adr) > 2, "the gap-day low 95 is carried: room below");
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

// ---- the base before the gap ---------------------------------------------------------------------------------------------
{
  const b = series([[110, 112, 108, 111, 1e6], [111, 113, 109, 112, 1e6]], 30);
  assert.deepEqual(preGapBase(b, 31, 2, 3), { days: 2, top: 113, bottom: 108 }, "a run within 3 ADR only");
  assert.equal(preGapBase(series([], 30), 29, 2, 3).days, 30);
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
