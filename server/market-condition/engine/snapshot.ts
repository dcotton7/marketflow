/**
 * Snapshot Poller & Cache Manager
 * 
 * Orchestrates periodic fetching of market data and theme calculations.
 * Manages caching and provides data to API endpoints.
 */

import { ClusterId, CLUSTERS, CLUSTER_IDS, getAllUniverseTickers, DEFAULT_CADENCE, isMarketHours, getPollingInterval, getMarketSession, MarketSession, TimeSlice, type SizeFilter } from "../universe";
import { getAllThemeTickerSymbols } from "../utils/theme-db-loader";
import { getAlpacaProvider } from "../providers/alpaca";
import { TickerSnapshot, BenchmarkData } from "../providers/types";
import { ThemeMetrics, calculateAllThemeMetrics, getClusterTickerMetrics, TickerMetrics } from "./theme-score";
import { LeaderCandidate, buildClusterLeaderCandidates, processClusterLeaders, resetRefreshTurnover } from "./leader-score";
import {
  saveThemeSnapshots,
  cleanupOldHourlySnapshots,
  shouldSaveHourlySnapshot,
  shouldSaveDailySnapshot,
  markHourlySnapshotSaved,
  markDailySnapshotSaved,
  getMarketDateTime,
  calculateDeltaRanks,
  getLatestDailySnapshot,
} from "./theme-snapshots";
import { getMADataForThemes } from "../../data-layer";

// =============================================================================
// Types
// =============================================================================

// Key benchmark symbols for the header display
export const BENCHMARK_SYMBOLS = ["QQQ", "IWM", "MDY", "SPY"] as const;
export type BenchmarkSymbol = typeof BENCHMARK_SYMBOLS[number];

export interface MarketConditionSnapshot {
  themes: ThemeMetrics[];
  spyBenchmark: BenchmarkData;
  benchmarks: Record<BenchmarkSymbol, BenchmarkData>;
  lastUpdated: Date;
  isStale: boolean;
  comparisonTime?: string | null; // ISO timestamp of the baseline snapshot for deltaRank
}

export interface SnapshotState {
  // Current data
  snapshots: Map<string, TickerSnapshot>;
  spyBenchmark: BenchmarkData | null;
  benchmarks: Map<string, BenchmarkData>;
  themeMetrics: ThemeMetrics[];
  maData: Map<string, { ema10d: number | null; ema20d: number | null; sma50d: number | null; sma200d: number | null }>;
  
  // Leaders per cluster
  clusterLeaders: Map<ClusterId, LeaderCandidate[]>;
  
  // Timestamps
  lastSnapshotTime: Date | null;
  lastLeaderRefreshTime: Date | null;
  
  // Status
  isPolling: boolean;
  errorCount: number;
  lastSizeFilter: SizeFilter;
}

// =============================================================================
// State
// =============================================================================

const state: SnapshotState = {
  snapshots: new Map(),
  spyBenchmark: null,
  benchmarks: new Map(),
  themeMetrics: [],
  maData: new Map(),
  clusterLeaders: new Map(),
  lastSnapshotTime: null,
  lastLeaderRefreshTime: null,
  isPolling: false,
  errorCount: 0,
  lastSizeFilter: "ALL" as SizeFilter,
};

// Polling interval handle
let pollTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
let leaderRefreshHandle: ReturnType<typeof setInterval> | null = null;

// Configurable poll intervals (can be changed by admin)
let marketHoursPollMs = DEFAULT_CADENCE.snapshotPollingMs;
let offHoursPollMs = DEFAULT_CADENCE.offHoursPollingMs;

// Track last known market hours state for logging
let lastMarketHoursState: boolean | null = null;

// Sleep/Wake mode - stop polling when idle to save API quota
let lastActivityTime: Date = new Date();
let sleepTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes of inactivity before sleep
let isSleeping = false;

// Health monitoring watchdog
let watchdogHandle: ReturnType<typeof setInterval> | null = null;
const WATCHDOG_INTERVAL_MS = 2 * 60 * 1000; // Check every 2 minutes
const MAX_STALE_TIME_MS = 10 * 60 * 1000; // Alert if no update for 10 minutes

// =============================================================================
// Core Functions
// =============================================================================

/**
 * Fetch all data and update state
 * @param useIntradayBaseline - Use 9:30 AM open as baseline instead of prev close
 * @param sizeFilter - Optional size filter for theme calculations
 */
