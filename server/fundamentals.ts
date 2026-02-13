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

const extendedCache = new Map<string, { data: ExtendedFundamentals; ts: number }>();
const EXTENDED_CACHE_TTL = 24 * 60 * 60 * 1000;

async function fetchProfileData(symbol: string): Promise<{ marketCap: number; beta: number | null }> {
  if (!FMP_API_KEY) return { marketCap: 0, beta: null };
  try {
    const url = `${FMP_BASE}/profile?symbol=${encodeURIComponent(symbol)}&apikey=${FMP_API_KEY}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { marketCap: 0, beta: null };
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return { marketCap: 0, beta: null };
    const profile = data[0];
    return {
      marketCap: profile.marketCap || 0,
      beta: profile.beta ?? null,
    };
  } catch {
    return { marketCap: 0, beta: null };
  }
}

async function fetchRatiosTTM(symbol: string): Promise<{ pe: number | null; debtToEquity: number | null; preTaxMargin: number | null }> {
  if (!FMP_API_KEY) return { pe: null, debtToEquity: null, preTaxMargin: null };
  try {
    const url = `${FMP_BASE}/ratios-ttm?symbol=${encodeURIComponent(symbol)}&apikey=${FMP_API_KEY}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { pe: null, debtToEquity: null, preTaxMargin: null };
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return { pe: null, debtToEquity: null, preTaxMargin: null };
    const r = data[0];
    return {
      pe: r.priceToEarningsRatioTTM != null ? Math.round(r.priceToEarningsRatioTTM * 100) / 100 : null,
      debtToEquity: r.debtToEquityRatioTTM != null ? Math.round(r.debtToEquityRatioTTM * 100) / 100 : null,
      preTaxMargin: r.pretaxProfitMarginTTM != null ? Math.round(r.pretaxProfitMarginTTM * 10000) / 100 : null,
    };
  } catch {
    return { pe: null, debtToEquity: null, preTaxMargin: null };
  }
}

async function fetchPriceTargetConsensus(symbol: string): Promise<{ consensus: string; targetPrice: number | null }> {
  if (!FMP_API_KEY) return { consensus: "N/A", targetPrice: null };
  try {
    const url = `${FMP_BASE}/price-target-consensus?symbol=${encodeURIComponent(symbol)}&apikey=${FMP_API_KEY}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { consensus: "N/A", targetPrice: null };
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return { consensus: "N/A", targetPrice: null };
    const pt = data[0];
    const targetPrice = pt.targetConsensus ?? pt.targetMedian ?? null;
    let consensus = "N/A";
    if (targetPrice != null && pt.targetHigh != null && pt.targetLow != null) {
      const mid = (pt.targetHigh + pt.targetLow) / 2;
      consensus = targetPrice >= mid ? "Buy" : "Hold";
    }
    return { consensus, targetPrice: targetPrice != null ? Math.round(targetPrice * 100) / 100 : null };
  } catch {
    return { consensus: "N/A", targetPrice: null };
  }
}

interface IncomeQuarter {
  date: string;
  period: string;
  fiscalYear: string;
  epsDiluted: number | null;
  revenue: number;
}

async function fetchQuarterlyIncomeStatements(symbol: string): Promise<IncomeQuarter[]> {
  if (!FMP_API_KEY) return [];
  try {
    const url = `${FMP_BASE}/income-statement?symbol=${encodeURIComponent(symbol)}&period=quarter&limit=5&apikey=${FMP_API_KEY}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.map((d: any) => ({
      date: d.date,
      period: d.period,
      fiscalYear: d.fiscalYear,
      epsDiluted: d.epsDiluted ?? null,
      revenue: d.revenue || 0,
    }));
  } catch {
    return [];
  }
}

