#!/usr/bin/env tsx
/**
 * Ensure all universe tickers exist in tickers table
 * Creates stub records for missing tickers so theme assignment can complete
 * 
 * Usage:
 *   npx tsx server/scripts/ensureAllUniverseTickers.ts
 */
import 'dotenv/config';
import { initializeDatabase, db } from '../db';
import { tickers } from '@shared/schema';
import { getAllUniverseTickers } from '../market-condition/universe';

async function ensureAllTickers() {
  if (!db) {
    console.error('Database not available');
    process.exit(1);
  }

  const universeTickers = getAllUniverseTickers();
  console.log(`[EnsureTickers] Checking ${universeTickers.length} universe tickers...`);

  // Get existing tickers
  const existing = await db.select({ symbol: tickers.symbol }).from(tickers);
  const existingSet = new Set(existing.map(r => r.symbol.toUpperCase()));

  const missing = universeTickers.filter(t => !existingSet.has(t.toUpperCase()));
  
  if (missing.length === 0) {
    console.log('[EnsureTickers] All universe tickers already exist in database');
    return;
  }

  console.log(`[EnsureTickers] Found ${missing.length} missing tickers, inserting stubs...`);

  let inserted = 0;
  for (const symbol of missing) {
    try {
      await db.insert(tickers).values({
        symbol: symbol.toUpperCase(),
        sector: 'Unknown',
        industry: 'Unknown',
        marketCap: 0,
        fetchedAt: new Date(),
      }).onConflictDoNothing();
      
      inserted++;
      
      if (inserted <= 20 || inserted % 50 === 0) {
        console.log(`  ✓ ${symbol}`);
      }
    } catch (error) {
      console.error(`  ✗ Failed to insert ${symbol}:`, error);
    }
  }

  console.log(`\n[EnsureTickers] Complete: ${inserted} new tickers added`);
  console.log('Run refreshMarketCaps.ts and backfillFundamentals.ts to enrich these tickers');
}

(async () => {
  await initializeDatabase();
  await ensureAllTickers();
  process.exit(0);
})();
