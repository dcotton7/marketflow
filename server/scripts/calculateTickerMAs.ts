/**
 * Calculate Ticker Moving Averages Script
 * 
 * Reads from historical_bars table and calculates:
 * - EMA 10-day
 * - EMA 20-day  
 * - SMA 50-day
 * - SMA 200-day
 * 
 * Results are upserted into the ticker_ma table.
 * 
 * Run with: npx tsx server/scripts/calculateTickerMAs.ts
 * 
 * Options:
 *   --symbols=AAPL,MSFT   Only calculate for specific symbols
 */

import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { eq, desc, sql } from "drizzle-orm";
import { historicalBars, tickerMa } from "../../shared/schema";

const { Pool } = pg;

interface Bar {
  close: number;
  date: string;
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

function parseArgs(): { symbols: string[] | null } {
  const args = process.argv.slice(2);
  let symbols: string[] | null = null;

  for (const arg of args) {
    if (arg.startsWith("--symbols=")) {
      const syms = arg.split("=")[1];
      symbols = syms.split(",").map((s) => s.trim().toUpperCase());
    }
  }

  return { symbols };
}

async function main() {
  console.log("=".repeat(60));
  console.log("CALCULATE TICKER MOVING AVERAGES");
  console.log("=".repeat(60));

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("ERROR: DATABASE_URL not set");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);

  const { symbols: filterSymbols } = parseArgs();

  let symbolsQuery;
  if (filterSymbols) {
    symbolsQuery = filterSymbols;
  } else {
    const rows = await db
      .selectDistinct({ symbol: historicalBars.symbol })
      .from(historicalBars);
    symbolsQuery = rows.map((r) => r.symbol);
  }

  console.log(`Processing ${symbolsQuery.length} symbols`);
  console.log("");

  let processed = 0;
  let skipped = 0;
  let updated = 0;

  for (const symbol of symbolsQuery) {
    const bars = await db
      .select({
        close: historicalBars.close,
        date: historicalBars.barDate,
      })
      .from(historicalBars)
      .where(eq(historicalBars.symbol, symbol))
      .orderBy(desc(historicalBars.barDate))
      .limit(250);

    if (bars.length < 50) {
      console.log(`  ${symbol}: Skipped (only ${bars.length} bars)`);
      skipped++;
      continue;
    }

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

    const maStatus = [
      ema10 ? `EMA10:${ema10.toFixed(2)}` : null,
      ema20 ? `EMA20:${ema20.toFixed(2)}` : null,
      sma50 ? `SMA50:${sma50.toFixed(2)}` : null,
      sma200 ? `SMA200:${sma200.toFixed(2)}` : null,
    ]
      .filter(Boolean)
      .join(", ");

    console.log(`  ${symbol}: ${maStatus}`);
    updated++;
    processed++;
  }

  console.log("\n" + "=".repeat(60));
  console.log("MA CALCULATION COMPLETE");
  console.log("=".repeat(60));
  console.log(`Processed: ${processed}`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped}`);

  await pool.end();
  process.exit(0);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
