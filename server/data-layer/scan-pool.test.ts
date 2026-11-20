import assert from "node:assert/strict";
import { meetsFloor, normalizePoolSymbol, parseScreenerRows, planPoolRefresh, refreshScanPool, type PoolCandidate } from "./scan-pool";
import { mergeBarUniverse, scanPoolEnabled } from "./bar-universe";

// ---- symbols: common stock shaped only, FMP's BRK-B spelt the MarketFlow way ---------------------------------------------
assert.equal(normalizePoolSymbol("brk-b"), "BRK.B");
assert.equal(normalizePoolSymbol("AAPL"), "AAPL");
assert.equal(normalizePoolSymbol("ACACW"), null, "warrant");
assert.equal(normalizePoolSymbol("XYZU"), "XYZU", "four letters is a ticker, not a unit");
assert.equal(normalizePoolSymbol("ABC-PA"), null, "preferred");
assert.equal(normalizePoolSymbol("TOOLONGX"), null);

// ---- screener rows ----------------------------------------------------------------------------------------------------------
const row = (symbol: string, marketCap: number, price: number, avgVolume: number, extra: object = {}) =>
  ({ symbol, companyName: symbol + " Inc", marketCap, price, avgVolume, exchangeShortName: "NASDAQ", sector: "Tech", industry: "X", isEtf: false, isFund: false, ...extra });
const parsed = parseScreenerRows([row("AAA", 5e9, 20, 3e6), row("SPY", 5e11, 600, 7e7, { isEtf: true }), row("BAD", 0, 10, 1e6), row("BBBBW", 2e9, 10, 1e6), { nope: 1 }]);
assert.deepEqual(parsed.map((p) => p.symbol), ["AAA"], "ETFs, bad rows and odd symbols dropped");
assert.equal(parsed[0]!.avgDollarVol, 6e7, "average traded value = average volume x price");

// ---- the three floors, all required --------------------------------------------------------------------------------------
const c = (symbol: string, marketCap: number, price: number, avgDollarVol: number): PoolCandidate => ({ symbol, companyName: null, exchange: null, sector: null, industry: null, marketCap, price, avgDollarVol });
assert.equal(meetsFloor(c("A", 1e9, 6, 50e6)), true, "all three at the floor: in");
assert.equal(meetsFloor(c("A", 0.99e9, 20, 80e6)), false, "cap short");
assert.equal(meetsFloor(c("A", 5e9, 5.99, 80e6)), false, "price short");
assert.equal(meetsFloor(c("A", 5e9, 20, 49e6)), false, "$30M names do not get in at $50M");
assert.equal(meetsFloor(c("A", 0.8e9, 4.8, 40e6), 0.8), true, "keep band is 80% of each floor");

// ---- planning: new, kept, hysteresis, dropped, back, guards ---------------------------------------------------------------
const filler = Array.from({ length: 700 }, (_, i) => c("F" + String(i).padStart(3, "0").replace(/\d/g, (d) => "ABCDEFGHIJ"[+d]), 5e9, 20, 80e6));
const stored = [
  { symbol: "KEEP", active: true },   // still fine
  { symbol: "HOVER", active: true },  // slipped to $45M: inside the keep band
  { symbol: "GONE", active: true },   // below the band
  { symbol: "MISSING", active: true },// not returned at all
  { symbol: "BACK", active: false },  // was out, now qualifies
  { symbol: "STAYOUT", active: false },// was out, between the bands: stays out
];
const rows = [...filler, c("KEEP", 3e9, 30, 90e6), c("HOVER", 3e9, 30, 45e6), c("GONE", 3e9, 30, 30e6), c("BACK", 2e9, 15, 60e6), c("STAYOUT", 2e9, 15, 45e6), c("NEWBIE", 4e9, 50, 120e6), c("SMALLFRY", 4e8, 50, 120e6)];
const stored2 = [...stored, ...filler.slice(0, 700).map((f) => ({ symbol: f.symbol, active: true }))];
const plan = planPoolRefresh(stored2, rows);
assert.deepEqual(plan.added.map((a) => a.symbol), ["NEWBIE"]);
assert.deepEqual(plan.reactivated.map((a) => a.symbol), ["BACK"]);
assert.ok(plan.kept.some((k) => k.symbol === "HOVER"), "a name hovering under the floor is kept, not flipped");
assert.deepEqual(plan.deactivated.sort(), ["GONE", "MISSING"]);
assert.equal(plan.guard, null);

const thin = planPoolRefresh(stored2, rows.slice(0, 100));
assert.match(thin.guard!, /fewer than 600/);
assert.deepEqual(thin.deactivated, [], "a partial answer deactivates nothing");
const lost = planPoolRefresh(stored2, filler.slice(0, 650));
assert.equal(lost.guard, null, "54 of 704 dropping is ordinary churn");
assert.equal(lost.deactivated.length, 54);
const collapse = planPoolRefresh(stored2, filler.slice(0, 310)); // 600 rows min is the first guard
assert.match(collapse.guard!, /fewer than 600/);

// ---- dry run writes nothing and counts what a real run would do -----------------------------------------------------------
const writes: string[] = [];
const fakeDb = { execute: async (q: any) => { writes.push("x"); throw new Error("no table"); } };
const dry = await refreshScanPool(fakeDb, { dryRun: true, universe: new Set(["KEEP"]), fetchRows: async () => rows });
assert.equal(dry.dryRun, true);
assert.equal(dry.added, 703, "700 filler + KEEP + BACK + NEWBIE meet the full floor; HOVER, GONE, STAYOUT, SMALLFRY do not");
assert.equal(writes.length, 1, "only the read of the stored pool ran");
assert.equal(dry.active.before, 0);

// ---- universe: pool joins the bars universe, retired leave, kill switch -------------------------------------------------
assert.deepEqual(mergeBarUniverse(["AAA"], ["NEWBIE", "AAA"], ["NEWBIE"]), ["AAA"]);
assert.equal(scanPoolEnabled({}), true);
assert.equal(scanPoolEnabled({ SCAN_POOL: "off" }), false);

console.log("scan-pool tests passed");
