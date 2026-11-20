/**
 * After-close scheduler for the research-backed daily setups, and the Postgres + Alpaca data source they read.
 *
 * Every 10 minutes it checks; on a weekday between 18:00 and 20:00 ET (the daily-bar cron runs at 21:30 UTC, so
 * 16:30 or 17:30 ET; night mode starts at 20:00) and when memory allows, it runs each job. A job finds the
 * sessions it has not finished and does them, so a missed evening is caught up the next one and the first run is
 * the backfill. Nothing here deletes or updates.
 */
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { fetchAlpacaMultiSymbolDailyBars } from "../alpaca";
import { getEtClock } from "@shared/usEquityMarketSession";
import { isMemoryPressureHigh, shouldRunHeavyBackgroundWork } from "../infra/memory-gate";
import { getThemesForSymbol } from "../market-condition/utils/theme-db-loader";
import { getCachedRAI } from "../market-condition/engine/rai";
import type { DBar } from "./daily-math";
import { scanLeaderShakeout, type BarSource } from "./leader-shakeout-job";
import { pgSetupStore, rowsOf, type RunRow } from "./store";
import { loadLatest, refreshUpcomingEarnings } from "../earnings/upcoming";
import { runSecJob, secEarningsReports } from "../earnings/sec";
import { pgEgInsert, pgLabels, pgReportSource, scanEarningsGapUp } from "./earnings-gap-up";

const TICK_MS = 10 * 60_000;
const WINDOW_START = 18 * 60;
const WINDOW_END = 20 * 60;
/** A bar date counts as a session once at least this many symbols have a bar on it (holidays have none). */
const MIN_SYMBOLS_PER_SESSION = 10;

type Db = NonNullable<ReturnType<typeof getDb>>;

export function pgBarSource(db: Db): BarSource {
  return {
    async sessions() {
      const r = await db.execute(sql`SELECT bar_date::text AS d FROM historical_bars GROUP BY bar_date HAVING COUNT(*) >= ${MIN_SYMBOLS_PER_SESSION} ORDER BY bar_date`);
      return rowsOf(r).map((x) => String(x.d));
    },
    async symbols() {
      const r = await db.execute(sql`SELECT DISTINCT symbol FROM historical_bars ORDER BY symbol`);
      return rowsOf(r).map((x) => String(x.symbol));
    },
    async countOn(date) {
      const r = await db.execute(sql`SELECT COUNT(*)::int AS n FROM historical_bars WHERE bar_date = ${date}`);
      return Number(rowsOf(r)[0]?.n ?? 0);
    },
    async bars(symbols, from) {
      const out = new Map<string, DBar[]>();
      if (!symbols.length) return out;
      const r = await db.execute(
        sql`SELECT symbol, bar_date::text AS d, open::float8 AS o, high::float8 AS h, low::float8 AS l, close::float8 AS c, volume::float8 AS v FROM historical_bars WHERE symbol IN (${sql.join(symbols.map((s) => sql`${s}`), sql`, `)}) AND bar_date >= ${from} ORDER BY symbol, bar_date`,
      );
      for (const x of rowsOf(r)) {
        const s = String(x.symbol);
        if (!out.has(s)) out.set(s, []);
        out.get(s)!.push({ date: String(x.d), open: Number(x.o), high: Number(x.h), low: Number(x.l), close: Number(x.c), volume: Number(x.v) });
      }
      return out;
    },
    async indexBars(from) {
      return alpacaDaily(["SPY", "QQQ", "IWM", "VIXY"], from);
    },
    themes: (symbol) => getThemesForSymbol(symbol),
    mfRegime(date) {
      const rai = getCachedRAI();
      if (!rai) return null;
      return getEtClock(new Date(rai.calculatedAt)).dateKey === date ? rai.label : null;
    },
    shouldStop: () => isMemoryPressureHigh(),
  };
}

/** Daily bars from MarketFlow's Alpaca client (split-adjusted), keyed by ET session date, oldest first. */
export async function alpacaDaily(symbols: string[], from: string, to = new Date()): Promise<Record<string, DBar[]>> {
  const m = await fetchAlpacaMultiSymbolDailyBars(symbols, new Date(from + "T00:00:00Z"), to);
  const out: Record<string, DBar[]> = {};
  for (const [s, candles] of m) {
    out[s] = candles.map((c) => ({ date: getEtClock(new Date(c.date)).dateKey, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }));
  }
  return out;
}

