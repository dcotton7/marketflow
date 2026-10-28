import assert from "node:assert/strict";
import { checkSharesWrite } from "./shares-write";

const item = { userId: 1, shares: 100 };

assert.deepEqual(checkSharesWrite(item, 1, { shares: 75, expectShares: 100 }), { status: 200, shares: 75 });
assert.deepEqual(checkSharesWrite(item, 1, { shares: 0, expectShares: 100 }), { status: 200, shares: 0 }, "sold out");
assert.equal(checkSharesWrite(null, 1, { shares: 75, expectShares: 100 }).status, 404);
assert.equal(checkSharesWrite(item, 2, { shares: 75, expectShares: 100 }).status, 403, "someone else's row");
assert.equal(checkSharesWrite(item, undefined, { shares: 75, expectShares: 100 }).status, 403);
const stale = checkSharesWrite(item, 1, { shares: 50, expectShares: 80 });
assert.deepEqual(stale, { status: 409, error: "Shares changed since the alert", shares: 100 }, "Don edited it since");
assert.equal(checkSharesWrite({ userId: 1, shares: null }, 1, { shares: 5, expectShares: 10 }).status, 409);
assert.equal(checkSharesWrite(item, 1, { shares: 120, expectShares: 100 }).status, 400, "a trim never adds");
assert.equal(checkSharesWrite(item, 1, { shares: 100, expectShares: 100 }).status, 400);
for (const body of [{}, { shares: 75 }, { shares: -1, expectShares: 100 }, { shares: "75", expectShares: 100 }, null, "75"]) {
  assert.equal(checkSharesWrite(item, 1, body).status, 400, JSON.stringify(body));
}

console.log("shares write ok");
