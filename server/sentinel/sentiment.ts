import * as alpaca from "../alpaca";
import { getSectorForSymbol } from "../fundamentals";
import { getDailyBars } from "../data-layer";

// Resample daily bars to weekly bars
function resampleToWeekly(dailyBars: alpaca.AlpacaCandle[]): alpaca.AlpacaCandle[] {
  if (dailyBars.length === 0) return [];
  
  const weeklyBars: alpaca.AlpacaCandle[] = [];
  let weekStart: Date | null = null;
  let weekOpen = 0;
  let weekHigh = -Infinity;
  let weekLow = Infinity;
  let weekClose = 0;
  let weekVolume = 0;
  
  for (const bar of dailyBars) {
    const date = new Date(bar.date);
    const dayOfWeek = date.getDay();
    
    // Start a new week on Monday (or first bar)
    if (weekStart === null || dayOfWeek === 1 || date.getTime() - weekStart.getTime() > 7 * 24 * 60 * 60 * 1000) {
      // Save previous week if exists
      if (weekStart !== null) {
        weeklyBars.push({
          date: weekStart.toISOString(),
          open: weekOpen,
          high: weekHigh,
          low: weekLow,
          close: weekClose,
          volume: weekVolume,
        });
      }
      // Start new week
      weekStart = date;
      weekOpen = bar.open;
      weekHigh = bar.high;
      weekLow = bar.low;
      weekClose = bar.close;
      weekVolume = bar.volume;
    } else {
      // Continue current week
      weekHigh = Math.max(weekHigh, bar.high);
      weekLow = Math.min(weekLow, bar.low);
      weekClose = bar.close;
      weekVolume += bar.volume;
    }
  }
  
  // Save final week
  if (weekStart !== null) {
    weeklyBars.push({
      date: weekStart.toISOString(),
      open: weekOpen,
      high: weekHigh,
      low: weekLow,
      close: weekClose,
      volume: weekVolume,
    });
  }
  
  return weeklyBars;
}

export interface InstrumentTrend {
  symbol: string;
  price: number;
  ma20: number;
  ma20Slope: "rising" | "falling" | "flat";
  trend: 1 | 0 | -1;
}

export interface DailyBasket {
  state: "RISK-ON" | "MIXED" | "RISK-OFF";
  confidence: "high" | "medium" | "low";
  instruments: Record<string, InstrumentTrend>;
  canaryTags: string[];
}

export interface MMTrend {
  state: 1 | 0.5 | -0.5 | -1;
  stateName: "Tailwind" | "Falling Tailwind" | "Slack" | "Headwind";
  confidence: "strong" | "moderate" | "weak";
  price: number;
  ema21: number;
  emaSlope: "rising" | "falling" | "flat";
}

export type WeeklyTrend = MMTrend;

export interface SectorTrend {
  sector: string;
  etf: string;
  state: 1 | 0 | -1;
  stateName: "Tailwind" | "Neutral" | "Headwind";
  confidence: "strong" | "moderate" | "weak";
  price: number;
  ma50: number;
  ma200: number;
}

export interface ChoppinessRegime {
  daily: {
    value: number;
    state: "CHOPPY" | "MIXED" | "TRENDING";
  };
  weekly: {
    value: number;
    state: "CHOPPY" | "MIXED" | "TRENDING";
  };
  recommendation: string;
}

export interface MarketSentiment {
  weekly: WeeklyTrend;
  daily: DailyBasket;
  choppiness?: ChoppinessRegime;
  summary: string;
  updatedAt: Date;
}

const RISK_BASKET = ["QQQ", "IWO", "SLY", "ARKK", "VIXY"];

const SECTOR_ETF_MAP: Record<string, { etf: string; name: string }> = {
  "Technology": { etf: "XLK", name: "Technology" },
  "Financial Services": { etf: "XLF", name: "Financials" },
  "Healthcare": { etf: "XLV", name: "Healthcare" },
  "Consumer Cyclical": { etf: "XLY", name: "Consumer Discretionary" },
  "Consumer Defensive": { etf: "XLP", name: "Consumer Staples" },
  "Energy": { etf: "XLE", name: "Energy" },
  "Industrials": { etf: "XLI", name: "Industrials" },
  "Basic Materials": { etf: "XLB", name: "Materials" },
  "Real Estate": { etf: "XLRE", name: "Real Estate" },
  "Utilities": { etf: "XLU", name: "Utilities" },
  "Communication Services": { etf: "XLC", name: "Communication Services" },
};

