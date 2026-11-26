/**
 * Fixed cases: theme / sector / size moves and velocity on fixture ticks, and the sector / size history writer
 * (docs/gateway-reads.md, item 3). No database.
 */
import assert from "node:assert/strict";
import express from "express";
import { etToUtc, parseInstant, Refusal, themeMove, tradingDaysBetween, velocity, type Group, type HistorySource, type TickRow } from "./theme-history";
import { computeGroupTicks, recordGroupTicks, resetGroupTicksForTests, type GroupTickRow } from "../market-condition/engine/group-ticks";
import { gatewayReadRoutes } from "./routes";
import { near, withApp } from "./test-helpers";

const refused = async (p: Promise<unknown>, status: number, re: RegExp) => {
  try { await p; } catch (e) {
    assert.ok(e instanceof Refusal, `a Refusal, got ${e}`);
    assert.equal(e.status, status, e.message);
    assert.match(e.message, re);
    return e;
  }
  assert.fail(`expected a ${status} refusal`);
};


// ==== fixture history =============================================================================================
/** In-memory HistorySource over fixture ticks and bars. */
function historyFixture(f: { ticks?: Partial<Record<Group, TickRow[]>>; bars?: Record<string, Record<string, number>>; membership?: Record<string, Record<string, string[]>>; classes?: Partial<Record<Group, Record<string, string[]>>> }): HistorySource {
  const ticks = (g: Group) => (f.ticks?.[g] ?? []).slice().sort((a, b) => a.slotAt.getTime() - b.slotAt.getTime());
  const sessions = () => [...new Set(Object.values(f.bars ?? {}).flatMap((m) => Object.keys(m)))].sort();
  return {
    async tickRange(g) { const t = ticks(g); return t.length ? { first: t[0].slotAt, last: t[t.length - 1].slotAt } : null; },
    async slotAtOrBefore(g, t) { const xs = ticks(g).filter((r) => r.slotAt <= t); return xs.length ? xs[xs.length - 1].slotAt : null; },
    async slotAtOrAfter(g, t) { return ticks(g).find((r) => r.slotAt >= t)?.slotAt ?? null; },
    async rowsAt(g, slot) { return ticks(g).filter((r) => r.slotAt.getTime() === slot.getTime()); },
    async sessionLastRows(g, from, to) {
      const last = new Map<string, TickRow>();
      for (const r of ticks(g)) if (r.marketDate >= from && r.marketDate < to) last.set(`${r.marketDate}|${r.id}`, r);
      return [...last.values()];
    },
    async barRange() { const s = sessions(); return s.length ? { first: s[0], last: s[s.length - 1] } : null; },
    async sessionOnOrBefore(d) { const s = sessions().filter((x) => x <= d); return s.length ? s[s.length - 1] : null; },
    async members(g, date) {
      if (g !== "theme") return { groups: new Map(Object.entries(f.classes?.[g] ?? {})), asOf: "today", note: "current class" };
      const days = Object.keys(f.membership ?? {}).sort();
      const d = days.filter((x) => x <= date).pop() ?? days[0];
      return { groups: new Map(Object.entries(f.membership?.[d] ?? {})), asOf: d, note: days.filter((x) => x <= date).length ? null : `membership is stored from ${d}` };
    },
    async closes(symbols, dates) {
      const out = new Map<string, Map<string, number>>();
      for (const s of symbols) for (const d of dates) { const c = f.bars?.[s]?.[d]; if (c) (out.get(s) ?? out.set(s, new Map()).get(s)!).set(d, c); }
      return out;
    },
    async ranksOn(g, date) {
      const last = new Map<string, number>();
      for (const r of ticks(g)) if (r.marketDate === date) last.set(r.id, r.rank);
      return last;
    },
  };
}
/** A theme tick at New York wall time. spy: SPY's day % (stored as median - RS on theme rows). */
const tick = (date: string, hhmm: string, id: string, rank: number, medianPct: number, breadthPct = 50, spy = 0.5): TickRow => {
  const [h, m] = hhmm.split(":").map(Number);
  return { slotAt: etToUtc(date, h * 60 + m), marketDate: date, id, rank, medianPct, breadthPct, spyPct: spy, members: null };
};
const NOW = new Date("2026-11-26T18:00:00Z");

