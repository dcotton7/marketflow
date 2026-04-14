/**
 * Theme Snapshots Service
 * 
 * Stores and retrieves historical theme rankings for multi-timeframe comparison.
 * - Hourly snapshots: Stored during market hours, deleted at end of day
 * - Daily close snapshots: Stored at market close, kept for historical analysis
 */

import { getDb } from "../../db";
import { themeSnapshots, InsertThemeSnapshot, ThemeSnapshot } from "@shared/schema";
import { eq, and, asc, desc, gte, sql, lt, inArray, isNotNull } from "drizzle-orm";
import { ClusterId, TimeSlice } from "../universe";
import type { ThemeMetrics } from "./theme-score";
import { getRaceTimelineWindow, type RaceTerminalState } from "../utils/theme-tracker-time";

// =============================================================================
// Types
// =============================================================================

export type SnapshotType = "hourly" | "daily_close";
const MIN_COMPLETE_BATCH_ROWS = 20;

export interface HistoricalRankings {
  themeId: ClusterId;
  currentRank: number;
  historicalRank: number | null;
  deltaRank: number;
}

export interface HistoricalThemeMetrics {
  rank: number;
  score: number;
  medianPct: number;
  rsVsBenchmark: number;
  breadthPct: number;
}

export interface HistoricalSnapshotResult {
  ranks: Map<ClusterId, number>;
  metrics: Map<ClusterId, HistoricalThemeMetrics>; // Full metric values for dual display
  comparisonTime: string | null; // ISO timestamp of the snapshot being compared to
}

// =============================================================================
// Snapshot Storage
// =============================================================================

/**
 * Save a snapshot for all themes
 */
/**
 * Calculate accumulation/distribution streak for each theme (William O'Neal style)
 * - Positive = consecutive accumulation days (medianPct > 0)
 * - Negative = consecutive distribution days (medianPct < 0)
 * - Zero = flat or first day
 */
async function calculateAccDistStreaks(
  themes: ThemeMetrics[],
  marketDate: string
): Promise<Map<ClusterId, number>> {
  const db = getDb();
  const streaks = new Map<ClusterId, number>();
  
  if (!db) {
    // Default to 0 if no DB
    themes.forEach(theme => streaks.set(theme.id, 0));
    return streaks;
  }

  try {
    // Get yesterday's snapshots to compare
    const yesterday = new Date(marketDate);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    
    const yesterdaySnapshots = await db
      .select()
      .from(themeSnapshots)
      .where(
        and(
          eq(themeSnapshots.marketDate, yesterdayStr),
          eq(themeSnapshots.snapshotType, "daily_close")
        )
      );
    
    const yesterdayMap = new Map(
      yesterdaySnapshots.map(s => [s.themeId as ClusterId, s])
    );
    
    // Calculate streak for each theme
    for (const theme of themes) {
      const yesterday = yesterdayMap.get(theme.id);
      
      if (!yesterday) {
        // First day or no history - start at 1 or -1 based on today
        if (Math.abs(theme.medianPct) < 0.01) {
          streaks.set(theme.id, 0); // Flat day
        } else {
          streaks.set(theme.id, theme.medianPct > 0 ? 1 : -1);
        }
        continue;
      }
      
      const todayPositive = theme.medianPct > 0.01;
      const todayNegative = theme.medianPct < -0.01;
      const yesterdayStreak = yesterday.accDistDays ?? 0;
      
      if (!todayPositive && !todayNegative) {
        // Flat day - reset to 0
        streaks.set(theme.id, 0);
      } else if (todayPositive) {
        // Accumulation day
        if (yesterdayStreak > 0) {
          // Continue accumulation streak
          streaks.set(theme.id, yesterdayStreak + 1);
        } else {
          // Start new accumulation streak
          streaks.set(theme.id, 1);
        }
      } else {
        // Distribution day
        if (yesterdayStreak < 0) {
          // Continue distribution streak
          streaks.set(theme.id, yesterdayStreak - 1);
        } else {
          // Start new distribution streak
          streaks.set(theme.id, -1);
        }
      }
    }
    
    return streaks;
  } catch (error) {
    console.error("[ThemeSnapshots] Failed to calculate A/D streaks:", error);
    themes.forEach(theme => streaks.set(theme.id, 0));
    return streaks;
  }
}