export async function refreshSnapshot(
  useIntradayBaseline: boolean = false,
  sizeFilter: SizeFilter = "ALL"
): Promise<void> {
  if (state.isPolling) {
    const now = Date.now();
    const timeSinceLastUpdate = state.lastSnapshotTime 
      ? now - state.lastSnapshotTime.getTime() 
      : 0;
    
    // If it's been more than 10 minutes since last update, force reset the lock
    if (timeSinceLastUpdate > 10 * 60 * 1000) {
      console.error(`[MC-Snapshot] DEADLOCK DETECTED! Last update was ${Math.round(timeSinceLastUpdate / 60000)} min ago. Forcing reset...`);
      state.isPolling = false;
      state.errorCount++;
    } else if (sizeFilter === state.lastSizeFilter) {
      // Same filter - skip, caller will get correct cached data
      console.warn("[MC-Snapshot] Already polling, skipping (refresh in progress)");
      return;
    } else {
      // User requested different filter (e.g. ALL after MEGA) - wait for poll to finish then run
      console.log(`[MC-Snapshot] Requested ${sizeFilter} but poll in progress (last=${state.lastSizeFilter}). Waiting...`);
      const waitStart = Date.now();
      const maxWaitMs = 10000;
      while (state.isPolling && Date.now() - waitStart < maxWaitMs) {
        await new Promise((r) => setTimeout(r, 100));
      }
      if (state.isPolling) {
        console.warn("[MC-Snapshot] Wait timeout - proceeding anyway");
        state.isPolling = false;
      }
      // Poll finished; if it gave us the right filter, we're done
      if (state.lastSizeFilter === sizeFilter) {
        return;
      }
      // Otherwise fall through to run our refresh with requested filter
    }
  }
  
  state.isPolling = true;
  const startTime = Date.now();
  
  try {
    const provider = getAlpacaProvider();
    
    // Get all universe tickers (CLUSTERS + DB theme members so SOLS etc. get snapshots)
    const clusterTickers = getAllUniverseTickers();
    const dbTickers = getAllThemeTickerSymbols(CLUSTER_IDS);
    const allTickers = [...new Set([...clusterTickers, ...dbTickers])];
    console.log(`[MC-Snapshot] Fetching ${allTickers.length} tickers`);
    
    // Fetch snapshots with optional intraday baseline
    const snapshots = await provider.getSnapshots(allTickers, useIntradayBaseline);
    state.snapshots = snapshots;
    
    // Get all benchmarks (QQQ, IWM, MDY, SPY)
    const benchmarks = await provider.getBenchmarks([...BENCHMARK_SYMBOLS]);
    state.benchmarks = benchmarks;
    
    // Get SPY benchmark (used for RS calculations)
    const spyBenchmark = benchmarks.get("SPY") || await provider.getSPYBenchmark();
    state.spyBenchmark = spyBenchmark;
    
    // Get size filter tickers if needed
    const { getTickersBySize } = await import("../utils/size-filter-helper");
    const allowedTickers = sizeFilter !== "ALL" ? await getTickersBySize(sizeFilter) : undefined;
    
    // Load pre-calculated MAs from ticker_ma table (for trend state and pct vs MA)
    let smaData: Map<string, { sma50: number; sma200: number }> | undefined;
    try {
      const fullMa = await getMADataForThemes();
      state.maData = fullMa;
      // Derive smaData for theme-level calculations
      smaData = new Map();
      for (const [sym, ma] of fullMa) {
        if (ma.sma50d != null && ma.sma200d != null) {
          smaData.set(sym, { sma50: ma.sma50d, sma200: ma.sma200d });
        }
      }
      if (smaData.size > 0) {
        console.log(`[MC-Snapshot] Loaded ${smaData.size} ticker MAs from database`);
      }
    } catch (err) {
      console.warn("[MC-Snapshot] Could not load ticker MAs, using VWAP fallback");
    }
    
    // Calculate theme metrics with optional size filter and SMA data
    state.themeMetrics = calculateAllThemeMetrics(
      snapshots, 
      spyBenchmark, 
      undefined, 
      smaData, 
      "1D", 
      allowedTickers
    );
    
    // Load A/D streaks from ticker-level fundamentals data
    const { loadTickerAccDist } = await import("../utils/ticker-acc-dist-loader");
    await loadTickerAccDist(state.themeMetrics);
    
    // Update timestamp and filter used
    state.lastSnapshotTime = new Date();
    state.errorCount = 0;
    state.lastSizeFilter = sizeFilter;
    
    const elapsed = Date.now() - startTime;
    console.log(`[MC-Snapshot] Refresh complete in ${elapsed}ms - ${snapshots.size} tickers, ${state.themeMetrics.length} themes (sizeFilter=${sizeFilter})`);
    
    // Save historical snapshots if needed
    await saveHistoricalSnapshotsIfNeeded(state.themeMetrics);
    
  } catch (error) {
    console.error("[MC-Snapshot] Refresh failed:", error);
    state.errorCount++;
    
    // If we're getting repeated errors, log more details
    if (state.errorCount >= 3) {
      console.error(`[MC-Snapshot] ⚠️ ${state.errorCount} consecutive errors - system may be unstable`);
    }
  } finally {
    state.isPolling = false;
  }
}

