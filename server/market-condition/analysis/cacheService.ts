/**
 * MarketFlow Analysis Cache Service
 * CRUD for marketflow_analysis_cache table (3 market-day reuse: current day = day 1).
 *
 * See docs/market-condition-and-marketflow-data-rules.md for TTL vs theme snapshots / race range.
 */

import { getDb } from "../../db";
import { marketflowAnalysisCache } from "@shared/schema";
import { eq } from "drizzle-orm";
import { subtractTradingDays } from "../utils/theme-tracker-time";

const DEFAULT_TTL_MARKET_DAYS = 3; // current day = day 1, so valid for today + 2 more trading days
const VERSION = "v1";

export interface AnalysisCacheMeta {
  exists: boolean;
  generated_at: string | null;
  version: string | null;
  modules_present: string[];
}

export interface AnalysisCachePayload {
  moduleResponses: unknown[];
  synthesis: unknown;
  generated_at: string;
}

/**
 * Get cache metadata for a symbol (for UI prompt: Use Cached vs Re-run).
 */
export async function getCacheMeta(symbol: string): Promise<AnalysisCacheMeta> {
  const db = getDb();
  if (!db) {
    return { exists: false, generated_at: null, version: null, modules_present: [] };
  }

  const upper = symbol.toUpperCase();
  const rows = await db
    .select({
      generatedAt: marketflowAnalysisCache.generatedAt,
      version: marketflowAnalysisCache.version,
      modulesPresent: marketflowAnalysisCache.modulesPresent,
    })
    .from(marketflowAnalysisCache)
    .where(eq(marketflowAnalysisCache.symbol, upper))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return { exists: false, generated_at: null, version: null, modules_present: [] };
  }

  const generatedAt = row.generatedAt instanceof Date ? row.generatedAt.toISOString() : String(row.generatedAt);
  // Current day = day 1 of 3; valid if generated on today or within previous 2 trading days
  // TTL matches "3 trading sessions" same helper as race/theme bounds.
  const cutoff = subtractTradingDays(new Date(), DEFAULT_TTL_MARKET_DAYS - 1);
  const isWithinTtl = row.generatedAt instanceof Date && row.generatedAt >= cutoff;

  return {
    exists: isWithinTtl,
    generated_at: isWithinTtl ? generatedAt : null,
    version: row.version,
    modules_present: Array.isArray(row.modulesPresent) ? row.modulesPresent : [],
  };
}

/**
 * Get full cached analysis payload for a symbol.
 */
export async function getCached(symbol: string): Promise<AnalysisCachePayload | null> {
  const db = getDb();
  if (!db) return null;

  const upper = symbol.toUpperCase();
  const rows = await db
    .select()
    .from(marketflowAnalysisCache)
    .where(eq(marketflowAnalysisCache.symbol, upper))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const generatedAt = row.generatedAt instanceof Date ? row.generatedAt.toISOString() : String(row.generatedAt);
  const ttlDays = row.ttlDays ?? DEFAULT_TTL_MARKET_DAYS;
  const cutoff = subtractTradingDays(new Date(), ttlDays - 1);
  if (row.generatedAt instanceof Date && row.generatedAt < cutoff) {
    return null;
  }

  const analysis = row.analysisJson as { moduleResponses?: unknown[]; synthesis?: unknown };
  return {
    moduleResponses: analysis?.moduleResponses ?? [],
    synthesis: analysis?.synthesis ?? {},
    generated_at: generatedAt,
  };
}

/**
 * Store or overwrite cached analysis for a symbol.
 */
export async function setCached(
  symbol: string,
  payload: Omit<AnalysisCachePayload, "generated_at">,
  createdBy?: number
): Promise<void> {
  const db = getDb();
  if (!db) return;

  const upper = symbol.toUpperCase();
  const generatedAt = new Date();
  const modulesPresent = Array.isArray(payload.moduleResponses)
    ? (payload.moduleResponses as { module_id?: string }[]).map((r) => r.module_id ?? "unknown")
    : [];

  await db
    .insert(marketflowAnalysisCache)
    .values({
      symbol: upper,
      analysisJson: payload as unknown as Record<string, unknown>,
      generatedAt,
      version: VERSION,
      modulesPresent,
      ttlDays: DEFAULT_TTL_MARKET_DAYS,
      createdBy: createdBy ?? null,
    })
    .onConflictDoUpdate({
      target: marketflowAnalysisCache.symbol,
      set: {
        analysisJson: payload as unknown as Record<string, unknown>,
        generatedAt,
        version: VERSION,
        modulesPresent,
        ttlDays: DEFAULT_TTL_MARKET_DAYS,
        createdBy: createdBy ?? null,
      },
    });
}

/**
 * Invalidate (delete) cached analysis for a symbol.
 */
export async function invalidate(symbol: string): Promise<void> {
  const db = getDb();
  if (!db) return;

  await db.delete(marketflowAnalysisCache).where(eq(marketflowAnalysisCache.symbol, symbol.toUpperCase()));
}
