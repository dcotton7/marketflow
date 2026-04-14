import { findSectorForSymbol as localLookup, STOCKS_BY_SECTOR } from "@shared/stocksBySector";
import { db } from "./db";
import { tickers } from "@shared/schema";
import { eq } from "drizzle-orm";
import * as finnhub from "./finnhub";
import { withRetry } from "./utils/dbRetry";

const FMP_API_KEY = process.env.FMP_API_KEY;
const FMP_BASE = "https://financialmodelingprep.com/stable";
const FMP_BATCH_CHUNK = 100; // symbols per batch request to avoid URL length limits

export interface FundamentalData {
  sector: string;
  industry: string;
  marketCap: number;
  companyName?: string;
  exchange?: string;
}

// Cache rule: No data → run query. If we have data and not expired → use cache.
const CACHE_TTL = 3 * 24 * 60 * 60 * 1000; // 3 days
const pendingRequests = new Map<string, Promise<any>>();

// Cap concurrent DB cache reads so scans don't exhaust the pool (BATCH_SIZE can be 12+).
const CACHE_READ_CONCURRENCY = 8;
let cacheReadsInFlight = 0;
const cacheReadQueue: Array<() => void> = [];
async function withCacheReadLimit<T>(fn: () => Promise<T>): Promise<T> {
  while (cacheReadsInFlight >= CACHE_READ_CONCURRENCY) {
    await new Promise<void>((r) => cacheReadQueue.push(r));
  }
  cacheReadsInFlight++;
  try {
    return await fn();
  } finally {
    cacheReadsInFlight--;
    const next = cacheReadQueue.shift();
    if (next) next();
  }
}

// Limit concurrent Finnhub API calls to avoid rate limiting (e.g. 60/min free tier)
const FINNHUB_CONCURRENCY = 5;
let finnhubInFlight = 0;
const finnhubQueue: Array<() => void> = [];

async function withFinnhubLimit<T>(fn: () => Promise<T>): Promise<T> {
  while (finnhubInFlight >= FINNHUB_CONCURRENCY) {
    await new Promise<void>((r) => finnhubQueue.push(r));
  }
  finnhubInFlight++;
  try {
    return await fn();
  } finally {
    finnhubInFlight--;
    const next = finnhubQueue.shift();
    if (next) next();
  }
}

async function fetchFromFinnhub(symbol: string): Promise<FundamentalData | null> {
  try {
    const profile = await finnhub.fetchCompanyProfile(symbol);
    if (!profile) {
      console.warn(`[Finnhub] No profile returned for ${symbol}`);
      return null;
    }

    // Map Finnhub industry to sector (Finnhub doesn't have separate sector field)
    const industry = profile.finnhubIndustry || 'Unknown';
    const sector = mapIndustryToSector(industry);

    // Check if market cap is valid (not null, undefined, or 0)
    const rawMarketCap = profile.marketCapitalization;
    const marketCap = (rawMarketCap && rawMarketCap > 0)
      ? rawMarketCap * 1000000 // Finnhub returns in millions
      : 0;

    const displayName =
      typeof profile.name === "string" && profile.name.trim() ? profile.name.trim() : undefined;

    return {
      sector,
      industry,
      marketCap,
      companyName: displayName,
      exchange: profile.exchange || undefined,
    };
  } catch (err) {
    console.error(`[Finnhub] Failed to fetch fundamentals for ${symbol}:`, err);
    return null;
  }
}

// Map Finnhub industry to broader sector categories
function mapIndustryToSector(industry: string): string {
  const lowerIndustry = industry.toLowerCase();
  if (lowerIndustry.includes('software') || lowerIndustry.includes('technology') || lowerIndustry.includes('internet') || lowerIndustry.includes('semiconductor')) return 'Technology';
  if (lowerIndustry.includes('healthcare') || lowerIndustry.includes('pharma') || lowerIndustry.includes('biotech') || lowerIndustry.includes('medical')) return 'Healthcare';
  if (lowerIndustry.includes('bank') || lowerIndustry.includes('financial') || lowerIndustry.includes('insurance')) return 'Financials';
  if (lowerIndustry.includes('consumer') || lowerIndustry.includes('retail')) return 'Consumer';
  if (lowerIndustry.includes('energy') || lowerIndustry.includes('oil') || lowerIndustry.includes('gas')) return 'Energy';
  if (lowerIndustry.includes('industrial') || lowerIndustry.includes('manufacturing')) return 'Industrials';
  if (lowerIndustry.includes('real estate') || lowerIndustry.includes('reit')) return 'Real Estate';
  if (lowerIndustry.includes('utility') || lowerIndustry.includes('utilities')) return 'Utilities';
  if (lowerIndustry.includes('material') || lowerIndustry.includes('mining') || lowerIndustry.includes('chemical')) return 'Basic Materials';
  if (lowerIndustry.includes('communication') || lowerIndustry.includes('telecom') || lowerIndustry.includes('media')) return 'Communication Services';
  return industry; // Return as-is if no mapping
}

