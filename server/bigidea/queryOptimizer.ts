/**
 * Query Optimizer for Big Idea Scanner
 * 
 * Automatically reorders scan thoughts to minimize total evaluations and execution time.
 * Uses historical performance data to make intelligent optimization decisions.
 * 
 * Inspired by database query planners, this optimizer learns from every scan execution
 * and continuously improves its cost estimates over time.
 */

import { db, isDatabaseAvailable } from "../db";
import { indicatorExecutionStats } from "@shared/schema";
import { eq } from "drizzle-orm";
import { INDICATOR_LIBRARY } from "./indicators";

export interface ThoughtNode {
  id: string;
  thoughtName: string;
  thoughtTimeframe?: string;
  thoughtCriteria?: Array<{ indicatorId: string; muted?: boolean }>;
  isMuted?: boolean;
}

export interface ScanEdge {
  source: string;
  target: string;
}

export interface OptimizationContext {
  universe: string;
  marketRegime?: { weeklyTrend: string; dailyBasket: string; choppiness: string };
  timeframe: string;
}

export interface ThoughtCostEstimate {
  thoughtId: string;
  thoughtName: string;
  estimatedCostMs: number;
  estimatedSelectivity: number; // 0-1, higher = more restrictive
  confidence: number; // 0-1, based on amount of historical data
  indicators: Array<{
    indicatorId: string;
    costMs: number;
    passRate: number;
  }>;
}

/**
 * Static cost estimates for indicators when no historical data exists
 */
const STATIC_COSTS: Record<string, { baseMs: number; selectivity: number }> = {
  // Fundamental indicators - very fast (DB lookup), vary in selectivity
  'FND-1': { baseMs: 2, selectivity: 0.7 },  // Market cap - highly selective
  'FND-2': { baseMs: 2, selectivity: 0.6 },  // PE ratio - moderately selective
  'FND-3': { baseMs: 2, selectivity: 0.8 },  // Sector - highly selective
  'FND-4': { baseMs: 2, selectivity: 0.5 },  // Earnings proximity - moderately selective
  
  // Price action - fast, varies
  'PA-1': { baseMs: 5, selectivity: 0.3 },   // Price above MA
  'PA-2': { baseMs: 5, selectivity: 0.4 },   // Close near high
  'PA-3': { baseMs: 8, selectivity: 0.2 },   // Consolidation detection
  'PA-10': { baseMs: 3, selectivity: 0.3 },  // Gap detection
  
  // Volume - fast
  'VOL-1': { baseMs: 4, selectivity: 0.3 },  // Volume surge
  'VOL-2': { baseMs: 4, selectivity: 0.4 },  // Volume dry-up
  
  // Momentum - expensive (complex calculations)
  'MOM-1': { baseMs: 25, selectivity: 0.3 }, // Stochastic
  'MOM-2': { baseMs: 30, selectivity: 0.2 }, // RSI divergence
  'MOM-3': { baseMs: 35, selectivity: 0.3 }, // MACD histogram
  
  // Volatility - moderately expensive
  'VLT-1': { baseMs: 15, selectivity: 0.3 }, // Bollinger width
  'VLT-2': { baseMs: 15, selectivity: 0.4 }, // ATR contraction
  'VLT-4': { baseMs: 20, selectivity: 0.2 }, // Squeeze detection
  'VLT-5': { baseMs: 12, selectivity: 0.4 }, // Price vs BB
  
  // Intraday - varies
  'ITD-1': { baseMs: 8, selectivity: 0.3 },  // Opening range breakout
  'ITD-2': { baseMs: 12, selectivity: 0.4 }, // VWAP position
  'ITD-3': { baseMs: 5, selectivity: 0.3 },  // Gap detection
  
  // Consolidation - expensive (complex pattern detection)
  'CB-1': { baseMs: 40, selectivity: 0.15 }, // Find base (historical)
};

/**
 * Get static cost estimate for an indicator when no historical data exists
 */
function getStaticCost(indicatorId: string): { costMs: number; selectivity: number } {
  if (STATIC_COSTS[indicatorId]) {
    return { costMs: STATIC_COSTS[indicatorId].baseMs, selectivity: STATIC_COSTS[indicatorId].selectivity };
  }
  
  // Fallback based on indicator category
  const indicator = INDICATOR_LIBRARY.find(ind => ind.id === indicatorId);
  if (!indicator) return { costMs: 10, selectivity: 0.5 };
  
  const categoryDefaults: Record<string, { costMs: number; selectivity: number }> = {
    'Fundamental': { costMs: 2, selectivity: 0.7 },
    'Price Action': { costMs: 5, selectivity: 0.3 },
    'Volume': { costMs: 4, selectivity: 0.3 },
    'Momentum': { costMs: 25, selectivity: 0.3 },
    'Volatility': { costMs: 15, selectivity: 0.3 },
    'Consolidation': { costMs: 35, selectivity: 0.2 },
    'Intraday': { costMs: 8, selectivity: 0.3 },
    'Moving Averages': { costMs: 6, selectivity: 0.4 },
    'Relative Strength': { costMs: 10, selectivity: 0.4 },
  };
  
  return categoryDefaults[indicator.category] || { costMs: 10, selectivity: 0.5 };
}

