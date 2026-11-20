import assert from "node:assert/strict";
import { evaluateLast, LS, RULE_VERSION, type Condition } from "./leader-shakeout";
import { looksLikeSplit, rsi2Series, type DBar } from "./daily-math";
import { scanLeaderShakeout, SETUP, type BarSource } from "./leader-shakeout-job";
import type { RunRow, SetupStore, ShakeoutRow } from "./store";
import { parseRange } from "./routes-helpers";
import { allowedPath } from "../middleware/animaGateway";
import { series, type Shape } from "./fixtures";

const verdict = (b: DBar[]) => {
  const r = evaluateLast(b);
  assert.ok(r, "evaluates");
  return r!;
};

// ---- the rule --------------------------------------------------------------------------------------------------
{
  const r = verdict(series());
  assert.deepEqual(r.failed, [], `hits: ${JSON.stringify(r)}`);
  assert.equal(r.hit, true);
  assert.ok(r.dropAtr >= 2 && r.ret <= -0.04 && r.relVol >= 2 && r.run20 > 0.1 && r.rsi2 < 5 && r.close >= 6 && r.dollarVol20Prev >= 30e6);
  assert.equal(r.liquid, false, "about $56M a day is not liquid");
  assert.equal(r.gapped, false);
  // the numbers are the research's: Run20 from yesterday's close back 21 sessions, ATR and volumes from the prior window
  const b = series();
  const i = b.length - 1;
  assert.equal(r.run20, b[i - 1].close / b[i - 21].close - 1);
  assert.equal(r.relVol, b[i].volume / (b.slice(i - 20, i).reduce((a, x) => a + x.volume, 0) / 20));
  assert.equal(r.rsi2, rsi2Series(b)[i]);
}

// one near miss for each condition: everything else still passes, only that one fails
const misses: [Condition, Shape][] = [
  ["price", { scale: 0.05 }], // about $5.30, same dollar volume and ratios
  ["dollarVol", { volume: 230_000 }], // about $26M a day
  ["dropAtr", { half: 1.6 }], // wider prior ranges: ATR about 3.3, a 5-point fall is 1.5 ATR
  ["dropPct", { drop: 4.3, half: 0.4 }], // 2+ ATR but -3.8%
  ["relVol", { dropVolMult: 1.9 }],
  ["run20", { rise: 0.48 }], // up 9% over the 20 sessions
  ["rsi2", { dips: [] }], // no down days before the drop: RSI(2) stays above 5
];
for (const [cond, shape] of misses) {
  const r = verdict(series(shape));
  assert.deepEqual(r.failed, [cond], `${cond} near miss: ${JSON.stringify(r)}`);
  assert.equal(r.hit, false);
}
// the boundaries are the rule's: >= on price, dollar volume, ATRs, volume; <= -4%; > 10%; < 5
assert.equal(LS.minPrice, 6);
assert.equal(LS.minDollarVol, 30e6);
// variants are flags on the same row
{
  const r = verdict(series({ volume: 1_000_000, gapAtrs: 1.2 }));
  assert.equal(r.hit, true);
  assert.equal(r.liquid, true, "about $112M a day");
  assert.equal(r.gapped, true, "opened 1.2 ATR below the prior close");
}
assert.equal(evaluateLast(series().slice(-21)), null, "needs 21 bars before the drop day");
assert.equal(looksLikeSplit(81.46, 40.86, 40.715), true, "FAST 2:1 in the stored history");
assert.equal(looksLikeSplit(116, 108, 108.5), false);

