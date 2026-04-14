/**
 * Universe Master Definitions - Theme Rotation Dashboard v2
 * 
 * This is the SINGLE SOURCE OF TRUTH for the Market Condition Terminal.
 * 
 * Rules:
 * - One ticker → one Primary Cluster (no double-counting for ThemeScore)
 * - Overlays are non-competing factors (ticker can be in cluster AND overlay)
 * - Leaders are dynamic subset with hybrid scoring (momentum + volatility discipline)
 * - 26 Primary Behavior Clusters + 5 Overlays
 */

import { normalizeWatchlistSymbol, sectorSpdrThemeLabel } from "@shared/watchlist-theme";

// =============================================================================
// Type Definitions
// =============================================================================

export type ClusterTier = "Macro" | "Structural" | "Narrative";

export type ClusterId =
  // Structural (12)
  | "SEMIS"
  | "AI_INFRA"
  | "STORAGE"
  | "ENTERPRISE_SOFT"
  | "CYBER"
  | "FIBER_OPTICAL"
  | "DATA_CENTER_REITS"
  | "INDUSTRIAL_INFRA"
  | "DEFENSE"
  | "FINANCIAL_CORE"
  | "PAYMENTS_FINTECH"
  | "ENERGY"
  // Macro (6)
  | "CONSUMER_DISC"
  | "CONSUMER_STAPLES"
  | "HEALTHCARE"
  | "MATERIALS_METALS"
  | "TRANSPORTS"
  | "HOMEBUILDERS"
  // Narrative (8)
  | "CRYPTO_EQ"
  | "NUCLEAR_URANIUM"
  | "SPACE_FRONTIER"
  | "QUANTUM"
  | "RARE_EARTH"
  | "PRECIOUS_METALS"
  | "BIOTECH"
  | "SOLAR"
  | "GAMING_CASINOS"
  | "HOSPITALITY_LEISURE";

export type OverlayId =
  | "MEGA_OVERLAY"
  | "MEMORY_OVERLAY"
  | "YIELD_OVERLAY"
  | "HIGH_BETA_OVERLAY"
  | "SMALL_CAP_OVERLAY";

// Time slice options for multi-timeframe analysis
export type TimeSlice = "TODAY" | "15M" | "30M" | "1H" | "4H" | "1D" | "5D" | "10D" | "1W" | "1M" | "3M" | "6M" | "YTD";

// Size filter options with ETF benchmarks
export type SizeFilter = "ALL" | "MEGA" | "LARGE" | "MID" | "SMALL" | "MICRO";

// ETF proxy types per theme
export type ETFProxyType = "direct" | "adjacent" | "macro" | "hedge" | "inverse" | "leveraged";

export interface ETFProxy {
  symbol: string;
  name: string;
  proxyType: ETFProxyType;
}

export interface ClusterDefinition {
  id: ClusterId;
  name: string;
  tier: ClusterTier;
  leadersTarget: number;
  core: string[];        // Always included, admin-curated
  candidates: string[];  // Eligible pool for leader selection
  etfProxies: ETFProxy[]; // ETF proxies for this theme
  notes: string;
}

export interface OverlayDefinition {
  id: OverlayId;
  name: string;
  rule: string;
  defaultTickers?: string[];
}

// Size filter benchmark mappings
export const SIZE_FILTER_BENCHMARKS: Record<SizeFilter, string> = {
  ALL: "SPY",
  MEGA: "MGK",
  LARGE: "SPY",
  MID: "MDY",
  SMALL: "IWM",
  MICRO: "IWC",
};

// Time slice configurations
export const TIME_SLICE_CONFIG: Record<TimeSlice, { days: number; label: string }> = {
  "TODAY": { days: 0, label: "Today (Live)" },
  "15M": { days: 0, label: "15 Minutes" },
  "30M": { days: 0, label: "30 Minutes" },
  "1H": { days: 0, label: "1 Hour" },
  "4H": { days: 0, label: "4 Hours" },
  "1D": { days: 1, label: "vs Yesterday" },
  "5D": { days: 5, label: "5 Days" },
  "10D": { days: 10, label: "10 Days" },
  "1W": { days: 5, label: "1 Week" },
  "1M": { days: 21, label: "1 Month" },
  "3M": { days: 63, label: "3 Months" },
  "6M": { days: 126, label: "6 Months" },
  "YTD": { days: -1, label: "Year to Date" }, // -1 = calculate from Jan 1
};

// =============================================================================
// Cadence Configuration (defaults, can be overridden by admin)
// =============================================================================

export const DEFAULT_CADENCE = {
  snapshotPollingMs: 60000,       // 1 minute during market hours
  offHoursPollingMs: 5 * 60000,   // 5 minutes outside market hours
  leadersRefreshMs: 45 * 60000,   // 45 minutes
  dailyRebuildTime: "20:30",      // 20:30 ET
  intradayBarsRefreshMs: 10 * 60000, // 10 minutes for leaders
};

// Market hours (Eastern Time)
export const MARKET_HOURS = {
  openHour: 9,
  openMinute: 30,
  closeHour: 16,
  closeMinute: 0,
  afterHoursEndHour: 20,
  afterHoursEndMinute: 0,
  timezone: "America/New_York",
};

/**
 * Market session types
 */
export type MarketSession = "MARKET_HOURS" | "AFTER_HOURS" | "CLOSED";

/**
 * Check if we're currently in market hours
 * Returns true between 9:30 AM and 4:00 PM ET on weekdays
 */
export function isMarketHours(): boolean {
  const now = new Date();
  
  // Convert to Eastern Time
  const etTime = new Date(now.toLocaleString("en-US", { timeZone: MARKET_HOURS.timezone }));
  const day = etTime.getDay(); // 0 = Sunday, 6 = Saturday
  
  // Weekend check
  if (day === 0 || day === 6) {
    return false;
  }
  
  const hours = etTime.getHours();
  const minutes = etTime.getMinutes();
  const currentMinutes = hours * 60 + minutes;
  
  const openMinutes = MARKET_HOURS.openHour * 60 + MARKET_HOURS.openMinute;
  const closeMinutes = MARKET_HOURS.closeHour * 60 + MARKET_HOURS.closeMinute;
  
  return currentMinutes >= openMinutes && currentMinutes < closeMinutes;
}

