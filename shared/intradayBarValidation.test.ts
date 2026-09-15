import assert from "node:assert/strict";
import { removeInjectedSessionAggregateBars } from "./intradayBarValidation";

const normalBars = Array.from({ length: 12 }, (_, index) => ({
  date: new Date(Date.UTC(2026, 8, 8, 13, 30 + index * 5)).toISOString(),
  high: index === 2 ? 44.43 : 43 + index * 0.01,
  low: index === 7 ? 39.45 : 40 + index * 0.01,
  volume: 1000 + index,
}));

const priorVolume = normalBars.reduce((sum, bar) => sum + bar.volume, 0);
const injectedAggregate = {
  date: new Date(Date.UTC(2026, 8, 8, 14, 30)).toISOString(),
  high: 44.43,
  low: 39.45,
  volume: priorVolume,
};

assert.deepEqual(
  removeInjectedSessionAggregateBars([...normalBars, injectedAggregate]),
  normalBars,
  "session aggregate should be removed"
);

const legitimateWideBar = {
  ...injectedAggregate,
  volume: priorVolume * 0.5,
};
assert.equal(
  removeInjectedSessionAggregateBars([...normalBars, legitimateWideBar]).length,
  normalBars.length + 1,
  "a wide but non-cumulative interval bar should remain"
);

console.log("intradayBarValidation tests passed");
