import assert from "node:assert/strict";
import { BASE_SESSIONS, summarizeBars, type DailySummary, type DayBar } from "./daily-summary";
import { buildRows, dropStale, parseScreenQuery, runScreen, type LiveSym } from "./screen-core";
import { allowedPath } from "../middleware/animaGateway";

// ---- the summary: from bars oldest first ------------------------------------------------------------------------
const bars: DayBar[] = Array.from({ length: 260 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
  const c = 100 + i * 0.1;
  return { date: d, open: c, high: c + 2, low: c - 2, close: c, volume: 1_000_000 + (i === 259 ? 1_000_000 : 0) };
});
const sm = summarizeBars("TEST", bars)!;
assert.equal(sm.asOf, bars[259]!.date);
assert.equal(sm.close, bars[259]!.close);
assert.equal(sm.prevHigh, bars[258]!.high);
assert.equal(sm.baseHighIncl, Math.max(...bars.slice(-BASE_SESSIONS).map((b) => b.high)), "base high: the 30 sessions through the last one");
assert.equal(sm.baseHighPrior, bars[258]!.high, "...and the 30 before it (the last one is excluded)");
assert.ok(sm.baseHighIncl! > sm.baseHighPrior!);
assert.ok(Math.abs(sm.sma20! - bars.slice(-20).reduce((a, b) => a + b.close, 0) / 20) < 1e-9);
assert.ok(sm.sma200 !== null && sm.sma50 !== null);
assert.equal(Math.round(sm.volExp!), 2, "last day is 2x the 20 sessions before it");
assert.equal(summarizeBars("X", bars.slice(0, 10)), null, "too short: no summary");
assert.equal(summarizeBars("X", bars.slice(0, 60))!.sma200, null, "no 200-day average on 60 bars");

// ---- rows: live theme name vs pool name ---------------------------------------------------------------------------
const summ = (symbol: string, over: Partial<DailySummary> = {}): DailySummary => ({ ...sm, symbol, sector: "Technology", industry: "Software", capSize: "LARGE", marketCap: 5e10, ...over });
const live = (symbol: string, over: Partial<LiveSym> = {}): LiveSym => ({
  symbol, themeIds: ["AI_INFRA"], price: 130, prevClose: 125, changePct: 4, vwap: 128, dayHigh: 131, dayLow: 126, volume: 3_000_000,
  prevDayHigh: 127, prevDayLow: 122, avgVolume20D: 1_500_000, pctVsEma10d: 2, pctVsEma20d: 3, pctVsSma20d: 3.5, pctVsSma50d: 6, pctVsSma200d: 20,
  trendState: "Bull", rsRank: 2, isLeader: true, snapshotAt: "2026-11-20T15:00:00.000Z", etDate: "2026-11-20", ...over,
});
const summaries = new Map<string, DailySummary>([
  ["NVDA", summ("NVDA", { asOf: "2026-11-19", baseHighIncl: 129, baseHighPrior: 120 })],
  ["POOL1", summ("POOL1", { asOf: "2026-11-19", close: 50, prevClose: 48, high: 51, low: 49, prevHigh: 49.5, prevLow: 47, baseHighPrior: 52, sma50: 45, sma200: 40, ema10: 49, ema20: 48, sma20: 47.5, avgDollarVol20: 40e6, volExp: 1.8, capSize: "MID", marketCap: 3e9 })],
  ["OLDTHEME", summ("OLDTHEME", { asOf: "2026-11-19" })],
]);
const all = buildRows([live("NVDA")], summaries, (s) => (s === "OLDTHEME" ? ["SEMIS"] : []));
const nv = all.find((r) => r.symbol === "NVDA")!;
const pool = all.find((r) => r.symbol === "POOL1")!;
const old = all.find((r) => r.symbol === "OLDTHEME")!;
assert.equal(nv.source, "live");
assert.equal(nv.priceAsOf, "2026-11-20T15:00:00.000Z");
assert.equal(nv.baseHigh, 129, "live row, summary is yesterday: base high through yesterday");
assert.equal(nv.dayHigh, 131);
assert.equal(nv.dayLow, 126);
assert.equal(nv.vwapPct, 1.5625);
assert.equal(nv.capSize, "LARGE");
assert.equal(nv.sector, "Technology");
assert.equal(nv.dollarVol, 130 * 1_500_000);
assert.equal(nv.volExp, 2);
assert.equal(pool.source, "eod");
assert.equal(pool.priceAsOf, "2026-11-19", "an end-of-day row carries its session date, never a time");
assert.equal(pool.vwapPct, null);
assert.deepEqual(pool.themeIds, [], "pool-only: no theme");
assert.equal(pool.themeId, null);
assert.equal(pool.baseHigh, 52, "end-of-day row: the base before its own day");
assert.equal(pool.dayHigh, 51);
assert.equal(pool.prevDayHigh, 49.5);
assert.equal(pool.rsRank, null);
assert.equal(pool.isLeader, null);
assert.equal(pool.trendState, "Bull");
assert.equal(pool.changePct, 4.1667);
assert.equal(pool.capSize, "MID");
assert.deepEqual(old.themeIds, ["SEMIS"], "a theme name without a live snapshot is end-of-day but keeps its theme");
const sameDay = buildRows([live("NVDA", { etDate: "2026-11-19" })], summaries, () => []).find((r) => r.symbol === "NVDA")!;
assert.equal(sameDay.baseHigh, 120, "summary already includes today: use the base before it");

