import yahooFinance from "yahoo-finance2";

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

export interface WeeklyTrend {
  state: 1 | 0 | -1;
  stateName: "Tailwind" | "Neutral" | "Headwind";
  confidence: "strong" | "moderate" | "weak";
  price: number;
  ma40w: number;
  maSlope: "rising" | "falling" | "flat";
}

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

export interface MarketSentiment {
  weekly: WeeklyTrend;
  daily: DailyBasket;
  summary: string;
  updatedAt: Date;
}

const RISK_BASKET = ["QQQ", "IWO", "SLY", "ARKK", "^VIX"];

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

async function fetchHistoricalPrices(symbol: string, days: number): Promise<number[]> {
  try {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days - 10);

    const result = await yahooFinance.historical(symbol, {
      period1: startDate,
      period2: endDate,
      interval: "1d",
    }) as Array<{ close: number }>;

    return result.map((d: { close: number }) => d.close).reverse();
  } catch (error) {
    console.error(`Failed to fetch ${symbol}:`, error);
    return [];
  }
}

async function fetchWeeklyPrices(symbol: string, weeks: number): Promise<number[]> {
  try {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - weeks * 7 - 30);

    const result = await yahooFinance.historical(symbol, {
      period1: startDate,
      period2: endDate,
      interval: "1wk",
    }) as Array<{ close: number }>;

    return result.map((d: { close: number }) => d.close).reverse();
  } catch (error) {
    console.error(`Failed to fetch weekly ${symbol}:`, error);
    return [];
  }
}

