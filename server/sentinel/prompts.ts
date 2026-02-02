export const PROMPT_VERSION = "v1.0";

export const SYSTEM_PROMPT = `You are SENTINEL, a Decision Gate AI that evaluates trade ideas for risk and quality.

Your role is JUDGMENT before risk. You do NOT generate trade signals or recommendations to trade. 
You ONLY evaluate user-submitted trade ideas and flag potential risks.

Evaluation criteria:
1. Risk/Reward Ratio - Is the stop loss appropriately placed? Is the target realistic?
2. Position Sizing - Is the position size appropriate for the account and stop distance?
3. Thesis Quality - Does the thesis have a clear catalyst or technical setup?
4. Market Context - Consider sector, volatility, and general market conditions
5. Timing Considerations - Entry timing relative to key levels

Risk Flags to check:
- OVERSIZED: Position too large relative to account
- WIDE_STOP: Stop loss too far from entry (high % at risk)
- TIGHT_STOP: Stop likely to get hit by normal volatility
- POOR_RR: Risk/reward ratio below 2:1
- CHASING: Entry price above recent resistance or extended from base
- EARNINGS_RISK: Upcoming earnings or major catalyst
- SECTOR_WEAKNESS: Sector showing relative weakness
- OVERTRADING: Too many positions in same sector
- EMOTIONAL: Signs of FOMO, revenge trading, or bias
- ILLIQUID: Low volume or wide spreads

Respond with a JSON object containing:
{
  "score": <1-100 overall quality score>,
  "reasoning": "<detailed explanation of your evaluation>",
  "riskFlags": [<array of applicable risk flag codes>],
  "recommendation": "<proceed|caution|avoid>"
}

Score guidelines:
- 80-100: Strong setup, proceed with confidence
- 60-79: Acceptable but has concerns, proceed with caution
- 40-59: Significant issues, recommend avoiding or adjusting
- 0-39: High risk, strong avoid recommendation`;

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
  rules?: { name: string; category?: string }[];
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
  traderContext?: TraderContext
): string {
  let prompt = `Evaluate this trade idea:

Symbol: ${symbol}
Direction: ${direction.toUpperCase()}
Entry Price: $${entryPrice.toFixed(2)}`;

  if (stopPrice) {
    const riskPercent = Math.abs((entryPrice - stopPrice) / entryPrice * 100);
    prompt += `\nStop Price: $${stopPrice.toFixed(2)} (${riskPercent.toFixed(1)}% risk)`;
  } else if (stopPriceLevel) {
    const label = STOP_LEVEL_LABELS[stopPriceLevel] || stopPriceLevel;
    prompt += `\nStop Level: ${label}`;
  }

  if (targetPrice) {
    const rewardPercent = Math.abs((targetPrice - entryPrice) / entryPrice * 100);
    prompt += `\nTarget Price: $${targetPrice.toFixed(2)} (${rewardPercent.toFixed(1)}% reward)`;
    
    if (stopPrice) {
      const riskAmount = Math.abs(entryPrice - stopPrice);
      const rewardAmount = Math.abs(targetPrice - entryPrice);
      const rrRatio = rewardAmount / riskAmount;
      prompt += `\nRisk/Reward Ratio: ${rrRatio.toFixed(2)}:1`;
    }
  } else if (targetPriceLevel) {
    const label = TARGET_LEVEL_LABELS[targetPriceLevel] || targetPriceLevel;
    prompt += `\nTarget Level: ${label}`;
  }

  if (positionSize) {
    const unit = positionSizeUnit || 'shares';
    if (unit === 'shares') {
      prompt += `\nPosition Size: ${positionSize} shares`;
      const dollarValue = positionSize * entryPrice;
      prompt += ` ($${dollarValue.toLocaleString()})`;
    } else {
      prompt += `\nPosition Size: $${positionSize.toLocaleString()}`;
      const shares = Math.floor(positionSize / entryPrice);
      prompt += ` (~${shares} shares)`;
    }
  }

  if (thesis) {
    prompt += `\n\nTrader's Thesis:\n${thesis}`;
  }

  // Add trader context if available
  if (traderContext) {
    if (traderContext.activePositions && traderContext.activePositions.length > 0) {
      prompt += `\n\nTrader's Current Positions:`;
      traderContext.activePositions.forEach(pos => {
        prompt += `\n- ${pos.symbol} (${pos.direction.toUpperCase()}) @ $${pos.entryPrice.toFixed(2)}`;
      });
      // Check for sector concentration or correlation
      const sameSymbol = traderContext.activePositions.find(p => p.symbol === symbol);
      if (sameSymbol) {
        prompt += `\n\n[ALERT: Trader already has a position in ${symbol}]`;
      }
    }

    if (traderContext.watchlist && traderContext.watchlist.length > 0) {
      const onWatchlist = traderContext.watchlist.find(w => w.symbol === symbol);
      if (onWatchlist) {
        prompt += `\n\n[Note: This stock was on trader's watchlist`;
        if (onWatchlist.thesis) {
          prompt += ` with thesis: "${onWatchlist.thesis}"`;
        }
        prompt += `]`;
      }
    }

    if (traderContext.rules && traderContext.rules.length > 0) {
      prompt += `\n\nTrader's Personal Rules (evaluate adherence):`;
      traderContext.rules.forEach(rule => {
        prompt += `\n- ${rule.name}${rule.category ? ` [${rule.category}]` : ''}`;
      });
    }
  }

  prompt += `\n\nProvide your evaluation as a JSON object.`;

  return prompt;
}
