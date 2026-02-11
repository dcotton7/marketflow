import { findSectorForSymbol as localLookup, STOCKS_BY_SECTOR } from "@shared/stocksBySector";

const FMP_API_KEY = process.env.FMP_API_KEY;
const FMP_BASE = "https://financialmodelingprep.com/stable";

export interface FundamentalData {
  sector: string;
  industry: string;
  marketCap: number;
}

const cache = new Map<string, { data: FundamentalData; expires: number }>();
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
    };
  } catch (err) {
    console.error(`[FMP] Failed to fetch fundamentals for ${symbol}:`, err);
    return null;
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

  const cached = cache.get(upper);
  if (cached && cached.expires > Date.now()) {
    return cached.data;
  }

  let pending = pendingRequests.get(upper);
  if (!pending) {
    pending = fetchFromFMP(upper);
    pendingRequests.set(upper, pending);
  }

  try {
    const result = await pending;
    const data = result || { sector: 'Unknown', industry: 'Unknown', marketCap: 0 };
    cache.set(upper, { data, expires: Date.now() + CACHE_TTL });
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
