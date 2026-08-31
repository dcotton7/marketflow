import { useEffect, useMemo, useState } from "react";
import type { ChartDataResponse } from "@/components/DualChartGrid";
import type { ChartMetrics } from "@/components/DualChartGrid";

export type ChartLoadStepStatus = "pending" | "active" | "done" | "error";

export interface ChartLoadStep {
  id: string;
  label: string;
  status: ChartLoadStepStatus;
  detail?: string;
}

export interface ChartLoadStatusInput {
  symbol: string;
  intradayTimeframe: string;
  dailyLoading: boolean;
  dailyData?: ChartDataResponse;
  dailyError?: boolean;
  intradayLoading: boolean;
  intradayFetching: boolean;
  intradayData?: ChartDataResponse;
  intradayError?: boolean;
  metricsLoading: boolean;
  metricsData?: ChartMetrics | null;
  metricsError?: boolean;
}

function candleCount(data?: ChartDataResponse): number {
  return data?.candles?.length ?? 0;
}

function indicatorsReady(data?: ChartDataResponse): boolean {
  return candleCount(data) > 0 && !!data?.indicators;
}

function tickerMatches(data: ChartDataResponse | undefined, symbol: string): boolean {
  if (!data?.ticker || !symbol) return false;
  return data.ticker.toUpperCase() === symbol.toUpperCase();
}

/** Steps shown while Ticker Review LLM/rules enrich runs before chart data loads. */
export function buildEnrichLoadSteps(
  enriching: boolean,
  enrichError: boolean,
  symbolCount: number,
  activeSymbol: string
): ChartLoadStep[] {
  const n = Math.max(1, symbolCount);
  const resolve = (
    id: string,
    label: string,
    done: boolean,
    active: boolean,
    errored: boolean,
    detail?: string
  ): ChartLoadStep => ({
    id,
    label,
    detail,
    status: errored ? "error" : done ? "done" : active ? "active" : "pending",
  });

  return [
    resolve(
      "enrich-dossier",
      `Packaging scan dossier (${n} starred ticker${n === 1 ? "" : "s"})`,
      true,
      false,
      false,
      activeSymbol ? `Lead symbol: ${activeSymbol}` : undefined
    ),
    resolve(
      "enrich-llm",
      "Running setup analysis",
      !enriching && !enrichError,
      enriching,
      enrichError,
      enriching
        ? "Decision brief + invalidation per symbol"
        : enrichError
          ? "Using rule-based narrative only"
          : "Analysis applied"
    ),
  ];
}

