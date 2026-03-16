#!/usr/bin/env tsx
/**
 * Check if A/D data exists in tickers table
 */
import 'dotenv/config';
import { initializeDatabase, db } from '../db';
import { tickers } from '@shared/schema';
import { isNotNull } from 'drizzle-orm';

async function checkAccDistData() {
  if (!db) {
    console.error('Database not available');
    process.exit(1);
  }

  console.log('[CheckAccDist] Querying A/D data from tickers table...\n');

  // Get all tickers with A/D data
  const results = await db
    .select({
      symbol: tickers.symbol,
      accDistDays: tickers.accDistDays,
      themeId: tickers.themeId,
    })
    .from(tickers)
    .where(isNotNull(tickers.accDistDays))
    .limit(50);

  console.log(`Found ${results.length} tickers with A/D data (showing first 50):\n`);

  for (const row of results) {
    console.log(`${row.symbol.padEnd(8)} A/D: ${String(row.accDistDays).padStart(3)} Theme: ${row.themeId || 'NULL'}`);
  }

  // Get count of tickers with non-zero A/D
  const allResults = await db
    .select({
      accDistDays: tickers.accDistDays,
    })
    .from(tickers);

  const total = allResults.length;
  const withAD = allResults.filter(r => r.accDistDays !== null && r.accDistDays !== undefined).length;
  const nonZero = allResults.filter(r => r.accDistDays && r.accDistDays !== 0).length;

  console.log(`\nSummary:`);
  console.log(`Total tickers: ${total}`);
  console.log(`With A/D data: ${withAD}`);
  console.log(`Non-zero A/D: ${nonZero}`);
}

(async () => {
  await initializeDatabase();
  await checkAccDistData();
  process.exit(0);
})();
