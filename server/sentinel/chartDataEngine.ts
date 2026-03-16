import { getPeriodsForTimeframe } from "../../shared/indicatorTemplates";
import * as alpaca from "../alpaca";
import { getDailyBars, getIntradayBars } from "../data-layer";

export interface ChartCandle {
  date: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Gap {
  index: number;              // Bar index where gap occurred
  isUp: boolean;              // true = gap up, false = gap down
  originalTop: number;        // Original top of gap
  originalBottom: number;     // Original bottom of gap
  currentTop: number;         // Current top (shrinks as partially filled)
  currentBottom: number;      // Current bottom (shrinks as partially filled)
  isTouched: boolean;         // Has price touched the gap?
  isFilled: boolean;          // Has gap been completely filled?
  filledBarIndex: number | null;  // Bar index where gap was filled
  createdAt: number;          // Timestamp when gap was created
  expiresAt: number;          // Timestamp when gap expires (createdAt + lookbackDays)
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
  gaps?: Gap[];              // Support/Resistance gaps
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

/**
 * Calculate Support/Resistance Gaps
 * Based on TradingView Pinescript gap detection logic by Nick Drendel
 * 
 * Gaps occur when:
 * - Gap Up: current bar's low > previous bar's close
 * - Gap Down: current bar's high < previous bar's close
 * 
 * Gaps are tracked until:
 * - Touched: price reaches the gap level
 * - Filled: close price completely fills the gap
 * - Expired: older than lookback_days
 * 
 * @param lookbackDays - Gaps expire after this many days (default 251, matching Pinescript)
 * @param gapLimit - Maximum number of gaps to show (default 20, matching Pinescript)
 */
function calculateGaps(
  candles: ChartCandle[], 
  removeOnFill: boolean = false,
  lookbackDays: number = 251,
  gapLimit: number = 20
): Gap[] {
  const gaps: Gap[] = [];
  const MS_IN_DAY = 1000 * 60 * 60 * 24;
  
  for (let i = 1; i < candles.length; i++) {
    const prevClose = candles[i - 1].close;
    const dayHigh = candles[i].high;
    const dayLow = candles[i].low;
    const dayClose = candles[i].close;
    
    // Check for gap up: current low > previous close
    const gapUp = dayLow > prevClose;
    
    // Check for gap down: current high < previous close
    const gapDown = dayHigh < prevClose;
    
    if (gapUp) {
      const gapDate = new Date(candles[i].date).getTime();
      gaps.push({
        index: i,
        isUp: true,
        originalTop: dayLow,
        originalBottom: prevClose,
        currentTop: dayLow,
        currentBottom: prevClose,
        isTouched: false,
        isFilled: false,
        filledBarIndex: null,
        createdAt: gapDate,
        expiresAt: gapDate + (lookbackDays * MS_IN_DAY),
      });
    } else if (gapDown) {
      const gapDate = new Date(candles[i].date).getTime();
      gaps.push({
        index: i,
        isUp: false,
        originalTop: prevClose,
        originalBottom: dayHigh,
        currentTop: prevClose,
        currentBottom: dayHigh,
        isTouched: false,
        isFilled: false,
        filledBarIndex: null,
        createdAt: gapDate,
        expiresAt: gapDate + (lookbackDays * MS_IN_DAY),
      });
    }
  }
  
  // Process each subsequent bar to check if gaps are touched/filled/shrunk
  for (let i = 0; i < candles.length; i++) {
    const bar = candles[i];
    
    for (let g = gaps.length - 1; g >= 0; g--) {
      const gap = gaps[g];
      
      // Skip if this bar is before or at the gap
      if (i <= gap.index) continue;
      
      // Skip if already filled (and we're removing on fill)
      if (gap.isFilled && removeOnFill) continue;
      
      // Check if current bar's high/low touches the gap
      if (!gap.isTouched) {
        if (gap.isUp && bar.low <= gap.currentTop) {
          gap.isTouched = true;
        } else if (!gap.isUp && bar.high >= gap.currentBottom) {
          gap.isTouched = true;
        }
      }
      
      // Check if the confirmed close fills the gap completely
      const isNewlyFilled = gap.isUp 
        ? bar.close <= gap.originalBottom 
        : bar.close >= gap.originalTop;
      
      if (isNewlyFilled && !gap.isFilled) {
        gap.isFilled = true;
        gap.filledBarIndex = i;
        if (removeOnFill) {
          gaps.splice(g, 1);
          continue;
        }
      }
      
      // Shrink the gap if partially filled by the close
      if (!gap.isFilled) {
        if (gap.isUp && bar.close < gap.currentTop && bar.close > gap.originalBottom) {
          gap.currentTop = bar.close;
        } else if (!gap.isUp && bar.close > gap.currentBottom && bar.close < gap.originalTop) {
          gap.currentBottom = bar.close;
        }
      }
    }
  }
  
  // Filter gaps after processing ALL bars (matching Pinescript logic)
  // Get the current date (last bar in the dataset)
  const lastBarDate = candles.length > 0 ? new Date(candles[candles.length - 1].date).getTime() : Date.now();
  
  // Step 1: Remove expired gaps (older than lookbackDays)
  const activeGaps = gaps.filter(gap => lastBarDate < gap.expiresAt);
  
  // Step 2: Keep only the gapLimit most recent active gaps
  const limitedGaps = activeGaps
    .sort((a, b) => b.createdAt - a.createdAt) // Most recent first
    .slice(0, gapLimit);
  
  console.log(`[Gaps] Detected ${gaps.length} total, ${activeGaps.length} within ${lookbackDays} days, keeping ${limitedGaps.length} most recent`);
  
  return limitedGaps;
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

    const isIntraday = interval !== "1d";
    
    if (isIntraday) {
      console.log(`[ChartData] Fetching intraday data for ${symbol} (${interval}, ETH=${includeETH})`);
      const intradayBars = await getIntradayBars(symbol, interval, startDate, endDate, includeETH);
      
      return intradayBars
        .map((c) => ({
          date: new Date(c.timestamp),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        }))
        .sort((a: HistoricalBar, b: HistoricalBar) => new Date(b.date).getTime() - new Date(a.date).getTime());
    } else {
      console.log(`[ChartData] Fetching daily data for ${symbol}`);
      const dataLayerBars = await getDailyBars(symbol, days);
      
      if (dataLayerBars && dataLayerBars.length >= days * 0.5) {
        return dataLayerBars.map((b) => ({
          date: new Date(b.date),
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
          volume: b.volume,
        }));
      }
      
      const alpacaCandles = await alpaca.getAlpacaIntradayData(symbol, startDate, endDate, "1d", true);
      
      return alpacaCandles
        .map((c: alpaca.AlpacaCandle) => ({
          date: new Date(c.date),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        }))
        .sort((a: HistoricalBar, b: HistoricalBar) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }
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

    // Calculate Support/Resistance Gaps (only for daily timeframe)
    const gaps = timeframe === "daily" ? calculateGaps(finalCandles, false) : undefined;

    return {
      candles: finalCandles,
      indicators: { ema5: ma5, ema10: ma10, sma21: ma20, sma50: ma50, sma200: ma200, vwap, avwapHigh, avwapLow },
      gaps,
      ticker: ticker.toUpperCase(),
      timeframe,
    };
  } catch (error) {
    console.error(`[ChartData] Error fetching chart data for ${ticker}:`, error);
    return null;
  }
}
