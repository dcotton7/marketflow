const TIINGO_BASE = "https://api.tiingo.com";

function getToken(): string {
  return process.env.TIINGO_API_KEY || "";
}

function tiingoHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Token ${getToken()}`,
  };
}

async function tiingoFetch(url: string): Promise<any> {
  const resp = await fetch(url, { headers: tiingoHeaders() });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Tiingo API error ${resp.status}: ${text}`);
  }
  return resp.json();
}

async function tiingoFetchWithRetry(url: string, retries = 3, delay = 1000): Promise<any> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await tiingoFetch(url);
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
        console.log(`[Tiingo] Retry ${attempt + 1}/${retries} after ${delay * (attempt + 1)}ms`);
        await new Promise((r) => setTimeout(r, delay * (attempt + 1)));
      } else {
        throw error;
      }
    }
  }
  throw new Error("Max retries exceeded");
}

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

function mapTiingoInterval(interval: string): { isIntraday: boolean; resampleFreq: string } {
  switch (interval) {
    case "1m":
      return { isIntraday: true, resampleFreq: "1min" };
    case "5m":
      return { isIntraday: true, resampleFreq: "5min" };
    case "15m":
      return { isIntraday: true, resampleFreq: "15min" };
    case "30m":
      return { isIntraday: true, resampleFreq: "30min" };
    case "60m":
    case "1h":
      return { isIntraday: true, resampleFreq: "1hour" };
    case "1d":
      return { isIntraday: false, resampleFreq: "daily" };
    case "1wk":
      return { isIntraday: false, resampleFreq: "weekly" };
    case "1mo":
      return { isIntraday: false, resampleFreq: "monthly" };
    default:
      return { isIntraday: false, resampleFreq: "daily" };
  }
}

function isMarketHours(d: Date): boolean {
  const etParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(d);
  let etH = parseInt(etParts.find((p) => p.type === "hour")?.value || "0", 10);
  if (etH === 24) etH = 0;
  const etM = parseInt(etParts.find((p) => p.type === "minute")?.value || "0", 10);
  const totalMin = etH * 60 + etM;
  return totalMin >= 570 && totalMin < 960;
}

export interface TiingoCandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TiingoQuote {
  ticker: string;
  tngoLast: number;
  prevClose: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  timestamp: string;
}

export async function fetchEODPrices(
  ticker: string,
  startDate: Date,
  endDate?: Date,
  resampleFreq: string = "daily"
): Promise<TiingoCandle[]> {
  const params = new URLSearchParams({
    startDate: formatDate(startDate),
    token: getToken(),
    resampleFreq,
  });
  if (endDate) params.set("endDate", formatDate(endDate));

  const url = `${TIINGO_BASE}/tiingo/daily/${encodeURIComponent(ticker)}/prices?${params}`;
  const data = await tiingoFetchWithRetry(url);

  return (data || []).map((d: any) => ({
    date: d.date?.split("T")[0] || d.date,
    open: d.adjOpen ?? d.open,
    high: d.adjHigh ?? d.high,
    low: d.adjLow ?? d.low,
    close: d.adjClose ?? d.close,
    volume: d.adjVolume ?? d.volume ?? 0,
  }));
}

export async function fetchIntradayPrices(
  ticker: string,
  startDate: Date,
  endDate?: Date,
  resampleFreq: string = "5min"
): Promise<TiingoCandle[]> {
  const params = new URLSearchParams({
    startDate: formatDate(startDate),
    resampleFreq,
    columns: "open,high,low,close,volume",
    token: getToken(),
  });
  if (endDate) params.set("endDate", formatDate(endDate));

  const url = `${TIINGO_BASE}/iex/${encodeURIComponent(ticker)}/prices?${params}`;
  const data = await tiingoFetchWithRetry(url);

  return (data || [])
    .filter((d: any) => {
      if (d.open == null || d.close == null) return false;
      const dt = new Date(d.date);
      return isMarketHours(dt);
    })
    .map((d: any) => ({
      date: new Date(d.date).toISOString(),
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
      volume: d.volume ?? 0,
    }));
}

