#!/usr/bin/env tsx
/**
 * Clean broken "Consecutive Up Days" indicators from database
 * 
 * These were created by AI hallucination, mapping to wrong indicators (PA-7, PA-3, PA-10)
 * while labeling them as "Consecutive Up Days"
 */
import 'dotenv/config';
import { initializeDatabase, db } from '../db';
import { scannerThoughts, scannerIdeas } from '@shared/schema';
import { like, or } from 'drizzle-orm';

async function cleanBrokenIndicators() {
  if (!db) {
    console.error('Database not available');
    process.exit(1);
  }

  console.log('[Clean] Searching for broken "Consecutive" indicators...\n');

  // Find thoughts with "Consecutive" in the name
  const brokenThoughts = await db
    .select()
    .from(scannerThoughts)
    .where(
      or(
        like(scannerThoughts.name, '%Consecutive%'),
        like(scannerThoughts.name, '%consecutive%')
      )
    );

  console.log(`[Clean] Found ${brokenThoughts.length} thought(s) with "Consecutive" in name:`);
  
  for (const thought of brokenThoughts) {
    const criteria = thought.criteria as any[];
    const indicatorIds = criteria.map(c => c.indicatorId).join(', ');
    
    console.log(`  - ID ${thought.id}: "${thought.name}"`);
    console.log(`    Category: ${thought.category}, Timeframe: ${thought.timeframe}`);
    console.log(`    Criteria: ${criteria.length} criterion(a) - Indicators: [${indicatorIds}]`);
    console.log(`    Description: ${thought.description?.substring(0, 100)}...`);
    
    // Check if any criteria use PA-7, PA-3, or PA-10 (indicators that don't detect consecutive days)
    const hasMismappedIndicator = criteria.some(c => 
      ['PA-7', 'PA-3', 'PA-10'].includes(c.indicatorId)
    );
    
    if (hasMismappedIndicator) {
      console.log(`    ⚠️  BROKEN: Uses wrong indicator (PA-7/PA-3/PA-10 don't detect consecutive days)`);
    }
  }

  console.log('\n[Clean] Checking if these thoughts are used in any Ideas...\n');

  // Check scanner_ideas for usage
  const allIdeas = await db.select().from(scannerIdeas);
  const usedThoughtIds = new Set<number>();
  
  for (const idea of allIdeas) {
    const nodes = idea.nodes as any[];
    const thoughtNodes = nodes.filter(n => n.type === 'thought' && n.thoughtId);
    
    for (const node of thoughtNodes) {
      if (brokenThoughts.some(t => t.id === node.thoughtId)) {
        usedThoughtIds.add(node.thoughtId);
        console.log(`  ⚠️  Thought ID ${node.thoughtId} is used in Idea "${idea.name}" (ID: ${idea.id})`);
      }
    }
  }

  if (brokenThoughts.length === 0) {
    console.log('\n[Clean] No broken indicators found. All clear!');
    return;
  }

  console.log('\n[Clean] Summary:');
  console.log(`  - Total broken thoughts: ${brokenThoughts.length}`);
  console.log(`  - Used in Ideas: ${usedThoughtIds.size}`);
  console.log(`  - Safe to delete: ${brokenThoughts.length - usedThoughtIds.size}`);

  const safeToDelete = brokenThoughts.filter(t => !usedThoughtIds.has(t.id));
  
  if (safeToDelete.length > 0) {
    console.log('\n[Clean] Deleting broken thoughts not used in any Ideas...');
    
    for (const thought of safeToDelete) {
      const { eq } = await import('drizzle-orm');
      await db.delete(scannerThoughts).where(eq(scannerThoughts.id, thought.id));
      console.log(`  ✓ Deleted thought ID ${thought.id}: "${thought.name}"`);
    }
  }

  if (usedThoughtIds.size > 0) {
    console.log('\n[Clean] ⚠️  WARNING: The following thoughts are BROKEN but still used in Ideas:');
    for (const id of usedThoughtIds) {
      const thought = brokenThoughts.find(t => t.id === id);
      console.log(`  - ID ${id}: "${thought?.name}"`);
    }
    console.log('\n  These should be manually reviewed and replaced with custom indicators.');
    console.log('  Ideas using them may produce incorrect results.');
  }

  console.log('\n[Clean] Done!');
}

(async () => {
  await initializeDatabase();
  await cleanBrokenIndicators();
  process.exit(0);
})();
