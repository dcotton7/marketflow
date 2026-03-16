#!/usr/bin/env tsx
/**
 * Refresh Market Caps & Size Categories
 * 
 * Fetches current market cap data and categorizes tickers by size.
 * Updates fundamentals_cache with market_cap and market_cap_size.
 * 
 * Usage:
 *   npx tsx server/scripts/refreshMarketCaps.ts
 *   DRY_RUN=1 npx tsx server/scripts/refreshMarketCaps.ts  # Test mode
 * 
 * Size Categories:
 *   MEGA:  >$200B
 *   LARGE: $10B - $200B
 *   MID:   $2B - $10B
 *   SMALL: $300M - $2B
 *   MICRO: <$300M
 */

import 'dotenv/config';
import { initializeDatabase, db } from '../db';
import { tickers } from '@shared/schema';
import { getAllUniverseTickers } from '../market-condition/universe';
import { eq } from 'drizzle-orm';

const FMP_BASE = 'https://financialmodelingprep.com/stable';
const FMP_API_KEY = process.env.FMP_API_KEY;
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

const BATCH_SIZE = 100;
const DELAY_MS = 1000;

type SizeCategory = 'MEGA' | 'LARGE' | 'MID' | 'SMALL' | 'MICRO';

function categorizeMarketCap(marketCap: number): SizeCategory {
  if (marketCap >= 200e9) return 'MEGA';
  if (marketCap >= 10e9) return 'LARGE';
  if (marketCap >= 2e9) return 'MID';
  if (marketCap >= 300e6) return 'SMALL';
  return 'MICRO';
}

async function fetchFmpBatch(symbols: string[]): Promise<Map<string, number>> {
  if (!FMP_API_KEY) return new Map();
  
  const url = `${FMP_BASE}/market-capitalization-batch?symbols=${encodeURIComponent(symbols.join(','))}&apikey=${FMP_API_KEY}`;
  const result = new Map<string, number>();
  
  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      console.warn(`[FMP] Batch request failed: ${resp.status}`);
      return result;
    }
    
    const data = await resp.json();
    if (Array.isArray(data)) {
      for (const item of data) {
        if (item.symbol && item.marketCap && item.marketCap > 0) {
          result.set(item.symbol.toUpperCase(), item.marketCap);
        }
      }
    }
  } catch (error) {
    console.error('[FMP] Batch fetch error:', error);
  }
  
  return result;
}

async function fetchFinnhubSingle(symbol: string): Promise<number | null> {
  if (!FINNHUB_API_KEY) return null;
  
  try {
    const url = `https://finnhub.io/api/v1/stock/metric?symbol=${symbol}&metric=all&token=${FINNHUB_API_KEY}`;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    
    const data = await resp.json();
    const marketCap = data?.metric?.marketCapitalization;
    return marketCap && marketCap > 0 ? marketCap * 1e6 : null; // Convert millions to actual value
  } catch (error) {
    console.error(`[Finnhub] Error fetching ${symbol}:`, error);
    return null;
  }
}

async function main() {
  console.log(`\n${'='.repeat(60)}`);
  console.log('Market Cap Refresh Script');
  console.log(`${'='.repeat(60)}\n`);
  
  if (DRY_RUN) {
    console.log('🔍 DRY RUN MODE - No database updates will be made\n');
  }
  
  if (!FMP_API_KEY && !FINNHUB_API_KEY) {
    console.error('❌ Set FMP_API_KEY and/or FINNHUB_API_KEY in .env');
    process.exit(1);
  }
  
  await initializeDatabase();
  if (!db) {
    console.error('❌ Database not available');
    process.exit(1);
  }
  
  // Get all universe tickers
  const tickers = getAllUniverseTickers();
  console.log(`📊 Processing ${tickers.length} tickers\n`);
  
  const stats = {
    processed: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    bySizeCategory: { MEGA: 0, LARGE: 0, MID: 0, SMALL: 0, MICRO: 0 } as Record<SizeCategory, number>,
  };
  
  // Batch fetch from FMP
  const marketCapData = new Map<string, number>();
  
  if (FMP_API_KEY) {
    console.log('📥 Fetching market caps from FMP (batched)...');
    for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
      const batch = tickers.slice(i, i + BATCH_SIZE);
      const batchData = await fetchFmpBatch(batch);
      
      for (const [symbol, marketCap] of batchData) {
        marketCapData.set(symbol, marketCap);
      }
      
      console.log(`  ✓ Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(tickers.length / BATCH_SIZE)} complete (${batchData.size} symbols)`);
      
      if (i + BATCH_SIZE < tickers.length) {
        await new Promise(resolve => setTimeout(resolve, DELAY_MS));
      }
    }
    console.log(`✓ FMP batch complete: ${marketCapData.size} market caps fetched\n`);
  }
  
  // Process each ticker
  console.log('💾 Updating database...\n');
  
  for (const symbol of tickers) {
    stats.processed++;
    
    let marketCap = marketCapData.get(symbol.toUpperCase());
    
    // Fallback to Finnhub if FMP didn't return data
    if (!marketCap && FINNHUB_API_KEY) {
      marketCap = await fetchFinnhubSingle(symbol) || undefined;
      if (marketCap) {
        console.log(`  [Finnhub] ${symbol}: $${(marketCap / 1e9).toFixed(2)}B`);
        await new Promise(resolve => setTimeout(resolve, 1100)); // Rate limit
      }
    }
    
    if (!marketCap || marketCap === 0) {
      stats.skipped++;
      if (stats.skipped <= 10) {
        console.log(`  ⚠️  ${symbol}: No market cap data available`);
      }
      continue;
    }
    
    const sizeCategory = categorizeMarketCap(marketCap);
    stats.bySizeCategory[sizeCategory]++;
    
    if (!DRY_RUN) {
      try {
        await db.update(tickers)
          .set({
            marketCap,
            marketCapSize: sizeCategory,
          })
          .where(eq(tickers.symbol, symbol));
        
        stats.updated++;
        
        if (stats.updated <= 20 || stats.updated % 100 === 0) {
          console.log(`  ✓ ${symbol}: $${(marketCap / 1e9).toFixed(2)}B (${sizeCategory})`);
        }
      } catch (error) {
        stats.errors++;
        console.error(`  ❌ ${symbol}: Update failed`, error);
      }
    } else {
      stats.updated++;
      if (stats.updated <= 20) {
        console.log(`  [DRY RUN] ${symbol}: $${(marketCap / 1e9).toFixed(2)}B (${sizeCategory})`);
      }
    }
  }
  
  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log('Summary');
  console.log(`${'='.repeat(60)}`);
  console.log(`Processed: ${stats.processed}`);
  console.log(`Updated:   ${stats.updated}`);
  console.log(`Skipped:   ${stats.skipped}`);
  console.log(`Errors:    ${stats.errors}`);
  console.log(`\nBy Size Category:`);
  console.log(`  MEGA:  ${stats.bySizeCategory.MEGA} (>$200B)`);
  console.log(`  LARGE: ${stats.bySizeCategory.LARGE} ($10B-$200B)`);
  console.log(`  MID:   ${stats.bySizeCategory.MID} ($2B-$10B)`);
  console.log(`  SMALL: ${stats.bySizeCategory.SMALL} ($300M-$2B)`);
  console.log(`  MICRO: ${stats.bySizeCategory.MICRO} (<$300M)`);
  
  if (DRY_RUN) {
    console.log(`\n✅ Dry run complete - no changes made`);
  } else {
    console.log(`\n✅ Market cap refresh complete`);
  }
  
  process.exit(0);
}

main();
