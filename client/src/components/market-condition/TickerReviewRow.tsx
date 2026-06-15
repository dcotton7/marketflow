import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MiniChart, type StartHereInterval } from "@/components/MiniChart";
import { MiniChartControlBar, type MiniChartControlInterval } from "@/components/MiniChartControlBar";
import { cn } from "@/lib/utils";
import { localSlotBgStyle } from "@/lib/local-slot-style";
import type { TickerReviewResultRow } from "@/lib/ticker-review-engine";
import { BUCKET_LABELS } from "@/lib/ticker-review-engine";
import type { OptionalCriterionId } from "@/components/market-condition/ticker-review-criteria";
import { OPTIONAL_CRITERIA } from "@/components/market-condition/ticker-review-criteria";
import { BarChart3, ChevronDown, Sparkles, Star } from "lucide-react";
import { useState } from "react";

const OPTIONAL_LABEL = Object.fromEntries(
  OPTIONAL_CRITERIA.map((c) => [c.id, c.shortLabel])
) as Record<OptionalCriterionId, string>;

interface TickerReviewRowProps {
  row: TickerReviewResultRow;
  showChart?: boolean;
  chartInterval?: MiniChartControlInterval;
  onChartIntervalChange?: (interval: MiniChartControlInterval) => void;
  onOpenMaSettings?: () => void;
  onOpenChart?: (symbol: string) => void;
  onOpenAnalysis?: (symbol: string) => void;
  compact?: boolean;
  /** Shared across rows — one toggle expands or collapses all setup info panels. */
  infoExpanded?: boolean;
  onInfoExpandedChange?: (expanded: boolean) => void;
  starred?: boolean;
  onToggleStar?: () => void;
}

