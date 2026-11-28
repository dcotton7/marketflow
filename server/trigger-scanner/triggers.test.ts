/**
 * Trigger scanner, fixed cases on made-up bars: every trigger (positive and negative, long and short), the level and
 * gap rule, the 5% refusal, the grade arithmetic, dedupe, one full pass, and a user's stored daily setup. No network,
 * no database.
 */
import assert from "node:assert/strict";
import { calculateSessionVwap } from "@shared/chart-indicators";
import { bars, ctx, DATE, noRotation, regime, settings } from "./fixtures";
import { buildDailyContext, classifyGaps } from "./daily";
import { gradeCandidate, riskPoints } from "./grade";
import { dailyLevels, levelsAt, pickStop } from "./levels";
import { readRotation, groupLeading, sectorEtf } from "./rotation";
import { Dedupe, runPass, sessionsUntil, settleBar, type Ready } from "./scan";
import { setupInfo } from "./registry";
import { buildSession, relVol, sessionBars, sessionOpenMs } from "./session";
import { memoryTriggerStore, type UserSetupRow } from "./store";
import type { TriggerInput } from "./triggers/common";
import { dailyInRange } from "./triggers/daily-in-range";
import { dayExtremeReversal } from "./triggers/day-extreme-reversal";
import { failedOrb } from "./triggers/failed-orb";
import { levelHold } from "./triggers/level-hold";
import { newExtremeVolume } from "./triggers/new-extreme-volume";
import { orb } from "./triggers/orb";
import { vwapCross } from "./triggers/vwap-cross";
import { criteriaFromIdea, userSetupPasses, validateUserSetup } from "./user-setups";
import { addShakeoutWatch, assembleChunk, newAcc, prepareUserSetups, resolveIdeas } from "./day-data";
import type { Bar, DailyBar } from "./types";

type Row = [number, number, number, number, number];
const at = (rows: Row[], c = ctx(), extra: Partial<TriggerInput> = {}) => {
  const s = buildSession(DATE, bars(rows));
  return { s, c, inp: { ctx: c, s, i: s.bars.length - 1, settings, ...extra } as TriggerInput };
};
const keys = (hits: { setupKey: string }[]) => hits.map((h) => h.setupKey);
const RANGE: Row[] = [[100, 101, 99.5, 100.5, 60000], [100.5, 100.9, 99.2, 99.6, 40000], [99.6, 100.4, 99, 100, 30000]];

// ---- session: 9:30 ET, the opening range, VWAP agrees with the shared session VWAP --------------------------------
assert.equal(new Date(sessionOpenMs("2026-11-24")).toISOString(), "2026-11-24T14:30:00.000Z", "EST");
assert.equal(new Date(sessionOpenMs("2026-07-14")).toISOString(), "2026-07-14T13:30:00.000Z", "EDT");
{
  const pre: Bar = { t: "2026-11-24T14:00:00.000Z", o: 50, h: 50, l: 50, c: 50, v: 9e6 }; // 9:00 ET, pre-market
  const day = sessionBars(DATE, [pre, ...bars(RANGE)]);
  assert.equal(day.length, 3, "pre-market bars never enter the session");
  const s = buildSession(DATE, day);
  const ref = calculateSessionVwap(day.map((b) => ({ date: b.t, high: b.h, low: b.l, close: b.c, volume: b.v })));
  s.vwap.forEach((v, i) => assert.ok(Math.abs(v - ref[i]!) < 1e-9, "same VWAP as shared/chart-indicators"));
  assert.equal(s.orHigh, null, "range not complete with only its own bars");
  const s2 = buildSession(DATE, bars([...RANGE, [100, 100.2, 99.8, 100, 10000]]));
  assert.deepEqual([s2.orHigh, s2.orLow, s2.orEnd], [101, 99, 3], "first 15 minutes = three bars");
}

// ---- ORB breakout / breakdown -------------------------------------------------------------------------------------
{
  const up = at([...RANGE, [100.8, 101.7, 100.7, 101.5, 80000]]);
  assert.deepEqual(keys(orb(up.inp)), ["orb_breakout"]);
  assert.ok(relVol(up.s, 3, 1e6)! >= 1.5);
  assert.deepEqual(keys(orb(at([...RANGE, [100.8, 101.7, 100.7, 101.5, 5000]]).inp)), [], "no breakout on thin volume");
  assert.deepEqual(keys(orb(at([...RANGE, [100.8, 101.7, 100.7, 101.5, 80000], [101.5, 102, 101.3, 101.9, 80000]]).inp)), [], "only the first close beyond");
  assert.deepEqual(keys(orb(at([...RANGE, [100.2, 100.9, 100.1, 100.8, 80000]]).inp)), [], "inside the range");
  assert.deepEqual(keys(orb(at([...RANGE, [99.2, 99.3, 98.4, 98.6, 80000]]).inp)), ["orb_breakdown"]);
  const late = Array.from({ length: 30 }, () => [100, 100.5, 99.5, 100, 20000] as Row);
  assert.deepEqual(keys(orb(at([...RANGE, ...late, [100.8, 101.7, 100.7, 101.5, 80000]]).inp)), [], "past orbUntilMin");
}