/**
 * Estimate cost for a single thought based on historical data + static estimates
 */
export async function estimateThoughtCost(
  thought: ThoughtNode,
  context: OptimizationContext
): Promise<ThoughtCostEstimate> {
  if (thought.isMuted) {
    return {
      thoughtId: thought.id,
      thoughtName: thought.thoughtName || 'Unnamed',
      estimatedCostMs: 0,
      estimatedSelectivity: 1.0, // Muted = always passes
      confidence: 1.0,
      indicators: [],
    };
  }
  
  const indicators = (thought.thoughtCriteria || []).filter(c => !c.muted);
  if (indicators.length === 0) {
    return {
      thoughtId: thought.id,
      thoughtName: thought.thoughtName || 'Unnamed',
      estimatedCostMs: 0,
      estimatedSelectivity: 1.0,
      confidence: 1.0,
      indicators: [],
    };
  }
  
  const indicatorCosts: Array<{ indicatorId: string; costMs: number; passRate: number; confidence: number }> = [];
  
  for (const criterion of indicators) {
    let costMs = 10;
    let passRate = 0.5;
    let confidence = 0.0;
    
    // Try to fetch historical data
    if (isDatabaseAvailable() && db) {
      try {
        const stats = await db.select()
          .from(indicatorExecutionStats)
          .where(eq(indicatorExecutionStats.indicatorId, criterion.indicatorId))
          .limit(1);
        
        if (stats.length > 0) {
          const stat = stats[0];
          
          // Use context-specific stats if available
          if (context.universe && stat.universeStats) {
            const universeData = (stat.universeStats as any)[context.universe];
            if (universeData) {
              costMs = universeData.avgTimeMs || stat.avgExecutionTimeMs;
              passRate = universeData.passRate || stat.avgPassRate;
            } else {
              costMs = stat.avgExecutionTimeMs;
              passRate = stat.avgPassRate;
            }
          } else {
            costMs = stat.avgExecutionTimeMs;
            passRate = stat.avgPassRate;
          }
          
          // Apply regime adjustments if available
          if (context.marketRegime && stat.regimeStats) {
            const regimeKey = `${context.marketRegime.weeklyTrend}/${context.marketRegime.dailyBasket}`;
            const regimeData = (stat.regimeStats as any)[regimeKey];
            if (regimeData && regimeData.passRate !== undefined) {
              passRate = regimeData.passRate;
            }
          }
          
          // Confidence based on amount of data
          confidence = Math.min(1.0, stat.totalEvaluations / 1000);
        }
      } catch (e) {
        console.warn(`[QueryOptimizer] Failed to fetch stats for ${criterion.indicatorId}:`, e);
      }
    }
    
    // Fall back to static estimates if no historical data
    if (confidence === 0) {
      const staticCost = getStaticCost(criterion.indicatorId);
      costMs = staticCost.costMs;
      passRate = 1 - staticCost.selectivity; // Convert selectivity to pass rate
    }
    
    indicatorCosts.push({ indicatorId: criterion.indicatorId, costMs, passRate, confidence });
  }
  
  // Thought cost = sum of indicator costs
  const totalCostMs = indicatorCosts.reduce((sum, ic) => sum + ic.costMs, 0);
  
  // Thought pass rate = product of indicator pass rates (AND logic)
  const combinedPassRate = indicatorCosts.reduce((product, ic) => product * ic.passRate, 1.0);
  
  // Selectivity = 1 - pass rate (higher selectivity = filters out more stocks)
  const selectivity = 1 - combinedPassRate;
  
  // Overall confidence = average of indicator confidences
  const avgConfidence = indicatorCosts.reduce((sum, ic) => sum + ic.confidence, 0) / (indicatorCosts.length || 1);
  
  return {
    thoughtId: thought.id,
    thoughtName: thought.thoughtName || 'Unnamed',
    estimatedCostMs: totalCostMs,
    estimatedSelectivity: selectivity,
    confidence: avgConfidence,
    indicators: indicatorCosts.map(ic => ({ indicatorId: ic.indicatorId, costMs: ic.costMs, passRate: ic.passRate })),
  };
}

/**
 * Calculate the effective cost of running a thought, considering:
 * - Base execution time
 * - Selectivity (how many stocks it filters out)
 * - Position in the execution order
 */