/**
 * Get the current market session
 * Returns MARKET_HOURS (9:30 AM - 4:00 PM), AFTER_HOURS (4:00 PM - 8:00 PM), or CLOSED
 */
export function getMarketSession(): MarketSession {
  const now = new Date();
  
  // Convert to Eastern Time
  const etTime = new Date(now.toLocaleString("en-US", { timeZone: MARKET_HOURS.timezone }));
  const day = etTime.getDay(); // 0 = Sunday, 6 = Saturday
  
  // Weekend = always closed
  if (day === 0 || day === 6) {
    return "CLOSED";
  }
  
  const hours = etTime.getHours();
  const minutes = etTime.getMinutes();
  const currentMinutes = hours * 60 + minutes;
  
  const openMinutes = MARKET_HOURS.openHour * 60 + MARKET_HOURS.openMinute;
  const closeMinutes = MARKET_HOURS.closeHour * 60 + MARKET_HOURS.closeMinute;
  const afterHoursEndMinutes = MARKET_HOURS.afterHoursEndHour * 60 + MARKET_HOURS.afterHoursEndMinute;
  
  // Market hours: 9:30 AM - 4:00 PM
  if (currentMinutes >= openMinutes && currentMinutes < closeMinutes) {
    return "MARKET_HOURS";
  }
  
  // After hours: 4:00 PM - 8:00 PM
  if (currentMinutes >= closeMinutes && currentMinutes < afterHoursEndMinutes) {
    return "AFTER_HOURS";
  }
  
  // Outside all trading hours
  return "CLOSED";
}

/**
 * Get the appropriate polling interval based on market hours
 */
export function getPollingInterval(): number {
  return isMarketHours() ? DEFAULT_CADENCE.snapshotPollingMs : DEFAULT_CADENCE.offHoursPollingMs;
}

// =============================================================================
// Leader Eligibility & Scoring Rules (Hybrid Model)
// =============================================================================

export const LEADER_RULES = {
  // Eligibility
  minPrice: 3,                    // Price >= $3
  minAvgDollarVolume: 20_000_000, // 20D avg dollar volume >= $20M
  excludeHalted: true,

  // RawScore weights (must sum to 100)
  weights: {
    rsVsSpy30d: 35,         // 30-day relative performance vs SPY
    rsVsCluster: 25,        // Performance minus cluster mean
    volumeExpansion: 20,    // 30d avg vol ÷ 90d avg vol
    emaAcceleration: 10,    // slope(20EMA) − slope(50EMA)
    trendStructure: 10,     // 1 if above 21/50/200, 0.5 partial, 0 broken
  },

  // Volatility Adjustment
  // AdjustedScore = RawScore ÷ (1 + VolatilityRank × 0.5)
  volatilityPenaltyFactor: 0.5,

  // Leader Classifications
  activeLeader: {
    percentileThreshold: 75,      // Top 25% by AdjustedScore
    consecutiveDays: 5,           // Must qualify for 5 consecutive days
    maxPerCluster: 5,             // Max 3-5 per cluster
    requireAbove21DMA: true,
    requirePositiveRsVsSpy: true,
  },
  emergingLeader: {
    percentileThreshold: 60,      // Top 40% RawScore
    volumeExpansionMin: 1.3,      // Volume expansion > 1.3
    statusDurationDays: 10,       // Status lasts 10 days unless promoted/invalidated
  },
  fadingLeader: {
    percentileDropTo: 50,         // AdjustedScore drops below 50th percentile
    dmaLossDays: 3,               // OR loses 21DMA for 3 closes
    drawdownThreshold: 0.15,      // OR drawdown > 15% from 30d high
  },

  // Stability Rules
  promotionCooldownDays: 10,      // 10 trading days between promotions
  demotionCooldownDays: 5,        // 5 trading days between demotions
  maxTurnoverPer30Days: 0.40,     // Max 40% leader rotation per cluster per 30 days
};

// =============================================================================
// ThemeScore Weights (Updated Formula)
// =============================================================================

export const THEME_SCORE_WEIGHTS = {
  pct: 40,          // Percentile rank of median member return
  breadth: 20,      // %Above50 + %Above200 weighted
  rs: 20,           // Median relative strength vs benchmark
  acceleration: 20, // RS_now - RS_previous
};

// Narrow leadership penalty configuration
export const NARROW_LEADERSHIP_CONFIG = {
  thresholdStart: 0.70,   // Start penalizing at 70% top3 contribution
  thresholdEnd: 0.90,     // Max penalty at 90%
  maxPenalty: 0.15,       // Max 15% penalty (multiplier goes to 0.85)
};

// =============================================================================
// 26 Behavior Clusters
// =============================================================================

