import assert from "node:assert/strict";
import { addDays, pullCalendar, reactionSessions, setLatestForTests, toRows, withUpcomingEarnings } from "./upcoming";
import { parseFacts, parseFilings, reactionSession, runSecJob, secUserAgent } from "./sec";
import { evaluateGapUp, scanEarningsGapUp, EG_RULE_VERSION, type EgRow, type ReportSource } from "../setups/earnings-gap-up";
import type { BarSource } from "../setups/leader-shakeout-job";
import type { RunRow } from "../setups/store";
import type { DBar } from "../setups/daily-math";
import type { FinnhubEarningsCalendar } from "../finnhub";

const cal = (symbol: string, date: string, hour = "amc", eps: number | null = 1.1): FinnhubEarningsCalendar =>
  ({ symbol, date, hour, epsEstimate: eps, epsActual: null, revenueEstimate: 1e9, revenueActual: null, quarter: 4, year: 2026 });

(async () => {
  // ---- the app's read: never a past "next" date -------------------------------------------------------------------
  {
    const NOW = "2026-11-20";
    setLatestForTests([{ symbol: "NVDA", date: "2026-11-25", hour: "amc", epsEstimate: 1.2, revenueEstimate: null, fetchedOn: NOW }, { symbol: "OLD", date: "2026-11-19", hour: "bmo", epsEstimate: null, revenueEstimate: null, fetchedOn: "2026-11-18" }], NOW);
    const base = { nextEarningsDate: "2026-08-20", nextEarningsDays: 12, earningsTime: "bmo" };
    assert.deepEqual(withUpcomingEarnings("nvda", base, { now: NOW }), { nextEarningsDate: "2026-11-25", nextEarningsDays: 5, earningsTime: "amc" }, "the daily calendar wins");
    assert.deepEqual(withUpcomingEarnings("AAPL", base, { now: NOW }), { nextEarningsDate: "N/A", nextEarningsDays: -1, earningsTime: "bmo" }, "a stored date in the past is not upcoming");
    assert.equal(withUpcomingEarnings("AAPL", base, { now: NOW, missing: null }).nextEarningsDate, null, "the scanner's read gets null");
    assert.deepEqual(withUpcomingEarnings("AAPL", { ...base, nextEarningsDate: "2026-12-01" }, { now: NOW }), { nextEarningsDate: "2026-12-01", nextEarningsDays: 11, earningsTime: "bmo" }, "a future stored date stays, days from today");
    assert.equal(withUpcomingEarnings("OLD", base, { now: NOW }).nextEarningsDate, "N/A", "the calendar's own date, once past, is not upcoming either");
    assert.equal(withUpcomingEarnings("AAPL", { ...base, nextEarningsDate: "N/A" }, { now: NOW }).nextEarningsDate, "N/A");
    assert.equal(withUpcomingEarnings("NVDA", base, { now: NOW }).nextEarningsDays, 5);
    assert.equal(withUpcomingEarnings("NVDA", base, { now: "2026-11-25" }).nextEarningsDays, 0, "today counts as upcoming (the report is today)");
  }

  // ---- the calendar pull: week windows, a capped window split by day --------------------------------------------
  {
    const asked: string[] = [];
    const fetcher = async (f: string, t: string) => {
      asked.push(`${f}..${t}`);
      if (f === "2026-11-27" && t === "2026-12-03") return Array.from({ length: 1500 }, (_, k) => cal(`X${k}`, "2026-12-03"));
      if (f === t && f === "2026-11-30") return [cal("NVDA", f)];
      return f === "2026-11-20" ? [cal("NVDA", "2026-11-25"), cal("NVDA", "2026-11-25"), cal("ZZZZ", "2026-11-21"), cal("AAPL", "2026-11-19")] : [];
    };
    const r = await pullCalendar("2026-11-20", fetcher);
    assert.equal(asked[0], "2026-11-20..2026-11-26");
    assert.ok(asked.includes("2026-11-30..2026-11-30"), "the capped week is re-asked day by day");
    assert.equal(asked.filter((a) => a.split("..")[0] === a.split("..")[1]).length, 7);
    assert.equal(asked[asked.length - 1].split("..")[1], addDays("2026-11-20", 90), "91 days ahead");
    const rows = toRows(r.rows, "2026-11-20", new Set(["NVDA", "AAPL"]));
    assert.deepEqual(rows.map((x) => `${x.symbol} ${x.reportDate}`), ["NVDA 2026-11-25", "NVDA 2026-11-30"], "followed symbols only, one row per date, nothing already past");
    assert.equal(rows[0].epsEstimate, 1.1);
  }

  // ---- reaction sessions --------------------------------------------------------------------------------------------
  {
    const S = ["2026-11-18", "2026-11-19", "2026-11-20", "2026-11-23"];
    const one = (hour: string | null, d = "2026-11-19") => reactionSessions([{ symbol: "A", reportDate: d, hour, source: "t" }], S).map((x) => `${x.session}${x.hourKnown ? "" : "?"}`);
    assert.deepEqual(one("bmo"), ["2026-11-19"]);
    assert.deepEqual(one("amc"), ["2026-11-20"]);
    assert.deepEqual(one("amc", "2026-11-20"), ["2026-11-23"], "Friday after the close reacts Monday");
    assert.deepEqual(one(""), ["2026-11-19?", "2026-11-20?"], "no hour: both sessions, flagged");
    // SEC acceptance time: before 16:00 ET that session, after it the next (AAPL's 16:30 ET release is 21:30Z in winter)
    assert.equal(reactionSession("2026-11-19T21:30:23.000Z", S), "2026-11-20");
    assert.equal(reactionSession("2026-11-19T12:00:00.000Z", S), "2026-11-19");
    assert.equal(reactionSession("2026-11-21T14:00:00.000Z", S), "2026-11-23", "a Saturday filing reacts on Monday");
  }

  // ---- SEC: off while SEC_USER_AGENT is empty; the parsers keep every version ---------------------------------------
  {
    assert.equal(secUserAgent({}), "");
    assert.equal(secUserAgent({ SEC_USER_AGENT: "   " }), "");
    let requests = 0, statements = 0;
    const logs: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => { logs.push(a.join(" ")); };
    const r = await runSecJob({ execute: async () => { statements++; return { rows: [] }; } }, ["AAPL"], { env: {}, get: async () => { requests++; return null; } });
    console.log = orig;
    assert.deepEqual(r, { off: true, reason: "SEC_USER_AGENT is empty" });
    assert.equal(requests, 0, "nothing is requested");
    assert.equal(statements, 0, "nothing is written, not even the tables");
    assert.ok(logs.some((l) => /SEC_USER_AGENT is empty/.test(l)), "and it says so in the log");

    const recent = { accessionNumber: ["a1", "a2", "a3"], form: ["8-K", "4", "10-Q"], filingDate: ["2026-11-02", "2026-11-03", "2026-10-31"], acceptanceDateTime: ["2026-11-02T21:30:23.000Z", "2026-11-03T22:00:00.000Z", "2026-10-31T20:00:00.000Z"], reportDate: ["2026-11-02", "", "2026-09-27"], items: ["2.02,9.01", "", ""], primaryDocument: ["x.htm", "f4.xml", "q.htm"] };
    const f = parseFilings(320193, recent);
    assert.deepEqual(f.map((x) => x.form), ["8-K", "10-Q"], "form 4 is not kept");
    assert.equal(f[0].acceptedAt, "2026-11-02T21:30:23.000Z");
    assert.equal(f[0].items, "2.02,9.01");
    const cf = { facts: { "us-gaap": { EarningsPerShareDiluted: { units: { "USD/shares": [
      { start: "2026-06-28", end: "2026-09-26", val: 1.85, accn: "a3", fy: 2026, fp: "Q4", form: "10-K", filed: "2026-10-31" },
      { start: "2026-06-28", end: "2026-09-26", val: 1.8, accn: "a9", fy: 2027, fp: "Q4", form: "10-K/A", filed: "2027-01-10" },
    ] } }, SomethingElse: { units: { USD: [{ end: "2026-09-26", val: 5, accn: "a3", filed: "2026-10-31" }] } } }, dei: { EntityCommonStockSharesOutstanding: { units: { shares: [{ end: "2026-10-15", val: 1.5e10, accn: "a3", filed: "2026-10-31" }] } } } } };
    const facts = parseFacts(320193, cf);
    assert.equal(facts.length, 3, "both versions of the EPS, the share count; not a concept outside the list");
    assert.deepEqual(facts.filter((x) => x.concept === "EarningsPerShareDiluted").map((x) => [x.value, x.filed]), [[1.85, "2026-10-31"], [1.8, "2027-01-10"]]);
    assert.equal(facts.find((x) => x.taxonomy === "dei")!.periodStart, null, "an instant fact has no start");
  }

  // ---- the setup: one hit, a near miss for each condition -----------------------------------------------------------
  const dates: string[] = [];
  for (let t = Date.parse("2026-01-05T12:00:00Z"); dates.length < 40; t += 864e5) { const wd = new Date(t).getUTCDay(); if (wd >= 1 && wd <= 5) dates.push(new Date(t).toISOString().slice(0, 10)); }
  /** 39 quiet days around $50 (ATR about 1), then the earnings day: open, close, high, low, volume multiple. */
  const bars = (o: Partial<{ open: number; close: number; high: number; low: number; vol: number; scale: number; base: number }> = {}): DBar[] => {
    const { open = 53, close = 54.5, high = 55, low = 52.5, vol = 3, scale = 1, base = 1_000_000 } = o;
    const b: DBar[] = dates.slice(0, 39).map((d, i) => { const c = 50 + (i % 2 ? 0.3 : -0.3); return { date: d, open: c, high: c + 0.5, low: c - 0.5, close: c, volume: base }; });
    b.push({ date: dates[39], open, high, low, close, volume: base * vol });
    return b.map((x) => ({ ...x, open: x.open * scale, high: x.high * scale, low: x.low * scale, close: x.close * scale, volume: x.volume / scale }));
  };
  const last = (b: DBar[]) => evaluateGapUp(b, b.length - 1)!;
  assert.deepEqual(last(bars()).failed, [], JSON.stringify(last(bars())));
  const misses: [string, Parameters<typeof bars>[0]][] = [
    ["price", { scale: 0.1 }],
    ["dollarVol", { base: 500_000 }],
    ["gapPct", { open: 50.9, close: 51.5, high: 51.6, low: 50.8 }], // 1.1 ATR but 2.4%
    ["closeAboveOpen", { open: 54.5, close: 54.4 }], // upper half, but below the open
    ["clv", { open: 53, close: 53.5, high: 56, low: 52.8 }],
    ["relVol", { vol: 1.9 }],
  ];
  for (const [cond, o] of misses) {
    assert.deepEqual(last(bars(o)).failed, [cond], `${cond}: ${JSON.stringify(last(bars(o)))}`);
  }
  {
    // the gap is 6.6% but the prior ranges are wide: ATR about 4, so under 1 ATR
    const b = bars().map((x, i) => (i < 39 ? { ...x, high: x.close + 2, low: x.close - 2 } : x));
    assert.deepEqual(last(b).failed, ["gapAtr"]);
  }

  // ---- the job: only real dates, each source on its own -----------------------------------------------------------
  {
    const b = bars();
    const runs = new Map<string, RunRow>(), hits = new Map<string, EgRow>();
    const store = {
      async doneDates(setup: string) { return new Set([...runs.values()].filter((r) => r.setup === setup).map((r) => r.marketDate)); },
      async insertRun(r: RunRow) { const k = `${r.setup}|${r.marketDate}`; if (runs.has(k)) return 0; runs.set(k, r); return 1; },
      async insertGapUps(rows: EgRow[]) { let n = 0; for (const r of rows) { const k = `${r.date}|${r.symbol}`; if (!hits.has(k)) { hits.set(k, r); n++; } } return n; },
      async labels() { return new Map([[dates[39], "UP_CALM"]]); },
    };
    const src: BarSource = {
      async sessions() { return dates; }, async symbols() { return ["EARN"]; }, async countOn() { return 1; },
      async bars(s, from) { return new Map(s.map((x) => [x, b.filter((y) => y.date >= from)])); },
      async indexBars() { return {}; }, themes: () => [], mfRegime: () => null,
    };
    // the calendar listed EARN for the last day, the evening before (bmo): a real date
    const reports = (first: string | null, rep: { symbol: string; reportDate: string; hour: string | null }[]): ReportSource => ({
      async calendarReports() { return { first, reports: rep }; }, async secReports() { return []; },
    });
    const r1 = await scanEarningsGapUp(src, reports(null, []), store);
    assert.equal(r1.finnhub_calendar, "no earnings dates from this source yet");
    assert.equal(runs.size, 0, "no run rows before there are real dates");
    const r2 = await scanEarningsGapUp(src, reports(dates[37], [{ symbol: "EARN", reportDate: dates[39], hour: "bmo" }]), store);
    assert.deepEqual(r2.finnhub_calendar, { dates: 2, reactionDays: 1, hits: 1 }, "sessions after the first fetch day only");
    assert.equal(r2.sec_8k, "no earnings dates from this source yet");
    const h = [...hits.values()][0];
    assert.equal(h.symbol, "EARN");
    assert.equal(h.dateSource, "finnhub_calendar");
    assert.equal(h.hourKnown, true);
    assert.equal(h.marketLabel, "UP_CALM", "the day's label from the Leader Shakeout run");
    assert.equal(runs.get(`earnings_gap_up:finnhub_calendar|${dates[39]}`)!.ruleVersion, EG_RULE_VERSION);
    const r3 = await scanEarningsGapUp(src, reports(dates[37], [{ symbol: "EARN", reportDate: dates[39], hour: "bmo" }]), store);
    assert.deepEqual(r3.finnhub_calendar, { dates: 0 }, "nothing twice");
  }
  console.log("earnings tests passed");
})().catch((e) => { console.error(e); process.exit(1); });