/**
 * Load A/D streaks from most recent daily snapshot
 */
async function loadAccDistStreaks(themes: ThemeMetrics[]): Promise<void> {
  try {
    const latest = await getLatestDailySnapshot();
    if (!latest) return;
    
    const accDistMap = new Map(latest.map(s => [s.themeId, s.accDistDays ?? 0]));
    
    for (const theme of themes) {
      theme.accDistDays = accDistMap.get(theme.id) ?? 0;
    }
  } catch (error) {
    console.error("[MC-Snapshot] Failed to load A/D streaks:", error);
  }
}

/**
 * Save intraday snapshots (every 15 minutes) and daily snapshots to database if it's time
 */
async function saveHistoricalSnapshotsIfNeeded(themes: ThemeMetrics[]): Promise<void> {
  const { date, hour, slot } = getMarketDateTime();
  
  // Check if we need intraday snapshot (every 15 minutes)
  const shouldSave = shouldSaveHourlySnapshot(date, hour, slot);
  console.log(`[MC-Snapshot] Checking 15-min save: date=${date} hour=${hour} slot=${slot} shouldSave=${shouldSave}`);
  
  if (shouldSave) {
    const saved = await saveThemeSnapshots(themes, "hourly", date, hour);
    if (saved) {
      markHourlySnapshotSaved(date, hour, slot);
      console.log(`[MC-Snapshot] Saved 15-min snapshot for ${date} ${hour}:${slot.toString().padStart(2, '0')}`);
      
      // Also clean up old hourly snapshots from previous days
      await cleanupOldHourlySnapshots(date);
    }
  }
  
  // Check if we need daily close snapshot
  if (shouldSaveDailySnapshot(date, hour)) {
    const saved = await saveThemeSnapshots(themes, "daily_close", date);
    if (saved) {
      markDailySnapshotSaved(date);
    }
  }
}

/**
 * Refresh leader calculations for all clusters
 */
export async function refreshLeaders(): Promise<void> {
  if (!state.spyBenchmark || state.snapshots.size === 0) {
    console.log("[MC-Snapshot] Skipping leader refresh - no snapshot data");
    return;
  }
  
  console.log("[MC-Snapshot] Refreshing leaders for all clusters");
  resetRefreshTurnover();
  
  for (const cluster of CLUSTERS) {
    const candidates = buildClusterLeaderCandidates(
      cluster.id,
      state.snapshots,
      state.spyBenchmark
    );
    
    const processed = processClusterLeaders(cluster.id, candidates);
    state.clusterLeaders.set(cluster.id, processed);
  }
  
  state.lastLeaderRefreshTime = new Date();
  console.log("[MC-Snapshot] Leader refresh complete");
}

/**
 * Schedule the next poll with adaptive interval based on market hours
 */
function scheduleNextPoll(): void {
  const inMarketHours = isMarketHours();
  const intervalMs = inMarketHours ? marketHoursPollMs : offHoursPollMs;
  
  // Log when market hours state changes
  if (lastMarketHoursState !== inMarketHours) {
    console.log(`[MC-Snapshot] Market hours: ${inMarketHours ? "OPEN" : "CLOSED"} - polling every ${intervalMs / 1000}s`);
    lastMarketHoursState = inMarketHours;
  }
  
  pollTimeoutHandle = setTimeout(async () => {
    await refreshSnapshot().catch((error) => {
      console.error("[MC-Snapshot] Polling error caught, will retry:", error);
    });
    // CRITICAL: Always schedule next poll, even if refresh failed/was skipped
    scheduleNextPoll();
  }, intervalMs);
}

/**
 * Start health monitoring watchdog
 * Checks every 2 minutes if polling is working correctly
 */