export interface JobStatus { lastRun: string | null; lastResult: unknown; running: boolean }
const status: Record<string, JobStatus> = {};
export function getSetupJobStatus() { return status; }

type Job = { name: string; run: (db: Db, source: RunRow["source"]) => Promise<unknown> };
/** The symbols MarketFlow follows: everything with daily bars, plus the tickers table. */
async function followed(db: Db): Promise<string[]> {
  const r = await db.execute(sql`SELECT symbol FROM (SELECT DISTINCT symbol FROM historical_bars UNION SELECT symbol FROM tickers) x ORDER BY symbol`);
  return rowsOf(r).map((x) => String(x.symbol).toUpperCase());
}
async function exists(db: Db, q: ReturnType<typeof sql>): Promise<boolean> {
  try { return rowsOf(await db.execute(q)).length > 0; } catch { return false; }
}

// In this order: the label the earnings job copies comes from the Leader Shakeout run; the earnings job reads the
// calendar and SEC rows the two jobs before it wrote.
const JOBS: Job[] = [
  {
    name: "leader_shakeout",
    run: (db, source) => scanLeaderShakeout(pgBarSource(db), pgSetupStore(db), { source, today: getEtClock().dateKey }),
  },
  {
    name: "earnings_calendar",
    async run(db) {
      const today = getEtClock().dateKey;
      if (await exists(db, sql`SELECT 1 FROM earnings_estimates_daily WHERE fetched_on = ${today}::date LIMIT 1`)) return { skipped: `already fetched ${today}` };
      return refreshUpcomingEarnings(db, new Set(await followed(db)), { fetchedOn: today });
    },
  },
  {
    name: "sec_filings",
    async run(db) {
      const today = getEtClock().dateKey;
      if (await exists(db, sql`SELECT 1 FROM sec_ticker_map WHERE snapshot_date = ${today}::date LIMIT 1`)) return { skipped: `already ran ${today}` };
      return runSecJob(db, await followed(db), { today, shouldStop: () => isMemoryPressureHigh() });
    },
  },
  {
    name: "earnings_gap_up",
    run: (db, source) => {
      const store = { ...pgSetupStore(db), insertGapUps: pgEgInsert(db), labels: (d: string[]) => pgLabels(db, d) };
      return scanEarningsGapUp(pgBarSource(db), pgReportSource(db, () => secEarningsReports(db, "2010-01-01")), store, { source, today: getEtClock().dateKey });
    },
  },
];
export function registerSetupJob(job: Job) { if (!JOBS.some((j) => j.name === job.name)) JOBS.push(job); }

export async function runSetupJob(name: string, source: RunRow["source"]): Promise<unknown> {
  const db = getDb();
  const job = JOBS.find((j) => j.name === name);
  if (!db || !job) return { error: !db ? "no database" : `no job ${name}` };
  const st = (status[name] ??= { lastRun: null, lastResult: null, running: false });
  if (st.running) return { error: "already running" };
  st.running = true;
  const t0 = Date.now();
  try {
    const r = await job.run(db, source);
    st.lastResult = r;
    console.log(`[SetupJobs] ${name} (${source}) in ${Date.now() - t0}ms:`, JSON.stringify(r).slice(0, 400));
    return r;
  } catch (err) {
    st.lastResult = { error: String(err) };
    console.error(`[SetupJobs] ${name} failed:`, err);
    return st.lastResult;
  } finally {
    st.running = false;
    st.lastRun = new Date().toISOString();
  }
}

export function inSetupWindow(now = new Date()): boolean {
  const c = getEtClock(now);
  const wd = new Date(c.dateKey + "T12:00:00Z").getUTCDay();
  return wd >= 1 && wd <= 5 && c.minuteOfDay >= WINDOW_START && c.minuteOfDay < WINDOW_END;
}

let timer: NodeJS.Timeout | null = null;
export function startSetupJobs(): void {
  if (timer) return;
  const db = getDb();
  if (db) loadLatest(db).catch((e) => console.warn("[SetupJobs] upcoming earnings load failed:", e));
  const tick = async () => {
    if (!inSetupWindow() || !shouldRunHeavyBackgroundWork()) return;
    for (const j of JOBS) {
      await runSetupJob(j.name, "daily");
    }
  };
  timer = setInterval(() => { tick().catch((e) => console.error("[SetupJobs] tick failed:", e)); }, TICK_MS);
  console.log("[SetupJobs] after-close setup jobs scheduled (weekdays 18:00-20:00 ET)");
}
