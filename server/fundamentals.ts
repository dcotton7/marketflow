import { findSectorForSymbol as localLookup, STOCKS_BY_SECTOR } from "@shared/stocksBySector";
import { db } from "./db";
import { fundamentalsCache } from "@shared/schema";
import { eq } from "drizzle-orm";

const FMP_API_KEY = process.env.FMP_API_KEY;
const FMP_BASE = "https://financialmodelingprep.com/stable";

export interface FundamentalData {
  sector: string;
  industry: string;
  marketCap: number;
  companyName?: string;
  exchange?: string;
}

const CACHE_TTL = 24 * 60 * 60 * 1000;
const pendingRequests = new Map<string, Promise<FundamentalData | null>>();

async function fetchFromFMP(symbol: string): Promise<FundamentalData | null> {
  if (!FMP_API_KEY) {
    return null;
  }

  try {
    const url = `${FMP_BASE}/profile?symbol=${encodeURIComponent(symbol)}&apikey=${FMP_API_KEY}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;

    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;

    const profile = data[0];
    return {
      sector: profile.sector || 'Unknown',
      industry: profile.industry || 'Unknown',
      marketCap: profile.marketCap || 0,
      companyName: profile.companyName || undefined,
      exchange: profile.exchangeShortName || undefined,
    };
  } catch (err) {
    console.error(`[FMP] Failed to fetch fundamentals for ${symbol}:`, err);
    return null;
  }
}

async function getFromDbCache(symbol: string): Promise<FundamentalData | null> {
  if (!db) return null;
  try {
    const rows = await db.select().from(fundamentalsCache).where(eq(fundamentalsCache.symbol, symbol)).limit(1);
    if (rows.length === 0) return null;

    const row = rows[0];
    const age = Date.now() - new Date(row.fetchedAt).getTime();
    if (age > CACHE_TTL) return null;

    return {
      sector: row.sector,
      industry: row.industry,
      marketCap: row.marketCap || 0,
      companyName: row.companyName || undefined,
      exchange: row.exchange || undefined,
    };
  } catch (err) {
    console.error(`[Fundamentals] DB cache read error for ${symbol}:`, err);
    return null;
  }
}

async function saveToDbCache(symbol: string, data: FundamentalData): Promise<void> {
  if (!db) return;
  try {
    await db.insert(fundamentalsCache)
      .values({
        symbol,
        sector: data.sector,
        industry: data.industry,
        marketCap: data.marketCap || null,
        companyName: data.companyName || null,
        exchange: data.exchange || null,
        fetchedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: fundamentalsCache.symbol,
        set: {
          sector: data.sector,
          industry: data.industry,
          marketCap: data.marketCap || null,
          companyName: data.companyName || null,
          exchange: data.exchange || null,
          fetchedAt: new Date(),
        },
      });
  } catch (err) {
    console.error(`[Fundamentals] DB cache write error for ${symbol}:`, err);
  }
}

export async function getFundamentals(symbol: string): Promise<FundamentalData> {
  const upper = symbol.toUpperCase();

  const local = localLookup(upper);
  if (local) {
    const stock = STOCKS_BY_SECTOR[local.sector]?.find(s => s.symbol === upper);
    return {
      sector: local.sector,
      industry: local.industry,
      marketCap: stock?.marketCap || 0,
    };
  }

  const dbCached = await getFromDbCache(upper);
  if (dbCached) {
    return dbCached;
  }

  let pending = pendingRequests.get(upper);
  if (!pending) {
    pending = fetchFromFMP(upper);
    pendingRequests.set(upper, pending);
  }

  try {
    const result = await pending;
    const data = result || { sector: 'Unknown', industry: 'Unknown', marketCap: 0 };

    if (result) {
      saveToDbCache(upper, data);
    }

    return data;
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
