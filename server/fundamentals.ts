import { findSectorForSymbol as localLookup, STOCKS_BY_SECTOR } from "@shared/stocksBySector";
import { db } from "./db";
import { tickers } from "@shared/schema";
import { eq } from "drizzle-orm";
import * as finnhub from "./finnhub";
import { withRetry } from "./utils/dbRetry";

const FMP_API_KEY = process.env.FMP_API_KEY;
const FMP_BASE = "https://financialmodelingprep.com/stable";
const FMP_BATCH_CHUNK = 100; // symbols per batch request to avoid URL length limits

/** Evict oldest entries from a ts-keyed cache Map when it exceeds maxSize. */
function pruneMapCache<V extends { ts: number }>(cache: Map<string, V>, maxSize: number): void {
  if (cache.size <= maxSize) return;
  const sorted = [...cache.entries()].sort((a, b) => a[1].ts - b[1].ts);
  const toRemove = sorted.slice(0, cache.size - maxSize);
  for (const [k] of toRemove) cache.delete(k);
}

export interface FundamentalData {
  sector: string;
  industry: string;
  marketCap: number;
  companyName?: string;
  exchange?: string;
}

// ── Tiered cache TTLs ──────────────────────────────────────────────────────
const PROFILE_CACHE_TTL = 365 * 24 * 60 * 60 * 1000; // 1 year — company profile rarely changes
const EARNINGS_CACHE_TTL = 24 * 60 * 60 * 1000;       // 1 day — earnings dates shift
const METRICS_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;    // 7 days — PE, beta, analyst consensus
const CACHE_TTL = METRICS_CACHE_TTL;                   // backward-compat alias for basic getFundamentals
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
  if (!finnhubBreaker.isAvailable()) {
    throw new Error("[Finnhub] Circuit breaker OPEN — skipping call");
  }
  while (finnhubInFlight >= FINNHUB_CONCURRENCY) {
    await new Promise<void>((r) => finnhubQueue.push(r));
  }
  finnhubInFlight++;
  try {
    return await finnhubBreaker.call(() => fn());
  } finally {
    finnhubInFlight--;
    const next = finnhubQueue.shift();
    if (next) next();
  }
}

// ── FMP rate limiter (max 4 concurrent, 60s backoff on 429, circuit breaker) ─

import { getOrCreateBreaker } from "./infra/circuit-breaker";
import { retryWithBackoff } from "./infra/retry";

const fmpBreaker = getOrCreateBreaker("FMP", { failureThreshold: 5, resetTimeoutMs: 120_000 });
const finnhubBreaker = getOrCreateBreaker("Finnhub", { failureThreshold: 5, resetTimeoutMs: 120_000 });

const FMP_CONCURRENCY = 4;
let fmpInFlight = 0;
const fmpQueue: Array<() => void> = [];
let fmpBackoffUntil = 0;

async function withFmpLimit<T>(fn: () => Promise<T>): Promise<T> {
  if (Date.now() < fmpBackoffUntil) {
    throw new Error("[FMP] Rate-limited, backing off");
  }
  if (!fmpBreaker.isAvailable()) {
    throw new Error("[FMP] Circuit breaker OPEN — skipping call");
  }
  while (fmpInFlight >= FMP_CONCURRENCY) {
    await new Promise<void>((r) => fmpQueue.push(r));
  }
  fmpInFlight++;
  try {
    const result = await fmpBreaker.call(() => fn());
    return result;
  } finally {
    fmpInFlight--;
    const next = fmpQueue.shift();
    if (next) next();
  }
}

// ── FMP Company Profile fetch ──────────────────────────────────────────────

interface FmpProfileRow {
  companyName?: string;
  description?: string;
  sector?: string;
  industry?: string;
  exchange?: string;
  mktCap?: number;
  symbol?: string;
  range?: string;        // "123.45-234.56" (52-week range)
  lastDiv?: number;
  volAvg?: number;
  fullTimeEmployees?: number;
  sharesOutstanding?: number;
}

async function fetchFmpProfile(symbol: string): Promise<FmpProfileRow | null> {
  if (!FMP_API_KEY) return null;
  const url = `${FMP_BASE}/profile?symbol=${encodeURIComponent(symbol)}&apikey=${FMP_API_KEY}`;
  try {
    const resp = await retryWithBackoff(
      () => withFmpLimit(() => fetch(url, { signal: AbortSignal.timeout(10000) })),
      { label: `FMP profile ${symbol}`, maxRetries: 2 }
    );
    if (resp.status === 429) {
      fmpBackoffUntil = Date.now() + 60_000;
      console.warn("[FMP] 429 rate limit hit, backing off 60s");
      return null;
    }
    if (!resp.ok) return null;
    const data = await resp.json();
    const row = Array.isArray(data) ? data[0] : data;
    return row ?? null;
  } catch (err) {
    console.warn(`[FMP] Profile fetch failed for ${symbol}:`, err);
    return null;
  }
}