// ---- failed break / reversal after the range -------------------------------------------------------------------------
{
  assert.deepEqual(keys(failedOrb(at([...RANGE, [100.8, 101.6, 100.7, 101.4, 50000], [101.4, 101.5, 100.4, 100.6, 50000]]).inp)), ["failed_orb"]);
  assert.deepEqual(keys(failedOrb(at([...RANGE, [100.8, 101.6, 100.7, 101.4, 50000], [101.4, 101.5, 101.1, 101.2, 50000]]).inp)), [], "still outside");
  assert.deepEqual(keys(failedOrb(at([...RANGE, [100.8, 101.6, 100.7, 101.4, 50000], [101.4, 101.5, 100.4, 100.6, 50000], [100.6, 100.8, 100.3, 100.5, 50000]]).inp)), [], "only the first close back inside");
  assert.deepEqual(keys(failedOrb(at([...RANGE, [100.2, 100.8, 100, 100.4, 50000]]).inp)), [], "never broke");
  assert.deepEqual(keys(failedOrb(at([...RANGE, [100.8, 101.2, 100.7, 101.1, 50000], [101.1, 101.2, 100.4, 100.6, 50000]]).inp)), [], "a break of under 0.1 ADR is not a failed break");
  assert.deepEqual(keys(failedOrb(at([...RANGE, [99.2, 99.3, 98.5, 98.7, 50000], [98.7, 99.6, 98.6, 99.4, 50000]]).inp)), ["orb_reversal"]);
}

// ---- VWAP reclaim / loss ------------------------------------------------------------------------------------------
{
  const base: Row[] = [[100, 100.2, 99.8, 100, 500000], [100, 100, 99.3, 99.5, 10000], [99.5, 99.6, 99.3, 99.4, 10000], [99.4, 99.6, 99.3, 99.5, 10000]];
  assert.deepEqual(keys(vwapCross(at([...base, [99.5, 100.6, 99.5, 100.4, 20000]]).inp)), ["vwap_reclaim"]);
  assert.deepEqual(keys(vwapCross(at([...base, [99.5, 99.9, 99.5, 99.8, 20000]]).inp)), [], "still under VWAP");
  assert.deepEqual(keys(vwapCross(at([...base, [99.5, 100.1, 99.5, 100.05, 20000]]).inp)), [], "across by under 0.05 ADR");
  assert.deepEqual(keys(vwapCross(at([base[0], base[1], [99.5, 100.4, 99.5, 100.3, 10000], base[3], [99.5, 100.6, 99.5, 100.4, 20000]]).inp)), [], "needs 3 closes under first");
  const above: Row[] = [[100, 100.2, 99.8, 100, 500000], [100, 100.7, 100, 100.5, 10000], [100.5, 100.7, 100.4, 100.6, 10000], [100.6, 100.7, 100.4, 100.5, 10000]];
  assert.deepEqual(keys(vwapCross(at([...above, [100.5, 100.5, 99.4, 99.6, 20000]]).inp)), ["vwap_loss"]);
}

