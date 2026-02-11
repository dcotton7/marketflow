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
  category: "Moving Averages" | "Volume" | "Price Action" | "Relative Strength" | "Volatility";
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
      { name: "period", label: "Period", type: "number", defaultValue: 50, min: 5, max: 500, step: 1 },
      { name: "direction", label: "Direction", type: "select", defaultValue: "above", options: ["above", "below"] },
    ],
    evaluate: (candles, params) => {
      const period = params.period ?? 50;
      const direction = params.direction ?? "above";
      if (candles.length < period) return false;
      const sma = calcSMA(candles, period);
      const price = candles[0].close;
      return direction === "above" ? price > sma : price < sma;
    },
  },
  {
    id: "MA-2",
    name: "EMA Value",
    category: "Moving Averages",
    description: "Finds stocks trading above or below their Exponential Moving Average. The EMA reacts faster than SMA by weighting recent bars more heavily. Use 'above 21 EMA' for short-term momentum stocks, or 'below 50 EMA' for stocks losing their trend.",
    params: [
      { name: "period", label: "Period", type: "number", defaultValue: 21, min: 5, max: 500, step: 1 },
      { name: "direction", label: "Direction", type: "select", defaultValue: "above", options: ["above", "below"] },
    ],
    evaluate: (candles, params) => {
      const period = params.period ?? 21;
      const direction = params.direction ?? "above";
      if (candles.length < period) return false;
      const ema = calcEMA(candles, period);
      const price = candles[0].close;
      return direction === "above" ? price > ema : price < ema;
    },
  },
  {
    id: "MA-3",
    name: "Price vs MA Distance",
    category: "Moving Averages",
    description: "Finds stocks within a specific percentage band around a moving average. Example: 0-5% above the 50 SMA catches stocks hugging the MA from above (a buy zone in an uptrend). Negative values find stocks below the MA. Great for pullback scans and 'near support' setups.",
    params: [
      { name: "period", label: "MA Period", type: "number", defaultValue: 50, min: 5, max: 500, step: 1 },
      { name: "maType", label: "MA Type", type: "select", defaultValue: "sma", options: ["sma", "ema"] },
      { name: "minPct", label: "Min % Distance", type: "number", defaultValue: 0, min: -100, max: 200, step: 0.5 },
      { name: "maxPct", label: "Max % Distance", type: "number", defaultValue: 10, min: -100, max: 200, step: 0.5 },
    ],
    evaluate: (candles, params) => {
      const period = params.period ?? 50;
      const maType = params.maType ?? "sma";
      const minPct = params.minPct ?? 0;
      const maxPct = params.maxPct ?? 10;
      if (candles.length < period) return false;
      const ma = getMA(candles, period, maType);
      if (ma === 0) return false;
      const pct = ((candles[0].close - ma) / ma) * 100;
      return pct >= minPct && pct <= maxPct;
    },
  },
  {
    id: "MA-4",
    name: "MA Slope",
    category: "Moving Averages",
    description: "Checks whether a moving average is trending up or down by measuring its slope over recent bars. A rising 50 SMA means the trend is healthy and price has been climbing. Use Min Slope > 0 to find uptrends only; use negative values to find declining MAs.",
    params: [
      { name: "period", label: "MA Period", type: "number", defaultValue: 50, min: 5, max: 500, step: 1 },
      { name: "maType", label: "MA Type", type: "select", defaultValue: "sma", options: ["sma", "ema"] },
      { name: "slopeDays", label: "Slope Lookback (bars)", type: "number", defaultValue: 10, min: 1, max: 60, step: 1 },
      { name: "minSlope", label: "Min Slope %", type: "number", defaultValue: 0, min: -50, max: 50, step: 0.1 },
    ],
    evaluate: (candles, params) => {
      const period = params.period ?? 50;
      const maType = params.maType ?? "sma";
      const slopeDays = params.slopeDays ?? 10;
      const minSlope = params.minSlope ?? 0;
      if (candles.length < period + slopeDays) return false;
      const maNow = getMA(candles, period, maType);
      const maThen = getMAAt(candles, period, maType, slopeDays);
      if (maThen === 0) return false;
      const slope = ((maNow - maThen) / maThen) * 100;
      return slope >= minSlope;
    },
  },
  {
    id: "MA-5",
    name: "MA Stacking Order",
    category: "Moving Averages",
    description: "Finds stocks where three moving averages are lined up in order. Bullish stacking (Price > Short MA > Medium MA > Long MA) confirms a strong, organized uptrend — the kind institutions like to buy. This is a Minervini trend template staple. Bearish stacking finds downtrends.",
    params: [
      { name: "order", label: "Stack Order", type: "select", defaultValue: "bullish", options: ["bullish", "bearish"] },
      { name: "ma1", label: "Short MA", type: "number", defaultValue: 50, min: 5, max: 500, step: 1 },
      { name: "ma2", label: "Medium MA", type: "number", defaultValue: 150, min: 5, max: 500, step: 1 },
      { name: "ma3", label: "Long MA", type: "number", defaultValue: 200, min: 5, max: 500, step: 1 },
    ],
    evaluate: (candles, params) => {
      const order = params.order ?? "bullish";
      const ma1p = params.ma1 ?? 50;
      const ma2p = params.ma2 ?? 150;
      const ma3p = params.ma3 ?? 200;
      const needed = Math.max(ma1p, ma2p, ma3p);
      if (candles.length < needed) return false;
      const price = candles[0].close;
      const v1 = calcSMA(candles, ma1p);
      const v2 = calcSMA(candles, ma2p);
      const v3 = calcSMA(candles, ma3p);
      if (order === "bullish") return price > v1 && v1 > v2 && v2 > v3;
      return price < v1 && v1 < v2 && v2 < v3;
    },
  },
  {
    id: "MA-6",
    name: "MA Distance / Convergence",
    category: "Moving Averages",
    description: "Finds stocks where two moving averages are close together. When the 50 and 200 SMA are within 5% of each other, the stock is at a decision point — a crossover may be near. Use this to catch stocks where moving averages are converging, which often precedes a trend change.",
    params: [
      { name: "fastPeriod", label: "Fast MA Period", type: "number", defaultValue: 50, min: 5, max: 500, step: 1 },
      { name: "slowPeriod", label: "Slow MA Period", type: "number", defaultValue: 200, min: 5, max: 500, step: 1 },
      { name: "maType", label: "MA Type", type: "select", defaultValue: "sma", options: ["sma", "ema"] },
      { name: "maxDistance", label: "Max Distance %", type: "number", defaultValue: 5, min: 0, max: 50, step: 0.5 },
    ],
    evaluate: (candles, params) => {
      const fastP = params.fastPeriod ?? 50;
      const slowP = params.slowPeriod ?? 200;
      const maType = params.maType ?? "sma";
      const maxDist = params.maxDistance ?? 5;
      if (candles.length < Math.max(fastP, slowP)) return false;
      const fastMA = getMA(candles, fastP, maType);
      const slowMA = getMA(candles, slowP, maType);
      if (slowMA === 0) return false;
      const dist = Math.abs((fastMA - slowMA) / slowMA) * 100;
      return dist <= maxDist;
    },
  },
  {
    id: "MA-7",
    name: "MA Crossover",
    category: "Moving Averages",
    description: "Finds stocks where a fast MA recently crossed above or below a slow MA. A bullish cross (50 above 200 = golden cross) signals a new uptrend starting. Set a short lookback (3-5 bars) to catch fresh crosses, or longer (10-20) to find crosses that happened recently.",
    params: [
      { name: "fastPeriod", label: "Fast MA Period", type: "number", defaultValue: 50, min: 5, max: 500, step: 1 },
      { name: "slowPeriod", label: "Slow MA Period", type: "number", defaultValue: 200, min: 5, max: 500, step: 1 },
      { name: "maType", label: "MA Type", type: "select", defaultValue: "sma", options: ["sma", "ema"] },
      { name: "lookback", label: "Lookback (bars)", type: "number", defaultValue: 5, min: 1, max: 30, step: 1 },
      { name: "crossType", label: "Cross Type", type: "select", defaultValue: "bullish", options: ["bullish", "bearish"] },
    ],
    evaluate: (candles, params) => {
      const fastP = params.fastPeriod ?? 50;
      const slowP = params.slowPeriod ?? 200;
      const maType = params.maType ?? "sma";
      const lookback = params.lookback ?? 5;
      const crossType = params.crossType ?? "bullish";
      const needed = Math.max(fastP, slowP) + lookback;
      if (candles.length < needed) return false;
      for (let i = 0; i < lookback; i++) {
        const fastNow = getMAAt(candles, fastP, maType, i);
        const slowNow = getMAAt(candles, slowP, maType, i);
        const fastPrev = getMAAt(candles, fastP, maType, i + 1);
        const slowPrev = getMAAt(candles, slowP, maType, i + 1);
        if (crossType === "bullish" && fastPrev <= slowPrev && fastNow > slowNow) return true;
        if (crossType === "bearish" && fastPrev >= slowPrev && fastNow < slowNow) return true;
      }
      return false;
    },
  },
  {
    id: "MA-8",
    name: "MA Comparison",
    category: "Moving Averages",
    description: "Checks if one MA is currently above or below another — without requiring a recent cross. Use '50 SMA above 200 SMA' to confirm a stock is in a confirmed uptrend. Unlike MA Crossover, this doesn't care when the cross happened — just the current relationship.",
    params: [
      { name: "fastPeriod", label: "Fast MA Period", type: "number", defaultValue: 50, min: 5, max: 500, step: 1 },
      { name: "slowPeriod", label: "Slow MA Period", type: "number", defaultValue: 200, min: 5, max: 500, step: 1 },
      { name: "maType", label: "MA Type", type: "select", defaultValue: "sma", options: ["sma", "ema"] },
      { name: "direction", label: "Direction", type: "select", defaultValue: "fast_above_slow", options: ["fast_above_slow", "fast_below_slow"] },
    ],
    evaluate: (candles, params) => {
      const fastP = params.fastPeriod ?? 50;
      const slowP = params.slowPeriod ?? 200;
      const maType = params.maType ?? "sma";
      const direction = params.direction ?? "fast_above_slow";
      if (candles.length < Math.max(fastP, slowP)) return false;
      const fastMA = getMA(candles, fastP, maType);
      const slowMA = getMA(candles, slowP, maType);
      if (direction === "fast_above_slow") return fastMA > slowMA;
      return fastMA < slowMA;
    },
  },
  {
    id: "MA-9",
    name: "Price Crosses MA",
    category: "Moving Averages",
    description: "Finds stocks where the price itself recently crossed above or below a single MA. Unlike MA Crossover (which compares two MAs), this checks price vs one MA. Use 'price crossed above 50 SMA' to find stocks reclaiming a key trend line, or 'crossed below 21 EMA' for breakdowns.",
    params: [
      { name: "maPeriod", label: "MA Period", type: "number", defaultValue: 50, min: 5, max: 500, step: 1 },
      { name: "maType", label: "MA Type", type: "select", defaultValue: "sma", options: ["sma", "ema"] },
      { name: "lookback", label: "Lookback (bars)", type: "number", defaultValue: 5, min: 1, max: 30, step: 1 },
      { name: "crossType", label: "Cross Direction", type: "select", defaultValue: "above", options: ["above", "below"] },
    ],
    evaluate: (candles, params) => {
      const maPeriod = params.maPeriod ?? 50;
      const maType = params.maType ?? "sma";
      const lookback = params.lookback ?? 5;
      const crossType = params.crossType ?? "above";
      if (candles.length < maPeriod + lookback + 1) return false;
      for (let i = 0; i < lookback; i++) {
        const maNow = getMAAt(candles, maPeriod, maType, i);
        const maPrev = getMAAt(candles, maPeriod, maType, i + 1);
        if (maNow === 0 || maPrev === 0) continue;
        const priceNow = candles[i].close;
        const pricePrev = candles[i + 1].close;
        if (crossType === "above" && pricePrev <= maPrev && priceNow > maNow) return true;
        if (crossType === "below" && pricePrev >= maPrev && priceNow < maNow) return true;
      }
      return false;
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
      { name: "period", label: "Avg Volume Period", type: "number", defaultValue: 50, min: 5, max: 200, step: 1 },
      { name: "minMultiple", label: "Min Multiple", type: "number", defaultValue: 1.5, min: 0.1, max: 20, step: 0.1 },
    ],
    evaluate: (candles, params) => {
      const period = params.period ?? 50;
      const minMult = params.minMultiple ?? 1.5;
      if (candles.length < period + 1) return false;
      const avgVol = candles.slice(1, period + 1).reduce((s, c) => s + c.volume, 0) / period;
      if (avgVol === 0) return false;
      return candles[0].volume / avgVol >= minMult;
    },
  },
  {
    id: "VOL-2",
    name: "Volume Trend",
    category: "Volume",
    description: "Detects whether volume is ramping up or fading over time. Compares the average volume over recent bars to a longer baseline. 'Increasing' finds stocks gaining trading interest (accumulation); 'Decreasing' finds stocks where volume is drying up (potential base forming).",
    params: [
      { name: "recentPeriod", label: "Recent Period", type: "number", defaultValue: 10, min: 3, max: 50, step: 1 },
      { name: "baselinePeriod", label: "Baseline Period", type: "number", defaultValue: 50, min: 10, max: 200, step: 1 },
      { name: "direction", label: "Trend Direction", type: "select", defaultValue: "increasing", options: ["increasing", "decreasing"] },
      { name: "threshold", label: "Min Change %", type: "number", defaultValue: 20, min: 0, max: 200, step: 5 },
    ],
    evaluate: (candles, params) => {
      const recentP = params.recentPeriod ?? 10;
      const baseP = params.baselinePeriod ?? 50;
      const direction = params.direction ?? "increasing";
      const threshold = params.threshold ?? 20;
      if (candles.length < baseP) return false;
      const recentAvg = candles.slice(0, recentP).reduce((s, c) => s + c.volume, 0) / recentP;
      const baseAvg = candles.slice(0, baseP).reduce((s, c) => s + c.volume, 0) / baseP;
      if (baseAvg === 0) return false;
      const changePct = ((recentAvg - baseAvg) / baseAvg) * 100;
      return direction === "increasing" ? changePct >= threshold : changePct <= -threshold;
    },
  },
  {
    id: "VOL-3",
    name: "Up/Down Volume Ratio",
    category: "Volume",
    description: "Measures buying pressure vs selling pressure by comparing volume on up-days to volume on down-days. A ratio above 1.0 means more volume flows in on green bars — a sign of accumulation. Ratios of 1.5+ suggest strong institutional buying interest. Below 1.0 means distribution.",
    params: [
      { name: "period", label: "Period", type: "number", defaultValue: 20, min: 5, max: 100, step: 1 },
      { name: "minRatio", label: "Min Ratio", type: "number", defaultValue: 1.2, min: 0.1, max: 10, step: 0.1 },
    ],
    evaluate: (candles, params) => {
      const period = params.period ?? 20;
      const minRatio = params.minRatio ?? 1.2;
      if (candles.length < period + 1) return false;
      let upVol = 0;
      let downVol = 0;
      for (let i = 0; i < period; i++) {
        if (candles[i].close >= candles[i + 1].close) upVol += candles[i].volume;
        else downVol += candles[i].volume;
      }
      if (downVol === 0) return upVol > 0;
      return upVol / downVol >= minRatio;
    },
  },
  {
    id: "VOL-4",
    name: "Volume Dry-Up",
    category: "Volume",
    description: "Finds stocks where volume has been consistently quiet for several bars in a row — all recent bars below a fraction of the average. This 'dry-up' pattern often appears right before breakouts as sellers dry up and supply evaporates. Combine with tightness indicators for coiling setups.",
    params: [
      { name: "period", label: "Avg Volume Period", type: "number", defaultValue: 50, min: 10, max: 200, step: 1 },
      { name: "dryUpDays", label: "Dry-Up Window (bars)", type: "number", defaultValue: 5, min: 1, max: 20, step: 1 },
      { name: "maxMultiple", label: "Max Volume Multiple", type: "number", defaultValue: 0.5, min: 0.1, max: 1, step: 0.05 },
    ],
    evaluate: (candles, params) => {
      const period = params.period ?? 50;
      const dryUpDays = params.dryUpDays ?? 5;
      const maxMult = params.maxMultiple ?? 0.5;
      if (candles.length < period) return false;
      const avgVol = candles.slice(dryUpDays, dryUpDays + period).reduce((s, c) => s + c.volume, 0) / period;
      if (avgVol === 0) return false;
      for (let i = 0; i < dryUpDays; i++) {
        if (candles[i].volume / avgVol > maxMult) return false;
      }
      return true;
    },
  },
  {
    id: "VOL-5",
    name: "Volume Surge",
    category: "Volume",
    description: "Finds stocks that had a sudden massive spike in volume on a single bar. A 2x surge means double the normal volume — often a breakout day or big institutional entry. 'Require Price Up' filters out panic selling spikes, keeping only bullish volume surges.",
    params: [
      { name: "period", label: "Avg Volume Period", type: "number", defaultValue: 50, min: 5, max: 200, step: 1 },
      { name: "surgeMultiple", label: "Surge Multiple", type: "number", defaultValue: 2.0, min: 1.5, max: 20, step: 0.5 },
      { name: "priceUp", label: "Require Price Up", type: "boolean", defaultValue: true },
    ],
    evaluate: (candles, params) => {
      const period = params.period ?? 50;
      const surgeMult = params.surgeMultiple ?? 2.0;
      const priceUp = params.priceUp ?? true;
      if (candles.length < period + 1) return false;
      const avgVol = candles.slice(1, period + 1).reduce((s, c) => s + c.volume, 0) / period;
      if (avgVol === 0) return false;
      const volRatio = candles[0].volume / avgVol;
      if (volRatio < surgeMult) return false;
      if (priceUp && candles[0].close <= candles[1].close) return false;
      return true;
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
      { name: "period", label: "ATR Period", type: "number", defaultValue: 14, min: 5, max: 50, step: 1 },
      { name: "minATR", label: "Min ATR", type: "number", defaultValue: 0, min: 0, max: 100, step: 0.1 },
      { name: "maxATR", label: "Max ATR", type: "number", defaultValue: 999, min: 0, max: 1000, step: 0.1 },
    ],
    evaluate: (candles, params) => {
      const period = params.period ?? 14;
      const minATR = params.minATR ?? 0;
      const maxATR = params.maxATR ?? 999;
      const atr = calcATR(candles, period);
      return atr >= minATR && atr <= maxATR;
    },
  },
  {
    id: "PA-2",
    name: "ATR Percent",
    category: "Price Action",
    description: "Filters stocks by ATR as a percentage of the stock price — normalizing volatility across all price levels. A $200 stock with $4 ATR = 2% (calm); a $20 stock with $3 ATR = 15% (wild). Use this instead of raw ATR when scanning across different-priced stocks.",
    params: [
      { name: "period", label: "ATR Period", type: "number", defaultValue: 14, min: 5, max: 50, step: 1 },
      { name: "minPct", label: "Min ATR %", type: "number", defaultValue: 2, min: 0, max: 50, step: 0.1 },
      { name: "maxPct", label: "Max ATR %", type: "number", defaultValue: 8, min: 0, max: 50, step: 0.1 },
    ],
    evaluate: (candles, params) => {
      const period = params.period ?? 14;
      const minPct = params.minPct ?? 2;
      const maxPct = params.maxPct ?? 8;
      if (candles.length < period + 1 || candles[0].close === 0) return false;
      const atr = calcATR(candles, period);
      const pct = (atr / candles[0].close) * 100;
      return pct >= minPct && pct <= maxPct;
    },
  },
  {
    id: "PA-3",
    name: "Consolidation / Base Detection",
    category: "Price Action",
    description: "The core base-building indicator. Scans recent bars to find a flat sideways zone where price traded within a tight range. The allowed range tightens as the base gets longer, so short bases can be wider and long bases must be tighter — producing natural variation in detected lengths. Rejects bases where price is sitting in the lower half (weak), where the base drifts/slopes too much, or where most closes aren't in the upper portion. Passes the detected base length downstream to Prior Advance and Smooth Advance.",
    provides: [{ linkType: "basePeriod", paramName: "period" }],
    params: [
      { name: "period", label: "Max Base Length", type: "number", defaultValue: 20, min: 5, max: 100, step: 1 },
      { name: "minPeriod", label: "Min Base Length", type: "number", defaultValue: 5, min: 5, max: 50, step: 1 },
      { name: "maxRange", label: "Max Range %", type: "number", defaultValue: 15, min: 1, max: 50, step: 0.5 },
      { name: "maxSlope", label: "Max Slope %", type: "number", defaultValue: 5, min: 0.5, max: 15, step: 0.5 },
      { name: "drifterPct", label: "Drifter Tolerance %", type: "number", defaultValue: 10, min: 0, max: 25, step: 1 },
      { name: "minBasePct", label: "Min Base % of Lookback", type: "number", defaultValue: 0, min: 0, max: 100, step: 5 },
    ],
    evaluate: (candles, params) => {
      const maxPeriod = params.period ?? 20;
      const minPeriod = Math.max(5, params.minPeriod ?? 5);
      const maxRange = params.maxRange ?? 15;
      const maxSlope = params.maxSlope ?? 5;
      const drifterPct = params.drifterPct ?? 10;
      const minBasePct = params.minBasePct ?? 0;
      if (candles.length < minPeriod) return false;

      const maxLen = Math.min(maxPeriod, candles.length);

      const recentSlice = candles.slice(0, minPeriod);
      const refHigh = Math.max(...recentSlice.map(c => c.high));
      const refLow = Math.min(...recentSlice.map(c => c.low));

      let detectedLen = minPeriod;
      let drifterCount = 0;

      if (refHigh === 0) return false;
      const initRangePct = ((refHigh - refLow) / refHigh) * 100;
      if (initRangePct > maxRange) return false;

      let runHigh = refHigh;
      let runLow = refLow;

      for (let i = minPeriod; i < maxLen; i++) {
        const bar = candles[i];
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
      }

      if (detectedLen < minPeriod) return false;

      const minRequired = Math.ceil(maxPeriod * minBasePct / 100);
      if (detectedLen < minRequired) return false;

      const baseSlice = candles.slice(0, detectedLen);
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

      return { pass: true, data: { detectedPeriod: detectedLen } };
    },
  },
  {
    id: "PA-4",
    name: "Base Depth",
    category: "Price Action",
    description: "Measures how deep the current pullback is from the highest price over a lookback window. Shallow bases (10-20% correction) suggest institutions are holding — strong demand. Deep corrections (30%+) may signal damaged charts. Use Min Depth to exclude stocks that haven't pulled back at all.",
    params: [
      { name: "lookback", label: "Lookback Period", type: "number", defaultValue: 60, min: 10, max: 260, step: 5 },
      { name: "maxDepth", label: "Max Depth %", type: "number", defaultValue: 25, min: 1, max: 60, step: 1 },
      { name: "minDepth", label: "Min Depth %", type: "number", defaultValue: 5, min: 0, max: 50, step: 1 },
    ],
    evaluate: (candles, params) => {
      const lookback = params.lookback ?? 60;
      const maxDepth = params.maxDepth ?? 25;
      const minDepth = params.minDepth ?? 5;
      if (candles.length < lookback) return false;
      const slice = candles.slice(0, lookback);
      const highVal = Math.max(...slice.map(c => c.high));
      if (highVal === 0) return false;
      const currentLow = Math.min(...slice.map(c => c.low));
      const depth = ((highVal - currentLow) / highVal) * 100;
      return depth >= minDepth && depth <= maxDepth;
    },
  },
  {
    id: "PA-5",
    name: "Base Count",
    category: "Price Action",
    description: "Counts how many separate consolidation pauses a stock has made during its advance. 1st and 2nd bases are highest probability for breakouts — later bases (3rd, 4th+) increasingly fail as the move gets extended. Set Max Bases to 2-3 to focus on early-stage leaders.",
    params: [
      { name: "lookback", label: "Lookback Period", type: "number", defaultValue: 120, min: 30, max: 500, step: 10 },
      { name: "consolidationRange", label: "Base Range %", type: "number", defaultValue: 15, min: 5, max: 30, step: 1 },
      { name: "minBaseDays", label: "Min Base Width (bars)", type: "number", defaultValue: 10, min: 3, max: 30, step: 1 },
      { name: "maxBases", label: "Max Bases", type: "number", defaultValue: 3, min: 1, max: 10, step: 1 },
    ],
    evaluate: (candles, params) => {
      const lookback = params.lookback ?? 120;
      const consolRange = params.consolidationRange ?? 15;
      const minBaseDays = params.minBaseDays ?? 10;
      const maxBases = params.maxBases ?? 3;
      if (candles.length < lookback) return false;
      const slice = candles.slice(0, lookback).reverse();
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
      return baseCount >= 1 && baseCount <= maxBases;
    },
  },
  {
    id: "PA-6",
    name: "Distance from 52-Week High",
    category: "Price Action",
    description: "Finds stocks near or far from their 52-week high. Stocks within 5-15% of highs are in 'buy zone' territory — strong enough to be near the top but pulled back enough to offer entry. Stocks 50%+ away may be damaged or in downtrends. Adjust Min/Max Distance to target your range.",
    params: [
      { name: "maxDistance", label: "Max Distance %", type: "number", defaultValue: 25, min: 0, max: 100, step: 1 },
      { name: "minDistance", label: "Min Distance %", type: "number", defaultValue: 0, min: 0, max: 100, step: 1 },
    ],
    evaluate: (candles, params) => {
      const maxDist = params.maxDistance ?? 25;
      const minDist = params.minDistance ?? 0;
      const period = Math.min(260, candles.length);
      if (period < 20) return false;
      const high52 = Math.max(...candles.slice(0, period).map(c => c.high));
      if (high52 === 0) return false;
      const dist = ((high52 - candles[0].close) / high52) * 100;
      return dist >= minDist && dist <= maxDist;
    },
  },
  {
    id: "PA-7",
    name: "Breakout Detection",
    category: "Price Action",
    description: "Finds stocks that recently broke out above the highest price of a prior base/consolidation zone. The breakout window controls how recently it must have happened (1-3 bars = just broke out; 10 = within last 2 weeks). Enable Volume Confirm to filter out weak, low-conviction breakouts.",
    provides: [{ linkType: "basePeriod", paramName: "basePeriod" }],
    params: [
      { name: "basePeriod", label: "Base Period", type: "number", defaultValue: 20, min: 5, max: 100, step: 1 },
      { name: "lookback", label: "Breakout Window (bars)", type: "number", defaultValue: 3, min: 1, max: 10, step: 1 },
      { name: "volumeConfirm", label: "Require Volume Surge", type: "boolean", defaultValue: true },
      { name: "volumeMultiple", label: "Volume Multiple", type: "number", defaultValue: 1.5, min: 1, max: 10, step: 0.1 },
    ],
    evaluate: (candles, params) => {
      const basePeriod = params.basePeriod ?? 20;
      const lookback = params.lookback ?? 3;
      const volumeConfirm = params.volumeConfirm ?? true;
      const volumeMult = params.volumeMultiple ?? 1.5;
      if (candles.length < basePeriod + lookback) return false;
      const baseHigh = Math.max(...candles.slice(lookback, lookback + basePeriod).map(c => c.high));
      for (let i = 0; i < lookback; i++) {
        if (candles[i].close > baseHigh) {
          if (!volumeConfirm) return true;
          const avgVol = candles.slice(lookback, lookback + 50).reduce((s, c) => s + c.volume, 0) / Math.min(50, candles.length - lookback);
          if (avgVol > 0 && candles[i].volume / avgVol >= volumeMult) return true;
        }
      }
      return false;
    },
  },
  {
    id: "PA-8",
    name: "Pullback to Level",
    category: "Price Action",
    description: "Finds stocks that have pulled back to test a moving average as support. The low of the current bar must be within a tolerance band of the MA. A stock touching its rising 21 EMA after an advance is a classic buy-the-dip entry point in strong uptrends.",
    params: [
      { name: "maPeriod", label: "MA Period", type: "number", defaultValue: 21, min: 5, max: 200, step: 1 },
      { name: "maType", label: "MA Type", type: "select", defaultValue: "ema", options: ["sma", "ema"] },
      { name: "tolerance", label: "Tolerance %", type: "number", defaultValue: 2, min: 0.5, max: 10, step: 0.5 },
    ],
    evaluate: (candles, params) => {
      const maPeriod = params.maPeriod ?? 21;
      const maType = params.maType ?? "ema";
      const tolerance = params.tolerance ?? 2;
      if (candles.length < maPeriod) return false;
      const ma = getMA(candles, maPeriod, maType);
      if (ma === 0) return false;
      const dist = Math.abs((candles[0].low - ma) / ma) * 100;
      return dist <= tolerance;
    },
  },
  {
    id: "PA-9",
    name: "VCP Tightness",
    category: "Price Action",
    description: "Detects the Volatility Contraction Pattern (VCP) — a series of price swings where each one is smaller than the last, forming a staircase of tightening contractions. This pattern shows sellers are drying up and supply is shrinking. More segments = more defined pattern but fewer matches.",
    params: [
      { name: "lookback", label: "Lookback Period", type: "number", defaultValue: 40, min: 15, max: 120, step: 5 },
      { name: "segments", label: "Number of Segments", type: "number", defaultValue: 3, min: 2, max: 5, step: 1 },
    ],
    evaluate: (candles, params) => {
      const lookback = params.lookback ?? 40;
      const segments = params.segments ?? 3;
      if (candles.length < lookback) return false;
      const slice = candles.slice(0, lookback).reverse();
      const segLen = Math.floor(slice.length / segments);
      if (segLen < 3) return false;
      const ranges: number[] = [];
      for (let s = 0; s < segments; s++) {
        const seg = slice.slice(s * segLen, (s + 1) * segLen);
        const high = Math.max(...seg.map(c => c.high));
        const low = Math.min(...seg.map(c => c.low));
        ranges.push(high > 0 ? ((high - low) / high) * 100 : 0);
      }
      for (let i = 1; i < ranges.length; i++) {
        if (ranges[i] >= ranges[i - 1]) return false;
      }
      return true;
    },
  },
  {
    id: "PA-10",
    name: "Price Gap Detection",
    category: "Price Action",
    description: "Finds stocks that gapped up or down recently — meaning the open was significantly above/below the prior close, leaving a visible gap on the chart. Gaps often signal news, earnings surprises, or institutional moves. Set min gap to 2%+ for meaningful gaps only.",
    params: [
      { name: "lookback", label: "Lookback (bars)", type: "number", defaultValue: 3, min: 1, max: 20, step: 1 },
      { name: "minGapPct", label: "Min Gap %", type: "number", defaultValue: 2, min: 0.5, max: 20, step: 0.5 },
      { name: "gapDirection", label: "Gap Direction", type: "select", defaultValue: "up", options: ["up", "down", "either"] },
    ],
    evaluate: (candles, params) => {
      const lookback = params.lookback ?? 3;
      const minGap = params.minGapPct ?? 2;
      const dir = params.gapDirection ?? "up";
      if (candles.length < lookback + 1) return false;
      for (let i = 0; i < lookback; i++) {
        const prev = candles[i + 1];
        const curr = candles[i];
        const gapUp = ((curr.low - prev.high) / prev.high) * 100;
        const gapDown = ((prev.low - curr.high) / prev.low) * 100;
        if (dir === "up" && gapUp >= minGap) return true;
        if (dir === "down" && gapDown >= minGap) return true;
        if (dir === "either" && (gapUp >= minGap || gapDown >= minGap)) return true;
      }
      return false;
    },
  },
  {
    id: "PA-11",
    name: "Distance from Key Level",
    category: "Price Action",
    description: "Finds stocks trading near a key price level — either VWAP (volume-weighted average price) or a pivot point. Stocks hugging VWAP are at their 'fair value' — a tight distance means the price is respecting this institutional reference. Good for finding stocks at decision points.",
    params: [
      { name: "level", label: "Level Type", type: "select", defaultValue: "vwap", options: ["vwap", "pivot"] },
      { name: "lookback", label: "Lookback Period", type: "number", defaultValue: 20, min: 5, max: 100, step: 1 },
      { name: "maxDistance", label: "Max Distance %", type: "number", defaultValue: 3, min: 0, max: 20, step: 0.5 },
    ],
    evaluate: (candles, params) => {
      const level = params.level ?? "vwap";
      const lookback = params.lookback ?? 20;
      const maxDist = params.maxDistance ?? 3;
      if (candles.length < lookback) return false;
      let keyLevel: number;
      if (level === "vwap") {
        const slice = candles.slice(0, lookback);
        let tpv = 0;
        let vol = 0;
        for (const c of slice) {
          const tp = (c.high + c.low + c.close) / 3;
          tpv += tp * c.volume;
          vol += c.volume;
        }
        keyLevel = vol > 0 ? tpv / vol : 0;
      } else {
        const prev = candles[1] || candles[0];
        keyLevel = (prev.high + prev.low + prev.close) / 3;
      }
      if (keyLevel === 0) return false;
      const dist = Math.abs((candles[0].close - keyLevel) / keyLevel) * 100;
      return dist <= maxDist;
    },
  },
  {
    id: "PA-12",
    name: "Prior Price Advance",
    category: "Price Action",
    description: "Verifies that the stock had a meaningful price advance BEFORE it built the current base. Skips over the base, then checks how much the stock gained in the window before that. Stocks that consolidate after a strong run-up (30%+) are building a classic base-on-advance pattern. When connected to Base Detection, automatically uses each stock's actual base length.",
    consumes: [{ paramName: "skipBars", dataKey: "detectedPeriod" }],
    params: [
      { name: "skipBars", label: "Skip Recent Bars", type: "number", defaultValue: 20, min: 5, max: 60, step: 1, autoLink: { linkType: "basePeriod" } },
      { name: "lookbackBars", label: "Advance Window (bars)", type: "number", defaultValue: 120, min: 20, max: 300, step: 5 },
      { name: "minGain", label: "Min Gain %", type: "number", defaultValue: 30, min: 5, max: 500, step: 5 },
    ],
    evaluate: (candles, params, _benchmarkCandles, upstreamData) => {
      const dynamicSkip = upstreamData?.detectedPeriod;
      const skip = dynamicSkip ?? params.skipBars ?? 20;
      const lookback = params.lookbackBars ?? 120;
      const minGain = params.minGain ?? 30;
      const totalNeeded = skip + lookback;
      if (candles.length < totalNeeded) return false;
      const priceAtBaseStart = candles[skip]?.close;
      const priceAtAdvanceStart = candles[skip + lookback - 1]?.close;
      if (!priceAtBaseStart || !priceAtAdvanceStart || priceAtAdvanceStart === 0) return false;
      const gain = ((priceAtBaseStart - priceAtAdvanceStart) / priceAtAdvanceStart) * 100;
      return gain >= minGain;
    },
  },
  {
    id: "PA-13",
    name: "Smooth Trending Advance",
    category: "Price Action",
    description: "Checks the QUALITY of the advance before the base — not just that it gained, but that it did so cleanly. Requires: (1) minimum net gain, (2) no single pullback deeper than Max Drawdown (rolling high to low), and (3) price stayed above a key SMA for most of the advance. This separates clean institutional staircase advances from volatile, choppy run-ups. Uses per-stock base length when connected to Base Detection.",
    consumes: [{ paramName: "skipBars", dataKey: "detectedPeriod" }],
    params: [
      { name: "skipBars", label: "Skip Recent Bars (base)", type: "number", defaultValue: 20, min: 5, max: 60, step: 1, autoLink: { linkType: "basePeriod" } },
      { name: "lookbackBars", label: "Advance Window (bars)", type: "number", defaultValue: 120, min: 20, max: 300, step: 5 },
      { name: "minGain", label: "Min Net Gain %", type: "number", defaultValue: 30, min: 5, max: 500, step: 5 },
      { name: "maxDrawdown", label: "Max Drawdown %", type: "number", defaultValue: 25, min: 5, max: 50, step: 1 },
      { name: "smaPeriod", label: "SMA Period", type: "number", defaultValue: 50, min: 10, max: 200, step: 5 },
      { name: "minBarsAboveSMA", label: "Min % Bars Above SMA", type: "number", defaultValue: 70, min: 30, max: 100, step: 5 },
    ],
    evaluate: (candles, params, _benchmarkCandles, upstreamData) => {
      const dynamicSkip = upstreamData?.detectedPeriod;
      const skip = dynamicSkip ?? params.skipBars ?? 20;
      const lookback = params.lookbackBars ?? 120;
      const minGain = params.minGain ?? 30;
      const maxDD = params.maxDrawdown ?? 25;
      const smaPeriod = params.smaPeriod ?? 50;
      const minAbovePct = params.minBarsAboveSMA ?? 70;

      const totalNeeded = skip + lookback + smaPeriod;
      if (candles.length < totalNeeded) return false;

      const advanceSlice = candles.slice(skip, skip + lookback);
      const priceEnd = advanceSlice[0]?.close;
      const priceStart = advanceSlice[advanceSlice.length - 1]?.close;
      if (!priceEnd || !priceStart || priceStart === 0) return false;
      const netGain = ((priceEnd - priceStart) / priceStart) * 100;
      if (netGain < minGain) return false;

      let rollingHigh = 0;
      let maxDrawdown = 0;
      for (let i = advanceSlice.length - 1; i >= 0; i--) {
        if (advanceSlice[i].high > rollingHigh) rollingHigh = advanceSlice[i].high;
        if (rollingHigh > 0) {
          const dd = ((rollingHigh - advanceSlice[i].low) / rollingHigh) * 100;
          if (dd > maxDrawdown) maxDrawdown = dd;
        }
      }
      if (maxDrawdown > maxDD) return false;

      let barsAbove = 0;
      for (let i = 0; i < lookback; i++) {
        const offset = skip + i;
        const smaSlice = candles.slice(offset, offset + smaPeriod);
        if (smaSlice.length < smaPeriod) continue;
        const sma = smaSlice.reduce((s, c) => s + c.close, 0) / smaPeriod;
        if (candles[offset].close > sma) barsAbove++;
      }
      const abovePct = (barsAbove / lookback) * 100;
      if (abovePct < minAbovePct) return false;

      return true;
    },
  },
  {
    id: "PA-14",
    name: "Tightness Ratio",
    category: "Price Action",
    description: "Compares the size of recent daily candles to the historical average. A ratio of 0.5 means candles are half their normal size — the stock is coiling with shrinking daily ranges. This tightness often precedes explosive moves. Works best combined with Volume Fade and Close Clustering to confirm a full 'quiet before the storm' setup.",
    params: [
      { name: "recentBars", label: "Recent Bars", type: "number", defaultValue: 5, min: 3, max: 20, step: 1 },
      { name: "baselineBars", label: "Baseline Bars", type: "number", defaultValue: 50, min: 20, max: 200, step: 5 },
      { name: "maxRatio", label: "Max Tightness Ratio", type: "number", defaultValue: 0.8, min: 0.1, max: 1.5, step: 0.05 },
    ],
    evaluate: (candles, params) => {
      const recentN = params.recentBars ?? 5;
      const baselineN = params.baselineBars ?? 50;
      const maxRatio = params.maxRatio ?? 0.8;
      if (candles.length < baselineN) return false;

      const dailyRangePct = (c: { high: number; low: number; close: number }) =>
        c.close === 0 ? 0 : ((c.high - c.low) / c.close) * 100;

      let recentSum = 0;
      for (let i = 0; i < recentN; i++) recentSum += dailyRangePct(candles[i]);
      const recentAvg = recentSum / recentN;

      let baselineSum = 0;
      for (let i = 0; i < baselineN; i++) baselineSum += dailyRangePct(candles[i]);
      const baselineAvg = baselineSum / baselineN;

      if (baselineAvg === 0) return false;
      const ratio = recentAvg / baselineAvg;
      return ratio <= maxRatio;
    },
  },
  {
    id: "PA-15",
    name: "Close Clustering",
    category: "Price Action",
    description: "Measures how tightly closing prices bunch together over recent bars. A 1% cluster means closes barely move day-to-day — the stock has settled into a narrow equilibrium. Think of it as a 'coil' indicator: the tighter the clustering, the more energy is stored for the next directional move. Use with Tightness Ratio for stronger confirmation.",
    params: [
      { name: "period", label: "Period", type: "number", defaultValue: 10, min: 5, max: 50, step: 1 },
      { name: "maxClusterPct", label: "Max Cluster %", type: "number", defaultValue: 3.0, min: 0.1, max: 5, step: 0.1 },
    ],
    evaluate: (candles, params) => {
      const period = params.period ?? 10;
      const maxPct = params.maxClusterPct ?? 3.0;
      if (candles.length < period) return false;

      const closes = candles.slice(0, period).map(c => c.close);
      const avg = closes.reduce((s, v) => s + v, 0) / period;
      if (avg === 0) return false;

      const variance = closes.reduce((s, v) => s + (v - avg) * (v - avg), 0) / period;
      const stdDev = Math.sqrt(variance);
      const clusterPct = (stdDev / avg) * 100;

      return clusterPct <= maxPct;
    },
  },
  {
    id: "PA-16",
    name: "Volume Fade",
    category: "Price Action",
    description: "Checks if recent volume has dried up compared to the historical average. A ratio of 0.5 means volume is half of normal — weak hands have been shaken out and the remaining holders aren't selling. Volume fade during a tight base is a classic sign that supply has been absorbed. Combine with Tightness Ratio and Close Clustering for the strongest coiling signals.",
    params: [
      { name: "recentBars", label: "Recent Bars", type: "number", defaultValue: 10, min: 3, max: 30, step: 1 },
      { name: "baselineBars", label: "Baseline Bars", type: "number", defaultValue: 50, min: 20, max: 200, step: 5 },
      { name: "maxRatio", label: "Max Volume Ratio", type: "number", defaultValue: 0.9, min: 0.1, max: 1.5, step: 0.05 },
    ],
    evaluate: (candles, params) => {
      const recentN = params.recentBars ?? 10;
      const baselineN = params.baselineBars ?? 50;
      const maxRatio = params.maxRatio ?? 0.9;
      if (candles.length < baselineN) return false;

      let recentVol = 0;
      for (let i = 0; i < recentN; i++) recentVol += candles[i].volume;
      const recentAvg = recentVol / recentN;

      let baselineVol = 0;
      for (let i = 0; i < baselineN; i++) baselineVol += candles[i].volume;
      const baselineAvg = baselineVol / baselineN;

      if (baselineAvg === 0) return false;
      const ratio = recentAvg / baselineAvg;
      return ratio <= maxRatio;
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
      { name: "period", label: "Period", type: "number", defaultValue: 60, min: 10, max: 260, step: 5 },
      { name: "minOutperformance", label: "Min Outperformance %", type: "number", defaultValue: 5, min: -50, max: 100, step: 1 },
    ],
    evaluate: (candles, params, benchmarkCandles) => {
      const period = params.period ?? 60;
      const minOut = params.minOutperformance ?? 5;
      if (candles.length < period || !benchmarkCandles || benchmarkCandles.length < period) return false;
      const stockReturn = ((candles[0].close - candles[period - 1].close) / candles[period - 1].close) * 100;
      const benchReturn = ((benchmarkCandles[0].close - benchmarkCandles[period - 1].close) / benchmarkCandles[period - 1].close) * 100;
      return (stockReturn - benchReturn) >= minOut;
    },
  },
  {
    id: "RS-2",
    name: "RS Score",
    category: "Relative Strength",
    description: "Calculates a raw strength ratio: stock return divided by benchmark return. A score of 1.5 means the stock gained 50% more than the index. Scores above 1.0 = outperforming; below 1.0 = underperforming. Use Min RS Score of 1.2+ to find meaningful leaders, not just marginal outperformers.",
    params: [
      { name: "period", label: "Period", type: "number", defaultValue: 60, min: 10, max: 260, step: 5 },
      { name: "minScore", label: "Min RS Score", type: "number", defaultValue: 1.2, min: 0, max: 5, step: 0.1 },
    ],
    evaluate: (candles, params, benchmarkCandles) => {
      const period = params.period ?? 60;
      const minScore = params.minScore ?? 1.2;
      if (candles.length < period || !benchmarkCandles || benchmarkCandles.length < period) return false;
      const stockReturn = candles[0].close / candles[period - 1].close;
      const benchReturn = benchmarkCandles[0].close / benchmarkCandles[period - 1].close;
      if (benchReturn === 0) return false;
      return stockReturn / benchReturn >= minScore;
    },
  },
  {
    id: "RS-3",
    name: "RS Line New High",
    category: "Relative Strength",
    description: "Checks if the stock's relative strength line vs the benchmark is making or near a new high. When the RS line hits new highs, the stock is outperforming the market more than it has in months — a hallmark of true market leaders. Tolerance allows stocks within a few percent of the high to pass.",
    params: [
      { name: "lookback", label: "Lookback Period", type: "number", defaultValue: 60, min: 10, max: 260, step: 5 },
      { name: "tolerance", label: "Tolerance %", type: "number", defaultValue: 2, min: 0, max: 10, step: 0.5 },
    ],
    evaluate: (candles, params, benchmarkCandles) => {
      const lookback = params.lookback ?? 60;
      const tolerance = params.tolerance ?? 2;
      if (candles.length < lookback || !benchmarkCandles || benchmarkCandles.length < lookback) return false;
      const rsRatios: number[] = [];
      for (let i = 0; i < lookback; i++) {
        if (benchmarkCandles[i].close > 0) {
          rsRatios.push(candles[i].close / benchmarkCandles[i].close);
        }
      }
      if (rsRatios.length < 2) return false;
      const currentRS = rsRatios[0];
      const maxRS = Math.max(...rsRatios);
      return currentRS >= maxRS * (1 - tolerance / 100);
    },
  },
  {
    id: "RS-4",
    name: "RSI",
    category: "Relative Strength",
    description: "The classic RSI momentum oscillator, ranging 0-100. Values above 50 show bullish momentum; above 70 is overbought (strong but potentially extended). Values below 30 are oversold (weak but potentially bouncing). Use a 50-80 range to find stocks with healthy upward momentum that aren't overheated.",
    params: [
      { name: "period", label: "RSI Period", type: "number", defaultValue: 14, min: 5, max: 50, step: 1 },
      { name: "minRSI", label: "Min RSI", type: "number", defaultValue: 50, min: 0, max: 100, step: 1 },
      { name: "maxRSI", label: "Max RSI", type: "number", defaultValue: 80, min: 0, max: 100, step: 1 },
    ],
    evaluate: (candles, params) => {
      const period = params.period ?? 14;
      const minRSI = params.minRSI ?? 50;
      const maxRSI = params.maxRSI ?? 80;
      const rsi = calcRSI(candles, period);
      return rsi >= minRSI && rsi <= maxRSI;
    },
  },
  {
    id: "RS-5",
    name: "MACD",
    category: "Relative Strength",
    description: "The MACD momentum indicator with multiple signal conditions. 'Bullish cross' catches the moment the MACD line crosses above the signal line — a buy signal. 'Histogram positive' confirms upward momentum. 'Above zero' means the fast EMA is above the slow EMA. Use for momentum confirmation alongside trend filters.",
    params: [
      { name: "fastPeriod", label: "Fast Period", type: "number", defaultValue: 12, min: 5, max: 50, step: 1 },
      { name: "slowPeriod", label: "Slow Period", type: "number", defaultValue: 26, min: 10, max: 100, step: 1 },
      { name: "signalPeriod", label: "Signal Period", type: "number", defaultValue: 9, min: 3, max: 30, step: 1 },
      { name: "condition", label: "Condition", type: "select", defaultValue: "bullish_cross", options: ["bullish_cross", "bearish_cross", "histogram_positive", "histogram_negative", "above_zero", "below_zero"] },
    ],
    evaluate: (candles, params) => {
      const fast = params.fastPeriod ?? 12;
      const slow = params.slowPeriod ?? 26;
      const sig = params.signalPeriod ?? 9;
      const condition = params.condition ?? "bullish_cross";
      if (candles.length < slow + sig) return false;
      const macd = calcMACD(candles, fast, slow, sig);
      const prevMACD = calcMACD(candles.slice(1), fast, slow, sig);
      switch (condition) {
        case "bullish_cross": return prevMACD.macd <= prevMACD.signal && macd.macd > macd.signal;
        case "bearish_cross": return prevMACD.macd >= prevMACD.signal && macd.macd < macd.signal;
        case "histogram_positive": return macd.histogram > 0;
        case "histogram_negative": return macd.histogram < 0;
        case "above_zero": return macd.macd > 0;
        case "below_zero": return macd.macd < 0;
        default: return false;
      }
    },
  },
  {
    id: "RS-6",
    name: "ADX",
    category: "Relative Strength",
    description: "Measures how STRONG the current trend is, regardless of direction. ADX above 25 = well-defined trend; above 40 = very strong trend; below 20 = no trend (choppy, range-bound). Enable 'Require Bullish' to filter for uptrends only (where buying pressure exceeds selling pressure).",
    params: [
      { name: "period", label: "ADX Period", type: "number", defaultValue: 14, min: 5, max: 50, step: 1 },
      { name: "minADX", label: "Min ADX", type: "number", defaultValue: 25, min: 0, max: 100, step: 1 },
      { name: "requireBullish", label: "Require Bullish (+DI > -DI)", type: "boolean", defaultValue: true },
    ],
    evaluate: (candles, params) => {
      const period = params.period ?? 14;
      const minADX = params.minADX ?? 25;
      const requireBullish = params.requireBullish ?? true;
      const { adx, plusDI, minusDI } = calcADX(candles, period);
      if (adx < minADX) return false;
      if (requireBullish && plusDI <= minusDI) return false;
      return true;
    },
  },
  {
    id: "RS-7",
    name: "Bull/Bear Power (Elder)",
    category: "Relative Strength",
    description: "Elder's momentum indicator comparing price extremes to the EMA. Bull Power (High minus EMA) > 0 means buyers pushed price above the trend — bullish. 'Bull rising' catches improving momentum across multiple bars. 'Bear rising' (negative bear power getting less negative) signals selling pressure is fading.",
    params: [
      { name: "period", label: "EMA Period", type: "number", defaultValue: 13, min: 5, max: 50, step: 1 },
      { name: "condition", label: "Condition", type: "select", defaultValue: "bull_positive", options: ["bull_positive", "bear_negative", "bull_rising", "bear_rising"] },
      { name: "lookback", label: "Lookback (for rising)", type: "number", defaultValue: 3, min: 1, max: 10, step: 1 },
    ],
    evaluate: (candles, params) => {
      const period = params.period ?? 13;
      const condition = params.condition ?? "bull_positive";
      const lookback = params.lookback ?? 3;
      if (candles.length < period + lookback) return false;
      const ema = calcEMA(candles, period);
      const bullPower = candles[0].high - ema;
      const bearPower = candles[0].low - ema;
      switch (condition) {
        case "bull_positive": return bullPower > 0;
        case "bear_negative": return bearPower < 0;
        case "bull_rising": {
          for (let i = 0; i < lookback - 1; i++) {
            const e1 = calcEMA(candles.slice(i), period);
            const e2 = calcEMA(candles.slice(i + 1), period);
            const bp1 = candles[i].high - e1;
            const bp2 = candles[i + 1].high - e2;
            if (bp1 <= bp2) return false;
          }
          return true;
        }
        case "bear_rising": {
          for (let i = 0; i < lookback - 1; i++) {
            const e1 = calcEMA(candles.slice(i), period);
            const e2 = calcEMA(candles.slice(i + 1), period);
            const bp1 = candles[i].low - e1;
            const bp2 = candles[i + 1].low - e2;
            if (bp1 <= bp2) return false;
          }
          return true;
        }
        default: return false;
      }
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
      { name: "period", label: "BB Period", type: "number", defaultValue: 20, min: 5, max: 50, step: 1 },
      { name: "stdDev", label: "Std Dev Multiplier", type: "number", defaultValue: 2, min: 1, max: 4, step: 0.5 },
      { name: "maxWidth", label: "Max Width %", type: "number", defaultValue: 10, min: 1, max: 50, step: 0.5 },
      { name: "minWidth", label: "Min Width %", type: "number", defaultValue: 0, min: 0, max: 50, step: 0.5 },
    ],
    evaluate: (candles, params) => {
      const period = params.period ?? 20;
      const stdDev = params.stdDev ?? 2;
      const maxWidth = params.maxWidth ?? 10;
      const minWidth = params.minWidth ?? 0;
      const bb = calcBollingerBands(candles, period, stdDev);
      return bb.width >= minWidth && bb.width <= maxWidth;
    },
  },
  {
    id: "VLT-2",
    name: "ATR Contraction/Expansion",
    category: "Volatility",
    description: "Compares the stock's recent volatility (ATR) to its historical volatility. 'Contracting' finds stocks where recent ATR has dropped significantly — the calm before the storm. 'Expanding' catches stocks where volatility is exploding — breakout or breakdown in progress. The threshold sets how much change (%) is needed to pass.",
    params: [
      { name: "atrPeriod", label: "ATR Period", type: "number", defaultValue: 14, min: 5, max: 50, step: 1 },
      { name: "recentDays", label: "Recent Bars", type: "number", defaultValue: 5, min: 1, max: 30, step: 1 },
      { name: "baselineDays", label: "Baseline Offset (bars)", type: "number", defaultValue: 20, min: 5, max: 100, step: 5 },
      { name: "condition", label: "Condition", type: "select", defaultValue: "contracting", options: ["contracting", "expanding"] },
      { name: "threshold", label: "Change Threshold %", type: "number", defaultValue: 25, min: 5, max: 80, step: 5 },
    ],
    evaluate: (candles, params) => {
      const atrPeriod = params.atrPeriod ?? 14;
      const recentDays = params.recentDays ?? 5;
      const baselineDays = params.baselineDays ?? 20;
      const condition = params.condition ?? "contracting";
      const threshold = params.threshold ?? 25;
      if (candles.length < atrPeriod + baselineDays + 1) return false;
      let recentATRSum = 0;
      for (let i = 0; i < recentDays; i++) {
        recentATRSum += calcATR(candles.slice(i), atrPeriod);
      }
      const recentATR = recentATRSum / recentDays;
      const baselineATR = calcATR(candles.slice(baselineDays), atrPeriod);
      if (baselineATR === 0) return false;
      const changePct = ((recentATR - baselineATR) / baselineATR) * 100;
      return condition === "contracting" ? changePct <= -threshold : changePct >= threshold;
    },
  },
  {
    id: "VLT-3",
    name: "Daily Range vs Average",
    category: "Volatility",
    description: "Compares today's bar range (high minus low) to the average daily range. A multiple under 0.5 means today's bar is half the normal size — tight, quiet action. A multiple above 2.0 means today was twice as wide as normal — an expansion day. Use for spotting narrow-range days inside bases or breakout expansion bars.",
    params: [
      { name: "period", label: "Avg Range Period", type: "number", defaultValue: 20, min: 5, max: 100, step: 1 },
      { name: "minMultiple", label: "Min Range Multiple", type: "number", defaultValue: 0, min: 0, max: 10, step: 0.1 },
      { name: "maxMultiple", label: "Max Range Multiple", type: "number", defaultValue: 1.5, min: 0.1, max: 10, step: 0.1 },
    ],
    evaluate: (candles, params) => {
      const period = params.period ?? 20;
      const minMult = params.minMultiple ?? 0;
      const maxMult = params.maxMultiple ?? 1.5;
      if (candles.length < period + 1) return false;
      const todayRange = candles[0].high - candles[0].low;
      let avgRange = 0;
      for (let i = 1; i <= period; i++) avgRange += candles[i].high - candles[i].low;
      avgRange /= period;
      if (avgRange === 0) return false;
      const multiple = todayRange / avgRange;
      return multiple >= minMult && multiple <= maxMult;
    },
  },
  {
    id: "VLT-4",
    name: "Squeeze Detection",
    category: "Volatility",
    description: "Detects the TTM Squeeze — when Bollinger Bands contract inside the Keltner Channels. This extreme low-volatility state is like a compressed spring. When the squeeze fires (bands expand back outside Keltner), the stock often makes a sharp directional move. One of the most reliable volatility-based setups.",
    params: [
      { name: "bbPeriod", label: "BB Period", type: "number", defaultValue: 20, min: 5, max: 50, step: 1 },
      { name: "bbStdDev", label: "BB Std Dev", type: "number", defaultValue: 2, min: 1, max: 4, step: 0.5 },
      { name: "kcPeriod", label: "Keltner Period", type: "number", defaultValue: 20, min: 5, max: 50, step: 1 },
      { name: "kcMult", label: "Keltner ATR Multiplier", type: "number", defaultValue: 1.5, min: 0.5, max: 4, step: 0.5 },
    ],
    evaluate: (candles, params) => {
      const bbPeriod = params.bbPeriod ?? 20;
      const bbStdDev = params.bbStdDev ?? 2;
      const kcPeriod = params.kcPeriod ?? 20;
      const kcMult = params.kcMult ?? 1.5;
      if (candles.length < Math.max(bbPeriod, kcPeriod) + 1) return false;
      const bb = calcBollingerBands(candles, bbPeriod, bbStdDev);
      const ema = calcEMA(candles, kcPeriod);
      const atr = calcATR(candles, kcPeriod);
      const kcUpper = ema + kcMult * atr;
      const kcLower = ema - kcMult * atr;
      return bb.lower > kcLower && bb.upper < kcUpper;
    },
  },
];

export const INDICATOR_LIBRARY: IndicatorDefinition[] = [
  ...MOVING_AVERAGES,
  ...VOLUME,
  ...PRICE_ACTION,
  ...RELATIVE_STRENGTH,
  ...VOLATILITY,
];