function calculateEffectiveCost(
  costEstimate: ThoughtCostEstimate,
  stocksRemaining: number,
  totalStocks: number
): number {
  // Effective cost = time per evaluation × number of evaluations
  const evaluationsNeeded = stocksRemaining;
  const executionCost = costEstimate.estimatedCostMs * evaluationsNeeded;
  
  // Discount for high selectivity (fewer stocks pass = cheaper downstream)
  const stocksAfter = stocksRemaining * (1 - costEstimate.estimatedSelectivity);
  const selectivityBenefit = (stocksRemaining - stocksAfter) * 5; // Avg cost saved per filtered stock
  
  // Net cost = execution cost - benefit from filtering
  return Math.max(0, executionCost - selectivityBenefit);
}

/**
 * Detect if the scan has a "parallel to results" pattern (all thoughts connect to results)
 */
export function shouldAutoOptimize(thoughts: ThoughtNode[], edges: ScanEdge[]): boolean {
  // Find result node (target with no outgoing edges)
  const targets = new Set(edges.map(e => e.target));
  const sources = new Set(edges.map(e => e.source));
  
  // Result nodes are targets that are NOT sources (no outgoing edges)
  const resultNodes = Array.from(targets).filter(t => !sources.has(t));
  
  if (resultNodes.length === 0) return false;
  
  // Count how many thoughts connect directly to result
  const thoughtIds = new Set(thoughts.map(th => th.id));
  const thoughtsToResult = edges.filter(e => 
    resultNodes.includes(e.target) && 
    thoughtIds.has(e.source)
  );
  
  // If 2+ thoughts connect directly to result with no chain, optimize
  return thoughtsToResult.length >= 2;
}

/**
 * Automatically reorder thoughts to minimize total cost
 * Uses a greedy algorithm: at each step, pick the thought with lowest effective cost
 */
export async function autoOptimizeThoughtOrder(
  thoughts: ThoughtNode[],
  edges: ScanEdge[],
  context: OptimizationContext
): Promise<{ nodes: ThoughtNode[]; edges: ScanEdge[]; optimization: string }> {
  console.log(`[QueryOptimizer] Starting auto-optimization for ${thoughts.length} thoughts`);
  
  // Get cost estimates for all thoughts
  const costEstimates = await Promise.all(
    thoughts.map(t => estimateThoughtCost(t, context))
  );
  
  // Log initial estimates
  console.log('[QueryOptimizer] Cost estimates:');
  for (const estimate of costEstimates) {
    console.log(`  ${estimate.thoughtName}: ${estimate.estimatedCostMs.toFixed(1)}ms, selectivity: ${(estimate.estimatedSelectivity * 100).toFixed(1)}%, confidence: ${(estimate.confidence * 100).toFixed(0)}%`);
  }
  
  // Greedy optimization: pick thought with lowest effective cost at each step
  const optimizedOrder: ThoughtNode[] = [];
  const remaining = new Set(thoughts.map(t => t.id));
  let stocksRemaining = 501; // Typical universe size (will be adjusted based on actual)
  
  while (remaining.size > 0) {
    let bestThought: ThoughtNode | null = null;
    let bestCost = Infinity;
    
    for (const thoughtId of remaining) {
      const thought = thoughts.find(t => t.id === thoughtId)!;
      const estimate = costEstimates.find(e => e.thoughtId === thoughtId)!;
      
      const effectiveCost = calculateEffectiveCost(estimate, stocksRemaining, stocksRemaining);
      
      if (effectiveCost < bestCost) {
        bestCost = effectiveCost;
        bestThought = thought;
      }
    }
    
    if (!bestThought) break;
    
    optimizedOrder.push(bestThought);
    remaining.delete(bestThought.id);
    
    // Update stocks remaining for next iteration
    const estimate = costEstimates.find(e => e.thoughtId === bestThought!.id)!;
    stocksRemaining = Math.max(1, Math.floor(stocksRemaining * (1 - estimate.estimatedSelectivity)));
  }
  
  // Rebuild edges as a sequential chain
  const optimizedEdges: ScanEdge[] = [];
  for (let i = 0; i < optimizedOrder.length - 1; i++) {
    optimizedEdges.push({
      source: optimizedOrder[i].id,
      target: optimizedOrder[i + 1].id,
    });
  }
  
  // Find the result node ID from original edges
  const targets = new Set(edges.map(e => e.target));
  const sources = new Set(edges.map(e => e.source));
  const resultNodeId = Array.from(targets).find(t => !sources.has(t)) || 'results';
  
  // Connect last thought to results
  if (optimizedOrder.length > 0) {
    optimizedEdges.push({
      source: optimizedOrder[optimizedOrder.length - 1].id,
      target: resultNodeId,
    });
  }
  
  const optimizationSummary = `Reordered ${thoughts.length} thoughts: ${optimizedOrder.map(t => t.thoughtName || t.id).join(' → ')}`;
  console.log(`[QueryOptimizer] ${optimizationSummary}`);
  
  return {
    nodes: optimizedOrder,
    edges: optimizedEdges,
    optimization: optimizationSummary,
  };
}

