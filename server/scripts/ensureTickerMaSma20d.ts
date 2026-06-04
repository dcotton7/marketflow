/**
 * Adds sma_20d to ticker_ma and migrates theme_members_ma1 default to sma20d.
 * Safe to run repeatedly.
 */
import "dotenv/config";
import { initializeDatabase, getPool } from "../db";

(async () => {
  await initializeDatabase();
  const pool = getPool();
  if (!pool) {
    console.error("Database unavailable. Set DATABASE_URL and retry.");
    process.exit(1);
  }
  try {
    await pool.query(
      `ALTER TABLE ticker_ma ADD COLUMN IF NOT EXISTS sma_20d DOUBLE PRECISION`
    );
    await pool.query(
      `ALTER TABLE "user_chart_preferences" ADD COLUMN IF NOT EXISTS "theme_members_ma1" text NOT NULL DEFAULT 'sma20d'`
    );
    await pool.query(
      `ALTER TABLE "user_chart_preferences" ADD COLUMN IF NOT EXISTS "theme_members_ma2" text NOT NULL DEFAULT 'sma50d'`
    );
    await pool.query(
      `UPDATE user_chart_preferences SET theme_members_ma1 = 'sma20d' WHERE theme_members_ma1 = 'ema20d'`
    );
    await pool.query(
      `ALTER TABLE user_chart_preferences ALTER COLUMN theme_members_ma1 SET DEFAULT 'sma20d'`
    );
    console.log("ticker_ma.sma_20d and theme_members_ma1 sma20d defaults are present.");
    process.exit(0);
  } catch (e) {
    console.error("ensureTickerMaSma20d failed:", e);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
