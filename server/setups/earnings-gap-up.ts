/**
 * Earnings gap up that holds, on real earnings dates (research/bounce/earnings_split.cjs, "Earnings gap up that
 * holds (SEC dates)"; card research/cards/setups/earnings-gap-up-that-holds.md):
 *   on the first session that could react to an earnings release,
 *   open >= 1 x ATR14_prev above the prior close, and open / prev_close - 1 >= 3%,
 *   close > open, close in the upper half of the day's range (CLV >= 0.5),
 *   volume >= 2 x the prior 20-day average; liquid floor price >= $6, prior 20-day dollar volume >= $30M.
 *
 * Earnings dates come from two sources, each scanned on its own (setup_scan_runs keeps one run per source, so a
 * source switched on later, like SEC, still gets its history scanned):
 *   sec_8k            8-K item 2.02 acceptance time (before 16:00 ET on a session = that session, else the next)
 *   finnhub_calendar  a date MarketFlow's daily calendar listed BEFORE it happened (bmo/dmh = that session, amc =
 *                     the next; no hour = both, flagged hour_known = false). History starts the first day the
 *                     calendar job ran.
 * Hits: setup_earnings_gap_up, append-only, one row per (session, symbol) whichever source found it first.
 */
import { sql } from "drizzle-orm";
import { atrPrev, contiguous, looksLikeSplit, trueRanges, volumePrev, type DBar } from "./daily-math";
import { reactionSessions } from "../earnings/upcoming";
import { reactionSession } from "../earnings/sec";
import type { BarSource } from "./leader-shakeout-job";
import type { RunRow, SetupStore } from "./store";

export const EG_RULE_VERSION = "A6-real-2026-11-20";
export const EG = { minGapAtr: 1, minGapPct: 0.03, minClv: 0.5, minRelVol: 2, minPrice: 6, minDollarVol: 30e6 } as const;
export const EG_SETUP = "earnings_gap_up";
const LOOKBACK = 21;

export type EgCondition = "price" | "dollarVol" | "gapAtr" | "gapPct" | "closeAboveOpen" | "clv" | "relVol";
export interface EgNumbers {
  date: string; open: number; high: number; low: number; close: number; prevClose: number; volume: number;
  gapPct: number; gapAtr: number; atr14Prev: number; clv: number; relVol: number; avgVol20Prev: number;
  dollarVol20Prev: number; dayChangePct: number;
}

export function evaluateGapUp(b: DBar[], i: number, tr = trueRanges(b)): (EgNumbers & { hit: boolean; failed: EgCondition[] }) | null {
  if (i < LOOKBACK || i >= b.length) return null;
  const t = b[i], prev = b[i - 1].close, atr = atrPrev(tr, i);
  const { avgVol, dollarVol } = volumePrev(b, i);
  if (!(atr > 0) || !(avgVol > 0) || !(prev > 0)) return null;
  const rng = t.high - t.low;
  const n: EgNumbers = {
    date: t.date, open: t.open, high: t.high, low: t.low, close: t.close, prevClose: prev, volume: t.volume,
    gapPct: t.open / prev - 1, gapAtr: (t.open - prev) / atr, atr14Prev: atr,
    clv: rng > 0 ? (t.close - t.low) / rng : 0.5, relVol: t.volume / avgVol, avgVol20Prev: avgVol,
    dollarVol20Prev: dollarVol, dayChangePct: t.close / prev - 1,
  };
  const failed: EgCondition[] = [];
  if (!(n.close >= EG.minPrice)) failed.push("price");
  if (!(n.dollarVol20Prev >= EG.minDollarVol)) failed.push("dollarVol");
  if (!(n.gapAtr >= EG.minGapAtr)) failed.push("gapAtr");
  if (!(n.gapPct >= EG.minGapPct)) failed.push("gapPct");
  if (!(n.close > n.open)) failed.push("closeAboveOpen");
  if (!(n.clv >= EG.minClv)) failed.push("clv");
  if (!(n.relVol >= EG.minRelVol)) failed.push("relVol");
  return { ...n, hit: failed.length === 0, failed };
}

export const DDL = [
  `CREATE TABLE IF NOT EXISTS setup_earnings_gap_up (id SERIAL PRIMARY KEY, rule_version TEXT NOT NULL, market_date TEXT NOT NULL, symbol TEXT NOT NULL, report_date TEXT, report_hour TEXT, hour_known BOOLEAN NOT NULL, date_source TEXT NOT NULL, open DOUBLE PRECISION NOT NULL, high DOUBLE PRECISION NOT NULL, low DOUBLE PRECISION NOT NULL, close DOUBLE PRECISION NOT NULL, prev_close DOUBLE PRECISION NOT NULL, volume DOUBLE PRECISION NOT NULL, gap_pct DOUBLE PRECISION NOT NULL, gap_atr DOUBLE PRECISION NOT NULL, atr14_prev DOUBLE PRECISION NOT NULL, clv DOUBLE PRECISION NOT NULL, rel_volume DOUBLE PRECISION NOT NULL, avg_vol20_prev DOUBLE PRECISION NOT NULL, dollar_vol20_prev DOUBLE PRECISION NOT NULL, day_change_pct DOUBLE PRECISION NOT NULL, themes JSONB NOT NULL DEFAULT '[]'::jsonb, themes_as_of TEXT, market_label TEXT, source TEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT NOW(), UNIQUE (rule_version, market_date, symbol))`,
  `CREATE INDEX IF NOT EXISTS idx_setup_earnings_gap_up_date ON setup_earnings_gap_up (market_date)`,
];

