import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useQuery } from "@tanstack/react-query";

import { DualChartGrid, type ChartMetrics } from "@/components/DualChartGrid";

import type { TickerReviewResultRow } from "@/lib/ticker-review-engine";

import { WatchlistSelector } from "@/components/WatchlistSelector";

import { Button } from "@/components/ui/button";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { useSentinelDailyChartData, useSentinelIntradayChartData } from "@/hooks/use-sentinel-chart-data";

import { usePersistedIntradayTimeframe } from "@/hooks/usePersistedIntradayTimeframe";

import { useChartLoadStatus } from "@/hooks/useChartLoadStatus";

import { ChartLoadStatusDialog } from "@/components/charts/ChartLoadStatusDialog";

import { ChevronLeft, ChevronRight, X } from "lucide-react";

import { createPortal } from "react-dom";



export interface TickerReviewChartViewerProps {

  open: boolean;

  symbols: string[];

  startIndex?: number;

  /** Optional subtitle per symbol (e.g. fired criteria) */

  symbolTags?: Record<string, string[]>;

  themeId?: string | null;

  themeRank?: number;

  themeName?: string | null;

  totalThemes?: number | null;

  themeBreakdownWatch?: import("@shared/theme-breakdown-watch").BreakdownWatchAssessment | null;

  rowBySymbol?: Map<string, TickerReviewResultRow>;

  onClose: () => void;

}



/**

 * Full-screen chart queue for Ticker Review scan results.

 * Prev/next through the watch list; closing returns to the screening overlay.

 */

