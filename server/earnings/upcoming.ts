/**
 * Upcoming earnings dates that are not stale (research/fundamentals/REPORT.md).
 *
 * The old path refreshed a ticker's "next earnings" only when someone read that ticker, so most stored dates were
 * already in the past (515 of 633 when the research checked). Now a job pulls Finnhub's earnings calendar (the
 * source and key already in use) for the next 91 days, market-wide, once a day after the close, and keeps every
 * day's answer in earnings_estimates_daily (the research's table; append-only, keyed by the day it was fetched).
 * The app reads the latest day's answer through `withUpcomingEarnings`, and a "next" date that is already past is
 * never shown as upcoming, whatever its source.
 */
import { sql } from "drizzle-orm";
import { fetchEarningsCalendarStrict, type FinnhubEarningsCalendar } from "../finnhub";
import { getEtClock } from "@shared/usEquityMarketSession";

export const DDL: string[] = [
  // research/fundamentals/REPORT.md. `period` holds the report date Finnhub gives (its calendar names the fiscal
  // year and quarter, not the period end, which are kept in fiscal_year / fiscal_quarter).
  `CREATE TABLE IF NOT EXISTS earnings_estimates_daily (fetched_on DATE NOT NULL, symbol TEXT NOT NULL, period DATE NOT NULL, report_date DATE NOT NULL, hour TEXT, eps_estimate DOUBLE PRECISION, revenue_estimate DOUBLE PRECISION, eps_actual DOUBLE PRECISION, revenue_actual DOUBLE PRECISION, fiscal_year INTEGER, fiscal_quarter INTEGER, source TEXT NOT NULL DEFAULT 'finnhub_calendar', first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (fetched_on, symbol, period))`,
  `CREATE INDEX IF NOT EXISTS idx_earnings_estimates_daily_symbol ON earnings_estimates_daily (symbol, fetched_on)`,
  `CREATE INDEX IF NOT EXISTS idx_earnings_estimates_daily_report ON earnings_estimates_daily (report_date)`,
];

export const HORIZON_DAYS = 91;
const WINDOW_DAYS = 7;
const FINNHUB_CAP = 1500;

export interface Upcoming {
  symbol: string;
  date: string; // report date
  hour: string | null; // bmo | amc | dmh | null
  epsEstimate: number | null;
  revenueEstimate: number | null;
  fetchedOn: string;
}

type Exec = { execute: (q: any) => Promise<any> };
const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : r?.rows ?? []);
const affected = (r: any): number => Number(r?.rowCount ?? r?.affectedRows ?? 0);
export const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
const today = () => getEtClock().dateKey;

let ensured = false;
export async function ensureEarningsTables(db: Exec) {
  if (ensured) return;
  for (const s of DDL) await db.execute(sql.raw(s));
  ensured = true;
}

/** The calendar from `from` for HORIZON_DAYS, in week windows; a window that hits Finnhub's cap is split by day. */
export async function pullCalendar(
  from: string,
  // a failed window (403, 429 after retries, ...) throws: the job then stores nothing for the day and says why
  fetcher: (from: string, to: string) => Promise<FinnhubEarningsCalendar[]> = fetchEarningsCalendarStrict,
): Promise<{ rows: FinnhubEarningsCalendar[]; calls: number; capped: string[] }> {
  const rows: FinnhubEarningsCalendar[] = [];
  const capped: string[] = [];
  let calls = 0;
  const get = async (f: string, t: string) => { calls++; return fetcher(f, t); };
  for (let d = 0; d < HORIZON_DAYS; d += WINDOW_DAYS) {
    const f = addDays(from, d), t = addDays(from, Math.min(d + WINDOW_DAYS, HORIZON_DAYS) - 1);
    let got = await get(f, t);
    if (got.length >= FINNHUB_CAP) {
      got = [];
      for (let k = f; k <= t; k = addDays(k, 1)) {
        const day = await get(k, k);
        if (day.length >= FINNHUB_CAP) capped.push(k);
        got.push(...day);
      }
    }
    rows.push(...got);
  }
  return { rows, calls, capped };
}

