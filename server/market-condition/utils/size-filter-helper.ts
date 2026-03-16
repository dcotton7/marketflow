/**
 * Size Filter Helper
 * 
 * Queries tickers table to get tickers matching a size category.
 * Used for filtering theme calculations by market cap.
 */

import { db } from "../../db";
import { tickers } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import type { SizeFilter } from "../universe";

/**
 * Get set of tickers matching the size filter from database
 * @param sizeFilter - Size category to filter by
 * @returns Set of ticker symbols matching the filter
 */
export async function getTickersBySize(sizeFilter: SizeFilter): Promise<Set<string>> {
  if (sizeFilter === "ALL" || !db) {
    return new Set(); // Empty set means "no filter, use all"
  }
  
  try {
    const results = await db
      .select({ symbol: tickers.symbol })
      .from(tickers)
      .where(eq(tickers.marketCapSize, sizeFilter));
    
    const tickerSet = new Set(results.map(r => r.symbol.toUpperCase()));
    
    console.log(`[SizeFilter] ${sizeFilter}: ${tickerSet.size} tickers`);
    return tickerSet;
    
  } catch (error) {
    console.error(`[SizeFilter] Failed to query tickers for ${sizeFilter}:`, error);
    return new Set();
  }
}

/**
 * Get A/D aggregate statistics for a specific theme (BOTTOM-UP from theme members)
 * @param themeId - Theme ID to calculate stats for
 * @returns Object with accumulation and distribution counts/percentages for THIS theme only
 */
export async function getAccDistAggregates(themeId: string): Promise<{
  total: number;
  accumulation3Plus: number;
  distribution3Plus: number;
  accumulationPct: number;
  distributionPct: number;
}> {
  if (!db) {
    return { total: 0, accumulation3Plus: 0, distribution3Plus: 0, accumulationPct: 0, distributionPct: 0 };
  }
  
  try {
    // Get A/D values for tickers in THIS theme only
    const results = await db
      .select({
        accDistDays: tickers.accDistDays,
      })
      .from(tickers)
      .where(eq(tickers.themeId, themeId));
    
    const total = results.filter(r => r.accDistDays !== null).length;
    const accumulation3Plus = results.filter(r => r.accDistDays && r.accDistDays >= 3).length;
    const distribution3Plus = results.filter(r => r.accDistDays && r.accDistDays <= -3).length;
    
    return {
      total,
      accumulation3Plus,
      distribution3Plus,
      accumulationPct: total > 0 ? (accumulation3Plus / total) * 100 : 0,
      distributionPct: total > 0 ? (distribution3Plus / total) * 100 : 0,
    };
    
  } catch (error) {
    console.error(`[AccDist] Failed to get aggregates for theme ${themeId}:`, error);
    return { total: 0, accumulation3Plus: 0, distribution3Plus: 0, accumulationPct: 0, distributionPct: 0 };
  }
}