// ==== instants and DST ============================================================================================
{
  assert.equal(parseInstant("2026-11-02")!.at.toISOString(), "2026-11-02T21:00:00.000Z", "a date is that day's 16:00 New York close (EST)");
  assert.equal(parseInstant("2026-10-30")!.at.toISOString(), "2026-10-30T20:00:00.000Z", "the Friday before DST ended (EDT)");
  assert.equal(parseInstant("2026-11-02T10:00")!.at.toISOString(), "2026-11-02T15:00:00.000Z", "a date-time with no zone is New York time");
  assert.equal(parseInstant("2026-10-30T10:00")!.at.toISOString(), "2026-10-30T14:00:00.000Z");
  assert.equal(parseInstant("2026-11-02T15:00:00Z")!.at.toISOString(), "2026-11-02T15:00:00.000Z");
  assert.equal(parseInstant("2026-11-02T10:00-05:00")!.at.toISOString(), "2026-11-02T15:00:00.000Z");
  assert.equal(parseInstant("2026-11-02")!.dateOnly, true);
  for (const bad of ["", "yesterday", "2026-13-40", "2026-11-02T25:00", "2026-11-02 10:00"]) assert.equal(parseInstant(bad), null, `refused ${bad}`);
  assert.deepEqual(tradingDaysBetween("2026-11-25", "2026-11-30"), ["2026-11-27"], "Thanksgiving and the weekend are not sessions");
}

// ==== move between two dates (member closes) ======================================================================
{
  const src = historyFixture({
    bars: { SPY: { "2026-11-20": 600, "2026-11-24": 606 }, AAA: { "2026-11-20": 100, "2026-11-24": 110 }, BBB: { "2026-11-20": 50, "2026-11-24": 49 }, CCC: { "2026-11-20": 20, "2026-11-24": 21 }, DDD: { "2026-11-20": 10 }, XXX: { "2026-11-20": 10, "2026-11-24": 9 } },
    membership: { "2026-11-20": { SEMIS: ["AAA", "BBB", "CCC", "DDD"], ENERGY: ["XXX"] } },
    ticks: { theme: [tick("2026-11-20", "15:55", "SEMIS", 4, 1), tick("2026-11-20", "15:55", "ENERGY", 2, 2), tick("2026-11-24", "15:55", "SEMIS", 1, 2), tick("2026-11-24", "15:55", "ENERGY", 9, -1)] },
  });
  // Saturday the 22nd resolves to Friday the 20th's close; Tuesday the 24th is a session
  const m = await themeMove(src, "theme", parseInstant("2026-11-22")!, parseInstant("2026-11-24")!, { now: NOW, names: (id) => `${id} name` });
  assert.equal(m.method, "member_closes");
  assert.equal(m.from.resolved, "2026-11-20");
  assert.equal(m.from.offsetDays, 2, "how far off the nearest session is");
  assert.equal(m.to.offsetDays, 0);
  near(m.spyMovePct, 1, "SPY 600 -> 606");
  const semis = m.rows.find((r) => r.id === "SEMIS")!;
  near(semis.movePct, 5, "median of +10, -2, +5"); // AAA +10, BBB -2, CCC +5
  near(semis.vsSpyPct, 4, "relative to SPY over the same span");
  near(semis.breadthUpPct, 66.67, "two of three up");
  assert.equal(semis.members, 3, "members with both closes");
  assert.equal(semis.membersMissing, 1, "DDD has no close on the 24th");
  assert.deepEqual([semis.rankFrom, semis.rankTo, semis.rankChange], [4, 1, 3], "the engine's rank at each session's last read; > 0 climbed");
  assert.equal(semis.name, "SEMIS name");
  assert.equal(semis.rankByMove, 1);
  assert.equal(m.rows[0].id, "SEMIS", "sorted by the span's move");
  const energy = m.rows.find((r) => r.id === "ENERGY")!;
  near(energy.movePct, -10, "ENERGY");
  assert.equal(energy.rankChange, -7);
  const only = await themeMove(src, "theme", parseInstant("2026-11-20")!, parseInstant("2026-11-24")!, { now: NOW, ids: new Set(["ENERGY"]) });
  assert.deepEqual(only.rows.map((r) => r.id), ["ENERGY"], "ids= narrows");
  const e = await refused(themeMove(src, "theme", parseInstant("2026-10-01")!, parseInstant("2026-11-24")!, { now: NOW }), 422, /stored from 2026-11-20 to 2026-11-24/);
  assert.deepEqual(e.extra.available, { from: "2026-11-20", to: "2026-11-24" }, "a span outside history is refused with what is available");
  await refused(themeMove(src, "theme", parseInstant("2026-11-21")!, parseInstant("2026-11-22")!, { now: NOW }), 422, /same session \(2026-11-20\)/);
  await refused(themeMove(src, "theme", parseInstant("2026-11-24")!, parseInstant("2026-11-20")!, { now: NOW }), 400, /before/);
  await refused(themeMove(src, "theme", parseInstant("2026-11-20")!, parseInstant("2026-12-24")!, { now: NOW }), 400, /future/);
  // sectors from the tickers table's classes
  const sec = historyFixture({ bars: { SPY: { "2026-11-20": 600, "2026-11-24": 606 }, AAA: { "2026-11-20": 100, "2026-11-24": 110 }, XXX: { "2026-11-20": 10, "2026-11-24": 9 } }, classes: { sector: { Technology: ["AAA"], Energy: ["XXX"] } } });
  const s = await themeMove(sec, "sector", parseInstant("2026-11-20")!, parseInstant("2026-11-24")!, { now: NOW });
  assert.deepEqual(s.rows.map((r) => [r.id, r.movePct]), [["Technology", 10], ["Energy", -10]]);
}

