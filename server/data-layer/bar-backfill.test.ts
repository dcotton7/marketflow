import assert from "node:assert/strict";
import { expectedLastSession, mergeBarUniverse, splitStale } from "./bar-universe";
import { backfillSymbol, planBackfill, rowsForInsert, type BarStat, type FetchedBar, type InsertRow } from "./bar-backfill";

// ---- universe: lists + tickers table - retired --------------------------------------------------------------------
assert.deepEqual(
  mergeBarUniverse(["spy", "AAPL", " "], ["AAPL", "zzz", "OLD"], ["old", "SPYX"]),
  ["AAPL", "SPY", "ZZZ"],
  "upper-cased, de-duplicated, sorted; a retired name leaves whichever list it came from"
);

// ---- the last finished session ------------------------------------------------------------------------------------
const at = (iso: string) => new Date(iso);
assert.equal(expectedLastSession(at("2026-11-19T22:00:00Z")), "2026-11-19", "Thu 17:00 ET: today's bar is final");
assert.equal(expectedLastSession(at("2026-11-19T15:00:00Z")), "2026-11-18", "Thu 10:00 ET: yesterday");
assert.equal(expectedLastSession(at("2026-11-21T17:00:00Z")), "2026-11-20", "Saturday: Friday");
assert.equal(expectedLastSession(at("2026-11-23T14:00:00Z")), "2026-11-20", "Monday morning: Friday");
assert.equal(expectedLastSession(at("2026-11-26T23:00:00Z")), "2026-11-25", "Thanksgiving evening: Wednesday");

// ---- stale split: stalest first, never-fetched first ---------------------------------------------------------------
const newest = new Map([["AAA", "2026-11-19"], ["BBB", "2026-03-10"], ["CCC", "2026-07-01"], ["DDD", "2026-11-18"]]);
const sp = splitStale(["AAA", "BBB", "CCC", "DDD", "EEE"], newest, "2026-11-19");
assert.deepEqual(sp.fresh, ["AAA"]);
assert.deepEqual(sp.stale, ["EEE", "BBB", "CCC", "DDD"], "no bar at all first, then oldest newest-bar");

// ---- the plan -------------------------------------------------------------------------------------------------------
const stats = new Map<string, BarStat>([
  ["AAA", { min: "2024-06-03", max: "2026-11-19", count: 640 }],
  ["BBB", { min: "2025-01-31", max: "2026-03-10", count: 270 }],
  ["CCC", { min: "2024-06-03", max: "2026-07-01", count: 540 }],
]);
const plan = planBackfill(["AAA", "BBB", "CCC", "DDD"], stats);
assert.equal(plan.latestSession, "2026-11-19");
assert.equal(plan.withLatest, 1);
assert.deepEqual(plan.targets, ["BBB", "CCC", "DDD"]);
assert.deepEqual(plan.noBarsAtAll, ["DDD"]);
assert.deepEqual(plan.stopped, ["BBB", "CCC"]);
assert.equal(plan.shallow, 1, "BBB starts after the requested depth");
assert.equal(plan.from, "2024-06-01");
assert.deepEqual(planBackfill(["AAA", "BBB"], stats, { only: ["aaa"] }).targets, ["AAA"], "--symbols picks exactly those");

// ---- rows: the bar of a session in progress is not stored ---------------------------------------------------------
const bar = (date: string, c = 10): FetchedBar => ({ date, open: 9, high: 11, low: 8, close: c, volume: 1000.4 });
const noon = at("2026-11-19T17:00:00Z"); // Thu 12:00 ET, regular session
const rows = rowsForInsert("brk.b", [bar("2026-11-18T05:00:00Z"), bar("2026-11-19T05:00:00Z"), bar("2026-11-18T05:00:00Z")], noon);
assert.equal(rows.length, 1, "today's developing bar and a repeated date are dropped");
assert.equal(rows[0]!.symbol, "BRK.B");
assert.equal(rows[0]!.barDate, "2026-11-18");
assert.equal(rows[0]!.volume, 1000);
assert.equal(rowsForInsert("X", [bar("2026-11-19T05:00:00Z")], at("2026-11-19T22:00:00Z")).length, 1, "after the close it is final");

// ---- inserts only, safe to run again -------------------------------------------------------------------------------
// An in-memory table with the same ON CONFLICT DO NOTHING behaviour as the real insert.
const table = new Map<string, InsertRow>();
table.set("BBB|2025-02-03", { symbol: "BBB", barDate: "2025-02-03", open: "1", high: "1", low: "1", close: "777", volume: 5 }); // a good bar already there
const insertChunk = async (rs: InsertRow[]) => {
  let n = 0;
  for (const r of rs) {
    const k = `${r.symbol}|${r.barDate}`;
    if (!table.has(k)) { table.set(k, r); n++; }
  }
  return n;
};
const fetched: FetchedBar[] = [bar("2025-02-03T05:00:00Z", 12), bar("2025-02-04T05:00:00Z", 13), bar("2025-02-05T05:00:00Z", 14)];
const after = at("2026-11-19T22:00:00Z");
const first = await backfillSymbol("BBB", at("2024-06-01T00:00:00Z"), after, async () => fetched, insertChunk, after);
assert.deepEqual([first.fetched, first.inserted, first.unserved], [3, 2, undefined]);
assert.equal(table.get("BBB|2025-02-03")!.close, "777", "an existing bar is never overwritten");
const second = await backfillSymbol("BBB", at("2024-06-01T00:00:00Z"), after, async () => fetched, insertChunk, after);
assert.equal(second.inserted, 0, "a second run inserts nothing");
assert.equal(table.size, 3, "and nothing was removed");

// chunking: 1,200 bars go in as three writes
const many: FetchedBar[] = Array.from({ length: 1200 }, (_, i) => bar(new Date(Date.UTC(2020, 0, 2 + i, 5)).toISOString()));
let writes = 0;
const big = await backfillSymbol("BIG", at("2020-01-01T00:00:00Z"), after, async () => many, async (rs) => { writes++; return rs.length; }, after);
assert.equal(writes, 3);
assert.equal(big.inserted, 1200);

// ---- vendor cannot serve a name: reported, not fatal ---------------------------------------------------------------
const none = await backfillSymbol("ZZZZ", noon, after, async () => [], insertChunk, after);
assert.deepEqual(none, { symbol: "ZZZZ", fetched: 0, inserted: 0, unserved: "no bars returned" });
const bad = await backfillSymbol("QQQQ", noon, after, async () => { throw new Error("Alpaca API error 422: invalid symbol"); }, insertChunk, after);
assert.match(bad.unserved!, /422/);
await assert.rejects(
  backfillSymbol("AAAA", noon, after, async () => { throw new Error("Alpaca API error 401: unauthorized"); }, insertChunk, after),
  /401/,
  "a credentials error stops the run"
);

console.log("bar-backfill tests passed");
