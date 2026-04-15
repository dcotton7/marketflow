const ALPACA_BASE_URL = process.env.ALPACA_BASE_URL || "https://paper-api.alpaca.markets";
const ALPACA_DATA_URL = "https://data.alpaca.markets";

function getApiKey(): string {
  return process.env.ALPACA_API_KEY || "";
}

function getApiSecret(): string {
  return process.env.ALPACA_API_SECRET || "";
}

function alpacaHeaders(): Record<string, string> {
  return {
    "APCA-API-KEY-ID": getApiKey(),
    "APCA-API-SECRET-KEY": getApiSecret(),
  };
}

async function alpacaFetch(url: string): Promise<any> {
  const resp = await fetch(url, { headers: alpacaHeaders() });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Alpaca API error ${resp.status}: ${text}`);
  }
  return resp.json();
}

async function alpacaFetchWithRetry(url: string, retries = 3, delay = 1000): Promise<any> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await alpacaFetch(url);
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
        console.log(`[Alpaca] Retry ${attempt + 1}/${retries} after ${delay * (attempt + 1)}ms`);
        await new Promise((r) => setTimeout(r, delay * (attempt + 1)));
      } else {
        throw error;
      }
    }
  }
  throw new Error("Max retries exceeded");
}

function formatAlpacaDate(d: Date): string {
  return d.toISOString();
}

function mapAlpacaTimeframe(interval: string): string {
  switch (interval) {
    case "1m":
      return "1Min";
    case "5m":
      return "5Min";
    case "15m":
      return "15Min";
    case "30m":
      return "30Min";
    case "60m":
    case "1h":
      return "1Hour";
    case "1d":
      return "1Day";
    default:
      return "1Day";
  }
}

export interface AlpacaBar {
  t: string;  // timestamp
  o: number;  // open
  h: number;  // high
  l: number;  // low
  c: number;  // close
  v: number;  // volume
  n?: number; // trade count
  vw?: number; // volume weighted average price
}

export interface AlpacaCandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface AlpacaTradingCalendarDay {
  date: string;
  open?: string;
  close?: string;
  session_open?: string;
  session_close?: string;
}

export async function fetchAlpacaTradingCalendar(
  startDate: string,
  endDate: string
): Promise<AlpacaTradingCalendarDay[]> {
  try {
    const params = new URLSearchParams({
      start: startDate,
      end: endDate,
    });
    const url = `${ALPACA_BASE_URL}/v2/calendar?${params}`;
    const data = await alpacaFetchWithRetry(url);
    return Array.isArray(data) ? (data as AlpacaTradingCalendarDay[]) : [];
  } catch (error) {
    console.error(`[Alpaca] Failed to fetch trading calendar ${startDate}..${endDate}:`, error);
    return [];
  }
}

const alpacaAssetNameCache = new Map<string, string | null>();

/**
 * Official asset display name from Alpaca (works well for ETFs; Finnhub/fundamentals often leave name blank).
 * GET /v2/assets/{symbol_or_asset_id}
 */
export async function fetchAlpacaAssetName(symbol: string): Promise<string | null> {
  const upper = symbol.toUpperCase();
  const hit = alpacaAssetNameCache.get(upper);
  if (hit !== undefined) return hit;

  if (!getApiKey() || !getApiSecret()) {
    alpacaAssetNameCache.set(upper, null);
    return null;
  }

  try {
    const url = `${ALPACA_BASE_URL}/v2/assets/${encodeURIComponent(upper)}`;
    const data = await alpacaFetchWithRetry(url);
    const name = typeof data?.name === "string" ? data.name.trim() : "";
    const out = name.length > 0 ? name : null;
    alpacaAssetNameCache.set(upper, out);
    return out;
  } catch {
    alpacaAssetNameCache.set(upper, null);
    return null;
  }
}

/**
 * Fetch intraday bars from Alpaca Market Data API v2
 * Supports extended hours (pre-market + after-hours)
 */
export async function fetchAlpacaIntradayBars(
  ticker: string,
  startDate: Date,
  endDate: Date,
  timeframe: string = "5Min",
  includeExtendedHours: boolean = false
): Promise<AlpacaCandle[]> {
  const extractBars = (data: any): AlpacaBar[] => {
    if (!data) return [];
    if (Array.isArray(data.bars)) return data.bars as AlpacaBar[];
    if (data.bars && typeof data.bars === "object" && Array.isArray(data.bars[ticker])) return data.bars[ticker] as AlpacaBar[];
    return [];
  };

  const params = new URLSearchParams({
    start: formatAlpacaDate(startDate),
    end: formatAlpacaDate(endDate),
    timeframe,
    feed: "sip", // SIP feed includes all trading hours (when entitled)
    limit: "10000", // Default is 1000; we must raise this for longer ranges
    sort: "asc",
  });

  console.log(`[Alpaca] Fetching ${ticker} bars`);
  console.log(`  - Timeframe: ${timeframe}, ETH: ${includeExtendedHours}`);
  console.log(`  - Date Range: ${startDate.toISOString()} to ${endDate.toISOString()}`);
  
  try {
    // Alpaca paginates via next_page_token. Without pagination, intraday ranges look "stuck" in older dates.
    const rawBars: AlpacaBar[] = [];
    let pageToken: string | null | undefined = undefined;
    let pages = 0;

    for (let i = 0; i < 50; i++) {
      if (pageToken) params.set("page_token", pageToken);
      else params.delete("page_token");

      const url = `${ALPACA_DATA_URL}/v2/stocks/${encodeURIComponent(ticker)}/bars?${params}`;
      if (i === 0) console.log(`  - URL: ${url}`);
      const data = await alpacaFetchWithRetry(url);

      const pageBars = extractBars(data);
      rawBars.push(...pageBars);
      pages++;

      pageToken = (data?.next_page_token ?? data?.nextPageToken ?? null) as any;
      if (!pageToken) break;
      if (pageBars.length === 0) break;
    }

    if (rawBars.length === 0) {
      console.log(`[Alpaca] No bars returned for ${ticker}`);
      return [];
    }

    const allBars = rawBars
      .map((bar: AlpacaBar) => ({
        date: bar.t,
        open: bar.o,
        high: bar.h,
        low: bar.l,
        close: bar.c,
        volume: bar.v || 0,
      }))
      .filter(
        (bar) =>
          bar.open != null &&
          bar.close != null &&
          bar.high != null &&
          bar.low != null &&
          Number.isFinite(bar.open) &&
          Number.isFinite(bar.close) &&
          Number.isFinite(bar.high) &&
          Number.isFinite(bar.low)
      );
    
    console.log(`[Alpaca] Received ${allBars.length} total bars from API (${pages} page${pages === 1 ? "" : "s"})`);
    if (allBars.length > 0) {
      const firstBar = new Date(allBars[0].date);
      const lastBar = new Date(allBars[allBars.length - 1].date);
      console.log(`  - First bar: ${firstBar.toISOString()}`);
      console.log(`  - Last bar: ${lastBar.toISOString()}`);
    }
    
    // If extended hours not requested, filter to regular trading hours (9:30 AM - 4:00 PM ET)
    if (!includeExtendedHours) {
      const filteredBars = allBars.filter((bar) => {
        const d = new Date(bar.date);
        const etHour = parseInt(d.toLocaleString("en-US", { timeZone: "America/New_York", hour: "2-digit", hour12: false }));
        const etMin = parseInt(d.toLocaleString("en-US", { timeZone: "America/New_York", minute: "2-digit" }));
        const etTotalMin = etHour * 60 + etMin;
        
        // Regular hours: 9:30 AM (570 min) to 4:00 PM (960 min) ET
        return etTotalMin >= 570 && etTotalMin < 960;
      });
      console.log(`[Alpaca] Filtered to ${filteredBars.length} regular hours bars (ETH=false)`);
      return filteredBars;
    }
    
    console.log(`[Alpaca] Returning ${allBars.length} bars (ETH=true, no filtering)`);
    return allBars;
  } catch (error) {
    console.error(`[Alpaca] Failed to fetch bars for ${ticker}:`, error);
    return []; // Return empty instead of throwing
  }
}

/**
 * Fetch current quote for a ticker
 * Note: Alpaca quotes API doesn't provide prevClose, so we fetch the last daily bar
 */
export async function fetchAlpacaQuote(ticker: string): Promise<{
  ticker: string;
  lastPrice: number;
  askPrice: number;
  bidPrice: number;
  prevClose: number;
  volume: number;
  timestamp: string;
} | null> {
  try {
    // Fetch daily bars first - this is reliable even when market is closed
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 10);
    
    const dailyBars = await fetchAlpacaDailyBars(ticker, startDate, endDate).catch((err) => {
      console.error(`[Alpaca] Daily bars failed for ${ticker}:`, err.message);
      return [];
    });
    
    // Try to get a live snapshot first so lastPrice can use the latest trade
    let snapshotData: any = null;
    try {
      snapshotData = await alpacaFetchWithRetry(
        `${ALPACA_DATA_URL}/v2/stocks/snapshots?symbols=${encodeURIComponent(ticker)}&feed=sip`
      );
    } catch {
      // Snapshot API may fail after hours or on entitlement gaps - daily bars still provide a fallback
    }
    
    if (dailyBars.length === 0) {
      console.warn(`[Alpaca] No daily bars for ${ticker}`);
      return null;
    }
    
    // Use the most recent regular-session close as the fallback baseline.
    const lastBarClose = dailyBars[dailyBars.length - 1].close;
    const prevBarClose = dailyBars.length >= 2 ? dailyBars[dailyBars.length - 2].close : lastBarClose;

    const snapshot = snapshotData?.[ticker] ?? snapshotData?.snapshots?.[ticker] ?? null;
    const latestTradePrice = snapshot?.latestTrade?.p;
    const quoteAsk = snapshot?.latestQuote?.ap || 0;
    const quoteBid = snapshot?.latestQuote?.bp || 0;
    const midPrice = quoteAsk > 0 && quoteBid > 0 ? (quoteAsk + quoteBid) / 2 : 0;
    const lastPrice = latestTradePrice || midPrice || lastBarClose;
    const volume = snapshot?.minuteBar?.v || dailyBars[dailyBars.length - 1]?.volume || 0;
    const timestamp =
      snapshot?.latestTrade?.t ||
      snapshot?.latestQuote?.t ||
      new Date().toISOString();
    
    return {
      ticker,
      lastPrice,
      askPrice: quoteAsk,
      bidPrice: quoteBid,
      prevClose: prevBarClose,
      volume,
      timestamp,
    };
  } catch (error) {
    console.error(`[Alpaca] Failed to fetch quote for ${ticker}:`, error);
    return null;
  }
}

/**
 * Get intraday bars with automatic timeframe mapping
 */
export async function getAlpacaIntradayData(
  symbol: string,
  startDate: Date,
  endDate: Date,
  interval: string = "5m",
  includeExtendedHours: boolean = false
): Promise<AlpacaCandle[]> {
  const timeframe = mapAlpacaTimeframe(interval);
  return fetchAlpacaIntradayBars(symbol, startDate, endDate, timeframe, includeExtendedHours);
}

/**
 * Fetch daily EOD bars from Alpaca (for technicals, suggest API fallback when Tiingo fails)
 */
export async function fetchAlpacaDailyBars(
  ticker: string,
  startDate: Date,
  endDate: Date
): Promise<AlpacaCandle[]> {
  return fetchAlpacaIntradayBars(ticker, startDate, endDate, "1Day", true);
}

const MULTI_SYMBOL_BATCH_SIZE = 100; // Stay under URL length limits

/**
 * Fetch daily EOD bars for multiple symbols in one API call.
 * Uses Alpaca multi-symbol endpoint: GET /v2/stocks/bars?symbols=AAPL,MSFT,...
 * Returns Map<symbol, AlpacaCandle[]>. Symbols with no data get empty array.
 */
export async function fetchAlpacaMultiSymbolDailyBars(
  symbols: string[],
  startDate: Date,
  endDate: Date
): Promise<Map<string, AlpacaCandle[]>> {
  const result = new Map<string, AlpacaCandle[]>();
  symbols.forEach((s) => result.set(s.toUpperCase(), []));

  if (symbols.length === 0) return result;

  const params = new URLSearchParams({
    symbols: symbols.map((s) => s.toUpperCase()).join(","),
    start: formatAlpacaDate(startDate),
    end: formatAlpacaDate(endDate),
    timeframe: "1Day",
    feed: "sip",
    limit: "10000",
    sort: "asc",
  });

  try {
    let pageToken: string | null | undefined = undefined;
    for (let i = 0; i < 50; i++) {
      if (pageToken) params.set("page_token", pageToken);
      else params.delete("page_token");

      const url = `${ALPACA_DATA_URL}/v2/stocks/bars?${params}`;
      const data = await alpacaFetchWithRetry(url);

      const barsObj = data?.bars;
      if (barsObj && typeof barsObj === "object") {
        for (const [sym, barList] of Object.entries(barsObj)) {
          const arr = barList as AlpacaBar[];
          if (!Array.isArray(arr)) continue;
          const candles: AlpacaCandle[] = arr
            .filter((b) => b?.o != null && b?.c != null)
            .map((b) => ({
              date: b.t,
              open: b.o,
              high: b.h,
              low: b.l,
              close: b.c,
              volume: b.v || 0,
            }));
          const existing = result.get(sym.toUpperCase()) || [];
          result.set(sym.toUpperCase(), [...existing, ...candles]);
        }
      }

      pageToken = data?.next_page_token ?? data?.nextPageToken ?? null;
      if (!pageToken) break;
    }

    // Sort each symbol's bars by date
    for (const [sym, candles] of result) {
      result.set(sym, candles.sort((a, b) => a.date.localeCompare(b.date)));
    }
  } catch (error: any) {
    console.error(`[Alpaca] Multi-symbol bars failed: ${error.message}`);
  }

  return result;
}
