import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import session from "express-session";
import { createApiAccessGuard, type AccessUser } from "./dataAccess";
import { allowedBody, allowedPath, createAnimaGateway, internalRequest, ipAllowed, loadAnimaGatewayOptions } from "./animaGateway";

const TOKEN = "t".repeat(40);
const USERS: Record<number, AccessUser> = { 1: { id: 1, isAdmin: true, isActive: true } };

for (const p of ["/api/stocks/AAPL/quote", "/api/stocks/BRK.B/history", "/api/market-condition/leaders",
  "/api/market-condition/themes/ai-infra/members", "/api/bigidea/ideas/12", "/api/discord-stream/summary",
  "/api/sentinel/trade-journal", "/api/sentinel/trades/closed", "/api/marketflow/NVDA/cached", "/API/News/Top/",
  "/api/alerts/feed", "/api/positions/snapshot"]) {
  assert.ok(allowedPath(p), `allowed ${p}`);
}
for (const p of ["/api/sentinel/watchlist/12/shares", "/api/sentinel/watchlist/bulk-add", "/api/sentinel/watchlist/remove-tickers",
  "/api/sentinel/watchlists", "/API/Sentinel/Watchlists/"]) {
  assert.ok(allowedPath(p, "POST"), `allowed POST ${p}`);
}
for (const p of ["/api/sentinel/watchlist/12", "/api/sentinel/watchlist", "/api/sentinel/watchlist/x/shares", "/api/stocks/AAPL/quote",
  "/api/sentinel/watchlists/12", "/api/sentinel/watchlists/12/set-default", "/api/sentinel/watchlists/12/items",
  "/api/sentinel/watchlist/bulk-add/x", "/api/sentinel/screen-grab/extract", "/api/sentinel/watchlist/remove"]) {
  assert.ok(!allowedPath(p, "POST"), `refused POST ${p}`);
}
const add = { watchlistId: 3, items: [{ symbol: "NVDA" }, { symbol: "BRK.B" }] };
assert.ok(allowedBody("/api/sentinel/watchlist/bulk-add", add));
// Don's broker screenshot in chat: shares, entry and the short side, update for rows already there (From Screen's body).
assert.ok(allowedBody("/api/sentinel/watchlist/bulk-add", { ...add, update: true }));
assert.ok(allowedBody("/api/sentinel/watchlist/bulk-add", { watchlistId: 3, update: true, items: [
  { symbol: "NVDA", shares: 100, entry: 182.35 }, { symbol: "CVNA", short: true }, { symbol: "META", shares: null, entry: null }] }));
