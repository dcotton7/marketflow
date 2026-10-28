/**
 * Quotes Data Layer
 * 
 * Provides real-time quote data from Alpaca API.
 * These cannot be cached as they need to be live.
 * 
 * Note: For bulk quote operations during Market Condition polling,
 * the snapshot system handles batching efficiently. This module
 * is for individual quote requests.
 */

import { getTickerSnapshot, getSPYBenchmark } from "../market-condition/engine/snapshot";
import { Quote } from "./types";

const SINGLE_QUOTE_CONCURRENCY = 6;

/**
 * Get current quote for a symbol.
 * First checks the snapshot cache (updated every 60-90s during market hours),
 * falls back to direct API call if not in cache.
 */
export async function getQuote(symbol: string): Promise<Quote | null> {
  const upperSymbol = symbol.toUpperCase();

  const snapshot = getTickerSnapshot(upperSymbol);

  if (snapshot) {
    return {
      symbol: upperSymbol,
      price: snapshot.price,
      prevClose: snapshot.prevClose,
      open: snapshot.open,
      high: snapshot.high,
      low: snapshot.low,
      change: snapshot.change,
      changePct: snapshot.changePct,
      volume: snapshot.volume,
      vwap: snapshot.vwap,
      timestamp: snapshot.timestamp,
    };
  }

  try {
    const { fetchAlpacaQuote } = await import("../alpaca");
    const alpacaQuote = await fetchAlpacaQuote(upperSymbol);

    if (!alpacaQuote) {
      return null;
    }

    const price = alpacaQuote.lastPrice;
    const prevClose = alpacaQuote.prevClose;
    const change = price - prevClose;
    const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;

    return {
      symbol: upperSymbol,
      price,
      prevClose,
      open: price,
      high: price,
      low: price,
      change,
      changePct,
      volume: alpacaQuote.volume ?? 0,
      vwap: price,
      timestamp: new Date(alpacaQuote.timestamp || Date.now()),
    };
  } catch (error) {
    console.error(`[DataLayer] getQuote error for ${symbol}:`, error);
    return null;
  }
}

/**
 * Get quotes for multiple symbols (batch).
 * First checks snapshot cache, then fetches missing symbols from API.
 */
export async function getQuotesBatch(
  symbols: string[]
): Promise<Map<string, Quote>> {
  const result = new Map<string, Quote>();
  const missingSymbols: string[] = [];

  for (const symbol of symbols) {
    const upperSymbol = symbol.toUpperCase();
    const snapshot = getTickerSnapshot(upperSymbol);

    if (snapshot) {
      result.set(upperSymbol, {
        symbol: upperSymbol,
        price: snapshot.price,
        prevClose: snapshot.prevClose,
        open: snapshot.open,
        high: snapshot.high,
        low: snapshot.low,
        change: snapshot.change,
        changePct: snapshot.changePct,
        volume: snapshot.volume,
        vwap: snapshot.vwap,
        timestamp: snapshot.timestamp,
      });
    } else {
      missingSymbols.push(upperSymbol);
    }
  }

  if (missingSymbols.length > 0) {
    try {
      const { fetchAlpacaQuote, fetchAlpacaSnapshotQuotes } = await import("../alpaca");

      const snaps = await fetchAlpacaSnapshotQuotes(missingSymbols);
      for (const [symbol, s] of snaps) {
        const change = s.price - s.prevClose;
        result.set(symbol, {
          symbol,
          price: s.price,
          prevClose: s.prevClose,
          open: s.open,
          high: s.high,
          low: s.low,
          change,
          changePct: (change / s.prevClose) * 100,
          volume: s.volume,
          vwap: s.vwap,
          timestamp: new Date(s.timestamp),
        });
      }

      // Each single-symbol fallback is two Alpaca calls, so run a few at a time rather than in series.
      const stillMissing = missingSymbols.filter((s) => !result.has(s));
      for (let i = 0; i < stillMissing.length; i += SINGLE_QUOTE_CONCURRENCY) {
        await Promise.all(stillMissing.slice(i, i + SINGLE_QUOTE_CONCURRENCY).map(async (symbol) => {
          const alpacaQuote = await fetchAlpacaQuote(symbol);
          if (!alpacaQuote) return;
          const price = alpacaQuote.lastPrice;
          const prevClose = alpacaQuote.prevClose;
          const change = price - prevClose;
          const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;

          result.set(symbol, {
            symbol,
            price,
            prevClose,
            open: price,
            high: price,
            low: price,
            change,
            changePct,
            volume: alpacaQuote.volume ?? 0,
            vwap: price,
            timestamp: new Date(alpacaQuote.timestamp || Date.now()),
          });
        }));
      }
    } catch (error) {
      console.error(
        `[DataLayer] getQuotesBatch error for ${missingSymbols.length} symbols:`,
        error
      );
    }
  }

  return result;
}

/**
 * Get SPY quote (commonly used as benchmark).
 */
export async function getSPYQuote(): Promise<Quote | null> {
  const benchmark = getSPYBenchmark();

  if (benchmark) {
    return {
      symbol: "SPY",
      price: benchmark.price,
      prevClose: benchmark.prevClose,
      open: benchmark.price,
      high: benchmark.price,
      low: benchmark.price,
      change: benchmark.price - benchmark.prevClose,
      changePct: benchmark.changePct,
      volume: benchmark.volume,
      vwap: benchmark.price,
      timestamp: benchmark.timestamp,
    };
  }

  return getQuote("SPY");
}
