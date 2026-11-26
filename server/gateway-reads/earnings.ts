/**
 * Upcoming earnings, read from what MarketFlow has already stored (docs/gateway-reads.md, item 1). Never calls a
 * vendor: a symbol that is not stored comes back as `unknown` with the reason.
 *
 *   GET /api/market-condition/earnings/upcoming?symbols=NVDA,AAPL      up to 50 symbols
 *   GET /api/market-condition/earnings/upcoming?days=7                  the next N days (1-30) across the liquid
 *                                                                       universe (20-day average dollar volume of
 *                                                                       at least $100M, from the stored daily bars)
 *
 * Sources, in order:
 *   1. earnings_estimates_daily: Finnhub's market-wide earnings calendar, pulled once a day after the close for the
 *      next 91 days by the setups job (server/earnings/upcoming.ts) and kept per pull day (append-only).
 *   2. tickers.next_earnings_date: the per-ticker earnings read (FMP, Finnhub when FMP had none), stored when a ticker's fundamentals were last
 *      fetched (only for symbols the newest calendar pull does not have, and only when that date is not past).
 * Finnhub's calendar does not say whether the company confirmed a date, so `confirmed` is null on every calendar row;
 * `listedSince` is the first pull that carried the same date (a date that has sat on the calendar for weeks is
 * usually the company's; one that appeared days ago may be a vendor estimate).
 */
import { sql } from "drizzle-orm";
import { getEtClock } from "@shared/usEquityMarketSession";
import { HORIZON_DAYS, addDays } from "../earnings/upcoming";

export const MAX_SYMBOLS = 50;
export const MAX_DAYS = 30;
export const DEFAULT_DAYS = 7;
export const MAX_ROWS = 300;
export const LIQUID_DOLLAR_VOL = 100e6;
/** A calendar older than this is served but marked stale. */
export const STALE_AFTER_DAYS = 4;

export type TimeOfDay = "before_open" | "after_close" | "during_market" | "unknown";

export interface EarningsRow {
  symbol: string;
  status: "scheduled" | "unknown";
  date: string | null;
  daysAway: number | null;
  timeOfDay: TimeOfDay | null;
  confirmed: boolean | null;
  listedSince: string | null;
  epsEstimate: number | null;
  asOf: string | null;
  source: "finnhub_calendar" | "ticker_cache" | null;
  dollarVol20?: number | null;
  reason?: string;
}

export interface CalendarRow { symbol: string; date: string; hour: string | null; epsEstimate: number | null; source: string; listedSince: string | null; dollarVol20?: number | null }
export interface TickerRow { symbol: string; date: string | null; time: string | null; fetchedAt: string | null }

/** Where the read comes from. The Postgres one is below; the tests use fixtures. */
export interface EarningsSource {
  /** The newest calendar pull day and when its first row was written, or null when no pull is stored. */
  latestPull(): Promise<{ fetchedOn: string; pulledAt: string | null } | null>;
  /** For each symbol, its earliest report date on or after `today` in that pull. */
  calendarFor(fetchedOn: string, symbols: string[], today: string): Promise<CalendarRow[]>;
  /** Report dates in [from, to] in that pull for symbols whose 20-day average dollar volume >= minDollarVol. */
  calendarWindow(fetchedOn: string, from: string, to: string, minDollarVol: number, limit: number): Promise<CalendarRow[]>;
  /** The tickers table's stored next date (FMP, per ticker) for these symbols. */
  tickerDates(symbols: string[]): Promise<TickerRow[]>;
  /** Which of these symbols MarketFlow follows (daily bars or a tickers row): the calendar pull keeps only those. */
  followed(symbols: string[]): Promise<Set<string>>;
}

export function parseSymbols(raw: unknown): { symbols: string[]; dropped: number } {
  const all = String(raw ?? "").split(",").map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z0-9.^=-]{1,15}$/.test(s));
  const uniq = [...new Set(all)];
  return { symbols: uniq.slice(0, MAX_SYMBOLS), dropped: Math.max(0, uniq.length - MAX_SYMBOLS) };
}

