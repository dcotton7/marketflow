/**
 * Trigger scanner: the store is insert-only, the routes answer 404 with the flag off, the pass list reaches Anima
 * through the gateway allow-list (read only), the scheduler pauses under the memory / night guards and says why,
 * falls back to the shortlist tier after failed fetches, and starts nothing with the flag off. No network, no database.
 */
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import express from "express";
import { createAnimaGateway, allowedPath } from "../middleware/animaGateway";
import { classifyApiPath } from "../middleware/dataAccess";
import { bars, ctx, DATE, regime } from "./fixtures";
import { createTriggerRoutes } from "./routes";
import { Dedupe, runPass } from "./scan";
import { TriggerScanner, startTriggerScanner, getScanner, type SchedulerDeps } from "./scheduler";
import { DEFAULTS, loadSettings, scannerEnabled } from "./settings";
import { memoryTriggerStore } from "./store";
import type { DayData } from "./day-data";

// ---- insert-only: no statement in the store or the migration rewrites or removes a row ------------------------------
{
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/--.*$/gm, "").replace(/DO NOTHING/g, "");
  for (const f of ["server/trigger-scanner/store.ts", "server/trigger-scanner/scheduler.ts", "server/trigger-scanner/day-data.ts", "server/trigger-scanner/routes.ts", "migrations/029_trigger_scanner.sql"]) {
    const src = strip(readFileSync(join(process.cwd(), f), "utf8"));
    assert.ok(!/\b(DELETE|UPDATE|TRUNCATE|DROP|ALTER)\b/i.test(src), `${f} never removes or rewrites`);
  }
  const ddl = readFileSync(join(process.cwd(), "server/trigger-scanner/store.ts"), "utf8");
  const mig = readFileSync(join(process.cwd(), "migrations/029_trigger_scanner.sql"), "utf8");
  for (const t of ["trigger_candidates", "trigger_scan_runs", "trigger_user_setups"]) {
    assert.ok(ddl.includes(`CREATE TABLE IF NOT EXISTS ${t}`) && mig.includes(`CREATE TABLE IF NOT EXISTS ${t}`), `${t} in both`);
  }
  const inserts = ddl.split("\n").filter((l) => l.includes("INSERT INTO"));
  assert.equal(inserts.length, 2);
  for (const l of inserts) assert.ok(l.includes("ON CONFLICT") && l.includes("DO NOTHING"), "every insert is ON CONFLICT DO NOTHING");
}

// ---- settings and the flag ----------------------------------------------------------------------------------------
assert.equal(scannerEnabled({} as any), false, "off unless set");
assert.equal(scannerEnabled({ TRIGGER_SCANNER: "1" } as any), false, "only 'on'");
assert.equal(scannerEnabled({ TRIGGER_SCANNER: " ON " } as any), true);
assert.equal(loadSettings({ TRIGGER_SCANNER_MIN_PRICE: "x", TRIGGER_SCANNER_TIER: "shortlist" } as any).minPrice, 6);
assert.equal(loadSettings({ TRIGGER_SCANNER_TIER: "shortlist" } as any).tier, "shortlist");
await startTriggerScanner({} as any);
assert.equal(getScanner(), null, "flag off: no scanner, no timer, no query");

// ---- the gateway allow-list and the access level ---------------------------------------------------------------------
assert.ok(allowedPath("/api/triggers"));
assert.ok(allowedPath("/api/triggers/status"));
assert.ok(!allowedPath("/api/triggers/x"));
assert.ok(!allowedPath("/api/triggers", "POST"), "read only");
assert.equal(classifyApiPath("GET", "/api/triggers"), "owner", "built from vendor data: owner only");
assert.equal(classifyApiPath("GET", "/api/triggers/status"), "owner");