/**
 * Fetch market caps for many symbols in one or a few FMP batch requests.
 * Use when Finnhub is rate-limited or fails so FND-1 (Market Cap Filter) can still return results.
 * Returns Map<symbol, marketCap in dollars>. Only includes symbols with valid marketCap > 0.
 */
export async function fetchMarketCapsBatchFromFMP(symbols: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!FMP_API_KEY || symbols.length === 0) return out;
  const list = [...new Set(symbols.map((s) => s.toUpperCase()))];
  for (let i = 0; i < list.length; i += FMP_BATCH_CHUNK) {
    const chunk = list.slice(i, i + FMP_BATCH_CHUNK);
    const symbolsParam = chunk.join(",");
    const url = `${FMP_BASE}/market-capitalization-batch?symbols=${encodeURIComponent(symbolsParam)}&apikey=${FMP_API_KEY}`;
    try {
      const resp = await fetch(url);
      if (!resp.ok) {
        console.warn(`[FMP] Batch market cap error ${resp.status} for chunk ${i / FMP_BATCH_CHUNK + 1}`);
        continue;
      }
      const data = await resp.json();
      if (!Array.isArray(data)) continue;
      for (const row of data) {
        const sym = (row.symbol ?? row.ticker) as string;
        const cap = row.marketCap ?? row.market_cap ?? row.mktCap ?? 0;
        if (sym && Number(cap) > 0) out.set(String(sym).toUpperCase(), Number(cap));
      }
    } catch (err) {
      console.warn(`[FMP] Batch market cap fetch failed for chunk:`, err);
    }
  }
  return out;
}

/** If we have data and not expired → use cache. No data or expired → return null (caller runs query). */
async function getFromDbCache(symbol: string): Promise<FundamentalData | null> {
  if (!db) return null;
  try {
    const rows = await withCacheReadLimit(() =>
      withRetry(() => db.select().from(tickers).where(eq(tickers.symbol, symbol)).limit(1))
    );
    if (rows.length === 0) return null;

    const row = rows[0];
    const age = Date.now() - new Date(row.fetchedAt).getTime();
    if (age > CACHE_TTL) return null;

    const marketCap = row.marketCap ?? 0;
    if (!marketCap) return null; // no usable market cap in cache → run query

    return {
      sector: row.sector,
      industry: row.industry,
      marketCap,
      companyName: row.companyName || undefined,
      exchange: row.exchange || undefined,
    };
  } catch (err) {
    console.error(`[Fundamentals] DB cache read failed for ${symbol} (after retries):`, err);
    return null;
  }
}

/** When provider fails or returns no data, use existing cached data if any (no expiry check). */
async function getStaleFromDbCache(symbol: string): Promise<FundamentalData | null> {
  if (!db) return null;
  try {
    const rows = await withCacheReadLimit(() =>
      withRetry(() => db.select().from(tickers).where(eq(tickers.symbol, symbol)).limit(1))
    );
    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      sector: row.sector,
      industry: row.industry,
      marketCap: row.marketCap || 0,
      companyName: row.companyName || undefined,
      exchange: row.exchange || undefined,
    };
  } catch (err) {
    console.error(`[Fundamentals] DB stale cache read failed for ${symbol} (after retries):`, err);
    return null;
  }
}

