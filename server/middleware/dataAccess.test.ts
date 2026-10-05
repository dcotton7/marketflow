import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import {
  classifyApiPath,
  createApiAccessGuard,
  isOwnerUser,
  loadOwnerConfig,
  parseOwnerUserIds,
  type AccessUser,
  type OwnerConfig,
} from "./dataAccess";

const USERS: Record<number, AccessUser> = {
  1: { id: 1, isAdmin: true, isActive: true },
  2: { id: 2, isAdmin: true, isActive: true },
  3: { id: 3, isAdmin: false, isActive: true },
  4: { id: 4, isAdmin: false, isActive: false },
  6: { id: 6, isAdmin: true, isActive: true },
};

/** Vendor-data and AI routes from docs/proposals/alpaca-data-exposure-audit.md (plus Options Pulse). */
const OWNER_ROUTES: Array<[string, string]> = [
  ["GET", "/api/sentinel/chart-data?ticker=AAPL"],
  ["GET", "/api/sentinel/trade-chart-metrics?ticker=AAPL"],
  ["GET", "/api/sentinel/ticker/AAPL"],
  ["GET", "/api/sentinel/company-logo/AAPL"],
  ["GET", "/api/sentinel/sentiment/market"],
  ["POST", "/api/sentinel/evaluate"],
  ["POST", "/api/sentinel/suggest"],
  ["POST", "/api/sentinel/chart-setup-enrich"],
  ["GET", "/api/stocks/AAPL/history"],
  ["GET", "/api/stocks/AAPL/quote"],
  ["GET", "/api/market/indicators"],
  ["GET", "/api/watchlist/quotes"],
  ["GET", "/api/industry-comps/AAPL"],
  ["GET", "/api/news/top"],
  ["GET", "/api/news/AAPL"],
  ["POST", "/api/scanner/run"],
  ["GET", "/api/scanner/stream"],
  ["GET", "/api/scanner/history"],
  ["GET", "/api/scanner/picks"],
  ["GET", "/api/scanner/workbench/cards"],
  ["POST", "/api/scanner/workbench/ai-analyze"],
  ["GET", "/api/scanner/upcoming-earnings"],
  ["GET", "/api/scanner/debug/ma/AAPL"],
  ["GET", "/api/market-condition/themes"],
  ["GET", "/api/market-condition/themes/abc/members"],
  ["GET", "/api/market-condition/regime"],
  ["GET", "/api/market-condition/rai"],
  ["GET", "/api/market-condition/briefing"],
  ["GET", "/api/market-condition/status"],
  ["GET", "/api/market-condition/search?q=a"],
  ["POST", "/api/market-condition/themes/abc/ticker-review"],
  ["GET", "/api/marketflow/AAPL/cached"],
  ["GET", "/api/marketflow/AAPL/cache-meta"],
  ["GET", "/api/marketflow/options/pulse"],
  ["GET", "/api/marketflow/options/regime"],
  ["POST", "/api/market-leaders/book"],
  ["POST", "/api/market-leaders/interpret"],
  ["GET", "/api/market-leaders/prefs"],
  ["POST", "/api/bigidea/scan"],
  ["POST", "/api/bigidea/scan-tune"],
  ["GET", "/api/bigidea/marketflow/universes"],
  ["POST", "/api/bigidea/custom-indicators/test"],
  ["POST", "/api/pattern-learning/scan"],
  ["POST", "/api/alerts/preview"],
  ["POST", "/api/alerts/7/evaluate"],
];

const OWNER_ADMIN_ROUTES: Array<[string, string]> = [
  ["POST", "/api/marketflow/AAPL"],
  ["DELETE", "/api/marketflow/AAPL/cache"],
];

/** Logged-in, user-owned content: any active account. */
const AUTH_ROUTES: Array<[string, string]> = [
  ["GET", "/api/sentinel/trade-journal"],
  ["GET", "/api/sentinel/rules"],
  ["GET", "/api/sentinel/watchlists"],
  ["GET", "/api/sentinel/dashboard"],
  ["GET", "/api/sentinel/settings/system"],
  ["GET", "/api/alerts"],
  ["GET", "/api/bigidea/thoughts"],
  ["POST", "/api/bigidea/ai/create-thought"],
  ["POST", "/api/pattern-learning/chat"],
  ["GET", "/api/uploads"],
  ["GET", "/api/chart-drawings"],
  ["GET", "/api/market-condition/time"],
  ["GET", "/api/market-condition/server-status"],
  ["GET", "/api/scanner/status"],
  ["GET", "/api/tos/status"],
  ["GET", "/api/some-future-route"],
];

