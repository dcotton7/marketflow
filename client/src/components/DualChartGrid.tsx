import { useState, useEffect, useRef, useMemo, useCallback, startTransition, type ReactNode } from "react";
import { IChartApi, ISeriesApi } from "lightweight-charts";
import { TradingChart, ChartCandle, ChartIndicators, Gap, type PriceLevelLine } from "@/components/TradingChart";
import type { DrawingData } from "@/lib/chartDrawingPrimitives";
import {
  clampHorizontalDrawingLineStyle,
  clampHorizontalDrawingWidth,
  getHorizontalDrawingDefaults,
  resolveHorizontalDrawingHex,
  setHorizontalDrawingDefaults,
  type HorizontalDrawingLineStyle,
} from "@/lib/chartHorizontalDrawingPrefs";
import type { SentinelChartIndicators, SentinelChartIndicatorsMeta } from "@shared/sentinelChartData";
import { MaSettingsDialog } from "@/components/MaSettingsDialog";
import { AlertBuilderDialog } from "@/components/alerts/AlertBuilderDialog";
import { useSystemSettings } from "@/context/SystemSettingsContext";
import { useQuery } from "@tanstack/react-query";
import { useChartDrawings } from "@/hooks/useChartDrawings";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Loader2, Ruler, Minus, Trash2, Bell, Settings2 } from "lucide-react";
import { IndicatorsFourSquaresIcon } from "@/components/chart/ChartToolbarIcons";
import { DEFAULT_CHART_MA_LIMITS, type ChartMaDataLimits } from "@/lib/chart-ma-feasibility";

export type ChartDataResponse = {
  candles: ChartCandle[];
  indicators: ChartIndicators;
  indicatorsExtended?: SentinelChartIndicators;
  indicatorsMeta?: SentinelChartIndicatorsMeta;
  gaps?: Gap[];
  ticker: string;
  timeframe: string;
};

export interface ChartMetrics {
  currentPrice: number;
  adr20: number;
  adr20Dollar: number;
  adr20Pct: number;
  extensionFrom50dAdr: number;
  extensionFrom50dPct: number;
  extensionFrom200d: number;
  extensionFrom20d: number;
  macd: string;
  macdTimeframe: string;
  sectorEtf: string;
  sectorEtfChange: number;
  nextEarningsDate: string;
  nextEarningsDays: number;
  marketCap: number;
  pe: number | null;
  beta: number | null;
  debtToEquity: number | null;
  preTaxMargin: number | null;
  analystConsensus: string;
  targetPrice: number | null;
  rsMomentum: number;
  industryPeers: { symbol: string; name: string }[];
  industryName: string;
  companyName: string;
  companyDescription: string;
  sectorName: string;
  epsCurrentQYoY: string;
  salesGrowth3QYoY: string;
  lastEpsSurprise: string;
}

export const formatMarketCap = (mc: number) => {
  if (mc >= 1e12) return `$${(mc / 1e12).toFixed(1)}T`;
  if (mc >= 1e9) return `$${(mc / 1e9).toFixed(1)}B`;
  if (mc >= 1e6) return `$${(mc / 1e6).toFixed(0)}M`;
  return `$${mc.toLocaleString()}`;
};

const UPPER_PANE_H = 40;
const NAV_INFO_H = 76;
const CHART_TOOLBAR_H = 28;
const FUND_H = 70;
const LOWER_PANE_H = 24;
const GAP = 4;

interface DualChartGridProps {
  symbol?: string;
  dailyData: ChartDataResponse | undefined;
  dailyLoading: boolean;
  intradayData: ChartDataResponse | undefined;
  intradayLoading: boolean;
  /** True while a background refetch is in flight; chart stays visible with a light "Updating" hint. */
  intradayFetching?: boolean;
  chartMetrics: ChartMetrics | null | undefined;
  intradayTimeframe: string;
  onIntradayTimeframeChange: (tf: string) => void;
  showETH: boolean;
  onShowETHChange: (show: boolean) => void;
  /**
   * When false (default): hide ETH + MA-basis controls — standard Sentinel Charts UX (RTH intraday only).
   * Beta Charts sets true to expose extended hours.
   */
  showExtendedHoursControls?: boolean;
  /**
   * Only when `showExtendedHoursControls` + ETH on: show MA RTH vs EXT indicator toggle.
   * Big Idea / scans: leave false so extended candles still use server primary (RTH) indicators only.
   */
  showIntradayMaBasisToggle?: boolean;
  onNavigateToTicker?: (ticker: string) => void;
  dailyChartProps?: Record<string, any>;
  intradayChartProps?: Record<string, any>;
  testIdPrefix?: string;
  upperPane?: ReactNode;
  navExtra?: ReactNode;
  lowerPane?: ReactNode;
  alertTradePlanPreview?: {
    mode?: "single" | "per_symbol";
    entry?: number | null;
    stop?: number | null;
    target?: number | null;
  } | null;
  alertWatchlistId?: number | null;
}

