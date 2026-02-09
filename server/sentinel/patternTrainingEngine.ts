let yahooFinance: any = null;

async function getYahooFinance() {
  if (yahooFinance) return yahooFinance;
  try {
    const YahooFinanceModule = await import('yahoo-finance2') as any;
    const YahooFinance = YahooFinanceModule.default || YahooFinanceModule;
    if (typeof YahooFinance === 'function') {
      yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });
    } else if (YahooFinance.default && typeof YahooFinance.default === 'function') {
      yahooFinance = new YahooFinance.default({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });
    } else {
      yahooFinance = YahooFinance;
    }
    return yahooFinance;
  } catch (error) {
    console.error("Failed to initialize YahooFinance:", error);
    throw error;
  }
}

export interface ChartCandle {
  date: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ChartDataWithIndicators {
  candles: ChartCandle[];
  indicators: {
    ema5: (number | null)[];
    ema10: (number | null)[];
    sma21: (number | null)[];
    sma50: (number | null)[];
    sma200: (number | null)[];
    avwapHigh?: (number | null)[];
    avwapLow?: (number | null)[];
  };
  ticker: string;
  timeframe: string;
}

export interface PointTechnicalData {
  sma10?: number;
  ema21?: number;
  sma50?: number;
  sma150?: number;
  sma200?: number;
  distSma10?: number;
  distEma21?: number;
  distSma50?: number;
  distSma150?: number;
  distSma200?: number;
  volume?: number;
  avgVolume50d?: number;
  volumeRatio?: number;
  atr14?: number;
  atrPercent?: number;
  rsi14?: number;
  macdLine?: number;
  macdSignal?: number;
  macdHistogram?: number;
  ema6?: number;
  ema20?: number;
  sessionVwap?: number;
  bollingerUpper?: number;
  bollingerLower?: number;
  bollingerWidth?: number;
}

export interface CalculatedSetupMetrics {
  riskReward?: number;
  maStacking?: string;
  volumeRatio?: number;
  baseDepthPct?: number;
  baseWidthDays?: number;
  atrPercent?: number;
  rsVsSpy?: number;
  momentum5d?: number;
  momentum20d?: number;
  momentum50d?: number;
  pctFrom52wHigh?: number;
  bollingerWidth?: number;
  rangeTightness?: number;
  upDownVolume?: string;
  consecutiveUpDays?: number;
  avwapRecentHigh?: number;
  avwapRecentLow?: number;
  avwapEP?: number;
  ema6_20CrossStatus?: string;
  macdCrossStatus?: string;
  sessionVwapDistance?: number;
  resistanceTouchCount?: number;
}

function calculateSMA(prices: number[], period: number): number {
  if (prices.length < period) return prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
  const slice = prices.slice(0, period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function calculateEMA(prices: number[], period: number): number {
  if (prices.length < period) return prices.length > 0 ? prices[0] : 0;
  const reversed = [...prices].reverse();
  const k = 2 / (period + 1);
  let ema = reversed.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < reversed.length; i++) {
    ema = reversed[i] * k + ema * (1 - k);
  }
  return ema;
}

function calculateEMASeries(prices: number[], period: number): number[] {
  if (prices.length === 0) return [];
  const reversed = [...prices].reverse();
  const k = 2 / (period + 1);
  const result: number[] = [];
  
  if (reversed.length < period) {
    let sum = 0;
    for (let i = 0; i < reversed.length; i++) {
      sum += reversed[i];
      result.push(sum / (i + 1));
    }
    return result.reverse();
  }
  
  let ema = reversed.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = 0; i < period; i++) {
    result.push(0);
  }
  result[period - 1] = ema;
  
  for (let i = period; i < reversed.length; i++) {
    ema = reversed[i] * k + ema * (1 - k);
    result.push(ema);
  }
  
  return result.reverse();
}

function calculateSMASeries(prices: number[], period: number): (number | null)[] {
  const reversed = [...prices].reverse();
  const result: (number | null)[] = [];
  for (let i = 0; i < reversed.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else {
      const slice = reversed.slice(i - period + 1, i + 1);
      result.push(slice.reduce((a, b) => a + b, 0) / period);
    }
  }
  return result.reverse();
}

function calculateEMASeriesAligned(prices: number[], period: number): (number | null)[] {
  const reversed = [...prices].reverse();
  const result: (number | null)[] = [];
  
  if (reversed.length < period) {
    return reversed.map(() => null).reverse();
  }
  
  const k = 2 / (period + 1);
  let ema = reversed.slice(0, period).reduce((a, b) => a + b, 0) / period;
  
  for (let i = 0; i < period - 1; i++) {
    result.push(null);
  }
  result.push(ema);
  
  for (let i = period; i < reversed.length; i++) {
    ema = reversed[i] * k + ema * (1 - k);
    result.push(ema);
  }
  
  return result.reverse();
}

function calculateSMASeriesForward(prices: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else {
      const slice = prices.slice(i - period + 1, i + 1);
      result.push(slice.reduce((a, b) => a + b, 0) / period);
    }
  }
  return result;
}

