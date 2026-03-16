export type CandleData = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type ParamAutoLink = {
  linkType: string;
  sourceParam?: string;
};

export type IndicatorParam = {
  name: string;
  label: string;
  type: "number" | "select" | "boolean";
  defaultValue: number | string | boolean;
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
  autoLink?: ParamAutoLink;
};

export type IndicatorProvides = {
  linkType: string;
  paramName: string;
};

export type IndicatorConsumes = {
  paramName: string;
  dataKey: string;
};

export type IndicatorResult = boolean | { pass: boolean; data?: Record<string, any> };

export type IndicatorDefinition = {
  id: string;
  name: string;
  category: "Moving Averages" | "Volume" | "Price Action" | "Relative Strength" | "Volatility" | "Consolidation" | "Momentum" | "Fundamental" | "Intraday";
  description: string;
  params: IndicatorParam[];
  provides?: IndicatorProvides[];
  consumes?: IndicatorConsumes[];
  evaluate: (candles: CandleData[], params: Record<string, any>, benchmarkCandles?: CandleData[], upstreamData?: Record<string, any>) => IndicatorResult;
};

export function normalizeResult(result: IndicatorResult): { pass: boolean; data?: Record<string, any> } {
  if (typeof result === "boolean") return { pass: result };
  return result;
}

function calcSMA(candles: CandleData[], period: number): number {
  if (candles.length < period) return candles.length > 0 ? candles.slice(0, candles.length).reduce((s, c) => s + c.close, 0) / candles.length : 0;
  return candles.slice(0, period).reduce((s, c) => s + c.close, 0) / period;
}

function calcSMAAt(candles: CandleData[], period: number, offset: number): number {
  if (candles.length < offset + period) return 0;
  return candles.slice(offset, offset + period).reduce((s, c) => s + c.close, 0) / period;
}

function calcEMA(candles: CandleData[], period: number): number {
  if (candles.length < period) return candles.length > 0 ? candles[0].close : 0;
  const closes = candles.map(c => c.close).reverse();
  const k = 2 / (period + 1);
  let ema = 0;
  for (let i = 0; i < period; i++) ema += closes[i];
  ema /= period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

function calcEMAAt(candles: CandleData[], period: number, offset: number): number {
  if (candles.length < offset + period) return 0;
  return calcEMA(candles.slice(offset), period);
}

function calcMASeries(candles: CandleData[], period: number, type: "sma" | "ema"): number[] {
  const closes = candles.map(c => c.close).reverse();
  const result: number[] = [];
  if (type === "sma") {
    for (let i = 0; i < closes.length; i++) {
      if (i < period - 1) { result.push(0); continue; }
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += closes[j];
      result.push(sum / period);
    }
  } else {
    const k = 2 / (period + 1);
    if (closes.length < period) return closes.map(() => 0);
    let ema = 0;
    for (let i = 0; i < period; i++) ema += closes[i];
    ema /= period;
    for (let i = 0; i < period - 1; i++) result.push(0);
    result.push(ema);
    for (let i = period; i < closes.length; i++) {
      ema = closes[i] * k + ema * (1 - k);
      result.push(ema);
    }
  }
  return result.reverse();
}

function calcATR(candles: CandleData[], period: number): number {
  if (candles.length < period + 1) return 0;
  let sum = 0;
  for (let i = 0; i < period; i++) {
    const curr = candles[i];
    const prev = candles[i + 1];
    const tr = Math.max(curr.high - curr.low, Math.abs(curr.high - prev.close), Math.abs(curr.low - prev.close));
    sum += tr;
  }
  return sum / period;
}

function calcRSI(candles: CandleData[], period: number): number {
  if (candles.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = 0; i < period; i++) {
    const change = candles[i].close - candles[i + 1].close;
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function calcMACD(candles: CandleData[], fastPeriod: number, slowPeriod: number, signalPeriod: number): { macd: number; signal: number; histogram: number } {
  const fastEMA = calcEMA(candles, fastPeriod);
  const slowEMA = calcEMA(candles, slowPeriod);
  const macdLine = fastEMA - slowEMA;

  const macdSeries: number[] = [];
  const len = Math.min(candles.length, slowPeriod + signalPeriod + 10);
  for (let i = 0; i < len; i++) {
    const slice = candles.slice(i);
    if (slice.length < slowPeriod) break;
    macdSeries.push(calcEMA(slice, fastPeriod) - calcEMA(slice, slowPeriod));
  }

  let signal = macdLine;
  if (macdSeries.length >= signalPeriod) {
    const reversed = [...macdSeries].reverse();
    const k = 2 / (signalPeriod + 1);
    let ema = 0;
    for (let i = 0; i < signalPeriod; i++) ema += reversed[i];
    ema /= signalPeriod;
    for (let i = signalPeriod; i < reversed.length; i++) {
      ema = reversed[i] * k + ema * (1 - k);
    }
    signal = ema;
  }

  return { macd: macdLine, signal, histogram: macdLine - signal };
}

function calcADX(candles: CandleData[], period: number): { adx: number; plusDI: number; minusDI: number } {
  if (candles.length < period * 2 + 1) return { adx: 0, plusDI: 0, minusDI: 0 };
  const reversed = [...candles].reverse();
  const trArr: number[] = [];
  const plusDMArr: number[] = [];
  const minusDMArr: number[] = [];

  for (let i = 1; i < reversed.length; i++) {
    const curr = reversed[i];
    const prev = reversed[i - 1];
    trArr.push(Math.max(curr.high - curr.low, Math.abs(curr.high - prev.close), Math.abs(curr.low - prev.close)));
    const upMove = curr.high - prev.high;
    const downMove = prev.low - curr.low;
    plusDMArr.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDMArr.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }

  if (trArr.length < period) return { adx: 0, plusDI: 0, minusDI: 0 };

  const smooth = (arr: number[], p: number): number[] => {
    const res: number[] = [];
    let sum = 0;
    for (let i = 0; i < p; i++) sum += arr[i];
    res.push(sum);
    for (let i = p; i < arr.length; i++) {
      res.push(res[res.length - 1] - res[res.length - 1] / p + arr[i]);
    }
    return res;
  };

  const smoothTR = smooth(trArr, period);
  const smoothPlusDM = smooth(plusDMArr, period);
  const smoothMinusDM = smooth(minusDMArr, period);

  const dxArr: number[] = [];
  for (let i = 0; i < smoothTR.length; i++) {
    if (smoothTR[i] === 0) { dxArr.push(0); continue; }
    const pdi = (smoothPlusDM[i] / smoothTR[i]) * 100;
    const mdi = (smoothMinusDM[i] / smoothTR[i]) * 100;
    const diff = Math.abs(pdi - mdi);
    const sum = pdi + mdi;
    dxArr.push(sum === 0 ? 0 : (diff / sum) * 100);
  }

  if (dxArr.length < period) return { adx: 0, plusDI: 0, minusDI: 0 };
  let adx = 0;
  for (let i = 0; i < period; i++) adx += dxArr[i];
  adx /= period;
  for (let i = period; i < dxArr.length; i++) {
    adx = (adx * (period - 1) + dxArr[i]) / period;
  }

  const lastTR = smoothTR[smoothTR.length - 1];
  const plusDI = lastTR > 0 ? (smoothPlusDM[smoothPlusDM.length - 1] / lastTR) * 100 : 0;
  const minusDI = lastTR > 0 ? (smoothMinusDM[smoothMinusDM.length - 1] / lastTR) * 100 : 0;

  return { adx, plusDI, minusDI };
}

function calcBollingerBands(candles: CandleData[], period: number, stdDevMult: number): { upper: number; middle: number; lower: number; width: number } {
  if (candles.length < period) return { upper: 0, middle: 0, lower: 0, width: 0 };
  const closes = candles.slice(0, period).map(c => c.close);
  const middle = closes.reduce((a, b) => a + b, 0) / period;
  const variance = closes.reduce((s, p) => s + (p - middle) ** 2, 0) / period;
  const std = Math.sqrt(variance);
  const upper = middle + stdDevMult * std;
  const lower = middle - stdDevMult * std;
  return { upper, middle, lower, width: middle > 0 ? ((upper - lower) / middle) * 100 : 0 };
}

function calcStochastic(candles: CandleData[], kPeriod: number, dPeriod: number, smooth: number = 3): { k: number; d: number; prevK: number; prevD: number } {
  if (candles.length < kPeriod + dPeriod + smooth) return { k: 50, d: 50, prevK: 50, prevD: 50 };
  
  // Calculate raw %K values
  const rawKValues: number[] = [];
  for (let i = 0; i < dPeriod + smooth + 1; i++) {
    const slice = candles.slice(i, i + kPeriod);
    const highs = slice.map(c => c.high);
    const lows = slice.map(c => c.low);
    const highestHigh = Math.max(...highs);
    const lowestLow = Math.min(...lows);
    const currentClose = slice[0].close;
    const rawK = highestHigh !== lowestLow ? ((currentClose - lowestLow) / (highestHigh - lowestLow)) * 100 : 50;
    rawKValues.push(rawK);
  }
  
  // Smooth %K (Fast Stochastic becomes Slow Stochastic)
  const smoothedK: number[] = [];
  for (let i = 0; i <= rawKValues.length - smooth; i++) {
    const sum = rawKValues.slice(i, i + smooth).reduce((a, b) => a + b, 0);
    smoothedK.push(sum / smooth);
  }
  
  // Calculate %D (SMA of smoothed %K)
  const dValues: number[] = [];
  for (let i = 0; i <= smoothedK.length - dPeriod; i++) {
    const sum = smoothedK.slice(i, i + dPeriod).reduce((a, b) => a + b, 0);
    dValues.push(sum / dPeriod);
  }
  
  return {
    k: smoothedK[0] ?? 50,
    d: dValues[0] ?? 50,
    prevK: smoothedK[1] ?? 50,
    prevD: dValues[1] ?? 50,
  };
}

function calcVWAP(candles: CandleData[]): number {
  if (candles.length === 0) return 0;
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;
  // VWAP from oldest to newest
  const reversed = [...candles].reverse();
  for (const c of reversed) {
    const typicalPrice = (c.high + c.low + c.close) / 3;
    cumulativeTPV += typicalPrice * c.volume;
    cumulativeVolume += c.volume;
  }
  return cumulativeVolume > 0 ? cumulativeTPV / cumulativeVolume : candles[0].close;
}

function calcRSISeries(candles: CandleData[], period: number, length: number): number[] {
  const rsiValues: number[] = [];
  for (let i = 0; i < length && i + period < candles.length; i++) {
    rsiValues.push(calcRSI(candles.slice(i), period));
  }
  return rsiValues;
}

function getMA(candles: CandleData[], period: number, type: "sma" | "ema"): number {
  return type === "sma" ? calcSMA(candles, period) : calcEMA(candles, period);
}

function getMAAt(candles: CandleData[], period: number, type: "sma" | "ema", offset: number): number {
  return type === "sma" ? calcSMAAt(candles, period, offset) : calcEMAAt(candles, period, offset);
}

const MOVING_AVERAGES: IndicatorDefinition[] = [
  {
    id: "MA-1",
    name: "SMA Value",
    category: "Moving Averages",
    description: "Finds stocks trading above or below their Simple Moving Average. Use 'above 50 SMA' to find stocks in an uptrend, or 'below 200 SMA' to find stocks that have broken down. The SMA smooths out price noise by averaging the last N closing prices equally.",
    params: [
      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 0, min: 0, max: 200, step: 1, autoLink: { linkType: "sequenceOffset" } },
      { name: "period", label: "Period", type: "number", defaultValue: 50, min: 5, max: 500, step: 1 },
      { name: "direction", label: "Direction", type: "select", defaultValue: "above", options: ["above", "below"] },
    ],
    evaluate: (candles, params, _benchmarkCandles, upstreamData) => {
      const skip = upstreamData?.patternEndBar ?? params.skipBars ?? 0;
      const period = params.period ?? 50;
      const direction = params.direction ?? "above";
      if (candles.length < skip + period) return { pass: false, data: { _diagnostics: { value: 'insufficient data', threshold: `${direction} ${period} SMA` } } };
      const effectiveCandles = skip > 0 ? candles.slice(skip) : candles;
      const sma = calcSMA(effectiveCandles, period);
      const price = effectiveCandles[0].close;
      const pass = direction === "above" ? price > sma : price < sma;
      return { pass, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: `$${price.toFixed(2)}`, threshold: `${direction === "above" ? ">" : "<"} SMA $${sma.toFixed(2)}`, detail: `${((price / sma - 1) * 100).toFixed(1)}% ${price >= sma ? "above" : "below"}` } } };
    },
  },
  {
    id: "MA-2",
    name: "EMA Value",
    category: "Moving Averages",
    description: "Finds stocks trading above or below their Exponential Moving Average. The EMA reacts faster than SMA by weighting recent bars more heavily. Use 'above 21 EMA' for short-term momentum stocks, or 'below 50 EMA' for stocks losing their trend.",
    params: [
      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 0, min: 0, max: 200, step: 1, autoLink: { linkType: "sequenceOffset" } },
      { name: "period", label: "Period", type: "number", defaultValue: 21, min: 5, max: 500, step: 1 },
      { name: "direction", label: "Direction", type: "select", defaultValue: "above", options: ["above", "below"] },
    ],
    evaluate: (candles, params, _benchmarkCandles, upstreamData) => {
      const skip = upstreamData?.patternEndBar ?? params.skipBars ?? 0;
      const period = params.period ?? 21;
      const direction = params.direction ?? "above";
      if (candles.length < skip + period) return { pass: false, data: { _diagnostics: { value: 'insufficient data', threshold: `${direction} ${period} EMA` } } };
      const effectiveCandles = skip > 0 ? candles.slice(skip) : candles;
      const ema = calcEMA(effectiveCandles, period);
      const price = effectiveCandles[0].close;
      const pass = direction === "above" ? price > ema : price < ema;
      return { pass, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: `$${price.toFixed(2)}`, threshold: `${direction === "above" ? ">" : "<"} EMA $${ema.toFixed(2)}`, detail: `${((price / ema - 1) * 100).toFixed(1)}% ${price >= ema ? "above" : "below"}` } } };
    },
  },
  {
    id: "MA-3",
    name: "Price vs MA Distance",
    category: "Moving Averages",
    description: "Finds stocks within a specific percentage band around a moving average. Example: 0-5% above the 50 SMA catches stocks hugging the MA from above (a buy zone in an uptrend). Negative values find stocks below the MA. Great for pullback scans and 'near support' setups.",
    params: [
      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 0, min: 0, max: 200, step: 1, autoLink: { linkType: "sequenceOffset" } },
      { name: "period", label: "MA Period", type: "number", defaultValue: 50, min: 5, max: 500, step: 1 },
      { name: "maType", label: "MA Type", type: "select", defaultValue: "sma", options: ["sma", "ema"] },
      { name: "minPct", label: "Min % Distance", type: "number", defaultValue: 0, min: -100, max: 200, step: 0.5 },
      { name: "maxPct", label: "Max % Distance", type: "number", defaultValue: 10, min: -100, max: 200, step: 0.5 },
    ],
    evaluate: (candles, params, _benchmarkCandles, upstreamData) => {
      const skip = upstreamData?.patternEndBar ?? params.skipBars ?? 0;
      const period = params.period ?? 50;
      const maType = params.maType ?? "sma";
      const minPct = params.minPct ?? 0;
      const maxPct = params.maxPct ?? 10;
      if (candles.length < skip + period) return { pass: false, data: { _diagnostics: { value: 'insufficient data', threshold: `${minPct}% to ${maxPct}%` } } };
      const effectiveCandles = skip > 0 ? candles.slice(skip) : candles;
      const ma = getMA(effectiveCandles, period, maType);
      if (ma === 0) return { pass: false, data: { _diagnostics: { value: 'MA=0', threshold: `${minPct}% to ${maxPct}%` } } };
      const pct = ((effectiveCandles[0].close - ma) / ma) * 100;
      return { pass: pct >= minPct && pct <= maxPct, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: `${pct.toFixed(1)}%`, threshold: `${minPct}% to ${maxPct}%` } } };
    },
  },
  {
    id: "MA-4",
    name: "MA Slope",
    category: "Moving Averages",
    description: "Checks whether a moving average is trending up or down by measuring its slope over recent bars. A rising 50 SMA means the trend is healthy and price has been climbing. Use Min Slope > 0 to find uptrends only; use negative values to find declining MAs.",
    params: [
      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 0, min: 0, max: 200, step: 1, autoLink: { linkType: "sequenceOffset" } },
      { name: "period", label: "MA Period", type: "number", defaultValue: 50, min: 5, max: 500, step: 1 },
      { name: "maType", label: "MA Type", type: "select", defaultValue: "sma", options: ["sma", "ema"] },
      { name: "slopeDays", label: "Slope Lookback (bars)", type: "number", defaultValue: 10, min: 1, max: 60, step: 1 },
      { name: "minSlope", label: "Min Slope %", type: "number", defaultValue: 0, min: -50, max: 50, step: 0.1 },
    ],
    evaluate: (candles, params, _benchmarkCandles, upstreamData) => {
      const skip = upstreamData?.patternEndBar ?? params.skipBars ?? 0;
      const period = params.period ?? 50;
      const maType = params.maType ?? "sma";
      const slopeDays = params.slopeDays ?? 10;
      const minSlope = params.minSlope ?? 0;
      if (candles.length < skip + period + slopeDays) return { pass: false, data: { _diagnostics: { value: 'insufficient data', threshold: `≥${minSlope}%` } } };
      const effectiveCandles = skip > 0 ? candles.slice(skip) : candles;
      const maNow = getMA(effectiveCandles, period, maType);
      const maThen = getMAAt(effectiveCandles, period, maType, slopeDays);
      if (maThen === 0) return { pass: false, data: { _diagnostics: { value: 'MA=0', threshold: `≥${minSlope}%` } } };
      const slope = ((maNow - maThen) / maThen) * 100;
      return { pass: slope >= minSlope, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: `${slope.toFixed(2)}%`, threshold: `≥${minSlope}%`, detail: `over ${slopeDays} bars` } } };
    },
  },
  {
    id: "MA-5",
    name: "MA Stacking Order",
    category: "Moving Averages",
    description: "Finds stocks where three moving averages are lined up in order. Bullish stacking (Price > Short MA > Medium MA > Long MA) confirms a strong, organized uptrend — the kind institutions like to buy. This is a Minervini trend template staple. Bearish stacking finds downtrends.",
    params: [
      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 0, min: 0, max: 200, step: 1, autoLink: { linkType: "sequenceOffset" } },
      { name: "order", label: "Stack Order", type: "select", defaultValue: "bullish", options: ["bullish", "bearish"] },
      { name: "ma1", label: "Short MA", type: "number", defaultValue: 50, min: 5, max: 500, step: 1 },
      { name: "ma2", label: "Medium MA", type: "number", defaultValue: 150, min: 5, max: 500, step: 1 },
      { name: "ma3", label: "Long MA", type: "number", defaultValue: 200, min: 5, max: 500, step: 1 },
    ],
    evaluate: (candles, params, _benchmarkCandles, upstreamData) => {
      const skip = upstreamData?.patternEndBar ?? params.skipBars ?? 0;
      const order = params.order ?? "bullish";
      const ma1p = params.ma1 ?? 50;
      const ma2p = params.ma2 ?? 150;
      const ma3p = params.ma3 ?? 200;
      const needed = Math.max(ma1p, ma2p, ma3p);
      if (candles.length < skip + needed) return { pass: false, data: { _diagnostics: { value: 'insufficient data', threshold: `${order} stack` } } };
      const effectiveCandles = skip > 0 ? candles.slice(skip) : candles;
      const price = effectiveCandles[0].close;
      const v1 = calcSMA(effectiveCandles, ma1p);
      const v2 = calcSMA(effectiveCandles, ma2p);
      const v3 = calcSMA(effectiveCandles, ma3p);
      const pass = order === "bullish" ? (price > v1 && v1 > v2 && v2 > v3) : (price < v1 && v1 < v2 && v2 < v3);
      return { pass, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: `P$${price.toFixed(0)} ${ma1p}:$${v1.toFixed(0)} ${ma2p}:$${v2.toFixed(0)} ${ma3p}:$${v3.toFixed(0)}`, threshold: `${order} stack` } } };
    },
  },
  {
    id: "MA-6",
    name: "MA Distance / Convergence",
    category: "Moving Averages",
    description: "Finds stocks where two moving averages are close together. When the 50 and 200 SMA are within 5% of each other, the stock is at a decision point — a crossover may be near. Use this to catch stocks where moving averages are converging, which often precedes a trend change.",
    params: [
      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 0, min: 0, max: 200, step: 1, autoLink: { linkType: "sequenceOffset" } },
      { name: "fastPeriod", label: "Fast MA Period", type: "number", defaultValue: 50, min: 5, max: 500, step: 1 },
      { name: "slowPeriod", label: "Slow MA Period", type: "number", defaultValue: 200, min: 5, max: 500, step: 1 },
      { name: "maType", label: "MA Type", type: "select", defaultValue: "sma", options: ["sma", "ema"] },
      { name: "maxDistance", label: "Max Distance %", type: "number", defaultValue: 5, min: 0, max: 50, step: 0.5 },
    ],
    evaluate: (candles, params, _benchmarkCandles, upstreamData) => {
      const skip = upstreamData?.patternEndBar ?? params.skipBars ?? 0;
      const fastP = params.fastPeriod ?? 50;
      const slowP = params.slowPeriod ?? 200;
      const maType = params.maType ?? "sma";
      const maxDist = params.maxDistance ?? 5;
      if (candles.length < skip + Math.max(fastP, slowP)) return { pass: false, data: { _diagnostics: { value: 'insufficient data', threshold: `≤${maxDist}%` } } };
      const effectiveCandles = skip > 0 ? candles.slice(skip) : candles;
      const fastMA = getMA(effectiveCandles, fastP, maType);
      const slowMA = getMA(effectiveCandles, slowP, maType);
      if (slowMA === 0) return { pass: false, data: { _diagnostics: { value: 'slow MA=0', threshold: `≤${maxDist}%` } } };
      const dist = Math.abs((fastMA - slowMA) / slowMA) * 100;
      return { pass: dist <= maxDist, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: `${dist.toFixed(1)}%`, threshold: `≤${maxDist}%`, detail: `fast $${fastMA.toFixed(2)} vs slow $${slowMA.toFixed(2)}` } } };
    },
  },
  {
    id: "MA-7",
    name: "MA Crossover",
    category: "Moving Averages",
    description: "Finds stocks where a fast MA recently crossed above or below a slow MA. A bullish cross (50 above 200 = golden cross) signals a new uptrend starting. Set a short lookback (3-5 bars) to catch fresh crosses, or longer (10-20) to find crosses that happened recently.",
    params: [
      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 0, min: 0, max: 200, step: 1, autoLink: { linkType: "sequenceOffset" } },
      { name: "fastPeriod", label: "Fast MA Period", type: "number", defaultValue: 50, min: 5, max: 500, step: 1 },
      { name: "slowPeriod", label: "Slow MA Period", type: "number", defaultValue: 200, min: 5, max: 500, step: 1 },
      { name: "maType", label: "MA Type", type: "select", defaultValue: "sma", options: ["sma", "ema"] },
      { name: "lookback", label: "Lookback (bars)", type: "number", defaultValue: 5, min: 1, max: 30, step: 1 },
      { name: "crossType", label: "Cross Type", type: "select", defaultValue: "bullish", options: ["bullish", "bearish"] },
    ],
    evaluate: (candles, params, _benchmarkCandles, upstreamData) => {
      const skip = upstreamData?.patternEndBar ?? params.skipBars ?? 0;
      const fastP = params.fastPeriod ?? 50;
      const slowP = params.slowPeriod ?? 200;
      const maType = params.maType ?? "sma";
      const lookback = params.lookback ?? 5;
      const crossType = params.crossType ?? "bullish";
      const needed = Math.max(fastP, slowP) + lookback;
      if (candles.length < skip + needed) return { pass: false, data: { _diagnostics: { value: 'insufficient data', threshold: `${crossType} within ${lookback} bars` } } };
      const effectiveCandles = skip > 0 ? candles.slice(skip) : candles;
      const fastNowVal = getMAAt(effectiveCandles, fastP, maType, 0);
      const slowNowVal = getMAAt(effectiveCandles, slowP, maType, 0);
      for (let i = 0; i < lookback; i++) {
        const fastNow = getMAAt(effectiveCandles, fastP, maType, i);
        const slowNow = getMAAt(effectiveCandles, slowP, maType, i);
        const fastPrev = getMAAt(effectiveCandles, fastP, maType, i + 1);
        const slowPrev = getMAAt(effectiveCandles, slowP, maType, i + 1);
        if (crossType === "bullish" && fastPrev <= slowPrev && fastNow > slowNow) return { pass: true, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: `cross at bar ${i}`, threshold: `${crossType} within ${lookback} bars`, detail: `fast $${fastNowVal.toFixed(2)} vs slow $${slowNowVal.toFixed(2)}` } } };
        if (crossType === "bearish" && fastPrev >= slowPrev && fastNow < slowNow) return { pass: true, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: `cross at bar ${i}`, threshold: `${crossType} within ${lookback} bars`, detail: `fast $${fastNowVal.toFixed(2)} vs slow $${slowNowVal.toFixed(2)}` } } };
      }
      return { pass: false, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: 'no cross', threshold: `${crossType} within ${lookback} bars`, detail: `fast $${fastNowVal.toFixed(2)} vs slow $${slowNowVal.toFixed(2)}` } } };
    },
  },
  {
    id: "MA-8",
    name: "MA Comparison",
    category: "Moving Averages",
    description: "Checks if one MA is currently above or below another — without requiring a recent cross. Use '50 SMA above 200 SMA' to confirm a stock is in a confirmed uptrend. Unlike MA Crossover, this doesn't care when the cross happened — just the current relationship.",
    params: [
      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 0, min: 0, max: 200, step: 1, autoLink: { linkType: "sequenceOffset" } },
      { name: "fastPeriod", label: "Fast MA Period", type: "number", defaultValue: 50, min: 5, max: 500, step: 1 },
      { name: "slowPeriod", label: "Slow MA Period", type: "number", defaultValue: 200, min: 5, max: 500, step: 1 },
      { name: "maType", label: "MA Type", type: "select", defaultValue: "sma", options: ["sma", "ema"] },
      { name: "direction", label: "Direction", type: "select", defaultValue: "fast_above_slow", options: ["fast_above_slow", "fast_below_slow"] },
    ],
    evaluate: (candles, params, _benchmarkCandles, upstreamData) => {
      const skip = upstreamData?.patternEndBar ?? params.skipBars ?? 0;
      const fastP = params.fastPeriod ?? 50;
      const slowP = params.slowPeriod ?? 200;
      const maType = params.maType ?? "sma";
      const direction = params.direction ?? "fast_above_slow";
      if (candles.length < skip + Math.max(fastP, slowP)) return { pass: false, data: { _diagnostics: { value: 'insufficient data', threshold: direction } } };
      const effectiveCandles = skip > 0 ? candles.slice(skip) : candles;
      const fastMA = getMA(effectiveCandles, fastP, maType);
      const slowMA = getMA(effectiveCandles, slowP, maType);
      const pass = direction === "fast_above_slow" ? fastMA > slowMA : fastMA < slowMA;
      const gap = slowMA > 0 ? ((fastMA - slowMA) / slowMA * 100).toFixed(1) : '0';
      return { pass, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: `fast $${fastMA.toFixed(2)} vs slow $${slowMA.toFixed(2)}`, threshold: direction, detail: `gap ${gap}%` } } };
    },
  },
  {
    id: "MA-9",
    name: "Price Crosses MA",
    category: "Moving Averages",
    description: "Finds stocks where the price itself recently crossed above or below a single MA. Unlike MA Crossover (which compares two MAs), this checks price vs one MA. Use 'price crossed above 50 SMA' to find stocks reclaiming a key trend line, or 'crossed below 21 EMA' for breakdowns. Use 'any' to find crosses in either direction.",
    params: [
      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 0, min: 0, max: 200, step: 1, autoLink: { linkType: "sequenceOffset" } },
      { name: "maPeriod", label: "MA Period", type: "number", defaultValue: 50, min: 5, max: 500, step: 1 },
      { name: "maType", label: "MA Type", type: "select", defaultValue: "sma", options: ["sma", "ema"] },
      { name: "lookback", label: "Lookback (bars)", type: "number", defaultValue: 5, min: 1, max: 30, step: 1 },
      { name: "crossType", label: "Cross Direction", type: "select", defaultValue: "above", options: ["above", "below", "any"] },
    ],
    evaluate: (candles, params, _benchmarkCandles, upstreamData) => {
      const skip = upstreamData?.patternEndBar ?? params.skipBars ?? 0;
      const maPeriod = params.maPeriod ?? 50;
      const maType = params.maType ?? "sma";
      const lookback = params.lookback ?? 5;
      const crossType = params.crossType ?? "above";
      if (candles.length < skip + maPeriod + lookback + 1) return { pass: false, data: { _diagnostics: { value: 'insufficient data', threshold: `price ${crossType} ${maPeriod} ${maType} within ${lookback} bars` } } };
      const effectiveCandles = skip > 0 ? candles.slice(skip) : candles;
      const currentMA = getMAAt(effectiveCandles, maPeriod, maType, 0);
      const currentPrice = effectiveCandles[0].close;
      for (let i = 0; i < lookback; i++) {
        const maNow = getMAAt(effectiveCandles, maPeriod, maType, i);
        const maPrev = getMAAt(effectiveCandles, maPeriod, maType, i + 1);
        if (maNow === 0 || maPrev === 0) continue;
        const priceNow = effectiveCandles[i].close;
        const pricePrev = effectiveCandles[i + 1].close;
        const crossedAbove = pricePrev <= maPrev && priceNow > maNow;
        const crossedBelow = pricePrev >= maPrev && priceNow < maNow;
        if (crossType === "above" && crossedAbove) return { pass: true, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: `cross above at bar ${i}`, threshold: `price ${crossType} within ${lookback} bars`, detail: `price $${currentPrice.toFixed(2)} vs MA $${currentMA.toFixed(2)}` } } };
        if (crossType === "below" && crossedBelow) return { pass: true, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: `cross below at bar ${i}`, threshold: `price ${crossType} within ${lookback} bars`, detail: `price $${currentPrice.toFixed(2)} vs MA $${currentMA.toFixed(2)}` } } };
        if (crossType === "any" && (crossedAbove || crossedBelow)) {
          const direction = crossedAbove ? "above" : "below";
          return { pass: true, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, crossDirection: direction, _diagnostics: { value: `cross ${direction} at bar ${i}`, threshold: `price cross (any) within ${lookback} bars`, detail: `price $${currentPrice.toFixed(2)} vs MA $${currentMA.toFixed(2)}` } } };
        }
      }
      return { pass: false, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: 'no cross', threshold: `price ${crossType} within ${lookback} bars`, detail: `price $${currentPrice.toFixed(2)} vs MA $${currentMA.toFixed(2)}` } } };
    },
  },
];