// ---- level touched and held ---------------------------------------------------------------------------------------
{
  const c = ctx({ sma20: 99 });
  const hold = levelHold(at([[100, 100.5, 99.9, 100.2, 50000], [100.2, 100.3, 99.05, 99.8, 50000]], c).inp);
  assert.deepEqual(hold.map((h) => [h.setupKey, h.variant]), [["level_hold", "sma20"]]);
  assert.deepEqual(levelHold(at([[100, 100.5, 99.9, 100.2, 50000], [100.2, 100.3, 99.5, 99.8, 50000]], c).inp), [], "did not reach the level");
  assert.deepEqual(levelHold(at([[99.3, 99.6, 99.1, 99.4, 50000], [99.4, 99.5, 99.05, 99.3, 50000]], c).inp), [], "chop on the level: never 0.3 ADR above it");
  assert.deepEqual(levelHold(at([[100, 100.5, 99.9, 100.2, 50000], [100.2, 100.3, 98.5, 98.8, 50000]], c).inp), [], "closed through it");
  const r = levelHold(at([[100, 100.3, 99.9, 100, 50000], [100, 100.95, 99.9, 100.3, 50000]], ctx({ sma50: 101 })).inp);
  assert.deepEqual(r.map((h) => [h.setupKey, h.variant]), [["level_reject", "sma50"]]);
  // a failed gap up is resistance, so a long never holds off it; a held one is support
  const gapFailed = ctx({ gaps: [{ date: "2026-11-10", dir: "up", edge: 99, far: 99.5, state: "failed", role: "resistance" }] });
  assert.deepEqual(levelHold(at([[100, 100.5, 99.9, 100.2, 50000], [100.2, 100.3, 99.05, 99.8, 50000]], gapFailed).inp), []);
  const gapHeld = ctx({ gaps: [{ date: "2026-11-10", dir: "up", edge: 99, far: 99.5, state: "filled_held", role: "support" }] });
  assert.deepEqual(levelHold(at([[100, 100.5, 99.9, 100.2, 50000], [100.2, 100.3, 99.05, 99.8, 50000]], gapHeld).inp).map((h) => h.variant), ["gap:2026-11-10"]);
  // v3, a real test: a touch is refused (named, counted) when the bar is a few cents, closes weak, or trades thin
  const ref = (rows: Row[], cc = c) => levelHold(at(rows, cc).inp).map((h) => [h.variant, h.refused ?? "kept"]);
  assert.deepEqual(ref([[100, 100.5, 99.9, 100.2, 50000], [99.1, 99.12, 99.0, 99.1, 50000]]), [["sma20", "small_bar"]], "a 12-cent bar on a $3 ADR: noise");
  assert.deepEqual(ref([[100, 100.5, 99.9, 100.2, 50000], [100.2, 100.3, 99.05, 99.2, 50000]]), [["sma20", "weak_close"]], "closed in the bottom of the bar");
  assert.deepEqual(ref([[100, 100.5, 99.9, 100.2, 50000], [100.2, 100.3, 99.05, 99.8, 5000]]), [["sma20", "low_volume"]], "0.15x the slot's volume");
  assert.deepEqual(ref([[100, 100.5, 99.9, 100.2, 50000], [100.2, 100.3, 99.05, 99.8, 50000]]), [["sma20", "kept"]], "a real test: 0.42 ADR bar, close in the top 60% (at least 40%), 1.5x");
  assert.deepEqual(ref([[100, 100.5, 99.9, 100.2, 50000], [100.2, 100.3, 99.2, 99.8, 50000]]), [], "20 cents short of the level is not a tag (tolerance min(0.15% = 14.85 cents, 0.07 ADR = 21 cents))");
  assert.deepEqual(levelHold(at([[100, 100.5, 99.9, 100.2, 50000], [100.2, 100.3, 99.12, 99.8, 50000]], ctx({ sma20: 99, adr: 1.5, adrPct: 1.5 })).inp), [], "on a 1.5% ADR name 0.07 ADR (10.5 cents) binds: 12 cents short is no tag");
  assert.deepEqual(ref([[100, 100.5, 99.9, 100.2, 50000], [100.2, 100.3, 99.05, 99.8, 50000]], ctx({ sma5: 99.1, sma20: 99 })), [["sma20", "kept"]], "the 20-day over the nearer 5-day");
  assert.equal(setupInfo("level_hold")!.dedupeMin, 24 * 60, "one per symbol per level per day");
  assert.equal(setupInfo("level_reject")!.dedupeMin, 24 * 60);
}

// ---- low / high of day reversal -----------------------------------------------------------------------------------
{
  const flush: Row[] = [[100, 100.2, 99.4, 99.5, 50000], [99.5, 99.6, 98.8, 98.9, 50000], [98.9, 99, 98.2, 98.3, 50000]];
  assert.deepEqual(keys(dayExtremeReversal(at([...flush, [98.3, 99.2, 97.9, 99.1, 50000]]).inp)), ["lod_reversal"], "new low on the bar, closes in its top");
  assert.deepEqual(keys(dayExtremeReversal(at([...flush, [98.3, 98.5, 97.9, 98.1, 50000]]).inp)), [], "closed weak");
  const small: Row[] = [[100, 100.2, 99.8, 99.9, 50000], [99.9, 100, 99.6, 99.7, 50000], [99.7, 99.8, 99.5, 99.55, 50000]];
  assert.deepEqual(keys(dayExtremeReversal(at([...small, [99.55, 99.9, 99.4, 99.85, 50000]]).inp)), [], "move under 0.5 ADR");
  const run: Row[] = [[100, 100.6, 99.9, 100.5, 50000], [100.5, 101.2, 100.4, 101.1, 50000], [101.1, 101.8, 101, 101.7, 50000]];
  assert.deepEqual(keys(dayExtremeReversal(at([...run, [101.7, 102.1, 100.8, 100.9, 50000]]).inp)), ["hod_reversal"]);
}

// ---- new session high / low on volume -----------------------------------------------------------------------------
{
  const busy: Row[] = RANGE.map((r) => [r[0], r[1], r[2], r[3], 200000] as Row);
  assert.deepEqual(keys(newExtremeVolume(at([...busy, [100.8, 101.6, 100.7, 101.5, 90000]]).inp)), ["new_high_volume"]);
  const quiet: Row[] = RANGE.map((r) => [r[0], r[1], r[2], r[3], 15000] as Row);
  assert.deepEqual(keys(newExtremeVolume(at([...quiet, [100.8, 101.6, 100.7, 101.5, 60000]]).inp)), [], "the day's volume is under its norm");
  assert.deepEqual(keys(newExtremeVolume(at([...busy, [99.2, 99.3, 98.4, 98.5, 90000]]).inp)), ["new_low_volume"]);
}

// ---- a daily setup coming into range -------------------------------------------------------------------------------
{
  const w = { setupKey: "leader_shakeout", setupOwner: "builtin", ownerUserId: null, side: "long" as const, entryName: "shakeout_close", entryLevel: 100, hitDate: "2026-11-20", tested: true };
  assert.deepEqual(keys(dailyInRange(at([[99.8, 100.7, 99.7, 100.5, 50000]], ctx(), { watch: [w] }).inp)), ["leader_shakeout"]);
  assert.deepEqual(keys(dailyInRange(at([[105.8, 106.7, 105.7, 106.5, 50000]], ctx(), { watch: [w] }).inp)), [], "2 ADR away");
  assert.deepEqual(keys(dailyInRange(at([[100.5, 100.7, 99.7, 100.1, 50000]], ctx(), { watch: [w] }).inp)), [], "a down bar for a long");
}

