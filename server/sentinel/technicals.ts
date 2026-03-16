import * as alpaca from "../alpaca";
import { getDailyBars, getQuote } from "../data-layer";

export interface TechnicalData {
  symbol: string;
  currentPrice: number;
  
  // Today's data
  todayOpen: number;
  todayHigh: number;
  todayLow: number;
  
  // Yesterday's data
  yesterdayHigh: number;
  yesterdayLow: number;
  yesterdayClose: number;
  
  // Weekly low (low of the week so far)
  weeklyLow: number;
  weeklyHigh: number;
  
  // 5-day range
  fiveDayHigh: number;
  fiveDayLow: number;
  
  // Key moving averages
  sma5: number;
  sma10: number;
  sma21: number;
  sma50: number;
  sma200: number;
  
  // Volatility
  atr14: number;
  avgVolume20: number;
  
  // Base structure
  baseBottom: number | null; // Lowest low in the last 30 days (for base quality)
  baseTop: number | null; // Highest high in consolidation area
  
  // Key price levels for profit targets
  high52Week: number; // 52-week (1 year) high
  low52Week: number; // 52-week (1 year) low
  swingHighs: { price: number; daysAgo: number; date: string; lastTouchedDaysAgo: number }[]; // Recent swing highs (resistance levels)
  adr20: number; // 20-day average daily range in dollar terms
  extensionFrom50dAdr: number | null; // How many ADRs price is above the 50 DMA
  
  // Relative to MAs
  distanceFromSma21: number; // % above/below
  distanceFromSma50: number;
  distanceFromSma200: number;
  
  fetchedAt: Date;
}

interface HistoricalQuote {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

async function fetchQuote(symbol: string): Promise<{ price: number; open: number; high: number; low: number } | null> {
  try {
    const quote = await getQuote(symbol);
    if (quote) {
      return {
        price: quote.price,
        open: quote.open,
        high: quote.high,
        low: quote.low,
      };
    }
    const alpacaQuote = await alpaca.fetchAlpacaQuote(symbol);
    return {
      price: alpacaQuote?.lastPrice || 0,
      open: 0,
      high: 0,
      low: 0,
    };
  } catch (error) {
    console.error(`Failed to fetch quote for ${symbol}:`, error);
    return null;
  }
}

async function fetchHistorical(symbol: string, days: number): Promise<HistoricalQuote[]> {
  try {
    const dataLayerBars = await getDailyBars(symbol, days + 10);
    
    if (dataLayerBars && dataLayerBars.length >= days * 0.5) {
      return dataLayerBars.map(b => ({
        date: new Date(b.date),
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
      }));
    }
    
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days - 10);
    const bars = await alpaca.fetchAlpacaDailyBars(symbol, startDate, endDate);
    return bars
      .map(b => ({
        date: new Date(b.date),
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
      }))
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .reverse();
  } catch (error) {
    console.error(`Failed to fetch historical for ${symbol}:`, error);
    return [];
  }
}