let sentimentCache: { data: MarketSentiment | null; fetchedAt: number } = {
  data: null,
  fetchedAt: 0,
};

const CACHE_DURATION = 30 * 60 * 1000;

function calculateMA(prices: number[], period: number): number {
  if (prices.length < period) return prices[0] || 0;
  const slice = prices.slice(0, period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function calculateSlope(prices: number[], period: number): "rising" | "falling" | "flat" {
  if (prices.length < period + 5) return "flat";
  const currentMA = calculateMA(prices.slice(0, period), period);
  const previousMA = calculateMA(prices.slice(5, period + 5), period);
  const diff = ((currentMA - previousMA) / previousMA) * 100;
  if (diff > 0.5) return "rising";
  if (diff < -0.5) return "falling";
  return "flat";
}

function calculateEMA(prices: number[], period: number): number {
  if (prices.length < period) return prices[0] || 0;
  const reversed = [...prices].reverse();
  const k = 2 / (period + 1);
  let ema = reversed.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < reversed.length; i++) {
    ema = reversed[i] * k + ema * (1 - k);
  }
  return ema;
}

function calculateEMASlope(prices: number[], period: number): "rising" | "falling" | "flat" {
  if (prices.length < period + 5) return "flat";
  const currentEMA = calculateEMA(prices, period);
  const previousEMA = calculateEMA(prices.slice(5), period);
  const diff = ((currentEMA - previousEMA) / previousEMA) * 100;
  if (diff > 0.3) return "rising";
  if (diff < -0.3) return "falling";
  return "flat";
}

async function fetchHistoricalPrices(symbol: string, days: number): Promise<number[]> {
  try {
    const dataLayerBars = await getDailyBars(symbol, days + 10);
    
    if (dataLayerBars && dataLayerBars.length >= days * 0.5) {
      return dataLayerBars.map((d) => d.close);
    }
    
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days - 10);
    const result = await alpaca.fetchAlpacaDailyBars(symbol, startDate, endDate);
    return result.map((d) => d.close).reverse();
  } catch (error) {
    console.error(`Failed to fetch ${symbol}:`, error);
    return [];
  }
}

async function fetchWeeklyPrices(symbol: string, weeks: number): Promise<number[]> {
  try {
    const days = weeks * 7 + 30;
    const dataLayerBars = await getDailyBars(symbol, days);
    
    let dailyBars: alpaca.AlpacaCandle[];
    
    if (dataLayerBars && dataLayerBars.length >= weeks * 5) {
      dailyBars = dataLayerBars.map(b => ({
        date: b.date,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
      })).reverse();
    } else {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      dailyBars = await alpaca.fetchAlpacaDailyBars(symbol, startDate, endDate);
    }
    
    const weeklyBars = resampleToWeekly(dailyBars);
    return weeklyBars.map((d) => d.close).reverse();
  } catch (error) {
    console.error(`Failed to fetch weekly ${symbol}:`, error);
    return [];
  }
}

interface OHLCCandle {
  high: number;
  low: number;
  close: number;
}

async function fetchDailyOHLC(symbol: string, days: number): Promise<OHLCCandle[]> {
  try {
    const dataLayerBars = await getDailyBars(symbol, days + 10);
    
    if (dataLayerBars && dataLayerBars.length >= days * 0.5) {
      return dataLayerBars.map(d => ({ high: d.high, low: d.low, close: d.close }));
    }
    
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days - 10);
    const result = await alpaca.fetchAlpacaDailyBars(symbol, startDate, endDate);
    return result.map(d => ({ high: d.high, low: d.low, close: d.close })).reverse();
  } catch (error) {
    console.error(`Failed to fetch OHLC for ${symbol}:`, error);
    return [];
  }
}