// ---- gaps: filled and held = support, failed = resistance, broken levels flip ------------------------------------------
{
  const d = (date: string, o: number, h: number, l: number, c: number): DailyBar => ({ date, open: o, high: h, low: l, close: c, volume: 1e6 });
  const g0 = [d("2026-11-02", 9.5, 10, 9, 9.8), d("2026-11-03", 10.6, 11, 10.5, 10.8)];
  assert.deepEqual(classifyGaps([...g0, d("2026-11-04", 10.8, 11.2, 10.6, 10.9)]).map((g) => [g.dir, g.edge, g.state, g.role]), [["up", 10, "open", "support"]]);
  assert.deepEqual(classifyGaps([...g0, d("2026-11-04", 10.8, 10.9, 10.2, 10.6)]).map((g) => [g.state, g.role]), [["filled_held", "support"]]);
  assert.deepEqual(classifyGaps([...g0, d("2026-11-04", 10.8, 10.9, 9.7, 9.9)]).map((g) => [g.state, g.role]), [["failed", "resistance"]]);
  const dn = [d("2026-11-02", 20, 21, 20, 20.5), d("2026-11-03", 19.2, 19.5, 18.8, 19)];
  assert.deepEqual(classifyGaps([...dn, d("2026-11-04", 19, 19.8, 18.9, 19.4)]).map((g) => [g.dir, g.edge, g.state, g.role]), [["down", 20, "filled_held", "resistance"]]);
  assert.deepEqual(classifyGaps([...dn, d("2026-11-04", 19, 20.6, 18.9, 20.4)]).map((g) => [g.state, g.role]), [["failed", "support"]]);
}

// ---- the stop rule ---------------------------------------------------------------------------------------------------
{
  const rule = settings;
  const lv = (name: any, price: number, gap?: any) => ({ name, price, ...(gap ? { gap } : {}) });
  // nearest support below, past it by min(0.1 ADR, 0.2%)
  const p = pickStop("long", 100, [lv("sma20", 98.5), lv("sma50", 96), lv("prev_high", 103)], 3, rule);
  assert.equal(p.ok, true);
  assert.equal(p.level!.name, "sma20");
  assert.ok(Math.abs(p.stop! - (98.5 - 0.197)) < 1e-9, `stop ${p.stop}`);
  assert.ok(Math.abs(p.riskPct! - 1.697) < 1e-9 && Math.abs(p.riskAdr! - 0.5657) < 1e-3);
  // a level inside 0.25 ADR is noise: the next one is taken
  assert.equal(pickStop("long", 100, [lv("vwap", 99.6), lv("sma20", 98.5)], 3, rule).level!.name, "sma20");
  // 5% refusal: the nearest usable level is past 5%
  const far = pickStop("long", 100, [lv("sma50", 94)], 3, rule);
  assert.deepEqual([far.ok, far.refused], [false, "no_level_inside_max"]);
  assert.deepEqual([pickStop("long", 100, [lv("prev_high", 103)], 3, rule).refused], ["no_level"], "nothing below");
  // a failed gap edge under the price is not support for a long; it is resistance for a short above
  const failedGap = { date: "2026-11-10", dir: "up", state: "failed", role: "resistance" };
  const g = pickStop("long", 100, [lv("gap", 98.8, failedGap), lv("sma50", 97)], 3, rule);
  assert.equal(g.level!.name, "sma50");
  assert.equal(g.considered[0].skipped, "wrong_role");
  const sh = pickStop("short", 97.5, [lv("gap", 98.8, failedGap), lv("sma50", 97)], 3, rule);
  assert.equal(sh.level!.name, "gap");
  assert.ok(sh.stop! > 98.8, "a short's stop sits just over");
  // company: another level within 0.3 ADR of the stop level
  assert.deepEqual(pickStop("long", 100, [lv("sma20", 98.5), lv("prev_low", 98.2), lv("sma50", 96)], 3, rule).company, ["prev_low"]);
  // the levels at a bar include the session's
  const s = buildSession(DATE, bars([...RANGE, [100, 100.4, 99.6, 100.1, 10000]]));
  assert.deepEqual(levelsAt(ctx({ sma5: 99 }), s, 3).map((l) => l.name), ["sma5", "prev_low", "prev_high", "vwap", "range_low", "range_high", "low_of_day", "high_of_day"]);
  assert.equal(dailyLevels(ctx()).length, 2, "nulls are not levels");
}

// ---- daily context -------------------------------------------------------------------------------------------------
{
  const series: DailyBar[] = Array.from({ length: 60 }, (_, k) => ({ date: `2026-09-${String(k + 1).padStart(2, "0")}`, open: 50 + k * 0.5, high: 51 + k * 0.5, low: 49 + k * 0.5, close: 50 + k * 0.5, volume: 1e6 }));
  const c = buildDailyContext("abc", series)!;
  assert.equal(c.symbol, "ABC");
  assert.equal(c.sma5, (79.5 + 79 + 78.5 + 78 + 77.5) / 5);
  assert.equal(c.prevLow, 78.5);
  assert.ok(c.adrPct > 2.4 && c.adrPct < 2.8);
  assert.equal(buildDailyContext("x", series.slice(0, 10)), null, "too few bars");
}