// ==== move between two times (stored ticks) =======================================================================
{
  const D = "2026-11-24";
  const src = historyFixture({ ticks: { theme: [
    tick(D, "09:30", "SEMIS", 5, 0.2, 55, 0.1), tick(D, "09:30", "ENERGY", 1, 1.0, 70, 0.1),
    tick(D, "10:00", "SEMIS", 4, 0.5, 60, 0.2), tick(D, "10:00", "ENERGY", 2, 0.8, 65, 0.2),
    tick(D, "14:00", "SEMIS", 1, 2.0, 80, 0.6), tick(D, "14:00", "ENERGY", 6, -0.5, 30, 0.6),
    tick(D, "15:55", "SEMIS", 1, 2.2, 82, 0.7), tick(D, "15:55", "ENERGY", 7, -0.6, 28, 0.7),
  ] } });
  // 10:03 is between the 10:00 and 10:05 slots: the earlier read is used, and the answer says it is 3 minutes off
  const m = await themeMove(src, "theme", parseInstant(`${D}T10:03`)!, parseInstant(`${D}T14:02`)!, { now: NOW });
  assert.equal(m.method, "stored_ticks");
  assert.equal(m.from.resolved, etToUtc(D, 600).toISOString());
  assert.equal(m.from.offsetMinutes, 3);
  assert.equal(m.to.offsetMinutes, 2);
  const semis = m.rows.find((r) => r.id === "SEMIS")!;
  near(semis.movePct, (1.02 / 1.005 - 1) * 100, "within a session: (1 + m_to) / (1 + m_from)");
  near(m.spyMovePct, (1.006 / 1.002 - 1) * 100, "SPY carried the same way");
  near(semis.vsSpyPct, (1.02 / 1.005 - 1) * 100 - (1.006 / 1.002 - 1) * 100, "relative to SPY");
  assert.deepEqual([semis.rankFrom, semis.rankTo, semis.rankChange], [4, 1, 3]);
  assert.deepEqual([semis.dayBreadthFrom, semis.dayBreadthTo], [60, 80], "the day's share green at each read");
  assert.equal(m.rows[0].id, "SEMIS");
  await refused(themeMove(src, "theme", parseInstant(`${D}T10:01`)!, parseInstant(`${D}T10:04`)!, { now: NOW }), 422, /same stored read/);
  const e = await refused(themeMove(src, "theme", parseInstant(`2026-11-20T10:00`)!, parseInstant(`${D}T14:00`)!, { now: NOW }), 422, /stored from 2026-11-24 09:30 ET/);
  assert.deepEqual(e.extra.available, { from: etToUtc(D, 570).toISOString(), to: etToUtc(D, 955).toISOString() });
  await refused(themeMove(historyFixture({}), "theme", parseInstant(`${D}T10:00`)!, parseInstant(`${D}T11:00`)!, { now: NOW }), 404, /no 5-minute theme history/);
}

