import { useState, useCallback } from "react";
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
import { Search, Sparkles, Eye } from "lucide-react";
import rubricShieldLogo from "@/assets/images/rubricshield-logo.png";

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

  const handleNavigateToTicker = useCallback((ticker: string) => {
    setTickerInput(ticker);
    setActiveSymbol(ticker);
  }, []);

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden" style={cssVariables as any}>
      <SentinelHeader showSentiment={false} />

      <div className="flex-shrink-0 flex items-center gap-3 px-4 py-2 border-b border-border" style={{ height: 48 }}>
        <img
          src={rubricShieldLogo}
          alt="Charts"
          className="h-7 flex-shrink-0"
          style={{ opacity: cssVariables.logoOpacity ?? 1 }}
          data-testid="img-charts-logo"
        />
        <span className="text-rs-header flex-shrink-0" style={{ color: cssVariables.textColorHeader }}>Charts</span>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={tickerInput}
                  onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
                  onKeyDown={handleKeyDown}
                  placeholder="Enter ticker..."
                  className="w-36 pl-8 text-sm font-mono uppercase"
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
          <div className="ml-auto flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => {
                    const price = dailyData?.candles?.length ? dailyData.candles[dailyData.candles.length - 1].close : 0;
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
          </div>
        )}
      </div>

      <div className="flex flex-col flex-1 min-h-0 p-4">
        {!activeSymbol ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-3">
              <Search className="w-12 h-12 text-muted-foreground/30 mx-auto" />
              <p className="text-muted-foreground text-sm">Enter a ticker symbol above to view charts</p>
            </div>
          </div>
        ) : (
          <DualChartGrid
            symbol={activeSymbol}
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
