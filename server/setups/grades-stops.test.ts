import assert from "node:assert/strict";
import { byGrade, DEFAULT_GRADES, flags, gradesWanted, parseSettings } from "./grades";
import { stopLevels, STOP_ORDER } from "./stop-levels";
import { scanLeaderShakeout, type BarSource } from "./leader-shakeout-job";
import { RULE_VERSION } from "./leader-shakeout";
import type { RunRow, ShakeoutRow } from "./store";
import { series } from "./fixtures";
import type { DBar } from "./daily-math";
import { refreshUpcomingEarnings } from "../earnings/upcoming";

// ---- grades: A = liquid and gapped, B = one, C = neither ------------------------------------------------------------
const S = DEFAULT_GRADES;
assert.deepEqual(flags(150e6, -1.5, S), { liquid: true, gapped: true, grade: "A" });
assert.deepEqual(flags(150e6, -0.5, S), { liquid: true, gapped: false, grade: "B" });
assert.deepEqual(flags(50e6, -1.0, S), { liquid: false, gapped: true, grade: "B" }, "exactly 1 ATR below counts");
assert.deepEqual(flags(99e6, -0.99, S), { liquid: false, gapped: false, grade: "C" });
assert.equal(flags(100e6, 0, S).liquid, true, "$100M exactly counts");
// thresholds are settings: a retune regrades the same stored numbers
assert.equal(flags(80e6, -0.8, { liquidDollarVol: 75e6, gapAtr: 0.75 }).grade, "A");
assert.deepEqual(parseSettings('{"liquidDollarVol":75000000}'), { liquidDollarVol: 75e6, gapAtr: 1 });
assert.deepEqual(parseSettings({ liquidDollarVol: -5, gapAtr: "x" }), DEFAULT_GRADES, "bad values keep the defaults");
assert.deepEqual(parseSettings("not json"), DEFAULT_GRADES);
// what he sees by default: A first, then B; C only when asked
assert.deepEqual(gradesWanted(undefined), ["A", "B"]);
assert.deepEqual(gradesWanted("all"), ["A", "B", "C"]);
assert.deepEqual(gradesWanted("c"), ["C"]);
const rows = [
  { grade: "C" as const, market_date: "2026-11-05", drop_atr: 5 },
  { grade: "B" as const, market_date: "2026-10-30", drop_atr: 3 },
  { grade: "A" as const, market_date: "2026-10-29", drop_atr: 6 },
  { grade: "B" as const, market_date: "2026-11-05", drop_atr: 2 },
  { grade: "A" as const, market_date: "2026-10-29", drop_atr: 7 },
];
assert.deepEqual(byGrade(rows.filter((r) => gradesWanted(undefined).includes(r.grade))).map((r) => `${r.grade} ${r.market_date} ${r.drop_atr}`),
  ["A 2026-10-29 7", "A 2026-10-29 6", "B 2026-11-05 2", "B 2026-10-30 3"], "A then B, newest first, biggest drop first; no C");

