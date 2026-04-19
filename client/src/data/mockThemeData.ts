// Market Condition / Flow Mode - Mock Theme Data
// Based on Universe Master v2 (Theme Rotation Dashboard) - 25 Clusters

export type ThemeTier = "Macro" | "Structural" | "Narrative";

// Time slice options for multi-timeframe analysis
export type TimeSlice = "TODAY" | "15M" | "30M" | "1H" | "4H" | "1D" | "5D" | "10D" | "1W" | "1M" | "3M" | "6M" | "YTD";

// Size filter options with ETF benchmarks
export type SizeFilter = "ALL" | "MEGA" | "LARGE" | "MID" | "SMALL" | "MICRO";

// Trend state for individual instruments or themes
export type TrendState = "Bull" | "Transition" | "Bear";

// ETF proxy types (live universe may add inverse / leveraged)
export type ETFProxyType =
  | "direct"
  | "adjacent"
  | "macro"
  | "hedge"
  | "inverse"
  | "leveraged";

export interface ETFProxy {
  symbol: string;
  name: string;
  proxyType: ETFProxyType;
}

export type ThemeId =
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
  // Macro (5)
  | "CONSUMER_DISC"
  | "CONSUMER_STAPLES"
  | "HEALTHCARE"
  | "MATERIALS_METALS"
  | "TRANSPORTS"
  // Narrative (8)
  | "CRYPTO_EQ"
  | "NUCLEAR_URANIUM"
  | "SPACE_FRONTIER"
  | "QUANTUM"
  | "RARE_EARTH"
  | "PRECIOUS_METALS"
  | "BIOTECH"
  | "SOLAR";

export type ReasonCode =
  | "BREADTH_STRONG"
  | "BREADTH_WEAK"
  | "RS_POS"
  | "RS_NEG"
  | "VOL_EXPAND"
  | "VOL_DRY"
  | "ACCEL_POS"
  | "ACCEL_NEG"
  | "LEADER_ROTATION"
  | "NEW_HIGHS";

export interface ThemeRow {
  id: ThemeId;
  name: string;
  tier: ThemeTier;
  medianPct: number;        // Median performance % of members
  score: number;            // ThemeScore 0-100 (after penalty)
  baseScore?: number;       // ThemeScore before narrow leadership penalty
  breadthPct: number;       // % of members green (legacy)
  pctAbove50d?: number;     // % of members above 50d SMA
  pctAbove200d?: number;    // % of members above 200d SMA
  rsVsSpy: number;          // Relative strength vs benchmark
  volExp: number;           // Volume expansion ratio (legacy)
  acceleration: number;     // RS change from previous period
  accDistDays: number;      // Accumulation/Distribution streak (William O'Neal style)
  rank: number;             // Current rank (1 = best)
  deltaRank: number;        // Change in rank from prior period
  percentile?: number;      // Percentile rank (0-100)
  penaltyFactor: number;    // 0.40-1.00 based on score
  narrowLeadershipMultiplier?: number; // 0.85-1.00
  reasonCodes: ReasonCode[];
  coreCount: number;        // Number of core members
  leaderCount: number;      // Number of active leaders
  top3Contribution?: number;    // % of positive returns from top 3 (0-1)
  top3Concentration: number;    // % display value (0-100) - legacy
  isNarrowLeadership: boolean;  // true if top3 >= 70%
  trendState?: TrendState;      // Bull/Transition/Bear
  bullCount?: number;           // Members in Bull state
  transitionCount?: number;     // Members in Transition
  bearCount?: number;           // Members in Bear state
  etfProxies?: ETFProxy[];      // ETF proxies for this theme
  // Historical snapshot for time-slice dual display (populated when timeSlice != "TODAY")
  historicalMetrics?: {
    rank: number;
    score: number;
    medianPct: number;
    rsVsBenchmark: number;
    breadthPct: number;
  };
}

export interface TickerRow {
  symbol: string;
  name: string;
  price?: number;           // Current price
  pct: number;              // Today's performance %
  leaderScore: number;      // 0-100 leader score
  rsVsSpy: number;          // RS vs benchmark
  volExp: number;           // Volume expansion
  momentum: "Above" | "Flat" | "Below";  // VWAP/EMA alignment (legacy)
  trendState?: TrendState;  // Bull/Transition/Bear
  accDistDays?: number;     // Accumulation/Distribution streak (William O'Neal style)
  isAbove50d?: boolean;     // Above 50d SMA
  isAbove200d?: boolean;    // Above 200d SMA
  isPrimary: boolean;       // Primary theme assignment
  isCore: boolean;          // Core member vs candidate
  contributionPct?: number; // % contribution to theme move
  rsRank?: number;          // RS rank within theme (1 = best)
  // % above/below each MA (for configurable columns)
  pctVsEma10d?: number | null;
  pctVsEma20d?: number | null;
  pctVsSma50d?: number | null;
  pctVsSma200d?: number | null;
  // Volume split: previous full session vs today
  prevDayVolExp?: number;
  // Historical data for time-slice dual display (populated when timeSlice is 1W or 1M)
  historicalPrice?: number;
  historicalPct?: number;
  historicalVolExp?: number;
}

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  tier: ThemeTier;
  core: string[];           // Core tickers (always included)
  candidates: string[];     // Candidate pool for leader selection
}

// Calculate penalty factor from theme score
export function getPenaltyFactor(score: number): number {
  if (score >= 80) return 1.0;
  if (score >= 60) return 0.85;
  if (score >= 40) return 0.65;
  return 0.4;
}

// Generate reason codes from metrics
export function getReasonCodes(
  breadthPct: number,
  rsVsSpy: number,
  volExp: number,
  acceleration: number
): ReasonCode[] {
  const codes: ReasonCode[] = [];
  
  if (breadthPct >= 70) codes.push("BREADTH_STRONG");
  else if (breadthPct < 50) codes.push("BREADTH_WEAK");
  
  if (rsVsSpy > 0.5) codes.push("RS_POS");
  else if (rsVsSpy < -0.5) codes.push("RS_NEG");
  
  if (volExp >= 1.5) codes.push("VOL_EXPAND");
  else if (volExp < 1.0) codes.push("VOL_DRY");
  
  if (acceleration > 2) codes.push("ACCEL_POS");
  else if (acceleration < -2) codes.push("ACCEL_NEG");
  
  return codes;
}

