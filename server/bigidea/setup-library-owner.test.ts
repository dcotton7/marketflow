/**
 * Setup Library on the real routes (scratch Postgres, route-harness.ts): off by default; with SETUP_LIBRARY=on,
 * edits and deletes need the setup's creator or an admin/owner, reads are unchanged.
 */
import assert from "node:assert/strict";
import { startHarness } from "./route-harness";

async function main() {
  const h = await startHarness();
  if (!h) return;
  const { call, users, sql } = h;
  try {
    delete process.env.SETUP_LIBRARY;
    assert.equal((await call("POST", "/api/bigidea/setups", users.alice, { name: "x" })).status, 404, "off by default");
    assert.deepEqual((await call("GET", "/api/bigidea/setups", users.alice)).body, []);

    process.env.SETUP_LIBRARY = "on";
    const name = `Alice Breakout ${Date.now()}`;
    const created = await call("POST", "/api/bigidea/setups", users.alice, { name, description: "d" });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.id;
    assert.equal(created.body.createdBy, users.alice);
    const [idea] = await sql(
      `INSERT INTO bigidea_extracted_ideas (setup_id, name, thoughts) VALUES ($1, 'idea', '[]'::jsonb) RETURNING id`, [id]);

    // reads unchanged: anyone signed in
    assert.equal((await call("GET", `/api/bigidea/setups/${id}`, users.bob)).status, 200);
    assert.ok((await call("GET", "/api/bigidea/setups", users.bob)).body.some((s: any) => s.id === id));

    // Bob cannot change Alice's setup or its ideas
    for (const [m, p, b] of [
      ["PATCH", `/api/bigidea/setups/${id}`, { description: "bob was here" }],
      ["POST", `/api/bigidea/setups/${id}/activate`, {}],
      ["POST", `/api/bigidea/setups/${id}/archive`, {}],
      ["POST", `/api/bigidea/setups/${id}/analyze`, {}],
      ["PUT", `/api/bigidea/extracted-ideas/${idea.id}`, { name: "bob" }],
      ["POST", `/api/bigidea/extracted-ideas/${idea.id}/approve`, {}],
      ["DELETE", `/api/bigidea/extracted-ideas/${idea.id}`, undefined],
      ["DELETE", `/api/bigidea/setups/${id}`, undefined],
    ] as [string, string, unknown][]) {
      const r = await call(m, p, users.bob, b);
      assert.equal(r.status, 403, `${m} ${p}: ${JSON.stringify(r.body)}`);
    }
    const [row] = await sql("SELECT description, status FROM bigidea_setups WHERE id = $1", [id]);
    assert.deepEqual(row, { description: "d", status: "draft" }, "nothing changed");
    assert.equal((await sql("SELECT count(*)::int AS n FROM bigidea_extracted_ideas WHERE id = $1", [idea.id]))[0].n, 1);

    // the creator and the owner can
    assert.equal((await call("PATCH", `/api/bigidea/setups/${id}`, users.alice, { description: "alice" })).status, 200);
    assert.equal((await call("PUT", `/api/bigidea/extracted-ideas/${idea.id}`, users.alice, { name: "alice idea" })).status, 200);
    assert.equal((await call("POST", `/api/bigidea/setups/${id}/activate`, users.owner, {})).status, 200);
    // a setup with no recorded creator counts as the owner's
    await sql("UPDATE bigidea_setups SET created_by = NULL WHERE id = $1", [id]);
    assert.equal((await call("PATCH", `/api/bigidea/setups/${id}`, users.alice, { description: "again" })).status, 403);
    assert.equal((await call("DELETE", `/api/bigidea/setups/${id}`, users.owner)).status, 200);

    delete process.env.SETUP_LIBRARY;
    console.log("setup-library-owner: all checks passed");
  } finally {
    await h.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