const VOLUME: IndicatorDefinition[] = [
  {
    id: "VOL-1",
    name: "Volume vs Average",
    category: "Volume",
    description: "Finds stocks where today's volume is unusually high compared to the average. A 1.5x multiple means volume is 50% above normal — something is happening. Great for confirming breakouts, institutional activity, or news-driven moves. Higher multiples catch bigger spikes.",
    params: [
      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 0, min: 0, max: 200, step: 1, autoLink: { linkType: "sequenceOffset" } },
      { name: "period", label: "Avg Volume Period", type: "number", defaultValue: 50, min: 5, max: 200, step: 1 },
      { name: "minMultiple", label: "Min Multiple", type: "number", defaultValue: 1.5, min: 0.1, max: 20, step: 0.1 },
    ],
    evaluate: (candles, params, _benchmarkCandles, upstreamData) => {
      const skip = upstreamData?.patternEndBar ?? params.skipBars ?? 0;
      const period = params.period ?? 50;
      const minMult = params.minMultiple ?? 1.5;
      if (candles.length < skip + period + 1) return { pass: false, data: { _diagnostics: { value: 'insufficient data', threshold: `≥${minMult}x` } } };
      const effectiveCandles = skip > 0 ? candles.slice(skip) : candles;
      const avgVol = effectiveCandles.slice(1, period + 1).reduce((s, c) => s + c.volume, 0) / period;
      if (avgVol === 0) return { pass: false, data: { _diagnostics: { value: 'avg vol=0', threshold: `≥${minMult}x` } } };
      const ratio = effectiveCandles[0].volume / avgVol;
      return { pass: ratio >= minMult, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: `${ratio.toFixed(1)}x avg`, threshold: `≥${minMult}x` } } };
    },
  },
  {
    id: "VOL-2",
    name: "Volume Trend",
    category: "Volume",
    description: "Detects whether volume is ramping up or fading over time. Compares the average volume over recent bars to a longer baseline. 'Increasing' finds stocks gaining trading interest (accumulation); 'Decreasing' finds stocks where volume is drying up (potential base forming).",
    params: [
      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 0, min: 0, max: 200, step: 1, autoLink: { linkType: "sequenceOffset" } },
      { name: "recentPeriod", label: "Recent Period", type: "number", defaultValue: 10, min: 3, max: 50, step: 1 },
      { name: "baselinePeriod", label: "Baseline Period", type: "number", defaultValue: 50, min: 10, max: 200, step: 1 },
      { name: "direction", label: "Trend Direction", type: "select", defaultValue: "increasing", options: ["increasing", "decreasing"] },
      { name: "threshold", label: "Min Change %", type: "number", defaultValue: 20, min: 0, max: 200, step: 5 },
    ],
    evaluate: (candles, params, _benchmarkCandles, upstreamData) => {
      const skip = upstreamData?.patternEndBar ?? params.skipBars ?? 0;
      const recentP = params.recentPeriod ?? 10;
      const baseP = params.baselinePeriod ?? 50;
      const direction = params.direction ?? "increasing";
      const threshold = params.threshold ?? 20;
      if (candles.length < skip + baseP) return { pass: false, data: { _diagnostics: { value: 'insufficient data', threshold: `${direction} ≥${threshold}%` } } };
      const effectiveCandles = skip > 0 ? candles.slice(skip) : candles;
      const recentAvg = effectiveCandles.slice(0, recentP).reduce((s, c) => s + c.volume, 0) / recentP;
      const baseAvg = effectiveCandles.slice(0, baseP).reduce((s, c) => s + c.volume, 0) / baseP;
      if (baseAvg === 0) return { pass: false, data: { _diagnostics: { value: 'baseline=0', threshold: `${direction} ≥${threshold}%` } } };
      const changePct = ((recentAvg - baseAvg) / baseAvg) * 100;
      const pass = direction === "increasing" ? changePct >= threshold : changePct <= -threshold;
      const fmtRecent = recentAvg >= 1e6 ? `${(recentAvg/1e6).toFixed(1)}M` : `${(recentAvg/1e3).toFixed(0)}K`;
      const fmtBase = baseAvg >= 1e6 ? `${(baseAvg/1e6).toFixed(1)}M` : `${(baseAvg/1e3).toFixed(0)}K`;
      return { pass, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: `${changePct.toFixed(1)}%`, threshold: `${direction === "increasing" ? "≥" : "≤-"}${threshold}%`, detail: `recent avg: ${fmtRecent} vs baseline avg: ${fmtBase}` } } };
    },
  },
  {
    id: "VOL-3",
    name: "Up/Down Volume Ratio",
    category: "Volume",
    description: "Measures buying pressure vs selling pressure by comparing volume on up-days to volume on down-days. A ratio above 1.0 means more volume flows in on green bars — a sign of accumulation. Ratios of 1.5+ suggest strong institutional buying interest. Below 1.0 means distribution.",
    params: [
      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 0, min: 0, max: 200, step: 1, autoLink: { linkType: "sequenceOffset" } },
      { name: "period", label: "Period", type: "number", defaultValue: 20, min: 5, max: 100, step: 1 },
      { name: "minRatio", label: "Min Ratio", type: "number", defaultValue: 1.2, min: 0.1, max: 10, step: 0.1 },
    ],
    evaluate: (candles, params, _benchmarkCandles, upstreamData) => {
      const skip = upstreamData?.patternEndBar ?? params.skipBars ?? 0;
      const period = params.period ?? 20;
      const minRatio = params.minRatio ?? 1.2;
      if (candles.length < skip + period + 1) return { pass: false, data: { _diagnostics: { value: 'insufficient data', threshold: `≥${minRatio}x` } } };
      const effectiveCandles = skip > 0 ? candles.slice(skip) : candles;
      let upVol = 0;
      let downVol = 0;
      for (let i = 0; i < period; i++) {
        if (effectiveCandles[i].close >= effectiveCandles[i + 1].close) upVol += effectiveCandles[i].volume;
        else downVol += effectiveCandles[i].volume;
      }
      if (downVol === 0) {
        const pass = upVol > 0;
        return { pass, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: `∞ (no down vol)`, threshold: `≥${minRatio}x` } } };
      }
      const ratio = upVol / downVol;
      return { pass: ratio >= minRatio, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: `${ratio.toFixed(2)}x`, threshold: `≥${minRatio}x` } } };
    },
  },
  {
    id: "VOL-4",
    name: "Volume Dry-Up",
    category: "Volume",
    description: "Finds stocks where volume has been consistently quiet for several bars in a row — all recent bars below a fraction of the average. This 'dry-up' pattern often appears right before breakouts as sellers dry up and supply evaporates. Combine with tightness indicators for coiling setups.",
    params: [
      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 0, min: 0, max: 200, step: 1, autoLink: { linkType: "sequenceOffset" } },
      { name: "period", label: "Avg Volume Period", type: "number", defaultValue: 50, min: 10, max: 200, step: 1 },
      { name: "dryUpDays", label: "Dry-Up Window (bars)", type: "number", defaultValue: 5, min: 1, max: 20, step: 1 },
      { name: "maxMultiple", label: "Max Volume Multiple", type: "number", defaultValue: 0.5, min: 0.1, max: 1, step: 0.05 },
    ],
    evaluate: (candles, params, _benchmarkCandles, upstreamData) => {
      const skip = upstreamData?.patternEndBar ?? params.skipBars ?? 0;
      const period = params.period ?? 50;
      const dryUpDays = params.dryUpDays ?? 5;
      const maxMult = params.maxMultiple ?? 0.5;
      if (candles.length < skip + dryUpDays + period) return { pass: false, data: { _diagnostics: { value: 'insufficient data', threshold: `≤${maxMult}x for ${dryUpDays} bars` } } };
      const effectiveCandles = skip > 0 ? candles.slice(skip) : candles;
      const avgVol = effectiveCandles.slice(dryUpDays, dryUpDays + period).reduce((s, c) => s + c.volume, 0) / period;
      if (avgVol === 0) return { pass: false, data: { _diagnostics: { value: 'avg vol=0', threshold: `≤${maxMult}x for ${dryUpDays} bars` } } };
      let maxSeen = 0;
      let allBelow = true;
      for (let i = 0; i < dryUpDays; i++) {
        const r = effectiveCandles[i].volume / avgVol;
        if (r > maxSeen) maxSeen = r;
        if (r > maxMult) allBelow = false;
      }
      return { pass: allBelow, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: `max ${maxSeen.toFixed(2)}x avg`, threshold: `≤${maxMult}x for ${dryUpDays} bars` } } };
    },
  },
];