assert.ok(allowedBody("/api/sentinel/watchlist/remove-tickers", { watchlistId: 3, symbols: ["NVDA"] }));
assert.ok(allowedBody("/api/sentinel/watchlists", { name: "Energy" }));
assert.ok(allowedBody("/api/sentinel/watchlist/12/shares", { shares: 1 }), "the trim's body is checked by its route");
assert.ok(allowedPath("/api/sentinel/watchlist/12/plan", "POST"));
assert.ok(allowedBody("/api/sentinel/watchlist/12/plan", { shares: 50, targetEntry: 612, expect: { shares: null, targetEntry: null } }));
assert.ok(!allowedBody("/api/sentinel/watchlist/12/plan", { shares: 50, symbol: "X", expect: { shares: 1 } }));
assert.ok(!allowedBody("/api/sentinel/watchlist/12/plan", { thesis: "x", expect: {} }));
assert.ok(!allowedBody("/api/sentinel/watchlist/12/plan", { shares: 5, expect: { userId: 2 } }));
assert.ok(!allowedBody("/api/sentinel/watchlist/12/plan", { shares: 5 }));
for (const [p, b] of [
  ["/api/sentinel/watchlist/bulk-add", { ...add, remove: ["MSFT"] }],
  ["/api/sentinel/watchlist/bulk-add", { ...add, remove: [] }],
  ["/api/sentinel/watchlist/bulk-add", { ...add, update: "yes" }],
  ["/api/sentinel/watchlist/bulk-add", { watchlistId: 3, items: [{ symbol: "NVDA", shares: -100 }] }],
  ["/api/sentinel/watchlist/bulk-add", { watchlistId: 3, items: [{ symbol: "NVDA", entry: "1" }] }],
  ["/api/sentinel/watchlist/bulk-add", { watchlistId: 3, items: [{ symbol: "NVDA", short: 1 }] }],
  ["/api/sentinel/watchlist/bulk-add", { watchlistId: 3, items: [{ symbol: "NVDA", stop: 170 }] }],
  ["/api/sentinel/watchlist/bulk-add", { watchlistId: 3, items: [{ symbol: "NVDA", direction: "short" }] }],
  ["/api/sentinel/watchlist/bulk-add", { watchlistId: "3", items: [{ symbol: "NVDA" }] }],
  ["/api/sentinel/watchlist/bulk-add", { watchlistId: 3, items: "NVDA" }],
  ["/api/sentinel/watchlist/bulk-add", { watchlistId: 3, items: [{ symbol: "X".repeat(13) }] }],
  ["/api/sentinel/watchlist/bulk-add", undefined],
  ["/api/sentinel/watchlist/bulk-add", [add]],
  ["/api/sentinel/watchlist/remove-tickers", { watchlistId: 3, symbols: ["NVDA"], all: true }],
  ["/api/sentinel/watchlist/remove-tickers", { watchlistId: 3, symbols: [7] }],
  ["/api/sentinel/watchlist/remove-tickers", { symbols: ["NVDA"] }],
  ["/api/sentinel/watchlists", { name: "Energy", isPortfolio: true }],
  ["/api/sentinel/watchlists", { name: "Energy", isDefault: true }],
  ["/api/sentinel/watchlists", { name: "  " }],
  ["/api/sentinel/watchlists", { name: "x".repeat(61) }],
  ["/api/sentinel/watchlists", {}],
  ["/api/sentinel/watchlists/12", { name: "Energy" }],
] as [string, unknown][]) {
  assert.ok(!allowedBody(p, b), `refused body ${p} ${JSON.stringify(b)}`);
}
for (const p of ["/api/auth/me", "/api/sentinel/evaluate", "/api/marketflow/NVDA", "/api/discord-stream/messages",
  "/api/market-leaders/book", "/api/alerts", "/api/sentinel/trade/12/labels", "/api/uploads", "/api/stocks/AAPL/quote/x",
  "/api/alerts/events", "/api/alerts/12", "/api/alerts/12/deliveries", "/api/alerts/feed/x", "/api/positions"]) {
  assert.ok(!allowedPath(p), `refused ${p}`);
}
assert.ok(internalRequest({ headers: { host: "marketflow-hrxh:10000" } } as any));
assert.ok(!internalRequest({ headers: { host: "marketflow-hrxh.onrender.com" } } as any));
assert.ok(!internalRequest({ headers: { host: "marketflow-hrxh:10000", "x-forwarded-for": "1.2.3.4" } } as any));
assert.ok(!internalRequest({ headers: {} } as any));

const RANGES = ["74.220.49.0/24", "74.220.57.0/24"];
assert.ok(ipAllowed("74.220.49.7", RANGES));
assert.ok(ipAllowed("74.220.57.255", RANGES));
for (const ip of ["74.220.50.1", "74.220.4.1", "1.2.3.4", "74.220.49", "74.220.49.300", "::1", ""]) {
  assert.ok(!ipAllowed(ip, RANGES), `refused ${ip}`);
}
assert.ok(!ipAllowed("10.0.0.1", ["0.0.0.0/0"]), "no catch-all range");
assert.deepEqual(loadAnimaGatewayOptions({ ANIMA_GATEWAY_IPS: " 74.220.49.0/24, ,74.220.57.0/24 " } as any).ips, RANGES);

