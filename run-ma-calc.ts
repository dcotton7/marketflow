import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, desc, sql } from "drizzle-orm";
import { historicalBars, tickerMa } from "./shared/schema";

const { Pool } = pg;
const DATABASE_URL = "postgresql://neondb_owner:npg_d1zsHf7jJRmV@ep-broad-truth-afv67u09-pooler.c-2.us-west-2.aws.neon.tech/neondb?sslmode=require";

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

async function main() {
  console.log("=".repeat(60));
  console.log("CALCULATE TICKER MOVING AVERAGES");
  console.log("=".repeat(60));

  const pool = new Pool({ connectionString: DATABASE_URL });
  const db = drizzle(pool);

  const rows = await db
    .selectDistinct({ symbol: historicalBars.symbol })
    .from(historicalBars);
  const symbols = rows.map((r) => r.symbol);

  console.log(`Processing ${symbols.length} symbols`);
  console.log("");

  let processed = 0;
  let skipped = 0;
  let updated = 0;
  let withSma200 = 0;

  for (const symbol of symbols) {
    const bars = await db
      .select({
        close: historicalBars.close,
        date: historicalBars.barDate,
      })
      .from(historicalBars)
      .where(eq(historicalBars.symbol, symbol))
      .orderBy(desc(historicalBars.barDate))
      .limit(300);

    if (bars.length < 50) {
      skipped++;
      continue;
    }

    const closes = bars.map((b) => Number(b.close));
    const ema10 = calculateEMA(closes, 10);
    const ema20 = calculateEMA(closes, 20);
    const sma50 = calculateSMA(closes, 50);
    const sma200 = closes.length >= 200 ? calculateSMA(closes, 200) : null;

    if (sma200) withSma200++;

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

    updated++;
    processed++;

    if (processed % 100 === 0) {
      console.log(`Processed ${processed}/${symbols.length} (${withSma200} with SMA200)`);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("MA CALCULATION COMPLETE");
  console.log("=".repeat(60));
  console.log(`Processed: ${processed}`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`With SMA200: ${withSma200}`);

  await pool.end();
}

main().catch(console.error);
