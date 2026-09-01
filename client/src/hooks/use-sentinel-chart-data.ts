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
  includeETH: boolean,
  lookbackDays?: number
): Promise<ChartDataResponse> {
  const params = new URLSearchParams({ ticker, timeframe });
  if (includeETH) params.set("includeETH", "true");
  if (lookbackDays && lookbackDays > 0) params.set("lookbackDays", String(lookbackDays));
  const res = await fetch(`/api/sentinel/chart-data?${params}`, {
    cache: "no-store",
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const msg = body?.error ?? `Chart data fetch failed (${res.status})`;
    throw new Error(msg);
  }
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
    retry: (failureCount, error) => {
      if (error.message.includes("try again") && failureCount < 2) return true;
      return false;
    },
    retryDelay: 2000,
    ...options,
  });
}

/**
 * Keep prior candles only when symbol AND timeframe match (smooth ETH toggle).
 * A 5m placeholder on a 30m chart leaves the time scale sized for the wrong bar count.
 */
function intradayPlaceholderForTicker(ticker: string | undefined, timeframe: string) {
  return (previousData: ChartDataResponse | undefined): ChartDataResponse | undefined => {
    if (!ticker || !previousData?.ticker) return undefined;
    if (previousData.ticker.toUpperCase() !== ticker.toUpperCase()) return undefined;
    if (previousData.timeframe && previousData.timeframe !== timeframe) return undefined;
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
    placeholderData: intradayPlaceholderForTicker(ticker, timeframe),
    refetchInterval: getChartRefetchIntervalMs(),
    gcTime: 2 * 60 * 60_000,
    retry: 3,
    retryDelay: (attempt) => Math.min(1500 * 2 ** attempt, 8000),
    ...options,
  });
}
