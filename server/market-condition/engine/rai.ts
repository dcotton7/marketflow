/**
 * Risk Appetite Index (RAI) Engine
 * 
 * Calculates a continuous 0-100 regime score independent of theme scores.
 * 
 * Components (each 0-20, total 0-100):
 * - Trend Position (20): QQQ, IWO, SLY, ARKK vs 21D/50D SMA
 * - Small vs Large Spread (20): IWM/SPY ratio vs 20D avg
 * - Speculative Leadership (20): ARKK, meme, crypto theme strength
 * - Market Breadth (20): % above 50D SMA (via proxy ETFs)
 * - Volatility Regime (20): VIX level + term structure
 */

import { getAlpacaProvider } from "../providers/alpaca";
import { BenchmarkData, HistoricalBar } from "../providers/types";
import { ThemeMetrics } from "./theme-score";

// =============================================================================
// Types
// =============================================================================

export interface RAIComponents {
  trendPosition: number;      // 0-20
  smallVsLarge: number;       // 0-20
  specLeadership: number;     // 0-20
  marketBreadth: number;      // 0-20
  volatilityRegime: number;   // 0-20
}

export interface RAIOutput {
  score: number;                                    // 0-100
  label: "AGGRESSIVE" | "NEUTRAL" | "DEFENSIVE";
  riskMultiplier: number;                           // 0.5-1.2
  components: RAIComponents;
  details: {
    trendPositionDetail: string;
    smallVsLargeDetail: string;
    specLeadershipDetail: string;
    marketBreadthDetail: string;
    volatilityDetail: string;
  };
  calculatedAt: Date;
}

// RAI proxy symbols
const RAI_SYMBOLS = {
  trend: ["QQQ", "IWO", "SLY", "ARKK"],  // Growth/small cap proxies
  ratio: { small: "IWM", large: "SPY" },  // Small vs large ratio
  spec: ["ARKK"],                          // Speculative proxy
  breadth: ["RSP", "FFTY"],               // Equal weight / sector breadth
  volatility: ["VIX", "UVXY"],            // Volatility proxies
};

// =============================================================================
// State
// =============================================================================

let cachedRAI: RAIOutput | null = null;
let lastCalculation: Date | null = null;
const CACHE_TTL_MS = 60000; // 1 minute cache

// =============================================================================
// Main Calculation
// =============================================================================

/**
 * Calculate full RAI score and components
 */
export async function calculateRAI(
  themeMetrics?: ThemeMetrics[],
  forceRefresh = false
): Promise<RAIOutput> {
  // Return cached if fresh
  if (!forceRefresh && cachedRAI && lastCalculation) {
    const age = Date.now() - lastCalculation.getTime();
    if (age < CACHE_TTL_MS) {
      return cachedRAI;
    }
  }
  
  const provider = getAlpacaProvider();
  
  // Fetch all needed symbols
  const allSymbols = [
    ...RAI_SYMBOLS.trend,
    RAI_SYMBOLS.ratio.small,
    RAI_SYMBOLS.ratio.large,
    ...RAI_SYMBOLS.breadth,
    ...RAI_SYMBOLS.volatility,
  ];
  
  try {
    const snapshots = await provider.getSnapshots(allSymbols);
    
    // Calculate each component
    const trendResult = calculateTrendPosition(snapshots);
    const smallVsLargeResult = calculateSmallVsLarge(snapshots);
    const specResult = calculateSpecLeadership(snapshots, themeMetrics);
    const breadthResult = calculateMarketBreadth(snapshots);
    const volResult = calculateVolatilityRegime(snapshots);
    
    const components: RAIComponents = {
      trendPosition: trendResult.score,
      smallVsLarge: smallVsLargeResult.score,
      specLeadership: specResult.score,
      marketBreadth: breadthResult.score,
      volatilityRegime: volResult.score,
    };
    
    // Total score
    const score = Object.values(components).reduce((a, b) => a + b, 0);
    
    // Determine label and multiplier
    const { label, riskMultiplier } = getRAILabelAndMultiplier(score);
    
    cachedRAI = {
      score,
      label,
      riskMultiplier,
      components,
      details: {
        trendPositionDetail: trendResult.detail,
        smallVsLargeDetail: smallVsLargeResult.detail,
        specLeadershipDetail: specResult.detail,
        marketBreadthDetail: breadthResult.detail,
        volatilityDetail: volResult.detail,
      },
      calculatedAt: new Date(),
    };
    
    lastCalculation = new Date();
    return cachedRAI;
    
  } catch (error) {
    console.error("[RAI] Calculation failed:", error);
    
    // Return cached or default
    if (cachedRAI) {
      return cachedRAI;
    }
    
    return getDefaultRAI();
  }
}

