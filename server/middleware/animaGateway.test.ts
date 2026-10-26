import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import session from "express-session";
import { createApiAccessGuard, type AccessUser } from "./dataAccess";
import { allowedPath, createAnimaGateway, internalRequest } from "./animaGateway";

const TOKEN = "t".repeat(40);
const USERS: Record<number, AccessUser> = { 1: { id: 1, isAdmin: true, isActive: true } };

for (const p of ["/api/stocks/AAPL/quote", "/api/stocks/BRK.B/history", "/api/market-condition/leaders",
  "/api/market-condition/themes/ai-infra/members", "/api/bigidea/ideas/12", "/api/discord-stream/summary",
  "/api/sentinel/trade-journal", "/api/sentinel/trades/closed", "/api/marketflow/NVDA/cached", "/API/News/Top/"]) {
  assert.ok(allowedPath(p), `allowed ${p}`);
}
for (const p of ["/api/auth/me", "/api/sentinel/evaluate", "/api/marketflow/NVDA", "/api/discord-stream/messages",
  "/api/market-leaders/book", "/api/alerts", "/api/sentinel/trade/12/labels", "/api/uploads", "/api/stocks/AAPL/quote/x"]) {
  assert.ok(!allowedPath(p), `refused ${p}`);
}
assert.ok(internalRequest({ headers: { host: "marketflow-hrxh:10000" } } as any));
assert.ok(!internalRequest({ headers: { host: "marketflow-hrxh.onrender.com" } } as any));
assert.ok(!internalRequest({ headers: { host: "marketflow-hrxh:10000", "x-forwarded-for": "1.2.3.4" } } as any));
assert.ok(!internalRequest({ headers: {} } as any));

async function withApp(opts: { token?: string; userId?: number }, fn: (call: Call) => Promise<void>) {
  const app = express();
  app.use(createAnimaGateway({ token: opts.token, userId: opts.userId }));
  app.use(session({ secret: "x", resave: false, saveUninitialized: false, store: new session.MemoryStore() }));
  app.use(createApiAccessGuard({ config: { ownerIds: new Set([1]) }, getUser: async (id) => USERS[id] ?? null }));
  app.get("/api/stocks/:t/quote", (req: any, res) => res.json({ t: req.params.t, uid: req.session.userId, q: req.query }));
  app.get("/api/market-condition/briefing", (req, res) => res.json({ q: req.query }));
  app.post("/api/sentinel/evaluate", (_req, res) => res.json({ ran: true }));
  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  try {
    await fn((method, path, headers = {}) => new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode!, body: body ? JSON.parse(body) : null, cookie: res.headers["set-cookie"] }));
      });
      req.on("error", reject);
      req.end();
    }));
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}
type Call = (method: string, path: string, headers?: Record<string, string>) =>
  Promise<{ status: number; body: any; cookie?: string[] }>;

const inside = { host: "marketflow-hrxh:10000", "x-anima-token": TOKEN };

await withApp({ token: TOKEN, userId: 1 }, async (call) => {
  const ok = await call("GET", "/api/anima/stocks/AAPL/quote?force=1&range=1d", inside);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { t: "AAPL", uid: 1, q: { range: "1d" } }, "runs as the owner, force dropped");
  assert.equal(ok.cookie, undefined, "no session cookie");
  const brief = await call("GET", "/api/anima/market-condition/briefing?mode=pre&refresh=1&Force=true", inside);
  assert.deepEqual(brief.body, { q: { mode: "pre" } }, "briefing served from cache");

  assert.equal((await call("GET", "/api/anima/stocks/AAPL/quote", { host: "marketflow-hrxh.onrender.com", "x-anima-token": TOKEN })).status, 404, "public host");
  assert.equal((await call("GET", "/api/anima/stocks/AAPL/quote", { ...inside, "x-forwarded-for": "9.9.9.9" })).status, 404, "via the edge");
  assert.equal((await call("GET", "/api/anima/stocks/AAPL/quote", { ...inside, "x-anima-token": "wrong" })).status, 404, "wrong token");
  assert.equal((await call("GET", "/api/anima/stocks/AAPL/quote", { host: inside.host })).status, 404, "no token");
  assert.equal((await call("POST", "/api/anima/sentinel/evaluate", inside)).status, 405, "read only");
  assert.equal((await call("GET", "/api/anima/auth/me", inside)).status, 403, "not on the list");
  assert.equal((await call("GET", "/api/anima/../sentinel/evaluate", inside)).status, 403, "no climbing out");
  assert.equal((await call("GET", "/api/stocks/AAPL/quote", inside)).status, 401, "the token is not a login anywhere else");
});

await withApp({ token: "short", userId: 1 }, async (call) => {
  assert.equal((await call("GET", "/api/anima/stocks/AAPL/quote", { ...inside, "x-anima-token": "short" })).status, 404, "a short token keeps it off");
});
await withApp({ token: TOKEN }, async (call) => {
  assert.equal((await call("GET", "/api/anima/stocks/AAPL/quote", inside)).status, 404, "no owner id keeps it off");
});

console.log("anima gateway ok");
