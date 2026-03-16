import { fetchTechnicalData, type TechnicalData } from "./technicals";
import type { AskIvyOverlaySettings } from "@shared/schema";
import { getCachedRAI, type RAIOutput } from "../market-condition/engine/rai";

// Market regime context for adjusting suggestions
export interface MarketRegimeContext {
  score: number;                                    // 0-100
  label: "AGGRESSIVE" | "NEUTRAL" | "DEFENSIVE";
  riskMultiplier: number;                           // 0.5-1.2
  isChoppy: boolean;                                // score < 40
  isTrending: boolean;                              // score > 60
}

// Setup context from BigIdea for Ivy-aware suggestions
export interface SetupContext {
  setupId?: number;
  setupName?: string;
  ivyEntryStrategy?: string | null;
  ivyStopStrategy?: string | null;
  ivyTargetStrategy?: string | null;
  ivyContextNotes?: string | null;
  ivyApproved?: boolean;
  indicatorResults?: {
    maUsed?: number;
    undercutPrice?: number;
    rallyPrice?: number;
    touchPrice?: number;
    patternType?: string;
  };
}

export interface SuggestRequest {
  symbol: string;
  direction: "long" | "short";
  entryPrice: number;
  setupType?: string;
  timeframe?: string; // "daily" | "5min" | "15min" | "30min" - affects which entries are shown
  setupContext?: SetupContext;
}

export interface StopSuggestion {
  price: number;
  label: string;
  description: string;
  riskPercent: number;
  rank: number;
  type?: "fixed" | "dynamic";
  warning?: string; // Qulmaggie: warn if stop exceeds ATR/ADR cap
}

export interface EntrySuggestion {
  price: number;
  label: string;
  description: string;
  reasoning: string;
  distPercent: number;
  distDollars: number;
  rank: number;
  type?: "fixed" | "dynamic";
}

export interface TargetSuggestion {
  price: number;
  label: string;
  description: string;
  rrRatio: number;
  rank: number;
  isChartBased?: boolean; // True for swing highs, 52W, weekly, etc. vs pure R:R math
}

export interface SuggestResponse {
  symbol: string;
  currentPrice: number;
  direction: "long" | "short";
  entryPrice: number;
  entrySuggestions: EntrySuggestion[];
  stopSuggestions: StopSuggestion[];
  targetSuggestions: TargetSuggestion[];
  positionSizeSuggestion?: {
    shares: number;
    dollarRisk: number;
    percentOfAccount: number;
    riskMultiplier?: number;
  };
  technicalContext: string;
  marketRegime?: MarketRegimeContext;
  fetchedAt: Date;
}

// =============================================================================
// Market Regime Helper
// =============================================================================

async function getMarketRegimeContext(): Promise<MarketRegimeContext | null> {
  try {
    const rai = getCachedRAI();
    if (!rai) {
      return null;
    }
    return {
      score: rai.score,
      label: rai.label,
      riskMultiplier: rai.riskMultiplier,
      isChoppy: rai.score < 40,
      isTrending: rai.score > 60,
    };
  } catch (error) {
    console.error("[Suggest] Failed to get market regime:", error);
    return null;
  }
}

const DEFAULT_RULES: Pick<
  AskIvyOverlaySettings,
  | "enableMinerviniCheatEntries"
  | "enableEma620Entry"
  | "ema620AllowedTimeframe"
  | "entryBufferPct"
  | "enableOrhEntry"
  | "orhTimeframe"
  | "enableMaSurfEntry"
  | "maSurfMaxDistancePct"
  | "include21EmaStop"
  | "include50SmaStop"
  | "includeAtrStop"
  | "atrStopMultiple"
  | "stopMaOffsetDollars"
  | "stop21Label"
  | "enforceAtrStopCap"
  | "enforceAdrStopCap"
  | "alwaysInclude8RTarget"
  | "includeSwingHighTargets"
  | "swingHighTargetCount"
  | "include52wTarget"
  | "includeWeeklyTarget"
  | "include5DayTarget"
  | "include8xAdrTarget"
  | "adr8TargetBreakoutOnly"
  | "warnIfNoChartTargets"
  | "minRrThreshold"
  | "targetDisplayLimit"
  | "prioritizeChartTargets"
  | "include8xAdrOver50Target"
  | "warn200DsmaBelow"
  | "suggestPartialProfits"
  | "partialProfitDays"
  | "includeTrailMaCloseStop"
  | "trailMaClosePeriod"
  | "extendedThresholdAdr"
  | "profitTakingThresholdAdr"
  | "showExtendedWarning"
> = {
  enableMinerviniCheatEntries: true,
  enableEma620Entry: true,
  ema620AllowedTimeframe: "5min_only",
  entryBufferPct: 0.002,
  // Qulmaggie entries
  enableOrhEntry: true,
  orhTimeframe: "both",
  enableMaSurfEntry: true,
  maSurfMaxDistancePct: 2,
  // Stops
  include21EmaStop: true,
  include50SmaStop: true,
  includeAtrStop: true,
  atrStopMultiple: 1.5,
  stopMaOffsetDollars: 0.1,
  stop21Label: "21 EMA",
  enforceAtrStopCap: true,
  enforceAdrStopCap: true,
  // Targets
  alwaysInclude8RTarget: true,
  includeSwingHighTargets: true,
  swingHighTargetCount: 8,
  include52wTarget: true,
  includeWeeklyTarget: true,
  include5DayTarget: true,
  include8xAdrTarget: true,
  adr8TargetBreakoutOnly: true,
  warnIfNoChartTargets: true,
  // Target display / filtering
  minRrThreshold: 2,
  targetDisplayLimit: 8,
  prioritizeChartTargets: true,
  include8xAdrOver50Target: true,
  // Risk warnings
  warn200DsmaBelow: true,
  // Qulmaggie position management
  suggestPartialProfits: true,
  partialProfitDays: 4,
  includeTrailMaCloseStop: true,
  trailMaClosePeriod: 10,
  // Extension
  extendedThresholdAdr: 5,
  profitTakingThresholdAdr: 8,
  showExtendedWarning: true,
};

function applyRuleDefaults(settings?: Partial<AskIvyOverlaySettings>) {
  return { ...DEFAULT_RULES, ...(settings || {}) };
}