async function withApp(opts: { token?: string; userId?: number; ips?: string[] }, fn: (call: Call) => Promise<void>) {
  const app = express();
  app.use(express.json());
  app.use(createAnimaGateway({ token: opts.token, userId: opts.userId, ips: opts.ips }));
  app.use(session({ secret: "x", resave: false, saveUninitialized: false, store: new session.MemoryStore() }));
  app.use(createApiAccessGuard({ config: { ownerIds: new Set([1]) }, getUser: async (id) => USERS[id] ?? null }));
  app.get("/api/stocks/:t/quote", (req: any, res) => res.json({ t: req.params.t, uid: req.session.userId, q: req.query }));
  app.get("/api/market-condition/briefing", (req, res) => res.json({ q: req.query }));
  app.post("/api/sentinel/evaluate", (_req, res) => res.json({ ran: true }));
  app.get("/api/alerts/feed", (req: any, res) => res.json({ uid: req.session.userId, q: req.query }));
  app.get("/api/alerts/events", (_req, res) => res.json({ leaked: true }));
  app.post("/api/sentinel/watchlist/:id/shares", express.json(), (req: any, res) => res.json({ id: req.params.id, uid: req.session.userId, body: req.body }));
  const echo = (req: any, res: any) => res.json({ path: req.path, uid: req.session.userId, body: req.body });
  app.post("/api/sentinel/watchlist/bulk-add", echo);
  app.post("/api/sentinel/watchlist/remove-tickers", echo);
  app.post("/api/sentinel/watchlists", echo);
  app.post("/api/sentinel/watchlist/:id", (_req, res) => res.json({ leaked: true }));
  const leak = (_req: any, res: any) => res.json({ leaked: true });
  app.delete("/api/sentinel/watchlists/:id", leak);
  app.delete("/api/sentinel/watchlists/:id/items", leak);
  app.delete("/api/sentinel/watchlist/:id", leak);
  app.patch("/api/sentinel/watchlists/:id", leak);
  app.post("/api/sentinel/watchlists/:id/set-default", leak);
  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  try {
    await fn((method, path, headers = {}, body) => new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode!, body: body ? JSON.parse(body) : null, cookie: res.headers["set-cookie"] }));
      });
      req.on("error", reject);
      req.end(body);
    }));
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}
type Call = (method: string, path: string, headers?: Record<string, string>, body?: string) =>
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
  const feed = await call("GET", "/api/anima/alerts/feed?after=41&events_after=7", inside);
  assert.deepEqual(feed.body, { uid: 1, q: { after: "41", events_after: "7" } }, "the alert feed, read after the cursor");
  assert.equal((await call("GET", "/api/anima/alerts/events", inside)).status, 403, "other alert routes stay closed");
  assert.equal((await call("POST", "/api/anima/alerts/feed", inside)).status, 405, "the feed is read only");
  const json = { ...inside, "content-type": "application/json" };
  const trim = JSON.stringify({ shares: 75, expectShares: 100 });
  const wrote = await call("POST", "/api/anima/sentinel/watchlist/12/shares", json, trim);
  assert.equal(wrote.status, 200);
  assert.deepEqual(wrote.body, { id: "12", uid: 1, body: { shares: 75, expectShares: 100 } }, "the one write, as the owner");
  assert.equal(wrote.cookie, undefined, "no session cookie on the write");
  assert.equal((await call("POST", "/api/anima/sentinel/watchlist/12/shares", inside, trim)).status, 415, "JSON only");
  assert.equal((await call("POST", "/api/anima/sentinel/watchlist/12/shares", { ...inside, "content-type": "text/plain" }, trim)).status, 415, "no form posts");
  assert.equal((await call("POST", "/api/anima/sentinel/watchlist/12", json, trim)).status, 405, "no other watchlist write");
  assert.equal((await call("POST", "/api/anima/sentinel/watchlist/12/shares/x", json, trim)).status, 405);
  assert.equal((await call("PATCH", "/api/anima/sentinel/watchlist/12/shares", json, trim)).status, 405, "POST only");
  assert.equal((await call("GET", "/api/anima/sentinel/watchlist/12/shares", inside)).status, 403, "not a read route");
  assert.equal((await call("POST", "/api/anima/sentinel/watchlist/12/shares", { ...json, "x-anima-token": "wrong" }, trim)).status, 404, "the write needs the token");
  assert.equal((await call("POST", "/api/sentinel/watchlist/12/shares", json, trim)).status, 401, "not open outside the gateway");

  const adds = JSON.stringify({ watchlistId: 7, items: [{ symbol: "NVDA" }, { symbol: "GEV" }] });
  const added = await call("POST", "/api/anima/sentinel/watchlist/bulk-add", json, adds);
  assert.equal(added.status, 200);
  assert.deepEqual(added.body, { path: "/api/sentinel/watchlist/bulk-add", uid: 1, body: JSON.parse(adds) }, "adds tickers as the owner");
  assert.equal(added.cookie, undefined);
  const drops = JSON.stringify({ watchlistId: 7, symbols: ["NVDA"] });
  assert.deepEqual((await call("POST", "/api/anima/sentinel/watchlist/remove-tickers", json, drops)).body.body, JSON.parse(drops), "removes named tickers");
  const made = await call("POST", "/api/anima/sentinel/watchlists", json, JSON.stringify({ name: "Energy" }));
  assert.deepEqual(made.body, { path: "/api/sentinel/watchlists", uid: 1, body: { name: "Energy" } }, "creates a list");
  const shot = JSON.stringify({ watchlistId: 7, update: true, items: [{ symbol: "NVDA", shares: 5, entry: 100 }, { symbol: "CVNA", short: true }] });
  assert.deepEqual((await call("POST", "/api/anima/sentinel/watchlist/bulk-add", json, shot)).body.body, JSON.parse(shot),
    "his screenshot's positions: shares, entry, short, update");
  for (const body of [{ watchlistId: 7, items: [{ symbol: "NVDA" }], remove: ["GEV"] },
    { watchlistId: 7, items: [{ symbol: "NVDA", shares: 5, stop: 90 }] }]) {
    assert.equal((await call("POST", "/api/anima/sentinel/watchlist/bulk-add", json, JSON.stringify(body))).status, 403,
      `no removes or other fields through bulk-add: ${JSON.stringify(body)}`);
  }
  const embedCookie = { ...json, cookie: "mf_anima_embed=1.x" };
  assert.equal((await call("POST", "/api/anima/sentinel/watchlist/bulk-add", embedCookie,
    JSON.stringify({ watchlistId: 7, items: [{ symbol: "NVDA" }], remove: ["GEV"] }))).status, 403,
    "Quinn never removes through bulk-add, whatever cookie comes along");
  assert.equal((await call("POST", "/api/anima/sentinel/watchlists", json, JSON.stringify({ name: "P", isPortfolio: true }))).status, 403, "a name only");
  assert.equal((await call("POST", "/api/anima/sentinel/watchlist/bulk-add", inside, adds)).status, 415, "the edits are JSON only");
  for (const [method, path] of [["DELETE", "/api/anima/sentinel/watchlists/7"], ["DELETE", "/api/anima/sentinel/watchlists/7/items"],
    ["DELETE", "/api/anima/sentinel/watchlist/7"], ["PATCH", "/api/anima/sentinel/watchlists/7"],
    ["POST", "/api/anima/sentinel/watchlists/7/set-default"], ["POST", "/api/anima/sentinel/watchlist/7"],
    ["PUT", "/api/anima/sentinel/watchlists"]]) {
    const r = await call(method, path, inside);
    assert.equal(r.status, 405, `${method} ${path} refused`);
    assert.notDeepEqual(r.body, { leaked: true });
  }
});