// ---- query parsing --------------------------------------------------------------------------------------------------
const ok = (q: Record<string, unknown>) => {
  const p = parseScreenQuery(q);
  assert.equal(p.ok, true, JSON.stringify(p));
  return (p as any).query;
};
const bad = (q: Record<string, unknown>, re: RegExp) => {
  const p = parseScreenQuery(q);
  assert.equal(p.ok, false);
  assert.match((p as any).error, re);
};
assert.equal(ok({}).limit, 50);
assert.equal(ok({}).sort, "dollarVol");
assert.equal(ok({}).dir, "desc");
assert.equal(ok({ limit: "500" }).limit, 100, "limit is capped at 100");
assert.equal(ok({ sort: "rsRank" }).dir, "asc", "rsRank: best (1) first");
assert.equal(ok({ sort: "rsRank", dir: "desc" }).dir, "desc");
assert.deepEqual(ok({ symbols: "nvda, brk-b ,NVDA" }).symbols, ["NVDA", "BRK.B"]);
bad({ sort: "colour" }, /sort must be one of/);
bad({ above: "ema7" }, /above/);
bad({ nearMa: "ema10" }, /nearPct/);
bad({ pctMin: "abc" }, /pctMin/);
bad({ side: "flat" }, /side/);
bad({ symbols: "A B" }, /symbols/);
bad({ symbols: Array.from({ length: 101 }, (_, i) => "S" + i).join(",") }, /at most 100/);
bad({ limit: "0" }, /limit/);

// ---- filters, sort, symbols -----------------------------------------------------------------------------------------
const big = buildRows(
  [
    live("AAA", { changePct: 5, themeIds: ["T1"] }),
    live("BBB", { changePct: -2, themeIds: ["T2"], price: 110, vwap: 112, pctVsSma50d: -3, trendState: "Transition", rsRank: 1 }),
    live("CCC", { changePct: 1, themeIds: ["T1"], rsRank: 3 }),
  ],
  new Map([...summaries, ["AAA", summ("AAA")], ["BBB", summ("BBB")], ["CCC", summ("CCC")]]),
  () => [],
);
const run = (q: Record<string, unknown>) => runScreen(big, ok(q));
const syms = (q: Record<string, unknown>) => run(q).rows.map((r) => r.symbol);
assert.equal(syms({ sort: "changePct" })[0], "AAA", "descending: the biggest change first");
assert.equal(syms({ sort: "changePct", dir: "asc" })[0], "BBB");
assert.deepEqual(syms({ sort: "rsRank", themes: "T1,T2" }), ["BBB", "AAA", "CCC"], "rsRank ascending: 1 first");
assert.deepEqual(syms({ themes: "T2" }), ["BBB"]);
assert.ok(syms({ universe: "pool" }).includes("POOL1"), "pool view has POOL1");
assert.ok(run({ universe: "pool" }).rows.every((r) => r.themeIds.length === 0), "pool-only names have no theme");
assert.ok(run({ universe: "themes" }).rows.every((r) => r.themeIds.length > 0));
assert.deepEqual(syms({ below: "sma50", themes: "T1,T2" }), ["BBB"]);
assert.deepEqual(syms({ above: "vwap,sma50", themes: "T1,T2" }).sort(), ["AAA", "CCC"]);
assert.deepEqual(syms({ side: "short", themes: "T1,T2" }), ["BBB"]);
assert.deepEqual(syms({ nearHigh: "1", themes: "T1" }).sort(), ["AAA", "CCC"], "price 130 vs prior high 127: through it");
assert.equal(run({ minDollarVol: "1e12" }).matched, 0);
assert.equal(syms({ trend: "Transition" })[0], "BBB");
assert.ok(syms({ minVolExp: "1.5", universe: "pool" }).includes("POOL1"));
assert.ok(!syms({ minVolExp: "5", universe: "pool" }).includes("POOL1"));

// symbols: a row each, wherever they rank; missing and filtered-out names are said, never silent
const w = run({ symbols: "POOL1,AAA,NOPE,BBB", pctMin: "0" });
assert.deepEqual(w.rows.map((r) => r.symbol).sort(), ["AAA", "POOL1"]);
assert.deepEqual(w.missing, ["NOPE"]);
assert.deepEqual(w.unmatched, ["BBB"], "BBB is down today: the filter dropped it, and the answer says so");
const w2 = run({ symbols: "POOL1,AAA,BBB,CCC", limit: "2" });
assert.equal(w2.returned, 2);
assert.equal(w2.matched, 4);
assert.equal(w2.truncated, true);
assert.equal(run({ symbols: "OLDTHEME" }).rows[0]!.source, "eod");

// ---- names whose bars stopped are not served as prices -----------------------------------------------------------
const dropped = dropStale(new Map([["A", summ("A", { asOf: "2026-11-19" })], ["B", summ("B", { asOf: "2026-11-13" })], ["C", summ("C", { asOf: "2026-03-10" })]]));
assert.deepEqual([...dropped.kept.keys()], ["A", "B"], "7 calendar days behind the newest is the edge");
assert.equal(dropped.dropped, 1);

// ---- gateway: R7 is on Anima's allow-list, read only ---------------------------------------------------------------
assert.equal(allowedPath("/api/market-condition/screen"), true);
assert.equal(allowedPath("/api/market-condition/screen", "POST"), false);
assert.equal(allowedPath("/api/market-condition/screens"), false);

console.log("screen tests passed");
