/** Fixed cases: upcoming earnings from stored rows only (docs/gateway-reads.md, item 1). No database, no vendor. */
import assert from "node:assert/strict";
import express from "express";
import { parseDays, parseSymbols, timeOfDay, upcomingForSymbols, upcomingWindow, MAX_ROWS, type CalendarRow, type EarningsSource, type TickerRow } from "./earnings";
import { gatewayReadRoutes } from "./routes";
import { withApp } from "./test-helpers";

function earningsFixture(opts: { pull?: { fetchedOn: string; pulledAt: string | null } | null; cal?: CalendarRow[]; tick?: TickerRow[]; followed?: string[] } = {}) {
  const calls: string[] = [];
  const src: EarningsSource = {
    async latestPull() { calls.push("pull"); return opts.pull === undefined ? { fetchedOn: "2026-11-25", pulledAt: "2026-11-25T23:10:00.000Z" } : opts.pull; },
    async calendarFor(_f, symbols, today) { calls.push("cal"); return (opts.cal ?? []).filter((r) => symbols.includes(r.symbol) && r.date >= today); },
    async calendarWindow(_f, from, to, min, limit) { calls.push("win"); return (opts.cal ?? []).filter((r) => r.date >= from && r.date <= to && (r.dollarVol20 ?? 0) >= min).slice(0, limit); },
    async tickerDates(symbols) { calls.push("tick"); return (opts.tick ?? []).filter((r) => symbols.includes(r.symbol)); },
    async followed(symbols) { calls.push("followed"); return new Set((opts.followed ?? []).filter((s) => symbols.includes(s))); },
  };
  return { src, calls };
}
const calRow = (symbol: string, date: string, hour: string | null, extra: Partial<CalendarRow> = {}): CalendarRow =>
  ({ symbol, date, hour, epsEstimate: 1.1, source: "finnhub_calendar", listedSince: "2026-11-02", ...extra });