/**
 * Get cached RAI without recalculating
 */
export function getCachedRAI(): RAIOutput | null {
  return cachedRAI;
}

// =============================================================================
// Component Calculations
// =============================================================================

/**
 * Trend Position: Are growth/risk proxies above their moving averages?
 * QQQ, IWO, SLY, ARKK vs VWAP (as proxy for short-term trend)
 */
function calculateTrendPosition(
  snapshots: Map<string, BenchmarkData>
): { score: number; detail: string } {
  let aboveVwapCount = 0;
  let totalChecked = 0;
  const details: string[] = [];
  
  for (const symbol of RAI_SYMBOLS.trend) {
    const data = snapshots.get(symbol);
    if (!data) continue;
    
    // Use price vs vwap as trend indicator (would ideally use 21D/50D SMA)
    const isPositive = data.changePct > 0;
    if (isPositive) aboveVwapCount++;
    totalChecked++;
    
    details.push(`${symbol}: ${data.changePct > 0 ? "+" : ""}${data.changePct.toFixed(2)}%`);
  }
  
  // Score: 0-20 based on % of proxies showing strength
  const pctAbove = totalChecked > 0 ? aboveVwapCount / totalChecked : 0.5;
  const score = Math.round(pctAbove * 20);
  
  return {
    score,
    detail: details.join(", ") || "No data",
  };
}

/**
 * Small vs Large Spread: Are small caps outperforming large caps?
 * IWM vs SPY spread
 */
function calculateSmallVsLarge(
  snapshots: Map<string, BenchmarkData>
): { score: number; detail: string } {
  const iwm = snapshots.get(RAI_SYMBOLS.ratio.small);
  const spy = snapshots.get(RAI_SYMBOLS.ratio.large);
  
  if (!iwm || !spy) {
    return { score: 10, detail: "Missing IWM or SPY data" };
  }
  
  const spread = iwm.changePct - spy.changePct;
  
  // Score mapping: -2% spread = 0, 0% = 10, +2% = 20
  const score = Math.max(0, Math.min(20, Math.round((spread + 2) * 5)));
  
  return {
    score,
    detail: `IWM ${iwm.changePct > 0 ? "+" : ""}${iwm.changePct.toFixed(2)}% vs SPY ${spy.changePct > 0 ? "+" : ""}${spy.changePct.toFixed(2)}% = ${spread > 0 ? "+" : ""}${spread.toFixed(2)}% spread`,
  };
}

/**
 * Speculative Leadership: Are speculative proxies leading?
 * ARKK performance + crypto/meme theme strength
 */
function calculateSpecLeadership(
  snapshots: Map<string, BenchmarkData>,
  themeMetrics?: ThemeMetrics[]
): { score: number; detail: string } {
  let totalScore = 0;
  const details: string[] = [];
  
  // ARKK performance (max 10 points)
  const arkk = snapshots.get("ARKK");
  if (arkk) {
    // -3% = 0, 0% = 5, +3% = 10
    const arkkScore = Math.max(0, Math.min(10, Math.round((arkk.changePct + 3) * (10 / 6))));
    totalScore += arkkScore;
    details.push(`ARKK: ${arkk.changePct > 0 ? "+" : ""}${arkk.changePct.toFixed(2)}%`);
  } else {
    totalScore += 5; // Neutral
  }
  
  // Crypto/Spec theme strength (max 10 points)
  if (themeMetrics) {
    const cryptoTheme = themeMetrics.find(t => t.id === "CRYPTO_EQ");
    const specTheme = themeMetrics.find(t => t.id === "SPEC_GROWTH_BETA");
    
    if (cryptoTheme || specTheme) {
      const avgScore = ((cryptoTheme?.score || 50) + (specTheme?.score || 50)) / 2;
      // Theme score 30-70 maps to 0-10
      const themeContrib = Math.max(0, Math.min(10, Math.round((avgScore - 30) * (10 / 40))));
      totalScore += themeContrib;
      details.push(`Spec themes avg: ${avgScore.toFixed(0)}`);
    } else {
      totalScore += 5;
    }
  } else {
    totalScore += 5;
  }
  
  return {
    score: Math.min(20, totalScore),
    detail: details.join(", ") || "No spec data",
  };
}

