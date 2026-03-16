const FINNHUB_BASE = "https://finnhub.io/api/v1";

function getApiKey(): string {
  return process.env.FINNHUB_API_KEY || "";
}

async function finnhubFetch(endpoint: string): Promise<any> {
  const url = `${FINNHUB_BASE}${endpoint}${endpoint.includes('?') ? '&' : '?'}token=${getApiKey()}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Finnhub API error ${resp.status}: ${text}`);
  }
  return resp.json();
}

async function finnhubFetchWithRetry(endpoint: string, retries = 3, delay = 1000): Promise<any> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await finnhubFetch(endpoint);
    } catch (error: any) {
      const msg = error.message?.toLowerCase() || "";
      const isRetryable =
        msg.includes("429") ||
        msg.includes("too many") ||
        msg.includes("timeout") ||
        msg.includes("500") ||
        msg.includes("502") ||
        msg.includes("503") ||
        msg.includes("fetch failed");

      if (attempt < retries - 1 && isRetryable) {
        console.log(`[Finnhub] Retry ${attempt + 1}/${retries} after ${delay * (attempt + 1)}ms`);
        await new Promise((r) => setTimeout(r, delay * (attempt + 1)));
      } else {
        throw error;
      }
    }
  }
  throw new Error("Max retries exceeded");
}

export interface FinnhubCompanyProfile {
  ticker: string;
  name: string;
  country: string;
  currency: string;
  exchange: string;
  ipo: string;
  marketCapitalization: number;
  phone: string;
  shareOutstanding: number;
  weburl: string;
  logo: string;
  finnhubIndustry: string;
}

export interface FinnhubBasicFinancials {
  metric: {
    "52WeekHigh": number;
    "52WeekLow": number;
    "52WeekLowDate": string;
    "52WeekHighDate": string;
    "10DayAverageTradingVolume": number;
    "3MonthAverageTradingVolume": number;
    "beta": number;
    "currentRatio": number;
    "dividendYieldIndicatedAnnual": number;
    "epsGrowth3Y": number;
    "epsTTM": number;
    "marketCapitalization": number;
    "payoutRatioTTM": number;
    "peExclExtraTTM": number;
    "peTTM": number;
    "pbAnnual": number;
    "pfcfShareTTM": number;
    "priceRelativeToS&P50052Week": number;
    "psTTM": number;
    "quickRatio": number;
    "revenueGrowth3Y": number;
    "revenueGrowthTTMYoy": number;
    "revenuePerShareTTM": number;
    "roaRfy": number;
    "roeTTM": number;
    "totalDebtToEquity": number;
    [key: string]: number | string;
  };
}

export interface FinnhubRecommendation {
  symbol: string;
  buy: number;
  hold: number;
  sell: number;
  strongBuy: number;
  strongSell: number;
  period: string;
}

export interface FinnhubPriceTarget {
  symbol: string;
  targetHigh: number;
  targetLow: number;
  targetMean: number;
  targetMedian: number;
  lastUpdated: string;
}

export interface FinnhubEarningsCalendar {
  symbol: string;
  date: string;
  epsActual: number | null;
  epsEstimate: number | null;
  hour: string;
  quarter: number;
  revenueActual: number | null;
  revenueEstimate: number | null;
  year: number;
}

/**
 * Fetch company profile (name, sector, market cap, etc.)
 */
export async function fetchCompanyProfile(symbol: string): Promise<FinnhubCompanyProfile | null> {
  try {
    const data = await finnhubFetchWithRetry(`/stock/profile2?symbol=${encodeURIComponent(symbol)}`);
    if (!data || !data.ticker) return null;
    return data;
  } catch (error) {
    console.error(`[Finnhub] Failed to fetch profile for ${symbol}:`, error);
    return null;
  }
}

/**
 * Fetch basic financial metrics (PE, beta, debt/equity, ratios, growth, etc.)
 */
export async function fetchBasicFinancials(symbol: string): Promise<FinnhubBasicFinancials | null> {
  try {
    const data = await finnhubFetchWithRetry(`/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all`);
    if (!data || !data.metric) return null;
    return data;
  } catch (error) {
    console.error(`[Finnhub] Failed to fetch basic financials for ${symbol}:`, error);
    return null;
  }
}

/**
 * Fetch analyst recommendations (buy/hold/sell counts)
 */
export async function fetchRecommendations(symbol: string): Promise<FinnhubRecommendation[]> {
  try {
    const data = await finnhubFetchWithRetry(`/stock/recommendation?symbol=${encodeURIComponent(symbol)}`);
    if (!Array.isArray(data)) return [];
    return data;
  } catch (error) {
    console.error(`[Finnhub] Failed to fetch recommendations for ${symbol}:`, error);
    return [];
  }
}

/**
 * Fetch price target consensus from analysts
 */
export async function fetchPriceTarget(symbol: string): Promise<FinnhubPriceTarget | null> {
  try {
    const data = await finnhubFetchWithRetry(`/stock/price-target?symbol=${encodeURIComponent(symbol)}`);
    if (!data || !data.targetMean) return null;
    return data;
  } catch (error) {
    console.error(`[Finnhub] Failed to fetch price target for ${symbol}:`, error);
    return null;
  }
}

