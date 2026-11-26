/** GET /api/bigidea/setup-indicators answers real ids and default parameters (it gave "0", "1", ... and no params). */
import assert from "node:assert/strict";
import { setupIndicatorChoices, INDICATOR_LIBRARY } from "./indicators";

const list = setupIndicatorChoices();
const ma1 = list.find((x) => x.id === "MA-1")!;
assert.ok(ma1, "real ids");
assert.deepEqual(ma1.defaultParams, { skipBars: 0, period: 50, direction: "above" });
assert.equal(ma1.category, "Moving Averages");
assert.ok(!list.some((x) => /^\d+$/.test(x.id)), "no array indexes");
assert.ok(!list.some((x) => x.id === "ITD-1" || x.id === "ITD-2"), "retired left out");
assert.equal(list.length, INDICATOR_LIBRARY.length - 2);
console.log("setup-indicators: all checks passed");
