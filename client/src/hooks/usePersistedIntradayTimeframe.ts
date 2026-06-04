import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  DEFAULT_INTRADAY_CHART_TIMEFRAME,
  parseIntradayChartTimeframe,
  type IntradayChartTimeframe,
} from "@shared/chart-timeframes";
import { apiRequest, queryClient } from "@/lib/queryClient";

type ChartPrefsWithTimeframe = {
  lastIntradayTimeframe?: string | null;
};

export function usePersistedIntradayTimeframe(): [
  IntradayChartTimeframe,
  (next: IntradayChartTimeframe) => void,
] {
  const { data: prefs } = useQuery<ChartPrefsWithTimeframe>({
    queryKey: ["/api/sentinel/chart-preferences"],
    staleTime: 60_000,
  });

  const [timeframe, setTimeframeState] = useState<IntradayChartTimeframe>(DEFAULT_INTRADAY_CHART_TIMEFRAME);
  const hydrated = useRef(false);
  const saveTimeoutRef = useRef<number>();

  useEffect(() => {
    if (!prefs || hydrated.current) return;
    setTimeframeState(parseIntradayChartTimeframe(prefs.lastIntradayTimeframe));
    hydrated.current = true;
  }, [prefs]);

  const setTimeframe = useCallback((next: IntradayChartTimeframe) => {
    setTimeframeState(next);
    window.clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = window.setTimeout(async () => {
      try {
        await apiRequest("PUT", "/api/sentinel/chart-preferences", {
          lastIntradayTimeframe: next,
        });
        queryClient.setQueryData<ChartPrefsWithTimeframe>(
          ["/api/sentinel/chart-preferences"],
          (old) => (old ? { ...old, lastIntradayTimeframe: next } : { lastIntradayTimeframe: next })
        );
      } catch {
        /* ignore — preference is still applied locally */
      }
    }, 400);
  }, []);

  useEffect(() => {
    return () => window.clearTimeout(saveTimeoutRef.current);
  }, []);

  return [timeframe, setTimeframe];
}