function generateEntrySuggestions(
  technicals: TechnicalData,
  currentPrice: number,
  direction: "long" | "short",
  timeframe?: string,
  rules?: Partial<AskIvyOverlaySettings>,
  marketRegime?: MarketRegimeContext | null
): EntrySuggestion[] {
  const suggestions: EntrySuggestion[] = [];
  const { baseTop, baseBottom, sma10, sma21, sma50, fiveDayHigh, yesterdayHigh, todayHigh, fiveDayLow } = technicals;
  const isIntraday = timeframe === "5min" || timeframe === "15min" || timeframe === "30min";
  const is5min = timeframe === "5min";
  const r = applyRuleDefaults(rules);
  const BUFFER_PCT = r.entryBufferPct; // default +0.2% buffer on entry prices
  
  // Market regime affects entry priority
  const isChoppy = marketRegime?.isChoppy ?? false;
  const isTrending = marketRegime?.isTrending ?? false;
  const regimeLabel = marketRegime?.label ?? "NEUTRAL";

  if (direction === "long") {
    // =============================================================================
    // REGIME-AWARE: In choppy/defensive markets, prioritize pullback entries
    // =============================================================================
    if (isChoppy && sma21 && sma21 < currentPrice && sma21 > currentPrice * 0.95) {
      const distPct = ((sma21 - currentPrice) / currentPrice) * 100;
      suggestions.push({
        price: Math.round(sma21 * 100) / 100,
        label: "⚡ Wait for PB to 21 EMA",
        description: `Market choppy (${regimeLabel}) - pullbacks work better than breakouts`,
        reasoning: "In defensive/choppy markets, breakouts fail more often. Wait for pullback to 21 EMA for lower-risk entry.",
        distPercent: Math.round(distPct * 100) / 100,
        distDollars: Math.round((sma21 - currentPrice) * 100) / 100,
        rank: 0, // Highest priority in choppy market
        type: "dynamic",
      });
    }
    
    if (isChoppy && sma50 && sma50 < currentPrice && sma50 > currentPrice * 0.92) {
      const distPct = ((sma50 - currentPrice) / currentPrice) * 100;
      suggestions.push({
        price: Math.round(sma50 * 100) / 100,
        label: "⚡ Wait for PB to 50 SMA",
        description: `Market choppy - deeper pullback entry available`,
        reasoning: "50-day MA offers stronger support in choppy conditions. More room for error.",
        distPercent: Math.round(distPct * 100) / 100,
        distDollars: Math.round((sma50 - currentPrice) * 100) / 100,
        rank: 1,
        type: "dynamic",
      });
    }
    
    // === MARK MINERVINI CHEAT ENTRIES ===
    // Reference: https://www.chartmill.com/documentation/stock-screener/technical-analysis-trading-strategies/502-Mark-Minervinis-Cheat-Entries-Getting-In-Before-the-Breakout
    // Cheat entries allow getting in BEFORE the breakout with tighter risk near moving averages
    if (r.enableMinerviniCheatEntries) {
    
      // HIGH CHEAT ENTRY: Price above both 10 and 20-day MA, within consolidation but below breakout
      // "Mini breakout inside consolidation, micro base above moving averages"
      if (baseTop && baseBottom && sma10 && sma21 && 
          currentPrice > sma10 && currentPrice > sma21 && 
          currentPrice < baseTop && currentPrice > baseBottom) {
        // Entry is just above the higher of the two MAs (provides tight stop)
        const highCheatEntry = Math.max(sma10, sma21) * (1 + BUFFER_PCT);
        if (highCheatEntry < baseTop && highCheatEntry > currentPrice * 0.97) {
          const distPct = ((highCheatEntry - currentPrice) / currentPrice) * 100;
          const distDollars = highCheatEntry - currentPrice;
          suggestions.push({
            price: Math.round(highCheatEntry * 100) / 100,
            label: "Minervini High Cheat",
            description: `Above 10/21 MA at $${Math.max(sma10, sma21).toFixed(2)}`,
            reasoning: "Early entry before breakout. Price above MAs in tight consolidation. Stop below MA.",
            distPercent: Math.round(distPct * 100) / 100,
            distDollars: Math.round(distDollars * 100) / 100,
            rank: 1,
            type: "dynamic",
          });
        }
      }
    
      // MID CHEAT ENTRY: Price near converging 10/20-day SMAs, in middle of base
      // "In middle of consolidation, above short-term trendline near converging 10/20-day SMAs"
      if (baseTop && baseBottom && sma10 && sma21) {
        const baseMid = (baseTop + baseBottom) / 2;
        const maConvergence = Math.abs(sma10 - sma21) / sma21; // How close are the MAs?
        const maAvg = (sma10 + sma21) / 2;
        
        // Check if MAs are converging (within 2% of each other) and price is near mid-base
        if (maConvergence < 0.02 && 
            currentPrice > baseBottom && currentPrice < baseTop &&
            Math.abs(currentPrice - baseMid) / baseMid < 0.05) {
          const midCheatEntry = maAvg * (1 + BUFFER_PCT);
          if (midCheatEntry > currentPrice * 0.97 && midCheatEntry < baseTop) {
            const distPct = ((midCheatEntry - currentPrice) / currentPrice) * 100;
            const distDollars = midCheatEntry - currentPrice;
            suggestions.push({
              price: Math.round(midCheatEntry * 100) / 100,
              label: "Minervini Mid Cheat",
              description: `Converging MAs at $${maAvg.toFixed(2)}`,
              reasoning: "Mid-base entry with converging 10/21 MA. Tight stop potential.",
              distPercent: Math.round(distPct * 100) / 100,
              distDollars: Math.round(distDollars * 100) / 100,
              rank: 2,
              type: "dynamic",
            });
          }
        }
      }
    
      // LOW CHEAT ENTRY: Near bottom of base, coiling under/near 50-day SMA
      // "Near bottom of base, coiling under 50-day SMA - allows low-risk entry ahead of breakout"
      if (baseTop && baseBottom && sma50 && 
          currentPrice > baseBottom * 0.98 && currentPrice < baseBottom * 1.03 &&
          currentPrice < sma50 * 1.02) {
        const lowCheatEntry = baseBottom * (1 + BUFFER_PCT);
        const distPct = ((lowCheatEntry - currentPrice) / currentPrice) * 100;
        const distDollars = lowCheatEntry - currentPrice;
        suggestions.push({
          price: Math.round(lowCheatEntry * 100) / 100,
          label: "Minervini Low Cheat",
          description: `Base bottom coil at $${baseBottom.toFixed(2)}`,
          reasoning: "Low-risk early entry near base support. Coiling under 50 MA. Tight stop below base.",
          distPercent: Math.round(distPct * 100) / 100,
          distDollars: Math.round(distDollars * 100) / 100,
          rank: 3,
          type: "fixed",
        });
      }
    }

    // === STANDARD BREAKOUT ENTRIES ===
    // Adjust rank based on market regime - breakouts rank lower in choppy markets
    const breakoutRankPenalty = isChoppy ? 10 : 0; // Push breakouts down in rankings when choppy
    const breakoutRankBoost = isTrending ? -2 : 0; // Boost breakouts in trending markets
    
    // Break of base high (all timeframes)
    if (baseTop && baseTop > currentPrice) {
      const entryWithBuffer = baseTop * (1 + BUFFER_PCT);
      const distPct = ((entryWithBuffer - currentPrice) / currentPrice) * 100;
      const distDollars = entryWithBuffer - currentPrice;
      const regimeNote = isChoppy ? " ⚠️ Choppy market - consider pullback entry instead" : 
                         isTrending ? " ✓ Trending market favors breakouts" : "";
      suggestions.push({
        price: Math.round(entryWithBuffer * 100) / 100,
        label: isChoppy ? "Break of base high ⚠️" : "Break of base high",
        description: `Base resistance at $${baseTop.toFixed(2)} (+0.2%)${regimeNote}`,
        reasoning: isChoppy ? "Clean breakout level, but breakouts fail more often in choppy markets. Consider waiting for pullback." :
                   "Clean breakout level. 2+ touches typical.",
        distPercent: Math.round(distPct * 100) / 100,
        distDollars: Math.round(distDollars * 100) / 100,
        rank: 4 + breakoutRankPenalty + breakoutRankBoost,
        type: "fixed",
      });
    }

    // Break of prior day high - only show if yesterday's high > today's high (daily timeframe logic)
    if (yesterdayHigh && todayHigh && yesterdayHigh > todayHigh && yesterdayHigh > currentPrice) {
      const entryWithBuffer = yesterdayHigh * (1 + BUFFER_PCT);
      const distPct = ((entryWithBuffer - currentPrice) / currentPrice) * 100;
      const distDollars = entryWithBuffer - currentPrice;
      suggestions.push({
        price: Math.round(entryWithBuffer * 100) / 100,
        label: isChoppy ? "Break of prior day high ⚠️" : "Break of prior day high",
        description: `Yesterday's high $${yesterdayHigh.toFixed(2)} (+0.2%)`,
        reasoning: isChoppy ? "Prior day resistance. Breakout risk elevated in choppy market." :
                   "Prior day resistance. Enter on break with volume.",
        distPercent: Math.round(distPct * 100) / 100,
        distDollars: Math.round(distDollars * 100) / 100,
        rank: 5 + breakoutRankPenalty + breakoutRankBoost,
        type: "fixed",
      });
    }

    // Break of current day high (all timeframes)
    if (todayHigh && todayHigh > currentPrice) {
      const entryWithBuffer = todayHigh * (1 + BUFFER_PCT);
      const distPct = ((entryWithBuffer - currentPrice) / currentPrice) * 100;
      const distDollars = entryWithBuffer - currentPrice;
      suggestions.push({
        price: Math.round(entryWithBuffer * 100) / 100,
        label: isChoppy ? "Break of day high ⚠️" : "Break of day high",
        description: `Today's high $${todayHigh.toFixed(2)} (+0.2%)`,
        reasoning: isChoppy ? "Session high break. Higher failure rate in choppy conditions." :
                   "Break of current session high. Confirm with volume.",
        distPercent: Math.round(distPct * 100) / 100,
        distDollars: Math.round(distDollars * 100) / 100,
        rank: 6 + breakoutRankPenalty + breakoutRankBoost,
        type: "fixed",
      });
    }

    // 5-day high breakout (all timeframes)
    if (fiveDayHigh && fiveDayHigh > currentPrice) {
      const entryWithBuffer = fiveDayHigh * (1 + BUFFER_PCT);
      const distPct = ((entryWithBuffer - currentPrice) / currentPrice) * 100;
      const distDollars = entryWithBuffer - currentPrice;
      suggestions.push({
        price: Math.round(entryWithBuffer * 100) / 100,
        label: isChoppy ? "5-day high breakout ⚠️" : "5-day high breakout",
        description: `5-day high $${fiveDayHigh.toFixed(2)} (+0.2%)`,
        reasoning: isChoppy ? "Short-term resistance. Breakouts struggle in choppy markets." :
                   "Short-term resistance. Breakout level.",
        distPercent: Math.round(distPct * 100) / 100,
        distDollars: Math.round(distDollars * 100) / 100,
        rank: 7 + breakoutRankPenalty + breakoutRankBoost,
        type: "fixed",
      });
    }

    // Most-touched base support level (all timeframes) - for pullback entries
    // In choppy markets, pullback entries get priority
    if (baseBottom && baseBottom < currentPrice && baseBottom > currentPrice * 0.95) {
      const distPct = ((baseBottom - currentPrice) / currentPrice) * 100;
      const distDollars = baseBottom - currentPrice;
      const pullbackBoost = isChoppy ? -5 : 0; // Boost pullback rank in choppy markets
      suggestions.push({
        price: Math.round(baseBottom * 100) / 100,
        label: isChoppy ? "⚡ Base support pullback" : "Base support pullback",
        description: `Support zone at $${baseBottom.toFixed(2)}${isChoppy ? " - preferred in choppy market" : ""}`,
        reasoning: isChoppy ? "Buy support at base bottom. Pullbacks outperform breakouts in choppy conditions." :
                   "Level with most price tests. Buy support.",
        distPercent: Math.round(distPct * 100) / 100,
        distDollars: Math.round(distDollars * 100) / 100,
        rank: 8 + pullbackBoost,
        type: "fixed",
      });
    }

    // 6/20 EMA entry (admin configurable)
    const allowEma620 = r.enableEma620Entry && ((r.ema620AllowedTimeframe === "all_intraday" && isIntraday) || (r.ema620AllowedTimeframe === "5min_only" && is5min));
    if (allowEma620 && sma10 && sma21) {
      // 6 EMA cross above 20 EMA zone (approximating with sma10/sma21)
      const emaZone = (sma10 + sma21) / 2;
      if (emaZone < currentPrice * 1.02 && emaZone > currentPrice * 0.98) {
        const distPct = ((emaZone - currentPrice) / currentPrice) * 100;
        const distDollars = emaZone - currentPrice;
        suggestions.push({
          price: Math.round(emaZone * 100) / 100,
          label: "6/20 EMA zone",
          description: `Intraday EMA pullback entry`,
          reasoning: "5min tactic: Buy on 6 EMA crossing back above 20.",
          distPercent: Math.round(distPct * 100) / 100,
          distDollars: Math.round(distDollars * 100) / 100,
          rank: 9,
          type: "dynamic",
        });
      }
    }

    // === QULMAGGIE ENTRY TACTICS ===

    // Opening Range High (ORH) - Qulmaggie breakout entry
    // Uses today's high as proxy for opening range high (actual ORH would need intraday data)
    if (r.enableOrhEntry && todayHigh && todayHigh > currentPrice) {
      const show5min = r.orhTimeframe === "5min" || r.orhTimeframe === "both";
      const show60min = r.orhTimeframe === "60min" || r.orhTimeframe === "both";

      if (show5min) {
        const orhEntry = todayHigh * (1 + BUFFER_PCT);
        const distPct = ((orhEntry - currentPrice) / currentPrice) * 100;
        const distDollars = orhEntry - currentPrice;
        suggestions.push({
          price: Math.round(orhEntry * 100) / 100,
          label: "ORH (5-min)",
          description: `Opening range high $${todayHigh.toFixed(2)} (+buffer)`,
          reasoning: "Qulmaggie: Buy above 5-min opening range high. Confirms intraday strength.",
          distPercent: Math.round(distPct * 100) / 100,
          distDollars: Math.round(distDollars * 100) / 100,
          rank: 10,
          type: "fixed",
        });
      }

      if (show60min) {
        // 60-min ORH typically slightly higher than 5-min; use today's high + small buffer
        const orh60Entry = todayHigh * (1 + BUFFER_PCT * 1.5);
        const distPct = ((orh60Entry - currentPrice) / currentPrice) * 100;
        const distDollars = orh60Entry - currentPrice;
        suggestions.push({
          price: Math.round(orh60Entry * 100) / 100,
          label: "ORH (60-min)",
          description: `First hour high ~$${(todayHigh * 1.001).toFixed(2)}`,
          reasoning: "Qulmaggie: Buy above 60-min opening range. More confirmation, slightly higher entry.",
          distPercent: Math.round(distPct * 100) / 100,
          distDollars: Math.round(distDollars * 100) / 100,
          rank: 11,
          type: "fixed",
        });
      }
    }

    // MA Surf Zone Entry - Qulmaggie "surfing the MAs" consolidation entry
    if (r.enableMaSurfEntry && sma10 && sma21) {
      const maxDist = r.maSurfMaxDistancePct / 100; // e.g., 2% = 0.02
      const higherMa = Math.max(sma10, sma21);
      const lowerMa = Math.min(sma10, sma21);
      
      // Check if price is "surfing" - above MAs but within tolerance
      const distFromHigherMa = (currentPrice - higherMa) / higherMa;
      const isSurfing = distFromHigherMa >= 0 && distFromHigherMa <= maxDist;
      
      // Also check if MAs are rising (bullish)
      const maSpread = (sma10 - sma21) / sma21;
      const masRising = sma10 > sma21; // 10 MA above 21 MA = bullish
      
      if (isSurfing && masRising) {
        // Entry at the higher MA as support
        const surfEntry = higherMa * (1 + BUFFER_PCT * 0.5); // Small buffer above MA
        const distPct = ((surfEntry - currentPrice) / currentPrice) * 100;
        const distDollars = surfEntry - currentPrice;
        suggestions.push({
          price: Math.round(surfEntry * 100) / 100,
          label: "MA Surf Zone",
          description: `Price surfing 10/20 MA ($${higherMa.toFixed(2)})`,
          reasoning: "Qulmaggie: Buy pullback to rising MAs during consolidation. Tight stop below MA.",
          distPercent: Math.round(distPct * 100) / 100,
          distDollars: Math.round(distDollars * 100) / 100,
          rank: 12,
          type: "dynamic",
        });
      }
    }
  }

  return suggestions
    .filter(s => Math.abs(s.distPercent) < 15)
    .sort((a, b) => Math.abs(a.distPercent) - Math.abs(b.distPercent))
    .map((s, i) => ({ ...s, rank: i + 1 }));
}

