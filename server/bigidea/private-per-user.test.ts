/**
 * BigIdea is private per user (Don, 26 Nov 2026): one user never sees or changes another's thoughts, ideas, favorites,
 * ratings, tuning history or custom indicators. Real routes on a scratch Postgres (route-harness.ts).
 */
import assert from "node:assert/strict";
import { startHarness } from "./route-harness";

const CRIT = [{ indicatorId: "MA-1", label: "above 50", params: [{ name: "period", value: 50 }, { name: "direction", value: "above" }] }];

async function main() {
  const h = await startHarness();
  if (!h) return;
  const { call, users, sql } = h;
  const { alice, bob } = users;
  try {
    // let the routes' score-rule seeding finish
    for (let i = 0; i < 50 && !(await sql("SELECT 1 FROM thought_score_rules LIMIT 1")).length; i++) await new Promise((r) => setTimeout(r, 100));

    // Alice's thought and idea
    const t = await call("POST", "/api/bigidea/thoughts", alice, { name: "A trend", category: "Trend", criteria: CRIT });
    assert.ok(t.status < 300, JSON.stringify(t.body));
    const thoughtId = t.body.id;
    const nodes = [{ id: "n1", type: "thought", thoughtId, thoughtName: "A trend", thoughtCriteria: CRIT }, { id: "results", type: "results" }];
    const i = await call("POST", "/api/bigidea/ideas", alice, { name: "A idea", nodes, edges: [{ source: "n1", target: "results" }] });
    assert.ok(i.status < 300, JSON.stringify(i.body));
    const ideaId = i.body.id;
    const before = (await sql("SELECT score, last_used_at FROM scanner_thoughts WHERE id = $1", [thoughtId]))[0];

    // thoughts and ideas: Bob sees none of Alice's and cannot change them
    assert.ok(!(await call("GET", "/api/bigidea/thoughts", bob)).body.some((x: any) => x.id === thoughtId));
    assert.ok(!(await call("GET", "/api/bigidea/ideas", bob)).body.some((x: any) => x.id === ideaId));
    assert.equal((await call("GET", `/api/bigidea/ideas/${ideaId}`, bob)).status, 404);
    assert.equal((await call("PATCH", `/api/bigidea/thoughts/${thoughtId}`, bob, { name: "bob" })).status, 404);
    assert.equal((await call("PATCH", `/api/bigidea/ideas/${ideaId}`, bob, { name: "bob" })).status, 404);
    // thought delete is idempotent by design: it answers "already deleted" and removes nothing
    assert.equal((await call("DELETE", `/api/bigidea/thoughts/${thoughtId}`, bob)).body.alreadyDeleted, true);
    assert.equal((await sql("SELECT count(*)::int AS n FROM scanner_thoughts WHERE id = $1", [thoughtId]))[0].n, 1);
    assert.equal((await call("DELETE", `/api/bigidea/ideas/${ideaId}`, bob)).status, 404);
    assert.equal((await call("GET", `/api/bigidea/ideas/${ideaId}`, alice)).status, 200);

    // Bob's own idea naming Alice's thought id (with changed criteria) must not touch Alice's thought
    const bobNodes = [{ id: "n1", type: "thought", thoughtId, thoughtName: "x", thoughtCriteria: [{ ...CRIT[0], label: "changed" }] }, { id: "results", type: "results" }];
    const bi = await call("POST", "/api/bigidea/ideas", bob, { name: "B idea", nodes: bobNodes, edges: [{ source: "n1", target: "results" }] });
    assert.ok(bi.status < 300);
    assert.equal((await call("PATCH", `/api/bigidea/ideas/${bi.body.id}`, bob, { nodes: bobNodes })).status, 200);

    // chart ratings: Bob rating with Alice's idea id is stored without it and scores nothing of hers
    const r = await call("POST", "/api/bigidea/chart-rating", bob, { symbol: "AAPL", rating: "up", ideaId });
    assert.equal(r.status, 201);
    assert.equal(r.body.ideaId, null);
    const after = (await sql("SELECT score, last_used_at FROM scanner_thoughts WHERE id = $1", [thoughtId]))[0];
    assert.deepEqual(after, before, "Alice's thought score and last-used are untouched by Bob");
    // Alice rating her own idea does score her thought
    assert.equal((await call("POST", "/api/bigidea/chart-rating", alice, { symbol: "AAPL", rating: "up", ideaId })).body.ideaId, ideaId);
    assert.equal((await sql("SELECT score FROM scanner_thoughts WHERE id = $1", [thoughtId]))[0].score, before.score + 1);
    assert.deepEqual((await call("GET", `/api/bigidea/chart-ratings/summary?ideaId=${ideaId}`, bob)).body, { up: 0, down: 0, total: 0 });
    assert.deepEqual((await call("GET", `/api/bigidea/chart-ratings/summary?ideaId=${ideaId}`, alice)).body, { up: 1, down: 0, total: 1 });

    // favorites: only on your own idea, only your own listed and deleted
    assert.equal((await call("POST", "/api/bigidea/favorites", bob, { ideaId, symbol: "AAPL" })).status, 404);
    const fav = await call("POST", "/api/bigidea/favorites", alice, { ideaId, symbol: "AAPL" });
    assert.equal(fav.status, 201);
    assert.deepEqual((await call("GET", `/api/bigidea/favorites/${ideaId}`, bob)).body, []);
    assert.equal((await call("DELETE", `/api/bigidea/favorites/${fav.body.id}`, bob)).status, 404);
    assert.equal((await call("GET", `/api/bigidea/favorites/${ideaId}`, alice)).body.length, 1);

    // tuning history: another user's sessions never come back
    await sql(`INSERT INTO scan_tuning_history (user_id, scan_config, funnel_data, ai_suggestions, result_count_before, outcome, accepted_suggestions, admin_approved)
      VALUES ($1, '{}'::jsonb, '{}'::jsonb, '{"suggestions":[]}'::jsonb, 5, 'accepted', '[{"indicatorId":"MA-1","paramName":"period","currentValue":50,"suggestedValue":40}]'::jsonb, true)`, [alice]);
    assert.deepEqual((await call("GET", "/api/bigidea/scan-tune/history/MA-1", bob)).body.history, {});
    assert.equal((await call("GET", "/api/bigidea/scan-tune/history/MA-1", alice)).body.history["MA-1"].recentSessions, 1);
    assert.equal((await call("PATCH", `/api/bigidea/scan-tune/999999/feedback`, bob, { feedback: "x" })).status, 404);

    // custom indicators in the merged library: your own only
    const ci = await call("POST", "/api/bigidea/custom-indicators", alice, { name: "Alice only", category: "Price Action", description: "d",
      logicDefinition: { rules: [{ condition: "PRICE_ABOVE", threshold: 6 }], combineLogic: "AND" } });
    const libA = (await call("GET", "/api/bigidea/indicators", alice)).body.map((x: any) => x.id);
    const libB = (await call("GET", "/api/bigidea/indicators", bob)).body.map((x: any) => x.id);
    assert.ok(libA.includes(ci.body.indicator.customId));
    assert.ok(!libB.includes(ci.body.indicator.customId));
    assert.ok(libB.includes("MA-1"), "built-ins for everyone");
    assert.equal((await call("GET", "/api/bigidea/indicators", null)).status, 401);

    console.log("private-per-user: all checks passed");
  } finally {
    await h.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