const PRICE_ACTION: IndicatorDefinition[] = [
  {
    id: "PA-1",
    name: "ATR",
    category: "Price Action",
    description: "Filters stocks by their Average True Range — a measure of daily price movement in dollar terms. Stocks with very low ATR are too quiet to trade; stocks with very high ATR may be too volatile. Use Min/Max ATR to find your sweet spot for risk management.",
    params: [
      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 0, min: 0, max: 200, step: 1, autoLink: { linkType: "sequenceOffset" } },
      { name: "period", label: "ATR Period", type: "number", defaultValue: 14, min: 5, max: 50, step: 1 },
      { name: "minATR", label: "Min ATR", type: "number", defaultValue: 0, min: 0, max: 100, step: 0.1 },
      { name: "maxATR", label: "Max ATR", type: "number", defaultValue: 999, min: 0, max: 1000, step: 0.1 },
    ],
    evaluate: (candles, params, _benchmarkCandles, upstreamData) => {
      const skip = upstreamData?.patternEndBar ?? params.skipBars ?? 0;
      const period = params.period ?? 14;
      const minATR = params.minATR ?? 0;
      const maxATR = params.maxATR ?? 999;
      if (candles.length < skip + period + 1) return { pass: false, data: { _diagnostics: { value: 'insufficient data', threshold: `$${minATR}-$${maxATR}` } } };
      const effectiveCandles = skip > 0 ? candles.slice(skip) : candles;
      const atr = calcATR(effectiveCandles, period);
      return { pass: atr >= minATR && atr <= maxATR, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: `$${atr.toFixed(2)}`, threshold: `$${minATR}-$${maxATR}` } } };
    },
  },
  {
    id: "PA-2",
    name: "ATR Percent",
    category: "Price Action",
    description: "Filters stocks by ATR as a percentage of the stock price — normalizing volatility across all price levels. A $200 stock with $4 ATR = 2% (calm); a $20 stock with $3 ATR = 15% (wild). Use this instead of raw ATR when scanning across different-priced stocks.",
    params: [
      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 0, min: 0, max: 200, step: 1, autoLink: { linkType: "sequenceOffset" } },
      { name: "period", label: "ATR Period", type: "number", defaultValue: 14, min: 5, max: 50, step: 1 },
      { name: "minPct", label: "Min ATR %", type: "number", defaultValue: 2, min: 0, max: 50, step: 0.1 },
      { name: "maxPct", label: "Max ATR %", type: "number", defaultValue: 8, min: 0, max: 50, step: 0.1 },
    ],
    evaluate: (candles, params, _benchmarkCandles, upstreamData) => {
      const skip = upstreamData?.patternEndBar ?? params.skipBars ?? 0;
      const period = params.period ?? 14;
      const minPct = params.minPct ?? 2;
      const maxPct = params.maxPct ?? 8;
      if (candles.length < skip + period + 1) return { pass: false, data: { _diagnostics: { value: 'insufficient data', threshold: `${minPct}%-${maxPct}%` } } };
      const effectiveCandles = skip > 0 ? candles.slice(skip) : candles;
      if (effectiveCandles[0].close === 0) return { pass: false, data: { _diagnostics: { value: 'price=0', threshold: `${minPct}%-${maxPct}%` } } };
      const atr = calcATR(effectiveCandles, period);
      const pct = (atr / effectiveCandles[0].close) * 100;
      return { pass: pct >= minPct && pct <= maxPct, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: `${pct.toFixed(1)}%`, threshold: `${minPct}%-${maxPct}%`, detail: `ATR $${atr.toFixed(2)} / price $${effectiveCandles[0].close.toFixed(2)}` } } };
    },
  },
  {
    id: "PA-3",
    name: "Consolidation / Base Detection",
    category: "Price Action",
    description: "The core base-building indicator. Scans recent bars to find a flat sideways zone where price traded within a tight range. The allowed range tightens as the base gets longer, so short bases can be wider and long bases must be tighter. Rejects bases where price is sitting in the lower half (weak), where the base drifts/slopes too much, or where most closes aren't in the upper portion. Key knobs: Max Range %, Max Slope %, and Min Base Length directly control which stocks pass. Drifter Tolerance affects how far the base extends (and the detected length passed downstream to Prior Advance / Smooth Advance) but won't change pass/fail on its own — it matters most when paired with Min Base % of Lookback or downstream indicators. When connected downstream from Find Base (CB-1), automatically limits its search to bars BEFORE the historical base to prevent overlap.",
    provides: [{ linkType: "basePeriod", paramName: "period" }],
    consumes: [{ paramName: "maxBaseLimit", dataKey: "baseEndBar" }],
    params: [
      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 0, min: 0, max: 200, step: 1, autoLink: { linkType: "sequenceOffset" } },
      { name: "period", label: "Max Base Length", type: "number", defaultValue: 20, min: 5, max: 100, step: 1 },
      { name: "minPeriod", label: "Min Base Length", type: "number", defaultValue: 5, min: 5, max: 50, step: 1 },
      { name: "maxRange", label: "Max Range %", type: "number", defaultValue: 15, min: 1, max: 50, step: 0.5 },
      { name: "maxSlope", label: "Max Slope %", type: "number", defaultValue: 5, min: 0.5, max: 15, step: 0.5 },
      { name: "drifterPct", label: "Drifter Tolerance %", type: "number", defaultValue: 10, min: 0, max: 25, step: 1 },
      { name: "minBasePct", label: "Min Base % of Lookback", type: "number", defaultValue: 0, min: 0, max: 100, step: 5 },
    ],
    evaluate: (candles, params, _benchmarkCandles, upstreamData) => {
      const skip = upstreamData?.patternEndBar ?? params.skipBars ?? 0;
      const maxPeriod = params.period ?? 20;
      const minPeriod = Math.max(5, params.minPeriod ?? 5);
      const maxRange = params.maxRange ?? 15;
      const maxSlope = params.maxSlope ?? 5;
      const drifterPct = params.drifterPct ?? 10;
      const minBasePct = params.minBasePct ?? 0;
      if (candles.length < skip + minPeriod) return { pass: false, data: { _diagnostics: { value: 'insufficient data', threshold: `≥${minPeriod} bars, ≤${maxRange}% range` } } };

      const effectiveCandles = skip > 0 ? candles.slice(skip) : candles;
      const upstreamBaseEnd = typeof upstreamData?.baseEndBar === "number" ? upstreamData.baseEndBar : null;
      const effectiveMaxPeriod = upstreamBaseEnd !== null ? Math.min(maxPeriod, Math.max(0, upstreamBaseEnd - skip)) : maxPeriod;
      if (upstreamBaseEnd !== null && effectiveMaxPeriod < minPeriod) {
        return { pass: false, data: { _diagnostics: { value: `upstream base too close (bar ${upstreamBaseEnd})`, threshold: `need ≥${minPeriod} bars before historical base` } } };
      }
      const maxLen = Math.min(effectiveMaxPeriod, effectiveCandles.length);

      const recentSlice = effectiveCandles.slice(0, minPeriod);
      const refHigh = Math.max(...recentSlice.map(c => c.high));
      const refLow = Math.min(...recentSlice.map(c => c.low));

      if (refHigh === 0) return { pass: false, data: { _diagnostics: { value: 'no base found', threshold: `≥${minPeriod} bars, ≤${maxRange}% range` } } };
      const initRangePct = ((refHigh - refLow) / refHigh) * 100;
      if (initRangePct > maxRange) return { pass: false, data: { _diagnostics: { value: `range ${initRangePct.toFixed(1)}%`, threshold: `≤${maxRange}% range` } } };

      const minRequired = Math.max(minPeriod, Math.ceil(maxPeriod * minBasePct / 100));

      const passesQuality = (len: number): boolean => {
        const baseSlice = effectiveCandles.slice(0, len);
        const closes = baseSlice.map(c => c.close);
        const baseHigh = Math.max(...baseSlice.map(c => c.high));
        const baseLow = Math.min(...baseSlice.map(c => c.low));
        const n = closes.length;
        const sumX = (n * (n - 1)) / 2;
        const sumX2 = ((n - 1) * n * (2 * n - 1)) / 6;
        let sumY = 0, sumXY = 0;
        for (let i = 0; i < n; i++) {
          sumY += closes[i];
          sumXY += i * closes[i];
        }
        const denom = n * sumX2 - sumX * sumX;
        if (denom === 0) return false;
        const slope = (n * sumXY - sumX * sumY) / denom;
        const avgPrice = sumY / n;
        if (avgPrice === 0) return false;
        const totalDrift = Math.abs((slope / avgPrice) * 100 * n);
        if (totalDrift > maxSlope) return false;
        const currentClose = closes[0];
        const posInRange = baseHigh === baseLow ? 1 : (currentClose - baseLow) / (baseHigh - baseLow);
        if (posInRange < 0.5) return false;
        let upperCount = 0;
        for (let i = 0; i < n; i++) {
          const pos = baseHigh === baseLow ? 1 : (closes[i] - baseLow) / (baseHigh - baseLow);
          if (pos >= 0.4) upperCount++;
        }
        if (upperCount / n < 0.5) return false;
        return true;
      };

      let bestPass = 0;

      let detectedLen = minPeriod;
      let drifterCount = 0;
      let runHigh = refHigh;
      let runLow = refLow;

      if (detectedLen >= minRequired && passesQuality(detectedLen)) {
        bestPass = detectedLen;
      }

      for (let i = minPeriod; i < maxLen; i++) {
        const bar = effectiveCandles[i];
        if (bar.high === 0) break;
        const testHigh = Math.max(runHigh, bar.high);
        const testLow = Math.min(runLow, bar.low);
        const testRangePct = ((testHigh - testLow) / testHigh) * 100;
        const currentLen = i + 1;
        const lengthRatio = currentLen / minPeriod;
        const scaledMaxRange = maxRange / Math.sqrt(lengthRatio);
        const barOutside = testRangePct > scaledMaxRange;
        if (barOutside) {
          drifterCount++;
          const allowedDrifters = Math.floor(currentLen * drifterPct / 100);
          if (drifterCount > allowedDrifters) break;
        } else {
          runHigh = testHigh;
          runLow = testLow;
        }
        detectedLen = currentLen;
        if (detectedLen >= minRequired && passesQuality(detectedLen)) {
          bestPass = detectedLen;
        }
      }

      if (bestPass === 0) return { pass: false, data: { _diagnostics: { value: 'no base found', threshold: `≥${minRequired} bars, ≤${maxRange}% range` } } };
      const finalSlice = effectiveCandles.slice(0, bestPass);
      const finalHigh = Math.max(...finalSlice.map(c => c.high));
      const finalLow = Math.min(...finalSlice.map(c => c.low));
      const rangePct = finalHigh > 0 ? ((finalHigh - finalLow) / finalHigh) * 100 : 0;

      const avgBaseVolume = finalSlice.reduce((s, c) => s + (c.volume || 0), 0) / finalSlice.length;
      const preBaseStart = bestPass;
      const preBaseEnd = Math.min(bestPass + bestPass, effectiveCandles.length);
      const preBaseSlice = effectiveCandles.slice(preBaseStart, preBaseEnd);
      const avgPreBaseVolume = preBaseSlice.length > 0
        ? preBaseSlice.reduce((s, c) => s + (c.volume || 0), 0) / preBaseSlice.length
        : avgBaseVolume;
      const volumeFadeRatio = avgPreBaseVolume > 0 ? avgBaseVolume / avgPreBaseVolume : 1;

      return { pass: true, data: {
        evaluationStartBar: skip,
        evaluationEndBar: skip,
        patternEndBar: skip,
        detectedPeriod: bestPass,
        baseTopPrice: finalHigh,
        baseBottomPrice: finalLow,
        baseDepthPct: rangePct,
        avgBaseVolume: Math.round(avgBaseVolume),
        avgPreBaseVolume: Math.round(avgPreBaseVolume),
        volumeFadeRatio: Math.round(volumeFadeRatio * 100) / 100,
        _cocHighlight: { type: "baseZone", topPrice: finalHigh, lowPrice: finalLow, startBar: bestPass, endBar: 0 },
        _diagnostics: { value: `${bestPass} bars`, threshold: `≥${minRequired} bars`, detail: `range ${rangePct.toFixed(1)}% (max ${maxRange}%), top $${finalHigh.toFixed(2)}, vol fade ${volumeFadeRatio.toFixed(2)}x` }
      } };
    },
  },
  {
    id: "PA-4",
    name: "Base Depth",
    category: "Price Action",
    description: "Measures how deep the current pullback is from the highest price over a lookback window. Shallow bases (10-20% correction) suggest institutions are holding — strong demand. Deep corrections (30%+) may signal damaged charts. Use Min Depth to exclude stocks that haven't pulled back at all.",
    params: [
      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 0, min: 0, max: 200, step: 1, autoLink: { linkType: "sequenceOffset" } },
      { name: "lookback", label: "Lookback Period", type: "number", defaultValue: 60, min: 10, max: 260, step: 5 },
      { name: "maxDepth", label: "Max Depth %", type: "number", defaultValue: 25, min: 1, max: 60, step: 1 },
      { name: "minDepth", label: "Min Depth %", type: "number", defaultValue: 5, min: 0, max: 50, step: 1 },
    ],
    evaluate: (candles, params, _benchmarkCandles, upstreamData) => {
      const skip = upstreamData?.patternEndBar ?? params.skipBars ?? 0;
      const lookback = params.lookback ?? 60;
      const maxDepth = params.maxDepth ?? 25;
      const minDepth = params.minDepth ?? 5;
      if (candles.length < skip + lookback) return { pass: false, data: { _diagnostics: { value: 'insufficient data', threshold: `${minDepth}%-${maxDepth}%` } } };
      const effectiveCandles = skip > 0 ? candles.slice(skip) : candles;
      const slice = effectiveCandles.slice(0, lookback);
      const highVal = Math.max(...slice.map(c => c.high));
      if (highVal === 0) return { pass: false, data: { _diagnostics: { value: 'high=0', threshold: `${minDepth}%-${maxDepth}%` } } };
      const currentLow = Math.min(...slice.map(c => c.low));
      const depth = ((highVal - currentLow) / highVal) * 100;
      const pa4Pass = depth >= minDepth && depth <= maxDepth;
      return { pass: pa4Pass, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, ...(pa4Pass ? { _cocHighlight: { type: "resistanceLine", level: highVal, startBar: lookback, endBar: 0 } } : {}), _diagnostics: { value: `${depth.toFixed(1)}%`, threshold: `${minDepth}%-${maxDepth}%` } } };
    },
  },
  {
    id: "PA-5",
    name: "Base Count",
    category: "Price Action",
    description: "Counts how many separate consolidation pauses a stock has made during its advance. 1st and 2nd bases are highest probability for breakouts — later bases (3rd, 4th+) increasingly fail as the move gets extended. Set Max Bases to 2-3 to focus on early-stage leaders.",
    params: [
      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 0, min: 0, max: 200, step: 1, autoLink: { linkType: "sequenceOffset" } },
      { name: "lookback", label: "Lookback Period", type: "number", defaultValue: 120, min: 30, max: 500, step: 10 },
      { name: "consolidationRange", label: "Base Range %", type: "number", defaultValue: 15, min: 5, max: 30, step: 1 },
      { name: "minBaseDays", label: "Min Base Width (bars)", type: "number", defaultValue: 10, min: 3, max: 30, step: 1 },
      { name: "maxBases", label: "Max Bases", type: "number", defaultValue: 3, min: 1, max: 10, step: 1 },
    ],
    evaluate: (candles, params, _benchmarkCandles, upstreamData) => {
      const skip = upstreamData?.patternEndBar ?? params.skipBars ?? 0;
      const lookback = params.lookback ?? 120;
      const consolRange = params.consolidationRange ?? 15;
      const minBaseDays = params.minBaseDays ?? 10;
      const maxBases = params.maxBases ?? 3;
      if (candles.length < skip + lookback) return { pass: false, data: { _diagnostics: { value: 'insufficient data', threshold: `1-${maxBases} bases` } } };
      const effectiveCandles = skip > 0 ? candles.slice(skip) : candles;
      const slice = effectiveCandles.slice(0, lookback).reverse();
      let baseCount = 0;
      let i = 0;
      while (i < slice.length - minBaseDays) {
        const window = slice.slice(i, i + minBaseDays);
        const high = Math.max(...window.map(c => c.high));
        const low = Math.min(...window.map(c => c.low));
        if (high > 0 && ((high - low) / high) * 100 <= consolRange) {
          baseCount++;
          i += minBaseDays;
        } else {
          i++;
        }
      }
      return { pass: baseCount >= 1 && baseCount <= maxBases, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: `${baseCount} bases`, threshold: `1-${maxBases} bases` } } };
    },
  },
  {
    id: "PA-6",
    name: "Distance from 52-Week High",
    category: "Price Action",
    description: "Finds stocks near or far from their 52-week high. Stocks within 5-15% of highs are in 'buy zone' territory — strong enough to be near the top but pulled back enough to offer entry. Stocks 50%+ away may be damaged or in downtrends. Adjust Min/Max Distance to target your range.",
    params: [
      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 0, min: 0, max: 200, step: 1, autoLink: { linkType: "sequenceOffset" } },
      { name: "maxDistance", label: "Max Distance %", type: "number", defaultValue: 25, min: 0, max: 100, step: 1 },
      { name: "minDistance", label: "Min Distance %", type: "number", defaultValue: 0, min: 0, max: 100, step: 1 },
    ],
    evaluate: (candles, params, _benchmarkCandles, upstreamData) => {
      const skip = upstreamData?.patternEndBar ?? params.skipBars ?? 0;
      const maxDist = params.maxDistance ?? 25;
      const minDist = params.minDistance ?? 0;
      if (candles.length < skip + 20) return { pass: false, data: { _diagnostics: { value: 'insufficient data', threshold: `${minDist}%-${maxDist}%` } } };
      const effectiveCandles = skip > 0 ? candles.slice(skip) : candles;
      const period = Math.min(260, effectiveCandles.length);
      if (period < 20) return { pass: false, data: { _diagnostics: { value: 'insufficient data', threshold: `${minDist}%-${maxDist}%` } } };
      const high52 = Math.max(...effectiveCandles.slice(0, period).map(c => c.high));
      if (high52 === 0) return { pass: false, data: { _diagnostics: { value: 'high=0', threshold: `${minDist}%-${maxDist}%` } } };
      const dist = ((high52 - effectiveCandles[0].close) / high52) * 100;
      return { pass: dist >= minDist && dist <= maxDist, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: `${dist.toFixed(1)}%`, threshold: `${minDist}%-${maxDist}%`, detail: `52wk high $${high52.toFixed(2)}, price $${effectiveCandles[0].close.toFixed(2)}` } } };
    },
  },
  {
    id: "PA-7",
    name: "Breakout Detection",
    category: "Price Action",
    description: "Finds stocks that recently broke out above the highest price of a prior base/consolidation zone. The breakout window controls how recently it must have happened (1-3 bars = just broke out; 10 = within last 2 weeks). Enable Volume Confirm to filter out weak, low-conviction breakouts.",
    provides: [{ linkType: "basePeriod", paramName: "basePeriod" }],
    params: [
      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 0, min: 0, max: 200, step: 1, autoLink: { linkType: "sequenceOffset" } },
      { name: "basePeriod", label: "Base Period", type: "number", defaultValue: 20, min: 5, max: 100, step: 1 },
      { name: "lookback", label: "Breakout Window (bars)", type: "number", defaultValue: 3, min: 1, max: 10, step: 1 },
      { name: "volumeConfirm", label: "Require Volume Surge", type: "boolean", defaultValue: true },
      { name: "volumeMultiple", label: "Volume Multiple", type: "number", defaultValue: 1.5, min: 1, max: 10, step: 0.1 },
    ],
    evaluate: (candles, params, _benchmarkCandles, upstreamData) => {
      const skip = upstreamData?.patternEndBar ?? params.skipBars ?? 0;
      const basePeriod = params.basePeriod ?? 20;
      const lookback = params.lookback ?? 3;
      const volumeConfirm = params.volumeConfirm ?? true;
      const volumeMult = params.volumeMultiple ?? 1.5;
      if (candles.length < skip + basePeriod + lookback) return { pass: false, data: { _diagnostics: { value: 'insufficient data', threshold: `breakout within ${lookback} bars` } } };
      const effectiveCandles = skip > 0 ? candles.slice(skip) : candles;
      const baseHigh = Math.max(...effectiveCandles.slice(lookback, lookback + basePeriod).map(c => c.high));
      for (let i = 0; i < lookback; i++) {
        if (effectiveCandles[i].close > baseHigh) {
          if (!volumeConfirm) return { pass: true, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: `$${effectiveCandles[i].close.toFixed(2)} > base $${baseHigh.toFixed(2)}`, threshold: `breakout within ${lookback} bars`, detail: `bar ${i}` } } };
          const avgVol = effectiveCandles.slice(lookback, lookback + 50).reduce((s, c) => s + c.volume, 0) / Math.min(50, effectiveCandles.length - lookback);
          const volRatio = avgVol > 0 ? effectiveCandles[i].volume / avgVol : 0;
          if (avgVol > 0 && volRatio >= volumeMult) return { pass: true, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: `$${effectiveCandles[i].close.toFixed(2)} > base $${baseHigh.toFixed(2)}`, threshold: `breakout within ${lookback} bars`, detail: `bar ${i}, vol ${volRatio.toFixed(1)}x (≥${volumeMult}x)` } } };
        }
      }
      return { pass: false, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: `price $${effectiveCandles[0].close.toFixed(2)}`, threshold: `> base high $${baseHigh.toFixed(2)}` } } };
    },
  },
  {
    id: "PA-8",
    name: "Pullback to Level",
    category: "Price Action",
    description: "Finds stocks that have pulled back to test a moving average as support. The low of the current bar must be within a tolerance band of the MA. A stock touching its rising 21 EMA after an advance is a classic buy-the-dip entry point in strong uptrends.",
    params: [
      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 0, min: 0, max: 200, step: 1, autoLink: { linkType: "sequenceOffset" } },
      { name: "maPeriod", label: "MA Period", type: "number", defaultValue: 21, min: 5, max: 200, step: 1 },
      { name: "maType", label: "MA Type", type: "select", defaultValue: "ema", options: ["sma", "ema"] },
      { name: "tolerance", label: "Tolerance %", type: "number", defaultValue: 2, min: 0.5, max: 10, step: 0.5 },
    ],
    evaluate: (candles, params, _benchmarkCandles, upstreamData) => {
      const skip = upstreamData?.patternEndBar ?? params.skipBars ?? 0;
      const maPeriod = params.maPeriod ?? 21;
      const maType = params.maType ?? "ema";
      const tolerance = params.tolerance ?? 2;
      if (candles.length < skip + maPeriod) return { pass: false, data: { _diagnostics: { value: 'insufficient data', threshold: `≤${tolerance}% from ${maPeriod} ${maType}` } } };
      const effectiveCandles = skip > 0 ? candles.slice(skip) : candles;
      const ma = getMA(effectiveCandles, maPeriod, maType);
      if (ma === 0) return { pass: false, data: { _diagnostics: { value: 'MA=0', threshold: `≤${tolerance}%` } } };
      const dist = Math.abs((effectiveCandles[0].low - ma) / ma) * 100;
      return { pass: dist <= tolerance, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: `${dist.toFixed(1)}% away`, threshold: `≤${tolerance}%`, detail: `low $${effectiveCandles[0].low.toFixed(2)} vs MA $${ma.toFixed(2)}` } } };
    },
  },
  {
    id: "PA-9",
    name: "VCP Tightness",
    category: "Price Action",
    description: "Detects the Volatility Contraction Pattern (VCP) — a series of price swings where each one is smaller than the last, forming a staircase of tightening contractions. This pattern shows sellers are drying up and supply is shrinking. More segments = more defined pattern but fewer matches.",
    params: [
      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 0, min: 0, max: 200, step: 1, autoLink: { linkType: "sequenceOffset" } },
      { name: "lookback", label: "Lookback Period", type: "number", defaultValue: 40, min: 15, max: 120, step: 5 },
      { name: "segments", label: "Number of Segments", type: "number", defaultValue: 3, min: 2, max: 5, step: 1 },
    ],
    evaluate: (candles, params, _benchmarkCandles, upstreamData) => {
      const skip = upstreamData?.patternEndBar ?? params.skipBars ?? 0;
      const lookback = params.lookback ?? 40;
      const segments = params.segments ?? 3;
      if (candles.length < skip + lookback) return { pass: false, data: { _diagnostics: { value: 'insufficient data', threshold: `${segments} contracting segments` } } };
      const effectiveCandles = skip > 0 ? candles.slice(skip) : candles;
      const slice = effectiveCandles.slice(0, lookback).reverse();
      const segLen = Math.floor(slice.length / segments);
      if (segLen < 3) return { pass: false, data: { _diagnostics: { value: 'segments too short', threshold: `${segments} contracting segments` } } };
      const ranges: number[] = [];
      for (let s = 0; s < segments; s++) {
        const seg = slice.slice(s * segLen, (s + 1) * segLen);
        const high = Math.max(...seg.map(c => c.high));
        const low = Math.min(...seg.map(c => c.low));
        ranges.push(high > 0 ? ((high - low) / high) * 100 : 0);
      }
      let contracting = true;
      for (let i = 1; i < ranges.length; i++) {
        if (ranges[i] >= ranges[i - 1]) { contracting = false; break; }
      }
      return { pass: contracting, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: ranges.map(r => `${r.toFixed(1)}%`).join(' → '), threshold: `${segments} contracting segments` } } };
    },
  },
  {
    id: "PA-11",
    name: "Distance from Key Level",
    category: "Price Action",
    description: "Finds stocks trading near a key price level — either VWAP (volume-weighted average price) or a pivot point. Stocks hugging VWAP are at their 'fair value' — a tight distance means the price is respecting this institutional reference. Good for finding stocks at decision points.",
    params: [
      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 0, min: 0, max: 200, step: 1, autoLink: { linkType: "sequenceOffset" } },
      { name: "level", label: "Level Type", type: "select", defaultValue: "vwap", options: ["vwap", "pivot"] },
      { name: "lookback", label: "Lookback Period", type: "number", defaultValue: 20, min: 5, max: 100, step: 1 },
      { name: "maxDistance", label: "Max Distance %", type: "number", defaultValue: 3, min: 0, max: 20, step: 0.5 },
    ],
    evaluate: (candles, params, _benchmarkCandles, upstreamData) => {
      const skip = upstreamData?.patternEndBar ?? params.skipBars ?? 0;
      const level = params.level ?? "vwap";
      const lookback = params.lookback ?? 20;
      const maxDist = params.maxDistance ?? 3;
      if (candles.length < skip + lookback) return { pass: false, data: { _diagnostics: { value: 'insufficient data', threshold: `≤${maxDist}% from ${level}` } } };
      const effectiveCandles = skip > 0 ? candles.slice(skip) : candles;
      let keyLevel: number;
      if (level === "vwap") {
        const slice = effectiveCandles.slice(0, lookback);
        let tpv = 0;
        let vol = 0;
        for (const c of slice) {
          const tp = (c.high + c.low + c.close) / 3;
          tpv += tp * c.volume;
          vol += c.volume;
        }
        keyLevel = vol > 0 ? tpv / vol : 0;
      } else {
        const prev = effectiveCandles[1] || effectiveCandles[0];
        keyLevel = (prev.high + prev.low + prev.close) / 3;
      }
      if (keyLevel === 0) return { pass: false, data: { _diagnostics: { value: `${level}=0`, threshold: `≤${maxDist}%` } } };
      const dist = Math.abs((effectiveCandles[0].close - keyLevel) / keyLevel) * 100;
      return { pass: dist <= maxDist, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: `${dist.toFixed(1)}% from ${level}`, threshold: `≤${maxDist}%`, detail: `${level} $${keyLevel.toFixed(2)}, price $${effectiveCandles[0].close.toFixed(2)}` } } };
    },
  },
  {
    id: "PA-12",
    name: "Prior Price Advance",
    category: "Price Action",
    description: "Verifies that the stock had a meaningful price advance BEFORE it built the current base. Skips over the base, then checks how much the stock gained in the window before that. Stocks that consolidate after a strong run-up (30%+) are building a classic base-on-advance pattern. When connected to Base Detection (PA-3), automatically uses each stock's actual base length. When connected to Find Base (CB-1), uses the found base's end bar as the skip offset — measuring the advance that led into that historical base. Max Retracement % prevents stocks that ran up then collapsed back down — the current price must not have given back more than this % of the peak gain (e.g., 50% means at least half the advance must be retained).",
    consumes: [{ paramName: "skipBars", dataKey: "detectedPeriod" }, { paramName: "skipBars", dataKey: "baseStartBar" }],
    params: [
      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 20, min: 5, max: 60, step: 1, autoLink: { linkType: "basePeriod" } },
      { name: "lookbackBars", label: "Advance Window (bars)", type: "number", defaultValue: 120, min: 20, max: 300, step: 5 },
      { name: "minGain", label: "Min Gain %", type: "number", defaultValue: 30, min: 5, max: 500, step: 5 },
      { name: "maxRetracement", label: "Max Retracement %", type: "number", defaultValue: 100, min: 10, max: 100, step: 5 },
    ],
    evaluate: (candles, params, _benchmarkCandles, upstreamData) => {
      const dynamicSkip = upstreamData?.baseStartBar ?? upstreamData?.detectedPeriod;
      const skip = dynamicSkip ?? params.skipBars ?? 20;
      const lookback = params.lookbackBars ?? 120;
      const minGain = params.minGain ?? 30;
      const maxRetracement = params.maxRetracement ?? 100;
      const totalNeeded = skip + lookback;
      if (candles.length < totalNeeded) return { pass: false, data: { _diagnostics: { value: 'insufficient data', threshold: `≥${minGain}% gain` } } };
      const advanceSlice = candles.slice(skip, skip + lookback);
      const priceAtBaseStart = advanceSlice[0]?.close;
      const priceAtAdvanceStart = advanceSlice[advanceSlice.length - 1]?.close;
      if (!priceAtBaseStart || !priceAtAdvanceStart || priceAtAdvanceStart === 0) return { pass: false, data: { _diagnostics: { value: 'missing price data', threshold: `≥${minGain}% gain` } } };
      const gain = ((priceAtBaseStart - priceAtAdvanceStart) / priceAtAdvanceStart) * 100;
      if (gain < minGain) return { pass: false, data: { _diagnostics: { value: `${gain.toFixed(1)}%`, threshold: `≥${minGain}%`, detail: `$${priceAtAdvanceStart.toFixed(2)} → $${priceAtBaseStart.toFixed(2)} over ${lookback} bars (skip=${skip})` } } };

      if (maxRetracement < 100) {
        let peakPrice = priceAtAdvanceStart;
        for (let i = advanceSlice.length - 1; i >= 0; i--) {
          if (advanceSlice[i].high > peakPrice) peakPrice = advanceSlice[i].high;
        }
        const currentPrice = candles[0]?.close;
        if (currentPrice && peakPrice > priceAtAdvanceStart) {
          const totalAdvance = peakPrice - priceAtAdvanceStart;
          const givenBack = peakPrice - currentPrice;
          const retracementPct = (givenBack / totalAdvance) * 100;
          if (retracementPct > maxRetracement) {
            return { pass: false, data: { _diagnostics: { value: `retraced ${retracementPct.toFixed(0)}%`, threshold: `≤${maxRetracement}% retracement`, detail: `peak $${peakPrice.toFixed(2)}, now $${currentPrice.toFixed(2)}, advance $${priceAtAdvanceStart.toFixed(2)} → $${peakPrice.toFixed(2)}` } } };
          }
        }
      }

      return { pass: true, data: { _diagnostics: { value: `${gain.toFixed(1)}%`, threshold: `≥${minGain}%`, detail: `$${priceAtAdvanceStart.toFixed(2)} → $${priceAtBaseStart.toFixed(2)} over ${lookback} bars (skip=${skip})` } } };
    },
  },
  {
    id: "PA-13",
    name: "Smooth Trending Advance",
    category: "Price Action",
    description: "Checks the QUALITY of the advance before the base — not just that it gained, but that it did so cleanly. Requires: (1) minimum net gain, (2) no single pullback deeper than Max Drawdown (rolling high to low), and (3) price stayed above a key SMA for most of the advance. This separates clean institutional staircase advances from volatile, choppy run-ups. Uses per-stock base length when connected to Base Detection (PA-3) or Find Base (CB-1).",
    consumes: [{ paramName: "skipBars", dataKey: "detectedPeriod" }, { paramName: "skipBars", dataKey: "baseStartBar" }],
    params: [
      { name: "skipBars", label: "Skip Recent Bars (base)", type: "number", defaultValue: 20, min: 5, max: 60, step: 1, autoLink: { linkType: "basePeriod" } },
      { name: "lookbackBars", label: "Advance Window (bars)", type: "number", defaultValue: 120, min: 20, max: 300, step: 5 },
      { name: "minGain", label: "Min Net Gain %", type: "number", defaultValue: 30, min: 5, max: 500, step: 5 },
      { name: "maxDrawdown", label: "Max Drawdown %", type: "number", defaultValue: 25, min: 5, max: 50, step: 1 },
      { name: "smaPeriod", label: "SMA Period", type: "number", defaultValue: 50, min: 10, max: 200, step: 5 },
      { name: "minBarsAboveSMA", label: "Min % Bars Above SMA", type: "number", defaultValue: 70, min: 30, max: 100, step: 5 },
    ],
    evaluate: (candles, params, _benchmarkCandles, upstreamData) => {
      const dynamicSkip = upstreamData?.baseStartBar ?? upstreamData?.detectedPeriod;
      const skip = dynamicSkip ?? params.skipBars ?? 20;
      const lookback = params.lookbackBars ?? 120;
      const minGain = params.minGain ?? 30;
      const maxDD = params.maxDrawdown ?? 25;
      const smaPeriod = params.smaPeriod ?? 50;
      const minAbovePct = params.minBarsAboveSMA ?? 70;

      const totalNeeded = skip + lookback + smaPeriod;
      if (candles.length < totalNeeded) return { pass: false, data: { _diagnostics: { value: 'insufficient data', threshold: `≥${minGain}% gain, ≤${maxDD}% dd` } } };

      const advanceSlice = candles.slice(skip, skip + lookback);
      const priceEnd = advanceSlice[0]?.close;
      const priceStart = advanceSlice[advanceSlice.length - 1]?.close;
      if (!priceEnd || !priceStart || priceStart === 0) return { pass: false, data: { _diagnostics: { value: 'missing price data', threshold: `≥${minGain}% gain` } } };
      const netGain = ((priceEnd - priceStart) / priceStart) * 100;
      if (netGain < minGain) return { pass: false, data: { _diagnostics: { value: `gain ${netGain.toFixed(1)}%`, threshold: `≥${minGain}%`, detail: `$${priceStart.toFixed(2)} → $${priceEnd.toFixed(2)}` } } };

      let rollingHigh = 0;
      let maxDrawdown = 0;
      for (let i = advanceSlice.length - 1; i >= 0; i--) {
        if (advanceSlice[i].high > rollingHigh) rollingHigh = advanceSlice[i].high;
        if (rollingHigh > 0) {
          const dd = ((rollingHigh - advanceSlice[i].low) / rollingHigh) * 100;
          if (dd > maxDrawdown) maxDrawdown = dd;
        }
      }
      if (maxDrawdown > maxDD) return { pass: false, data: { _diagnostics: { value: `dd ${maxDrawdown.toFixed(1)}%`, threshold: `≤${maxDD}%`, detail: `gain ${netGain.toFixed(1)}%` } } };

      let barsAbove = 0;
      for (let i = 0; i < lookback; i++) {
        const offset = skip + i;
        const smaSlice = candles.slice(offset, offset + smaPeriod);
        if (smaSlice.length < smaPeriod) continue;
        const sma = smaSlice.reduce((s, c) => s + c.close, 0) / smaPeriod;
        if (candles[offset].close > sma) barsAbove++;
      }
      const abovePct = (barsAbove / lookback) * 100;
      if (abovePct < minAbovePct) return { pass: false, data: { _diagnostics: { value: `${abovePct.toFixed(0)}% above SMA`, threshold: `≥${minAbovePct}%`, detail: `gain ${netGain.toFixed(1)}%, dd ${maxDrawdown.toFixed(1)}%` } } };

      return { pass: true, data: { _diagnostics: { value: `gain ${netGain.toFixed(1)}%`, threshold: `≥${minGain}%, ≤${maxDD}% dd`, detail: `dd ${maxDrawdown.toFixed(1)}%, ${abovePct.toFixed(0)}% above SMA` } } };
    },
  },
  {
    id: "PA-14",
    name: "Daily Range Contraction",
    category: "Price Action",
    description: "Compares the size of recent daily candles to the historical average. A ratio of 0.5 means candles are half their normal size — the stock is coiling with shrinking daily ranges. This contraction often precedes explosive moves. Works best combined with Volume Trend and Close Clustering to confirm a full 'quiet before the storm' setup. When connected to Base Detection, automatically uses each stock's detected base length as the baseline window.",
    consumes: [{ paramName: "baselineBars", dataKey: "detectedPeriod" }],
    params: [
      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 0, min: 0, max: 200, step: 1, autoLink: { linkType: "sequenceOffset" } },
      { name: "recentBars", label: "Recent Bars", type: "number", defaultValue: 5, min: 3, max: 20, step: 1 },
      { name: "baselineBars", label: "Baseline Bars", type: "number", defaultValue: 50, min: 20, max: 200, step: 5, autoLink: { linkType: "basePeriod" } },
      { name: "maxRatio", label: "Max Range Ratio", type: "number", defaultValue: 0.8, min: 0.1, max: 1.5, step: 0.05 },
    ],
    evaluate: (candles, params, _benchmarkCandles, upstreamData) => {
      const skip = upstreamData?.patternEndBar ?? params.skipBars ?? 0;
      const dynamicBaseline = upstreamData?.detectedPeriod;
      const recentN = params.recentBars ?? 5;
      const baselineN = dynamicBaseline ?? params.baselineBars ?? 50;
      const maxRatio = params.maxRatio ?? 0.8;
      if (candles.length < skip + recentN + baselineN) return { pass: false, data: { _diagnostics: { value: 'insufficient data', threshold: `≤${maxRatio}x` } } };

      const effectiveCandles = skip > 0 ? candles.slice(skip) : candles;
      const dailyRangePct = (c: { high: number; low: number; close: number }) =>
        c.close === 0 ? 0 : ((c.high - c.low) / c.close) * 100;

      let recentSum = 0;
      for (let i = 0; i < recentN; i++) recentSum += dailyRangePct(effectiveCandles[i]);
      const recentAvg = recentSum / recentN;

      let baselineSum = 0;
      for (let i = recentN; i < recentN + baselineN; i++) baselineSum += dailyRangePct(effectiveCandles[i]);
      const baselineAvg = baselineSum / baselineN;

      if (baselineAvg === 0) return { pass: false, data: { _diagnostics: { value: 'baseline=0', threshold: `≤${maxRatio}x` } } };
      const ratio = recentAvg / baselineAvg;
      return { pass: ratio <= maxRatio, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: `${ratio.toFixed(2)}x`, threshold: `≤${maxRatio}x`, detail: `recent ${recentAvg.toFixed(2)}% vs baseline ${baselineAvg.toFixed(2)}%` } } };
    },
  },
  {
    id: "PA-15",
    name: "Close Clustering",
    category: "Price Action",
    description: "Measures how tightly closing prices bunch together over recent bars. A 1% cluster means closes barely move day-to-day — the stock has settled into a narrow equilibrium. Think of it as a 'coil' indicator: the tighter the clustering, the more energy is stored for the next directional move. Use with Tightness Ratio for stronger confirmation. When connected to Base Detection, automatically uses each stock's detected base length as the period.",
    consumes: [{ paramName: "period", dataKey: "detectedPeriod" }],
    params: [
      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 0, min: 0, max: 200, step: 1, autoLink: { linkType: "sequenceOffset" } },
      { name: "period", label: "Period", type: "number", defaultValue: 10, min: 5, max: 50, step: 1, autoLink: { linkType: "basePeriod" } },
      { name: "maxClusterPct", label: "Max Cluster %", type: "number", defaultValue: 3.0, min: 0.1, max: 5, step: 0.1 },
    ],
    evaluate: (candles, params, _benchmarkCandles, upstreamData) => {
      const skip = upstreamData?.patternEndBar ?? params.skipBars ?? 0;
      const dynamicPeriod = upstreamData?.detectedPeriod;
      const period = dynamicPeriod ?? params.period ?? 10;
      const maxPct = params.maxClusterPct ?? 3.0;
      if (candles.length < skip + period) return { pass: false, data: { _diagnostics: { value: 'insufficient data', threshold: `≤${maxPct}%` } } };

      const effectiveCandles = skip > 0 ? candles.slice(skip) : candles;
      const closes = effectiveCandles.slice(0, period).map(c => c.close);
      const avg = closes.reduce((s, v) => s + v, 0) / period;
      if (avg === 0) return { pass: false, data: { _diagnostics: { value: 'avg=0', threshold: `≤${maxPct}%` } } };

      const variance = closes.reduce((s, v) => s + (v - avg) * (v - avg), 0) / period;
      const stdDev = Math.sqrt(variance);
      const clusterPct = (stdDev / avg) * 100;

      const pa15Pass = clusterPct <= maxPct;
      return { pass: pa15Pass, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, ...(pa15Pass ? { _cocHighlight: { type: "pullbackCircle", barCount: 3 } } : {}), _diagnostics: { value: `${clusterPct.toFixed(2)}%`, threshold: `≤${maxPct}%` } } };
    },
  },
  {
    id: "PA-17",
    name: "Wedge Pop Detection",
    category: "Price Action",
    description: "Oliver Kell's 'Money Pattern' — detects stocks that consolidated under declining short-term EMAs with tightening price ranges and drying volume, then broke back above those EMAs on a volume surge. The best Wedge Pops happen via a gap up through both the 10 and 20 EMA. Identifies the setup phase (wedge formation with volatility contraction and volume dry-up) and the trigger (price reclaiming EMAs on increased volume). Returns rich diagnostic data including pop type (gap/strong bar/gradual), gap %, volume ratio, wedge duration, range contraction, and position vs 200 DMA.",
    params: [
      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 0, min: 0, max: 200, step: 1, autoLink: { linkType: "sequenceOffset" } },
      { name: "emaShort", label: "Short EMA", type: "number", defaultValue: 10, min: 5, max: 50, step: 1 },
      { name: "emaLong", label: "Long EMA", type: "number", defaultValue: 20, min: 10, max: 100, step: 1 },
      { name: "minWedgeBars", label: "Min Wedge Bars", type: "number", defaultValue: 8, min: 3, max: 30, step: 1 },
      { name: "maxWedgeBars", label: "Max Wedge Bars", type: "number", defaultValue: 40, min: 10, max: 80, step: 5 },
      { name: "minVolumeRatio", label: "Min Pop Volume Ratio", type: "number", defaultValue: 1.5, min: 1.0, max: 5.0, step: 0.1 },
      { name: "minGapPercent", label: "Min Gap %", type: "number", defaultValue: 0, min: 0, max: 10, step: 0.5 },
      { name: "requireGap", label: "Require Gap Up", type: "boolean", defaultValue: false },
      { name: "requireUnfilledGap", label: "Require Unfilled Gap", type: "boolean", defaultValue: false },
      { name: "rangeContractionPct", label: "Range Contraction %", type: "number", defaultValue: 30, min: 10, max: 80, step: 5 },
      { name: "volumeDeclinePct", label: "Volume Decline %", type: "number", defaultValue: 20, min: 5, max: 60, step: 5 },
    ],
    evaluate: (candles, params, _benchmarkCandles, upstreamData) => {
      const skip = upstreamData?.patternEndBar ?? params.skipBars ?? 0;
      const emaShort = params.emaShort ?? 10;
      const emaLong = params.emaLong ?? 20;
      const minWedgeBars = params.minWedgeBars ?? 8;
      const maxWedgeBars = params.maxWedgeBars ?? 40;
      const minVolumeRatio = params.minVolumeRatio ?? 1.5;
      const minGapPct = params.minGapPercent ?? 0;
      const requireGap = params.requireGap ?? false;
      const requireUnfilledGap = params.requireUnfilledGap ?? false;
      const rangeContractionPct = params.rangeContractionPct ?? 30;
      const volumeDeclinePct = params.volumeDeclinePct ?? 20;

      const needed = Math.max(maxWedgeBars + emaLong + 10, 200 + 1);
      if (candles.length < skip + needed) return { pass: false, data: { _diagnostics: { value: 'insufficient data', threshold: 'wedge pop' } } };

      const effectiveCandles = skip > 0 ? candles.slice(skip) : candles;
      const today = effectiveCandles[0];
      const prev = effectiveCandles[1];

      const emaShortNow = calcEMA(effectiveCandles, emaShort);
      const emaLongNow = calcEMA(effectiveCandles, emaLong);

      const priceAboveShortEma = today.close > emaShortNow;
      const priceAboveLongEma = today.close > emaLongNow;
      if (!priceAboveShortEma || !priceAboveLongEma) {
        return { pass: false, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: `close ${today.close.toFixed(2)} vs ${emaShort}e=${emaShortNow.toFixed(2)}/${emaLong}e=${emaLongNow.toFixed(2)}`, threshold: 'price must close above both EMAs' } } };
      }

      const gapPct = prev.close > 0 ? ((today.open - prev.close) / prev.close) * 100 : 0;
      const emaShortPrev = calcEMAAt(effectiveCandles, emaShort, 1);
      const emaLongPrev = calcEMAAt(effectiveCandles, emaLong, 1);
      const gapAboveBothEmas = today.open > emaShortPrev && today.open > emaLongPrev;
      const gapUnfilled = today.low > prev.close;

      let popType: "gap" | "strong_bar" | "gradual" = "gradual";
      if (gapAboveBothEmas && gapPct > 0.5) {
        popType = "gap";
      } else {
        const prevClose = prev.close;
        const prevBelowEma = prevClose < emaShortPrev || prevClose < emaLongPrev;
        if (prevBelowEma && priceAboveShortEma && priceAboveLongEma) {
          const barRange = today.high - today.low;
          const recentRanges: number[] = [];
          for (let i = 1; i <= 10 && i < effectiveCandles.length; i++) {
            recentRanges.push(effectiveCandles[i].high - effectiveCandles[i].low);
          }
          const avgRecentRange = recentRanges.length > 0 ? recentRanges.reduce((a, b) => a + b, 0) / recentRanges.length : barRange;
          if (barRange > avgRecentRange * 1.3) {
            popType = "strong_bar";
          }
        }
      }

      if (requireGap && popType !== "gap") {
        return { pass: false, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: `popType=${popType}`, threshold: 'gap required' } } };
      }
      if (requireUnfilledGap && !(popType === "gap" && gapUnfilled)) {
        return { pass: false, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: `gap=${popType === "gap"}, unfilled=${gapUnfilled}`, threshold: 'unfilled gap required' } } };
      }
      if (minGapPct > 0 && gapPct < minGapPct) {
        return { pass: false, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: `gap ${gapPct.toFixed(1)}%`, threshold: `≥${minGapPct}%` } } };
      }

      let wedgeBars = 0;
      let foundWedge = false;
      for (let startOffset = 1; startOffset <= 5; startOffset++) {
        for (let wb = minWedgeBars; wb <= maxWedgeBars; wb++) {
          const wedgeEnd = startOffset + wb;
          if (wedgeEnd >= effectiveCandles.length - emaLong) break;

          let belowCount = 0;
          for (let i = startOffset; i < wedgeEnd; i++) {
            const emaS = calcEMAAt(effectiveCandles, emaShort, i);
            const emaL = calcEMAAt(effectiveCandles, emaLong, i);
            const c = effectiveCandles[i];
            if (c.close < emaS || c.close < emaL) belowCount++;
          }
          if (belowCount < wb * 0.5) continue;

          const emaShortWedgeStart = calcEMAAt(effectiveCandles, emaShort, wedgeEnd - 1);
          const emaShortWedgeEnd = calcEMAAt(effectiveCandles, emaShort, startOffset);
          const emaLongWedgeStart = calcEMAAt(effectiveCandles, emaLong, wedgeEnd - 1);
          const emaLongWedgeEnd = calcEMAAt(effectiveCandles, emaLong, startOffset);
          const emaShortDeclining = emaShortWedgeEnd < emaShortWedgeStart;
          const emaLongFlat = emaLongWedgeEnd <= emaLongWedgeStart * 1.02;
          if (!emaShortDeclining && !emaLongFlat) continue;

          const halfLen = Math.floor(wb / 2);
          let earlyRangeSum = 0;
          let lateRangeSum = 0;
          for (let i = wedgeEnd - halfLen; i < wedgeEnd; i++) {
            earlyRangeSum += effectiveCandles[i].high - effectiveCandles[i].low;
          }
          for (let i = startOffset; i < startOffset + halfLen; i++) {
            lateRangeSum += effectiveCandles[i].high - effectiveCandles[i].low;
          }
          const earlyAvgRange = earlyRangeSum / halfLen;
          const lateAvgRange = lateRangeSum / halfLen;
          if (earlyAvgRange === 0) continue;
          const contraction = ((earlyAvgRange - lateAvgRange) / earlyAvgRange) * 100;
          if (contraction < rangeContractionPct) continue;

          let earlyVolSum = 0;
          let lateVolSum = 0;
          for (let i = wedgeEnd - halfLen; i < wedgeEnd; i++) {
            earlyVolSum += effectiveCandles[i].volume;
          }
          for (let i = startOffset; i < startOffset + halfLen; i++) {
            lateVolSum += effectiveCandles[i].volume;
          }
          const earlyAvgVol = earlyVolSum / halfLen;
          const lateAvgVol = lateVolSum / halfLen;
          if (earlyAvgVol === 0) continue;
          const volDecline = ((earlyAvgVol - lateAvgVol) / earlyAvgVol) * 100;
          if (volDecline < volumeDeclinePct) continue;

          wedgeBars = wb;
          foundWedge = true;
          break;
        }
        if (foundWedge) break;
      }

      if (!foundWedge) {
        return { pass: false, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: 'no wedge formation found', threshold: `${minWedgeBars}-${maxWedgeBars} bars, ${rangeContractionPct}% contraction` } } };
      }

      let vol20Avg = 0;
      for (let i = 1; i <= 20 && i < effectiveCandles.length; i++) vol20Avg += effectiveCandles[i].volume;
      vol20Avg /= 20;
      const volumeRatio = vol20Avg > 0 ? today.volume / vol20Avg : 0;
      if (volumeRatio < minVolumeRatio) {
        return { pass: false, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: `vol ${volumeRatio.toFixed(1)}x`, threshold: `≥${minVolumeRatio}x` } } };
      }

      const finalHalf = Math.floor(wedgeBars / 2);
      let finalEarlyRangeSum = 0, finalLateRangeSum = 0;
      for (let i = 1 + wedgeBars - finalHalf; i < 1 + wedgeBars; i++) finalEarlyRangeSum += effectiveCandles[i].high - effectiveCandles[i].low;
      for (let i = 1; i < 1 + finalHalf; i++) finalLateRangeSum += effectiveCandles[i].high - effectiveCandles[i].low;
      const finalContraction = finalEarlyRangeSum > 0 ? ((finalEarlyRangeSum / finalHalf - finalLateRangeSum / finalHalf) / (finalEarlyRangeSum / finalHalf)) * 100 : 0;

      let priceVs200dma: "above" | "near" | "below" = "below";
      if (effectiveCandles.length >= 200) {
        const sma200 = calcSMA(effectiveCandles, 200);
        const pctFrom200 = sma200 > 0 ? ((today.close - sma200) / sma200) * 100 : 0;
        if (pctFrom200 > 5) priceVs200dma = "above";
        else if (pctFrom200 > -5) priceVs200dma = "near";
      }

      const diagnosticDetail = [
        `type=${popType}`,
        popType === "gap" ? `gap=${gapPct.toFixed(1)}%${gapUnfilled ? ' unfilled' : ' filled'}` : '',
        `vol=${volumeRatio.toFixed(1)}x`,
        `wedge=${wedgeBars}bars`,
        `contraction=${finalContraction.toFixed(0)}%`,
        `vs200dma=${priceVs200dma}`,
      ].filter(Boolean).join(', ');

      return {
        pass: true,
        data: {
          evaluationStartBar: skip,
          evaluationEndBar: skip,
          patternEndBar: skip,
          wedgePopDetected: true,
          popType,
          gapPercent: Math.round(gapPct * 10) / 10,
          gapFilled: popType === "gap" ? !gapUnfilled : null,
          volumeRatio: Math.round(volumeRatio * 10) / 10,
          wedgeBars,
          rangeContraction: Math.round(finalContraction),
          priceVsEmaShort: priceAboveShortEma ? "above" : "below",
          priceVsEmaLong: priceAboveLongEma ? "above" : "below",
          priceVs200dma,
          _cocHighlight: { type: "gapCircle", barIndex: 0, gapPct },
          _diagnostics: {
            value: `${popType} pop, ${volumeRatio.toFixed(1)}x vol`,
            threshold: `≥${minVolumeRatio}x vol, ${rangeContractionPct}% contraction`,
            detail: diagnosticDetail,
          },
        },
      };
    },
  },
  {
    id: "PA-18",
    name: "Price Change Over Period",
    category: "Price Action",
    description: "Measures price change from a starting point forward over a specified number of bars. Unlike other indicators that look backward from today, this checks what happened AFTER a pattern. Use for sequences like '3 updays then 5% decline' or 'base then 10% advance'. When connected to upstream patterns, automatically starts measuring from where that pattern ended.",
    provides: [{ linkType: "sequenceOffset", paramName: "period" }],
    consumes: [{ paramName: "startBar", dataKey: "patternEndBar" }],
    params: [
      { name: "startBar", label: "Start Bar", type: "number", defaultValue: 10, min: 0, max: 200, step: 1, autoLink: { linkType: "sequenceOffset" } },
      { name: "period", label: "Period (bars)", type: "number", defaultValue: 5, min: 1, max: 50, step: 1 },
      { name: "changeType", label: "Change Type", type: "select", defaultValue: "gain", options: ["gain", "decline", "any"] },
      { name: "minChangePct", label: "Min Change %", type: "number", defaultValue: 5, min: 0, max: 100, step: 0.5 },
      { name: "maxChangePct", label: "Max Change %", type: "number", defaultValue: 100, min: 0, max: 200, step: 1 },
    ],
    evaluate: (candles, params, _benchmarkCandles, upstreamData) => {
      const startBar = upstreamData?.patternEndBar ?? params.startBar ?? 10;
      const period = params.period ?? 5;
      const changeType = params.changeType ?? "gain";
      const minChange = params.minChangePct ?? 5;
      const maxChange = params.maxChangePct ?? 100;
      
      const endBar = Math.max(0, startBar - period);
      
      if (candles.length <= startBar) {
        return { pass: false, data: { _diagnostics: { value: 'insufficient data', threshold: `${minChange}%-${maxChange}% ${changeType}` } } };
      }
      
      const startPrice = candles[startBar]?.close;
      const endPrice = candles[endBar]?.close;
      
      if (!startPrice || !endPrice || startPrice === 0) {
        return { pass: false, data: { _diagnostics: { value: 'missing price data', threshold: `${minChange}%-${maxChange}% ${changeType}` } } };
      }
      
      const changePct = ((endPrice - startPrice) / startPrice) * 100;
      const absChange = Math.abs(changePct);
      
      let pass = false;
      if (changeType === "gain") {
        pass = changePct >= minChange && changePct <= maxChange;
      } else if (changeType === "decline") {
        pass = changePct <= -minChange && changePct >= -maxChange;
      } else {
        pass = absChange >= minChange && absChange <= maxChange;
      }
      
      return { 
        pass, 
        data: { 
          priceChangeStartBar: startBar,
          priceChangeEndBar: endBar,
          patternEndBar: endBar,
          _diagnostics: { 
            value: `${changePct >= 0 ? '+' : ''}${changePct.toFixed(1)}%`, 
            threshold: `${minChange}%-${maxChange}% ${changeType}`,
            detail: `$${startPrice.toFixed(2)} (bar ${startBar}) → $${endPrice.toFixed(2)} (bar ${endBar}) over ${period} bars`
          } 
        }
      };
    },
  },
  {
    id: "PA-19",
    name: "Undercut & Rally",
    category: "Price Action",
    description: "Detects the classic U&R shakeout pattern: price undercuts (closes below) a key moving average, then rallies back above it within a specified number of bars. This pattern traps weak hands and often precedes strong moves. Requires price to currently be above the MA after completing the undercut-rally sequence. Use Max Bars Below to control how long the undercut can last, and Min Undercut Depth to require meaningful penetration below the MA.",
    provides: [{ linkType: "sequenceOffset", paramName: "lookback" }],
    params: [
      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 0, min: 0, max: 200, step: 1, autoLink: { linkType: "sequenceOffset" } },
      { name: "maPeriod", label: "MA Period", type: "number", defaultValue: 21, min: 5, max: 200, step: 1 },
      { name: "maType", label: "MA Type", type: "select", defaultValue: "ema", options: ["sma", "ema"] },
      { name: "lookback", label: "Lookback Window (bars)", type: "number", defaultValue: 10, min: 3, max: 30, step: 1 },
      { name: "maxUndercutBars", label: "Max Bars Below MA", type: "number", defaultValue: 5, min: 1, max: 15, step: 1 },
      { name: "minUndercutPct", label: "Min Undercut Depth %", type: "number", defaultValue: 0, min: 0, max: 10, step: 0.5 },
      { name: "requireVolumeSpike", label: "Require Volume on Rally", type: "boolean", defaultValue: false },
    ],
    evaluate: (candles, params, _benchmarkCandles, upstreamData) => {
      const skip = upstreamData?.patternEndBar ?? params.skipBars ?? 0;
      const maPeriod = params.maPeriod ?? 21;
      const maType = (params.maType ?? "ema") as "sma" | "ema";
      const lookback = params.lookback ?? 10;
      const maxUndercutBars = params.maxUndercutBars ?? 5;
      const minUndercutPct = params.minUndercutPct ?? 0;
      const requireVolume = params.requireVolumeSpike ?? false;
      
      if (candles.length < skip + maPeriod + lookback + 5) {
        return { pass: false, data: { _diagnostics: { value: 'insufficient data', threshold: `U&R within ${lookback} bars` } } };
      }
      
      const effectiveCandles = skip > 0 ? candles.slice(skip) : candles;
      const currentPrice = effectiveCandles[0].close;
      const currentMA = maType === "sma" ? calcSMA(effectiveCandles, maPeriod) : calcEMA(effectiveCandles, maPeriod);
      
      if (currentPrice <= currentMA) {
        return { pass: false, data: { _diagnostics: { 
          value: 'price below MA', 
          threshold: `need price > ${maPeriod} ${maType.toUpperCase()}`,
          detail: `$${currentPrice.toFixed(2)} vs MA $${currentMA.toFixed(2)}`
        }}};
      }
      
      const getMAAt = (offset: number): number => {
        if (effectiveCandles.length < offset + maPeriod) return 0;
        const slice = effectiveCandles.slice(offset);
        return maType === "sma" ? calcSMA(slice, maPeriod) : calcEMA(slice, maPeriod);
      };
      
      for (let rallyBar = 1; rallyBar < lookback; rallyBar++) {
        const rallyMA = getMAAt(rallyBar);
        const rallyPrice = effectiveCandles[rallyBar].close;
        const prevPrice = effectiveCandles[rallyBar + 1]?.close;
        const prevMA = getMAAt(rallyBar + 1);
        
        if (!prevPrice || prevMA === 0 || rallyMA === 0) continue;
        
        if (prevPrice <= prevMA && rallyPrice > rallyMA) {
          let undercutBar = -1;
          let undercutDepth = 0;
          let barsBelow = 0;
          let undercutLow = Infinity;
          
          for (let i = rallyBar + 1; i < Math.min(rallyBar + 1 + maxUndercutBars + 3, effectiveCandles.length - maPeriod); i++) {
            const barPrice = effectiveCandles[i].close;
            const barMA = getMAAt(i);
            
            if (barMA === 0) break;
            
            if (barPrice < barMA) {
              barsBelow++;
              const depth = ((barMA - barPrice) / barMA) * 100;
              if (depth > undercutDepth) {
                undercutDepth = depth;
                undercutBar = i;
              }
              if (barPrice < undercutLow) undercutLow = barPrice;
            } else if (barsBelow > 0) {
              break;
            }
          }
          
          if (undercutBar > 0 && barsBelow <= maxUndercutBars && undercutDepth >= minUndercutPct) {
            if (requireVolume) {
              const volSlice = effectiveCandles.slice(rallyBar + 1, Math.min(rallyBar + 21, effectiveCandles.length));
              const avgVol = volSlice.reduce((s, c) => s + c.volume, 0) / volSlice.length;
              const rallyVol = effectiveCandles[rallyBar].volume;
              if (rallyVol < avgVol * 1.2) continue;
            }
            
            return { 
              pass: true, 
              data: { 
                evaluationStartBar: skip + undercutBar,
                evaluationEndBar: skip + rallyBar,
                patternEndBar: skip,
                undercutBar: skip + undercutBar,
                rallyBar: skip + rallyBar,
                barsBelow,
                undercutDepthPct: undercutDepth,
                undercutLowPrice: undercutLow,
                _cocHighlight: { type: "urPattern", undercutBar: skip + undercutBar, rallyBar: skip + rallyBar, maValue: currentMA },
                _diagnostics: { 
                  value: `U&R ${rallyBar} bars ago`, 
                  threshold: `within ${lookback} bars`,
                  detail: `undercut ${undercutDepth.toFixed(1)}% below ${maPeriod} ${maType.toUpperCase()} for ${barsBelow} bars, rallied bar ${rallyBar}`
                } 
              }
            };
          }
        }
      }
      
      return { 
        pass: false, 
        data: { 
          patternEndBar: skip,
          _diagnostics: { 
            value: 'no U&R found', 
            threshold: `within ${lookback} bars`,
            detail: `price $${currentPrice.toFixed(2)} vs ${maPeriod} ${maType.toUpperCase()} $${currentMA.toFixed(2)}`
          }
        }
      };
    },
  },
  {
    id: "PA-20",
    name: "Pullback to MA",
    category: "Price Action",
    description: "Finds stocks that ran up, pulled back to touch or approach a key moving average, and are now bouncing. The classic 'buy the dip' setup in an uptrend. Requires a prior advance, a pullback that brings price near the MA (within touch threshold), and current price recovering above the recent low. Optional volume dry-up during pullback confirms institutional holding.",
    provides: [{ linkType: "sequenceOffset", paramName: "lookback" }],
    params: [
      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 0, min: 0, max: 200, step: 1, autoLink: { linkType: "sequenceOffset" } },
      { name: "maPeriod", label: "MA Period", type: "number", defaultValue: 21, min: 5, max: 200, step: 1 },
      { name: "maType", label: "MA Type", type: "select", defaultValue: "ema", options: ["sma", "ema"] },
      { name: "lookback", label: "Lookback Window (bars)", type: "number", defaultValue: 20, min: 5, max: 60, step: 1 },
      { name: "priorAdvancePct", label: "Min Prior Advance %", type: "number", defaultValue: 15, min: 5, max: 100, step: 5 },
      { name: "priorAdvanceBars", label: "Prior Advance Lookback", type: "number", defaultValue: 60, min: 20, max: 200, step: 10 },
      { name: "touchThresholdPct", label: "MA Touch Threshold %", type: "number", defaultValue: 2, min: 0, max: 5, step: 0.5 },
      { name: "bounceConfirmPct", label: "Bounce Confirm %", type: "number", defaultValue: 1, min: 0, max: 10, step: 0.5 },
      { name: "requireVolumeDryUp", label: "Require Volume Dry-Up", type: "boolean", defaultValue: false },
    ],
    evaluate: (candles, params, _benchmarkCandles, upstreamData) => {
      const skip = upstreamData?.patternEndBar ?? params.skipBars ?? 0;
      const maPeriod = params.maPeriod ?? 21;
      const maType = (params.maType ?? "ema") as "sma" | "ema";
      const lookback = params.lookback ?? 20;
      const priorAdvancePct = params.priorAdvancePct ?? 15;
      const priorAdvanceBars = params.priorAdvanceBars ?? 60;
      const touchThreshold = params.touchThresholdPct ?? 2;
      const bounceConfirm = params.bounceConfirmPct ?? 1;
      const requireVolDryUp = params.requireVolumeDryUp ?? false;
      
      const needed = skip + Math.max(maPeriod, lookback) + priorAdvanceBars;
      if (candles.length < needed) {
        return { pass: false, data: { _diagnostics: { value: 'insufficient data', threshold: `pullback to ${maPeriod} ${maType.toUpperCase()}` } } };
      }
      
      const effectiveCandles = skip > 0 ? candles.slice(skip) : candles;
      const currentPrice = effectiveCandles[0].close;
      const currentMA = maType === "sma" ? calcSMA(effectiveCandles, maPeriod) : calcEMA(effectiveCandles, maPeriod);
      
      if (currentPrice <= currentMA * 0.97) {
        return { pass: false, data: { _diagnostics: { 
          value: 'price too far below MA', 
          threshold: `need price near/above ${maPeriod} ${maType.toUpperCase()}`,
          detail: `$${currentPrice.toFixed(2)} vs MA $${currentMA.toFixed(2)}`
        }}};
      }
      
      const getMAAt = (offset: number): number => {
        if (effectiveCandles.length < offset + maPeriod) return 0;
        const slice = effectiveCandles.slice(offset);
        return maType === "sma" ? calcSMA(slice, maPeriod) : calcEMA(slice, maPeriod);
      };
      
      let peakPrice = 0;
      let peakBar = -1;
      for (let i = 0; i < Math.min(priorAdvanceBars, effectiveCandles.length); i++) {
        if (effectiveCandles[i].high > peakPrice) {
          peakPrice = effectiveCandles[i].high;
          peakBar = i;
        }
      }
      
      if (peakBar < 3) {
        return { pass: false, data: { _diagnostics: { 
          value: 'peak too recent', 
          threshold: `need pullback from high`,
          detail: `peak $${peakPrice.toFixed(2)} at bar ${peakBar}`
        }}};
      }
      
      const advanceStart = Math.min(peakBar + priorAdvanceBars, effectiveCandles.length - 1);
      const advanceStartPrice = effectiveCandles[advanceStart].close;
      const advance = advanceStartPrice > 0 ? ((peakPrice - advanceStartPrice) / advanceStartPrice) * 100 : 0;
      
      if (advance < priorAdvancePct) {
        return { pass: false, data: { _diagnostics: { 
          value: `advance ${advance.toFixed(1)}%`, 
          threshold: `need ≥${priorAdvancePct}% prior advance`,
          detail: `$${advanceStartPrice.toFixed(2)} → $${peakPrice.toFixed(2)}`
        }}};
      }
      
      let touchBar = -1;
      let touchLow = Infinity;
      let touchMA = 0;
      
      for (let i = 1; i < Math.min(lookback, peakBar); i++) {
        const barLow = effectiveCandles[i].low;
        const barMA = getMAAt(i);
        if (barMA === 0) continue;
        
        const distFromMA = ((barLow - barMA) / barMA) * 100;
        
        if (distFromMA <= touchThreshold && distFromMA >= -touchThreshold) {
          if (barLow < touchLow) {
            touchLow = barLow;
            touchBar = i;
            touchMA = barMA;
          }
        }
      }
      
      if (touchBar < 0) {
        return { pass: false, data: { _diagnostics: { 
          value: 'no MA touch', 
          threshold: `need price within ${touchThreshold}% of ${maPeriod} ${maType.toUpperCase()}`,
          detail: `during pullback from $${peakPrice.toFixed(2)}`
        }}};
      }
      
      const bounceFromLow = touchLow > 0 ? ((currentPrice - touchLow) / touchLow) * 100 : 0;
      if (bounceFromLow < bounceConfirm) {
        return { pass: false, data: { _diagnostics: { 
          value: `bounce ${bounceFromLow.toFixed(1)}%`, 
          threshold: `need ≥${bounceConfirm}% bounce from low`,
          detail: `low $${touchLow.toFixed(2)} at bar ${touchBar}`
        }}};
      }
      
      if (requireVolDryUp) {
        const pbSlice = effectiveCandles.slice(1, touchBar + 1);
        const preSlice = effectiveCandles.slice(touchBar + 1, touchBar + 21);
        if (pbSlice.length > 0 && preSlice.length > 0) {
          const pbAvgVol = pbSlice.reduce((s, c) => s + c.volume, 0) / pbSlice.length;
          const preAvgVol = preSlice.reduce((s, c) => s + c.volume, 0) / preSlice.length;
          if (preAvgVol > 0 && pbAvgVol > preAvgVol * 0.8) {
            return { pass: false, data: { _diagnostics: { 
              value: 'no volume dry-up', 
              threshold: `need volume contraction on pullback`,
              detail: `pullback vol ${(pbAvgVol/preAvgVol*100).toFixed(0)}% of prior`
            }}};
          }
        }
      }
      
      const pullbackDepth = peakPrice > 0 ? ((peakPrice - touchLow) / peakPrice) * 100 : 0;
      
      return { 
        pass: true, 
        data: { 
          evaluationStartBar: skip + peakBar,
          evaluationEndBar: skip + touchBar,
          patternEndBar: skip,
          peakBar: skip + peakBar,
          peakPrice,
          touchBar: skip + touchBar,
          touchLowPrice: touchLow,
          touchMAPrice: touchMA,
          priorAdvancePct: advance,
          pullbackDepthPct: pullbackDepth,
          bounceFromLowPct: bounceFromLow,
          _cocHighlight: { type: "pullbackPattern", peakBar: skip + peakBar, touchBar: skip + touchBar, maValue: currentMA },
          _diagnostics: { 
            value: `PB to ${maPeriod} ${maType.toUpperCase()}`, 
            threshold: `within ${lookback} bars`,
            detail: `${advance.toFixed(0)}% advance, ${pullbackDepth.toFixed(1)}% pullback, touched MA bar ${touchBar}, bounced ${bounceFromLow.toFixed(1)}%`
          } 
        }
      };
    },
  },
];

