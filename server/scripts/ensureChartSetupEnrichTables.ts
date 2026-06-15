#!/usr/bin/env tsx
/**
 * Creates chart setup enrich tables (IF NOT EXISTS). Safe to run repeatedly.
 */
import "dotenv/config";
import { initializeDatabase, getPool } from "../db";

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "chart_setup_enrich_runs" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "symbol" text NOT NULL,
  "trading_day_key" text,
  "theme_id" text,
  "dossier" jsonb,
  "result" jsonb NOT NULL,
  "include_visual" boolean DEFAULT false,
  "source" text DEFAULT 'llm',
  "created_at" timestamp DEFAULT now()
)`,
  `CREATE TABLE IF NOT EXISTS "chart_enrich_feedback" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "enrich_run_id" integer,
  "symbol" text NOT NULL,
  "helpful" text NOT NULL,
  "correction_kind" text,
  "corrected_lifecycle" text,
  "corrected_pattern" text,
  "note" text,
  "enrich_snapshot" jsonb,
  "dossier" jsonb,
  "created_at" timestamp DEFAULT now()
)`,
  `CREATE TABLE IF NOT EXISTS "chart_enrich_models" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "enrich_run_id" integer,
  "feedback_id" integer,
  "symbol" text NOT NULL,
  "tier" text NOT NULL,
  "scopes" text[] DEFAULT '{}' NOT NULL,
  "pattern_label" text,
  "pattern_cleanliness" text,
  "lifecycle_stage" text,
  "note" text,
  "enrich_snapshot" jsonb,
  "dossier" jsonb,
  "apply_flag" boolean DEFAULT true,
  "created_at" timestamp DEFAULT now()
)`,
];

(async () => {
  await initializeDatabase();
  const pool = getPool();
  if (!pool) {
    console.error("Database unavailable. Set DATABASE_URL and retry.");
    process.exit(1);
  }
  try {
    for (const sql of STATEMENTS) {
      await pool.query(sql);
    }
    console.log("Chart setup enrich tables are present.");
    process.exit(0);
  } catch (e) {
    console.error("ensureChartSetupEnrichTables failed:", e);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