export function TickerReviewChartViewer({

  open,

  symbols,

  startIndex = 0,

  symbolTags,

  themeId,

  themeRank,

  themeName,

  totalThemes,

  themeBreakdownWatch,

  rowBySymbol,

  onClose,

}: TickerReviewChartViewerProps) {

  const [index, setIndex] = useState(startIndex);

  const [intradayTimeframe, setIntradayTimeframe] = usePersistedIntradayTimeframe();

  const [showETH, setShowETH] = useState(false);

  const [loadDialogOpen, setLoadDialogOpen] = useState(false);



  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    if (symbols.length === 0) { onCloseRef.current(); return; }
    setIndex(Math.min(Math.max(0, startIndex), symbols.length - 1));
  }, [open, startIndex, symbols.length]);



  const activeSymbol = symbols[index]?.toUpperCase() ?? "";



  const {

    data: dailyData,

    isLoading: dailyLoading,

    isError: dailyError,

  } = useSentinelDailyChartData(open ? activeSymbol : undefined);

  const {

    data: intradayData,

    isLoading: intradayLoading,

    isFetching: intradayFetching,

    isError: intradayError,

  } = useSentinelIntradayChartData(

    open ? activeSymbol : undefined,

    intradayTimeframe,

    showETH

  );



  const {

    data: chartMetrics,

    isLoading: metricsLoading,

    isError: metricsError,

  } = useQuery<ChartMetrics>({

    queryKey: ["/api/sentinel/trade-chart-metrics", activeSymbol, intradayTimeframe, showETH, themeId, themeRank],

    enabled: open && !!activeSymbol,

    queryFn: async () => {

      const p = new URLSearchParams({ ticker: activeSymbol, timeframe: intradayTimeframe });

      if (showETH) p.set("includeETH", "true");

      if (themeId) p.set("themeId", themeId);

      const res = await fetch(`/api/sentinel/trade-chart-metrics?${p}`, { credentials: "include" });

      if (!res.ok) throw new Error("Failed to fetch metrics");

      return res.json();

    },

    staleTime: 60_000,

  });



  const setupInfo = useMemo(() => {

    const row = rowBySymbol?.get(activeSymbol);

    if (!row) return null;

    return { row };

  }, [activeSymbol, rowBySymbol]);



  const chartLoadStatus = useChartLoadStatus({

    symbol: activeSymbol,

    intradayTimeframe,

    dailyLoading,

    dailyData,

    dailyError,

    intradayLoading,

    intradayFetching,

    intradayData,

    intradayError,

    metricsLoading,

    metricsData: chartMetrics ?? null,

    metricsError,

  });



  const pipelineSteps = useMemo(

    () => chartLoadStatus.steps.filter((s) => s.id !== "session"),

    [chartLoadStatus.steps]

  );



  const pipelineComplete = chartLoadStatus.isComplete;
  const chartsLayoutReady = chartLoadStatus.layoutReady;

  const pipelineActiveStep =

    pipelineSteps.find((s) => s.status === "active") ??

    pipelineSteps.find((s) => s.status === "pending");



  useEffect(() => {

    if (open) setLoadDialogOpen(true);

  }, [open, activeSymbol]);



  useEffect(() => {

    if (!loadDialogOpen) return;

    if (!chartsLayoutReady && !pipelineComplete) return;

    const delay = pipelineComplete ? 600 : 0;

    const t = window.setTimeout(() => setLoadDialogOpen(false), delay);

    return () => window.clearTimeout(t);

  }, [pipelineComplete, chartsLayoutReady, loadDialogOpen]);



  const goPrev = useCallback(() => {

    setIndex((i) => Math.max(0, i - 1));

  }, []);



  const goNext = useCallback(() => {

    setIndex((i) => Math.min(symbols.length - 1, i + 1));

  }, [symbols.length]);



  useEffect(() => {

    if (!open) return;

    const onKey = (e: KeyboardEvent) => {

      if (e.key === "ArrowLeft") goPrev();

      if (e.key === "ArrowRight") goNext();

      if (e.key === "Escape") onClose();

    };

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);

  }, [open, goPrev, goNext, onClose]);



  const tags = useMemo(() => {

    if (!activeSymbol || !symbolTags) return [];

    return symbolTags[activeSymbol] ?? symbolTags[symbols[index] ?? ""] ?? [];

  }, [activeSymbol, symbolTags, symbols, index]);



  if (!open || !symbols.length) return null;



  const navExtra = (

    <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">

      <Button

        size="icon"

        variant="outline"

        disabled={index === 0}

        onClick={goPrev}

        data-testid="button-ticker-review-chart-prev"

      >

        <ChevronLeft className="h-4 w-4" />

      </Button>

      <span className="text-sm text-muted-foreground tabular-nums" data-testid="text-ticker-review-chart-position">

        {index + 1} of {symbols.length}

      </span>

      <Button

        size="icon"

        variant="outline"

        disabled={index >= symbols.length - 1}

        onClick={goNext}

        data-testid="button-ticker-review-chart-next"

      >

        <ChevronRight className="h-4 w-4" />

      </Button>

      <WatchlistSelector symbol={activeSymbol} />

    </div>

  );



  return createPortal(

    <div

      className="fixed inset-0 z-[3200] flex flex-col bg-background"

      data-testid="ticker-review-chart-viewer"

    >

      <ChartLoadStatusDialog

        open={loadDialogOpen && !!activeSymbol}

        symbol={activeSymbol}

        steps={pipelineSteps}

        activeStep={pipelineActiveStep}

        elapsedMs={chartLoadStatus.elapsedMs}

        isComplete={pipelineComplete}

        showContinue={chartsLayoutReady && !pipelineComplete}

        onDismiss={() => setLoadDialogOpen(false)}

        title={

          pipelineComplete

            ? `${activeSymbol} charts ready`

            : symbols.length > 1

              ? `Opening ${activeSymbol} — Ticker Review charts`

              : `Loading ${activeSymbol} charts`

        }

      />

      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2 bg-slate-900/95">

        <div className="flex items-center gap-3 min-w-0">

          <span className="font-mono text-lg font-semibold">{activeSymbol}</span>

          {tags.length > 0 && (

            <span className="text-xs text-muted-foreground truncate hidden sm:inline">

              {tags.slice(0, 4).join(" · ")}

            </span>

          )}

          <span className="text-[11px] uppercase tracking-wide text-muted-foreground hidden md:inline">

            {symbols.length > 1 ? "Ticker Review queue" : "Theme Charts"}

          </span>

        </div>

        <Tooltip>

          <TooltipTrigger asChild>

            <Button

              size="icon"

              variant="ghost"

              onClick={onClose}

              data-testid="button-ticker-review-chart-close"

            >

              <X className="h-5 w-5" />

            </Button>

          </TooltipTrigger>

          <TooltipContent>

            {symbols.length > 1 ? "Close chart — return to Ticker Review" : "Close chart — return to Theme Charts"}

          </TooltipContent>

        </Tooltip>

      </div>



      <div className="flex flex-1 min-h-0 flex-col p-3">

        <DualChartGrid

          symbol={activeSymbol}

          dailyData={dailyData}

          dailyLoading={dailyLoading}

          intradayData={intradayData}

          intradayLoading={intradayLoading}

          intradayFetching={intradayFetching}

          chartMetrics={chartMetrics ?? null}

          setupInfo={setupInfo}

          themeId={themeId}

          themeRank={themeRank}

          themeName={themeName}

          totalThemes={totalThemes}

          themeBreakdownWatch={themeBreakdownWatch}

          intradayTimeframe={intradayTimeframe}

          onIntradayTimeframeChange={(tf) =>

            setIntradayTimeframe(tf as "5min" | "15min" | "30min")

          }

          showETH={showETH}

          onShowETHChange={setShowETH}

          showExtendedHoursControls

          showIntradayMaBasisToggle

          navExtra={navExtra}

          testIdPrefix="ticker-review-chart"

        />

      </div>

    </div>,

    document.body

  );

}


