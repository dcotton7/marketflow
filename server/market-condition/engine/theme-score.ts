/**
 * Theme Score Calculator v2
 * 
 * Calculates ThemeScore (0-100) for each behavior cluster based on:
 * - Pct (40%): Percentile rank of median member return
 * - Breadth (20%): %Above50 and %Above200 weighted
 * - RS (20%): Median relative strength vs benchmark
 * - Acceleration (20%): RS_now - RS_previous
 * 
 * Includes:
 * - Cross-sectional percentile normalization
 * - Narrow leadership penalty (smooth, 70%→90% = 1.0→0.85)
 * - Trend state calculation (Bull/Transition/Bear)
 */

import { 
  ClusterId, 
  CLUSTERS, 
  THEME_SCORE_WEIGHTS, 
  NARROW_LEADERSHIP_CONFIG,
  getClusterById,
  TimeSlice,
  SizeFilter,
  ETFProxy,
} from "../universe";
import { TickerSnapshot, BenchmarkData } from "../providers/types";
import { getTickersBySize } from "../utils/size-filter-helper";
import { getThemeTickerSymbols, getThemeCoreSymbols, isCacheInitialized, getCompanyNameMap } from "../utils/theme-db-loader";

// =============================================================================
// Types
// =============================================================================

export type TrendState = "Bull" | "Transition" | "Bear";

export interface ThemeMetrics {
  id: ClusterId;
  name: string;
  tier: "Macro" | "Structural" | "Narrative";
  
  // Core metrics (raw values)
  score: number;              // 0-100 ThemeScore (after penalty)
  baseScore: number;          // 0-100 ThemeScore (before penalty)
  medianPct: number;          // Median % change of members
  rsVsBenchmark: number;      // Median RS vs benchmark
  acceleration: number;       // RS change from previous period
  accDistDays: number;        // Accumulation/Distribution streak (William O'Neal style)
  
  // Component scores (0-1 normalized)
  pctComponent: number;       // Percentile rank of median return
  breadthComponent: number;   // Combined breadth score
  rsComponent: number;        // Percentile rank of RS
  accelComponent: number;     // Percentile rank of acceleration
  
  // Breadth details
  breadthPct: number;         // % of members green (legacy)
  pctAbove50d: number;        // % of members above 50d SMA
  pctAbove200d: number;       // % of members above 200d SMA
  
  // Ranking
  rank: number;               // Current rank (1 = best)
  deltaRank: number;          // Change from prior period
  percentile: number;         // Percentile rank (0-100)
  
  // Derived
  penaltyFactor: number;      // 0.40-1.00 for trade weighting
  narrowLeadershipMultiplier: number; // 0.85-1.00
  reasonCodes: string[];      // Signal codes
  
  // Member counts
  coreCount: number;
  totalCount: number;
  greenCount: number;
  
  // Concentration (Method D: positive returns only)
  top3Contribution: number;   // % of positive returns from top 3 (0-1)
  isNarrowLeadership: boolean; // true if top3 >= 70%
  
  // Trend state (aggregated from members)
  trendState: TrendState;
  bullCount: number;          // Members in Bull state
  transitionCount: number;    // Members in Transition
  bearCount: number;          // Members in Bear state
  
  // ETF proxies
  etfProxies: ETFProxy[];
  
  // Historical metrics for time-slice comparison (populated when timeSlice != "1D")
  historicalMetrics?: {
    rank: number;
    score: number;
    medianPct: number;
    rsVsBenchmark: number;
    breadthPct: number;
  };
  
  // Timestamp
  calculatedAt: Date;
  timeSlice: TimeSlice;
}

export interface TickerMetrics {
  symbol: string;
  companyName?: string | null;
  clusterId: ClusterId;
  
  // Price data
  price: number;
  prevClose: number;
  pctChange: number;
  prevDayVolExp?: number;     // Volume expansion for previous full session (D-Close)
  
  // Relative metrics
  rsVsBenchmark: number;
  volExp: number;
  
  // Historical ticker data for time-slice comparison (populated when timeSlice != "1D")
  historicalPrice?: number;
  historicalPct?: number;
  historicalVolExp?: number;
  
  // Trend state
  trendState: TrendState;
  isAbove50d: boolean;
  isAbove200d: boolean;
  
  // % above/below each MA (for configurable columns)
  pctVsEma10d?: number | null;
  pctVsEma20d?: number | null;
  pctVsSma50d?: number | null;
  pctVsSma200d?: number | null;
  
