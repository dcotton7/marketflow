/**
 * Leader Score Calculator
 * 
 * Calculates LeaderScore (0-100) for individual tickers based on:
 * - RS vs SPY (35%): Relative strength
 * - Volume Expansion (25%): Volume vs 20D average
 * - Momentum (25%): Above VWAP and 20D/21D SMA
 * - Acceleration (15%): Recent price momentum
 * 
 * Implements promotion/demotion with hysteresis and turnover caps.
 */

import { ClusterId, LEADER_RULES, getClusterById } from "../universe";
import { TickerSnapshot, HistoricalBar, BenchmarkData } from "../providers/types";

// =============================================================================
// Types
// =============================================================================

export interface LeaderCandidate {
  symbol: string;
  clusterId: ClusterId;
  leaderScore: number;
  
  // Score components
  rsVsSpy: number;
  volumeExp: number;
  momentumScore: number;
  accelerationScore: number;
  
  // Status
  isLeader: boolean;
  isPinned: boolean;
  
  // Hysteresis tracking
  consecutiveAbove70: number;
  consecutiveBelow55: number;
  
  // Eligibility
  isEligible: boolean;
  eligibilityReason?: string;
  
  // Price data
  price: number;
  pctChange: number;
  
  // Updated timestamp
  updatedAt: Date;
}

export interface LeaderState {
  [symbol: string]: {
    isLeader: boolean;
    isPinned: boolean;
    consecutiveAbove70: number;
    consecutiveBelow55: number;
  };
}

// =============================================================================
// State Management
// =============================================================================

// In-memory state for hysteresis tracking
const leaderState: Map<string, LeaderState[string]> = new Map();

// Daily turnover tracking
let dailyTurnoverCount = 0;
let dailyTurnoverResetDate: string = "";

// Per-refresh turnover tracking
let refreshTurnoverCount = 0;

/**
 * Reset turnover counters for a new refresh
 */
export function resetRefreshTurnover(): void {
  refreshTurnoverCount = 0;
}

/**
 * Check and reset daily turnover if needed
 */
function checkDailyTurnoverReset(): void {
  const today = new Date().toISOString().split("T")[0];
  if (today !== dailyTurnoverResetDate) {
    dailyTurnoverCount = 0;
    dailyTurnoverResetDate = today;
  }
}

// =============================================================================
// Leader Score Calculation
// =============================================================================

/**
 * Calculate LeaderScore for a single ticker
 */
export function calculateLeaderScore(
  snapshot: TickerSnapshot,
  spyBenchmark: BenchmarkData,
  historicalBars?: HistoricalBar[],
  avgVolume20D?: number
): number {
  const { weights } = LEADER_RULES;
  
  // RS vs SPY component (35%)
  const rsVsSpy = snapshot.changePct - spyBenchmark.changePct;
  // Map -5% to +5% → 0-100
  const rsScore = Math.max(0, Math.min(100, (rsVsSpy + 5) * 10));
  
  // Volume Expansion component (25%)
  const avgVol = avgVolume20D || snapshot.volume;
  const volExp = avgVol > 0 ? snapshot.volume / avgVol : 1;
  // Map 0.5x to 2.5x → 0-100
  const volScore = Math.max(0, Math.min(100, (volExp - 0.5) * 50));
  
  // Momentum component (25%)
  // Above VWAP: +33 points
  // Above 20D SMA: +33 points
  // Above 21D SMA: +34 points (if available)
  let momentumScore = 50; // Neutral default
  
  if (snapshot.price > snapshot.vwap) {
    momentumScore += 25;
  } else {
    momentumScore -= 25;
  }
  
  // Check against 20D SMA if historical data available
  if (historicalBars && historicalBars.length >= 20) {
    const closes = historicalBars.slice(-20).map(b => b.close);
    const sma20 = closes.reduce((a, b) => a + b, 0) / 20;
    if (snapshot.price > sma20) {
      momentumScore += 25;
    } else {
      momentumScore -= 25;
    }
  }
  
  momentumScore = Math.max(0, Math.min(100, momentumScore));
  
  // Acceleration component (15%)
  // Based on recent price momentum (3-day rate of change)
  let accelerationScore = 50; // Neutral default
  if (historicalBars && historicalBars.length >= 4) {
    const threeDaysAgo = historicalBars[historicalBars.length - 4]?.close || snapshot.prevClose;
    const threeDay = ((snapshot.price - threeDaysAgo) / threeDaysAgo) * 100;
    // Map -10% to +10% → 0-100
    accelerationScore = Math.max(0, Math.min(100, (threeDay + 10) * 5));
  }
  
  // Weighted sum
  const score =
    (rsScore * weights.rsVsSpy +
     volScore * weights.volumeExpansion +
     momentumScore * weights.momentum +
     accelerationScore * weights.acceleration) / 100;
  
  return Math.round(score * 10) / 10;
}

