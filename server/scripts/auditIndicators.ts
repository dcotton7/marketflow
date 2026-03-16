#!/usr/bin/env tsx
/**
 * Audit the indicator library for duplicates, overlaps, and usage statistics
 */
import 'dotenv/config';
import { initializeDatabase, db } from '../db';
import { INDICATOR_LIBRARY } from '../bigidea/indicators';
import { scannerThoughts } from '../../shared/schema';
import { sql } from 'drizzle-orm';

async function auditIndicators() {
  console.log('\n=== INDICATOR LIBRARY AUDIT ===\n');
  
  // 1. Count by category
  const byCategory: Record<string, number> = {};
  for (const ind of INDICATOR_LIBRARY) {
    byCategory[ind.category] = (byCategory[ind.category] || 0) + 1;
  }
  
  console.log('## Indicators by Category:');
  for (const [cat, count] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat}: ${count}`);
  }
  console.log(`  TOTAL: ${INDICATOR_LIBRARY.length}\n`);
  
  // 2. Find indicators with similar names or descriptions
  console.log('## Potential Duplicates (similar names):');
  const processed = new Set<string>();
  let foundDuplicates = false;
  
  for (let i = 0; i < INDICATOR_LIBRARY.length; i++) {
    for (let j = i + 1; j < INDICATOR_LIBRARY.length; j++) {
      const ind1 = INDICATOR_LIBRARY[i];
      const ind2 = INDICATOR_LIBRARY[j];
      const key = `${ind1.id}-${ind2.id}`;
      if (processed.has(key)) continue;
      
      const name1Lower = ind1.name.toLowerCase();
      const name2Lower = ind2.name.toLowerCase();
      
      // Check for similar names
      const words1 = name1Lower.split(/\s+/);
      const words2 = name2Lower.split(/\s+/);
      const commonWords = words1.filter(w => words2.includes(w) && w.length > 3);
      
      if (commonWords.length >= 2 || (commonWords.length === 1 && words1.length <= 3)) {
        console.log(`  ⚠️  ${ind1.id} "${ind1.name}" ↔ ${ind2.id} "${ind2.name}"`);
        console.log(`      Common: ${commonWords.join(', ')}`);
        foundDuplicates = true;
        processed.add(key);
      }
    }
  }
  if (!foundDuplicates) console.log('  ✓ No obvious name duplicates found\n');
  else console.log('');
  
  // 3. Check database usage
  if (!db) {
    console.log('## Usage Statistics: Database not available\n');
    return;
  }
  
  console.log('## Usage Statistics (from saved thoughts):');
  
  try {
    const thoughts = await db.select().from(scannerThoughts);
    const indicatorUsage: Record<string, number> = {};
    
    for (const thought of thoughts) {
      const criteria = thought.thoughtCriteria as any[];
      if (!criteria) continue;
      
      for (const crit of criteria) {
        const indicatorId = crit.indicatorId;
        if (indicatorId) {
          indicatorUsage[indicatorId] = (indicatorUsage[indicatorId] || 0) + 1;
        }
      }
    }
    
    const sorted = Object.entries(indicatorUsage).sort((a, b) => b[1] - a[1]);
    
    console.log(`  Total thoughts: ${thoughts.length}`);
    console.log(`  Unique indicators used: ${sorted.length} / ${INDICATOR_LIBRARY.length}\n`);
    
    console.log('  Top 10 Most Used:');
    for (const [id, count] of sorted.slice(0, 10)) {
      const ind = INDICATOR_LIBRARY.find(i => i.id === id);
      console.log(`    ${id} "${ind?.name || 'Unknown'}": ${count} uses`);
    }
    
    console.log('\n  Never Used Indicators:');
    const usedIds = new Set(sorted.map(([id]) => id));
    const neverUsed = INDICATOR_LIBRARY.filter(ind => !usedIds.has(ind.id));
    
    if (neverUsed.length === 0) {
      console.log('    ✓ All indicators have been used at least once');
    } else {
      for (const ind of neverUsed) {
        console.log(`    ${ind.id} "${ind.name}" (${ind.category})`);
      }
    }
    
  } catch (error: any) {
    console.error('  Error querying database:', error.message);
  }
  
  console.log('\n=== END AUDIT ===\n');
}

(async () => {
  await initializeDatabase();
  await auditIndicators();
  process.exit(0);
})();
