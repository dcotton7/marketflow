import assert from "node:assert/strict";
import { ADVISORY_KEY, guardState, guardTrippedToday, lockHolder, memLine, overLimit, resetGuardForTests, rssLimitMb, tryAcquire, withJobLock } from "./job-guard";
import { chunkRows, maFromClosesDesc, recalculateTickerMAs } from "../data-layer/daily-bar-refresh";

const logs: string[] = [];
const origLog = console.log, origWarn = console.warn;
console.log = (...a: unknown[]) => { logs.push(a.join(" ")); };
console.warn = (...a: unknown[]) => { logs.push(a.join(" ")); };
const quiet = () => { console.log = origLog; console.warn = origWarn; };

(async () => {
  // ---- the setting ------------------------------------------------------------------------------------------------
  assert.equal(rssLimitMb({}), 1300, "default 1,300 MB");
  assert.equal(rssLimitMb({ JOB_RSS_LIMIT_MB: "1100" }), 1100);
  assert.equal(rssLimitMb({ JOB_RSS_LIMIT_MB: "5" }), 1300, "a silly value falls back");
  assert.match(memLine(), /^rss \d+ MB, heap \d+ MB, external \d+ MB$/);

  // ---- one job at a time -------------------------------------------------------------------------------------------
  resetGuardForTests();
  const release = await tryAcquire("daily bar job");
  assert.ok(release);
  assert.equal(lockHolder(), "daily bar job");
  assert.equal(await tryAcquire("scan pool refresh"), null, "a second start is refused");
  assert.ok(logs.some((l) => /scan pool refresh not started: daily bar job is running/.test(l)), "and the skipped start is logged");
  const both = await Promise.all([withJobLock("a", async () => 1), withJobLock("b", async () => 2)]);
  assert.deepEqual(both, [{ skipped: true }, { skipped: true }], "both refused while the bar job holds the lock");
  await release!();
  assert.equal(lockHolder(), null);
  const ran = await withJobLock("backfill", async () => 42);
  assert.deepEqual(ran, { skipped: false, value: 42 });
  const racers = await Promise.all([withJobLock("x", async () => { await new Promise((r) => setTimeout(r, 20)); return "x"; }), withJobLock("y", async () => "y")]);
  assert.equal(racers.filter((r) => r.skipped).length, 1, "two ticks at the same moment: exactly one runs");
  await withJobLock("boom", async () => { throw new Error("x"); }).catch(() => {});
  assert.equal(lockHolder(), null, "the lock is released when the job throws");

  // ---- across processes: the Postgres advisory lock --------------------------------------------------------------
  const calls: string[] = [];
  const poolWith = (ok: boolean) => ({
    connect: async () => ({
      query: async (q: string, p?: unknown[]) => { calls.push(q.split("(")[0]! + (p ? `:${p[0]}` : "")); return { rows: [{ ok }] }; },
      release: () => calls.push("release"),
    }),
  });
  const free = await tryAcquire("bars", { $client: poolWith(true) });
  assert.ok(free);
  await free!();
  assert.deepEqual(calls, [`SELECT pg_try_advisory_lock:${ADVISORY_KEY}`, `SELECT pg_advisory_unlock:${ADVISORY_KEY}`, "release"], "lock, unlock, give the connection back");
  calls.length = 0;
  assert.equal(await tryAcquire("bars", { $client: poolWith(false) }), null, "a backfill in another process holds it: refused");
  assert.equal(lockHolder(), null, "and the in-process lock is not left held");
  assert.ok(calls.includes("release"), "the connection went back");

  // ---- the memory guard ----------------------------------------------------------------------------------------------
  resetGuardForTests();
  assert.equal(overLimit("DailyBarRefresh", "batch 1", 100000), false, "under the limit: keep going");
  assert.equal(guardTrippedToday(), false);
  assert.equal(overLimit("DailyBarRefresh", "batch 7, name 700 of 1752", 1), true, "over the limit: stop");
  assert.equal(guardTrippedToday(), true, "and stay stopped for the rest of the day");
  assert.match(guardState()!.where, /batch 7, name 700 of 1752/);
  assert.ok(logs.some((l) => /STOPPED at batch 7, name 700 of 1752/.test(l) && /rss \d+ MB, heap/.test(l)), "the log says where and the memory");
  resetGuardForTests();

  // ---- batching: chunks, and the MA phase reads 50 names at a time ---------------------------------------------------
  assert.deepEqual(chunkRows([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunkRows([], 2), []);
  // 20 closes newest first, rising oldest to newest: the formulas as before
  const closes = Array.from({ length: 250 }, (_, i) => 200 - i * 0.1); // index 0 = newest = 200
  const m = maFromClosesDesc(closes);
  assert.ok(Math.abs(m.sma20! - closes.slice(0, 20).reduce((a, b) => a + b, 0) / 20) < 1e-9);
  assert.ok(m.sma200 !== null && m.sma50 !== null && m.ema10 !== null);
  assert.equal(maFromClosesDesc(closes.slice(0, 60)).sma200, null);

  let selects = 0, upserts = 0, rowsUpserted = 0;
  const names = Array.from({ length: 120 }, (_, i) => `S${i}`);
  const fakeDb = {
    execute: async () => {
      selects++;
      return { rows: names.flatMap((s) => closes.slice(0, 60).map((c) => ({ symbol: s, c }))) }; // the code keeps only its own batch
    },
    insert: () => ({ values: (v: any[]) => ({ onConflictDoUpdate: async () => { upserts++; rowsUpserted += v.length; } }) }),
  };
  await recalculateTickerMAs(fakeDb, names);
  assert.equal(selects, 3, "120 names read in 3 queries, not 120");
  assert.equal(upserts, 3, "and written in 3 statements");
  assert.equal(rowsUpserted, 120);
  quiet();
  console.log("job-guard tests passed");
})();
