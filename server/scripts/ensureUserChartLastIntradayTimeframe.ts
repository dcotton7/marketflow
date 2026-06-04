/**
 * Adds last_intraday_timeframe to user_chart_preferences if missing.
 */
import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(
      `ALTER TABLE "user_chart_preferences" ADD COLUMN IF NOT EXISTS "last_intraday_timeframe" text NOT NULL DEFAULT '5min'`
    );
    console.log("user_chart_preferences.last_intraday_timeframe is present.");
  } catch (e) {
    console.error("ensureUserChartLastIntradayTimeframe failed:", e);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