// Mock theme data (simulating a RISK-ON market day with 22 themes)
export const MOCK_THEMES: ThemeRow[] = [
  {
    id: "QUANTUM",
    name: "Quantum Computing",
    tier: "Narrative",
    medianPct: 4.8,
    score: 91,
    breadthPct: 100,
    rsVsSpy: 4.2,
    volExp: 2.3,
    acceleration: 8,
    rank: 1,
    deltaRank: 4,
    penaltyFactor: 1.0,
    reasonCodes: ["BREADTH_STRONG", "RS_POS", "VOL_EXPAND", "ACCEL_POS"],
    coreCount: 5,
    leaderCount: 4,
    top3Concentration: 65,
    isNarrowLeadership: true,
    trendState: "Bull",
    bullCount: 4,
    transitionCount: 1,
    bearCount: 0,
    etfProxies: [
      { symbol: "QTUM", name: "Defiance Quantum ETF", proxyType: "direct" },
      { symbol: "XLK", name: "Technology Select SPDR", proxyType: "macro" },
    ],
  },
  {
    id: "FIBER_OPTICAL",
    name: "Fiber / Optical",
    tier: "Structural",
    medianPct: 3.1,
    score: 88,
    breadthPct: 92,
    rsVsSpy: 2.5,
    volExp: 1.9,
    acceleration: 5,
    rank: 2,
    deltaRank: 3,
    penaltyFactor: 1.0,
    reasonCodes: ["BREADTH_STRONG", "RS_POS", "VOL_EXPAND", "ACCEL_POS"],
    coreCount: 8,
    leaderCount: 6,
    top3Concentration: 42,
    isNarrowLeadership: false,
  },
  {
    id: "AI_INFRA",
    name: "AI Infrastructure",
    tier: "Structural",
    medianPct: 2.4,
    score: 84,
    breadthPct: 83,
    rsVsSpy: 1.8,
    volExp: 1.6,
    acceleration: 3,
    rank: 3,
    deltaRank: 1,
    penaltyFactor: 1.0,
    reasonCodes: ["BREADTH_STRONG", "RS_POS", "VOL_EXPAND"],
    coreCount: 17,
    leaderCount: 5,
    top3Concentration: 28,
    isNarrowLeadership: false,
  },
  {
    id: "CRYPTO_EQ",
    name: "Crypto Equities",
    tier: "Narrative",
    medianPct: 2.7,
    score: 82,
    breadthPct: 85,
    rsVsSpy: 2.1,
    volExp: 1.8,
    acceleration: 4,
    rank: 4,
    deltaRank: 2,
    penaltyFactor: 1.0,
    reasonCodes: ["BREADTH_STRONG", "RS_POS", "VOL_EXPAND"],
    coreCount: 9,
    leaderCount: 5,
    top3Concentration: 55,
    isNarrowLeadership: true,
  },
  {
    id: "SEMIS",
    name: "Semiconductors",
    tier: "Structural",
    medianPct: 1.8,
    score: 76,
    breadthPct: 71,
    rsVsSpy: 1.2,
    volExp: 1.4,
    acceleration: 1,
    rank: 5,
    deltaRank: 0,
    penaltyFactor: 0.85,
    reasonCodes: ["BREADTH_STRONG", "RS_POS"],
    coreCount: 23,
    leaderCount: 5,
    top3Concentration: 22,
    isNarrowLeadership: false,
  },
  {
    id: "STORAGE",
    name: "Storage / Data Infrastructure",
    tier: "Structural",
    medianPct: 1.6,
    score: 74,
    breadthPct: 75,
    rsVsSpy: 1.0,
    volExp: 1.3,
    acceleration: 2,
    rank: 6,
    deltaRank: 0,
    penaltyFactor: 0.85,
    reasonCodes: ["BREADTH_STRONG", "RS_POS"],
    coreCount: 4,
    leaderCount: 3,
    top3Concentration: 72,
    isNarrowLeadership: true,
  },
  {
    id: "NUCLEAR_URANIUM",
    name: "Nuclear / Uranium",
    tier: "Narrative",
    medianPct: 1.2,
    score: 72,
    breadthPct: 66,
    rsVsSpy: 0.6,
    volExp: 1.3,
    acceleration: 0,
    rank: 7,
    deltaRank: -1,
    penaltyFactor: 0.85,
    reasonCodes: ["RS_POS"],
    coreCount: 10,
    leaderCount: 4,
    top3Concentration: 45,
    isNarrowLeadership: false,
  },
  {
    id: "SPACE_FRONTIER",
    name: "Space / Frontier",
    tier: "Narrative",
    medianPct: 1.5,
    score: 70,
    breadthPct: 62,
    rsVsSpy: 0.9,
    volExp: 1.4,
    acceleration: 1,
    rank: 8,
    deltaRank: 0,
    penaltyFactor: 0.85,
    reasonCodes: ["RS_POS"],
    coreCount: 6,
    leaderCount: 3,
    top3Concentration: 58,
    isNarrowLeadership: true,
  },
  {
    id: "ENTERPRISE_SOFT",
    name: "Enterprise Software",
    tier: "Structural",
    medianPct: 0.6,
    score: 64,
    breadthPct: 58,
    rsVsSpy: 0.0,
    volExp: 1.0,
    acceleration: -2,
    rank: 9,
    deltaRank: -3,
    penaltyFactor: 0.85,
    reasonCodes: ["ACCEL_NEG"],
    coreCount: 18,
    leaderCount: 5,
    top3Concentration: 25,
    isNarrowLeadership: false,
  },
  {
    id: "PAYMENTS_FINTECH",
    name: "Payments / FinTech",
    tier: "Structural",
    medianPct: 0.5,
    score: 62,
    breadthPct: 55,
    rsVsSpy: -0.1,
    volExp: 1.0,
    acceleration: -1,
    rank: 10,
    deltaRank: -1,
    penaltyFactor: 0.85,
    reasonCodes: [],
    coreCount: 9,
    leaderCount: 4,
    top3Concentration: 48,
    isNarrowLeadership: false,
  },
  {
    id: "DATA_CENTER_REITS",
    name: "Data Center REITs",
    tier: "Structural",
    medianPct: 0.4,
    score: 58,
    breadthPct: 50,
    rsVsSpy: -0.2,
    volExp: 0.9,
    acceleration: -1,
    rank: 11,
    deltaRank: 0,
    penaltyFactor: 0.65,
    reasonCodes: ["VOL_DRY"],
    coreCount: 7,
    leaderCount: 4,
    top3Concentration: 52,
    isNarrowLeadership: true,
  },
  {
    id: "CYBER",
    name: "Cybersecurity",
    tier: "Structural",
    medianPct: 0.3,
    score: 56,
    breadthPct: 50,
    rsVsSpy: -0.3,
    volExp: 0.9,
    acceleration: -2,
    rank: 12,
    deltaRank: -2,
    penaltyFactor: 0.65,
    reasonCodes: ["VOL_DRY", "ACCEL_NEG"],
    coreCount: 10,
    leaderCount: 4,
    top3Concentration: 40,
    isNarrowLeadership: false,
  },
  {
    id: "INDUSTRIAL_INFRA",
    name: "Industrial Infrastructure",
    tier: "Structural",
    medianPct: 0.2,
    score: 54,
    breadthPct: 45,
    rsVsSpy: -0.4,
    volExp: 0.85,
    acceleration: -2,
    rank: 13,
    deltaRank: -1,
    penaltyFactor: 0.65,
    reasonCodes: ["BREADTH_WEAK", "VOL_DRY", "ACCEL_NEG"],
    coreCount: 13,
    leaderCount: 5,
    top3Concentration: 32,
    isNarrowLeadership: false,
  },
  {
    id: "CONSUMER_DISC",
    name: "Consumer Discretionary",
    tier: "Macro",
    medianPct: 0.1,
    score: 52,
    breadthPct: 46,
    rsVsSpy: -0.5,
    volExp: 0.9,
    acceleration: -1,
    rank: 14,
    deltaRank: 0,
    penaltyFactor: 0.65,
    reasonCodes: ["BREADTH_WEAK", "RS_NEG"],
    coreCount: 13,
    leaderCount: 5,
    top3Concentration: 35,
    isNarrowLeadership: false,
  },
  {
    id: "RARE_EARTH",
    name: "Rare Earth / Critical Materials",
    tier: "Narrative",
    medianPct: -0.1,
    score: 48,
    breadthPct: 42,
    rsVsSpy: -0.7,
    volExp: 0.8,
    acceleration: -3,
    rank: 15,
    deltaRank: -2,
    penaltyFactor: 0.65,
    reasonCodes: ["BREADTH_WEAK", "RS_NEG", "VOL_DRY", "ACCEL_NEG"],
    coreCount: 6,
    leaderCount: 3,
    top3Concentration: 68,
    isNarrowLeadership: true,
  },
  {
    id: "DEFENSE",
    name: "Defense Primes",
    tier: "Structural",
    medianPct: -0.3,
    score: 42,
    breadthPct: 40,
    rsVsSpy: -0.9,
    volExp: 0.9,
    acceleration: -3,
    rank: 16,
    deltaRank: -3,
    penaltyFactor: 0.65,
    reasonCodes: ["BREADTH_WEAK", "RS_NEG", "ACCEL_NEG"],
    coreCount: 8,
    leaderCount: 4,
    top3Concentration: 55,
    isNarrowLeadership: true,
  },
  {
    id: "FINANCIAL_CORE",
    name: "Financial Core",
    tier: "Structural",
    medianPct: -0.4,
    score: 38,
    breadthPct: 35,
    rsVsSpy: -1.0,
    volExp: 0.8,
    acceleration: -5,
    rank: 17,
    deltaRank: -5,
    penaltyFactor: 0.4,
    reasonCodes: ["BREADTH_WEAK", "RS_NEG", "VOL_DRY", "ACCEL_NEG"],
    coreCount: 13,
    leaderCount: 5,
    top3Concentration: 30,
    isNarrowLeadership: false,
  },
  {
    id: "HEALTHCARE",
    name: "Healthcare",
    tier: "Macro",
    medianPct: -0.3,
    score: 36,
    breadthPct: 38,
    rsVsSpy: -0.9,
    volExp: 0.85,
    acceleration: -2,
    rank: 18,
    deltaRank: -1,
    penaltyFactor: 0.4,
    reasonCodes: ["BREADTH_WEAK", "RS_NEG", "VOL_DRY"],
    coreCount: 20,
    leaderCount: 5,
    top3Concentration: 28,
    isNarrowLeadership: false,
    trendState: "Transition",
  },
  {
    id: "CONSUMER_STAPLES",
    name: "Consumer Staples",
    tier: "Macro",
    medianPct: -0.5,
    score: 34,
    breadthPct: 32,
    rsVsSpy: -1.1,
    volExp: 0.75,
    acceleration: -3,
    rank: 19,
    deltaRank: -2,
    penaltyFactor: 0.4,
    reasonCodes: ["BREADTH_WEAK", "RS_NEG", "VOL_DRY", "ACCEL_NEG"],
    coreCount: 11,
    leaderCount: 4,
    top3Concentration: 42,
    isNarrowLeadership: false,
  },
  {
    id: "MATERIALS_METALS",
    name: "Materials / Industrial Metals",
    tier: "Macro",
    medianPct: -0.6,
    score: 32,
    breadthPct: 30,
    rsVsSpy: -1.2,
    volExp: 0.7,
    acceleration: -4,
    rank: 20,
    deltaRank: -2,
    penaltyFactor: 0.4,
    reasonCodes: ["BREADTH_WEAK", "RS_NEG", "VOL_DRY", "ACCEL_NEG"],
    coreCount: 10,
    leaderCount: 4,
    top3Concentration: 45,
    isNarrowLeadership: false,
  },
  {
    id: "ENERGY",
    name: "Energy",
    tier: "Structural",
    medianPct: -0.8,
    score: 28,
    breadthPct: 25,
    rsVsSpy: -1.4,
    volExp: 0.65,
    acceleration: -5,
    rank: 21,
    deltaRank: -3,
    penaltyFactor: 0.4,
    reasonCodes: ["BREADTH_WEAK", "RS_NEG", "VOL_DRY", "ACCEL_NEG"],
    coreCount: 12,
    leaderCount: 5,
    top3Concentration: 35,
    isNarrowLeadership: false,
  },
  {
    id: "PRECIOUS_METALS",
    name: "Precious Metals",
    tier: "Narrative",
    medianPct: -1.0,
    score: 24,
    breadthPct: 20,
    rsVsSpy: -1.6,
    volExp: 0.6,
    acceleration: -6,
    rank: 22,
    deltaRank: -4,
    penaltyFactor: 0.4,
    reasonCodes: ["BREADTH_WEAK", "RS_NEG", "VOL_DRY", "ACCEL_NEG"],
    coreCount: 10,
    leaderCount: 4,
    top3Concentration: 60,
    isNarrowLeadership: true,
    trendState: "Bear",
  },
  {
    id: "BIOTECH",
    name: "Biotech",
    tier: "Narrative",
    medianPct: 1.9,
    score: 68,
    breadthPct: 58,
    rsVsSpy: 1.3,
    volExp: 1.4,
    acceleration: 2,
    rank: 9,
    deltaRank: 1,
    penaltyFactor: 0.85,
    reasonCodes: ["RS_POS"],
    coreCount: 12,
    leaderCount: 4,
    top3Concentration: 45,
    isNarrowLeadership: false,
    trendState: "Transition",
  },
  {
    id: "SOLAR",
    name: "Solar / Clean Energy",
    tier: "Narrative",
    medianPct: 2.2,
    score: 71,
    breadthPct: 65,
    rsVsSpy: 1.6,
    volExp: 1.5,
    acceleration: 3,
    rank: 7,
    deltaRank: 2,
    penaltyFactor: 0.85,
    reasonCodes: ["RS_POS", "ACCEL_POS"],
    coreCount: 10,
    leaderCount: 4,
    top3Concentration: 52,
    isNarrowLeadership: true,
    trendState: "Transition",
  },
  {
    id: "TRANSPORTS",
    name: "Transports",
    tier: "Macro",
    medianPct: 0.4,
    score: 55,
    breadthPct: 48,
    rsVsSpy: -0.2,
    volExp: 0.95,
    acceleration: -1,
    rank: 13,
    deltaRank: 0,
    penaltyFactor: 0.65,
    reasonCodes: ["BREADTH_WEAK"],
    coreCount: 18,
    leaderCount: 5,
    top3Concentration: 32,
    isNarrowLeadership: false,
    trendState: "Transition",
  },
];