async function fetchAnalystEpsEstimates(symbol: string): Promise<{ epsAvg: number | null; date: string; numAnalysts: number } | null> {
  if (!FMP_API_KEY) return null;
  try {
    const url = `${FMP_BASE}/analyst-estimates?symbol=${encodeURIComponent(symbol)}&period=annual&apikey=${FMP_API_KEY}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    const now = new Date();
    const mostRecent = data.find((d: any) => {
      const estDate = new Date(d.date);
      return estDate <= now;
    });
    if (!mostRecent) return null;
    return {
      epsAvg: mostRecent.epsAvg ?? null,
      date: mostRecent.date,
      numAnalysts: mostRecent.numAnalystsEps ?? 0,
    };
  } catch {
    return null;
  }
}

function computeEpsGrowthMetrics(quarters: IncomeQuarter[], analystEst: { epsAvg: number | null; date: string } | null): {
  epsCurrentQYoY: string;
  salesGrowth3QYoY: string;
  lastEpsSurprise: string;
  nextEarningsDate: string;
  nextEarningsDays: number;
} {
  const result = {
    epsCurrentQYoY: "N/A",
    salesGrowth3QYoY: "N/A",
    lastEpsSurprise: "N/A",
    nextEarningsDate: "N/A",
    nextEarningsDays: -1,
  };

  if (quarters.length === 0) return result;

  const current = quarters[0];

  if (quarters.length >= 2) {
    const sameQLastYear = quarters.find(
      (q) => q.period === current.period && q.fiscalYear !== current.fiscalYear
    );
    if (sameQLastYear && current.epsDiluted != null && sameQLastYear.epsDiluted != null && sameQLastYear.epsDiluted !== 0) {
      const yoyPct = ((current.epsDiluted - sameQLastYear.epsDiluted) / Math.abs(sameQLastYear.epsDiluted)) * 100;
      result.epsCurrentQYoY = `${yoyPct >= 0 ? "+" : ""}${Math.round(yoyPct)}%`;
    } else if (current.epsDiluted != null) {
      result.epsCurrentQYoY = `$${current.epsDiluted.toFixed(2)}`;
    }
  }

  if (quarters.length >= 5) {
    const recent3Rev = quarters.slice(0, 3).reduce((s, q) => s + q.revenue, 0);
    const prior3Rev = quarters.slice(3, 5).reduce((s, q) => s + q.revenue, 0);
    if (prior3Rev > 0 && quarters.length >= 5) {
      const avgPrior = prior3Rev / 2;
      const avgRecent = recent3Rev / 3;
      const salesGrowth = ((avgRecent - avgPrior) / avgPrior) * 100;
      result.salesGrowth3QYoY = `${salesGrowth >= 0 ? "+" : ""}${Math.round(salesGrowth)}%`;
    }
  }

  if (analystEst && analystEst.epsAvg != null && quarters.length >= 4) {
    const trailing4Eps = quarters.slice(0, 4).reduce((s, q) => s + (q.epsDiluted || 0), 0);
    const annualEstEps = analystEst.epsAvg;
    if (annualEstEps !== 0) {
      const surprise = trailing4Eps - annualEstEps;
      const surprisePct = ((surprise / Math.abs(annualEstEps)) * 100);
      result.lastEpsSurprise = `${surprise >= 0 ? "+" : ""}$${surprise.toFixed(2)} (${surprisePct >= 0 ? "+" : ""}${Math.round(surprisePct)}%)`;
    }
  }

  if (current.date) {
    const lastReportDate = new Date(current.date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let nextEstimate = new Date(lastReportDate);
    nextEstimate.setMonth(nextEstimate.getMonth() + 3);
    while (nextEstimate <= today) {
      nextEstimate.setMonth(nextEstimate.getMonth() + 3);
    }
    const diffDays = Math.ceil((nextEstimate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    result.nextEarningsDate = nextEstimate.toISOString().split("T")[0];
    result.nextEarningsDays = diffDays;
  }

  return result;
}

export async function getExtendedFundamentals(symbol: string): Promise<ExtendedFundamentals> {
  const upper = symbol.toUpperCase();
  const cached = extendedCache.get(upper);
  if (cached && Date.now() - cached.ts < EXTENDED_CACHE_TTL) {
    return cached.data;
  }

  const [profile, ratios, priceTarget, incomeQuarters, analystEst] = await Promise.all([
    fetchProfileData(upper),
    fetchRatiosTTM(upper),
    fetchPriceTargetConsensus(upper),
    fetchQuarterlyIncomeStatements(upper),
    fetchAnalystEpsEstimates(upper),
  ]);

  const growth = computeEpsGrowthMetrics(incomeQuarters, analystEst);

  const result: ExtendedFundamentals = {
    marketCap: profile.marketCap,
    pe: ratios.pe,
    beta: profile.beta,
    debtToEquity: ratios.debtToEquity,
    preTaxMargin: ratios.preTaxMargin,
    analystConsensus: priceTarget.consensus,
    targetPrice: priceTarget.targetPrice,
    nextEarningsDate: growth.nextEarningsDate,
    nextEarningsDays: growth.nextEarningsDays,
    epsCurrentQYoY: growth.epsCurrentQYoY,
    salesGrowth3QYoY: growth.salesGrowth3QYoY,
    lastEpsSurprise: growth.lastEpsSurprise,
  };

  extendedCache.set(upper, { data: result, ts: Date.now() });
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