function generateStopSuggestions(
  technicals: TechnicalData,
  entryPrice: number,
  direction: "long" | "short",
  rules?: Partial<AskIvyOverlaySettings>
): StopSuggestion[] {
  const suggestions: StopSuggestion[] = [];
  const r = applyRuleDefaults(rules);
  const { currentPrice, todayLow, yesterdayLow, weeklyLow, fiveDayLow, sma10, sma21, sma50, sma200, atr14 } = technicals;

  if (direction === "long") {
    if (todayLow && todayLow < entryPrice) {
      const riskPercent = ((entryPrice - todayLow) / entryPrice) * 100;
      suggestions.push({
        price: Math.round((todayLow - 0.01) * 100) / 100,
        label: "LOD",
        description: "Below today's low - tight stop",
        riskPercent: Math.round(riskPercent * 100) / 100,
        rank: 1,
      });
    }

    if (yesterdayLow && yesterdayLow < entryPrice) {
      const riskPercent = ((entryPrice - yesterdayLow) / entryPrice) * 100;
      suggestions.push({
        price: Math.round((yesterdayLow - 0.01) * 100) / 100,
        label: "PDL",
        description: "Below previous day low",
        riskPercent: Math.round(riskPercent * 100) / 100,
        rank: 2,
      });
    }

    if (sma10 && sma10 < entryPrice) {
      const riskPercent = ((entryPrice - sma10) / entryPrice) * 100;
      suggestions.push({
        price: Math.round((sma10 - r.stopMaOffsetDollars) * 100) / 100,
        label: "10 SMA",
        description: "Below 10-day moving average",
        riskPercent: Math.round(riskPercent * 100) / 100,
        rank: 3,
      });
    }

    if (r.include21EmaStop && sma21 && sma21 < entryPrice) {
      const riskPercent = ((entryPrice - sma21) / entryPrice) * 100;
      suggestions.push({
        price: Math.round((sma21 - r.stopMaOffsetDollars) * 100) / 100,
        label: r.stop21Label || "21 EMA",
        description: "Below 21-day EMA. Dynamic — level moves intraday.",
        riskPercent: Math.round(riskPercent * 100) / 100,
        rank: 4,
        type: "dynamic",
      });
    }

    if (r.include50SmaStop && sma50 && sma50 < entryPrice && sma50 > entryPrice * 0.9) {
      const riskPercent = ((entryPrice - sma50) / entryPrice) * 100;
      suggestions.push({
        price: Math.round((sma50 - r.stopMaOffsetDollars) * 100) / 100,
        label: "50 SMA",
        description: "Below 50-day moving average - wider stop",
        riskPercent: Math.round(riskPercent * 100) / 100,
        rank: 5,
      });
    }

    if (weeklyLow && weeklyLow < entryPrice && weeklyLow > entryPrice * 0.92) {
      const riskPercent = ((entryPrice - weeklyLow) / entryPrice) * 100;
      suggestions.push({
        price: Math.round((weeklyLow - 0.01) * 100) / 100,
        label: "Week Low",
        description: "Below this week's low",
        riskPercent: Math.round(riskPercent * 100) / 100,
        rank: 6,
      });
    }

    if (r.includeAtrStop && atr14) {
      const atrStop = entryPrice - (atr14 * r.atrStopMultiple);
      const riskPercent = ((entryPrice - atrStop) / entryPrice) * 100;
      suggestions.push({
        price: Math.round(atrStop * 100) / 100,
        label: `${r.atrStopMultiple}× ATR`,
        description: `${r.atrStopMultiple}× Average True Range below entry`,
        riskPercent: Math.round(riskPercent * 100) / 100,
        rank: 7,
      });
    }

    // === QULMAGGIE TRAILING STOP ON MA CLOSE ===
    // Trail remainder of position with 10 or 20-day MA close (not intraday breach)
    if (r.includeTrailMaCloseStop) {
      const trailMa = r.trailMaClosePeriod === 10 ? sma10 : sma21;
      if (trailMa && trailMa < entryPrice) {
        const riskPercent = ((entryPrice - trailMa) / entryPrice) * 100;
        suggestions.push({
          price: Math.round(trailMa * 100) / 100,
          label: `Trail ${r.trailMaClosePeriod} MA Close`,
          description: `Qulmaggie: Exit on first CLOSE below ${r.trailMaClosePeriod}-day MA. Use for trailing after partial.`,
          riskPercent: Math.round(riskPercent * 100) / 100,
          rank: 8,
          type: "dynamic",
        });
      }
    }
  } else {
    if (technicals.todayHigh && technicals.todayHigh > entryPrice) {
      const riskPercent = ((technicals.todayHigh - entryPrice) / entryPrice) * 100;
      suggestions.push({
        price: Math.round((technicals.todayHigh + 0.01) * 100) / 100,
        label: "HOD",
        description: "Above today's high - tight stop",
        riskPercent: Math.round(riskPercent * 100) / 100,
        rank: 1,
      });
    }

    if (technicals.yesterdayHigh && technicals.yesterdayHigh > entryPrice) {
      const riskPercent = ((technicals.yesterdayHigh - entryPrice) / entryPrice) * 100;
      suggestions.push({
        price: Math.round((technicals.yesterdayHigh + 0.01) * 100) / 100,
        label: "PDH",
        description: "Above previous day high",
        riskPercent: Math.round(riskPercent * 100) / 100,
        rank: 2,
      });
    }

    if (sma10 && sma10 > entryPrice) {
      const riskPercent = ((sma10 - entryPrice) / entryPrice) * 100;
      suggestions.push({
        price: Math.round((sma10 + r.stopMaOffsetDollars) * 100) / 100,
        label: "10 SMA",
        description: "Above 10-day moving average",
        riskPercent: Math.round(riskPercent * 100) / 100,
        rank: 3,
      });
    }

    if (r.include21EmaStop && sma21 && sma21 > entryPrice) {
      const riskPercent = ((sma21 - entryPrice) / entryPrice) * 100;
      suggestions.push({
        price: Math.round((sma21 + r.stopMaOffsetDollars) * 100) / 100,
        label: r.stop21Label || "21 EMA",
        description: "Above 21-day exponential MA",
        riskPercent: Math.round(riskPercent * 100) / 100,
        rank: 4,
      });
    }

    if (r.includeAtrStop && atr14) {
      const atrStop = entryPrice + (atr14 * r.atrStopMultiple);
      const riskPercent = ((atrStop - entryPrice) / entryPrice) * 100;
      suggestions.push({
        price: Math.round(atrStop * 100) / 100,
        label: `${r.atrStopMultiple}× ATR`,
        description: `${r.atrStopMultiple}× Average True Range above entry`,
        riskPercent: Math.round(riskPercent * 100) / 100,
        rank: 5,
      });
    }

    // === QULMAGGIE TRAILING STOP ON MA CLOSE (shorts) ===
    if (r.includeTrailMaCloseStop) {
      const trailMa = r.trailMaClosePeriod === 10 ? sma10 : sma21;
      if (trailMa && trailMa > entryPrice) {
        const riskPercent = ((trailMa - entryPrice) / entryPrice) * 100;
        suggestions.push({
          price: Math.round(trailMa * 100) / 100,
          label: `Trail ${r.trailMaClosePeriod} MA Close`,
          description: `Qulmaggie: Exit on first CLOSE above ${r.trailMaClosePeriod}-day MA. Use for trailing after partial.`,
          riskPercent: Math.round(riskPercent * 100) / 100,
          rank: 6,
          type: "dynamic",
        });
      }
    }
  }

  // === QULMAGGIE STOP CAP WARNINGS ===
  // Warn if stop exceeds 1× ATR or 1× ADR% (Qulmaggie rule: never risk more than the stock's typical daily range)
  const atr = technicals.atr14 || 0;
  const adr = technicals.adr20 || 0;
  const adrPct = adr > 0 && currentPrice > 0 ? (adr / currentPrice) * 100 : 0;

  return suggestions
    .filter(s => s.riskPercent > 0 && s.riskPercent < 15)
    .sort((a, b) => a.riskPercent - b.riskPercent)
    .map((s, i) => {
      const stopDist = Math.abs(entryPrice - s.price);
      let warning: string | undefined;

      // Check ATR cap
      if (r.enforceAtrStopCap && atr > 0 && stopDist > atr) {
        const exceedsPct = ((stopDist / atr - 1) * 100).toFixed(0);
        warning = `⚠️ Stop exceeds 1× ATR ($${atr.toFixed(2)}) by ${exceedsPct}%. Consider passing or tighter entry.`;
      }
      // Check ADR% cap (only if ATR didn't already warn)
      else if (r.enforceAdrStopCap && adrPct > 0 && s.riskPercent > adrPct) {
        const exceedsPct = ((s.riskPercent / adrPct - 1) * 100).toFixed(0);
        warning = `⚠️ Stop exceeds 1× ADR (${adrPct.toFixed(1)}%) by ${exceedsPct}%. Risk/reward may be unfavorable.`;
      }

      return { ...s, rank: i + 1, warning };
    });
}

