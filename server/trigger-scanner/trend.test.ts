/**
 * Trend facts (trend.ts), fixed cases on made-up daily bars with answers worked by hand: price vs the 20/50/200-day,
 * slopes and the flat band, tight averages, the base proxy, room in the trade's direction, the reclaim and "closing
 * the gap", off the low vs SPY, base and go, SPY's own 50-day, too little history, and that a pass's grades, stops
 * and fields are the same with and without the trend. Plus the serialised SQL: the new column, the migration, and the
 * daily load's chunk query (an IN list, text dates). No network, no database.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { bars, ctx, DATE, noRotation, regime, settings } from "./fixtures";
import { buildDailyContext } from "./daily";
import { dailyChunkQuery, dailyCutoff, dailySessions } from "./day-data";
import { Dedupe, runPass } from "./scan";
import { DDL, pgTriggerStore } from "./store";
import { candidateTrend, dailyTrend, TREND_SESSIONS, type TrendInput } from "./trend";
import type { DailyBar, Level } from "./types";

const near = (a: number | null | undefined, b: number, tol = 0.01, what = "") => assert.ok(a !== null && a !== undefined && Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const day = (k: number) => new Date(Date.parse("2025-11-03T12:00:00Z") + k * 864e5).toISOString().slice(0, 10);
const series = (closes: number[], spread = (c: number) => 0.5): DailyBar[] =>
  closes.map((c, k) => ({ date: day(k), open: c, high: c + spread(c), low: c - spread(c), close: c, volume: 1e6 }));
const input = (over: Partial<TrendInput>): TrendInput => ({ daily: null, spy: null, side: "long", entry: 100, adr: 1, dailyLevels: [], prevClose: 100, setupKey: "orb_breakout", facts: {}, ...over });

// ---- A: a steady uptrend, 260 sessions, close = 100 + 0.1 k (k = 0..259), high/low = close +- 0.5 ---------------
const upBars = series(Array.from({ length: 260 }, (_, k) => 100 + 0.1 * k));
const up = dailyTrend(upBars, 1.0, settings);
{
  // last close 125.9; sma20 = 125.9 - 0.95, sma50 = 125.9 - 2.45, sma200 = 125.9 - 9.95, sma10 = 125.9 - 0.45
  near(up.avg.sma20.value, 124.95, 1e-9, "sma20");
  near(up.avg.sma50.value, 123.45, 1e-9, "sma50");
  near(up.avg.sma200.value, 115.95, 1e-9, "sma200");
  // slope 20-day over 10 sessions: 124.95 / 123.95 - 1 = 0.807% -> inside the +-1% band: FLAT
  near(up.avg.sma20.slopePct, 0.8068, 1e-3, "sma20 slope");
  assert.equal(up.avg.sma20.slope, "flat");
  // 50-day over 10: 123.45 / 122.45 - 1 = 0.817% > 0.5 -> rising; 200-day over 20: 115.95 / 113.95 - 1 = 1.755%
  near(up.avg.sma50.slopePct, 0.8167, 1e-3, "sma50 slope");
  assert.equal(up.avg.sma50.slope, "rising");
  near(up.avg.sma200.slopePct, 1.7552, 1e-3, "sma200 slope");
  assert.equal(up.avg.sma200.slope, "rising");
  // base: with a 1.0 ADR, the run of sessions to yesterday within 3.0: range = 0.1 (k - 1) + 1 <= 3 -> 21 sessions
  assert.equal(up.base.days, 21);
  assert.equal(up.base.ok, true, "21 >= 15 sessions");
  near(up.base.top, 126.4, 1e-9, "base high = yesterday's high");
  assert.deepEqual(up.missing, []);

  // long at 126.50 with a resistance level at 128.00 (1.5 ADR up): above both, tight, clear, base and go
  const t = candidateTrend(input({ daily: up, entry: 126.5, prevClose: 125.9, adr: 1.0, dailyLevels: [{ name: "prev_high", price: 128 }, { name: "sma5", price: 125.7 }] }), settings);
  assert.equal(t.known, true);
  assert.equal(t.above_50_and_200, true);
  assert.equal(t.below_50_and_200, false);
  assert.equal(t.ma.sma200.above, true);
  near(t.ma.sma200.pct, 9.1, 0.01, "126.5 / 115.95 - 1");
  // tight: (125.45 - 123.45) / 126.5 = 1.58% <= 3
  near(t.tight.spread_pct, 1.58, 0.005, "spread");
  assert.equal(t.tight.ok, true);
  // room: nearest above is prev_high 128.00 (high_20d 126.4 is under the entry): 1.5 ADR, 1.19% -> clear
  assert.deepEqual([t.room.level, t.room.price, t.room.dist_adr, t.room.clear], ["prev_high", 128, 1.5, true]);
  near(t.room.dist_pct, 1.19, 0.005, "room %");
  // base and go: yesterday 125.9 at or under the base high 126.4, the trigger closes 126.5 over it
  assert.equal(t.base_and_go.ok, true);
  // a level 0.5 ADR up: not clear
  const t2 = candidateTrend(input({ daily: up, entry: 126.5, prevClose: 125.9, adr: 1.0, dailyLevels: [{ name: "prev_high", price: 127 }] }), settings);
  assert.deepEqual([t2.room.level, t2.room.dist_adr, t2.room.clear], ["prev_high", 0.5, false]);
  // nothing above at all: clear, level null
  const t3 = candidateTrend(input({ daily: up, entry: 126.5, prevClose: 125.9, adr: 1.0 }), settings);
  assert.deepEqual([t3.room.level, t3.room.clear], [null, true]);
  // a gap level above that is SUPPORT is not resistance for the room
  const gapSup: Level = { name: "gap", price: 127, gap: { date: "x", dir: "down", state: "failed", role: "support" } };
  assert.equal(candidateTrend(input({ daily: up, entry: 126.5, adr: 1.0, dailyLevels: [gapSup] }), settings).room.level, null);
  // the trigger under the base high (126.3): no base and go
  assert.equal(candidateTrend(input({ daily: up, entry: 126.3, prevClose: 125.9, adr: 1.0 }), settings).base_and_go.ok, false);
  // gap and go uses the gap rule's own base fact
  assert.equal(candidateTrend(input({ daily: up, entry: 126.5, setupKey: "gap_and_go", facts: { from_base: 1 } }), settings).base_and_go.ok, true);
  assert.equal(candidateTrend(input({ daily: up, entry: 126.5, setupKey: "gap_and_go", facts: { from_base: 0 } }), settings).base_and_go.ok, false);
}

// ---- B: a correction and a reclaim. 240 closes at 100, 10 at 90, then 3 at 105 (253 sessions) --------------------
const flat = (c: number) => c * 0.01;
const reclaimBars = series([...Array(240).fill(100), ...Array(10).fill(90), 105, 105, 105], flat);
// C: the same correction, still under and closing the gap: the last three at 92, 94, 96 (also used as SPY)
const closingBars = series([...Array(240).fill(100), ...Array(10).fill(90), 92, 94, 96], flat);
const rec = dailyTrend(reclaimBars, 2.0, settings);
const clo = dailyTrend(closingBars, 2.0, settings);
{
  // at index 250 the 50-day is (39 x 100 + 10 x 90 + 105) / 50 = 98.1; the close 105 is over it after 10 closes
  // under: the reclaim, 3 sessions ago (yesterday = 1). Index 251 and 252 have closes over it in their prior five.
  for (const k of ["sma20", "sma50", "sma200"] as const) {
    assert.equal(rec.avg[k].reclaimUp?.date, reclaimBars[250].date, `${k} reclaim date`);
    assert.equal(rec.avg[k].reclaimUp?.sessionsAgo, 3, `${k} reclaim sessions ago`);
  }
  const t = candidateTrend(input({ daily: rec, spy: clo, entry: 105.5, prevClose: 105, adr: 2.1 }), settings);
  assert.deepEqual([t.reclaim.sma50.date, t.reclaim.sma50.sessions_ago, t.reclaim.sma50.recent], [reclaimBars[250].date, 3, true]);
  assert.equal(t.reclaim.sma50.closing, false, "above now: not 'closing'");
  // off the low of the last 40 closes (90): 105 / 90 - 1 = 16.67%; SPY (C) 96 / 90 - 1 = 6.67%; the name is 10 ahead
  near(t.vs_spy.off_low_pct, 16.67, 0.005, "off low");
  near(t.vs_spy.spy_off_low_pct, 6.67, 0.005, "spy off low");
  near(t.vs_spy.vs_spy_off_low_pct, 10, 0.005, "vs spy");
  assert.equal(t.vs_spy.reclaimed_50_before_spy, true, "the name reclaimed, SPY has not");
  // SPY (C): its 50-day at 252 = (37 x 100 + 10 x 90 + 92 + 94 + 96) / 50 = 97.64; 96 is 1.68% under; no reclaim
  assert.equal(t.market.spy_above_50, false);
  near(t.market.spy_pct_vs_50, -1.68, 0.005, "spy vs 50");
  assert.deepEqual([t.market.spy_reclaim_50_sessions_ago, t.market.spy_reclaimed_50_recent], [null, false]);

  // C as the name: under the 50-day and closing: now -1.68%, 5 sessions ago (close 90, 50-day 98.4) -8.54%
  const c = candidateTrend(input({ daily: clo, spy: rec, entry: 96.2, prevClose: 96, adr: 1.9 }), settings);
  near(c.reclaim.sma50.dist_now_pct, -1.68, 0.005, "dist now");
  near(c.reclaim.sma50.dist_then_pct, -8.54, 0.005, "dist then");
  assert.deepEqual([c.reclaim.sma50.closing, c.reclaim.sma50.date, c.reclaim.sma50.recent], [true, null, false]);
  assert.equal(c.vs_spy.reclaimed_50_before_spy, false, "SPY reclaimed, the name has not");
  assert.equal(c.market.spy_above_50, true);
  assert.equal(c.market.spy_reclaimed_50_recent, true);
  // neither reclaimed: null
  assert.equal(candidateTrend(input({ daily: clo, spy: clo, entry: 96.2 }), settings).vs_spy.reclaimed_50_before_spy, null);

  // the short mirror (coordinator's assumption): C as a short at 95.8. 200-day = (187 x 100 + 900 + 282) / 200 = 99.41
  const s = candidateTrend(input({ daily: clo, side: "short", entry: 95.8, prevClose: 96, adr: 1.94 }), settings);
  assert.equal(s.below_50_and_200, true);
  // room below: the 20-session low is 90 x 0.99 = 89.1: (95.8 - 89.1) / 1.94 = 3.45 ADR -> clear
  assert.equal(s.room.level, "low_20d");
  near(s.room.dist_adr, 3.45, 0.005, "short room");
  assert.equal(s.room.clear, true);
  // a support 0.5 ADR under the short's entry: not clear
  assert.equal(candidateTrend(input({ daily: clo, side: "short", entry: 95.8, adr: 1.94, dailyLevels: [{ name: "sma5", price: 94.83 }] }), settings).room.clear, false);
}

// ---- too little history and no trend at all ----------------------------------------------------------------------
{
  const short = dailyTrend(upBars.slice(0, 100), 1.0, settings);
  assert.equal(short.avg.sma200.value, null);
  assert.ok(short.missing.some((m) => m === "sma200: 100 sessions, needs 200"), short.missing.join("; "));
  const t = candidateTrend(input({ daily: short, entry: 111 }), settings);
  assert.equal(t.known, true);
  assert.deepEqual([t.ma.sma200.value, t.ma.sma200.above, t.ma.sma200.slope, t.above_50_and_200], [null, null, null, null]);
  assert.equal(t.ma.sma50.above, true, "what is known is still given");
  // 205 sessions: the 200-day is known, its 20-session slope is not
  const mid = dailyTrend(upBars.slice(0, 205), 1.0, settings);
  assert.ok(mid.avg.sma200.value !== null && mid.avg.sma200.slope === null);
  assert.ok(mid.missing.includes("sma200 slope: 205 sessions, needs 220"));
  const none = candidateTrend(input({}), settings);
  assert.deepEqual([none.known, none.above_50_and_200, none.tight.ok, none.room.clear, none.base.ok, none.base_and_go.ok], [false, null, null, null, null, null]);
  assert.ok(none.missing.includes("no daily trend for this name"));
}

// ---- the daily context carries it; a pass's candidates carry it; nothing else changes -----------------------------
{
  const c = buildDailyContext("UP", upBars)!;
  assert.ok(c.trend && c.trend.avg.sma200.value !== null);
  const RANGE: [number, number, number, number, number][] = [[100, 101, 99.5, 100.5, 60000], [100.5, 100.9, 99.2, 99.6, 40000], [99.6, 100.4, 99, 100, 30000], [100.8, 101.7, 100.7, 101.5, 80000]];
  const run = (withTrend: boolean) => {
    const contexts = new Map([["AAA", ctx({ symbol: "AAA", sma20: 99.2, trend: withTrend ? dailyTrend(series(Array.from({ length: 260 }, (_, k) => 75 + 0.1 * k)), 3, settings) : undefined })]]);
    if (withTrend) contexts.set("SPY", ctx({ symbol: "SPY", trend: clo }));
    return runPass({ date: DATE, contexts, bars: new Map([["AAA", bars(RANGE)]]), watch: new Map(), regime: regime("AGGRESSIVE"), rotation: noRotation, settings, dedupe: new Dedupe(), evaluated: new Map() }).candidates;
  };
  const a = run(true), b = run(false);
  assert.equal(a.length, b.length);
  assert.ok(a.length >= 1);
  for (let i = 0; i < a.length; i++) {
    const { trend: ta, ...ra } = a[i];
    const { trend: tb, ...rb } = b[i];
    assert.deepEqual(ra, rb, "grades, stops and every other field the same with and without the trend");
    assert.equal(ta!.known, true);
    assert.equal(tb!.known, false);
  }
  const orb = a.find((x) => x.setupKey === "orb_breakout")!;
  // series 75 + 0.1 k: last close 100.9, entry 101.5: above the 50 (98.45) and the 200 (90.95)
  assert.equal(orb.trend!.above_50_and_200, true);
  assert.equal(orb.trend!.market.spy_above_50, false, "SPY's own state from its context");
}

// ---- the daily load: sessions, cutoff, and the chunk query as Postgres receives it --------------------------------
{
  assert.equal(TREND_SESSIONS, 250);
  assert.equal(dailySessions(false), 250, "was 75");
  assert.equal(dailySessions(true), 260);
  assert.equal(dailyCutoff("2026-11-27", 250), "2025-11-17", "375 calendar days back");
  const q = new PgDialect().sqlToQuery(dailyChunkQuery(sql, ["AAPL", "MSFT"], "2025-11-17", "2026-11-27"));
  assert.match(q.sql, /symbol IN \(\$1, \$2\) AND bar_date >= \$3 AND bar_date < \$4/);
  assert.ok(!/::date|ANY\s*\(/i.test(q.sql), `no cast to date, no ANY: ${q.sql}`);
  assert.deepEqual(q.params, ["AAPL", "MSFT", "2025-11-17", "2026-11-27"]);
}

// ---- the store: the column is added safely, written as jsonb, and read back (null on an old row) ------------------
{
  assert.ok(DDL.includes("ALTER TABLE trigger_candidates ADD COLUMN IF NOT EXISTS trend JSONB"));
  const mig = readFileSync(new URL("../../migrations/031_trigger_candidate_trend.sql", import.meta.url), "utf8");
  assert.match(mig, /ALTER TABLE trigger_candidates ADD COLUMN IF NOT EXISTS trend JSONB;/);
  const seen: { sql: string; params: unknown[] }[] = [];
  const dialect = new PgDialect();
  let rows: any[] = [];
  const db = { async execute(q: any) { seen.push(dialect.sqlToQuery(q)); return { rows, rowCount: 1 }; } };
  const store = pgTriggerStore(db);
  const RANGE: [number, number, number, number, number][] = [[100, 101, 99.5, 100.5, 60000], [100.5, 100.9, 99.2, 99.6, 40000], [99.6, 100.4, 99, 100, 30000], [100.8, 101.7, 100.7, 101.5, 80000]];
  const cand = runPass({ date: DATE, contexts: new Map([["AAA", ctx({ symbol: "AAA", sma20: 99.2, trend: up })]]), bars: new Map([["AAA", bars(RANGE)]]), watch: new Map(), regime: regime("AGGRESSIVE"), rotation: noRotation, settings, dedupe: new Dedupe(), evaluated: new Map() }).candidates[0];
  await store.insertCandidates([cand]);
  const ins = seen.find((x) => /INSERT INTO trigger_candidates/.test(x.sql))!;
  assert.match(ins.sql, /dedupe_key, rule_version, trend\) VALUES/);
  assert.match(ins.sql, /\$33, \$34::jsonb\)/, "the trend is the 34th value, sent as jsonb");
  assert.equal(JSON.parse(String(ins.params[33])).v, 1);
  assert.equal(seen.filter((x) => /ADD COLUMN IF NOT EXISTS trend/.test(x.sql)).length, 1, "ensured before the first write");
  const base = { id: 1, market_date: DATE, symbol: "AAA", side: "long", setup_key: "x", setup_owner: "builtin", owner_user_id: null, variant: "v", why: "w", trigger_at: "2026-11-24T15:00:00Z", bar: {}, entry_ref: 1, stop_level: "vwap", stop_level_price: 1, stop_price: 1, stop_gap: null, risk_pct: 1, risk_adr: 1, adr_pct: 1, levels: [], rel_volume: null, liquidity: {}, regime: {}, cap_size: null, sector: null, group_leading: false, rotation: {}, grade: "A", grade_points: 8, grade_components: {}, data_as_of: {}, facts: {}, dedupe_key: "k", rule_version: "r" };
  rows = [base];
  assert.equal((await store.listCandidates({ day: DATE, since: 0, grades: ["A"], limit: 5, viewerUserId: null }))[0].trend, null, "an old row: null");
  rows = [{ ...base, trend: { v: 1, known: true } }];
  assert.deepEqual((await store.listCandidates({ day: DATE, since: 0, grades: ["A"], limit: 5, viewerUserId: null }))[0].trend, { v: 1, known: true });
}

console.log("trend: ok");
process.exit(0);