// ---- grade arithmetic (v3: risk in ADR, the level's weight, volume; docs "Grade") --------------------------------------
{
  const gs = settings;
  const base = { side: "long" as const, riskPct: 1.2, riskAdr: 0.6, hasCompany: true, setupKind: "builtin" as const, regime: regime("NEUTRAL"), groupLeading: false, dollarVol20: 150e6, earningsInSessions: null, relVol: 2, levelName: "sma20" };
  const A = gradeCandidate({ ...base, setupKind: "tested", regime: regime("AGGRESSIVE"), groupLeading: true }, gs);
  assert.deepEqual([A.grade, A.points, A.components.risk, A.components.level, A.components.volume, A.components.regime, A.components.liquidity], ["A", 11, 3, 2, 2, 1, 0], "the most there is: 11");
  // Friday's noise A (VRNS: a tag of the 5-day on 0.18x volume, a stop 0.43 ADR and 0.19% away) was A 8; now C
  const noise = gradeCandidate({ ...base, riskPct: 0.19, riskAdr: 0.36, relVol: 0.18, levelName: "sma5" }, gs);
  assert.deepEqual([noise.grade, noise.points, noise.components.risk, noise.components.level, noise.components.volume], ["C", 3, 1, 0, 0]);
  // the risk band, in ADR
  const rp = (adr: number, pct = 1) => riskPoints(pct, adr, gs);
  assert.deepEqual([rp(0.36), rp(0.44), rp(0.45), rp(0.75), rp(1), rp(1.01), rp(1.5), rp(1.6), rp(2), rp(2.1)], [1, 1, 3, 3, 3, 2, 2, 1, 1, 0]);
  assert.equal(rp(0.6, 4), 2, "a stop past 3% scores at most 2");
  // volume and level weight count
  const vol = (rv: number | null) => gradeCandidate({ ...base, relVol: rv }, gs).components.volume;
  assert.deepEqual([vol(0.5), vol(0.75), vol(1.49), vol(1.5), vol(null)], [0, 1, 1, 2, 0]);
  const lvl = (n: string) => gradeCandidate({ ...base, levelName: n }, gs).components.level;
  assert.deepEqual([lvl("sma50"), lvl("prev_low"), lvl("gap"), lvl("vwap"), lvl("range_low"), lvl("sma5"), lvl("ema10")], [2, 2, 2, 1, 1, 0, 0]);
  // an A on points with no volume point is a B, noted
  const quiet = gradeCandidate({ ...base, setupKind: "tested", groupLeading: true, relVol: 0.5 }, gs);
  assert.deepEqual([quiet.points, quiet.grade], [9, "B"]);
  assert.ok(quiet.components.notes.some((n) => n.includes("volume")));
  const B = gradeCandidate({ ...base, regime: regime("DEFENSIVE"), relVol: 1 }, gs);
  assert.deepEqual([B.grade, B.points, B.components.regime], ["B", 7, 0]);
  assert.ok(B.components.notes.some((n) => n.includes("against the regime")));
  const S = gradeCandidate({ ...base, side: "short", setupKind: "user", regime: regime("DEFENSIVE"), dollarVol20: 50e6, earningsInSessions: undefined, hasCompany: false }, gs);
  assert.deepEqual([S.points, S.components.setup, S.components.regime, S.components.liquidity], [7, 0, 1, -1], "short in DEFENSIVE: the regime point; thin: -1");
  assert.ok(S.components.notes.includes("earnings date not checked: 0"));
  const E = gradeCandidate({ ...base, earningsInSessions: 2 }, gs);
  assert.deepEqual([E.points, E.components.earnings], [7, -2]);
  const U = gradeCandidate({ ...base, regime: { label: null, score: null, asOf: null } }, gs);
  assert.ok(U.components.notes.includes("regime unknown: 0"));
  assert.equal(sessionsUntil("2026-11-24", "2026-11-27"), 3);
  assert.equal(sessionsUntil("2026-11-27", "2026-11-30"), 1, "over a weekend");
}

// ---- rotation ------------------------------------------------------------------------------------------------------
{
  const m = (t: number, d: number) => ({ todayPct: t, d5Pct: d });
  const hot = readRotation(new Map([["SPY", m(0.2, 1)], ["IWM", m(1.1, 1.5)], ["MDY", m(0.5, 1)], ["MGK", m(0, 0.5)], ["QQQ", m(0.1, 1)], ["XLE", m(1.5, 3)], ["XLK", m(-0.5, 0)], ["XLF", m(0.6, 2)]]), settings, "x");
  assert.deepEqual(hot.leadingSize, ["MID", "SMALL"], "IWM hot: move to midcap");
  assert.deepEqual(hot.leadingSectors, ["XLE", "XLF"]);
  assert.equal(groupLeading(hot, "MID", null), true);
  assert.equal(groupLeading(hot, "MEGA", "Energy"), true, "a leading sector");
  assert.equal(groupLeading(hot, "MEGA", "Technology"), false);
  const none = readRotation(new Map([["SPY", m(0.2, 1)], ["IWM", m(1.1, 1)], ["QQQ", m(1.2, 1)]]), settings, null);
  assert.deepEqual(none.leadingSize, [], "both ends hot: no tilt");
  assert.equal(sectorEtf("Financial Services"), "XLF");
  assert.equal(sectorEtf("Consumer Defensive"), "XLP");
}