export function parseDays(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_DAYS;
  return Math.min(n, MAX_DAYS);
}

/** Finnhub's hour field: bmo / amc / dmh, else unknown. FMP's per-ticker time uses the same words. */
export function timeOfDay(hour: string | null | undefined): TimeOfDay {
  const h = String(hour ?? "").trim().toLowerCase();
  if (h === "bmo") return "before_open";
  if (h === "amc") return "after_close";
  if (h === "dmh") return "during_market";
  return "unknown";
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5);

function fromCalendar(r: CalendarRow, fetchedOn: string, today: string): EarningsRow {
  return {
    symbol: r.symbol, status: "scheduled", date: r.date, daysAway: daysBetween(today, r.date), timeOfDay: timeOfDay(r.hour),
    confirmed: null, listedSince: r.listedSince, epsEstimate: r.epsEstimate, asOf: fetchedOn,
    source: "finnhub_calendar", ...(r.dollarVol20 !== undefined ? { dollarVol20: r.dollarVol20 === null ? null : Math.round(r.dollarVol20) } : {}),
  };
}

function unknownRow(symbol: string, reason: string): EarningsRow {
  return { symbol, status: "unknown", date: null, daysAway: null, timeOfDay: null, confirmed: null, listedSince: null, epsEstimate: null, asOf: null, source: null, reason };
}

export interface EarningsAnswer {
  mode: "symbols" | "window";
  today: string;
  calendar: { fetchedOn: string | null; pulledAt: string | null; horizonDays: number; stale: boolean; source: string };
  window?: { from: string; to: string; days: number; minDollarVol: number; truncated: boolean };
  rows: EarningsRow[];
  dropped?: number;
  notes: string[];
}

const CALENDAR_SOURCE = "Finnhub earnings calendar (market-wide, pulled once a day after the close)";
const NOTES = [
  "confirmed is null: Finnhub's calendar does not say whether the company confirmed a date. listedSince is the first daily pull that carried the same date.",
  "asOf is the calendar pull day (ET) for finnhub_calendar rows, the day the ticker's fundamentals were last fetched for ticker_cache rows.",
];

/** Symbols mode. Reads only; never asks a vendor. */
export async function upcomingForSymbols(src: EarningsSource, symbols: string[], today: string): Promise<EarningsAnswer> {
  const pull = await src.latestPull();
  const stale = !!pull && daysBetween(pull.fetchedOn, today) > STALE_AFTER_DAYS;
  const cal = pull ? await src.calendarFor(pull.fetchedOn, symbols, today) : [];
  const bySym = new Map(cal.map((r) => [r.symbol.toUpperCase(), r]));
  const missing = symbols.filter((s) => !bySym.has(s));
  const tick = missing.length ? await src.tickerDates(missing) : [];
  const tickBy = new Map(tick.map((r) => [r.symbol.toUpperCase(), r]));
  const followed = missing.length ? await src.followed(missing) : new Set<string>();
  const rows = symbols.map((s): EarningsRow => {
    const c = bySym.get(s);
    if (c && pull) return fromCalendar(c, pull.fetchedOn, today);
    const t = tickBy.get(s);
    if (t?.date && /^\d{4}-\d{2}-\d{2}$/.test(t.date) && t.date >= today) {
      return {
        symbol: s, status: "scheduled", date: t.date, daysAway: daysBetween(today, t.date), timeOfDay: timeOfDay(t.time), confirmed: null,
        listedSince: null, epsEstimate: null, asOf: t.fetchedAt ? t.fetchedAt.slice(0, 10) : null, source: "ticker_cache",
        reason: pull ? `not on the calendar pulled ${pull.fetchedOn}; this is the date stored with the ticker's fundamentals (FMP, or Finnhub when FMP had none)` : "no calendar pull stored; this is the date stored with the ticker's fundamentals (FMP, or Finnhub when FMP had none)",
      };
    }
    if (!pull) return unknownRow(s, "no earnings calendar pull is stored yet, and the ticker has no stored upcoming date");
    if (!followed.has(s)) return unknownRow(s, `MarketFlow does not follow ${s} (no daily bars, no tickers row), so the calendar pull did not keep it`);
    return unknownRow(s, `no report date in the ${HORIZON_DAYS} days after ${pull.fetchedOn} on Finnhub's calendar, and no stored upcoming date`);
  });
  return {
    mode: "symbols", today,
    calendar: { fetchedOn: pull?.fetchedOn ?? null, pulledAt: pull?.pulledAt ?? null, horizonDays: HORIZON_DAYS, stale, source: CALENDAR_SOURCE },
    rows, notes: [...NOTES, ...(stale ? [`the newest calendar pull is ${pull!.fetchedOn}, more than ${STALE_AFTER_DAYS} days old`] : [])],
  };
}

