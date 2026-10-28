import assert from "node:assert/strict";
import { analyzeSymbol, type AnalyzeContext, type Candidate } from "./analyze-symbol";
import { STRATEGY_VERSIONS } from "./strategy";
import { barsFromDrifts, indexFrom, prng, segments } from "./testing";
import type { DailyBar } from "./types";

// Changing future bars changes no past decision: signals, facts, rule checks, stops, cycle labels, fills and every
// trade action dated on or before the cut are identical.

const drifts = segments([60, 0], [50, 0.004], [20, 0.012], [40, -0.003], [50, 0.003], [40, -0.006], [30, 0], [60, 0.005], [40, -0.004], [90, 0.003]);
const index = indexFrom(barsFromDrifts(segments([drifts.length, 0.0004]), { seed: 5 }));

function ctx(): AnalyzeContext {
  return {
    symbol: "TEST",
    index,
    signalFrom: "2026-01-02",
    tradeEnd: "2026-12-31",
    versions: STRATEGY_VERSIONS,
    rsRankAt: () => 90,
    regimeAt: () => undefined,
    vixBucketAt: () => "15-20",
    slippageBps: () => 10,
    wantMinutes: false,
    cooldownSessions: 5,
  };
}

let checked = 0;
let checkedFills = 0;
for (const seed of [11, 12, 13, 14, 15, 16]) {
  const bars = barsFromDrifts(drifts, { seed, noise: 0.02 }).map((b, k) => ({ ...b, volume: b.volume * (k % 13 === 0 ? 3 : 1) }));
  const cut = bars.findIndex((b) => b.date >= "2026-05-01");
  const rnd = prng(seed * 7);
  const altered: DailyBar[] = bars.map((b, k) => {
    if (k <= cut) return b;
    const m = 0.7 + rnd() * 0.6;
    return { ...b, open: b.open * m, high: b.high * m * 1.02, low: b.low * m * 0.98, close: b.close * m, volume: b.volume * (0.5 + rnd()) };
  });
  const a = analyzeSymbol(bars, ctx());
  const b = analyzeSymbol(altered, ctx());

  assert.deepEqual(b.stages.slice(0, cut + 1), a.stages.slice(0, cut + 1));
  for (const key of ["sma50", "ema10", "ema20", "atr14", "extSma50", "relVol", "rsLine", "mansfield"] as const)
    assert.deepEqual(b.facts[key].slice(0, cut + 1), a.facts[key].slice(0, cut + 1), key);

  const past = (list: Candidate[]) => list.filter((c) => c.signalIndex <= cut);
  const pa = past(a.candidates);
  const pb = past(b.candidates);
  assert.deepEqual(pb.map((c) => c.id), pa.map((c) => c.id), "same past signals");
  for (let j = 0; j < pa.length; j++) {
    const x = pa[j];
    const y = pb[j];
    checked++;
    assert.deepEqual(y.stop, x.stop);
    assert.deepEqual(y.facts, x.facts);
    assert.deepEqual(y.checks, x.checks);
    assert.equal(y.stage, x.stage);
    assert.deepEqual(y.order, x.order);
    for (const k of Object.keys(x.sims)) {
      const sx = x.sims[k];
      const sy = y.sims[k];
      if (sx.fillIndex == null || sx.fillIndex > cut) continue;
      checkedFills++;
      assert.equal(sy.fillIndex, sx.fillIndex);
      assert.equal(sy.entry, sx.entry);
      assert.equal(sy.status, sx.status);
      assert.deepEqual(sy.pieces.filter((p) => p.index <= cut), sx.pieces.filter((p) => p.index <= cut));
      assert.deepEqual(sy.trimDues.filter((d) => d.index <= cut), sx.trimDues.filter((d) => d.index <= cut));
    }
  }

  // Fills only after the signal close; no trade opens before the window.
  for (const c of a.candidates)
    for (const s of Object.values(c.sims)) {
      if (s.fillIndex == null) continue;
      assert.ok(s.fillIndex > c.signalIndex, "fill after the signal bar");
      assert.ok((s.fillDate as string) >= "2026-01-02", "no trade before the window");
      if (c.order.type === "next_open" && s.status === "filled" && !s.limitFill)
        assert.ok(Math.abs((s.entry as number) - bars[c.signalIndex + 1].open * 1.001) < 1e-9, "next-open fill at the open plus slippage");
    }
}
assert.ok(checked >= 10, `enough past candidates compared (${checked})`);
assert.ok(checkedFills >= 10, `enough past fills compared (${checkedFills})`);

console.log(`lookahead.test.ts: ok (${checked} candidates, ${checkedFills} fills compared)`);