export interface EgRow extends EgNumbers {
  symbol: string; reportDate: string | null; reportHour: string | null; hourKnown: boolean; dateSource: string;
  themes: { id: string; name: string }[]; themesAsOf: string | null; marketLabel: string | null; source: RunRow["source"];
}
export interface EgStore extends Pick<SetupStore, "doneDates" | "insertRun"> {
  insertGapUps(rows: EgRow[]): Promise<number>;
  /** That day's market label from the Leader Shakeout run (it has the breadth this job does not compute). */
  labels(dates: string[]): Promise<Map<string, string>>;
}

type Exec = { execute: (q: any) => Promise<any> };
const affected = (r: any): number => Number(r?.rowCount ?? r?.affectedRows ?? 0);
const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : r?.rows ?? []);
let ensured = false;
export async function ensureEgTables(db: Exec) { if (ensured) return; for (const s of DDL) await db.execute(sql.raw(s)); ensured = true; }

export async function pgLabels(db: Exec, dates: string[]): Promise<Map<string, string>> {
  if (!dates.length) return new Map();
  const r = await db.execute(sql`SELECT market_date, market_label FROM setup_scan_runs WHERE setup = 'leader_shakeout' AND market_date IN (${sql.join(dates.map((d) => sql`${d}`), sql`, `)}) AND market_label IS NOT NULL`);
  return new Map(rowsOf(r).map((x) => [String(x.market_date), String(x.market_label)]));
}

export function pgEgInsert(db: Exec) {
  return async (rows: EgRow[]) => {
    if (!rows.length) return 0;
    await ensureEgTables(db);
    const v = rows.map((r) => sql`(${EG_RULE_VERSION}, ${r.date}, ${r.symbol}, ${r.reportDate}, ${r.reportHour}, ${r.hourKnown}, ${r.dateSource}, ${r.open}, ${r.high}, ${r.low}, ${r.close}, ${r.prevClose}, ${r.volume}, ${r.gapPct}, ${r.gapAtr}, ${r.atr14Prev}, ${r.clv}, ${r.relVol}, ${r.avgVol20Prev}, ${r.dollarVol20Prev}, ${r.dayChangePct}, ${JSON.stringify(r.themes)}::jsonb, ${r.themesAsOf}, ${r.marketLabel}, ${r.source})`);
    return affected(await db.execute(sql`INSERT INTO setup_earnings_gap_up (rule_version, market_date, symbol, report_date, report_hour, hour_known, date_source, open, high, low, close, prev_close, volume, gap_pct, gap_atr, atr14_prev, clv, rel_volume, avg_vol20_prev, dollar_vol20_prev, day_change_pct, themes, themes_as_of, market_label, source) VALUES ${sql.join(v, sql`, `)} ON CONFLICT (rule_version, market_date, symbol) DO NOTHING`));
  };
}

export interface ReportSource {
  /** Finnhub calendar dates as listed by the latest snapshot fetched before each date, and the first fetch day. */
  calendarReports(): Promise<{ first: string | null; reports: { symbol: string; reportDate: string; hour: string | null }[] }>;
  /** 8-K item 2.02 filings (empty while the SEC job is off). */
  secReports(): Promise<{ symbol: string; acceptedAt: string }[]>;
}

export function pgReportSource(db: Exec, secReports: () => Promise<{ symbol: string; acceptedAt: string }[]>): ReportSource {
  return {
    async calendarReports() {
      try {
        const first = rowsOf(await db.execute(sql`SELECT MIN(fetched_on)::text AS d FROM earnings_estimates_daily`))[0]?.d ?? null;
        const r = await db.execute(sql`SELECT e.symbol, e.report_date::text AS report_date, e.hour FROM earnings_estimates_daily e WHERE e.fetched_on = (SELECT MAX(e2.fetched_on) FROM earnings_estimates_daily e2 WHERE e2.symbol = e.symbol AND e2.fetched_on < e.report_date)`);
        return { first, reports: rowsOf(r).map((x) => ({ symbol: String(x.symbol), reportDate: String(x.report_date), hour: x.hour ?? null })) };
      } catch {
        return { first: null, reports: [] };
      }
    },
    secReports,
  };
}