function generateTargetSuggestions(
  technicals: TechnicalData,
  entryPrice: number,
  stopPrice: number | null,
  direction: "long" | "short",
  setupType?: string,
  rules?: Partial<AskIvyOverlaySettings>
): TargetSuggestion[] {
  const suggestions: TargetSuggestion[] = [];
  const r = applyRuleDefaults(rules);
  const riskPerShare = stopPrice ? Math.abs(entryPrice - stopPrice) : technicals.atr14 || entryPrice * 0.02;

  if (direction === "long") {
    // Standard R:R based targets - filter by minRrThreshold
    const minRr = r.minRrThreshold || 2;
    [2, 3, 4, 5].filter(rr => rr >= minRr).forEach((rrRatio, index) => {
      const target = entryPrice + (riskPerShare * rrRatio);
      suggestions.push({
        price: Math.round(target * 100) / 100,
        label: `${rrRatio}:1 R:R`,
        description: `${rrRatio}× your risk for reward`,
        rrRatio,
        rank: index + 1,
        isChartBased: false,
      });
    });

    // Always include 8R target if enabled (math target, may not align with resistance)
    if (r.alwaysInclude8RTarget) {
      const target = entryPrice + (riskPerShare * 8);
      suggestions.push({
        price: Math.round(target * 100) / 100,
        label: "8R",
        description: "8× your risk per share (math target)",
        rrRatio: 8,
        rank: 999,
        isChartBased: false,
      });
    }

    // 8x ADR target for new breakouts
    const isBreakout = setupType?.includes('breakout') || setupType === 'vcp' || setupType === 'cup_and_handle';
    const allow8xAdr = r.include8xAdrTarget && (!r.adr8TargetBreakoutOnly || isBreakout);
    if (allow8xAdr && technicals.adr20) {
      const adr8Target = entryPrice + (technicals.adr20 * 8);
      const rrRatio = (adr8Target - entryPrice) / riskPerShare;
      if (rrRatio >= 1) {
        suggestions.push({
          price: Math.round(adr8Target * 100) / 100,
          label: "8x ADR",
          description: "8× average daily range target for new breakout",
          rrRatio: Math.round(rrRatio * 10) / 10,
          rank: 8,
          isChartBased: true,
        });
      }
    }

    // 8x ADR above 50 SMA profit-taking zone (user's sell rule)
    if (r.include8xAdrOver50Target && technicals.adr20 && technicals.sma50) {
      const adr8Over50 = technicals.sma50 + (technicals.adr20 * 8);
      if (adr8Over50 > entryPrice) {
        const rrRatio = (adr8Over50 - entryPrice) / riskPerShare;
        if (rrRatio >= 1) {
          suggestions.push({
            price: Math.round(adr8Over50 * 100) / 100,
            label: "8x ADR > 50",
            description: "Profit-taking zone: 8× ADR above 50-day SMA (sell rule)",
            rrRatio: Math.round(rrRatio * 10) / 10,
            rank: 9,
            isChartBased: true,
          });
        }
      }
    }

    // Previous significant swing highs
    if (r.includeSwingHighTargets && technicals.swingHighs?.length) {
      const wanted = Math.max(0, r.swingHighTargetCount);
      let added = 0;
      let idx = 0;
      for (const swingHigh of technicals.swingHighs.filter(sh => sh.price > entryPrice)) {
        if (added >= wanted) break;
        const rrRatio = (swingHigh.price - entryPrice) / riskPerShare;
        if (rrRatio < 1) {
          idx++;
          continue;
        }
        const monthsAgo = Math.max(0, Math.round(swingHigh.daysAgo / 21));
        const lastTouchedMonths = Math.max(0, Math.round((swingHigh as any).lastTouchedDaysAgo / 21));
        suggestions.push({
          price: Math.round(swingHigh.price * 100) / 100,
          label: `Swing High (${(swingHigh as any).date || `${swingHigh.daysAgo}d`})`,
          description: `Printed ${(swingHigh as any).date || `${swingHigh.daysAgo}d ago`} (~${monthsAgo}mo). Last touched ~${lastTouchedMonths}mo ago.`,
          rrRatio: Math.round(rrRatio * 10) / 10,
          rank: 12 + idx,
          isChartBased: true,
        });
        added++;
        idx++;
      }
    }

    // 52-week high
    if (r.include52wTarget && technicals.high52Week && technicals.high52Week > entryPrice) {
      const rrRatio = (technicals.high52Week - entryPrice) / riskPerShare;
      if (rrRatio >= 1) {
        suggestions.push({
          price: Math.round(technicals.high52Week * 100) / 100,
          label: "52W High",
          description: "52-week high resistance",
          rrRatio: Math.round(rrRatio * 10) / 10,
          rank: 15,
          isChartBased: true,
        });
      }
    }

    if (r.include5DayTarget && technicals.fiveDayHigh && technicals.fiveDayHigh > entryPrice) {
      const rrRatio = (technicals.fiveDayHigh - entryPrice) / riskPerShare;
      if (rrRatio >= 1) {
        suggestions.push({
          price: Math.round(technicals.fiveDayHigh * 100) / 100,
          label: "5-Day High",
          description: "Resistance at 5-day high",
          rrRatio: Math.round(rrRatio * 10) / 10,
          rank: 10,
          isChartBased: true,
        });
      }
    }

    if (r.includeWeeklyTarget && technicals.weeklyHigh && technicals.weeklyHigh > entryPrice) {
      const rrRatio = (technicals.weeklyHigh - entryPrice) / riskPerShare;
      if (rrRatio >= 1) {
        suggestions.push({
          price: Math.round(technicals.weeklyHigh * 100) / 100,
          label: "Week High",
          description: "Resistance at weekly high",
          rrRatio: Math.round(rrRatio * 10) / 10,
          rank: 11,
          isChartBased: true,
        });
      }
    }
  } else {
    // Short direction targets - filter by minRrThreshold
    const minRr = r.minRrThreshold || 2;
    [2, 3, 4, 5].filter(rr => rr >= minRr).forEach((rrRatio, index) => {
      const target = entryPrice - (riskPerShare * rrRatio);
      if (target > 0) {
        suggestions.push({
          price: Math.round(target * 100) / 100,
          label: `${rrRatio}:1 R:R`,
          description: `${rrRatio}× your risk for reward`,
          rrRatio,
          rank: index + 1,
          isChartBased: false,
        });
      }
    });

    if (r.alwaysInclude8RTarget) {
      const target = entryPrice - (riskPerShare * 8);
      if (target > 0) {
        suggestions.push({
          price: Math.round(target * 100) / 100,
          label: "8R",
          description: "8× your risk per share (math target)",
          rrRatio: 8,
          rank: 999,
          isChartBased: false,
        });
      }
    }

    // 8x ADR target for shorts
    if (r.include8xAdrTarget && technicals.adr20) {
      const adr8Target = entryPrice - (technicals.adr20 * 8);
      if (adr8Target > 0) {
        const rrRatio = (entryPrice - adr8Target) / riskPerShare;
        if (rrRatio >= 1) {
          suggestions.push({
            price: Math.round(adr8Target * 100) / 100,
            label: "8x ADR",
            description: "8× average daily range target",
            rrRatio: Math.round(rrRatio * 10) / 10,
            rank: 8,
            isChartBased: true,
          });
        }
      }
    }

    // 52-week low for shorts
    if (r.include52wTarget && technicals.low52Week && technicals.low52Week < entryPrice) {
      const rrRatio = (entryPrice - technicals.low52Week) / riskPerShare;
      if (rrRatio >= 1) {
        suggestions.push({
          price: Math.round(technicals.low52Week * 100) / 100,
          label: "52W Low",
          description: "52-week low support",
          rrRatio: Math.round(rrRatio * 10) / 10,
          rank: 15,
          isChartBased: true,
        });
      }
    }

    if (r.include5DayTarget && technicals.fiveDayLow && technicals.fiveDayLow < entryPrice) {
      const rrRatio = (entryPrice - technicals.fiveDayLow) / riskPerShare;
      if (rrRatio >= 1) {
        suggestions.push({
          price: Math.round(technicals.fiveDayLow * 100) / 100,
          label: "5-Day Low",
          description: "Support at 5-day low",
          rrRatio: Math.round(rrRatio * 10) / 10,
          rank: 10,
          isChartBased: true,
        });
      }
    }
  }

  // De-duplicate by price (within $0.01)
  const seen = new Set<string>();
  const deduped = suggestions.filter(s => {
    const key = s.price.toFixed(2);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort: prioritize chart-based targets if enabled, then by R:R
  let sorted: TargetSuggestion[];
  if (r.prioritizeChartTargets) {
    // Chart-based first (sorted by R:R), then math targets (sorted by R:R)
    const chartBased = deduped.filter(s => s.isChartBased).sort((a, b) => a.rrRatio - b.rrRatio);
    const mathBased = deduped.filter(s => !s.isChartBased).sort((a, b) => a.rrRatio - b.rrRatio);
    sorted = [...chartBased, ...mathBased];
  } else {
    sorted = deduped.sort((a, b) => a.rrRatio - b.rrRatio);
  }

  // Warn if no chart-based targets exist
  const hasChartTargets = sorted.some(s => s.isChartBased);
  if (r.warnIfNoChartTargets && !hasChartTargets && sorted.length > 0) {
    // Add a warning target at the top
    sorted.unshift({
      price: 0,
      label: "⚠️ No Chart Targets",
      description: "No swing highs, 52W, or weekly targets found. Consider using R:R math targets with caution.",
      rrRatio: 0,
      rank: 0,
      isChartBased: false,
    });
  }

  return sorted.map((s, i) => ({ ...s, rank: i + 1 }));
}

function buildTechnicalContext(technicals: TechnicalData, direction: "long" | "short", rules?: Partial<AskIvyOverlaySettings>): string {
  const { currentPrice, sma10, sma21, sma50, sma200, atr14, adr20, distanceFromSma21, extensionFrom50dAdr, baseTop, baseBottom } = technicals;
  const r = applyRuleDefaults(rules);
  
  const parts: string[] = [];
  
  parts.push(`Current price: $${currentPrice.toFixed(2)}`);
  
  // Detect Minervini Cheat Entry setup
  if (direction === "long" && baseTop && baseBottom && sma10 && sma21) {
    const inBase = currentPrice > baseBottom && currentPrice < baseTop;
    const aboveMAs = currentPrice > sma10 && currentPrice > sma21;
    const maConverging = Math.abs(sma10 - sma21) / sma21 < 0.02;
    
    if (inBase && aboveMAs) {
      parts.push("[MINERVINI HIGH CHEAT SETUP - Price above MAs in consolidation]");
    } else if (inBase && maConverging) {
      parts.push("[MINERVINI MID CHEAT SETUP - Converging MAs in consolidation]");
    } else if (sma50 && currentPrice > baseBottom * 0.98 && currentPrice < baseBottom * 1.03 && currentPrice < sma50 * 1.02) {
      parts.push("[MINERVINI LOW CHEAT SETUP - Coiling near base bottom under 50 MA]");
    }
  }

  // === 200 DSMA WARNING ===
  // Warn on longs trading below the 200-day SMA (increased risk)
  if (r.warn200DsmaBelow && direction === "long" && sma200) {
    if (currentPrice < sma200) {
      const distBelow = ((sma200 - currentPrice) / sma200 * 100).toFixed(1);
      // Check if we're near the 200 (potential breakout/breakthrough)
      const nearMa = currentPrice > sma200 * 0.97; // Within 3% below
      if (nearMa) {
        parts.push(`[⚠️ 200 DSMA RISK: Price ${distBelow}% below 200 SMA ($${sma200.toFixed(2)}). A breakthrough could signal opportunity, but watch for pullback & bounce confirmation.]`);
      } else {
        parts.push(`[⚠️ 200 DSMA WARNING: Trading ${distBelow}% below 200 SMA ($${sma200.toFixed(2)}). Higher risk - long setups below 200 DSMA have lower odds.]`);
      }
    }
  }

  // Detect Qullaggie "Surfing MAs" breakout setup
  if (direction === "long" && sma10 && sma21) {
    const masRising = sma10 > sma21; // 10 MA above 21 = bullish trend
    const distFromMa10 = sma10 > 0 ? (currentPrice - sma10) / sma10 : 0;
    const isSurfing = distFromMa10 >= 0 && distFromMa10 <= 0.03; // Within 3% above MA
    
    if (masRising && isSurfing) {
      parts.push("[QULLAGGIE MA SURF - Price surfing rising 10/20 MAs. Ideal for ORH breakout entry.]");
    } else if (masRising && baseTop && baseBottom) {
      const inBase = currentPrice > baseBottom && currentPrice < baseTop;
      if (inBase) {
        parts.push("[QULLAGGIE CONSOLIDATION - Orderly base above rising MAs. Watch for breakout above base top.]");
      }
    }
  }
  
  if (sma21) {
    const position = currentPrice > sma21 ? "above" : "below";
    parts.push(`${distanceFromSma21?.toFixed(1) || "?"}% ${position} 21 SMA ($${sma21.toFixed(2)})`);
  }
  
  if (sma50) {
    const position = currentPrice > sma50 ? "above" : "below";
    if (extensionFrom50dAdr !== null && adr20 > 0) {
      const absExt = Math.abs(extensionFrom50dAdr).toFixed(1);
      let zone = '';
      if (r.showExtendedWarning) {
        if (extensionFrom50dAdr >= r.profitTakingThresholdAdr) zone = ' [PROFIT-TAKING ZONE]';
        else if (extensionFrom50dAdr >= r.extendedThresholdAdr) zone = ' [CAUTION]';
      }
      parts.push(`${absExt}x ADR ${position} 50 SMA ($${sma50.toFixed(2)})${zone}`);
    } else {
      const distPct = ((currentPrice - sma50) / sma50 * 100).toFixed(1);
      parts.push(`${distPct}% ${position} 50 SMA ($${sma50.toFixed(2)})`);
    }
  }
  
  if (sma200) {
    parts.push(`200 SMA at $${sma200.toFixed(2)}`);
  }
  
  if (adr20 > 0) {
    parts.push(`ADR(20): $${adr20.toFixed(2)}`);
  }
  
  if (atr14) {
    parts.push(`ATR(14): $${atr14.toFixed(2)}`);
  }
  
  // Add base structure info
  if (baseTop && baseBottom) {
    const baseRange = ((baseTop - baseBottom) / baseBottom * 100).toFixed(1);
    parts.push(`Base: $${baseBottom.toFixed(2)} - $${baseTop.toFixed(2)} (${baseRange}% range)`);
  }

  // === QULMAGGIE POSITION MANAGEMENT NOTES ===
  if (r.suggestPartialProfits || r.includeTrailMaCloseStop) {
    const mgmtParts: string[] = [];
    
    if (r.suggestPartialProfits) {
      mgmtParts.push(`Sell 1/3 to 1/2 after ${r.partialProfitDays} days, move stop to break-even.`);
    }
    
    if (r.includeTrailMaCloseStop) {
      mgmtParts.push(`Trail remainder with ${r.trailMaClosePeriod}-day MA (exit on first CLOSE below, not intraday breach).`);
    }
    
    if (mgmtParts.length > 0) {
      parts.push(`[POSITION MGMT: ${mgmtParts.join(" ")}]`);
    }
  }
  
  return parts.join(" | ");
}

// =============================================================================
// Setup-Aware Suggestions - Generated from BigIdea setup configurations
// =============================================================================

function generateSetupAwareEntrySuggestions(
  setupContext: SetupContext,
  technicals: TechnicalData,
  currentPrice: number,
  direction: "long" | "short"
): EntrySuggestion[] {
  const suggestions: EntrySuggestion[] = [];
  const { ivyEntryStrategy, ivyContextNotes, indicatorResults } = setupContext;
  
  if (direction !== "long") return suggestions; // For now, only long setups
  
  const BUFFER_PCT = 0.002; // 0.2% buffer
  
  switch (ivyEntryStrategy) {
    case "rally_reclaim": {
      // U&R: Entry above the rally bar / MA reclaim
      if (indicatorResults?.rallyPrice) {
        const entryPrice = indicatorResults.rallyPrice * (1 + BUFFER_PCT);
        const distPct = ((entryPrice - currentPrice) / currentPrice) * 100;
        suggestions.push({
          price: Math.round(entryPrice * 100) / 100,
          label: "U&R Rally Entry",
          description: `Above rally price $${indicatorResults.rallyPrice.toFixed(2)}${indicatorResults.maUsed ? ` (${indicatorResults.maUsed} EMA reclaim)` : ""}`,
          reasoning: ivyContextNotes || "Enter on rally back above MA after undercut. This is a mean-reversion play.",
          distPercent: Math.round(distPct * 100) / 100,
          distDollars: Math.round((entryPrice - currentPrice) * 100) / 100,
          rank: 0, // Priority entry for this setup
          type: "fixed",
        });
      }
      // Also suggest waiting for pullback if price is extended
      const { sma21 } = technicals;
      if (sma21 && currentPrice > sma21 * 1.02) {
        suggestions.push({
          price: Math.round(sma21 * (1 + BUFFER_PCT) * 100) / 100,
          label: "Wait for PB to 21 EMA",
          description: `Pullback entry at $${sma21.toFixed(2)}`,
          reasoning: "Wait for pullback under 21 EMA for undercut and rally opportunity",
          distPercent: Math.round(((sma21 - currentPrice) / currentPrice) * 100 * 100) / 100,
          distDollars: Math.round((sma21 - currentPrice) * 100) / 100,
          rank: 1,
          type: "dynamic",
        });
      }
      break;
    }
    
    case "ma_touch": {
      // Pullback to MA entry
      const ma = indicatorResults?.maUsed === 50 ? technicals.sma50 : 
                 indicatorResults?.maUsed === 10 ? technicals.sma10 : technicals.sma21;
      if (ma && indicatorResults?.touchPrice) {
        const entryPrice = indicatorResults.touchPrice * (1 + BUFFER_PCT);
        const distPct = ((entryPrice - currentPrice) / currentPrice) * 100;
        suggestions.push({
          price: Math.round(entryPrice * 100) / 100,
          label: `PB to ${indicatorResults.maUsed || 21} MA`,
          description: `MA touch entry at $${indicatorResults.touchPrice.toFixed(2)}`,
          reasoning: ivyContextNotes || `Enter on pullback touch of ${indicatorResults.maUsed || 21}-day MA`,
          distPercent: Math.round(distPct * 100) / 100,
          distDollars: Math.round((entryPrice - currentPrice) * 100) / 100,
          rank: 0,
          type: "dynamic",
        });
      }
      break;
    }
    
    case "pullback_bounce": {
      // Bounce from support
      if (indicatorResults?.touchPrice) {
        const entryPrice = indicatorResults.touchPrice * (1 + BUFFER_PCT);
        const distPct = ((entryPrice - currentPrice) / currentPrice) * 100;
        suggestions.push({
          price: Math.round(entryPrice * 100) / 100,
          label: "Support Bounce",
          description: `Bounce entry at support $${indicatorResults.touchPrice.toFixed(2)}`,
          reasoning: ivyContextNotes || "Enter on bounce from key support level",
          distPercent: Math.round(distPct * 100) / 100,
          distDollars: Math.round((entryPrice - currentPrice) * 100) / 100,
          rank: 0,
          type: "fixed",
        });
      }
      break;
    }
    
    case "breakout": {
      // Standard breakout - defer to existing logic but add context
      if (technicals.baseTop && technicals.baseTop > currentPrice) {
        const entryPrice = technicals.baseTop * (1 + BUFFER_PCT);
        const distPct = ((entryPrice - currentPrice) / currentPrice) * 100;
        suggestions.push({
          price: Math.round(entryPrice * 100) / 100,
          label: "Breakout Entry",
          description: `Above base top $${technicals.baseTop.toFixed(2)}`,
          reasoning: ivyContextNotes || "Enter on breakout above resistance with volume confirmation",
          distPercent: Math.round(distPct * 100) / 100,
          distDollars: Math.round((entryPrice - currentPrice) * 100) / 100,
          rank: 0,
          type: "fixed",
        });
      }
      break;
    }
    
    case "gap_fill": {
      // Gap fill entry - would need gap data from indicators
      break;
    }
  }
  
  return suggestions;
}

function generateSetupAwareStopSuggestions(
  setupContext: SetupContext,
  technicals: TechnicalData,
  entryPrice: number,
  direction: "long" | "short"
): StopSuggestion[] {
  const suggestions: StopSuggestion[] = [];
  const { ivyStopStrategy, indicatorResults } = setupContext;
  
  if (direction !== "long") return suggestions;
  
  const STOP_OFFSET = 0.01; // $0.01 below level
  
  switch (ivyStopStrategy) {
    case "below_undercut": {
      // U&R: Stop below the undercut low
      if (indicatorResults?.undercutPrice) {
        const stopPrice = indicatorResults.undercutPrice - STOP_OFFSET;
        const riskPercent = ((entryPrice - stopPrice) / entryPrice) * 100;
        suggestions.push({
          price: Math.round(stopPrice * 100) / 100,
          label: "Below Undercut",
          description: `Below undercut low $${indicatorResults.undercutPrice.toFixed(2)} - invalidates U&R pattern`,
          riskPercent: Math.round(riskPercent * 100) / 100,
          rank: 0, // Priority stop for this setup
          type: "fixed",
        });
      }
      break;
    }
    
    case "below_ma": {
      // Stop below the key MA
      const ma = indicatorResults?.maUsed === 50 ? technicals.sma50 : 
                 indicatorResults?.maUsed === 10 ? technicals.sma10 : technicals.sma21;
      if (ma && ma < entryPrice) {
        const stopPrice = ma - STOP_OFFSET;
        const riskPercent = ((entryPrice - stopPrice) / entryPrice) * 100;
        suggestions.push({
          price: Math.round(stopPrice * 100) / 100,
          label: `Below ${indicatorResults?.maUsed || 21} MA`,
          description: `Below ${indicatorResults?.maUsed || 21}-day MA at $${ma.toFixed(2)}`,
          riskPercent: Math.round(riskPercent * 100) / 100,
          rank: 0,
          type: "dynamic",
        });
      }
      break;
    }
    
    case "below_base": {
      // Stop below base/consolidation
      if (technicals.baseBottom && technicals.baseBottom < entryPrice) {
        const stopPrice = technicals.baseBottom - STOP_OFFSET;
        const riskPercent = ((entryPrice - stopPrice) / entryPrice) * 100;
        suggestions.push({
          price: Math.round(stopPrice * 100) / 100,
          label: "Below Base",
          description: `Below base support $${technicals.baseBottom.toFixed(2)}`,
          riskPercent: Math.round(riskPercent * 100) / 100,
          rank: 0,
          type: "fixed",
        });
      }
      break;
    }
    
    case "atr_based": {
      // ATR-based stop (defers to existing ATR logic)
      break;
    }
    
    case "prior_day_low": {
      if (technicals.yesterdayLow && technicals.yesterdayLow < entryPrice) {
        const stopPrice = technicals.yesterdayLow - STOP_OFFSET;
        const riskPercent = ((entryPrice - stopPrice) / entryPrice) * 100;
        suggestions.push({
          price: Math.round(stopPrice * 100) / 100,
          label: "Below Prior Day Low",
          description: `Below PDL $${technicals.yesterdayLow.toFixed(2)}`,
          riskPercent: Math.round(riskPercent * 100) / 100,
          rank: 0,
          type: "fixed",
        });
      }
      break;
    }
  }
  
  return suggestions;
}

function buildSetupContext(setupContext: SetupContext, technicals: TechnicalData): string {
  const parts: string[] = [];
  
  if (setupContext.setupName) {
    parts.push(`[SETUP: ${setupContext.setupName}]`);
  }
  
  if (setupContext.ivyContextNotes) {
    parts.push(`[GUIDANCE: ${setupContext.ivyContextNotes}]`);
  }
  
  if (setupContext.indicatorResults) {
    const ir = setupContext.indicatorResults;
    if (ir.patternType === "ur" && ir.undercutPrice && ir.rallyPrice) {
      parts.push(`[U&R: Undercut at $${ir.undercutPrice.toFixed(2)}, Rally at $${ir.rallyPrice.toFixed(2)}${ir.maUsed ? ` on ${ir.maUsed} EMA` : ""}]`);
    } else if (ir.patternType === "pullback" && ir.touchPrice && ir.maUsed) {
      parts.push(`[PULLBACK: Touch at $${ir.touchPrice.toFixed(2)} on ${ir.maUsed} MA]`);
    }
  }
  
  return parts.join(" ");
}

export async function generateSuggestions(
  request: SuggestRequest,
  accountSize: number = 100000,
  rules?: Partial<AskIvyOverlaySettings>
): Promise<SuggestResponse> {
  const technicals = await fetchTechnicalData(request.symbol);
  
  if (!technicals) {
    throw new Error(`Could not fetch technical data for ${request.symbol}`);
  }
  
  // Fetch market regime for context-aware suggestions
  const marketRegime = await getMarketRegimeContext();

  // Generate standard suggestions with regime awareness
  let entrySuggestions = generateEntrySuggestions(technicals, request.entryPrice, request.direction, request.timeframe, rules, marketRegime);
  let stopSuggestions = generateStopSuggestions(technicals, request.entryPrice, request.direction, rules);
  
  // If setup context is provided and approved, prepend setup-specific suggestions
  if (request.setupContext?.ivyApproved) {
    const setupEntries = generateSetupAwareEntrySuggestions(
      request.setupContext,
      technicals,
      technicals.currentPrice,
      request.direction
    );
    const setupStops = generateSetupAwareStopSuggestions(
      request.setupContext,
      technicals,
      request.entryPrice,
      request.direction
    );
    
    // Prepend setup suggestions (they get priority) and re-rank
    if (setupEntries.length > 0) {
      entrySuggestions = [...setupEntries, ...entrySuggestions].map((s, i) => ({ ...s, rank: i + 1 }));
    }
    if (setupStops.length > 0) {
      stopSuggestions = [...setupStops, ...stopSuggestions].map((s, i) => ({ ...s, rank: i + 1 }));
    }
  }
  
  const bestStop = stopSuggestions.length > 0 ? stopSuggestions[0].price : null;
  const targetSuggestions = generateTargetSuggestions(technicals, request.entryPrice, bestStop, request.direction, request.setupType, rules);

  let positionSizeSuggestion = undefined;
  if (bestStop && accountSize > 0) {
    const riskPerShare = Math.abs(request.entryPrice - bestStop);
    // Base risk is 1% of account, but adjust based on market regime
    // In defensive markets (choppy), reduce position size; in aggressive markets, can increase
    const riskMultiplier = marketRegime?.riskMultiplier ?? 1.0;
    const baseRiskPct = 0.01; // 1% base risk
    const adjustedRiskPct = baseRiskPct * riskMultiplier;
    const maxRiskDollars = accountSize * adjustedRiskPct;
    const shares = Math.floor(maxRiskDollars / riskPerShare);
    
    positionSizeSuggestion = {
      shares,
      dollarRisk: Math.round(shares * riskPerShare * 100) / 100,
      percentOfAccount: Math.round(adjustedRiskPct * 100 * 10) / 10, // e.g., 0.8, 1.0, 1.2
      riskMultiplier: riskMultiplier,
    };
  }

  let technicalContext = buildTechnicalContext(technicals, request.direction, rules);
  
  // Prepend market regime context
  if (marketRegime) {
    const regimeLabel = marketRegime.isChoppy ? "⚠️ CHOPPY" : 
                        marketRegime.isTrending ? "✓ TRENDING" : "NEUTRAL";
    const regimeContext = `Market: ${regimeLabel} (RAI ${marketRegime.score})`;
    technicalContext = `${regimeContext} | ${technicalContext}`;
  }
  
  // Prepend setup-specific context if available
  if (request.setupContext?.ivyApproved) {
    const setupContextStr = buildSetupContext(request.setupContext, technicals);
    if (setupContextStr) {
      technicalContext = `${setupContextStr} | ${technicalContext}`;
    }
  }

  return {
    symbol: request.symbol,
    currentPrice: technicals.currentPrice,
    direction: request.direction,
    entryPrice: request.entryPrice,
    entrySuggestions,
    stopSuggestions,
    targetSuggestions,
    positionSizeSuggestion,
    technicalContext,
    marketRegime: marketRegime ?? undefined,
    fetchedAt: new Date(),
  };
}