/**
 * Check if a ticker is eligible to be a leader
 */
export function checkLeaderEligibility(
  snapshot: TickerSnapshot,
  avgDollarVolume20D?: number
): { isEligible: boolean; reason?: string } {
  // Price check
  if (snapshot.price < LEADER_RULES.minPrice) {
    return {
      isEligible: false,
      reason: `Price ${snapshot.price.toFixed(2)} < min $${LEADER_RULES.minPrice}`,
    };
  }
  
  // Dollar volume check (if available)
  if (avgDollarVolume20D !== undefined && avgDollarVolume20D < LEADER_RULES.minAvgDollarVolume) {
    return {
      isEligible: false,
      reason: `Avg dollar volume ${(avgDollarVolume20D / 1e6).toFixed(1)}M < min $${LEADER_RULES.minAvgDollarVolume / 1e6}M`,
    };
  }
  
  return { isEligible: true };
}

/**
 * Process leader candidates for a cluster with hysteresis
 */
export function processClusterLeaders(
  clusterId: ClusterId,
  candidates: LeaderCandidate[]
): LeaderCandidate[] {
  checkDailyTurnoverReset();
  
  const cluster = getClusterById(clusterId);
  if (!cluster) return candidates;
  
  const targetLeaders = cluster.leadersTarget;
  const maxRefreshTurnover = Math.ceil(targetLeaders * LEADER_RULES.maxTurnoverPerRefresh);
  const maxDailyTurnover = Math.ceil(targetLeaders * LEADER_RULES.maxTurnoverPerDay);
  
  // Get current leaders
  const currentLeaders = candidates.filter(c => {
    const state = leaderState.get(c.symbol);
    return state?.isLeader || state?.isPinned;
  });
  
  // Sort candidates by score (excluding current leaders)
  const nonLeaders = candidates
    .filter(c => !currentLeaders.includes(c))
    .sort((a, b) => b.leaderScore - a.leaderScore);
  
  // Process hysteresis for each candidate
  for (const candidate of candidates) {
    let state = leaderState.get(candidate.symbol) || {
      isLeader: false,
      isPinned: false,
      consecutiveAbove70: 0,
      consecutiveBelow55: 0,
    };
    
    // Update consecutive counters
    if (candidate.leaderScore >= LEADER_RULES.promoteThreshold) {
      state.consecutiveAbove70++;
      state.consecutiveBelow55 = 0;
    } else if (candidate.leaderScore <= LEADER_RULES.demoteThreshold) {
      state.consecutiveBelow55++;
      state.consecutiveAbove70 = 0;
    } else {
      // Score in middle zone - reset both
      state.consecutiveAbove70 = 0;
      state.consecutiveBelow55 = 0;
    }
    
    // Check for promotion
    if (!state.isLeader &&
        state.consecutiveAbove70 >= LEADER_RULES.promoteConsecutiveRequired &&
        candidate.isEligible) {
      // Check turnover caps
      if (refreshTurnoverCount < maxRefreshTurnover &&
          dailyTurnoverCount < maxDailyTurnover) {
        state.isLeader = true;
        refreshTurnoverCount++;
        dailyTurnoverCount++;
      }
    }
    
    // Check for demotion
    if (state.isLeader &&
        !state.isPinned &&
        state.consecutiveBelow55 >= LEADER_RULES.demoteConsecutiveRequired) {
      state.isLeader = false;
      refreshTurnoverCount++;
      dailyTurnoverCount++;
    }
    
    // Update candidate with state
    candidate.isLeader = state.isLeader;
    candidate.isPinned = state.isPinned;
    candidate.consecutiveAbove70 = state.consecutiveAbove70;
    candidate.consecutiveBelow55 = state.consecutiveBelow55;
    
    // Save state
    leaderState.set(candidate.symbol, state);
  }
  
  // Ensure we have at least some leaders if none exist
  const leaders = candidates.filter(c => c.isLeader);
  if (leaders.length === 0) {
    // Bootstrap: promote top N eligible candidates
    const eligible = candidates
      .filter(c => c.isEligible)
      .sort((a, b) => b.leaderScore - a.leaderScore)
      .slice(0, targetLeaders);
    
    for (const candidate of eligible) {
      candidate.isLeader = true;
      const state = leaderState.get(candidate.symbol) || {
        isLeader: true,
        isPinned: false,
        consecutiveAbove70: 0,
        consecutiveBelow55: 0,
      };
      state.isLeader = true;
      leaderState.set(candidate.symbol, state);
    }
  }
  
  return candidates;
}