function calculateEMASeriesForward(prices: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  if (prices.length < period) {
    return prices.map(() => null);
  }
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = 0; i < period - 1; i++) {
    result.push(null);
  }
  result.push(ema);
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
    result.push(ema);
  }
  return result;
}

function calculateAVWAPSeries(
  candles: { high: number; low: number; close: number; volume: number }[],
  anchorIndex: number
): (number | null)[] {
  const result: (number | null)[] = [];
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;
  for (let i = 0; i < candles.length; i++) {
    if (i < anchorIndex) {
      result.push(null);
    } else {
      const c = candles[i];
      const tp = (c.high + c.low + c.close) / 3;
      cumulativeTPV += tp * c.volume;
      cumulativeVolume += c.volume;
      result.push(cumulativeVolume > 0 ? cumulativeTPV / cumulativeVolume : null);
    }
  }
  return result;
}

function findRecentHighIndex(candles: { high: number; close: number }[], lookback: number = 100): number {
  const end = candles.length - 1;
  const start = Math.max(0, end - lookback);
  let maxIdx = start;
  for (let i = start; i <= end; i++) {
    if (candles[i].high >= candles[maxIdx].high) {
      maxIdx = i;
    }
  }
  return maxIdx;
}

function findRecentLowIndex(candles: { low: number; close: number }[], lookback: number = 100): number {
  const end = candles.length - 1;
  const start = Math.max(0, end - lookback);
  let minIdx = start;
  for (let i = start; i <= end; i++) {
    if (candles[i].low <= candles[minIdx].low) {
      minIdx = i;
    }
  }
  return minIdx;
}

function calculateATR(candles: { high: number; low: number; close: number }[], period: number): number {
  if (candles.length < period + 1) return 0;
  let atrSum = 0;
  for (let i = 0; i < period; i++) {
    const current = candles[i];
    const previous = candles[i + 1];
    if (!current || !previous) continue;
    const tr = Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close)
    );
    atrSum += tr;
  }
  return atrSum / period;
}

