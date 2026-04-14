/**
 * React Query Hooks for Market Condition Terminal
 * 
 * Provides live data from the market-condition API endpoints.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// =============================================================================
// Types (matching server types)
// =============================================================================

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
  | "SOLAR";

export type TimeSlice = "TODAY" | "15M" | "30M" | "1H" | "4H" | "1D" | "5D" | "10D" | "1W" | "1M" | "3M" | "6M" | "YTD";
export type SizeFilter = "ALL" | "MEGA" | "LARGE" | "MID" | "SMALL" | "MICRO";
export type TrendState = "Bull" | "Transition" | "Bear";
export type MarketSession = "MARKET_HOURS" | "AFTER_HOURS" | "CLOSED";

export interface ETFProxy {
  symbol: string;
  name: string;
  proxyType: "direct" | "adjacent" | "macro" | "hedge" | "inverse" | "leveraged";
}

export interface ThemeMetrics {
  id: ClusterId;
  name: string;
  tier: "Macro" | "Structural" | "Narrative";
  score: number;
  baseScore?: number;
  medianPct: number;
  rsVsBenchmark?: number;
  rsVsSpy: number;  // Legacy alias
  acceleration: number;
  accDistDays?: number;
  // Component scores (0-1)
  pctComponent?: number;
  breadthComponent?: number;
  rsComponent?: number;
  accelComponent?: number;
  // Breadth details
  breadthPct: number;
  pctAbove50d?: number;
  pctAbove200d?: number;
  // Ranking
  rank: number;
  deltaRank: number;
  percentile?: number;
  // Derived
  volExp: number;
  penaltyFactor: number;
  narrowLeadershipMultiplier?: number;
  reasonCodes: string[];
  // Member counts
  coreCount: number;
  totalCount: number;
  greenCount: number;
  // Concentration
  top3Contribution?: number;
  top3Concentration: number;
  isNarrowLeadership: boolean;
  // Trend state
  trendState?: TrendState;
  bullCount?: number;
  transitionCount?: number;
  bearCount?: number;
  // ETF proxies
  etfProxies?: ETFProxy[];
  // Historical metrics for time-slice dual display (populated when timeSlice != "1D")
  historicalMetrics?: {
    rank: number;
    score: number;
    medianPct: number;
    rsVsBenchmark: number;
    breadthPct: number;
  };
  // Timestamp
  calculatedAt: string;
  timeSlice?: TimeSlice;
}

export interface TickerMetrics {
  symbol: string;
  clusterId: ClusterId;
  price: number;
  prevClose: number;
  pctChange: number;
  prevDayVolExp?: number;    // Volume expansion for previous full session (D-Close split)
  rsVsBenchmark?: number;
  rsVsSpy: number;  // Legacy alias
  volExp: number;
  momentum?: "Above" | "Flat" | "Below";  // Legacy
  trendState?: TrendState;
  isAbove50d?: boolean;
  isAbove200d?: boolean;
  pctVsEma10d?: number | null;
  pctVsEma20d?: number | null;
  pctVsSma50d?: number | null;
  pctVsSma200d?: number | null;
  isCore: boolean;
  isCandidate: boolean;
  contributionPct?: number;
  rsRank?: number;
  accDistDays?: number;  // Accumulation/Distribution streak (William O'Neal style)
  leaderScore?: number;
  isLeader?: boolean;
  isPinned?: boolean;
  // Historical ticker data for time-slice comparison
  historicalPrice?: number;
  historicalPct?: number;
  historicalVolExp?: number;
}

export interface RAIOutput {
  score: number;
  label: "AGGRESSIVE" | "NEUTRAL" | "DEFENSIVE";
  riskMultiplier: number;
  components: {
    trendPosition: number;
    smallVsLarge: number;
    specLeadership: number;
    marketBreadth: number;
    volatilityRegime: number;
  };
  details: {
    trendPositionDetail: string;
    smallVsLargeDetail: string;
    specLeadershipDetail: string;
    marketBreadthDetail: string;
    volatilityDetail: string;
  };
  calculatedAt: string;
}

export interface BenchmarkData {
  symbol: string;
  price: number;
  prevClose: number;
  changePct: number;
  volume: number;
  timestamp: string;
}

export interface MarketConditionData {
  themes: ThemeMetrics[];
  spyBenchmark: BenchmarkData;
  benchmarks?: Record<string, BenchmarkData>; // QQQ, IWM, MDY, SPY
  lastUpdated: string;
  isStale: boolean;
  comparisonTime?: string | null; // ISO timestamp of baseline for deltaRank
  comparisonUnavailable?: string | null;
}

export interface MarketRegimeData {
  regime: "RISK_ON" | "NEUTRAL" | "RISK_OFF";
  raiScore: number;
  raiLabel: "AGGRESSIVE" | "NEUTRAL" | "DEFENSIVE";
  riskMultiplier: number;
  topThemes: Array<{
    id: ClusterId;
    name: string;
    score: number;
    penaltyFactor: number;
  }>;
  weakThemes: Array<{
    id: ClusterId;
    name: string;
    score: number;
    penaltyFactor: number;
  }>;
  penaltyFactors: Record<ClusterId, number>;
  spyChangePct: number;
  lastUpdated: string;
  isStale: boolean;
}

export interface PollingStatus {
  isPolling: boolean;
  intervalMs: number;
  lastUpdate: string | null;
  lastLeaderRefresh: string | null;
  errorCount: number;
  tickerCount: number;
  themeCount: number;
  universeSize: number;
  clusterCount: number;
  overlayCount: number;
  marketSession: MarketSession;
}

export interface MarketConditionSettings {
  pollIntervalMs: number;
  marketHoursPollIntervalMs?: number;
  offHoursPollIntervalMs?: number;
  enableStreaming: boolean;
  showRaiInHeader: boolean;
  autoStartPolling: boolean;
  maBoldThresholdPct?: number;
  clientThemesRefetchIntervalMs?: number;
  clientTickersRefetchIntervalMs?: number;
}

// =============================================================================
// API Functions
// =============================================================================

const API_BASE = "/api/market-condition";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `Failed to fetch ${url}`);
  }
  return res.json();
}

async function postJson<T>(url: string, body?: any): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `Failed to post ${url}`);
  }
  return res.json();
}

async function putJson<T>(url: string, body: any): Promise<T> {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `Failed to put ${url}`);
  }
  return res.json();
}

// =============================================================================
// Query Hooks
// =============================================================================

/**
 * Get all theme metrics
 * Refetches at interval from settings (default 1 min)
 */