/**
 * Pin a ticker as a leader (admin action)
 */
export function pinLeader(symbol: string): void {
  const state = leaderState.get(symbol) || {
    isLeader: true,
    isPinned: true,
    consecutiveAbove70: 0,
    consecutiveBelow55: 0,
  };
  state.isPinned = true;
  state.isLeader = true;
  leaderState.set(symbol, state);
}

/**
 * Unpin a ticker (returns to normal hysteresis rules)
 */
export function unpinLeader(symbol: string): void {
  const state = leaderState.get(symbol);
  if (state) {
    state.isPinned = false;
    leaderState.set(symbol, state);
  }
}

/**
 * Get all current leaders for a cluster
 */
export function getClusterLeaders(clusterId: ClusterId): string[] {
  const cluster = getClusterById(clusterId);
  if (!cluster) return [];
  
  const allTickers = [...cluster.core, ...cluster.candidates];
  return allTickers.filter(symbol => {
    const state = leaderState.get(symbol);
    return state?.isLeader;
  });
}

/**
 * Get leader state for a symbol
 */
export function getLeaderState(symbol: string): LeaderState[string] | undefined {
  return leaderState.get(symbol);
}

/**
 * Build full leader candidates list for a cluster
 */
export function buildClusterLeaderCandidates(
  clusterId: ClusterId,
  snapshots: Map<string, TickerSnapshot>,
  spyBenchmark: BenchmarkData,
  historicalData?: Map<string, HistoricalBar[]>,
  avgVolumes?: Map<string, number>
): LeaderCandidate[] {
  const cluster = getClusterById(clusterId);
  if (!cluster) return [];
  
  const candidates: LeaderCandidate[] = [];
  const allTickers = [...cluster.core, ...cluster.candidates];
  
  for (const symbol of allTickers) {
    const snapshot = snapshots.get(symbol);
    if (!snapshot) continue;
    
    const historical = historicalData?.get(symbol);
    const avgVol = avgVolumes?.get(symbol);
    const avgDollarVol = avgVol && snapshot.price ? avgVol * snapshot.price : undefined;
    
    // Calculate leader score
    const leaderScore = calculateLeaderScore(snapshot, spyBenchmark, historical, avgVol);
    
    // Check eligibility
    const { isEligible, reason } = checkLeaderEligibility(snapshot, avgDollarVol);
    
    // Get existing state
    const state = leaderState.get(symbol);
    
    // Calculate score components for transparency
    const rsVsSpy = snapshot.changePct - spyBenchmark.changePct;
    const volExp = avgVol && avgVol > 0 ? snapshot.volume / avgVol : 1;
    
    candidates.push({
      symbol,
      clusterId,
      leaderScore,
      rsVsSpy,
      volumeExp: volExp,
      momentumScore: snapshot.price > snapshot.vwap ? 75 : 25,
      accelerationScore: 50, // Would need historical to calculate properly
      isLeader: state?.isLeader || false,
      isPinned: state?.isPinned || false,
      consecutiveAbove70: state?.consecutiveAbove70 || 0,
      consecutiveBelow55: state?.consecutiveBelow55 || 0,
      isEligible,
      eligibilityReason: reason,
      price: snapshot.price,
      pctChange: snapshot.changePct,
      updatedAt: new Date(),
    });
  }
  
  return candidates.sort((a, b) => b.leaderScore - a.leaderScore);
}
