import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { ChartDataResponse } from "@/components/DualChartGrid";

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
    /** Server shares one Alpaca-backed cache per symbol+interval; long gcTime avoids refetch churn when swapping tickers. */
    gcTime: 2 * 60 * 60_000,
    ...options,
  });
}
