/**
 * Automated Daily Bar Refresh
 *
 * Ensures historical_bars stays current. Runs:
 *   1. On server startup (if bars are stale or missing)
 *   2. On a scheduled timer (every 30 minutes; fetches only what is behind the last finished session)
 *
 * Smart refresh: only fetches symbols that are actually stale or missing,
 * not the entire universe. Respects a memory gate to avoid OOM during
 * concurrent MC snapshot polling.
 *
 * Universe: static theme lists + the tickers table - retired file (bar-universe.ts). It used to be the static
 * lists only, which left every tickers-table-only name (about 430) without a bar since March.
 * Stale = newest bar older than the last finished session. Stalest names go first, so a run cut short by the
 * memory gate or night mode still moves on, and a retry follows in 30 minutes instead of 6 hours.
 */

import { getDb } from "../db";
import { historicalBars, tickerMa } from "@shared/schema";
import { sql } from "drizzle-orm";
import { fetchAlpacaMultiSymbolDailyBars } from "../alpaca";
import { getAllUniverseTickers } from "../market-condition/universe";
import { expectedLastSession, loadBarUniverse, loadNewestBars, loadThemeUniverse, splitStale } from "./bar-universe";
import { guardState, guardTrippedToday, lockHolder, logPhase, overLimit, tryAcquire, withJobLock } from "../infra/job-guard";
import { isMemoryPressureHigh, isNightMode } from "../infra/memory-gate";
import { getEtClock, getUsEquityMarketSession } from "@shared/usEquityMarketSession";

const REFRESH_LOOKBACK_DAYS = 10;

/** True only while a manually started cycle runs: night mode (8pm-4am ET, weekends) is ignored for that one run. */
let manualRun = false;
const nightNow = () => !manualRun && isNightMode();
const BATCH_SIZE = 100;
const BATCH_PAUSE_MS = 1000;
const UPSERT_CHUNK = 500;

/** Pure: split rows into chunks of at most `n`. */
export function chunkRows<T>(rows: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += n) out.push(rows.slice(i, i + n));
  return out;
}
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

let lastRefreshAttempt: Date | null = null;
let lastRefreshSuccess: Date | null = null;
let apiKeyBroken = false;
let refreshInProgress = false;
let lastRun: {
  at: string; expectedSession: string; universe: number; stale: number; withBars: number;
  noBars: number; noBarsSample: string[]; needsBackfill: number; complete: boolean;
} | null = null;
const loggedToday = new Map<string, string>();

/** Log a line at most once per day per key (night-mode and all-fresh lines used to repeat on every check). */
function logOncePerDay(key: string, line: string): void {
  const day = new Date().toISOString().slice(0, 10);
  if (loggedToday.get(key) === day) return;
  loggedToday.set(key, day);
  console.log(line);
}

export function isDailyBarApiHealthy(): boolean {
  return !apiKeyBroken;
}

export function getDailyBarRefreshStatus() {
  return {
    lastAttempt: lastRefreshAttempt?.toISOString() ?? null,
    lastSuccess: lastRefreshSuccess?.toISOString() ?? null,
    apiKeyBroken,
    refreshInProgress,
    lastRun,
  };
}

/**
 * Identify which universe symbols have stale or missing bars (older than the last finished session).
 * Stalest first.
 */
async function getStaleSymbols(): Promise<{ staleSymbols: string[]; freshCount: number; expected: string; newest: Map<string, string> }> {
  const expected = expectedLastSession();
  const db = getDb();
  if (!db) return { staleSymbols: [], freshCount: 0, expected, newest: new Map() };
  try {
    const universe = await loadBarUniverse(db, getAllUniverseTickers());
    const newest = await loadNewestBars(db);
    const { stale, fresh } = splitStale(universe, newest, expected);
    return { staleSymbols: stale, freshCount: fresh.length, expected, newest };
  } catch (err) {
    console.warn("[DailyBarRefresh] getStaleSymbols error:", err);
    return { staleSymbols: [], freshCount: 0, expected, newest: new Map() };
  }
}

