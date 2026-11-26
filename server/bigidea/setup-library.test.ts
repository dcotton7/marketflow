/**
 * The Setup Library is off unless SETUP_LIBRARY=on (Don, 26 Nov 2026: "disable it"), and its client entry points are
 * hidden. No database needed: the guard runs before any handler.
 */
import assert from "node:assert/strict";
import express from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { isSetupLibraryPath, setupLibraryEnabled, setupLibraryGuard, SETUP_LIBRARY_STATUS_PATH } from "./setup-library";
import { setupLibraryEnabled as clientEnabled } from "../../client/src/lib/setup-library";
import { allowedPath } from "../middleware/animaGateway";

async function serve(env: Record<string, string | undefined>) {
  const app = express();
  app.use(express.json());
  app.use(setupLibraryGuard(env));
  app.use((_req, res) => { res.json({ reached: true }); });
  const server = await new Promise<import("node:http").Server>((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string) => {
    const r = await fetch(base + path, { method, headers: { "content-type": "application/json" }, body: method === "GET" ? undefined : "{}" });
    return { status: r.status, header: r.headers.get("x-setup-library"), body: await r.json() };
  };
  return { call, close: () => new Promise<void>((r) => server.close(() => r())) };
}

const LIBRARY_ROUTES: [string, string][] = [
  ["GET", "/api/bigidea/setups/3"], ["POST", "/api/bigidea/setups"], ["PATCH", "/api/bigidea/setups/3"],
  ["DELETE", "/api/bigidea/setups/3"], ["POST", "/api/bigidea/setups/3/activate"], ["POST", "/api/bigidea/setups/3/archive"],
  ["POST", "/api/bigidea/setups/3/preview-analysis"], ["POST", "/api/bigidea/setups/3/refine-analysis"],
  ["POST", "/api/bigidea/setups/3/create-from-preview"], ["POST", "/api/bigidea/setups/3/analyze"],
  ["GET", "/api/bigidea/setups/3/extracted-ideas"], ["PUT", "/api/bigidea/extracted-ideas/9"],
  ["DELETE", "/api/bigidea/extracted-ideas/9"], ["POST", "/api/bigidea/extracted-ideas/9/approve"],
  ["POST", "/api/bigidea/extracted-ideas/9/start-validation"], ["POST", "/api/bigidea/extracted-ideas/9/rate"],
  ["GET", "/api/bigidea/extracted-ideas/9/ratings"], ["POST", "/api/bigidea/extracted-ideas/9/push-to-scanner"],
  ["POST", "/api/bigidea/extracted-ideas/9/refine"], ["POST", "/api/bigidea/suggest-mappings"],
  ["GET", "/api/bigidea/setup-indicators"], ["POST", "/api/uploads"], ["GET", "/api/uploads"], ["GET", "/api/uploads/4"],
  ["GET", "/api/uploads/4/file"], ["DELETE", "/api/uploads/4"], ["POST", "/api/uploads/4/link-setup"],
  ["POST", "/api/uploads/4/reprocess"], ["GET", "/api/setups/3/uploads"], ["POST", "/API/BigIdea/Setups/3/Analyze/"],
];
const OTHER_ROUTES: [string, string][] = [
  ["GET", "/api/bigidea/ideas"], ["POST", "/api/bigidea/scan"], ["GET", "/api/bigidea/thoughts"],
  ["POST", "/api/bigidea/ai/create-thought"], ["GET", "/api/bigidea/custom-indicators"], ["GET", "/api/setups/leader-shakeout"],
];

async function main() {
  // the flag
  assert.equal(setupLibraryEnabled({}), false, "off by default");
  assert.equal(setupLibraryEnabled({ SETUP_LIBRARY: "off" }), false);
  assert.equal(setupLibraryEnabled({ SETUP_LIBRARY: "on" }), true);
  assert.equal(setupLibraryEnabled({ SETUP_LIBRARY: " ON " }), true);
  for (const [, p] of LIBRARY_ROUTES) assert.ok(isSetupLibraryPath(p), p);
  for (const [, p] of OTHER_ROUTES) assert.ok(!isSetupLibraryPath(p), p);

  // off (default): every library route answers 404 before its handler; the list answers [] for the gateway
  const off = await serve({});
  try {
    for (const [m, p] of LIBRARY_ROUTES) {
      const r = await off.call(m, p);
      assert.equal(r.status, 404, `${m} ${p}`);
      assert.equal(r.body.code, "SETUP_LIBRARY_DISABLED");
    }
    const list = await off.call("GET", "/api/bigidea/setups");
    assert.equal(list.status, 200);
    assert.deepEqual(list.body, []);
    assert.equal(list.header, "disabled");
    for (const [m, p] of OTHER_ROUTES) assert.deepEqual((await off.call(m, p)).body, { reached: true }, `${m} ${p}`);
    assert.deepEqual((await off.call("GET", SETUP_LIBRARY_STATUS_PATH)).body, { enabled: false });
  } finally { await off.close(); }

  // on: everything reaches its handler as before
  const on = await serve({ SETUP_LIBRARY: "on" });
  try {
    for (const [m, p] of [...LIBRARY_ROUTES, ["GET", "/api/bigidea/setups"] as [string, string]]) {
      assert.deepEqual((await on.call(m, p)).body, { reached: true }, `${m} ${p}`);
    }
    assert.deepEqual((await on.call("GET", SETUP_LIBRARY_STATUS_PATH)).body, { enabled: true });
  } finally { await on.close(); }

  // the Anima gateway still reads /api/bigidea/setups (bigidea_setups): it gets the empty list above
  assert.equal(allowedPath("/api/bigidea/setups"), true);

  // client: hidden unless the server says enabled
  assert.equal(clientEnabled(undefined), false);
  assert.equal(clientEnabled({ enabled: false }), false);
  assert.equal(clientEnabled({ error: "x" }), false);
  assert.equal(clientEnabled({ enabled: "yes" }), false);
  assert.equal(clientEnabled({ enabled: true }), true);
  const root = join(import.meta.dirname, "..", "..");
  const app = readFileSync(join(root, "client/src/App.tsx"), "utf8");
  assert.match(app, /<SetupLibraryGate>\s*<SetupLibraryPage \/>\s*<\/SetupLibraryGate>/, "the page renders only through the gate");
  assert.equal((app.match(/<SetupLibraryPage/g) || []).length, 1, "no other route renders the page");
  const admin = readFileSync(join(root, "client/src/pages/SentinelAdminPage.tsx"), "utf8");
  assert.match(admin, /\{setupLibraryOn && \(\s*<Button onClick=\{\(\) => navigate\("\/sentinel\/setup-library"\)\}/, "the admin button shows only when on");
  assert.equal((admin.match(/sentinel\/setup-library/g) || []).length, 1);
  const gate = readFileSync(join(root, "client/src/components/bigidea/SetupLibraryGate.tsx"), "utf8");
  assert.match(gate, /if \(!enabled\)/);

  console.log("setup-library: all checks passed");
}

main().catch((e) => { console.error(e); process.exit(1); });
