/** FND-4 Earnings Proximity on fixed earnings data: days counted from today, no data never a pass (inverted or not). */
import assert from "node:assert/strict";
import { earningsDays } from "./earnings-days";
import { INDICATOR_LIBRARY, normalizeResult, criterionPass } from "./indicators";

const today = "2026-11-27";
assert.deepEqual(earningsDays(null, today), {});
assert.deepEqual(earningsDays({ nextEarningsDate: "2026-12-07", nextEarningsDays: 999, lastEarningsDate: "2026-10-28" }, today), { daysToEarnings: 10, daysSinceEarnings: 30 });
assert.deepEqual(earningsDays({ nextEarningsDate: "2026-11-20", nextEarningsDays: -7, lastEarningsDate: null }, today), {}, "a past 'next' date is no data");
assert.deepEqual(earningsDays({ nextEarningsDate: "N/A", nextEarningsDays: -1, lastEarningsDate: null }, today), {}, "N/A / -1 is not 'reported yesterday'");
assert.deepEqual(earningsDays({ nextEarningsDate: today, nextEarningsDays: 0, lastEarningsDate: null }, today), { daysToEarnings: 0 });

const fnd4 = INDICATOR_LIBRARY.find((i) => i.id === "FND-4")!;
const run = (fd: any, params: any) => normalizeResult(fnd4.evaluate([], params, undefined, { fundamentalData: fd }));
assert.equal(run({ daysToEarnings: 10 }, { minDays: 0, maxDays: 30 }).pass, true);
assert.equal(run({ daysToEarnings: 45 }, { minDays: 0, maxDays: 30 }).pass, false);
const none = run({}, { minDays: 0, maxDays: 30 });
assert.equal(none.pass, false);
assert.equal(none.data?._noData, true);
assert.equal(none.data?._diagnostics.value, "no earnings date");
assert.equal(criterionPass(none.pass, true, none.data), false, "inverted with no data is not a pass");
assert.equal(criterionPass(false, true, {}), true, "inverted with data still inverts");
assert.equal(criterionPass(true, false, none.data), true);
// a window below zero: reported within the last 5 days
assert.equal(run({ daysToEarnings: 60, daysSinceEarnings: 3 }, { minDays: -5, maxDays: 0 }).pass, true);
assert.equal(run({ daysSinceEarnings: 9 }, { minDays: -5, maxDays: 0 }).pass, false);
assert.equal(run({ daysSinceEarnings: 9 }, { minDays: 0, maxDays: 30 }).data?._noData, true, "only a past report and a future window: no data");
console.log("earnings-days: all checks passed");
