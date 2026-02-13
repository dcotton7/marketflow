import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { SentinelHeader } from "@/components/SentinelHeader";
import { TradingChart, ChartCandle, ChartIndicators } from "@/components/TradingChart";
import { MaSettingsDialog } from "@/components/MaSettingsDialog";
import { useSystemSettings } from "@/context/SystemSettingsContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Search, BarChart3, Settings2, Ruler, Sparkles } from "lucide-react";

type ChartDataResponse = { candles: ChartCandle[]; indicators: ChartIndicators; ticker: string; timeframe: string };

interface ChartMetrics {
  currentPrice: number;
  adr20: number;
  extensionFrom50dAdr: number;
  extensionFrom50dPct: number;
  extensionFrom200d: number;
  macd: string;
  macdTimeframe: string;
  sectorEtf: string;
  sectorEtfChange: number;
  nextEarningsDate: string;
  nextEarningsDays: number;
}

export default function SentinelChartsPage() {
  const { cssVariables } = useSystemSettings();
  const searchString = useSearch();
  const urlParams = new URLSearchParams(searchString);
  const initialSymbol = urlParams.get("symbol") || "";

  const [tickerInput, setTickerInput] = useState(initialSymbol);
  const [activeSymbol, setActiveSymbol] = useState(initialSymbol.toUpperCase());
  const [intradayTimeframe, setIntradayTimeframe] = useState("15min");
  const [maSettingsOpen, setMaSettingsOpen] = useState(false);
  const [dailyMeasureMode, setDailyMeasureMode] = useState(false);
  const [intradayMeasureMode, setIntradayMeasureMode] = useState(false);
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
    queryKey: ["/api/sentinel/pattern-training/chart-data", activeSymbol, intradayTimeframe],
    enabled: !!activeSymbol,
    queryFn: async () => {
      const res = await fetch(`/api/sentinel/pattern-training/chart-data?ticker=${activeSymbol}&timeframe=${intradayTimeframe}`);
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
        setChartHeight(Math.max(300, gridH - 24));
      }
    };
    const timer = setTimeout(measure, 100);
    const observer = new ResizeObserver(() => requestAnimationFrame(measure));
    if (chartGridRef.current) observer.observe(chartGridRef.current);
    return () => { clearTimeout(timer); observer.disconnect(); };
  }, [activeSymbol]);

  const displayPrice = dayChange?.price ?? 0;
  const priceChange = dayChange?.change ?? 0;
  const pricePctChange = dayChange?.changePct ?? 0;
  const isPriceUp = priceChange >= 0;

  return (
    <div className="min-h-screen bg-background flex flex-col" style={cssVariables as any}>
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

          {activeSymbol && dailyData && (
            <div
              className="rs-ticker flex items-center gap-0 text-xl tracking-tight"
              data-testid={`ticker-box-${activeSymbol}`}
            >
              <span className="rs-ticker-symbol font-bold text-foreground" data-testid="text-chart-symbol">{activeSymbol}</span>
              <span className="text-muted-foreground mx-1.5">|</span>
              <span className="rs-ticker-price font-semibold text-foreground" data-testid="text-chart-price">
                ${displayPrice.toFixed(2)}
              </span>
              <span className="text-muted-foreground mx-1.5">|</span>
              <span
                className={`font-bold ${isPriceUp ? "rs-ticker-change-up text-rs-green" : "rs-ticker-change-down text-rs-red"}`}
                data-testid="text-chart-change"
              >
                {isPriceUp ? "+" : ""}{priceChange.toFixed(2)}
              </span>
              <span className="text-muted-foreground mx-1">|</span>
              <span
                className={`font-bold ${isPriceUp ? "rs-ticker-change-up text-rs-green" : "rs-ticker-change-down text-rs-red"}`}
                data-testid="text-chart-pct"
              >
                {isPriceUp ? "+" : ""}{pricePctChange.toFixed(2)}%
              </span>
            </div>
          )}

          <div className="ml-auto flex items-center gap-2">
            {activeSymbol && (
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
            )}
          </div>
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
            <div ref={chartGridRef} className="grid grid-cols-2 gap-3 flex-1 min-h-0">
              <div className="flex flex-col min-h-0">
                <div className="flex items-center gap-2 mb-1 px-1 flex-shrink-0 h-7">
                  <span className="text-xs text-muted-foreground font-medium">Daily</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className={`toggle-elevate ${dailyMeasureMode ? "toggle-elevated" : ""}`}
                    onClick={() => setDailyMeasureMode(m => !m)}
                    data-testid="button-daily-measure-mode"
                  >
                    <Ruler className="h-3.5 w-3.5" />
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
                <div className="flex items-center gap-2 mb-1 px-1 flex-shrink-0 h-7">
                  <span className="text-xs text-muted-foreground font-medium">Intraday</span>
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
                    onClick={() => setMaSettingsOpen(true)}
                    data-testid="button-chart-ma-settings"
                  >
                    <Settings2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className={`toggle-elevate ${intradayMeasureMode ? "toggle-elevated" : ""}`}
                    onClick={() => setIntradayMeasureMode(m => !m)}
                    data-testid="button-intraday-measure-mode"
                  >
                    <Ruler className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {intradayLoading ? (
                  <Card className="flex-1">
                    <CardContent className="flex items-center justify-center h-full">
                      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    </CardContent>
                  </Card>
                ) : rthData ? (
                  <TradingChart
                    data={rthData}
                    timeframe={intradayTimeframe}
                    height={chartHeight}
                    showLegend={true}
                    showDayDividers={true}
                    maSettings={maSettingsData}
                    maxBars={maxBars}
                    measureMode={intradayMeasureMode}
                  />
                ) : (
                  <Card className="flex-1">
                    <CardContent className="flex items-center justify-center h-full text-muted-foreground text-sm">
                      No intraday data
                    </CardContent>
                  </Card>
                )}
                {chartMetrics && (
                  <div className="border border-border rounded p-2.5 flex flex-wrap gap-x-5 gap-y-1.5 mt-1 flex-shrink-0" data-testid="chart-metrics-strip">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-muted-foreground">Price</span>
                      <span className="text-sm font-medium text-foreground">${chartMetrics.currentPrice.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-muted-foreground">ADR(20)</span>
                      <span className="text-sm font-medium text-foreground">{chartMetrics.adr20}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-muted-foreground">50d ext</span>
                      <span className={`text-sm font-medium ${chartMetrics.extensionFrom50dAdr >= 0 ? "text-rs-green" : "text-rs-red"}`}>
                        {chartMetrics.extensionFrom50dAdr >= 0 ? "+" : ""}{chartMetrics.extensionFrom50dAdr}x ADR
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-muted-foreground">200d Ext</span>
                      <span className={`text-sm font-medium ${chartMetrics.extensionFrom200d >= 0 ? "text-rs-green" : "text-rs-red"}`}>
                        {chartMetrics.extensionFrom200d >= 0 ? "+" : ""}{chartMetrics.extensionFrom200d}%
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-muted-foreground">MACD ({chartMetrics.macdTimeframe})</span>
                      <span className={`text-sm font-medium ${chartMetrics.macd === "Open" ? "text-rs-green" : chartMetrics.macd === "Closed" ? "text-rs-red" : "text-muted-foreground"}`}>
                        {chartMetrics.macd}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-muted-foreground">Sector</span>
                      <span className="text-sm font-medium text-foreground">
                        {chartMetrics.sectorEtf}
                        {chartMetrics.sectorEtf !== "N/A" && (
                          <span className={`ml-1 ${chartMetrics.sectorEtfChange >= 0 ? "text-rs-green" : "text-rs-red"}`}>
                            {chartMetrics.sectorEtfChange >= 0 ? "+" : ""}{chartMetrics.sectorEtfChange}%
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-muted-foreground">Earnings</span>
                      <span className={`text-sm font-medium ${chartMetrics.nextEarningsDays >= 0 && chartMetrics.nextEarningsDays <= 7 ? "text-rs-yellow" : "text-foreground"}`}>
                        {chartMetrics.nextEarningsDate !== "N/A"
                          ? `${chartMetrics.nextEarningsDate} (${chartMetrics.nextEarningsDays}d)`
                          : "N/A"}
                      </span>
                    </div>
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