const RELATIVE_STRENGTH: IndicatorDefinition[] = [
  {
    id: "RS-1",
    name: "RS vs Index",
    category: "Relative Strength",
    description: "Finds stocks outperforming the benchmark index (S&P 500) over a time period. A stock that gained 15% while the index gained 5% has 10% outperformance. Leaders in a bull market consistently outperform the index — this filters for those winners and rejects laggards.",
    params: [
      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 0, min: 0, max: 200, step: 1, autoLink: { linkType: "sequenceOffset" } },
      { name: "period", label: "Period", type: "number", defaultValue: 60, min: 10, max: 260, step: 5 },
      { name: "minOutperformance", label: "Min Outperformance %", type: "number", defaultValue: 5, min: -50, max: 100, step: 1 },
    ],
    evaluate: (candles, params, benchmarkCandles, upstreamData) => {
      const skip = upstreamData?.patternEndBar ?? params.skipBars ?? 0;
      const period = params.period ?? 60;
      const minOut = params.minOutperformance ?? 5;
      if (candles.length < skip + period || !benchmarkCandles || benchmarkCandles.length < skip + period) return { pass: false, data: { _diagnostics: { value: 'insufficient data', threshold: `≥${minOut}%` } } };
      const effectiveCandles = skip > 0 ? candles.slice(skip) : candles;
      const effectiveBench = skip > 0 ? benchmarkCandles.slice(skip) : benchmarkCandles;
      const stockReturn = ((effectiveCandles[0].close - effectiveCandles[period - 1].close) / effectiveCandles[period - 1].close) * 100;
      const benchReturn = ((effectiveBench[0].close - effectiveBench[period - 1].close) / effectiveBench[period - 1].close) * 100;
      const outperf = stockReturn - benchReturn;
      return { pass: outperf >= minOut, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: `${outperf.toFixed(1)}%`, threshold: `≥${minOut}%`, detail: `stock ${stockReturn.toFixed(1)}% vs bench ${benchReturn.toFixed(1)}%` } } };
    },
  },
  {
    id: "RS-2",
    name: "RS Score",
    category: "Relative Strength",
    description: "Calculates a raw strength ratio: stock return divided by benchmark return. A score of 1.5 means the stock gained 50% more than the index. Scores above 1.0 = outperforming; below 1.0 = underperforming. Use Min RS Score of 1.2+ to find meaningful leaders, not just marginal outperformers.",
    params: [
      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 0, min: 0, max: 200, step: 1, autoLink: { linkType: "sequenceOffset" } },
      { name: "period", label: "Period", type: "number", defaultValue: 60, min: 10, max: 260, step: 5 },
      { name: "minScore", label: "Min RS Score", type: "number", defaultValue: 1.2, min: 0, max: 5, step: 0.1 },
    ],
    evaluate: (candles, params, benchmarkCandles, upstreamData) => {
      const skip = upstreamData?.patternEndBar ?? params.skipBars ?? 0;
      const period = params.period ?? 60;
      const minScore = params.minScore ?? 1.2;
      if (candles.length < skip + period || !benchmarkCandles || benchmarkCandles.length < skip + period) return { pass: false, data: { _diagnostics: { value: 'insufficient data', threshold: `≥${minScore}x` } } };
      const effectiveCandles = skip > 0 ? candles.slice(skip) : candles;
      const effectiveBench = skip > 0 ? benchmarkCandles.slice(skip) : benchmarkCandles;
      const stockReturn = effectiveCandles[0].close / effectiveCandles[period - 1].close;
      const benchReturn = effectiveBench[0].close / effectiveBench[period - 1].close;
      if (benchReturn === 0) return { pass: false, data: { _diagnostics: { value: 'bench=0', threshold: `≥${minScore}x` } } };
      const score = stockReturn / benchReturn;
      return { pass: score >= minScore, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: `${score.toFixed(2)}x`, threshold: `≥${minScore}x` } } };
    },
  },
  {
    id: "RS-3",
    name: "RS Line New High",
    category: "Relative Strength",
    description: "Checks if the stock's relative strength line vs the benchmark is making or near a new high. When the RS line hits new highs, the stock is outperforming the market more than it has in months — a hallmark of true market leaders. Tolerance allows stocks within a few percent of the high to pass.",
    params: [
      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 0, min: 0, max: 200, step: 1, autoLink: { linkType: "sequenceOffset" } },
      { name: "lookback", label: "Lookback Period", type: "number", defaultValue: 60, min: 10, max: 260, step: 5 },
      { name: "tolerance", label: "Tolerance %", type: "number", defaultValue: 2, min: 0, max: 10, step: 0.5 },
    ],
    evaluate: (candles, params, benchmarkCandles, upstreamData) => {
      const skip = upstreamData?.patternEndBar ?? params.skipBars ?? 0;
      const lookback = params.lookback ?? 60;
      const tolerance = params.tolerance ?? 2;
      if (candles.length < skip + lookback || !benchmarkCandles || benchmarkCandles.length < skip + lookback) return { pass: false, data: { _diagnostics: { value: 'insufficient data', threshold: `within ${tolerance}% of high` } } };
      const effectiveCandles = skip > 0 ? candles.slice(skip) : candles;
      const effectiveBench = skip > 0 ? benchmarkCandles.slice(skip) : benchmarkCandles;
      const rsRatios: number[] = [];
      for (let i = 0; i < lookback; i++) {
        if (effectiveBench[i].close > 0) {
          rsRatios.push(effectiveCandles[i].close / effectiveBench[i].close);
        }
      }
      if (rsRatios.length < 2) return { pass: false, data: { _diagnostics: { value: 'insufficient RS data', threshold: `within ${tolerance}% of high` } } };
      const currentRS = rsRatios[0];
      const maxRS = Math.max(...rsRatios);
      const pass = currentRS >= maxRS * (1 - tolerance / 100);
      const pctFromHigh = maxRS > 0 ? ((maxRS - currentRS) / maxRS * 100).toFixed(1) : '0';
      return { pass, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: `${pctFromHigh}% from high`, threshold: `within ${tolerance}%`, detail: `RS ${currentRS.toFixed(3)}, max ${maxRS.toFixed(3)}` } } };
    },
  },
  {
    id: "RS-4",
    name: "RSI",
    category: "Relative Strength",
    description: "The classic RSI momentum oscillator, ranging 0-100. Values above 50 show bullish momentum; above 70 is overbought (strong but potentially extended). Values below 30 are oversold (weak but potentially bouncing). Use a 50-80 range to find stocks with healthy upward momentum that aren't overheated.",
    params: [
      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 0, min: 0, max: 200, step: 1, autoLink: { linkType: "sequenceOffset" } },
      { name: "period", label: "RSI Period", type: "number", defaultValue: 14, min: 5, max: 50, step: 1 },
      { name: "minRSI", label: "Min RSI", type: "number", defaultValue: 50, min: 0, max: 100, step: 1 },
      { name: "maxRSI", label: "Max RSI", type: "number", defaultValue: 80, min: 0, max: 100, step: 1 },
    ],
    evaluate: (candles, params, _benchmarkCandles, upstreamData) => {
      const skip = upstreamData?.patternEndBar ?? params.skipBars ?? 0;
      const period = params.period ?? 14;
      const minRSI = params.minRSI ?? 50;
      const maxRSI = params.maxRSI ?? 80;
      if (candles.length < skip + period + 1) return { pass: false, data: { _diagnostics: { value: 'insufficient data', threshold: `${minRSI}-${maxRSI}` } } };
      const effectiveCandles = skip > 0 ? candles.slice(skip) : candles;
      const rsi = calcRSI(effectiveCandles, period);
      return { pass: rsi >= minRSI && rsi <= maxRSI, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: `${rsi.toFixed(1)}`, threshold: `${minRSI}-${maxRSI}` } } };
    },
  },
  {
    id: "RS-5",
    name: "MACD",
    category: "Relative Strength",
    description: "The MACD momentum indicator with multiple signal conditions. 'Bullish cross' catches the moment the MACD line crosses above the signal line — a buy signal. 'Histogram positive' confirms upward momentum. 'Above zero' means the fast EMA is above the slow EMA. Use for momentum confirmation alongside trend filters.",
    params: [
      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 0, min: 0, max: 200, step: 1, autoLink: { linkType: "sequenceOffset" } },
      { name: "fastPeriod", label: "Fast Period", type: "number", defaultValue: 12, min: 5, max: 50, step: 1 },
      { name: "slowPeriod", label: "Slow Period", type: "number", defaultValue: 26, min: 10, max: 100, step: 1 },
      { name: "signalPeriod", label: "Signal Period", type: "number", defaultValue: 9, min: 3, max: 30, step: 1 },
      { name: "condition", label: "Condition", type: "select", defaultValue: "bullish_cross", options: ["bullish_cross", "bearish_cross", "histogram_positive", "histogram_negative", "above_zero", "below_zero"] },
    ],
    evaluate: (candles, params, _benchmarkCandles, upstreamData) => {
      const skip = upstreamData?.patternEndBar ?? params.skipBars ?? 0;
      const fast = params.fastPeriod ?? 12;
      const slow = params.slowPeriod ?? 26;
      const sig = params.signalPeriod ?? 9;
      const condition = params.condition ?? "bullish_cross";
      if (candles.length < skip + slow + sig) return { pass: false, data: { _diagnostics: { value: 'insufficient data', threshold: condition } } };
      const effectiveCandles = skip > 0 ? candles.slice(skip) : candles;
      const macd = calcMACD(effectiveCandles, fast, slow, sig);
      const prevMACD = calcMACD(effectiveCandles.slice(1), fast, slow, sig);
      let pass = false;
      switch (condition) {
        case "bullish_cross": pass = prevMACD.macd <= prevMACD.signal && macd.macd > macd.signal; break;
        case "bearish_cross": pass = prevMACD.macd >= prevMACD.signal && macd.macd < macd.signal; break;
        case "histogram_positive": pass = macd.histogram > 0; break;
        case "histogram_negative": pass = macd.histogram < 0; break;
        case "above_zero": pass = macd.macd > 0; break;
        case "below_zero": pass = macd.macd < 0; break;
        default: pass = false;
      }
      return { pass, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: `MACD ${macd.macd.toFixed(2)}, sig ${macd.signal.toFixed(2)}`, threshold: condition, detail: `hist ${macd.histogram.toFixed(2)}` } } };
    },
  },
  {
    id: "RS-6",
    name: "ADX",
    category: "Relative Strength",
    description: "Measures how STRONG the current trend is, regardless of direction. ADX above 25 = well-defined trend; above 40 = very strong trend; below 20 = no trend (choppy, range-bound). Enable 'Require Bullish' to filter for uptrends only (where buying pressure exceeds selling pressure).",
    params: [
      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 0, min: 0, max: 200, step: 1, autoLink: { linkType: "sequenceOffset" } },
      { name: "period", label: "ADX Period", type: "number", defaultValue: 14, min: 5, max: 50, step: 1 },
      { name: "minADX", label: "Min ADX", type: "number", defaultValue: 25, min: 0, max: 100, step: 1 },
      { name: "requireBullish", label: "Require Bullish (+DI > -DI)", type: "boolean", defaultValue: true },
    ],
    evaluate: (candles, params, _benchmarkCandles, upstreamData) => {
      const skip = upstreamData?.patternEndBar ?? params.skipBars ?? 0;
      const period = params.period ?? 14;
      const minADX = params.minADX ?? 25;
      const requireBullish = params.requireBullish ?? true;
      if (candles.length < skip + period * 2 + 1) return { pass: false, data: { _diagnostics: { value: 'insufficient data', threshold: `≥${minADX}` } } };
      const effectiveCandles = skip > 0 ? candles.slice(skip) : candles;
      const { adx, plusDI, minusDI } = calcADX(effectiveCandles, period);
      const pass = adx >= minADX && (!requireBullish || plusDI > minusDI);
      return { pass, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: `ADX ${adx.toFixed(1)}`, threshold: `≥${minADX}`, detail: `+DI ${plusDI.toFixed(1)} / -DI ${minusDI.toFixed(1)}` } } };
    },
  },
  {
    id: "RS-7",
    name: "Bull/Bear Power (Elder)",
    category: "Relative Strength",
    description: "Elder's momentum indicator comparing price extremes to the EMA. Bull Power (High minus EMA) > 0 means buyers pushed price above the trend — bullish. 'Bull rising' catches improving momentum across multiple bars. 'Bear rising' (negative bear power getting less negative) signals selling pressure is fading.",
    params: [
      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 0, min: 0, max: 200, step: 1, autoLink: { linkType: "sequenceOffset" } },
      { name: "period", label: "EMA Period", type: "number", defaultValue: 13, min: 5, max: 50, step: 1 },
      { name: "condition", label: "Condition", type: "select", defaultValue: "bull_positive", options: ["bull_positive", "bear_negative", "bull_rising", "bear_rising"] },
      { name: "lookback", label: "Lookback (for rising)", type: "number", defaultValue: 3, min: 1, max: 10, step: 1 },
    ],
    evaluate: (candles, params, _benchmarkCandles, upstreamData) => {
      const skip = upstreamData?.patternEndBar ?? params.skipBars ?? 0;
      const period = params.period ?? 13;
      const condition = params.condition ?? "bull_positive";
      const lookback = params.lookback ?? 3;
      if (candles.length < skip + period + lookback) return { pass: false, data: { _diagnostics: { value: 'insufficient data', threshold: condition } } };
      const effectiveCandles = skip > 0 ? candles.slice(skip) : candles;
      const ema = calcEMA(effectiveCandles, period);
      const bullPower = effectiveCandles[0].high - ema;
      const bearPower = effectiveCandles[0].low - ema;
      let pass = false;
      switch (condition) {
        case "bull_positive": pass = bullPower > 0; break;
        case "bear_negative": pass = bearPower < 0; break;
        case "bull_rising": {
          pass = true;
          for (let i = 0; i < lookback - 1; i++) {
            const e1 = calcEMA(effectiveCandles.slice(i), period);
            const e2 = calcEMA(effectiveCandles.slice(i + 1), period);
            const bp1 = effectiveCandles[i].high - e1;
            const bp2 = effectiveCandles[i + 1].high - e2;
            if (bp1 <= bp2) { pass = false; break; }
          }
          break;
        }
        case "bear_rising": {
          pass = true;
          for (let i = 0; i < lookback - 1; i++) {
            const e1 = calcEMA(effectiveCandles.slice(i), period);
            const e2 = calcEMA(effectiveCandles.slice(i + 1), period);
            const bp1 = effectiveCandles[i].low - e1;
            const bp2 = effectiveCandles[i + 1].low - e2;
            if (bp1 <= bp2) { pass = false; break; }
          }
          break;
        }
        default: pass = false;
      }
      return { pass, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: `bull ${bullPower.toFixed(2)}, bear ${bearPower.toFixed(2)}`, threshold: condition } } };
    },
  },
];

