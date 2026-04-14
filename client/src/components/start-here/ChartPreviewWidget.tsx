import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import type { CssVariables } from "@/context/SystemSettingsContext";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  formatMiniChartLastPrice,
  MiniChart,
  type MiniChartQuoteSummary,
  type StartHereInterval,
} from "@/components/MiniChart";
import { BarChart3 } from "lucide-react";
import {
  paletteLaneHeaderControlClass,
  StartHereWidgetChrome,
} from "./StartHereWidgetChrome";
import { groupLinkAccent } from "./dashboard-persistence";
import { StartHereGroupPicker, useStartHere } from "./StartHereContext";
import {
  stockHistoryIsIntradayInterval,
  STOCK_HISTORY_INTRADAY_REFETCH_MS,
} from "@/hooks/use-stocks";
import { useWatchlist, useWatchlists } from "@/hooks/use-watchlist";

export function ChartPreviewWidget({
  cssVariables,
  instanceId,
  groupId,
  accentColor,
  onClose,
}: {
  cssVariables: CssVariables;
  instanceId: string;
  groupId: string;
  accentColor?: string;
  onClose: () => void;
}) {
  const {
    userId,
    activeStartId,
    dashboard,
    setDefaultChartTemplate,
    setChartInterval,
    setFocusedChartInstance,
    setChartTickerOverride,
    clearChartTickerOverride,
    broadcastLaneSymbol,
    workspacePalette,
  } = useStartHere();
  const gid = dashboard.instances[instanceId]?.groupId ?? groupId;
  const { accentLabel } = groupLinkAccent(gid, workspacePalette, dashboard.groups[gid]);
  const groupSym = (dashboard.groups[gid]?.symbol ?? "").trim();
  const instMeta = dashboard.instances[instanceId];
  const overrideRaw =
    instMeta?.type === "chart" && instMeta.chartSymbolOverride?.trim()
      ? instMeta.chartSymbolOverride.trim().toUpperCase()
      : "";
  const sym = overrideRaw || groupSym.toUpperCase();
  const isDefaultTemplate = dashboard.defaultChartInstanceId === instanceId;
  const chartTf: StartHereInterval =
    instMeta?.type === "chart" ? (instMeta.chartInterval ?? "1d") : "1d";
  const linkedSetLocked = instMeta?.type === "chart" && instMeta.linkedSetLocked === true;
  const chartFocused = dashboard.focusedChartInstanceId === instanceId;
  const { data: allWatchlistItems } = useWatchlist();
  const { data: watchlists } = useWatchlists();

  const paletteHdr = paletteLaneHeaderControlClass(accentColor, workspacePalette.unlinkedColor);
  const entryPrice = useMemo(() => {
    const symU = sym.trim().toUpperCase();
    if (!symU || !allWatchlistItems?.length) return null;
    const portfolioWatchlistIds = new Set(
      (watchlists ?? []).filter((w) => w.isPortfolio).map((w) => w.id)
    );
    const matches = allWatchlistItems
      .filter((item) => item.symbol.trim().toUpperCase() === symU)
      .map((item) => ({
        updatedAt: item.updatedAt ? new Date(item.updatedAt).getTime() : 0,
        entryPrice: item.targetEntry != null ? Number(item.targetEntry) : NaN,
        isPortfolio:
          item.watchlistId != null && portfolioWatchlistIds.has(item.watchlistId),
      }))
      .filter((item) => Number.isFinite(item.entryPrice) && item.entryPrice > 0)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    const portfolioMatch = matches.find((m) => m.isPortfolio);
    return portfolioMatch?.entryPrice ?? matches[0]?.entryPrice ?? null;
  }, [allWatchlistItems, sym, watchlists]);

  const isPortfolioTicker = useMemo(() => {
    const symU = sym.trim().toUpperCase();
    if (!symU || !allWatchlistItems?.length || !watchlists?.length) return false;
    const portfolioWatchlistIds = new Set(
      watchlists.filter((w) => w.isPortfolio).map((w) => w.id)
    );
    return allWatchlistItems.some(
      (item) =>
        item.symbol.trim().toUpperCase() === symU &&
        item.watchlistId != null &&
        portfolioWatchlistIds.has(item.watchlistId)
    );
  }, [allWatchlistItems, sym, watchlists]);

  const onTickerInputChange = (raw: string) => {
    const v = raw.toUpperCase();
    const t = v.trim();
    if (linkedSetLocked) {
      if (!t) return;
      broadcastLaneSymbol(gid, t);
      return;
    }
    if (!t) {
      clearChartTickerOverride(instanceId);
      return;
    }
    if (t === groupSym.toUpperCase()) {
      clearChartTickerOverride(instanceId);
      return;
    }
    setChartTickerOverride(instanceId, t);
  };

  const [quoteStrip, setQuoteStrip] = useState<MiniChartQuoteSummary | null>(null);

  useEffect(() => {
    if (!sym) setQuoteStrip(null);
  }, [sym]);

  const onQuoteSummaryChange = useCallback((q: MiniChartQuoteSummary | null) => {
    setQuoteStrip(q);
  }, []);

  const entryPct = useMemo(() => {
    const px = quoteStrip?.lastPrice ?? null;
    if (!isPortfolioTicker || entryPrice == null || !Number.isFinite(entryPrice) || entryPrice <= 0) {
      return null;
    }
    if (px == null || !Number.isFinite(px) || px <= 0) return null;
    return ((px - entryPrice) / entryPrice) * 100;
  }, [entryPrice, isPortfolioTicker, quoteStrip?.lastPrice]);

  const portfolioBorderClass = useMemo(() => {
    if (entryPct == null) return undefined;
    if (entryPct <= -2.1) return "!border-orange-800";
    if (entryPct < 0 && entryPct > -2.1) return "!border-yellow-400";
    return undefined;
  }, [entryPct]);

  const historyIntervalForStrip = chartTf;
  const refreshHint = stockHistoryIsIntradayInterval(historyIntervalForStrip)
    ? `Intraday data refetches about every ${STOCK_HISTORY_INTRADAY_REFETCH_MS / 1000} seconds while this page is open.`
    : "Daily data does not auto-refresh; reload the page for newer bars.";

  const headerTitleSlot = (
    <>
      <div className="flex w-1/2 max-w-[50%] min-w-0 shrink-0 items-center gap-1">
        <Input
          id={`start-here-chart-symbol-${instanceId}`}
          name={`start-here-chart-symbol-${instanceId}`}
          value={sym}
          onChange={(e) => onTickerInputChange(e.target.value)}
          placeholder="Ticker"
          className="start-here-no-drag h-8 min-w-0 flex-1 font-mono uppercase"
          style={{ color: cssVariables.textColorNormal, fontSize: cssVariables.fontSizeSmall }}
        />
        <Link
          href={sym ? `/sentinel/charts?symbol=${encodeURIComponent(sym)}` : "/sentinel/charts"}
          className="start-here-no-drag shrink-0"
        >
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 gap-1 px-2"
            disabled={!sym}
            aria-label="Open Sentinel charts"
          >
            <BarChart3 className="h-4 w-4" />
            Charts
          </Button>
        </Link>
      </div>
      <div
        className="start-here-no-drag flex min-w-0 flex-1 shrink items-baseline justify-end gap-x-1.5 text-xs font-mono sm:gap-x-2 sm:text-sm"
        title={
          quoteStrip && quoteStrip.dataUpdatedAt > 0
            ? `${refreshHint}\nUpdated ${new Intl.DateTimeFormat(undefined, {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              }).format(new Date(quoteStrip.dataUpdatedAt))}`
            : sym
              ? refreshHint
              : undefined
        }
      >
        {quoteStrip ? (
          <>
            <span
              className={cn(
                "rounded border border-white/40 bg-white/85 px-1.5 py-0.5 font-semibold tabular-nums",
                quoteStrip.changePct >= 0 ? "text-rs-green" : "text-rs-red"
              )}
              data-testid={`change-${sym}`}
            >
              {quoteStrip.changePct >= 0 ? "+" : ""}
              {quoteStrip.changePct.toFixed(2)}%
            </span>
            <span className="select-none opacity-50" aria-hidden>
              |
            </span>
            {quoteStrip.lastPrice != null && Number.isFinite(quoteStrip.lastPrice) ? (
              <span
                className="rounded border border-white/40 bg-white/85 px-1.5 py-0.5 font-medium tabular-nums text-slate-900"
                data-testid={`last-price-${sym}`}
              >
                {formatMiniChartLastPrice(quoteStrip.lastPrice)}
              </span>
            ) : null}
          </>
        ) : sym ? (
          <span className="text-muted-foreground tabular-nums">…</span>
        ) : null}
      </div>
    </>
  );

  const controlRow = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          value={chartTf}
          onValueChange={(v) => {
            if (v === "5m" || v === "15m" || v === "1d") {
              setChartInterval(instanceId, v);
            }
          }}
          variant="outline"
          size="sm"
          className="start-here-no-drag flex-shrink-0 justify-start"
          style={{ fontSize: cssVariables.fontSizeSmall }}
        >
          <ToggleGroupItem value="5m" aria-label="5 minute bars">
            5m
          </ToggleGroupItem>
          <ToggleGroupItem value="15m" aria-label="15 minute bars">
            15m
          </ToggleGroupItem>
          <ToggleGroupItem value="1d" aria-label="Daily bars">
            Daily
          </ToggleGroupItem>
        </ToggleGroup>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={cn(
            "start-here-no-drag h-8 flex-shrink-0 px-2 text-xs font-medium",
            paletteHdr,
            isDefaultTemplate &&
              "bg-muted text-muted-foreground opacity-80 hover:bg-muted/90 hover:opacity-100"
          )}
          title="Use this chart widget’s size and timeframe as the template for watchlist chart buttons and bulk load"
          aria-label={
            isDefaultTemplate
              ? "Default chart template is on — click to clear"
              : "Set as default chart template for watchlist"
          }
          aria-pressed={isDefaultTemplate}
          onClick={() => setDefaultChartTemplate(isDefaultTemplate ? null : instanceId)}
        >
          Default
        </Button>
      </div>
      <div className="start-here-no-drag flex shrink-0">
        {linkedSetLocked ? (
          <span
            className="inline-flex h-8 items-center rounded border border-amber-500/40 bg-amber-500/10 px-2 text-[11px] font-semibold text-amber-200"
            title="This chart belongs to a locked 3-chart linked set."
          >
            Linked x3
          </span>
        ) : (
          <StartHereGroupPicker instanceId={instanceId} cssVariables={cssVariables} />
        )}
      </div>
    </div>
  );

  return (
    <StartHereWidgetChrome
      title="Chart"
      headerTitleSlot={headerTitleSlot}
      cssVariables={cssVariables}
      onClose={onClose}
      accentColor={accentColor}
      accentLabel={accentLabel}
      neutralAccentColor={workspacePalette.unlinkedColor}
      frameClassName={chartFocused ? "ring-2 ring-ring ring-offset-2 ring-offset-background" : undefined}
    >
      <div
        className="flex h-full min-h-0 flex-col gap-2"
        onPointerDownCapture={(e) => {
          const el = e.target as HTMLElement;
          const drag = el.closest(".start-here-drag-handle");
          const noDrag = el.closest(".start-here-no-drag");
          if (drag && !noDrag) return;
          setFocusedChartInstance(instanceId);
        }}
      >
        {controlRow}
        {!sym ? (
          <p style={{ color: cssVariables.textColorSmall, fontSize: cssVariables.fontSizeSmall }}>
            Enter a symbol or pick one from a linked watchlist.
          </p>
        ) : (
          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-white/10 p-1",
              portfolioBorderClass
            )}
          >
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <MiniChart
                symbol={sym}
                timeframe="50D"
                movingAverages2150200
                startHereInterval={chartTf}
                entryPrice={entryPrice}
                entryLineTone={isPortfolioTicker ? "portfolio" : "default"}
                fillContainer
                hideChangeFooter
                onQuoteSummaryChange={onQuoteSummaryChange}
              />
            </div>
          </div>
        )}
      </div>
    </StartHereWidgetChrome>
  );
}