export async function saveThemeSnapshots(
  themes: ThemeMetrics[],
  snapshotType: SnapshotType,
  marketDate: string,
  hour?: number,
  slot?: number
): Promise<boolean> {
  const db = getDb();
  if (!db) {
    console.warn("[ThemeSnapshots] Database not available, skipping snapshot save");
    return false;
  }

  try {
    // For hourly snapshots, enforce one batch per date/hour/slot in ET.
    // This prevents duplicate writes caused by near-simultaneous refreshes.
    if (snapshotType === "hourly" && hour !== undefined && slot !== undefined) {
      const existing = await db
        .select({ id: themeSnapshots.id })
        .from(themeSnapshots)
        .where(
          and(
            eq(themeSnapshots.snapshotType, "hourly"),
            eq(themeSnapshots.marketDate, marketDate),
            eq(themeSnapshots.snapshotHour, hour),
            sql`(floor(extract(minute from ${themeSnapshots.createdAt}) / 15) * 15) = ${slot}`
          )
        );

      if (existing.length > 0) {
        await db
          .delete(themeSnapshots)
          .where(inArray(themeSnapshots.id, existing.map((r) => r.id)));
        console.log(
          `[ThemeSnapshots] Deduped ${existing.length} existing hourly rows for ${marketDate} ${hour}:${slot
            .toString()
            .padStart(2, "0")} ET`
        );
      }
    }

    // Calculate A/D streaks only for daily_close snapshots
    let accDistStreaks: Map<ClusterId, number> | undefined;
    if (snapshotType === "daily_close") {
      accDistStreaks = await calculateAccDistStreaks(themes, marketDate);
    }
    
    const records: InsertThemeSnapshot[] = themes.map((theme) => ({
      themeId: theme.id,
      rank: theme.rank,
      score: theme.score,
      medianPct: theme.medianPct,
      rsVsBenchmark: theme.rsVsBenchmark,
      breadthPct: theme.breadthPct,
      accDistDays: accDistStreaks?.get(theme.id) ?? null,
      snapshotType,
      marketDate,
      snapshotHour: hour ?? null,
    }));

    await db.insert(themeSnapshots).values(records);
    
    console.log(`[ThemeSnapshots] Saved ${records.length} ${snapshotType} snapshots for ${marketDate}${hour !== undefined ? ` hour ${hour}` : ""}`);
    return true;
  } catch (error) {
    console.error("[ThemeSnapshots] Failed to save snapshots:", error);
    return false;
  }
}

/**
 * Get the most recent daily snapshot (for loading A/D streaks)
 */
export async function getLatestDailySnapshot(): Promise<ThemeSnapshot[] | null> {
  const db = getDb();
  if (!db) return null;
  
  try {
    const latest = await db
      .select()
      .from(themeSnapshots)
      .where(
        and(
          eq(themeSnapshots.snapshotType, "daily_close"),
          isNotNull(themeSnapshots.accDistDays)
        )
      )
      .orderBy(desc(themeSnapshots.marketDate))
      .limit(30); // Get up to 30 themes
    
    return latest.length > 0 ? latest : null;
  } catch (error) {
    console.error("[ThemeSnapshots] Failed to get latest daily snapshot:", error);
    return null;
  }
}

/**
 * Get the most recent snapshot for a specific time slice comparison
 * Returns both the rank map and the comparison timestamp for UI display
 */
