#!/usr/bin/env tsx
/**
 * Seed theme_id and is_core in tickers table from universe.ts CLUSTERS
 * 
 * Usage:
 *   npx tsx server/scripts/seedThemeMembers.ts
 */
import 'dotenv/config';
import { initializeDatabase, db } from '../db';
import { tickers } from '@shared/schema';
import { CLUSTERS } from '../market-condition/universe';
import { eq } from 'drizzle-orm';

async function seedThemeMembers() {
  if (!db) {
    console.error('Database not available');
    process.exit(1);
  }

  console.log(`[SeedThemeMembers] Assigning tickers to themes from universe.ts...`);

  let assigned = 0;
  let notFound = 0;
  const notFoundSymbols: string[] = [];

  for (const cluster of CLUSTERS) {
    console.log(`\n[${cluster.id}] Processing ${cluster.core.length} core + ${cluster.candidates.length} candidates...`);

    // Assign core members
    for (const symbol of cluster.core) {
      try {
        const result = await db
          .update(tickers)
          .set({
            themeId: cluster.id,
            isCore: true,
          })
          .where(eq(tickers.symbol, symbol));

        if (result.rowCount === 0) {
          notFound++;
          notFoundSymbols.push(symbol);
          console.log(`  ⚠ ${symbol} not found in tickers table (core)`);
        } else {
          assigned++;
        }
      } catch (error) {
        console.error(`  ✗ Failed to assign ${symbol}:`, error);
      }
    }

    // Assign candidate members
    for (const symbol of cluster.candidates) {
      try {
        const result = await db
          .update(tickers)
          .set({
            themeId: cluster.id,
            isCore: false,
          })
          .where(eq(tickers.symbol, symbol));

        if (result.rowCount === 0) {
          notFound++;
          notFoundSymbols.push(symbol);
          console.log(`  ⚠ ${symbol} not found in tickers table (candidate)`);
        } else {
          assigned++;
        }
      } catch (error) {
        console.error(`  ✗ Failed to assign ${symbol}:`, error);
      }
    }
  }

  console.log(`\n[SeedThemeMembers] Complete: ${assigned} assigned, ${notFound} not found`);
  
  if (notFoundSymbols.length > 0) {
    console.log(`\nNot found symbols (need to be added to tickers table first):`);
    console.log(notFoundSymbols.join(', '));
  }
}

(async () => {
  await initializeDatabase();
  await seedThemeMembers();
  process.exit(0);
})();
