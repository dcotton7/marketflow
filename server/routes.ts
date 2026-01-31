import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { initializeDatabase, isDatabaseAvailable } from "./db";
import { api } from "@shared/routes";
import { z } from "zod";

// Dynamic import to handle ESM/CJS compatibility
let yahooFinance: any = null;

async function getYahooFinance() {
  if (!yahooFinance) {
    try {
      const YahooFinanceModule = await import('yahoo-finance2');
      const YahooFinance = YahooFinanceModule.default || YahooFinanceModule;
      if (typeof YahooFinance === 'function') {
        yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });
      } else if (YahooFinance.default && typeof YahooFinance.default === 'function') {
        yahooFinance = new YahooFinance.default({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });
      } else {
        yahooFinance = YahooFinance;
      }
      console.log("Yahoo Finance initialized successfully");
    } catch (error) {
      console.error("Failed to initialize Yahoo Finance:", error);
      throw error;
    }
  }
  return yahooFinance;
}

// Helper to calculate date for period
function getPeriodStartDate(period: string): Date {
  const now = new Date();
  switch (period) {
    case '1mo':
      return new Date(now.setMonth(now.getMonth() - 1));
    case '3mo':
      return new Date(now.setMonth(now.getMonth() - 3));
    case '6mo':
      return new Date(now.setMonth(now.getMonth() - 6));
    case '1y':
      return new Date(now.setFullYear(now.getFullYear() - 1));
    case '2y':
      return new Date(now.setFullYear(now.getFullYear() - 2));
    default:
      return new Date(now.setFullYear(now.getFullYear() - 1));
  }
}

// Helper to get chart data (historical data)
async function getChartData(yf: any, symbol: string, period: string = '1y', interval: string = '1d'): Promise<Candle[]> {
  const startDate = getPeriodStartDate(period);
  const result = await yf.chart(symbol, { period1: startDate, period2: new Date(), interval });
  if (!result.quotes || result.quotes.length === 0) {
    return [];
  }
  return result.quotes
    .filter((item: any) => item.open != null && item.close != null)
    .map((item: any) => ({
      date: interval.includes('m') ? new Date(item.date).toISOString() : new Date(item.date).toISOString().split('T')[0],
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close,
      volume: item.volume || 0,
    }));
}

// S&P 100 stocks for the scanner
const STOCK_UNIVERSE = [
  'AAPL', 'MSFT', 'GOOGL', 'GOOG', 'AMZN', 'NVDA', 'META', 'TSLA', 'BRK.B', 'UNH',
  'XOM', 'JNJ', 'JPM', 'V', 'PG', 'MA', 'HD', 'CVX', 'MRK', 'LLY',
  'ABBV', 'PEP', 'KO', 'AVGO', 'COST', 'TMO', 'MCD', 'WMT', 'CSCO', 'ABT',
  'ACN', 'CRM', 'DHR', 'NEE', 'LIN', 'ADBE', 'TXN', 'AMD', 'PM', 'NFLX',
  'WFC', 'RTX', 'CMCSA', 'HON', 'T', 'UNP', 'LOW', 'BA', 'ORCL', 'AMGN',
  'IBM', 'SPGI', 'QCOM', 'GE', 'CAT', 'INTC', 'INTU', 'SBUX', 'PLD', 'MDLZ',
  'GILD', 'GS', 'AXP', 'BLK', 'DE', 'ADI', 'CVS', 'ISRG', 'BKNG', 'SYK',
  'REGN', 'MMC', 'VRTX', 'TJX', 'SCHW', 'CB', 'PGR', 'CI', 'MO', 'DUK',
  'SO', 'LRCX', 'BDX', 'BSX', 'CME', 'COP', 'EOG', 'EQIX', 'FIS', 'ICE',
  'MMM', 'MU', 'NSC', 'PNC', 'USB', 'SPY', 'QQQ', 'IWM', 'DIA', 'GLD'
];