export async function getHistoricalSnapshot(
  timeSlice: TimeSlice,
  currentDate: string,
  currentHour: number
): Promise<HistoricalSnapshotResult | null> {
  const db = getDb();
  if (!db) return null;

  try {
    let query;
    let preResolvedResults: ThemeSnapshot[] | null = null;
    let comparisonTime: string | null = null;
    const now = new Date();

    const queryHourlyAtOrBefore = (cutoff: Date) =>
      db
        .select()
        .from(themeSnapshots)
        .where(
          and(
            eq(themeSnapshots.snapshotType, "hourly"),
            sql`${themeSnapshots.createdAt} <= ${cutoff.toISOString()}`
          )
        )
        .orderBy(desc(themeSnapshots.createdAt))
        .limit(120);

    const queryHourlyByTradingDaysBack = async (daysBack: number): Promise<ThemeSnapshot[]> => {
      const marketDates = await db
        .select({ marketDate: themeSnapshots.marketDate })
        .from(themeSnapshots)
        .where(eq(themeSnapshots.snapshotType, "hourly"))
        .groupBy(themeSnapshots.marketDate)
        .orderBy(desc(themeSnapshots.marketDate))
        .limit(daysBack + 30);
      if (!marketDates.length) return [];
      // Require enough hourly trading dates for true "N trading days back" semantics.
      // If insufficient history, return empty so caller can apply daily-close fallback.
      if (marketDates.length <= daysBack) return [];
      const targetDate = marketDates[daysBack]?.marketDate;
      if (!targetDate) return [];
      const rows = await db
        .select()
        .from(themeSnapshots)
        .where(
          and(
            eq(themeSnapshots.snapshotType, "hourly"),
            eq(themeSnapshots.marketDate, targetDate)
          )
        )
        .orderBy(desc(themeSnapshots.createdAt))
        .limit(120);
      return rows;
    };
    
    switch (timeSlice) {
      case "15M": {
        query = queryHourlyAtOrBefore(new Date(now.getTime() - 15 * 60 * 1000));
        break;
      }
      
      case "30M": {
        query = queryHourlyAtOrBefore(new Date(now.getTime() - 30 * 60 * 1000));
        break;
      }
      
      case "1H": {
        query = queryHourlyAtOrBefore(new Date(now.getTime() - 60 * 60 * 1000));
        break;
      }
      
      case "4H": {
        query = queryHourlyAtOrBefore(new Date(now.getTime() - 4 * 60 * 60 * 1000));
        break;
      }
      
      case "1D": {
        preResolvedResults = await queryHourlyByTradingDaysBack(1);
        break;
      }
      case "5D": {
        preResolvedResults = await queryHourlyByTradingDaysBack(5);
        break;
      }
      case "10D": {
        preResolvedResults = await queryHourlyByTradingDaysBack(10);
        break;
      }
      
      case "1W": {
        // Get snapshot from ~5 trading days ago
        query = db
          .select()
          .from(themeSnapshots)
          .where(eq(themeSnapshots.snapshotType, "daily_close"))
          .orderBy(desc(themeSnapshots.marketDate))
          .limit(25 * 6); // Get ~6 days worth, pick 5th day
        break;
      }
      
      case "1M": {
        preResolvedResults = await queryHourlyByTradingDaysBack(21);
        break;
      }
      
      default:
        return null;
    }

    const getDailyTradingDayFallback = async (daysBack: number): Promise<ThemeSnapshot[] | null> => {
      const dailyDates = await db
        .select({ marketDate: themeSnapshots.marketDate })
        .from(themeSnapshots)
        .where(eq(themeSnapshots.snapshotType, "daily_close"))
        .groupBy(themeSnapshots.marketDate)
        .orderBy(desc(themeSnapshots.marketDate))
        .limit(daysBack + 40);
      if (!dailyDates.length) return null;
      const uniqueDates = dailyDates
        .map((r) => r.marketDate)
        .filter((d) => {
          const day = new Date(d + "T12:00:00Z").getUTCDay();
          return day !== 0 && day !== 6;
        });
      const targetDate = uniqueDates[daysBack - 1] || uniqueDates[uniqueDates.length - 1];
      if (!targetDate) return null;
      comparisonTime = `${targetDate}T16:00:00.000Z`;
      const targetRows = await db
        .select()
        .from(themeSnapshots)
        .where(
          and(
            eq(themeSnapshots.snapshotType, "daily_close"),
            eq(themeSnapshots.marketDate, targetDate)
          )
        );
      return targetRows;
    };

    let results = preResolvedResults ?? (await query);

    // Fallbacks: if hourly baselines are unavailable, use daily_close snapshots.
    if ((!results || results.length === 0) && (timeSlice === "5D" || timeSlice === "10D" || timeSlice === "1M")) {
      const fallbackDays = timeSlice === "5D" ? 5 : timeSlice === "10D" ? 10 : 21;
      const fallback = await getDailyTradingDayFallback(fallbackDays);
      if (fallback) results = fallback;
    }
    
    if (!results || results.length === 0) {
      console.log(`[ThemeSnapshots] No historical data found for ${timeSlice} @ ${comparisonTime}`);
      return { ranks: new Map<ClusterId, number>(), metrics: new Map<ClusterId, HistoricalThemeMetrics>(), comparisonTime };
    }

    // Choose an aligned snapshot batch (same createdAt across themes) for unified lookbacks.
    let targetResults = results;
    const unifiedLookbacks: TimeSlice[] = ["15M", "30M", "1H", "4H", "1D", "5D", "10D", "1M"];
    
    if (unifiedLookbacks.includes(timeSlice)) {
      if (results.length > 0 && results[0].snapshotType === "daily_close") {
        const targetDate = results[0].marketDate;
        targetResults = results.filter((r) => r.marketDate === targetDate);
        comparisonTime = targetDate ? `${targetDate}T16:00:00.000Z` : null;
      } else {
      const byBatch = new Map<string, ThemeSnapshot[]>();
      for (const row of results) {
        if (!row.createdAt) continue;
        const key = row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt);
        if (!byBatch.has(key)) byBatch.set(key, []);
        byBatch.get(key)!.push(row);
      }

      const orderedBatchKeys = [...byBatch.keys()].sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
      let selectedBatch: ThemeSnapshot[] = [];
      let selectedKey: string | null = null;
      for (const key of orderedBatchKeys) {
        const batch = byBatch.get(key) || [];
        if (batch.length >= MIN_COMPLETE_BATCH_ROWS) {
          selectedBatch = batch;
          selectedKey = key;
          break;
        }
        if (!selectedKey && batch.length > 0) {
          selectedBatch = batch;
          selectedKey = key;
        }
      }

      targetResults = selectedBatch.length ? selectedBatch : results;
      comparisonTime = selectedKey;
      }
    } else if (timeSlice === "1W") {
      // Find results from ~5 trading days ago (skip weekends)
      const uniqueDates = [...new Set(results.map(r => r.marketDate))]
        .filter(d => { const day = new Date(d + "T12:00:00Z").getUTCDay(); return day !== 0 && day !== 6; })
        .sort().reverse();
      const targetDate = uniqueDates[4] || uniqueDates[uniqueDates.length - 1];
      targetResults = results.filter(r => r.marketDate === targetDate);
      comparisonTime = targetDate ? `${targetDate}T16:00:00.000Z` : null;
    }

    // If snapshot has no meaningful data (all zeros), treat as no historical data
    // so the UI shows current values instead of 0% / "—" everywhere
    const hasMeaningfulData = targetResults.some(
      (s) =>
        (s.score != null && Math.abs(s.score) > 0.01) ||
        (s.medianPct != null && Math.abs(s.medianPct) > 0.001)
    );
    if (!hasMeaningfulData && targetResults.length > 0) {
      if (timeSlice === "5D" || timeSlice === "10D" || timeSlice === "1M") {
        const fallbackDays = timeSlice === "5D" ? 5 : timeSlice === "10D" ? 10 : 21;
        const fallback = await getDailyTradingDayFallback(fallbackDays);
        if (fallback && fallback.length > 0) {
          targetResults = fallback;
        }
      }
    }

    const hasMeaningfulAfterFallback = targetResults.some(
      (s) =>
        (s.score != null && Math.abs(s.score) > 0.01) ||
        (s.medianPct != null && Math.abs(s.medianPct) > 0.001)
    );
    if (!hasMeaningfulAfterFallback && targetResults.length > 0) {
      console.log(
        `[ThemeSnapshots] Historical snapshot for ${timeSlice} has all-zero metrics (likely saved before data was ready); treating as no data`
      );
      return null;
    }

    // Build map of themeId -> rank and full metrics (after any fallback adjustments)
    const rankMap = new Map<ClusterId, number>();
    const metricsMap = new Map<ClusterId, HistoricalThemeMetrics>();
    for (const snapshot of targetResults) {
      const id = snapshot.themeId as ClusterId;
      rankMap.set(id, snapshot.rank);
      metricsMap.set(id, {
        rank: snapshot.rank,
        score: snapshot.score ?? 0,
        medianPct: snapshot.medianPct ?? 0,
        rsVsBenchmark: snapshot.rsVsBenchmark ?? 0,
        breadthPct: snapshot.breadthPct ?? 0,
      });
    }

    console.log(`[ThemeSnapshots] Found ${rankMap.size} historical rankings for ${timeSlice} @ ${comparisonTime} (queried ${results.length} rows)`);
    return { ranks: rankMap, metrics: metricsMap, comparisonTime };
  } catch (error) {
    console.error("[ThemeSnapshots] Failed to get historical snapshot:", error);
    return null;
  }
}