function calculateSMA(prices: number[], period: number): number {
  if (prices.length < period) return prices[0] || 0;
  const slice = prices.slice(0, period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function calculateATR(candles: HistoricalQuote[], period: number): number {
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

function findBaseStructure(candles: HistoricalQuote[]): { bottom: number | null; top: number | null } {
  if (candles.length < 20) return { bottom: null, top: null };
  
  // Look at last 30 days for a base
  const last30 = candles.slice(0, 30);
  const lows = last30.map(c => c.low);
  const highs = last30.map(c => c.high);
  
  const bottom = Math.min(...lows);
  const top = Math.max(...highs);
  
  return { bottom, top };
}

function findSwingHighs(
  candles: HistoricalQuote[],
  referencePrice: number,
  maxResults: number = 8,
  touchTolerancePct: number = 0.002
): { price: number; daysAgo: number; date: string; lastTouchedDaysAgo: number }[] {
  if (candles.length < 10) return [];
  const candidates: { price: number; index: number; date: string; distPct: number }[] = [];
  const minSeparation = 5;
  
  for (let i = 2; i < candles.length - 2; i++) {
    const c = candles[i];
    if (
      c.high > candles[i - 1].high &&
      c.high > candles[i - 2].high &&
      c.high > candles[i + 1].high &&
      c.high > candles[i + 2].high
    ) {
      const distPct = referencePrice > 0 ? ((c.high - referencePrice) / referencePrice) * 100 : 0;
      candidates.push({ price: c.high, index: i, date: c.date.toISOString().slice(0, 10), distPct });
    }
  }
  
  // Prefer the closest OVERHEAD resistance levels above the reference price.
  const overhead = candidates.filter(c => c.price > referencePrice);
  overhead.sort((a, b) => (a.price - b.price) || (a.index - b.index));
  
  const selected: { price: number; daysAgo: number; date: string; lastTouchedDaysAgo: number }[] = [];
  for (const c of overhead) {
    if (selected.length >= maxResults) break;
    const tooClose = selected.some(s => Math.abs(s.daysAgo - c.index) < minSeparation);
    if (!tooClose) {
      // Find most recent touch of this level (high within tolerance of swing price)
      let lastTouched = c.index;
      for (let j = 0; j < candles.length; j++) {
        const pctDiff = Math.abs(candles[j].high - c.price) / c.price;
        if (pctDiff <= touchTolerancePct) {
          lastTouched = j; // smaller j = more recent
          break;
        }
      }
      selected.push({ price: c.price, daysAgo: c.index, date: c.date, lastTouchedDaysAgo: lastTouched });
    }
  }
  
  // Sort final list by price (nearest overhead first)
  selected.sort((a, b) => a.price - b.price);
  return selected;
}

function findResistanceClusters(
  candles: HistoricalQuote[],
  referencePrice: number,
  maxResults: number = 5,
  clusterTolerancePct: number = 0.003,
  minTouches: number = 2
): { price: number; daysAgo: number; date: string; lastTouchedDaysAgo: number }[] {
  if (candles.length < 10 || referencePrice <= 0) return [];

  type Cluster = {
    sum: number;
    repPrice: number; // mean of touches
    touches: number;
    lastTouchedIdx: number; // smaller = more recent
    lastTouchedDate: string;
  };

  const clusters: Cluster[] = [];

  for (let i = 0; i < candles.length; i++) {
    const samples = [candles[i].high, candles[i].close];
    for (const h of samples) {
      if (!isFinite(h) || h <= referencePrice) continue;

      let matched: Cluster | null = null;
      for (const c of clusters) {
        const pctDiff = Math.abs(h - c.repPrice) / c.repPrice;
        if (pctDiff <= clusterTolerancePct) {
          matched = c;
          break;
        }
      }

      if (!matched) {
        clusters.push({
          sum: h,
          repPrice: h,
          touches: 1,
          lastTouchedIdx: i,
          lastTouchedDate: candles[i].date.toISOString().slice(0, 10),
        });
        continue;
      }

      matched.touches++;
      matched.sum += h;
      matched.repPrice = matched.sum / matched.touches;
      // lastTouchedIdx: smallest index wins (most recent)
      if (i < matched.lastTouchedIdx) {
        matched.lastTouchedIdx = i;
        matched.lastTouchedDate = candles[i].date.toISOString().slice(0, 10);
      }
    }
  }

  const filtered = clusters
    .filter(c => c.touches >= minTouches)
    .sort((a, b) => (a.repPrice - b.repPrice) || (b.touches - a.touches));

  return filtered.slice(0, maxResults).map(c => ({
    price: c.repPrice,
    daysAgo: c.lastTouchedIdx,
    date: c.lastTouchedDate,
    lastTouchedDaysAgo: c.lastTouchedIdx,
  }));
}

function findOverheadHighPrints(
  candles: HistoricalQuote[],
  referencePrice: number,
  minPrice: number,
  maxResults: number = 8,
  mergeTolerancePct: number = 0.001
): { price: number; daysAgo: number; date: string; lastTouchedDaysAgo: number }[] {
  if (candles.length < 10 || referencePrice <= 0) return [];

  type Level = {
    repPrice: number;
    lastTouchedIdx: number;
    lastTouchedDate: string;
  };

  const levels: Level[] = [];
  for (let i = 0; i < candles.length; i++) {
    const h = candles[i].high;
    if (!isFinite(h) || h <= referencePrice || h < minPrice) continue;

    let matched: Level | null = null;
    for (const lvl of levels) {
      const pctDiff = Math.abs(h - lvl.repPrice) / lvl.repPrice;
      if (pctDiff <= mergeTolerancePct) {
        matched = lvl;
        break;
      }
    }

    if (!matched) {
      levels.push({
        repPrice: h,
        lastTouchedIdx: i,
        lastTouchedDate: candles[i].date.toISOString().slice(0, 10),
      });
      continue;
    }

    // Keep representative as the actual printed high closest to the reference (i.e., prefer lower highs).
    matched.repPrice = Math.min(matched.repPrice, h);
    if (i < matched.lastTouchedIdx) {
      matched.lastTouchedIdx = i;
      matched.lastTouchedDate = candles[i].date.toISOString().slice(0, 10);
    }
  }

  levels.sort((a, b) => a.repPrice - b.repPrice);
  return levels.slice(0, maxResults).map(lvl => ({
    price: lvl.repPrice,
    daysAgo: lvl.lastTouchedIdx,
    date: lvl.lastTouchedDate,
    lastTouchedDaysAgo: lvl.lastTouchedIdx,
  }));
}

function calculateADR(candles: HistoricalQuote[], period: number): number {
  if (candles.length < period) return 0;
  const slice = candles.slice(0, period);
  return slice.reduce((sum, c) => sum + (c.high - c.low), 0) / period;
}

function getWeeklyRange(candles: HistoricalQuote[]): { low: number; high: number } {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  
  // Get candles from this week
  const weekCandles = candles.slice(0, daysFromMonday + 1);
  if (weekCandles.length === 0) {
    return { low: 0, high: 0 };
  }
  
  return {
    low: Math.min(...weekCandles.map(c => c.low)),
    high: Math.max(...weekCandles.map(c => c.high)),
  };
}

export async function fetchTechnicalData(symbol: string): Promise<TechnicalData | null> {
  console.log(`[Technicals] Fetching data for ${symbol} from Alpaca...`);
  try {
    const [quote, historical] = await Promise.all([
      fetchQuote(symbol),
      // Use a long lookback so overhead swing-high resistance can include older supply levels.
      // (Some stocks revisit multi-year levels; these matter for profit targets.)
      fetchHistorical(symbol, 2000),
    ]);

    if (!quote || historical.length < 5) {
      console.error(`[Technicals] Insufficient data for ${symbol}: quote=${!!quote}, historical=${historical.length}`);
      return null;
    }
    
    console.log(`[Technicals] ${symbol} quote: price=$${quote.price.toFixed(2)}, low=$${quote.low.toFixed(2)}, high=$${quote.high.toFixed(2)}`);

    const closes = historical.map(c => c.close);
    
    // Yesterday's data (index 0 is today if market is open, or last trading day)
    const yesterday = historical[1] || historical[0];
    
    // 5-day high/low
    const last5 = historical.slice(0, 5);
    const fiveDayHigh = Math.max(...last5.map(c => c.high));
    const fiveDayLow = Math.min(...last5.map(c => c.low));
    
    // Weekly range
    const weeklyRange = getWeeklyRange(historical);
    
    // Moving averages
    const sma5 = calculateSMA(closes, 5);
    const sma10 = calculateSMA(closes, 10);
    const sma21 = calculateSMA(closes, 21);
    const sma50 = calculateSMA(closes, 50);
    const sma200 = calculateSMA(closes, 200);
    
    // ATR
    const atr14 = calculateATR(historical, 14);
    
    // Average volume
    const volumes = historical.slice(0, 20).map(c => c.volume);
    const avgVolume20 = volumes.reduce((a, b) => a + b, 0) / volumes.length;
    
    // Base structure
    const base = findBaseStructure(historical);
    
    // 52-week high/low (based on most recent ~252 trading days)
    const last252 = historical.slice(0, 252);
    const allHighs = last252.map(c => c.high);
    const allLows = last252.map(c => c.low);
    const high52Week = allHighs.length ? Math.max(...allHighs) : 0;
    const low52Week = allLows.length ? Math.min(...allLows) : 0;
    
    // ADR (20-day average daily range)
    const adr20 = calculateADR(historical, 20);
    
    // Swing highs (resistance levels)
    const pivotSwingHighs = findSwingHighs(historical, quote.price);
    const clusterLevels = findResistanceClusters(historical, quote.price);
    const overheadMinPrice = quote.price + Math.max(adr20 * 0.5, quote.price * 0.01);
    const overheadHighPrints = findOverheadHighPrints(historical, quote.price, overheadMinPrice);
    // Merge and de-duplicate by ~0.25% to avoid spam
    const mergedSwingHighs: { price: number; daysAgo: number; date: string; lastTouchedDaysAgo: number }[] = [];
    const seen: Array<{ price: number }> = [];
    const addLevel = (lvl: { price: number; daysAgo: number; date: string; lastTouchedDaysAgo: number }) => {
      const dup = seen.some(s => Math.abs(s.price - lvl.price) / lvl.price <= 0.0025);
      if (!dup) {
        seen.push({ price: lvl.price });
        mergedSwingHighs.push(lvl);
      }
    };
    [...pivotSwingHighs, ...clusterLevels, ...overheadHighPrints]
      .sort((a, b) => a.price - b.price)
      .forEach(addLevel);

    const swingHighs = mergedSwingHighs;
    
    // Extension from 50 DMA in ADR multiples
    const extensionFrom50dAdr = sma50 > 0 && adr20 > 0 
      ? (quote.price - sma50) / adr20 
      : null;
    
    // Distance from MAs
    const distanceFromSma21 = ((quote.price - sma21) / sma21) * 100;
    const distanceFromSma50 = ((quote.price - sma50) / sma50) * 100;
    const distanceFromSma200 = ((quote.price - sma200) / sma200) * 100;

    return {
      symbol: symbol.toUpperCase(),
      currentPrice: quote.price,
      
      todayOpen: quote.open,
      todayHigh: quote.high,
      todayLow: quote.low,
      
      yesterdayHigh: yesterday.high,
      yesterdayLow: yesterday.low,
      yesterdayClose: yesterday.close,
      
      weeklyLow: weeklyRange.low,
      weeklyHigh: weeklyRange.high,
      
      fiveDayHigh,
      fiveDayLow,
      
      sma5,
      sma10,
      sma21,
      sma50,
      sma200,
      
      atr14,
      avgVolume20,
      
      baseBottom: base.bottom,
      baseTop: base.top,
      
      high52Week,
      low52Week,
      swingHighs,
      adr20,
      extensionFrom50dAdr,
      
      distanceFromSma21,
      distanceFromSma50,
      distanceFromSma200,
      
      fetchedAt: new Date(),
    };
  } catch (error) {
    console.error(`Failed to fetch technical data for ${symbol}:`, error);
    return null;
  }
}

// Fetch historical technical data for a specific past date
export async function fetchHistoricalTechnicalData(
  symbol: string, 
  targetDate: Date
): Promise<TechnicalData | null> {
  try {
    const dataLayerBars = await getDailyBars(symbol, 300);
    
    let allData: HistoricalQuote[];
    
    if (dataLayerBars && dataLayerBars.length >= 100) {
      allData = dataLayerBars.map(b => ({
        date: new Date(b.date),
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
      }));
    } else {
      const endDate = new Date(targetDate);
      endDate.setDate(endDate.getDate() + 1);
      const startDate = new Date(targetDate);
      startDate.setDate(startDate.getDate() - 300);
      
      const bars = await alpaca.fetchAlpacaDailyBars(symbol, startDate, endDate);
      
      allData = bars
        .map(b => ({
          date: new Date(b.date),
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
          volume: b.volume,
        }))
        .sort((a, b) => a.date.getTime() - b.date.getTime())
        .reverse();
    }
    
    // Find the target date index (or closest prior trading day)
    const targetTime = targetDate.getTime();
    let targetIndex = allData.findIndex(d => {
      const dTime = new Date(d.date).getTime();
      return dTime <= targetTime;
    });
    
    if (targetIndex === -1 || allData.length < 5) {
      console.error(`Insufficient historical data for ${symbol} on ${targetDate.toISOString()}`);
      return null;
    }
    
    // Slice from target date onwards (historical perspective)
    const historical = allData.slice(targetIndex);
    const targetDay = historical[0];
    const yesterday = historical[1] || historical[0];
    const closes = historical.map(c => c.close);
    
    // 5-day high/low from that perspective
    const last5 = historical.slice(0, 5);
    const fiveDayHigh = Math.max(...last5.map(c => c.high));
    const fiveDayLow = Math.min(...last5.map(c => c.low));
    
    // Weekly range - calculate from that date's week
    const targetDayOfWeek = new Date(targetDay.date).getDay();
    const daysFromMonday = targetDayOfWeek === 0 ? 6 : targetDayOfWeek - 1;
    const weekCandles = historical.slice(0, daysFromMonday + 1);
    const weeklyRange = weekCandles.length > 0 
      ? { low: Math.min(...weekCandles.map(c => c.low)), high: Math.max(...weekCandles.map(c => c.high)) }
      : { low: targetDay.low, high: targetDay.high };
    
    // Moving averages as of that date
    const sma5 = calculateSMA(closes, 5);
    const sma10 = calculateSMA(closes, 10);
    const sma21 = calculateSMA(closes, 21);
    const sma50 = calculateSMA(closes, 50);
    const sma200 = calculateSMA(closes, 200);
    
    // ATR as of that date
    const atr14 = calculateATR(historical, 14);
    
    // Average volume as of that date
    const volumes = historical.slice(0, 20).map(c => c.volume);
    const avgVolume20 = volumes.reduce((a, b) => a + b, 0) / volumes.length;
    
    // Base structure as of that date
    const base = findBaseStructure(historical);
    
    // Use close price as the "current" price for that historical date
    const priceOnDate = targetDay.close;
    
    // 52-week high/low as of that date
    const allHighs = historical.map(c => c.high);
    const allLows = historical.map(c => c.low);
    const high52Week = Math.max(...allHighs);
    const low52Week = Math.min(...allLows);
    
    // Swing highs
    const swingHighs = findSwingHighs(historical);
    
    // ADR
    const adr20 = calculateADR(historical, 20);
    const extensionFrom50dAdr = sma50 > 0 && adr20 > 0 
      ? (priceOnDate - sma50) / adr20 
      : null;
    
    // Distance from MAs
    const distanceFromSma21 = ((priceOnDate - sma21) / sma21) * 100;
    const distanceFromSma50 = ((priceOnDate - sma50) / sma50) * 100;
    const distanceFromSma200 = ((priceOnDate - sma200) / sma200) * 100;
    
    return {
      symbol: symbol.toUpperCase(),
      currentPrice: priceOnDate,
      
      todayOpen: targetDay.open,
      todayHigh: targetDay.high,
      todayLow: targetDay.low,
      
      yesterdayHigh: yesterday.high,
      yesterdayLow: yesterday.low,
      yesterdayClose: yesterday.close,
      
      weeklyLow: weeklyRange.low,
      weeklyHigh: weeklyRange.high,
      
      fiveDayHigh,
      fiveDayLow,
      
      sma5,
      sma10,
      sma21,
      sma50,
      sma200,
      
      atr14,
      avgVolume20,
      
      baseBottom: base.bottom,
      baseTop: base.top,
      
      high52Week,
      low52Week,
      swingHighs,
      adr20,
      extensionFrom50dAdr,
      
      distanceFromSma21,
      distanceFromSma50,
      distanceFromSma200,
      
      fetchedAt: targetDate,
    };
  } catch (error) {
    console.error(`Failed to fetch historical technical data for ${symbol} on ${targetDate}:`, error);
    return null;
  }
}

// Resolve level-based stop/target to actual price
export function resolveLevelPrice(
  level: string,
  technicals: TechnicalData,
  entryPrice: number,
  direction: 'long' | 'short'
): { price: number; description: string } | null {
  switch (level) {
    case "LOD_TODAY":
      return { price: technicals.todayLow, description: `LOD Today ($${technicals.todayLow.toFixed(2)})` };
    case "LOD_YESTERDAY":
      return { price: technicals.yesterdayLow, description: `LOD Yesterday ($${technicals.yesterdayLow.toFixed(2)})` };
    case "LOD_WEEKLY":
      return { price: technicals.weeklyLow, description: `Weekly Low ($${technicals.weeklyLow.toFixed(2)})` };
    case "5_DMA":
      return { price: technicals.sma5, description: `5 DMA ($${technicals.sma5.toFixed(2)})` };
    case "10_DMA":
      return { price: technicals.sma10, description: `10 DMA ($${technicals.sma10.toFixed(2)})` };
    case "21_DMA":
      return { price: technicals.sma21, description: `21 DMA ($${technicals.sma21.toFixed(2)})` };
    case "50_DMA":
      return { price: technicals.sma50, description: `50 DMA ($${technicals.sma50.toFixed(2)})` };
    case "PREV_DAY_HIGH":
      return { price: technicals.yesterdayHigh, description: `Previous Day High ($${technicals.yesterdayHigh.toFixed(2)})` };
    case "5_DAY_HIGH":
      return { price: technicals.fiveDayHigh, description: `5 Day High ($${technicals.fiveDayHigh.toFixed(2)})` };
    case "EXTENDED_8X_50DMA": {
      if (technicals.sma50 > 0 && technicals.adr20 > 0) {
        const targetPrice = technicals.sma50 + (technicals.adr20 * 8);
        return { price: targetPrice, description: `8x ADR above 50 DMA ($${targetPrice.toFixed(2)})` };
      }
      return null;
    }
    default:
      // Check for RR multipliers
      if (level.startsWith("RR_")) {
        const match = level.match(/RR_(\d+)X/);
        if (match) {
          const multiplier = parseInt(match[1]);
          // This needs stop price to calculate, return null to signal
          return null;
        }
      }
      return null;
  }
}

// Calculate RR-based target given entry and stop
export function calculateRRTarget(
  entryPrice: number,
  stopPrice: number,
  rrMultiplier: number,
  direction: 'long' | 'short'
): number {
  const riskAmount = Math.abs(entryPrice - stopPrice);
  const rewardAmount = riskAmount * rrMultiplier;
  
  return direction === 'long' 
    ? entryPrice + rewardAmount 
    : entryPrice - rewardAmount;
}

// Get a summary of MA structure
export function getMaStructureSummary(technicals: TechnicalData): string {
  const { currentPrice, sma21, sma50, sma200, distanceFromSma21, distanceFromSma50, distanceFromSma200 } = technicals;
  
  const parts: string[] = [];
  
  // Price relative to MAs
  if (currentPrice > sma21 && currentPrice > sma50 && currentPrice > sma200) {
    parts.push("Price above all major MAs (bullish structure)");
  } else if (currentPrice < sma21 && currentPrice < sma50 && currentPrice < sma200) {
    parts.push("Price below all major MAs (bearish structure)");
  } else {
    const above: string[] = [];
    const below: string[] = [];
    if (currentPrice > sma21) above.push("21"); else below.push("21");
    if (currentPrice > sma50) above.push("50"); else below.push("50");
    if (currentPrice > sma200) above.push("200"); else below.push("200");
    parts.push(`Price above ${above.join("/")} MA, below ${below.join("/")} MA`);
  }
  
  // MA stacking
  if (sma21 > sma50 && sma50 > sma200) {
    parts.push("MAs stacked bullish (21>50>200)");
  } else if (sma21 < sma50 && sma50 < sma200) {
    parts.push("MAs stacked bearish (21<50<200)");
  }
  
  // Distance from 21
  if (Math.abs(distanceFromSma21) < 3) {
    parts.push("Price near 21 MA (potential support/resistance)");
  } else if (distanceFromSma21 > 10) {
    parts.push(`Extended ${distanceFromSma21.toFixed(1)}% above 21 MA (potential pullback risk)`);
  } else if (distanceFromSma21 < -10) {
    parts.push(`Extended ${Math.abs(distanceFromSma21).toFixed(1)}% below 21 MA`);
  }
  
  return parts.join(". ");
}

// =============================================================================
// Key Levels (for MarketFlow Key Levels module and Chart AI)
// =============================================================================

export type KeyLevelType = "support" | "resistance" | "ma" | "vwap_anchor" | "gap";
export type KeyLevelSignificance = "major" | "moderate" | "minor";

export interface KeyLevel {
  price: number;
  type: KeyLevelType;
  label: string;
  significance: KeyLevelSignificance;
  distancePct: number;
  source: string;
}

/**
 * Get key price levels for a symbol (support, resistance, MAs, 52wk, swing highs).
 * Use for Key Levels module and Chart AI; do not recompute levels elsewhere.
 * Optional includeVolumeProfile returns simple volume-by-price nodes from daily bars.
 */
export async function getKeyLevels(
  symbol: string,
  options?: { includeVolumeProfile?: boolean }
): Promise<KeyLevel[]> {
  const technicals = await fetchTechnicalData(symbol);
  if (!technicals) return [];

  const price = technicals.currentPrice;
  const levels: KeyLevel[] = [];

  const add = (
    p: number,
    type: KeyLevelType,
    label: string,
    significance: KeyLevelSignificance,
    source: string
  ) => {
    const distancePct = price > 0 ? ((p - price) / price) * 100 : 0;
    levels.push({ price: p, type, label, significance, distancePct, source });
  };

  // 52-week high/low — major
  if (technicals.high52Week > 0) {
    add(technicals.high52Week, "resistance", "52W High", "major", "52-week");
  }
  if (technicals.low52Week > 0) {
    add(technicals.low52Week, "support", "52W Low", "major", "52-week");
  }

  // Swing highs (resistance)
  for (const sh of technicals.swingHighs.slice(0, 6)) {
    add(sh.price, "resistance", `Swing ${sh.daysAgo}d`, "moderate", "swing_high");
  }

  // Base top/bottom
  if (technicals.baseTop != null && technicals.baseTop > price) {
    add(technicals.baseTop, "resistance", "Base top", "moderate", "base");
  }
  if (technicals.baseBottom != null && technicals.baseBottom < price) {
    add(technicals.baseBottom, "support", "Base bottom", "moderate", "base");
  }

  // Moving averages
  if (technicals.sma200 > 0) {
    add(technicals.sma200, "ma", "200 SMA", technicals.distanceFromSma200 > 0 ? "moderate" : "major", "ma");
  }
  if (technicals.sma50 > 0) {
    add(technicals.sma50, "ma", "50 SMA", "moderate", "ma");
  }
  if (technicals.sma21 > 0) {
    add(technicals.sma21, "ma", "21 SMA", "moderate", "ma");
  }

  // Sort by price ascending so UI can render ladder
  levels.sort((a, b) => a.price - b.price);
  return levels;
}
