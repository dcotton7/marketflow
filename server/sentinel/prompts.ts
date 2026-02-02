import type { TechnicalData } from "./technicals";

export const PROMPT_VERSION = "v3.0";

export const SYSTEM_PROMPT = `You are SENTINEL, a Decision Gate AI that evaluates trade ideas for risk and quality.

Your role is JUDGMENT before risk. You do NOT generate trade signals. 
You evaluate user-submitted trade ideas, flag risks, and help build trading discipline.

## YOUR TONE
- Calm coach, surgical checklist
- Never scolding, never hype
- Never "I think it will go up"
- Perfect line: "This may work, but the environment is making follow-through harder. If you take it, keep risk tight."

## CRITICAL: Use the TECHNICAL DATA provided
You are given real-time price data, moving averages, and key levels. USE THESE SPECIFIC NUMBERS.
- Reference actual price levels (LOD, MA levels, etc.)
- Calculate and state the actual dollar risk and R:R ratio
- Comment on the stock's position relative to its moving averages

## MODEL TAG DETECTION
Based on the thesis and technicals, identify the trade model:
- BREAKOUT: Breaking out of a base/consolidation, new high attempt
- RECLAIM: Reclaiming a key level after breakdown (VWAP, MA, prior support)
- CUP_AND_HANDLE: Classic cup pattern with handle formation
- PULLBACK: Buying pullback in uptrend to support (MA, VWAP, prior breakout)
- EPISODIC_PIVOT: News/earnings catalyst driving gap or momentum
- UNKNOWN: Cannot clearly identify the pattern

## EVALUATION CRITERIA

1. **Risk/Reward Ratio** - Calculate using ACTUAL stop and target levels
   - State exact R:R (e.g., "2.3:1 based on $103.50 stop to $115 target")
   - Flag if R:R < 2:1

2. **Stop Placement Quality**
   - Is stop below logical support (LOD, MA, base bottom)?
   - How far is stop from entry (% risk)?
   - Does ATR suggest stop could get hit by noise?

3. **Position Sizing**
   - Calculate: Risk per share × shares = total dollar risk
   - Calculate: Dollar risk ÷ account size = % of account at risk
   - Flag if >2% of account

4. **Technical Structure**
   - Where is price vs 21/50/200 MA?
   - Is MA structure bullish or bearish?
   - Is stock extended or pulling back?

5. **Entry Quality**
   - Chasing if far above breakout level
   - Good if entering on pullback to support
   - Check distance from recent highs/lows

## RISK FLAGS TO CHECK
- CHASE_RISK: Entry is extended, not at defined trigger
- OVERHEAD_RESISTANCE: Nearby resistance limits room to run
- WIDE_STOP: Stop >8% from entry or >2x ATR
- TIGHT_STOP: Stop <0.5x ATR, likely to get hit
- POOR_RR: R:R ratio below 2:1
- HEADWIND_REGIME: Market environment against trade direction
- THESIS_VAGUE: Thesis lacks specific trigger/edge
- OVERSIZED: Position risk >2% of account
- EXTENDED: Price >10% above 21 MA
- BELOW_KEY_MA: Price below 50 or 200 MA (for longs)
- RULE_VIOLATION: Violates trader's personal rules
- NO_STOP: Stop not defined

## RESPONSE FORMAT
Respond with a JSON object:
{
  "score": <1-100>,
  "status": "<GREEN|YELLOW|RED>",
  "confidence": "<HIGH|MEDIUM|LOW>",
  "modelTag": "<BREAKOUT|RECLAIM|CUP_AND_HANDLE|PULLBACK|EPISODIC_PIVOT|UNKNOWN>",
  "planSummary": {
    "entry": "$XXX.XX",
    "stop": "$XXX.XX",
    "riskPerShare": "$X.XX (X.X%)",
    "target": "$XXX.XX or null",
    "rrRatio": "X.X:1 or null"
  },
  "whyBullets": [
    "<3-7 short bullets tied to rules, not vibe - why this could work>"
  ],
  "riskFlags": [
    {
      "flag": "<FLAG_CODE>",
      "severity": "<high|medium|low>",
      "detail": "<specific, actionable warning>"
    }
  ],
  "improvements": [
    "<2-3 concrete changes that would raise the score>"
  ],
  "ruleChecklist": [
    {"rule": "<rule name>", "status": "<followed|violated|na>", "note": "<brief>"}
  ]
}

## STATUS SCORING
- GREEN (80-100): Strong setup, good technicals and risk management, proceed with confidence
- YELLOW (50-79): Acceptable but has concerns, proceed with caution
- RED (0-49): Significant issues, recommend pass or major adjustments

## CONFIDENCE LEVELS
- HIGH: Clear pattern, defined risk, environment supports direction
- MEDIUM: Pattern exists but some ambiguity or mixed environment
- LOW: Weak pattern, missing info, or significant uncertainties`;