/**
 * Fetch earnings calendar (upcoming and historical earnings dates)
 */
export async function fetchEarningsCalendar(
  from: string,
  to: string,
  symbol?: string
): Promise<{ earningsCalendar: FinnhubEarningsCalendar[] }> {
  try {
    const symbolParam = symbol ? `&symbol=${encodeURIComponent(symbol)}` : "";
    const data = await finnhubFetchWithRetry(`/calendar/earnings?from=${from}&to=${to}${symbolParam}`);
    return data || { earningsCalendar: [] };
  } catch (error) {
    console.error(`[Finnhub] Failed to fetch earnings calendar:`, error);
    return { earningsCalendar: [] };
  }
}

/**
 * Fetch EPS surprises (historical earnings beats/misses)
 */
export async function fetchEarningsSurprises(symbol: string): Promise<any[]> {
  try {
    const data = await finnhubFetchWithRetry(`/stock/earnings?symbol=${encodeURIComponent(symbol)}`);
    if (!Array.isArray(data)) return [];
    return data;
  } catch (error) {
    console.error(`[Finnhub] Failed to fetch earnings surprises for ${symbol}:`, error);
    return [];
  }
}

/**
 * Finnhub news article interface
 */
export interface FinnhubNewsArticle {
  id: number;
  category: string;
  datetime: number;
  headline: string;
  image: string;
  related: string;
  source: string;
  summary: string;
  url: string;
}

/**
 * Fetch company news from Finnhub
 * @param symbol - Stock symbol
 * @param daysBack - How many days back to fetch (default 7)
 */
export async function fetchCompanyNews(symbol: string, daysBack = 7): Promise<FinnhubNewsArticle[]> {
  try {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - daysBack);
    
    const fromStr = from.toISOString().split('T')[0];
    const toStr = to.toISOString().split('T')[0];
    
    const data = await finnhubFetchWithRetry(
      `/company-news?symbol=${encodeURIComponent(symbol)}&from=${fromStr}&to=${toStr}`
    );
    
    if (!Array.isArray(data)) return [];
    
    return data.map((article: any) => ({
      id: article.id || 0,
      category: article.category || '',
      datetime: article.datetime || 0,
      headline: article.headline || '',
      image: article.image || '',
      related: article.related || '',
      source: article.source || '',
      summary: article.summary || '',
      url: article.url || '',
    }));
  } catch (error) {
    console.error(`[Finnhub] Failed to fetch news for ${symbol}:`, error);
    return [];
  }
}

/**
 * Get comprehensive fundamental data for a symbol
 */
export async function getComprehensiveFundamentals(symbol: string): Promise<{
  profile: FinnhubCompanyProfile | null;
  metrics: FinnhubBasicFinancials | null;
  recommendations: FinnhubRecommendation[];
  priceTarget: FinnhubPriceTarget | null;
  earningsSurprises: any[];
}> {
  const [profile, metrics, recommendations, priceTarget, earningsSurprises] = await Promise.allSettled([
    fetchCompanyProfile(symbol),
    fetchBasicFinancials(symbol),
    fetchRecommendations(symbol),
    fetchPriceTarget(symbol),
    fetchEarningsSurprises(symbol),
  ]);

  return {
    profile: profile.status === "fulfilled" ? profile.value : null,
    metrics: metrics.status === "fulfilled" ? metrics.value : null,
    recommendations: recommendations.status === "fulfilled" ? recommendations.value : [],
    priceTarget: priceTarget.status === "fulfilled" ? priceTarget.value : null,
    earningsSurprises: earningsSurprises.status === "fulfilled" ? earningsSurprises.value : [],
  };
}

/**
 * Company overview: profile, recommendations, price target, next earnings, recent surprises in one batch.
 * Use for MarketFlow and any "stock summary" view; single server-side batch instead of multiple calls.
 */
export interface CompanyOverview {
  profile: FinnhubCompanyProfile | null;
  recommendations: FinnhubRecommendation[];
  priceTarget: FinnhubPriceTarget | null;
  nextEarnings: FinnhubEarningsCalendar | null;
  recentEarningsSurprises: any[];
}

export async function getCompanyOverview(symbol: string): Promise<CompanyOverview> {
  const from = new Date();
  const to = new Date();
  to.setMonth(to.getMonth() + 3);
  const fromStr = from.toISOString().split("T")[0];
  const toStr = to.toISOString().split("T")[0];

  const [profile, recommendations, priceTarget, calendar, earningsSurprises] = await Promise.all([
    fetchCompanyProfile(symbol),
    fetchRecommendations(symbol),
    fetchPriceTarget(symbol),
    fetchEarningsCalendar(fromStr, toStr, symbol),
    fetchEarningsSurprises(symbol),
  ]);

  const nextEarnings =
    calendar.earningsCalendar?.length > 0
      ? calendar.earningsCalendar.find((e) => e.symbol.toUpperCase() === symbol.toUpperCase()) ?? calendar.earningsCalendar[0]
      : null;

  return {
    profile,
    recommendations,
    priceTarget,
    nextEarnings,
    recentEarningsSurprises: earningsSurprises ?? [],
  };
}