async function getExtendedFromDbCache(symbol: string): Promise<ExtendedFundamentals | null> {
  if (!db) return null;
  try {
    const rows = await withCacheReadLimit(() =>
      withRetry(() => db.select().from(tickers).where(eq(tickers.symbol, symbol)).limit(1))
    );
    if (rows.length === 0) return null;

    const row = rows[0];
    const age = Date.now() - new Date(row.fetchedAt).getTime();
    if (age > CACHE_TTL) return null;

    // Check if we have extended data (pe might be null but fetchedAt proves we tried)
    if (row.pe === null && row.analystConsensus === null) {
      return null; // No extended data cached yet
    }

    return {
      marketCap: row.marketCap || 0,
      pe: row.pe,
      beta: row.beta,
      debtToEquity: row.debtToEquity,
      preTaxMargin: row.preTaxMargin,
      analystConsensus: row.analystConsensus || "N/A",
      targetPrice: row.targetPrice,
      nextEarningsDate: row.nextEarningsDate || "N/A",
      nextEarningsDays: row.nextEarningsDays || -1,
      epsCurrentQYoY: row.epsCurrentQYoY || "N/A",
      salesGrowth3QYoY: row.salesGrowth3QYoY || "N/A",
      lastEpsSurprise: row.lastEpsSurprise || "N/A",
    };
  } catch (err) {
    console.error(`[Fundamentals] Extended DB cache read failed for ${symbol} (after retries):`, err);
    return null;
  }
}

async function saveToDbCache(symbol: string, data: FundamentalData, extended?: ExtendedFundamentals): Promise<void> {
  if (!db) return;
  try {
    const values: any = {
      symbol,
      sector: data.sector,
      industry: data.industry,
      marketCap: data.marketCap || null,
      companyName: data.companyName || null,
      exchange: data.exchange || null,
      fetchedAt: new Date(),
    };

    // If extended fundamentals are provided, include them
    if (extended) {
      values.pe = extended.pe;
      values.beta = extended.beta;
      values.debtToEquity = extended.debtToEquity;
      values.preTaxMargin = extended.preTaxMargin;
      values.analystConsensus = extended.analystConsensus;
      values.targetPrice = extended.targetPrice;
      values.nextEarningsDate = extended.nextEarningsDate;
      values.nextEarningsDays = extended.nextEarningsDays;
      values.epsCurrentQYoY = extended.epsCurrentQYoY;
      values.salesGrowth3QYoY = extended.salesGrowth3QYoY;
      values.lastEpsSurprise = extended.lastEpsSurprise;
    }

    await db.insert(tickers)
      .values(values)
      .onConflictDoUpdate({
        target: tickers.symbol,
        set: values,
      });
  } catch (err) {
    console.error(`[Fundamentals] DB cache write error for ${symbol}:`, err);
  }
}

export async function getFundamentals(symbol: string): Promise<FundamentalData> {
  const upper = symbol.toUpperCase();

  // Check DB cache first
  const dbCached = await getFromDbCache(upper);
  
  const local = localLookup(upper);
  if (local) {
    const stock = STOCKS_BY_SECTOR[local.sector]?.find(s => s.symbol === upper);
    const localCap = stock?.marketCap ?? 0;
    if (localCap > 0) {
      // If we have companyName cached, return immediately
      if (dbCached?.companyName) {
        return {
          sector: local.sector,
          industry: local.industry,
          marketCap: localCap,
          companyName: dbCached.companyName,
          exchange: dbCached?.exchange || undefined,
        };
      }
      // No companyName cached - fetch from Finnhub to get it
      const finnhubData = await withFinnhubLimit(() => fetchFromFinnhub(upper)).catch(() => null);
      if (finnhubData?.companyName) {
        // Save to cache for next time
        saveToDbCache(upper, { ...finnhubData, sector: local.sector, industry: local.industry, marketCap: localCap });
        return {
          sector: local.sector,
          industry: local.industry,
          marketCap: localCap,
          companyName: finnhubData.companyName,
          exchange: finnhubData.exchange || undefined,
        };
      }
      // Couldn't get companyName, return without it
      return {
        sector: local.sector,
        industry: local.industry,
        marketCap: localCap,
      };
    }
    // local has no usable marketCap, fall through to cache/Finnhub
  }
  
  // If we already have valid cached data, return it
  if (dbCached) {
    return dbCached;
  }

  // Not present or past expiry → query provider
  let pending = pendingRequests.get(upper);
  if (!pending) {
    pending = withFinnhubLimit(() => fetchFromFinnhub(upper));
    pendingRequests.set(upper, pending);
  }

  try {
    const result = await pending;
    if (result) {
      saveToDbCache(upper, result);
      return result;
    }
    // Unable to query or no results from Finnhub → use existing cached data only if it has usable market cap
    const stale = await getStaleFromDbCache(upper);
    if (stale && (stale.marketCap ?? 0) > 0) {
      return stale;
    }
    return { sector: 'Unknown', industry: 'Unknown', marketCap: 0 };
  } finally {
    pendingRequests.delete(upper);
  }
}

export async function getSectorForSymbol(symbol: string): Promise<string | null> {
  const result = await getFundamentals(symbol);
  return result.sector !== 'Unknown' ? result.sector : null;
}