export interface DeltaRankResult {
  deltas: Map<ClusterId, number>;
  historicalMetrics: Map<ClusterId, HistoricalThemeMetrics>;
  comparisonTime: string | null;
}

/**
 * Get the first complete intraday snapshot batch for current market date
 * at/after 9:30 ET (open baseline for Rotation+TODAY).
 */
export async function getOpenBaselineSnapshot(
  currentDate: string
): Promise<HistoricalSnapshotResult | null> {
  const db = getDb();
  if (!db) return null;

  try {
    const rows = await db
      .select()
      .from(themeSnapshots)
      .where(
        and(
          eq(themeSnapshots.snapshotType, "hourly"),
          eq(themeSnapshots.marketDate, currentDate),
          sql`(
            ${themeSnapshots.snapshotHour} > 9
            or (
              ${themeSnapshots.snapshotHour} = 9
              and extract(minute from ${themeSnapshots.createdAt}) >= 30
            )
          )`,
          sql`${themeSnapshots.snapshotHour} < 16`
        )
      )
      .orderBy(themeSnapshots.createdAt);

    if (!rows.length) return null;

    const byBatch = new Map<string, ThemeSnapshot[]>();
    for (const row of rows) {
      const key =
        row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt);
      if (!byBatch.has(key)) byBatch.set(key, []);
      byBatch.get(key)!.push(row);
    }

    // Prefer earliest complete batch; fallback to earliest non-empty.
    let selectedKey: string | null = null;
    for (const [key, batch] of byBatch) {
      if (batch.length >= MIN_COMPLETE_BATCH_ROWS) {
        selectedKey = key;
        break;
      }
      if (!selectedKey) selectedKey = key;
    }
    if (!selectedKey) return null;

    const selectedRows = byBatch.get(selectedKey) || [];
    const ranks = new Map<ClusterId, number>();
    const metrics = new Map<ClusterId, HistoricalThemeMetrics>();

    for (const s of selectedRows) {
      const id = s.themeId as ClusterId;
      ranks.set(id, s.rank);
      metrics.set(id, {
        rank: s.rank,
        score: s.score ?? 0,
        medianPct: s.medianPct ?? 0,
        rsVsBenchmark: s.rsVsBenchmark ?? 0,
        breadthPct: s.breadthPct ?? 0,
      });
    }

    return { ranks, metrics, comparisonTime: selectedKey };
  } catch (error) {
    console.error("[ThemeSnapshots] Failed to get open baseline snapshot:", error);
    return null;
  }
}