// ==== across sessions, and across the DST change (Sunday 1 Nov 2026) ==============================================
{
  const ticks = [
    tick("2026-10-30", "15:00", "SEMIS", 3, 1.0), tick("2026-10-30", "15:55", "SEMIS", 2, 2.0),
    tick("2026-11-02", "09:30", "SEMIS", 2, 0.5), tick("2026-11-02", "10:00", "SEMIS", 1, 1.0),
  ];
  const src = historyFixture({ ticks: { theme: ticks } });
  assert.equal(ticks[1].slotAt.toISOString(), "2026-10-30T19:55:00.000Z", "15:55 EDT");
  assert.equal(ticks[3].slotAt.toISOString(), "2026-11-02T15:00:00.000Z", "10:00 EST");
  const m = await themeMove(src, "theme", parseInstant("2026-10-30T15:00")!, parseInstant("2026-11-02T10:00")!, { now: NOW });
  near(m.rows[0].movePct, ((1.02 / 1.01) * 1.01 - 1) * 100, "chained through Friday's last read");
  assert.equal(m.from.session, "2026-10-30");
  assert.equal(m.to.session, "2026-11-02");
  // a session with no reads inside the span is refused, naming it
  const gap = historyFixture({ ticks: { theme: [tick("2026-11-23", "10:00", "SEMIS", 1, 1), tick("2026-11-25", "10:00", "SEMIS", 1, 1)] } });
  const e = await refused(themeMove(gap, "theme", parseInstant("2026-11-23T10:00")!, parseInstant("2026-11-25T10:00")!, { now: NOW }), 422, /no stored reads on 2026-11-24/);
  assert.deepEqual(e.extra.missingSessions, ["2026-11-24"]);
  // velocity at 9:00 EST on the Monday: the market is closed, the last session is Friday's (EDT) final windows
  const v = await velocity(src, "theme", 5, parseInstant("2026-11-02T09:00")!.at);
  assert.equal(v.marketOpen, false);
  assert.equal(v.session, "2026-10-30");
  assert.equal(v.end, "2026-10-30T19:55:00.000Z");
  assert.match(v.notes[0], /market closed at 2026-11-02 09:00 ET: these are the final windows of the session of 2026-10-30/);
  // and at 10:00 EST it is open, on Monday's reads
  const open = await velocity(src, "theme", 30, parseInstant("2026-11-02T10:00")!.at);
  assert.equal(open.marketOpen, true);
  assert.equal(open.session, "2026-11-02");
  assert.equal(open.minutes, 30);
  near(open.rows[0].deltaPct, (1.01 / 1.005 - 1) * 100, "Monday 9:30 -> 10:00");
}

