export const INTRADAY_CHART_TIMEFRAMES = ["5min", "15min", "30min"] as const;
export type IntradayChartTimeframe = (typeof INTRADAY_CHART_TIMEFRAMES)[number];
export const DEFAULT_INTRADAY_CHART_TIMEFRAME: IntradayChartTimeframe = "5min";

export function parseIntradayChartTimeframe(
  raw: unknown,
  fallback: IntradayChartTimeframe = DEFAULT_INTRADAY_CHART_TIMEFRAME
): IntradayChartTimeframe {
  if (typeof raw === "string" && (INTRADAY_CHART_TIMEFRAMES as readonly string[]).includes(raw)) {
    return raw as IntradayChartTimeframe;
  }
  return fallback;
}