/**
 * Calculate delta ranks vs today's open baseline (>=9:30 ET).
 */
export async function calculateDeltaRanksFromOpen(
  currentThemes: ThemeMetrics[],
  currentDate: string
): Promise<DeltaRankResult> {
  const deltaMap = new Map<ClusterId, number>();
  const emptyMetrics = new Map<ClusterId, HistoricalThemeMetrics>();

  const openBaseline = await getOpenBaselineSnapshot(currentDate);
  if (!openBaseline) {
    for (const theme of currentThemes) {
      deltaMap.set(theme.id, 0);
    }
    return { deltas: deltaMap, historicalMetrics: emptyMetrics, comparisonTime: null };
  }

  const { ranks: baselineRanks, metrics: baselineMetrics, comparisonTime } = openBaseline;
  for (const theme of currentThemes) {
    const baselineRank = baselineRanks.get(theme.id);
    if (baselineRank !== undefined) {
      deltaMap.set(theme.id, baselineRank - theme.rank);
    } else {
      deltaMap.set(theme.id, 0);
    }
  }

  return { deltas: deltaMap, historicalMetrics: baselineMetrics, comparisonTime };
}

/**
 * Calculate deltaRank values based on time slice selection
 * Returns both the delta values and the comparison timestamp
 */
export async function calculateDeltaRanks(
  currentThemes: ThemeMetrics[],
  timeSlice: TimeSlice,
  currentDate: string,
  currentHour: number
): Promise<DeltaRankResult> {
  const deltaMap = new Map<ClusterId, number>();
  
  // For real-time (current poll), use the in-memory previous rankings
  // This function is for when user selects a specific time slice
  
  const historicalResult = await getHistoricalSnapshot(timeSlice, currentDate, currentHour);
  
  const emptyMetrics = new Map<ClusterId, HistoricalThemeMetrics>();

  if (!historicalResult) {
    // No historical data, return 0 deltas
    for (const theme of currentThemes) {
      deltaMap.set(theme.id, 0);
    }
    return { deltas: deltaMap, historicalMetrics: emptyMetrics, comparisonTime: null };
  }

  const { ranks: historicalRanks, metrics: historicalMetrics, comparisonTime } = historicalResult;

  for (const theme of currentThemes) {
    const historicalRank = historicalRanks.get(theme.id);
    if (historicalRank !== undefined) {
      // Positive delta = improved (lower rank number), negative = declined
      deltaMap.set(theme.id, historicalRank - theme.rank);
    } else {
      deltaMap.set(theme.id, 0);
    }
  }

  return { deltas: deltaMap, historicalMetrics, comparisonTime };
}