// ---- routes: 404 when off; the pass list with a cursor; private user setups ------------------------------------------------
const store = memoryTriggerStore();
{
  const RANGE: [number, number, number, number, number][] = [[100, 101, 99.5, 100.5, 60000], [100.5, 100.9, 99.2, 99.6, 40000], [99.6, 100.4, 99, 100, 30000]];
  const rows: [number, number, number, number, number][] = [...RANGE, [100.8, 101.7, 100.7, 101.5, 80000]];
  const contexts = new Map(["AAA", "BBB", "CCC"].map((s) => [s, ctx({ symbol: s })]));
  const watch = new Map([["CCC", [{ setupKey: "my_setup", setupOwner: "user:7", ownerUserId: 7, side: "long" as const, entryName: "prev_close", entryLevel: 101.4, hitDate: "2026-11-23", tested: false }]]]);
  const res = runPass({ date: DATE, contexts, bars: new Map(["AAA", "BBB", "CCC"].map((s) => [s, bars(rows)])), watch, regime: regime("AGGRESSIVE"), rotation: { asOf: null, leadingSize: [], leadingSectors: [], size: {}, sectors: {} }, settings: DEFAULTS, dedupe: new Dedupe(), evaluated: new Map() });
  assert.ok(res.candidates.length >= 4);
  await store.insertCandidates(res.candidates);
}
let on = false;
const status = { state: "running", why: null, tier: "bars", marketDate: DATE, universeSize: 1746, lastPassAt: "2026-11-24T14:50:21.000Z", barsLagSec: 21 } as any;
const app = express();
app.use(createAnimaGateway({ token: "t".repeat(40), userId: 7 }));
app.use((req: any, _res, next) => { if (!req.session) req.session = { userId: Number(req.headers["x-user"]) || undefined }; next(); });
app.use("/api/triggers", createTriggerRoutes({ enabled: () => on, store: () => store, status: () => status, now: () => new Date("2026-11-24T15:00:00Z") }));
app.use((_req, res) => res.status(404).json({ error: "Not found" }));
const server = app.listen(0);
await new Promise<void>((r) => server.once("listening", () => r()));
const { port } = server.address() as AddressInfo;
const get = (path: string, headers: Record<string, string> = {}) => new Promise<{ status: number; body: any }>((resolve, reject) => {
  http.get({ host: "127.0.0.1", port, path, headers }, (res) => {
    let b = "";
    res.on("data", (c) => (b += c));
    res.on("end", () => resolve({ status: res.statusCode!, body: b ? JSON.parse(b) : null }));
  }).on("error", reject);
});
try {
  assert.equal((await get("/api/triggers", { "x-user": "1" })).status, 404, "flag off: 404");
  assert.equal((await get("/api/triggers/status", { "x-user": "1" })).status, 404, "flag off: status 404 too");
  on = true;
  const all = await get("/api/triggers?grade=all&day=2026-11-24", { "x-user": "1" });
  assert.equal(all.status, 200);
  const ids = all.body.candidates.map((c: any) => c.id);
  assert.deepEqual(ids, [...ids].sort((a, b) => b - a), "newest first");
  assert.ok(all.body.candidates.every((c: any) => c.setup_owner === "builtin"), "user 1 does not see user 7's setup");
  const c0 = all.body.candidates[0];
  for (const k of ["symbol", "side", "setup_key", "setup_owner", "grade", "grade_points", "grade_components", "trigger_at", "entry_ref", "stop", "risk_pct", "risk_adr", "adr_pct", "rel_volume", "trigger_bar", "levels", "liquidity", "regime", "cap_size", "sector", "group_leading", "rotation", "data_as_of", "dedupe_key"]) {
    assert.ok(k in c0, `field ${k}`);
  }
  assert.match(c0.trigger_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, "ISO time");
  assert.ok(c0.stop.level && c0.stop.price > 0);
  // the cursor: page by 2, no row lost or repeated
  const seen: number[] = [];
  let since = 0;
  for (let k = 0; k < 10; k++) {
    const page = await get(`/api/triggers?grade=all&day=2026-11-24&limit=2&since=${since}`, { "x-user": "1" });
    seen.push(...page.body.candidates.map((c: any) => c.id));
    since = page.body.next_cursor;
    if (!page.body.has_more) break;
  }
  assert.deepEqual([...seen].sort((a, b) => a - b), [...ids].sort((a, b) => a - b), "paging by cursor returns every row once");
  const none = await get(`/api/triggers?grade=all&day=2026-11-24&since=${since}`, { "x-user": "1" });
  assert.deepEqual([none.body.count, none.body.next_cursor, none.body.has_more], [0, since, false], "nothing new: same cursor back");
  const mine = await get("/api/triggers?grade=all&day=2026-11-24&setup=my_setup", { "x-user": "7" });
  assert.ok(mine.body.candidates.length >= 1 && mine.body.candidates.every((c: any) => c.setup_owner === "user:7"), "the owner sees their own setup");
  const shorts = await get("/api/triggers?grade=all&day=2026-11-24&side=short", { "x-user": "1" });
  assert.ok(shorts.body.candidates.every((c: any) => c.side === "short"));
  const st = await get("/api/triggers/status", { "x-user": "1" });
  assert.equal(st.status, 200);
  assert.deepEqual([st.body.running, st.body.universe_size, st.body.bars_lag_sec, st.body.tier], [true, 1746, 21, "bars"]);
  assert.ok(st.body.today.total >= 3 && st.body.today.by_setup.orb_breakout);
  assert.ok(st.body.setups.some((s: any) => s.key === "orb_breakout" && s.owner === "builtin"));
  // through the Anima gateway, as its owner (user 7): read only
  const inside = { host: "marketflow-hrxh:10000", "x-anima-token": "t".repeat(40) };
  const gw = await get("/api/anima/triggers?grade=all&day=2026-11-24", inside);
  assert.equal(gw.status, 200);
  assert.ok(gw.body.candidates.some((c: any) => c.setup_owner === "user:7"), "the gateway runs as its owner");
  assert.equal((await get("/api/anima/triggers/status", inside)).status, 200);
  assert.equal((await get("/api/anima/triggers/x", inside)).status, 403, "only the two routes");
  on = false;
  assert.equal((await get("/api/anima/triggers", inside)).status, 404, "flag off through the gateway too");
} finally {
  await new Promise<void>((r) => server.close(() => r()));
}