// Mock ticker data per theme (subset for common themes)
export const MOCK_THEME_MEMBERS: Record<ThemeId, TickerRow[]> = {
  QUANTUM: [
    { symbol: "IONQ", name: "IonQ Inc", pct: 6.1, leaderScore: 94, rsVsSpy: 5.5, volExp: 2.6, momentum: "Above", isPrimary: true, isCore: true },
    { symbol: "RGTI", name: "Rigetti Computing", pct: 4.8, leaderScore: 88, rsVsSpy: 4.2, volExp: 2.1, momentum: "Above", isPrimary: true, isCore: true },
    { symbol: "QBTS", name: "D-Wave Quantum", pct: 3.9, leaderScore: 82, rsVsSpy: 3.3, volExp: 1.8, momentum: "Above", isPrimary: true, isCore: true },
    { symbol: "ARQQ", name: "Arqit Quantum", pct: 4.2, leaderScore: 85, rsVsSpy: 3.6, volExp: 2.0, momentum: "Above", isPrimary: true, isCore: true },
    { symbol: "QUBT", name: "Quantum Computing", pct: 5.1, leaderScore: 90, rsVsSpy: 4.5, volExp: 2.3, momentum: "Above", isPrimary: true, isCore: true },
  ],
  FIBER_OPTICAL: [
    { symbol: "LITE", name: "Lumentum Holdings", pct: 4.3, leaderScore: 91, rsVsSpy: 3.7, volExp: 2.1, momentum: "Above", isPrimary: true, isCore: true },
    { symbol: "CIEN", name: "Ciena Corp", pct: 3.2, leaderScore: 83, rsVsSpy: 2.6, volExp: 1.6, momentum: "Above", isPrimary: true, isCore: true },
    { symbol: "FN", name: "Fabrinet", pct: 3.9, leaderScore: 87, rsVsSpy: 3.3, volExp: 1.8, momentum: "Above", isPrimary: true, isCore: true },
    { symbol: "GLW", name: "Corning Inc", pct: 2.4, leaderScore: 76, rsVsSpy: 1.8, volExp: 1.4, momentum: "Above", isPrimary: true, isCore: true },
    { symbol: "CALX", name: "Calix Inc", pct: 2.8, leaderScore: 79, rsVsSpy: 2.2, volExp: 1.5, momentum: "Above", isPrimary: true, isCore: true },
    { symbol: "VIAV", name: "Viavi Solutions", pct: 1.9, leaderScore: 71, rsVsSpy: 1.3, volExp: 1.3, momentum: "Above", isPrimary: true, isCore: true },
    { symbol: "AAOI", name: "Applied Optoelectronics", pct: 2.6, leaderScore: 78, rsVsSpy: 2.0, volExp: 1.7, momentum: "Above", isPrimary: true, isCore: true },
    { symbol: "INFN", name: "Infinera Corp", pct: 1.6, leaderScore: 68, rsVsSpy: 1.0, volExp: 1.2, momentum: "Flat", isPrimary: true, isCore: true },
  ],
  AI_INFRA: [
    { symbol: "ANET", name: "Arista Networks", pct: 2.8, leaderScore: 86, rsVsSpy: 2.2, volExp: 1.7, momentum: "Above", isPrimary: true, isCore: true },
    { symbol: "SMCI", name: "Super Micro Computer", pct: 3.1, leaderScore: 88, rsVsSpy: 2.5, volExp: 1.8, momentum: "Above", isPrimary: true, isCore: true },
    { symbol: "DELL", name: "Dell Technologies", pct: 2.2, leaderScore: 81, rsVsSpy: 1.6, volExp: 1.5, momentum: "Above", isPrimary: true, isCore: true },
    { symbol: "VRT", name: "Vertiv Holdings", pct: 3.4, leaderScore: 89, rsVsSpy: 2.8, volExp: 1.9, momentum: "Above", isPrimary: true, isCore: true },
    { symbol: "HPE", name: "HP Enterprise", pct: 1.8, leaderScore: 74, rsVsSpy: 1.2, volExp: 1.3, momentum: "Above", isPrimary: true, isCore: true },
    { symbol: "CSCO", name: "Cisco Systems", pct: 1.4, leaderScore: 68, rsVsSpy: 0.8, volExp: 1.2, momentum: "Flat", isPrimary: true, isCore: true },
    { symbol: "ETN", name: "Eaton Corp", pct: 1.9, leaderScore: 75, rsVsSpy: 1.3, volExp: 1.4, momentum: "Above", isPrimary: true, isCore: true },
  ],
  CRYPTO_EQ: [
    { symbol: "COIN", name: "Coinbase", pct: 3.2, leaderScore: 87, rsVsSpy: 2.6, volExp: 1.9, momentum: "Above", isPrimary: true, isCore: true },
    { symbol: "MSTR", name: "MicroStrategy", pct: 4.1, leaderScore: 91, rsVsSpy: 3.5, volExp: 2.2, momentum: "Above", isPrimary: true, isCore: true },
    { symbol: "MARA", name: "Marathon Digital", pct: 2.8, leaderScore: 83, rsVsSpy: 2.2, volExp: 1.8, momentum: "Above", isPrimary: true, isCore: true },
    { symbol: "RIOT", name: "Riot Platforms", pct: 2.4, leaderScore: 79, rsVsSpy: 1.8, volExp: 1.6, momentum: "Above", isPrimary: true, isCore: true },
    { symbol: "CLSK", name: "CleanSpark", pct: 2.6, leaderScore: 81, rsVsSpy: 2.0, volExp: 1.7, momentum: "Above", isPrimary: true, isCore: true },
    { symbol: "HUT", name: "Hut 8 Corp", pct: 2.1, leaderScore: 76, rsVsSpy: 1.5, volExp: 1.5, momentum: "Above", isPrimary: true, isCore: true },
    { symbol: "IREN", name: "Iris Energy", pct: 1.8, leaderScore: 72, rsVsSpy: 1.2, volExp: 1.4, momentum: "Above", isPrimary: true, isCore: true },
  ],
  SEMIS: [
    { symbol: "NVDA", name: "NVIDIA Corp", pct: 2.4, leaderScore: 92, rsVsSpy: 1.8, volExp: 1.6, momentum: "Above", isPrimary: true, isCore: true },
    { symbol: "AMD", name: "AMD Inc", pct: 1.9, leaderScore: 84, rsVsSpy: 1.3, volExp: 1.4, momentum: "Above", isPrimary: true, isCore: true },
    { symbol: "AVGO", name: "Broadcom Inc", pct: 1.6, leaderScore: 79, rsVsSpy: 1.0, volExp: 1.3, momentum: "Above", isPrimary: true, isCore: true },
    { symbol: "ARM", name: "Arm Holdings", pct: 2.1, leaderScore: 86, rsVsSpy: 1.5, volExp: 1.5, momentum: "Above", isPrimary: true, isCore: true },
    { symbol: "TSM", name: "Taiwan Semi", pct: 1.4, leaderScore: 74, rsVsSpy: 0.8, volExp: 1.2, momentum: "Flat", isPrimary: true, isCore: true },
    { symbol: "ASML", name: "ASML Holding", pct: 1.2, leaderScore: 71, rsVsSpy: 0.6, volExp: 1.1, momentum: "Flat", isPrimary: true, isCore: true },
    { symbol: "MU", name: "Micron Technology", pct: 1.8, leaderScore: 78, rsVsSpy: 1.2, volExp: 1.3, momentum: "Above", isPrimary: true, isCore: true },
    { symbol: "MRVL", name: "Marvell Technology", pct: 2.2, leaderScore: 85, rsVsSpy: 1.6, volExp: 1.5, momentum: "Above", isPrimary: true, isCore: true },
  ],
  STORAGE: [
    { symbol: "WDC", name: "Western Digital", pct: 1.8, leaderScore: 78, rsVsSpy: 1.2, volExp: 1.4, momentum: "Above", isPrimary: true, isCore: true },
    { symbol: "STX", name: "Seagate Technology", pct: 1.6, leaderScore: 74, rsVsSpy: 1.0, volExp: 1.3, momentum: "Above", isPrimary: true, isCore: true },
    { symbol: "PSTG", name: "Pure Storage", pct: 2.0, leaderScore: 80, rsVsSpy: 1.4, volExp: 1.5, momentum: "Above", isPrimary: true, isCore: true },
    { symbol: "NTAP", name: "NetApp", pct: 1.2, leaderScore: 68, rsVsSpy: 0.6, volExp: 1.1, momentum: "Flat", isPrimary: true, isCore: true },
  ],
  NUCLEAR_URANIUM: [
    { symbol: "CCJ", name: "Cameco Corp", pct: 1.4, leaderScore: 78, rsVsSpy: 0.8, volExp: 1.4, momentum: "Above", isPrimary: true, isCore: true },
    { symbol: "UEC", name: "Uranium Energy", pct: 1.1, leaderScore: 72, rsVsSpy: 0.5, volExp: 1.2, momentum: "Flat", isPrimary: true, isCore: true },
    { symbol: "SMR", name: "NuScale Power", pct: 1.8, leaderScore: 82, rsVsSpy: 1.2, volExp: 1.5, momentum: "Above", isPrimary: true, isCore: true },
    { symbol: "OKLO", name: "Oklo Inc", pct: 2.1, leaderScore: 85, rsVsSpy: 1.5, volExp: 1.6, momentum: "Above", isPrimary: true, isCore: true },
    { symbol: "LEU", name: "Centrus Energy", pct: 0.8, leaderScore: 65, rsVsSpy: 0.2, volExp: 1.1, momentum: "Flat", isPrimary: true, isCore: true },
    { symbol: "BWXT", name: "BWX Technologies", pct: 0.6, leaderScore: 62, rsVsSpy: 0.0, volExp: 1.0, momentum: "Flat", isPrimary: true, isCore: true },
  ],
  SPACE_FRONTIER: [
    { symbol: "RKLB", name: "Rocket Lab", pct: 2.1, leaderScore: 84, rsVsSpy: 1.5, volExp: 1.6, momentum: "Above", isPrimary: true, isCore: true },
    { symbol: "ASTS", name: "AST SpaceMobile", pct: 1.8, leaderScore: 79, rsVsSpy: 1.2, volExp: 1.4, momentum: "Above", isPrimary: true, isCore: true },
    { symbol: "IRDM", name: "Iridium Comm", pct: 1.2, leaderScore: 70, rsVsSpy: 0.6, volExp: 1.2, momentum: "Flat", isPrimary: true, isCore: true },
    { symbol: "LUNR", name: "Intuitive Machines", pct: 1.4, leaderScore: 72, rsVsSpy: 0.8, volExp: 1.3, momentum: "Above", isPrimary: true, isCore: true },
    { symbol: "SPCE", name: "Virgin Galactic", pct: 0.8, leaderScore: 58, rsVsSpy: 0.2, volExp: 1.1, momentum: "Flat", isPrimary: true, isCore: true },
    { symbol: "RDW", name: "Redwire Corp", pct: 1.0, leaderScore: 64, rsVsSpy: 0.4, volExp: 1.2, momentum: "Flat", isPrimary: true, isCore: true },
  ],
  ENTERPRISE_SOFT: [
    { symbol: "MSFT", name: "Microsoft Corp", pct: 0.8, leaderScore: 75, rsVsSpy: 0.2, volExp: 1.1, momentum: "Flat", isPrimary: true, isCore: true },
    { symbol: "CRM", name: "Salesforce", pct: 0.6, leaderScore: 71, rsVsSpy: 0.0, volExp: 1.0, momentum: "Flat", isPrimary: true, isCore: true },
    { symbol: "NOW", name: "ServiceNow", pct: 0.8, leaderScore: 74, rsVsSpy: 0.2, volExp: 1.1, momentum: "Flat", isPrimary: true, isCore: true },
    { symbol: "ORCL", name: "Oracle Corp", pct: 0.4, leaderScore: 68, rsVsSpy: -0.2, volExp: 0.9, momentum: "Flat", isPrimary: true, isCore: true },
    { symbol: "ADBE", name: "Adobe Inc", pct: 0.2, leaderScore: 64, rsVsSpy: -0.4, volExp: 0.85, momentum: "Below", isPrimary: true, isCore: true },
    { symbol: "SNOW", name: "Snowflake Inc", pct: 1.2, leaderScore: 78, rsVsSpy: 0.6, volExp: 1.2, momentum: "Above", isPrimary: true, isCore: true },
    { symbol: "IBM", name: "IBM Corp", pct: 0.5, leaderScore: 66, rsVsSpy: -0.1, volExp: 0.95, momentum: "Flat", isPrimary: true, isCore: true },
  ],
  PAYMENTS_FINTECH: [
    { symbol: "V", name: "Visa Inc", pct: 0.6, leaderScore: 72, rsVsSpy: 0.0, volExp: 1.0, momentum: "Flat", isPrimary: true, isCore: true },
    { symbol: "MA", name: "Mastercard", pct: 0.5, leaderScore: 70, rsVsSpy: -0.1, volExp: 0.95, momentum: "Flat", isPrimary: true, isCore: true },
    { symbol: "PYPL", name: "PayPal", pct: 0.4, leaderScore: 66, rsVsSpy: -0.2, volExp: 0.9, momentum: "Flat", isPrimary: true, isCore: true },
    { symbol: "SQ", name: "Block Inc", pct: 0.8, leaderScore: 74, rsVsSpy: 0.2, volExp: 1.1, momentum: "Flat", isPrimary: true, isCore: true },
    { symbol: "AFRM", name: "Affirm Holdings", pct: 1.2, leaderScore: 78, rsVsSpy: 0.6, volExp: 1.3, momentum: "Above", isPrimary: true, isCore: true },
  ],
  DATA_CENTER_REITS: [
    { symbol: "EQIX", name: "Equinix Inc", pct: 0.6, leaderScore: 72, rsVsSpy: 0.0, volExp: 0.95, momentum: "Flat", isPrimary: true, isCore: true },
    { symbol: "DLR", name: "Digital Realty", pct: 0.4, leaderScore: 68, rsVsSpy: -0.2, volExp: 0.9, momentum: "Flat", isPrimary: true, isCore: true },
    { symbol: "AMT", name: "American Tower", pct: 0.2, leaderScore: 64, rsVsSpy: -0.4, volExp: 0.85, momentum: "Below", isPrimary: true, isCore: true },
    { symbol: "CCI", name: "Crown Castle", pct: 0.3, leaderScore: 66, rsVsSpy: -0.3, volExp: 0.88, momentum: "Flat", isPrimary: true, isCore: true },
    { symbol: "SBAC", name: "SBA Communications", pct: 0.5, leaderScore: 70, rsVsSpy: -0.1, volExp: 0.92, momentum: "Flat", isPrimary: true, isCore: true },
  ],
  CYBER: [
    { symbol: "PANW", name: "Palo Alto Networks", pct: 0.5, leaderScore: 72, rsVsSpy: -0.1, volExp: 1.0, momentum: "Flat", isPrimary: true, isCore: true },
    { symbol: "CRWD", name: "CrowdStrike", pct: 0.4, leaderScore: 70, rsVsSpy: -0.2, volExp: 0.95, momentum: "Flat", isPrimary: true, isCore: true },
    { symbol: "FTNT", name: "Fortinet", pct: 0.2, leaderScore: 66, rsVsSpy: -0.4, volExp: 0.9, momentum: "Below", isPrimary: true, isCore: true },
    { symbol: "ZS", name: "Zscaler", pct: 0.3, leaderScore: 68, rsVsSpy: -0.3, volExp: 0.92, momentum: "Flat", isPrimary: true, isCore: true },
  ],
  INDUSTRIAL_INFRA: [
    { symbol: "CAT", name: "Caterpillar", pct: 0.4, leaderScore: 68, rsVsSpy: -0.2, volExp: 0.9, momentum: "Flat", isPrimary: true, isCore: true },
    { symbol: "DE", name: "Deere & Co", pct: 0.2, leaderScore: 64, rsVsSpy: -0.4, volExp: 0.85, momentum: "Below", isPrimary: true, isCore: true },
    { symbol: "HON", name: "Honeywell", pct: 0.3, leaderScore: 66, rsVsSpy: -0.3, volExp: 0.88, momentum: "Flat", isPrimary: true, isCore: true },
    { symbol: "URI", name: "United Rentals", pct: -0.1, leaderScore: 58, rsVsSpy: -0.7, volExp: 0.8, momentum: "Below", isPrimary: true, isCore: true },
  ],
  CONSUMER_DISC: [
    { symbol: "AMZN", name: "Amazon.com", pct: 0.3, leaderScore: 68, rsVsSpy: -0.3, volExp: 0.95, momentum: "Flat", isPrimary: true, isCore: true },
    { symbol: "TSLA", name: "Tesla Inc", pct: 0.8, leaderScore: 76, rsVsSpy: 0.2, volExp: 1.2, momentum: "Flat", isPrimary: true, isCore: true },
    { symbol: "HD", name: "Home Depot", pct: -0.2, leaderScore: 58, rsVsSpy: -0.8, volExp: 0.8, momentum: "Below", isPrimary: true, isCore: true },
    { symbol: "LOW", name: "Lowe's", pct: -0.3, leaderScore: 55, rsVsSpy: -0.9, volExp: 0.78, momentum: "Below", isPrimary: true, isCore: true },
  ],
  RARE_EARTH: [
    { symbol: "MP", name: "MP Materials", pct: -0.2, leaderScore: 54, rsVsSpy: -0.8, volExp: 0.82, momentum: "Below", isPrimary: true, isCore: true },
    { symbol: "LAC", name: "Lithium Americas", pct: -0.4, leaderScore: 48, rsVsSpy: -1.0, volExp: 0.75, momentum: "Below", isPrimary: true, isCore: true },
    { symbol: "ALB", name: "Albemarle Corp", pct: -0.1, leaderScore: 56, rsVsSpy: -0.7, volExp: 0.85, momentum: "Below", isPrimary: true, isCore: true },
    { symbol: "SQM", name: "Sociedad Quimica", pct: -0.3, leaderScore: 50, rsVsSpy: -0.9, volExp: 0.78, momentum: "Below", isPrimary: true, isCore: true },
  ],
  DEFENSE: [
    { symbol: "LMT", name: "Lockheed Martin", pct: -0.2, leaderScore: 56, rsVsSpy: -0.8, volExp: 0.9, momentum: "Below", isPrimary: true, isCore: true },
    { symbol: "RTX", name: "RTX Corp", pct: -0.3, leaderScore: 54, rsVsSpy: -0.9, volExp: 0.88, momentum: "Below", isPrimary: true, isCore: true },
    { symbol: "NOC", name: "Northrop Grumman", pct: -0.4, leaderScore: 52, rsVsSpy: -1.0, volExp: 0.85, momentum: "Below", isPrimary: true, isCore: true },
    { symbol: "GD", name: "General Dynamics", pct: -0.2, leaderScore: 55, rsVsSpy: -0.8, volExp: 0.9, momentum: "Below", isPrimary: true, isCore: true },
  ],
  FINANCIAL_CORE: [
    { symbol: "JPM", name: "JPMorgan Chase", pct: -0.3, leaderScore: 52, rsVsSpy: -0.9, volExp: 0.82, momentum: "Below", isPrimary: true, isCore: true },
    { symbol: "BAC", name: "Bank of America", pct: -0.5, leaderScore: 46, rsVsSpy: -1.1, volExp: 0.78, momentum: "Below", isPrimary: true, isCore: true },
    { symbol: "WFC", name: "Wells Fargo", pct: -0.4, leaderScore: 48, rsVsSpy: -1.0, volExp: 0.8, momentum: "Below", isPrimary: true, isCore: true },
    { symbol: "GS", name: "Goldman Sachs", pct: -0.2, leaderScore: 54, rsVsSpy: -0.8, volExp: 0.85, momentum: "Below", isPrimary: true, isCore: true },
  ],
  HEALTHCARE: [
    { symbol: "UNH", name: "UnitedHealth", pct: -0.2, leaderScore: 56, rsVsSpy: -0.8, volExp: 0.88, momentum: "Below", trendState: "Transition", isPrimary: true, isCore: true },
    { symbol: "LLY", name: "Eli Lilly", pct: 0.2, leaderScore: 64, rsVsSpy: -0.4, volExp: 0.95, momentum: "Flat", trendState: "Bull", isPrimary: true, isCore: true },
    { symbol: "JNJ", name: "Johnson & Johnson", pct: -0.4, leaderScore: 50, rsVsSpy: -1.0, volExp: 0.82, momentum: "Below", trendState: "Transition", isPrimary: true, isCore: true },
    { symbol: "MRK", name: "Merck & Co", pct: -0.3, leaderScore: 52, rsVsSpy: -0.9, volExp: 0.85, momentum: "Below", trendState: "Transition", isPrimary: true, isCore: true },
    { symbol: "PFE", name: "Pfizer", pct: -0.5, leaderScore: 45, rsVsSpy: -1.1, volExp: 0.78, momentum: "Below", trendState: "Bear", isPrimary: true, isCore: true },
    { symbol: "CVS", name: "CVS Health", pct: -0.1, leaderScore: 58, rsVsSpy: -0.7, volExp: 0.9, momentum: "Flat", trendState: "Transition", isPrimary: true, isCore: true },
  ],
  BIOTECH: [
    { symbol: "REGN", name: "Regeneron", pct: 2.4, leaderScore: 82, rsVsSpy: 1.8, volExp: 1.5, momentum: "Above", trendState: "Bull", isPrimary: true, isCore: true },
    { symbol: "VRTX", name: "Vertex", pct: 1.8, leaderScore: 76, rsVsSpy: 1.2, volExp: 1.3, momentum: "Above", trendState: "Bull", isPrimary: true, isCore: true },
    { symbol: "MRNA", name: "Moderna", pct: 2.8, leaderScore: 85, rsVsSpy: 2.2, volExp: 1.8, momentum: "Above", trendState: "Transition", isPrimary: true, isCore: true },
    { symbol: "BNTX", name: "BioNTech", pct: 2.1, leaderScore: 78, rsVsSpy: 1.5, volExp: 1.4, momentum: "Above", trendState: "Transition", isPrimary: true, isCore: true },
    { symbol: "CRSP", name: "CRISPR", pct: 1.5, leaderScore: 72, rsVsSpy: 0.9, volExp: 1.2, momentum: "Above", trendState: "Transition", isPrimary: true, isCore: true },
    { symbol: "BIIB", name: "Biogen", pct: 0.8, leaderScore: 65, rsVsSpy: 0.2, volExp: 1.0, momentum: "Flat", trendState: "Transition", isPrimary: true, isCore: true },
  ],
  SOLAR: [
    { symbol: "ENPH", name: "Enphase Energy", pct: 3.2, leaderScore: 88, rsVsSpy: 2.6, volExp: 1.8, momentum: "Above", trendState: "Transition", isPrimary: true, isCore: true },
    { symbol: "SEDG", name: "SolarEdge", pct: 2.8, leaderScore: 84, rsVsSpy: 2.2, volExp: 1.6, momentum: "Above", trendState: "Bear", isPrimary: true, isCore: true },
    { symbol: "FSLR", name: "First Solar", pct: 2.1, leaderScore: 78, rsVsSpy: 1.5, volExp: 1.4, momentum: "Above", trendState: "Transition", isPrimary: true, isCore: true },
    { symbol: "RUN", name: "Sunrun", pct: 1.8, leaderScore: 74, rsVsSpy: 1.2, volExp: 1.3, momentum: "Above", trendState: "Bear", isPrimary: true, isCore: true },
    { symbol: "NOVA", name: "Sunnova Energy", pct: 1.5, leaderScore: 70, rsVsSpy: 0.9, volExp: 1.2, momentum: "Flat", trendState: "Bear", isPrimary: true, isCore: true },
  ],
  TRANSPORTS: [
    { symbol: "UNP", name: "Union Pacific", pct: 0.6, leaderScore: 68, rsVsSpy: 0.0, volExp: 1.0, momentum: "Flat", trendState: "Transition", isPrimary: true, isCore: true },
    { symbol: "CSX", name: "CSX Corp", pct: 0.4, leaderScore: 65, rsVsSpy: -0.2, volExp: 0.95, momentum: "Flat", trendState: "Transition", isPrimary: true, isCore: true },
    { symbol: "DAL", name: "Delta Air Lines", pct: 0.8, leaderScore: 72, rsVsSpy: 0.2, volExp: 1.1, momentum: "Above", trendState: "Transition", isPrimary: true, isCore: true },
    { symbol: "FDX", name: "FedEx", pct: 0.2, leaderScore: 62, rsVsSpy: -0.4, volExp: 0.9, momentum: "Flat", trendState: "Transition", isPrimary: true, isCore: true },
    { symbol: "UPS", name: "UPS", pct: 0.1, leaderScore: 58, rsVsSpy: -0.5, volExp: 0.85, momentum: "Below", trendState: "Bear", isPrimary: true, isCore: true },
    { symbol: "ODFL", name: "Old Dominion", pct: 0.5, leaderScore: 66, rsVsSpy: -0.1, volExp: 0.98, momentum: "Flat", trendState: "Transition", isPrimary: true, isCore: true },
  ],
  CONSUMER_STAPLES: [
    { symbol: "PG", name: "Procter & Gamble", pct: -0.4, leaderScore: 48, rsVsSpy: -1.0, volExp: 0.78, momentum: "Below", isPrimary: true, isCore: true },
    { symbol: "KO", name: "Coca-Cola", pct: -0.5, leaderScore: 45, rsVsSpy: -1.1, volExp: 0.75, momentum: "Below", isPrimary: true, isCore: true },
    { symbol: "PEP", name: "PepsiCo", pct: -0.6, leaderScore: 42, rsVsSpy: -1.2, volExp: 0.72, momentum: "Below", isPrimary: true, isCore: true },
    { symbol: "WMT", name: "Walmart", pct: -0.3, leaderScore: 52, rsVsSpy: -0.9, volExp: 0.82, momentum: "Below", isPrimary: true, isCore: true },
  ],
  MATERIALS_METALS: [
    { symbol: "FCX", name: "Freeport-McMoRan", pct: -0.5, leaderScore: 45, rsVsSpy: -1.1, volExp: 0.72, momentum: "Below", isPrimary: true, isCore: true },
    { symbol: "NUE", name: "Nucor Corp", pct: -0.6, leaderScore: 42, rsVsSpy: -1.2, volExp: 0.7, momentum: "Below", isPrimary: true, isCore: true },
    { symbol: "AA", name: "Alcoa Corp", pct: -0.7, leaderScore: 38, rsVsSpy: -1.3, volExp: 0.68, momentum: "Below", isPrimary: true, isCore: true },
    { symbol: "LIN", name: "Linde plc", pct: -0.4, leaderScore: 48, rsVsSpy: -1.0, volExp: 0.75, momentum: "Below", isPrimary: true, isCore: true },
  ],
  ENERGY: [
    { symbol: "XOM", name: "Exxon Mobil", pct: -0.7, leaderScore: 38, rsVsSpy: -1.3, volExp: 0.68, momentum: "Below", isPrimary: true, isCore: true },
    { symbol: "CVX", name: "Chevron", pct: -0.8, leaderScore: 35, rsVsSpy: -1.4, volExp: 0.65, momentum: "Below", isPrimary: true, isCore: true },
    { symbol: "COP", name: "ConocoPhillips", pct: -0.9, leaderScore: 32, rsVsSpy: -1.5, volExp: 0.62, momentum: "Below", isPrimary: true, isCore: true },
    { symbol: "SLB", name: "Schlumberger", pct: -0.6, leaderScore: 40, rsVsSpy: -1.2, volExp: 0.7, momentum: "Below", isPrimary: true, isCore: true },
  ],
  PRECIOUS_METALS: [
    { symbol: "NEM", name: "Newmont Corp", pct: -0.9, leaderScore: 32, rsVsSpy: -1.5, volExp: 0.62, momentum: "Below", isPrimary: true, isCore: true },
    { symbol: "AEM", name: "Agnico Eagle", pct: -1.0, leaderScore: 28, rsVsSpy: -1.6, volExp: 0.58, momentum: "Below", isPrimary: true, isCore: true },
    { symbol: "GOLD", name: "Barrick Gold", pct: -1.1, leaderScore: 25, rsVsSpy: -1.7, volExp: 0.55, momentum: "Below", isPrimary: true, isCore: true },
    { symbol: "GLD", name: "SPDR Gold Trust", pct: -0.8, leaderScore: 35, rsVsSpy: -1.4, volExp: 0.65, momentum: "Below", isPrimary: true, isCore: true },
  ],
};