// Sector ETF mappings
const SECTOR_ETFS: Record<string, string[]> = {
  'Technology': ['XLK', 'QQQ', 'VGT'],
  'Healthcare': ['XLV', 'VHT', 'IBB'],
  'Financial Services': ['XLF', 'VFH', 'KBE'],
  'Consumer Cyclical': ['XLY', 'VCR', 'FDIS'],
  'Consumer Defensive': ['XLP', 'VDC', 'FSTA'],
  'Energy': ['XLE', 'VDE', 'OIH'],
  'Industrials': ['XLI', 'VIS', 'FIDU'],
  'Basic Materials': ['XLB', 'VAW', 'FMAT'],
  'Real Estate': ['XLRE', 'VNQ', 'IYR'],
  'Utilities': ['XLU', 'VPU', 'FUTY'],
  'Communication Services': ['XLC', 'VOX', 'FCOM'],
};

interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Helper to detect patterns
function detectPattern(candles: Candle[], patternType: string): boolean {
  if (candles.length < 5) return false;
  const current = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  
  const isGreen = (c: Candle) => c.close > c.open;
  const isRed = (c: Candle) => c.close < c.open;
  const bodySize = (c: Candle) => Math.abs(c.close - c.open);
  const upperShadow = (c: Candle) => c.high - Math.max(c.open, c.close);
  const lowerShadow = (c: Candle) => Math.min(c.open, c.close) - c.low;

  switch (patternType) {
    case 'Doji':
      return bodySize(current) <= (current.high - current.low) * 0.1;
    
    case 'Hammer':
      return (
        lowerShadow(current) >= bodySize(current) * 2 &&
        upperShadow(current) <= bodySize(current) * 0.5
      );

    case 'Bullish Engulfing':
      return (
        isRed(prev) &&
        isGreen(current) &&
        current.open <= prev.close &&
        current.close >= prev.open
      );

    case 'Bearish Engulfing':
       return (
        isGreen(prev) &&
        isRed(current) &&
        current.open >= prev.close &&
        current.close <= prev.open
       );
       
    case 'Morning Star':
      const first = candles[candles.length - 3];
      return (
        isRed(first) &&
        bodySize(prev) < bodySize(first) * 0.5 &&
        isGreen(current) &&
        current.close > (first.open + first.close) / 2
      );

    case 'VCP':
      return detectVCP(candles);

    default:
      return false;
  }
}

// VCP (Volatility Contraction Pattern) Detection
// Looks for progressively tightening price ranges with decreasing volume
function detectVCP(candles: Candle[]): boolean {
  if (candles.length < 30) return false;
  
  // Get last 30 days of data
  const recentCandles = candles.slice(-30);
  
  // Divide into 3 periods to check for contraction
  const period1 = recentCandles.slice(0, 10);
  const period2 = recentCandles.slice(10, 20);
  const period3 = recentCandles.slice(20, 30);
  
  // Calculate price range (volatility) for each period
  const getRange = (c: Candle[]) => {
    const highs = c.map(x => x.high);
    const lows = c.map(x => x.low);
    const maxHigh = Math.max(...highs);
    const minLow = Math.min(...lows);
    const avgPrice = c.reduce((sum, x) => sum + x.close, 0) / c.length;
    return (maxHigh - minLow) / avgPrice; // Normalized range as percentage
  };
  
  // Calculate average volume for each period
  const getAvgVolume = (c: Candle[]) => c.reduce((sum, x) => sum + x.volume, 0) / c.length;
  
  const range1 = getRange(period1);
  const range2 = getRange(period2);
  const range3 = getRange(period3);
  
  const vol1 = getAvgVolume(period1);
  const vol2 = getAvgVolume(period2);
  const vol3 = getAvgVolume(period3);
  
  // VCP characteristics:
  // 1. Price range should be contracting (each period smaller than previous)
  // 2. Volume should be decreasing or stable
  // 3. Price should be near highs of the consolidation (not breaking down)
  
  const rangeContracting = range2 < range1 * 0.9 && range3 < range2 * 0.9;
  const volumeDecreasing = vol2 <= vol1 * 1.1 && vol3 <= vol2 * 1.1;
  
  // Check if current price is in upper half of consolidation range
  const consolidationHigh = Math.max(...recentCandles.map(c => c.high));
  const consolidationLow = Math.min(...recentCandles.map(c => c.low));
  const currentClose = recentCandles[recentCandles.length - 1].close;
  const inUpperHalf = currentClose > (consolidationHigh + consolidationLow) / 2;
  
  return rangeContracting && volumeDecreasing && inUpperHalf;
}