// ---- dedupe and one full pass ----------------------------------------------------------------------------------------
{
  const d = new Dedupe();
  assert.equal(d.take("k", 0, 60), true);
  assert.equal(d.take("k", 30 * 60_000, 60), false, "inside the window");
  assert.equal(d.take("k", 61 * 60_000, 60), true, "after it");

  const rows: Row[] = [...RANGE, [100.8, 101.7, 100.7, 101.5, 80000], [101.5, 101.8, 101.2, 101.6, 30000]];
  const contexts = new Map([["AAA", ctx({ symbol: "AAA", sma20: 99.2 })], ["BBB", ctx({ symbol: "BBB" })]]);
  const barsBy = new Map([["AAA", bars(rows)], ["BBB", bars(rows)], ["NOCTX", bars(rows)]]);
  const dedupe = new Dedupe();
  const p1 = runPass({ date: DATE, contexts, bars: barsBy, watch: new Map(), regime: regime("AGGRESSIVE"), rotation: noRotation, settings, dedupe, evaluated: new Map() });
  const orbs = p1.candidates.filter((c) => c.setupKey === "orb_breakout");
  assert.equal(orbs.length, 2, "one ORB per name");
  const a = orbs.find((c) => c.symbol === "AAA")!;
  assert.equal(a.triggerAt, "2026-11-24T14:50:00.000Z", "the trigger time is the bar's close (9:50)");
  assert.equal(a.entryRef, 101.5);
  assert.equal(a.side, "long");
  assert.ok(a.riskPct <= 5 && a.riskPct > 0);
  assert.ok(["vwap", "range_low", "sma20", "low_of_day"].includes(a.stopLevel), a.stopLevel);
  assert.equal(a.setupOwner, "builtin");
  assert.ok(a.dedupeKey.startsWith("2026-11-24|AAA|long|orb_breakout|builtin|range_high|"));
  assert.equal(p1.skipped.no_daily_context, 1);
  assert.equal(a.gradePoints, Object.values(a.gradeComponents).filter((x) => typeof x === "number").reduce((s: number, x: any) => s + x, 0), "points = sum of components");
  // the same bars again (a restart re-evaluating them): nothing new
  const p2 = runPass({ date: DATE, contexts, bars: barsBy, watch: new Map(), regime: regime("AGGRESSIVE"), rotation: noRotation, settings, dedupe, evaluated: new Map() });
  assert.equal(p2.candidates.length, 0);
  assert.ok(p2.deduped >= 2);
  // the store's unique key holds too
  const store = memoryTriggerStore();
  assert.equal(await store.insertCandidates(p1.candidates), p1.candidates.length);
  assert.equal(await store.insertCandidates(p1.candidates), 0, "insert-only, no doubles");
  // incremental: an evaluated cursor skips old bars
  const ev = new Map<string, number>();
  runPass({ date: DATE, contexts, bars: barsBy, watch: new Map(), regime: regime(), rotation: noRotation, settings, dedupe: new Dedupe(), evaluated: ev });
  const p3 = runPass({ date: DATE, contexts, bars: barsBy, watch: new Map(), regime: regime(), rotation: noRotation, settings, dedupe: new Dedupe(), evaluated: ev });
  assert.equal(p3.barsEvaluated, 0, "no bar is evaluated twice");
  // a refused stop is counted, not raised
  const thin = runPass({ date: DATE, contexts: new Map([["CCC", ctx({ symbol: "CCC", adr: 0.05, adrPct: 0.05 })]]), bars: new Map([["CCC", bars([...RANGE, [100.8, 108, 100.7, 107.9, 80000]])]]), watch: new Map(), regime: regime(), rotation: noRotation, settings: { ...settings, minAdrPct: 0 }, dedupe: new Dedupe(), evaluated: new Map() });
  assert.equal(thin.candidates.filter((c) => c.setupKey === "orb_breakout").length, 0);
  assert.equal(thin.refused["orb_breakout:no_level_inside_max"], 1);

  // v3 noise rules on one pass. AAA's ORB at 9:50: entry 101.5, stop under VWAP, 0.39 ADR; its new session high on the
  // same bar is the same trade: one candidate, the other named in facts.also and counted
  assert.equal(a.facts.also, "new_high_volume");
  assert.equal(p1.refused["new_high_volume:same_bar"], 2, "AAA and BBB");
  assert.ok(Math.abs(a.riskAdr - 0.3861) < 1e-3, String(a.riskAdr));
  // a stop under minRiskAdr is inside the noise: refused, named, counted
  const strict = runPass({ date: DATE, contexts, bars: barsBy, watch: new Map(), regime: regime(), rotation: noRotation, settings: { ...settings, minRiskAdr: 0.5 }, dedupe: new Dedupe(), evaluated: new Map() });
  assert.equal(strict.candidates.filter((c) => c.setupKey === "orb_breakout").length, 0);
  assert.equal(strict.refused["orb_breakout:stop_inside_noise"], 2);
  // a name whose ADR is under minAdrPct (1%) is not scanned (Friday: TECH 0.17%, MKTX 0.20%: trades of cents)
  const pinned = runPass({ date: DATE, contexts: new Map([["PIN", ctx({ symbol: "PIN", adr: 0.5, adrPct: 0.5 })]]), bars: new Map([["PIN", bars(rows)]]), watch: new Map(), regime: regime(), rotation: noRotation, settings, dedupe: new Dedupe(), evaluated: new Map() });
  assert.deepEqual([pinned.candidates.length, pinned.skipped.adr_under_min, pinned.symbolsScanned], [0, 1, 0]);
}

