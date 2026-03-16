/**
 * Refresh Daily Bars Script (Incremental Update)
 * 
 * Designed to run daily after market close:
 * 1. Fetches the last 5 days of bars for all universe tickers
 * 2. Upserts into historical_bars table (handles weekends/holidays)
 * 3. Recalculates all moving averages
 * 
 * Run with: npx tsx server/scripts/refreshDailyBars.ts
 * 
 * Options:
 *   --symbols=AAPL,MSFT   Only refresh specific symbols
 *   --skip-mas            Skip MA recalculation
 */

import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { eq, desc, sql } from "drizzle-orm";
import { historicalBars, tickerMa } from "../../shared/schema";
import { fetchAlpacaMultiSymbolDailyBars } from "../alpaca";
import { getConstituents } from "../universe/constituents";

const { Pool } = pg;

const REFRESH_DAYS = 5;
const BATCH_SIZE = 100; // Multi-symbol API: 100 symbols per request

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

function parseArgs(): { symbols: string[] | null; skipMAs: boolean } {
  const args = process.argv.slice(2);
  let symbols: string[] | null = null;
  let skipMAs = false;

  for (const arg of args) {
    if (arg.startsWith("--symbols=")) {
      const syms = arg.split("=")[1];
      symbols = syms.split(",").map((s) => s.trim().toUpperCase());
    } else if (arg === "--skip-mas") {
      skipMAs = true;
    }
  }

  return { symbols, skipMAs };
}

async function main() {
  console.log("=".repeat(60));
  console.log("DAILY BARS REFRESH (Incremental)");
  console.log(`Fetching last ${REFRESH_DAYS} days for all tickers`);
  console.log("=".repeat(60));

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("ERROR: DATABASE_URL not set");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);

  const { symbols, skipMAs } = parseArgs();

  const allTickers = symbols || (await getConstituents("russell3000"));
  console.log(`Tickers to refresh: ${allTickers.length}`);
  console.log(`Skip MA calculation: ${skipMAs}`);
  console.log("");

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - REFRESH_DAYS - 3);

  let totalBarsUpdated = 0;
  let failed: string[] = [];
  let masUpdated = 0;

  const chunks: string[][] = [];
  for (let i = 0; i < allTickers.length; i += BATCH_SIZE) {
    chunks.push(allTickers.slice(i, i + BATCH_SIZE));
  }

  console.log("PHASE 1: Fetching recent bars from Alpaca (multi-symbol)\n");

  for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
    const chunk = chunks[chunkIdx];
    console.log(`Batch ${chunkIdx + 1}/${chunks.length}: ${chunk.length} symbols`);

    try {
      const barsBySymbol = await fetchAlpacaMultiSymbolDailyBars(
        chunk,
        startDate,
        endDate
      );

      for (const symbol of chunk) {
        const bars = barsBySymbol.get(symbol.toUpperCase()) || [];
        if (bars.length === 0) {
          failed.push(symbol);
          continue;
        }

        const values = bars.map((bar) => ({
          symbol: symbol.toUpperCase(),
          barDate: bar.date.split("T")[0],
          open: bar.open.toString(),
          high: bar.high.toString(),
          low: bar.low.toString(),
          close: bar.close.toString(),
          volume: bar.volume,
          vwap: null as string | null,
        }));

        await db
          .insert(historicalBars)
          .values(values)
          .onConflictDoUpdate({
            target: [historicalBars.symbol, historicalBars.barDate],
            set: {
              open: sql`excluded.open`,
              high: sql`excluded.high`,
              low: sql`excluded.low`,
              close: sql`excluded.close`,
              volume: sql`excluded.volume`,
            },
          });

        totalBarsUpdated += bars.length;
      }
    } catch (error: any) {
      console.error(`  Batch ERROR - ${error.message}`);
      failed.push(...chunk);
    }

    if (chunkIdx < chunks.length - 1) {
      await sleep(500);
    }
  }

  console.log(`\nBars updated: ${totalBarsUpdated}`);

  if (!skipMAs) {
    console.log("\nPHASE 2: Recalculating Moving Averages\n");

    for (const symbol of allTickers) {
      if (failed.includes(symbol)) continue;

      const bars = await db
        .select({
          close: historicalBars.close,
          date: historicalBars.barDate,
        })
        .from(historicalBars)
        .where(eq(historicalBars.symbol, symbol))
        .orderBy(desc(historicalBars.barDate))
        .limit(250);

      if (bars.length < 50) continue;

      const closes = bars.map((b) => Number(b.close));

      const ema10 = calculateEMA(closes, 10);
      const ema20 = calculateEMA(closes, 20);
      const sma50 = calculateSMA(closes, 50);
      const sma200 = closes.length >= 200 ? calculateSMA(closes, 200) : null;

      await db
        .insert(tickerMa)
        .values({
          symbol,
          ema10d: ema10?.toFixed(4) || null,
          ema20d: ema20?.toFixed(4) || null,
          sma50d: sma50?.toFixed(4) || null,
          sma200d: sma200?.toFixed(4) || null,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: tickerMa.symbol,
          set: {
            ema10d: sql`excluded.ema_10d`,
            ema20d: sql`excluded.ema_20d`,
            sma50d: sql`excluded.sma_50d`,
            sma200d: sql`excluded.sma_200d`,
            updatedAt: sql`now()`,
          },
        });

      masUpdated++;
    }

    console.log(`MAs updated: ${masUpdated}`);
  }

  console.log("\n" + "=".repeat(60));
  console.log("REFRESH COMPLETE");
  console.log("=".repeat(60));
  console.log(`Total bars updated: ${totalBarsUpdated}`);
  console.log(`MAs updated: ${masUpdated}`);
  console.log(`Failed symbols: ${failed.length}`);
  if (failed.length > 0) {
    console.log(`Failed: ${failed.join(", ")}`);
  }

  await pool.end();
  process.exit(0);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