/** One row per (symbol, report date) for the symbols MarketFlow follows. */
export function toRows(cal: FinnhubEarningsCalendar[], fetchedOn: string, follow: Set<string>) {
  const seen = new Set<string>();
  const out: { fetchedOn: string; symbol: string; reportDate: string; hour: string | null; epsEstimate: number | null; revenueEstimate: number | null; epsActual: number | null; revenueActual: number | null; fiscalYear: number | null; fiscalQuarter: number | null }[] = [];
  for (const c of cal) {
    const symbol = String(c.symbol ?? "").toUpperCase();
    if (!symbol || !follow.has(symbol) || !/^\d{4}-\d{2}-\d{2}$/.test(c.date ?? "") || c.date < fetchedOn) continue;
    const k = `${symbol}|${c.date}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({
      fetchedOn, symbol, reportDate: c.date, hour: c.hour ? String(c.hour) : null,
      epsEstimate: num(c.epsEstimate), revenueEstimate: num(c.revenueEstimate), epsActual: num(c.epsActual), revenueActual: num(c.revenueActual),
      fiscalYear: num(c.year), fiscalQuarter: num(c.quarter),
    });
  }
  return out;
}

// ---- the app's read: the latest day's answer, in memory ------------------------------------------------------------
let latest = new Map<string, Upcoming>();
let latestFetchedOn: string | null = null;

export function setLatestForTests(rows: Upcoming[], fetchedOn: string) {
  latest = new Map(rows.map((r) => [r.symbol, r]));
  latestFetchedOn = fetchedOn;
}
export function latestUpcoming(symbol: string): Upcoming | null {
  return latest.get(symbol.toUpperCase()) ?? null;
}
export function upcomingStatus() {
  return { fetchedOn: latestFetchedOn, symbols: latest.size };
}

/** Load the newest fetch day: for each symbol its earliest report date on or after today. */
export async function loadLatest(db: Exec): Promise<void> {
  await ensureEarningsTables(db);
  const r = rowsOf(await db.execute(sql`SELECT MAX(fetched_on)::text AS d FROM earnings_estimates_daily`));
  const d = r[0]?.d ? String(r[0].d) : null;
  if (!d) return;
  const rows = rowsOf(await db.execute(
    sql`SELECT DISTINCT ON (symbol) symbol, report_date::text AS report_date, hour, eps_estimate, revenue_estimate FROM earnings_estimates_daily WHERE fetched_on = ${d} AND report_date >= ${today()} ORDER BY symbol, report_date`,
  ));
  latest = new Map(rows.map((x) => [String(x.symbol), {
    symbol: String(x.symbol), date: String(x.report_date), hour: x.hour ?? null,
    epsEstimate: x.eps_estimate ?? null, revenueEstimate: x.revenue_estimate ?? null, fetchedOn: d,
  }]));
  latestFetchedOn = d;
}

/**
 * The upcoming-earnings fields of any earnings object, from the latest daily calendar when it has the symbol;
 * otherwise the object's own date, but never a date already past ("N/A" then). Days are counted from today (ET).
 */
export function withUpcomingEarnings<T extends { nextEarningsDate: string | null; nextEarningsDays: number; earningsTime: string | null }>(
  symbol: string,
  data: T,
  opts: { missing?: "N/A" | null; now?: string } = {},
): T {
  const now = opts.now ?? today();
  const missing = opts.missing === undefined ? "N/A" : opts.missing;
  const u = latestUpcoming(symbol);
  const days = (d: string) => Math.round((Date.parse(d + "T00:00:00Z") - Date.parse(now + "T00:00:00Z")) / 864e5);
  if (u && u.date >= now) return { ...data, nextEarningsDate: u.date, nextEarningsDays: days(u.date), earningsTime: u.hour ?? data.earningsTime };
  const own = data.nextEarningsDate;
  if (own && /^\d{4}-\d{2}-\d{2}$/.test(own)) {
    if (own < now) return { ...data, nextEarningsDate: missing, nextEarningsDays: -1 };
    return { ...data, nextEarningsDays: days(own) };
  }
  return data;
}

// ---- the job -----------------------------------------------------------------------------------------------------
export async function refreshUpcomingEarnings(
  db: Exec,
  follow: Set<string>,
  opts: { fetchedOn?: string; fetcher?: Parameters<typeof pullCalendar>[1] } = {},
): Promise<{ fetchedOn: string; calls: number; calendarRows: number; kept: number; inserted: number; capped: string[]; failed?: string }> {
  await ensureEarningsTables(db);
  const fetchedOn = opts.fetchedOn ?? today();
  let pulled: Awaited<ReturnType<typeof pullCalendar>>;
  try {
    pulled = await pullCalendar(fetchedOn, opts.fetcher);
  } catch (err) {
    console.warn(`[EarningsCalendar] ${fetchedOn}: not stored (a calendar window failed; earlier days' rows stay):`, String(err).slice(0, 200));
    return { fetchedOn, calls: 0, calendarRows: 0, kept: 0, inserted: 0, capped: [], failed: String(err).slice(0, 200) };
  }
  const { rows, calls, capped } = pulled;
  const keep = toRows(rows, fetchedOn, follow);
  let inserted = 0;
  for (let i = 0; i < keep.length; i += 300) {
    const values = keep.slice(i, i + 300).map(
      (r) => sql`(${r.fetchedOn}::date, ${r.symbol}, ${r.reportDate}::date, ${r.reportDate}::date, ${r.hour}, ${r.epsEstimate}, ${r.revenueEstimate}, ${r.epsActual}, ${r.revenueActual}, ${r.fiscalYear}, ${r.fiscalQuarter})`,
    );
    inserted += affected(await db.execute(
      sql`INSERT INTO earnings_estimates_daily (fetched_on, symbol, period, report_date, hour, eps_estimate, revenue_estimate, eps_actual, revenue_actual, fiscal_year, fiscal_quarter) VALUES ${sql.join(values, sql`, `)} ON CONFLICT (fetched_on, symbol, period) DO NOTHING`,
    ));
  }
  if (keep.length) await loadLatest(db);
  return { fetchedOn, calls, calendarRows: rows.length, kept: keep.length, inserted, capped };
}

/**
 * Earnings reaction sessions known from the daily snapshots: a report seen BEFORE its date (fetched_on < report
 * date, so it was a scheduled date, not a guess made later). bmo / dmh: that session reacts; amc: the next session;
 * no hour: both are possible and the row says so.
 */
export interface ReactionDay { symbol: string; session: string; reportDate: string; hour: string | null; hourKnown: boolean; source: string }
export function reactionSessions(
  reports: { symbol: string; reportDate: string; hour: string | null; source: string }[],
  sessions: string[],
): ReactionDay[] {
  const out: ReactionDay[] = [];
  const nextSession = (d: string, inclusive: boolean) => sessions.find((s) => (inclusive ? s >= d : s > d)) ?? null;
  for (const r of reports) {
    const h = (r.hour ?? "").toLowerCase();
    const add = (session: string | null, hourKnown: boolean) => { if (session) out.push({ symbol: r.symbol, session, reportDate: r.reportDate, hour: r.hour, hourKnown, source: r.source }); };
    if (h === "amc") add(nextSession(r.reportDate, false), true);
    else if (h === "bmo" || h === "dmh") add(nextSession(r.reportDate, true), true);
    else { add(nextSession(r.reportDate, true), false); add(nextSession(r.reportDate, false), false); }
  }
  return out;
}
