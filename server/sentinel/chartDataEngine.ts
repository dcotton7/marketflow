import { getPeriodsForTimeframe } from "../../shared/indicatorTemplates";
import * as tiingo from "../tiingo";

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
    vwap?: (number | null)[];
    avwapHigh?: (number | null)[];
    avwapLow?: (number | null)[];
  };
  ticker: string;
  timeframe: string;
}

interface HistoricalBar {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
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

function calculateSessionVWAP(
  candles: { date: string; high: number; low: number; close: number; volume: number }[]
): (number | null)[] {
  const result: (number | null)[] = [];
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;
  let currentDay = '';

  for (let i = 0; i < candles.length; i++) {
    const itemDate = new Date(candles[i].date);
    const dayKey = itemDate.toDateString();

    if (dayKey !== currentDay) {
      cumulativeTPV = 0;
      cumulativeVolume = 0;
      currentDay = dayKey;
    }

    const tp = (candles[i].high + candles[i].low + candles[i].close) / 3;
    cumulativeTPV += tp * candles[i].volume;
    cumulativeVolume += candles[i].volume;

    result.push(cumulativeVolume > 0 ? cumulativeTPV / cumulativeVolume : null);
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

async function fetchHistoricalBars(symbol: string, days: number, interval: string = "1d", includeETH: boolean = false): Promise<HistoricalBar[]> {
  try {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const candles = await tiingo.getHistoricalBars(symbol, startDate, endDate, interval, includeETH);
    
    return candles
      .map((c: tiingo.TiingoCandle) => ({
        date: new Date(c.date),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      }))
      .sort((a: HistoricalBar, b: HistoricalBar) => new Date(b.date).getTime() - new Date(a.date).getTime());
  } catch (error) {
    console.error(`Failed to fetch historical bars for ${symbol}:`, error);
    return [];
  }
}

export async function fetchChartData(
  ticker: string,
  timeframe: string = "daily",
  lookbackDays?: number,
  includeETH: boolean = false
): Promise<ChartDataWithIndicators | null> {
  try {
    const intradayLookback: Record<string, number> = { "5min": 90, "15min": 180, "30min": 180 };
    const isIntraday = timeframe !== "daily";
    const days = lookbackDays || (isIntraday ? (intradayLookback[timeframe] || 90) : 750);
    const intervalMap: Record<string, string> = { "daily": "1d", "5min": "5m", "15min": "15m", "30min": "30m" };
    const interval = intervalMap[timeframe] || "1d";
    
    const bars = await fetchHistoricalBars(ticker.toUpperCase(), days, interval, includeETH);
    if (bars.length < 10) {
      console.error(`[ChartData] Insufficient data for ${ticker}: ${bars.length} bars`);
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

    const maConfig = getPeriodsForTimeframe(timeframe);
    const ma5Def = maConfig.find(m => m.id === "ma5");
    const ma10Def = maConfig.find(m => m.id === "ma10");
    const ma20Def = maConfig.find(m => m.id === "ma20");
    const ma50Def = maConfig.find(m => m.id === "ma50");
    const ma200Def = maConfig.find(m => m.id === "ma200");

    const ma5 = ma5Def ? (ma5Def.type === "ema" ? calculateEMASeriesForward(closes, ma5Def.period) : calculateSMASeriesForward(closes, ma5Def.period)) : calculateSMASeriesForward(closes, 5);
    const ma10 = ma10Def ? (ma10Def.type === "ema" ? calculateEMASeriesForward(closes, ma10Def.period) : calculateSMASeriesForward(closes, ma10Def.period)) : calculateSMASeriesForward(closes, 10);
    const ma20 = ma20Def ? (ma20Def.type === "ema" ? calculateEMASeriesForward(closes, ma20Def.period) : calculateSMASeriesForward(closes, ma20Def.period)) : calculateSMASeriesForward(closes, 21);
    const ma50 = ma50Def ? (ma50Def.type === "ema" ? calculateEMASeriesForward(closes, ma50Def.period) : calculateSMASeriesForward(closes, ma50Def.period)) : calculateSMASeriesForward(closes, 50);
    const ma200 = ma200Def ? (ma200Def.type === "ema" ? calculateEMASeriesForward(closes, ma200Def.period) : calculateSMASeriesForward(closes, ma200Def.period)) : calculateSMASeriesForward(closes, 200);

    const vwap = calculateSessionVWAP(finalCandles);
    const avwapHighIdx = findRecentHighIndex(finalCandles, 120);
    const avwapLowIdx = findRecentLowIndex(finalCandles, 120);
    const avwapHigh = calculateAVWAPSeries(finalCandles, avwapHighIdx);
    const avwapLow = calculateAVWAPSeries(finalCandles, avwapLowIdx);

    return {
      candles: finalCandles,
      indicators: { ema5: ma5, ema10: ma10, sma21: ma20, sma50: ma50, sma200: ma200, vwap, avwapHigh, avwapLow },
      ticker: ticker.toUpperCase(),
      timeframe,
    };
  } catch (error) {
    console.error(`[ChartData] Error fetching chart data for ${ticker}:`, error);
    return null;
  }
}
