import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { ChartDataResponse } from "@/components/DualChartGrid";

function getChartRefetchIntervalMs(): number | false {
  const now = new Date();
  const et = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hour12: false,
  }).formatToParts(now);
  const h = parseInt(et.find((p) => p.type === "hour")?.value ?? "0", 10);
  const m = parseInt(et.find((p) => p.type === "minute")?.value ?? "0", 10);
  const day = et.find((p) => p.type === "weekday")?.value ?? "";
  if (["Sat", "Sun"].includes(day)) return false;
  const mins = h * 60 + m;
  if (mins >= 570 && mins < 960) return 30_000;   // 9:30–16:00 → every 30s
  if (mins >= 960 && mins < 1140) return 120_000;  // 16:00–19:00 → every 2 min
  return false;
}

export const sentinelChartDataQueryKey = (
  ticker: string,
  timeframe: string,
  includeETH: boolean
) => ["/api/sentinel/chart-data", ticker, timeframe, includeETH] as const;

export async function fetchSentinelChartData(
  ticker: string,
  timeframe: string,
  includeETH: boolean
): Promise<ChartDataResponse> {
  const params = new URLSearchParams({ ticker, timeframe });
  if (includeETH) params.set("includeETH", "true");
  const res = await fetch(`/api/sentinel/chart-data?${params}`, {
    cache: "no-store",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch chart data");
  return res.json();
}

type DailyOpts = Omit<
  UseQueryOptions<ChartDataResponse, Error>,
  "queryKey" | "queryFn" | "enabled"
>;

type IntradayOpts = Omit<
  UseQueryOptions<ChartDataResponse, Error>,
  "queryKey" | "queryFn" | "enabled"
>;

export function useSentinelDailyChartData(ticker: string | undefined, options?: DailyOpts) {
  return useQuery<ChartDataResponse, Error>({
    queryKey: ticker ? sentinelChartDataQueryKey(ticker, "daily", false) : ["/api/sentinel/chart-data", "", "daily", false],
    queryFn: () => fetchSentinelChartData(ticker!, "daily", false),
    enabled: !!ticker,
    refetchInterval: getChartRefetchIntervalMs() || undefined,
    ...options,
  });
}

/**
 * Keep prior candles only when the symbol matches (smooth ETH toggle).
 * `keepPreviousData` alone would show the old ticker on intraday while the new symbol loads.
 */
function intradayPlaceholderForTicker(ticker: string | undefined) {
  return (previousData: ChartDataResponse | undefined): ChartDataResponse | undefined => {
    if (!ticker || !previousData?.ticker) return undefined;
    if (previousData.ticker.toUpperCase() !== ticker.toUpperCase()) return undefined;
    return previousData;
  };
}

export function useSentinelIntradayChartData(
  ticker: string | undefined,
  timeframe: string,
  includeETH: boolean,
  options?: IntradayOpts
) {
  return useQuery<ChartDataResponse, Error>({
    queryKey: ticker
      ? sentinelChartDataQueryKey(ticker, timeframe, includeETH)
      : ["/api/sentinel/chart-data", "", timeframe, includeETH],
    queryFn: () => fetchSentinelChartData(ticker!, timeframe, includeETH),
    enabled: !!ticker,
    placeholderData: intradayPlaceholderForTicker(ticker),
    refetchInterval: getChartRefetchIntervalMs(),
    gcTime: 2 * 60 * 60_000,
    retry: 3,
    retryDelay: (attempt) => Math.min(1500 * 2 ** attempt, 8000),
    ...options,
  });
}