function calculateRSI(prices: number[], period: number): number {
  if (prices.length < period + 1) return 50;
  const reversed = [...prices].reverse();
  let gains = 0;
  let losses = 0;
  
  for (let i = reversed.length - period; i < reversed.length; i++) {
    const change = reversed[i] - reversed[i - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }
  
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculateMACD(prices: number[]): { line: number; signal: number; histogram: number } {
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  const macdLine = ema12 - ema26;
  
  const macdSeries = calculateEMASeries(prices, 12).map((_, i) => {
    const e12 = calculateEMA(prices.slice(i), 12);
    const e26 = calculateEMA(prices.slice(i), 26);
    return e12 - e26;
  });
  
  const signal = macdSeries.length >= 9 ? calculateEMA(macdSeries, 9) : macdLine;
  
  return {
    line: macdLine,
    signal,
    histogram: macdLine - signal,
  };
}

function calculateBollingerBands(prices: number[], period: number = 20, stdDevMultiplier: number = 2): { upper: number; lower: number; width: number } {
  if (prices.length < period) return { upper: 0, lower: 0, width: 0 };
  const slice = prices.slice(0, period);
  const sma = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((sum, p) => sum + Math.pow(p - sma, 2), 0) / period;
  const stdDev = Math.sqrt(variance);
  const upper = sma + stdDevMultiplier * stdDev;
  const lower = sma - stdDevMultiplier * stdDev;
  return {
    upper,
    lower,
    width: sma > 0 ? ((upper - lower) / sma) * 100 : 0,
  };
}

function calculateVWAP(candles: { close: number; high: number; low: number; volume: number }[]): number {
  if (candles.length === 0) return 0;
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;
  const reversed = [...candles].reverse();
  for (const c of reversed) {
    const tp = (c.high + c.low + c.close) / 3;
    cumulativeTPV += tp * c.volume;
    cumulativeVolume += c.volume;
  }
  return cumulativeVolume > 0 ? cumulativeTPV / cumulativeVolume : 0;
}

function calculateAnchoredVWAP(candles: { close: number; high: number; low: number; volume: number }[], anchorIndex: number): number {
  if (candles.length === 0 || anchorIndex < 0) return 0;
  const reversed = [...candles].reverse();
  const startIdx = reversed.length - 1 - anchorIndex;
  if (startIdx < 0) return 0;
  
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;
  for (let i = startIdx; i < reversed.length; i++) {
    const c = reversed[i];
    const tp = (c.high + c.low + c.close) / 3;
    cumulativeTPV += tp * c.volume;
    cumulativeVolume += c.volume;
  }
  return cumulativeVolume > 0 ? cumulativeTPV / cumulativeVolume : 0;
}

interface HistoricalBar {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

async function fetchHistoricalBars(symbol: string, days: number, interval: string = "1d"): Promise<HistoricalBar[]> {
  try {
    const yf = await getYahooFinance();
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const isIntraday = ["1m", "2m", "5m", "15m", "30m", "60m", "90m"].includes(interval);

    if (isIntraday) {
      const chartResult = await yf.chart(symbol, {
        period1: startDate,
        period2: endDate,
        interval,
      });
      const quotes = chartResult?.quotes || [];
      return quotes
        .filter((q: any) => q.open != null && q.high != null && q.low != null && q.close != null)
        .map((q: any) => ({
          date: q.date instanceof Date ? q.date : new Date(q.date),
          open: q.open,
          high: q.high,
          low: q.low,
          close: q.close,
          volume: q.volume || 0,
        }))
        .sort((a: HistoricalBar, b: HistoricalBar) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }

    const result = await yf.historical(symbol, {
      period1: startDate,
      period2: endDate,
      interval,
    }) as HistoricalBar[];

    return result.sort((a: HistoricalBar, b: HistoricalBar) => new Date(b.date).getTime() - new Date(a.date).getTime());
  } catch (error) {
    console.error(`Failed to fetch historical bars for ${symbol}:`, error);
    return [];
  }
}

export async function fetchChartData(
  ticker: string,
  timeframe: string = "daily",
  lookbackDays?: number
): Promise<ChartDataWithIndicators | null> {
  try {
    const intradayLookback: Record<string, number> = { "5min": 30, "15min": 45, "30min": 60 };
    const isIntraday = timeframe !== "daily";
    const days = lookbackDays || (isIntraday ? (intradayLookback[timeframe] || 45) : 750);
    const intervalMap: Record<string, string> = { "daily": "1d", "5min": "5m", "15min": "15m", "30min": "30m" };
    const interval = intervalMap[timeframe] || "1d";
    
    const bars = await fetchHistoricalBars(ticker.toUpperCase(), days, interval);
    if (bars.length < 10) {
      console.error(`[PatternTraining] Insufficient data for ${ticker}: ${bars.length} bars`);
      return null;
    }

    const candles: ChartCandle[] = bars.map(b => {
      const d = new Date(b.date);
      return {
        date: isIntraday ? d.toISOString() : d.toISOString().split('T')[0],
        timestamp: Math.floor(d.getTime() / 1000),
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
      };
    }).reverse();

    const seen = new Set<number>();
    const dedupedCandles = candles.filter(c => {
      if (seen.has(c.timestamp)) return false;
      seen.add(c.timestamp);
      return true;
    });

    const finalCandles = dedupedCandles;
    const closes = finalCandles.map(c => c.close);

    const ema5 = calculateEMASeriesForward(closes, 5);
    const ema10 = calculateEMASeriesForward(closes, 10);
    const sma21 = calculateSMASeriesForward(closes, 21);
    const sma50 = calculateSMASeriesForward(closes, 50);
    const sma200 = calculateSMASeriesForward(closes, 200);

    const avwapHighIdx = findRecentHighIndex(finalCandles, 120);
    const avwapLowIdx = findRecentLowIndex(finalCandles, 120);
    const avwapHigh = calculateAVWAPSeries(finalCandles, avwapHighIdx);
    const avwapLow = calculateAVWAPSeries(finalCandles, avwapLowIdx);

    return {
      candles: finalCandles,
      indicators: { ema5, ema10, sma21, sma50, sma200, avwapHigh, avwapLow },
      ticker: ticker.toUpperCase(),
      timeframe,
    };
  } catch (error) {
    console.error(`[PatternTraining] Error fetching chart data for ${ticker}:`, error);
    return null;
  }
}

export async function calculatePointTechnicals(
  ticker: string,
  pointDate: string,
  timeframe: string = "daily"
): Promise<{ technicals: PointTechnicalData; ohlcv: { open: number; high: number; low: number; close: number; volume: number } } | null> {
  try {
    const intradayLookback: Record<string, number> = { "5min": 30, "15min": 45, "30min": 60 };
    const isIntraday = timeframe !== "daily";
    const days = isIntraday ? (intradayLookback[timeframe] || 45) : 400;
    const intervalMap: Record<string, string> = { "daily": "1d", "5min": "5m", "15min": "15m", "30min": "30m" };
    const interval = intervalMap[timeframe] || "1d";
    const bars = await fetchHistoricalBars(ticker.toUpperCase(), days, interval);
    
    if (bars.length < 10) return null;

    let targetIdx: number;
    if (isIntraday && pointDate.includes('T')) {
      const targetTs = new Date(pointDate).getTime();
      targetIdx = bars.findIndex(b => {
        return Math.abs(new Date(b.date).getTime() - targetTs) < 60000;
      });
    } else {
      const targetDateStr = pointDate.split('T')[0];
      targetIdx = bars.findIndex(b => {
        const barDate = new Date(b.date).toISOString().split('T')[0];
        return barDate === targetDateStr;
      });
    }

    if (targetIdx < 0) {
      const targetTs = new Date(pointDate).getTime();
      let closestIdx = 0;
      let closestDiff = Infinity;
      bars.forEach((b, i) => {
        const diff = Math.abs(new Date(b.date).getTime() - targetTs);
        if (diff < closestDiff) {
          closestDiff = diff;
          closestIdx = i;
        }
      });
      return computeTechnicalsAtIndex(bars, closestIdx);
    }

    return computeTechnicalsAtIndex(bars, targetIdx);
  } catch (error) {
    console.error(`[PatternTraining] Error calculating technicals for ${ticker} on ${pointDate}:`, error);
    return null;
  }
}

function computeTechnicalsAtIndex(
  bars: HistoricalBar[],
  idx: number
): { technicals: PointTechnicalData; ohlcv: { open: number; high: number; low: number; close: number; volume: number } } {
  const barsFromIdx = bars.slice(idx);
  const closes = barsFromIdx.map(b => b.close);
  const bar = bars[idx];
  const price = bar.close;

  const sma10 = calculateSMA(closes, 10);
  const ema21 = calculateEMA(closes, 21);
  const sma50 = calculateSMA(closes, 50);
  const sma150 = calculateSMA(closes, 150);
  const sma200 = calculateSMA(closes, 200);

  const avgVol50 = barsFromIdx.slice(0, 50).reduce((s, b) => s + b.volume, 0) / Math.min(50, barsFromIdx.length);
  const volRatio = avgVol50 > 0 ? bar.volume / avgVol50 : 0;

  const atr14 = calculateATR(barsFromIdx, 14);
  const rsi14 = calculateRSI(closes, 14);
  const macd = calculateMACD(closes);
  const bollinger = calculateBollingerBands(closes, 20, 2);

  const ema6 = calculateEMA(closes, 6);
  const ema20 = calculateEMA(closes, 20);

  const sessionVwap = calculateVWAP(barsFromIdx.slice(0, 1).map(b => ({ close: b.close, high: b.high, low: b.low, volume: b.volume })));

  return {
    technicals: {
      sma10,
      ema21,
      sma50,
      sma150,
      sma200,
      distSma10: price > 0 ? ((price - sma10) / sma10) * 100 : 0,
      distEma21: price > 0 ? ((price - ema21) / ema21) * 100 : 0,
      distSma50: price > 0 ? ((price - sma50) / sma50) * 100 : 0,
      distSma150: price > 0 ? ((price - sma150) / sma150) * 100 : 0,
      distSma200: price > 0 ? ((price - sma200) / sma200) * 100 : 0,
      volume: bar.volume,
      avgVolume50d: avgVol50,
      volumeRatio: volRatio,
      atr14,
      atrPercent: price > 0 ? (atr14 / price) * 100 : 0,
      rsi14,
      macdLine: macd.line,
      macdSignal: macd.signal,
      macdHistogram: macd.histogram,
      ema6,
      ema20,
      bollingerUpper: bollinger.upper,
      bollingerLower: bollinger.lower,
      bollingerWidth: bollinger.width,
    },
    ohlcv: {
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
    },
  };
}

export function calculateSetupMetrics(
  bars: HistoricalBar[],
  entryIdx: number,
  stopPrice?: number,
  targetPrice?: number,
  entryPrice?: number
): CalculatedSetupMetrics {
  const barsFromEntry = bars.slice(entryIdx);
  const closes = barsFromEntry.map(b => b.close);
  const price = entryPrice || bars[entryIdx]?.close || 0;

  const sma10 = calculateSMA(closes, 10);
  const ema21 = calculateEMA(closes, 21);
  const sma50 = calculateSMA(closes, 50);
  const sma150 = calculateSMA(closes, 150);
  const sma200 = calculateSMA(closes, 200);

  let maStacking = "mixed";
  if (price > sma10 && sma10 > ema21 && ema21 > sma50 && sma50 > sma150 && sma150 > sma200) {
    maStacking = "bullish_perfect";
  } else if (price > sma50 && sma50 > sma200) {
    maStacking = "bullish";
  } else if (price < sma50 && sma50 < sma200) {
    maStacking = "bearish";
  }

  const avgVol50 = barsFromEntry.slice(0, 50).reduce((s, b) => s + b.volume, 0) / Math.min(50, barsFromEntry.length);
  const volumeRatio = avgVol50 > 0 ? bars[entryIdx]?.volume / avgVol50 : 0;

  const allCloses = bars.map(b => b.close);
  const high52w = Math.max(...bars.slice(0, 252).map(b => b.high));
  const pctFrom52wHigh = high52w > 0 ? ((price - high52w) / high52w) * 100 : 0;

  let baseDepthPct: number | undefined;
  let baseWidthDays: number | undefined;
  const recentHigh52w = high52w;
  let baseStart = -1;
  for (let i = 0; i < Math.min(bars.length, 252); i++) {
    if (bars[i].high >= recentHigh52w * 0.98) {
      baseStart = i;
      break;
    }
  }
  if (baseStart >= 0 && baseStart < entryIdx) {
    const baseSlice = bars.slice(entryIdx, baseStart + 1);
    if (baseSlice.length > 0) {
      const baseLow = Math.min(...baseSlice.map(b => b.low));
      baseDepthPct = ((recentHigh52w - baseLow) / recentHigh52w) * 100;
      baseWidthDays = baseSlice.length;
    }
  }

  const atr14 = calculateATR(barsFromEntry, 14);
  const atrPercent = price > 0 ? (atr14 / price) * 100 : 0;

  let riskReward: number | undefined;
  if (stopPrice && targetPrice && entryPrice) {
    const risk = Math.abs(entryPrice - stopPrice);
    const reward = Math.abs(targetPrice - entryPrice);
    riskReward = risk > 0 ? reward / risk : 0;
  }

  const momentum5d = closes.length > 5 ? ((closes[0] - closes[5]) / closes[5]) * 100 : 0;
  const momentum20d = closes.length > 20 ? ((closes[0] - closes[20]) / closes[20]) * 100 : 0;
  const momentum50d = closes.length > 50 ? ((closes[0] - closes[50]) / closes[50]) * 100 : 0;

  const bollinger = calculateBollingerBands(closes, 20, 2);

  const last10 = barsFromEntry.slice(0, 10);
  const last30 = barsFromEntry.slice(0, 30);
  const range10 = last10.length > 0 ? (Math.max(...last10.map(b => b.high)) - Math.min(...last10.map(b => b.low))) : 0;
  const range30 = last30.length > 0 ? (Math.max(...last30.map(b => b.high)) - Math.min(...last30.map(b => b.low))) : 0;
  const rangeTightness = range30 > 0 ? (range10 / range30) * 100 : 0;

  const entryBar = bars[entryIdx];
  const upDownVolume = entryBar && entryBar.close >= entryBar.open ? "up" : "down";

  let consecutiveUpDays = 0;
  for (let i = entryIdx; i < bars.length - 1; i++) {
    if (bars[i].close > bars[i + 1].close) {
      consecutiveUpDays++;
    } else {
      break;
    }
  }

  const ema6 = calculateEMA(closes, 6);
  const ema20 = calculateEMA(closes, 20);
  let ema6_20CrossStatus: string | undefined;
  if (closes.length > 2) {
    const prevEma6 = calculateEMA(closes.slice(1), 6);
    const prevEma20 = calculateEMA(closes.slice(1), 20);
    if (ema6 > ema20 && prevEma6 <= prevEma20) {
      ema6_20CrossStatus = "bullish_cross";
    } else if (ema6 < ema20 && prevEma6 >= prevEma20) {
      ema6_20CrossStatus = "bearish_cross";
    } else if (ema6 > ema20) {
      ema6_20CrossStatus = "above";
    } else {
      ema6_20CrossStatus = "below";
    }
  }

  const macd = calculateMACD(closes);
  let macdCrossStatus: string | undefined;
  if (macd.histogram > 0) {
    macdCrossStatus = "bullish";
  } else {
    macdCrossStatus = "bearish";
  }

  let rsVsSpy: number | undefined;

  return {
    riskReward,
    maStacking,
    volumeRatio,
    baseDepthPct,
    baseWidthDays,
    atrPercent,
    rsVsSpy,
    momentum5d,
    momentum20d,
    momentum50d,
    pctFrom52wHigh,
    bollingerWidth: bollinger.width,
    rangeTightness,
    upDownVolume,
    consecutiveUpDays,
    ema6_20CrossStatus,
    macdCrossStatus,
  };
}

export async function calculateRSvsSPY(ticker: string, days: number = 50): Promise<number> {
  try {
    const [tickerBars, spyBars] = await Promise.all([
      fetchHistoricalBars(ticker, days + 10, "1d"),
      fetchHistoricalBars("SPY", days + 10, "1d"),
    ]);

    if (tickerBars.length < days || spyBars.length < days) return 0;

    const tickerReturn = ((tickerBars[0].close - tickerBars[days - 1].close) / tickerBars[days - 1].close) * 100;
    const spyReturn = ((spyBars[0].close - spyBars[days - 1].close) / spyBars[days - 1].close) * 100;

    return tickerReturn - spyReturn;
  } catch {
    return 0;
  }
}

export async function calculateFullSetupMetrics(
  ticker: string,
  entryDate: string,
  stopPrice?: number,
  targetPrice?: number,
  entryPrice?: number
): Promise<CalculatedSetupMetrics> {
  const bars = await fetchHistoricalBars(ticker.toUpperCase(), 400, "1d");
  if (bars.length < 10) return {};

  const targetDateStr = entryDate.split('T')[0];
  let entryIdx = bars.findIndex(b => new Date(b.date).toISOString().split('T')[0] === targetDateStr);
  if (entryIdx < 0) entryIdx = 0;

  const metrics = calculateSetupMetrics(bars, entryIdx, stopPrice, targetPrice, entryPrice);

  const rsVsSpy = await calculateRSvsSPY(ticker);
  metrics.rsVsSpy = rsVsSpy;

  return metrics;
}

export function findNearestMA(
  technicals: PointTechnicalData,
  price: number
): { name: string; distance: number } {
  const mas: { name: string; value: number }[] = [
    { name: "10 SMA", value: technicals.sma10 || 0 },
    { name: "21 EMA", value: technicals.ema21 || 0 },
    { name: "50 SMA", value: technicals.sma50 || 0 },
    { name: "150 SMA", value: technicals.sma150 || 0 },
    { name: "200 SMA", value: technicals.sma200 || 0 },
  ].filter(m => m.value > 0);

  if (mas.length === 0) return { name: "none", distance: 0 };

  let nearest = mas[0];
  let minDist = Math.abs(price - mas[0].value);

  for (const ma of mas) {
    const dist = Math.abs(price - ma.value);
    if (dist < minDist) {
      minDist = dist;
      nearest = ma;
    }
  }

  return {
    name: nearest.name,
    distance: nearest.value > 0 ? ((price - nearest.value) / nearest.value) * 100 : 0,
  };
}

export function countResistanceTouches(
  bars: HistoricalBar[],
  resistancePrice: number,
  tolerancePct: number = 1.0
): number {
  const tolerance = resistancePrice * (tolerancePct / 100);
  let touches = 0;
  let lastTouchIdx = -3;

  for (let i = 0; i < bars.length; i++) {
    if (Math.abs(bars[i].high - resistancePrice) <= tolerance) {
      if (i - lastTouchIdx >= 2) {
        touches++;
        lastTouchIdx = i;
      }
    }
  }

  return touches;
}

export async function calculateAnchoredVWAPValues(
  ticker: string,
  anchorDates: { recentHigh?: string; recentLow?: string; ep?: string },
  currentDate: string
): Promise<{ recentHigh?: number; recentLow?: number; ep?: number }> {
  try {
    const bars = await fetchHistoricalBars(ticker.toUpperCase(), 400, "1d");
    if (bars.length === 0) return {};

    const result: { recentHigh?: number; recentLow?: number; ep?: number } = {};

    for (const [key, anchorDate] of Object.entries(anchorDates)) {
      if (!anchorDate) continue;
      const anchorDateStr = anchorDate.split('T')[0];
      const anchorIdx = bars.findIndex(b => new Date(b.date).toISOString().split('T')[0] === anchorDateStr);
      if (anchorIdx < 0) continue;

      const currentDateStr = currentDate.split('T')[0];
      const currentIdx = bars.findIndex(b => new Date(b.date).toISOString().split('T')[0] === currentDateStr);
      const endIdx = currentIdx >= 0 ? currentIdx : 0;

      const slice = bars.slice(endIdx, anchorIdx + 1);
      if (slice.length === 0) continue;

      const vwap = calculateVWAP(slice.map(b => ({ close: b.close, high: b.high, low: b.low, volume: b.volume })));
      (result as any)[key] = vwap;
    }

    return result;
  } catch {
    return {};
  }
}