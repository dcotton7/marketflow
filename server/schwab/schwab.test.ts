/**
 * Schwab read-only link, fixed cases (docs/schwab-readonly.md). Mocked Schwab replies only; no network, no keys.
 * Run: npx tsx server/schwab/schwab.test.ts
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connectionState, EXPIRED_MESSAGE, REFRESH_LIFETIME_MS, SchwabSignedOut, stateMessage, TokenManager } from "./auth";
import { checkState, decryptText, encryptText, loadSchwabConfig, makeState } from "./config";
import { getAlertQuote } from "./alert-price";
import { clearTicks, freshTick, lastQuoteAgeSec } from "./quote-cache";
import { balancesFrom, positionsFrom, quotesFrom, SchwabRest } from "./rest";
import { buildHealth } from "./status";
import { MemoryStore } from "./store";
import { SchwabStreamer, type WsLike } from "./streamer";
import { planSync } from "./sync";
import { evaluatePosition, type DayBar } from "../alerts/position-rules";
import { allowedPath } from "../middleware/animaGateway";
import { classifyApiPath } from "../middleware/dataAccess";
import type { Quote } from "../data-layer/types";

const here = dirname(fileURLToPath(import.meta.url));
const T0 = Date.UTC(2026, 10, 10, 15, 0, 0);
const MIN = 60_000, HOUR = 3_600_000;
const cfg = loadSchwabConfig({
  SCHWAB_ENABLED: "1", SCHWAB_APP_KEY: "test-key", SCHWAB_APP_SECRET: "test-secret",
  SCHWAB_CALLBACK_URL: "https://example.test/api/schwab/callback",
} as NodeJS.ProcessEnv);

type Call = { url: string; method: string; body?: string };
function fakeFetch(reply: (c: Call) => { status: number; json?: unknown; headers?: Record<string, string> }) {
  const calls: Call[] = [];
  const impl = (async (url: any, init: any = {}) => {
    const c = { url: String(url), method: String(init.method ?? "GET"), body: init.body ? String(init.body) : undefined };
    calls.push(c);
    const r = reply(c);
    return {
      ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.json,
      headers: { get: (k: string) => r.headers?.[k.toLowerCase()] ?? null },
    } as any;
  }) as typeof fetch;
  return { impl, calls };
}

async function signedIn(store: MemoryStore, accessLeftMs: number, refreshLeftMs = 6 * 24 * HOUR) {
  await store.saveTokens({ userId: 1, accessToken: "old-access", refreshToken: "refresh-1",
    accessExpiresAt: T0 + accessLeftMs, refreshExpiresAt: T0 + refreshLeftMs });
}

// ---- config: tokens are encrypted, state is signed and expires
{
  const sealed = encryptText(cfg.tokenKey!, "secret-token");
  assert.ok(!sealed.includes("secret-token"));
  assert.equal(decryptText(cfg.tokenKey!, sealed), "secret-token");
  const st = makeState(cfg.tokenKey!, 7, T0);
  assert.equal(checkState(cfg.tokenKey!, st, T0 + MIN), 7);
  assert.equal(checkState(cfg.tokenKey!, st, T0 + 11 * MIN), null, "state older than 10 minutes");
  assert.equal(checkState(cfg.tokenKey!, st.replace(/^7\./, "8."), T0), null, "a changed user id fails the HMAC");
  assert.equal(loadSchwabConfig({} as NodeJS.ProcessEnv).enabled, false, "flag off by default");
}

// ---- 1. token refresh before expiry
{
  const store = new MemoryStore();
  await signedIn(store, 20 * MIN);
  const f = fakeFetch(() => ({ status: 200, json: { access_token: "new-access", refresh_token: "refresh-1", expires_in: 1800 } }));
  const tm = new TokenManager(cfg, store, f.impl, () => T0);
  assert.equal(await tm.accessToken(1), "old-access", "20 minutes left: no refresh");
  assert.equal(f.calls.length, 0);

  await signedIn(store, 4 * MIN);
  const [a, b] = await Promise.all([tm.accessToken(1), tm.accessToken(1)]);
  assert.equal(a, "new-access");
  assert.equal(b, "new-access");
  assert.equal(f.calls.length, 1, "4 minutes left: one refresh, shared by both callers");
  assert.equal(f.calls[0].method, "POST");
  assert.match(f.calls[0].url, /\/v1\/oauth\/token$/);
  assert.match(f.calls[0].body!, /grant_type=refresh_token/);
  const row = (await store.load(1))!;
  assert.equal(row.accessToken, "new-access");
  assert.equal(row.accessExpiresAt, T0 + 1800_000);
  assert.equal(row.refreshExpiresAt, T0 + 6 * 24 * HOUR, "refreshing never extends the 7 days");

  // The other instance refreshed already: its token is used, no call.
  await store.saveTokens({ ...row, accessToken: "other-instance", accessExpiresAt: T0 + 29 * MIN });
  assert.equal(await tm.accessToken(1), "other-instance");
  assert.equal(f.calls.length, 1);

  // Sign-in sets the 7 days.
  const s2 = new MemoryStore();
  const f2 = fakeFetch(() => ({ status: 200, json: { access_token: "a", refresh_token: "r", expires_in: 1800 } }));
  await new TokenManager(cfg, s2, f2.impl, () => T0).exchangeCode(1, "code@");
  assert.equal((await s2.load(1))!.refreshExpiresAt, T0 + REFRESH_LIFETIME_MS);
  assert.match(f2.calls[0].body!, /grant_type=authorization_code&code=code%40&redirect_uri=/);
}

// ---- 2. the expired-refresh state, and the warning a day ahead
{
  const store = new MemoryStore();
  await signedIn(store, 20 * MIN, 23 * HOUR);
  assert.equal(connectionState(await store.load(1), T0), "expiring");
  assert.equal(stateMessage("expiring", await store.load(1), T0), "Schwab sign-in expires in 23 hours — sign in again to keep it");

  await signedIn(store, 20 * MIN, -1);
  const f = fakeFetch(() => ({ status: 200, json: {} }));
  const tm = new TokenManager(cfg, store, f.impl, () => T0);
  await assert.rejects(tm.accessToken(1), (e: unknown) => e instanceof SchwabSignedOut && e.state === "expired");
  assert.equal(f.calls.length, 0, "an expired sign-in is not sent to Schwab");
  const row = await store.load(1);
  assert.equal(row!.refreshToken, null, "tokens deleted");
  assert.equal(connectionState(row, T0), "expired");
  assert.equal(stateMessage("expired", row, T0), "Schwab disconnected — sign in again");

  // Schwab refuses the refresh (invalid_grant): the same state.
  const s2 = new MemoryStore();
  await signedIn(s2, 1 * MIN);
  const refused = fakeFetch(() => ({ status: 400, json: { error: "invalid_grant" } }));
  await assert.rejects(new TokenManager(cfg, s2, refused.impl, () => T0).accessToken(1), /sign in again/);
  assert.equal(connectionState(await s2.load(1), T0), "expired");

  // A 500 on refresh keeps the sign-in (try again later).
  const s3 = new MemoryStore();
  await signedIn(s3, 1 * MIN);
  const down = fakeFetch(() => ({ status: 503 }));
  await assert.rejects(new TokenManager(cfg, s3, down.impl, () => T0).accessToken(1), /refresh failed \(503\)/);
  assert.equal(connectionState(await s3.load(1), T0), "connected");

  // Disconnect is "disconnected", not "expired".
  const s4 = new MemoryStore();
  await signedIn(s4, 20 * MIN);
  await new TokenManager(cfg, s4, down.impl, () => T0).disconnect(1);
  assert.equal(connectionState(await s4.load(1), T0), "disconnected");
}

// ---- REST: GET only, backoff on 429, one token refresh on 401
{
  const store = new MemoryStore();
  await signedIn(store, 20 * MIN);
  let n = 0;
  const f = fakeFetch((c) => {
    if (c.url.includes("/oauth/token")) return { status: 200, json: { access_token: "fresh", expires_in: 1800 } };
    n++;
    if (n === 1) return { status: 429, headers: { "retry-after": "2" } };
    if (n === 2) return { status: 401 };
    return { status: 200, json: { SPY: { realtime: true, quote: { lastPrice: 600.5, closePrice: 598, totalVolume: 10 } } } };
  });
  const waits: number[] = [];
  const tm = new TokenManager(cfg, store, f.impl, () => T0);
  const rest = new SchwabRest(tm, 1, { fetchImpl: f.impl, wait: async (ms) => { waits.push(ms); }, now: () => T0 });
  const [q] = await rest.quotes(["SPY"]);
  assert.equal(q.last, 600.5);
  assert.equal(q.realtime, true);
  assert.deepEqual(waits, [2000], "Retry-After honoured");
  assert.equal(f.calls.filter((c) => c.url.includes("/oauth/token")).length, 1, "a 401 refreshes once");
  assert.ok(f.calls.filter((c) => !c.url.includes("/oauth/token")).every((c) => c.method === "GET"));
}

// ---- 3. stream reconnect
{
  clearTicks();
  class FakeWs implements WsLike {
    sent: any[] = [];
    handlers: Record<string, Array<(a?: any) => void>> = {};
    closed = false;
    send(d: string) { this.sent.push(JSON.parse(d).requests[0]); }
    close() { if (this.closed) return; this.closed = true; this.emit("close"); }
    on(e: string, fn: (a?: any) => void) { (this.handlers[e] ??= []).push(fn); }
    emit(e: string, a?: any) { for (const fn of this.handlers[e] ?? []) fn(a); }
    reply(o: unknown) { this.emit("message", JSON.stringify(o)); }
  }
  const sockets: FakeWs[] = [];
  const timers: Array<{ fn: () => void; ms: number; id: number }> = [];
  let clock = T0, tid = 0, tokenN = 0;
  const info = { streamerSocketUrl: "wss://streamer.test/ws", schwabClientCustomerId: "c", schwabClientCorrelId: "r", schwabClientChannel: "N9", schwabClientFunctionId: "APIAPP" };
  const s = new SchwabStreamer({
    accessToken: async () => `token-${++tokenN}`,
    streamerInfo: async () => info,
    openSocket: () => { const w = new FakeWs(); sockets.push(w); return w; },
    maxSymbols: 3,
    now: () => clock,
    setTimer: (fn, ms) => { const t = { fn, ms, id: ++tid }; timers.push(t); return t.id; },
    clearTimer: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
  });
  const flush = () => new Promise((r) => setImmediate(r));
  const fire = async (ms: number) => { const i = timers.findIndex((t) => t.ms === ms); assert.ok(i >= 0, `timer ${ms}`); const [t] = timers.splice(i, 1); t.fn(); await flush(); };
  const loginOk = (w: FakeWs) => w.reply({ response: [{ service: "ADMIN", command: "LOGIN", requestid: "0", content: { code: 0, msg: "ok" } }] });

  s.setSymbols("alerts:positions", ["nvda", "spy"]);
  s.setSymbols("alerts:starred", ["AAPL", "SPY", "TSLA"]);
  assert.deepEqual(s.desiredSymbols(), ["NVDA", "SPY", "AAPL"], "union in caller order, capped at 3");
  s.start();
  await flush();
  assert.equal(s.state, "connecting");
  sockets[0].emit("open");
  await flush();
  assert.equal(sockets[0].sent[0].command, "LOGIN");
  assert.equal(sockets[0].sent[0].parameters.Authorization, "token-1", "bare access token");
  loginOk(sockets[0]);
  assert.equal(s.state, "streaming");
  const subs = sockets[0].sent.filter((r) => r.command === "SUBS");
  assert.deepEqual(subs.map((r) => [r.service, r.parameters.keys]), [["LEVELONE_EQUITIES", "NVDA,SPY,AAPL"], ["CHART_EQUITY", "NVDA,SPY,AAPL"]]);

  // Drop: reconnect after 1 s, log in with a fresh token, the same symbols again.
  sockets[0].close();
  assert.equal(s.state, "reconnecting");
  assert.equal(s.reconnects, 1);
  await fire(1000);
  assert.equal(sockets.length, 2);
  sockets[1].emit("open");
  await flush();
  assert.equal(sockets[1].sent[0].parameters.Authorization, "token-2");
  loginOk(sockets[1]);
  assert.equal(s.state, "streaming");
  assert.equal(sockets[1].sent.filter((r) => r.command === "SUBS")[0].parameters.keys, "NVDA,SPY,AAPL");

  // A refused login backs off 1 s, then 2 s (doubling, at most 60 s).
  sockets[1].reply({ response: [{ service: "ADMIN", command: "LOGIN", content: { code: 3, msg: "Login denied" } }] });
  assert.match(s.lastError!, /login refused \(3\)/);
  await fire(1000);
  sockets[2].close();
  await fire(2000);
  assert.equal(sockets.length, 4);

  // Silence for over a minute counts as a drop.
  sockets[3].emit("open");
  await flush();
  loginOk(sockets[3]);
  clock += 61_000;
  await fire(15_000);
  assert.equal(s.state, "reconnecting");
  assert.ok(timers.some((t) => t.ms === 1000), "backoff reset after a good login");

  // ---- 4. an alert fires from a Schwab tick
  await fire(1000);
  sockets[4].emit("open");
  await flush();
  loginOk(sockets[4]);
  sockets[4].reply({ data: [{ service: "LEVELONE_EQUITIES", command: "SUBS", content: [{ key: "NVDA", "1": 94.9, "2": 95.1, "3": 95, "8": 1_000_000, "12": 100 }] }] });
  sockets[4].reply({ data: [{ service: "LEVELONE_EQUITIES", command: "SUBS", content: [{ key: "NVDA", "3": 94.8 }] }] });
  const tick = freshTick("NVDA", clock)!;
  assert.equal(tick.last, 94.8, "partial update merged onto the last tick");
  assert.equal(tick.bid, 94.9);
  assert.equal(lastQuoteAgeSec(clock), 0);
  let fellBack = 0;
  const fallback = async (): Promise<Quote | null> => { fellBack++; return null; };
  const q = (await getAlertQuote("nvda", fallback, clock))!;
  assert.equal(q.price, 94.8);
  assert.equal((q as any).source, "schwab");
  assert.equal(q.prevClose, 100);
  assert.equal(fellBack, 0, "fresh tick: the old source is not asked");
  const day = (i: number) => new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
  const bars: DayBar[] = Array.from({ length: 80 }, (_, i) => ({ date: day(i), open: 100, high: 101, low: 99, close: 100, volume: 1e6 }));
  const signals = evaluatePosition({ itemId: 7, symbol: "NVDA", entry: 100, shares: 100 },
    { bars, price: q.price, closeFinal: false, vix: 17, day: day(79) });
  assert.ok(signals.some((x) => x.rule === "stop" && x.level === "breach"), "stop breach from the Schwab price");
  await getAlertQuote("NVDA", fallback, clock + 16_000);
  assert.equal(fellBack, 1, "a tick over 15 s old falls back to the current source");

  s.stop();
  assert.equal(s.state, "off");
  assert.equal(timers.length, 0);
}

// ---- 5. the sync never deletes or changes his own rows
{
  const pos = (symbol: string, shares: number, avg: number, side: "long" | "short" = "long") =>
    ({ symbol, shares, side, averagePrice: avg, marketValue: null, dayPnl: null, assetType: "EQUITY", accounts: ["…1234"] });
  const plan = planSync({
    rows: [
      { id: 1, symbol: "NVDA", direction: "long", shares: 10, targetEntry: 100 }, // synced, changed at Schwab
      { id: 2, symbol: "AMD", direction: "long", shares: 5, targetEntry: 90 }, // synced, closed at Schwab
      { id: 3, symbol: "TSLA", direction: "long", shares: 3, targetEntry: 200 }, // his own row, not at Schwab
      { id: 4, symbol: "AAPL", direction: "long", shares: 1, targetEntry: 150 }, // his own row, also at Schwab
      { id: 5, symbol: "MSFT", direction: "long", shares: 2, targetEntry: 400 }, // synced, unchanged
    ],
    syncedIds: new Set([1, 2, 5]),
    otherPortfolioKeys: new Set(["META:long"]),
    positions: [pos("NVDA", 20, 105), pos("AAPL", 50, 160), pos("MSFT", 2, 400), pos("META", 4, 500), pos("SPY", 1, 600, "short")],
  });
  assert.deepEqual(plan.deletes, [2], "only the sync's own closed row");
  assert.ok(!plan.deletes.includes(3) && !plan.deletes.includes(4), "manual rows are never deleted");
  assert.deepEqual(plan.updates, [{ id: 1, direction: "long", shares: 20, entry: 105 }], "manual AAPL row not changed");
  assert.deepEqual(plan.inserts, [{ symbol: "SPY", direction: "short", shares: 1, entry: 600 }]);
  assert.deepEqual(plan.skipped.sort(), ["AAPL:long", "META:long"], "his own row, and a position in another list");
  // Nothing at Schwab: still only synced rows go.
  const empty = planSync({ rows: [{ id: 3, symbol: "TSLA", direction: "long", shares: 3, targetEntry: 200 }], syncedIds: new Set(), otherPortfolioKeys: new Set(), positions: [] });
  assert.deepEqual(empty.deletes, []);

  // Recorded-shape accounts reply: two accounts summed, options and money funds skipped, account numbers masked.
  const accounts = [
    { securitiesAccount: { type: "MARGIN", accountNumber: "11112222", currentBalances: { liquidationValue: 50_000, cashBalance: 1_000, buyingPower: 20_000, secretThing: 1 },
      positions: [
        { longQuantity: 10, shortQuantity: 0, averagePrice: 100, marketValue: 1100, instrument: { assetType: "EQUITY", symbol: "NVDA" } },
        { longQuantity: 1, shortQuantity: 0, averagePrice: 5, instrument: { assetType: "OPTION", symbol: "NVDA  261218C00150000" } },
        { longQuantity: 900, shortQuantity: 0, averagePrice: 1, instrument: { assetType: "CASH_EQUIVALENT", symbol: "SWVXX" } },
      ] } },
    { securitiesAccount: { type: "CASH", accountNumber: "33334444", positions: [
      { longQuantity: 30, shortQuantity: 0, averagePrice: 120, marketValue: 3300, instrument: { assetType: "EQUITY", symbol: "NVDA" } },
      { longQuantity: 0, shortQuantity: 5, averagePrice: 600, instrument: { assetType: "COLLECTIVE_INVESTMENT", symbol: "SPY" } },
    ] } },
  ];
  const ps = positionsFrom(accounts);
  assert.deepEqual(ps.map((p) => [p.symbol, p.side, p.shares, p.averagePrice, p.accounts.join(",")]),
    [["NVDA", "long", 40, 115, "…2222,…4444"], ["SPY", "short", 5, 600, "…4444"]]);
  assert.deepEqual(balancesFrom(accounts)[0], { account: "…2222", type: "MARGIN", liquidationValue: 50_000, cashBalance: 1_000, buyingPower: 20_000 });
  assert.equal(quotesFrom({ BAD: { quote: {} } }).length, 0);
}

// ---- 6. no order endpoint exists
{
  const files = readdirSync(here).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
  assert.ok(files.includes("rest.ts") && files.includes("routes.ts"));
  for (const f of files) {
    const src = readFileSync(join(here, f), "utf8");
    assert.ok(!/method:\s*["'`](PUT|DELETE|PATCH)["'`]/i.test(src), `${f}: no PUT/DELETE/PATCH to Schwab`);
    const posts = src.match(/method:\s*["'`]POST["'`]/gi) ?? [];
    if (f === "auth.ts") assert.equal(posts.length, 1, "auth.ts: the one POST is the OAuth token request");
    else assert.equal(posts.length, 0, `${f}: no POST to Schwab`);
    assert.ok(!/(placeOrder|replaceOrder|cancelOrder|previewOrder)/i.test(src), `${f}: no order-writing method`);
    // Routes: MarketFlow's own POSTs are only Disconnect and Sync now.
    const routes = [...src.matchAll(/app\.(post|put|delete|patch)\(\s*"([^"]+)"/g)].map((m) => `${m[1]} ${m[2]}`);
    if (f === "routes.ts") assert.deepEqual(routes, ["post /api/schwab/disconnect", "post /api/schwab/sync"]);
    else assert.deepEqual(routes, []);
  }
  const auth = readFileSync(join(here, "auth.ts"), "utf8");
  assert.match(auth, /fetchImpl\(`\$\{AUTH_BASE\}\/token`, \{\s*method: "POST"/, "that POST goes to the token URL");
  // The REST client sends GET and nothing else, whatever method is called.
  const store = new MemoryStore();
  await signedIn(store, 20 * MIN);
  const f = fakeFetch(() => ({ status: 200, json: [] }));
  const rest = new SchwabRest(new TokenManager(cfg, store, f.impl, () => T0), 1, { fetchImpl: f.impl, now: () => T0 });
  await rest.accountNumbers(); await rest.accounts(); await rest.orders("h", "a", "b"); await rest.transactions("h", "a", "b");
  await rest.userPreference(); await rest.quotes(["SPY"]); await rest.priceHistory("SPY");
  assert.ok(f.calls.length === 7 && f.calls.every((c) => c.method === "GET"), "every Schwab call is a GET");
  const proto = Object.getOwnPropertyNames(SchwabRest.prototype);
  assert.ok(!proto.some((m) => /post|put|delete|place|cancel|replace/i.test(m)), `client methods: ${proto.join(", ")}`);
  // Anima reads positions, balances, quotes and status only.
  for (const p of ["positions", "balances", "quotes", "status"]) assert.ok(allowedPath(`/api/schwab/${p}`), p);
  for (const p of ["orders", "transactions", "sync", "disconnect", "connect", "callback"]) {
    assert.ok(!allowedPath(`/api/schwab/${p}`) && !allowedPath(`/api/schwab/${p}`, "POST"), `gateway closed: ${p}`);
  }
  assert.equal(classifyApiPath("GET", "/api/schwab/positions"), "owner");
  assert.equal(classifyApiPath("POST", "/api/schwab/sync"), "owner");
  assert.equal(classifyApiPath("GET", "/api/schwab/callback"), "public");
  assert.equal(classifyApiPath("GET", "/api/health/schwab"), "public");
}

// ---- 7. the status endpoint's shapes
{
  const KEYS = ["accessExpiresAt", "configured", "enabled", "lastQuoteAgeSec", "message", "realtime", "refreshExpiresAt", "refreshHoursLeft", "state", "stream"];
  const STREAM_KEYS = ["lastMessageAt", "reconnects", "state", "symbols"];
  const stream = { state: "streaming" as const, symbols: 12, lastMessageAt: T0 - 2000, reconnects: 1 };
  const conn = { userId: 1, accessToken: "a", refreshToken: "r", accessExpiresAt: T0 + 20 * MIN, refreshExpiresAt: T0 + 30 * HOUR, lastError: null, syncWatchlistId: 9, lastSyncAt: null };
  const cases = {
    off: buildHealth({ cfg: loadSchwabConfig({} as NodeJS.ProcessEnv), conn: null, stream: null, lastQuoteAgeSec: null, realtime: null, now: T0 }),
    notConfigured: buildHealth({ cfg: loadSchwabConfig({ SCHWAB_ENABLED: "1" } as NodeJS.ProcessEnv), conn: null, stream: null, lastQuoteAgeSec: null, realtime: null, now: T0 }),
    disconnected: buildHealth({ cfg, conn: null, stream: null, lastQuoteAgeSec: null, realtime: null, now: T0 }),
    connected: buildHealth({ cfg, conn, stream, lastQuoteAgeSec: 2, realtime: true, now: T0 }),
    expiring: buildHealth({ cfg, conn: { ...conn, refreshExpiresAt: T0 + 5 * HOUR }, stream, lastQuoteAgeSec: 2, realtime: true, now: T0 }),
    expired: buildHealth({ cfg, conn: { ...conn, refreshToken: null, accessToken: null, lastError: "refused" }, stream, lastQuoteAgeSec: 2, realtime: true, now: T0 }),
  };
  for (const [name, h] of Object.entries(cases)) {
    assert.deepEqual(Object.keys(h).sort(), KEYS, `${name}: keys`);
    assert.deepEqual(Object.keys(h.stream).sort(), STREAM_KEYS, `${name}: stream keys`);
    assert.ok(!JSON.stringify(h).includes('"a"') && !JSON.stringify(h).includes('"r"'), `${name}: no tokens`);
  }
  assert.deepEqual([cases.off.state, cases.notConfigured.state, cases.disconnected.state, cases.connected.state, cases.expiring.state, cases.expired.state],
    ["off", "not_configured", "disconnected", "connected", "expiring", "expired"]);
  assert.deepEqual(cases.connected, {
    enabled: true, configured: true, state: "connected", message: "Schwab connected",
    accessExpiresAt: new Date(T0 + 20 * MIN).toISOString(), refreshExpiresAt: new Date(T0 + 30 * HOUR).toISOString(), refreshHoursLeft: 30,
    stream: { state: "streaming", symbols: 12, lastMessageAt: new Date(T0 - 2000).toISOString(), reconnects: 1 },
    lastQuoteAgeSec: 2, realtime: true,
  });
  assert.equal(cases.expiring.message, "Schwab sign-in expires in 5 hours — sign in again to keep it");
  assert.equal(cases.expired.message, EXPIRED_MESSAGE);
  assert.equal(cases.expired.stream.state, "off", "an expired sign-in shows no stream");
  assert.equal(cases.expired.lastQuoteAgeSec, null);
  assert.equal(cases.off.enabled, false);
}

console.log("schwab.test.ts: all fixed cases pass");