// ---- v3: a long and a short on the same name (settleBar) --------------------------------------------------------------
{
  const T = Date.parse("2026-11-24T15:00:00.000Z");
  const mk = (side: "long" | "short", points: number, key = side === "long" ? "level_hold" : "level_reject"): Ready =>
    ({ h: { setupKey: key, side, variant: "x", why: "", facts: {} }, setupOwner: "builtin", base: `${DATE}|SYM|${side}|${key}|builtin|x`, window: 60, g: { points } } as unknown as Ready);
  const run = (rs: Ready[], at: number, d: Dedupe, refused: Record<string, number> = {}) => ({ kept: settleBar(rs, "SYM", at, DATE, settings, d, refused).map((r) => `${r.h.side}:${r.g.points}`), refused });
  // the same bar, 8 against 7: price pinned between a support and a resistance; neither
  const same = run([mk("long", 8), mk("short", 7)], T, new Dedupe());
  assert.deepEqual([same.kept, same.refused], [[], { "level_hold:conflict": 1, "level_reject:conflict": 1 }]);
  // the same bar, 9 against 6: the long is clearly better and kept
  assert.deepEqual(run([mk("long", 9), mk("short", 6)], T, new Dedupe()).kept, ["long:9"]);
  // a later bar: a short 10 minutes after a 6-point long is refused unless 2 points better; after 30 minutes it stands
  const d = new Dedupe();
  assert.deepEqual(run([mk("long", 6)], T, d).kept, ["long:6"]);
  assert.deepEqual(run([mk("short", 7)], T + 10 * 60_000, d).kept, [], "inside the window, not clearly better");
  assert.deepEqual(run([mk("long", 6)], T + 15 * 60_000, d).kept, [], "a refused short still marks the chop");
  const d2 = new Dedupe();
  run([mk("long", 6)], T, d2);
  assert.deepEqual(run([mk("short", 8)], T + 10 * 60_000, d2).kept, ["short:8"], "2 points better: kept");
  const d3 = new Dedupe();
  run([mk("long", 6)], T, d3);
  assert.deepEqual(run([mk("short", 6)], T + 31 * 60_000, d3).kept, ["short:6"], "past conflictWindowMin");
  // after a restart the stored long seeds the side with unknown points: a short inside the window is refused
  const d4 = new Dedupe();
  d4.seed(`${DATE}|SYM|long|level_hold|builtin|sma20`, T);
  assert.deepEqual(run([mk("short", 11)], T + 5 * 60_000, d4).kept, []);
  // several setups on one side and bar: one, the most points; a named setup (gap and go) is never merged away
  const m = run([mk("long", 6, "vwap_reclaim"), mk("long", 7, "orb_reversal")], T, new Dedupe());
  assert.deepEqual([m.kept, m.refused], [["long:7"], { "vwap_reclaim:same_bar": 1 }]);
  assert.deepEqual(run([mk("long", 8, "orb_breakout"), mk("long", 6, "gap_and_go")], T, new Dedupe()).kept, ["long:6"]);
}