function startWatchdog(): void {
  if (watchdogHandle) {
    clearInterval(watchdogHandle);
  }
  
  console.log("[MC-Watchdog] Health monitoring started");
  
  watchdogHandle = setInterval(() => {
    const now = Date.now();
    const timeSinceLastUpdate = state.lastSnapshotTime 
      ? now - state.lastSnapshotTime.getTime() 
      : Infinity;
    
    const expectedInterval = isMarketHours() ? marketHoursPollMs : offHoursPollMs;
    
    // If no update for more than 3x the expected interval, something is wrong
    if (timeSinceLastUpdate > MAX_STALE_TIME_MS) {
      console.error(`[MC-Watchdog] ⚠️ STALE DATA ALERT! Last update was ${Math.round(timeSinceLastUpdate / 60000)} min ago`);
      console.error(`[MC-Watchdog] Expected interval: ${expectedInterval / 1000}s, Sleeping: ${isSleeping}, Polling handle: ${!!pollTimeoutHandle}`);
      
      // Attempt auto-recovery
      if (!isSleeping && pollTimeoutHandle) {
        console.error("[MC-Watchdog] Polling handle exists but not executing. Attempting restart...");
        stopPolling();
        setTimeout(() => startPolling(), 1000);
      }
    } else if (timeSinceLastUpdate > expectedInterval * 2) {
      console.warn(`[MC-Watchdog] Polling slower than expected. Last update: ${Math.round(timeSinceLastUpdate / 1000)}s ago (expected ${expectedInterval / 1000}s)`);
    } else {
      // All healthy
      console.log(`[MC-Watchdog] ✓ Healthy - Last update: ${Math.round(timeSinceLastUpdate / 1000)}s ago, Errors: ${state.errorCount}`);
    }
  }, WATCHDOG_INTERVAL_MS);
}

/**
 * Start periodic polling with adaptive intervals
 */
export function startPolling(intervalMs?: number): void {
  if (pollTimeoutHandle) {
    console.log("[MC-Snapshot] Polling already running");
    return;
  }
  
  // Reset sleep state when starting
  isSleeping = false;
  lastActivityTime = new Date();
  
  // If a specific interval is provided, use it for market hours
  if (intervalMs) {
    marketHoursPollMs = intervalMs;
  }
  
  const inMarketHours = isMarketHours();
  const currentInterval = inMarketHours ? marketHoursPollMs : offHoursPollMs;
  console.log(`[MC-Snapshot] Starting adaptive polling - market hours: ${inMarketHours ? "OPEN" : "CLOSED"}`);
  console.log(`[MC-Snapshot] Intervals: ${marketHoursPollMs / 1000}s (market) / ${offHoursPollMs / 1000}s (off-hours)`);
  console.log(`[MC-Snapshot] Sleep mode: will sleep after ${IDLE_TIMEOUT_MS / 60000} min of inactivity`);
  
  // Start the sleep timer
  resetSleepTimer();
  
  // Start health monitoring watchdog
  startWatchdog();
  
  // Initial fetch
  refreshSnapshot().catch(console.error);
  
  // Schedule next poll with adaptive interval
  scheduleNextPoll();
  
  // Set up leader refresh (every 45 minutes)
  leaderRefreshHandle = setInterval(() => {
    refreshLeaders().catch(console.error);
  }, DEFAULT_CADENCE.leadersRefreshMs);
  
  // Initial leader refresh after first snapshot
  setTimeout(() => {
    refreshLeaders().catch(console.error);
  }, 5000);
}

/**
 * Stop polling
 */
export function stopPolling(): void {
  if (pollTimeoutHandle) {
    clearTimeout(pollTimeoutHandle);
    pollTimeoutHandle = null;
  }
  if (leaderRefreshHandle) {
    clearInterval(leaderRefreshHandle);
    leaderRefreshHandle = null;
  }
  if (watchdogHandle) {
    clearInterval(watchdogHandle);
    watchdogHandle = null;
  }
  if (sleepTimeoutHandle && !isSleeping) {
    // Only clear sleep timer if manually stopped (not entering sleep mode)
    clearTimeout(sleepTimeoutHandle);
    sleepTimeoutHandle = null;
  }
  lastMarketHoursState = null;
  console.log("[MC-Snapshot] Polling stopped");
}

/**
 * Update polling intervals (admin setting)
 */
