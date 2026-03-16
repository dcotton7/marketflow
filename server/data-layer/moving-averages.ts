/**
 * Moving Averages Data Layer
 * 
 * Provides pre-calculated moving averages from the ticker_ma table.
 * MAs are calculated nightly from historical bars:
 * - EMA 10d, EMA 20d (Exponential)
 * - SMA 50d, SMA 200d (Simple)
 */

import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { tickerMa } from "@shared/schema";
import { TickerMAs } from "./types";

let maCache: Map<string, TickerMAs> | null = null;
let maCacheTime: Date | null = null;
const MA_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get pre-calculated MAs for a single symbol.
 */
export async function getMAs(symbol: string): Promise<TickerMAs | null> {
  const db = getDb();
  if (!db) {
    console.warn("[DataLayer] Database not available for getMAs");
    return null;
  }

  const upperSymbol = symbol.toUpperCase();

  try {
    const result = await db
      .select()
      .from(tickerMa)
      .where(eq(tickerMa.symbol, upperSymbol))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    const row = result[0];
    return {
      symbol: row.symbol,
      ema10d: row.ema10d ? Number(row.ema10d) : null,
      ema20d: row.ema20d ? Number(row.ema20d) : null,
      sma50d: row.sma50d ? Number(row.sma50d) : null,
      sma200d: row.sma200d ? Number(row.sma200d) : null,
      updatedAt: row.updatedAt || new Date(),
    };
  } catch (error) {
    console.error(`[DataLayer] getMAs error for ${symbol}:`, error);
    return null;
  }
}

/**
 * Get all pre-calculated MAs (for Market Condition theme calculations).
 * Uses an in-memory cache with 5-minute TTL.
 */
export async function getAllMAs(): Promise<Map<string, TickerMAs>> {
  if (
    maCache &&
    maCacheTime &&
    Date.now() - maCacheTime.getTime() < MA_CACHE_TTL_MS
  ) {
    return maCache;
  }

  const db = getDb();
  if (!db) {
    console.warn("[DataLayer] Database not available for getAllMAs");
    return new Map();
  }

  try {
    const rows = await db.select().from(tickerMa);
    const result = new Map<string, TickerMAs>();

    for (const row of rows) {
      result.set(row.symbol, {
        symbol: row.symbol,
        ema10d: row.ema10d ? Number(row.ema10d) : null,
        ema20d: row.ema20d ? Number(row.ema20d) : null,
        sma50d: row.sma50d ? Number(row.sma50d) : null,
        sma200d: row.sma200d ? Number(row.sma200d) : null,
        updatedAt: row.updatedAt || new Date(),
      });
    }

    maCache = result;
    maCacheTime = new Date();
    console.log(`[DataLayer] Loaded ${result.size} ticker MAs into cache`);

    return result;
  } catch (error) {
    console.error("[DataLayer] getAllMAs error:", error);
    return maCache || new Map();
  }
}

/**
 * Get SMA data formatted for theme-score calculations.
 * Returns Map of symbol -> { sma50, sma200 }
 */
export async function getSMADataForThemes(): Promise<
  Map<string, { sma50: number; sma200: number }>
> {
  const allMAs = await getAllMAs();
  const result = new Map<string, { sma50: number; sma200: number }>();

  for (const [symbol, ma] of allMAs) {
    if (ma.sma50d && ma.sma200d) {
      result.set(symbol, {
        sma50: ma.sma50d,
        sma200: ma.sma200d,
      });
    }
  }

  return result;
}

/**
 * Get full MA data for theme member calculations (pct vs MA).
 * Returns Map of symbol -> { ema10d, ema20d, sma50d, sma200d }
 */
export async function getMADataForThemes(): Promise<
  Map<string, { ema10d: number | null; ema20d: number | null; sma50d: number | null; sma200d: number | null }>
> {
  const allMAs = await getAllMAs();
  const result = new Map<string, { ema10d: number | null; ema20d: number | null; sma50d: number | null; sma200d: number | null }>();

  for (const [symbol, ma] of allMAs) {
    result.set(symbol, {
      ema10d: ma.ema10d,
      ema20d: ma.ema20d,
      sma50d: ma.sma50d,
      sma200d: ma.sma200d,
    });
  }

  return result;
}

/**
 * Clear the MA cache (call after updating MAs in DB)
 */
export function clearMACache(): void {
  maCache = null;
  maCacheTime = null;
  console.log("[DataLayer] MA cache cleared");
}
