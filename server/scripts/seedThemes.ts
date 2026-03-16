#!/usr/bin/env tsx
/**
 * Seed themes table from universe.ts CLUSTERS definitions
 * 
 * Usage:
 *   npx tsx server/scripts/seedThemes.ts
 */
import 'dotenv/config';
import { initializeDatabase, db } from '../db';
import { themes } from '@shared/schema';
import { CLUSTERS } from '../market-condition/universe';

async function seedThemes() {
  if (!db) {
    console.error('Database not available');
    process.exit(1);
  }

  console.log(`[SeedThemes] Seeding ${CLUSTERS.length} themes from universe.ts...`);

  let inserted = 0;
  let updated = 0;

  for (const cluster of CLUSTERS) {
    try {
      const themeData = {
        id: cluster.id,
        name: cluster.name,
        tier: cluster.tier,
        leadersTarget: cluster.leadersTarget,
        notes: cluster.notes,
        etfProxies: cluster.etfProxies,
        updatedAt: new Date(),
      };

      const result = await db
        .insert(themes)
        .values(themeData)
        .onConflictDoUpdate({
          target: themes.id,
          set: themeData,
        });

      // Check if it was an insert or update (rough heuristic)
      if (result.rowCount === 1) {
        inserted++;
      } else {
        updated++;
      }

      console.log(`  ✓ ${cluster.id} - ${cluster.name}`);
    } catch (error) {
      console.error(`  ✗ Failed to seed theme ${cluster.id}:`, error);
    }
  }

  console.log(`\n[SeedThemes] Complete: ${inserted} inserted, ${updated} updated`);
}

(async () => {
  await initializeDatabase();
  await seedThemes();
  process.exit(0);
})();
