import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useSearch } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { SentinelHeader } from "@/components/SentinelHeader";
import { TradingChart, ChartCandle, ChartIndicators } from "@/components/TradingChart";
import { MaSettingsDialog } from "@/components/MaSettingsDialog";
import { useSystemSettings } from "@/context/SystemSettingsContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Search, BarChart3, Settings2, Ruler, Sparkles, Eye } from "lucide-react";

type ChartDataResponse = { candles: ChartCandle[]; indicators: ChartIndicators; ticker: string; timeframe: string };

interface ChartMetrics {
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
  epsCurrentQYoY: string;
  salesGrowth3QYoY: string;
  lastEpsSurprise: string;
}

const formatMarketCap = (mc: number) => {
  if (mc >= 1e12) return `$${(mc / 1e12).toFixed(1)}T`;
  if (mc >= 1e9) return `$${(mc / 1e9).toFixed(1)}B`;
  if (mc >= 1e6) return `$${(mc / 1e6).toFixed(0)}M`;
  return `$${mc.toLocaleString()}`;
};

export default function SentinelChartsPage() {
  const { cssVariables } = useSystemSettings();
  const { toast } = useToast();
  const searchString = useSearch();
  const urlParams = new URLSearchParams(searchString);
  const initialSymbol = urlParams.get("symbol") || "";

  const [tickerInput, setTickerInput] = useState(initialSymbol);
  const [activeSymbol, setActiveSymbol] = useState(initialSymbol.toUpperCase());
  const [intradayTimeframe, setIntradayTimeframe] = useState("15min");
  const [maSettingsOpen, setMaSettingsOpen] = useState(false);
  const [dailyMeasureMode, setDailyMeasureMode] = useState(false);
  const [intradayMeasureMode, setIntradayMeasureMode] = useState(false);
  const [dailyTrendLineMode, setDailyTrendLineMode] = useState(false);
  const [intradayTrendLineMode, setIntradayTrendLineMode] = useState(false);
  const [showETH, setShowETH] = useState(false);
  const chartGridRef = useRef<HTMLDivElement>(null);
  const [chartHeight, setChartHeight] = useState(500);

  const handleSubmitTicker = useCallback(() => {
    const cleaned = tickerInput.trim().toUpperCase();
    if (cleaned) {
      setActiveSymbol(cleaned);
    }
  }, [tickerInput]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSubmitTicker();
    }
  }, [handleSubmitTicker]);

  const { data: dailyData, isLoading: dailyLoading } = useQuery<ChartDataResponse>({
    queryKey: ["/api/sentinel/pattern-training/chart-data", activeSymbol, "daily"],
    enabled: !!activeSymbol,
    queryFn: async () => {
      const res = await fetch(`/api/sentinel/pattern-training/chart-data?ticker=${activeSymbol}&timeframe=daily`);
      if (!res.ok) throw new Error("Failed to fetch daily chart data");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: intradayData, isLoading: intradayLoading } = useQuery<ChartDataResponse>({
    queryKey: ["/api/sentinel/pattern-training/chart-data", activeSymbol, intradayTimeframe, showETH],
    enabled: !!activeSymbol,
    queryFn: async () => {
      const params = new URLSearchParams({ ticker: activeSymbol!, timeframe: intradayTimeframe });
      if (showETH) params.set('includeETH', 'true');
      const res = await fetch(`/api/sentinel/pattern-training/chart-data?${params}`);
      if (!res.ok) throw new Error("Failed to fetch intraday chart data");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: maSettingsData } = useQuery<any[]>({
    queryKey: ["/api/sentinel/ma-settings"],
  });

  const { data: chartPrefs } = useQuery<{ defaultBarsOnScreen: number }>({
    queryKey: ["/api/sentinel/chart-preferences"],
  });
  const maxBars = chartPrefs?.defaultBarsOnScreen ?? 200;

  const { data: chartMetrics } = useQuery<ChartMetrics>({
    queryKey: ["/api/sentinel/trade-chart-metrics", activeSymbol, intradayTimeframe],
    enabled: !!activeSymbol,
    queryFn: async () => {
      const res = await fetch(`/api/sentinel/trade-chart-metrics?ticker=${activeSymbol}&timeframe=${intradayTimeframe}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch metrics");
      return res.json();
    },
    staleTime: 60 * 1000,
  });

  const watchlistMutation = useMutation({
    mutationFn: async ({ symbol }: { symbol: string }) => {
      const res = await fetch("/api/sentinel/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ symbol }),
      });
      if (!res.ok) throw new Error("Failed to add to watchlist");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/watchlist"] });
      toast({ title: "Added to Watchlist", description: `${activeSymbol} has been added to your watching list.` });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to add to watchlist. It may already be on your list.", variant: "destructive" });
    },
  });

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
        avwapHigh: intradayData.indicators.avwapHigh ? rthIndices.map(i => intradayData.indicators.avwapHigh![i] ?? null) : undefined,
        avwapLow: intradayData.indicators.avwapLow ? rthIndices.map(i => intradayData.indicators.avwapLow![i] ?? null) : undefined,
      },
    };
    return rthResult;
  }, [intradayData]);

  const dayChange = useMemo(() => {
    if (!dailyData || dailyData.candles.length < 2) return null;
    const last = dailyData.candles[dailyData.candles.length - 1];
    const prev = dailyData.candles[dailyData.candles.length - 2];
    const change = last.close - prev.close;
    const changePct = (change / prev.close) * 100;
    return { price: last.close, change, changePct };
  }, [dailyData]);

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
  }, [activeSymbol]);

  const displayPrice = dayChange?.price ?? 0;
  const priceChange = dayChange?.change ?? 0;
  const pricePctChange = dayChange?.changePct ?? 0;
  const isPriceUp = priceChange >= 0;

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden" style={cssVariables as any}>
      <SentinelHeader showSentiment={false} />
      <div className="flex flex-col flex-1 min-h-0 p-4 gap-3">
        <div className="flex items-center gap-3 flex-shrink-0 flex-wrap">
          <BarChart3 className="w-5 h-5 text-muted-foreground" />
          <div className="flex items-center gap-1.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={tickerInput}
                    onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
                    onKeyDown={handleKeyDown}
                    placeholder="Enter ticker..."
                    className="w-32 pl-8 text-sm font-mono uppercase"
                    data-testid="input-chart-ticker"
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-sm">Type a stock ticker and press Enter to load charts</p>
              </TooltipContent>
            </Tooltip>
            <Button
              size="sm"
              onClick={handleSubmitTicker}
              disabled={!tickerInput.trim()}
              data-testid="button-chart-go"
            >
              Go
            </Button>
          </div>

          {activeSymbol && (
            <div className="ml-auto flex items-center gap-2 flex-wrap">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => {
                      const price = dayChange?.price ?? 0;
                      window.location.href = `/sentinel/evaluate?symbol=${encodeURIComponent(activeSymbol)}&price=${price.toFixed(2)}&from=charts`;
                    }}
                    data-testid="button-chart-evaluate"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>Ivy AI</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-sm">Open Trade Evaluator pre-filled with this ticker</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => watchlistMutation.mutate({ symbol: activeSymbol })}
                    disabled={watchlistMutation.isPending}
                    data-testid="button-chart-watchlist"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    <span>Watchlist</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-sm">Add this ticker to your Watching list for tracking</p>
                </TooltipContent>
              </Tooltip>
              {dailyData && (
                <div
                  className="flex items-center gap-2 px-3 py-1 rounded-md border border-border bg-card"
                  data-testid={`ticker-box-${activeSymbol}`}
                >
                  <span className="font-mono font-bold text-2xl text-foreground" data-testid="text-chart-symbol">{activeSymbol}</span>
                  <span className="text-muted-foreground text-xl">|</span>
                  <span className="font-mono font-semibold text-2xl text-foreground" data-testid="text-chart-price">
                    ${displayPrice.toFixed(2)}
                  </span>
                  <span className="text-muted-foreground text-xl">|</span>
                  <span
                    className={`font-mono font-bold text-2xl ${isPriceUp ? "text-rs-green" : "text-rs-red"}`}
                    data-testid="text-chart-change"
                  >
                    {isPriceUp ? "+" : ""}{priceChange.toFixed(2)}
                  </span>
                  <span className="text-muted-foreground text-xl">|</span>
                  <span
                    className={`font-mono font-bold text-2xl ${isPriceUp ? "text-rs-green" : "text-rs-red"}`}
                    data-testid="text-chart-pct"
                  >
                    {isPriceUp ? "+" : ""}{pricePctChange.toFixed(2)}%
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {!activeSymbol ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-3">
              <BarChart3 className="w-12 h-12 text-muted-foreground/30 mx-auto" />
              <p className="text-muted-foreground text-sm">Enter a ticker symbol above to view charts</p>
            </div>
          </div>
        ) : (
          <>
            <div ref={chartGridRef} className="grid grid-cols-2 gap-3 flex-1 min-h-0 overflow-hidden">
              <div className="flex flex-col min-h-0">
                <div className="flex items-center gap-2 mb-1 px-1 flex-shrink-0 h-7 rounded-md" style={{ backgroundColor: cssVariables.secondaryOverlayColor }}>
                  <span className="text-xs text-black font-medium">Daily</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className={`text-black toggle-elevate ${dailyMeasureMode ? "toggle-elevated bg-black/15" : ""}`}
                    onClick={() => setDailyMeasureMode(m => !m)}
                    style={dailyMeasureMode ? { boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.3)' } : undefined}
                    data-testid="button-daily-measure-mode"
                  >
                    <Ruler className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className={`text-black toggle-elevate ${dailyTrendLineMode ? "toggle-elevated bg-black/15" : ""}`}
                    onClick={() => setDailyTrendLineMode(m => !m)}
                    style={dailyTrendLineMode ? { boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.3)' } : undefined}
                    data-testid="button-daily-trend-line-mode"
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <line x1="2" y1="12" x2="12" y2="2" stroke="currentColor" strokeWidth="1.5"/>
                      <circle cx="2" cy="12" r="1.5" fill="currentColor"/>
                      <circle cx="12" cy="2" r="1.5" fill="currentColor"/>
                    </svg>
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
                  />
                ) : (
                  <Card className="flex-1">
                    <CardContent className="flex items-center justify-center h-full text-muted-foreground text-sm">
                      No daily data
                    </CardContent>
                  </Card>
                )}
                {chartMetrics && (
                  <div className="border border-border rounded p-2 mt-1 flex-shrink-0 grid grid-cols-5 gap-x-4 gap-y-1" data-testid="chart-daily-metrics-strip">
                    <div><span className="text-[10px] text-muted-foreground">Market Cap</span><div className="text-xs font-medium text-foreground" data-testid="metric-daily-market-cap">{formatMarketCap(chartMetrics.marketCap)}</div></div>
                    <div><span className="text-[10px] text-muted-foreground">Sales Growth 3Q YoY</span><div className="text-xs font-medium text-foreground" data-testid="metric-daily-sales-growth">{chartMetrics.salesGrowth3QYoY}</div></div>
                    <div><span className="text-[10px] text-muted-foreground">EPS Current Q YoY</span><div className="text-xs font-medium text-foreground" data-testid="metric-daily-eps-yoy">{chartMetrics.epsCurrentQYoY}</div></div>
                    <div><span className="text-[10px] text-muted-foreground">Next Earnings</span><div className={`text-xs font-medium ${chartMetrics.nextEarningsDays >= 0 && chartMetrics.nextEarningsDays <= 7 ? "text-rs-yellow" : "text-foreground"}`} data-testid="metric-daily-next-earnings">{chartMetrics.nextEarningsDate !== "N/A" ? `${chartMetrics.nextEarningsDate} (${chartMetrics.nextEarningsDays}d)` : "N/A"}</div></div>
                    <div><span className="text-[10px] text-muted-foreground">Analyst Consensus</span><div className="text-xs font-medium text-foreground" data-testid="metric-daily-analyst-consensus">{chartMetrics.analystConsensus}</div></div>
                    <div><span className="text-[10px] text-muted-foreground">PE</span><div className="text-xs font-medium text-foreground" data-testid="metric-daily-pe">{chartMetrics.pe != null ? chartMetrics.pe.toFixed(1) : "N/A"}</div></div>
                    <div><span className="text-[10px] text-muted-foreground">Pre-Tax Margin</span><div className="text-xs font-medium text-foreground" data-testid="metric-daily-pretax-margin">{chartMetrics.preTaxMargin != null ? `${chartMetrics.preTaxMargin.toFixed(1)}%` : "N/A"}</div></div>
                    <div><span className="text-[10px] text-muted-foreground">Last EPS Surprise</span><div className="text-xs font-medium text-foreground" data-testid="metric-daily-eps-surprise">{chartMetrics.lastEpsSurprise}</div></div>
                    <div><span className="text-[10px] text-muted-foreground">Debt/Equity</span><div className="text-xs font-medium text-foreground" data-testid="metric-daily-debt-equity">{chartMetrics.debtToEquity != null ? chartMetrics.debtToEquity.toFixed(2) : "N/A"}</div></div>
                    <div><span className="text-[10px] text-muted-foreground">Target Price</span><div className="text-xs font-medium text-foreground" data-testid="metric-daily-target-price">{chartMetrics.targetPrice != null ? `$${chartMetrics.targetPrice.toFixed(2)}` : "N/A"}</div></div>
                  </div>
                )}
              </div>
              <div className="flex flex-col min-h-0">
                <div className="flex items-center gap-2 mb-1 px-1 flex-shrink-0 h-7 rounded-md" style={{ backgroundColor: cssVariables.secondaryOverlayColor }}>
                  <span className="text-xs text-black font-medium">Intraday</span>
                  <Select value={intradayTimeframe} onValueChange={setIntradayTimeframe}>
                    <SelectTrigger className="h-6 w-20 text-[10px]" data-testid="select-chart-intraday">
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
                    className="text-black"
                    onClick={() => setMaSettingsOpen(true)}
                    data-testid="button-chart-ma-settings"
                  >
                    <Settings2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className={`text-black toggle-elevate ${intradayMeasureMode ? "toggle-elevated bg-black/15" : ""}`}
                    onClick={() => setIntradayMeasureMode(m => !m)}
                    style={intradayMeasureMode ? { boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.3)' } : undefined}
                    data-testid="button-intraday-measure-mode"
                  >
                    <Ruler className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className={`text-black toggle-elevate ${intradayTrendLineMode ? "toggle-elevated bg-black/15" : ""}`}
                    onClick={() => setIntradayTrendLineMode(m => !m)}
                    style={intradayTrendLineMode ? { boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.3)' } : undefined}
                    data-testid="button-intraday-trend-line-mode"
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <line x1="2" y1="12" x2="12" y2="2" stroke="currentColor" strokeWidth="1.5"/>
                      <circle cx="2" cy="12" r="1.5" fill="currentColor"/>
                      <circle cx="12" cy="2" r="1.5" fill="currentColor"/>
                    </svg>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className={`text-black text-[10px] font-semibold toggle-elevate ${showETH ? "toggle-elevated bg-black/15" : ""}`}
                    onClick={() => setShowETH(e => !e)}
                    style={showETH ? { boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.3)' } : undefined}
                    data-testid="button-intraday-eth-toggle"
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
                ) : (showETH ? intradayData : rthData) ? (
                  <TradingChart
                    data={showETH ? intradayData! : rthData!}
                    timeframe={intradayTimeframe}
                    height={chartHeight}
                    showLegend={true}
                    showDayDividers={true}
                    maSettings={maSettingsData}
                    maxBars={maxBars}
                    measureMode={intradayMeasureMode}
                    trendLineMode={intradayTrendLineMode}
                  />
                ) : (
                  <Card className="flex-1">
                    <CardContent className="flex items-center justify-center h-full text-muted-foreground text-sm">
                      No intraday data
                    </CardContent>
                  </Card>
                )}
                {chartMetrics && (
                  <div className="border border-border rounded p-2 mt-1 flex-shrink-0 grid grid-cols-4 gap-x-4 gap-y-1" data-testid="chart-intraday-metrics-strip">
                    <div><span className="text-[10px] text-muted-foreground">ADR(20) $</span><div className="text-xs font-medium text-foreground" data-testid="metric-intraday-adr20-dollar">${chartMetrics.adr20Dollar?.toFixed(2) ?? chartMetrics.adr20}</div></div>
                    <div><span className="text-[10px] text-muted-foreground">50d Ext (ADR)</span><div className={`text-xs font-medium ${chartMetrics.extensionFrom50dAdr >= 0 ? "text-rs-green" : "text-rs-red"}`} data-testid="metric-intraday-50d-ext-adr">{chartMetrics.extensionFrom50dAdr >= 0 ? "+" : ""}{chartMetrics.extensionFrom50dAdr}x</div></div>
                    <div><span className="text-[10px] text-muted-foreground">MACD ({chartMetrics.macdTimeframe})</span><div className={`text-xs font-medium ${chartMetrics.macd === "Open" ? "text-rs-green" : chartMetrics.macd === "Closed" ? "text-rs-red" : "text-muted-foreground"}`} data-testid="metric-intraday-macd">{chartMetrics.macd}</div></div>
                    <div><span className="text-[10px] text-muted-foreground">Sector</span><div className="text-xs font-medium" data-testid="metric-intraday-sector-etf">{chartMetrics.sectorEtf !== "N/A" ? (<><span className="cursor-pointer text-foreground underline decoration-dotted" onClick={() => { setTickerInput(chartMetrics.sectorEtf); setActiveSymbol(chartMetrics.sectorEtf); }} data-testid="link-intraday-sector-etf">{chartMetrics.sectorEtf}</span><span className={`ml-1 ${chartMetrics.sectorEtfChange >= 0 ? "text-rs-green" : "text-rs-red"}`}>{chartMetrics.sectorEtfChange >= 0 ? "+" : ""}{chartMetrics.sectorEtfChange}%</span></>) : "N/A"}</div></div>
                    <div><span className="text-[10px] text-muted-foreground">ADR(20) %</span><div className="text-xs font-medium text-foreground" data-testid="metric-intraday-adr20-pct">{chartMetrics.adr20Pct?.toFixed(1) ?? "N/A"}%</div></div>
                    <div><span className="text-[10px] text-muted-foreground">20d Ext %</span><div className={`text-xs font-medium ${(chartMetrics.extensionFrom20d ?? 0) >= 0 ? "text-rs-green" : "text-rs-red"}`} data-testid="metric-intraday-20d-ext">{(chartMetrics.extensionFrom20d ?? 0) >= 0 ? "+" : ""}{chartMetrics.extensionFrom20d ?? 0}%</div></div>
                    <div><span className="text-[10px] text-muted-foreground">RS Momentum</span><div className={`text-xs font-medium ${(chartMetrics.rsMomentum ?? 0) >= 0 ? "text-rs-green" : "text-rs-red"}`} data-testid="metric-intraday-rs-momentum">{chartMetrics.rsMomentum ?? "N/A"}</div></div>
                    <div className="col-span-1"><span className="text-[10px] text-muted-foreground">Peers ({chartMetrics.industryName || "Industry"})</span><div className="text-xs font-medium text-foreground truncate" data-testid="metric-intraday-industry-peers">{chartMetrics.industryPeers?.length > 0 ? chartMetrics.industryPeers.slice(0, 5).map((p, i) => (<span key={p.symbol}>{i > 0 && ", "}<span className="cursor-pointer underline decoration-dotted" onClick={() => { setTickerInput(p.symbol); setActiveSymbol(p.symbol); }} data-testid={`link-intraday-peer-${p.symbol}`}>{p.symbol}</span></span>)) : "N/A"}</div></div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
      <MaSettingsDialog open={maSettingsOpen} onOpenChange={setMaSettingsOpen} />
    </div>
  );
}