export function useChartLoadStatus(input: ChartLoadStatusInput) {
  const {
    symbol,
    intradayTimeframe,
    dailyLoading,
    dailyData,
    dailyError,
    intradayLoading,
    intradayFetching,
    intradayData,
    intradayError,
    metricsLoading,
    metricsData,
    metricsError,
  } = input;

  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!symbol) {
      setStartedAt(null);
      setElapsedMs(0);
      return;
    }
    setStartedAt(Date.now());
    setElapsedMs(0);
  }, [symbol]);

  useEffect(() => {
    if (!startedAt) return;
    const id = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 200);
    return () => window.clearInterval(id);
  }, [startedAt]);

  const dailyReady = !dailyLoading && tickerMatches(dailyData, symbol) && candleCount(dailyData) > 0;
  const dailyIndicatorsReady = dailyReady && indicatorsReady(dailyData);
  const intradayBusy = intradayLoading || (intradayFetching && !tickerMatches(intradayData, symbol));
  const intradayReady =
    !intradayBusy && tickerMatches(intradayData, symbol) && candleCount(intradayData) > 0;
  const intradayIndicatorsReady = intradayReady && indicatorsReady(intradayData);
  const metricsReady = !metricsLoading && !!metricsData;
  const layoutReady = dailyReady && intradayReady;
  // Hard fail only when a bars query errored with no usable candles (refetch isError + stale data is soft).
  const dailyBarsFailed = !!dailyError && !dailyReady;
  const intradayBarsFailed = !!intradayError && !intradayReady;
  const barsFailed = dailyBarsFailed || intradayBarsFailed;
  // Metrics are decorative for the dual-chart grid — never block "charts ready".
  const metricsFailed = !!metricsError && !metricsReady;
  const isComplete = layoutReady && !barsFailed;

  const steps = useMemo((): ChartLoadStep[] => {
    if (!symbol) return [];

    const tfLabel =
      intradayTimeframe === "5min"
        ? "5-minute"
        : intradayTimeframe === "15min"
          ? "15-minute"
          : intradayTimeframe === "30min"
            ? "30-minute"
            : intradayTimeframe;

    const resolve = (
      id: string,
      label: string,
      done: boolean,
      active: boolean,
      errored: boolean,
      detail?: string
    ): ChartLoadStep => ({
      id,
      label,
      detail,
      status: errored ? "error" : done ? "done" : active ? "active" : "pending",
    });

    return [
      resolve(
        "session",
        `Opening charts for ${symbol}`,
        true,
        false,
        false,
        "Routing to Sentinel Charts"
      ),
      resolve(
        "daily-bars",
        "Pulling daily price history",
        dailyReady,
        dailyLoading && !dailyReady,
        dailyBarsFailed,
        dailyReady
          ? `${candleCount(dailyData)} daily bars`
          : dailyLoading
            ? "Alpaca daily OHLCV"
            : undefined
      ),
      resolve(
        "daily-indicators",
        "Computing daily MAs, VWAP & S/R gaps",
        dailyIndicatorsReady,
        dailyReady && !dailyIndicatorsReady,
        dailyBarsFailed,
        dailyIndicatorsReady ? "Indicators attached" : undefined
      ),
      resolve(
        "intraday-bars",
        `Pulling ${tfLabel} intraday bars`,
        intradayReady,
        intradayBusy && !intradayReady,
        intradayBarsFailed,
        intradayReady
          ? `${candleCount(intradayData)} intraday bars`
          : intradayBusy
            ? "Alpaca intraday feed"
            : undefined
      ),
      resolve(
        "intraday-indicators",
        "Computing intraday MAs & session VWAP",
        intradayIndicatorsReady,
        intradayReady && !intradayIndicatorsReady,
        intradayBarsFailed,
        intradayIndicatorsReady ? "RTH session math" : undefined
      ),
      resolve(
        "metrics",
        "Loading ADR, RS, sector & earnings",
        metricsReady,
        metricsLoading && !metricsReady,
        metricsFailed,
        metricsReady
          ? "Fundamentals row ready"
          : metricsFailed
            ? "Skipped — charts still usable"
            : metricsLoading
              ? "Trade chart metrics API"
              : undefined
      ),
      resolve(
        "layout",
        "Preparing dual-chart layout",
        layoutReady,
        !layoutReady && dailyReady && intradayBusy,
        false,
        layoutReady ? "Rendering charts" : undefined
      ),
      resolve(
        "ready",
        "Charts ready",
        isComplete,
        layoutReady && !isComplete,
        barsFailed
      ),
    ];
  }, [
    symbol,
    intradayTimeframe,
    dailyLoading,
    dailyData,
    dailyBarsFailed,
    dailyReady,
    dailyIndicatorsReady,
    intradayBusy,
    intradayReady,
    intradayIndicatorsReady,
    intradayData,
    intradayBarsFailed,
    metricsLoading,
    metricsReady,
    metricsFailed,
    layoutReady,
    barsFailed,
    isComplete,
  ]);

  const activeStep = steps.find((s) => s.status === "active") ?? steps.find((s) => s.status === "pending");

  return {
    steps,
    activeStep,
    isComplete,
    layoutReady,
    barsFailed,
    metricsFailed,
    elapsedMs,
    isLoading: !!symbol && !isComplete,
  };
}