const VOLATILITY: IndicatorDefinition[] = [
  {
    id: "VLT-1",
    name: "Bollinger Band Width",
    category: "Volatility",
    description: "Measures how wide the Bollinger Bands are. Narrow bands (low width %) mean the stock is in a low-volatility squeeze — historically, these often precede big breakout moves. A width under 10% is compressed; under 5% is an extreme squeeze. Use Max Width to find stocks that are coiled tight.",
    params: [
      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 0, min: 0, max: 200, step: 1, autoLink: { linkType: "sequenceOffset" } },
      { name: "period", label: "BB Period", type: "number", defaultValue: 20, min: 5, max: 50, step: 1 },
      { name: "stdDev", label: "Std Dev Multiplier", type: "number", defaultValue: 2, min: 1, max: 4, step: 0.5 },
      { name: "maxWidth", label: "Max Width %", type: "number", defaultValue: 10, min: 1, max: 50, step: 0.5 },
      { name: "minWidth", label: "Min Width %", type: "number", defaultValue: 0, min: 0, max: 50, step: 0.5 },
    ],
    evaluate: (candles, params, _benchmarkCandles, upstreamData) => {
      const skip = upstreamData?.patternEndBar ?? params.skipBars ?? 0;
      const period = params.period ?? 20;
      const stdDev = params.stdDev ?? 2;
      const maxWidth = params.maxWidth ?? 10;
      const minWidth = params.minWidth ?? 0;
      if (candles.length < skip + period) return { pass: false, data: { _diagnostics: { value: 'insufficient data', threshold: `${minWidth}%-${maxWidth}%` } } };
      const effectiveCandles = skip > 0 ? candles.slice(skip) : candles;
      const bb = calcBollingerBands(effectiveCandles, period, stdDev);
      return { pass: bb.width >= minWidth && bb.width <= maxWidth, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: `${bb.width.toFixed(1)}%`, threshold: `${minWidth}%-${maxWidth}%` } } };
    },
  },
  {
    id: "VLT-3",
    name: "Daily Range vs Average",
    category: "Volatility",
    description: "Compares today's bar range (high minus low) to the average daily range. A multiple under 0.5 means today's bar is half the normal size — tight, quiet action. A multiple above 2.0 means today was twice as wide as normal — an expansion day. Use for spotting narrow-range days inside bases or breakout expansion bars.",
    params: [
      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 0, min: 0, max: 200, step: 1, autoLink: { linkType: "sequenceOffset" } },
      { name: "period", label: "Avg Range Period", type: "number", defaultValue: 20, min: 5, max: 100, step: 1 },
      { name: "minMultiple", label: "Min Range Multiple", type: "number", defaultValue: 0, min: 0, max: 10, step: 0.1 },
      { name: "maxMultiple", label: "Max Range Multiple", type: "number", defaultValue: 1.5, min: 0.1, max: 10, step: 0.1 },
    ],
    evaluate: (candles, params, _benchmarkCandles, upstreamData) => {
      const skip = upstreamData?.patternEndBar ?? params.skipBars ?? 0;
      const period = params.period ?? 20;
      const minMult = params.minMultiple ?? 0;
      const maxMult = params.maxMultiple ?? 1.5;
      if (candles.length < skip + period + 1) return { pass: false, data: { _diagnostics: { value: 'insufficient data', threshold: `${minMult}x-${maxMult}x` } } };
      const effectiveCandles = skip > 0 ? candles.slice(skip) : candles;
      const todayRange = effectiveCandles[0].high - effectiveCandles[0].low;
      let avgRange = 0;
      for (let i = 1; i <= period; i++) avgRange += effectiveCandles[i].high - effectiveCandles[i].low;
      avgRange /= period;
      if (avgRange === 0) return { pass: false, data: { _diagnostics: { value: 'avg range=0', threshold: `${minMult}x-${maxMult}x` } } };
      const multiple = todayRange / avgRange;
      return { pass: multiple >= minMult && multiple <= maxMult, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: `${multiple.toFixed(2)}x avg`, threshold: `${minMult}x-${maxMult}x`, detail: `today $${todayRange.toFixed(2)} vs avg $${avgRange.toFixed(2)}` } } };
    },
  },
  {
    id: "VLT-4",
    name: "Squeeze Detection",
    category: "Volatility",
    description: "Detects the TTM Squeeze — when Bollinger Bands contract inside the Keltner Channels. This extreme low-volatility state is like a compressed spring. When the squeeze fires (bands expand back outside Keltner), the stock often makes a sharp directional move. One of the most reliable volatility-based setups.",
    params: [
      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 0, min: 0, max: 200, step: 1, autoLink: { linkType: "sequenceOffset" } },
      { name: "bbPeriod", label: "BB Period", type: "number", defaultValue: 20, min: 5, max: 50, step: 1 },
      { name: "bbStdDev", label: "BB Std Dev", type: "number", defaultValue: 2, min: 1, max: 4, step: 0.5 },
      { name: "kcPeriod", label: "Keltner Period", type: "number", defaultValue: 20, min: 5, max: 50, step: 1 },
      { name: "kcMult", label: "Keltner ATR Multiplier", type: "number", defaultValue: 1.5, min: 0.5, max: 4, step: 0.5 },
    ],
    evaluate: (candles, params, _benchmarkCandles, upstreamData) => {
      const skip = upstreamData?.patternEndBar ?? params.skipBars ?? 0;
      const bbPeriod = params.bbPeriod ?? 20;
      const bbStdDev = params.bbStdDev ?? 2;
      const kcPeriod = params.kcPeriod ?? 20;
      const kcMult = params.kcMult ?? 1.5;
      const needed = Math.max(bbPeriod, kcPeriod) + 1;
      if (candles.length < skip + needed) return { pass: false, data: { _diagnostics: { value: 'insufficient data', threshold: 'BB inside KC' } } };
      const effectiveCandles = skip > 0 ? candles.slice(skip) : candles;
      const bb = calcBollingerBands(effectiveCandles, bbPeriod, bbStdDev);
      const ema = calcEMA(effectiveCandles, kcPeriod);
      const atr = calcATR(effectiveCandles, kcPeriod);
      const kcUpper = ema + kcMult * atr;
      const kcLower = ema - kcMult * atr;
      const pass = bb.lower > kcLower && bb.upper < kcUpper;
      return { pass, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: `BB ${bb.width.toFixed(1)}%`, threshold: 'BB inside KC', detail: `BB [${bb.lower.toFixed(2)}-${bb.upper.toFixed(2)}] KC [${kcLower.toFixed(2)}-${kcUpper.toFixed(2)}]` } } };
    },
  },
  {
    id: "VLT-5",
    name: "Price vs Bollinger Bands",
    category: "Volatility",
    description: "Checks where the current price sits relative to the Bollinger Bands. 'Above upper' finds stocks breaking out above the upper band (strong momentum but potentially overextended). 'Below lower' finds oversold bounces. 'Near middle' catches stocks reverting to the mean. The %B indicator (0-100) shows the exact position: 0 = at lower band, 50 = at middle, 100 = at upper band.",
    params: [
      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 0, min: 0, max: 200, step: 1, autoLink: { linkType: "sequenceOffset" } },
      { name: "period", label: "BB Period", type: "number", defaultValue: 20, min: 5, max: 50, step: 1 },
      { name: "stdDev", label: "Std Dev Multiplier", type: "number", defaultValue: 2, min: 1, max: 4, step: 0.5 },
      { name: "position", label: "Price Position", type: "select", defaultValue: "above_upper", options: ["above_upper", "below_lower", "near_upper", "near_middle", "near_lower", "inside_bands"] },
      { name: "tolerance", label: "Near Tolerance %", type: "number", defaultValue: 5, min: 1, max: 20, step: 1 },
    ],
    evaluate: (candles, params, _benchmarkCandles, upstreamData) => {
      const skip = upstreamData?.patternEndBar ?? params.skipBars ?? 0;
      const period = params.period ?? 20;
      const stdDev = params.stdDev ?? 2;
      const position = params.position ?? "above_upper";
      const tolerance = (params.tolerance ?? 5) / 100;
      if (candles.length < skip + period) return { pass: false, data: { _diagnostics: { value: 'insufficient data', threshold: position } } };
      const effectiveCandles = skip > 0 ? candles.slice(skip) : candles;
      const bb = calcBollingerBands(effectiveCandles, period, stdDev);
      const price = effectiveCandles[0].close;
      const bandRange = bb.upper - bb.lower;
      const percentB = bandRange > 0 ? ((price - bb.lower) / bandRange) * 100 : 50;
      
      let pass = false;
      switch (position) {
        case "above_upper": pass = price > bb.upper; break;
        case "below_lower": pass = price < bb.lower; break;
        case "near_upper": pass = Math.abs(price - bb.upper) / bb.upper <= tolerance; break;
        case "near_middle": pass = Math.abs(price - bb.middle) / bb.middle <= tolerance; break;
        case "near_lower": pass = Math.abs(price - bb.lower) / bb.lower <= tolerance; break;
        case "inside_bands": pass = price >= bb.lower && price <= bb.upper; break;
      }
      return { pass, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: `%B: ${percentB.toFixed(1)}`, threshold: position, detail: `price $${price.toFixed(2)} vs bands [${bb.lower.toFixed(2)}-${bb.upper.toFixed(2)}]` } } };
    },
  },
];