{
  assert.equal(timeOfDay("bmo"), "before_open");
  assert.equal(timeOfDay("AMC"), "after_close");
  assert.equal(timeOfDay("dmh"), "during_market");
  assert.equal(timeOfDay(""), "unknown");
  assert.equal(timeOfDay(null), "unknown");
  const many = Array.from({ length: 60 }, (_, i) => `T${i}`).join(",");
  assert.equal(parseSymbols(many).symbols.length, 50, "at most 50 symbols");
  assert.equal(parseSymbols(many).dropped, 10);
  assert.deepEqual(parseSymbols(" nvda, NVDA ,brk.b,,<x>").symbols, ["NVDA", "BRK.B"], "upper-cased, de-duplicated, junk dropped");
  assert.equal(parseDays(undefined), 7);
  assert.equal(parseDays("90"), 30, "at most 30 days");
  assert.equal(parseDays("0"), 7);

  const TODAY = "2026-11-26";
  const { src, calls } = earningsFixture({
    cal: [calRow("NVDA", "2026-12-02", "amc"), calRow("CRM", "2026-12-03", "bmo", { listedSince: "2026-11-24" })],
    tick: [{ symbol: "DELL", date: "2026-12-04", time: "amc", fetchedAt: "2026-11-20T14:00:00.000Z" }, { symbol: "OLD", date: "2026-11-01", time: "bmo", fetchedAt: "2026-10-01T00:00:00.000Z" }],
    followed: ["OLD", "ZZZ"],
  });
  const a = await upcomingForSymbols(src, ["NVDA", "CRM", "DELL", "OLD", "ZZZ", "NOPE"], TODAY);
  const by = Object.fromEntries(a.rows.map((r) => [r.symbol, r]));
  assert.deepEqual(by.NVDA, { symbol: "NVDA", status: "scheduled", date: "2026-12-02", daysAway: 6, timeOfDay: "after_close", confirmed: null, listedSince: "2026-11-02", epsEstimate: 1.1, asOf: "2026-11-25", source: "finnhub_calendar" });
  assert.equal(by.CRM.timeOfDay, "before_open");
  assert.equal(by.DELL.source, "ticker_cache", "not on the calendar: the ticker's stored date");
  assert.equal(by.DELL.asOf, "2026-11-20");
  assert.equal(by.OLD.status, "unknown", "a stored date in the past is never upcoming");
  assert.match(by.OLD.reason!, /no report date in the 91 days after 2026-11-25/);
  assert.match(by.ZZZ.reason!, /no report date/);
  assert.match(by.NOPE.reason!, /does not follow NOPE/);
  assert.equal(a.calendar.fetchedOn, "2026-11-25");
  assert.equal(a.calendar.stale, false);
  assert.deepEqual(a.rows.map((r) => r.symbol), ["NVDA", "CRM", "DELL", "OLD", "ZZZ", "NOPE"], "rows in the order asked");
  assert.ok(!calls.includes("win"));

  const none = await upcomingForSymbols(earningsFixture({ pull: null }).src, ["NVDA"], TODAY);
  assert.match(none.rows[0].reason!, /no earnings calendar pull is stored yet/);
  const old = await upcomingForSymbols(earningsFixture({ pull: { fetchedOn: "2026-11-10", pulledAt: null }, cal: [calRow("NVDA", "2026-12-02", "amc")] }).src, ["NVDA"], TODAY);
  assert.equal(old.calendar.stale, true, "a pull older than 4 days is marked stale");
  assert.equal(old.rows[0].status, "scheduled", "and still served");

  const big = Array.from({ length: MAX_ROWS + 20 }, (_, i) => calRow(`S${i}`, "2026-11-30", "amc", { dollarVol20: 2e8 }));
  const w = await upcomingWindow(earningsFixture({ cal: [calRow("NVDA", "2026-12-02", "amc", { dollarVol20: 3e10 }), calRow("TINY", "2026-11-27", "bmo", { dollarVol20: 5e6 }), calRow("FAR", "2026-12-20", "amc", { dollarVol20: 5e9 }), ...big] }).src, 7, TODAY);
  assert.equal(w.window!.to, "2026-12-02");
  assert.equal(w.rows.length, MAX_ROWS, "bounded");
  assert.equal(w.window!.truncated, true);
  assert.ok(!w.rows.some((r) => r.symbol === "TINY"), "under $100M a day is not the liquid universe");
  assert.ok(!w.rows.some((r) => r.symbol === "FAR"), "outside the window");
  const w2 = await upcomingWindow(earningsFixture({ cal: [calRow("NVDA", "2026-12-02", "amc", { dollarVol20: 3.04e10 })] }).src, 7, TODAY);
  assert.equal(w2.rows[0].dollarVol20, 3.04e10);
  assert.equal(w2.window!.truncated, false);
}

// ---- over HTTP ----
{
  const { src: earn } = earningsFixture({ cal: [calRow("NVDA", "2026-12-02", "amc")], followed: [] });
  const app = express();
  app.use("/api/market-condition", gatewayReadRoutes({ earnings: () => earn, now: () => new Date("2026-11-26T15:00:00Z") }));
  const noDb = express();
  noDb.use("/api/market-condition", gatewayReadRoutes({ earnings: () => null }));
  await withApp(app, async (get) => {
    const e = await get("/api/market-condition/earnings/upcoming?symbols=NVDA,ZZZ");
    assert.equal(e.status, 200);
    assert.deepEqual(e.body.rows.map((r: any) => [r.symbol, r.status]), [["NVDA", "scheduled"], ["ZZZ", "unknown"]]);
    const many = await get(`/api/market-condition/earnings/upcoming?symbols=${Array.from({ length: 55 }, (_, i) => `Q${i}`).join(",")}`);
    assert.equal(many.body.rows.length, 50);
    assert.equal(many.body.dropped, 5);
    assert.equal((await get("/api/market-condition/earnings/upcoming?symbols=")).status, 400);
    assert.equal((await get("/api/market-condition/earnings/upcoming?days=5")).body.mode, "window");
  });
  await withApp(noDb, async (get) => {
    assert.equal((await get("/api/market-condition/earnings/upcoming?symbols=NVDA")).status, 503);
  });
}

console.log("gateway earnings read ok");