/** Window mode: the next `days` days (today included) across the liquid universe. */
export async function upcomingWindow(src: EarningsSource, days: number, today: string, minDollarVol = LIQUID_DOLLAR_VOL): Promise<EarningsAnswer> {
  const pull = await src.latestPull();
  const to = addDays(today, days - 1);
  const stale = !!pull && daysBetween(pull.fetchedOn, today) > STALE_AFTER_DAYS;
  const got = pull ? await src.calendarWindow(pull.fetchedOn, today, to, minDollarVol, MAX_ROWS + 1) : [];
  const truncated = got.length > MAX_ROWS;
  return {
    mode: "window", today,
    calendar: { fetchedOn: pull?.fetchedOn ?? null, pulledAt: pull?.pulledAt ?? null, horizonDays: HORIZON_DAYS, stale, source: CALENDAR_SOURCE },
    window: { from: today, to, days, minDollarVol, truncated },
    rows: got.slice(0, MAX_ROWS).map((r) => fromCalendar(r, pull!.fetchedOn, today)),
    notes: [
      ...NOTES,
      `liquid = 20-day average dollar volume (close x volume over the last 20 stored daily bars) of at least $${minDollarVol / 1e6}M; sorted by date, then dollar volume`,
      ...(!pull ? ["no earnings calendar pull is stored yet"] : []),
      ...(stale ? [`the newest calendar pull is ${pull!.fetchedOn}, more than ${STALE_AFTER_DAYS} days old`] : []),
      ...(truncated ? [`more than ${MAX_ROWS} reports in the window: the first ${MAX_ROWS} are shown; ask fewer days`] : []),
    ],
  };
}

// ---- Postgres --------------------------------------------------------------------------------------------------
type Exec = { execute: (q: any) => Promise<any> };
const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : r?.rows ?? []);
const numOrNull = (x: unknown) => (x === null || x === undefined || !Number.isFinite(Number(x)) ? null : Number(x));
const text = (x: unknown) => (x === null || x === undefined ? null : String(x).slice(0, 10));