async function fetchWeeklyOHLC(symbol: string, weeks: number): Promise<OHLCCandle[]> {
  try {
    const days = weeks * 7 + 30;
    const dataLayerBars = await getDailyBars(symbol, days);
    
    let dailyBars: alpaca.AlpacaCandle[];
    
    if (dataLayerBars && dataLayerBars.length >= weeks * 5) {
      dailyBars = dataLayerBars.map(b => ({
        date: b.date,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
      })).reverse();
    } else {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      dailyBars = await alpaca.fetchAlpacaDailyBars(symbol, startDate, endDate);
    }
    
    const weeklyBars = resampleToWeekly(dailyBars);
    return weeklyBars.map(d => ({ high: d.high, low: d.low, close: d.close })).reverse();
  } catch (error) {
    console.error(`Failed to fetch weekly OHLC for ${symbol}:`, error);
    return [];
  }
}

// Calculate Choppiness Index (CI)
// CI = 100 * LOG10(SUM(ATR, n) / (Highest High - Lowest Low)) / LOG10(n)
// CI > 61.8 = Choppy/ranging, CI < 38.2 = Trending
function calculateChoppinessIndex(candles: OHLCCandle[], period: number): number {
  if (candles.length < period + 1) return 50; // Default to mixed if insufficient data
  
  // Calculate ATR sum over period
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
  
  // Get highest high and lowest low over the period
  const periodCandles = candles.slice(0, period);
  const highestHigh = Math.max(...periodCandles.map(c => c.high));
  const lowestLow = Math.min(...periodCandles.map(c => c.low));
  
  const range = highestHigh - lowestLow;
  if (range === 0) return 50; // Avoid division by zero
  
  // Choppiness Index formula
  const ci = 100 * Math.log10(atrSum / range) / Math.log10(period);
  
  return Math.min(100, Math.max(0, ci)); // Clamp between 0-100
}

function classifyChoppiness(value: number): "CHOPPY" | "MIXED" | "TRENDING" {
  if (value >= 61.8) return "CHOPPY";
  if (value <= 38.2) return "TRENDING";
  return "MIXED";
}

function getChoppinessRecommendation(dailyState: string, weeklyState: string): string {
  if (dailyState === "CHOPPY" && weeklyState === "CHOPPY") {
    return "Market is very choppy. Scale out profits quickly, avoid overnight holds, use smaller position sizes.";
  }
  if (dailyState === "CHOPPY" && weeklyState === "TRENDING") {
    return "Daily chop within weekly trend. Use intraday pullbacks for entries aligned with weekly trend.";
  }
  if (dailyState === "TRENDING" && weeklyState === "CHOPPY") {
    return "Short-term trend in choppy environment. Quick day trades work, avoid swing holds.";
  }
  if (dailyState === "TRENDING" && weeklyState === "TRENDING") {
    return "Strong trending environment. Let winners run, add on pullbacks, overnight holds OK.";
  }
  return "Mixed conditions. Normal trade management applies.";
}

async function fetchChoppinessRegime(): Promise<ChoppinessRegime | null> {
  try {
    const [dailyCandles, weeklyCandles] = await Promise.all([
      fetchDailyOHLC("SPY", 20), // Need 20 days for 14-period CI
      fetchWeeklyOHLC("SPY", 15), // Need 15 weeks for 10-period CI
    ]);

    const dailyCI = calculateChoppinessIndex(dailyCandles, 14);
    const weeklyCI = calculateChoppinessIndex(weeklyCandles, 10);
    
    const dailyState = classifyChoppiness(dailyCI);
    const weeklyState = classifyChoppiness(weeklyCI);

    console.log(`[Sentiment] Choppiness - Daily: ${dailyCI.toFixed(1)} (${dailyState}), Weekly: ${weeklyCI.toFixed(1)} (${weeklyState})`);

    return {
      daily: { value: Math.round(dailyCI * 10) / 10, state: dailyState },
      weekly: { value: Math.round(weeklyCI * 10) / 10, state: weeklyState },
      recommendation: getChoppinessRecommendation(dailyState, weeklyState),
    };
  } catch (error) {
    console.error("Failed to calculate choppiness:", error);
    return null;
  }
}