function chartHorizontalDrawingsToPriceLines(drawings: DrawingData[]): PriceLevelLine[] {
  return drawings
    .filter((d) => d.toolType === "horizontal" && d.points.p1 && typeof d.points.p1.price === "number")
    .map((d) => ({
      price: d.points.p1!.price,
      color: resolveHorizontalDrawingHex(d.styling?.color),
      label: "",
      lineStyle: clampHorizontalDrawingLineStyle(d.styling?.lineStyle),
      lineWidth: clampHorizontalDrawingWidth(d.styling?.width ?? 1),
    }));
}

function HorizontalLineSettingsPopover({
  drawings,
  selectedId,
  updateStyling,
  testIdPrefix,
}: {
  drawings: DrawingData[];
  selectedId: number | string | null;
  updateStyling: (id: number | string, patch: Partial<NonNullable<DrawingData["styling"]>>) => void;
  testIdPrefix: string;
}) {
  const [saveDefaultLocked, setSaveDefaultLocked] = useState(false);

  const d =
    selectedId != null ? drawings.find((x) => x.id === selectedId) : undefined;
  const isHorizontal = d?.toolType === "horizontal";

  const color =
    isHorizontal && d ? resolveHorizontalDrawingHex(d.styling?.color) : "";
  const width =
    isHorizontal && d ? clampHorizontalDrawingWidth(d.styling?.width) : 1;
  const lineStyle =
    isHorizontal && d
      ? clampHorizontalDrawingLineStyle(d.styling?.lineStyle)
      : ("solid" as HorizontalDrawingLineStyle);

  useEffect(() => {
    setSaveDefaultLocked(false);
  }, [selectedId]);

  if (selectedId == null || !d || !isHorizontal) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="text-white h-7 px-2 gap-1 text-[10px] shrink-0"
          title="Line color & thickness"
          data-testid={`${testIdPrefix}-horiz-line-settings-trigger`}
        >
          <Settings2 className="h-3.5 w-3.5" />
          Settings
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-64 border-border bg-popover text-popover-foreground"
        align="start"
        sideOffset={6}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="space-y-3">
          <div className="text-sm font-medium text-foreground">Horizontal line</div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Color</Label>
            <input
              type="color"
              value={color}
              onChange={(e) => {
                setSaveDefaultLocked(false);
                updateStyling(d.id, { color: e.target.value });
              }}
              className="h-9 w-full cursor-pointer rounded border border-input bg-transparent p-1"
              data-testid={`${testIdPrefix}-horiz-line-color`}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Thickness</Label>
            <Select
              value={String(width)}
              onValueChange={(v) => {
                setSaveDefaultLocked(false);
                updateStyling(d.id, { width: parseInt(v, 10) });
              }}
            >
              <SelectTrigger className="h-8 text-xs" data-testid={`${testIdPrefix}-horiz-line-width`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {([1, 2, 3, 4] as const).map((n) => (
                  <SelectItem key={n} value={String(n)} className="text-xs">
                    {n}px
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Line type</Label>
            <Select
              value={lineStyle}
              onValueChange={(v) => {
                setSaveDefaultLocked(false);
                updateStyling(d.id, { lineStyle: v as HorizontalDrawingLineStyle });
              }}
            >
              <SelectTrigger className="h-8 text-xs" data-testid={`${testIdPrefix}-horiz-line-style`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="solid" className="text-xs">
                  Solid
                </SelectItem>
                <SelectItem value="dashed" className="text-xs">
                  Dashed
                </SelectItem>
                <SelectItem value="dotted" className="text-xs">
                  Dotted
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="w-full text-xs"
              onClick={() => {
                setSaveDefaultLocked(false);
                const def = getHorizontalDrawingDefaults();
                updateStyling(d.id, { color: def.color, width: def.width, lineStyle: def.lineStyle });
              }}
              data-testid={`${testIdPrefix}-horiz-use-default`}
            >
              Use saved default
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full text-xs"
              disabled={saveDefaultLocked}
              title={
                saveDefaultLocked
                  ? "Change color, thickness, or line type to save a new default"
                  : undefined
              }
              onClick={() => {
                setHorizontalDrawingDefaults(color, width, lineStyle);
                setSaveDefaultLocked(true);
              }}
              data-testid={`${testIdPrefix}-horiz-save-default`}
            >
              Save as default for new lines
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function DualChartGrid({
  symbol,
  dailyData,
  dailyLoading,
  intradayData,
  intradayLoading,
  intradayFetching = false,
  chartMetrics,
  intradayTimeframe,
  onIntradayTimeframeChange,
  showETH,
  onShowETHChange,
  showExtendedHoursControls = false,
  showIntradayMaBasisToggle = false,
  onNavigateToTicker,
  dailyChartProps = {},
  intradayChartProps = {},
  testIdPrefix = "",
  upperPane,
  navExtra,
  lowerPane,
  alertTradePlanPreview = null,
  alertWatchlistId = null,
}: DualChartGridProps) {
  const { cssVariables } = useSystemSettings();
  const containerRef = useRef<HTMLDivElement>(null);
  const [chartHeight, setChartHeight] = useState(300);
  const [dailyMeasureMode, setDailyMeasureMode] = useState(false);
  const [intradayMeasureMode, setIntradayMeasureMode] = useState(false);
  const [maSettingsOpen, setMaSettingsOpen] = useState(false);
  const [showGaps, setShowGaps] = useState(false);
  /** When ETH candles are on: RTH = server primary (regular-session math, forward-filled), EXT = all bars in MA/VWAP. */
  const [intradayMaBasis, setIntradayMaBasis] = useState<"rth" | "extended">("rth");
  const [alertDialogOpen, setAlertDialogOpen] = useState(false);

  const dailyChartRef = useRef<IChartApi | null>(null);
  const dailySeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const intradayChartRef = useRef<IChartApi | null>(null);
  const intradaySeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  const dailyDrawings = useChartDrawings({
    ticker: symbol || "",
    timeframe: "daily",
    chartRef: dailyChartRef,
    seriesRef: dailySeriesRef,
    enabled: !!symbol && !!dailyData,
  });

  const intradayDrawings = useChartDrawings({
    ticker: symbol || "",
    timeframe: intradayTimeframe,
    chartRef: intradayChartRef,
    seriesRef: intradaySeriesRef,
    enabled: !!symbol && !!intradayData,
  });

  const mergedDailyChartProps = useMemo(() => {
    const base = dailyChartProps ?? {};
    const fromDrawings = chartHorizontalDrawingsToPriceLines(dailyDrawings.drawings);
    const pl = [...(base.priceLines ?? []), ...fromDrawings];
    return { ...base, priceLines: pl };
  }, [dailyChartProps, dailyDrawings.drawings]);

  const mergedIntradayChartProps = useMemo(() => {
    const base = intradayChartProps ?? {};
    const fromDrawings = chartHorizontalDrawingsToPriceLines(intradayDrawings.drawings);
    const pl = [...(base.priceLines ?? []), ...fromDrawings];
    return { ...base, priceLines: pl };
  }, [intradayChartProps, intradayDrawings.drawings]);

  const { data: maSettingsData } = useQuery<any[]>({
    queryKey: ["/api/sentinel/ma-settings"],
  });

  const { data: chartPrefs } = useQuery<{
    defaultBarsOnScreen: number;
    dataLimitDaily?: number;
    dataLimit5min?: number;
    dataLimit15min?: number;
    dataLimit30min?: number;
  }>({
    queryKey: ["/api/sentinel/chart-preferences"],
  });

  const maxBars = chartPrefs?.defaultBarsOnScreen ?? 200;

  const maDataLimits: ChartMaDataLimits = useMemo(
    () => ({
      dataLimitDaily: chartPrefs?.dataLimitDaily ?? DEFAULT_CHART_MA_LIMITS.dataLimitDaily,
      dataLimit5min: chartPrefs?.dataLimit5min ?? DEFAULT_CHART_MA_LIMITS.dataLimit5min,
      dataLimit15min: chartPrefs?.dataLimit15min ?? DEFAULT_CHART_MA_LIMITS.dataLimit15min,
      dataLimit30min: chartPrefs?.dataLimit30min ?? DEFAULT_CHART_MA_LIMITS.dataLimit30min,
    }),
    [
      chartPrefs?.dataLimitDaily,
      chartPrefs?.dataLimit5min,
      chartPrefs?.dataLimit15min,
      chartPrefs?.dataLimit30min,
    ]
  );

  useEffect(() => {
    if (!showETH) setIntradayMaBasis("rth");
  }, [showETH]);

  useEffect(() => {
    const measure = () => {
      if (!containerRef.current) return;
      const totalH = containerRef.current.clientHeight;
      const hasUpper = !!upperPane;
      const hasLower = !!lowerPane;
      const fixedH =
        (hasUpper ? UPPER_PANE_H + GAP : 0) +
        NAV_INFO_H + GAP +
        CHART_TOOLBAR_H +
        FUND_H + GAP +
        (hasLower ? LOWER_PANE_H + GAP : 0) +
        GAP * 2;
      const available = totalH - fixedH;
      setChartHeight(Math.max(150, available));
    };
    const timer = setTimeout(measure, 50);
    const observer = new ResizeObserver(() => requestAnimationFrame(measure));
    if (containerRef.current) observer.observe(containerRef.current);
    return () => { clearTimeout(timer); observer.disconnect(); };
  }, [!!upperPane, !!lowerPane]);

  const effectiveIntradayData = useMemo(() => {
    if (!intradayData) return null;
    const useExt =
      showIntradayMaBasisToggle &&
      showETH &&
      intradayMaBasis === "extended" &&
      intradayData.indicatorsExtended;
    const indicators = useExt ? intradayData.indicatorsExtended! : intradayData.indicators;
    return { ...intradayData, indicators };
  }, [intradayData, showIntradayMaBasisToggle, showETH, intradayMaBasis]);

  const intradayTickerMismatch = useMemo(() => {
    if (!symbol || !intradayData?.ticker) return false;
    return intradayData.ticker.toUpperCase() !== symbol.toUpperCase();
  }, [symbol, intradayData?.ticker]);

  const intradayBlockingLoad =
    !!symbol && ((intradayLoading && !intradayData) || intradayTickerMismatch);

  const [intradayLoadSec, setIntradayLoadSec] = useState(0);
  useEffect(() => {
    if (!intradayBlockingLoad) {
      setIntradayLoadSec(0);
      return;
    }
    const t0 = Date.now();
    setIntradayLoadSec(0);
    const id = window.setInterval(() => {
      setIntradayLoadSec(Math.floor((Date.now() - t0) / 1000));
    }, 500);
    return () => window.clearInterval(id);
  }, [intradayBlockingLoad, symbol, intradayTimeframe]);

  const [intradayFetchSec, setIntradayFetchSec] = useState(0);
  useEffect(() => {
    if (!intradayFetching) {
      setIntradayFetchSec(0);
      return;
    }
    const t0 = Date.now();
    setIntradayFetchSec(0);
    const id = window.setInterval(() => {
      setIntradayFetchSec(Math.floor((Date.now() - t0) / 1000));
    }, 500);
    return () => window.clearInterval(id);
  }, [intradayFetching, symbol, intradayTimeframe, showETH]);

  const dayChange = useMemo(() => {
    if (!dailyData || dailyData.candles.length < 2) return null;
    const last = dailyData.candles[dailyData.candles.length - 1];
    const prev = dailyData.candles[dailyData.candles.length - 2];
    const change = last.close - prev.close;
    const changePct = (change / prev.close) * 100;
    return { price: last.close, change, changePct };
  }, [dailyData]);

  const handleTickerNav = useCallback((ticker: string) => {
    if (onNavigateToTicker) {
      onNavigateToTicker(ticker);
    } else {
      window.location.href = `/sentinel/charts?ticker=${ticker}`;
    }
  }, [onNavigateToTicker]);

  const pid = testIdPrefix ? `${testIdPrefix}-` : "";

  const displayPrice = dayChange?.price ?? 0;
  const priceChange = dayChange?.change ?? 0;
  const pricePctChange = dayChange?.changePct ?? 0;
  const isPriceUp = priceChange >= 0;

  return (
    <div ref={containerRef} className="flex flex-col flex-1 min-h-0" data-testid={`${pid}dual-chart-container`}>
      {upperPane && (
        <div className="flex-shrink-0 overflow-hidden" style={{ height: UPPER_PANE_H }} data-testid={`${pid}upper-pane`}>
          {upperPane}
        </div>
      )}

      <div className="flex-shrink-0 overflow-hidden grid grid-cols-2 gap-3" style={{ height: NAV_INFO_H, marginTop: upperPane ? GAP : 0 }} data-testid={`${pid}nav-info-row`}>
        <div className="flex items-center gap-2 overflow-hidden" data-testid={`${pid}nav-pane`}>
          <div className="flex items-center gap-2 px-3 py-1 rounded-md border border-border bg-card flex-shrink-0">
            <span className="font-mono font-bold text-lg" style={{ color: cssVariables.textColorHeader }} data-testid="text-chart-symbol">{symbol || "—"}</span>
            <span style={{ color: cssVariables.textColorTiny }}>|</span>
            {dailyData ? (
              <>
                <span className="font-mono font-semibold text-lg" style={{ color: cssVariables.textColorHeader }} data-testid="text-chart-price">${displayPrice.toFixed(2)}</span>
                <span style={{ color: cssVariables.textColorTiny }}>|</span>
                <span className={`font-mono font-bold text-lg ${isPriceUp ? "text-rs-green" : "text-rs-red"}`} data-testid="text-chart-change">{isPriceUp ? "+" : ""}{priceChange.toFixed(2)}</span>
                <span style={{ color: cssVariables.textColorTiny }}>|</span>
                <span className={`font-mono font-bold text-lg ${isPriceUp ? "text-rs-green" : "text-rs-red"}`} data-testid="text-chart-pct">{isPriceUp ? "+" : ""}{pricePctChange.toFixed(2)}%</span>
              </>
            ) : (
              <span className="font-mono text-lg text-muted-foreground animate-pulse">—</span>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 flex-shrink-0"
            onClick={() => setAlertDialogOpen(true)}
            disabled={!symbol}
            data-testid={`${pid}button-chart-alert`}
          >
            <Bell className="w-4 h-4" />
            Chart Alert
          </Button>
          {navExtra}
        </div>

        <div className="flex items-stretch gap-2 overflow-hidden flex-1" data-testid={`${pid}info-pane`}>
          {chartMetrics ? (
            <>
              {/* Left frame: Company info */}
              <div className="flex flex-col justify-center gap-0 px-2 py-1 rounded border border-border/50 bg-card/50 flex-shrink-0 min-w-0" style={{ maxWidth: '220px' }}>
                <div className="flex items-center gap-1.5 overflow-hidden">
                  <span className="font-bold" style={{ color: cssVariables.textColorHeader, fontSize: cssVariables.fontSizeSmall }}>{symbol}</span>
                  <span style={{ color: cssVariables.textColorTiny }}>|</span>
                  <span className="font-semibold truncate" style={{ color: cssVariables.textColorHeader, fontSize: cssVariables.fontSizeSmall }}>{chartMetrics.companyName || '—'}</span>
                </div>
                <div className="flex items-center gap-1.5 overflow-hidden">
                  {chartMetrics.industryName && chartMetrics.industryName !== "Unknown" && (
                    <span className="truncate" style={{ color: cssVariables.textColorSmall, fontSize: cssVariables.fontSizeTiny }}>{chartMetrics.industryName}</span>
                  )}
                  {chartMetrics.industryName && chartMetrics.industryName !== "Unknown" && chartMetrics.sectorName && (
                    <span style={{ color: cssVariables.textColorTiny, fontSize: cssVariables.fontSizeTiny }}>|</span>
                  )}
                  {chartMetrics.sectorName && (
                    <span className="truncate" style={{ color: cssVariables.textColorSmall, fontSize: cssVariables.fontSizeTiny }}>{chartMetrics.sectorName}</span>
                  )}
                </div>
              </div>
              {/* Right frame: Description */}
              {chartMetrics.companyDescription && (
                <div className="flex-1 flex items-center px-2 py-1 rounded border border-border/50 bg-card/50 min-w-0 overflow-hidden">
                  <p className="line-clamp-2 overflow-hidden leading-tight" style={{ color: cssVariables.textColorSmall, fontSize: cssVariables.fontSizeTiny }} title={chartMetrics.companyDescription}>
                    {chartMetrics.companyDescription}
                  </p>
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 overflow-hidden" style={{ height: chartHeight + CHART_TOOLBAR_H, marginTop: GAP }}>
        <div className="flex flex-col min-h-0 overflow-hidden">
          <div className="flex items-center gap-2 px-1 flex-shrink-0 rounded-md" style={{ height: CHART_TOOLBAR_H, backgroundColor: cssVariables.overlayBg }}>
            <span className="text-xs text-white font-medium">Daily</span>
            <Button
              size="sm"
              variant="ghost"
              className={`text-white toggle-elevate ${dailyMeasureMode ? "toggle-elevated bg-white/15" : ""}`}
              onClick={() => { setDailyMeasureMode(m => !m); dailyDrawings.setActiveTool(null); }}
              style={dailyMeasureMode ? { boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.3)' } : undefined}
              data-testid={`${pid}button-daily-measure-mode`}
            >
              <Ruler className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className={`text-white toggle-elevate ${dailyDrawings.activeTool === "horizontal" ? "toggle-elevated bg-white/15" : ""}`}
              onClick={() => { dailyDrawings.setActiveTool(dailyDrawings.activeTool === "horizontal" ? null : "horizontal"); setDailyMeasureMode(false); }}
              style={dailyDrawings.activeTool === "horizontal" ? { boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.3)' } : undefined}
              data-testid={`${pid}button-daily-horizontal-line`}
              title="Horizontal Line"
            >
              <Minus className="h-3.5 w-3.5" />
            </Button>
            <HorizontalLineSettingsPopover
              drawings={dailyDrawings.drawings}
              selectedId={dailyDrawings.selectedId}
              updateStyling={dailyDrawings.updateDrawingStyling}
              testIdPrefix={`${pid}daily`}
            />
            <Button
              size="sm"
              variant="ghost"
              className={`text-white toggle-elevate text-[10px] px-2 ${showGaps ? "toggle-elevated bg-white/15" : ""}`}
              onClick={() => setShowGaps(!showGaps)}
              style={showGaps ? { boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.3)' } : undefined}
              data-testid={`${pid}button-toggle-gaps`}
              title="Support/Resistance Gaps"
            >
              S/R Gaps
            </Button>
            {dailyDrawings.drawings.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="text-white"
                onClick={() => dailyDrawings.clearAll()}
                data-testid={`${pid}button-daily-clear-drawings`}
                title="Clear All Drawings"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          <div className="flex-1 min-h-0">
            {dailyLoading ? (
              <Card className="h-full">
                <CardContent className="flex items-center justify-center h-full">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </CardContent>
              </Card>
            ) : dailyData ? (
              <TradingChart
                data={dailyData}
                timeframe="daily"
                height={chartHeight}
                showLegend={true}
                showGaps={showGaps}
                maSettings={maSettingsData}
                maDataLimits={maDataLimits}
                maxBars={maxBars}
                measureMode={dailyMeasureMode}
                drawingToolActive={dailyDrawings.activeTool}
                onChartReady={(chart, series) => {
                  dailyChartRef.current = chart;
                  dailySeriesRef.current = series;
                  dailyDrawings.syncPrimitivesToChart();
                }}
                onChartClick={dailyDrawings.handleChartClick}
                onChartMouseDown={dailyDrawings.handleMouseDown}
                onChartCrosshairMove={dailyDrawings.handleMouseMove}
                onChartMouseUp={dailyDrawings.handleMouseUp}
                {...mergedDailyChartProps}
              />
            ) : (
              <Card className="h-full">
                <CardContent className="flex items-center justify-center h-full text-muted-foreground text-sm">
                  No daily data
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        <div className="flex flex-col min-h-0 overflow-hidden">
          <div className="flex items-center gap-2 px-1 flex-shrink-0 rounded-md" style={{ height: CHART_TOOLBAR_H, backgroundColor: cssVariables.overlayBg }}>
            <span className="text-xs text-white font-medium">Intraday</span>
            <Select value={intradayTimeframe} onValueChange={onIntradayTimeframeChange}>
              <SelectTrigger className="h-6 w-20 text-[10px]" data-testid={`${pid}select-intraday-timeframe`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="5min">5m</SelectItem>
                <SelectItem value="15min">15m</SelectItem>
                <SelectItem value="30min">30m</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="ghost"
              className="text-white"
              onClick={() => setMaSettingsOpen(true)}
              data-testid={`${pid}button-ma-settings`}
            >
              <IndicatorsFourSquaresIcon className="text-current" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className={`text-white toggle-elevate ${intradayMeasureMode ? "toggle-elevated bg-white/15" : ""}`}
              onClick={() => { setIntradayMeasureMode(m => !m); intradayDrawings.setActiveTool(null); }}
              style={intradayMeasureMode ? { boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.3)' } : undefined}
              data-testid={`${pid}button-intraday-measure-mode`}
            >
              <Ruler className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className={`text-white toggle-elevate ${intradayDrawings.activeTool === "horizontal" ? "toggle-elevated bg-white/15" : ""}`}
              onClick={() => { intradayDrawings.setActiveTool(intradayDrawings.activeTool === "horizontal" ? null : "horizontal"); setIntradayMeasureMode(false); }}
              style={intradayDrawings.activeTool === "horizontal" ? { boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.3)' } : undefined}
              data-testid={`${pid}button-intraday-horizontal-line`}
              title="Horizontal Line"
            >
              <Minus className="h-3.5 w-3.5" />
            </Button>
            <HorizontalLineSettingsPopover
              drawings={intradayDrawings.drawings}
              selectedId={intradayDrawings.selectedId}
              updateStyling={intradayDrawings.updateDrawingStyling}
              testIdPrefix={`${pid}intraday`}
            />
            {intradayDrawings.drawings.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="text-white"
                onClick={() => intradayDrawings.clearAll()}
                data-testid={`${pid}button-intraday-clear-drawings`}
                title="Clear All Drawings"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
            {showExtendedHoursControls && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  className={`text-white text-[10px] font-semibold toggle-elevate ${showETH ? "toggle-elevated bg-white/15" : ""}`}
                  onClick={() => startTransition(() => onShowETHChange(!showETH))}
                  style={showETH ? { boxShadow: "inset 0 2px 4px rgba(0,0,0,0.3)" } : undefined}
                  data-testid={`${pid}button-intraday-eth-toggle`}
                  title="Show pre-market and after-hours candles (data from Alpaca extended hours)"
                >
                  ETH
                </Button>
                {showIntradayMaBasisToggle &&
                  showETH &&
                  intradayData?.indicatorsExtended && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className={`text-white text-[10px] font-semibold toggle-elevate ${intradayMaBasis === "extended" ? "toggle-elevated bg-white/15" : ""}`}
                    onClick={() =>
                      startTransition(() =>
                        setIntradayMaBasis((b) => (b === "rth" ? "extended" : "rth"))
                      )
                    }
                    style={
                      intradayMaBasis === "extended"
                        ? { boxShadow: "inset 0 2px 4px rgba(0,0,0,0.3)" }
                        : undefined
                    }
                    data-testid={`${pid}button-intraday-ma-basis-toggle`}
                    title="RTH: MAs/VWAP use regular session only (forward-filled on ETH bars). EXT: indicators include all extended-hours bars."
                  >
                    MA {intradayMaBasis === "rth" ? "RTH" : "EXT"}
                  </Button>
                )}
              </>
            )}
          </div>
          <div className="flex-1 min-h-0 relative">
            {intradayBlockingLoad ? (
              <Card className="h-full">
                <CardContent className="flex flex-col items-center justify-center gap-2 h-full text-muted-foreground text-sm">
                  <Loader2 className="w-6 h-6 animate-spin" />
                  <span className="text-center px-2" data-testid={`${pid}intraday-loading-label`}>
                    Loading {intradayTimeframe} for {symbol}… {intradayLoadSec}s
                  </span>
                </CardContent>
              </Card>
            ) : effectiveIntradayData ? (
              <>
                <TradingChart
                  key={`${symbol ?? ""}-${intradayTimeframe}-${showETH ? 1 : 0}`}
                  data={effectiveIntradayData}
                  timeframe={intradayTimeframe}
                  height={chartHeight}
                  showLegend={true}
                  maSettings={maSettingsData}
                  maDataLimits={maDataLimits}
                  maxBars={maxBars}
                  measureMode={intradayMeasureMode}
                  drawingToolActive={intradayDrawings.activeTool}
                  onChartReady={(chart, series) => {
                    intradayChartRef.current = chart;
                    intradaySeriesRef.current = series;
                    intradayDrawings.syncPrimitivesToChart();
                  }}
                  onChartClick={intradayDrawings.handleChartClick}
                  onChartMouseDown={intradayDrawings.handleMouseDown}
                  onChartCrosshairMove={intradayDrawings.handleMouseMove}
                  onChartMouseUp={intradayDrawings.handleMouseUp}
                  {...mergedIntradayChartProps}
                  whiteExtendedHoursCandles={showETH}
                />
                {intradayFetching ? (
                  <div
                    className="pointer-events-none absolute top-2 right-2 z-10 flex items-center gap-1.5 rounded-md border border-white/15 bg-black/55 px-2 py-1 text-[11px] text-white/90 shadow-md backdrop-blur-sm"
                    data-testid={`${pid}intraday-fetching-hint`}
                  >
                    <Loader2 className="h-3 w-3 animate-spin opacity-80" />
                    Updating…{intradayFetchSec > 0 ? ` ${intradayFetchSec}s` : ""}
                  </div>
                ) : null}
              </>
            ) : (
              <Card className="h-full">
                <CardContent className="flex items-center justify-center h-full text-muted-foreground text-sm">
                  No intraday data
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

      <div className="flex-shrink-0 grid grid-cols-2 gap-3 overflow-visible" style={{ height: FUND_H, marginTop: GAP }} data-testid={`${pid}fundamentals-row`}>
        <div className="border border-border rounded p-2 grid grid-cols-5 gap-x-4 gap-y-1 overflow-visible bg-background" data-testid={`${pid}daily-metrics-strip`}>
          {chartMetrics ? (<>
          <div><span className="text-[10px] whitespace-nowrap text-gray-400">Market Cap</span><div className="text-xs font-medium text-white" data-testid={`${pid}metric-market-cap`}>{formatMarketCap(chartMetrics.marketCap)}</div></div>
          <div><span className="text-[10px] whitespace-nowrap text-gray-400">Sales Growth 3Q YoY</span><div className="text-xs font-medium text-white" data-testid={`${pid}metric-sales-growth`}>{chartMetrics.salesGrowth3QYoY}</div></div>
          <div><span className="text-[10px] whitespace-nowrap text-gray-400">EPS Current Q YoY</span><div className="text-xs font-medium text-white" data-testid={`${pid}metric-eps-yoy`}>{chartMetrics.epsCurrentQYoY}</div></div>
          <div><span className="text-[10px] whitespace-nowrap text-gray-400">Next Earnings</span><div className={`text-xs font-medium ${chartMetrics.nextEarningsDays >= 0 && chartMetrics.nextEarningsDays <= 7 ? "text-rs-yellow" : "text-white"}`} data-testid={`${pid}metric-next-earnings`}>{chartMetrics.nextEarningsDate !== "N/A" ? `${chartMetrics.nextEarningsDate} (${chartMetrics.nextEarningsDays}d)` : "N/A"}</div></div>
          <div><span className="text-[10px] whitespace-nowrap text-gray-400">Analyst Consensus</span><div className="text-xs font-medium text-white" data-testid={`${pid}metric-analyst-consensus`}>{chartMetrics.analystConsensus}</div></div>
          <div><span className="text-[10px] whitespace-nowrap text-gray-400">PE</span><div className="text-xs font-medium text-white" data-testid={`${pid}metric-pe`}>{chartMetrics.pe != null ? chartMetrics.pe.toFixed(1) : "N/A"}</div></div>
          <div><span className="text-[10px] whitespace-nowrap text-gray-400">Pre-Tax Margin</span><div className="text-xs font-medium text-white" data-testid={`${pid}metric-pretax-margin`}>{chartMetrics.preTaxMargin != null ? `${chartMetrics.preTaxMargin.toFixed(1)}%` : "N/A"}</div></div>
          <div><span className="text-[10px] whitespace-nowrap text-gray-400">Last EPS Surprise</span><div className="text-xs font-medium text-white" data-testid={`${pid}metric-eps-surprise`}>{chartMetrics.lastEpsSurprise}</div></div>
          <div><span className="text-[10px] whitespace-nowrap text-gray-400">Debt/Equity</span><div className="text-xs font-medium text-white" data-testid={`${pid}metric-debt-equity`}>{chartMetrics.debtToEquity != null ? chartMetrics.debtToEquity.toFixed(2) : "N/A"}</div></div>
          <div><span className="text-[10px] whitespace-nowrap text-gray-400">Target Price</span><div className="text-xs font-medium text-white" data-testid={`${pid}metric-target-price`}>{chartMetrics.targetPrice != null ? `$${chartMetrics.targetPrice.toFixed(2)}` : "N/A"}</div></div>
          </>) : null}
        </div>
        <div className="border border-border rounded p-2 grid grid-cols-4 gap-x-4 gap-y-1 overflow-visible bg-background" data-testid={`${pid}intraday-metrics-strip`}>
          {chartMetrics ? (<>
          <div><span className="text-[10px] whitespace-nowrap text-gray-400">ADR(20) $</span><div className="text-xs font-medium text-white" data-testid={`${pid}metric-adr20-dollar`}>${chartMetrics.adr20Dollar?.toFixed(2) ?? chartMetrics.adr20}</div></div>
          <div><span className="text-[10px] whitespace-nowrap text-gray-400">50d Ext (ADR)</span><div className={`text-xs font-medium ${chartMetrics.extensionFrom50dAdr >= 0 ? "text-rs-green" : "text-rs-red"}`} data-testid={`${pid}metric-50d-ext-adr`}>{chartMetrics.extensionFrom50dAdr >= 0 ? "+" : ""}{chartMetrics.extensionFrom50dAdr}x</div></div>
          <div><span className="text-[10px] whitespace-nowrap text-gray-400">MACD ({chartMetrics.macdTimeframe})</span><div className={`text-xs font-medium ${chartMetrics.macd === "Open" ? "text-rs-green" : chartMetrics.macd === "Closed" ? "text-rs-red" : "text-white"}`} data-testid={`${pid}metric-macd`}>{chartMetrics.macd}</div></div>
          <div><span className="text-[10px] whitespace-nowrap text-gray-400">Sector</span><div className="text-xs font-medium" data-testid={`${pid}metric-sector-etf`}>{chartMetrics.sectorEtf !== "N/A" ? (<><span className="cursor-pointer underline decoration-dotted text-white" onClick={() => handleTickerNav(chartMetrics.sectorEtf)} data-testid={`${pid}link-sector-etf`}>{chartMetrics.sectorEtf}</span><span className={`ml-1 ${chartMetrics.sectorEtfChange >= 0 ? "text-rs-green" : "text-rs-red"}`}>{chartMetrics.sectorEtfChange >= 0 ? "+" : ""}{chartMetrics.sectorEtfChange}%</span></>) : <span className="text-gray-500">N/A</span>}</div></div>
          <div><span className="text-[10px] whitespace-nowrap text-gray-400">ADR(20) %</span><div className="text-xs font-medium text-white" data-testid={`${pid}metric-adr20-pct`}>{chartMetrics.adr20Pct?.toFixed(1) ?? "N/A"}%</div></div>
          <div><span className="text-[10px] whitespace-nowrap text-gray-400">20d Ext %</span><div className={`text-xs font-medium ${(chartMetrics.extensionFrom20d ?? 0) >= 0 ? "text-rs-green" : "text-rs-red"}`} data-testid={`${pid}metric-20d-ext`}>{(chartMetrics.extensionFrom20d ?? 0) >= 0 ? "+" : ""}{chartMetrics.extensionFrom20d ?? 0}%</div></div>
          <div><span className="text-[10px] whitespace-nowrap text-gray-400">RS Momentum</span><div className={`text-xs font-medium ${(chartMetrics.rsMomentum ?? 0) >= 0 ? "text-rs-green" : "text-rs-red"}`} data-testid={`${pid}metric-rs-momentum`}>{chartMetrics.rsMomentum ?? "N/A"}</div></div>
          <div className="col-span-1"><span className="text-[10px] whitespace-nowrap text-gray-400">Peers ({chartMetrics.industryName || "Industry"})</span><div className="text-xs font-medium text-white" data-testid={`${pid}metric-industry-peers`}>{chartMetrics.industryPeers?.length > 0 ? chartMetrics.industryPeers.slice(0, 5).map((p, i) => (<span key={p.symbol}>{i > 0 && ", "}<span className="cursor-pointer underline decoration-dotted" onClick={() => handleTickerNav(p.symbol)} data-testid={`${pid}link-peer-${p.symbol}`}>{p.symbol}</span></span>)) : "N/A"}</div></div>
          </>) : null}
        </div>
      </div>

      {lowerPane && (
        <div className="flex-shrink-0 overflow-hidden" style={{ height: LOWER_PANE_H, marginTop: GAP }} data-testid={`${pid}lower-pane`}>
          {lowerPane}
        </div>
      )}

      <MaSettingsDialog open={maSettingsOpen} onOpenChange={setMaSettingsOpen} />
      {symbol && (
        <AlertBuilderDialog
          open={alertDialogOpen}
          onOpenChange={setAlertDialogOpen}
          suggestedName={`${symbol} chart alert`}
          tradePlanPreview={alertTradePlanPreview}
          targetScope={{
            mode: "single_symbol",
            targetType: "symbol",
            sourceClient: "chart",
            label: symbol,
            symbol,
            watchlistId: alertWatchlistId ?? undefined,
          }}
        />
      )}
    </div>
  );
}