export const HISTORICAL_SYSTEM_PROMPT = `You are SENTINEL, evaluating a COMPLETED trade for process quality.

This is a POST-TRADE analysis. The trade has already happened. Your job is to:
1. Evaluate whether the trader followed good PROCESS, regardless of outcome
2. Check rule adherence - did they follow their own rules?
3. Identify what they did well and what they can improve
4. Reward disciplined execution even if the trade lost money
5. Flag process violations even if the trade made money

Key principle: A winning trade with poor process is WORSE than a losing trade with good process.

Respond with a JSON object containing:
{
  "score": <1-100 process quality score>,
  "recommendation": "<excellent_process|good_process|needs_improvement|poor_process>",
  "reasoning": "<analysis of the process, not the outcome>",
  "riskFlags": [<process issues identified>],
  "processAnalysis": {
    "entryExecution": "<how well did they execute the entry>",
    "stopManagement": "<did they honor their stop>",
    "targetManagement": "<did they take profits appropriately>",
    "emotionalControl": "<any signs of emotional decisions>",
    "rulesFollowed": <number of rules followed>,
    "rulesViolated": <number of rules violated>
  },
  "ruleChecklist": [
    {"rule": "<rule name>", "status": "<followed|violated|not_applicable>", "note": "<brief explanation>"}
  ]
}`;

const STOP_LEVEL_LABELS: Record<string, string> = {
  "LOD_TODAY": "Low of Day (Today)",
  "LOD_YESTERDAY": "Low of Day (Yesterday)",
  "LOD_WEEKLY": "Low of Day (Weekly)",
  "5_DMA": "5-Day Moving Average",
  "10_DMA": "10-Day Moving Average",
  "21_DMA": "21-Day Moving Average",
  "50_DMA": "50-Day Moving Average",
  "6_20_DOWN_CROSS": "6/20 SMA Down Cross (5 min)",
  "MACD_DOWN_CROSS": "MACD Cross Down",
};

const TARGET_LEVEL_LABELS: Record<string, string> = {
  "PREV_DAY_HIGH": "Previous Day High",
  "5_DAY_HIGH": "Past 5 Day High",
  "RR_2X": "2x Risk/Reward",
  "RR_3X": "3x Risk/Reward",
  "RR_4X": "4x Risk/Reward",
  "RR_5X": "5x Risk/Reward",
  "RR_8X": "8x Risk/Reward",
  "RR_10X": "10x Risk/Reward",
};

interface TraderContext {
  activePositions?: { symbol: string; direction: string; entryPrice: number }[];
  watchlist?: { symbol: string; thesis?: string }[];
  rules?: { id: number; name: string; category?: string; description?: string; severity?: string }[];
  accountSize?: number;
}

export interface MarketContext {
  weekly?: {
    state: 1 | 0 | -1;
    stateName: string;
    confidence: string;
  };
  daily?: {
    state: string;
    confidence: string;
    canaryTags: string[];
  };
  sector?: {
    sector: string;
    etf: string;
    state: 1 | 0 | -1;
    stateName: string;
    confidence: string;
  };
  summary?: string;
}