// Market regime based on aggregate metrics
export type MarketRegime = "RISK_ON" | "NEUTRAL" | "RISK_OFF";

// Risk Appetite Index (RAI) - continuous regime score
export interface RiskAppetiteIndex {
  score: number;              // 0-100 overall RAI
  components: {
    trendPosition: number;    // QQQ, IWO, SLY, ARKK vs 21d/50d (0-20)
    smallVsLarge: number;     // Small cap spread vs large (0-20)
    specLeadership: number;   // ARKK, meme, crypto strength (0-20)
    marketBreadth: number;    // A/D, % above 50d (0-20)
    volatilityRegime: number; // VIX level, term structure (0-20)
  };
  label: "AGGRESSIVE" | "NEUTRAL" | "DEFENSIVE";
  riskMultiplier: number;     // 0.5-1.2 for trade weighting
}

// Mega Cap Overlay - treated as overlay, not theme
export interface MegaCapOverlay {
  status: "LEADING" | "INLINE" | "LAGGING";
  medianPct: number;
  breadthPct: number;
  tickers: string[];
}

// Benchmark data structure from API
export interface BenchmarkData {
  symbol: string;
  price: number;
  prevClose: number;
  changePct: number;
  volume: number;
  timestamp: Date | string;
}

// Key indices displayed in the header
export interface IndexBenchmarks {
  QQQ: BenchmarkData;
  IWM: BenchmarkData;
  MDY: BenchmarkData;
  SPY: BenchmarkData;
}