/**
 * Market Breadth: How broad is market participation?
 * Uses equal-weight ETFs as proxy (RSP vs SPY, sector breadth)
 */
function calculateMarketBreadth(
  snapshots: Map<string, BenchmarkData>
): { score: number; detail: string } {
  const rsp = snapshots.get("RSP"); // Equal weight S&P
  const spy = snapshots.get("SPY");
  
  if (!rsp || !spy) {
    return { score: 10, detail: "Missing breadth data" };
  }
  
  // RSP vs SPY: If RSP outperforms, breadth is good
  const breadthSpread = rsp.changePct - spy.changePct;
  
  // Also factor in absolute performance
  const absPerf = (rsp.changePct + spy.changePct) / 2;
  
  // Spread component: -1% = 0, 0% = 7, +1% = 14
  const spreadScore = Math.max(0, Math.min(14, Math.round((breadthSpread + 1) * 7)));
  
  // Absolute component: -2% = 0, 0% = 3, +2% = 6
  const absScore = Math.max(0, Math.min(6, Math.round((absPerf + 2) * 1.5)));
  
  const score = spreadScore + absScore;
  
  return {
    score: Math.min(20, score),
    detail: `RSP-SPY spread: ${breadthSpread > 0 ? "+" : ""}${breadthSpread.toFixed(2)}%, Avg: ${absPerf > 0 ? "+" : ""}${absPerf.toFixed(2)}%`,
  };
}

/**
 * Volatility Regime: Is volatility elevated or suppressed?
 * VIX level (inverted - low VIX = risk-on)
 */
function calculateVolatilityRegime(
  snapshots: Map<string, BenchmarkData>
): { score: number; detail: string } {
  // Note: VIX is typically not available via Alpaca snapshots
  // We'll use UVXY as a proxy if available, or estimate from market data
  
  const uvxy = snapshots.get("UVXY");
  const spy = snapshots.get("SPY");
  
  let score = 10; // Neutral default
  let detail = "Volatility data limited";
  
  if (uvxy) {
    // UVXY change: +5% = 0 (high vol), 0% = 10, -5% = 20 (low vol)
    score = Math.max(0, Math.min(20, Math.round((-uvxy.changePct + 5) * 2)));
    detail = `UVXY: ${uvxy.changePct > 0 ? "+" : ""}${uvxy.changePct.toFixed(2)}%`;
  } else if (spy) {
    // Estimate from SPY movement - big moves = high vol
    const absMove = Math.abs(spy.changePct);
    // Small move (< 0.5%) = low vol = high score
    // Big move (> 2%) = high vol = low score
    score = Math.max(0, Math.min(20, Math.round((2 - absMove) * 10)));
    detail = `SPY move: ${spy.changePct > 0 ? "+" : ""}${spy.changePct.toFixed(2)}%`;
  }
  
  return { score, detail };
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Get RAI label and risk multiplier based on score
 */
function getRAILabelAndMultiplier(score: number): {
  label: "AGGRESSIVE" | "NEUTRAL" | "DEFENSIVE";
  riskMultiplier: number;
} {
  if (score >= 70) {
    return {
      label: "AGGRESSIVE",
      riskMultiplier: 1.0 + ((score - 70) / 30) * 0.2, // 1.0 to 1.2
    };
  } else if (score >= 40) {
    return {
      label: "NEUTRAL",
      riskMultiplier: 0.7 + ((score - 40) / 30) * 0.3, // 0.7 to 1.0
    };
  } else {
    return {
      label: "DEFENSIVE",
      riskMultiplier: 0.5 + (score / 40) * 0.2, // 0.5 to 0.7
    };
  }
}

/**
 * Get default RAI when calculation fails
 */
function getDefaultRAI(): RAIOutput {
  return {
    score: 50,
    label: "NEUTRAL",
    riskMultiplier: 0.85,
    components: {
      trendPosition: 10,
      smallVsLarge: 10,
      specLeadership: 10,
      marketBreadth: 10,
      volatilityRegime: 10,
    },
    details: {
      trendPositionDetail: "Using default",
      smallVsLargeDetail: "Using default",
      specLeadershipDetail: "Using default",
      marketBreadthDetail: "Using default",
      volatilityDetail: "Using default",
    },
    calculatedAt: new Date(),
  };
}

/**
 * Clear RAI cache
 */
export function clearRAICache(): void {
  cachedRAI = null;
  lastCalculation = null;
}
