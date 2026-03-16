/**
 * Backfill Historical Bars Script
 * 
 * Fetches 250 days of daily OHLCV data for all universe tickers
 * and populates the historical_bars table.
 * 
 * Run with: npx tsx server/scripts/backfillHistoricalBars.ts
 * 
 * Options:
 *   --symbols=AAPL,MSFT   Only backfill specific symbols
 *   --days=250            Number of days to fetch (default 250)
 *   --batch=50            Symbols per batch (default 50)
 */

import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { eq, sql } from "drizzle-orm";
import { historicalBars } from "../../shared/schema";
import { fetchAlpacaMultiSymbolDailyBars } from "../alpaca";
import { getConstituents } from "../universe/constituents";

const { Pool } = pg;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(): { symbols: string[] | null; days: number; batchSize: number } {
  const args = process.argv.slice(2);
  let symbols: string[] | null = null;
  let days = 250;
  let batchSize = 100; // Multi-symbol API: 100 symbols per request

  for (const arg of args) {
    if (arg.startsWith("--symbols=")) {
      const syms = arg.split("=")[1];
      symbols = syms.split(",").map((s) => s.trim().toUpperCase());
    } else if (arg.startsWith("--days=")) {
      days = parseInt(arg.split("=")[1], 10) || 250;
    } else if (arg.startsWith("--batch=")) {
      batchSize = parseInt(arg.split("=")[1], 10) || 50;
    }
  }

  return { symbols, days, batchSize };
}

async function main() {
  console.log("=".repeat(60));
  console.log("HISTORICAL BARS BACKFILL");
  console.log("=".repeat(60));

  let databaseUrl = process.env.DATABASE_URL;
  
  // Handle PowerShell env var mangling - check if URL seems valid
  if (!databaseUrl || !databaseUrl.includes("postgresql://") || databaseUrl.includes(" ")) {
    // Try reading directly from .env file
    const fs = await import("fs");
    const path = await import("path");
    const envPath = path.join(process.cwd(), ".env");
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, "utf-8");
      const match = envContent.match(/DATABASE_URL="([^"]+)"/);
      if (match) {
        databaseUrl = match[1];
        console.log("Loaded DATABASE_URL from .env file");
      }
    }
  }
  
  if (!databaseUrl) {
    console.error("ERROR: DATABASE_URL not set");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);

  const { symbols, days, batchSize } = parseArgs();

  const allTickers = symbols || (await getConstituents("russell3000"));
  console.log(`Tickers to backfill: ${allTickers.length}`);
  console.log(`Days per ticker: ${days}`);
  console.log(`Batch size: ${batchSize}`);
  console.log("");

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days - 10);

  let totalFetched = 0;
  let totalUpserted = 0;
  let failed: string[] = [];

  const chunks: string[][] = [];
  for (let i = 0; i < allTickers.length; i += batchSize) {
    chunks.push(allTickers.slice(i, i + batchSize));
  }

  for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
    const chunk = chunks[chunkIdx];
    console.log(
      `\nBatch ${chunkIdx + 1}/${chunks.length}: ${chunk.length} symbols (multi-symbol fetch)`
    );

    try {
      const barsBySymbol = await fetchAlpacaMultiSymbolDailyBars(
        chunk,
        startDate,
        endDate
      );

      let batchUpserted = 0;
      for (const symbol of chunk) {
        const bars = barsBySymbol.get(symbol.toUpperCase()) || [];
        if (bars.length === 0) {
          console.log(`  ${symbol}: No data`);
          failed.push(symbol);
          continue;
        }

        totalFetched += bars.length;

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

        totalUpserted += bars.length;
        batchUpserted += bars.length;
      }
      console.log(`  ${chunk.length} symbols: ${batchUpserted} bars upserted`);
    } catch (error: any) {
      console.error(`  Batch ERROR - ${error.message}`);
      failed.push(...chunk);
    }

    if (chunkIdx < chunks.length - 1) {
      console.log("  Pausing 500ms before next batch...");
      await sleep(500);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("BACKFILL COMPLETE");
  console.log("=".repeat(60));
  console.log(`Total bars fetched: ${totalFetched}`);
  console.log(`Total bars upserted: ${totalUpserted}`);
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