export function setPollInterval(marketIntervalMs: number, offHoursIntervalMs?: number): void {
  marketHoursPollMs = marketIntervalMs;
  if (offHoursIntervalMs) {
    offHoursPollMs = offHoursIntervalMs;
  }
  
  // Restart polling with new intervals
  if (pollTimeoutHandle) {
    stopPolling();
    startPolling(marketIntervalMs);
  }
  
  // Update provider cache TTL based on current market state
  const provider = getAlpacaProvider();
  provider.setSnapshotTtl(isMarketHours() ? marketHoursPollMs : offHoursPollMs);
  
  console.log(`[MC-Snapshot] Poll intervals updated: ${marketHoursPollMs / 1000}s (market) / ${offHoursPollMs / 1000}s (off-hours)`);
}

// =============================================================================
// Sleep/Wake Mode - Saves API quota when no users are active
// =============================================================================

/**
 * Called on every data request to track activity
 * Wakes up polling if sleeping, resets idle timer
 */
export function touchActivity(): void {
  lastActivityTime = new Date();
  
  // If sleeping, wake up
  if (isSleeping) {
    wakeUp();
  }
  
  // Reset sleep timer
  resetSleepTimer();
}

/**
 * Reset the idle timeout that triggers sleep mode
 */
function resetSleepTimer(): void {
  if (sleepTimeoutHandle) {
    clearTimeout(sleepTimeoutHandle);
  }
  
  sleepTimeoutHandle = setTimeout(() => {
    enterSleepMode();
  }, IDLE_TIMEOUT_MS);
}

/**
 * Enter sleep mode - stop polling to save API quota
 * Only sleeps during off-hours; during market hours polling always continues.
 */
function enterSleepMode(): void {
  if (isSleeping) return;

  if (isMarketHours()) {
    // Never sleep during market hours - reschedule check for after close
    console.log("[MC-Snapshot] Inactivity detected but market is OPEN - not sleeping, resetting timer");
    resetSleepTimer();
    return;
  }

  console.log("[MC-Snapshot] No activity for 15 min (off-hours) - entering SLEEP mode to save API quota");
  isSleeping = true;
  stopPolling();
}

/**
 * Wake up from sleep mode - resume polling
 */
function wakeUp(): void {
  if (!isSleeping) return;
  
  console.log("[MC-Snapshot] Activity detected - WAKING UP, resuming polling");
  isSleeping = false;
  startPolling();
}

/**
 * Get current sleep/wake status
 */
export function getSleepStatus(): { isSleeping: boolean; lastActivityTime: Date; idleTimeoutMs: number } {
  return {
    isSleeping,
    lastActivityTime,
    idleTimeoutMs: IDLE_TIMEOUT_MS,
  };
}

// =============================================================================
// Data Access Functions
// =============================================================================

/**
 * Helper: Convert benchmarks Map to Record format for API response
 */
function getBenchmarksRecord(): Record<BenchmarkSymbol, BenchmarkData> {
  const defaultBenchmark: BenchmarkData = {
    symbol: "N/A",
    price: 0,
    prevClose: 0,
    changePct: 0,
    volume: 0,
    timestamp: new Date(),
  };
  
  return {
    QQQ: state.benchmarks.get("QQQ") || { ...defaultBenchmark, symbol: "QQQ" },
    IWM: state.benchmarks.get("IWM") || { ...defaultBenchmark, symbol: "IWM" },
    MDY: state.benchmarks.get("MDY") || { ...defaultBenchmark, symbol: "MDY" },
    SPY: state.benchmarks.get("SPY") || state.spyBenchmark || { ...defaultBenchmark, symbol: "SPY" },
  };
}

/**
 * Get current market condition snapshot
 */
const STALE_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes - don't mark stale if updated recently

export function getMarketCondition(): MarketConditionSnapshot {
  const isStale = !state.lastSnapshotTime ||
    Date.now() - state.lastSnapshotTime.getTime() > STALE_THRESHOLD_MS;
  
  return {
    themes: state.themeMetrics,
    spyBenchmark: state.spyBenchmark || {
      symbol: "SPY",
      price: 0,
      prevClose: 0,
      changePct: 0,
      volume: 0,
      timestamp: new Date(),
    },
    benchmarks: getBenchmarksRecord(),
    lastUpdated: state.lastSnapshotTime || new Date(),
    isStale,
  };
}

/**
 * Get market condition with deltaRank calculated against a specific time slice
 */
