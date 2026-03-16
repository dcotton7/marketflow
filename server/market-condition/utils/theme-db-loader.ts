/**
 * Theme Database Loader
 * 
 * Loads themes and their members from the database (database-first architecture)
 * Provides cached access for performance
 */

import { db } from "../../db";
import { themes, tickers } from "@shared/schema";
import { eq } from "drizzle-orm";
import type { ClusterId } from "../universe";
import { getClusterById } from "../universe";

export interface ThemeMember {
  symbol: string;
  isCore: boolean;
  companyName?: string | null;
}

// Cache for theme members (refreshed on server start or manual refresh)
const themeMembersCache = new Map<ClusterId, ThemeMember[]>();
let cacheInitialized = false;

/**
 * Initialize theme members cache from database
 * Call this on server startup
 */
export async function initializeThemeMembersCache(): Promise<void> {
  if (!db) {
    console.error('[ThemeDBLoader] Database not available, cache not initialized');
    return;
  }

  try {
    console.log('[ThemeDBLoader] Loading theme members from database...');
    
    // Get all themes
    const allThemes = await db.select({ id: themes.id }).from(themes);
    
    // Load members for each theme
    for (const theme of allThemes) {
      const members = await db
        .select({
          symbol: tickers.symbol,
          isCore: tickers.isCore,
          companyName: tickers.companyName,
        })
        .from(tickers)
        .where(eq(tickers.themeId, theme.id));
      
      themeMembersCache.set(theme.id as ClusterId, members.map(m => ({
        symbol: m.symbol,
        isCore: m.isCore ?? false,
        companyName: m.companyName,
      })));
    }
    
    cacheInitialized = true;
    console.log(`[ThemeDBLoader] Cached ${allThemes.length} themes with members`);
    
    // Log summary
    for (const [themeId, members] of themeMembersCache) {
      const coreCount = members.filter(m => m.isCore).length;
      const candCount = members.length - coreCount;
      console.log(`  ${themeId}: ${coreCount} core + ${candCount} candidates`);
    }
  } catch (error) {
    console.error('[ThemeDBLoader] Failed to initialize cache:', error);
  }
}

/**
 * Get theme members from cache (uses DB-loaded data)
 * @param themeId - Theme ID to load members for
 * @returns Array of member symbols with core/candidate status
 */
export function getThemeMembersFromCache(themeId: ClusterId): ThemeMember[] {
  if (!cacheInitialized) {
    console.warn(`[ThemeDBLoader] Cache not initialized, returning empty for ${themeId}`);
    return [];
  }
  
  return themeMembersCache.get(themeId) || [];
}

/**
 * Get all themes that include the given symbol (for Market Context overlays and admin tuning).
 * Uses cache; returns theme id and name. Single source of truth for "which themes is this stock in".
 */
export function getThemesForSymbol(symbol: string): { id: string; name: string }[] {
  if (!cacheInitialized || !symbol) return [];
  const upper = symbol.toUpperCase();
  const result: { id: string; name: string }[] = [];
  for (const [themeId, members] of themeMembersCache) {
    if (members.some((m) => m.symbol.toUpperCase() === upper)) {
      const cluster = getClusterById(themeId);
      result.push({ id: themeId, name: cluster?.name ?? themeId });
    }
  }
  return result;
}

/**
 * Load theme members from database (bypasses cache)
 * @param themeId - Theme ID to load members for
 * @returns Array of member symbols with core/candidate status
 */
export async function getThemeMembersFromDB(themeId: ClusterId): Promise<ThemeMember[]> {
  if (!db) {
    console.error('[ThemeDBLoader] Database not available');
    return [];
  }

  try {
    const members = await db
      .select({
        symbol: tickers.symbol,
        isCore: tickers.isCore,
      })
      .from(tickers)
      .where(eq(tickers.themeId, themeId));

    return members.map(m => ({
      symbol: m.symbol,
      isCore: m.isCore ?? false,
    }));
  } catch (error) {
    console.error(`[ThemeDBLoader] Failed to load members for ${themeId}:`, error);
    return [];
  }
}

/**
 * Load all themes from database
 * @returns Array of theme IDs
 */
export async function getAllThemeIdsFromDB(): Promise<ClusterId[]> {
  if (!db) {
    console.error('[ThemeDBLoader] Database not available');
    return [];
  }

  try {
    const result = await db
      .select({ id: themes.id })
      .from(themes);

    return result.map(r => r.id as ClusterId);
  } catch (error) {
    console.error('[ThemeDBLoader] Failed to load themes:', error);
    return [];
  }
}

/**
 * Get all ticker symbols in a theme from cache
 * @param themeId - Theme ID
 * @returns Array of ticker symbols
 */
export function getThemeTickerSymbols(themeId: ClusterId): string[] {
  const members = getThemeMembersFromCache(themeId);
  return members.map(m => m.symbol);
}

/**
 * Get all ticker symbols across all themes (for snapshot universe - ensures DB-only members get fetched)
 */
export function getAllThemeTickerSymbols(themeIds: readonly string[]): string[] {
  if (!cacheInitialized) return [];
  const set = new Set<string>();
  for (const id of themeIds) {
    for (const m of getThemeMembersFromCache(id as ClusterId)) {
      set.add(m.symbol.toUpperCase());
    }
  }
  return Array.from(set);
}

/**
 * Get core tickers for a theme from cache
 * @param themeId - Theme ID
 * @returns Array of core ticker symbols
 */
export function getThemeCoreSymbols(themeId: ClusterId): string[] {
  const members = getThemeMembersFromCache(themeId);
  return members.filter(m => m.isCore).map(m => m.symbol);
}

/**
 * Get candidate tickers for a theme from cache
 * @param themeId - Theme ID
 * @returns Array of candidate ticker symbols
 */
export function getThemeCandidateSymbols(themeId: ClusterId): string[] {
  const members = getThemeMembersFromCache(themeId);
  return members.filter(m => !m.isCore).map(m => m.symbol);
}

/**
 * Check if cache is initialized
 */
export function isCacheInitialized(): boolean {
  return cacheInitialized;
}

/**
 * Get a company name lookup map: symbol -> companyName
 */
export function getCompanyNameMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const members of themeMembersCache.values()) {
    for (const m of members) {
      if (m.companyName) map.set(m.symbol.toUpperCase(), m.companyName);
    }
  }
  return map;
}

/**
 * Refresh the theme members cache from database
 * Call after adding/removing tickers from themes
 */
export async function refreshThemeMembersCache(): Promise<void> {
  cacheInitialized = false;
  themeMembersCache.clear();
  await initializeThemeMembersCache();
}
