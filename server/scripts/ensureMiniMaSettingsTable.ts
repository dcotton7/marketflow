#!/usr/bin/env tsx
/**
 * Ensure user_mini_ma_settings + chart_background_color exist.
 *
 * Usage:
 *   npm run db:ensure-mini-ma
 */
import "dotenv/config";
import { readFileSync } from "fs";
import { join } from "path";
import { sql } from "drizzle-orm";
import { initializeDatabase, db } from "../db";

async function main() {
  if (!db) {
    console.error("Database not available (set DATABASE_URL)");
    process.exit(1);
  }

  await initializeDatabase();

  const filepath = join(process.cwd(), "migrations", "013_user_mini_ma_and_chart_bg.sql");
  const sqlContent = readFileSync(filepath, "utf-8");

  console.log("[ensure-mini-ma] Running migration 013...");
  await db.execute(sql.raw(sqlContent));
  console.log("[ensure-mini-ma] Done.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[ensure-mini-ma] Failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