// ---- stop levels: levels under the close, distance in percent, the first in Don's order inside 5% --------------------
const flat = (n: number, c: number): DBar[] => Array.from({ length: n }, (_, i) => ({ date: `d${String(i).padStart(3, "0")}`, open: c, high: c + 1, low: c - 1, close: c, volume: 1e6 }));
{
  // 60 days at 100, then the hit day closes at 103 with a low of 101: every average (about 100) is 2.9% below
  const b = flat(60, 100); b.push({ date: "d060", open: 104, high: 105, low: 101, close: 103, volume: 3e6 });
  const s = stopLevels(b, b.length - 1, 102);
  assert.equal(s.first, "sma50", "the 50-day comes first in his order");
  assert.ok(Math.abs(s.levels.sma50!.distPct - ((103 - s.levels.sma50!.level) / 103) * 100) < 1e-12);
  assert.ok(s.firstDistPct! < 5);
  assert.equal(s.levels.lowOfDay!.level, 101);
  assert.equal(s.levels.prevDayLow!.level, 99);
  assert.equal(s.levels.vwap!.level, 102);
  assert.equal(s.noStopInside5, false);
  assert.deepEqual(Object.keys(s.levels), [...STOP_ORDER]);
}
{
  // a shakeout: closes far under every average; only the low of the day sits under the close, 1% down: it is first
  const b = flat(60, 100); b.push({ date: "d060", open: 92, high: 93, low: 89, close: 90, volume: 3e6 });
  const s = stopLevels(b, b.length - 1, 91);
  assert.equal(s.levels.sma50, null, "an average above the close is not a stop level");
  assert.equal(s.levels.vwap, null, "VWAP above the close: none");
  assert.equal(s.first, "lowOfDay");
  assert.ok(Math.abs(s.firstDistPct! - (1 / 90) * 100) < 1e-9);
}
{
  // nothing within 5%: still a result, flagged
  const b = flat(60, 100); b.push({ date: "d060", open: 140, high: 150, low: 120, close: 150, volume: 3e6 });
  const s = stopLevels(b, b.length - 1, null);
  assert.equal(s.first, null);
  assert.equal(s.noStopInside5, true);
  assert.ok(s.levels.sma50!.distPct > 5);
  assert.equal(s.levels.vwap, null, "no VWAP available");
}

(async () => {
  // ---- the job stores grade and stops on every hit (a no-stop hit is still stored) ---------------------------------
  const hit = series({ volume: 1_000_000, gapAtrs: 1.2 });
  const runs = new Map<string, RunRow>(), hits = new Map<string, ShakeoutRow>();
  const store = {
    async doneDates() { return new Set([...runs.values()].map((r) => r.marketDate)); },
    async insertShakeouts(r: ShakeoutRow[]) { for (const x of r) hits.set(x.symbol + x.date, x); return r.length; },
    async insertRun(r: RunRow) { runs.set(r.marketDate, r); return 1; },
  };
  const src: BarSource = {
    async sessions() { return hit.map((x) => x.date); }, async symbols() { return ["HIT"]; }, async countOn() { return 1; },
    async bars(s, from) { return new Map(s.map((x) => [x, hit.filter((b) => b.date >= from)])); },
    async indexBars() { return {}; }, themes: () => [], mfRegime: () => null,
    async vwaps(p) { return new Map(p.map((x) => [`${x.symbol}|${x.date}`, 1e9])); }, // above any close: no VWAP level
    async gradeSettings() { return DEFAULT_GRADES; },
  };
  await scanLeaderShakeout(src, store, {});
  const row = [...hits.values()][0];
  assert.equal(row.ruleVersion, RULE_VERSION);
  assert.equal(row.grade, "A", "about $112M a day and opened 1.2 ATR down");
  assert.deepEqual(row.gradeSettings, DEFAULT_GRADES);
  assert.equal(row.vwap, 1e9);
  assert.equal(row.stops.levels.vwap, null);
  assert.ok(row.stops.first === null || row.stops.firstDistPct! <= 5);
  // with a C-grade threshold set the same hit is stored as C (and stays a hit)
  hits.clear(); runs.clear();
  await scanLeaderShakeout({ ...src, gradeSettings: async () => ({ liquidDollarVol: 1e12, gapAtr: 9 }) }, store, {});
  assert.equal([...hits.values()][0].grade, "C");

  // ---- the calendar: a failed window stores nothing for the day ------------------------------------------------------
  let execs = 0;
  const db = { execute: async () => { execs++; return { rows: [] }; } };
  const r = await refreshUpcomingEarnings(db, new Set(["AAPL"]), { fetchedOn: "2026-11-20", fetcher: async (f) => { if (f > "2026-12-01") throw new Error("Finnhub API error 403"); return [{ symbol: "AAPL", date: "2026-11-25", hour: "amc", epsEstimate: 1, epsActual: null, revenueEstimate: null, revenueActual: null, quarter: 1, year: 2027 }]; } });
  assert.match(String(r.failed), /403/);
  assert.equal(r.inserted, 0);
  const before = execs;
  assert.equal(before <= 3, true, "only the CREATE TABLE statements ran, no INSERT");
  console.log("grades and stop-level tests passed");
})().catch((e) => { console.error(e); process.exit(1); });
