/**
 * Ticker A/D Loader
 * 
 * Loads accumulation/distribution data from tickers table (database-first)
 * for both themes and individual tickers.
 */

import { db } from "../../db";
import { tickers } from "@shared/schema";
import { inArray } from "drizzle-orm";
import type { ThemeMetrics } from "../engine/theme-score";
import { getThemeTickerSymbols, isCacheInitialized } from "./theme-db-loader";
import { getClusterById } from "../universe";

/**
 * Load ticker A/D from database and populate theme A/D
 * Themes inherit the median A/D of their members
 */
export async function loadTickerAccDist(themes: ThemeMetrics[]): Promise<void> {
  if (!db) return;
  
  try {
    // Get all symbols from tickers table with A/D data
    const results = await db
      .select({
        symbol: tickers.symbol,
        accDistDays: tickers.accDistDays,
      })
      .from(tickers);
    
    const accDistMap = new Map(
      results
        .filter(r => r.accDistDays !== null)
        .map(r => [r.symbol.toUpperCase(), r.accDistDays])
    );
    
    console.log(`[TickerAccDist] Loaded ${accDistMap.size} ticker A/D values from database`);
    
    // Calculate theme A/D as median of member tickers
    for (const theme of themes) {
      // Try database first (database-first architecture)
      let allMembers: string[] = [];
      
      if (isCacheInitialized()) {
        allMembers = getThemeTickerSymbols(theme.id);
      } else {
        // Fallback to universe.ts if DB cache not ready
        const cluster = getClusterById(theme.id);
        if (cluster) {
          allMembers = [...cluster.core, ...cluster.candidates];
        }
      }
      
      if (allMembers.length === 0) {
        theme.accDistDays = 0;
        continue;
      }
      
      const memberAccDist = allMembers
        .map(symbol => accDistMap.get(symbol.toUpperCase()))
        .filter((val): val is number => val !== undefined);
      
      if (memberAccDist.length === 0) {
        theme.accDistDays = 0;
        continue;
      }
      
      // Use median A/D of members as theme A/D
      const sorted = memberAccDist.sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      theme.accDistDays = sorted.length % 2 !== 0
        ? sorted[mid]
        : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
    }
    
    console.log(`[TickerAccDist] Calculated A/D for ${themes.length} themes`);
    
  } catch (error) {
    console.error("[TickerAccDist] Failed to load ticker A/D:", error);
  }
}

/**
 * Get ticker A/D map from database for specific symbols
 */
export async function getTickerAccDistMap(symbols: string[]): Promise<Map<string, number>> {
  if (!db || symbols.length === 0) {
    return new Map();
  }
  
  try {
    const results = await db
      .select({
        symbol: tickers.symbol,
        accDistDays: tickers.accDistDays,
      })
      .from(tickers)
      .where(inArray(tickers.symbol, symbols));
    
    return new Map(
      results
        .filter(r => r.accDistDays !== null)
        .map(r => [r.symbol.toUpperCase(), r.accDistDays])
    );
    
  } catch (error) {
    console.error("[TickerAccDist] Failed to get ticker A/D map:", error);
    return new Map();
  }
}
