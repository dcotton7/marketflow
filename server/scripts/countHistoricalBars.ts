/**
 * Quick script to count tickers and bars in historical_bars
 * Run: npx tsx server/scripts/countHistoricalBars.ts
 */
import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const client = await pool.connect();
  const tickerRes = await client.query(
    "SELECT COUNT(DISTINCT symbol)::int as cnt FROM historical_bars"
  );
  const barRes = await client.query(
    "SELECT COUNT(*)::int as cnt FROM historical_bars"
  );
  client.release();
  await pool.end();

  const inDb = tickerRes.rows[0]?.cnt ?? 0;
  const totalBars = barRes.rows[0]?.cnt ?? 0;
  const attempted = 3009; // Russell 3000
  const omitted = attempted - inDb;

  console.log("Tickers in DB:", inDb);
  console.log("Total bars:", totalBars);
  console.log("Attempted (Russell 3000):", attempted);
  console.log("Omitted (no data):", omitted);
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