/**
 * Record execution performance for a thought (called after scan completes)
 */
export async function recordThoughtPerformance(
  indicatorId: string,
  performance: {
    executionTimeMs: number;
    passed: number;
    evaluated: number;
    universe: string;
    marketRegime?: { weeklyTrend: string; dailyBasket: string };
    timeframe: string;
  }
): Promise<void> {
  if (!isDatabaseAvailable() || !db) return;
  
  try {
    const indicator = INDICATOR_LIBRARY.find(ind => ind.id === indicatorId);
    if (!indicator) return;
    
    const passRate = performance.evaluated > 0 ? performance.passed / performance.evaluated : 0;
    const selectivity = 1 - passRate;
    
    // Fetch existing stats
    const existing = await db.select()
      .from(indicatorExecutionStats)
      .where(eq(indicatorExecutionStats.indicatorId, indicatorId))
      .limit(1);
    
    if (existing.length === 0) {
      // Create new record
      await db.insert(indicatorExecutionStats).values({
        indicatorId,
        indicatorName: indicator.name,
        category: indicator.category,
        avgExecutionTimeMs: performance.executionTimeMs,
        avgPassRate: passRate,
        totalEvaluations: performance.evaluated,
        totalPasses: performance.passed,
        selectivityScore: selectivity,
        universeStats: { [performance.universe]: { passRate, avgTimeMs: performance.executionTimeMs } },
        regimeStats: performance.marketRegime 
          ? { [`${performance.marketRegime.weeklyTrend}/${performance.marketRegime.dailyBasket}`]: { passRate } }
          : {},
        timeframeStats: { [performance.timeframe]: { passRate, avgTimeMs: performance.executionTimeMs } },
        recentExecutionTimes: [performance.executionTimeMs],
        lastUpdated: new Date(),
      });
    } else {
      // Update existing with exponential moving average
      const stat = existing[0];
      const alpha = 0.1; // Weight for new data
      
      const newAvgTime = alpha * performance.executionTimeMs + (1 - alpha) * stat.avgExecutionTimeMs;
      const newAvgPassRate = alpha * passRate + (1 - alpha) * stat.avgPassRate;
      const newSelectivity = 1 - newAvgPassRate;
      
      // Update universe stats
      const universeStats = (stat.universeStats as any) || {};
      const prevUniverseData = universeStats[performance.universe] || { passRate: stat.avgPassRate, avgTimeMs: stat.avgExecutionTimeMs };
      universeStats[performance.universe] = {
        passRate: alpha * passRate + (1 - alpha) * prevUniverseData.passRate,
        avgTimeMs: alpha * performance.executionTimeMs + (1 - alpha) * prevUniverseData.avgTimeMs,
      };
      
      // Update regime stats
      const regimeStats = (stat.regimeStats as any) || {};
      if (performance.marketRegime) {
        const regimeKey = `${performance.marketRegime.weeklyTrend}/${performance.marketRegime.dailyBasket}`;
        const prevRegimeData = regimeStats[regimeKey] || { passRate: stat.avgPassRate };
        regimeStats[regimeKey] = {
          passRate: alpha * passRate + (1 - alpha) * prevRegimeData.passRate,
        };
      }
      
      // Update timeframe stats
      const timeframeStats = (stat.timeframeStats as any) || {};
      const prevTimeframeData = timeframeStats[performance.timeframe] || { passRate: stat.avgPassRate, avgTimeMs: stat.avgExecutionTimeMs };
      timeframeStats[performance.timeframe] = {
        passRate: alpha * passRate + (1 - alpha) * prevTimeframeData.passRate,
        avgTimeMs: alpha * performance.executionTimeMs + (1 - alpha) * prevTimeframeData.avgTimeMs,
      };
      
      // Update recent execution times (keep last 10)
      const recentTimes = (stat.recentExecutionTimes as number[]) || [];
      recentTimes.unshift(performance.executionTimeMs);
      if (recentTimes.length > 10) recentTimes.pop();
      
      await db.update(indicatorExecutionStats)
        .set({
          avgExecutionTimeMs: newAvgTime,
          avgPassRate: newAvgPassRate,
          totalEvaluations: stat.totalEvaluations + performance.evaluated,
          totalPasses: stat.totalPasses + performance.passed,
          selectivityScore: newSelectivity,
          universeStats,
          regimeStats,
          timeframeStats,
          recentExecutionTimes: recentTimes,
          lastUpdated: new Date(),
        })
        .where(eq(indicatorExecutionStats.indicatorId, indicatorId));
    }
  } catch (error) {
    console.error(`[QueryOptimizer] Failed to record performance for ${indicatorId}:`, error);
  }
}
