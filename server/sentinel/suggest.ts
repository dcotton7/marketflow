import { fetchTechnicalData, type TechnicalData } from "./technicals";

export interface SuggestRequest {
  symbol: string;
  direction: "long" | "short";
  entryPrice: number;
  setupType?: string;
}

export interface StopSuggestion {
  price: number;
  label: string;
  description: string;
  riskPercent: number;
  rank: number;
}

export interface TargetSuggestion {
  price: number;
  label: string;
  description: string;
  rrRatio: number;
  rank: number;
}

export interface SuggestResponse {
  symbol: string;
  currentPrice: number;
  direction: "long" | "short";
  entryPrice: number;
  stopSuggestions: StopSuggestion[];
  targetSuggestions: TargetSuggestion[];
  positionSizeSuggestion?: {
    shares: number;
    dollarRisk: number;
    percentOfAccount: number;
  };
  technicalContext: string;
  fetchedAt: Date;
}

function generateStopSuggestions(
  technicals: TechnicalData,
  entryPrice: number,
  direction: "long" | "short"
): StopSuggestion[] {
  const suggestions: StopSuggestion[] = [];
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
        price: Math.round((sma10 - 0.10) * 100) / 100,
        label: "10 SMA",
        description: "Below 10-day moving average",
        riskPercent: Math.round(riskPercent * 100) / 100,
        rank: 3,
      });
    }

    if (sma21 && sma21 < entryPrice) {
      const riskPercent = ((entryPrice - sma21) / entryPrice) * 100;
      suggestions.push({
        price: Math.round((sma21 - 0.10) * 100) / 100,
        label: "21 EMA",
        description: "Below 21-day exponential MA",
        riskPercent: Math.round(riskPercent * 100) / 100,
        rank: 4,
      });
    }

    if (sma50 && sma50 < entryPrice && sma50 > entryPrice * 0.9) {
      const riskPercent = ((entryPrice - sma50) / entryPrice) * 100;
      suggestions.push({
        price: Math.round((sma50 - 0.10) * 100) / 100,
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

    if (atr14) {
      const atrStop = entryPrice - (atr14 * 1.5);
      const riskPercent = ((entryPrice - atrStop) / entryPrice) * 100;
      suggestions.push({
        price: Math.round(atrStop * 100) / 100,
        label: "1.5× ATR",
        description: "1.5× Average True Range below entry",
        riskPercent: Math.round(riskPercent * 100) / 100,
        rank: 7,
      });
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
        price: Math.round((sma10 + 0.10) * 100) / 100,
        label: "10 SMA",
        description: "Above 10-day moving average",
        riskPercent: Math.round(riskPercent * 100) / 100,
        rank: 3,
      });
    }

    if (sma21 && sma21 > entryPrice) {
      const riskPercent = ((sma21 - entryPrice) / entryPrice) * 100;
      suggestions.push({
        price: Math.round((sma21 + 0.10) * 100) / 100,
        label: "21 EMA",
        description: "Above 21-day exponential MA",
        riskPercent: Math.round(riskPercent * 100) / 100,
        rank: 4,
      });
    }

    if (atr14) {
      const atrStop = entryPrice + (atr14 * 1.5);
      const riskPercent = ((atrStop - entryPrice) / entryPrice) * 100;
      suggestions.push({
        price: Math.round(atrStop * 100) / 100,
        label: "1.5× ATR",
        description: "1.5× Average True Range above entry",
        riskPercent: Math.round(riskPercent * 100) / 100,
        rank: 5,
      });
    }
  }

  return suggestions
    .filter(s => s.riskPercent > 0 && s.riskPercent < 15)
    .sort((a, b) => a.riskPercent - b.riskPercent)
    .map((s, i) => ({ ...s, rank: i + 1 }));
}

