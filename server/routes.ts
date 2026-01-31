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
      // Handle both ESM default export and CJS module.exports
      const YahooFinance = YahooFinanceModule.default || YahooFinanceModule;
      if (typeof YahooFinance === 'function') {
        yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
      } else if (YahooFinance.default && typeof YahooFinance.default === 'function') {
        yahooFinance = new YahooFinance.default({ suppressNotices: ['yahooSurvey'] });
      } else {
        // Fallback for older API style
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
      // Very small body relative to range
      return bodySize(current) <= (current.high - current.low) * 0.1;
    
    case 'Hammer':
      // Small body, long lower shadow (at least 2x body), little/no upper shadow
      // Usually found in downtrend (simplified here to just shape)
      return (
        lowerShadow(current) >= bodySize(current) * 2 &&
        upperShadow(current) <= bodySize(current) * 0.5
      );

    case 'Bullish Engulfing':
      // Prev red, Current green, Current body covers Prev body
      return (
        isRed(prev) &&
        isGreen(current) &&
        current.open <= prev.close &&
        current.close >= prev.open
      );

    case 'Bearish Engulfing':
       // Prev green, Current red, Current body covers Prev body
       return (
        isGreen(prev) &&
        isRed(current) &&
        current.open >= prev.close &&
        current.close <= prev.open
       );
       
    case 'Morning Star':
      // 3 candle pattern: Red, Small Body, Green
      // Simplified check
      const first = candles[candles.length - 3];
      return (
        isRed(first) &&
        bodySize(prev) < bodySize(first) * 0.5 && // Middle is small
        isGreen(current) &&
        current.close > (first.open + first.close) / 2 // Closes above midpoint of first
      );

    default:
      return false;
  }
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
      const queryOptions = { period1: '2023-01-01' }; // Fetch last year
      const result = await yf.historical(symbol, queryOptions);
      
      const history = result.map((item: any) => ({
        date: item.date.toISOString().split('T')[0],
        open: item.open,
        high: item.high,
        low: item.low,
        close: item.close,
        volume: item.volume,
      }));
      
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
            const history = await yf.historical(symbol, { period1: '1mo' }); // Get last month
            const candles = history.map((item: any) => ({
              date: item.date.toISOString().split('T')[0],
              open: item.open,
              high: item.high,
              low: item.low,
              close: item.close,
              volume: item.volume
            }));

            if (detectPattern(candles, input.pattern)) {
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