export const CLUSTERS: ClusterDefinition[] = [
  // -------------------------------------------------------------------------
  // STRUCTURAL TIER (12 clusters)
  // -------------------------------------------------------------------------
  {
    id: "SEMIS",
    name: "Semiconductors",
    tier: "Structural",
    leadersTarget: 5,
    core: ["NVDA", "AMD", "AVGO", "ARM", "TSM", "ASML", "AMAT", "LRCX", "KLAC", "MU", "MRVL", "NXPI", "ON", "ADI", "TXN", "QCOM", "INTC", "MCHP", "MPWR", "SWKS", "QRVO", "TER", "STM"],
    candidates: ["CRUS", "WOLF", "ALGM", "AMKR", "COHU"],
    etfProxies: [
      { symbol: "SMH", name: "VanEck Semiconductor ETF", proxyType: "direct" },
      { symbol: "SOXX", name: "iShares Semiconductor ETF", proxyType: "direct" },
      { symbol: "XLK", name: "Technology Select SPDR", proxyType: "adjacent" },
      { symbol: "QQQ", name: "Invesco QQQ Trust", proxyType: "macro" },
      { symbol: "SOXS", name: "Direxion Daily Semiconductor Bear 3X", proxyType: "inverse" },
      { symbol: "SSG", name: "ProShares UltraShort Semiconductors", proxyType: "inverse" },
      { symbol: "SOXL", name: "Direxion Daily Semiconductor Bull 3X", proxyType: "leveraged" },
      { symbol: "USD", name: "ProShares Ultra Semiconductors 2X", proxyType: "leveraged" },
    ],
    notes: "Logic, Foundry, Equipment, Analog. High-beta capex & cycle leadership.",
  },
  {
    id: "AI_INFRA",
    name: "AI Infrastructure",
    tier: "Structural",
    leadersTarget: 5,
    core: ["ANET", "SMCI", "DELL", "HPE", "CSCO", "VRT", "ETN", "HUBB", "CARR", "JCI", "TT", "GNRC", "PWR", "ABB", "EMR", "FLR", "CLS"],
    candidates: ["POWL", "AYI", "NVT", "APH", "TEL", "FLEX"],
    etfProxies: [
      { symbol: "AIIQ", name: "Global X AI & Technology ETF", proxyType: "direct" },
      { symbol: "BOTZ", name: "Global X Robotics & AI ETF", proxyType: "adjacent" },
      { symbol: "XLI", name: "Industrial Select SPDR", proxyType: "macro" },
      { symbol: "XLU", name: "Utilities Select SPDR", proxyType: "hedge" },
      { symbol: "TECS", name: "Direxion Daily Technology Bear 3X", proxyType: "inverse" },
      { symbol: "TECL", name: "Direxion Daily Technology Bull 3X", proxyType: "leveraged" },
    ],
    notes: "Servers, Networking, Power, Cooling. Data center buildout beneficiaries.",
  },
  {
    id: "STORAGE",
    name: "Storage / Data Infrastructure",
    tier: "Structural",
    leadersTarget: 3,
    core: ["WDC", "STX", "PSTG", "NTAP"],
    candidates: ["NTNX", "BOX", "DBX", "NEWR"],
    etfProxies: [
      { symbol: "CLOU", name: "Global X Cloud Computing ETF", proxyType: "adjacent" },
      { symbol: "XLK", name: "Technology Select SPDR", proxyType: "macro" },
      { symbol: "TECS", name: "Direxion Daily Technology Bear 3X", proxyType: "inverse" },
      { symbol: "TECL", name: "Direxion Daily Technology Bull 3X", proxyType: "leveraged" },
    ],
    notes: "Storage separated from AI Infra for purity.",
  },
  {
    id: "ENTERPRISE_SOFT",
    name: "Enterprise Software",
    tier: "Structural",
    leadersTarget: 5,
    core: ["MSFT", "CRM", "ORCL", "NOW", "ADBE", "INTU", "WDAY", "ADSK", "VEEV", "TEAM", "SNOW", "DDOG", "MDB", "NET", "HUBS", "SHOP", "ESTC", "IBM"],
    candidates: ["ZM", "DOCU", "TWLO", "OKTA", "ZI", "BILL", "PCOR", "MNDY"],
    etfProxies: [
      { symbol: "IGV", name: "iShares Software ETF", proxyType: "direct" },
      { symbol: "WCLD", name: "WisdomTree Cloud Computing ETF", proxyType: "direct" },
      { symbol: "XLK", name: "Technology Select SPDR", proxyType: "macro" },
      { symbol: "XLP", name: "Consumer Staples SPDR", proxyType: "hedge" },
      { symbol: "TECS", name: "Direxion Daily Technology Bear 3X", proxyType: "inverse" },
      { symbol: "TECL", name: "Direxion Daily Technology Bull 3X", proxyType: "leveraged" },
    ],
    notes: "Recurring-revenue sponsorship. SaaS and enterprise cloud.",
  },
  {
    id: "CYBER",
    name: "Cybersecurity",
    tier: "Structural",
    leadersTarget: 4,
    core: ["PANW", "CRWD", "FTNT", "ZS", "S", "CHKP", "TENB", "CYBR", "VRNS", "QLYS"],
    candidates: ["RPD", "AKAM", "FEYE", "SAIL"],
    etfProxies: [
      { symbol: "CIBR", name: "First Trust Cybersecurity ETF", proxyType: "direct" },
      { symbol: "HACK", name: "ETFMG Prime Cyber Security ETF", proxyType: "direct" },
      { symbol: "XLK", name: "Technology Select SPDR", proxyType: "macro" },
      { symbol: "TECS", name: "Direxion Daily Technology Bear 3X", proxyType: "inverse" },
      { symbol: "TECL", name: "Direxion Daily Technology Bull 3X", proxyType: "leveraged" },
    ],
    notes: "Security trades as its own behavior cluster.",
  },
  {
    id: "FIBER_OPTICAL",
    name: "Fiber / Optical / Connectivity",
    tier: "Structural",
    leadersTarget: 4,
    core: ["LITE", "CIEN", "FN", "GLW", "CALX", "VIAV", "AAOI", "INFN"],
    candidates: ["COHR", "IIVI", "COMM"],
    etfProxies: [
      { symbol: "FIVG", name: "Defiance Next Gen Connectivity ETF", proxyType: "direct" },
      { symbol: "XLC", name: "Communication Services SPDR", proxyType: "macro" },
      { symbol: "TECS", name: "Direxion Daily Technology Bear 3X", proxyType: "inverse" },
      { symbol: "TECL", name: "Direxion Daily Technology Bull 3X", proxyType: "leveraged" },
    ],
    notes: "Early-cycle signal cluster. GLW primary here.",
  },
  {
    id: "DATA_CENTER_REITS",
    name: "Data Center / Tower REITs",
    tier: "Structural",
    leadersTarget: 4,
    core: ["EQIX", "DLR", "AMT", "CCI", "SBAC", "IRM", "PLD"],
    candidates: ["CONE", "QTS", "UNIT"],
    etfProxies: [
      { symbol: "VNQ", name: "Vanguard Real Estate ETF", proxyType: "adjacent" },
      { symbol: "XLRE", name: "Real Estate Select SPDR", proxyType: "macro" },
      { symbol: "TLT", name: "iShares 20+ Year Treasury", proxyType: "hedge" },
      { symbol: "SRS", name: "ProShares UltraShort Real Estate", proxyType: "inverse" },
      { symbol: "DRV", name: "Direxion Daily Real Estate Bear 3X", proxyType: "inverse" },
      { symbol: "DRN", name: "Direxion Daily Real Estate Bull 3X", proxyType: "leveraged" },
    ],
    notes: "Yield/infra hybrid behavior; useful for regime context.",
  },
  {
    id: "INDUSTRIAL_INFRA",
    name: "Industrial Infrastructure",
    tier: "Structural",
    leadersTarget: 5,
    core: ["CAT", "DE", "HON", "PH", "URI", "CMI", "ROK", "ITW", "DOV", "FAST", "XYL", "IR", "OTIS"],
    candidates: ["GE", "MMM", "GWW", "WSO", "TRMB", "AME", "NDSN"],
    etfProxies: [
      { symbol: "XLI", name: "Industrial Select SPDR", proxyType: "direct" },
      { symbol: "VIS", name: "Vanguard Industrials ETF", proxyType: "direct" },
      { symbol: "SPY", name: "SPDR S&P 500 ETF", proxyType: "macro" },
      { symbol: "SQQQ", name: "ProShares UltraPro Short QQQ", proxyType: "inverse" },
      { symbol: "TQQQ", name: "ProShares UltraPro QQQ 3X", proxyType: "leveraged" },
      { symbol: "SPXU", name: "ProShares UltraPro Short S&P 500", proxyType: "inverse" },
      { symbol: "UPRO", name: "ProShares UltraPro S&P 500 3X", proxyType: "leveraged" },
    ],
    notes: "Cyclical capex leadership; distinct from energy/financials.",
  },
  {
    id: "DEFENSE",
    name: "Defense Primes",
    tier: "Structural",
    leadersTarget: 4,
    core: ["LMT", "RTX", "NOC", "GD", "LHX", "HII", "TDY", "HEI"],
    candidates: ["BA", "LDOS", "KTOS", "PLTR"],
    etfProxies: [
      { symbol: "ITA", name: "iShares U.S. Aerospace & Defense ETF", proxyType: "direct" },
      { symbol: "XAR", name: "SPDR S&P Aerospace & Defense ETF", proxyType: "direct" },
      { symbol: "XLI", name: "Industrial Select SPDR", proxyType: "macro" },
      { symbol: "DFEN", name: "Direxion Daily Aerospace & Defense Bull 3X", proxyType: "leveraged" },
    ],
    notes: "Steady sponsorship; tends to hold in risk-off.",
  },
  {
    id: "FINANCIAL_CORE",
    name: "Financial Core",
    tier: "Structural",
    leadersTarget: 5,
    core: ["JPM", "BAC", "WFC", "C", "GS", "MS", "BLK", "SCHW", "AXP", "CME", "ICE", "SPGI", "MCO"],
    candidates: ["PGR", "TRV", "ALL", "MET", "PRU", "USB", "PNC", "TFC", "FITB", "KEY"],
    etfProxies: [
      { symbol: "XLF", name: "Financial Select SPDR", proxyType: "direct" },
      { symbol: "KBE", name: "SPDR S&P Bank ETF", proxyType: "direct" },
      { symbol: "KRE", name: "SPDR S&P Regional Banking ETF", proxyType: "adjacent" },
      { symbol: "TLT", name: "iShares 20+ Year Treasury", proxyType: "hedge" },
      { symbol: "FAZ", name: "Direxion Daily Financial Bear 3X", proxyType: "inverse" },
      { symbol: "SKF", name: "ProShares UltraShort Financials", proxyType: "inverse" },
      { symbol: "FAS", name: "Direxion Daily Financial Bull 3X", proxyType: "leveraged" },
      { symbol: "UYG", name: "ProShares Ultra Financials 2X", proxyType: "leveraged" },
    ],
    notes: "Liquidity/yield regime read; core rotation engine.",
  },
  {
    id: "PAYMENTS_FINTECH",
    name: "Payments / FinTech",
    tier: "Structural",
    leadersTarget: 4,
    core: ["V", "MA", "PYPL", "SQ", "AFRM", "HOOD", "SOFI", "FIS", "FI"],
    candidates: ["GPN", "FOUR", "DFS", "COF", "SYF"],
    etfProxies: [
      { symbol: "IPAY", name: "ETFMG Prime Mobile Payments ETF", proxyType: "direct" },
      { symbol: "FINX", name: "Global X FinTech ETF", proxyType: "direct" },
      { symbol: "XLF", name: "Financial Select SPDR", proxyType: "macro" },
      { symbol: "FAZ", name: "Direxion Daily Financial Bear 3X", proxyType: "inverse" },
      { symbol: "FAS", name: "Direxion Daily Financial Bull 3X", proxyType: "leveraged" },
    ],
    notes: "Higher-beta financial behavior from core banks/exchanges.",
  },
  {
    id: "ENERGY",
    name: "Energy",
    tier: "Structural",
    leadersTarget: 5,
    core: ["XOM", "CVX", "COP", "EOG", "OXY", "DVN", "FANG", "SLB", "HAL", "MPC", "VLO", "BKR"],
    candidates: ["EQT", "AR", "KMI", "WMB", "OKE", "TRGP", "PSX", "LNG", "PXD", "HES"],
    etfProxies: [
      { symbol: "XLE", name: "Energy Select SPDR", proxyType: "direct" },
      { symbol: "XOP", name: "SPDR S&P Oil & Gas E&P ETF", proxyType: "direct" },
      { symbol: "OIH", name: "VanEck Oil Services ETF", proxyType: "adjacent" },
      { symbol: "USO", name: "United States Oil Fund", proxyType: "macro" },
      { symbol: "ERY", name: "Direxion Daily Energy Bear 2X", proxyType: "inverse" },
      { symbol: "DUG", name: "ProShares UltraShort Oil & Gas", proxyType: "inverse" },
      { symbol: "ERX", name: "Direxion Daily Energy Bull 2X", proxyType: "leveraged" },
      { symbol: "DIG", name: "ProShares Ultra Oil & Gas 2X", proxyType: "leveraged" },
    ],
    notes: "Commodity beta behavior. Oil, gas, services.",
  },

  // -------------------------------------------------------------------------
  // MACRO TIER (6 clusters)
  // -------------------------------------------------------------------------
  {
    id: "CONSUMER_DISC",
    name: "Consumer Discretionary",
    tier: "Macro",
    leadersTarget: 5,
    core: ["AMZN", "TSLA", "HD", "LOW", "NKE", "SBUX", "CMG", "BKNG", "ABNB", "TJX", "DKNG", "RCL", "CCL"],
    candidates: ["MCD", "LULU", "ROST", "DG", "DLTR", "YUM", "MAR", "HLT", "EXPE", "LVS", "WYNN", "MGM"],
    etfProxies: [
      { symbol: "XLY", name: "Consumer Discretionary SPDR", proxyType: "direct" },
      { symbol: "VCR", name: "Vanguard Consumer Discretionary ETF", proxyType: "direct" },
      { symbol: "RTH", name: "VanEck Retail ETF", proxyType: "adjacent" },
      { symbol: "XLP", name: "Consumer Staples SPDR", proxyType: "hedge" },
      { symbol: "SCC", name: "ProShares UltraShort Consumer Services", proxyType: "inverse" },
      { symbol: "UCC", name: "ProShares Ultra Consumer Services 2X", proxyType: "leveraged" },
    ],
    notes: "Risk-on consumer complex. Retail, travel, leisure.",
  },
  {
    id: "CONSUMER_STAPLES",
    name: "Consumer Staples",
    tier: "Macro",
    leadersTarget: 4,
    core: ["PG", "KO", "PEP", "WMT", "COST", "CL", "MO", "PM", "MDLZ", "GIS", "KR"],
    candidates: ["HSY", "SJM", "K", "CAG", "CPB", "CHD"],
    etfProxies: [
      { symbol: "XLP", name: "Consumer Staples SPDR", proxyType: "direct" },
      { symbol: "VDC", name: "Vanguard Consumer Staples ETF", proxyType: "direct" },
      { symbol: "XLY", name: "Consumer Discretionary SPDR", proxyType: "hedge" },
      { symbol: "SZK", name: "ProShares UltraShort Consumer Goods", proxyType: "inverse" },
      { symbol: "UGE", name: "ProShares Ultra Consumer Goods 2X", proxyType: "leveraged" },
    ],
    notes: "Defensive rotation cluster. Steady earners.",
  },
  {
    id: "HEALTHCARE",
    name: "Healthcare",
    tier: "Macro",
    leadersTarget: 5,
    core: ["UNH", "LLY", "JNJ", "ABBV", "MRK", "TMO", "DHR", "ISRG", "AMGN", "BMY", "GILD", "PFE", "CVS", "CI", "HUM", "ELV", "MDT", "SYK", "ABT", "ZTS"],
    candidates: ["BSX", "BDX", "EW", "DXCM", "IDXX", "A", "IQV", "HOLX"],
    etfProxies: [
      { symbol: "XLV", name: "Health Care Select SPDR", proxyType: "direct" },
      { symbol: "VHT", name: "Vanguard Health Care ETF", proxyType: "direct" },
      { symbol: "IHI", name: "iShares Medical Devices ETF", proxyType: "adjacent" },
      { symbol: "XLP", name: "Consumer Staples SPDR", proxyType: "hedge" },
      { symbol: "RXD", name: "ProShares UltraShort Health Care", proxyType: "inverse" },
      { symbol: "RXL", name: "ProShares Ultra Health Care 2X", proxyType: "leveraged" },
    ],
    notes: "Core defensive healthcare. Managed care, pharma, devices.",
  },
  {
    id: "MATERIALS_METALS",
    name: "Materials / Industrial Metals",
    tier: "Macro",
    leadersTarget: 4,
    core: ["FCX", "NUE", "STLD", "AA", "LIN", "APD", "ECL", "BHP", "RIO", "VALE"],
    candidates: ["CLF", "X", "TECK", "SCCO", "RS", "ATI"],
    etfProxies: [
      { symbol: "XLB", name: "Materials Select SPDR", proxyType: "direct" },
      { symbol: "XME", name: "SPDR S&P Metals & Mining ETF", proxyType: "direct" },
      { symbol: "COPX", name: "Global X Copper Miners ETF", proxyType: "adjacent" },
      { symbol: "GLD", name: "SPDR Gold Shares", proxyType: "hedge" },
      { symbol: "SMN", name: "ProShares UltraShort Basic Materials", proxyType: "inverse" },
      { symbol: "UYM", name: "ProShares Ultra Basic Materials 2X", proxyType: "leveraged" },
    ],
    notes: "Industrial metals and materials. Precious metals separated.",
  },
  {
    id: "TRANSPORTS",
    name: "Transports",
    tier: "Macro",
    leadersTarget: 5,
    core: ["UNP", "CSX", "NSC", "CP", "CNI", "DAL", "UAL", "LUV", "FDX", "UPS", "ODFL", "SAIA", "XPO", "JBHT", "KNX", "CHRW", "EXPD", "WAB"],
    candidates: ["AAL", "ALK", "JBLU", "WERN", "GBX", "MATX", "KEX"],
    etfProxies: [
      { symbol: "IYT", name: "iShares Transportation Average ETF", proxyType: "direct" },
      { symbol: "XTN", name: "SPDR S&P Transportation ETF", proxyType: "direct" },
      { symbol: "JETS", name: "U.S. Global Jets ETF", proxyType: "adjacent" },
      { symbol: "XLI", name: "Industrial Select SPDR", proxyType: "macro" },
      { symbol: "TPOR", name: "Direxion Daily Transportation Bull 3X", proxyType: "leveraged" },
    ],
    notes: "Dow Theory transports. Rails, airlines, trucking, logistics.",
  },
  {
    id: "HOMEBUILDERS",
    name: "Homebuilders",
    tier: "Macro",
    leadersTarget: 4,
    core: ["DHI", "LEN", "PHM", "TOL", "NVR", "KBH", "MDC", "BZH", "TPH", "TMHC", "MTH"],
    candidates: ["GRBK", "CCS", "LGIH", "MHO", "HOV", "CVCO"],
    etfProxies: [
      { symbol: "XHB", name: "SPDR S&P Homebuilders ETF", proxyType: "direct" },
      { symbol: "ITB", name: "iShares U.S. Home Construction ETF", proxyType: "direct" },
      { symbol: "XLY", name: "Consumer Discretionary SPDR", proxyType: "adjacent" },
      { symbol: "TLT", name: "iShares 20+ Year Treasury", proxyType: "hedge" },
      { symbol: "SRS", name: "ProShares UltraShort Real Estate", proxyType: "inverse" },
      { symbol: "DRN", name: "Direxion Daily Real Estate Bull 3X", proxyType: "leveraged" },
    ],
    notes: "Housing cycle leadership. Highly rate-sensitive. HD/LOW are adjacent (home improvement retail), not core.",
  },

  // -------------------------------------------------------------------------
  // NARRATIVE TIER (8 clusters)
  // -------------------------------------------------------------------------
  {
    id: "CRYPTO_EQ",
    name: "Crypto Equities",
    tier: "Narrative",
    leadersTarget: 4,
    core: ["COIN", "MSTR", "MARA", "RIOT", "CLSK", "HUT", "IREN", "IBIT", "BITO"],
    candidates: ["GBTC", "ETHE", "CIFR", "BTBT"],
    etfProxies: [
      { symbol: "IBIT", name: "iShares Bitcoin Trust", proxyType: "direct" },
      { symbol: "BITO", name: "ProShares Bitcoin Strategy ETF", proxyType: "direct" },
      { symbol: "ARKK", name: "ARK Innovation ETF", proxyType: "adjacent" },
      { symbol: "GLD", name: "SPDR Gold Shares", proxyType: "hedge" },
      { symbol: "BITI", name: "ProShares Short Bitcoin Strategy ETF", proxyType: "inverse" },
      { symbol: "BITX", name: "Volatility Shares 2X Bitcoin ETF", proxyType: "leveraged" },
    ],
    notes: "Speculative sponsorship wave; pair with RAI for posture.",
  },
  {
    id: "NUCLEAR_URANIUM",
    name: "Nuclear / Uranium",
    tier: "Narrative",
    leadersTarget: 4,
    core: ["CCJ", "UEC", "NXE", "UUUU", "BWXT", "LEU", "SMR", "OKLO", "DNN", "URA"],
    candidates: ["VST", "CEG", "NRG", "LTBR"],
    etfProxies: [
      { symbol: "URA", name: "Global X Uranium ETF", proxyType: "direct" },
      { symbol: "URNM", name: "Sprott Uranium Miners ETF", proxyType: "direct" },
      { symbol: "XLU", name: "Utilities Select SPDR", proxyType: "macro" },
      { symbol: "SDYL", name: "ETRACS 2x Leveraged US Utilities", proxyType: "leveraged" },
    ],
    notes: "Narrative wave with macro hooks. Clean energy + defense.",
  },
  {
    id: "SPACE_FRONTIER",
    name: "Space / Frontier Tech",
    tier: "Narrative",
    leadersTarget: 3,
    core: ["RKLB", "ASTS", "IRDM", "LUNR", "SPCE", "RDW"],
    candidates: ["MNTS", "BKSY", "PL", "VORB"],
    etfProxies: [
      { symbol: "UFO", name: "Procure Space ETF", proxyType: "direct" },
      { symbol: "ARKX", name: "ARK Space Exploration ETF", proxyType: "direct" },
      { symbol: "ITA", name: "iShares Aerospace & Defense ETF", proxyType: "macro" },
      { symbol: "DFEN", name: "Direxion Daily Aerospace & Defense Bull 3X", proxyType: "leveraged" },
    ],
    notes: "High-vol narrative bucket. Space exploration and satellites.",
  },
  {
    id: "QUANTUM",
    name: "Quantum Computing",
    tier: "Narrative",
    leadersTarget: 3,
    core: ["IONQ", "RGTI", "QBTS", "ARQQ", "QUBT"],
    candidates: ["QTUM", "FORM"],
    etfProxies: [
      { symbol: "QTUM", name: "Defiance Quantum ETF", proxyType: "direct" },
      { symbol: "XLK", name: "Technology Select SPDR", proxyType: "macro" },
      { symbol: "TECS", name: "Direxion Daily Technology Bear 3X", proxyType: "inverse" },
      { symbol: "TECL", name: "Direxion Daily Technology Bull 3X", proxyType: "leveraged" },
    ],
    notes: "Emerging quantum computing pure-plays.",
  },
  {
    id: "RARE_EARTH",
    name: "Rare Earth / Critical Materials",
    tier: "Narrative",
    leadersTarget: 3,
    core: ["MP", "LAC", "ALB", "SQM", "PLL", "REMX"],
    candidates: ["LTHM", "ALTM", "SGML", "UUUU"],
    etfProxies: [
      { symbol: "REMX", name: "VanEck Rare Earth/Strategic Metals ETF", proxyType: "direct" },
      { symbol: "LIT", name: "Global X Lithium & Battery Tech ETF", proxyType: "adjacent" },
      { symbol: "XLB", name: "Materials Select SPDR", proxyType: "macro" },
      { symbol: "SMN", name: "ProShares UltraShort Basic Materials", proxyType: "inverse" },
      { symbol: "UYM", name: "ProShares Ultra Basic Materials 2X", proxyType: "leveraged" },
    ],
    notes: "Critical materials and rare earth. EV supply chain.",
  },
  {
    id: "PRECIOUS_METALS",
    name: "Precious Metals",
    tier: "Narrative",
    leadersTarget: 5,
    core: [
      // Gold miners
      "NEM", "AEM", "GOLD", "FNV", "WPM", "KGC", "RGLD",
      // Silver miners
      "PAAS", "AG", "HL", "CDE", "FSM",
      // ETFs
      "GLD", "SLV", "GDX", "GDXJ",
    ],
    candidates: [
      // More silver exposure
      "EXK", "MAG", "SVM",
      // Junior miners
      "BTG", "IAG", "NGD", "SAND",
    ],
    etfProxies: [
      { symbol: "GLD", name: "SPDR Gold Shares", proxyType: "direct" },
      { symbol: "GDX", name: "VanEck Gold Miners ETF", proxyType: "direct" },
      { symbol: "GDXJ", name: "VanEck Junior Gold Miners", proxyType: "direct" },
      { symbol: "SLV", name: "iShares Silver Trust", proxyType: "direct" },
      { symbol: "TLT", name: "iShares 20+ Year Treasury", proxyType: "macro" },
      { symbol: "DUST", name: "Direxion Daily Gold Miners Bear 2X", proxyType: "inverse" },
      { symbol: "GLL", name: "ProShares UltraShort Gold", proxyType: "inverse" },
      { symbol: "NUGT", name: "Direxion Daily Gold Miners Bull 2X", proxyType: "leveraged" },
      { symbol: "UGL", name: "ProShares Ultra Gold 2X", proxyType: "leveraged" },
    ],
    notes: "Gold & silver miners plus bullion ETFs. Safe-haven play, Fed/inflation sensitive.",
  },
  {
    id: "BIOTECH",
    name: "Biotech",
    tier: "Narrative",
    leadersTarget: 4,
    core: ["REGN", "VRTX", "MRNA", "BNTX", "CRSP", "BIIB", "ALNY", "BGNE", "BMRN", "SRPT", "INCY", "XBI"],
    candidates: ["EXAS", "RARE", "UTHR", "ARGX", "LEGN", "IONS", "NTRA", "PCVX"],
    etfProxies: [
      { symbol: "XBI", name: "SPDR S&P Biotech ETF", proxyType: "direct" },
      { symbol: "IBB", name: "iShares Biotechnology ETF", proxyType: "direct" },
      { symbol: "ARKG", name: "ARK Genomic Revolution ETF", proxyType: "adjacent" },
      { symbol: "XLV", name: "Health Care Select SPDR", proxyType: "macro" },
      { symbol: "LABD", name: "Direxion Daily S&P Biotech Bear 3X", proxyType: "inverse" },
      { symbol: "LABU", name: "Direxion Daily S&P Biotech Bull 3X", proxyType: "leveraged" },
    ],
    notes: "Event-driven high beta. Catalysts, pipelines, M&A.",
  },
  {
    id: "SOLAR",
    name: "Solar / Clean Energy",
    tier: "Narrative",
    leadersTarget: 5,
    core: ["ENPH", "SEDG", "FSLR", "RUN", "NOVA", "ARRY", "SHLS", "CSIQ", "JKS", "TAN", "BE", "PLUG"],
    candidates: ["FLNC", "STEM", "MAXN", "SPWR", "HASI", "NEP", "FCEL", "BLDP"],
    etfProxies: [
      { symbol: "TAN", name: "Invesco Solar ETF", proxyType: "direct" },
      { symbol: "ICLN", name: "iShares Global Clean Energy ETF", proxyType: "direct" },
      { symbol: "QCLN", name: "First Trust NASDAQ Clean Edge ETF", proxyType: "adjacent" },
      { symbol: "XLE", name: "Energy Select SPDR", proxyType: "hedge" },
      { symbol: "ERY", name: "Direxion Daily Energy Bear 2X", proxyType: "inverse" },
      { symbol: "ERX", name: "Direxion Daily Energy Bull 2X", proxyType: "leveraged" },
    ],
    notes: "Solar + hydrogen/fuel cells. Policy-driven, high beta. Moves on IRA/green energy sentiment.",
  },
  {
    id: "GAMING_CASINOS",
    name: "Gaming / Casinos",
    tier: "Narrative",
    leadersTarget: 4,
    core: [
      // Major casino operators
      "LVS", "WYNN", "MGM", "CZR", "MLCO",
      // Regional gaming
      "PENN", "BYD", "CHDN", "RRR",
      // Online gaming/sports betting
      "DKNG", "FLUT", "RSI",
      // Gaming equipment
      "IGT", "LNW",
    ],
    candidates: [
      "GDEN", "BALY", "EVRI", "AGS", "PDYPY",
    ],
    etfProxies: [
      { symbol: "BJK", name: "VanEck Gaming ETF", proxyType: "direct" },
      { symbol: "BETZ", name: "Roundhill Sports Betting ETF", proxyType: "direct" },
      { symbol: "XLY", name: "Consumer Discretionary SPDR", proxyType: "macro" },
      { symbol: "SCC", name: "ProShares UltraShort Consumer Services", proxyType: "inverse" },
      { symbol: "UCC", name: "ProShares Ultra Consumer Services 2X", proxyType: "leveraged" },
    ],
    notes: "Casinos, sports betting, iGaming. Macro sensitive, high beta. Vegas + Macau exposure.",
  },
  {
    id: "HOSPITALITY_LEISURE",
    name: "Hospitality / Leisure",
    tier: "Narrative",
    leadersTarget: 4,
    core: [
      // Hotels
      "MAR", "HLT", "H", "WH", "IHG", "CHH",
      // Cruises
      "CCL", "RCL", "NCLH",
      // Travel/booking
      "BKNG", "EXPE", "ABNB",
      // Theme parks / entertainment
      "SIX", "FUN", "SEAS",
    ],
    candidates: [
      // More hotels
      "VAC", "PLYA", "HTHT",
      // Travel adjacent
      "TRIP", "TCOM",
    ],
    etfProxies: [
      { symbol: "PEJ", name: "Invesco Leisure & Entertainment ETF", proxyType: "direct" },
      { symbol: "JETS", name: "U.S. Global Jets ETF", proxyType: "adjacent" },
      { symbol: "XLY", name: "Consumer Discretionary SPDR", proxyType: "macro" },
      { symbol: "SCC", name: "ProShares UltraShort Consumer Services", proxyType: "inverse" },
      { symbol: "UCC", name: "ProShares Ultra Consumer Services 2X", proxyType: "leveraged" },
    ],
    notes: "Hotels, cruises, travel booking, theme parks. Consumer discretionary, post-COVID recovery play.",
  },
];

