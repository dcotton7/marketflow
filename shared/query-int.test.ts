/** Run with: npx tsx shared/query-int.test.ts */
import assert from "node:assert/strict";
import { queryInt } from "./query-int";

assert.equal(queryInt(undefined, 50, 1, 200), 50, "missing → default (was NaN → no LIMIT)");
assert.equal(queryInt("", 50, 1, 200), 50);
assert.equal(queryInt("abc", 50, 1, 200), 50);
assert.equal(queryInt("-1", 50, 1, 200), 1);
assert.equal(queryInt("40", 50, 1, 200), 40);
assert.equal(queryInt("5000", 50, 1, 200), 200);
assert.equal(queryInt(["7", "9"], 50, 1, 200), 7, "repeated param: first value");
assert.equal(queryInt("1000000", 0, 0, 10_000), 10_000, "offset is bounded");
console.log("✅ queryInt tests passed");
