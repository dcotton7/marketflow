import { useState, useMemo, useCallback } from "react";
import { useSearch } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { SentinelHeader } from "@/components/SentinelHeader";
import { DualChartGrid, ChartDataResponse, ChartMetrics } from "@/components/DualChartGrid";
import { useSystemSettings } from "@/context/SystemSettingsContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { BarChart3, Search, Sparkles, Eye } from "lucide-react";

export default function SentinelChartsPage() {
  const { cssVariables } = useSystemSettings();
  const { toast } = useToast();
  const searchString = useSearch();
  const urlParams = new URLSearchParams(searchString);
  const initialSymbol = urlParams.get("symbol") || "";

  const [tickerInput, setTickerInput] = useState(initialSymbol);
  const [activeSymbol, setActiveSymbol] = useState(initialSymbol.toUpperCase());
  const [intradayTimeframe, setIntradayTimeframe] = useState("15min");
  const [showETH, setShowETH] = useState(false);

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

  const dayChange = useMemo(() => {
    if (!dailyData || dailyData.candles.length < 2) return null;
    const last = dailyData.candles[dailyData.candles.length - 1];
    const prev = dailyData.candles[dailyData.candles.length - 2];
    const change = last.close - prev.close;
    const changePct = (change / prev.close) * 100;
    return { price: last.close, change, changePct };
  }, [dailyData]);

  const displayPrice = dayChange?.price ?? 0;
  const priceChange = dayChange?.change ?? 0;
  const pricePctChange = dayChange?.changePct ?? 0;
  const isPriceUp = priceChange >= 0;

  const handleNavigateToTicker = useCallback((ticker: string) => {
    setTickerInput(ticker);
    setActiveSymbol(ticker);
  }, []);

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
                <div className="flex items-center gap-3 flex-wrap" data-testid={`ticker-box-${activeSymbol}`}>
                  <div
                    className="flex items-center gap-2 px-3 py-1 rounded-md border border-border bg-card"
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
                  {chartMetrics && (chartMetrics.companyName || chartMetrics.sectorName || chartMetrics.industryName) && (
                    <div className="flex flex-col gap-0.5" data-testid="text-company-info">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        {chartMetrics.companyName && <span className="text-foreground font-medium">{chartMetrics.companyName}</span>}
                        {chartMetrics.companyName && (chartMetrics.sectorName || chartMetrics.industryName) && <span>·</span>}
                        {chartMetrics.sectorName && <span>{chartMetrics.sectorName}</span>}
                        {chartMetrics.sectorName && chartMetrics.industryName && <span>/</span>}
                        {chartMetrics.industryName && chartMetrics.industryName !== "Unknown" && <span>{chartMetrics.industryName}</span>}
                      </div>
                      {chartMetrics.companyDescription && (
                        <p className="text-[10px] text-muted-foreground/70 line-clamp-2 max-w-[500px]" title={chartMetrics.companyDescription} data-testid="text-company-description">
                          {chartMetrics.companyDescription}
                        </p>
                      )}
                    </div>
                  )}
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
          <DualChartGrid
            dailyData={dailyData}
            dailyLoading={dailyLoading}
            intradayData={intradayData}
            intradayLoading={intradayLoading}
            chartMetrics={chartMetrics ?? null}
            intradayTimeframe={intradayTimeframe}
            onIntradayTimeframeChange={setIntradayTimeframe}
            showETH={showETH}
            onShowETHChange={setShowETH}
            onNavigateToTicker={handleNavigateToTicker}
            testIdPrefix="chart"
          />
        )}
      </div>
    </div>
  );
}