// Detect VCP with loose rules (more variance allowed)
function detectVCPLoose(candles: Candle[]): boolean {
  if (candles.length < 30) return false;
  
  const recentCandles = candles.slice(-30);
  const period1 = recentCandles.slice(0, 10);
  const period2 = recentCandles.slice(10, 20);
  const period3 = recentCandles.slice(20, 30);
  
  const getRange = (c: Candle[]) => {
    const highs = c.map(x => x.high);
    const lows = c.map(x => x.low);
    const maxHigh = Math.max(...highs);
    const minLow = Math.min(...lows);
    const avgPrice = c.reduce((sum, x) => sum + x.close, 0) / c.length;
    return (maxHigh - minLow) / avgPrice;
  };
  
  const getAvgVolume = (c: Candle[]) => c.reduce((sum, x) => sum + x.volume, 0) / c.length;
  
  const range1 = getRange(period1);
  const range2 = getRange(period2);
  const range3 = getRange(period3);
  
  const vol1 = getAvgVolume(period1);
  const vol2 = getAvgVolume(period2);
  const vol3 = getAvgVolume(period3);
  
  // Loose: Allow more variance (1.0 instead of 0.9, 1.3 instead of 1.1)
  const rangeContracting = range3 < range1 * 1.0; // Just need overall contraction
  const volumeStable = vol3 <= vol1 * 1.3;
  
  const consolidationHigh = Math.max(...recentCandles.map(c => c.high));
  const consolidationLow = Math.min(...recentCandles.map(c => c.low));
  const currentClose = recentCandles[recentCandles.length - 1].close;
  const inUpperThird = currentClose > consolidationLow + (consolidationHigh - consolidationLow) * 0.4;
  
  return rangeContracting && volumeStable && inUpperThird;
}

// Weekly Tight: 1-4 weeks of tight consolidation (current)
function detectWeeklyTight(candles: Candle[], loose: boolean = false): boolean {
  if (candles.length < 5) return false;
  
  // Look at last 5-20 trading days (1-4 weeks)
  const recentCandles = candles.slice(-20);
  if (recentCandles.length < 5) return false;
  
  // Calculate the price range as percentage of average price
  const highs = recentCandles.map(c => c.high);
  const lows = recentCandles.map(c => c.low);
  const maxHigh = Math.max(...highs);
  const minLow = Math.min(...lows);
  const avgPrice = recentCandles.reduce((sum, c) => sum + c.close, 0) / recentCandles.length;
  const rangePercent = ((maxHigh - minLow) / avgPrice) * 100;
  
  // Tight threshold: price range < 8% (tight) or < 12% (loose)
  const threshold = loose ? 12 : 8;
  
  // Must be current (last bar within range)
  const lastClose = recentCandles[recentCandles.length - 1].close;
  const isCurrent = lastClose >= minLow && lastClose <= maxHigh;
  
  // Volume should be decreasing or stable
  const firstHalfVol = recentCandles.slice(0, Math.floor(recentCandles.length / 2))
    .reduce((sum, c) => sum + c.volume, 0);
  const secondHalfVol = recentCandles.slice(Math.floor(recentCandles.length / 2))
    .reduce((sum, c) => sum + c.volume, 0);
  const volumeStable = secondHalfVol <= firstHalfVol * (loose ? 1.5 : 1.2);
  
  return rangePercent <= threshold && isCurrent && volumeStable;
}