// ---- the scheduler: pauses, bar fetches, fallback --------------------------------------------------------------------
{
  const day: DayData = {
    date: DATE, universe: ["AAA"], contexts: new Map([["AAA", ctx({ symbol: "AAA" })]]), watch: new Map(), earningsAsOf: null,
    skipped: {}, userSetups: [], loadedAt: "2026-11-24T14:00:00.000Z",
  };
  let now = new Date("2026-11-24T14:50:25Z"); // 9:50:25 ET
  let pause: string | null = null;
  let failing = false;
  let calls = 0;
  const rows: [number, number, number, number, number][] = [[100, 101, 99.5, 100.5, 60000], [100.5, 100.9, 99.2, 99.6, 40000], [99.6, 100.4, 99, 100, 30000], [100.8, 101.7, 100.7, 101.5, 80000]];
  const st = memoryTriggerStore();
  const deps: SchedulerDeps = {
    now: () => now, store: st, settings: DEFAULTS, loadDay: async () => day,
    fetchBars: async (symbols) => {
      calls++;
      if (failing) throw new Error("Alpaca bars 429: too many requests");
      return { bars: new Map(symbols.filter((s) => s === "AAA").map((s) => [s, bars(rows)])), requests: 1 };
    },
    regime: () => regime("NEUTRAL"),
    pauseReason: () => pause,
  };
  const sc = new TriggerScanner(deps);
  pause = "memory pressure";
  assert.equal(await sc.tick(), "paused");
  assert.deepEqual([sc.status.state, sc.status.why, calls], ["paused", "memory pressure", 0], "paused: says why, fetches nothing");
  assert.equal(st.runs.length, 1, "one run row for the paused slot");
  assert.equal(st.runs[0].paused, "memory pressure");
  await sc.tick();
  assert.equal(st.runs.length, 1, "not again in the same slot");
  pause = null;
  assert.match(await sc.tick(), /^pass:/);
  assert.equal(calls, 1);
  assert.equal(sc.status.state, "running");
  assert.equal(sc.status.universeSize, 1);
  assert.equal(sc.status.lastBarClose, "2026-11-24T14:50:00.000Z");
  assert.equal(sc.status.barsLagSec, 25);
  assert.ok(st.candidates.some((c) => c.setupKey === "orb_breakout"), "the ORB was raised from the fetched bars");
  assert.equal(await sc.tick(), "up_to_date", "nothing new until the next bar closes");
  assert.equal(sc.status.storedToday, st.candidates.length);
  // the daily cap: a scanner with room for 1 keeps the best one and counts the rest
  const capped = memoryTriggerStore();
  const sc3 = new TriggerScanner({ ...deps, store: capped, settings: { ...DEFAULTS, maxStoredPerDay: 1 } });
  assert.match(await sc3.tick(), /^pass:1$/);
  assert.equal(capped.candidates.length, 1);
  assert.ok(sc3.status.overCapToday >= 1 && capped.runs[0].skipped.over_daily_cap >= 1, "over the cap: counted, not stored");
  now = new Date("2026-11-24T14:55:05Z");
  assert.equal(await sc.tick(), "settling", "waits barSettleSec after the boundary");
  now = new Date("2026-11-24T14:55:30Z");
  failing = true;
  assert.equal(await sc.tick(), "fetch_failed");
  assert.equal(sc.status.tier, "bars");
  now = new Date("2026-11-24T14:56:00Z");
  assert.equal(await sc.tick(), "fetch_failed");
  assert.equal(sc.status.tier, "shortlist", "two failures: shortlist tier for the day");
  assert.match(sc.status.tierWhy!, /two failed bar fetches/);
  pause = "night mode";
  now = new Date("2026-11-25T02:00:00Z"); // 21:00 ET
  assert.equal(await sc.tick(), "closed", "outside the session");
  // a guard trip: paused until tomorrow
  const sc2 = new TriggerScanner({ ...deps, pauseReason: () => "memory guard tripped today (BarJob: batch 4); paused until tomorrow" });
  now = new Date("2026-11-24T15:10:30Z");
  assert.equal(await sc2.tick(), "paused");
  assert.match(sc2.status.why!, /until tomorrow/);
}