// =============================================================================
// Cleanup Operations
// =============================================================================

/**
 * Delete hourly snapshots older than the configured retention window.
 * Keep enough 15-minute history for long Race lookbacks and historical replay.
 */
export async function cleanupOldHourlySnapshots(currentDate: string, daysToKeep: number = 400): Promise<number> {
  const db = getDb();
  if (!db) return 0;

  try {
    const cutoffDate = new Date(`${currentDate}T12:00:00Z`);
    cutoffDate.setUTCDate(cutoffDate.getUTCDate() - daysToKeep);
    const cutoffStr = cutoffDate.toISOString().slice(0, 10);

    const result = await db
      .delete(themeSnapshots)
      .where(
        and(
          eq(themeSnapshots.snapshotType, "hourly"),
          lt(themeSnapshots.marketDate, cutoffStr)
        )
      );

    const deletedCount = (result as any)?.rowCount ?? 0;
    
    if (deletedCount > 0) {
      console.log(
        `[ThemeSnapshots] Cleaned up ${deletedCount} hourly snapshots older than ${cutoffStr} (${daysToKeep}d retention)`
      );
    }
    
    return deletedCount;
  } catch (error) {
    console.error("[ThemeSnapshots] Failed to cleanup old snapshots:", error);
    return 0;
  }
}

/**
 * Delete daily snapshots older than N days (default 90 days)
 */
export async function cleanupOldDailySnapshots(daysToKeep: number = 90): Promise<number> {
  const db = getDb();
  if (!db) return 0;

  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    const cutoffStr = cutoffDate.toISOString().split("T")[0];

    const result = await db
      .delete(themeSnapshots)
      .where(
        and(
          eq(themeSnapshots.snapshotType, "daily_close"),
          lt(themeSnapshots.marketDate, cutoffStr)
        )
      );

    const deletedCount = (result as any)?.rowCount ?? 0;
    
    if (deletedCount > 0) {
      console.log(`[ThemeSnapshots] Cleaned up ${deletedCount} daily snapshots older than ${daysToKeep} days`);
    }
    
    return deletedCount;
  } catch (error) {
    console.error("[ThemeSnapshots] Failed to cleanup old daily snapshots:", error);
    return 0;
  }
}

// =============================================================================
// Snapshot Schedule Manager (15-minute intervals for intraday rotation tracking)
// =============================================================================

let lastIntradaySnapshot: { date: string; hour: number; slot: number } | null = null;
let lastDailySnapshot: string | null = null;

/**
 * Check if we need to save an intraday snapshot (every 15 minutes)
 * Returns true if a new snapshot should be saved
 */