export async function getMarketConditionWithTimeSlice(timeSlice: TimeSlice): Promise<MarketConditionSnapshot> {
  const isStale = !state.lastSnapshotTime ||
    Date.now() - state.lastSnapshotTime.getTime() > STALE_THRESHOLD_MS;
  
  // Get the current themes
  let themes = [...state.themeMetrics];
  let comparisonTime: string | null = null;
  
  // If not the default time slice, recalculate deltaRank from historical data
  if (timeSlice !== "TODAY" && themes.length > 0) {
    const { date, hour } = getMarketDateTime();
    const deltaResult = await calculateDeltaRanks(themes, timeSlice, date, hour);
    
    // Apply historical deltaRank values AND historical metrics for dual display
    themes = themes.map(theme => ({
      ...theme,
      deltaRank: deltaResult.deltas.get(theme.id) ?? 0,
      historicalMetrics: deltaResult.historicalMetrics?.get(theme.id),
    }));
    
    comparisonTime = deltaResult.comparisonTime;
  }
  
  return {
    themes,
    spyBenchmark: state.spyBenchmark || {
      symbol: "SPY",
      price: 0,
      prevClose: 0,
      changePct: 0,
      volume: 0,
      timestamp: new Date(),
    },
    benchmarks: getBenchmarksRecord(),
    lastUpdated: state.lastSnapshotTime || new Date(),
    isStale,
    comparisonTime,
  };
}

/**
 * Get theme metrics for a specific cluster
 */
export function getThemeById(id: ClusterId): ThemeMetrics | undefined {
  return state.themeMetrics.find(t => t.id === id);
}

/**
 * Get all theme metrics
 */
export function getAllThemes(): ThemeMetrics[] {
  return state.themeMetrics;
}

/**
 * Get ticker metrics for a cluster
 */
export function getClusterMembers(clusterId: ClusterId): TickerMetrics[] {
  if (!state.spyBenchmark) return [];
  return getClusterTickerMetrics(clusterId, state.snapshots, state.spyBenchmark, undefined, undefined, state.maData);
}

/**
 * Get leaders for a cluster
 */
export function getClusterLeaderCandidates(clusterId: ClusterId): LeaderCandidate[] {
  return state.clusterLeaders.get(clusterId) || [];
}

/**
 * Get all leaders across all clusters
 */
export function getAllLeaders(): LeaderCandidate[] {
  const leaders: LeaderCandidate[] = [];
  const allCandidates = Array.from(state.clusterLeaders.values());
  for (const candidates of allCandidates) {
    leaders.push(...candidates.filter((c: LeaderCandidate) => c.isLeader));
  }
  return leaders.sort((a, b) => b.leaderScore - a.leaderScore);
}

/**
 * Get snapshot for a specific ticker
 */
export function getTickerSnapshot(symbol: string): TickerSnapshot | undefined {
  return state.snapshots.get(symbol);
}

/**
 * Get SPY benchmark data
 */
export function getSPYBenchmark(): BenchmarkData | null {
  return state.spyBenchmark;
}

/**
 * Get polling status
 */
export function getPollingStatus(): {
  isPolling: boolean;
  marketHoursIntervalMs: number;
  offHoursIntervalMs: number;
  currentIntervalMs: number;
  isMarketHours: boolean;
  marketSession: MarketSession;
  lastUpdate: Date | null;
  lastLeaderRefresh: Date | null;
  errorCount: number;
  tickerCount: number;
  themeCount: number;
} {
  const inMarketHours = isMarketHours();
  const session = getMarketSession();
  return {
    isPolling: !!pollTimeoutHandle,
    marketHoursIntervalMs: marketHoursPollMs,
    offHoursIntervalMs: offHoursPollMs,
    currentIntervalMs: inMarketHours ? marketHoursPollMs : offHoursPollMs,
    isMarketHours: inMarketHours,
    marketSession: session,
    lastUpdate: state.lastSnapshotTime,
    lastLeaderRefresh: state.lastLeaderRefreshTime,
    errorCount: state.errorCount,
    tickerCount: state.snapshots.size,
    themeCount: state.themeMetrics.length,
  };
}

/**
 * Force immediate refresh (for admin/testing)
 */
export async function forceRefresh(): Promise<void> {
  await refreshSnapshot();
  await refreshLeaders();
}

/**
 * Force save an intraday snapshot (for admin when data is stale)
 */
export async function forceSaveSnapshot(): Promise<boolean> {
  const { forceSaveIntradaySnapshot } = await import("./theme-snapshots");
  
  if (!state.themeMetrics || state.themeMetrics.length === 0) {
    console.log("[MC-Snapshot] Cannot force save - no theme metrics available");
    return false;
  }
  
  return forceSaveIntradaySnapshot(state.themeMetrics);
}