export function TickerReviewRow({
  row,
  showChart = true,
  chartInterval = "1d",
  onChartIntervalChange,
  onOpenMaSettings,
  onOpenChart,
  onOpenAnalysis,
  compact = false,
  infoExpanded: infoExpandedProp,
  onInfoExpandedChange,
  starred = false,
  onToggleStar,
}: TickerReviewRowProps) {
  const [localInfoExpanded, setLocalInfoExpanded] = useState(false);
  const infoExpanded = infoExpandedProp ?? localInfoExpanded;
  const toggleInfoExpanded = () => {
    const next = !infoExpanded;
    onInfoExpandedChange?.(next);
    if (infoExpandedProp === undefined) setLocalInfoExpanded(next);
  };
  const chartPlotHeight = compact ? "min-h-[188px]" : "min-h-[228px]";
  const chartPane = (
    <div
      className={cn(
        "min-w-0 flex flex-col rounded-lg border border-slate-700/40 overflow-hidden shrink-0",
        showChart ? "h-[232px]" : "h-[88px]"
      )}
      style={localSlotBgStyle("marketFlow:overlayChartChrome", "var(--admin-main-bg)")}
      data-ui-region="marketFlow:overlayChartChrome"
    >
      {showChart ? (
        <>
          {onChartIntervalChange && onOpenMaSettings ? (
            <MiniChartControlBar
              interval={chartInterval}
              onIntervalChange={onChartIntervalChange}
              onOpenMaSettings={onOpenMaSettings}
              starred={starred}
              onToggleStar={onToggleStar}
              starSymbol={row.symbol}
            />
          ) : null}
          <div className={cn("flex-1 min-h-0 w-full", chartPlotHeight)}>
            <MiniChart
              key={`${row.symbol}-${chartInterval}`}
              symbol={row.symbol}
              movingAverages2150200
              startHereInterval={chartInterval}
              fillContainer
              hideChangeFooter
              hideInfoBox
              showVolume
              showLeftPriceScale
              priceScaleTickCount={4}
            />
          </div>
        </>
      ) : (
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground px-3 text-center">
          Chart cap — open full chart
        </div>
      )}
    </div>
  );

  const infoPane = (
    <div className="min-w-0 space-y-2 flex flex-col">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <span className="font-mono text-lg font-semibold text-slate-100">{row.symbol}</span>
          <Badge variant="outline" className="text-xs border-cyan-500/40 text-cyan-300">
            {BUCKET_LABELS[row.bucket]}
          </Badge>
          <span className="text-xs text-muted-foreground tabular-nums">
            Score {row.watchScore}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {onToggleStar && !showChart && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "h-8 w-8",
                    starred ? "text-amber-400 hover:text-amber-300" : "text-muted-foreground hover:text-foreground"
                  )}
                  onClick={onToggleStar}
                  data-testid={`button-ticker-review-star-${row.symbol}`}
                  aria-label={starred ? `Unstar ${row.symbol}` : `Star ${row.symbol}`}
                >
                  <Star className={cn("h-4 w-4", starred && "fill-amber-400")} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{starred ? "Remove from saved charts" : "Save to daily watchlist"}</TooltipContent>
            </Tooltip>
          )}
          {onOpenChart && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  onClick={() => onOpenChart(row.symbol)}
                  data-testid={`button-ticker-review-chart-${row.symbol}`}
                  aria-label={`Open ${row.symbol} in chart queue`}
                >
                  <BarChart3 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>View saved chart</TooltipContent>
            </Tooltip>
          )}
          {onOpenAnalysis && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2.5 text-xs text-amber-400/90"
              onClick={() => onOpenAnalysis(row.symbol)}
            >
              Analysis
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {row.firedOptional.map((id) => {
          const hit = row.patternHits?.find((h) => h.criterionId === id);
          return (
            <Badge
              key={id}
              variant="secondary"
              className="text-[11px] px-2 py-0.5 bg-green-500/15 text-green-300 border-green-500/30"
            >
              {OPTIONAL_LABEL[id]}
              {hit ? ` · ${hit.stage}` : ""}
            </Badge>
          );
        })}
        {row.tightMa.fired && !row.firedOptional.includes("O4") && (
          <Badge variant="outline" className="text-[11px] px-2 py-0.5">
            Tight MA {row.tightMa.tier}
          </Badge>
        )}
      </div>

      {!infoExpanded && row.summaryLines[0] && (
        <p className="text-sm text-slate-400 leading-relaxed line-clamp-1">{row.summaryLines[0]}</p>
      )}
    </div>
  );

  return (
    <div
      className="rounded-xl border border-slate-700/50 p-4 h-full flex flex-col gap-2"
      style={localSlotBgStyle("marketFlow:overlayResultCard")}
      data-ui-region="marketFlow:overlayResultCard"
      data-testid={`ticker-review-row-${row.symbol}`}
    >
      {compact ? (
        <div className="flex flex-col gap-2 shrink-0">
          {chartPane}
          {infoPane}
        </div>
      ) : (
        <div className="grid gap-4 items-start flex-1 min-h-0 grid-cols-[minmax(280px,380px)_minmax(0,1fr)]">
          {chartPane}
          {infoPane}
        </div>
      )}

      <div className={cn("pt-1 border-t border-slate-700/40 shrink-0", compact && "mt-auto")}>
        <button
          type="button"
          onClick={toggleInfoExpanded}
          className="mx-auto flex w-full items-center justify-center gap-1 py-1 text-muted-foreground hover:text-slate-200 transition-colors"
          aria-expanded={infoExpanded}
          aria-label={infoExpanded ? "Collapse setup info" : "Expand setup info"}
          data-testid={`button-ticker-review-info-${row.symbol}`}
        >
          <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
            Setup Info
          </span>
          <ChevronDown
            className={cn("h-3.5 w-3.5 transition-transform duration-200", infoExpanded && "rotate-180")}
          />
        </button>

        {infoExpanded && (
          <div
            className="space-y-2.5 pb-1 px-0.5 animate-in fade-in slide-in-from-top-1 duration-200"
            data-testid={`ticker-review-info-${row.symbol}`}
          >
            <div className="flex items-start gap-2 rounded-lg bg-slate-900/60 border border-green-500/20 px-3 py-2.5">
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-green-400/90 mt-0.5" />
              <p className="text-sm text-slate-200 leading-relaxed">{row.setupNarrative}</p>
            </div>
            <div className="space-y-1 px-1">
              {row.summaryLines.map((line, i) => (
                <p key={i} className="text-xs text-slate-400 leading-relaxed">
                  {line}
                </p>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
