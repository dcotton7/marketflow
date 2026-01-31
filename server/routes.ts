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
    default:
      return new Date(now.setFullYear(now.getFullYear() - 1));
  }
}

// Helper to get chart data (historical data)
async function getChartData(yf: any, symbol: string, period: string = '1y'): Promise<Candle[]> {
  const startDate = getPeriodStartDate(period);
  const result = await yf.chart(symbol, { period1: startDate, period2: new Date(), interval: '1d' });
  if (!result.quotes || result.quotes.length === 0) {
    return [];
  }
  return result.quotes
    .filter((item: any) => item.open != null && item.close != null)
    .map((item: any) => ({
      date: new Date(item.date).toISOString().split('T')[0],
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close,
      volume: item.volume || 0,
    }));
}

// Simulated universe of stocks for the scanner
const STOCK_UNIVERSE = [
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'META', 'NVDA', 'AMD', 'NFLX', 'INTC',
  'SPY', 'QQQ', 'IWM', 'DIA', 'BA', 'DIS', 'JPM', 'GS', 'V', 'MA',
  'CSCO', 'PEP', 'KO', 'WMT', 'TGT', 'COST', 'CVX', 'XOM', 'PFE', 'MRNA'
];

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
    try {
      const yf = await getYahooFinance();
      const history = await getChartData(yf, symbol, '1y');
      
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
      res.json({
        symbol: quote.symbol,
        price: quote.regularMarketPrice,
        change: quote.regularMarketChange,
        changePercent: quote.regularMarketChangePercent,
        volume: quote.regularMarketVolume,
        companyName: quote.longName || quote.shortName,
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
      const universe = STOCK_UNIVERSE.slice(0, 20); // Limit to 20 to speed up MVP response

      for (const symbol of universe) {
        try {
          // Get quote for price/volume filter
          const quote = await yf.quote(symbol);
          
          // Filter by Price
          if (input.minPrice && quote.regularMarketPrice < input.minPrice) continue;
          if (input.maxPrice && quote.regularMarketPrice > input.maxPrice) continue;
          
          // Filter by Volume
          if (input.minVolume && quote.regularMarketVolume < input.minVolume) continue;

          // Filter by Pattern
          let matchedPattern = undefined;
          if (input.pattern && input.pattern !== 'All') {
            // VCP needs more history (at least 30 days), others need less
            const period = input.pattern === 'VCP' ? '3mo' : '1mo';
            const candles = await getChartData(yf, symbol, period);

            if (candles.length >= 5 && detectPattern(candles, input.pattern)) {
              matchedPattern = input.pattern;
            } else {
              continue; // Pattern didn't match
            }
          }

          results.push({
            symbol: quote.symbol,
            price: quote.regularMarketPrice,
            changePercent: quote.regularMarketChangePercent,
            volume: quote.regularMarketVolume,
            matchedPattern,
            sector: 'Technology' // Placeholder, would need detailed profile data
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
