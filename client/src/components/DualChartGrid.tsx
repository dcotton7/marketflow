import { useState, useEffect, useRef, useMemo, useCallback } from "react";
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

interface DualChartGridProps {
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
}

const TrendLineIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
    <line x1="2" y1="12" x2="12" y2="2" stroke="currentColor" strokeWidth="1.5"/>
    <circle cx="2" cy="12" r="1.5" fill="currentColor"/>
    <circle cx="12" cy="2" r="1.5" fill="currentColor"/>
  </svg>
);

export function DualChartGrid({
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
}: DualChartGridProps) {
  const { cssVariables } = useSystemSettings();
  const chartGridRef = useRef<HTMLDivElement>(null);
  const [chartHeight, setChartHeight] = useState(500);
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
      if (chartGridRef.current) {
        const gridH = chartGridRef.current.clientHeight;
        setChartHeight(Math.max(180, Math.floor((gridH - 120) * 0.85)));
      }
    };
    const timer = setTimeout(measure, 150);
    const observer = new ResizeObserver(() => requestAnimationFrame(measure));
    if (chartGridRef.current) observer.observe(chartGridRef.current);
    return () => { clearTimeout(timer); observer.disconnect(); };
  }, [dailyData, intradayData]);

  const effectiveIntradayData = showETH ? intradayData : rthData;

  const handleTickerNav = useCallback((ticker: string) => {
    if (onNavigateToTicker) {
      onNavigateToTicker(ticker);
    } else {
      window.location.href = `/sentinel/charts?ticker=${ticker}`;
    }
  }, [onNavigateToTicker]);

  const pid = testIdPrefix ? `${testIdPrefix}-` : "";

  return (
    <>
      <div ref={chartGridRef} className="grid grid-cols-2 gap-3 flex-1 min-h-0">
        <div className="flex flex-col min-h-0">
          <div className="flex items-center gap-2 mb-1 px-1 flex-shrink-0 h-7 rounded-md" style={{ backgroundColor: cssVariables.overlayBg }}>
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
          {dailyLoading ? (
            <Card className="flex-1">
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
            <Card className="flex-1">
              <CardContent className="flex items-center justify-center h-full text-muted-foreground text-sm">
                No daily data
              </CardContent>
            </Card>
          )}
        </div>
        <div className="flex flex-col min-h-0">
          <div className="flex items-center gap-2 mb-1 px-1 flex-shrink-0 h-7 rounded-md" style={{ backgroundColor: cssVariables.overlayBg }}>
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
          {intradayLoading ? (
            <Card className="flex-1">
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
            <Card className="flex-1">
              <CardContent className="flex items-center justify-center h-full text-muted-foreground text-sm">
                No intraday data
              </CardContent>
            </Card>
          )}
        </div>
      </div>
      {chartMetrics && (
        <div className="grid grid-cols-2 gap-3 flex-shrink-0 mt-1">
          <div className="border border-border rounded p-2 grid grid-cols-5 gap-x-4 gap-y-1" data-testid={`${pid}daily-metrics-strip`}>
            <div><span className="text-[10px] text-muted-foreground">Market Cap</span><div className="text-xs font-medium text-foreground" data-testid={`${pid}metric-market-cap`}>{formatMarketCap(chartMetrics.marketCap)}</div></div>
            <div><span className="text-[10px] text-muted-foreground">Sales Growth 3Q YoY</span><div className="text-xs font-medium text-foreground" data-testid={`${pid}metric-sales-growth`}>{chartMetrics.salesGrowth3QYoY}</div></div>
            <div><span className="text-[10px] text-muted-foreground">EPS Current Q YoY</span><div className="text-xs font-medium text-foreground" data-testid={`${pid}metric-eps-yoy`}>{chartMetrics.epsCurrentQYoY}</div></div>
            <div><span className="text-[10px] text-muted-foreground">Next Earnings</span><div className={`text-xs font-medium ${chartMetrics.nextEarningsDays >= 0 && chartMetrics.nextEarningsDays <= 7 ? "text-rs-yellow" : "text-foreground"}`} data-testid={`${pid}metric-next-earnings`}>{chartMetrics.nextEarningsDate !== "N/A" ? `${chartMetrics.nextEarningsDate} (${chartMetrics.nextEarningsDays}d)` : "N/A"}</div></div>
            <div><span className="text-[10px] text-muted-foreground">Analyst Consensus</span><div className="text-xs font-medium text-foreground" data-testid={`${pid}metric-analyst-consensus`}>{chartMetrics.analystConsensus}</div></div>
            <div><span className="text-[10px] text-muted-foreground">PE</span><div className="text-xs font-medium text-foreground" data-testid={`${pid}metric-pe`}>{chartMetrics.pe != null ? chartMetrics.pe.toFixed(1) : "N/A"}</div></div>
            <div><span className="text-[10px] text-muted-foreground">Pre-Tax Margin</span><div className="text-xs font-medium text-foreground" data-testid={`${pid}metric-pretax-margin`}>{chartMetrics.preTaxMargin != null ? `${chartMetrics.preTaxMargin.toFixed(1)}%` : "N/A"}</div></div>
            <div><span className="text-[10px] text-muted-foreground">Last EPS Surprise</span><div className="text-xs font-medium text-foreground" data-testid={`${pid}metric-eps-surprise`}>{chartMetrics.lastEpsSurprise}</div></div>
            <div><span className="text-[10px] text-muted-foreground">Debt/Equity</span><div className="text-xs font-medium text-foreground" data-testid={`${pid}metric-debt-equity`}>{chartMetrics.debtToEquity != null ? chartMetrics.debtToEquity.toFixed(2) : "N/A"}</div></div>
            <div><span className="text-[10px] text-muted-foreground">Target Price</span><div className="text-xs font-medium text-foreground" data-testid={`${pid}metric-target-price`}>{chartMetrics.targetPrice != null ? `$${chartMetrics.targetPrice.toFixed(2)}` : "N/A"}</div></div>
          </div>
          <div className="border border-border rounded p-2 grid grid-cols-4 gap-x-4 gap-y-1" data-testid={`${pid}intraday-metrics-strip`}>
            <div><span className="text-[10px] text-muted-foreground">ADR(20) $</span><div className="text-xs font-medium text-foreground" data-testid={`${pid}metric-adr20-dollar`}>${chartMetrics.adr20Dollar?.toFixed(2) ?? chartMetrics.adr20}</div></div>
            <div><span className="text-[10px] text-muted-foreground">50d Ext (ADR)</span><div className={`text-xs font-medium ${chartMetrics.extensionFrom50dAdr >= 0 ? "text-rs-green" : "text-rs-red"}`} data-testid={`${pid}metric-50d-ext-adr`}>{chartMetrics.extensionFrom50dAdr >= 0 ? "+" : ""}{chartMetrics.extensionFrom50dAdr}x</div></div>
            <div><span className="text-[10px] text-muted-foreground">MACD ({chartMetrics.macdTimeframe})</span><div className={`text-xs font-medium ${chartMetrics.macd === "Open" ? "text-rs-green" : chartMetrics.macd === "Closed" ? "text-rs-red" : "text-muted-foreground"}`} data-testid={`${pid}metric-macd`}>{chartMetrics.macd}</div></div>
            <div><span className="text-[10px] text-muted-foreground">Sector</span><div className="text-xs font-medium" data-testid={`${pid}metric-sector-etf`}>{chartMetrics.sectorEtf !== "N/A" ? (<><span className="cursor-pointer text-foreground underline decoration-dotted" onClick={() => handleTickerNav(chartMetrics.sectorEtf)} data-testid={`${pid}link-sector-etf`}>{chartMetrics.sectorEtf}</span><span className={`ml-1 ${chartMetrics.sectorEtfChange >= 0 ? "text-rs-green" : "text-rs-red"}`}>{chartMetrics.sectorEtfChange >= 0 ? "+" : ""}{chartMetrics.sectorEtfChange}%</span></>) : "N/A"}</div></div>
            <div><span className="text-[10px] text-muted-foreground">ADR(20) %</span><div className="text-xs font-medium text-foreground" data-testid={`${pid}metric-adr20-pct`}>{chartMetrics.adr20Pct?.toFixed(1) ?? "N/A"}%</div></div>
            <div><span className="text-[10px] text-muted-foreground">20d Ext %</span><div className={`text-xs font-medium ${(chartMetrics.extensionFrom20d ?? 0) >= 0 ? "text-rs-green" : "text-rs-red"}`} data-testid={`${pid}metric-20d-ext`}>{(chartMetrics.extensionFrom20d ?? 0) >= 0 ? "+" : ""}{chartMetrics.extensionFrom20d ?? 0}%</div></div>
            <div><span className="text-[10px] text-muted-foreground">RS Momentum</span><div className={`text-xs font-medium ${(chartMetrics.rsMomentum ?? 0) >= 0 ? "text-rs-green" : "text-rs-red"}`} data-testid={`${pid}metric-rs-momentum`}>{chartMetrics.rsMomentum ?? "N/A"}</div></div>
            <div className="col-span-1"><span className="text-[10px] text-muted-foreground">Peers ({chartMetrics.industryName || "Industry"})</span><div className="text-xs font-medium text-foreground truncate" data-testid={`${pid}metric-industry-peers`}>{chartMetrics.industryPeers?.length > 0 ? chartMetrics.industryPeers.slice(0, 5).map((p, i) => (<span key={p.symbol}>{i > 0 && ", "}<span className="cursor-pointer underline decoration-dotted" onClick={() => handleTickerNav(p.symbol)} data-testid={`${pid}link-peer-${p.symbol}`}>{p.symbol}</span></span>)) : "N/A"}</div></div>
          </div>
        </div>
      )}
      <MaSettingsDialog open={maSettingsOpen} onOpenChange={setMaSettingsOpen} />
    </>
  );
}