  // Classification
  isCore: boolean;
  isCandidate: boolean;
  
  // Contribution tracking
  contributionPct: number;    // % contribution to theme move
  rsRank: number;             // RS rank within theme (1 = best)
}

// =============================================================================
// State Storage
// =============================================================================

// Previous RS values for acceleration calculation
let previousRS: Map<ClusterId, number> = new Map();

// Previous rankings for delta calculation
let previousRankings: Map<ClusterId, number> = new Map();

export function setPreviousRS(rs: Map<ClusterId, number>): void {
  previousRS = new Map(rs);
}

export function getPreviousRS(): Map<ClusterId, number> {
  return new Map(previousRS);
}

export function setPreviousRankings(rankings: Map<ClusterId, number>): void {
  previousRankings = new Map(rankings);
}

export function getPreviousRankings(): Map<ClusterId, number> {
  return new Map(previousRankings);
}

/**
 * Initialize previous RS and rankings from the most recent daily snapshot
 * This should be called once on server startup to seed acceleration calculations
 */
export async function initializePreviousValuesFromSnapshots(): Promise<boolean> {
  const { getDb } = await import('../../db');
  const { themeSnapshots } = await import('@shared/schema');
  const { eq, and, desc, lt } = await import('drizzle-orm');
  
  const db = getDb();
  if (!db) {
    console.log('[ThemeScore] No database - acceleration will be 0 until polling updates');
    return false;
  }
  
  try {
    // Get YESTERDAY's snapshot (not today's) for meaningful acceleration
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    
    const latestSnapshots = await db
      .select()
      .from(themeSnapshots)
      .where(
        and(
          eq(themeSnapshots.snapshotType, 'daily_close'),
          lt(themeSnapshots.marketDate, yesterdayStr + 'ZZZ') // Get yesterday or earlier
        )
      )
      .orderBy(desc(themeSnapshots.marketDate))
      .limit(30);
    
    if (!latestSnapshots || latestSnapshots.length === 0) {
      console.log('[ThemeScore] No historical snapshots found - acceleration will be 0 until next snapshot');
      return false;
    }
    
    const rsMap = new Map<ClusterId, number>();
    const rankMap = new Map<ClusterId, number>();
    
    for (const snapshot of latestSnapshots) {
      rsMap.set(snapshot.themeId as ClusterId, snapshot.rsVsBenchmark);
      rankMap.set(snapshot.themeId as ClusterId, snapshot.rank);
    }
    
    previousRS = rsMap;
    previousRankings = rankMap;
    
    console.log(`[ThemeScore] Initialized acceleration from ${latestSnapshots[0]?.marketDate} snapshot (${rsMap.size} themes)`);
    return true;
  } catch (error) {
    console.error('[ThemeScore] Failed to initialize from snapshots:', error);
    return false;
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Round to 2 decimal places
 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Calculate median of an array
 */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Calculate percentile rank of a value within a distribution
 * Returns 0-1 (0 = worst, 1 = best)
 */
export function percentileRank(value: number, allValues: number[]): number {
  if (allValues.length === 0) return 0.5;
  const sorted = [...allValues].sort((a, b) => a - b);
  let rank = 0;
  for (const v of sorted) {
    if (v < value) rank++;
    else if (v === value) rank += 0.5;
  }
  return rank / sorted.length;
}

/**
 * Calculate narrow leadership multiplier
 * Smooth penalty from 70% to 90% top3 contribution
 * Returns 1.0 (no penalty) down to 0.85 (max penalty)
 */
export function narrowLeadershipMultiplier(top3Contribution: number): number {
  const { thresholdStart, thresholdEnd, maxPenalty } = NARROW_LEADERSHIP_CONFIG;
  
  if (!Number.isFinite(top3Contribution) || top3Contribution < thresholdStart) {
    return 1.0;
  }
  
  // Scale contribution from threshold range to 0-1
  const t = Math.min(1, Math.max(0, 
    (top3Contribution - thresholdStart) / (thresholdEnd - thresholdStart)
  ));
  
  // Apply smooth penalty
  return 1.0 - (maxPenalty * t);
}

/**
 * Calculate top 3 contribution using positive returns only (Method D)
 * Returns 0-1 representing concentration
 */
export function calculateTop3Contribution(pctChanges: number[]): number {
  // Filter to positive returns only
  const positiveReturns = pctChanges.filter(p => p > 0);
  
  if (positiveReturns.length === 0) return 0;
  
  // Sort descending
  const sorted = [...positiveReturns].sort((a, b) => b - a);
  
  // Sum of all positive returns
  const totalPositive = sorted.reduce((sum, p) => sum + p, 0);
  
  if (totalPositive === 0) return 0;
  
  // Sum of top 3 (or fewer if less available)
  const top3Sum = sorted.slice(0, 3).reduce((sum, p) => sum + p, 0);
  
  return top3Sum / totalPositive;
}

/**
 * Determine trend state from 50d and 200d SMA positions
 */
export function determineTrendState(isAbove50d: boolean, isAbove200d: boolean): TrendState {
  if (isAbove50d && isAbove200d) return "Bull";
  if (!isAbove50d && !isAbove200d) return "Bear";
  return "Transition";
}

/**
 * Determine theme-level trend state from member counts
 */
export function determineThemeTrendState(
  bullCount: number, 
  transitionCount: number, 
  bearCount: number
): TrendState {
  const total = bullCount + transitionCount + bearCount;
  if (total === 0) return "Transition";
  
  const bullPct = bullCount / total;
  const bearPct = bearCount / total;
  
  if (bullPct >= 0.6) return "Bull";
  if (bearPct >= 0.6) return "Bear";
  return "Transition";
}

// =============================================================================
// Theme Score Calculation
// =============================================================================

/**
 * Calculate theme metrics for all clusters with percentile normalization
 * @param allowedTickers - Optional set of tickers to filter by (for size filtering)
 */
export function calculateAllThemeMetrics(
  snapshots: Map<string, TickerSnapshot>,
  benchmark: BenchmarkData,
  historicalVolumes?: Map<string, number>,
  smaData?: Map<string, { sma50: number; sma200: number }>,
  timeSlice: TimeSlice = "1D",
  allowedTickers?: Set<string>
): ThemeMetrics[] {
  // Filter snapshots if size filter is active
  let filteredSnapshots = snapshots;
  if (allowedTickers && allowedTickers.size > 0) {
    filteredSnapshots = new Map();
    for (const [symbol, snapshot] of snapshots) {
      if (allowedTickers.has(symbol.toUpperCase())) {
        filteredSnapshots.set(symbol, snapshot);
      }
    }
    console.log(`[ThemeScore] Size filter active: ${filteredSnapshots.size}/${snapshots.size} tickers`);
  }
  
  // First pass: calculate raw metrics for each cluster
  const rawMetrics: ThemeMetrics[] = [];
  
  for (const cluster of CLUSTERS) {
    const metrics = calculateClusterMetricsRaw(
      cluster.id,
      filteredSnapshots,
      benchmark,
      historicalVolumes,
      smaData,
      timeSlice
    );
    
    // Skip themes with no matching tickers
    if (metrics.totalCount === 0 && allowedTickers && allowedTickers.size > 0) {
      continue;
    }
    
    rawMetrics.push(metrics);
  }
  
  // Collect all values for percentile calculations
  const allMedianPcts = rawMetrics.map(m => m.medianPct);
  const allRS = rawMetrics.map(m => m.rsVsBenchmark);
  const allBreadth = rawMetrics.map(m => 
    0.6 * m.pctAbove50d + 0.4 * m.pctAbove200d
  );
  
  // Calculate acceleration (RS change from previous)
  const accelerations: number[] = [];
  for (const m of rawMetrics) {
    const prevRS = previousRS.get(m.id) ?? m.rsVsBenchmark;
    const accel = m.rsVsBenchmark - prevRS;
    accelerations.push(accel);
  }
  console.log(`[Accel Debug] Sample accelerations:`, accelerations.slice(0, 5).map((a, i) => `${rawMetrics[i]?.id}: ${a.toFixed(2)}`));
  
  // Second pass: apply percentile normalization and calculate final scores
  const finalMetrics: ThemeMetrics[] = [];
  
  for (let i = 0; i < rawMetrics.length; i++) {
    const m = rawMetrics[i];
    const accel = accelerations[i];
    
    // Calculate percentile-normalized components (0-1)
    const pctComponent = percentileRank(m.medianPct, allMedianPcts);
    const rsComponent = percentileRank(m.rsVsBenchmark, allRS);
    const breadthRaw = 0.6 * m.pctAbove50d + 0.4 * m.pctAbove200d;
    const breadthComponent = percentileRank(breadthRaw, allBreadth);
    const accelComponent = percentileRank(accel, accelerations);
    
    // Calculate base score using new weights
    const baseScore = (
      pctComponent * THEME_SCORE_WEIGHTS.pct +
      breadthComponent * THEME_SCORE_WEIGHTS.breadth +
      rsComponent * THEME_SCORE_WEIGHTS.rs +
      accelComponent * THEME_SCORE_WEIGHTS.acceleration
    );
    
    // Apply narrow leadership penalty
    const nlMultiplier = narrowLeadershipMultiplier(m.top3Contribution);
    const finalScore = Math.round(baseScore * nlMultiplier * 10) / 10;
    
    finalMetrics.push({
      ...m,
      baseScore: round2(baseScore),
      score: round2(finalScore),
      acceleration: round2(accel),
      pctComponent: round2(pctComponent),
      breadthComponent: round2(breadthComponent),
      rsComponent: round2(rsComponent),
      accelComponent: round2(accelComponent),
      narrowLeadershipMultiplier: round2(nlMultiplier),
      isNarrowLeadership: m.top3Contribution >= NARROW_LEADERSHIP_CONFIG.thresholdStart,
    });
  }
  
  // Sort by score descending and assign ranks
  finalMetrics.sort((a, b) => b.score - a.score);
  
  finalMetrics.forEach((m, index) => {
    m.rank = index + 1;
    m.percentile = Math.round(((finalMetrics.length - index) / finalMetrics.length) * 100);
    const prevRank = previousRankings.get(m.id);
    m.deltaRank = prevRank ? prevRank - m.rank : 0;
  });
  
  // Store current values for next calculation
  const newRS = new Map<ClusterId, number>();
  const newRankings = new Map<ClusterId, number>();
  finalMetrics.forEach(m => {
    newRS.set(m.id, m.rsVsBenchmark);
    newRankings.set(m.id, m.rank);
  });
  previousRS = newRS;
  previousRankings = newRankings;
  
  return finalMetrics;
}

/**
 * Calculate raw metrics for a single cluster (before percentile normalization)
 */
function calculateClusterMetricsRaw(
  clusterId: ClusterId,
  snapshots: Map<string, TickerSnapshot>,
  benchmark: BenchmarkData,
  historicalVolumes?: Map<string, number>,
  smaData?: Map<string, { sma50: number; sma200: number }>,
  timeSlice: TimeSlice = "1D"
): ThemeMetrics {
  const cluster = getClusterById(clusterId);
  if (!cluster) {
    throw new Error(`Unknown cluster: ${clusterId}`);
  }
  
  const allTickers = [...cluster.core, ...cluster.candidates];
  const pctChanges: number[] = [];
  const rsValues: number[] = [];
  let greenCount = 0;
  let above50Count = 0;
  let above200Count = 0;
  let bullCount = 0;
  let transitionCount = 0;
  let bearCount = 0;
  let validCount = 0;
  
  // Gather metrics for all tickers
  for (const symbol of allTickers) {
    const snapshot = snapshots.get(symbol);
    if (!snapshot) continue;
    
    validCount++;
    const pctChange = snapshot.changePct;
    pctChanges.push(pctChange);
    
    if (pctChange > 0) greenCount++;
    
    // Calculate RS vs benchmark
    const rs = pctChange - benchmark.changePct;
    rsValues.push(rs);
    
    // Check SMA positions if data available
    const sma = smaData?.get(symbol);
    if (sma) {
      const isAbove50d = snapshot.price > sma.sma50;
      const isAbove200d = snapshot.price > sma.sma200;
      
      if (isAbove50d) above50Count++;
      if (isAbove200d) above200Count++;
      
      const trendState = determineTrendState(isAbove50d, isAbove200d);
      if (trendState === "Bull") bullCount++;
      else if (trendState === "Bear") bearCount++;
      else transitionCount++;
    } else {
      // Without SMA data, use price vs VWAP as proxy
      const aboveVwap = snapshot.price > snapshot.vwap;
      if (aboveVwap) {
        above50Count++;
        above200Count++;
        bullCount++;
      } else {
        transitionCount++;
      }
    }
  }
  
  // Calculate aggregate metrics (rounded to 2 decimal places)
  const medianPct = round2(median(pctChanges));
  const rsVsBenchmark = round2(median(rsValues));
  
  // Breadth percentages (rounded)
  const pctAbove50d = round2(validCount > 0 ? (above50Count / validCount) * 100 : 50);
  const pctAbove200d = round2(validCount > 0 ? (above200Count / validCount) * 100 : 50);
  const breadthPct = round2(validCount > 0 ? (greenCount / validCount) * 100 : 50);
  
  // Top 3 contribution (Method D: positive returns only) - rounded
  const top3Contribution = round2(calculateTop3Contribution(pctChanges));
  
  // Theme trend state
  const trendState = determineThemeTrendState(bullCount, transitionCount, bearCount);
  
  // Generate reason codes
  const reasonCodes = generateReasonCodes(breadthPct, rsVsBenchmark, 1, 0);
  
  // Calculate penalty factor (for backward compatibility)
  const penaltyFactor = calculatePenaltyFactor(50); // Will be recalculated with final score
  
  return {
    id: clusterId,
    name: cluster.name,
    tier: cluster.tier,
    score: 0,           // Will be set after normalization
    baseScore: 0,       // Will be set after normalization
    medianPct,
    rsVsBenchmark,
    acceleration: 0,    // Will be set after normalization
    accDistDays: 0,     // Will be set from historical snapshots
    pctComponent: 0,    // Will be set after normalization
    breadthComponent: 0,
    rsComponent: 0,
    accelComponent: 0,
    breadthPct,
    pctAbove50d,
    pctAbove200d,
    rank: 0,
    deltaRank: 0,
    percentile: 0,
    penaltyFactor,
    narrowLeadershipMultiplier: 1,
    reasonCodes,
    coreCount: cluster.core.length,
    totalCount: validCount,
    greenCount,
    top3Contribution,
    isNarrowLeadership: false,
    trendState,
    bullCount,
    transitionCount,
    bearCount,
    etfProxies: cluster.etfProxies,
    calculatedAt: new Date(),
    timeSlice,
  };
}

/**
 * Calculate penalty factor for trade weighting (legacy support)
 */
export function calculatePenaltyFactor(score: number): number {
  if (score >= 70) return 1.0;
  if (score >= 60) return 0.85;
  if (score >= 50) return 0.65;
  return 0.40;
}

/**
 * Generate reason codes for a theme
 */
export function generateReasonCodes(
  breadthPct: number,
  rsVsBenchmark: number,
  volExp: number,
  acceleration: number
): string[] {
  const codes: string[] = [];
  
  // Breadth signals
  if (breadthPct >= 70) codes.push("BREADTH_STRONG");
  else if (breadthPct < 50) codes.push("BREADTH_WEAK");
  
  // RS signals
  if (rsVsBenchmark > 0.5) codes.push("RS_POS");
  else if (rsVsBenchmark < -0.5) codes.push("RS_NEG");
  
  // Volume signals
  if (volExp >= 1.5) codes.push("VOL_EXPAND");
  else if (volExp < 1.0) codes.push("VOL_DRY");
  
  // Acceleration signals
  if (acceleration > 0.5) codes.push("ACCEL_POS");
  else if (acceleration < -0.5) codes.push("ACCEL_NEG");
  
  return codes;
}

/** Full MA data for pct vs MA calculations */
export type MaDataEntry = { ema10d: number | null; ema20d: number | null; sma50d: number | null; sma200d: number | null };

function pctVsMa(price: number, ma: number | null): number | null {
  if (ma == null || ma <= 0) return null;
  return ((price - ma) / ma) * 100;
}

/**
 * Get ticker-level metrics for a specific cluster
 */
export function getClusterTickerMetrics(
  clusterId: ClusterId,
  snapshots: Map<string, TickerSnapshot>,
  benchmark: BenchmarkData,
  historicalVolumes?: Map<string, number>,
  smaData?: Map<string, { sma50: number; sma200: number }>,
  maData?: Map<string, MaDataEntry>
): TickerMetrics[] {
  // Merge DB cache with runtime CLUSTERS (add-tickers modifies CLUSTERS in-memory)
  const cluster = getClusterById(clusterId);
  let allTickers: string[] = [];
  let coreTickers: Set<string> = new Set();

  if (isCacheInitialized()) {
    const dbTickers = getThemeTickerSymbols(clusterId);
    const dbCore = new Set(getThemeCoreSymbols(clusterId).map((s: string) => s.toUpperCase()));
    // Include runtime adds from CLUSTERS (add-tickers pushes to candidates)
    const runtimeTickers = cluster ? [...cluster.core, ...cluster.candidates] : [];
    const seen = new Set<string>();
    for (const s of [...dbTickers, ...runtimeTickers]) {
      const u = s.toUpperCase();
      if (!seen.has(u)) {
        seen.add(u);
        allTickers.push(s);
      }
    }
    coreTickers = dbCore;
    if (cluster) {
      for (const s of cluster.core) coreTickers.add(s.toUpperCase());
    }
  } else if (cluster) {
    allTickers = [...cluster.core, ...cluster.candidates];
    coreTickers = new Set(cluster.core.map(s => s.toUpperCase()));
  }
  
  if (allTickers.length === 0) return [];
  
  const metrics: TickerMetrics[] = [];
  
  // First pass: collect data
  for (const symbol of allTickers) {
    const snapshot = snapshots.get(symbol);
    if (!snapshot) continue;
    
    const pctChange = snapshot.changePct;
    const rsVsBenchmark = pctChange - benchmark.changePct;
    const avgVol = historicalVolumes?.get(symbol) || snapshot.volume;
    const volExp = avgVol > 0 ? snapshot.volume / avgVol : 1;
    const prevDayVolExp = avgVol > 0 && snapshot.prevDayVolume > 0 ? snapshot.prevDayVolume / avgVol : undefined;
    
    // Trend state: use maData if available, else smaData, else VWAP
    const ma = maData?.get(symbol);
    const sma = smaData?.get(symbol);
    const isAbove50d = ma?.sma50d != null
      ? snapshot.price > ma.sma50d
      : sma ? snapshot.price > sma.sma50 : snapshot.price > snapshot.vwap;
    const isAbove200d = ma?.sma200d != null
      ? snapshot.price > ma.sma200d
      : sma ? snapshot.price > sma.sma200 : snapshot.price > snapshot.vwap;
    const trendState = determineTrendState(isAbove50d, isAbove200d);
    
    // % vs each MA (for configurable columns)
    const pctVsEma10d = ma ? pctVsMa(snapshot.price, ma.ema10d) : null;
    const pctVsEma20d = ma ? pctVsMa(snapshot.price, ma.ema20d) : null;
    const pctVsSma50d = ma ? pctVsMa(snapshot.price, ma.sma50d) : null;
    const pctVsSma200d = ma ? pctVsMa(snapshot.price, ma.sma200d) : null;
    
    const symbolUpper = symbol.toUpperCase();
    const isCore = coreTickers.has(symbolUpper);
    
    metrics.push({
      symbol,
      clusterId,
      price: snapshot.price,
      prevClose: snapshot.prevClose,
      pctChange,
      prevDayVolExp,
      rsVsBenchmark,
      volExp,
      trendState,
      isAbove50d,
      isAbove200d,
      pctVsEma10d: pctVsEma10d ?? undefined,
      pctVsEma20d: pctVsEma20d ?? undefined,
      pctVsSma50d: pctVsSma50d ?? undefined,
      pctVsSma200d: pctVsSma200d ?? undefined,
      isCore: isCore,
      isCandidate: !isCore,
      contributionPct: 0,  // Will be calculated
      rsRank: 0,           // Will be calculated
    });
  }
  
  // Calculate contribution percentages
  const totalPositive = metrics
    .filter(m => m.pctChange > 0)
    .reduce((sum, m) => sum + m.pctChange, 0);
  
  for (const m of metrics) {
    if (m.pctChange > 0 && totalPositive > 0) {
      m.contributionPct = m.pctChange / totalPositive;
    }
  }
  
  // Sort by RS and assign ranks
  const sortedByRS = [...metrics].sort((a, b) => b.rsVsBenchmark - a.rsVsBenchmark);
  sortedByRS.forEach((m, i) => {
    const original = metrics.find(x => x.symbol === m.symbol);
    if (original) original.rsRank = i + 1;
  });
  
  // Return sorted by pctChange descending
  return metrics.sort((a, b) => b.pctChange - a.pctChange);
}

// =============================================================================
// Legacy Compatibility
// =============================================================================

/**
 * Legacy function signature for backward compatibility
 * @deprecated Use calculateAllThemeMetrics with full parameters
 */
export function calculateThemeScore(
  breadthPct: number,
  rsVsSpy: number,
  volExp: number,
  acceleration: number
): number {
  // Legacy formula for backward compatibility
  const breadthScore = Math.max(0, Math.min(100, breadthPct));
  const rsScore = Math.max(0, Math.min(100, (rsVsSpy + 5) * 10));
  const volScore = Math.max(0, Math.min(100, (volExp - 0.5) * 50));
  const accelScore = Math.max(0, Math.min(100, (acceleration + 10) * 5));
  
  // Use old weights for legacy calls
  const score = (breadthScore * 40 + rsScore * 30 + volScore * 20 + accelScore * 10) / 100;
  
  return Math.round(score * 10) / 10;
}