// Monthly Tight: 1-4 months of tight consolidation (current)
function detectMonthlyTight(candles: Candle[], loose: boolean = false): boolean {
  if (candles.length < 20) return false;
  
  // Look at last 20-80 trading days (1-4 months)
  const recentCandles = candles.slice(-80);
  if (recentCandles.length < 20) return false;
  
  // Calculate the price range as percentage of average price
  const highs = recentCandles.map(c => c.high);
  const lows = recentCandles.map(c => c.low);
  const maxHigh = Math.max(...highs);
  const minLow = Math.min(...lows);
  const avgPrice = recentCandles.reduce((sum, c) => sum + c.close, 0) / recentCandles.length;
  const rangePercent = ((maxHigh - minLow) / avgPrice) * 100;
  
  // Monthly tight threshold: price range < 15% (tight) or < 22% (loose)
  const threshold = loose ? 22 : 15;
  
  // Must be current (last bar within range)
  const lastClose = recentCandles[recentCandles.length - 1].close;
  const isCurrent = lastClose >= minLow && lastClose <= maxHigh;
  
  // Volume should be lower in recent period
  const firstHalfVol = recentCandles.slice(0, Math.floor(recentCandles.length / 2))
    .reduce((sum, c) => sum + c.volume, 0);
  const secondHalfVol = recentCandles.slice(Math.floor(recentCandles.length / 2))
    .reduce((sum, c) => sum + c.volume, 0);
  const volumeStable = secondHalfVol <= firstHalfVol * (loose ? 1.5 : 1.2);
  
  return rangePercent <= threshold && isCurrent && volumeStable;
}

// Detect chart patterns with strictness setting
function detectChartPattern(candles: Candle[], pattern: string, strictness: string = 'tight'): boolean {
  const useTight = strictness === 'tight' || strictness === 'both';
  const useLoose = strictness === 'loose' || strictness === 'both';
  
  switch (pattern) {
    case 'VCP':
      if (useTight && detectVCP(candles)) return true;
      if (useLoose && detectVCPLoose(candles)) return true;
      return false;
    case 'Weekly Tight':
      if (useTight && detectWeeklyTight(candles, false)) return true;
      if (useLoose && detectWeeklyTight(candles, true)) return true;
      return false;
    case 'Monthly Tight':
      if (useTight && detectMonthlyTight(candles, false)) return true;
      if (useLoose && detectMonthlyTight(candles, true)) return true;
      return false;
    default:
      return false;
  }
}

// Calculate Simple Moving Average
function calculateSMA(candles: Candle[], period: number): number | null {
  if (candles.length < period) return null;
  const recentCandles = candles.slice(-period);
  const sum = recentCandles.reduce((acc, c) => acc + c.close, 0);
  return sum / period;
}

// Check SMA filter conditions
function checkSMAFilter(candles: Candle[], smaFilter: string, currentPrice: number): boolean {
  if (!smaFilter || smaFilter === 'none') return true;
  
  const sma5 = calculateSMA(candles, 5);
  const sma20 = calculateSMA(candles, 20);
  const sma50 = calculateSMA(candles, 50);
  const sma200 = calculateSMA(candles, 200);
  
  if (smaFilter === 'stacked') {
    // Price > 5d SMA > 20d SMA > 50d SMA > 200d SMA
    if (!sma5 || !sma20 || !sma50 || !sma200) return false;
    return currentPrice > sma5 && sma5 > sma20 && sma20 > sma50 && sma50 > sma200;
  }
  
  if (smaFilter === 'above50_200') {
    // Price > 50d SMA > 200d SMA
    if (!sma50 || !sma200) return false;
    return currentPrice > sma50 && sma50 > sma200;
  }
  
  return true;
}

// Check price proximity to 50d SMA
function checkPriceProximity(candles: Candle[], currentPrice: number, maxPct: number | undefined): boolean {
  if (maxPct === undefined) return true;
  
  const sma50 = calculateSMA(candles, 50);
  if (!sma50) return true; // Skip filter if not enough data
  
  const pctDiff = Math.abs((currentPrice - sma50) / sma50) * 100;
  return pctDiff <= maxPct;
}

