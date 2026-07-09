/**
 * Automated Daily Bar Refresh
 *
 * Ensures historical_bars stays current. Runs:
 *   1. On server startup (if bars are stale)
 *   2. On a scheduled timer (5:30 PM ET daily — after market close)
 *
 * If the Alpaca API key is invalid (401), logs a critical warning
 * and disables MA-based scanner signals until fixed.
 */

import { getDb } from "../db";
import { historicalBars, tickerMa } from "@shared/schema";
import { sql, eq, desc } from "drizzle-orm";
import { fetchAlpacaIntradayBars } from "../alpaca";
import { getAllUniverseTickers } from "../market-condition/universe";

const STALE_THRESHOLD_DAYS = 3;
const REFRESH_LOOKBACK_DAYS = 10;
const BATCH_SIZE = 15;

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
 * Check per-symbol freshness: for each symbol, what's the newest bar_date?
 * Returns the count of symbols whose newest bar is older than STALE_THRESHOLD_DAYS.
 */
async function countStaleSymbols(): Promise<{ stale: number; total: number; oldestDate: string | null }> {
  const db = getDb();
  if (!db) return { stale: 0, total: 0, oldestDate: null };

  try {
    const result = await db.execute(sql`
      SELECT symbol, MAX(bar_date) as newest_bar
      FROM historical_bars
      GROUP BY symbol
    `);

    const rows = (result as any)?.rows ?? result ?? [];
    if (!Array.isArray(rows) || rows.length === 0) {
      return { stale: 0, total: 0, oldestDate: null };
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - STALE_THRESHOLD_DAYS);
    const cutoffStr = cutoff.toISOString().split("T")[0];

    let stale = 0;
    let oldestDate: string | null = null;
    for (const row of rows) {
      const newest = row.newest_bar ?? row.newestBar ?? row.newest ?? null;
      if (!newest || newest < cutoffStr) {
        stale++;
        if (!oldestDate || (newest && newest < oldestDate)) oldestDate = newest;
      }
    }
    return { stale, total: rows.length, oldestDate };
  } catch (err) {
    console.warn("[DailyBarRefresh] countStaleSymbols error:", err);
    return { stale: 0, total: 0, oldestDate: null };
  }
}

function daysBetween(dateStr: string): number {
  const d = new Date(dateStr + "T00:00:00Z");
  return (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
}

export async function checkAndRefreshDailyBars(): Promise<void> {
  if (refreshInProgress) return;

  const { stale, total, oldestDate } = await countStaleSymbols();
  if (total === 0) {
    console.warn("[DailyBarRefresh] No bars in DB — cannot determine staleness.");
    return;
  }

  const staleRatio = stale / total;
  if (staleRatio < 0.1) {
    console.log(`[DailyBarRefresh] Bars are fresh (${stale}/${total} stale, <10%). No refresh needed.`);
    return;
  }

  console.warn(`[DailyBarRefresh] ⚠️ ${stale}/${total} symbols have STALE bars (oldest: ${oldestDate}). Refreshing...`);
  await refreshDailyBars();
}

async function refreshDailyBars(): Promise<void> {
  const db = getDb();
  if (!db) {
    console.warn("[DailyBarRefresh] No database available.");
    return;
  }

  refreshInProgress = true;
  lastRefreshAttempt = new Date();

  const tickers = getAllUniverseTickers();
  if (tickers.length === 0) {
    console.warn("[DailyBarRefresh] No universe tickers to refresh.");
    refreshInProgress = false;
    return;
  }

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - REFRESH_LOOKBACK_DAYS);

  let totalUpserted = 0;
  let totalFailed = 0;

  // Use single-symbol endpoint (works with current API key — multi-symbol returns 401)
  for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
    const batch = tickers.slice(i, i + BATCH_SIZE);

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
          console.error(`[DailyBarRefresh] ❌ CRITICAL: Alpaca API key is INVALID (401). Cannot refresh bars. Fix the ALPACA_API_KEY/ALPACA_API_SECRET in .env`);
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
    if (i + BATCH_SIZE < tickers.length) {
      await new Promise((r) => setTimeout(r, 1000));
    }

    // Progress log every 5 batches
    if ((Math.floor(i / BATCH_SIZE) + 1) % 5 === 0) {
      console.log(`[DailyBarRefresh] Progress: ${i + BATCH_SIZE}/${tickers.length} symbols processed, ${totalUpserted} bars upserted`);
    }
  }

  if (totalUpserted > 0) {
    apiKeyBroken = false;
    lastRefreshSuccess = new Date();
    console.log(`[DailyBarRefresh] ✅ Refreshed ${totalUpserted} bars (${totalFailed} symbols failed). Now recalculating MAs...`);
    await recalculateTickerMAs(db, tickers);
  } else if (totalFailed > 0) {
    console.warn(`[DailyBarRefresh] ⚠️ All ${totalFailed} symbols failed. Check API key.`);
  }

  refreshInProgress = false;
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

    // Yield control every 50 symbols to avoid blocking the event loop
    if (i > 0 && i % 50 === 0) {
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  console.log(`[DailyBarRefresh] ✅ Recalculated MAs for ${updated} symbols (${errors} errors).`);
}

/**
 * Schedule daily refresh at 5:30 PM ET (21:30 UTC in winter, 21:30 UTC - adjust as needed).
 * Also runs immediately on startup if bars are stale.
 */
export function startDailyBarRefreshScheduler(): void {
  // Startup check (delayed to ensure DB is ready, non-blocking)
  setTimeout(() => {
    checkAndRefreshDailyBars().catch((err) => {
      console.error("[DailyBarRefresh] Startup check failed (non-fatal):", String(err).slice(0, 200));
      apiKeyBroken = true;
    });
  }, 10_000);

  // Schedule refresh every 6 hours (covers market close regardless of timezone)
  const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
  setInterval(() => {
    checkAndRefreshDailyBars().catch((err) => {
      console.error("[DailyBarRefresh] Scheduled refresh failed (non-fatal):", String(err).slice(0, 200));
    });
  }, SIX_HOURS_MS);

  console.log("[DailyBarRefresh] Scheduler started — checks every 6 hours.");
}
