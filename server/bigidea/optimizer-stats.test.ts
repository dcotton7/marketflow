/** Optimizer "weekly improvement" reads the stored funnels (it read a scan_sessions column that does not exist). */
import assert from "node:assert/strict";
import { thoughtEvaluationsPerName, weeklyImprovementPct } from "./queryOptimizer";

const funnel = (tickers: number, evaluated: number[]) => ({ totalTickers: tickers, perThought: Object.fromEntries(evaluated.map((e, i) => [`t${i}`, { evaluated: e }])) });
assert.equal(thoughtEvaluationsPerName(funnel(100, [100, 50])), 1.5);
assert.equal(thoughtEvaluationsPerName(null), null);
assert.equal(thoughtEvaluationsPerName({ perThought: {} }), null);
// previous week 2.0 evaluations a name, this week 1.5: 25% fewer
assert.equal(weeklyImprovementPct([funnel(100, [100, 50]), funnel(10, [10, 5])], [funnel(200, [200, 200])]), 25);
assert.equal(weeklyImprovementPct([], [funnel(200, [200, 200])]), 0);
assert.equal(weeklyImprovementPct([funnel(100, [100])], []), 0);
console.log("optimizer-stats: all checks passed");