const CONSOLIDATION: IndicatorDefinition[] = [
  {
    id: "CB-1",
    name: "Find Base (Historical)",
    category: "Consolidation",
    description: "Searches through price history to LOCATE a consolidation (base) — a period where price traded sideways within a tight range. Unlike PA-3 which checks if the stock is currently IN a base, this indicator scans backwards (or forwards) through up to 500 bars to find WHERE a base existed and passes its location downstream. Use it to chain patterns: Find Base → Price Advance → Find Another Base. When connected downstream from another Find Base, automatically starts searching PAST the upstream base's oldest bar to prevent overlap. When connected downstream from PA-3 (Consolidation / Base Detection), automatically starts searching PAST the current base's detected period to prevent overlap. The Skip Recent Bars param auto-links to PA-3's period when both are in the scan, ensuring the historical base search doesn't overlap with the current base detection zone. Provides base top/bottom price lines for chart rendering.",
    provides: [{ linkType: "baseBar", paramName: "searchWindow" }],
    consumes: [{ paramName: "searchStart", dataKey: "baseStartBar" }, { paramName: "searchStart", dataKey: "detectedPeriod" }],
    params: [
      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 0, min: 0, max: 200, step: 1, autoLink: { linkType: "sequenceOffset" } },
      { name: "searchWindow", label: "Search Window (bars)", type: "number", defaultValue: 200, min: 20, max: 500, step: 10 },
      { name: "searchDirection", label: "Search Direction", type: "select", defaultValue: "backward", options: ["backward", "forward"] },
      { name: "minBaseLength", label: "Min Base Length (bars)", type: "number", defaultValue: 10, min: 5, max: 100, step: 1 },
      { name: "maxBaseLength", label: "Max Base Length (bars)", type: "number", defaultValue: 60, min: 10, max: 200, step: 5 },
      { name: "maxRangePct", label: "Max Price Range %", type: "number", defaultValue: 15, min: 3, max: 40, step: 0.5 },
      { name: "volumeContraction", label: "Require Volume Contraction", type: "boolean", defaultValue: true },
      { name: "volumeDeclinePct", label: "Volume Decline %", type: "number", defaultValue: 30, min: 10, max: 80, step: 5 },
      { name: "skipRecentBars", label: "Skip Recent Bars", type: "number", defaultValue: 0, min: 0, max: 100, step: 1, autoLink: { linkType: "basePeriod" } },
    ],
    evaluate: (candles, params, _benchmarkCandles, upstreamData) => {
      const skip = upstreamData?.patternEndBar ?? params.skipBars ?? 0;
      const searchWindow = params.searchWindow ?? 200;
      const direction = params.searchDirection ?? "backward";
      const minLen = params.minBaseLength ?? 10;
      const maxLen = params.maxBaseLength ?? 60;
      const maxRange = params.maxRangePct ?? 15;
      const requireVolContraction = params.volumeContraction ?? true;
      const volDecline = params.volumeDeclinePct ?? 30;
      const skipRecent = params.skipRecentBars ?? 0;

      const upstreamBaseStart = upstreamData?.baseStartBar;
      const upstreamDetectedPeriod = upstreamData?.detectedPeriod;
      const upstreamStartBar = typeof upstreamBaseStart === "number" ? upstreamBaseStart : (typeof upstreamDetectedPeriod === "number" ? upstreamDetectedPeriod : undefined);
      const dynamicStart = typeof upstreamStartBar === "number" ? upstreamStartBar + 1 : 0;
      const startOffset = Math.max(dynamicStart, skipRecent, skip);

      if (candles.length < startOffset + minLen + 10) {
        return { pass: false, data: { _diagnostics: { value: "insufficient data", threshold: `${minLen}-${maxLen} bar base within ${searchWindow} bars` } } };
      }

      const maxSearchEnd = Math.min(startOffset + searchWindow, candles.length);

      let bestBase: { start: number; end: number; topPrice: number; lowPrice: number; depth: number; duration: number } | null = null;

      if (direction === "backward") {
        for (let scanStart = startOffset; scanStart < maxSearchEnd - minLen; scanStart++) {
          for (let length = maxLen; length >= minLen; length--) {
            const scanEnd = scanStart + length;
            if (scanEnd > maxSearchEnd) continue;
            if (scanEnd > candles.length) continue;

            const slice = candles.slice(scanStart, scanEnd);
            if (slice.length < minLen) continue;

            const high = Math.max(...slice.map(c => c.high));
            const low = Math.min(...slice.map(c => c.low));
            if (high === 0) continue;
            const rangePct = ((high - low) / high) * 100;
            if (rangePct > maxRange) continue;

            const closes = slice.map(c => c.close);
            const n = closes.length;
            const sumX = (n * (n - 1)) / 2;
            const sumX2 = ((n - 1) * n * (2 * n - 1)) / 6;
            let sumY = 0, sumXY = 0;
            for (let i = 0; i < n; i++) { sumY += closes[i]; sumXY += i * closes[i]; }
            const denom = n * sumX2 - sumX * sumX;
            if (denom !== 0) {
              const slope = (n * sumXY - sumX * sumY) / denom;
              const avgPrice = sumY / n;
              if (avgPrice > 0) {
                const totalDrift = Math.abs((slope / avgPrice) * 100 * n);
                if (totalDrift > maxRange * 0.5) continue;
              }
            }

            if (requireVolContraction) {
              const baseVol = slice.reduce((s, c) => s + (c.volume || 0), 0) / slice.length;
              const preBaseStart = scanEnd;
              const preBaseEnd = Math.min(scanEnd + length, candles.length);
              const preSlice = candles.slice(preBaseStart, preBaseEnd);
              if (preSlice.length > 0) {
                const preVol = preSlice.reduce((s, c) => s + (c.volume || 0), 0) / preSlice.length;
                if (preVol > 0) {
                  const decline = ((preVol - baseVol) / preVol) * 100;
                  if (decline < volDecline) continue;
                }
              }
            }

            bestBase = { start: scanEnd - 1, end: scanStart, topPrice: high, lowPrice: low, depth: rangePct, duration: length };
            break;
          }
          if (bestBase) break;
        }
      } else {
        for (let scanStart = maxSearchEnd - minLen; scanStart >= startOffset; scanStart--) {
          for (let length = maxLen; length >= minLen; length--) {
            const scanEnd = scanStart + length;
            if (scanEnd > candles.length) continue;

            const slice = candles.slice(scanStart, scanEnd);
            if (slice.length < minLen) continue;

            const high = Math.max(...slice.map(c => c.high));
            const low = Math.min(...slice.map(c => c.low));
            if (high === 0) continue;
            const rangePct = ((high - low) / high) * 100;
            if (rangePct > maxRange) continue;

            const closes = slice.map(c => c.close);
            const n = closes.length;
            const sumX = (n * (n - 1)) / 2;
            const sumX2 = ((n - 1) * n * (2 * n - 1)) / 6;
            let sumY = 0, sumXY = 0;
            for (let i = 0; i < n; i++) { sumY += closes[i]; sumXY += i * closes[i]; }
            const denom = n * sumX2 - sumX * sumX;
            if (denom !== 0) {
              const slope = (n * sumXY - sumX * sumY) / denom;
              const avgPrice = sumY / n;
              if (avgPrice > 0) {
                const totalDrift = Math.abs((slope / avgPrice) * 100 * n);
                if (totalDrift > maxRange * 0.5) continue;
              }
            }

            if (requireVolContraction) {
              const baseVol = slice.reduce((s, c) => s + (c.volume || 0), 0) / slice.length;
              const preBaseStart = scanEnd;
              const preBaseEnd = Math.min(scanEnd + length, candles.length);
              const preSlice = candles.slice(preBaseStart, preBaseEnd);
              if (preSlice.length > 0) {
                const preVol = preSlice.reduce((s, c) => s + (c.volume || 0), 0) / preSlice.length;
                if (preVol > 0) {
                  const decline = ((preVol - baseVol) / preVol) * 100;
                  if (decline < volDecline) continue;
                }
              }
            }

            bestBase = { start: scanEnd - 1, end: scanStart, topPrice: high, lowPrice: low, depth: rangePct, duration: length };
            break;
          }
          if (bestBase) break;
        }
      }

      if (!bestBase) {
        return { pass: false, data: { _diagnostics: { value: "no base found", threshold: `${minLen}-${maxLen} bars, ≤${maxRange}% range, window ${searchWindow}` } } };
      }

      return {
        pass: true,
        data: {
          evaluationStartBar: startOffset,
          evaluationEndBar: bestBase.end,
          patternEndBar: bestBase.end,
          baseStartBar: bestBase.start,
          baseEndBar: bestBase.end,
          baseTopPrice: bestBase.topPrice,
          baseLowPrice: bestBase.lowPrice,
          baseDepth: bestBase.depth,
          baseDuration: bestBase.duration,
          _cocHighlight: { type: "baseZone", topPrice: bestBase.topPrice, lowPrice: bestBase.lowPrice, startBar: bestBase.start, endBar: bestBase.end },
          _diagnostics: {
            value: `${bestBase.duration} bars`,
            threshold: `${minLen}-${maxLen} bars, ≤${maxRange}%`,
            detail: `bars ${bestBase.start}→${bestBase.end}, top $${bestBase.topPrice.toFixed(2)}, low $${bestBase.lowPrice.toFixed(2)}, depth ${bestBase.depth.toFixed(1)}%`
          }
        }
      };
    },
  },
];