const PUBLIC_ROUTES: Array<[string, string]> = [
  ["POST", "/api/auth/login"],
  ["POST", "/api/auth/logout"],
  ["POST", "/api/auth/register"],
  ["GET", "/api/auth/me"],
  ["GET", "/api/health/memory"],
  ["POST", "/api/alerts/deliveries/twilio-status"],
  ["GET", "/"],
  ["GET", "/assets/index.js"],
  ["GET", "/tos-helper/ToSLink.cmd"],
];

// ── Pure helpers ────────────────────────────────────────────────────────────
assert.equal(parseOwnerUserIds(undefined), null);
assert.equal(parseOwnerUserIds(" , x"), null);
assert.deepEqual([...parseOwnerUserIds("1, 2,abc")!], [1, 2]);
assert.equal(loadOwnerConfig({}).ownerIds, null);

const explicit: OwnerConfig = { ownerIds: new Set([1, 2]) };
const fallback: OwnerConfig = { ownerIds: null };
assert.equal(isOwnerUser(USERS[2], explicit), true);
assert.equal(isOwnerUser(USERS[6], explicit), false, "admin not in OWNER_USER_IDS is not owner");
assert.equal(isOwnerUser(USERS[6], fallback), true, "unset OWNER_USER_IDS falls back to admin");
assert.equal(isOwnerUser(USERS[3], fallback), false);
assert.equal(isOwnerUser({ id: 1, isAdmin: true, isActive: false }, explicit), false, "disabled owner");

for (const [m, p] of OWNER_ROUTES) assert.equal(classifyApiPath(m, p.split("?")[0]), "owner", `${m} ${p}`);
for (const [m, p] of OWNER_ADMIN_ROUTES) assert.equal(classifyApiPath(m, p), "owner_admin", `${m} ${p}`);
for (const [m, p] of AUTH_ROUTES) assert.equal(classifyApiPath(m, p), "auth", `${m} ${p}`);

// ── HTTP behaviour through a real Express app ──────────────────────────────
async function withServer(config: OwnerConfig, fn: (call: (m: string, p: string, uid?: number) => Promise<{ status: number; body: any }>) => Promise<void>) {
  const app = express();
  app.use((req, _res, next) => {
    const uid = Number(req.header("x-test-user"));
    (req as any).session = {
      userId: Number.isFinite(uid) && uid > 0 ? uid : undefined,
      destroy: (cb: () => void) => cb(),
    };
    next();
  });
  app.use(createApiAccessGuard({ config, getUser: async (id) => USERS[id] ?? null }));
  app.use((_req, res) => res.status(200).json({ ok: true }));
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(async (method, path, uid) => {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        headers: uid ? { "x-test-user": String(uid) } : {},
      });
      const text = await res.text();
      let body: any = null;
      try { body = JSON.parse(text); } catch { body = text; }
      return { status: res.status, body };
    });
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

await withServer(explicit, async (call) => {
  for (const [m, p] of [...OWNER_ROUTES, ...OWNER_ADMIN_ROUTES, ...AUTH_ROUTES]) {
    assert.equal((await call(m, p)).status, 401, `anonymous ${m} ${p}`);
    assert.equal((await call(m, p, 4)).status, 401, `disabled user ${m} ${p}`);
  }
  for (const [m, p] of OWNER_ROUTES) {
    const r = await call(m, p, 3);
    assert.equal(r.status, 403, `non-owner ${m} ${p}`);
    assert.equal(r.body.code, "OWNER_ONLY");
    assert.equal((await call(m, p, 6)).status, 403, `admin not owner ${m} ${p}`);
    assert.equal((await call(m, p, 2)).status, 200, `owner ${m} ${p}`);
  }
  for (const [m, p] of OWNER_ADMIN_ROUTES) {
    assert.equal((await call(m, p, 3)).status, 403, `non-owner ${m} ${p}`);
    assert.equal((await call(m, p, 2)).status, 200, `owner admin ${m} ${p}`);
  }
  for (const [m, p] of AUTH_ROUTES) {
    assert.equal((await call(m, p, 3)).status, 200, `logged-in ${m} ${p}`);
  }
  for (const [m, p] of PUBLIC_ROUTES) {
    assert.equal((await call(m, p)).status, 200, `public ${m} ${p}`);
  }
});

await withServer(fallback, async (call) => {
  assert.equal((await call("GET", "/api/sentinel/chart-data", 6)).status, 200, "fallback: admin is owner");
  assert.equal((await call("GET", "/api/sentinel/chart-data", 3)).status, 403, "fallback: standard user");
});

console.log(
  `data access guard ok: ${OWNER_ROUTES.length} owner, ${OWNER_ADMIN_ROUTES.length} owner+admin, ` +
    `${AUTH_ROUTES.length} login, ${PUBLIC_ROUTES.length} public`,
);