// ==== velocity arithmetic =========================================================================================
{
  const D = "2026-11-24";
  const ticks: TickRow[] = [];
  // FAST climbs 0.1 a slot, then 0.3 a slot over the last 15 minutes; SLOW falls 0.05 a slot throughout
  const fast = [0, 0.1, 0.2, 0.3, 0.6, 0.9, 1.2];
  const slow = [1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7];
  fast.forEach((m, i) => {
    const t = `13:${String(i * 5).padStart(2, "0")}`;
    ticks.push(tick(D, t, "FAST", 10 - i, m), tick(D, t, "SLOW", 3 + (i > 3 ? 1 : 0), slow[i]), tick(D, t, "FLAT", 5, 0.4));
  });
  const src = historyFixture({ ticks: { theme: ticks } });
  const at = new Date(etToUtc(D, 13 * 60 + 32).getTime()); // 13:32, between the 13:30 read and the next
  const v = await velocity(src, "theme", 15, at, { names: (id) => id.toLowerCase() });
  assert.equal(v.marketOpen, true);
  assert.equal(v.end, etToUtc(D, 13 * 60 + 30).toISOString(), "the read at or before the time asked");
  assert.equal(v.start, etToUtc(D, 13 * 60 + 15).toISOString());
  assert.equal(v.prevStart, etToUtc(D, 13 * 60).toISOString());
  assert.equal(v.minutes, 15);
  assert.equal(v.prevMinutes, 15);
  const f = v.rows.find((r) => r.id === "FAST")!;
  const d = (1.012 / 1.003 - 1) * 100, p = (1.003 / 1.0 - 1) * 100;
  near(f.deltaPct, d, "change of the median over the window");
  near(f.perHourPct, d * 4, "per hour");
  near(f.prevPerHourPct, p * 4, "the window before");
  near(f.accelerationPerHour, d * 4 - p * 4, "acceleration = this window's rate minus the previous one's");
  assert.equal(f.rankChange, 3, "rank 7 -> 4");
  assert.equal(f.rankPerHour, 12);
  assert.equal(f.name, "fast");
  assert.deepEqual(v.rows.map((r) => r.id), ["FAST", "SLOW", "FLAT"], "sorted by absolute velocity");
  assert.deepEqual(v.up.map((r) => r.id), ["FAST"]);
  assert.deepEqual(v.down.map((r) => r.id), ["SLOW"]);
  const s = v.rows.find((r) => r.id === "SLOW")!;
  assert.equal(s.rankChange, -1);
  assert.equal((await velocity(src, "theme", 15, at, { limit: 1 })).rows.length, 1, "bounded by limit");
  // a window longer than the session so far: partial, said so
  const long = await velocity(src, "theme", 60, at);
  assert.equal(long.partial, true);
  assert.equal(long.minutes, 30);
  assert.equal(long.prevStart, null);
  assert.equal(long.rows[0].accelerationPerHour, null);
  assert.ok(long.notes.some((n) => /this window is 30 minutes, not 60/.test(n)));
  await refused(velocity(src, "theme", 7, at), 400, /window must be one of 5, 15, 30, 60/);
  await refused(velocity(src, "sector", 15, at), 404, /no 5-minute sector history is stored yet/);
  await refused(velocity(src, "theme", 15, etToUtc("2026-11-20", 600)), 422, /stored from 2026-11-24 13:00 ET/);
  // Saturday: closed, last session's final windows
  const sat = await velocity(src, "theme", 15, new Date("2026-11-28T15:00:00Z"));
  assert.equal(sat.marketOpen, false);
  assert.equal(sat.session, D);
}

