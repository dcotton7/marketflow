export type CandleData = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
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
};

export type IndicatorDefinition = {
  id: string;
  name: string;
  category: "Moving Averages" | "Volume" | "Price Action" | "Relative Strength" | "Volatility";
  description: string;
  params: IndicatorParam[];
  evaluate: (candles: CandleData[], params: Record<string, any>, benchmarkCandles?: CandleData[]) => boolean;
};

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
    description: "Price is above or below the Simple Moving Average of a given period",
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
    description: "Price is above or below the Exponential Moving Average of a given period",
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
    description: "Price distance from a moving average as a percentage. Positive = above, negative = below.",
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
    description: "Moving average slope (% change over N bars). Positive slope = uptrend.",
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
    description: "Checks if moving averages are stacked in bullish or bearish order (e.g. Price > 50 SMA > 150 SMA > 200 SMA)",
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
    description: "Measures the percentage distance between two moving averages. Useful for detecting convergence or divergence.",
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
    description: "Detects a moving average crossover (golden cross or death cross) within the last N bars",
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
    description: "Checks if one moving average is above or below another (e.g. 50 SMA above 200 SMA for bullish trend)",
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
    description: "Detects if the close price crossed above or below a single moving average within the last N bars. Use this for 'price crossed above/below the 50 SMA' style scans.",
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
    description: "Current volume as a multiple of the N-day average volume",
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
    description: "Compares recent average volume to a longer baseline average to detect increasing or decreasing volume trends",
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
    description: "Ratio of volume on up bars vs down bars over a period. > 1 means more volume on up bars.",
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
    description: "Detects a period of unusually low volume relative to average, often preceding breakouts",
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
    description: "Detects a sudden spike in volume, typically on a breakout or reversal day",
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
    description: "Average True Range over N periods. Filters by a minimum or maximum ATR value.",
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
    description: "ATR as a percentage of price. Measures volatility relative to share price.",
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
    description: "Detects a tight price range (consolidation base) over a period. Range is (high-low)/high as %.",
    params: [
      { name: "period", label: "Lookback Period", type: "number", defaultValue: 20, min: 5, max: 100, step: 1 },
      { name: "maxRange", label: "Max Range %", type: "number", defaultValue: 15, min: 1, max: 50, step: 0.5 },
    ],
    evaluate: (candles, params) => {
      const period = params.period ?? 20;
      const maxRange = params.maxRange ?? 15;
      if (candles.length < period) return false;
      const slice = candles.slice(0, period);
      const high = Math.max(...slice.map(c => c.high));
      const low = Math.min(...slice.map(c => c.low));
      if (high === 0) return false;
      const range = ((high - low) / high) * 100;
      return range <= maxRange;
    },
  },
  {
    id: "PA-4",
    name: "Base Depth",
    category: "Price Action",
    description: "Pullback depth from the highest high over a lookback period. Shallow bases (< 20%) are preferred.",
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
    description: "Counts the number of consolidation bases during an advance. Earlier bases (1st, 2nd) are higher probability.",
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
    description: "How far the current price is from the 52-week (260-day) high, as a percentage",
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
    description: "Detects if price broke above the highest high of a prior consolidation period within the last N bars",
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
    description: "Detects a pullback to a moving average or support level within a tolerance band",
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
    description: "Volatility Contraction Pattern: checks if successive price contractions are getting tighter over a period",
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
    description: "Detects a gap up or gap down within the last N bars",
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
    description: "Measures distance from VWAP or a pivot level. VWAP is computed over the lookback period.",
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
];

const RELATIVE_STRENGTH: IndicatorDefinition[] = [
  {
    id: "RS-1",
    name: "RS vs Index",
    category: "Relative Strength",
    description: "Relative strength vs a benchmark index. Measures outperformance over a period as a percentage.",
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
    description: "Raw relative strength score (stock return / benchmark return). Values > 1 indicate outperformance.",
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
    description: "Checks if the relative strength line (stock/benchmark ratio) is at or near a new high over a lookback period",
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
    description: "Relative Strength Index. Classic momentum oscillator (0-100).",
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
    description: "MACD crossover or histogram direction for momentum confirmation",
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
    description: "Average Directional Index. Measures trend strength (not direction). ADX > 25 = strong trend.",
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
    description: "Elder's Bull Power (High - EMA) and Bear Power (Low - EMA). Bull Power > 0 in uptrend is bullish.",
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
    description: "Bollinger Band width as a percentage of the middle band. Narrow bands suggest low volatility / potential breakout.",
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
    description: "Compares recent ATR to historical ATR. Contraction often precedes big moves.",
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
    description: "Latest bar's range (high-low) compared to the average range. Useful for detecting expansion or contraction.",
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
    description: "Bollinger Bands inside Keltner Channels. A squeeze indicates very low volatility and an impending expansion.",
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