function classifyInstrument(
  symbol: string,
  price: number,
  ma20: number,
  ma20Slope: "rising" | "falling" | "flat"
): InstrumentTrend {
  const isVix = symbol === "VIXY";
  let trend: 1 | 0 | -1;

  if (isVix) {
    if (price < ma20 && ma20Slope === "falling") {
      trend = 1;
    } else if (price > ma20 && ma20Slope === "rising") {
      trend = -1;
    } else {
      trend = 0;
    }
  } else {
    if (price > ma20 && (ma20Slope === "rising" || ma20Slope === "flat")) {
      trend = 1;
    } else if (price < ma20 && (ma20Slope === "falling" || ma20Slope === "flat")) {
      trend = -1;
    } else {
      trend = 0;
    }
  }

  return { symbol, price, ma20, ma20Slope, trend };
}

function classifyDailyBasket(instruments: Record<string, InstrumentTrend>): DailyBasket {
  const equityETFs = ["QQQ", "IWO", "SLY", "ARKK"];
  const qqq = instruments["QQQ"];
  const vix = instruments["VIXY"];

  const riskOnCount = equityETFs.filter((s) => instruments[s]?.trend === 1).length;
  const riskOffCount = equityETFs.filter((s) => instruments[s]?.trend === -1).length;

  let state: "RISK-ON" | "MIXED" | "RISK-OFF";

  if (qqq?.trend === 1 && riskOnCount >= 3 && vix?.trend !== -1) {
    state = "RISK-ON";
  } else if (riskOffCount >= 3 && (qqq?.trend === -1 || vix?.trend === -1)) {
    state = "RISK-OFF";
  } else {
    state = "MIXED";
  }

  const canaryTags: string[] = [];

  if (
    qqq?.trend === 1 &&
    (instruments["IWO"]?.trend === -1 || instruments["ARKK"]?.trend === -1)
  ) {
    canaryTags.push("Selective Risk / Narrow Leadership");
  }

  if (
    instruments["IWO"]?.trend === 1 &&
    instruments["ARKK"]?.trend === 1 &&
    (qqq?.trend === 0 || qqq?.trend === -1)
  ) {
    canaryTags.push("Speculative Rebound Attempt");
  }

  if (vix?.trend === -1) {
    canaryTags.push("Volatility Stress");
  }

  let confidence: "high" | "medium" | "low";
  if (state === "RISK-ON" && riskOnCount === 4 && vix?.trend === 1) {
    confidence = "high";
  } else if (state === "RISK-OFF" && riskOffCount >= 3 && vix?.trend === -1) {
    confidence = "high";
  } else if (canaryTags.includes("Volatility Stress")) {
    confidence = "low";
  } else {
    confidence = "medium";
  }

  return { state, confidence, instruments, canaryTags };
}

async function fetchWeeklyTrend(): Promise<MMTrend> {
  const prices = await fetchHistoricalPrices("SPY", 40);

  if (prices.length < 25) {
    return {
      state: 0,
      stateName: "Slack",
      confidence: "weak",
      price: 0,
      ema21: 0,
      emaSlope: "flat",
    } as any;
  }

  const price = prices[0];
  const ema21 = calculateEMA(prices, 21);
  const emaSlope = calculateEMASlope(prices, 21);

  let state: 1 | 0.5 | -0.5 | -1;
  let stateName: "Tailwind" | "Falling Tailwind" | "Slack" | "Headwind";

  if (price > ema21) {
    if (emaSlope === "rising" || emaSlope === "flat") {
      state = 1;
      stateName = "Tailwind";
    } else {
      state = 0.5;
      stateName = "Falling Tailwind";
    }
  } else {
    if (emaSlope === "rising" || emaSlope === "flat") {
      state = -0.5;
      stateName = "Slack";
    } else {
      state = -1;
      stateName = "Headwind";
    }
  }

  const priceDistance = Math.abs((price - ema21) / ema21);
  let confidence: "strong" | "moderate" | "weak";
  if (priceDistance > 0.03) {
    confidence = "strong";
  } else if (priceDistance > 0.01) {
    confidence = "moderate";
  } else {
    confidence = "weak";
  }

  return { state, stateName, confidence, price, ema21, emaSlope };
}