// ==== sector and size history writer ==============================================================================
{
  const classes: Record<string, { sector: string | null; capSize: string | null }> = {
    A: { sector: "Technology", capSize: "MEGA" }, B: { sector: "Technology", capSize: "LARGE" }, C: { sector: "Technology", capSize: "LARGE" },
    D: { sector: "Energy", capSize: "LARGE" }, E: { sector: "Energy", capSize: "SMALL" }, F: { sector: "Energy", capSize: "MICRO" }, G: { sector: "Unknown", capSize: null },
  };
  const live = [{ symbol: "A", changePct: 3 }, { symbol: "B", changePct: 1 }, { symbol: "C", changePct: -1 }, { symbol: "D", changePct: -2 }, { symbol: "E", changePct: -1 }, { symbol: "F", changePct: 0.5 }, { symbol: "G", changePct: 9 }, { symbol: "SPY", changePct: 0.4 }, { symbol: "A", changePct: 99 }];
  const rows = computeGroupTicks(live, (s) => classes[s], 0.4);
  const tech = rows.find((r) => r.kind === "sector" && r.groupId === "Technology")!;
  assert.deepEqual([tech.medianPct, tech.members, tech.rank], [1, 3, 1]);
  near(tech.breadthPct, 66.67, "two of three green");
  assert.equal(rows.find((r) => r.groupId === "Energy")!.rank, 2);
  assert.ok(!rows.some((r) => r.groupId === "Unknown"), "no class, no group");
  assert.deepEqual(rows.filter((r) => r.kind === "size").map((r) => r.groupId), ["LARGE"], "groups under 3 names are left out");
  assert.deepEqual(rows.find((r) => r.kind === "benchmark"), { kind: "benchmark", groupId: "SPY", medianPct: 0.4, breadthPct: null, members: 1, rank: 1 });
  const wrote: GroupTickRow[][] = [];
  const store = { insertGroupTicks: async (r: GroupTickRow[]) => { wrote.push(r); return r.length; } };
  const inputs = async () => ({ live, classOf: (s: string) => classes[s], spyPct: 0.4 });
  resetGroupTicksForTests();
  assert.equal(await recordGroupTicks(store, inputs, new Date("2026-11-24T15:02:00Z")), rows.length, "10:02 ET: written");
  assert.equal(wrote[0][0].slotAt.toISOString(), "2026-11-24T15:00:00.000Z", "on the 5-minute slot");
  assert.equal(wrote[0][0].marketDate, "2026-11-24");
  assert.equal(await recordGroupTicks(store, inputs, new Date("2026-11-24T15:04:00Z")), 0, "once a slot");
  assert.equal(await recordGroupTicks(store, inputs, new Date("2026-11-24T22:00:00Z")), 0, "not after the close");
  assert.equal(await recordGroupTicks({ insertGroupTicks: async () => { throw new Error("db down"); } }, inputs, new Date("2026-11-24T15:06:00Z")), 0, "a failed write never throws");
}

// ---- over HTTP ----
{
  const D = "2026-11-24";
  const hist = historyFixture({ ticks: { theme: [tick(D, "10:00", "SEMIS", 2, 0.5), tick(D, "10:15", "SEMIS", 1, 1.0)] } });
  const app = express();
  app.use("/api/market-condition", gatewayReadRoutes({ history: () => hist, names: (id) => id, now: () => new Date("2026-11-26T15:00:00Z") }));
  const noDb = express();
  noDb.use("/api/market-condition", gatewayReadRoutes({ history: () => null, names: (id) => id }));
  await withApp(app, async (get) => {
    const mv = await get(`/api/market-condition/themes/move?from=${D}T10:00&to=${D}T10:15`);
    assert.equal(mv.status, 200);
    near(mv.body.rows[0].movePct, (1.01 / 1.005 - 1) * 100, "move over HTTP");
    assert.equal((await get(`/api/market-condition/themes/move?from=${D}T10:00`)).status, 400, "to is required");
    assert.equal((await get(`/api/market-condition/themes/move?from=${D}T10:00&to=${D}T10:15&group=industry`)).status, 400);
    const out = await get(`/api/market-condition/themes/move?from=2026-11-01T10:00&to=${D}T10:15`);
    assert.equal(out.status, 422);
    assert.ok(out.body.available.from, "the refusal names the available range");
    const vel = await get(`/api/market-condition/themes/velocity?window=15&at=${D}T10:16`);
    assert.equal(vel.status, 200);
    assert.equal(vel.body.windowMinutes, 15);
    assert.equal((await get(`/api/market-condition/themes/velocity?window=15&group=size`)).status, 404, "no size history stored: 404");
    assert.equal((await get(`/api/market-condition/themes/velocity?window=15&at=soon`)).status, 400);
  });
  await withApp(noDb, async (get) => {
    assert.equal((await get(`/api/market-condition/themes/velocity?window=15`)).status, 503);
  });
}

console.log("gateway theme history reads ok");