/** For each date source: find its reaction sessions not yet scanned and test the rule on them. */
export async function scanEarningsGapUp(
  src: BarSource,
  reports: ReportSource,
  store: EgStore,
  opts: { source?: RunRow["source"]; today?: string } = {},
): Promise<Record<string, unknown>> {
  const sessions = await src.sessions();
  const out: Record<string, unknown> = {};
  if (sessions.length <= LOOKBACK) return out;
  const last = sessions[sessions.length - 1];
  let lastReady = true;
  {
    const [a, b] = [await src.countOn(last), await src.countOn(sessions[sessions.length - 2])];
    if (a < 0.9 * b) { lastReady = false; out.waiting = `${last}: bars for ${a} of ${b} symbols so far`; }
  }
  const cal = await reports.calendarReports();
  const sec = await reports.secReports();
  const sources: { name: string; from: string | null; days: { symbol: string; session: string; reportDate: string | null; hour: string | null; hourKnown: boolean }[] }[] = [
    { name: "sec_8k", from: sec.length ? sessions[LOOKBACK] : null, days: sec.map((r) => ({ symbol: r.symbol.toUpperCase(), session: reactionSession(r.acceptedAt, sessions) ?? "", reportDate: r.acceptedAt.slice(0, 10), hour: null, hourKnown: true })) },
    // the calendar is only a real date source from the day after its first fetch
    { name: "finnhub_calendar", from: cal.first ? sessions.find((s) => s > cal.first!) ?? null : null, days: reactionSessions(cal.reports.map((r) => ({ ...r, source: "finnhub_calendar" })), sessions) },
  ];
  const sessionIndex = new Map(sessions.map((d, k) => [d, k]));

  for (const s of sources) {
    const setup = `${EG_SETUP}:${s.name}`;
    if (!s.from) { out[s.name] = "no earnings dates from this source yet"; continue; }
    const done = await store.doneDates(setup, EG_RULE_VERSION);
    const todo = sessions.filter((d) => d >= s.from! && sessionIndex.get(d)! >= LOOKBACK && !done.has(d) && (lastReady || d !== last));
    if (!todo.length) { out[s.name] = { dates: 0 }; continue; }
    const want = new Set(todo);
    const bySym = new Map<string, typeof s.days>();
    for (const d of s.days) if (want.has(d.session)) bySym.set(d.symbol, [...(bySym.get(d.symbol) ?? []), d]);
    const from = sessions[Math.max(0, sessionIndex.get(todo[0])! - LOOKBACK - 5)];
    const hits: Omit<EgRow, "marketLabel" | "source">[] = [];
    const tested = new Map<string, number>();
    const syms = [...bySym.keys()];
    for (let k = 0; k < syms.length; k += 150) {
      if (src.shouldStop?.()) { out.stopped = true; return out; }
      const bars = await src.bars(syms.slice(k, k + 150), from);
      for (const [sym, b] of bars) {
        const tr = trueRanges(b);
        const pos = new Map(b.map((x, i) => [x.date, i]));
        const seen = new Set<string>();
        for (const day of bySym.get(sym.toUpperCase()) ?? []) {
          const i = pos.get(day.session);
          if (i === undefined || seen.has(day.session)) continue;
          seen.add(day.session);
          if (!contiguous(b, i, LOOKBACK, sessionIndex) || looksLikeSplit(b[i - 1].close, b[i].open, b[i].close)) continue;
          tested.set(day.session, (tested.get(day.session) ?? 0) + 1);
          const r = evaluateGapUp(b, i, tr);
          if (!r?.hit) continue;
          const { hit: _h, failed: _f, ...n } = r;
          hits.push({ ...n, symbol: sym.toUpperCase(), reportDate: day.reportDate, reportHour: day.hour, hourKnown: day.hourKnown, dateSource: s.name, themes: src.themes(sym), themesAsOf: opts.today ?? null });
        }
      }
    }
    const labels = await store.labels(todo).catch(() => new Map<string, string>());
    let inserted = 0;
    for (const d of todo) {
      const source: RunRow["source"] = (opts.source ?? "daily") === "daily" && d !== last ? "backfill" : opts.source ?? "daily";
      const lab = labels.get(d) ?? null;
      const dayHits = hits.filter((h) => h.date === d).map((h) => ({ ...h, marketLabel: lab, source }));
      inserted += await store.insertGapUps(dayHits);
      await store.insertRun({ setup, ruleVersion: EG_RULE_VERSION, marketDate: d, symbolsScanned: tested.get(d) ?? 0, hits: dayHits.length, skipped: {}, marketLabel: lab, marketInputs: null, source });
    }
    out[s.name] = { dates: todo.length, reactionDays: s.days.filter((x) => want.has(x.session)).length, hits: inserted };
  }
  return out;
}
