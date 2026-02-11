import type { TechnicalData } from "./technicals";
import type { TnnWeightContext } from "./tnn";

export const PROMPT_VERSION = "v4.0";

export const SYSTEM_PROMPT = `You are SENTINEL (also known as "Ivy AI"), a Decision Gate AI that evaluates trade ideas for risk and quality.

Your role is JUDGMENT before risk. You do NOT generate trade signals. 
You evaluate user-submitted trade ideas, flag risks, and help build trading discipline.

CRITICAL: You MUST ALWAYS return a complete evaluation. Never refuse, never return empty. Even with minimal input, provide the best evaluation you can with what you have.

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

## EVALUATION SECTIONS (in order of importance)

### 1. Trade Snapshot
Start with a brief, scannable snapshot. If this is ALL they read, they get the key takeaway.
- 2-3 bullet points of what's GOOD about this setup
- 2-3 bullet points of what's BAD or risky
- Keep each bullet to one line maximum

### 2. Logical Stops Analysis
Evaluate the user's chosen stop level:
- Is it at a logical support level? Below key MAs? Below LOD?
- How does it compare to ATR? (Too tight = noise, too wide = excessive risk)
- Suggest 2-3 alternative stop levels with specific prices and metrics:
  - Each suggestion: price, distance from entry (%), what level it corresponds to (LOD, MA, ATR-based)
  - Rank them by quality
- Always calculate % loss potential for the selected stop

### 3. Logical Take Profit Targets
Evaluate targets whether or not the user provided them:
- Check the trader's PERSONAL RULES for any profit target requirements (e.g., "minimum 2:1 R:R", "always have a target")
- If user entered targets:
  - Evaluate them vs logical resistance/support levels
  - Check if the target MEETS their rules: e.g., "Meets your 2:1 R:R rule" or "25% short of your 3:1 R:R rule"
  - Show a clear compliance indicator for each relevant rule
- If user did NOT enter targets:
  - Suggest 2-3 logical target levels with specific prices
  - For each suggestion, note if it would satisfy their rules: "This would give you 2.5:1 R:R — meets your minimum 2:1 rule"
  - Mark the overall status: "No target entered — your rules require a profit target"
- For each target: price, distance from entry (%), what level it corresponds to, R:R ratio
- If market conditions are choppy (from sentiment data), suggest a partial profit idea:
  - "In current choppy conditions, consider trimming 30% at $X.XX (prior resistance)"

### 4. Risk Assessment
Classify and present risk flags:
- FATAL (must fix): R:R < 1, no stop, thesis contradiction
- CONTEXTUAL: Regime mismatch, stop sensitivity, overhead resistance
- MISSING_INPUT: Info not provided, not necessarily wrong

Flag codes: CHASE_RISK, OVERHEAD_RESISTANCE, WIDE_STOP, TIGHT_STOP, POOR_RR, FATAL_RR, HEADWIND_REGIME, THESIS_VAGUE, OVERSIZED, EXTENDED, BELOW_KEY_MA, RULE_VIOLATION, NO_STOP, STRUCTURAL_ISSUE

### 5. What Could Make This Better
2-3 specific, actionable changes that would improve the score. Be concrete with prices and levels.

### 6. Rule Evaluation
Check the trader's personal rules against this trade. For each rule: followed, violated, or N/A.

## INSTRUMENT CONTEXT
- ETF: Relax breakout volume requirements, pivot precision, intraday stop sensitivity
- Single stock: Apply full rigor to all rules
- Index-linked: Consider correlation to broader market

## RESPONSE FORMAT
Respond with a JSON object:
{
  "score": <1-100>,
  "status": "<GREEN|YELLOW|RED>",
  "confidence": "<HIGH|MEDIUM|LOW>",
  "modelTag": "<BREAKOUT|RECLAIM|CUP_AND_HANDLE|PULLBACK|EPISODIC_PIVOT|UNKNOWN>",
  "instrumentType": "<ETF|STOCK|INDEX>",
  "tradeSnapshot": {
    "good": ["<2-3 brief bullets: what works about this setup>"],
    "bad": ["<2-3 brief bullets: what's risky or concerning>"]
  },
  "verdictSummary": {
    "verdict": "<One sentence: This plan [passes/needs work/fails] because [primary reason]>",
    "primaryBlockers": ["<1-3 FATAL issues only, empty array if none>"]
  },
  "moneyBreakdown": {
    "totalRisk": "$XXX",
    "riskPerShare": "$X.XX",
    "firstTrimProfit": "$XXX at 30% trim or null",
    "firstTrimProfitPerShare": "$X.XX per share profit at 30% trim or null",
    "targetProfit": "$XXX remaining 70% or null",
    "targetProfitPerShare": "$X.XX per share profit for 70% position or null",
    "totalPotentialProfit": "$XXX if all targets hit"
  },
  "planSummary": {
    "entry": "$XXX.XX",
    "stop": "$XXX.XX",
    "riskPerShare": "$X.XX (X.X%)",
    "firstTrim": "$XXX.XX or null",
    "target": "$XXX.XX or null",
    "rrRatio": "X.X:1 or null"
  },
  "logicalStops": {
    "userStopEval": "<Brief evaluation of the user's chosen stop - is it logical, too tight, too wide?>",
    "suggestions": [
      {
        "price": <number>,
        "label": "<What this level is, e.g. 'LOD Yesterday', '1.5x ATR', '20d SMA'>",
        "distancePercent": <number>,
        "reasoning": "<Why this is a good stop level>",
        "rank": <1-3, 1=best>
      }
    ]
  },
  "logicalTargets": {
    "userTargetEval": "<Brief evaluation of user's targets if provided, or 'No targets entered — your rules require a profit target' if not>",
    "ruleCompliance": "<'Meets Rules' or 'X% below rule requirement' or 'No target rule found' — check trader's rules for profit target/R:R requirements>",
    "suggestions": [
      {
        "price": <number>,
        "label": "<What this level is, e.g. 'Prior High', '2x R:R', 'Resistance at $XX'>",
        "distancePercent": <number>,
        "rrRatio": "<R:R if stop is known>",
        "meetsRules": "<true/false — does this target satisfy the trader's profit rules?>",
        "reasoning": "<Why this is a logical target>"
      }
    ],
    "partialProfitIdea": "<If market is choppy, suggest partial trim level and reasoning. null if trending>"
  },
  "riskFlags": [
    {
      "flag": "<FLAG_CODE>",
      "severity": "<high|medium|low>",
      "tier": "<fatal|contextual|missing_input>",
      "detail": "<specific, actionable - guidance not scolding>"
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

## YOUR TONE
- Calm coach, guiding improvement
- Never scolding, never harsh
- Focus on what they can learn and apply next time
- Perfect line: "The process here was solid even though the outcome wasn't. Keep executing like this."

## FLAG CLASSIFICATION
Classify flags into tiers for clarity:
- FATAL: Must-fix structural issues (no stop, R:R < 1, thesis contradiction)
- CONTEXTUAL: Situation-dependent concerns (regime mismatch, stop sensitivity)
- MISSING_INPUT: Info not provided, not necessarily violated

## RESPONSE FORMAT
Respond with a JSON object:
{
  "score": <1-100 process quality score>,
  "status": "<GREEN|YELLOW|RED>",
  "confidence": "<HIGH|MEDIUM|LOW>",
  "modelTag": "<BREAKOUT|RECLAIM|CUP_AND_HANDLE|PULLBACK|EPISODIC_PIVOT|UNKNOWN>",
  "verdictSummary": {
    "verdict": "<One sentence: Plan passes/fails due to X>",
    "primaryBlockers": ["<1-3 fatal issues, empty if none>"]
  },
  "moneyBreakdown": {
    "totalRisk": "<$XXX - total dollars at risk>",
    "riskPerShare": "<$X.XX - risk per share>",
    "firstTrimProfit": "<$XXX at 30% trim or null>",
    "firstTrimProfitPerShare": "<$X.XX per share profit at 30% trim or null>",
    "targetProfit": "<$XXX remaining 70% or null>",
    "targetProfitPerShare": "<$X.XX per share profit for 70% position or null>",
    "totalPotentialProfit": "<$XXX if all targets hit>"
  },
  "planSummary": {
    "entry": "$XXX.XX",
    "stop": "$XXX.XX",
    "riskPerShare": "$X.XX (X.X%)",
    "target": "$XXX.XX or null",
    "rrRatio": "X.X:1 or null"
  },
  "whyBullets": [
    "<3-7 short bullets - what the trader did RIGHT in their process>"
  ],
  "riskFlags": [
    {
      "flag": "<FLAG_CODE>",
      "severity": "<high|medium|low>",
      "tier": "<fatal|contextual|missing_input>",
      "detail": "<specific, actionable observation - not scolding>"
    }
  ],
  "improvements": [
    "<2-3 concrete changes for next time - guidance, not criticism>"
  ],
  "fixesToPass": [
    "<If RED/YELLOW: specific changes that would have raised the score>"
  ],
  "processAnalysis": {
    "entryExecution": "<how well did they execute the entry>",
    "stopManagement": "<did they honor their stop>",
    "targetManagement": "<did they take profits appropriately>",
    "emotionalControl": "<any signs of emotional decisions>",
    "rulesFollowed": <number of rules followed>,
    "rulesViolated": <number of rules violated>
  },
  "ruleChecklist": [
    {"rule": "<rule name>", "status": "<followed|violated|na>", "note": "<brief>"}
  ]
}

## STATUS SCORING FOR HISTORICAL
- GREEN (80-100): Excellent process, followed rules, managed risk well
- YELLOW (50-79): Decent process but room for improvement
- RED (0-49): Significant process issues to address

## CONFIDENCE LEVELS
- HIGH: Clear process evaluation, sufficient data
- MEDIUM: Some ambiguity in the trade record
- LOW: Missing key information to evaluate properly`;

