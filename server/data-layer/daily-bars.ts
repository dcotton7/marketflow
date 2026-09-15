/**
 * Daily Bars Data Layer
 * 
 * Provides daily OHLCV bars by merging:
 * 1. Historical bars from the historical_bars DB table (T-1 and older)
 * 2. Today's bar from the snapshot cache (60-90s refresh)
 * 
 * This eliminates API calls for daily bar data in scans and technicals.
 */

import { desc, eq, and, gte, sql } from "drizzle-orm";
import { getDb } from "../db";
import { historicalBars } from "@shared/schema";
import { getTickerSnapshot } from "../market-condition/engine/snapshot";
import { DailyBar, Quote } from "./types";
import { getQuote } from "./quotes";
import { getEtClock, getUsEquityMarketSession } from "@shared/usEquityMarketSession";
import type { TickerSnapshot } from "../market-condition/providers/types";

function snapshotRegularSessionBar(snapshot: TickerSnapshot): DailyBar | null {
  if (snapshot.open <= 0 || !snapshot.regularSessionClose || snapshot.regularSessionClose <= 0) {
    return null;
  }

  const now = new Date();
  const currentSession = getUsEquityMarketSession(now);
  const currentEtDate = getEtClock(now).dateKey;
  const snapshotEtDate = getEtClock(snapshot.timestamp).dateKey;

  // Premarket trades belong in ETH pricing, not in a developing daily RTH candle.
  if (currentSession === "pre_market" && snapshotEtDate === currentEtDate) {
    return null;
  }

  return {
    date: snapshotEtDate,
    open: snapshot.open,
    high: snapshot.high,
    low: snapshot.low,
    close: snapshot.regularSessionClose,
    volume: snapshot.volume,
    vwap: snapshot.vwap,
  };
}

function mergeRegularSessionBar(candles: DailyBar[], snapshot: TickerSnapshot | undefined): DailyBar[] {
  if (!snapshot) return candles;
  const sessionBar = snapshotRegularSessionBar(snapshot);
  if (!sessionBar) return candles;

  const existingIndex = candles.findIndex((bar) => bar.date === sessionBar.date);
  if (existingIndex >= 0) {
    candles[existingIndex] = sessionBar;
  } else if (!candles.length || sessionBar.date > candles[0].date) {
    candles.unshift(sessionBar);
  }
  return candles;
}

/**
 * Get daily bars for a symbol, merging DB history with today's live bar.
 * Returns newest bars first (descending date order).
 * 
 * @param symbol - Stock symbol
 * @param days - Number of days to return (default 250)
 * @returns Array of daily bars (newest first), or null if insufficient data
 */
export async function getDailyBars(
  symbol: string,
  days: number = 250
): Promise<DailyBar[] | null> {
  const db = getDb();
  if (!db) {
    console.warn("[DataLayer] Database not available for getDailyBars");
    return null;
  }

  const upperSymbol = symbol.toUpperCase();

  try {
    const dbBars = await db
      .select()
      .from(historicalBars)
      .where(eq(historicalBars.symbol, upperSymbol))
      .orderBy(desc(historicalBars.barDate))
      .limit(days + 5);

    if (dbBars.length < 50) {
      return null;
    }

    const candles: DailyBar[] = dbBars.map((b) => ({
      date: b.barDate,
      open: Number(b.open),
      high: Number(b.high),
      low: Number(b.low),
      close: Number(b.close),
      volume: Number(b.volume),
      vwap: b.vwap ? Number(b.vwap) : undefined,
    }));

    return mergeRegularSessionBar(candles, getTickerSnapshot(upperSymbol)).slice(0, days);
  } catch (error) {
    console.error(`[DataLayer] getDailyBars error for ${symbol}:`, error);
    return null;
  }
}

/**
 * Get daily bars for multiple symbols (batch operation).
 * More efficient than calling getDailyBars individually.
 * 
 * @param symbols - Array of stock symbols
 * @param days - Number of days per symbol (default 250)
 * @returns Map of symbol -> daily bars array
 */
export async function getDailyBarsBatch(
  symbols: string[],
  days: number = 250
): Promise<Map<string, DailyBar[]>> {
  const db = getDb();
  const result = new Map<string, DailyBar[]>();

  if (!db || symbols.length === 0) {
    return result;
  }

  const upperSymbols = symbols.map((s) => s.toUpperCase());

  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days - 10);
    const cutoffStr = cutoffDate.toISOString().split("T")[0];

    const dbBars = await db
      .select()
      .from(historicalBars)
      .where(
        and(
          sql`${historicalBars.symbol} = ANY(${upperSymbols})`,
          gte(historicalBars.barDate, cutoffStr)
        )
      )
      .orderBy(historicalBars.symbol, desc(historicalBars.barDate));

    const barsBySymbol = new Map<string, typeof dbBars>();
    for (const bar of dbBars) {
      const existing = barsBySymbol.get(bar.symbol) || [];
      existing.push(bar);
      barsBySymbol.set(bar.symbol, existing);
    }

    for (const symbol of upperSymbols) {
      const symbolBars = barsBySymbol.get(symbol) || [];

      if (symbolBars.length < 50) {
        continue;
      }

      const candles: DailyBar[] = symbolBars.slice(0, days + 5).map((b) => ({
        date: b.barDate,
        open: Number(b.open),
        high: Number(b.high),
        low: Number(b.low),
        close: Number(b.close),
        volume: Number(b.volume),
        vwap: b.vwap ? Number(b.vwap) : undefined,
      }));

      result.set(
        symbol,
        mergeRegularSessionBar(candles, getTickerSnapshot(symbol)).slice(0, days)
      );
    }

    return result;
  } catch (error) {
    console.error("[DataLayer] getDailyBarsBatch error:", error);
    return result;
  }
}

/**
 * Get today's bar from the snapshot cache (no API call).
 * Returns null if no snapshot data available.
 */
export function getTodayBar(symbol: string): DailyBar | null {
  const snapshot = getTickerSnapshot(symbol.toUpperCase());

  return snapshot ? snapshotRegularSessionBar(snapshot) : null;
}

/**
 * Check if we have sufficient historical data for a symbol in the DB.
 */
export async function hasHistoricalData(
  symbol: string,
  minDays: number = 50
): Promise<boolean> {
  const db = getDb();
  if (!db) return false;

  try {
    const count = await db
      .select({ count: sql<number>`count(*)` })
      .from(historicalBars)
      .where(eq(historicalBars.symbol, symbol.toUpperCase()));

    return (count[0]?.count || 0) >= minDays;
  } catch {
    return false;
  }
}

/**
 * Get daily bars and current quote in one round trip (parallel fetch).
 * Use for orchestrator and modules that need both; single contract from data-layer.
 */
export async function getBarsAndQuote(
  symbol: string,
  days: number = 250
): Promise<{ bars: DailyBar[] | null; quote: Quote | null }> {
  const [bars, quote] = await Promise.all([
    getDailyBars(symbol, days),
    getQuote(symbol),
  ]);
  return { bars, quote };
}