// ---- user setups: stored as data per account, BigIdea criteria on daily bars, served to their owner only ---------------
{
  const up: DailyBar[] = Array.from({ length: 80 }, (_, k) => ({ date: `d${String(k).padStart(3, "0")}`, open: 50 + k * 0.3, high: 51 + k * 0.3, low: 49.5 + k * 0.3, close: 50.5 + k * 0.3, volume: 2e6 }));
  const down = up.map((b, k) => ({ ...b, open: 100 - k * 0.3, high: 101 - k * 0.3, low: 99.5 - k * 0.3, close: 100.5 - k * 0.3 }));
  const nearMa: UserSetupRow = {
    ownerUserId: 7, setupKey: "near_20d", version: 2, name: "Within 0-5% over the 20-day", side: "long", timeframe: "daily", ideaId: null,
    criteria: [{ indicatorId: "MA-3", inverted: false, params: [{ name: "period", value: 20 }, { name: "maType", value: "sma" }, { name: "minPct", value: 0 }, { name: "maxPct", value: 5 }] }],
    entryRule: "prev_high", rangeAdr: 0.6, active: true,
  };
  assert.equal(validateUserSetup(nearMa, settings), null);
  assert.equal(userSetupPasses(nearMa, up), true, "rising: close is 0-5% over its 20-day");
  assert.equal(userSetupPasses(nearMa, down), false);
  assert.equal(userSetupPasses({ ...nearMa, criteria: [{ ...nearMa.criteria[0], inverted: true }] }, up), false, "inverted");
  assert.match(validateUserSetup({ ...nearMa, criteria: [{ indicatorId: "ITD-1", params: [] }] }, settings)!, /not allowed|intraday/);
  assert.match(validateUserSetup({ ...nearMa, criteria: [{ indicatorId: "CB-1", params: [] }] }, settings)!, /not allowed/);
  assert.match(validateUserSetup({ ...nearMa, criteria: [{ indicatorId: "NOPE", params: [] }] }, settings)!, /unknown indicator/);
  assert.match(validateUserSetup({ ...nearMa, criteria: Array(13).fill(nearMa.criteria[0]) }, settings)!, /at most 12/);
  assert.match(validateUserSetup({ ...nearMa, setupKey: "X" }, settings)!, /setup_key/);
  assert.match(validateUserSetup({ ...nearMa, side: "both" as any }, settings)!, /side/);

  // an idea-linked setup takes its owner's one daily thought; another account's idea or two thoughts are refused
  const idea = { user_id: 7, nodes: [{ id: "t1", type: "thought", thoughtTimeframe: "daily", thoughtCriteria: nearMa.criteria }, { id: "results", type: "results" }], edges: [] };
  assert.deepEqual(criteriaFromIdea(idea, 7), { criteria: nearMa.criteria });
  assert.deepEqual(criteriaFromIdea(idea, 8), { error: "idea belongs to another account" });
  assert.match((criteriaFromIdea({ ...idea, nodes: [...idea.nodes, { id: "t2", type: "thought", thoughtCriteria: [] }] }, 7) as any).error, /2 thoughts/);
  assert.match((criteriaFromIdea({ ...idea, nodes: [{ ...idea.nodes[0], thoughtTimeframe: "5min" }] }, 7) as any).error, /daily only/);
  const linked = resolveIdeas([{ ...nearMa, setupKey: "from_idea", ideaId: 41, criteria: [] }, { ...nearMa, setupKey: "missing", ideaId: 99, criteria: [] }], new Map([[41, idea]]));
  assert.deepEqual(linked.rows.map((r) => [r.setupKey, r.criteria.length]), [["from_idea", 1]]);
  assert.match(linked.report[0].reason!, /idea 99: idea not found/);

  const { runnable, report } = prepareUserSetups([nearMa, { ...nearMa, setupKey: "bad_one", criteria: [{ indicatorId: "PA-17", params: [] }] }], settings);
  assert.deepEqual(runnable.map((r) => r.setupKey), ["near_20d"]);
  assert.equal(report.find((r) => r.key === "bad_one")!.ok, false);
  const acc = newAcc();
  assembleChunk(new Map([["UPP", up], ["DWN", down]]), { capSize: new Map(), sector: new Map(), earnings: null, earningsAsOf: null }, settings, runnable, acc);
  assert.deepEqual([...acc.watch.keys()], ["UPP"], "the setup passed on last night's bars for UPP only");
  const w = acc.watch.get("UPP")![0];
  assert.deepEqual([w.setupOwner, w.entryName, w.entryLevel], ["user:7", "prev_high", up[79].high]);
  assert.equal(addShakeoutWatch([{ symbol: "UPP", date: "d070", close: 70 }, { symbol: "UPP", date: "d078", close: 73.9 }, { symbol: "ZZZ", date: "d078", close: 9 }], acc.watch, acc.contexts), 1, "newest hit per name, universe names only");

  // intraday: the user's setup fires near its entry level; its candidate is the owner's alone
  const c = acc.contexts.get("UPP")!;
  const e = w.entryLevel;
  const day = bars([[e - 0.3, e + 0.1, e - 0.4, e - 0.05, 400000]]);
  const res = runPass({ date: DATE, contexts: acc.contexts, bars: new Map([["UPP", day]]), watch: acc.watch, regime: regime("AGGRESSIVE"), rotation: noRotation, settings, dedupe: new Dedupe(), evaluated: new Map() });
  const mine = res.candidates.find((x) => x.setupKey === "near_20d");
  assert.ok(mine, "user setup raised");
  assert.deepEqual([mine!.setupOwner, mine!.ownerUserId, mine!.gradeComponents.setup], ["user:7", 7, 0]);
  assert.ok(c.adr > 0);
  const store = memoryTriggerStore();
  await store.insertCandidates(res.candidates);
  const q = (viewer: number | null) => store.listCandidates({ day: DATE, since: 0, grades: ["A", "B", "C"], limit: 50, viewerUserId: viewer });
  assert.ok((await q(7)).some((x) => x.setupKey === "near_20d"), "the owner sees it");
  assert.ok(!(await q(8)).some((x) => x.setupKey === "near_20d"), "another account does not");
  assert.ok(!(await q(null)).some((x) => x.setupOwner !== "builtin"), "no viewer: built-ins only");
}

console.log("trigger scanner triggers ok");
