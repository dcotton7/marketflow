/**
 * DSL Rule Evaluator for Custom Indicators
 * 
 * Executes user-created indicators using a safe, declarative DSL.
 * No arbitrary code execution - only predefined operations.
 */

import type { CandleData } from './indicators';

export type DslCondition = 
  | "PRICE_ABOVE"
  | "PRICE_BELOW"
  | "PRICE_BETWEEN"
  | "CLOSE_ABOVE_OPEN"
  | "CLOSE_BELOW_OPEN"
  | "VOLUME_ABOVE_AVG"
  | "VOLUME_ABOVE_THRESHOLD"
  | "CONSECUTIVE_UP_DAYS"
  | "CONSECUTIVE_DOWN_DAYS"
  | "SMA_CROSS_ABOVE"
  | "SMA_CROSS_BELOW"
  | "EMA_CROSS_ABOVE"
  | "EMA_CROSS_BELOW"
  | "PRICE_ABOVE_SMA"
  | "PRICE_BELOW_SMA"
  | "PRICE_ABOVE_EMA"
  | "PRICE_BELOW_EMA"
  | "GAP_UP"
  | "GAP_DOWN"
  | "GAP_UP_PCT"
  | "GAP_DOWN_PCT"
  | "HIGHER_HIGH"
  | "LOWER_LOW"
  | "HIGHER_LOW"
  | "LOWER_HIGH"
  | "RANGE_EXPANSION"
  | "RANGE_CONTRACTION"
  | "BREAKOUT_NEW_HIGH"
  | "BREAKDOWN_NEW_LOW"
  | "INSIDE_BAR"
  | "OUTSIDE_BAR"
  | "DOJI"
  | "HAMMER"
  | "SHOOTING_STAR"
  | "ENGULFING_BULL"
  | "ENGULFING_BEAR"
  | "MOMENTUM_INCREASING"
  | "MOMENTUM_DECREASING";

export type DslOperator = ">" | "<" | ">=" | "<=" | "==" | "!=";

export interface DslRule {
  condition: DslCondition;
  operator?: DslOperator;
  threshold?: number | string;
  lookback?: number;
  period?: number;
  period2?: number;
  minGapPct?: number;
  consecutiveDays?: number;
}

export interface DslLogicDefinition {
  rules: DslRule[];
  combineLogic: "AND" | "OR";
}

/**
 * Helper functions for calculations
 */

function calcSMA(candles: CandleData[], period: number, offset = 0): number {
  if (candles.length < offset + period) return 0;
  const slice = candles.slice(offset, offset + period);
  return slice.reduce((sum, c) => sum + c.close, 0) / slice.length;
}

