#!/usr/bin/env tsx
/**
 * Creates Start Here tables without interactive drizzle-kit prompts.
 * Safe to run repeatedly (IF NOT EXISTS).
 */
import "dotenv/config";
import { initializeDatabase, getPool } from "../db";

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "start_here_workspaces" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "workspace_id" text NOT NULL,
  "name" text NOT NULL,
  "dashboard" jsonb NOT NULL,
  "extras" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "start_here_workspaces_user_id_sentinel_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."sentinel_users"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "start_here_workspaces_user_id_workspace_id_unique" UNIQUE("user_id","workspace_id")
)`,
  `CREATE TABLE IF NOT EXISTS "start_here_user_state" (
  "user_id" integer PRIMARY KEY NOT NULL,
  "active_workspace_id" text,
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "start_here_user_state_user_id_sentinel_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."sentinel_users"("id") ON DELETE cascade ON UPDATE no action
)`,
];

(async () => {
  await initializeDatabase();
  const pool = getPool();
  if (!pool) {
    console.error("Database unavailable. Set DATABASE_URL (see .env) and retry.");
    process.exit(1);
  }
  try {
    for (const sql of STATEMENTS) {
      await pool.query(sql);
      console.log("Executed:", sql.split("\n")[0] + " …");
    }
    console.log("Start Here tables are present.");
    process.exit(0);
  } catch (e) {
    console.error("ensureStartHereTables failed:", e);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
