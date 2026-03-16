/**
 * Market Condition Exports
 * 
 * Functions exported for use by other modules (e.g., BigIdea Scanner).
 * This is the integration point for market regime data.
 */

import { ClusterId, CLUSTERS } from "./universe";
import { getAllThemes, getSPYBenchmark, getMarketCondition } from "./engine/snapshot";
import { calculateRAI, getCachedRAI, RAIOutput } from "./engine/rai";
import { ThemeMetrics } from "./engine/theme-score";
import { getQuotesBatch } from "../data-layer/quotes";

// =============================================================================
// Types for Scanner Integration
// =============================================================================

export type MarketRegime = "RISK_ON" | "NEUTRAL" | "RISK_OFF";

export interface ScannerRegimeData {
  // Core regime
  regime: MarketRegime;
  raiScore: number;
  raiLabel: "AGGRESSIVE" | "NEUTRAL" | "DEFENSIVE";
  riskMultiplier: number;
  
  // Top/bottom themes
  topThemes: Array<{
    id: ClusterId;
    name: string;
    score: number;
    penaltyFactor: number;
  }>;
  weakThemes: Array<{
    id: ClusterId;
    name: string;
    score: number;
    penaltyFactor: number;
  }>;
  
  // Penalty factors for all themes (for trade weighting)
  penaltyFactors: Record<ClusterId, number>;
  
  // Benchmark
  spyChangePct: number;
  
  // Metadata
  lastUpdated: Date;
  isStale: boolean;
}

// =============================================================================
// Main Export Function
// =============================================================================

/**
 * Get market regime data formatted for Scanner integration
 * 
 * Usage in Scanner:
 * ```typescript
 * import { getMarketRegimeForScanner } from '../market-condition/exports';
 * 
 * const regime = getMarketRegimeForScanner();
 * const adjustedWeight = baseWeight * regime.penaltyFactors[tickerTheme] * regime.riskMultiplier;
 * ```
 */
export function getMarketRegimeForScanner(): ScannerRegimeData {
  const condition = getMarketCondition();
  const themes = condition.themes;
  const cachedRAI = getCachedRAI();
  
  // Determine regime from RAI or theme data
  let regime: MarketRegime = "NEUTRAL";
  let raiScore = 50;
  let raiLabel: "AGGRESSIVE" | "NEUTRAL" | "DEFENSIVE" = "NEUTRAL";
  let riskMultiplier = 0.85;
  
  if (cachedRAI) {
    raiScore = cachedRAI.score;
    raiLabel = cachedRAI.label;
    riskMultiplier = cachedRAI.riskMultiplier;
    
    if (cachedRAI.label === "AGGRESSIVE") {
      regime = "RISK_ON";
    } else if (cachedRAI.label === "DEFENSIVE") {
      regime = "RISK_OFF";
    }
  } else if (themes.length > 0) {
    // Fallback: derive regime from theme data
    const avgScore = themes.reduce((sum, t) => sum + t.score, 0) / themes.length;
    if (avgScore >= 65) {
      regime = "RISK_ON";
      raiScore = avgScore;
      raiLabel = "AGGRESSIVE";
      riskMultiplier = 1.0;
    } else if (avgScore <= 45) {
      regime = "RISK_OFF";
      raiScore = avgScore;
      raiLabel = "DEFENSIVE";
      riskMultiplier = 0.6;
    }
  }
  
  // Get top and weak themes
  const sortedThemes = [...themes].sort((a, b) => b.score - a.score);
  const topThemes = sortedThemes.slice(0, 5).map(t => ({
    id: t.id,
    name: t.name,
    score: t.score,
    penaltyFactor: t.penaltyFactor,
  }));
  const weakThemes = sortedThemes.slice(-5).reverse().map(t => ({
    id: t.id,
    name: t.name,
    score: t.score,
    penaltyFactor: t.penaltyFactor,
  }));
  
  // Build penalty factors map
  const penaltyFactors: Record<string, number> = {};
  for (const theme of themes) {
    penaltyFactors[theme.id] = theme.penaltyFactor;
  }
  
  // Get SPY change
  const spy = getSPYBenchmark();
  
  return {
    regime,
    raiScore,
    raiLabel,
    riskMultiplier,
    topThemes,
    weakThemes,
    penaltyFactors: penaltyFactors as Record<ClusterId, number>,
    spyChangePct: spy?.changePct || 0,
    lastUpdated: condition.lastUpdated,
    isStale: condition.isStale,
  };
}