/** The end-of-day summary the screen route (R7) serves from: built once a day, after the bars are in. Never throws. */
async function summaryIfDue(expected: string): Promise<void> {
  try {
    const db = getDb();
    if (!db || nightNow() || isMemoryPressureHigh()) return;
    const { ensureDailySummary } = await import("../market-condition/daily-summary");
    logPhase("DailySummary", "check start");
    const built = await ensureDailySummary(db, expected, await loadBarUniverse(db, getAllUniverseTickers()), {
      shouldStop: () => isMemoryPressureHigh() || overLimit("DailySummary", "summary build"),
    });
    logPhase("DailySummary", built ? `build end (${built.summarized} rows)` : "up to date");
  } catch (err) {
    console.warn("[DailyBarRefresh] daily summary failed (non-fatal):", String(err).slice(0, 160));
  }
}

/**
 * True when this check did not finish the stale list (deferred, cut short, or failed): the scheduler retries soon.
 * One data job at a time (job-guard.ts): a check that finds another running (a pool refresh, the backfill) is skipped and logged.
 * After the memory guard has stopped a job today, nothing restarts until tomorrow.
 */
export async function checkAndRefreshDailyBars(): Promise<boolean> {
  if (refreshInProgress) return false;
  if (guardTrippedToday()) {
    logOncePerDay("guard", `[DailyBarRefresh] The memory guard stopped a data job today (${guardState()?.where}, rss ${guardState()?.rssMb} MB): bars wait until tomorrow.`);
    return false;
  }
  const ran = await withJobLock("daily bar job", runCheck, getDb());
  return ran.skipped ? true : ran.value;
}

async function runCheck(): Promise<boolean> {

  if (nightNow()) {
    logOncePerDay("night", "[DailyBarRefresh] Night mode (8pm-4am ET, weekends) - bars wait for the next check.");
    return false;
  }

  if (nightNow() || isMemoryPressureHigh()) {
    logOncePerDay(`pressure-${new Date().getHours()}`, "[DailyBarRefresh] Memory pressure high - deferring refresh, retry in 30 min.");
    return true;
  }

  const { staleSymbols, freshCount, expected, newest } = await getStaleSymbols();
  const total = staleSymbols.length + freshCount;

  if (staleSymbols.length === 0) {
    // Mark healthy so server-status is not stuck on lastSuccess=null forever.
    lastRefreshAttempt = new Date();
    lastRefreshSuccess = lastRefreshAttempt;
    logOncePerDay(`fresh-${expected}`, `[DailyBarRefresh] All ${total} symbols have the ${expected} bar. No refresh needed.`);
    await summaryIfDue(expected);
    return false;
  }

  console.log(`[DailyBarRefresh] ${staleSymbols.length}/${total} symbols are behind ${expected} (${freshCount} fresh). Starting smart refresh...`);
  logPhase("DailyBarRefresh", "refresh start");
  const incomplete = await refreshDailyBars(staleSymbols, expected, total, newest);
  if (!incomplete) await summaryIfDue(expected);
  return incomplete;
}