export async function fetchMarketSentiment(): Promise<MarketSentiment> {
  const now = Date.now();
  if (sentimentCache.data && now - sentimentCache.fetchedAt < CACHE_DURATION) {
    return sentimentCache.data;
  }

  const [mmTrend, choppiness, ...basketPrices] = await Promise.all([
    fetchWeeklyTrend(),
    fetchChoppinessRegime(),
    ...RISK_BASKET.map((s) => fetchHistoricalPrices(s, 30)),
  ]);

  const instruments: Record<string, InstrumentTrend> = {};
  RISK_BASKET.forEach((symbol, i) => {
    const prices = basketPrices[i];
    if (prices.length >= 20) {
      const price = prices[0];
      const ma20 = calculateMA(prices, 20);
      const ma20Slope = calculateSlope(prices, 20);
      instruments[symbol] = classifyInstrument(symbol, price, ma20, ma20Slope);
    }
  });

  const daily = classifyDailyBasket(instruments);

  let summary: string;
  if (mmTrend.state >= 0.5 && daily.state === "RISK-ON") {
    summary = "Strong tailwinds across MM structure and daily execution. Favorable for longs.";
  } else if (mmTrend.state <= -0.5 && daily.state === "RISK-OFF") {
    summary = "Headwinds at both MM and daily levels. Defensive positioning favored.";
  } else if (mmTrend.state >= 0.5 && daily.state === "MIXED") {
    summary = "MM trend constructive but daily mixed. Selective entries on pullbacks.";
  } else if (mmTrend.state <= -0.5 && daily.state === "MIXED") {
    summary = "MM trend cautious with choppy daily. Reduced exposure, quick profits.";
  } else {
    summary = "Market in transition. Prioritize quality setups with tight risk management.";
  }

  if (daily.canaryTags.length > 0) {
    summary += ` Warning: ${daily.canaryTags.join(", ")}.`;
  }

  // Add choppiness context to summary
  if (choppiness) {
    if (choppiness.daily.state === "CHOPPY" || choppiness.weekly.state === "CHOPPY") {
      summary += " Choppiness detected - take profits faster, reduce overnight exposure.";
    }
  }

  const sentiment: MarketSentiment = {
    weekly: mmTrend,
    daily,
    choppiness: choppiness || undefined,
    summary,
    updatedAt: new Date(),
  };

  sentimentCache = { data: sentiment, fetchedAt: now };
  return sentiment;
}

export async function fetchSectorSentiment(symbol: string): Promise<SectorTrend | null> {
  try {
    const sector = await getSectorForSymbol(symbol);

    if (!sector || !SECTOR_ETF_MAP[sector]) {
      console.log(`No sector mapping for ${symbol} (sector: ${sector})`);
      return null;
    }

    const sectorInfo = SECTOR_ETF_MAP[sector] || SECTOR_ETF_MAP["Technology"];
    const etfSymbol = sectorInfo.etf;

    const prices = await fetchHistoricalPrices(etfSymbol, 250);
    if (prices.length < 200) {
      return null;
    }

    const price = prices[0];
    const ma50 = calculateMA(prices, 50);
    const ma200 = calculateMA(prices, 200);

    let state: 1 | 0 | -1;
    let stateName: "Tailwind" | "Neutral" | "Headwind";

    if (price > ma50 && price > ma200) {
      state = 1;
      stateName = "Tailwind";
    } else if (price < ma50 && price < ma200) {
      state = -1;
      stateName = "Headwind";
    } else {
      state = 0;
      stateName = "Neutral";
    }

    const priceVs50 = Math.abs((price - ma50) / ma50);
    const priceVs200 = Math.abs((price - ma200) / ma200);
    let confidence: "strong" | "moderate" | "weak";
    if (priceVs50 > 0.05 && priceVs200 > 0.05) {
      confidence = "strong";
    } else if (priceVs50 > 0.02 || priceVs200 > 0.02) {
      confidence = "moderate";
    } else {
      confidence = "weak";
    }

    return {
      sector: sectorInfo.name,
      etf: etfSymbol,
      state,
      stateName,
      confidence,
      price,
      ma50,
      ma200,
    };
  } catch (error) {
    console.error(`Failed to fetch sector for ${symbol}:`, error);
    return null;
  }
}