function classifyInstrument(
  symbol: string,
  price: number,
  ma20: number,
  ma20Slope: "rising" | "falling" | "flat"
): InstrumentTrend {
  const isVix = symbol === "^VIX";
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
  const vix = instruments["^VIX"];

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

async function fetchWeeklyTrend(): Promise<WeeklyTrend> {
  const prices = await fetchWeeklyPrices("SPY", 50);

  if (prices.length < 40) {
    return {
      state: 0,
      stateName: "Neutral",
      confidence: "weak",
      price: 0,
      ma40w: 0,
      maSlope: "flat",
    };
  }

  const price = prices[0];
  const ma40w = calculateMA(prices, 40);
  const maSlope = calculateSlope(prices, 40);

  let state: 1 | 0 | -1;
  let stateName: "Tailwind" | "Neutral" | "Headwind";

  if (price > ma40w && (maSlope === "rising" || maSlope === "flat")) {
    state = 1;
    stateName = "Tailwind";
  } else if (price < ma40w && maSlope === "falling") {
    state = -1;
    stateName = "Headwind";
  } else {
    state = 0;
    stateName = "Neutral";
  }

  const priceDistance = Math.abs((price - ma40w) / ma40w);
  let confidence: "strong" | "moderate" | "weak";
  if (priceDistance > 0.05) {
    confidence = "strong";
  } else if (priceDistance > 0.02) {
    confidence = "moderate";
  } else {
    confidence = "weak";
  }

  return { state, stateName, confidence, price, ma40w, maSlope };
}

export async function fetchMarketSentiment(): Promise<MarketSentiment> {
  const now = Date.now();
  if (sentimentCache.data && now - sentimentCache.fetchedAt < CACHE_DURATION) {
    return sentimentCache.data;
  }

  const [weekly, ...basketPrices] = await Promise.all([
    fetchWeeklyTrend(),
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
  if (weekly.state === 1 && daily.state === "RISK-ON") {
    summary = "Strong tailwinds across weekly structure and daily execution. Favorable for longs.";
  } else if (weekly.state === -1 && daily.state === "RISK-OFF") {
    summary = "Headwinds at both weekly and daily levels. Defensive positioning favored.";
  } else if (weekly.state === 1 && daily.state === "MIXED") {
    summary = "Weekly uptrend intact but daily mixed. Selective entries on pullbacks.";
  } else if (weekly.state === -1 && daily.state === "MIXED") {
    summary = "Weekly downtrend with choppy daily. Reduced exposure, quick profits.";
  } else {
    summary = "Market in transition. Prioritize quality setups with tight risk management.";
  }

  if (daily.canaryTags.length > 0) {
    summary += ` Warning: ${daily.canaryTags.join(", ")}.`;
  }

  const sentiment: MarketSentiment = {
    weekly,
    daily,
    summary,
    updatedAt: new Date(),
  };

  sentimentCache = { data: sentiment, fetchedAt: now };
  return sentiment;
}

export async function fetchSectorSentiment(symbol: string): Promise<SectorTrend | null> {
  try {
    const quote = await yahooFinance.quoteSummary(symbol, { modules: ["assetProfile"] }) as { assetProfile?: { sector?: string } };
    const sector = quote.assetProfile?.sector;

    if (!sector || !SECTOR_ETF_MAP[sector]) {
      const fallbackSector = Object.keys(SECTOR_ETF_MAP).find((s) =>
        sector?.toLowerCase().includes(s.toLowerCase())
      );
      if (!fallbackSector) {
        console.log(`No sector mapping for ${symbol} (sector: ${sector})`);
        return null;
      }
    }

    const sectorInfo = SECTOR_ETF_MAP[sector!] || SECTOR_ETF_MAP["Technology"];
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
    const end = new Date(endDate);
    end.setDate(end.getDate() + 1); // Include the target date
    const start = new Date(endDate);
    start.setDate(start.getDate() - days - 10);

    const result = await yahooFinance.historical(symbol, {
      period1: start,
      period2: end,
      interval: "1d",
    }) as Array<{ date: Date; close: number }>;

    // Sort by date descending (most recent first relative to endDate)
    const sorted = result.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return sorted.map((d) => d.close);
  } catch (error) {
    console.error(`Failed to fetch historical ${symbol} as of ${endDate}:`, error);
    return [];
  }
}

// Fetch weekly prices ending on a specific date
async function fetchWeeklyPricesAsOf(symbol: string, endDate: Date, weeks: number): Promise<number[]> {
  try {
    const end = new Date(endDate);
    end.setDate(end.getDate() + 7); // Buffer to include the week
    const start = new Date(endDate);
    start.setDate(start.getDate() - weeks * 7 - 30);

    const result = await yahooFinance.historical(symbol, {
      period1: start,
      period2: end,
      interval: "1wk",
    }) as Array<{ date: Date; close: number }>;

    // Filter to only weeks before or on the target date, then sort descending
    const targetTime = endDate.getTime();
    const filtered = result.filter(d => new Date(d.date).getTime() <= targetTime);
    const sorted = filtered.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return sorted.map((d) => d.close);
  } catch (error) {
    console.error(`Failed to fetch weekly historical ${symbol}:`, error);
    return [];
  }
}

// Fetch weekly trend as of a historical date
async function fetchWeeklyTrendAsOf(targetDate: Date): Promise<WeeklyTrend> {
  const prices = await fetchWeeklyPricesAsOf("SPY", targetDate, 50);

  if (prices.length < 40) {
    return {
      state: 0,
      stateName: "Neutral",
      confidence: "weak",
      price: 0,
      ma40w: 0,
      maSlope: "flat",
    };
  }

  const price = prices[0];
  const ma40w = calculateMA(prices, 40);
  const maSlope = calculateSlope(prices, 40);

  let state: 1 | 0 | -1;
  let stateName: "Tailwind" | "Neutral" | "Headwind";

  if (price > ma40w && (maSlope === "rising" || maSlope === "flat")) {
    state = 1;
    stateName = "Tailwind";
  } else if (price < ma40w && maSlope === "falling") {
    state = -1;
    stateName = "Headwind";
  } else {
    state = 0;
    stateName = "Neutral";
  }

  const priceDistance = Math.abs((price - ma40w) / ma40w);
  let confidence: "strong" | "moderate" | "weak";
  if (priceDistance > 0.05) {
    confidence = "strong";
  } else if (priceDistance > 0.02) {
    confidence = "moderate";
  } else {
    confidence = "weak";
  }

  return { state, stateName, confidence, price, ma40w, maSlope };
}

// Fetch market sentiment as of a historical date
export async function fetchHistoricalMarketSentiment(targetDate: Date): Promise<MarketSentiment> {
  const [weekly, ...basketPrices] = await Promise.all([
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
  if (weekly.state === 1 && daily.state === "RISK-ON") {
    summary = "Strong tailwinds across weekly structure and daily execution. Favorable for longs.";
  } else if (weekly.state === -1 && daily.state === "RISK-OFF") {
    summary = "Headwinds at both weekly and daily levels. Defensive positioning favored.";
  } else if (weekly.state === 1 && daily.state === "MIXED") {
    summary = "Weekly uptrend intact but daily mixed. Selective entries on pullbacks.";
  } else if (weekly.state === -1 && daily.state === "MIXED") {
    summary = "Weekly downtrend with choppy daily. Reduced exposure, quick profits.";
  } else {
    summary = "Market in transition. Prioritize quality setups with tight risk management.";
  }

  if (daily.canaryTags.length > 0) {
    summary += ` Warning: ${daily.canaryTags.join(", ")}.`;
  }

  return {
    weekly,
    daily,
    summary,
    updatedAt: targetDate,
  };
}

// Fetch sector sentiment as of a historical date
export async function fetchHistoricalSectorSentiment(symbol: string, targetDate: Date): Promise<SectorTrend | null> {
  try {
    const quote = await yahooFinance.quoteSummary(symbol, { modules: ["assetProfile"] }) as { assetProfile?: { sector?: string } };
    const sector = quote.assetProfile?.sector;

    if (!sector || !SECTOR_ETF_MAP[sector]) {
      const fallbackSector = Object.keys(SECTOR_ETF_MAP).find((s) =>
        sector?.toLowerCase().includes(s.toLowerCase())
      );
      if (!fallbackSector) {
        console.log(`No sector mapping for ${symbol} (sector: ${sector})`);
        return null;
      }
    }

    const sectorInfo = SECTOR_ETF_MAP[sector!] || SECTOR_ETF_MAP["Technology"];
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
