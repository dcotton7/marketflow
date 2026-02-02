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

export function buildEvaluationPrompt(
  symbol: string,
  direction: 'long' | 'short',
  entryPrice: number,
  stopPrice?: number,
  targetPrice?: number,
  positionSize?: number,
  thesis?: string
): string {
  let prompt = `Evaluate this trade idea:

Symbol: ${symbol}
Direction: ${direction.toUpperCase()}
Entry Price: $${entryPrice.toFixed(2)}`;

  if (stopPrice) {
    const riskPercent = Math.abs((entryPrice - stopPrice) / entryPrice * 100);
    prompt += `\nStop Price: $${stopPrice.toFixed(2)} (${riskPercent.toFixed(1)}% risk)`;
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
  }

  if (positionSize) {
    prompt += `\nPosition Size: ${positionSize} shares`;
    const dollarValue = positionSize * entryPrice;
    prompt += ` ($${dollarValue.toLocaleString()})`;
  }

  if (thesis) {
    prompt += `\n\nTrader's Thesis:\n${thesis}`;
  }

  prompt += `\n\nProvide your evaluation as a JSON object.`;

  return prompt;
}