// the live pause reasons read the app's own guards
{
  const { livePauseReason } = await import("./scheduler");
  const reason = await livePauseReason();
  assert.equal(reason(new Date("2026-11-28T15:00:00Z")), "night mode", "a Saturday");
  const { resetGuardForTests, overLimit } = await import("../infra/job-guard");
  resetGuardForTests();
  overLimit("Test", "batch 1", 1); // trips the guard (RSS is over 1 MB)
  assert.match(reason(new Date())!, /night mode|memory guard tripped today/);
  resetGuardForTests();
}


// ---- the bar feed (a fake fetch: paging, a 429 retried, incomplete bars left out) and the shortlist tier --------------
{
  const { alpacaBarsFetcher, BarBook } = await import("./bars-feed");
  const { promoteShortlist } = await import("./shortlist");
  const urls: string[] = [];
  let n = 0;
  const fake = (async (url: string) => {
    urls.push(url);
    n++;
    if (n === 1) return new Response("slow down", { status: 429 });
    const page = url.includes("page_token") ? 2 : 1;
    const body = page === 1
      ? { bars: { AAA: [{ t: "2026-11-24T14:30:00Z", o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }] }, next_page_token: "p2" }
      : { bars: { AAA: [{ t: "2026-11-24T14:35:00Z", o: 1.5, h: 2, l: 1, c: 1.8, v: 12 }], BBB: [{ t: "2026-11-24T14:30:00Z", o: 5, h: 6, l: 4, c: 5.5, v: 7 }] }, next_page_token: null };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  const f = alpacaBarsFetcher({ feed: "sip", batch: 200, fetchImpl: fake, env: {} as any });
  const got = await f(["AAA", "BBB"], new Date("2026-11-24T14:30:00Z"), new Date("2026-11-24T14:39:59Z"));
  assert.equal(got.requests, 3, "429 retried once, then two pages");
  assert.match(urls[1], /timeframe=5Min/);
  assert.match(urls[1], /symbols=AAA%2CBBB/);
  assert.match(urls[1], /feed=sip/);
  assert.equal(got.bars.get("AAA")!.length, 2);
  const book = new BarBook(DATE);
  assert.equal(book.add(got.bars, Date.parse("2026-11-24T14:40:00Z")), 3);
  assert.equal(book.add(got.bars, Date.parse("2026-11-24T14:40:00Z")), 0, "merged by start time, no doubles");
  const partial = new BarBook(DATE);
  partial.add(got.bars, Date.parse("2026-11-24T14:38:00Z"));
  assert.equal(partial.bySymbol.get("AAA")!.length, 1, "a bar that has not closed is not kept");
  assert.equal(book.newestClose(), "2026-11-24T14:40:00.000Z");
  const fails = alpacaBarsFetcher({ feed: "sip", batch: 200, fetchImpl: (async () => new Response("no", { status: 403 })) as any, env: {} as any });
  await assert.rejects(fails(["AAA"], new Date(), new Date()), /Alpaca bars 403/);

  const contexts = new Map([["NEAR", ctx({ symbol: "NEAR", sma20: 100.5 })], ["FAR", ctx({ symbol: "FAR" })], ["WATCH", ctx({ symbol: "WATCH" })], ["MOVER", ctx({ symbol: "MOVER" })]]);
  const q = (price: number, open = price, vwap = price + 5, volume = 1000) => ({ price, open, high: price, low: price, volume, vwap });
  const picked = promoteShortlist(new Map([["NEAR", q(100)], ["FAR", q(100)], ["WATCH", q(100)], ["MOVER", q(104, 100)]]), contexts, { max: 10, slot: 20, watched: new Set(["WATCH"]) });
  assert.deepEqual(picked, ["WATCH", "NEAR", "MOVER"], "watched first, then nearest a level; a 1-ADR mover; not FAR");
  assert.deepEqual(promoteShortlist(new Map([["NEAR", q(100)], ["MOVER", q(104, 100)]]), contexts, { max: 1, slot: 20, watched: new Set() }), ["NEAR"], "capped");
}

console.log("trigger scanner routes, gateway, store, scheduler ok");
process.exit(0);