const STOP_LEVEL_LABELS: Record<string, string> = {
  "LOD_TODAY": "Low of Day (Today)",
  "LOD_YESTERDAY": "Low of Day (Yesterday)",
  "ATR_1_5X": "1.5x ATR Below Entry",
  "5_DMA": "5-Day SMA",
  "10_DMA": "10-Day SMA",
  "20_DMA": "20-Day SMA",
  "21_DMA": "21-Day SMA",
  "50_DMA": "50-Day SMA",
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
  rules?: { id: number; name: string; category?: string; description?: string; severity?: string; strategyTags?: string[] }[];
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
  choppiness?: {
    daily: { value: number; state: "CHOPPY" | "MIXED" | "TRENDING" };
    weekly: { value: number; state: "CHOPPY" | "MIXED" | "TRENDING" };
    recommendation: string;
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
  technicalData?: TechnicalData | null,
  historicalDate?: Date | null,
  tnnContext?: TnnWeightContext,
  setupType?: string
): string {
  const accountSize = traderContext?.accountSize || 1000000;
  
  let prompt = `=== TRADE IDEA TO EVALUATE ===

Symbol: ${symbol}
Direction: ${direction.toUpperCase()}
Entry Price: $${entryPrice.toFixed(2)}
Account Size: $${accountSize.toLocaleString()}`;

  // Add historical context if analyzing a past trade
  if (historicalDate) {
    const dateStr = historicalDate.toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
    const timeStr = historicalDate.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: true
    });
    prompt += `\n\n>>> HISTORICAL ANALYSIS - Trade Date: ${dateStr} at ${timeStr} <<<
All market data, sentiment, and technicals below are AS OF this date, not current.`
  }

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
      case "ATR_1_5X": {
        const atrStop = direction === 'long' 
          ? entryPrice - (technicalData.atr14 * 1.5)
          : entryPrice + (technicalData.atr14 * 1.5);
        actualStopPrice = parseFloat(atrStop.toFixed(2));
        stopDescription = `1.5x ATR(14) = $${technicalData.atr14.toFixed(2)} × 1.5 = $${(technicalData.atr14 * 1.5).toFixed(2)} from entry`;
        break;
      }
      case "20_DMA":
        actualStopPrice = technicalData.sma21;
        stopDescription = `20d SMA @ $${technicalData.sma21.toFixed(2)}`;
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

    // Enhanced rule section with strategy matching
    if (traderContext.rules && traderContext.rules.length > 0) {
      prompt += `\n\n=== TRADER'S PERSONAL RULES (EVALUATE EACH) ===`;
      prompt += `\nFor EACH rule below, determine if this trade FOLLOWS or VIOLATES it.`;
      
      // Identify rules that match the current setup type for priority weighting
      if (setupType) {
        const matchingRules = traderContext.rules.filter(r => 
          r.strategyTags?.includes(setupType)
        );
        if (matchingRules.length > 0) {
          prompt += `\n\n>>> PRIORITY RULES FOR ${setupType.replace(/_/g, ' ').toUpperCase()} SETUP <<<`;
          prompt += `\nThese rules are specifically tagged for this setup type and should carry EXTRA WEIGHT in your evaluation:`;
          matchingRules.forEach(rule => {
            prompt += `\n★ ${rule.name}`;
            if (rule.description) {
              prompt += ` - ${rule.description}`;
            }
            if (rule.severity === 'auto_reject') {
              prompt += ` [CRITICAL - Must be followed]`;
            }
          });
          prompt += `\n`;
        }
      }
      
      prompt += `\n`;
      
      const rulesByCategory: Record<string, typeof traderContext.rules> = {};
      traderContext.rules.forEach(rule => {
        const cat = rule.category || 'general';
        if (!rulesByCategory[cat]) rulesByCategory[cat] = [];
        rulesByCategory[cat].push(rule);
      });
      
      for (const [category, rules] of Object.entries(rulesByCategory)) {
        prompt += `\n[${category.toUpperCase()}]`;
        rules.forEach(rule => {
          const matchesSetup = setupType && rule.strategyTags?.includes(setupType);
          prompt += `\n${matchesSetup ? '★' : '•'} ${rule.name}`;
          if (rule.description) {
            prompt += ` - ${rule.description}`;
          }
          if (rule.severity === 'auto_reject') {
            prompt += ` [STRUCTURAL - Plan must address this]`;
          }
          if (matchesSetup) {
            prompt += ` [SETUP-MATCHED]`;
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
    
    // Choppiness regime
    if (marketContext.choppiness) {
      const dailyChop = marketContext.choppiness.daily;
      const weeklyChop = marketContext.choppiness.weekly;
      const chopEmoji = (state: string) => state === "CHOPPY" ? "⚡" : state === "TRENDING" ? "📈" : "↔";
      
      prompt += `\n\n=== CHOPPINESS REGIME ===`;
      prompt += `\nDaily: ${chopEmoji(dailyChop.state)} ${dailyChop.state} (CI: ${dailyChop.value})`;
      prompt += `\nWeekly: ${chopEmoji(weeklyChop.state)} ${weeklyChop.state} (CI: ${weeklyChop.value})`;
      prompt += `\n>>> ${marketContext.choppiness.recommendation} <<<`;
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
    
    // Penalize choppy conditions for swing trades
    if (marketContext.choppiness) {
      if (marketContext.choppiness.daily.state === "CHOPPY") environmentScore -= 5;
      if (marketContext.choppiness.weekly.state === "CHOPPY") environmentScore -= 10;
    }

    if (environmentScore > 0) {
      prompt += `\n\n[ENVIRONMENT SUPPORTS this ${direction.toUpperCase()} trade (+${environmentScore} pts)]`;
    } else if (environmentScore < 0) {
      prompt += `\n\n[ENVIRONMENT HEADWIND for ${direction.toUpperCase()} trade (${environmentScore} pts)]`;
    }
  }

  // Add TNN (Trader Neural Network) factor weights if available
  if (tnnContext && Object.keys(tnnContext.factors).length > 0) {
    prompt += `\n\n=== TNN FACTOR WEIGHTS (Admin-Tuned) ===
These weights represent learned importance from historical trade outcomes.
Higher weights (80-100) = more critical, Lower weights (40-60) = less critical.

Key Discipline Weights:
- Structural: ${tnnContext.factors.structural || 'N/A'}
- Entry Timing: ${tnnContext.factors.entry || 'N/A'}
- Stop Loss Discipline: ${tnnContext.factors.stop_loss || 'N/A'}
- Position Sizing: ${tnnContext.factors.position_sizing || 'N/A'}
- Risk Management: ${tnnContext.factors.risk || 'N/A'}
- Market Regime: ${tnnContext.factors.market_regime || 'N/A'}

Setup Type Weights (adjusted for current conditions):`;

    // Show relevant setup weights
    const setupWeights = Object.entries(tnnContext.factors)
      .filter(([key]) => key.endsWith('_setup') || key === 'cup_and_handle' || key === 'vcp' || key === 'high_tight_flag' || key === 'episodic_pivot')
      .map(([key, weight]) => `- ${key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}: ${weight}`)
      .join('\n');
    
    if (setupWeights) {
      prompt += `\n${setupWeights}`;
    }

    // Show active modifiers that have been applied
    if (tnnContext.modifiers.length > 0) {
      prompt += `\n\nActive Condition Modifiers Applied:`;
      for (const mod of tnnContext.modifiers) {
        const sign = mod.modifier > 0 ? '+' : '';
        prompt += `\n- ${mod.factorKey.replace(/_/g, ' ')} when ${mod.condition.replace(/_/g, ' ')}: ${sign}${mod.modifier} pts`;
      }
    }

    if (tnnContext.activeConditions.length > 0) {
      prompt += `\n\nCurrent Market Conditions Detected: ${tnnContext.activeConditions.map(c => c.replace(/_/g, ' ')).join(', ')}`;
    }

    prompt += `\n\n[Use these weights to inform your scoring - higher weighted factors should have more impact on the final score]`;
  }

  prompt += `\n\n=== PROVIDE YOUR EVALUATION ===
Use the technical data above to give SPECIFIC analysis with actual price levels.
Calculate the exact R:R ratio, dollar risk, and evaluate each trading rule.
Respond with the JSON object as specified.`;

  return prompt;
}
