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
import { sql, eq, desc } from "drizzle-orm";
import { fetchAlpacaIntradayBars } from "../alpaca";
import { getAllUniverseTickers } from "../market-condition/universe";
import { expectedLastSession, loadBarUniverse, loadNewestBars, splitStale } from "./bar-universe";
import {
  isMemoryPressureHigh,
  isNightMode,
  shouldRunHeavyBackgroundWork,
} from "../infra/memory-gate";
import { getEtClock, getUsEquityMarketSession } from "@shared/usEquityMarketSession";

const REFRESH_LOOKBACK_DAYS = 10;
const BATCH_SIZE = 5;
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

/** True when this check did not finish the stale list (deferred, cut short, or failed): the scheduler retries soon. */
export async function checkAndRefreshDailyBars(): Promise<boolean> {
  if (refreshInProgress) return false;

  if (isNightMode()) {
    logOncePerDay("night", "[DailyBarRefresh] Night mode (8pm-4am ET, weekends) - bars wait for the next check.");
    return false;
  }

  if (!shouldRunHeavyBackgroundWork()) {
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
    return false;
  }

  console.log(`[DailyBarRefresh] ${staleSymbols.length}/${total} symbols are behind ${expected} (${freshCount} fresh). Starting smart refresh...`);
  return refreshDailyBars(staleSymbols, expected, total, newest);
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
  const noBarsList: string[] = [];

  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    // Abort remaining work if night mode starts mid-run or RSS/heap pressure persists.
    if (isNightMode()) {
      console.warn("[DailyBarRefresh] Night mode started mid-run — stopping remaining batches.");
      break;
    }
    if (isMemoryPressureHigh()) {
      memorySkipped++;
      if (memorySkipped <= 3) {
        console.warn(
          `[DailyBarRefresh] Memory pressure high (heap or RSS) — pausing 10s (batch ${Math.floor(i / BATCH_SIZE) + 1})`
        );
      }
      await new Promise((r) => setTimeout(r, 10_000));
      if (isMemoryPressureHigh() || isNightMode()) {
        console.warn("[DailyBarRefresh] Still under pressure / night mode — stopping remaining batches.");
        break;
      }
    }

    const batch = symbols.slice(i, i + BATCH_SIZE);
    processed = i + batch.length;

    const results = await Promise.allSettled(
      batch.map(async (symbol) => {
        try {
          const bars = await fetchAlpacaIntradayBars(symbol, startDate, endDate, "1Day", true);
          if (bars.length === 0) return { symbol, count: 0, empty: true };

          let inserted = 0;
          const now = new Date();
          const currentEtDate = getEtClock(now).dateKey;
          const currentSession = getUsEquityMarketSession(now);
          for (const bar of bars) {
            const barDate = getEtClock(new Date(bar.date)).dateKey;
            const currentDayStillDeveloping =
              barDate === currentEtDate &&
              (currentSession === "pre_market" || currentSession === "regular");
            if (currentDayStillDeveloping) {
              continue;
            }
            try {
              await db!.insert(historicalBars).values({
                symbol: symbol.toUpperCase(),
                barDate,
                open: bar.open.toString(),
                high: bar.high.toString(),
                low: bar.low.toString(),
                close: bar.close.toString(),
                volume: bar.volume,
              }).onConflictDoUpdate({
                target: [historicalBars.symbol, historicalBars.barDate],
                set: {
                  open: bar.open.toString(),
                  high: bar.high.toString(),
                  low: bar.low.toString(),
                  close: bar.close.toString(),
                  volume: bar.volume,
                },
              });
              inserted++;
            } catch {
              // Individual bar insert failure — skip
            }
          }
          return { symbol, count: inserted };
        } catch (err: any) {
          const msg = String(err?.message ?? "");
          if (msg.includes("401")) throw err;
          return { symbol, count: 0, error: msg.slice(0, 80) };
        }
      })
    );

    for (const r of results) {
      if (r.status === "fulfilled" && r.value.count > 0) {
        totalUpserted += r.value.count;
        withBars++;
      } else if (r.status === "fulfilled" && (r.value as any).empty) {
        noBarsList.push(r.value.symbol);
      } else if (r.status === "rejected") {
        const msg = String(r.reason?.message ?? "");
        if (msg.includes("401")) {
          console.error(`[DailyBarRefresh] ❌ CRITICAL: Alpaca API key is INVALID (401). Cannot refresh bars.`);
          apiKeyBroken = true;
          refreshInProgress = false;
          return false;
        }
        totalFailed++;
      } else {
        totalFailed++;
      }
    }

    // Rate limit: pause between batches
    if (i + BATCH_SIZE < symbols.length) {
      await new Promise((r) => setTimeout(r, 1500));
    }

    // Progress log every 10 batches
    if ((Math.floor(i / BATCH_SIZE) + 1) % 10 === 0) {
      const mem = process.memoryUsage();
      console.log(`[DailyBarRefresh] Progress: ${Math.min(i + BATCH_SIZE, symbols.length)}/${symbols.length} symbols, ${totalUpserted} bars upserted, heap ${Math.round(mem.heapUsed / 1024 / 1024)}MB`);
    }
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
      if (!isNightMode() && !isMemoryPressureHigh()) {
        await recalculateTickerMAs(db, doneSymbols);
      } else {
        console.warn("[DailyBarRefresh] Skipping MA recalculation — night mode or memory pressure.");
      }
    } else if (totalFailed > 0) {
      console.warn(`[DailyBarRefresh] ⚠️ All ${totalFailed} symbols failed (or deferred). Not marking API key broken.`);
    }
  } finally {
    refreshInProgress = false;
  }
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

export async function recalculateTickerMAs(db: any, tickers: string[]): Promise<void> {
  let updated = 0;
  let errors = 0;

  for (let i = 0; i < tickers.length; i++) {
    const symbol = tickers[i]!;
    try {
      const bars = await db
        .select({ close: historicalBars.close, date: historicalBars.barDate })
        .from(historicalBars)
        .where(eq(historicalBars.symbol, symbol))
        .orderBy(desc(historicalBars.barDate))
        .limit(250);

      if (bars.length < 20) continue;

      const closes = bars.map((b: any) => Number(b.close));
      const ema10 = calculateEMA(closes, 10);
      const ema20 = calculateEMA(closes, 20);
      const sma20 = calculateSMA(closes, 20);
      const sma50 = calculateSMA(closes, 50);
      const sma200 = closes.length >= 200 ? calculateSMA(closes, 200) : null;

      await db
        .insert(tickerMa)
        .values({
          symbol,
          ema10d: ema10?.toFixed(4) || null,
          ema20d: ema20?.toFixed(4) || null,
          sma20d: sma20?.toFixed(4) || null,
          sma50d: sma50?.toFixed(4) || null,
          sma200d: sma200?.toFixed(4) || null,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
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
      updated++;
    } catch (err) {
      errors++;
      if (errors <= 3) {
        console.warn(`[DailyBarRefresh] MA calc error for ${symbol}:`, String(err).slice(0, 100));
      }
    }

    if (i > 0 && i % 50 === 0) {
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  console.log(`[DailyBarRefresh] ✅ Recalculated MAs for ${updated} symbols (${errors} errors).`);
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