// === MOMENTUM INDICATORS ===
const MOMENTUM: IndicatorDefinition[] = [
  {
    id: "MOM-1",
    name: "Stochastic Oscillator",
    category: "Momentum",
    description: "The classic Stochastic momentum oscillator comparing the closing price to the high-low range over a period. %K is the fast line, %D is the smoothed signal line. Values above 80 are overbought (strong but extended); below 20 are oversold (weak but potential bounce). A bullish cross (%K crosses above %D) in oversold territory is a classic buy signal. Use for momentum confirmation and reversal detection.",
    params: [
      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 0, min: 0, max: 200, step: 1, autoLink: { linkType: "sequenceOffset" } },
      { name: "kPeriod", label: "%K Period", type: "number", defaultValue: 14, min: 5, max: 50, step: 1 },
      { name: "dPeriod", label: "%D Period", type: "number", defaultValue: 3, min: 1, max: 10, step: 1 },
      { name: "smooth", label: "Smoothing", type: "number", defaultValue: 3, min: 1, max: 10, step: 1 },
      { name: "condition", label: "Condition", type: "select", defaultValue: "bullish_cross", options: ["bullish_cross", "bearish_cross", "overbought", "oversold", "k_above_d", "k_below_d"] },
      { name: "overboughtLevel", label: "Overbought Level", type: "number", defaultValue: 80, min: 50, max: 95, step: 5 },
      { name: "oversoldLevel", label: "Oversold Level", type: "number", defaultValue: 20, min: 5, max: 50, step: 5 },
    ],
    evaluate: (candles, params, _benchmarkCandles, upstreamData) => {
      const skip = upstreamData?.patternEndBar ?? params.skipBars ?? 0;
      const kPeriod = params.kPeriod ?? 14;
      const dPeriod = params.dPeriod ?? 3;
      const smooth = params.smooth ?? 3;
      const condition = params.condition ?? "bullish_cross";
      const overbought = params.overboughtLevel ?? 80;
      const oversold = params.oversoldLevel ?? 20;
      const needed = kPeriod + dPeriod + smooth;
      if (candles.length < skip + needed) return { pass: false, data: { _diagnostics: { value: 'insufficient data', threshold: condition } } };
      const effectiveCandles = skip > 0 ? candles.slice(skip) : candles;
      const stoch = calcStochastic(effectiveCandles, kPeriod, dPeriod, smooth);
      let pass = false;
      
      switch (condition) {
        case "bullish_cross": pass = stoch.k > stoch.d && stoch.prevK <= stoch.prevD; break;
        case "bearish_cross": pass = stoch.k < stoch.d && stoch.prevK >= stoch.prevD; break;
        case "overbought": pass = stoch.k >= overbought && stoch.d >= overbought; break;
        case "oversold": pass = stoch.k <= oversold && stoch.d <= oversold; break;
        case "k_above_d": pass = stoch.k > stoch.d; break;
        case "k_below_d": pass = stoch.k < stoch.d; break;
      }
      
      return { pass, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: `%K: ${stoch.k.toFixed(1)}, %D: ${stoch.d.toFixed(1)}`, threshold: condition, detail: `prev %K: ${stoch.prevK.toFixed(1)}, prev %D: ${stoch.prevD.toFixed(1)}` } } };
    },
  },
  {
    id: "MOM-2",
    name: "RSI Divergence",
    category: "Momentum",
    description: "Detects divergence between price and RSI — a powerful reversal signal. Bullish divergence: price makes a lower low but RSI makes a higher low (hidden buying pressure). Bearish divergence: price makes a higher high but RSI makes a lower high (hidden selling pressure). Divergences often precede trend reversals. The lookback period controls how far back to search for the divergence pattern.",
    params: [
      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 0, min: 0, max: 200, step: 1, autoLink: { linkType: "sequenceOffset" } },
      { name: "rsiPeriod", label: "RSI Period", type: "number", defaultValue: 14, min: 5, max: 30, step: 1 },
      { name: "lookback", label: "Divergence Lookback (bars)", type: "number", defaultValue: 20, min: 5, max: 50, step: 1 },
      { name: "divergenceType", label: "Divergence Type", type: "select", defaultValue: "bullish", options: ["bullish", "bearish", "any"] },
      { name: "minDivergence", label: "Min RSI Divergence", type: "number", defaultValue: 5, min: 1, max: 20, step: 1 },
    ],
    evaluate: (candles, params, _benchmarkCandles, upstreamData) => {
      const skip = upstreamData?.patternEndBar ?? params.skipBars ?? 0;
      const rsiPeriod = params.rsiPeriod ?? 14;
      const lookback = params.lookback ?? 20;
      const divergenceType = params.divergenceType ?? "bullish";
      const minDiv = params.minDivergence ?? 5;
      
      if (candles.length < skip + lookback + rsiPeriod + 5) {
        return { pass: false, data: { _diagnostics: { value: 'insufficient data', threshold: `${divergenceType} divergence` } } };
      }
      
      const effectiveCandles = skip > 0 ? candles.slice(skip) : candles;
      const rsiValues = calcRSISeries(effectiveCandles, rsiPeriod, lookback + 1);
      const currentPrice = effectiveCandles[0].close;
      const currentRSI = rsiValues[0];
      
      // Find swing lows/highs in price and RSI
      let bullishDiv = false;
      let bearishDiv = false;
      
      for (let i = 5; i < lookback - 2; i++) {
        const pastPrice = effectiveCandles[i].close;
        const pastRSI = rsiValues[i];
        
        // Bullish divergence: price lower low, RSI higher low
        if (currentPrice < pastPrice && currentRSI > pastRSI + minDiv) {
          // Check if these are actual swing lows
          const priceIsLow = effectiveCandles[0].low <= Math.min(...effectiveCandles.slice(0, 3).map(c => c.low));
          const pastPriceWasLow = effectiveCandles[i].low <= Math.min(...effectiveCandles.slice(i-2, i+3).map(c => c.low));
          if (priceIsLow && pastPriceWasLow) bullishDiv = true;
        }
        
        // Bearish divergence: price higher high, RSI lower high
        if (currentPrice > pastPrice && currentRSI < pastRSI - minDiv) {
          const priceIsHigh = effectiveCandles[0].high >= Math.max(...effectiveCandles.slice(0, 3).map(c => c.high));
          const pastPriceWasHigh = effectiveCandles[i].high >= Math.max(...effectiveCandles.slice(i-2, i+3).map(c => c.high));
          if (priceIsHigh && pastPriceWasHigh) bearishDiv = true;
        }
      }
      
      let pass = false;
      let found = "none";
      if (divergenceType === "bullish" && bullishDiv) { pass = true; found = "bullish"; }
      else if (divergenceType === "bearish" && bearishDiv) { pass = true; found = "bearish"; }
      else if (divergenceType === "any" && (bullishDiv || bearishDiv)) { pass = true; found = bullishDiv ? "bullish" : "bearish"; }
      
      return { pass, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: `RSI ${currentRSI.toFixed(1)}, div: ${found}`, threshold: `${divergenceType} divergence`, detail: `lookback ${lookback} bars, min div ${minDiv}` } } };
    },
  },
  {
    id: "MOM-3",
    name: "MACD Histogram",
    category: "Momentum",
    description: "Focuses on the MACD histogram — the difference between the MACD line and signal line. A rising histogram (bars getting taller) shows accelerating momentum. 'Positive rising' catches stocks where bullish momentum is increasing. 'Negative falling' (histogram getting more negative) catches accelerating selloffs. Use for momentum confirmation and acceleration detection.",
    params: [
      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 0, min: 0, max: 200, step: 1, autoLink: { linkType: "sequenceOffset" } },
      { name: "fastPeriod", label: "Fast EMA", type: "number", defaultValue: 12, min: 5, max: 30, step: 1 },
      { name: "slowPeriod", label: "Slow EMA", type: "number", defaultValue: 26, min: 10, max: 50, step: 1 },
      { name: "signalPeriod", label: "Signal Period", type: "number", defaultValue: 9, min: 3, max: 20, step: 1 },
      { name: "condition", label: "Histogram Condition", type: "select", defaultValue: "positive_rising", options: ["positive_rising", "positive_falling", "negative_rising", "negative_falling", "positive", "negative", "zero_cross_up", "zero_cross_down"] },
      { name: "barsToCheck", label: "Bars to Check Trend", type: "number", defaultValue: 3, min: 2, max: 10, step: 1 },
    ],
    evaluate: (candles, params, _benchmarkCandles, upstreamData) => {
      const skip = upstreamData?.patternEndBar ?? params.skipBars ?? 0;
      const fast = params.fastPeriod ?? 12;
      const slow = params.slowPeriod ?? 26;
      const sig = params.signalPeriod ?? 9;
      const condition = params.condition ?? "positive_rising";
      const barsToCheck = params.barsToCheck ?? 3;
      
      if (candles.length < skip + slow + sig + barsToCheck + 5) {
        return { pass: false, data: { _diagnostics: { value: 'insufficient data', threshold: condition } } };
      }
      
      const effectiveCandles = skip > 0 ? candles.slice(skip) : candles;
      const histValues: number[] = [];
      for (let i = 0; i < barsToCheck + 1; i++) {
        const macd = calcMACD(effectiveCandles.slice(i), fast, slow, sig);
        histValues.push(macd.histogram);
      }
      
      const currentHist = histValues[0];
      const prevHist = histValues[1];
      const isRising = histValues.slice(0, barsToCheck).every((v, i, arr) => i === 0 || v >= arr[i-1] * 0.95);
      const isFalling = histValues.slice(0, barsToCheck).every((v, i, arr) => i === 0 || v <= arr[i-1] * 1.05);
      
      let pass = false;
      switch (condition) {
        case "positive_rising": pass = currentHist > 0 && isRising; break;
        case "positive_falling": pass = currentHist > 0 && isFalling; break;
        case "negative_rising": pass = currentHist < 0 && isRising; break;
        case "negative_falling": pass = currentHist < 0 && isFalling; break;
        case "positive": pass = currentHist > 0; break;
        case "negative": pass = currentHist < 0; break;
        case "zero_cross_up": pass = currentHist > 0 && prevHist <= 0; break;
        case "zero_cross_down": pass = currentHist < 0 && prevHist >= 0; break;
      }
      
      return { pass, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: `Hist: ${currentHist.toFixed(3)}`, threshold: condition, detail: `rising: ${isRising}, falling: ${isFalling}` } } };
    },
  },
];