// =============================================================================
// Sector Performance (11 GICS sectors ranked by ETF change %)
// =============================================================================

/** One primary ETF per GICS sector for sector performance ranking */
const SECTOR_ETF_PRIMARY: { sector: string; etf: string }[] = [
  { sector: "Technology", etf: "XLK" },
  { sector: "Financial Services", etf: "XLF" },
  { sector: "Healthcare", etf: "XLV" },
  { sector: "Consumer Cyclical", etf: "XLY" },
  { sector: "Consumer Defensive", etf: "XLP" },
  { sector: "Energy", etf: "XLE" },
  { sector: "Industrials", etf: "XLI" },
  { sector: "Basic Materials", etf: "XLB" },
  { sector: "Real Estate", etf: "XLRE" },
  { sector: "Utilities", etf: "XLU" },
  { sector: "Communication Services", etf: "XLC" },
];

export interface SectorPerformanceRow {
  sector: string;
  etf: string;
  changePct: number;
  rank: number;
}

/**
 * Get ranked sector performance (1-11) by ETF change %.
 * Use for Market Context sector rank and sector heat views; one call from orchestrator.
 */
export async function getSectorPerformance(): Promise<SectorPerformanceRow[]> {
  const symbols = SECTOR_ETF_PRIMARY.map((r) => r.etf);
  const quotes = await getQuotesBatch(symbols);
  const rows: SectorPerformanceRow[] = SECTOR_ETF_PRIMARY.map((r) => ({
    sector: r.sector,
    etf: r.etf,
    changePct: quotes.get(r.etf)?.changePct ?? 0,
    rank: 0,
  }));
  rows.sort((a, b) => b.changePct - a.changePct);
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });
  return rows;
}

// =============================================================================
// Helper Functions for Scanner
// =============================================================================

/**
 * Get penalty factor for a specific ticker based on its theme
 * Returns 1.0 if ticker/theme not found
 */
export function getTickerPenaltyFactor(symbol: string): number {
  // Find which cluster this ticker belongs to
  for (const cluster of CLUSTERS) {
    if (cluster.core.includes(symbol) || cluster.candidates.includes(symbol)) {
      const themes = getAllThemes();
      const theme = themes.find(t => t.id === cluster.id);
      return theme?.penaltyFactor || 1.0;
    }
  }
  return 1.0; // Default no penalty
}

/**
 * Get risk multiplier from current RAI
 */
export function getCurrentRiskMultiplier(): number {
  const rai = getCachedRAI();
  return rai?.riskMultiplier || 0.85;
}

/**
 * Check if a theme is currently strong (score >= 70)
 */
export function isThemeStrong(themeId: ClusterId): boolean {
  const themes = getAllThemes();
  const theme = themes.find(t => t.id === themeId);
  return (theme?.score || 0) >= 70;
}

/**
 * Check if a theme is currently weak (score < 40)
 */
export function isThemeWeak(themeId: ClusterId): boolean {
  const themes = getAllThemes();
  const theme = themes.find(t => t.id === themeId);
  return (theme?.score || 50) < 40;
}

/**
 * Get the primary theme for a ticker
 */
export function getTickerTheme(symbol: string): ClusterId | null {
  for (const cluster of CLUSTERS) {
    if (cluster.core.includes(symbol)) {
      return cluster.id;
    }
  }
  for (const cluster of CLUSTERS) {
    if (cluster.candidates.includes(symbol)) {
      return cluster.id;
    }
  }
  return null;
}

/**
 * Calculate trade weight adjustment based on market condition
 * 
 * @param baseWeight - Base position size
 * @param tickerSymbol - Ticker symbol (to look up theme)
 * @returns Adjusted weight
 */
export function calculateAdjustedTradeWeight(
  baseWeight: number,
  tickerSymbol: string
): {
  adjustedWeight: number;
  penaltyFactor: number;
  riskMultiplier: number;
  explanation: string;
} {
  const tickerPenalty = getTickerPenaltyFactor(tickerSymbol);
  const riskMult = getCurrentRiskMultiplier();
  const adjustedWeight = baseWeight * tickerPenalty * riskMult;
  
  return {
    adjustedWeight: Math.round(adjustedWeight * 100) / 100,
    penaltyFactor: tickerPenalty,
    riskMultiplier: riskMult,
    explanation: `$${baseWeight.toLocaleString()} × ${tickerPenalty} (theme) × ${riskMult.toFixed(2)} (RAI) = $${Math.round(adjustedWeight).toLocaleString()}`,
  };
}
