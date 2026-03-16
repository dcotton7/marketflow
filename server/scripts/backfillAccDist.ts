#!/usr/bin/env tsx
/**
 * Backfill Accumulation/Distribution Streaks
 * 
 * Fetches last 5 days of price bars and calculates consecutive up/down streaks.
 * Updates fundamentals_cache.acc_dist_days and theme_snapshots.acc_dist_days.
 * 
 * Usage:
 *   npx tsx server/scripts/backfillAccDist.ts
 *   DRY_RUN=1 npx tsx server/scripts/backfillAccDist.ts  # Test mode
 * 
 * Logic (William O'Neal style):
 *   - Compare each day's close vs previous day's close
 *   - Build consecutive streaks: positive = accumulation, negative = distribution
 *   - Most recent streak is stored (e.g., +3 = 3 days up in a row, -2 = 2 days down)
 */

import 'dotenv/config';
import { initializeDatabase, db } from '../db';
import { tickers } from '@shared/schema';
import { getAllUniverseTickers } from '../market-condition/universe';
import { getAlpacaProvider } from '../market-condition/providers/alpaca';
import { eq } from 'drizzle-orm';

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const DAYS_TO_FETCH = 5;
const BATCH_SIZE = 50; // Alpaca allows multi-symbol requests

interface DailyBar {
  date: Date;
  close: number;
}

/**
 * Calculate A/D streak from daily bars
 * Returns: positive for accumulation days, negative for distribution days, 0 for flat
 */
function calculateAccDistStreak(bars: DailyBar[]): number {
  if (bars.length < 2) return 0;
  
  // Sort by date ascending
  bars.sort((a, b) => a.date.getTime() - b.date.getTime());
  
  let streak = 0;
  let currentDirection: 'up' | 'down' | null = null;
  
  for (let i = 1; i < bars.length; i++) {
    const prevClose = bars[i - 1].close;
    const currClose = bars[i].close;
    
    if (currClose > prevClose) {
      // Up day (accumulation)
      if (currentDirection === 'up') {
        streak++;
      } else {
        currentDirection = 'up';
        streak = 1;
      }
    } else if (currClose < prevClose) {
      // Down day (distribution)
      if (currentDirection === 'down') {
        streak--;
      } else {
        currentDirection = 'down';
        streak = -1;
      }
    }
    // If equal, don't change streak
  }
  
  return streak;
}

async function main() {
  console.log(`\n${'='.repeat(60)}`);
  console.log('A/D Backfill Script (5-Day Lookback)');
  console.log(`${'='.repeat(60)}\n`);
  
  if (DRY_RUN) {
    console.log('🔍 DRY RUN MODE - No database updates will be made\n');
  }
  
  await initializeDatabase();
  if (!db) {
    console.error('❌ Database not available');
    process.exit(1);
  }
  
  const alpaca = getAlpacaProvider();
  const tickers = getAllUniverseTickers();
  
  console.log(`📊 Processing ${tickers.length} tickers (${DAYS_TO_FETCH} days of history)`);
  console.log(`⚡ Using multi-symbol batching (${BATCH_SIZE} symbols per request)\n`);
  
  const stats = {
    processed: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    accumulation: 0, // Positive streak
    distribution: 0, // Negative streak
    flat: 0, // No streak
  };
  
  // Process in batches for Alpaca multi-symbol endpoint
  const batches = [];
  for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
    batches.push(tickers.slice(i, i + BATCH_SIZE));
  }
  
  console.log(`📥 Fetching historical bars (${batches.length} batches)...\n`);
  
  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];
    
    try {
      // Fetch bars for all symbols in batch
      const barsMap = new Map<string, DailyBar[]>();
      
      for (const symbol of batch) {
        try {
          const bars = await alpaca.getHistoricalBars(symbol, DAYS_TO_FETCH + 2); // Extra buffer for weekends
          
          if (bars.length >= 2) {
            barsMap.set(symbol, bars.map(b => ({
              date: b.timestamp,
              close: b.close,
            })));
          }
        } catch (error) {
          // Symbol fetch failed, skip it
          stats.errors++;
        }
      }
      
      // Calculate A/D for each symbol
      for (const symbol of batch) {
        stats.processed++;
        
        const bars = barsMap.get(symbol);
        if (!bars || bars.length < 2) {
          stats.skipped++;
          if (stats.skipped <= 10) {
            console.log(`  ⚠️  ${symbol}: Insufficient bar data (need at least 2 days)`);
          }
          continue;
        }
        
        const accDistDays = calculateAccDistStreak(bars);
        
        if (accDistDays > 0) {
          stats.accumulation++;
        } else if (accDistDays < 0) {
          stats.distribution++;
        } else {
          stats.flat++;
        }
        
        if (!DRY_RUN) {
          try {
            await db.update(tickers)
              .set({ accDistDays: accDistDays })
              .where(eq(tickers.symbol, symbol));
            
            stats.updated++;
            
            if (stats.updated <= 30 || stats.updated % 100 === 0) {
              const label = accDistDays > 0 ? 'A' : accDistDays < 0 ? 'D' : '—';
              const display = accDistDays !== 0 ? `${label}:${Math.abs(accDistDays)}` : '—';
              console.log(`  ✓ ${symbol}: ${display}`);
            }
          } catch (error) {
            stats.errors++;
            console.error(`  ❌ ${symbol}: Update failed`, error);
          }
        } else {
          stats.updated++;
          if (stats.updated <= 30) {
            const label = accDistDays > 0 ? 'A' : accDistDays < 0 ? 'D' : '—';
            const display = accDistDays !== 0 ? `${label}:${Math.abs(accDistDays)}` : '—';
            console.log(`  [DRY RUN] ${symbol}: ${display}`);
          }
        }
      }
      
      const progress = ((batchIdx + 1) / batches.length * 100).toFixed(0);
      console.log(`\n  Batch ${batchIdx + 1}/${batches.length} complete (${progress}%)\n`);
      
    } catch (error) {
      console.error(`\n  ❌ Batch ${batchIdx + 1} failed:`, error);
    }
  }
  
  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log('Summary');
  console.log(`${'='.repeat(60)}`);
  console.log(`Processed:     ${stats.processed}`);
  console.log(`Updated:       ${stats.updated}`);
  console.log(`Skipped:       ${stats.skipped}`);
  console.log(`Errors:        ${stats.errors}`);
  console.log(`\nA/D Distribution:`);
  console.log(`  Accumulation: ${stats.accumulation} (${(stats.accumulation / stats.updated * 100).toFixed(1)}%)`);
  console.log(`  Distribution: ${stats.distribution} (${(stats.distribution / stats.updated * 100).toFixed(1)}%)`);
  console.log(`  Flat:         ${stats.flat} (${(stats.flat / stats.updated * 100).toFixed(1)}%)`);
  
  if (DRY_RUN) {
    console.log(`\n✅ Dry run complete - no changes made`);
  } else {
    console.log(`\n✅ A/D backfill complete`);
  }
  
  process.exit(0);
}

main();