export async function getSectorAndIndustry(symbol: string): Promise<{ sector: string; industry: string }> {
  const result = await getFundamentals(symbol);
  return { sector: result.sector, industry: result.industry };
}

export interface ExtendedFundamentals {
  marketCap: number;
  pe: number | null;
  beta: number | null;
  debtToEquity: number | null;
  preTaxMargin: number | null;
  analystConsensus: string;
  targetPrice: number | null;
  nextEarningsDate: string;
  nextEarningsDays: number;
  epsCurrentQYoY: string;
  salesGrowth3QYoY: string;
  lastEpsSurprise: string;
}

// Remove in-memory cache - now using DB cache only
// All old FMP helper functions removed - now using Finnhub via server/finnhub.ts

export async function getExtendedFundamentals(symbol: string): Promise<ExtendedFundamentals> {
  const upper = symbol.toUpperCase();

  // Check DB cache first
  const dbCached = await getExtendedFromDbCache(upper);
  if (dbCached) {
    console.log(`[Fundamentals] Using cached extended fundamentals for ${upper}`);
    return dbCached;
  }

  console.log(`[Fundamentals] Fetching extended fundamentals for ${upper} from Finnhub`);

  // Fetch comprehensive data from Finnhub
  const finnhubData = await finnhub.getComprehensiveFundamentals(upper);

  const profile = finnhubData.profile;
  const metrics = finnhubData.metrics?.metric;
  const recommendations = finnhubData.recommendations;
  const priceTarget = finnhubData.priceTarget;
  const earningsSurprises = finnhubData.earningsSurprises;

  // Calculate market cap (in dollars)
  // Try profile first, then metrics, default to 0 if neither has valid data
  let marketCap = 0;
  if (profile?.marketCapitalization && profile.marketCapitalization > 0) {
    marketCap = profile.marketCapitalization * 1000000; // Finnhub returns in millions
  } else if (metrics?.marketCapitalization && metrics.marketCapitalization > 0) {
    marketCap = metrics.marketCapitalization * 1000000; // Also in millions
  }
  // If both are null/0/undefined, marketCap stays 0 (meaning "no data")

  // Get PE ratio
  const pe = metrics?.peTTM ?? metrics?.peExclExtraTTM ?? null;

  // Get beta
  const beta = metrics?.beta ?? null;

  // Get debt to equity
  const debtToEquity = metrics?.totalDebtToEquity ?? null;

  // Get pre-tax margin (using ROA as proxy if not available)
  const preTaxMargin = metrics?.roaRfy ?? null;

  // Calculate analyst consensus
  let analystConsensus = "N/A";
  if (recommendations.length > 0) {
    const latest = recommendations[0];
    const totalRecs = latest.buy + latest.hold + latest.sell + latest.strongBuy + latest.strongSell;
    if (totalRecs > 0) {
      const bullishScore = (latest.strongBuy * 2 + latest.buy) / totalRecs;
      const bearishScore = (latest.strongSell * 2 + latest.sell) / totalRecs;
      if (bullishScore > 1.0) analystConsensus = "Strong Buy";
      else if (bullishScore > 0.5) analystConsensus = "Buy";
      else if (bearishScore > 0.5) analystConsensus = "Sell";
      else analystConsensus = "Hold";
    }
  }

  // Get target price
  const targetPrice = priceTarget?.targetMean ?? priceTarget?.targetMedian ?? null;

  // Calculate next earnings date and days
  let nextEarningsDate = "N/A";
  let nextEarningsDays = -1;
  
  if (earningsSurprises.length > 0) {
    // Find the most recent earnings date
    const sortedEarnings = earningsSurprises.sort((a, b) => new Date(b.period).getTime() - new Date(a.period).getTime());
    const lastEarnings = new Date(sortedEarnings[0].period);
    
    // Estimate next earnings (roughly 90 days later)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let nextEstimate = new Date(lastEarnings);
    nextEstimate.setMonth(nextEstimate.getMonth() + 3);
    
    while (nextEstimate <= today) {
      nextEstimate.setMonth(nextEstimate.getMonth() + 3);
    }
    
    nextEarningsDate = nextEstimate.toISOString().split("T")[0];
    nextEarningsDays = Math.ceil((nextEstimate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  }

  // Calculate EPS growth
  let epsCurrentQYoY = "N/A";
  if (earningsSurprises.length >= 2) {
    const sorted = earningsSurprises.sort((a, b) => new Date(b.period).getTime() - new Date(a.period).getTime());
    const current = sorted[0];
    const yearAgo = sorted.find((e, i) => i > 0 && i <= 4); // Look within last 4 quarters for YoY comparison
    
    if (current.actual != null && yearAgo?.actual != null && yearAgo.actual !== 0) {
      const yoyPct = ((current.actual - yearAgo.actual) / Math.abs(yearAgo.actual)) * 100;
      epsCurrentQYoY = `${yoyPct >= 0 ? "+" : ""}${Math.round(yoyPct)}%`;
    } else if (current.actual != null) {
      epsCurrentQYoY = `$${current.actual.toFixed(2)}`;
    }
  }

  // Calculate sales growth (using revenue growth from metrics)
  const salesGrowth3QYoY = metrics?.revenueGrowthTTMYoy 
    ? `${metrics.revenueGrowthTTMYoy >= 0 ? "+" : ""}${Math.round(metrics.revenueGrowthTTMYoy)}%`
    : (metrics?.revenueGrowth3Y ? `${metrics.revenueGrowth3Y >= 0 ? "+" : ""}${Math.round(metrics.revenueGrowth3Y)}%` : "N/A");

  // Calculate last EPS surprise
  let lastEpsSurprise = "N/A";
  if (earningsSurprises.length > 0) {
    const latest = earningsSurprises[0];
    if (latest.actual != null && latest.estimate != null && latest.estimate !== 0) {
      const surprise = latest.actual - latest.estimate;
      const surprisePct = (surprise / Math.abs(latest.estimate)) * 100;
      lastEpsSurprise = `${surprise >= 0 ? "+" : ""}$${surprise.toFixed(2)} (${surprisePct >= 0 ? "+" : ""}${Math.round(surprisePct)}%)`;
    }
  }

  const result: ExtendedFundamentals = {
    marketCap,
    pe,
    beta,
    debtToEquity,
    preTaxMargin,
    analystConsensus,
    targetPrice,
    nextEarningsDate,
    nextEarningsDays,
    epsCurrentQYoY,
    salesGrowth3QYoY,
    lastEpsSurprise,
  };

  // Save to DB cache - need basic fundamental data too
  const basicData: FundamentalData = {
    sector: profile?.finnhubIndustry ? mapIndustryToSector(profile.finnhubIndustry) : 'Unknown',
    industry: profile?.finnhubIndustry || 'Unknown',
    marketCap,
    companyName: profile?.name,
    exchange: profile?.exchange,
  };

  await saveToDbCache(upper, basicData, result);
  console.log(`[Fundamentals] Saved extended fundamentals for ${upper} to DB cache`);

  return result;
}

const fmpPeersCache = new Map<string, { data: { symbol: string; name: string; industry: string; marketCap: number }[]; ts: number }>();
const FMP_PEERS_CACHE_TTL = 12 * 60 * 60 * 1000;

export async function fetchIndustryPeersFromFMP(industry: string, sector: string, excludeSymbol: string, limit: number = 20): Promise<{ symbol: string; name: string; industry: string; marketCap: number }[]> {
  if (!FMP_API_KEY) return [];

  const cacheKey = `${sector}:${industry}`;
  const cached = fmpPeersCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < FMP_PEERS_CACHE_TTL) {
    return cached.data.filter(s => s.symbol !== excludeSymbol).slice(0, limit);
  }

  try {
    const url = `https://financialmodelingprep.com/api/v3/stock-screener?industry=${encodeURIComponent(industry)}&sector=${encodeURIComponent(sector)}&exchange=NYSE,NASDAQ&isActivelyTrading=true&marketCapMoreThan=500000000&limit=30&apikey=${FMP_API_KEY}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];

    const data = await res.json();
    if (!Array.isArray(data)) return [];

    const peers = data
      .filter((d: any) => d.symbol && d.companyName)
      .map((d: any) => ({
        symbol: d.symbol as string,
        name: (d.companyName as string) || d.symbol,
        industry: (d.industry as string) || industry,
        marketCap: (d.marketCap as number) || 0,
      }))
      .sort((a: { marketCap: number }, b: { marketCap: number }) => b.marketCap - a.marketCap);

    fmpPeersCache.set(cacheKey, { data: peers, ts: Date.now() });
    return peers.filter(s => s.symbol !== excludeSymbol).slice(0, limit);
  } catch (err) {
    console.error(`[FMP] Failed to fetch industry peers for ${industry}:`, err);
    return [];
  }
}