// ---- the job ---------------------------------------------------------------------------------------------------
function memStore() {
  const runs = new Map<string, RunRow>();
  const hits = new Map<string, ShakeoutRow>();
  const store: SetupStore = {
    async doneDates(setup, v) { return new Set([...runs.values()].filter((r) => r.setup === setup && r.ruleVersion === v).map((r) => r.marketDate)); },
    async insertShakeouts(rows) { let n = 0; for (const r of rows) { const k = `${r.ruleVersion}|${r.date}|${r.symbol}`; if (!hits.has(k)) { hits.set(k, r); n++; } } return n; },
    async insertRun(r) { const k = `${r.setup}|${r.ruleVersion}|${r.marketDate}`; if (runs.has(k)) return 0; runs.set(k, r); return 1; },
  };
  return { store, runs, hits };
}
function fakeSource(bars: Record<string, DBar[]>, extra: Partial<BarSource> = {}): BarSource {
  const all = [...new Set(Object.values(bars).flatMap((b) => b.map((x) => x.date)))].sort();
  return {
    async sessions() { return all; },
    async symbols() { return Object.keys(bars); },
    async countOn(d) { return Object.values(bars).filter((b) => b.some((x) => x.date === d)).length; },
    async bars(syms, from) { return new Map(syms.map((s) => [s, bars[s].filter((x) => x.date >= from)])); },
    async indexBars() { return {}; },
    themes: (s) => (s === "HIT" ? [{ id: "SEMIS", name: "Semiconductors" }] : []),
    mfRegime: () => null,
    ...extra,
  };
}
(async () => {
  const hit = series(), flat = series({ dips: [0.6, 0.6] }); // same dates, no hit
  const last = hit[hit.length - 1].date;
  {
    const m = memStore();
    const src = fakeSource({ HIT: hit, FLAT: flat, SPY: hit });
    const r = await scanLeaderShakeout(src, m.store, { today: last });
    assert.equal(r.dates.length, hit.length - 21, "every session with 21 bars before it");
    assert.equal(r.hits, 1);
    assert.equal(m.hits.size, 1);
    const row = [...m.hits.values()][0];
    assert.equal(row.symbol, "HIT");
    assert.equal(row.date, last);
    assert.equal(row.ruleVersion, RULE_VERSION);
    assert.deepEqual(row.themes, [{ id: "SEMIS", name: "Semiconductors" }]);
    assert.equal(row.source, "daily", "the newest session");
    const run = m.runs.get(`${SETUP}|${RULE_VERSION}|${last}`)!;
    assert.equal(run.symbolsScanned, 2, "SPY is an ETF and is not scanned");
    assert.equal(run.hits, 1);
    assert.equal(m.runs.get(`${SETUP}|${RULE_VERSION}|${hit[25].date}`)!.source, "backfill");
    // a second run finds nothing left to do and writes nothing
    const again = await scanLeaderShakeout(src, m.store, {});
    assert.deepEqual(again, { dates: [], hits: 0, waiting: null, stopped: false });
  }
  {
    // the newest session waits while its bars are still coming in (1 of 3 symbols)
    const m = memStore();
    const src = fakeSource({ HIT: hit, A: flat.slice(0, -1), B: flat.slice(0, -1) });
    const r = await scanLeaderShakeout(src, m.store, {});
    assert.match(String(r.waiting), /bars for 1 of 3/);
    assert.ok(!r.dates.includes(last));
    assert.equal(r.hits, 0);
  }
  {
    // a missing session inside the window skips that symbol for the day, and says so
    const m = memStore();
    const holed = hit.filter((_, i) => i !== hit.length - 5);
    await scanLeaderShakeout(fakeSource({ HIT: holed, FLAT: flat }), m.store, {});
    const run = m.runs.get(`${SETUP}|${RULE_VERSION}|${last}`)!;
    assert.equal(run.hits, 0);
    assert.equal((run.skipped as any).missingSession, 1);
  }
  {
    // memory pressure stops the run before anything is written; the next run does it all
    const m = memStore();
    const r = await scanLeaderShakeout(fakeSource({ HIT: hit }, { shouldStop: () => true }), m.store, {});
    assert.equal(r.stopped, true);
    assert.equal(m.runs.size, 0);
  }

  // ---- the read route's range and the gateway --------------------------------------------------------------------
  assert.deepEqual(parseRange({ date: "2026-11-19" }), { from: "2026-11-19", to: "2026-11-19" });
  assert.deepEqual(parseRange({ from: "2026-01-01", to: "2026-11-19" }), { from: "2026-01-01", to: "2026-11-19" });
  assert.ok("error" in parseRange({}));
  assert.ok("error" in parseRange({ from: "2026-11-19", to: "2026-01-01" }));
  assert.ok("error" in parseRange({ from: "2024-01-01", to: "2026-01-01" }), "range cap");
  assert.ok("error" in parseRange({ date: "19-11-2026" }));
  assert.equal(allowedPath("/api/market-condition/setups/leader-shakeout"), true);
  assert.equal(allowedPath("/api/market-condition/setups/status"), true);
  assert.equal(allowedPath("/api/market-condition/setups/run/leader_shakeout", "POST"), false, "the admin run stays closed to Anima");

  console.log("leader-shakeout tests passed");
})().catch((err) => { console.error(err); process.exit(1); });
