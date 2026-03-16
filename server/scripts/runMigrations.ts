#!/usr/bin/env tsx
/**
 * Run all migration SQL files in order
 * 
 * Usage:
 *   npx tsx server/scripts/runMigrations.ts
 */
import 'dotenv/config';
import { initializeDatabase, db } from '../db';
import { readFileSync } from 'fs';
import { join } from 'path';
import { sql } from 'drizzle-orm';

const MIGRATIONS = [
  '001_create_themes_table.sql',
  '002_rename_fundamentals_to_tickers.sql',
  '003_create_fundamental_snapshots.sql',
  '004_create_acc_dist_log.sql',
  '005_create_user_indicators.sql',
];

async function runMigrations() {
  if (!db) {
    console.error('Database not available');
    process.exit(1);
  }

  console.log(`[Migrations] Running ${MIGRATIONS.length} migration files...\n`);

  for (const filename of MIGRATIONS) {
    const filepath = join(process.cwd(), 'migrations', filename);
    
    try {
      console.log(`[${filename}] Reading...`);
      const sqlContent = readFileSync(filepath, 'utf-8');
      
      console.log(`[${filename}] Executing...`);
      await db.execute(sql.raw(sqlContent));
      
      console.log(`[${filename}] ✓ Complete\n`);
    } catch (error: any) {
      console.error(`[${filename}] ✗ FAILED:`, error.message);
      console.error('Stopping migration process.');
      process.exit(1);
    }
  }

  console.log('[Migrations] All migrations completed successfully!');
}

(async () => {
  await initializeDatabase();
  await runMigrations();
  process.exit(0);
})();
