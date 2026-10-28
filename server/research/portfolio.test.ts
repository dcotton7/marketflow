import assert from "node:assert/strict";
import { analyzeSymbol, type AnalyzeContext, type Candidate } from "./analyze-symbol";
import { runPortfolio } from "./portfolio";
import { STRATEGY_VERSIONS } from "./strategy";
import { barsFromDrifts, indexFrom, segments } from "./testing";

const drifts = segments([60, 0], [50, 0.004], [20, 0.012], [40, -0.003], [50, 0.003], [40, -0.006], [30, 0], [60, 0.005], [40, -0.004], [90, 0.003]);
const idxBars = barsFromDrifts(segments([drifts.length, 0.0004]), { seed: 5 });
const index = indexFrom(idxBars);
const calendar = idxBars.map((b) => b.date);

const closes = new Map<string, Map<string, number>>();
const candidates: Candidate[] = [];
for (let s = 0; s < 8; s++) {
  const symbol = `S${s}`;
  const bars = barsFromDrifts(drifts, { seed: 100 + s, noise: 0.02 }).map((b, k) => ({ ...b, volume: b.volume * (k % 11 === s ? 3 : 1) }));
  closes.set(symbol, new Map(bars.map((b) => [b.date, b.close])));
  const ctx: AnalyzeContext = {
    symbol,
    index,
    signalFrom: "2026-01-02",
    tradeEnd: "2026-12-31",
    versions: STRATEGY_VERSIONS,
    rsRankAt: () => 50 + s * 5,
    regimeAt: () => undefined,
    vixBucketAt: () => "unknown",
    slippageBps: () => 10,
    wantMinutes: false,
    cooldownSessions: 5,
  };
  candidates.push(...analyzeSymbol(bars, ctx).candidates);
}
assert.ok(candidates.length > 20, `candidates (${candidates.length})`);

for (const v of STRATEGY_VERSIONS) {
  const small = { ...v, params: { ...v.params, maxPositions: 3 } };
  const { decisions, equity } = runPortfolio(small, candidates, calendar, "2026-01-02", (sym, d) => closes.get(sym)?.get(d) ?? null);
  assert.equal(decisions.length, candidates.length, "one decision per candidate");
  assert.equal(new Set(decisions.map((d) => d.candidateId)).size, decisions.length);
  assert.ok(decisions.every((d) => d.reason.length > 0 && d.reason !== "pending"), "every decision says why");
  const taken = decisions.filter((d) => d.decision === "taken");
  for (const d of taken) {
    assert.ok(d.shares >= 1);
    assert.ok((d.entry as number) > d.stop, "stop below entry");
    assert.ok(((d.entry as number) - d.stop) / (d.entry as number) <= 0.05 + 1e-9, `taken trades fit the 5% maximum: ${v.id} ${d.candidateId}`);
    assert.ok(d.shares * ((d.entry as number) - d.stop) <= small.params.startingEquity * 3 * small.params.accountRiskPct, "risk stays near the account risk %");
  }
  assert.ok(equity.every((p) => p.positions <= 3), "max positions respected");
  assert.ok(decisions.some((d) => d.decision === "skipped"), "skips are logged");
  const wide = decisions.filter((d) => candidates.find((c) => c.id === d.candidateId)!.sims[d.simKey]?.status === "skipped_stop_too_wide");
  if (small.params.waitSessions === 0) {
    assert.ok(wide.length > 0);
    assert.ok(wide.every((d) => d.decision === "skipped" && d.wouldHaveSimKey != null), "stop-too-wide candidates are skipped and carry a would-have simulation");
  }
}

console.log("portfolio.test.ts: ok");