export function buildEvaluationPrompt(
  symbol: string,
  direction: 'long' | 'short',
  entryPrice: number,
  stopPrice?: number,
  stopPriceLevel?: string,
  targetPrice?: number,
  targetPriceLevel?: string,
  positionSize?: number,
  positionSizeUnit?: 'shares' | 'dollars',
  thesis?: string,
  traderContext?: TraderContext,
  marketContext?: MarketContext,
  technicalData?: TechnicalData | null
): string {
  const accountSize = traderContext?.accountSize || 1000000;
  
  let prompt = `=== TRADE IDEA TO EVALUATE ===

Symbol: ${symbol}
Direction: ${direction.toUpperCase()}
Entry Price: $${entryPrice.toFixed(2)}
Account Size: $${accountSize.toLocaleString()}`;

  // Calculate actual stop price from level if needed
  let actualStopPrice = stopPrice;
  let stopDescription = "";
  
  if (technicalData && stopPriceLevel && !stopPrice) {
    switch (stopPriceLevel) {
      case "LOD_TODAY":
        actualStopPrice = technicalData.todayLow;
        stopDescription = `LOD Today @ $${technicalData.todayLow.toFixed(2)}`;
        break;
      case "LOD_YESTERDAY":
        actualStopPrice = technicalData.yesterdayLow;
        stopDescription = `LOD Yesterday @ $${technicalData.yesterdayLow.toFixed(2)}`;
        break;
      case "LOD_WEEKLY":
        actualStopPrice = technicalData.weeklyLow;
        stopDescription = `Weekly Low @ $${technicalData.weeklyLow.toFixed(2)}`;
        break;
      case "5_DMA":
        actualStopPrice = technicalData.sma5;
        stopDescription = `5 DMA @ $${technicalData.sma5.toFixed(2)}`;
        break;
      case "10_DMA":
        actualStopPrice = technicalData.sma10;
        stopDescription = `10 DMA @ $${technicalData.sma10.toFixed(2)}`;
        break;
      case "21_DMA":
        actualStopPrice = technicalData.sma21;
        stopDescription = `21 DMA @ $${technicalData.sma21.toFixed(2)}`;
        break;
      case "50_DMA":
        actualStopPrice = technicalData.sma50;
        stopDescription = `50 DMA @ $${technicalData.sma50.toFixed(2)}`;
        break;
      default:
        stopDescription = STOP_LEVEL_LABELS[stopPriceLevel] || stopPriceLevel;
    }
  }

  if (actualStopPrice) {
    const riskPerShare = Math.abs(entryPrice - actualStopPrice);
    const riskPercent = (riskPerShare / entryPrice) * 100;
    prompt += `\nStop Price: $${actualStopPrice.toFixed(2)} (${riskPercent.toFixed(2)}% risk per share)`;
    if (stopDescription) {
      prompt += ` - ${stopDescription}`;
    }
  } else if (stopPriceLevel) {
    const label = STOP_LEVEL_LABELS[stopPriceLevel] || stopPriceLevel;
    prompt += `\nStop Level: ${label} (exact price unknown - evaluate with caution)`;
  }

  // Calculate actual target price
  let actualTargetPrice = targetPrice;
  let targetDescription = "";
  
  if (technicalData && targetPriceLevel && !targetPrice) {
    switch (targetPriceLevel) {
      case "PREV_DAY_HIGH":
        actualTargetPrice = technicalData.yesterdayHigh;
        targetDescription = `Previous Day High @ $${technicalData.yesterdayHigh.toFixed(2)}`;
        break;
      case "5_DAY_HIGH":
        actualTargetPrice = technicalData.fiveDayHigh;
        targetDescription = `5 Day High @ $${technicalData.fiveDayHigh.toFixed(2)}`;
        break;
      default:
        // Handle RR targets if we have a stop
        if (targetPriceLevel.startsWith("RR_") && actualStopPrice) {
          const match = targetPriceLevel.match(/RR_(\d+)X/);
          if (match) {
            const multiplier = parseInt(match[1]);
            const riskAmount = Math.abs(entryPrice - actualStopPrice);
            actualTargetPrice = direction === 'long' 
              ? entryPrice + (riskAmount * multiplier)
              : entryPrice - (riskAmount * multiplier);
            targetDescription = `${multiplier}x R:R @ $${actualTargetPrice.toFixed(2)}`;
          }
        } else {
          targetDescription = TARGET_LEVEL_LABELS[targetPriceLevel] || targetPriceLevel;
        }
    }
  }

  if (actualTargetPrice) {
    const rewardPerShare = Math.abs(actualTargetPrice - entryPrice);
    const rewardPercent = (rewardPerShare / entryPrice) * 100;
    prompt += `\nTarget Price: $${actualTargetPrice.toFixed(2)} (${rewardPercent.toFixed(2)}% potential reward)`;
    if (targetDescription) {
      prompt += ` - ${targetDescription}`;
    }
    
    if (actualStopPrice) {
      const riskAmount = Math.abs(entryPrice - actualStopPrice);
      const rewardAmount = Math.abs(actualTargetPrice - entryPrice);
      const rrRatio = rewardAmount / riskAmount;
      prompt += `\n>>> CALCULATED R:R RATIO: ${rrRatio.toFixed(2)}:1 <<<`;
    }
  } else if (targetPriceLevel) {
    const label = TARGET_LEVEL_LABELS[targetPriceLevel] || targetPriceLevel;
    prompt += `\nTarget Level: ${label}`;
  }

  // Position sizing with risk calculations
  if (positionSize) {
    const unit = positionSizeUnit || 'shares';
    let shares: number;
    let dollarPosition: number;
    
    if (unit === 'shares') {
      shares = positionSize;
      dollarPosition = shares * entryPrice;
    } else {
      dollarPosition = positionSize;
      shares = Math.floor(dollarPosition / entryPrice);
    }
    
    prompt += `\n\nPosition Size: ${shares} shares ($${dollarPosition.toLocaleString()})`;
    
    if (actualStopPrice) {
      const riskPerShare = Math.abs(entryPrice - actualStopPrice);
      const totalDollarRisk = riskPerShare * shares;
      const percentOfAccount = (totalDollarRisk / accountSize) * 100;
      prompt += `\n>>> DOLLAR RISK: $${totalDollarRisk.toFixed(2)} (${percentOfAccount.toFixed(2)}% of account) <<<`;
      
      if (percentOfAccount > 2) {
        prompt += `\n[WARNING: Risk exceeds 2% of account!]`;
      }
    }
  }

  // Technical data section
  if (technicalData) {
    prompt += `\n\n=== TECHNICAL DATA (REAL-TIME) ===`;
    prompt += `\nCurrent Price: $${technicalData.currentPrice.toFixed(2)}`;
    prompt += `\nToday's Range: $${technicalData.todayLow.toFixed(2)} - $${technicalData.todayHigh.toFixed(2)}`;
    prompt += `\nYesterday's Range: $${technicalData.yesterdayLow.toFixed(2)} - $${technicalData.yesterdayHigh.toFixed(2)}`;
    prompt += `\n5-Day Range: $${technicalData.fiveDayLow.toFixed(2)} - $${technicalData.fiveDayHigh.toFixed(2)}`;
    
    prompt += `\n\nMoving Averages:`;
    prompt += `\n  21 DMA: $${technicalData.sma21.toFixed(2)} (${technicalData.distanceFromSma21 > 0 ? '+' : ''}${technicalData.distanceFromSma21.toFixed(1)}% from price)`;
    prompt += `\n  50 DMA: $${technicalData.sma50.toFixed(2)} (${technicalData.distanceFromSma50 > 0 ? '+' : ''}${technicalData.distanceFromSma50.toFixed(1)}% from price)`;
    prompt += `\n  200 DMA: $${technicalData.sma200.toFixed(2)} (${technicalData.distanceFromSma200 > 0 ? '+' : ''}${technicalData.distanceFromSma200.toFixed(1)}% from price)`;
    
    prompt += `\n\nVolatility:`;
    prompt += `\n  ATR(14): $${technicalData.atr14.toFixed(2)} (${((technicalData.atr14 / technicalData.currentPrice) * 100).toFixed(1)}% of price)`;
    
    // MA structure analysis
    const aboveAll = technicalData.currentPrice > technicalData.sma21 && 
                     technicalData.currentPrice > technicalData.sma50 && 
                     technicalData.currentPrice > technicalData.sma200;
    const belowAll = technicalData.currentPrice < technicalData.sma21 && 
                     technicalData.currentPrice < technicalData.sma50 && 
                     technicalData.currentPrice < technicalData.sma200;
    const maStackedBullish = technicalData.sma21 > technicalData.sma50 && technicalData.sma50 > technicalData.sma200;
    const maStackedBearish = technicalData.sma21 < technicalData.sma50 && technicalData.sma50 < technicalData.sma200;
    
    prompt += `\n\nMA Structure Analysis:`;
    if (aboveAll) {
      prompt += `\n  Price ABOVE all major MAs (bullish structure)`;
    } else if (belowAll) {
      prompt += `\n  Price BELOW all major MAs (bearish structure)`;
    } else {
      prompt += `\n  Price mixed relative to MAs`;
    }
    
    if (maStackedBullish) {
      prompt += `\n  MAs stacked bullish (21 > 50 > 200)`;
    } else if (maStackedBearish) {
      prompt += `\n  MAs stacked bearish (21 < 50 < 200)`;
    }
    
    if (Math.abs(technicalData.distanceFromSma21) < 3) {
      prompt += `\n  [NEAR 21 MA - potential support/resistance zone]`;
    }
    if (technicalData.distanceFromSma21 > 10) {
      prompt += `\n  [EXTENDED - ${technicalData.distanceFromSma21.toFixed(1)}% above 21 MA - pullback risk]`;
    }
    
    // Base structure
    if (technicalData.baseBottom && technicalData.baseTop) {
      prompt += `\n\n30-Day Base:`;
      prompt += `\n  Range: $${technicalData.baseBottom.toFixed(2)} - $${technicalData.baseTop.toFixed(2)}`;
      const baseDepth = ((technicalData.baseTop - technicalData.baseBottom) / technicalData.baseTop) * 100;
      prompt += `\n  Depth: ${baseDepth.toFixed(1)}%`;
    }
    
    // Suggested alternative stops
    prompt += `\n\nKey Support Levels for Stop Consideration:`;
    prompt += `\n  LOD Today: $${technicalData.todayLow.toFixed(2)}`;
    prompt += `\n  LOD Yesterday: $${technicalData.yesterdayLow.toFixed(2)}`;
    prompt += `\n  Weekly Low: $${technicalData.weeklyLow.toFixed(2)}`;
    prompt += `\n  21 DMA: $${technicalData.sma21.toFixed(2)}`;
    if (technicalData.baseBottom) {
      prompt += `\n  Base Bottom (30d): $${technicalData.baseBottom.toFixed(2)}`;
    }
  } else {
    prompt += `\n\n[WARNING: Technical data unavailable - evaluation based on provided info only]`;
  }

  if (thesis) {
    prompt += `\n\n=== TRADER'S THESIS ===\n${thesis}`;
  }

  // Trader context
  if (traderContext) {
    if (traderContext.activePositions && traderContext.activePositions.length > 0) {
      prompt += `\n\n=== CURRENT POSITIONS ===`;
      traderContext.activePositions.forEach(pos => {
        prompt += `\n- ${pos.symbol} (${pos.direction.toUpperCase()}) @ $${pos.entryPrice.toFixed(2)}`;
      });
      const sameSymbol = traderContext.activePositions.find(p => p.symbol.toUpperCase() === symbol.toUpperCase());
      if (sameSymbol) {
        prompt += `\n[ALERT: Already has a position in ${symbol}!]`;
      }
    }

    if (traderContext.watchlist && traderContext.watchlist.length > 0) {
      const onWatchlist = traderContext.watchlist.find(w => w.symbol.toUpperCase() === symbol.toUpperCase());
      if (onWatchlist) {
        prompt += `\n\n[This stock was on the watchlist`;
        if (onWatchlist.thesis) {
          prompt += ` with thesis: "${onWatchlist.thesis}"`;
        }
        prompt += `]`;
      }
    }

    // Enhanced rule section
    if (traderContext.rules && traderContext.rules.length > 0) {
      prompt += `\n\n=== TRADER'S PERSONAL RULES (EVALUATE EACH) ===`;
      prompt += `\nFor EACH rule below, determine if this trade FOLLOWS or VIOLATES it:\n`;
      
      const rulesByCategory: Record<string, typeof traderContext.rules> = {};
      traderContext.rules.forEach(rule => {
        const cat = rule.category || 'general';
        if (!rulesByCategory[cat]) rulesByCategory[cat] = [];
        rulesByCategory[cat].push(rule);
      });
      
      for (const [category, rules] of Object.entries(rulesByCategory)) {
        prompt += `\n[${category.toUpperCase()}]`;
        rules.forEach(rule => {
          prompt += `\n• ${rule.name}`;
          if (rule.description) {
            prompt += ` - ${rule.description}`;
          }
          if (rule.severity === 'auto_reject') {
            prompt += ` [AUTO-REJECT if violated]`;
          }
        });
      }
    }
  }

  // Market context
  if (marketContext) {
    prompt += `\n\n=== MARKET ENVIRONMENT ===`;
    
    if (marketContext.weekly) {
      const weeklyEmoji = marketContext.weekly.state === 1 ? "↑" : marketContext.weekly.state === -1 ? "↓" : "→";
      prompt += `\nWeekly Trend: ${weeklyEmoji} ${marketContext.weekly.stateName} (${marketContext.weekly.confidence})`;
    }
    
    if (marketContext.daily) {
      const dailyEmoji = marketContext.daily.state === "RISK-ON" ? "↑" : marketContext.daily.state === "RISK-OFF" ? "↓" : "→";
      prompt += `\nDaily Risk: ${dailyEmoji} ${marketContext.daily.state} (${marketContext.daily.confidence})`;
      if (marketContext.daily.canaryTags && marketContext.daily.canaryTags.length > 0) {
        prompt += `\n  Warnings: ${marketContext.daily.canaryTags.join(", ")}`;
      }
    }
    
    if (marketContext.sector) {
      const sectorEmoji = marketContext.sector.state === 1 ? "↑" : marketContext.sector.state === -1 ? "↓" : "→";
      prompt += `\nSector (${marketContext.sector.sector}): ${sectorEmoji} ${marketContext.sector.stateName} via ${marketContext.sector.etf}`;
    }

    // Environment scoring guidance
    const isLong = direction === 'long';
    let environmentScore = 0;
    
    if (marketContext.weekly?.state === 1) environmentScore += isLong ? 10 : -10;
    if (marketContext.weekly?.state === -1) environmentScore += isLong ? -10 : 10;
    if (marketContext.daily?.state === "RISK-ON") environmentScore += isLong ? 10 : -10;
    if (marketContext.daily?.state === "RISK-OFF") environmentScore += isLong ? -10 : 10;
    if (marketContext.sector?.state === 1) environmentScore += isLong ? 5 : -5;
    if (marketContext.sector?.state === -1) environmentScore += isLong ? -5 : 5;

    if (environmentScore > 0) {
      prompt += `\n\n[ENVIRONMENT SUPPORTS this ${direction.toUpperCase()} trade (+${environmentScore} pts)]`;
    } else if (environmentScore < 0) {
      prompt += `\n\n[ENVIRONMENT HEADWIND for ${direction.toUpperCase()} trade (${environmentScore} pts)]`;
    }
  }

  prompt += `\n\n=== PROVIDE YOUR EVALUATION ===
Use the technical data above to give SPECIFIC analysis with actual price levels.
Calculate the exact R:R ratio, dollar risk, and evaluate each trading rule.
Respond with the JSON object as specified.`;

  return prompt;
}