async function refreshDailyBars(symbols: string[], expected: string, universeSize: number, newest: Map<string, string>): Promise<boolean> {
  const db = getDb();
  if (!db) {
    console.warn("[DailyBarRefresh] No database available.");
    return false;
  }

  refreshInProgress = true;
  lastRefreshAttempt = new Date();

  if (symbols.length === 0) {
    console.log("[DailyBarRefresh] No symbols to refresh.");
    refreshInProgress = false;
    return false;
  }

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - REFRESH_LOOKBACK_DAYS);

  let totalUpserted = 0;
  let totalFailed = 0;
  let memorySkipped = 0;
  let processed = 0;
  let withBars = 0;
  let stoppedByGuard = false;
  const noBarsList: string[] = [];
  const now0 = new Date();
  const currentEtDate = getEtClock(now0).dateKey;
  const currentSession = getUsEquityMarketSession(now0);

  // One multi-symbol vendor call per BATCH_SIZE names (about 16 calls for 1,550 names, was one per name).
  // Memory: one batch of 100 names x about 7 bars at a time.
  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    // Abort remaining work if night mode starts mid-run or RSS/heap pressure persists.
    if (nightNow()) {
      console.warn("[DailyBarRefresh] Night mode started mid-run - stopping remaining batches.");
      break;
    }
    if (isMemoryPressureHigh()) {
      memorySkipped++;
      if (memorySkipped <= 3) {
        console.warn(`[DailyBarRefresh] Memory pressure high (heap or RSS) - pausing 10s (batch ${Math.floor(i / BATCH_SIZE) + 1})`);
      }
      await new Promise((r) => setTimeout(r, 10_000));
      if (isMemoryPressureHigh() || nightNow()) {
        console.warn("[DailyBarRefresh] Still under pressure / night mode - stopping remaining batches.");
        break;
      }
    }

    const batch = symbols.slice(i, i + BATCH_SIZE);
    let fetched: Awaited<ReturnType<typeof fetchAlpacaMultiSymbolDailyBars>>;
    try {
      fetched = await fetchAlpacaMultiSymbolDailyBars(batch, startDate, endDate, { throwOnError: true });
    } catch (err: any) {
      const msg = String(err?.message ?? "");
      if (msg.includes("401")) {
        console.error(`[DailyBarRefresh] CRITICAL: Alpaca API key is INVALID (401). Cannot refresh bars.`);
        apiKeyBroken = true;
        refreshInProgress = false;
        return false;
      }
      totalFailed += batch.length; // this batch is retried at the next check (its names are still stale)
      processed = i + batch.length;
      console.warn(`[DailyBarRefresh] batch ${Math.floor(i / BATCH_SIZE) + 1} failed: ${msg.slice(0, 120)}`);
      await new Promise((r) => setTimeout(r, BATCH_PAUSE_MS));
      continue;
    }
    processed = i + batch.length;

    // One statement per chunk of rows for the whole batch (about 700 rows), not one per name: fewer round trips, and
    // nothing from the batch is kept once it is written.
    const batchRows: { symbol: string; barDate: string; open: string; high: string; low: string; close: string; volume: number }[] = [];
    const namesWithRows = new Set<string>();
    for (const symbol of batch) {
      const bars = fetched.get(symbol.toUpperCase()) ?? [];
      if (bars.length === 0) {
        noBarsList.push(symbol);
        continue;
      }
      for (const bar of bars) {
        const barDate = getEtClock(new Date(bar.date)).dateKey;
        // today's bar is not final while the session is open
        if (barDate === currentEtDate && (currentSession === "pre_market" || currentSession === "regular")) continue;
        batchRows.push({
          symbol: symbol.toUpperCase(),
          barDate,
          open: bar.open.toString(),
          high: bar.high.toString(),
          low: bar.low.toString(),
          close: bar.close.toString(),
          volume: bar.volume,
        });
        namesWithRows.add(symbol.toUpperCase());
      }
    }
    fetched = undefined as any; // the vendor answer is not needed past this point
    for (const chunk of chunkRows(batchRows, UPSERT_CHUNK)) {
      try {
        await db.insert(historicalBars).values(chunk).onConflictDoUpdate({
          target: [historicalBars.symbol, historicalBars.barDate],
          set: {
            open: sql`excluded.open`,
            high: sql`excluded.high`,
            low: sql`excluded.low`,
            close: sql`excluded.close`,
            volume: sql`excluded.volume`,
          },
        });
        totalUpserted += chunk.length;
      } catch (err) {
        totalFailed += new Set(chunk.map((r) => r.symbol)).size;
        console.warn("[DailyBarRefresh] batch write failed:", String(err).slice(0, 120));
      }
    }
    withBars += namesWithRows.size;

    const batchNo = Math.floor(i / BATCH_SIZE) + 1;
    logPhase("DailyBarRefresh", `batch ${batchNo}/${Math.ceil(symbols.length / BATCH_SIZE)} (${processed}/${symbols.length} names, ${totalUpserted} bars)`);
    if (overLimit("DailyBarRefresh", `batch ${batchNo}, name ${processed} of ${symbols.length}`)) {
      stoppedByGuard = true;
      break;
    }

    // Rate limit: pause between batches
    if (i + BATCH_SIZE < symbols.length) await new Promise((r) => setTimeout(r, BATCH_PAUSE_MS));

  }

  const complete = processed >= symbols.length;
  const doneSymbols = symbols.slice(0, processed);
  const cutoff = new Date(`${expected}T12:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - REFRESH_LOOKBACK_DAYS);
  const cutoffKey = cutoff.toISOString().slice(0, 10);
  // A name whose newest bar is older than the lookback window leaves a hole this job does not fill: the backfill tool does.
  const needsBackfill = symbols.filter((sym) => (newest.get(sym) ?? "") < cutoffKey).length;
  lastRun = {
    at: new Date().toISOString(),
    expectedSession: expected,
    universe: universeSize,
    stale: symbols.length,
    withBars,
    noBars: noBarsList.length,
    noBarsSample: noBarsList.slice(0, 40),
    needsBackfill,
    complete,
  };
  if (noBarsList.length > 0) {
    console.warn(`[DailyBarRefresh] ${noBarsList.length} symbol(s) returned no bars: ${noBarsList.slice(0, 40).join(", ")}${noBarsList.length > 40 ? " ..." : ""}`);
  }
  if (needsBackfill > 0) {
    console.warn(`[DailyBarRefresh] ${needsBackfill} symbol(s) are more than ${REFRESH_LOOKBACK_DAYS} days behind: run the backfill (server/scripts/backfillMissingBars.ts).`);
  }

  try {
    if (totalUpserted > 0) {
      apiKeyBroken = false;
      lastRefreshSuccess = new Date();
      console.log(
        `[DailyBarRefresh] ✅ Refreshed ${totalUpserted} bars for ${symbols.length} symbols ` +
          `(${totalFailed} failed${memorySkipped > 0 ? `, ${memorySkipped} batches deferred for memory` : ""}). ` +
          `Now recalculating MAs...`
      );
      if (!nightNow() && !isMemoryPressureHigh() && !stoppedByGuard) {
        // ticker_ma serves the theme readings; scan-pool-only names have no use for it (R7 has its own summary)
        const themeSet = new Set(await loadThemeUniverse(db, getAllUniverseTickers()));
        logPhase("DailyBarRefresh", "MA phase start");
        await recalculateTickerMAs(db, doneSymbols.filter((s) => themeSet.has(s.toUpperCase())));
        logPhase("DailyBarRefresh", "MA phase end");
      } else {
        console.warn("[DailyBarRefresh] Skipping MA recalculation — night mode or memory pressure.");
      }
    } else if (totalFailed > 0) {
      console.warn(`[DailyBarRefresh] ⚠️ All ${totalFailed} symbols failed (or deferred). Not marking API key broken.`);
    }
  } finally {
    refreshInProgress = false;
  }
  logPhase("DailyBarRefresh", `refresh end (${complete ? "complete" : stoppedByGuard ? "stopped by the memory guard" : "incomplete"})`);
  return !complete;
}

function calculateSMA(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const sum = closes.slice(0, period).reduce((a, b) => a + b, 0);
  return sum / period;
}

function calculateEMA(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let ema = closes.slice(closes.length - period).reduce((a, b) => a + b, 0) / period;
  for (let i = closes.length - period - 1; i >= 0; i--) {
    ema = closes[i]! * k + ema * (1 - k);
  }
  return ema;
}

/** Pure: the five averages from closes newest first (the existing method), null where there are too few. */
export function maFromClosesDesc(closes: number[]) {
  return {
    ema10: calculateEMA(closes, 10),
    ema20: calculateEMA(closes, 20),
    sma20: calculateSMA(closes, 20),
    sma50: calculateSMA(closes, 50),
    sma200: closes.length >= 200 ? calculateSMA(closes, 200) : null,
  };
}

const MA_BATCH = 50;

/**
 * Recalculate ticker_ma for `tickers`: 50 names per read (their last 250 closes in one query) and one upsert, instead of
 * a read and a write per name; stops between batches on the memory limit.
 */
export async function recalculateTickerMAs(db: any, tickers: string[]): Promise<void> {
  let updated = 0;
  let errors = 0;
  for (let i = 0; i < tickers.length; i += MA_BATCH) {
    if (overLimit("DailyBarRefresh", `MA phase, name ${i} of ${tickers.length}`)) break;
    const batch = tickers.slice(i, i + MA_BATCH);
    try {
      const res: any = await db.execute(sql`SELECT symbol, close::float8 AS c FROM (
          SELECT symbol, close, bar_date, ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY bar_date DESC) AS rn
          FROM historical_bars WHERE symbol IN (${sql.join(batch.map((s) => sql`${s}`), sql`, `)})) x
        WHERE rn <= 250 ORDER BY symbol, rn`);
      const bySym = new Map<string, number[]>();
      for (const r of res?.rows ?? res ?? []) {
        const k = String(r.symbol);
        if (!bySym.has(k)) bySym.set(k, []);
        bySym.get(k)!.push(Number(r.c));
      }
      const values = [];
      for (const symbol of batch) {
        const closes = bySym.get(symbol);
        if (!closes || closes.length < 20) continue;
        const m = maFromClosesDesc(closes);
        values.push({
          symbol,
          ema10d: m.ema10?.toFixed(4) || null,
          ema20d: m.ema20?.toFixed(4) || null,
          sma20d: m.sma20?.toFixed(4) || null,
          sma50d: m.sma50?.toFixed(4) || null,
          sma200d: m.sma200?.toFixed(4) || null,
          updatedAt: new Date(),
        });
      }
      if (values.length) {
        await db.insert(tickerMa).values(values).onConflictDoUpdate({
          target: tickerMa.symbol,
          set: {
            ema10d: sql`excluded.ema_10d`,
            ema20d: sql`excluded.ema_20d`,
            sma20d: sql`excluded.sma_20d`,
            sma50d: sql`excluded.sma_50d`,
            sma200d: sql`excluded.sma_200d`,
            updatedAt: sql`now()`,
          },
        });
        updated += values.length;
      }
    } catch (err) {
      errors += batch.length;
      if (errors <= MA_BATCH * 3) console.warn("[DailyBarRefresh] MA batch error:", String(err).slice(0, 100));
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  console.log(`[DailyBarRefresh] ✅ Recalculated MAs for ${updated} symbols (${errors} errors).`);
}

/**
 * Start one bar cycle now, by hand (admin route POST /api/market-condition/bars/refresh): ignores night mode for this run only,
 * under the same lock, memory guard and phase lines as the scheduled one. Refuses (and says why) when another data job is
 * running, the memory guard stopped one today, or memory pressure is already high. The cycle runs in the background: the answer
 * comes at once, progress is in the log (`[DailyBarRefresh] ... rss`) and in getDailyBarRefreshStatus().
 */
export async function startManualBarCycle(): Promise<{ started: true } | { started: false; reason: string }> {
  if (refreshInProgress) return { started: false, reason: "a bar refresh is already running" };
  if (lockHolder()) return { started: false, reason: `another data job is running (${lockHolder()})` };
  if (guardTrippedToday()) return { started: false, reason: `the memory guard stopped a data job today (${guardState()?.where}); wait until tomorrow` };
  if (isMemoryPressureHigh()) return { started: false, reason: "memory pressure is already high" };
  const db = getDb();
  if (!db) return { started: false, reason: "database unavailable" };
  const release = await tryAcquire("daily bar job (manual)", db);
  if (!release) return { started: false, reason: "another data job is running (bar job, pool refresh or backfill)" };
  manualRun = true;
  console.log("[DailyBarRefresh] Manual cycle started (night mode ignored for this run).");
  void runCheck()
    .catch((err) => console.error("[DailyBarRefresh] Manual cycle failed:", String(err).slice(0, 200)))
    .finally(async () => {
      manualRun = false;
      await release();
      console.log("[DailyBarRefresh] Manual cycle finished.");
    });
  return { started: true };
}

/**
 * Schedule: first check 60 s after start, then every 30 minutes. A check is cheap when everything is fresh (one
 * aggregate query); it only fetches names behind the last finished session, and night mode / memory pressure just
 * move it to the next check. Before, it ran every 6 hours and a cut-short run waited the full 6 hours.
 */
export function startDailyBarRefreshScheduler(): void {
  const run = (label: string) =>
    checkAndRefreshDailyBars().catch((err) => {
      // Do not flip apiKeyBroken on generic errors - night/pressure skips and transient DB blips
      // were falsely marking the key broken and hiding real status.
      console.error(`[DailyBarRefresh] ${label} check failed (non-fatal):`, String(err).slice(0, 200));
    });

  setTimeout(() => void run("Startup"), 60_000);
  setInterval(() => void run("Scheduled"), CHECK_INTERVAL_MS);

  console.log(
    "[DailyBarRefresh] Scheduler started - first check in 60s, then every 30 min " +
      "(skips night mode 8pm-4am ET and RSS/heap pressure; only names behind the last session are fetched)."
  );
}