export async function fetchCurrentQuote(ticker: string): Promise<TiingoQuote | null> {
  try {
    const url = `${TIINGO_BASE}/iex/${encodeURIComponent(ticker)}?token=${getToken()}`;
    const data = await tiingoFetchWithRetry(url);
    const item = Array.isArray(data) ? data[0] : data;
    if (!item) return null;
    return {
      ticker: item.ticker || ticker,
      tngoLast: item.tngoLast ?? item.last ?? 0,
      prevClose: item.prevClose ?? 0,
      open: item.open ?? 0,
      high: item.high ?? 0,
      low: item.low ?? 0,
      volume: item.volume ?? 0,
      timestamp: item.timestamp || "",
    };
  } catch (error) {
    console.error(`[Tiingo] Failed to fetch quote for ${ticker}:`, error);
    return null;
  }
}

export async function fetchTickerMeta(ticker: string): Promise<{
  name: string;
  description: string;
  exchangeCode: string;
  startDate: string;
  endDate: string;
} | null> {
  try {
    const url = `${TIINGO_BASE}/tiingo/daily/${encodeURIComponent(ticker)}?token=${getToken()}`;
    const data = await tiingoFetchWithRetry(url);
    return {
      name: data.name || ticker,
      description: data.description || "",
      exchangeCode: data.exchangeCode || "",
      startDate: data.startDate || "",
      endDate: data.endDate || "",
    };
  } catch (error) {
    console.error(`[Tiingo] Failed to fetch meta for ${ticker}:`, error);
    return null;
  }
}

export async function searchTickers(query: string): Promise<Array<{ ticker: string; name: string }>> {
  try {
    const url = `${TIINGO_BASE}/tiingo/utilities/search?query=${encodeURIComponent(query)}&token=${getToken()}`;
    const data = await tiingoFetchWithRetry(url);
    return (data || []).map((d: any) => ({
      ticker: d.ticker || "",
      name: d.name || "",
    }));
  } catch (error) {
    console.error(`[Tiingo] Search failed for "${query}":`, error);
    return [];
  }
}

export async function getHistoricalBars(
  symbol: string,
  startDate: Date,
  endDate: Date,
  interval: string = "1d"
): Promise<TiingoCandle[]> {
  const { isIntraday, resampleFreq } = mapTiingoInterval(interval);
  if (isIntraday) {
    return fetchIntradayPrices(symbol, startDate, endDate, resampleFreq);
  }
  return fetchEODPrices(symbol, startDate, endDate, resampleFreq);
}

export async function getChartData(
  symbol: string,
  period: string,
  interval: string = "1d"
): Promise<TiingoCandle[]> {
  const endDate = new Date();
  const startDate = getPeriodStartDate(period);
  return getHistoricalBars(symbol, startDate, endDate, interval);
}

function getPeriodStartDate(period: string): Date {
  const now = new Date();
  switch (period) {
    case "59d":
      return new Date(now.getTime() - 59 * 24 * 60 * 60 * 1000);
    case "1mo":
      return new Date(new Date().setMonth(now.getMonth() - 1));
    case "2mo":
      return new Date(new Date().setMonth(now.getMonth() - 2));
    case "3mo":
      return new Date(new Date().setMonth(now.getMonth() - 3));
    case "6mo":
      return new Date(new Date().setMonth(now.getMonth() - 6));
    case "1y":
      return new Date(new Date().setFullYear(now.getFullYear() - 1));
    case "2y":
      return new Date(new Date().setFullYear(now.getFullYear() - 2));
    case "3y":
      return new Date(new Date().setFullYear(now.getFullYear() - 3));
    case "5y":
      return new Date(new Date().setFullYear(now.getFullYear() - 5));
    default:
      return new Date(new Date().setFullYear(now.getFullYear() - 3));
  }
}

export interface TiingoNewsArticle {
  id: number;
  title: string;
  url: string;
  source: string;
  publishedDate: string;
  description: string;
  tickers: string[];
}

export async function fetchNews(ticker: string, limit = 15): Promise<TiingoNewsArticle[]> {
  try {
    const url = `${TIINGO_BASE}/tiingo/news?tickers=${encodeURIComponent(ticker)}&limit=${limit}&token=${getToken()}`;
    const data = await tiingoFetchWithRetry(url);
    if (!Array.isArray(data)) return [];
    return data.map((article: any) => ({
      id: article.id || 0,
      title: article.title || '',
      url: article.url || '',
      source: article.source || '',
      publishedDate: article.publishedDate || '',
      description: article.description || '',
      tickers: article.tickers || [],
    }));
  } catch (error) {
    console.error(`[Tiingo] Failed to fetch news for ${ticker}:`, error);
    return [];
  }
}