export function getSentimentCacheAge(): number {
  if (!sentimentCache.fetchedAt) return -1;
  return Math.floor((Date.now() - sentimentCache.fetchedAt) / 60000);
}

// Fetch historical prices ending on a specific date
async function fetchHistoricalPricesAsOf(symbol: string, endDate: Date, days: number): Promise<number[]> {
  try {
    const now = new Date();
    const isRecentDate = (now.getTime() - endDate.getTime()) < 30 * 24 * 60 * 60 * 1000;
    
    if (isRecentDate) {
      const dataLayerBars = await getDailyBars(symbol, days + 40);
      if (dataLayerBars && dataLayerBars.length >= days) {
        const endDateStr = endDate.toISOString().split("T")[0];
        const filtered = dataLayerBars.filter(b => b.date <= endDateStr);
        if (filtered.length >= days * 0.5) {
          return filtered.slice(0, days + 10).map(d => d.close);
        }
      }
    }
    
    const end = new Date(endDate);
    end.setDate(end.getDate() + 1);
    const start = new Date(endDate);
    start.setDate(start.getDate() - days - 10);

    const result = await alpaca.fetchAlpacaDailyBars(symbol, start, end);
    return result.map((d) => d.close).reverse();
  } catch (error) {
    console.error(`Failed to fetch historical ${symbol} as of ${endDate}:`, error);
    return [];
  }
}

// Fetch weekly prices ending on a specific date
async function fetchWeeklyPricesAsOf(symbol: string, endDate: Date, weeks: number): Promise<number[]> {
  try {
    const days = weeks * 7 + 30;
    const now = new Date();
    const isRecentDate = (now.getTime() - endDate.getTime()) < 30 * 24 * 60 * 60 * 1000;
    
    let dailyBars: alpaca.AlpacaCandle[];
    
    if (isRecentDate) {
      const dataLayerBars = await getDailyBars(symbol, days + 40);
      if (dataLayerBars && dataLayerBars.length >= weeks * 5) {
        const endDateStr = endDate.toISOString().split("T")[0];
        const filtered = dataLayerBars.filter(b => b.date <= endDateStr);
        dailyBars = filtered.map(b => ({
          date: b.date,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
          volume: b.volume,
        })).reverse();
      } else {
        const end = new Date(endDate);
        end.setDate(end.getDate() + 7);
        const start = new Date(endDate);
        start.setDate(start.getDate() - days);
        dailyBars = await alpaca.fetchAlpacaDailyBars(symbol, start, end);
      }
    } else {
      const end = new Date(endDate);
      end.setDate(end.getDate() + 7);
      const start = new Date(endDate);
      start.setDate(start.getDate() - days);
      dailyBars = await alpaca.fetchAlpacaDailyBars(symbol, start, end);
    }
    
    const weeklyBars = resampleToWeekly(dailyBars);
    return weeklyBars.map((d) => d.close).reverse();
  } catch (error) {
    console.error(`Failed to fetch weekly historical ${symbol}:`, error);
    return [];
  }
}

// Fetch weekly trend as of a historical date
async function fetchWeeklyTrendAsOf(targetDate: Date): Promise<MMTrend> {
  const prices = await fetchHistoricalPricesAsOf("SPY", targetDate, 40);

  if (prices.length < 25) {
    return {
      state: 0,
      stateName: "Slack",
      confidence: "weak",
      price: 0,
      ema21: 0,
      emaSlope: "flat",
    } as any;
  }

  const price = prices[0];
  const ema21 = calculateEMA(prices, 21);
  const emaSlope = calculateEMASlope(prices, 21);

  let state: 1 | 0.5 | -0.5 | -1;
  let stateName: "Tailwind" | "Falling Tailwind" | "Slack" | "Headwind";

  if (price > ema21) {
    if (emaSlope === "rising" || emaSlope === "flat") {
      state = 1;
      stateName = "Tailwind";
    } else {
      state = 0.5;
      stateName = "Falling Tailwind";
    }
  } else {
    if (emaSlope === "rising" || emaSlope === "flat") {
      state = -0.5;
      stateName = "Slack";
    } else {
      state = -1;
      stateName = "Headwind";
    }
  }

  const priceDistance = Math.abs((price - ema21) / ema21);
  let confidence: "strong" | "moderate" | "weak";
  if (priceDistance > 0.03) {
    confidence = "strong";
  } else if (priceDistance > 0.01) {
    confidence = "moderate";
  } else {
    confidence = "weak";
  }

  return { state, stateName, confidence, price, ema21, emaSlope };
}