export interface MarketConditionSummary {
  regime: MarketRegime;
  spyPct: number;
  benchmarks?: IndexBenchmarks;  // QQQ, IWM, MDY, SPY
  overallBreadth: number;
  leadersCount: number;     // Themes with score >= 70
  weakCount: number;        // Themes with score < 40
  topTheme: ThemeId;
  bottomTheme: ThemeId;
  rai: RiskAppetiteIndex;
  megaOverlay: MegaCapOverlay;
}

// Mock RAI data
export const MOCK_RAI: RiskAppetiteIndex = {
  score: 72,
  components: {
    trendPosition: 16,
    smallVsLarge: 14,
    specLeadership: 15,
    marketBreadth: 14,
    volatilityRegime: 13,
  },
  label: "AGGRESSIVE",
  riskMultiplier: 1.1,
};

// Mock Mega Cap Overlay
export const MOCK_MEGA_OVERLAY: MegaCapOverlay = {
  status: "INLINE",
  medianPct: 0.8,
  breadthPct: 62,
  tickers: ["AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "TSLA", "AVGO"],
};

export const MOCK_MARKET_SUMMARY: MarketConditionSummary = {
  regime: "RISK_ON",
  spyPct: 0.6,
  overallBreadth: 67,
  leadersCount: 5,
  weakCount: 6,
  topTheme: "QUANTUM",
  bottomTheme: "PRECIOUS_METALS",
  rai: MOCK_RAI,
  megaOverlay: MOCK_MEGA_OVERLAY,
};

// Trade weight calculation
export function calculateTradeWeight(
  baseWeight: number,
  themeScore: number,
  rai: RiskAppetiteIndex
): { finalWeight: number; penaltyFactor: number; explanation: string } {
  let penaltyFactor: number;
  if (themeScore >= 70) penaltyFactor = 1.0;
  else if (themeScore >= 60) penaltyFactor = 0.85;
  else if (themeScore >= 50) penaltyFactor = 0.65;
  else penaltyFactor = 0.40;

  const finalWeight = baseWeight * penaltyFactor * rai.riskMultiplier;
  const explanation = `$${baseWeight.toLocaleString()} × ${penaltyFactor} (theme) × ${rai.riskMultiplier} (RAI) = $${Math.round(finalWeight).toLocaleString()}`;

  return { finalWeight, penaltyFactor, explanation };
}

// =============================================================================
// Company Name Mapping
// =============================================================================
export const COMPANY_NAMES: Record<string, string> = {
  // Semiconductors
  NVDA: "NVIDIA",
  AMD: "AMD",
  AVGO: "Broadcom",
  ARM: "Arm Holdings",
  TSM: "Taiwan Semi",
  ASML: "ASML",
  AMAT: "Applied Materials",
  LRCX: "Lam Research",
  KLAC: "KLA Corp",
  MU: "Micron",
  MRVL: "Marvell",
  NXPI: "NXP Semi",
  ON: "ON Semi",
  ADI: "Analog Devices",
  TXN: "Texas Instruments",
  QCOM: "Qualcomm",
  INTC: "Intel",
  MCHP: "Microchip",
  MPWR: "Monolithic Power",
  SWKS: "Skyworks",
  QRVO: "Qorvo",
  TER: "Teradyne",
  STM: "STMicroelectronics",
  
  // AI Infrastructure
  ANET: "Arista Networks",
  SMCI: "Super Micro",
  DELL: "Dell Technologies",
  HPE: "HPE",
  CSCO: "Cisco",
  VRT: "Vertiv",
  ETN: "Eaton",
  HUBB: "Hubbell",
  CARR: "Carrier",
  JCI: "Johnson Controls",
  TT: "Trane",
  GNRC: "Generac",
  PWR: "Quanta Services",
  ABB: "ABB Ltd",
  EMR: "Emerson",
  FLR: "Fluor",
  CLS: "Celestica",
  
  // Storage
  WDC: "Western Digital",
  STX: "Seagate",
  SNDK: "SanDisk",
  PSTG: "Pure Storage",
  NTAP: "NetApp",
  
  // Enterprise Software
  MSFT: "Microsoft",
  CRM: "Salesforce",
  ORCL: "Oracle",
  NOW: "ServiceNow",
  ADBE: "Adobe",
  INTU: "Intuit",
  WDAY: "Workday",
  ADSK: "Autodesk",
  VEEV: "Veeva",
  TEAM: "Atlassian",
  SNOW: "Snowflake",
  DDOG: "Datadog",
  MDB: "MongoDB",
  NET: "Cloudflare",
  HUBS: "HubSpot",
  SHOP: "Shopify",
  ESTC: "Elastic",
  IBM: "IBM",
  
  // Cybersecurity
  PANW: "Palo Alto",
  CRWD: "CrowdStrike",
  FTNT: "Fortinet",
  ZS: "Zscaler",
  S: "SentinelOne",
  CHKP: "Check Point",
  TENB: "Tenable",
  CYBR: "CyberArk",
  VRNS: "Varonis",
  QLYS: "Qualys",
  
  // Fiber/Optical
  LITE: "Lumentum",
  CIEN: "Ciena",
  FN: "Fabrinet",
  GLW: "Corning",
  CALX: "Calix",
  VIAV: "Viavi",
  AAOI: "Applied Optoelec",
  INFN: "Infinera",
  
  // Data Center REITs
  EQIX: "Equinix",
  DLR: "Digital Realty",
  AMT: "American Tower",
  CCI: "Crown Castle",
  SBAC: "SBA Comms",
  IRM: "Iron Mountain",
  PLD: "Prologis",
  
  // Industrial Infrastructure
  CAT: "Caterpillar",
  DE: "John Deere",
  HON: "Honeywell",
  PH: "Parker Hannifin",
  URI: "United Rentals",
  CMI: "Cummins",
  ROK: "Rockwell",
  ITW: "Illinois Tool",
  DOV: "Dover",
  FAST: "Fastenal",
  XYL: "Xylem",
  IR: "Ingersoll Rand",
  OTIS: "Otis",
  
  // Defense
  LMT: "Lockheed Martin",
  RTX: "RTX",
  NOC: "Northrop",
  GD: "General Dynamics",
  LHX: "L3Harris",
  HII: "Huntington Ingalls",
  TDY: "Teledyne",
  HEI: "HEICO",
  
  // Financial Core
  JPM: "JPMorgan",
  BAC: "Bank of America",
  WFC: "Wells Fargo",
  C: "Citigroup",
  GS: "Goldman Sachs",
  MS: "Morgan Stanley",
  BLK: "BlackRock",
  SCHW: "Schwab",
  AXP: "American Express",
  CME: "CME Group",
  ICE: "ICE",
  SPGI: "S&P Global",
  MCO: "Moody's",
  
  // Payments/Fintech
  V: "Visa",
  MA: "Mastercard",
  PYPL: "PayPal",
  SQ: "Block",
  AFRM: "Affirm",
  HOOD: "Robinhood",
  SOFI: "SoFi",
  FIS: "FIS",
  FI: "Fiserv",
  
  // Energy
  XOM: "Exxon",
  CVX: "Chevron",
  COP: "ConocoPhillips",
  EOG: "EOG Resources",
  OXY: "Occidental",
  DVN: "Devon Energy",
  FANG: "Diamondback",
  SLB: "Schlumberger",
  HAL: "Halliburton",
  MPC: "Marathon Petro",
  VLO: "Valero",
  BKR: "Baker Hughes",
  
  // Consumer Discretionary
  AMZN: "Amazon",
  TSLA: "Tesla",
  HD: "Home Depot",
  LOW: "Lowe's",
  NKE: "Nike",
  SBUX: "Starbucks",
  CMG: "Chipotle",
  BKNG: "Booking",
  ABNB: "Airbnb",
  TJX: "TJX Companies",
  DKNG: "DraftKings",
  RCL: "Royal Caribbean",
  CCL: "Carnival",
  
  // Consumer Staples
  PG: "Procter & Gamble",
  KO: "Coca-Cola",
  PEP: "PepsiCo",
  WMT: "Walmart",
  COST: "Costco",
  CL: "Colgate",
  MO: "Altria",
  PM: "Philip Morris",
  MDLZ: "Mondelez",
  GIS: "General Mills",
  KR: "Kroger",
  
  // Healthcare/Life Sciences
  UNH: "UnitedHealth",
  LLY: "Eli Lilly",
  JNJ: "Johnson & Johnson",
  ABBV: "AbbVie",
  MRK: "Merck",
  TMO: "Thermo Fisher",
  DHR: "Danaher",
  ISRG: "Intuitive Surgical",
  REGN: "Regeneron",
  VRTX: "Vertex",
  AMGN: "Amgen",
  BMY: "Bristol-Myers",
  GILD: "Gilead",
  MRNA: "Moderna",
  BNTX: "BioNTech",
  CRSP: "CRISPR",
  
  // Materials/Metals
  FCX: "Freeport-McMoRan",
  NUE: "Nucor",
  STLD: "Steel Dynamics",
  AA: "Alcoa",
  LIN: "Linde",
  APD: "Air Products",
  ECL: "Ecolab",
  BHP: "BHP Group",
  RIO: "Rio Tinto",
  VALE: "Vale",
  
  // Crypto Equities
  COIN: "Coinbase",
  MSTR: "MicroStrategy",
  MARA: "Marathon Digital",
  RIOT: "Riot Platforms",
  CLSK: "CleanSpark",
  HUT: "Hut 8",
  IREN: "Iris Energy",
  IBIT: "iShares Bitcoin",
  BITO: "ProShares Bitcoin",
  
  // Nuclear/Uranium
  CCJ: "Cameco",
  UEC: "Uranium Energy",
  NXE: "NexGen Energy",
  UUUU: "Energy Fuels",
  BWXT: "BWX Technologies",
  LEU: "Centrus Energy",
  SMR: "NuScale Power",
  OKLO: "Oklo",
  DNN: "Denison Mines",
  URA: "Global X Uranium",
  
  // Space/Frontier
  RKLB: "Rocket Lab",
  ASTS: "AST SpaceMobile",
  IRDM: "Iridium",
  LUNR: "Intuitive Machines",
  SPCE: "Virgin Galactic",
  RDW: "Redwire",
  
  // Quantum
  IONQ: "IonQ",
  RGTI: "Rigetti",
  QBTS: "D-Wave",
  ARQQ: "Arqit",
  QUBT: "Quantum Computing",
  
  // Rare Earth
  MP: "MP Materials",
  LAC: "Lithium Americas",
  ALB: "Albemarle",
  SQM: "SQM",
  PLL: "Piedmont Lithium",
  REMX: "VanEck Rare Earth",
  
  // Precious Metals
  NEM: "Newmont",
  AEM: "Agnico Eagle",
  GOLD: "Barrick Gold",
  FNV: "Franco-Nevada",
  WPM: "Wheaton Precious",
  KGC: "Kinross Gold",
  PAAS: "Pan American",
  AG: "First Majestic",
  GLD: "SPDR Gold",
  SLV: "iShares Silver",
  
  // Mega Caps
  AAPL: "Apple",
  GOOGL: "Alphabet",
  META: "Meta",
  
  // Biotech (additional)
  BIIB: "Biogen",
  ALNY: "Alnylam",
  BGNE: "BeiGene",
  BMRN: "BioMarin",
  SRPT: "Sarepta",
  INCY: "Incyte",
  XBI: "SPDR Biotech",
  
  // Solar
  ENPH: "Enphase",
  SEDG: "SolarEdge",
  FSLR: "First Solar",
  RUN: "Sunrun",
  NOVA: "Sunnova",
  ARRY: "Array Technologies",
  SHLS: "Shoals Tech",
  CSIQ: "Canadian Solar",
  JKS: "JinkoSolar",
  TAN: "Invesco Solar",
  FLNC: "Fluence",
  STEM: "Stem Inc",
  
  // Transports
  UNP: "Union Pacific",
  CSX: "CSX",
  NSC: "Norfolk Southern",
  CP: "Canadian Pacific",
  CNI: "Canadian National",
  DAL: "Delta",
  UAL: "United Airlines",
  LUV: "Southwest",
  AAL: "American Airlines",
  FDX: "FedEx",
  UPS: "UPS",
  ODFL: "Old Dominion",
  SAIA: "Saia",
  XPO: "XPO Inc",
  JBHT: "J.B. Hunt",
  KNX: "Knight-Swift",
  CHRW: "C.H. Robinson",
  EXPD: "Expeditors",
  WAB: "Wabtec",
  JETS: "U.S. Global Jets",
};

// Get company name with fallback
export function getCompanyName(symbol: string): string {
  return COMPANY_NAMES[symbol] || symbol;
}