export function shouldSaveHourlySnapshot(currentDate: string, currentHour: number, currentSlot?: number): boolean {
  // Weekdays only
  const d = new Date(currentDate + "T12:00:00Z");
  const dayOfWeek = d.getUTCDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;

  // Only save during regular market hours (9:30am - 4:00pm ET)
  if (currentHour < 9 || currentHour > 15) return false;
  
  // Default slot to 0 if not provided (backward compatibility)
  const slot = currentSlot ?? 0;
  if (currentHour === 9 && slot < 30) return false;
  
  if (!lastIntradaySnapshot) {
    console.log(`[ThemeSnapshots] No previous snapshot, will save`);
    return true;
  }
  if (lastIntradaySnapshot.date !== currentDate) {
    console.log(`[ThemeSnapshots] New date (${lastIntradaySnapshot.date} -> ${currentDate}), will save`);
    return true;
  }
  
  // Check if we're in a new 15-minute slot
  if (lastIntradaySnapshot.hour !== currentHour || lastIntradaySnapshot.slot !== slot) {
    console.log(`[ThemeSnapshots] New slot (${lastIntradaySnapshot.hour}:${lastIntradaySnapshot.slot} -> ${currentHour}:${slot}), will save`);
    return true;
  }
  
  return false;
}

/**
 * Mark that we've saved an intraday snapshot
 */
export function markHourlySnapshotSaved(date: string, hour: number, slot?: number): void {
  lastIntradaySnapshot = { date, hour, slot: slot ?? 0 };
}

/**
 * Force save an intraday snapshot (admin only)
 * Bypasses the normal shouldSaveHourlySnapshot check
 */
export async function forceSaveIntradaySnapshot(themes: ThemeMetrics[]): Promise<boolean> {
  const { date, hour, slot } = getMarketDateTime();
  
  console.log(`[ThemeSnapshots] Force saving 15-min snapshot at ${date} ${hour}:${slot.toString().padStart(2, '0')}`);
  
  const saved = await saveThemeSnapshots(themes, "hourly", date, hour, slot);
  if (saved) {
    markHourlySnapshotSaved(date, hour, slot);
    console.log(`[ThemeSnapshots] Force saved snapshot successfully`);
  }
  return saved;
}

/**
 * Check if we need to save a daily close snapshot
 * Returns true if a new daily snapshot should be saved
 */
export function shouldSaveDailySnapshot(currentDate: string, currentHour: number): boolean {
  // Only save on weekdays (Mon-Fri)
  const d = new Date(currentDate + "T12:00:00Z");
  const dayOfWeek = d.getUTCDay(); // 0=Sun, 6=Sat
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;

  // Save daily snapshot after 4pm ET
  if (currentHour < 16) return false;
  
  if (lastDailySnapshot === currentDate) return false;
  
  return true;
}

/**
 * Mark that we've saved a daily snapshot
 */
export function markDailySnapshotSaved(date: string): void {
  lastDailySnapshot = date;
}

/**
 * @deprecated NEVER USE THIS FUNCTION!
 * Historical 15-minute snapshots are critical for Theme Tracker and Race timeline.
 * Deleting them breaks intraday comparisons and visualization.
 * 
 * This function is kept only for reference. Cleanup of old snapshots happens
 * automatically via `cleanupOldHourlySnapshots()` when saving new data.
 */
export async function clearTodayHourlySnapshots(): Promise<void> {
  console.warn("⚠️ clearTodayHourlySnapshots() is DEPRECATED and should NEVER be called!");
  return; // No-op to prevent accidental deletion
  
  // Original implementation commented out below:
  /*
  const db = getDb();
  if (!db) return;
  const { date } = getMarketDateTime();
  try {
    await db
      .delete(themeSnapshots)
      .where(
        and(
          eq(themeSnapshots.snapshotType, "hourly"),
          eq(themeSnapshots.marketDate, date)
        )
      );
    // Reset in-memory tracker so the next poll immediately writes a fresh snapshot
    lastIntradaySnapshot = null;
    console.log(`[ThemeSnapshots] Cleared today's (${date}) hourly snapshots — fresh timestamps will be written on next poll`);
  } catch (error) {
    console.error("[ThemeSnapshots] Failed to clear today's hourly snapshots:", error);
  }
  */
}

/**
 * Get current market date, hour, and minute in Eastern Time
 */