// Fetch market sentiment as of a historical date
export async function fetchHistoricalMarketSentiment(targetDate: Date): Promise<MarketSentiment> {
  const [mmTrend, ...basketPrices] = await Promise.all([
    fetchWeeklyTrendAsOf(targetDate),
    ...RISK_BASKET.map((s) => fetchHistoricalPricesAsOf(s, targetDate, 30)),
  ]);

  const instruments: Record<string, InstrumentTrend> = {};
  RISK_BASKET.forEach((symbol, i) => {
    const prices = basketPrices[i];
    if (prices.length >= 20) {
      const price = prices[0];
      const ma20 = calculateMA(prices, 20);
      const ma20Slope = calculateSlope(prices, 20);
      instruments[symbol] = classifyInstrument(symbol, price, ma20, ma20Slope);
    }
  });

  const daily = classifyDailyBasket(instruments);

  let summary: string;
  if (mmTrend.state >= 0.5 && daily.state === "RISK-ON") {
    summary = "Strong tailwinds across MM structure and daily execution. Favorable for longs.";
  } else if (mmTrend.state <= -0.5 && daily.state === "RISK-OFF") {
    summary = "Headwinds at both MM and daily levels. Defensive positioning favored.";
  } else if (mmTrend.state >= 0.5 && daily.state === "MIXED") {
    summary = "MM trend constructive but daily mixed. Selective entries on pullbacks.";
  } else if (mmTrend.state <= -0.5 && daily.state === "MIXED") {
    summary = "MM trend cautious with choppy daily. Reduced exposure, quick profits.";
  } else {
    summary = "Market in transition. Prioritize quality setups with tight risk management.";
  }

  if (daily.canaryTags.length > 0) {
    summary += ` Warning: ${daily.canaryTags.join(", ")}.`;
  }

  return {
    weekly: mmTrend,
    daily,
    summary,
    updatedAt: targetDate,
  };
}

// Fetch sector sentiment as of a historical date
export async function fetchHistoricalSectorSentiment(symbol: string, targetDate: Date): Promise<SectorTrend | null> {
  try {
    const sector = await getSectorForSymbol(symbol);

    if (!sector || !SECTOR_ETF_MAP[sector]) {
      console.log(`No sector mapping for ${symbol} (sector: ${sector})`);
      return null;
    }

    const sectorInfo = SECTOR_ETF_MAP[sector] || SECTOR_ETF_MAP["Technology"];
    const etfSymbol = sectorInfo.etf;

    const prices = await fetchHistoricalPricesAsOf(etfSymbol, targetDate, 250);
    if (prices.length < 200) {
      return null;
    }

    const price = prices[0];
    const ma50 = calculateMA(prices, 50);
    const ma200 = calculateMA(prices, 200);

    let state: 1 | 0 | -1;
    let stateName: "Tailwind" | "Neutral" | "Headwind";

    if (price > ma50 && price > ma200) {
      state = 1;
      stateName = "Tailwind";
    } else if (price < ma50 && price < ma200) {
      state = -1;
      stateName = "Headwind";
    } else {
      state = 0;
      stateName = "Neutral";
    }

    const priceVs50 = Math.abs((price - ma50) / ma50);
    const priceVs200 = Math.abs((price - ma200) / ma200);
    let confidence: "strong" | "moderate" | "weak";
    if (priceVs50 > 0.05 && priceVs200 > 0.05) {
      confidence = "strong";
    } else if (priceVs50 > 0.02 || priceVs200 > 0.02) {
      confidence = "moderate";
    } else {
      confidence = "weak";
    }

    return {
      sector: sectorInfo.name,
      etf: etfSymbol,
      state,
      stateName,
      confidence,
      price,
      ma50,
      ma200,
    };
  } catch (error) {
    console.error(`Failed to fetch historical sector for ${symbol}:`, error);
    return null;
  }
}
