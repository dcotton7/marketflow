import assert from "node:assert/strict";
import { checkPlanWrite } from "./plan-write";

const row = { userId: 1, targetEntry: 380, stopPlan: null, entryDate: null, shares: 20, direction: "long" };

const ok = checkPlanWrite(row, 1, { targetEntry: 380.2, stopPlan: 360, expect: { targetEntry: 380, stopPlan: null } });
assert.deepEqual(ok, { status: 200, write: { set: { targetEntry: 380.2, stopPlan: 360 }, expect: { targetEntry: 380, stopPlan: null } } });
assert.equal(checkPlanWrite(row, 1, { shares: 50, expect: { shares: 20 } }).status, 200, "a count can go up");
assert.equal(checkPlanWrite(row, 1, { shares: 0, expect: { shares: 20 } }).status, 200, "or to nothing");
assert.equal(checkPlanWrite(row, 1, { direction: "short", expect: { direction: "long" } }).status, 200);
assert.equal(checkPlanWrite(row, 1, { entryDate: "2026-10-01", expect: { entryDate: null } }).status, 200);
const stale = checkPlanWrite(row, 1, { targetEntry: 390, expect: { targetEntry: 375 } });
assert.equal(stale.status, 409, "Don changed it since");
assert.equal((stale as { current: Record<string, unknown> }).current.targetEntry, 380);
assert.equal(checkPlanWrite(null, 1, { shares: 5, expect: { shares: 1 } }).status, 404);
assert.equal(checkPlanWrite(row, 2, { shares: 5, expect: { shares: 20 } }).status, 403, "someone else's row");
for (const body of [
  {}, { expect: {} }, { shares: 5 }, { targetEntry: 5, expect: {} }, { targetEntry: -1, expect: { targetEntry: 380 } },
  { entryDate: "10/01/2026", expect: { entryDate: null } }, { direction: "sideways", expect: { direction: "long" } },
  { symbol: "X", shares: 5, expect: { shares: 20 } }, { thesis: "x", expect: {} }, { shares: 5, expect: { shares: 20, thesis: "" } },
  null, "x",
]) assert.equal(checkPlanWrite(row, 1, body).status, 400, JSON.stringify(body));

console.log("plan write ok");