export function pgEarningsSource(db: Exec): EarningsSource {
  const listed = async (symbols: string[], today: string) => {
    if (!symbols.length) return new Map<string, string>();
    const r = rowsOf(await db.execute(sql`SELECT symbol, report_date::text AS d, MIN(fetched_on)::text AS f FROM earnings_estimates_daily WHERE symbol = ANY(${symbols}) AND report_date >= ${today}::date GROUP BY symbol, report_date`));
    return new Map(r.map((x) => [`${x.symbol}|${text(x.d)}`, String(text(x.f))]));
  };
  return {
    async latestPull() {
      try {
        const r = rowsOf(await db.execute(sql`SELECT MAX(fetched_on)::text AS d FROM earnings_estimates_daily`))[0];
        if (!r?.d) return null;
        const at = rowsOf(await db.execute(sql`SELECT MIN(first_seen_at) AS at FROM earnings_estimates_daily WHERE fetched_on = ${String(r.d)}::date`))[0];
        return { fetchedOn: String(r.d).slice(0, 10), pulledAt: at?.at ? new Date(at.at).toISOString() : null };
      } catch {
        return null; // the table is created by the first calendar pull
      }
    },
    async calendarFor(fetchedOn, symbols, today) {
      if (!symbols.length) return [];
      const r = rowsOf(await db.execute(sql`SELECT DISTINCT ON (symbol) symbol, report_date::text AS d, hour, eps_estimate, source FROM earnings_estimates_daily WHERE fetched_on = ${fetchedOn}::date AND symbol = ANY(${symbols}) AND report_date >= ${today}::date ORDER BY symbol, report_date`));
      const since = await listed(r.map((x) => String(x.symbol)), today);
      return r.map((x) => ({ symbol: String(x.symbol), date: String(text(x.d)), hour: x.hour ?? null, epsEstimate: numOrNull(x.eps_estimate), source: String(x.source), listedSince: since.get(`${x.symbol}|${text(x.d)}`) ?? null }));
    },
    async calendarWindow(fetchedOn, from, to, minDollarVol, limit) {
      const cutoff = addDays(from, -45);
      const r = rowsOf(await db.execute(sql`
        WITH cal AS (
          SELECT DISTINCT ON (symbol) symbol, report_date, hour, eps_estimate, source FROM earnings_estimates_daily
          WHERE fetched_on = ${fetchedOn}::date AND report_date BETWEEN ${from}::date AND ${to}::date ORDER BY symbol, report_date),
        bars AS (
          SELECT b.symbol, b.close::float8 * b.volume::float8 AS dv, ROW_NUMBER() OVER (PARTITION BY b.symbol ORDER BY b.bar_date DESC) AS rn
          FROM historical_bars b JOIN cal ON cal.symbol = b.symbol WHERE b.bar_date >= ${cutoff}::date AND b.bar_date < ${from}::date),
        liq AS (SELECT symbol, AVG(dv) AS dv FROM bars WHERE rn <= 20 GROUP BY symbol)
        SELECT cal.symbol, cal.report_date::text AS d, cal.hour, cal.eps_estimate, cal.source, liq.dv FROM cal JOIN liq ON liq.symbol = cal.symbol
        WHERE liq.dv >= ${minDollarVol} ORDER BY cal.report_date, liq.dv DESC LIMIT ${limit}`));
      const since = await listed(r.map((x) => String(x.symbol)), from);
      return r.map((x) => ({ symbol: String(x.symbol), date: String(text(x.d)), hour: x.hour ?? null, epsEstimate: numOrNull(x.eps_estimate), source: String(x.source), listedSince: since.get(`${x.symbol}|${text(x.d)}`) ?? null, dollarVol20: numOrNull(x.dv) }));
    },
    async tickerDates(symbols) {
      if (!symbols.length) return [];
      const r = rowsOf(await db.execute(sql`SELECT symbol, next_earnings_date, earnings_time, earnings_fetched_at FROM tickers WHERE symbol = ANY(${symbols})`));
      return r.map((x) => ({ symbol: String(x.symbol), date: x.next_earnings_date ? String(x.next_earnings_date) : null, time: x.earnings_time ?? null, fetchedAt: x.earnings_fetched_at ? new Date(x.earnings_fetched_at).toISOString() : null }));
    },
    async followed(symbols) {
      if (!symbols.length) return new Set();
      const r = rowsOf(await db.execute(sql`SELECT symbol FROM tickers WHERE symbol = ANY(${symbols}) UNION SELECT DISTINCT symbol FROM historical_bars WHERE symbol = ANY(${symbols}) AND bar_date >= ${addDays(getEtClock().dateKey, -14)}::date`));
      return new Set(r.map((x) => String(x.symbol).toUpperCase()));
    },
  };
}
