/**
 * Custom indicators belong to the signed-in user (they were all saved as user 1, because the routes read req.user,
 * which this app never sets). Real routes on a scratch Postgres (route-harness.ts).
 */
import assert from "node:assert/strict";
import { startHarness } from "./route-harness";

const DEF = { rules: [{ condition: "PRICE_ABOVE", threshold: 6 }], combineLogic: "AND" };

async function main() {
  const h = await startHarness();
  if (!h) return;
  const { call, users, sql } = h;
  try {
    assert.equal((await call("POST", "/api/bigidea/custom-indicators", null, { name: "x", category: "Price Action", description: "d", logicDefinition: DEF })).status, 401);

    const a = await call("POST", "/api/bigidea/custom-indicators", users.alice, { name: "Alice $6", category: "Price Action", description: "price over 6", logicDefinition: DEF });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal(a.body.indicator.userId, users.alice, "saved under the caller, not user 1");
    assert.match(a.body.indicator.customId, new RegExp(`^CUSTOM-${users.alice}-`));
    const b = await call("POST", "/api/bigidea/custom-indicators", users.bob, { name: "Bob $6", category: "Price Action", description: "price over 6", logicDefinition: DEF });
    assert.equal(b.body.indicator.userId, users.bob);

    const la = await call("GET", "/api/bigidea/custom-indicators", users.alice);
    assert.deepEqual(la.body.indicators.map((i: any) => i.name), ["Alice $6"], "Alice sees only hers");
    const lb = await call("GET", "/api/bigidea/custom-indicators", users.bob);
    assert.deepEqual(lb.body.indicators.map((i: any) => i.name), ["Bob $6"]);
    assert.equal((await call("GET", "/api/bigidea/custom-indicators", null)).status, 401);

    // usage counter: only on your own
    assert.equal((await call("POST", `/api/bigidea/custom-indicators/${a.body.indicator.id}/use`, users.bob, { passed: true })).status, 404);
    assert.equal((await sql("SELECT times_used FROM user_indicators WHERE id = $1", [a.body.indicator.id]))[0].times_used, 0);
    assert.equal((await call("POST", `/api/bigidea/custom-indicators/${a.body.indicator.id}/use`, users.alice, { passed: true })).status, 200);
    assert.equal((await sql("SELECT times_used FROM user_indicators WHERE id = $1", [a.body.indicator.id]))[0].times_used, 1);

    // admin queue: an admin/owner by the session's user row, not req.user
    assert.equal((await call("GET", "/api/bigidea/custom-indicators/approval-queue", users.bob)).status, 403);
    assert.equal((await call("GET", "/api/bigidea/custom-indicators/approval-queue", users.owner)).status, 200);
    assert.equal((await call("POST", "/api/bigidea/custom-indicators/review/999999", users.bob, { decision: "approved" })).status, 403);
    assert.equal((await call("POST", "/api/bigidea/custom-indicators/review/999999", users.owner, { decision: "approved" })).status, 404);

    // AI generate needs a signed-in user before anything else
    assert.equal((await call("POST", "/api/bigidea/custom-indicators/generate", null, { requestText: "x" })).status, 401);
    console.log("custom-indicators-owner: all checks passed");
  } finally {
    await h.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