// === FUNDAMENTAL INDICATORS ===
// NOTE: These indicators require external fundamental data passed via the scan context.
// The evaluate function checks for fundamentalData in upstreamData which must be populated
// by the scan engine before running these indicators.
const FUNDAMENTAL: IndicatorDefinition[] = [
  {
    id: "FND-1",
    name: "Market Cap Filter",
    category: "Fundamental",
    description: "Filters stocks by market capitalization. Micro-cap (<$300M), Small-cap ($300M-$2B), Mid-cap ($2B-$10B), Large-cap ($10B-$200B), Mega-cap (>$200B). Smaller caps tend to be more volatile with higher growth potential; larger caps are more stable. Use to focus on your preferred liquidity and volatility profile. Requires fundamental data from external source.",
    params: [
      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 0, min: 0, max: 200, step: 1, autoLink: { linkType: "sequenceOffset" } },
      { name: "minMarketCap", label: "Min Market Cap ($M)", type: "number", defaultValue: 300, min: 0, max: 100000, step: 100 },
      { name: "maxMarketCap", label: "Max Market Cap ($M)", type: "number", defaultValue: 50000, min: 0, max: 500000, step: 1000 },
    ],
    evaluate: (candles, params, _benchmarkCandles, upstreamData) => {
      const skip = upstreamData?.patternEndBar ?? params.skipBars ?? 0;
      const minCap = (params.minMarketCap ?? 300) * 1000000;
      const maxCap = (params.maxMarketCap ?? 50000) * 1000000;
      const marketCap = upstreamData?.fundamentalData?.marketCap;
      
      // Treat undefined, null, or 0 as "no data" (0 is returned by getFundamentals when data not found)
      if (marketCap === undefined || marketCap === null || marketCap === 0) {
        return { pass: false, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: 'no market cap data', threshold: `$${params.minMarketCap}M-$${params.maxMarketCap}M` } } };
      }
      
      const pass = marketCap >= minCap && marketCap <= maxCap;
      const capInM = (marketCap / 1000000).toFixed(0);
      return { pass, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: `$${capInM}M`, threshold: `$${params.minMarketCap}M-$${params.maxMarketCap}M` } } };
    },
  },
  {
    id: "FND-2",
    name: "PE Ratio Filter",
    category: "Fundamental",
    description: "Filters stocks by Price-to-Earnings ratio. Low PE (<15) may indicate undervaluation or slow growth. High PE (>30) suggests high growth expectations or overvaluation. Negative PE means the company is unprofitable. Use to screen for value stocks (low PE) or exclude expensive growth stocks. Requires fundamental data from external source.",
    params: [
      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 0, min: 0, max: 200, step: 1, autoLink: { linkType: "sequenceOffset" } },
      { name: "minPE", label: "Min PE Ratio", type: "number", defaultValue: 0, min: -100, max: 500, step: 1 },
      { name: "maxPE", label: "Max PE Ratio", type: "number", defaultValue: 50, min: 0, max: 1000, step: 5 },
      { name: "excludeNegative", label: "Exclude Negative PE", type: "boolean", defaultValue: true },
    ],
    evaluate: (candles, params, _benchmarkCandles, upstreamData) => {
      const skip = upstreamData?.patternEndBar ?? params.skipBars ?? 0;
      const minPE = params.minPE ?? 0;
      const maxPE = params.maxPE ?? 50;
      const excludeNeg = params.excludeNegative ?? true;
      const pe = upstreamData?.fundamentalData?.pe;
      
      if (pe === undefined || pe === null) {
        return { pass: false, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: 'no PE data', threshold: `${minPE}-${maxPE}` } } };
      }
      
      if (excludeNeg && pe < 0) {
        return { pass: false, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: `PE: ${pe.toFixed(1)} (negative)`, threshold: `${minPE}-${maxPE}` } } };
      }
      
      const pass = pe >= minPE && pe <= maxPE;
      return { pass, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: `PE: ${pe.toFixed(1)}`, threshold: `${minPE}-${maxPE}` } } };
    },
  },
  {
    id: "FND-3",
    name: "Sector Filter",
    category: "Fundamental",
    description: "Filters stocks by their sector classification. Use to focus on specific sectors (Technology, Healthcare, Financials, etc.) or exclude sectors you want to avoid. Great for sector rotation strategies or avoiding overexposure. Requires fundamental data from external source with sector information.",
    params: [
      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 0, min: 0, max: 200, step: 1, autoLink: { linkType: "sequenceOffset" } },
      { name: "sectors", label: "Sectors (comma-separated)", type: "select", defaultValue: "Technology", options: ["Technology", "Healthcare", "Financials", "Consumer Cyclical", "Consumer Defensive", "Industrials", "Energy", "Basic Materials", "Real Estate", "Utilities", "Communication Services"] },
      { name: "mode", label: "Filter Mode", type: "select", defaultValue: "include", options: ["include", "exclude"] },
    ],
    evaluate: (candles, params, _benchmarkCandles, upstreamData) => {
      const skip = upstreamData?.patternEndBar ?? params.skipBars ?? 0;
      const targetSector = params.sectors ?? "Technology";
      const mode = params.mode ?? "include";
      const sector = upstreamData?.fundamentalData?.sector;
      
      if (!sector) {
        return { pass: false, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: 'no sector data', threshold: `${mode} ${targetSector}` } } };
      }
      
      const match = sector.toLowerCase().includes(targetSector.toLowerCase());
      const pass = mode === "include" ? match : !match;
      return { pass, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: sector, threshold: `${mode} ${targetSector}` } } };
    },
  },
  {
    id: "FND-4",
    name: "Earnings Proximity",
    category: "Fundamental",
    description: "Filters stocks based on how close they are to their next earnings report. Avoid stocks with earnings in 1-5 days to reduce binary event risk. Or target stocks with imminent earnings for volatility plays. Negative days means earnings have already passed. Requires fundamental data with next earnings date.",
    params: [
      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 0, min: 0, max: 200, step: 1, autoLink: { linkType: "sequenceOffset" } },
      { name: "minDays", label: "Min Days to Earnings", type: "number", defaultValue: 7, min: -30, max: 90, step: 1 },
      { name: "maxDays", label: "Max Days to Earnings", type: "number", defaultValue: 60, min: 0, max: 120, step: 5 },
    ],
    evaluate: (candles, params, _benchmarkCandles, upstreamData) => {
      const skip = upstreamData?.patternEndBar ?? params.skipBars ?? 0;
      const minDays = params.minDays ?? 7;
      const maxDays = params.maxDays ?? 60;
      const daysToEarnings = upstreamData?.fundamentalData?.daysToEarnings;
      
      if (daysToEarnings === undefined || daysToEarnings === null) {
        return { pass: false, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: 'no earnings date', threshold: `${minDays}-${maxDays} days` } } };
      }
      
      const pass = daysToEarnings >= minDays && daysToEarnings <= maxDays;
      return { pass, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: `${daysToEarnings} days`, threshold: `${minDays}-${maxDays} days` } } };
    },
  },
];

// === INTRADAY INDICATORS ===
const INTRADAY: IndicatorDefinition[] = [
  {
    id: "ITD-1",
    name: "Opening Range Breakout",
    category: "Intraday",
    description: "Detects stocks breaking out of their opening range — the high and low established in the first N minutes of trading. A breakout above the opening range high with volume suggests strong buyer interest. Works best on intraday timeframes (5min, 15min). The opening range is calculated from the first N bars of the session.",
    params: [
      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 0, min: 0, max: 200, step: 1, autoLink: { linkType: "sequenceOffset" } },
      { name: "orbBars", label: "Opening Range Bars", type: "number", defaultValue: 3, min: 1, max: 12, step: 1 },
      { name: "breakoutDir", label: "Breakout Direction", type: "select", defaultValue: "up", options: ["up", "down", "any"] },
      { name: "minBreakout", label: "Min Breakout %", type: "number", defaultValue: 0.1, min: 0, max: 5, step: 0.1 },
      { name: "volumeConfirm", label: "Require Volume Surge", type: "boolean", defaultValue: false },
      { name: "volumeMultiple", label: "Volume Multiple", type: "number", defaultValue: 1.5, min: 1, max: 5, step: 0.1 },
    ],
    evaluate: (candles, params, _benchmarkCandles, upstreamData) => {
      const skip = upstreamData?.patternEndBar ?? params.skipBars ?? 0;
      const orbBars = params.orbBars ?? 3;
      const direction = params.breakoutDir ?? "up";
      const minBreakout = (params.minBreakout ?? 0.1) / 100;
      const volumeConfirm = params.volumeConfirm ?? false;
      const volumeMult = params.volumeMultiple ?? 1.5;
      
      if (candles.length < skip + orbBars + 5) {
        return { pass: false, data: { _diagnostics: { value: 'insufficient data', threshold: `ORB ${direction}` } } };
      }
      
      const effectiveCandles = skip > 0 ? candles.slice(skip) : candles;
      const recentBars = effectiveCandles.slice(0, orbBars * 2);
      const orbHigh = Math.max(...recentBars.slice(orbBars, orbBars * 2).map(c => c.high));
      const orbLow = Math.min(...recentBars.slice(orbBars, orbBars * 2).map(c => c.low));
      
      const currentPrice = effectiveCandles[0].close;
      const currentHigh = effectiveCandles[0].high;
      const currentLow = effectiveCandles[0].low;
      
      const breakoutUp = currentHigh > orbHigh * (1 + minBreakout);
      const breakoutDown = currentLow < orbLow * (1 - minBreakout);
      
      let pass = false;
      if (direction === "up") pass = breakoutUp;
      else if (direction === "down") pass = breakoutDown;
      else pass = breakoutUp || breakoutDown;
      
      if (pass && volumeConfirm) {
        const avgVol = effectiveCandles.slice(1, 21).reduce((s, c) => s + c.volume, 0) / 20;
        if (effectiveCandles[0].volume < avgVol * volumeMult) pass = false;
      }
      
      return { pass, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: `ORB: $${orbLow.toFixed(2)}-$${orbHigh.toFixed(2)}`, threshold: `${direction} breakout`, detail: `current $${currentPrice.toFixed(2)}` } } };
    },
  },
  {
    id: "ITD-2",
    name: "VWAP Position",
    category: "Intraday",
    description: "Checks where price is relative to VWAP (Volume Weighted Average Price). VWAP is the average price weighted by volume — institutional traders often use it as a benchmark. Price above VWAP suggests buyers are in control; below suggests sellers. A cross above VWAP can be a bullish signal. Best used on intraday timeframes.",
    params: [
      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 0, min: 0, max: 200, step: 1, autoLink: { linkType: "sequenceOffset" } },
      { name: "vwapBars", label: "VWAP Calculation Bars", type: "number", defaultValue: 78, min: 10, max: 390, step: 1 },
      { name: "position", label: "Price Position", type: "select", defaultValue: "above", options: ["above", "below", "cross_above", "cross_below", "near"] },
      { name: "tolerance", label: "Near Tolerance %", type: "number", defaultValue: 0.2, min: 0.05, max: 2, step: 0.05 },
    ],
    evaluate: (candles, params, _benchmarkCandles, upstreamData) => {
      const skip = upstreamData?.patternEndBar ?? params.skipBars ?? 0;
      const vwapBars = params.vwapBars ?? 78;
      const position = params.position ?? "above";
      const tolerance = (params.tolerance ?? 0.2) / 100;
      
      if (candles.length < skip + vwapBars + 2) {
        return { pass: false, data: { _diagnostics: { value: 'insufficient data', threshold: `VWAP ${position}` } } };
      }
      
      const effectiveCandles = skip > 0 ? candles.slice(skip) : candles;
      const vwap = calcVWAP(effectiveCandles.slice(0, vwapBars));
      const prevVwap = calcVWAP(effectiveCandles.slice(1, vwapBars + 1));
      const price = effectiveCandles[0].close;
      const prevPrice = effectiveCandles[1].close;
      
      let pass = false;
      switch (position) {
        case "above": pass = price > vwap; break;
        case "below": pass = price < vwap; break;
        case "cross_above": pass = price > vwap && prevPrice <= prevVwap; break;
        case "cross_below": pass = price < vwap && prevPrice >= prevVwap; break;
        case "near": pass = Math.abs(price - vwap) / vwap <= tolerance; break;
      }
      
      const distPct = ((price - vwap) / vwap * 100).toFixed(2);
      return { pass, data: { evaluationStartBar: skip, evaluationEndBar: skip, patternEndBar: skip, _diagnostics: { value: `VWAP: $${vwap.toFixed(2)} (${distPct}%)`, threshold: position, detail: `price $${price.toFixed(2)}` } } };
    },
  },
  {
    id: "ITD-3",
    name: "Gap Detection",
    category: "Intraday",
    description: "Detects price gaps — when today's open is significantly different from the prior close. Gap ups often signal positive news or strong buying interest; gap downs signal selling pressure. Large gaps (>3%) can be playable setups. This can be used on daily timeframe to find overnight gaps or intraday for session gaps.",
    params: [
      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 0, min: 0, max: 200, step: 1, autoLink: { linkType: "sequenceOffset" } },
      { name: "gapDirection", label: "Gap Direction", type: "select", defaultValue: "up", options: ["up", "down", "any"] },
      { name: "minGapPct", label: "Min Gap %", type: "number", defaultValue: 1, min: 0.1, max: 20, step: 0.1 },
      { name: "maxGapPct", label: "Max Gap %", type: "number", defaultValue: 15, min: 1, max: 50, step: 1 },
      { name: "gapFilled", label: "Gap Status", type: "select", defaultValue: "any", options: ["unfilled", "partially_filled", "filled", "any"] },
    ],
    evaluate: (candles, params, _benchmarkCandles, upstreamData) => {
      const skip = upstreamData?.patternEndBar ?? params.skipBars ?? 0;
      const direction = params.gapDirection ?? "up";
      const minGap = params.minGapPct ?? 1;
      const maxGap = params.maxGapPct ?? 15;
      const gapStatus = params.gapFilled ?? "any";
      
      if (candles.length < skip + 2) {
        return { pass: false, data: { _diagnostics: { value: 'insufficient data', threshold: `${direction} gap ${minGap}%-${maxGap}%` } } };
      }
      
      const effectiveCandles = skip > 0 ? candles.slice(skip) : candles;
      const todayOpen = effectiveCandles[0].open;
      const yesterdayClose = effectiveCandles[1].close;
      const gapPct = ((todayOpen - yesterdayClose) / yesterdayClose) * 100;
      const absGap = Math.abs(gapPct);
      
      const isGapUp = gapPct > 0;
      const isGapDown = gapPct < 0;
      
      let dirPass = false;
      if (direction === "up") dirPass = isGapUp;
      else if (direction === "down") dirPass = isGapDown;
      else dirPass = true;
      
      const sizePass = absGap >= minGap && absGap <= maxGap;
      
      // Check gap fill status
      let statusPass = true;
      if (gapStatus !== "any") {
        const currentPrice = effectiveCandles[0].close;
        const gapTop = Math.max(todayOpen, yesterdayClose);
        const gapBottom = Math.min(todayOpen, yesterdayClose);
        const todayLow = effectiveCandles[0].low;
        const todayHigh = effectiveCandles[0].high;
        
        const gapFillPct = isGapUp 
          ? (todayOpen - todayLow) / (todayOpen - yesterdayClose)
          : (todayHigh - todayOpen) / (yesterdayClose - todayOpen);
        
        if (gapStatus === "unfilled") statusPass = gapFillPct < 0.25;
        else if (gapStatus === "partially_filled") statusPass = gapFillPct >= 0.25 && gapFillPct < 1;
        else if (gapStatus === "filled") statusPass = gapFillPct >= 1;
      }
      
      const pass = dirPass && sizePass && statusPass;
      
      return { 
        pass, 
        data: { 
          evaluationStartBar: skip,
          evaluationEndBar: skip,
          patternEndBar: skip,
          _diagnostics: { 
            value: `${gapPct.toFixed(2)}%`, 
            threshold: `${direction} ${minGap}%-${maxGap}%`,
            detail: `open $${todayOpen.toFixed(2)} vs prev close $${yesterdayClose.toFixed(2)}`
          },
          _cocHighlight: pass ? { type: "gapDiamond", barIndex: 0, gapPct: Math.abs(gapPct) } : undefined
        }
      };
    },
  },
];

export const INDICATOR_LIBRARY: IndicatorDefinition[] = [
  ...MOVING_AVERAGES,
  ...VOLUME,
  ...PRICE_ACTION,
  ...RELATIVE_STRENGTH,
  ...VOLATILITY,
  ...CONSOLIDATION,
  ...MOMENTUM,
  ...FUNDAMENTAL,
  ...INTRADAY,
];

/**
 * Get indicator library for a specific user, including their custom indicators
 */
export async function getIndicatorLibraryForUser(userId: number): Promise<IndicatorDefinition[]> {
  const { db, isDatabaseAvailable } = await import("../db");
  const { userIndicators } = await import("@shared/schema");
  const { eq } = await import("drizzle-orm");
  const { evaluateDslIndicator } = await import("./dsl-evaluator");

  if (!isDatabaseAvailable()) {
    return INDICATOR_LIBRARY;
  }

  try {
    const customIndicators = await db
      .select()
      .from(userIndicators)
      .where(eq(userIndicators.userId, userId));

    const customIndicatorDefs: IndicatorDefinition[] = customIndicators.map(ind => ({
      id: ind.customId,
      name: `${ind.name} (Custom)`,
      category: ind.category as any,
      description: ind.description,
      params: ind.params as any[] || [],
      evaluate: (candles: CandleData[], params: Record<string, any>) => {
        return evaluateDslIndicator(ind.logicDefinition as any, candles, params);
      },
    }));

    return [...INDICATOR_LIBRARY, ...customIndicatorDefs];
  } catch (error) {
    console.error('[getIndicatorLibraryForUser] Error loading custom indicators:', error);
    return INDICATOR_LIBRARY;
  }
}