const edge = { host: "marketflow-hrxh.onrender.com", "x-forwarded-for": "74.220.49.7", "x-anima-token": TOKEN };
await withApp({ token: TOKEN, userId: 1, ips: RANGES }, async (call) => {
  const ok = await call("GET", "/api/anima/stocks/AAPL/quote", { ...edge, "cf-connecting-ip": "74.220.49.7" });
  assert.equal(ok.status, 200, "public address from Anima's range");
  assert.equal(ok.body.uid, 1);
  assert.equal((await call("GET", "/api/anima/stocks/AAPL/quote", { ...edge, "cf-connecting-ip": "8.8.8.8" })).status, 404, "outside the range");
  assert.equal((await call("GET", "/api/anima/stocks/AAPL/quote", edge)).status, 404, "a forged X-Forwarded-For is not enough");
  assert.equal((await call("GET", "/api/anima/stocks/AAPL/quote", { ...edge, "cf-connecting-ip": "74.220.49.7", "x-anima-token": "wrong" })).status, 404, "range without the token");
  assert.equal((await call("POST", "/api/anima/sentinel/evaluate", { ...edge, "cf-connecting-ip": "74.220.49.7" })).status, 405, "still read only");
  assert.equal((await call("GET", "/api/anima/stocks/AAPL/quote", inside)).status, 200, "private network still works");
});
await withApp({ token: TOKEN, userId: 1 }, async (call) => {
  assert.equal((await call("GET", "/api/anima/stocks/AAPL/quote", { ...edge, "cf-connecting-ip": "74.220.49.7" })).status, 404, "no ranges, no public door");
});

await withApp({ token: "short", userId: 1 }, async (call) => {
  assert.equal((await call("GET", "/api/anima/stocks/AAPL/quote", { ...inside, "x-anima-token": "short" })).status, 404, "a short token keeps it off");
});
await withApp({ token: TOKEN }, async (call) => {
  assert.equal((await call("GET", "/api/anima/stocks/AAPL/quote", inside)).status, 404, "no owner id keeps it off");
});

console.log("anima gateway ok");