function generateTargetSuggestions(
  technicals: TechnicalData,
  entryPrice: number,
  stopPrice: number | null,
  direction: "long" | "short"
): TargetSuggestion[] {
  const suggestions: TargetSuggestion[] = [];
  const riskPerShare = stopPrice ? Math.abs(entryPrice - stopPrice) : technicals.atr14 || entryPrice * 0.02;

  if (direction === "long") {
    [1.5, 2, 3, 4, 5].forEach((rrRatio, index) => {
      const target = entryPrice + (riskPerShare * rrRatio);
      suggestions.push({
        price: Math.round(target * 100) / 100,
        label: `${rrRatio}:1 R:R`,
        description: `${rrRatio}× your risk for reward`,
        rrRatio,
        rank: index + 1,
      });
    });

    if (technicals.fiveDayHigh && technicals.fiveDayHigh > entryPrice) {
      const rrRatio = (technicals.fiveDayHigh - entryPrice) / riskPerShare;
      if (rrRatio >= 1) {
        suggestions.push({
          price: Math.round(technicals.fiveDayHigh * 100) / 100,
          label: "5-Day High",
          description: "Resistance at 5-day high",
          rrRatio: Math.round(rrRatio * 10) / 10,
          rank: 10,
        });
      }
    }

    if (technicals.weeklyHigh && technicals.weeklyHigh > entryPrice) {
      const rrRatio = (technicals.weeklyHigh - entryPrice) / riskPerShare;
      if (rrRatio >= 1) {
        suggestions.push({
          price: Math.round(technicals.weeklyHigh * 100) / 100,
          label: "Week High",
          description: "Resistance at weekly high",
          rrRatio: Math.round(rrRatio * 10) / 10,
          rank: 11,
        });
      }
    }
  } else {
    [1.5, 2, 3, 4, 5].forEach((rrRatio, index) => {
      const target = entryPrice - (riskPerShare * rrRatio);
      if (target > 0) {
        suggestions.push({
          price: Math.round(target * 100) / 100,
          label: `${rrRatio}:1 R:R`,
          description: `${rrRatio}× your risk for reward`,
          rrRatio,
          rank: index + 1,
        });
      }
    });

    if (technicals.fiveDayLow && technicals.fiveDayLow < entryPrice) {
      const rrRatio = (entryPrice - technicals.fiveDayLow) / riskPerShare;
      if (rrRatio >= 1) {
        suggestions.push({
          price: Math.round(technicals.fiveDayLow * 100) / 100,
          label: "5-Day Low",
          description: "Support at 5-day low",
          rrRatio: Math.round(rrRatio * 10) / 10,
          rank: 10,
        });
      }
    }
  }

  return suggestions.sort((a, b) => a.rrRatio - b.rrRatio).map((s, i) => ({ ...s, rank: i + 1 }));
}

function buildTechnicalContext(technicals: TechnicalData, direction: "long" | "short"): string {
  const { currentPrice, sma21, sma50, sma200, atr14, adr20, distanceFromSma21, extensionFrom50dAdr } = technicals;
  
  const parts: string[] = [];
  
  parts.push(`Current price: $${currentPrice.toFixed(2)}`);
  
  if (sma21) {
    const position = currentPrice > sma21 ? "above" : "below";
    parts.push(`${distanceFromSma21?.toFixed(1) || "?"}% ${position} 21 SMA ($${sma21.toFixed(2)})`);
  }
  
  if (sma50) {
    const position = currentPrice > sma50 ? "above" : "below";
    if (extensionFrom50dAdr !== null && adr20 > 0) {
      const absExt = Math.abs(extensionFrom50dAdr).toFixed(1);
      let zone = '';
      if (extensionFrom50dAdr >= 8) zone = ' [PROFIT-TAKING ZONE]';
      else if (extensionFrom50dAdr >= 5) zone = ' [CAUTION]';
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
  
  return parts.join(" | ");
}

export async function generateSuggestions(
  request: SuggestRequest,
  accountSize: number = 100000
): Promise<SuggestResponse> {
  const technicals = await fetchTechnicalData(request.symbol);
  
  if (!technicals) {
    throw new Error(`Could not fetch technical data for ${request.symbol}`);
  }

  const stopSuggestions = generateStopSuggestions(technicals, request.entryPrice, request.direction);
  
  const bestStop = stopSuggestions.length > 0 ? stopSuggestions[0].price : null;
  const targetSuggestions = generateTargetSuggestions(technicals, request.entryPrice, bestStop, request.direction);

  let positionSizeSuggestion = undefined;
  if (bestStop && accountSize > 0) {
    const riskPerShare = Math.abs(request.entryPrice - bestStop);
    const maxRiskDollars = accountSize * 0.01;
    const shares = Math.floor(maxRiskDollars / riskPerShare);
    
    positionSizeSuggestion = {
      shares,
      dollarRisk: Math.round(shares * riskPerShare * 100) / 100,
      percentOfAccount: 1,
    };
  }

  const technicalContext = buildTechnicalContext(technicals, request.direction);

  return {
    symbol: request.symbol,
    currentPrice: technicals.currentPrice,
    direction: request.direction,
    entryPrice: request.entryPrice,
    stopSuggestions,
    targetSuggestions,
    positionSizeSuggestion,
    technicalContext,
    fetchedAt: new Date(),
  };
}