// Calculate channel height percentage for consolidation patterns
function calculateChannelHeightPct(candles: Candle[], pattern: string): number | null {
  let lookbackDays: number;
  
  switch (pattern) {
    case 'VCP':
      lookbackDays = 30;
      break;
    case 'Weekly Tight':
      lookbackDays = 20;
      break;
    case 'Monthly Tight':
      lookbackDays = 80;
      break;
    default:
      return null;
  }
  
  if (candles.length < lookbackDays) return null;
  
  const recentCandles = candles.slice(-lookbackDays);
  const highs = recentCandles.map(c => c.high);
  const lows = recentCandles.map(c => c.low);
  const maxHigh = Math.max(...highs);
  const minLow = Math.min(...lows);
  const avgPrice = recentCandles.reduce((sum, c) => sum + c.close, 0) / recentCandles.length;
  
  return ((maxHigh - minLow) / avgPrice) * 100;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Initialize database connection (non-blocking, app works without it)
  console.log("Attempting database connection...");
  await initializeDatabase();
  
  if (isDatabaseAvailable()) {
    console.log("Database is available");
  } else {
    console.warn("Database is not available - watchlist features will be limited");
  }

  // --- Stock History ---
  app.get(api.stocks.history.path, async (req, res) => {
    const { symbol } = req.params;
    const interval = String(req.query.interval || '1d');
    let period = String(req.query.period || '2y'); // Default to 2 years for SMA 200
    
    // For intraday, use shorter periods
    if (['5m', '15m', '30m'].includes(interval)) {
      period = '1mo'; // Yahoo limits intraday to ~60 days
    } else if (interval === '60m') {
      period = '3mo';
    }
    
    try {
      const yf = await getYahooFinance();
      const history = await getChartData(yf, symbol, period, interval);
      
      if (history.length === 0) {
        res.status(404).json({ message: `No data available for ${symbol}` });
        return;
      }
      
      res.json(history);
    } catch (error) {
      console.error(`Error fetching history for ${symbol}:`, error);
      res.status(404).json({ message: `Symbol ${symbol} not found or data unavailable` });
    }
  });

  // --- Stock Quote ---
  app.get(api.stocks.quote.path, async (req, res) => {
    const { symbol } = req.params;
    try {
      const yf = await getYahooFinance();
      const quote = await yf.quote(symbol);
      
      // Get sector info and related stocks
      const sector = quote.sector || 'Unknown';
      const sectorETFs = SECTOR_ETFS[sector] || [];
      
      // Find other stocks in the same sector from our universe
      const relatedStocks: { symbol: string; name: string }[] = [];
      if (sector !== 'Unknown') {
        for (const sym of STOCK_UNIVERSE.slice(0, 20)) {
          if (sym !== symbol) {
            try {
              const q = await yf.quote(sym);
              if (q.sector === sector) {
                relatedStocks.push({ 
                  symbol: q.symbol, 
                  name: q.shortName || q.symbol 
                });
                if (relatedStocks.length >= 5) break;
              }
            } catch {}
          }
        }
      }
      
      res.json({
        symbol: quote.symbol,
        price: quote.regularMarketPrice,
        change: quote.regularMarketChange,
        changePercent: quote.regularMarketChangePercent,
        volume: quote.regularMarketVolume,
        companyName: quote.longName || quote.shortName,
        marketCap: quote.marketCap,
        peRatio: quote.trailingPE || quote.forwardPE,
        sector: sector,
        industry: quote.industry || 'Unknown',
        description: quote.longBusinessSummary || `${quote.longName || quote.shortName} is a publicly traded company.`,
        sectorETFs,
        relatedStocks,
      });
    } catch (error) {
      console.error(`Error fetching quote for ${symbol}:`, error);
      res.status(404).json({ message: `Symbol ${symbol} not found` });
    }
  });

  // --- Scanner ---
  app.post(api.scanner.run.path, async (req, res) => {
    try {
      const yf = await getYahooFinance();
      const input = api.scanner.run.input.parse(req.body);
      const results = [];

      // Note: In a production app, we wouldn't loop 30+ HTTP requests sequentially.
      // We would cache data or use a bulk API. For MVP, we limit the universe.
      const universe = STOCK_UNIVERSE.slice(0, 100); // S&P 100 universe

      for (const symbol of universe) {
        try {
          // Get quote for price/volume filter
          const quote = await yf.quote(symbol);
          
          // Filter by Price
          if (input.minPrice && quote.regularMarketPrice < input.minPrice) continue;
          if (input.maxPrice && quote.regularMarketPrice > input.maxPrice) continue;
          
          // Filter by Volume
          if (input.minVolume && quote.regularMarketVolume < input.minVolume) continue;

          // Filter by Candlestick Pattern
          let matchedPattern: string | undefined = undefined;
          let channelHeightPct: number | undefined = undefined;
          const hasCandlestickFilter = input.candlestickPattern && input.candlestickPattern !== 'All';
          const hasChartFilter = input.chartPattern && input.chartPattern !== 'All';
          const hasSMAFilter = input.smaFilter && input.smaFilter !== 'none';
          const hasProximityFilter = input.priceWithin50dPct !== undefined;
          const hasChannelHeightFilter = input.maxChannelHeightPct !== undefined && hasChartFilter;
          
          // Determine if we need historical data
          const needsHistory = hasCandlestickFilter || hasChartFilter || hasSMAFilter || hasProximityFilter;
          
          if (needsHistory) {
            // Get history for pattern detection (1y for SMA 200)
            const period = (hasSMAFilter || hasProximityFilter) ? '1y' : (hasChartFilter ? '3mo' : '1mo');
            const candles = await getChartData(yf, symbol, period);
            
            if (candles.length < 5) continue;
            
            // Check SMA filter
            if (hasSMAFilter) {
              if (!checkSMAFilter(candles, input.smaFilter!, quote.regularMarketPrice)) {
                continue;
              }
            }
            
            // Check price proximity to 50d SMA
            if (hasProximityFilter) {
              if (!checkPriceProximity(candles, quote.regularMarketPrice, input.priceWithin50dPct)) {
                continue;
              }
            }
            
            // Check candlestick pattern
            if (hasCandlestickFilter) {
              if (!detectPattern(candles, input.candlestickPattern!)) {
                continue;
              }
              matchedPattern = input.candlestickPattern;
            }
            
            // Check chart pattern
            if (hasChartFilter) {
              const strictness = input.patternStrictness || 'tight';
              if (!detectChartPattern(candles, input.chartPattern!, strictness)) {
                continue;
              }
              
              // Calculate channel height for chart patterns
              channelHeightPct = calculateChannelHeightPct(candles, input.chartPattern!) ?? undefined;
              
              // Filter by max channel height if specified
              if (hasChannelHeightFilter && channelHeightPct !== undefined) {
                if (channelHeightPct > input.maxChannelHeightPct!) {
                  continue;
                }
              }
              
              matchedPattern = matchedPattern 
                ? `${matchedPattern}, ${input.chartPattern}` 
                : input.chartPattern;
            }
          }

          results.push({
            symbol: quote.symbol,
            price: quote.regularMarketPrice,
            changePercent: quote.regularMarketChangePercent,
            volume: quote.regularMarketVolume,
            matchedPattern,
            sector: 'Technology',
            channelHeightPct
          });

        } catch (err) {
          console.error(`Failed to scan ${symbol}`, err);
        }
      }

      res.json(results);
    } catch (error) {
       console.error("Scanner error:", error);
       res.status(500).json({ message: "Failed to run scanner" });
    }
  });

  // --- Watchlist ---
  app.get(api.watchlist.list.path, async (req, res) => {
    const items = await storage.getWatchlist();
    res.json(items);
  });

  app.post(api.watchlist.add.path, async (req, res) => {
    try {
      const input = api.watchlist.add.input.parse(req.body);
      const item = await storage.addToWatchlist(input);
      res.status(201).json(item);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: error.errors[0].message });
      } else {
        res.status(500).json({ message: "Internal server error" });
      }
    }
  });

  app.delete(api.watchlist.delete.path, async (req, res) => {
    const { id } = req.params;
    await storage.removeFromWatchlist(Number(id));
    res.status(204).send();
  });

  // Seed default watchlist if empty (only if database is available)
  if (isDatabaseAvailable()) {
    try {
      const watchlist = await storage.getWatchlist();
      if (watchlist.length === 0) {
        const defaultSymbols = ['AAPL', 'MSFT', 'SPY', 'NVDA'];
        for (const symbol of defaultSymbols) {
          await storage.addToWatchlist({ symbol });
        }
        console.log('Seeded default watchlist');
      }
    } catch (error) {
      console.error('Failed to seed watchlist:', error);
    }
  }

  return httpServer;
}
