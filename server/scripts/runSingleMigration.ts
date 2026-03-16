#!/usr/bin/env tsx
/**
 * Run a single migration SQL file
 * 
 * Usage:
 *   npx tsx server/scripts/runSingleMigration.ts <filename>
 */
import 'dotenv/config';
import { initializeDatabase, db } from '../db';
import { readFileSync } from 'fs';
import { join } from 'path';
import { sql } from 'drizzle-orm';

async function runSingleMigration(filename: string) {
  if (!db) {
    console.error('Database not available');
    process.exit(1);
  }

  console.log(`[Migration] Running ${filename}...\n`);

  const filepath = join(process.cwd(), 'migrations', filename);
  
  try {
    console.log(`[${filename}] Reading...`);
    const sqlContent = readFileSync(filepath, 'utf-8');
    
    console.log(`[${filename}] Executing...`);
    await db.execute(sql.raw(sqlContent));
    
    console.log(`[${filename}] ✓ Complete\n`);
  } catch (error: any) {
    console.error(`[${filename}] ✗ FAILED:`, error.message);
    process.exit(1);
  }

  console.log('[Migration] Complete!');
}

(async () => {
  const filename = process.argv[2];
  if (!filename) {
    console.error('Usage: npx tsx server/scripts/runSingleMigration.ts <filename>');
    process.exit(1);
  }

  await initializeDatabase();
  await runSingleMigration(filename);
  process.exit(0);
})();
