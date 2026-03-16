/**
 * Theme Snapshots Service
 * 
 * Stores and retrieves historical theme rankings for multi-timeframe comparison.
 * - Hourly snapshots: Stored during market hours, deleted at end of day
 * - Daily close snapshots: Stored at market close, kept for historical analysis
 */

import { getDb } from "../../db";
import { themeSnapshots, InsertThemeSnapshot, ThemeSnapshot } from "@shared/schema";
import { eq, and, desc, sql, lt, inArray, isNotNull } from "drizzle-orm";
import { ClusterId, TimeSlice } from "../universe";
import type { ThemeMetrics } from "./theme-score";

// =============================================================================
// Types
// =============================================================================

export type SnapshotType = "hourly" | "daily_close";

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
  hour?: number
): Promise<boolean> {
  const db = getDb();
  if (!db) {
    console.warn("[ThemeSnapshots] Database not available, skipping snapshot save");
    return false;
  }

  try {
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
    let comparisonTime: string | null = null;
    
    switch (timeSlice) {
      case "15M": {
        // Find the most recent snapshot that's at least 15 minutes old
        const cutoffTime = new Date(Date.now() - 15 * 60 * 1000);
        
        query = db
          .select()
          .from(themeSnapshots)
          .where(
            and(
              eq(themeSnapshots.marketDate, currentDate),
              eq(themeSnapshots.snapshotType, "hourly"),
              sql`${themeSnapshots.createdAt} <= ${cutoffTime.toISOString()}`
            )
          )
          .orderBy(desc(themeSnapshots.createdAt))
          .limit(60);
        
        break;
      }
      
      case "30M": {
        // Find the most recent snapshot that's at least 30 minutes old
        const cutoffTime = new Date(Date.now() - 30 * 60 * 1000);
        
        query = db
          .select()
          .from(themeSnapshots)
          .where(
            and(
              eq(themeSnapshots.marketDate, currentDate),
              eq(themeSnapshots.snapshotType, "hourly"),
              sql`${themeSnapshots.createdAt} <= ${cutoffTime.toISOString()}`
            )
          )
          .orderBy(desc(themeSnapshots.createdAt))
          .limit(60);
        
        // comparisonTime will be set from actual results
        break;
      }
      
      case "1H": {
        // Find the most recent snapshot that's at least 1 hour old
        const cutoffTime = new Date(Date.now() - 60 * 60 * 1000);
        
        query = db
          .select()
          .from(themeSnapshots)
          .where(
            and(
              eq(themeSnapshots.marketDate, currentDate),
              eq(themeSnapshots.snapshotType, "hourly"),
              sql`${themeSnapshots.createdAt} <= ${cutoffTime.toISOString()}`
            )
          )
          .orderBy(desc(themeSnapshots.createdAt))
          .limit(60);
        
        break;
      }
      
      case "4H": {
        // Find the most recent snapshot that's at least 4 hours old
        const cutoffTime = new Date(Date.now() - 4 * 60 * 60 * 1000);
        
        query = db
          .select()
          .from(themeSnapshots)
          .where(
            and(
              eq(themeSnapshots.snapshotType, "hourly"),
              sql`${themeSnapshots.createdAt} <= ${cutoffTime.toISOString()}`
            )
          )
          .orderBy(desc(themeSnapshots.createdAt))
          .limit(60);
        
        break;
      }
      
      case "1D": {
        // Find the last trading day (last weekday on or before currentDate)
        const lastTradingDay = new Date(currentDate + "T12:00:00Z");
        while (lastTradingDay.getUTCDay() === 0 || lastTradingDay.getUTCDay() === 6) {
          lastTradingDay.setUTCDate(lastTradingDay.getUTCDate() - 1);
        }
        // Then go one more trading day back — this is the "prior close" to compare against
        const priorClose = new Date(lastTradingDay);
        priorClose.setUTCDate(priorClose.getUTCDate() - 1);
        while (priorClose.getUTCDay() === 0 || priorClose.getUTCDay() === 6) {
          priorClose.setUTCDate(priorClose.getUTCDate() - 1);
        }
        const priorCloseDate = priorClose.toISOString().split("T")[0];

        query = db
          .select()
          .from(themeSnapshots)
          .where(
            and(
              eq(themeSnapshots.marketDate, priorCloseDate),
              eq(themeSnapshots.snapshotType, "daily_close")
            )
          )
          .orderBy(desc(themeSnapshots.createdAt))
          .limit(28); // one per theme
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
        // Get snapshot from ~21 trading days ago
        query = db
          .select()
          .from(themeSnapshots)
          .where(eq(themeSnapshots.snapshotType, "daily_close"))
          .orderBy(desc(themeSnapshots.marketDate))
          .limit(25 * 22); // Get ~22 days worth
        break;
      }
      
      default:
        return null;
    }

    const results = await query;
    
    if (!results || results.length === 0) {
      console.log(`[ThemeSnapshots] No historical data found for ${timeSlice} @ ${comparisonTime}`);
      return { ranks: new Map<ClusterId, number>(), metrics: new Map<ClusterId, HistoricalThemeMetrics>(), comparisonTime };
    }

    // For weekly/monthly, we need to find the right date offset
    let targetResults = results;
    
    if (timeSlice === "15M" || timeSlice === "30M" || timeSlice === "1H" || timeSlice === "4H") {
      // For intraday, take unique themes from the most recent batch (first of each theme)
      const seenThemes = new Set<string>();
      targetResults = results.filter(r => {
        if (seenThemes.has(r.themeId)) return false;
        seenThemes.add(r.themeId);
        return true;
      });
      // Use the actual snapshot time from results if we got data
      if (targetResults.length > 0 && targetResults[0].createdAt) {
        const createdAt = targetResults[0].createdAt;
        comparisonTime = createdAt instanceof Date ? createdAt.toISOString() : String(createdAt);
      }
    } else if (timeSlice === "1W") {
      // Find results from ~5 trading days ago (skip weekends)
      const uniqueDates = [...new Set(results.map(r => r.marketDate))]
        .filter(d => { const day = new Date(d + "T12:00:00Z").getUTCDay(); return day !== 0 && day !== 6; })
        .sort().reverse();
      const targetDate = uniqueDates[4] || uniqueDates[uniqueDates.length - 1];
      targetResults = results.filter(r => r.marketDate === targetDate);
      comparisonTime = targetDate ? `${targetDate}T16:00:00.000Z` : null;
    } else if (timeSlice === "1M") {
      // Find results from ~21 trading days ago (skip weekends)
      const uniqueDates = [...new Set(results.map(r => r.marketDate))]
        .filter(d => { const day = new Date(d + "T12:00:00Z").getUTCDay(); return day !== 0 && day !== 6; })
        .sort().reverse();
      const targetDate = uniqueDates[20] || uniqueDates[uniqueDates.length - 1];
      targetResults = results.filter(r => r.marketDate === targetDate);
      comparisonTime = targetDate ? `${targetDate}T16:00:00.000Z` : null;
    } else if (timeSlice === "1D" && targetResults.length > 0) {
      // Use the date from the daily snapshot
      comparisonTime = targetResults[0].marketDate ? `${targetResults[0].marketDate}T16:00:00.000Z` : null;
    }

    // Build map of themeId -> rank and full metrics
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

    // If snapshot has no meaningful data (all zeros), treat as no historical data
    // so the UI shows current values instead of 0% / "—" everywhere
    const hasMeaningfulData = targetResults.some(
      (s) =>
        (s.score != null && Math.abs(s.score) > 0.01) ||
        (s.medianPct != null && Math.abs(s.medianPct) > 0.001)
    );
    if (!hasMeaningfulData && targetResults.length > 0) {
      console.log(
        `[ThemeSnapshots] Historical snapshot for ${timeSlice} has all-zero metrics (likely saved before data was ready); treating as no data`
      );
      return null;
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
 * Delete hourly snapshots from previous days (keep today's hourly data)
 */
export async function cleanupOldHourlySnapshots(currentDate: string): Promise<number> {
  const db = getDb();
  if (!db) return 0;

  try {
    const result = await db
      .delete(themeSnapshots)
      .where(
        and(
          eq(themeSnapshots.snapshotType, "hourly"),
          lt(themeSnapshots.marketDate, currentDate)
        )
      );

    const deletedCount = (result as any)?.rowCount ?? 0;
    
    if (deletedCount > 0) {
      console.log(`[ThemeSnapshots] Cleaned up ${deletedCount} old hourly snapshots`);
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
  // Only save during market hours (9am - 4pm ET)
  if (currentHour < 9 || currentHour > 16) return false;
  
  // Default slot to 0 if not provided (backward compatibility)
  const slot = currentSlot ?? 0;
  
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
  
  const saved = await saveThemeSnapshots(themes, "hourly", date, hour);
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