export function getMarketDateTime(): { date: string; hour: number; minute: number; slot: number } {
  const now = new Date();
  
  // Use toLocaleString for more reliable timezone conversion
  const etString = now.toLocaleString("en-US", { 
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit", 
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  
  // Debug: log raw values
  console.log(`[MarketTime] UTC: ${now.toISOString()}, ET string: "${etString}"`);
  
  // Parse: "02/24/2026, 10:38" format
  const [datePart, timePart] = etString.split(", ");
  const [month, day, year] = datePart.split("/");
  const [hourStr, minuteStr] = timePart.split(":");
  
  const hour = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr, 10);
  
  // Calculate 15-minute slot (0, 15, 30, 45)
  const slot = Math.floor(minute / 15) * 15;
  
  return {
    date: `${year}-${month}-${day}`,
    hour,
    minute,
    slot,
  };
}

/**
 * Check if market is currently open
 */
export function isMarketOpen(): boolean {
  const { hour } = getMarketDateTime();
  const now = new Date();
  const day = now.getDay();
  
  // Closed on weekends
  if (day === 0 || day === 6) return false;
  
  // Market hours: 9:30 AM - 4:00 PM ET
  // We use 9 and 16 for simplicity
  return hour >= 9 && hour < 16;
}

/** Per-theme metrics stored in each race timeline frame */
export interface RaceFrameThemeSlice {
  rank: number;
  score: number;
  medianPct: number | null;
  rsVsBenchmark: number | null;
  breadthPct: number | null;
}

export interface RaceTimelineFrame {
  at: string;
  label: string;
  themes: Record<string, RaceFrameThemeSlice>;
}

export interface RaceTimelinePayload {
  frames: RaceTimelineFrame[];
  fromBoundary: string;
  interpretation: "trading" | "calendar";
  terminalState: RaceTerminalState;
}

/**
 * Load theme snapshot batches for the acceleration race UI.
 * Race is intraday-only: one frame per stored 15-minute market snapshot.
 * 
 * Uses market-session-aligned date boundaries (exchange calendar for short ranges).
 * See docs/market-condition-and-marketflow-data-rules.md and docs/spec-next-build-theme-tracker-unified-dates.md.
 */
export async function getRaceTimeline(range: string): Promise<RaceTimelinePayload> {
  const db = getDb();

  const { fromInstant, fromDateStr, interpretation, terminalState } = await getRaceTimelineWindow(range);
  const payloadBase = {
    fromBoundary: fromInstant.toISOString(),
    interpretation,
    terminalState,
  } as const;

  if (!db) {
    return {
      ...payloadBase,
      frames: [],
    };
  }

  console.log(
    `[ThemeSnapshots] getRaceTimeline: range=${range}, from=${fromDateStr}, interpretation=${interpretation}, terminalState=${terminalState}`
  );

  try {
    const rows = await db
      .select()
      .from(themeSnapshots)
      .where(and(eq(themeSnapshots.snapshotType, "hourly"), gte(themeSnapshots.createdAt, fromInstant)))
      .orderBy(asc(themeSnapshots.createdAt), asc(themeSnapshots.themeId));

    const FIFTEEN_MIN_MS = 15 * 60 * 1000;
    const byBucket = new Map<number, ThemeSnapshot[]>();
    for (const row of rows) {
      if (!row.createdAt) continue;
      const ms = new Date(row.createdAt).getTime();
      const bucket = Math.floor(ms / FIFTEEN_MIN_MS) * FIFTEEN_MIN_MS;
      if (!byBucket.has(bucket)) byBucket.set(bucket, []);
      byBucket.get(bucket)!.push(row);
    }

    const sorted = [...byBucket.keys()].sort((a, b) => a - b);
    const frames: RaceTimelineFrame[] = [];
    for (const bucket of sorted) {
      const batch = byBucket.get(bucket)!;
      const themes: Record<string, RaceFrameThemeSlice> = {};
      for (const row of batch) {
        themes[row.themeId] = {
          rank: row.rank,
          score: row.score,
          medianPct: row.medianPct,
          rsVsBenchmark: row.rsVsBenchmark,
          breadthPct: row.breadthPct,
        };
      }
      const d = new Date(bucket);
      const label = d.toLocaleString("en-US", {
        timeZone: "America/New_York",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      });
      frames.push({
        at: d.toISOString(),
        label,
        themes,
      });
    }
    return {
      ...payloadBase,
      frames,
    };
  } catch (e) {
    console.error("[ThemeSnapshots] getRaceTimeline failed:", e);
    return {
      ...payloadBase,
      frames: [],
    };
  }
}