// =============================================================================
// 5 Overlays (Non-Competing Factors)
// =============================================================================

export const OVERLAYS: OverlayDefinition[] = [
  {
    id: "MEGA_OVERLAY",
    name: "Mega Cap",
    rule: "Top 8 by market cap, curated mega list",
    defaultTickers: ["AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "TSLA", "AVGO"],
  },
  {
    id: "MEMORY_OVERLAY",
    name: "Memory",
    rule: "Memory semiconductor specialists (cycles differently from logic)",
    defaultTickers: ["MU", "SNDK"],
  },
  {
    id: "YIELD_OVERLAY",
    name: "High Yield",
    rule: "Top dividend yield quartile within universe (computed dynamically)",
  },
  {
    id: "HIGH_BETA_OVERLAY",
    name: "High Beta",
    rule: "Top ATR% decile (computed dynamically)",
  },
  {
    id: "SMALL_CAP_OVERLAY",
    name: "Small Cap",
    rule: "Market cap threshold-based (computed dynamically)",
  },
];

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get all unique tickers across all clusters (for batched API calls)
 */
export function getAllUniverseTickers(): string[] {
  const tickerSet = new Set<string>();
  
  for (const cluster of CLUSTERS) {
    cluster.core.forEach(t => tickerSet.add(t));
    cluster.candidates.forEach(t => tickerSet.add(t));
  }
  
  // Add overlay tickers
  for (const overlay of OVERLAYS) {
    if (overlay.defaultTickers) {
      overlay.defaultTickers.forEach(t => tickerSet.add(t));
    }
  }
  
  // Add RAI proxy ETFs (SPY, QQQ, IWM for breadth + UVXY for vol)
  const raiProxies = ["SPY", "QQQ", "IWM", "IWO", "SLY", "ARKK", "RSP", "UVXY"];
  raiProxies.forEach(t => tickerSet.add(t));
  
  // Add size filter benchmark ETFs
  Object.values(SIZE_FILTER_BENCHMARKS).forEach(t => tickerSet.add(t));
  
  // Add all ETF proxies from clusters
  for (const cluster of CLUSTERS) {
    cluster.etfProxies.forEach(p => tickerSet.add(p.symbol));
  }
  
  return Array.from(tickerSet).sort();
}

/**
 * Get cluster by ID
 */
export function getClusterById(id: ClusterId): ClusterDefinition | undefined {
  return CLUSTERS.find(c => c.id === id);
}

/**
 * Get all tickers for a specific cluster (core + candidates)
 */
export function getClusterTickers(id: ClusterId): string[] {
  const cluster = getClusterById(id);
  if (!cluster) return [];
  return [...cluster.core, ...cluster.candidates];
}

/**
 * Find which cluster a ticker belongs to (primary assignment)
 * Returns the first cluster where ticker is in core, then candidates
 */
export function getTickerPrimaryCluster(symbol: string): ClusterId | null {
  const upper = symbol.toUpperCase();
  // First check core lists (higher priority)
  for (const cluster of CLUSTERS) {
    if (cluster.core.includes(upper)) {
      return cluster.id;
    }
  }
  // Then check candidate lists
  for (const cluster of CLUSTERS) {
    if (cluster.candidates.includes(upper)) {
      return cluster.id;
    }
  }
  return null;
}

/** Prefer lower numbers (tighter theme link) when the same ETF appears under multiple clusters. */
const ETF_PROXY_TYPE_RANK: Record<ETFProxyType, number> = {
  direct: 0,
  adjacent: 1,
  macro: 2,
  hedge: 3,
  inverse: 4,
  leveraged: 5,
};

/**
 * Human theme name for a symbol: core/candidate membership first, else best ETF proxy match.
 * Used by watchlist extended quotes when company/ETF display name is missing.
 */
export function getThemeLabelForSymbol(symbol: string): string | null {
  const upper = normalizeWatchlistSymbol(symbol);
  const primaryId = getTickerPrimaryCluster(upper);
  if (primaryId) {
    const c = getClusterById(primaryId);
    if (c?.name) return c.name;
  }

  let best: { rank: number; clusterIndex: number; name: string } | null = null;
  CLUSTERS.forEach((cluster, clusterIndex) => {
    const hit = cluster.etfProxies.find((p) => p.symbol.toUpperCase() === upper);
    if (!hit) return;
    const rank = ETF_PROXY_TYPE_RANK[hit.proxyType] ?? 99;
    if (
      !best ||
      rank < best.rank ||
      (rank === best.rank && clusterIndex < best.clusterIndex)
    ) {
      best = { rank, clusterIndex, name: cluster.name };
    }
  });

  const sector = sectorSpdrThemeLabel(upper);
  return best?.name ?? (sector || null);
}

/**
 * Get clusters by tier
 */
export function getClustersByTier(tier: ClusterTier): ClusterDefinition[] {
  return CLUSTERS.filter(c => c.tier === tier);
}

/**
 * Build a map of ticker -> primary cluster for fast lookups
 */
export function buildTickerClusterMap(): Map<string, ClusterId> {
  const map = new Map<string, ClusterId>();
  
  // Core tickers take priority
  for (const cluster of CLUSTERS) {
    for (const ticker of cluster.core) {
      if (!map.has(ticker)) {
        map.set(ticker, cluster.id);
      }
    }
  }
  
  // Then candidates (if not already assigned)
  for (const cluster of CLUSTERS) {
    for (const ticker of cluster.candidates) {
      if (!map.has(ticker)) {
        map.set(ticker, cluster.id);
      }
    }
  }
  
  return map;
}

/**
 * Get overlay tickers
 */
export function getOverlayTickers(overlayId: OverlayId): string[] {
  const overlay = OVERLAYS.find(o => o.id === overlayId);
  return overlay?.defaultTickers || [];
}

/**
 * Check if ticker is in an overlay
 */
export function isTickerInOverlay(symbol: string, overlayId: OverlayId): boolean {
  const tickers = getOverlayTickers(overlayId);
  return tickers.includes(symbol);
}

/**
 * Get ETF proxies for a cluster
 */
export function getClusterETFProxies(id: ClusterId): ETFProxy[] {
  const cluster = getClusterById(id);
  return cluster?.etfProxies || [];
}

/**
 * Get benchmark ETF for a size filter
 */
export function getSizeFilterBenchmark(size: SizeFilter): string {
  return SIZE_FILTER_BENCHMARKS[size];
}

/**
 * Get days for a time slice
 */
export function getTimeSliceDays(slice: TimeSlice): number {
  const config = TIME_SLICE_CONFIG[slice];
  if (config.days === -1) {
    // YTD: calculate days from Jan 1
    const now = new Date();
    const jan1 = new Date(now.getFullYear(), 0, 1);
    const diffMs = now.getTime() - jan1.getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }
  return config.days;
}

// =============================================================================
// Exports for TypeScript consumers
// =============================================================================

export const CLUSTER_IDS = CLUSTERS.map(c => c.id);
export const CLUSTER_COUNT = CLUSTERS.length;
export const TOTAL_UNIVERSE_SIZE = getAllUniverseTickers().length;
