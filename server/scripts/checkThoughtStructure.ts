#!/usr/bin/env tsx
import 'dotenv/config';
import { initializeDatabase, db } from '../db';
import { scannerThoughts } from '../../shared/schema';
import { desc } from 'drizzle-orm';

async function checkStructure() {
  if (!db) {
    console.error('Database not available');
    process.exit(1);
  }
  
  const thoughts = await db
    .select()
    .from(scannerThoughts)
    .orderBy(desc(scannerThoughts.id))
    .limit(3);
  
  console.log('\n=== SAMPLE THOUGHT STRUCTURES ===\n');
  
  for (const thought of thoughts) {
    console.log(`Thought #${thought.id}: "${thought.name}"`);
    console.log('Criteria structure:', JSON.stringify(thought.thoughtCriteria, null, 2));
    console.log('\n---\n');
  }
}

(async () => {
  await initializeDatabase();
  await checkStructure();
  process.exit(0);
})();