export function useMarketCondition(options?: { 
  refetchInterval?: number;
  timeSlice?: TimeSlice;
  sizeFilter?: SizeFilter;
  useIntradayBaseline?: boolean;
  rotationBaseline?: "open930";
}) {
  const { data: settings } = useQuery<MarketConditionSettings>({
    queryKey: ["market-condition", "settings"],
    queryFn: () => fetchJson(`${API_BASE}/settings`),
    staleTime: 60000,
  });
  const themesInterval = options?.refetchInterval ?? settings?.clientThemesRefetchIntervalMs ?? 60000;

  const params = new URLSearchParams();
  if (options?.timeSlice) params.set("timeSlice", options.timeSlice);
  if (options?.sizeFilter) params.set("sizeFilter", options.sizeFilter);
  if (options?.useIntradayBaseline) params.set("useIntradayBaseline", "true");
  if (options?.rotationBaseline) params.set("rotationBaseline", options.rotationBaseline);
  const queryString = params.toString();
  const url = queryString ? `${API_BASE}/themes?${queryString}` : `${API_BASE}/themes`;
  
  return useQuery<MarketConditionData>({
    queryKey: ["market-condition", "themes", options?.timeSlice, options?.sizeFilter, options?.useIntradayBaseline, options?.rotationBaseline],
    queryFn: () => fetchJson(url),
    staleTime: 2 * 60 * 1000,
    gcTime: 5000,
    refetchInterval: options?.timeSlice === "TODAY" ? themesInterval : false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
}

/**
 * Get members for a specific theme
 * Refetches at interval from settings (default 1 min)
 */
export function useThemeMembers(themeId: ClusterId | null, timeSlice?: TimeSlice) {
  const { data: settings } = useQuery<MarketConditionSettings>({
    queryKey: ["market-condition", "settings"],
    queryFn: () => fetchJson(`${API_BASE}/settings`),
    staleTime: 60000,
  });
  const tickersInterval = settings?.clientTickersRefetchIntervalMs ?? 60000;

  const url = timeSlice && timeSlice !== "TODAY"
    ? `${API_BASE}/themes/${themeId}/members?timeSlice=${timeSlice}`
    : `${API_BASE}/themes/${themeId}/members`;

  return useQuery<{ 
    themeId: string; 
    members: TickerMetrics[]; 
    totalCount: number; 
    leaderCount: number;
    accDistStats?: AccDistStats;
  }>({
    queryKey: ["market-condition", "members", themeId, timeSlice],
    queryFn: () => fetchJson(url),
    enabled: !!themeId,
    staleTime: 30000,
    refetchInterval: themeId ? tickersInterval : false,
    refetchIntervalInBackground: true,
  });
}

/**
 * Get RAI (Risk Appetite Index)
 */
export function useRAI(options?: { refetchInterval?: number }) {
  return useQuery<RAIOutput>({
    queryKey: ["market-condition", "rai"],
    queryFn: () => fetchJson(`${API_BASE}/rai`),
    refetchInterval: options?.refetchInterval ?? 60000, // 1 minute
    staleTime: 30000,
  });
}

/**
 * Get market regime data (for Scanner integration)
 */
export function useMarketRegime() {
  return useQuery<MarketRegimeData>({
    queryKey: ["market-condition", "regime"],
    queryFn: () => fetchJson(`${API_BASE}/regime`),
    refetchInterval: 30000,
    staleTime: 15000,
  });
}

/**
 * Get all leaders across themes
 */
export function useLeaders() {
  return useQuery<{ leaders: TickerMetrics[]; totalCount: number }>({
    queryKey: ["market-condition", "leaders"],
    queryFn: () => fetchJson(`${API_BASE}/leaders`),
    refetchInterval: 60000,
    staleTime: 30000,
  });
}

/**
 * Get polling status
 */
export function usePollingStatus() {
  return useQuery<PollingStatus>({
    queryKey: ["market-condition", "status"],
    queryFn: () => fetchJson(`${API_BASE}/status`),
    refetchInterval: 5000,
  });
}

/**
 * Get settings
 */
export function useMarketConditionSettings() {
  return useQuery<MarketConditionSettings>({
    queryKey: ["market-condition", "settings"],
    queryFn: () => fetchJson(`${API_BASE}/settings`),
    staleTime: 60000,
  });
}

// =============================================================================
// Mutation Hooks
// =============================================================================

/**
 * Update settings
 */
export function useUpdateSettings() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (settings: Partial<MarketConditionSettings>) =>
      putJson(`${API_BASE}/settings`, settings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["market-condition", "settings"] });
      queryClient.invalidateQueries({ queryKey: ["market-condition", "status"] });
    },
  });
}

/**
 * Start polling
 */
export function useStartPolling() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: () => postJson(`${API_BASE}/start`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["market-condition", "status"] });
    },
  });
}

/**
 * Stop polling
 */
export function useStopPolling() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: () => postJson(`${API_BASE}/stop`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["market-condition", "status"] });
    },
  });
}

/**
 * Force refresh
 */
export function useForceRefresh() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: () => postJson(`${API_BASE}/refresh`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["market-condition"] });
    },
  });
}

// =============================================================================
// Utility Hooks
// =============================================================================

/**
 * Combined hook for the main page - themes + RAI
 */
export function useMarketConditionFull() {
  const themes = useMarketCondition();
  const rai = useRAI();
  const status = usePollingStatus();
  
  return {
    themes: themes.data?.themes || [],
    spyBenchmark: themes.data?.spyBenchmark,
    rai: rai.data,
    lastUpdated: themes.data?.lastUpdated ? new Date(themes.data.lastUpdated) : null,
    isStale: themes.data?.isStale ?? true,
    isPolling: status.data?.isPolling ?? false,
    isLoading: themes.isLoading || rai.isLoading,
    error: themes.error || rai.error,
  };
}
