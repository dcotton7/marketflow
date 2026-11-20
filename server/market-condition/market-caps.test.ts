import assert from "node:assert/strict";
import { bucketOf, BOUNDARIES } from "./utils/cap-size";
import { bigStoredIgnored, isStale, judge, manualOverride, liveSources, needsSecondOpinion, plan, refreshMarketCaps, toFmpSymbol, type Sources, type Stored } from "./utils/market-cap-refresh";

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
  const sources: Sources = { async fmpBatch(syms) { return new Map([...fetched].filter(([s]) => syms.includes(s)).map(([s, cap]) => [s, { cap, date: "2026-11-20" }])); }, async finnhub() { finnhubCalls++; return 1e9; }, async sleep() {} };
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
  // a cap FMP last dated weeks ago (the ticker stopped trading) is listed as stale, not written
  statements.length = 0;
  const old: any = await refreshMarketCaps(db, { dryRun: true, sources: { ...sources, async fmpBatch(syms) { return new Map(syms.filter((s) => s === "CRDO").map((s) => [s, { cap: 10e9, date: "2026-10-05" }])); } }, asOf: "2026-11-20", log: () => {} });
  assert.deepEqual(old.rejected.map((r: any) => [r.symbol, r.reason]), [["CRDO", "stale: FMP's latest cap is dated 2026-10-05"]]);
  assert.equal(old.accepted, 0);
  assert.equal(isStale("2026-11-10", "2026-11-20"), false, "10 days is not stale");
  assert.equal(isStale("2026-11-09", "2026-11-20"), true);
  assert.equal(isStale(null, "2026-11-20"), false);
  // share classes: MarketFlow's BRK.B is FMP's BRK-B
  assert.equal(toFmpSymbol("BRK.B"), "BRK-B");
  assert.equal(toFmpSymbol("bf.b"), "BF-B");
  assert.equal(toFmpSymbol("AAPL"), "AAPL");
  const realFetch = globalThis.fetch;
  let asked = "";
  globalThis.fetch = (async (url: string) => { asked = String(url); return new Response(JSON.stringify([{ symbol: "BRK-B", date: "2026-11-20", marketCap: 8.07e11 }]), { status: 200 }); }) as any;
  const got = await liveSources({ FMP_API_KEY: "k" }).fmpBatch(["BRK.B", "AAPL"]);
  globalThis.fetch = realFetch;
  assert.match(decodeURIComponent(asked), /symbols=BRK-B,AAPL&/);
  assert.deepEqual([...got], [["BRK.B", { cap: 8.07e11, date: "2026-11-20" }]], "mapped back to MarketFlow's symbol");
  // ---- big-stored rule: off by default, lists what it would touch; on, a $5.98T stored yen figure no longer vetoes
  const hmc = st("HMC", 5.98e12, null);
  assert.equal(judge(hmc, 43.0e9).ok, false, "off: the stored $5.98T vetoes $43B (more than 10x)");
  assert.deepEqual(judge(hmc, 43.0e9, null, { bigStoredRule: true }), { ok: true, note: "stored cap above $2T ignored (big-stored rule)" });
  assert.equal(bigStoredIgnored(st("AAPL", 5.07e12), 5.09e12), false, "a company really that large is not touched");
  assert.equal(bigStoredIgnored(st("NVDA", 3.33e12), 3.4e12), false);
  assert.equal(bigStoredIgnored(st("X", 1.9e12), 1e9), false, "under $2T stored: the normal rules");
  const withHmc = [...stored, hmc];
  const dbH = { async execute(q: any) { const t = JSON.stringify(q?.queryChunks ?? q ?? ""); if (/FROM tickers ORDER BY/.test(t)) return { rows: withHmc.map((x) => ({ symbol: x.symbol, market_cap: x.marketCap, market_cap_size: x.bucket })) }; return { rows: [], rowCount: 1 }; } };
  const srcH: Sources = { ...sources, async fmpBatch(syms) { return new Map(syms.filter((x) => x === "HMC" || fetched.has(x)).map((x) => [x, { cap: x === "HMC" ? 43.0e9 : fetched.get(x)!, date: "2026-11-20" }])); } };
  const off: any = await refreshMarketCaps(dbH, { dryRun: true, sources: srcH, asOf: "2026-11-20", log: () => {} });
  assert.equal(off.bigStoredRule, false);
  assert.deepEqual(off.bigStoredTouches, ["HMC stored 5980000000000 fetched 43000000000"], "listed while off");
  assert.ok(off.rejected.some((r: any) => r.symbol === "HMC"));
  const on: any = await refreshMarketCaps(dbH, { dryRun: true, sources: srcH, asOf: "2026-11-20", log: () => {}, bigStoredRule: true });
  assert.equal(on.rejected.some((r: any) => r.symbol === "HMC"), false);
  assert.ok(on.bucketChanges.includes("HMC none->LARGE"));

  // ---- manual override: a history row marked manual_override with its reason, then the current value ------------
  const ov: string[] = [];
  const dbO = { async execute(q: any) { const t = JSON.stringify(q?.queryChunks ?? q ?? ""); ov.push(t); if (/SELECT market_cap, market_cap_size FROM tickers WHERE symbol/.test(t)) return { rows: /HMC/.test(t) ? [{ market_cap: 5.98e12, market_cap_size: null }] : [] }; return { rows: [], rowCount: 1 }; } };
  const r1: any = await manualOverride(dbO, { symbol: "hmc", marketCap: 43.0e9, reason: "stored $5.98T is a yen figure; FMP $43.0B (PM, 20 Nov)", asOf: "2026-11-20" });
  assert.equal(r1.ok, true);
  assert.equal(r1.bucket, "LARGE");
  assert.deepEqual(r1.previous, { marketCap: 5.98e12, bucket: null });
  const hist = ov.find((t) => /INSERT INTO market_cap_history/.test(t))!;
  assert.match(hist, /manual_override/);
  assert.match(hist, /yen figure/);
  assert.ok(ov.findIndex((t) => /INSERT INTO market_cap_history/.test(t)) < ov.findIndex((t) => /UPDATE tickers/.test(t)), "history first");
  assert.equal((await manualOverride(dbO, { symbol: "HMC", marketCap: 43e9, reason: "" }) as any).ok, false, "a reason is required");
  assert.equal((await manualOverride(dbO, { symbol: "HMC", marketCap: 2e13, reason: "x" }) as any).ok, false, "an implausible cap is refused");
  assert.equal((await manualOverride(dbO, { symbol: "NOPE", marketCap: 1e9, reason: "x" }) as any).ok, false, "an unknown symbol is refused");
  console.log("market cap refresh tests passed");
})().catch((e) => { console.error(e); process.exit(1); });
