/**
 * Run SQL migration script
 * Usage: tsx scripts/run-migration.ts migrations/add_acc_dist_days.sql
 */

import { config } from "dotenv";
config(); // Load .env file

import { initializeDatabase } from "../server/db";
import * as fs from "fs";
import * as path from "path";

async function runMigration(migrationFile: string) {
  console.log(`[Migration] Running: ${migrationFile}`);
  
  const db = await initializeDatabase();
  if (!db) {
    console.error("[Migration] Database not available");
    process.exit(1);
  }
  
  const sqlPath = path.join(process.cwd(), migrationFile);
  if (!fs.existsSync(sqlPath)) {
    console.error(`[Migration] File not found: ${sqlPath}`);
    process.exit(1);
  }
  
  const sql = fs.readFileSync(sqlPath, "utf-8");
  
  try {
    await db.execute(sql);
    console.log("[Migration] ✓ Migration completed successfully");
  } catch (error) {
    console.error("[Migration] ✗ Migration failed:", error);
    process.exit(1);
  }
  
  process.exit(0);
}

const migrationFile = process.argv[2];
if (!migrationFile) {
  console.error("Usage: tsx scripts/run-migration.ts <migration-file>");
  process.exit(1);
}

runMigration(migrationFile);
