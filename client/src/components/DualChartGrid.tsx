import { useState, useEffect, useRef, useMemo, useCallback, type ReactNode } from "react";
import { TradingChart, ChartCandle, ChartIndicators } from "@/components/TradingChart";
import { MaSettingsDialog } from "@/components/MaSettingsDialog";
import { useSystemSettings } from "@/context/SystemSettingsContext";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Settings2, Ruler } from "lucide-react";

export type ChartDataResponse = { candles: ChartCandle[]; indicators: ChartIndicators; ticker: string; timeframe: string };

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
const FUND_H = 58;
const LOWER_PANE_H = 24;
const GAP = 4;

interface DualChartGridProps {
  symbol?: string;
  dailyData: ChartDataResponse | undefined;
  dailyLoading: boolean;
  intradayData: ChartDataResponse | undefined;
  intradayLoading: boolean;
  chartMetrics: ChartMetrics | null | undefined;
  intradayTimeframe: string;
  onIntradayTimeframeChange: (tf: string) => void;
  showETH: boolean;
  onShowETHChange: (show: boolean) => void;
  onNavigateToTicker?: (ticker: string) => void;
  dailyChartProps?: Record<string, any>;
  intradayChartProps?: Record<string, any>;
  testIdPrefix?: string;
  upperPane?: ReactNode;
  navExtra?: ReactNode;
  lowerPane?: ReactNode;
}

const TrendLineIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
    <line x1="2" y1="12" x2="12" y2="2" stroke="currentColor" strokeWidth="1.5"/>
    <circle cx="2" cy="12" r="1.5" fill="currentColor"/>
    <circle cx="12" cy="2" r="1.5" fill="currentColor"/>
  </svg>
);

