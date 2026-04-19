/**
 * Adds theme_members_ma1 / theme_members_ma2 to user_chart_preferences if missing.
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
      `ALTER TABLE "user_chart_preferences" ADD COLUMN IF NOT EXISTS "theme_members_ma1" text NOT NULL DEFAULT 'ema20d'`
    );
    await pool.query(
      `ALTER TABLE "user_chart_preferences" ADD COLUMN IF NOT EXISTS "theme_members_ma2" text NOT NULL DEFAULT 'sma50d'`
    );
    console.log("user_chart_preferences theme_members_ma1 / theme_members_ma2 are present.");
    process.exit(0);
  } catch (e) {
    console.error("ensureUserChartThemeMembersMaColumns failed:", e);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
