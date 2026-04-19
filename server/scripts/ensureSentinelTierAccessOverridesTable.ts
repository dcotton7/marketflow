#!/usr/bin/env tsx
/**
 * Creates sentinel_tier_access_overrides (IF NOT EXISTS). Safe to run repeatedly.
 */
import "dotenv/config";
import { initializeDatabase, getPool } from "../db";

const SQL = `CREATE TABLE IF NOT EXISTS "sentinel_tier_access_overrides" (
  "config_key" text PRIMARY KEY NOT NULL DEFAULT 'global',
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "updated_at" timestamp DEFAULT now()
)`;

(async () => {
  await initializeDatabase();
  const pool = getPool();
  if (!pool) {
    console.error("Database unavailable. Set DATABASE_URL and retry.");
    process.exit(1);
  }
  try {
    await pool.query(SQL);
    console.log("sentinel_tier_access_overrides table is present.");
    process.exit(0);
  } catch (e) {
    console.error("ensureSentinelTierAccessOverridesTable failed:", e);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