export function DualChartGrid({
  symbol,
  dailyData,
  dailyLoading,
  intradayData,
  intradayLoading,
  chartMetrics,
  intradayTimeframe,
  onIntradayTimeframeChange,
  showETH,
  onShowETHChange,
  onNavigateToTicker,
  dailyChartProps = {},
  intradayChartProps = {},
  testIdPrefix = "",
  upperPane,
  navExtra,
  lowerPane,
}: DualChartGridProps) {
  const { cssVariables } = useSystemSettings();
  const containerRef = useRef<HTMLDivElement>(null);
  const [chartHeight, setChartHeight] = useState(300);
  const [dailyMeasureMode, setDailyMeasureMode] = useState(false);
  const [intradayMeasureMode, setIntradayMeasureMode] = useState(false);
  const [dailyTrendLineMode, setDailyTrendLineMode] = useState(false);
  const [intradayTrendLineMode, setIntradayTrendLineMode] = useState(false);
  const [maSettingsOpen, setMaSettingsOpen] = useState(false);

  const { data: maSettingsData } = useQuery<any[]>({
    queryKey: ["/api/sentinel/ma-settings"],
  });

  const { data: chartPrefs } = useQuery<{ defaultBarsOnScreen: number }>({
    queryKey: ["/api/sentinel/chart-preferences"],
  });

  const maxBars = chartPrefs?.defaultBarsOnScreen ?? 200;

  const rthData = useMemo(() => {
    if (!intradayData) return null;
    const rthFmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit", minute: "2-digit",
      hour12: false,
    });
    const rthIndices: number[] = [];
    intradayData.candles.forEach((c, i) => {
      const parts = rthFmt.formatToParts(new Date(c.timestamp * 1000));
      let etH = parseInt(parts.find(p => p.type === "hour")?.value || "0", 10);
      if (etH === 24) etH = 0;
      const etM = parseInt(parts.find(p => p.type === "minute")?.value || "0", 10);
      const totalMin = etH * 60 + etM;
      if (totalMin >= 570 && totalMin < 960) rthIndices.push(i);
    });
    if (rthIndices.length === 0) return intradayData;
    const rthResult: ChartDataResponse = {
      ...intradayData,
      candles: rthIndices.map(i => intradayData.candles[i]),
      indicators: {
        ema5: rthIndices.map(i => intradayData.indicators.ema5[i] ?? null),
        ema10: rthIndices.map(i => intradayData.indicators.ema10[i] ?? null),
        sma21: rthIndices.map(i => intradayData.indicators.sma21[i] ?? null),
        sma50: rthIndices.map(i => intradayData.indicators.sma50[i] ?? null),
        sma200: rthIndices.map(i => intradayData.indicators.sma200[i] ?? null),
        vwap: intradayData.indicators.vwap ? rthIndices.map(i => intradayData.indicators.vwap![i] ?? null) : undefined,
        avwapHigh: intradayData.indicators.avwapHigh ? rthIndices.map(i => intradayData.indicators.avwapHigh![i] ?? null) : undefined,
        avwapLow: intradayData.indicators.avwapLow ? rthIndices.map(i => intradayData.indicators.avwapLow![i] ?? null) : undefined,
      },
    };
    return rthResult;
  }, [intradayData]);

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

  const effectiveIntradayData = showETH ? intradayData : rthData;

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
          {navExtra}
        </div>

        <div className="flex items-start gap-1.5 overflow-hidden" data-testid={`${pid}info-pane`}>
          {chartMetrics ? (
            <div className="flex flex-col gap-0.5 overflow-hidden">
              <div className="flex items-center gap-1.5 overflow-hidden flex-wrap">
                {chartMetrics.companyName && <span className="font-semibold truncate" style={{ color: cssVariables.textColorHeader, fontSize: cssVariables.fontSizeHeader }}>{chartMetrics.companyName}</span>}
              </div>
              <div className="flex items-center gap-1.5 overflow-hidden flex-wrap">
                {chartMetrics.sectorName && <span className="flex-shrink-0" style={{ color: cssVariables.textColorSmall, fontSize: cssVariables.fontSizeSmall }}>{chartMetrics.sectorName}</span>}
                {chartMetrics.sectorName && chartMetrics.industryName && <span className="flex-shrink-0" style={{ color: cssVariables.textColorTiny, fontSize: cssVariables.fontSizeTiny }}>/</span>}
                {chartMetrics.industryName && chartMetrics.industryName !== "Unknown" && <span className="flex-shrink-0" style={{ color: cssVariables.textColorSmall, fontSize: cssVariables.fontSizeSmall }}>{chartMetrics.industryName}</span>}
              </div>
              {chartMetrics.companyDescription && (
                <p className="line-clamp-2 overflow-hidden leading-tight" style={{ color: cssVariables.textColorTiny, fontSize: cssVariables.fontSizeTiny }} title={chartMetrics.companyDescription}>
                  {chartMetrics.companyDescription}
                </p>
              )}
            </div>
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
              onClick={() => setDailyMeasureMode(m => !m)}
              style={dailyMeasureMode ? { boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.3)' } : undefined}
              data-testid={`${pid}button-daily-measure-mode`}
            >
              <Ruler className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className={`text-white toggle-elevate ${dailyTrendLineMode ? "toggle-elevated bg-white/15" : ""}`}
              onClick={() => setDailyTrendLineMode(m => !m)}
              style={dailyTrendLineMode ? { boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.3)' } : undefined}
              data-testid={`${pid}button-daily-trend-line-mode`}
            >
              <TrendLineIcon />
            </Button>
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
                maSettings={maSettingsData}
                maxBars={maxBars}
                measureMode={dailyMeasureMode}
                trendLineMode={dailyTrendLineMode}
                {...dailyChartProps}
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
              <Settings2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className={`text-white toggle-elevate ${intradayMeasureMode ? "toggle-elevated bg-white/15" : ""}`}
              onClick={() => setIntradayMeasureMode(m => !m)}
              style={intradayMeasureMode ? { boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.3)' } : undefined}
              data-testid={`${pid}button-intraday-measure-mode`}
            >
              <Ruler className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className={`text-white toggle-elevate ${intradayTrendLineMode ? "toggle-elevated bg-white/15" : ""}`}
              onClick={() => setIntradayTrendLineMode(m => !m)}
              style={intradayTrendLineMode ? { boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.3)' } : undefined}
              data-testid={`${pid}button-intraday-trend-line-mode`}
            >
              <TrendLineIcon />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className={`text-white text-[10px] font-semibold toggle-elevate ${showETH ? "toggle-elevated bg-white/15" : ""}`}
              onClick={() => onShowETHChange(!showETH)}
              style={showETH ? { boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.3)' } : undefined}
              data-testid={`${pid}button-intraday-eth-toggle`}
            >
              ETH
            </Button>
          </div>
          <div className="flex-1 min-h-0">
            {intradayLoading ? (
              <Card className="h-full">
                <CardContent className="flex items-center justify-center h-full">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </CardContent>
              </Card>
            ) : effectiveIntradayData ? (
              <TradingChart
                data={effectiveIntradayData}
                timeframe={intradayTimeframe}
                height={chartHeight}
                showLegend={true}
                showDayDividers={true}
                maSettings={maSettingsData}
                maxBars={maxBars}
                measureMode={intradayMeasureMode}
                trendLineMode={intradayTrendLineMode}
                {...intradayChartProps}
              />
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

      <div className="flex-shrink-0 grid grid-cols-2 gap-3 overflow-hidden" style={{ height: FUND_H, marginTop: GAP }} data-testid={`${pid}fundamentals-row`}>
        <div className="border border-border rounded p-2 grid grid-cols-5 gap-x-4 gap-y-1 overflow-hidden" data-testid={`${pid}daily-metrics-strip`}>
          {chartMetrics ? (<>
          <div className="overflow-hidden"><span className="text-[10px] whitespace-nowrap" style={{ color: cssVariables.textColorTiny }}>Market Cap</span><div className="text-xs font-medium truncate" style={{ color: cssVariables.textColorNormal }} data-testid={`${pid}metric-market-cap`}>{formatMarketCap(chartMetrics.marketCap)}</div></div>
          <div className="overflow-hidden"><span className="text-[10px] whitespace-nowrap" style={{ color: cssVariables.textColorTiny }}>Sales Growth 3Q YoY</span><div className="text-xs font-medium truncate" style={{ color: cssVariables.textColorNormal }} data-testid={`${pid}metric-sales-growth`}>{chartMetrics.salesGrowth3QYoY}</div></div>
          <div className="overflow-hidden"><span className="text-[10px] whitespace-nowrap" style={{ color: cssVariables.textColorTiny }}>EPS Current Q YoY</span><div className="text-xs font-medium truncate" style={{ color: cssVariables.textColorNormal }} data-testid={`${pid}metric-eps-yoy`}>{chartMetrics.epsCurrentQYoY}</div></div>
          <div className="overflow-hidden"><span className="text-[10px] whitespace-nowrap" style={{ color: cssVariables.textColorTiny }}>Next Earnings</span><div className={`text-xs font-medium truncate ${chartMetrics.nextEarningsDays >= 0 && chartMetrics.nextEarningsDays <= 7 ? "text-rs-yellow" : ""}`} style={chartMetrics.nextEarningsDays >= 0 && chartMetrics.nextEarningsDays <= 7 ? undefined : { color: cssVariables.textColorNormal }} data-testid={`${pid}metric-next-earnings`}>{chartMetrics.nextEarningsDate !== "N/A" ? `${chartMetrics.nextEarningsDate} (${chartMetrics.nextEarningsDays}d)` : "N/A"}</div></div>
          <div className="overflow-hidden"><span className="text-[10px] whitespace-nowrap" style={{ color: cssVariables.textColorTiny }}>Analyst Consensus</span><div className="text-xs font-medium truncate" style={{ color: cssVariables.textColorNormal }} data-testid={`${pid}metric-analyst-consensus`}>{chartMetrics.analystConsensus}</div></div>
          <div className="overflow-hidden"><span className="text-[10px] whitespace-nowrap" style={{ color: cssVariables.textColorTiny }}>PE</span><div className="text-xs font-medium truncate" style={{ color: cssVariables.textColorNormal }} data-testid={`${pid}metric-pe`}>{chartMetrics.pe != null ? chartMetrics.pe.toFixed(1) : "N/A"}</div></div>
          <div className="overflow-hidden"><span className="text-[10px] whitespace-nowrap" style={{ color: cssVariables.textColorTiny }}>Pre-Tax Margin</span><div className="text-xs font-medium truncate" style={{ color: cssVariables.textColorNormal }} data-testid={`${pid}metric-pretax-margin`}>{chartMetrics.preTaxMargin != null ? `${chartMetrics.preTaxMargin.toFixed(1)}%` : "N/A"}</div></div>
          <div className="overflow-hidden"><span className="text-[10px] whitespace-nowrap" style={{ color: cssVariables.textColorTiny }}>Last EPS Surprise</span><div className="text-xs font-medium truncate" style={{ color: cssVariables.textColorNormal }} data-testid={`${pid}metric-eps-surprise`}>{chartMetrics.lastEpsSurprise}</div></div>
          <div className="overflow-hidden"><span className="text-[10px] whitespace-nowrap" style={{ color: cssVariables.textColorTiny }}>Debt/Equity</span><div className="text-xs font-medium truncate" style={{ color: cssVariables.textColorNormal }} data-testid={`${pid}metric-debt-equity`}>{chartMetrics.debtToEquity != null ? chartMetrics.debtToEquity.toFixed(2) : "N/A"}</div></div>
          <div className="overflow-hidden"><span className="text-[10px] whitespace-nowrap" style={{ color: cssVariables.textColorTiny }}>Target Price</span><div className="text-xs font-medium truncate" style={{ color: cssVariables.textColorNormal }} data-testid={`${pid}metric-target-price`}>{chartMetrics.targetPrice != null ? `$${chartMetrics.targetPrice.toFixed(2)}` : "N/A"}</div></div>
          </>) : null}
        </div>
        <div className="border border-border rounded p-2 grid grid-cols-4 gap-x-4 gap-y-1 overflow-hidden" data-testid={`${pid}intraday-metrics-strip`}>
          {chartMetrics ? (<>
          <div className="overflow-hidden"><span className="text-[10px] whitespace-nowrap" style={{ color: cssVariables.textColorTiny }}>ADR(20) $</span><div className="text-xs font-medium truncate" style={{ color: cssVariables.textColorNormal }} data-testid={`${pid}metric-adr20-dollar`}>${chartMetrics.adr20Dollar?.toFixed(2) ?? chartMetrics.adr20}</div></div>
          <div className="overflow-hidden"><span className="text-[10px] whitespace-nowrap" style={{ color: cssVariables.textColorTiny }}>50d Ext (ADR)</span><div className={`text-xs font-medium truncate ${chartMetrics.extensionFrom50dAdr >= 0 ? "text-rs-green" : "text-rs-red"}`} data-testid={`${pid}metric-50d-ext-adr`}>{chartMetrics.extensionFrom50dAdr >= 0 ? "+" : ""}{chartMetrics.extensionFrom50dAdr}x</div></div>
          <div className="overflow-hidden"><span className="text-[10px] whitespace-nowrap" style={{ color: cssVariables.textColorTiny }}>MACD ({chartMetrics.macdTimeframe})</span><div className={`text-xs font-medium truncate ${chartMetrics.macd === "Open" ? "text-rs-green" : chartMetrics.macd === "Closed" ? "text-rs-red" : ""}`} style={chartMetrics.macd !== "Open" && chartMetrics.macd !== "Closed" ? { color: cssVariables.textColorSmall } : undefined} data-testid={`${pid}metric-macd`}>{chartMetrics.macd}</div></div>
          <div className="overflow-hidden"><span className="text-[10px] whitespace-nowrap" style={{ color: cssVariables.textColorTiny }}>Sector</span><div className="text-xs font-medium truncate" data-testid={`${pid}metric-sector-etf`}>{chartMetrics.sectorEtf !== "N/A" ? (<><span className="cursor-pointer underline decoration-dotted" style={{ color: cssVariables.textColorNormal }} onClick={() => handleTickerNav(chartMetrics.sectorEtf)} data-testid={`${pid}link-sector-etf`}>{chartMetrics.sectorEtf}</span><span className={`ml-1 ${chartMetrics.sectorEtfChange >= 0 ? "text-rs-green" : "text-rs-red"}`}>{chartMetrics.sectorEtfChange >= 0 ? "+" : ""}{chartMetrics.sectorEtfChange}%</span></>) : <span style={{ color: cssVariables.textColorSmall }}>N/A</span>}</div></div>
          <div className="overflow-hidden"><span className="text-[10px] whitespace-nowrap" style={{ color: cssVariables.textColorTiny }}>ADR(20) %</span><div className="text-xs font-medium truncate" style={{ color: cssVariables.textColorNormal }} data-testid={`${pid}metric-adr20-pct`}>{chartMetrics.adr20Pct?.toFixed(1) ?? "N/A"}%</div></div>
          <div className="overflow-hidden"><span className="text-[10px] whitespace-nowrap" style={{ color: cssVariables.textColorTiny }}>20d Ext %</span><div className={`text-xs font-medium truncate ${(chartMetrics.extensionFrom20d ?? 0) >= 0 ? "text-rs-green" : "text-rs-red"}`} data-testid={`${pid}metric-20d-ext`}>{(chartMetrics.extensionFrom20d ?? 0) >= 0 ? "+" : ""}{chartMetrics.extensionFrom20d ?? 0}%</div></div>
          <div className="overflow-hidden"><span className="text-[10px] whitespace-nowrap" style={{ color: cssVariables.textColorTiny }}>RS Momentum</span><div className={`text-xs font-medium truncate ${(chartMetrics.rsMomentum ?? 0) >= 0 ? "text-rs-green" : "text-rs-red"}`} data-testid={`${pid}metric-rs-momentum`}>{chartMetrics.rsMomentum ?? "N/A"}</div></div>
          <div className="overflow-hidden col-span-1"><span className="text-[10px] whitespace-nowrap" style={{ color: cssVariables.textColorTiny }}>Peers ({chartMetrics.industryName || "Industry"})</span><div className="text-xs font-medium truncate" style={{ color: cssVariables.textColorNormal }} data-testid={`${pid}metric-industry-peers`}>{chartMetrics.industryPeers?.length > 0 ? chartMetrics.industryPeers.slice(0, 5).map((p, i) => (<span key={p.symbol}>{i > 0 && ", "}<span className="cursor-pointer underline decoration-dotted" onClick={() => handleTickerNav(p.symbol)} data-testid={`${pid}link-peer-${p.symbol}`}>{p.symbol}</span></span>)) : "N/A"}</div></div>
          </>) : null}
        </div>
      </div>

      {lowerPane && (
        <div className="flex-shrink-0 overflow-hidden" style={{ height: LOWER_PANE_H, marginTop: GAP }} data-testid={`${pid}lower-pane`}>
          {lowerPane}
        </div>
      )}

      <MaSettingsDialog open={maSettingsOpen} onOpenChange={setMaSettingsOpen} />
    </div>
  );
}