// ── FMP Earnings Calendar fetch ────────────────────────────────────────────

interface FmpEarningsRow {
  date: string;
  symbol: string;
  epsActual: number | null;
  epsEstimated: number | null;
  revenueActual: number | null;
  revenueEstimated: number | null;
  // Legacy fields from old /stable/earning_calendar endpoint (kept for backward compat)
  eps?: number | null;
  revenue?: number | null;
  time?: string; // "bmo" | "amc"
}

interface ParsedEarnings {
  nextEarningsDate: string;
  nextEarningsDays: number;
  earningsTime: string | null;
  lastEarningsDate: string | null;
  epsActual: number | null;
  epsEstimate: number | null;
  revenueActual: number | null;
  revenueEstimate: number | null;
}

async function fetchFmpEarnings(symbol: string): Promise<ParsedEarnings | null> {
  if (!FMP_API_KEY) return null;
  const url = `${FMP_BASE}/earnings?symbol=${encodeURIComponent(symbol)}&apikey=${FMP_API_KEY}`;
  try {
    const resp = await retryWithBackoff(
      () => withFmpLimit(() => fetch(url, { signal: AbortSignal.timeout(10000) })),
      { label: `FMP earnings ${symbol}`, maxRetries: 2 }
    );
    if (resp.status === 429) {
      fmpBackoffUntil = Date.now() + 60_000;
      console.warn("[FMP] 429 rate limit hit, backing off 60s");
      return null;
    }
    if (!resp.ok) return null;
    const data: FmpEarningsRow[] = await resp.json();
    if (!Array.isArray(data) || data.length === 0) return null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().slice(0, 10);

    const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));

    // Next upcoming (date > today)
    const upcoming = sorted.find((e) => e.date > todayStr);
    // Most recent past (date <= today)
    const pastEvents = sorted.filter((e) => e.date <= todayStr);
    const recent = pastEvents.length > 0 ? pastEvents[pastEvents.length - 1]! : null;

    let nextEarningsDate = "N/A";
    let nextEarningsDays = -1;
    let earningsTime: string | null = null;

    if (upcoming) {
      nextEarningsDate = upcoming.date;
      nextEarningsDays = Math.ceil(
        (new Date(upcoming.date).getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
      );
      earningsTime = upcoming.time || null;
    }

    return {
      nextEarningsDate,
      nextEarningsDays,
      earningsTime,
      lastEarningsDate: recent?.date ?? null,
      epsActual: recent?.epsActual ?? recent?.eps ?? null,
      epsEstimate: recent?.epsEstimated ?? null,
      revenueActual: recent?.revenueActual ?? recent?.revenue ?? null,
      revenueEstimate: recent?.revenueEstimated ?? null,
    };
  } catch (err) {
    console.warn(`[FMP] Earnings fetch failed for ${symbol}:`, err);
    return null;
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

/** Returns { profileStale, earningsStale, metricsStale } flags and cached data. */
interface TieredCacheResult {
  data: ExtendedFundamentals | null;
  profileStale: boolean;
  earningsStale: boolean;
  metricsStale: boolean;
  row: any; // raw DB row for reuse
}

async function getExtendedFromDbCacheTiered(symbol: string): Promise<TieredCacheResult> {
  const empty: TieredCacheResult = { data: null, profileStale: true, earningsStale: true, metricsStale: true, row: null };
  if (!db) return empty;
  const _db = db;
  try {
    const rows = await withCacheReadLimit(() =>
      withRetry(() => _db.select().from(tickers).where(eq(tickers.symbol, symbol)).limit(1))
    );
    if (rows.length === 0) return empty;

    const row = rows[0];
    const now = Date.now();

    const profileAge = row.profileFetchedAt ? now - new Date(row.profileFetchedAt).getTime() : Infinity;
    const earningsAge = row.earningsFetchedAt ? now - new Date(row.earningsFetchedAt).getTime() : Infinity;
    const metricsAge = now - new Date(row.fetchedAt).getTime();

    const profileStale = profileAge > PROFILE_CACHE_TTL;
    let earningsStale = earningsAge > EARNINGS_CACHE_TTL;
    const extendedFieldsAllNull = row.pe === null && row.beta === null && row.week52High === null && row.lastEarningsDate === null;
    const metricsStale = metricsAge > METRICS_CACHE_TTL || (row.pe === null && row.analystConsensus === null) || extendedFieldsAllNull;

    // Force refetch when cached nextEarningsDate is in the past
    const todayStr = new Date().toISOString().slice(0, 10);
    if (!earningsStale && row.nextEarningsDate && row.nextEarningsDate !== "N/A" && row.nextEarningsDate <= todayStr) {
      earningsStale = true;
    }

    // Recalculate nextEarningsDays relative to today (stored value is a snapshot)
    let recalcDays = row.nextEarningsDays ?? -1;
    if (row.nextEarningsDate && row.nextEarningsDate !== "N/A") {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      recalcDays = Math.ceil(
        (new Date(row.nextEarningsDate + "T00:00:00").getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
      );
    }

    const data: ExtendedFundamentals = {
      marketCap: row.marketCap || 0,
      pe: row.pe,
      beta: row.beta,
      debtToEquity: row.debtToEquity,
      preTaxMargin: row.preTaxMargin,
      analystConsensus: row.analystConsensus || "N/A",
      targetPrice: row.targetPrice,
      nextEarningsDate: row.nextEarningsDate || "N/A",
      nextEarningsDays: recalcDays,
      epsCurrentQYoY: row.epsCurrentQYoY || "N/A",
      salesGrowth3QYoY: row.salesGrowth3QYoY || "N/A",
      lastEpsSurprise: row.lastEpsSurprise || "N/A",
      companyDescription: row.companyDescription || null,
      earningsTime: row.earningsTime || null,
      lastEarningsDate: row.lastEarningsDate || null,
      epsActual: row.epsActual ?? null,
      epsEstimate: row.epsEstimate ?? null,
      revenueActual: row.revenueActual ?? null,
      revenueEstimate: row.revenueEstimate ?? null,
      week52High: row.week52High ?? null,
      week52Low: row.week52Low ?? null,
      dividendYield: row.dividendYield ?? null,
      roe: row.roe ?? null,
      sharesOutstanding: row.sharesOutstanding ?? null,
    };

    return { data, profileStale, earningsStale, metricsStale, row };
  } catch (err) {
    console.error(`[Fundamentals] Extended DB cache read failed for ${symbol} (after retries):`, err);
    return empty;
  }
}

async function getExtendedFromDbCache(symbol: string): Promise<ExtendedFundamentals | null> {
  const { data, metricsStale } = await getExtendedFromDbCacheTiered(symbol);
  if (!data || metricsStale) return null;
  return data;
}

interface SaveOptions {
  profileData?: {
    companyDescription?: string | null;
    companyName?: string;
    sector?: string;
    industry?: string;
    exchange?: string;
    marketCap?: number;
  };
  earningsData?: ParsedEarnings;
  metricsData?: Partial<ExtendedFundamentals>;
}

async function saveToDbCache(symbol: string, data: FundamentalData, extended?: ExtendedFundamentals, opts?: SaveOptions): Promise<void> {
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
      values.companyDescription = extended.companyDescription;
      values.earningsTime = extended.earningsTime;
      values.lastEarningsDate = extended.lastEarningsDate;
      values.epsActual = extended.epsActual;
      values.epsEstimate = extended.epsEstimate;
      values.revenueActual = extended.revenueActual;
      values.revenueEstimate = extended.revenueEstimate;
      values.week52High = extended.week52High;
      values.week52Low = extended.week52Low;
      values.dividendYield = extended.dividendYield;
      values.roe = extended.roe;
      values.sharesOutstanding = extended.sharesOutstanding;
    }

    if (opts?.profileData) {
      values.profileFetchedAt = new Date();
      if (opts.profileData.companyDescription != null) values.companyDescription = opts.profileData.companyDescription;
      if (opts.profileData.companyName) values.companyName = opts.profileData.companyName;
      if (opts.profileData.sector) values.sector = opts.profileData.sector;
      if (opts.profileData.industry) values.industry = opts.profileData.industry;
      if (opts.profileData.exchange) values.exchange = opts.profileData.exchange;
      if (opts.profileData.marketCap) values.marketCap = opts.profileData.marketCap;
    }

    if (opts?.earningsData) {
      values.earningsFetchedAt = new Date();
      values.nextEarningsDate = opts.earningsData.nextEarningsDate;
      values.nextEarningsDays = opts.earningsData.nextEarningsDays;
      values.earningsTime = opts.earningsData.earningsTime;
      values.lastEarningsDate = opts.earningsData.lastEarningsDate;
      values.epsActual = opts.earningsData.epsActual;
      values.epsEstimate = opts.earningsData.epsEstimate;
      values.revenueActual = opts.earningsData.revenueActual;
      values.revenueEstimate = opts.earningsData.revenueEstimate;
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

function localStockName(symbol: string): string | undefined {
  const local = localLookup(symbol);
  if (!local) return undefined;
  return STOCKS_BY_SECTOR[local.sector]?.find((s) => s.symbol === symbol)?.name;
}

export async function getFundamentals(symbol: string): Promise<FundamentalData> {
  const upper = symbol.toUpperCase();

  // Check DB cache first
  const dbCached = await getFromDbCache(upper);
  
  const local = localLookup(upper);
  if (local) {
    const stock = STOCKS_BY_SECTOR[local.sector]?.find(s => s.symbol === upper);
    const localCap = stock?.marketCap ?? 0;
    const localName = stock?.name;
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
      return {
        sector: local.sector,
        industry: local.industry,
        marketCap: localCap,
        companyName: localName,
      };
    }
    // local has no usable marketCap, fall through to cache/Finnhub
  }
  
  // If we already have valid cached data, return it (enrich with local name when missing)
  if (dbCached) {
    if (dbCached.companyName) return dbCached;
    const name = localStockName(upper);
    return name ? { ...dbCached, companyName: name } : dbCached;
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
  // New FMP-sourced earnings fields
  companyDescription: string | null;
  earningsTime: string | null;
  lastEarningsDate: string | null;
  epsActual: number | null;
  epsEstimate: number | null;
  revenueActual: number | null;
  revenueEstimate: number | null;
  // Extended profile + metrics fields
  week52High: number | null;
  week52Low: number | null;
  dividendYield: number | null;
  roe: number | null;
  sharesOutstanding: number | null;
}

// ── Cache-only reader for scanner (never triggers API calls) ────────────────

export async function getCachedEarningsData(symbol: string): Promise<{
  nextEarningsDate: string | null;
  nextEarningsDays: number;
  earningsTime: string | null;
  lastEarningsDate: string | null;
  epsActual: number | null;
  epsEstimate: number | null;
  revenueActual: number | null;
  revenueEstimate: number | null;
} | null> {
  if (!db) return null;
  const _db = db;
  try {
    const rows = await withCacheReadLimit(() =>
      withRetry(() => _db.select().from(tickers).where(eq(tickers.symbol, symbol.toUpperCase())).limit(1))
    );
    if (rows.length === 0) return null;
    const row = rows[0];
    if (!row.nextEarningsDate && !row.lastEarningsDate) return null;
    // Recalculate nextEarningsDays relative to today
    let nextEarningsDays = row.nextEarningsDays ?? -1;
    if (row.nextEarningsDate && row.nextEarningsDate !== "N/A") {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      nextEarningsDays = Math.ceil(
        (new Date(row.nextEarningsDate + "T00:00:00").getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
      );
    }
    return {
      nextEarningsDate: row.nextEarningsDate || null,
      nextEarningsDays,
      earningsTime: row.earningsTime || null,
      lastEarningsDate: row.lastEarningsDate || null,
      epsActual: row.epsActual ?? null,
      epsEstimate: row.epsEstimate ?? null,
      revenueActual: row.revenueActual ?? null,
      revenueEstimate: row.revenueEstimate ?? null,
    };
  } catch {
    return null;
  }
}

// ── Quarterly earnings history (4-quarter table) ──────────────────────────

export interface QuarterlyEarning {
  quarter: string;       // e.g. "Q2 '25"
  date: string;          // fiscal date ending or report date
  epsActual: number | null;
  epsEstimate: number | null;
  revenueActual: number | null;
  revenueEstimate: number | null;
}

const earningsHistoryCache = new Map<string, { data: QuarterlyEarning[]; ts: number }>();
const MAX_EARNINGS_HISTORY_CACHE = 50;

function formatQuarterLabel(dateStr: string): string {
  const d = new Date(dateStr);
  const month = d.getUTCMonth(); // 0-indexed
  const q = month < 3 ? 1 : month < 6 ? 2 : month < 9 ? 3 : 4;
  const yr = String(d.getUTCFullYear()).slice(2);
  return `Q${q} '${yr}`;
}

export async function fetchEarningsHistory(symbol: string): Promise<QuarterlyEarning[]> {
  const upper = symbol.toUpperCase();
  const cached = earningsHistoryCache.get(upper);
  if (cached && Date.now() - cached.ts < EARNINGS_CACHE_TTL) return cached.data;

  // Try FMP first
  if (FMP_API_KEY) {
    try {
      const url = `${FMP_BASE}/earnings?symbol=${encodeURIComponent(upper)}&apikey=${FMP_API_KEY}`;
      const resp = await retryWithBackoff(
        () => withFmpLimit(() => fetch(url, { signal: AbortSignal.timeout(10000) })),
        { label: `FMP earnings history ${upper}`, maxRetries: 2 }
      );
      if (resp.status === 429) {
        fmpBackoffUntil = Date.now() + 60_000;
        console.warn("[FMP] 429 rate limit hit on earnings history, backing off 60s");
      } else if (resp.ok) {
        const data: FmpEarningsRow[] = await resp.json();
        if (Array.isArray(data) && data.length > 0) {
          const today = new Date().toISOString().slice(0, 10);
          const pastEntries = data
            .filter((e) => e.date <= today && ((e.epsActual ?? e.eps) != null || (e.revenueActual ?? e.revenue) != null))
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, 4);

          if (pastEntries.length > 0) {
            const result: QuarterlyEarning[] = pastEntries.map((e) => ({
              quarter: formatQuarterLabel(e.date),
              date: e.date,
              epsActual: e.epsActual ?? e.eps,
              epsEstimate: e.epsEstimated,
              revenueActual: e.revenueActual ?? e.revenue,
              revenueEstimate: e.revenueEstimated,
            }));
            pruneMapCache(earningsHistoryCache, MAX_EARNINGS_HISTORY_CACHE);
            earningsHistoryCache.set(upper, { data: result, ts: Date.now() });
            return result;
          }
        }
      }
    } catch (err) {
      console.warn(`[FMP] Earnings history fetch failed for ${upper}:`, err);
    }
  }

  // Fallback to Finnhub /stock/earnings
  try {
    const surprises = await finnhub.fetchEarningsSurprises(upper);
    if (Array.isArray(surprises) && surprises.length > 0) {
      const sorted = [...surprises]
        .filter((e) => e.period)
        .sort((a, b) => b.period.localeCompare(a.period))
        .slice(0, 4);

      const result: QuarterlyEarning[] = sorted.map((e) => ({
        quarter: formatQuarterLabel(e.period),
        date: e.period,
        epsActual: e.actual ?? null,
        epsEstimate: e.estimate ?? null,
        revenueActual: null,
        revenueEstimate: null,
      }));
      pruneMapCache(earningsHistoryCache, MAX_EARNINGS_HISTORY_CACHE);
      earningsHistoryCache.set(upper, { data: result, ts: Date.now() });
      return result;
    }
  } catch (err) {
    console.warn(`[Finnhub] Earnings history fallback failed for ${upper}:`, err);
  }

  pruneMapCache(earningsHistoryCache, MAX_EARNINGS_HISTORY_CACHE);
  earningsHistoryCache.set(upper, { data: [], ts: Date.now() });
  return [];
}

export async function getExtendedFundamentals(symbol: string): Promise<ExtendedFundamentals> {
  const upper = symbol.toUpperCase();

  // Deduplication: if an in-flight request exists for this symbol, await it
  let pending = pendingRequests.get(`ext:${upper}`);
  if (pending) return pending as Promise<ExtendedFundamentals>;

  const doWork = async (): Promise<ExtendedFundamentals> => {
    // ── Step 1: Read tiered cache ──────────────────────────────────────────
    const cached = await getExtendedFromDbCacheTiered(upper);
    let result = cached.data;
    const saveOpts: SaveOptions = {};

    // ── Step 2: If profile stale → fetch FMP profile ────────────────────
    let fmpProfileData: FmpProfileRow | null = null;
    if (cached.profileStale) {
      console.log(`[Fundamentals] Profile stale for ${upper}, fetching from FMP`);
      fmpProfileData = await fetchFmpProfile(upper).catch(() => null);
      if (fmpProfileData) {
        const desc = fmpProfileData.description || null;
        const sector = fmpProfileData.sector || result?.companyDescription ? undefined : "Unknown";
        const industry = fmpProfileData.industry || undefined;
        saveOpts.profileData = {
          companyDescription: desc,
          companyName: fmpProfileData.companyName || undefined,
          sector: fmpProfileData.sector || sector,
          industry: fmpProfileData.industry || industry,
          exchange: fmpProfileData.exchange || undefined,
          marketCap: fmpProfileData.mktCap || undefined,
        };

        // Extract 52-week range from FMP "range" field (format "123.45-234.56")
        let w52High: number | null = null;
        let w52Low: number | null = null;
        if (fmpProfileData.range) {
          const parts = fmpProfileData.range.split("-");
          if (parts.length === 2) {
            const lo = parseFloat(parts[0]);
            const hi = parseFloat(parts[1]);
            if (!isNaN(lo) && !isNaN(hi)) { w52Low = lo; w52High = hi; }
          }
        }

        // Compute dividend yield from lastDiv if available
        let fmpDividendYield: number | null = null;
        if (fmpProfileData.lastDiv && fmpProfileData.lastDiv > 0 && fmpProfileData.mktCap && fmpProfileData.sharesOutstanding) {
          const priceEst = fmpProfileData.mktCap / fmpProfileData.sharesOutstanding;
          if (priceEst > 0) fmpDividendYield = (fmpProfileData.lastDiv / priceEst) * 100;
        }

        if (result) {
          result = {
            ...result,
            companyDescription: desc,
            week52High: w52High ?? result.week52High,
            week52Low: w52Low ?? result.week52Low,
            dividendYield: fmpDividendYield ?? result.dividendYield,
            sharesOutstanding: fmpProfileData.sharesOutstanding ?? result.sharesOutstanding,
          };
          if (fmpProfileData.mktCap && fmpProfileData.mktCap > 0) result.marketCap = fmpProfileData.mktCap;
        }
      }
    }

    // ── Step 3: If earnings stale → fetch FMP earnings calendar ─────────
    if (cached.earningsStale) {
      console.log(`[Fundamentals] Earnings stale for ${upper}, fetching from FMP`);
      const fmpEarnings = await fetchFmpEarnings(upper).catch(() => null);
      if (fmpEarnings) {
        saveOpts.earningsData = fmpEarnings;
        if (result) {
          result = {
            ...result,
            nextEarningsDate: fmpEarnings.nextEarningsDate,
            nextEarningsDays: fmpEarnings.nextEarningsDays,
            earningsTime: fmpEarnings.earningsTime,
            lastEarningsDate: fmpEarnings.lastEarningsDate,
            epsActual: fmpEarnings.epsActual,
            epsEstimate: fmpEarnings.epsEstimate,
            revenueActual: fmpEarnings.revenueActual,
            revenueEstimate: fmpEarnings.revenueEstimate,
          };
          // Update lastEpsSurprise from real data
          if (fmpEarnings.epsActual != null && fmpEarnings.epsEstimate != null && fmpEarnings.epsEstimate !== 0) {
            const surprise = fmpEarnings.epsActual - fmpEarnings.epsEstimate;
            const surprisePct = (surprise / Math.abs(fmpEarnings.epsEstimate)) * 100;
            result.lastEpsSurprise = `${surprise >= 0 ? "+" : ""}$${surprise.toFixed(2)} (${surprisePct >= 0 ? "+" : ""}${Math.round(surprisePct)}%)`;
          }
        }
      }
    }

    // ── Step 4: If metrics stale → fetch Finnhub comprehensive ──────────
    if (cached.metricsStale) {
      console.log(`[Fundamentals] Metrics stale for ${upper}, fetching from Finnhub`);
      const finnhubData = await finnhub.getComprehensiveFundamentals(upper);

      const profile = finnhubData.profile;
      const metrics = finnhubData.metrics?.metric;
      const recommendations = finnhubData.recommendations;
      const priceTargetData = finnhubData.priceTarget;
      const earningsSurprises = finnhubData.earningsSurprises;

      // Market cap refreshes on metrics TTL (7d) — always update from latest source
      let marketCap = 0;
      if (profile?.marketCapitalization && profile.marketCapitalization > 0) {
        marketCap = profile.marketCapitalization * 1000000;
      } else if (metrics?.marketCapitalization && Number(metrics.marketCapitalization) > 0) {
        marketCap = Number(metrics.marketCapitalization) * 1000000;
      }
      if (!marketCap && fmpProfileData?.mktCap && fmpProfileData.mktCap > 0) {
        marketCap = fmpProfileData.mktCap;
      }
      if (!marketCap && result?.marketCap) {
        marketCap = result.marketCap;
      }

      const pe = metrics?.peTTM ?? metrics?.peExclExtraTTM ?? null;
      const beta = metrics?.beta ?? null;
      const debtToEquity = metrics?.totalDebtToEquity ?? null;
      const preTaxMargin = metrics?.roaRfy ?? null;

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

      const targetPrice = priceTargetData?.targetMean ?? priceTargetData?.targetMedian ?? null;

      // EPS growth from Finnhub surprises (fallback if FMP didn't provide)
      let epsCurrentQYoY = result?.epsCurrentQYoY ?? "N/A";
      if (epsCurrentQYoY === "N/A" && earningsSurprises.length >= 2) {
        const sorted = earningsSurprises.sort((a, b) => new Date(b.period).getTime() - new Date(a.period).getTime());
        const current = sorted[0];
        const yearAgo = sorted.find((_e, i) => i > 0 && i <= 4);
        if (current.actual != null && yearAgo?.actual != null && yearAgo.actual !== 0) {
          const yoyPct = ((current.actual - yearAgo.actual) / Math.abs(yearAgo.actual)) * 100;
          epsCurrentQYoY = `${yoyPct >= 0 ? "+" : ""}${Math.round(yoyPct)}%`;
        } else if (current.actual != null) {
          epsCurrentQYoY = `$${current.actual.toFixed(2)}`;
        }
      }

      const salesGrowth3QYoY = metrics?.revenueGrowthTTMYoy
        ? `${metrics.revenueGrowthTTMYoy >= 0 ? "+" : ""}${Math.round(metrics.revenueGrowthTTMYoy)}%`
        : (metrics?.revenueGrowth3Y ? `${metrics.revenueGrowth3Y >= 0 ? "+" : ""}${Math.round(metrics.revenueGrowth3Y)}%` : (result?.salesGrowth3QYoY ?? "N/A"));

      // Last EPS surprise from Finnhub (fallback if not already set by FMP)
      let lastEpsSurprise = result?.lastEpsSurprise ?? "N/A";
      if (lastEpsSurprise === "N/A" && earningsSurprises.length > 0) {
        const latest = earningsSurprises[0];
        if (latest.actual != null && latest.estimate != null && latest.estimate !== 0) {
          const surprise = latest.actual - latest.estimate;
          const surprisePct = (surprise / Math.abs(latest.estimate)) * 100;
          lastEpsSurprise = `${surprise >= 0 ? "+" : ""}$${surprise.toFixed(2)} (${surprisePct >= 0 ? "+" : ""}${Math.round(surprisePct)}%)`;
        }
      }

      // Use FMP earnings data (from step 3) when result is null (first fetch)
      let nextEarningsDate = result?.nextEarningsDate ?? saveOpts.earningsData?.nextEarningsDate ?? "N/A";
      let nextEarningsDays = result?.nextEarningsDays ?? saveOpts.earningsData?.nextEarningsDays ?? -1;
      if (nextEarningsDate === "N/A" && earningsSurprises.length > 0) {
        const sortedEarnings = earningsSurprises.sort((a, b) => new Date(b.period).getTime() - new Date(a.period).getTime());
        const lastEarnings = new Date(sortedEarnings[0].period);
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

      // If Finnhub provided earnings data and FMP didn't, persist Finnhub's as the earnings source
      if (!saveOpts.earningsData && earningsSurprises.length > 0) {
        const sorted = [...earningsSurprises].sort((a, b) => new Date(b.period).getTime() - new Date(a.period).getTime());
        saveOpts.earningsData = {
          nextEarningsDate,
          nextEarningsDays,
          earningsTime: result?.earningsTime ?? null,
          lastEarningsDate: sorted[0]?.period ?? null,
          epsActual: sorted[0]?.actual ?? null,
          epsEstimate: sorted[0]?.estimate ?? null,
          revenueActual: null,
          revenueEstimate: null,
        };
      }

      // Extract ROE, 52w high/low, dividend yield from Finnhub metrics
      const finnhubRoe = metrics?.roeTTM != null ? Number(metrics.roeTTM) : null;
      const finnhub52High = metrics?.["52WeekHigh"] != null ? Number(metrics["52WeekHigh"]) : null;
      const finnhub52Low = metrics?.["52WeekLow"] != null ? Number(metrics["52WeekLow"]) : null;
      const finnhubDivYield = metrics?.dividendYieldIndicatedAnnual != null ? Number(metrics.dividendYieldIndicatedAnnual) : null;

      // Extract FMP 52-week range from profile as final fallback
      let fmpW52High: number | null = null;
      let fmpW52Low: number | null = null;
      if (fmpProfileData?.range) {
        const rangeParts = fmpProfileData.range.split("-");
        if (rangeParts.length === 2) {
          const lo = parseFloat(rangeParts[0]);
          const hi = parseFloat(rangeParts[1]);
          if (!isNaN(lo) && !isNaN(hi)) { fmpW52Low = lo; fmpW52High = hi; }
        }
      }

      result = {
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
        companyDescription: result?.companyDescription ?? null,
        earningsTime: result?.earningsTime ?? saveOpts.earningsData?.earningsTime ?? null,
        lastEarningsDate: saveOpts.earningsData?.lastEarningsDate ?? result?.lastEarningsDate ?? null,
        epsActual: saveOpts.earningsData?.epsActual ?? result?.epsActual ?? null,
        epsEstimate: saveOpts.earningsData?.epsEstimate ?? result?.epsEstimate ?? null,
        revenueActual: saveOpts.earningsData?.revenueActual ?? result?.revenueActual ?? null,
        revenueEstimate: saveOpts.earningsData?.revenueEstimate ?? result?.revenueEstimate ?? null,
        week52High: result?.week52High ?? finnhub52High ?? fmpW52High,
        week52Low: result?.week52Low ?? finnhub52Low ?? fmpW52Low,
        dividendYield: result?.dividendYield ?? finnhubDivYield,
        roe: finnhubRoe ?? result?.roe ?? null,
        sharesOutstanding: result?.sharesOutstanding ?? null,
      };

      // ── Fill-on-miss: attempt to fill remaining nulls from alternate sources ──
      if ((!result.marketCap || result.marketCap === 0) && result.sharesOutstanding && result.sharesOutstanding > 0) {
        if (fmpProfileData?.mktCap && fmpProfileData.mktCap > 0) {
          result.marketCap = fmpProfileData.mktCap;
        }
      }
      if (result.week52High == null && finnhub52High != null) result.week52High = finnhub52High;
      if (result.week52Low == null && finnhub52Low != null) result.week52Low = finnhub52Low;
      if (result.week52High == null && fmpW52High != null) result.week52High = fmpW52High;
      if (result.week52Low == null && fmpW52Low != null) result.week52Low = fmpW52Low;
      if (result.dividendYield == null && finnhubDivYield != null) result.dividendYield = finnhubDivYield;
      if (result.roe == null && finnhubRoe != null) result.roe = finnhubRoe;

      // Log warnings for fields still null after all attempts
      const missingFields: string[] = [];
      if (!result.marketCap) missingFields.push("marketCap");
      if (result.pe == null) missingFields.push("pe");
      if (result.week52High == null) missingFields.push("week52High");
      if (result.week52Low == null) missingFields.push("week52Low");
      if (result.roe == null) missingFields.push("roe");
      if (missingFields.length > 0) {
        console.warn(`[Fundamentals] ${upper} still missing after fill-on-miss: ${missingFields.join(", ")}`);
      }

      // Build basic data for cache write
      const basicData: FundamentalData = {
        sector: profile?.finnhubIndustry ? mapIndustryToSector(profile.finnhubIndustry) : (cached.row?.sector || "Unknown"),
        industry: profile?.finnhubIndustry || (cached.row?.industry || "Unknown"),
        marketCap: result.marketCap,
        companyName: profile?.name || cached.row?.companyName,
        exchange: profile?.exchange || cached.row?.exchange,
      };

      await saveToDbCache(upper, basicData, result, saveOpts);
      console.log(`[Fundamentals] Saved extended fundamentals for ${upper} to DB cache`);
      return result;
    }

    // ── Only profile or earnings were stale (metrics still fresh) ──────────
    if (Object.keys(saveOpts).length > 0 && result) {
      const basicData: FundamentalData = {
        sector: cached.row?.sector || "Unknown",
        industry: cached.row?.industry || "Unknown",
        marketCap: result.marketCap,
        companyName: cached.row?.companyName,
        exchange: cached.row?.exchange,
      };
      await saveToDbCache(upper, basicData, result, saveOpts);
    }

    if (result) {
      console.log(`[Fundamentals] Using cached extended fundamentals for ${upper} (refreshed stale tiers)`);
      return result;
    }

    // No cached data at all — full fetch needed
    return {
      marketCap: 0, pe: null, beta: null, debtToEquity: null, preTaxMargin: null,
      analystConsensus: "N/A", targetPrice: null, nextEarningsDate: "N/A", nextEarningsDays: -1,
      epsCurrentQYoY: "N/A", salesGrowth3QYoY: "N/A", lastEpsSurprise: "N/A",
      companyDescription: null, earningsTime: null, lastEarningsDate: null,
      epsActual: null, epsEstimate: null, revenueActual: null, revenueEstimate: null,
      week52High: null, week52Low: null, dividendYield: null, roe: null, sharesOutstanding: null,
    };
  };

  const promise = doWork();
  pendingRequests.set(`ext:${upper}`, promise);
  try {
    return await promise;
  } finally {
    pendingRequests.delete(`ext:${upper}`);
  }
}

const fmpPeersCache = new Map<string, { data: { symbol: string; name: string; industry: string; marketCap: number }[]; ts: number }>();
const FMP_PEERS_CACHE_TTL = 12 * 60 * 60 * 1000;
const MAX_PEERS_CACHE = 50;

export async function fetchIndustryPeersFromFMP(industry: string, sector: string, excludeSymbol: string, limit: number = 20): Promise<{ symbol: string; name: string; industry: string; marketCap: number }[]> {
  if (!FMP_API_KEY) return [];

  const cacheKey = `${sector}:${industry}`;
  const cached = fmpPeersCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < FMP_PEERS_CACHE_TTL) {
    return cached.data.filter(s => s.symbol !== excludeSymbol).slice(0, limit);
  }

  try {
    const url = `https://financialmodelingprep.com/api/v3/stock-screener?industry=${encodeURIComponent(industry)}&sector=${encodeURIComponent(sector)}&exchange=NYSE,NASDAQ&isActivelyTrading=true&marketCapMoreThan=500000000&limit=30&apikey=${FMP_API_KEY}`;
    const res = await retryWithBackoff(
      () => withFmpLimit(() => fetch(url, { signal: AbortSignal.timeout(10000) })),
      { label: `FMP peers ${industry}`, maxRetries: 2 }
    );
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

    pruneMapCache(fmpPeersCache, MAX_PEERS_CACHE);
    fmpPeersCache.set(cacheKey, { data: peers, ts: Date.now() });
    return peers.filter(s => s.symbol !== excludeSymbol).slice(0, limit);
  } catch (err) {
    console.error(`[FMP] Failed to fetch industry peers for ${industry}:`, err);
    return [];
  }
}