function calcEMA(candles: CandleData[], period: number, offset = 0): number {
  const slice = candles.slice(offset);
  if (slice.length < period) return slice.length > 0 ? slice[0].close : 0;
  
  const closes = slice.map(c => c.close).reverse();
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((sum, val) => sum + val, 0) / period;
  
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

function calcAvgVolume(candles: CandleData[], period: number): number {
  if (candles.length < period) return 0;
  return candles.slice(0, period).reduce((sum, c) => sum + c.volume, 0) / period;
}

/**
 * Evaluate a single DSL rule
 */
function evaluateRule(rule: DslRule, candles: CandleData[]): boolean {
  if (candles.length === 0) return false;

  const latestCandle = candles[0];
  const lookback = rule.lookback || 20;
  const period = rule.period || 20;
  const period2 = rule.period2 || 50;

  switch (rule.condition) {
    case "PRICE_ABOVE":
      return latestCandle.close > (rule.threshold as number);

    case "PRICE_BELOW":
      return latestCandle.close < (rule.threshold as number);

    case "PRICE_BETWEEN":
      if (typeof rule.threshold === "string") {
        const [min, max] = rule.threshold.split("-").map(Number);
        return latestCandle.close >= min && latestCandle.close <= max;
      }
      return false;

    case "CLOSE_ABOVE_OPEN":
      return latestCandle.close > latestCandle.open;

    case "CLOSE_BELOW_OPEN":
      return latestCandle.close < latestCandle.open;

    case "VOLUME_ABOVE_AVG": {
      const avgVol = calcAvgVolume(candles, period);
      return latestCandle.volume > avgVol;
    }

    case "VOLUME_ABOVE_THRESHOLD":
      return latestCandle.volume > (rule.threshold as number);

    case "CONSECUTIVE_UP_DAYS": {
      const days = rule.consecutiveDays || 3;
      if (candles.length < days) return false;
      for (let i = 0; i < days; i++) {
        if (candles[i].close <= candles[i].open) return false;
      }
      return true;
    }

    case "CONSECUTIVE_DOWN_DAYS": {
      const days = rule.consecutiveDays || 3;
      if (candles.length < days) return false;
      for (let i = 0; i < days; i++) {
        if (candles[i].close >= candles[i].open) return false;
      }
      return true;
    }

    case "PRICE_ABOVE_SMA": {
      const sma = calcSMA(candles, period);
      return latestCandle.close > sma;
    }

    case "PRICE_BELOW_SMA": {
      const sma = calcSMA(candles, period);
      return latestCandle.close < sma;
    }

    case "PRICE_ABOVE_EMA": {
      const ema = calcEMA(candles, period);
      return latestCandle.close > ema;
    }

    case "PRICE_BELOW_EMA": {
      const ema = calcEMA(candles, period);
      return latestCandle.close < ema;
    }

    case "SMA_CROSS_ABOVE": {
      if (candles.length < Math.max(period, period2) + 1) return false;
      const smaFast0 = calcSMA(candles, period, 0);
      const smaSlow0 = calcSMA(candles, period2, 0);
      const smaFast1 = calcSMA(candles, period, 1);
      const smaSlow1 = calcSMA(candles, period2, 1);
      return smaFast0 > smaSlow0 && smaFast1 <= smaSlow1;
    }

    case "SMA_CROSS_BELOW": {
      if (candles.length < Math.max(period, period2) + 1) return false;
      const smaFast0 = calcSMA(candles, period, 0);
      const smaSlow0 = calcSMA(candles, period2, 0);
      const smaFast1 = calcSMA(candles, period, 1);
      const smaSlow1 = calcSMA(candles, period2, 1);
      return smaFast0 < smaSlow0 && smaFast1 >= smaSlow1;
    }

    case "EMA_CROSS_ABOVE": {
      if (candles.length < Math.max(period, period2) + 1) return false;
      const emaFast0 = calcEMA(candles, period, 0);
      const emaSlow0 = calcEMA(candles, period2, 0);
      const emaFast1 = calcEMA(candles, period, 1);
      const emaSlow1 = calcEMA(candles, period2, 1);
      return emaFast0 > emaSlow0 && emaFast1 <= emaSlow1;
    }

    case "EMA_CROSS_BELOW": {
      if (candles.length < Math.max(period, period2) + 1) return false;
      const emaFast0 = calcEMA(candles, period, 0);
      const emaSlow0 = calcEMA(candles, period2, 0);
      const emaFast1 = calcEMA(candles, period, 1);
      const emaSlow1 = calcEMA(candles, period2, 1);
      return emaFast0 < emaSlow0 && emaFast1 >= emaSlow1;
    }

    case "GAP_UP": {
      if (candles.length < 2) return false;
      return candles[0].open > candles[1].close;
    }

    case "GAP_DOWN": {
      if (candles.length < 2) return false;
      return candles[0].open < candles[1].close;
    }

    case "GAP_UP_PCT": {
      if (candles.length < 2) return false;
      const gapPct = ((candles[0].open - candles[1].close) / candles[1].close) * 100;
      return gapPct > (rule.minGapPct || 0);
    }

    case "GAP_DOWN_PCT": {
      if (candles.length < 2) return false;
      const gapPct = ((candles[1].close - candles[0].open) / candles[1].close) * 100;
      return gapPct > (rule.minGapPct || 0);
    }

    case "HIGHER_HIGH": {
      if (candles.length < 2) return false;
      return candles[0].high > candles[1].high;
    }

    case "LOWER_LOW": {
      if (candles.length < 2) return false;
      return candles[0].low < candles[1].low;
    }

    case "HIGHER_LOW": {
      if (candles.length < 2) return false;
      return candles[0].low > candles[1].low;
    }

    case "LOWER_HIGH": {
      if (candles.length < 2) return false;
      return candles[0].high < candles[1].high;
    }

    case "RANGE_EXPANSION": {
      if (candles.length < 2) return false;
      const range0 = candles[0].high - candles[0].low;
      const range1 = candles[1].high - candles[1].low;
      return range0 > range1 * (rule.threshold as number || 1.2);
    }

    case "RANGE_CONTRACTION": {
      if (candles.length < 2) return false;
      const range0 = candles[0].high - candles[0].low;
      const range1 = candles[1].high - candles[1].low;
      return range0 < range1 * (rule.threshold as number || 0.8);
    }

    case "BREAKOUT_NEW_HIGH": {
      if (candles.length < lookback + 1) return false;
      const priorHigh = Math.max(...candles.slice(1, lookback + 1).map(c => c.high));
      return candles[0].high > priorHigh;
    }

    case "BREAKDOWN_NEW_LOW": {
      if (candles.length < lookback + 1) return false;
      const priorLow = Math.min(...candles.slice(1, lookback + 1).map(c => c.low));
      return candles[0].low < priorLow;
    }

    case "INSIDE_BAR": {
      if (candles.length < 2) return false;
      return candles[0].high < candles[1].high && candles[0].low > candles[1].low;
    }

    case "OUTSIDE_BAR": {
      if (candles.length < 2) return false;
      return candles[0].high > candles[1].high && candles[0].low < candles[1].low;
    }

    case "DOJI": {
      const bodySize = Math.abs(latestCandle.close - latestCandle.open);
      const totalRange = latestCandle.high - latestCandle.low;
      return totalRange > 0 && (bodySize / totalRange) < 0.1;
    }

    case "HAMMER": {
      const bodySize = Math.abs(latestCandle.close - latestCandle.open);
      const totalRange = latestCandle.high - latestCandle.low;
      const lowerShadow = Math.min(latestCandle.open, latestCandle.close) - latestCandle.low;
      const upperShadow = latestCandle.high - Math.max(latestCandle.open, latestCandle.close);
      return totalRange > 0 && lowerShadow > bodySize * 2 && upperShadow < bodySize;
    }

    case "SHOOTING_STAR": {
      const bodySize = Math.abs(latestCandle.close - latestCandle.open);
      const totalRange = latestCandle.high - latestCandle.low;
      const upperShadow = latestCandle.high - Math.max(latestCandle.open, latestCandle.close);
      const lowerShadow = Math.min(latestCandle.open, latestCandle.close) - latestCandle.low;
      return totalRange > 0 && upperShadow > bodySize * 2 && lowerShadow < bodySize;
    }

    case "ENGULFING_BULL": {
      if (candles.length < 2) return false;
      return (
        candles[1].close < candles[1].open &&
        candles[0].close > candles[0].open &&
        candles[0].open < candles[1].close &&
        candles[0].close > candles[1].open
      );
    }

    case "ENGULFING_BEAR": {
      if (candles.length < 2) return false;
      return (
        candles[1].close > candles[1].open &&
        candles[0].close < candles[0].open &&
        candles[0].open > candles[1].close &&
        candles[0].close < candles[1].open
      );
    }

    case "MOMENTUM_INCREASING": {
      if (candles.length < lookback) return false;
      const recentGain = ((candles[0].close - candles[lookback - 1].close) / candles[lookback - 1].close) * 100;
      const priorGain = ((candles[lookback].close - candles[lookback * 2 - 1].close) / candles[lookback * 2 - 1].close) * 100;
      return recentGain > priorGain;
    }

    case "MOMENTUM_DECREASING": {
      if (candles.length < lookback) return false;
      const recentGain = ((candles[0].close - candles[lookback - 1].close) / candles[lookback - 1].close) * 100;
      const priorGain = ((candles[lookback].close - candles[lookback * 2 - 1].close) / candles[lookback * 2 - 1].close) * 100;
      return recentGain < priorGain;
    }

    default:
      console.warn(`[DSL] Unknown condition: ${rule.condition}`);
      return false;
  }
}

/**
 * Main evaluation function for DSL-based indicators
 */
export function evaluateDslIndicator(
  logic: DslLogicDefinition,
  candles: CandleData[],
  params: Record<string, any>,
  upstreamData?: Record<string, any>
): { pass: boolean; data: Record<string, any> } {
  if (!logic || !logic.rules || logic.rules.length === 0) {
    console.warn('[DSL] No rules defined in logic');
    return { pass: false, data: { _diagnostics: { value: 'no rules', threshold: 'N/A' } } };
  }

  if (candles.length === 0) {
    return { pass: false, data: { _diagnostics: { value: 'insufficient data', threshold: 'N/A' } } };
  }

  // Extract skipBars from upstreamData or params
  const skip = upstreamData?.patternEndBar ?? params.skipBars ?? 0;
  
  // Apply skip offset to candles
  const effectiveCandles = skip > 0 ? candles.slice(skip) : candles;
  
  if (effectiveCandles.length === 0) {
    return { pass: false, data: { _diagnostics: { value: 'insufficient data after skip', threshold: 'N/A' } } };
  }

  const results = logic.rules.map(rule => {
    const ruleWithParams = {
      ...rule,
      lookback: rule.lookback || params.lookback || 20,
      period: rule.period || params.period || 20,
      period2: rule.period2 || params.period2 || 50,
      consecutiveDays: rule.consecutiveDays || params.consecutiveDays || params.minConsecutiveDays || 3,
      minGapPct: rule.minGapPct || params.minGapPct || 0,
      threshold: rule.threshold || params.threshold,
    };

    return evaluateRule(ruleWithParams, effectiveCandles);
  });

  const pass = logic.combineLogic === "AND" 
    ? results.every(r => r)
    : results.some(r => r);

  return {
    pass,
    data: {
      evaluationStartBar: skip,
      evaluationEndBar: skip,
      patternEndBar: skip,
      _diagnostics: {
        value: pass ? 'pass' : 'fail',
        threshold: `${logic.rules.length} rule(s) combined with ${logic.combineLogic}`
      }
    }
  };
}

/**
 * Validate a DSL definition before saving
 */
export function validateDslDefinition(logic: DslLogicDefinition): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!logic || typeof logic !== "object") {
    errors.push("Logic definition must be an object");
    return { valid: false, errors };
  }

  if (!logic.rules || !Array.isArray(logic.rules)) {
    errors.push("Logic definition must have a 'rules' array");
    return { valid: false, errors };
  }

  if (logic.rules.length === 0) {
    errors.push("At least one rule is required");
    return { valid: false, errors };
  }

  if (!logic.combineLogic || !["AND", "OR"].includes(logic.combineLogic)) {
    errors.push("combineLogic must be 'AND' or 'OR'");
    return { valid: false, errors };
  }

  const validConditions = [
    "PRICE_ABOVE", "PRICE_BELOW", "PRICE_BETWEEN",
    "CLOSE_ABOVE_OPEN", "CLOSE_BELOW_OPEN",
    "VOLUME_ABOVE_AVG", "VOLUME_ABOVE_THRESHOLD",
    "CONSECUTIVE_UP_DAYS", "CONSECUTIVE_DOWN_DAYS",
    "SMA_CROSS_ABOVE", "SMA_CROSS_BELOW",
    "EMA_CROSS_ABOVE", "EMA_CROSS_BELOW",
    "PRICE_ABOVE_SMA", "PRICE_BELOW_SMA",
    "PRICE_ABOVE_EMA", "PRICE_BELOW_EMA",
    "GAP_UP", "GAP_DOWN", "GAP_UP_PCT", "GAP_DOWN_PCT",
    "HIGHER_HIGH", "LOWER_LOW", "HIGHER_LOW", "LOWER_HIGH",
    "RANGE_EXPANSION", "RANGE_CONTRACTION",
    "BREAKOUT_NEW_HIGH", "BREAKDOWN_NEW_LOW",
    "INSIDE_BAR", "OUTSIDE_BAR",
    "DOJI", "HAMMER", "SHOOTING_STAR",
    "ENGULFING_BULL", "ENGULFING_BEAR",
    "MOMENTUM_INCREASING", "MOMENTUM_DECREASING",
  ];

  for (let i = 0; i < logic.rules.length; i++) {
    const rule = logic.rules[i];
    
    if (!rule.condition) {
      errors.push(`Rule ${i + 1}: Missing 'condition' field`);
      continue;
    }

    if (!validConditions.includes(rule.condition)) {
      errors.push(`Rule ${i + 1}: Invalid condition '${rule.condition}'`);
    }

    if (rule.condition.includes("CONSECUTIVE") && !rule.consecutiveDays) {
      if (i === 0) {
        errors.push(`Rule ${i + 1}: CONSECUTIVE_* conditions require 'consecutiveDays' parameter`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
