import assert from "node:assert/strict";
import { bucketOf, BOUNDARIES } from "./utils/cap-size";
import { judge, needsSecondOpinion, plan, refreshMarketCaps, type Sources, type Stored } from "./utils/market-cap-refresh";

// ---- one set of boundaries -------------------------------------------------------------------------------------------
assert.deepEqual(BOUNDARIES, { MEGA: 200e9, LARGE: 10e9, MID: 2e9, SMALL: 300e6 });
assert.equal(bucketOf(5.09e12), "MEGA");
assert.equal(bucketOf(200e9), "MEGA", "the lower bound belongs to the bucket");
assert.equal(bucketOf(199.9e9), "LARGE");
assert.equal(bucketOf(10e9), "LARGE");
assert.equal(bucketOf(9.99e9), "MID");
assert.equal(bucketOf(2e9), "MID");
assert.equal(bucketOf(1.99e9), "SMALL");
assert.equal(bucketOf(300e6), "SMALL");
assert.equal(bucketOf(299e6), "MICRO");

// ---- plausibility -------------------------------------------------------------------------------------------------------
const st = (symbol: string, marketCap: number | null, bucket: Stored["bucket"] = null): Stored => ({ symbol, marketCap, bucket });
assert.deepEqual(judge(st("A", 50e9), 0), { ok: false, reason: "zero or negative" });
assert.deepEqual(judge(st("A", 50e9), -5), { ok: false, reason: "zero or negative" });
assert.deepEqual(judge(st("A", null), 2e13), { ok: false, reason: "above $10T" });
assert.equal(judge(st("A", 50e9), 60e9).ok, true);
assert.equal(judge(st("A", 50e9), 4.9e9).ok, false, "more than 10x down vs stored");
assert.match((judge(st("A", 5e9), 60e9) as any).reason, /12\.0x up vs stored/);
assert.equal(judge(st("A", 5e9), 60e9, 58e9).ok, true, "Finnhub agrees within 25%: accepted");
assert.equal(judge(st("A", 5e9), 60e9, 6e9).ok, false, "Finnhub disagrees: rejected");
assert.equal(judge(st("A", 1.36e15), 5e9).ok, true, "an implausible stored value is not a yardstick");
assert.equal(judge(st("A", null), 5e9).ok, true, "nothing stored: no ratio test");
assert.equal(needsSecondOpinion(st("A", 5e9), 60e9), true);
assert.equal(needsSecondOpinion(st("A", 5e9), 6e9), false);
assert.equal(needsSecondOpinion(st("A", null), 60e9), false);

// ---- the plan's counts ------------------------------------------------------------------------------------------------
const stored = [st("AAPL", 4.9e12, "MEGA"), st("CRDO", 25e9, "MID"), st("NEWB", null, null), st("JUMP", 1e9, "SMALL"), st("GONE", 3e9, "MID"), st("ZERO", 1e9, null)];
const fetched = new Map([["AAPL", 5.09e12], ["CRDO", 24e9], ["NEWB", 400e6], ["JUMP", 50e9], ["ZERO", 0]]);
const p = plan(stored, fetched, new Map([["JUMP", 1e9]]));
assert.deepEqual(p.accepted.map((a) => `${a.symbol} ${a.oldBucket}->${a.newBucket}`), ["AAPL MEGA->MEGA", "CRDO MID->LARGE", "NEWB null->SMALL"]);
assert.deepEqual(p.rejected.map((r) => r.symbol), ["JUMP", "ZERO"], "listed, not written");
assert.deepEqual(p.noData, ["GONE"]);
assert.deepEqual({ ...p.counts, byBucket: undefined }, { bucketChanged: 1, nullToBucket: 1, sameBucket: 1, byBucket: undefined, keptOldBucketNoData: 1 });

// ---- dry run writes nothing; the real run appends history then updates the current value ------------------------------
(async () => {
  const statements: string[] = [];
  const db = {
    async execute(q: any) {
      const text = JSON.stringify(q?.queryChunks ?? q ?? "");
      statements.push(text);
      if (/SELECT symbol, market_cap, market_cap_size FROM tickers/.test(text)) return { rows: stored.map((s) => ({ symbol: s.symbol, market_cap: s.marketCap, market_cap_size: s.bucket })) };
      return { rows: [], rowCount: 1 };
    },
  };
  let finnhubCalls = 0;
  const sources: Sources = { async fmpBatch(syms) { return new Map([...fetched].filter(([s]) => syms.includes(s))); }, async finnhub() { finnhubCalls++; return 1e9; }, async sleep() {} };
  const logs: string[] = [];
  const dry: any = await refreshMarketCaps(db, { dryRun: true, sources, asOf: "2026-11-20", log: (s) => logs.push(s) });
  assert.equal(dry.dryRun, true);
  assert.equal(statements.length, 1, "the dry run only reads the tickers table");
  assert.deepEqual([dry.counts.bucketChanged, dry.counts.nullToBucket], [1, 1]);
  assert.ok(logs.some((l) => /1 change bucket, 1 go from no bucket to a bucket/.test(l)));
  assert.ok(logs.some((l) => /rejected JUMP/.test(l)));
  assert.equal(finnhubCalls, 1, "Finnhub only for the >10x move");

  statements.length = 0;
  const run: any = await refreshMarketCaps(db, { dryRun: false, sources, asOf: "2026-11-20", log: () => {} });
  assert.equal(run.written, 3);
  const ins = statements.filter((s) => /INSERT INTO market_cap_history/.test(s)).length;
  const upd = statements.filter((s) => /UPDATE tickers SET market_cap/.test(s)).length;
  assert.deepEqual([ins, upd], [3, 3], "a history row and a current-value update per accepted cap");
  assert.equal(statements.some((s) => /DELETE/i.test(s)), false, "nothing is deleted");
  assert.ok(statements.findIndex((s) => /INSERT INTO market_cap_history/.test(s)) < statements.findIndex((s) => /UPDATE tickers/.test(s)), "history first");

  // a failed FMP batch: no writes at all
  statements.length = 0;
  const failed: any = await refreshMarketCaps(db, { dryRun: false, sources: { ...sources, async fmpBatch() { throw new Error("FMP 429"); } }, asOf: "2026-11-20", log: () => {} });
  assert.equal(failed.written, 0);
  assert.equal(failed.aborted, "FMP batch failed");
  assert.equal(statements.length, 1);
  console.log("market cap refresh tests passed");
})().catch((e) => { console.error(e); process.exit(1); });
