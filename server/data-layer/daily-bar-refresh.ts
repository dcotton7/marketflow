/**
 * Automated Daily Bar Refresh
 *
 * Ensures historical_bars stays current. Runs:
 *   1. On server startup (if bars are stale or missing)
 *   2. On a scheduled timer (every 6 hours)
 *
 * Smart refresh: only fetches symbols that are actually stale or missing,
 * not the entire universe. Respects a memory gate to avoid OOM during
 * concurrent MC snapshot polling.
 */

import { getDb } from "../db";
import { historicalBars, tickerMa } from "@shared/schema";
import { sql, eq, desc } from "drizzle-orm";
import { fetchAlpacaIntradayBars } from "../alpaca";
import { getAllUniverseTickers } from "../market-condition/universe";
import {
  isMemoryPressureHigh,
  isNightMode,
  shouldRunHeavyBackgroundWork,
} from "../infra/memory-gate";

const STALE_THRESHOLD_DAYS = 3;
const REFRESH_LOOKBACK_DAYS = 10;
const BATCH_SIZE = 5;

let lastRefreshAttempt: Date | null = null;
let lastRefreshSuccess: Date | null = null;
let apiKeyBroken = false;
let refreshInProgress = false;

export function isDailyBarApiHealthy(): boolean {
  return !apiKeyBroken;
}

export function getDailyBarRefreshStatus() {
  return {
    lastAttempt: lastRefreshAttempt?.toISOString() ?? null,
    lastSuccess: lastRefreshSuccess?.toISOString() ?? null,
    apiKeyBroken,
    refreshInProgress,
  };
}

/**
 * Identify which universe symbols have stale or missing bars.
 * Returns the actual list of symbols that need refreshing.
 */
async function getStaleSymbols(): Promise<{ staleSymbols: string[]; freshCount: number }> {
  const db = getDb();
  if (!db) return { staleSymbols: [], freshCount: 0 };

  const universeTickers = getAllUniverseTickers();

  try {
    const result = await db.execute(sql`
      SELECT symbol, MAX(bar_date) as newest_bar
      FROM historical_bars
      GROUP BY symbol
    `);

    const rows = (result as any)?.rows ?? result ?? [];
    const freshMap = new Map<string, string>();

    if (Array.isArray(rows)) {
      for (const row of rows) {
        const sym = (row.symbol as string)?.toUpperCase();
        const newest = row.newest_bar ?? row.newestBar ?? row.newest ?? null;
        if (sym && newest) freshMap.set(sym, newest);
      }
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - STALE_THRESHOLD_DAYS);
    const cutoffStr = cutoff.toISOString().split("T")[0]!;

    const staleSymbols: string[] = [];
    let freshCount = 0;

    for (const ticker of universeTickers) {
      const newest = freshMap.get(ticker.toUpperCase());
      if (!newest || newest < cutoffStr) {
        staleSymbols.push(ticker);
      } else {
        freshCount++;
      }
    }

    return { staleSymbols, freshCount };
  } catch (err) {
    console.warn("[DailyBarRefresh] getStaleSymbols error:", err);
    return { staleSymbols: [], freshCount: 0 };
  }
}

export async function checkAndRefreshDailyBars(): Promise<void> {
  if (refreshInProgress) return;

  if (isNightMode()) {
    console.log("[DailyBarRefresh] Night mode (8pm–4am ET) — deferring refresh.");
    return;
  }

  if (!shouldRunHeavyBackgroundWork()) {
    console.warn("[DailyBarRefresh] Memory pressure high — deferring refresh.");
    return;
  }

  const { staleSymbols, freshCount } = await getStaleSymbols();
  const total = staleSymbols.length + freshCount;

  if (staleSymbols.length === 0) {
    // Mark healthy so server-status is not stuck on lastSuccess=null forever.
    lastRefreshAttempt = new Date();
    lastRefreshSuccess = lastRefreshAttempt;
    console.log(`[DailyBarRefresh] All ${total} symbols are fresh. No refresh needed.`);
    return;
  }

  console.log(`[DailyBarRefresh] ${staleSymbols.length}/${total} symbols need refresh (${freshCount} fresh). Starting smart refresh...`);
  await refreshDailyBars(staleSymbols);
}

async function refreshDailyBars(symbols: string[]): Promise<void> {
  const db = getDb();
  if (!db) {
    console.warn("[DailyBarRefresh] No database available.");
    return;
  }

  refreshInProgress = true;
  lastRefreshAttempt = new Date();

  if (symbols.length === 0) {
    console.log("[DailyBarRefresh] No symbols to refresh.");
    refreshInProgress = false;
    return;
  }

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - REFRESH_LOOKBACK_DAYS);

  let totalUpserted = 0;
  let totalFailed = 0;
  let memorySkipped = 0;

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

    const results = await Promise.allSettled(
      batch.map(async (symbol) => {
        try {
          const bars = await fetchAlpacaIntradayBars(symbol, startDate, endDate, "1Day", true).catch(() => []);
          if (bars.length === 0) return { symbol, count: 0 };

          let inserted = 0;
          for (const bar of bars) {
            const barDate = new Date(bar.date).toISOString().split("T")[0];
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
      } else if (r.status === "rejected") {
        const msg = String(r.reason?.message ?? "");
        if (msg.includes("401")) {
          console.error(`[DailyBarRefresh] ❌ CRITICAL: Alpaca API key is INVALID (401). Cannot refresh bars.`);
          apiKeyBroken = true;
          refreshInProgress = false;
          return;
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
        await recalculateTickerMAs(db, symbols);
      } else {
        console.warn("[DailyBarRefresh] Skipping MA recalculation — night mode or memory pressure.");
      }
    } else if (totalFailed > 0) {
      console.warn(`[DailyBarRefresh] ⚠️ All ${totalFailed} symbols failed (or deferred). Not marking API key broken.`);
    }
  } finally {
    refreshInProgress = false;
  }
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

async function recalculateTickerMAs(db: any, tickers: string[]): Promise<void> {
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
 * Schedule daily refresh. Runs on startup (deferred 60s) and every 6 hours.
 */
export function startDailyBarRefreshScheduler(): void {
  setTimeout(() => {
    checkAndRefreshDailyBars().catch((err) => {
      // Do not flip apiKeyBroken on generic startup errors — night/pressure skips and
      // transient DB blips were falsely marking the key broken and hiding real status.
      console.error("[DailyBarRefresh] Startup check failed (non-fatal):", String(err).slice(0, 200));
    });
  }, 60_000);

  const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
  setInterval(() => {
    checkAndRefreshDailyBars().catch((err) => {
      console.error("[DailyBarRefresh] Scheduled refresh failed (non-fatal):", String(err).slice(0, 200));
    });
  }, SIX_HOURS_MS);

  console.log(
    "[DailyBarRefresh] Scheduler started — first check in 60s, then every 6 hours " +
      "(skips night mode 8pm–4am ET and RSS/heap pressure)."
  );
}
