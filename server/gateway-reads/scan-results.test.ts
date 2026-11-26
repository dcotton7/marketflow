/** Fixed cases: the user's stored BigIdea scans (docs/gateway-reads.md, item 4). No database. */
import assert from "node:assert/strict";
import express from "express";
import { scanResultsRoutes, toScanRow, type ScanSource } from "./scan-results";
import { withApp } from "./test-helpers";

{
  const row = toScanRow({ id: 7, idea_id: null, idea_name: null, universe: "sp500", created_at: "2026-11-25T15:00:00Z", result_count: 3, result_symbols: ["NVDA", "AMD", "AVGO"],
    funnel: { totalTickers: 500, fetchFails: 2, tooFewCandles: 1, perThought: { t1: { name: "Base", passed: 40, failed: 460, evaluated: 500, skipped: 0, failedTickers: ["X", "Y"] } } } }, 2);
  assert.deepEqual(row, { id: 7, ideaId: null, ideaName: null, universe: "sp500", createdAt: "2026-11-25T15:00:00.000Z", resultCount: 3, symbols: ["NVDA", "AMD"], symbolsTruncated: true,
    funnel: { totalTickers: 500, fetchFails: 2, tooFewCandles: 1, perThought: [{ name: "Base", passed: 40, failed: 460, evaluated: 500, skipped: 0 }] } }, "counts and names only; no failure lists");
  assert.equal(toScanRow({ id: 1, result_count: 0, result_symbols: null, funnel: null }, 10).funnel, null);
}

// ---- over HTTP ----
{
  const asked: any[] = [];
  const scans: ScanSource = { async recent(userId, opts) { asked.push({ userId, ...opts }); return [{ id: 3, idea_id: null, result_count: 1, result_symbols: ["NVDA"], created_at: "2026-11-25T15:00:00Z", universe: "sp500", funnel: null }]; } };
  const sapp = express();
  sapp.use((req: any, _res, next) => { req.session = { userId: req.headers["x-user"] ? Number(req.headers["x-user"]) : undefined }; next(); });
  sapp.use("/api/bigidea", scanResultsRoutes({ source: () => scans }));
  await withApp(sapp, async (get) => {
    assert.equal((await get("/api/bigidea/scan-results")).status, 401, "a user's own scans only: login required");
  });
  const owner = express();
  owner.use((req: any, _res, next) => { req.session = { userId: 1 }; next(); });
  owner.use("/api/bigidea", scanResultsRoutes({ source: () => scans }));
  await withApp(owner, async (get) => {
    const r = await get("/api/bigidea/scan-results?limit=500&ideaId=4");
    assert.equal(r.status, 200);
    assert.deepEqual(asked.at(-1), { userId: 1, ideaId: 4, limit: 50 }, "the session's user, limit capped at 50");
    assert.deepEqual(r.body.scans[0].symbols, ["NVDA"]);
    assert.equal((await get("/api/bigidea/scan-results?ideaId=x")).status, 400);
  });
}

console.log("gateway scan results read ok");
