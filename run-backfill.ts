import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { historicalBars } from "./shared/schema";

const { Pool } = pg;

const DATABASE_URL = "postgresql://neondb_owner:npg_d1zsHf7jJRmV@ep-broad-truth-afv67u09-pooler.c-2.us-west-2.aws.neon.tech/neondb?sslmode=require";
const ALPACA_API_KEY = "PKCCJS3BA56V4URZ34HXLZMAAR";
const ALPACA_API_SECRET = "sWXzni6KH7JnP92EqHUCBvhN7LXxYWMnjxcvBBQcSza";
const ALPACA_DATA_URL = "https://data.alpaca.markets";

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface AlpacaBar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

async function fetchBars(symbols: string[], startDate: Date, endDate: Date): Promise<Map<string, AlpacaBar[]>> {
  const result = new Map<string, AlpacaBar[]>();
  symbols.forEach((s) => result.set(s.toUpperCase(), []));

  const params = new URLSearchParams({
    symbols: symbols.map((s) => s.toUpperCase()).join(","),
    start: startDate.toISOString(),
    end: endDate.toISOString(),
    timeframe: "1Day",
    feed: "sip",
    limit: "10000",
    sort: "asc",
  });

  let pageToken: string | null = null;
  for (let i = 0; i < 50; i++) {
    if (pageToken) params.set("page_token", pageToken);
    else params.delete("page_token");

    const url = `${ALPACA_DATA_URL}/v2/stocks/bars?${params}`;
    const resp = await fetch(url, {
      headers: {
        "APCA-API-KEY-ID": ALPACA_API_KEY,
        "APCA-API-SECRET-KEY": ALPACA_API_SECRET,
      },
    });

    if (!resp.ok) {
      throw new Error(`Alpaca error: ${resp.status}`);
    }

    const data = await resp.json();
    const barsObj = data?.bars;
    if (barsObj && typeof barsObj === "object") {
      for (const [sym, barList] of Object.entries(barsObj)) {
        const arr = barList as AlpacaBar[];
        if (!Array.isArray(arr)) continue;
        const existing = result.get(sym.toUpperCase()) || [];
        result.set(sym.toUpperCase(), [...existing, ...arr]);
      }
    }

    pageToken = data?.next_page_token || null;
    if (!pageToken) break;
  }

  return result;
}

async function getConstituents(): Promise<string[]> {
  const pool = new Pool({ connectionString: DATABASE_URL });
  const result = await pool.query("SELECT DISTINCT symbol FROM tickers WHERE symbol IS NOT NULL ORDER BY symbol");
  await pool.end();
  return result.rows.map((r: { symbol: string }) => r.symbol);
}

async function main() {
  console.log("=".repeat(60));
  console.log("HISTORICAL BARS BACKFILL (400 DAYS)");
  console.log("=".repeat(60));

  // Get tickers that don't have enough bars
  const checkPool = new Pool({ connectionString: DATABASE_URL });
  const needsBackfill = await checkPool.query(`
    SELECT symbol FROM tickers 
    WHERE symbol NOT IN (
      SELECT symbol FROM historical_bars 
      GROUP BY symbol HAVING COUNT(*) >= 200
    )
    ORDER BY symbol
  `);
  await checkPool.end();
  
  const allTickers = needsBackfill.rows.map((r: { symbol: string }) => r.symbol);
  console.log(`Tickers needing backfill: ${allTickers.length}`);

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 410);

  console.log(`Date range: ${startDate.toISOString().split("T")[0]} to ${endDate.toISOString().split("T")[0]}`);
  console.log("");

  let totalUpserted = 0;
  let failed: string[] = [];
  const batchSize = 50; // Smaller batches to avoid DB timeouts

  const chunks: string[][] = [];
  for (let i = 0; i < allTickers.length; i += batchSize) {
    chunks.push(allTickers.slice(i, i + batchSize));
  }

  for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
    const chunk = chunks[chunkIdx];
    console.log(`Batch ${chunkIdx + 1}/${chunks.length}: ${chunk.length} symbols`);

    // Create fresh pool per batch to avoid Neon timeout
    const pool = new Pool({ connectionString: DATABASE_URL, max: 5 });
    const db = drizzle(pool);

    try {
      const barsBySymbol = await fetchBars(chunk, startDate, endDate);
      let batchUpserted = 0;

      for (const symbol of chunk) {
        const bars = barsBySymbol.get(symbol.toUpperCase()) || [];
        if (bars.length === 0) {
          failed.push(symbol);
          continue;
        }

        const values = bars.map((bar) => ({
          symbol: symbol.toUpperCase(),
          barDate: bar.t.split("T")[0],
          open: bar.o.toString(),
          high: bar.h.toString(),
          low: bar.l.toString(),
          close: bar.c.toString(),
          volume: bar.v || 0,
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

        batchUpserted += bars.length;
      }

      totalUpserted += batchUpserted;
      console.log(`  Upserted: ${batchUpserted} bars`);
    } catch (error: any) {
      console.error(`  ERROR: ${error.message}`);
      failed.push(...chunk);
    } finally {
      await pool.end();
    }

    if (chunkIdx < chunks.length - 1) {
      await sleep(500); // Longer pause between batches
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("BACKFILL COMPLETE");
  console.log("=".repeat(60));
  console.log(`Total bars upserted: ${totalUpserted}`);
  console.log(`Failed symbols: ${failed.length}`);
}

main().catch(console.error);
