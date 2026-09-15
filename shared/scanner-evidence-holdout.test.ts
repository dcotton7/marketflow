import assert from "node:assert/strict";
import {
  PROVISIONAL_CANDIDATE_COHORTS,
  evaluateCostSensitivity,
  summarizeHoldout,
} from "./scanner-evidence-holdout";

const unstable = summarizeHoldout([
  { week: "2026-08-10", episodes: 100, hits: 40, edgeSum: 20 },
  { week: "2026-08-17", episodes: 100, hits: 20, edgeSum: -10 },
  { week: "2026-08-24", episodes: 100, hits: 18, edgeSum: -5 },
]);
assert.equal(unstable.stable, false);
assert.ok(unstable.notes.length > 0);

const stable = summarizeHoldout([
  { week: "2026-08-10", episodes: 80, hits: 32, edgeSum: 16 },
  { week: "2026-08-17", episodes: 90, hits: 36, edgeSum: 18 },
  { week: "2026-08-24", episodes: 70, hits: 28, edgeSum: 14 },
  { week: "2026-08-31", episodes: 60, hits: 24, edgeSum: 9 },
]);
assert.equal(stable.stable, true);
assert.ok((stable.edgePct ?? 0) > 0);
assert.ok((stable.hitRate ?? 0) >= 0.28);

const costOk = evaluateCostSensitivity({
  edgePct: 0.25,
  roundTripCostPct: 0.1,
  priorDayDollarVol: 50_000_000,
});
assert.equal(costOk.passes, true);

const costFail = evaluateCostSensitivity({
  edgePct: 0.05,
  roundTripCostPct: 0.12,
  priorDayDollarVol: 50_000_000,
});
assert.equal(costFail.passes, false);

const liqFail = evaluateCostSensitivity({
  edgePct: 0.4,
  roundTripCostPct: 0.1,
  priorDayDollarVol: 1_000_000,
});
assert.equal(liqFail.passes, false);

assert.equal(PROVISIONAL_CANDIDATE_COHORTS.length, 4);

console.log("scanner-evidence-holdout tests passed");
