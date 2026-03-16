#!/usr/bin/env tsx
/**
 * Backfill fundamentals_cache with market cap. Uses FMP batch first (fast), falls back to Finnhub per-symbol.
 *
 * Usage:
 *   npx tsx server/scripts/backfillFundamentals.ts
 *
 * Env:
 *   FMP_API_KEY  - optional; if set, try FMP batch first (premium endpoint may 402 on free tier)
 *   FINNHUB_API_KEY - optional; used as fallback when FMP fails or returns partial
 *   BACKFILL_MISSING_ONLY=1 - only backfill symbols not already in cache with valid market_cap
 *
 * Dry-run: temporarily set tickers to getUniverseTickers('sp500').slice(0, 10) below.
 */
import 'dotenv/config';
import { initializeDatabase, db } from '../db';
import { tickers } from '@shared/schema';
import { getUniverseTickers } from '../bigidea/universes';
import { gt } from 'drizzle-orm';
import * as finnhub from '../finnhub';

const FMP_BASE = 'https://financialmodelingprep.com/stable';
const FMP_API_KEY = process.env.FMP_API_KEY;
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
const CHUNK = 100;
const PAUSE_MS = 1000; // 1s between chunks
const FINNHUB_BATCH = 1; // 1 at a time to respect Finnhub free tier 60/min
const FINNHUB_DELAY_MS = 1100; // ~55/min to stay under 60/min

/** When set (e.g. BACKFILL_MISSING_ONLY=1), only backfill symbols not already in cache with valid market_cap. */
const MISSING_ONLY = process.env.BACKFILL_MISSING_ONLY === '1' || process.env.BACKFILL_MISSING_ONLY === 'true';

if (!FMP_API_KEY && !FINNHUB_API_KEY) {
  console.error('Set FMP_API_KEY and/or FINNHUB_API_KEY in .env. Exiting.');
  process.exit(1);
}

async function getCachedSymbolsWithMarketCap(): Promise<Set<string>> {
  if (!db) return new Set();
  const rows = await db
    .select({ symbol: tickers.symbol })
    .from(tickers)
    .where(gt(tickers.marketCap, 0));
  return new Set(rows.map((r) => r.symbol.toUpperCase()));
}

async function fetchFmpBatch(symbols: string[]) {
  const url = `${FMP_BASE}/market-capitalization-batch?symbols=${encodeURIComponent(symbols.join(','))}&apikey=${FMP_API_KEY}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`FMP error ${resp.status}: ${txt}`);
  }
  const body = await resp.json();
  const arr = Array.isArray(body) ? body : Array.isArray(body.data) ? body.data : [];
  const map = new Map<string, number>();
  for (const row of arr) {
    const sym = (row.symbol ?? row.ticker ?? '').toString().toUpperCase();
    const cap = row.marketCap ?? row.market_cap ?? row.mktCap ?? 0;
    if (sym && Number(cap) > 0) map.set(sym, Number(cap));
  }
  return map;
}

async function upsert(symbol: string, marketCap: number, sector = 'Unknown', industry = 'Unknown', companyName: string | null = null, exchange: string | null = null) {
  if (!db) throw new Error('DB not initialized');
  const values: any = {
    symbol,
    sector,
    industry,
    marketCap,
    companyName,
    exchange,
    fetchedAt: new Date(),
  };
  await db.insert(tickers).values(values).onConflictDoUpdate({
    target: tickers.symbol,
    set: values,
  });
}

async function fetchFromFinnhub(symbol: string): Promise<{ marketCap: number; sector: string; industry: string; companyName?: string; exchange?: string } | null> {
  const profile = await finnhub.fetchCompanyProfile(symbol);
  if (!profile || !profile.marketCapitalization || profile.marketCapitalization <= 0) return null;
  const industry = profile.finnhubIndustry || 'Unknown';
  const sector = industry.toLowerCase().includes('software') || industry.toLowerCase().includes('technology') ? 'Technology'
    : industry.toLowerCase().includes('healthcare') || industry.toLowerCase().includes('pharma') ? 'Healthcare'
    : industry.toLowerCase().includes('bank') || industry.toLowerCase().includes('financial') ? 'Financials'
    : industry.toLowerCase().includes('consumer') || industry.toLowerCase().includes('retail') ? 'Consumer'
    : industry.toLowerCase().includes('energy') ? 'Energy'
    : industry.toLowerCase().includes('industrial') ? 'Industrials'
    : industry;
  return {
    marketCap: profile.marketCapitalization * 1e6,
    sector,
    industry,
    companyName: profile.name || undefined,
    exchange: profile.exchange || undefined,
  };
}

async function backfill(symbols: string[]) {
  let fmpTotal = 0;
  let finnhubTotal = 0;
  for (let i = 0; i < symbols.length; i += CHUNK) {
    const chunk = symbols.slice(i, i + CHUNK).map(s => s.toUpperCase());
    const chunkNum = Math.floor(i / CHUNK) + 1;
    let caps = new Map<string, number>();

    if (FMP_API_KEY) {
      try {
        caps = await fetchFmpBatch(chunk);
        fmpTotal += caps.size;
        console.log(`[Chunk ${chunkNum}] FMP: ${caps.size}/${chunk.length} caps`);
      } catch (err: any) {
        const is402 = err?.message?.includes('402');
        console.log(`[Chunk ${chunkNum}] FMP ${is402 ? '(premium)' : 'failed'}, falling back to Finnhub`);
      }
    }

    const missing = chunk.filter(s => !caps.has(s) || (caps.get(s) ?? 0) <= 0);
    for (const sym of chunk) {
      const cap = caps.get(sym) ?? 0;
      if (cap > 0) {
        try {
          await upsert(sym, cap);
        } catch (e) {
          console.error(`Upsert failed for ${sym}:`, e);
        }
      }
    }

    if (missing.length > 0 && FINNHUB_API_KEY) {
      let filled = 0;
      for (const sym of missing) {
        const data = await fetchFromFinnhub(sym);
        if (data && data.marketCap > 0) {
          try {
            await upsert(sym, data.marketCap, data.sector, data.industry, data.companyName ?? null, data.exchange ?? null);
            filled++;
            finnhubTotal++;
          } catch (e) {
            console.error(`Finnhub upsert failed for ${sym}:`, e);
          }
        }
        await new Promise(r => setTimeout(r, FINNHUB_DELAY_MS));
      }
      if (filled > 0) {
        console.log(`[Chunk ${chunkNum}] Finnhub: ${filled}/${missing.length} symbols filled`);
      }
    }

    await new Promise(r => setTimeout(r, PAUSE_MS));
  }
  console.log(`Backfill completed. FMP: ${fmpTotal}, Finnhub: ${finnhubTotal}`);
}

(async () => {
  await initializeDatabase();
  if (!db) {
    console.error('Database not available - aborting backfill');
    process.exit(1);
  }
  let tickers = getUniverseTickers('sp500').map((s) => s.toUpperCase());
  if (MISSING_ONLY) {
    const cached = await getCachedSymbolsWithMarketCap();
    const before = tickers.length;
    tickers = tickers.filter((s) => !cached.has(s));
    console.log(`BACKFILL_MISSING_ONLY: skipping ${before - tickers.length} already cached; backfilling ${tickers.length}`);
  } else {
    console.log(`Starting full backfill for ${tickers.length} tickers`);
  }
  if (tickers.length === 0) {
    console.log('Nothing to backfill.');
    process.exit(0);
  }
  await backfill(tickers);
  process.exit(0);
})();

