// Market Condition / Flow Mode Page
// v4: Theme Rotation Dashboard with multi-timeframe support
// Now with resizable panels and live API integration
import { useState, useCallback, useMemo, useEffect } from "react";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from "react-resizable-panels";
import {
  HeaderBar,
  ThemeHeatmapGrid,
  ThemeDetailPanel,
  RotationTable,
  TickerWorkbench,
} from "@/components/market-condition";
import { AnalysisPanel } from "@/features/marketflow-analysis";
import {
  MOCK_THEMES,
  MOCK_THEME_MEMBERS,
  MOCK_MARKET_SUMMARY,
  ThemeId,
  ThemeRow,
  TickerRow,
  MarketConditionSummary,
  getCompanyName,
  TimeSlice,
  SizeFilter,
} from "@/data/mockThemeData";
import { SentinelHeader } from "@/components/SentinelHeader";
import { useLocation } from "wouter";
import { Grid3X3, List, LayoutGrid, Maximize2, Minimize2, TrendingUp, ArrowUpDown, PieChart, Info, GripVertical, GripHorizontal, RefreshCw, AlertCircle, Clock, Filter, ChevronDown, BarChart3, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { 
  useMarketCondition, 
  useRAI, 
  useThemeMembers,
  useForceRefresh,
  usePollingStatus,
  ThemeMetrics,
  ClusterId,
} from "@/hooks/useMarketCondition";
import { useMarketSurgeSync } from "@/hooks/useMarketSurgeSync";
import { useChartPopout } from "@/hooks/useChartPopout";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

type ViewMode = "grid" | "table" | "split";
type LensMode = "flow" | "rotation" | "concentration" | "accumulation";

// Time slice label mapping
const TIME_SLICE_LABELS: Record<TimeSlice, string> = {
  "TODAY": "Today (Live)",
  "15M": "15 Minutes",
  "30M": "30 Minutes",
  "1H": "1 Hour",
  "1D": "vs Yesterday",
  "1W": "1 Week",
  "1M": "1 Month",
  "3M": "3 Months",
  "6M": "6 Months",
  "YTD": "Year to Date",
};

// Size filter label mapping
const SIZE_FILTER_LABELS: Record<SizeFilter, string> = {
  ALL: "All Sizes",
  MEGA: "Mega Cap (MGK)",
  LARGE: "Large Cap (SPY)",
  MID: "Mid Cap (MDY)",
  SMALL: "Small Cap (IWM)",
  MICRO: "Micro Cap (IWC)",
};

// Convert server ThemeMetrics to UI ThemeRow format
function convertToThemeRow(theme: ThemeMetrics): ThemeRow {
  return {
    id: theme.id as ThemeId,
    name: theme.name,
    tier: theme.tier,
    medianPct: theme.medianPct,
    score: theme.score,
    baseScore: theme.baseScore,
    breadthPct: theme.breadthPct,
    pctAbove50d: theme.pctAbove50d,
    pctAbove200d: theme.pctAbove200d,
    rsVsSpy: theme.rsVsBenchmark ?? theme.rsVsSpy ?? 0,
    volExp: theme.volExp ?? 1.0,
    acceleration: theme.acceleration,
    accDistDays: theme.accDistDays ?? 0,
    rank: theme.rank,
    deltaRank: theme.deltaRank,
    percentile: theme.percentile,
    penaltyFactor: theme.penaltyFactor,
    narrowLeadershipMultiplier: theme.narrowLeadershipMultiplier,
    reasonCodes: theme.reasonCodes as any,
    coreCount: theme.coreCount,
    leaderCount: theme.greenCount,
    top3Contribution: theme.top3Contribution,
    top3Concentration: theme.top3Concentration ?? 0,
    isNarrowLeadership: theme.isNarrowLeadership ?? false,
    trendState: theme.trendState,
    bullCount: theme.bullCount,
    transitionCount: theme.transitionCount,
    bearCount: theme.bearCount,
    etfProxies: theme.etfProxies,
    historicalMetrics: theme.historicalMetrics,
  };
}

// Resize handle component
function ResizeHandle({ direction = "vertical" }: { direction?: "vertical" | "horizontal" }) {
  return (
    <PanelResizeHandle
      className={cn(
        "group relative flex items-center justify-center",
        direction === "vertical" ? "w-2 hover:bg-cyan-500/20" : "h-2 hover:bg-cyan-500/20",
        "transition-colors duration-150"
      )}
    >
      <div
        className={cn(
          "absolute rounded-full bg-slate-600 group-hover:bg-cyan-500 transition-colors",
          direction === "vertical" ? "w-1 h-8" : "h-1 w-8"
        )}
      />
      {direction === "vertical" ? (
        <GripVertical className="w-3 h-3 text-slate-500 group-hover:text-cyan-400 absolute" />
      ) : (
        <GripHorizontal className="w-3 h-3 text-slate-500 group-hover:text-cyan-400 absolute" />
      )}
    </PanelResizeHandle>
  );
}

// Panel header component
function PanelHeader({ title, tooltip, subtitle, action }: { title: string; tooltip: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-slate-800/50 border-b border-slate-700/50 shrink-0">
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-2 cursor-help">
            <span className="text-sm font-medium">{title}</span>
            {subtitle && (
              <span className="text-xs text-muted-foreground">
                {subtitle}
              </span>
            )}
            <Info className="w-3 h-3 text-muted-foreground" />
          </div>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p className="text-xs">{tooltip}</p>
        </TooltipContent>
      </Tooltip>
      {action}
    </div>
  );
}

export default function MarketConditionPage() {
  const [, navigate] = useLocation();
  const [selectedTheme, setSelectedTheme] = useState<ThemeId | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [lensMode, setLensMode] = useState<LensMode>("flow");
  const timeSliceDisabledModes = new Set<LensMode>(["concentration", "accumulation"]);
  const handleLensMode = (mode: LensMode) => {
    if (timeSliceDisabledModes.has(mode) && timeSlice !== "TODAY") {
      setTimeSlice("TODAY");
      setHeatmapSort("current");
    }
    setLensMode(mode);
  };

  const handleTimeSlice = (slice: TimeSlice) => {
    setTimeSlice(slice);
    if (slice === "TODAY") setHeatmapSort("current");
  };
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [useLiveData, setUseLiveData] = useState(true);
  const [timeSlice, setTimeSlice] = useState<TimeSlice>("TODAY");
  const [heatmapSort, setHeatmapSort] = useState<"current" | "historical">("current");
  const [sizeFilter, setSizeFilter] = useState<SizeFilter>("ALL");
  const [accDistFilter, setAccDistFilter] = useState<number | null>(null);
  
  // Search state
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightedTicker, setHighlightedTicker] = useState<string | null>(null);

  // Pop-out charting state and hooks
  const [msSyncEnabled, setMsSyncEnabled] = useState(false);
  const [chartSyncEnabled, setChartSyncEnabled] = useState(false);
  const [analysisSyncEnabled, setAnalysisSyncEnabled] = useState(false);
  const [analysisSheetSymbol, setAnalysisSheetSymbol] = useState<string | null>(null);
  const { syncToMarketSurge } = useMarketSurgeSync();
  const { syncToChart } = useChartPopout();

  // Live data hooks - pass time slice and size filter to API
  // Use isFetching for spinner, isLoading only for initial load overlay
  const { data: pollingStatus } = usePollingStatus();
  const { data: marketCondition, isLoading: themesLoading, isFetching: themesFetching, error: themesError, refetch: refetchThemes } = useMarketCondition({ 
    timeSlice, 
    sizeFilter,
    rotationBaseline: lensMode === "rotation" && timeSlice === "TODAY" ? "open930" : undefined,
  });
  const { data: rai, isLoading: raiLoading, isFetching: raiFetching } = useRAI();
  const { data: themeMembers, refetch: refetchMembers } = useThemeMembers(selectedTheme as ClusterId | null, timeSlice);
  const forceRefresh = useForceRefresh();
  const { toast } = useToast();
  
  // Force snapshot mutation (admin only)
  const forceSnapshotMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/market-condition/force-snapshot", { method: "POST" });
      if (!res.ok) throw new Error("Failed to save snapshot");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Snapshot saved", description: "Historical data updated" });
      refetchThemes();
    },
    onError: () => {
      toast({ title: "Failed to save snapshot", variant: "destructive" });
    },
  });
  
  // Fetch ticker-to-theme assignments for search
  const { data: tickerAssignments } = useQuery<Record<string, { theme: string; isCore: boolean }[]>>({
    queryKey: ["/api/market-condition/ticker-assignments"],
    queryFn: async () => {
      const res = await fetch("/api/market-condition/ticker-assignments");
      if (!res.ok) throw new Error("Failed to fetch ticker assignments");
      return res.json();
    },
  });
  
  // User info for admin check
  const { data: userInfo } = useQuery<{ id: number; username: string; isAdmin: boolean }>({
    queryKey: ["/api/sentinel/me"],
  });

  // Determine if we should use live or mock data
  const hasLiveData = !themesError && marketCondition?.themes && marketCondition.themes.length > 0;
  const shouldUseLive = useLiveData && hasLiveData;
  const isStale = marketCondition?.isStale ?? false;
  const [isRetrying, setIsRetrying] = useState(false);

  // Handle retry
  const handleRetry = useCallback(async () => {
    setIsRetrying(true);
    try {
      await refetchThemes();
    } finally {
      setIsRetrying(false);
    }
  }, [refetchThemes]);

  // Convert live themes to UI format or use mock
  const themes: ThemeRow[] = useMemo(() => {
    if (shouldUseLive && marketCondition?.themes) {
      return marketCondition.themes.map(convertToThemeRow);
    }
    return MOCK_THEMES;
  }, [shouldUseLive, marketCondition]);

  // Build market summary from live data or use mock
  const marketSummary: MarketConditionSummary = useMemo(() => {
    if (shouldUseLive && marketCondition && rai) {
      const sortedThemes = [...themes].sort((a, b) => b.score - a.score);
      return {
        regime: rai.label === "AGGRESSIVE" ? "RISK_ON" : rai.label === "DEFENSIVE" ? "RISK_OFF" : "NEUTRAL",
        spyPct: marketCondition.spyBenchmark?.changePct || 0,
        benchmarks: marketCondition.benchmarks,
        overallBreadth: themes.length > 0 
          ? themes.reduce((sum, t) => sum + t.breadthPct, 0) / themes.length 
          : 50,
        leadersCount: themes.filter(t => t.score >= 70).length,
        weakCount: themes.filter(t => t.score < 40).length,
        topTheme: sortedThemes[0]?.id || "SEMIS",
        bottomTheme: sortedThemes[sortedThemes.length - 1]?.id || "STRATEGIC_METALS",
        rai: {
          score: rai.score,
          components: rai.components,
          label: rai.label,
          riskMultiplier: rai.riskMultiplier,
        },
        megaOverlay: MOCK_MARKET_SUMMARY.megaOverlay, // Use mock for now
      };
    }
    return MOCK_MARKET_SUMMARY;
  }, [shouldUseLive, marketCondition, rai, themes]);

  // Get selected theme members
  const selectedThemeTickers: TickerRow[] = useMemo(() => {
    if (shouldUseLive && themeMembers?.members) {
      return themeMembers.members.map(m => ({
        symbol: m.symbol,
        name: getCompanyName(m.symbol),
        price: m.price,
        pct: m.pctChange,
        leaderScore: m.leaderScore || 50,
        rsVsSpy: m.rsVsSpy,
        volExp: m.volExp,
        momentum: m.momentum,
        isPrimary: m.isCore,
        isCore: m.isCore,
        accDistDays: m.accDistDays,
        trendState: m.trendState,
        isAbove50d: m.isAbove50d,
        isAbove200d: m.isAbove200d,
        contributionPct: m.contributionPct,
        rsRank: m.rsRank,
        pctVsEma10d: m.pctVsEma10d,
        pctVsEma20d: m.pctVsEma20d,
        pctVsSma50d: m.pctVsSma50d,
        pctVsSma200d: m.pctVsSma200d,
        prevDayVolExp: m.prevDayVolExp,
        historicalPrice: m.historicalPrice,
        historicalPct: m.historicalPct,
        historicalVolExp: m.historicalVolExp,
      }));
    }
    if (selectedTheme) {
      return MOCK_THEME_MEMBERS[selectedTheme] || [];
    }
    return [];
  }, [shouldUseLive, themeMembers, selectedTheme]);

  // Handle theme selection
  const handleThemeSelect = useCallback((themeId: ThemeId) => {
    setSelectedTheme(themeId);
  }, []);

  // Handle ticker click - navigate or sync to popout window
  const handleTickerSelect = useCallback(
    (symbol: string) => {
      if (analysisSyncEnabled) {
        setAnalysisSheetSymbol(symbol);
      }
      // If MarketSurge sync is enabled, drive the popout window
      if (msSyncEnabled) {
        syncToMarketSurge(symbol, 'day');
      }
      // If internal chart sync is enabled, drive the popout window
      if (chartSyncEnabled) {
        syncToChart(symbol);
      }
      // If neither sync is enabled, navigate in same window
      if (!msSyncEnabled && !chartSyncEnabled && !analysisSyncEnabled) {
        navigate(`/sentinel/charts?symbol=${symbol}`);
      }
    },
    [navigate, msSyncEnabled, chartSyncEnabled, analysisSyncEnabled, syncToMarketSurge, syncToChart]
  );

  // Handle ticker added - refresh members list
  const handleTickersAdded = useCallback(() => {
    refetchMembers();
  }, [refetchMembers]);

  // Get selected theme data
  const selectedThemeData = selectedTheme
    ? themes.find((t) => t.id === selectedTheme) || null
    : null;

  // Sort themes based on lens mode, then apply A/D filter
  const sortedThemes = useMemo((): ThemeRow[] => {
    let themesCopy = [...themes];
    
    // Apply A/D filter first (if set)
    if (accDistFilter !== null) {
      themesCopy = themesCopy.filter(t => Math.abs(t.accDistDays) >= accDistFilter);
    }
    
    switch (lensMode) {
      case "flow": {
        // Sort by ThemeScore — either current live score or the historical score for the selected timeframe
        const useHistorical = heatmapSort === "historical" && timeSlice !== "TODAY";
        return themesCopy.sort((a, b) => {
          const scoreA = useHistorical ? (a.historicalMetrics?.score ?? a.score) : a.score;
          const scoreB = useHistorical ? (b.historicalMetrics?.score ?? b.score) : b.score;
          return scoreB - scoreA;
        });
      }
      
      case "rotation": {
        const useHistoricalRot = heatmapSort === "historical" && timeSlice !== "TODAY";
        if (useHistoricalRot) {
          // Sort by score improvement (currentScore - historicalScore), biggest movers first
          return themesCopy.sort((a, b) => {
            const diffA = a.score - (a.historicalMetrics?.score ?? a.score);
            const diffB = b.score - (b.historicalMetrics?.score ?? b.score);
            if (diffB !== diffA) return diffB - diffA;
            return b.score - a.score;
          });
        }
        // Default: sort by deltaRank (rank position change), biggest climbers first
        return themesCopy.sort((a, b) => {
          const deltaA = a.deltaRank ?? 0;
          const deltaB = b.deltaRank ?? 0;
          if (deltaB !== deltaA) return deltaB - deltaA;
          return b.score - a.score;
        });
      }
      
      case "concentration":
        // Sort by top3Contribution (highest = narrowest leadership = most fragile)
        // Use top3Contribution (0-1) if available, fall back to top3Concentration (0-100)
        return themesCopy.sort((a, b) => {
          const concA = a.top3Contribution ?? (a.top3Concentration / 100) ?? 0;
          const concB = b.top3Contribution ?? (b.top3Concentration / 100) ?? 0;
          return concB - concA;
        });
      
      case "accumulation":
        // Sort by A/D streak (highest accumulation first, then highest distribution)
        return themesCopy.sort((a, b) => {
          const adA = a.accDistDays ?? 0;
          const adB = b.accDistDays ?? 0;
          if (adB !== adA) return adB - adA;
          return b.score - a.score;
        });
      
      default:
        return themesCopy;
    }
  }, [lensMode, themes, accDistFilter, heatmapSort, timeSlice]);

  // Build search results from query
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return { themes: [], tickers: [] };
    
    const q = searchQuery.toUpperCase();
    
    // Find matching themes (by name, max 5)
    const themeMatches = themes
      .filter(t => t.name.toUpperCase().includes(q))
      .slice(0, 5);
    
    // Find matching tickers (by symbol, max 10)
    const tickerMatches = tickerAssignments
      ? Object.keys(tickerAssignments)
          .filter(ticker => ticker.includes(q))
          .slice(0, 10)
          .map(ticker => ({ 
            symbol: ticker, 
            themeId: tickerAssignments[ticker][0]?.theme as ClusterId,
            themes: tickerAssignments[ticker] // Keep all themes for display
          }))
          .filter(t => t.themeId) // Filter out any without a theme
      : [];
    
    return { themes: themeMatches, tickers: tickerMatches };
  }, [searchQuery, themes, tickerAssignments]);

  // Handle search selection
  const handleSelectTicker = useCallback((symbol: string, themeId: ClusterId) => {
    setSelectedTheme(themeId as ThemeId);
    setHighlightedTicker(symbol);
    setSearchOpen(false);
    setSearchQuery("");
    if (analysisSyncEnabled) setAnalysisSheetSymbol(symbol);
  }, [analysisSyncEnabled]);

  const handleSelectTheme = useCallback((themeId: ThemeId) => {
    setSelectedTheme(themeId);
    setHighlightedTicker(null);
    setSearchOpen(false);
    setSearchQuery("");
  }, []);

  // Handle ESC key to exit fullscreen
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFullscreen]);

  // isLoading = initial load only (no data yet), isFetching = background refresh
  const isInitialLoading = themesLoading || raiLoading;
  const isFetching = themesFetching || raiFetching;
  const lastUpdated = marketCondition?.lastUpdated 
    ? new Date(marketCondition.lastUpdated) 
    : new Date();

  // When market is closed, show the last market day date instead of "TODAY" / "LIVE"
  const isMarketClosed = pollingStatus?.marketSession === "CLOSED" || pollingStatus?.marketSession === "AFTER_HOURS";
  const lastMarketDateLabel = useMemo(() => {
    if (!isMarketClosed) return null;
    // Walk backwards from today to find the last weekday (Mon-Fri)
    const d = new Date();
    // After hours on a weekday = today IS the last trading day
    // Weekend = go back to Friday
    while (d.getDay() === 0 || d.getDay() === 6) {
      d.setDate(d.getDate() - 1);
    }
    return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  }, [isMarketClosed]);
  
  // Format comparison time for display, with staleness indicator
  const { comparisonTimeLabel, isComparisonStale } = useMemo(() => {
    if (!marketCondition?.comparisonTime) return { comparisonTimeLabel: null, isComparisonStale: false };

    // 1D: when market is closed, "yesterday" is the day before the last trading session
    if (timeSlice === "1D") {
      const compTime = new Date(marketCondition.comparisonTime);
      const dateStr = compTime.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" });
      const label = isMarketClosed ? `vs Prior Close (${dateStr})` : "vs Yesterday's Close";
      return { comparisonTimeLabel: label, isComparisonStale: false };
    }

    // For weekly/monthly slices show the date, not a time
    if (timeSlice === "1W" || timeSlice === "1M") {
      const compTime = new Date(marketCondition.comparisonTime);
      const dateStr = compTime.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      return { comparisonTimeLabel: `vs ${dateStr}`, isComparisonStale: false };
    }

    // Intraday slices — show time and flag if stale
    const compTime = new Date(marketCondition.comparisonTime);
    const ageMinutes = Math.round((Date.now() - compTime.getTime()) / (60 * 1000));
    const expectedMaxMinutes: Record<string, number> = {
      "15M": 45,
      "30M": 75,
      "1H": 150,
      "4H": 360,
    };
    const maxExpected = expectedMaxMinutes[timeSlice] || 180;
    const isStale = ageMinutes > maxExpected;
    const timeStr = compTime.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
    const label = isStale ? `vs ${timeStr} (stale)` : `vs ${timeStr}`;
    return { comparisonTimeLabel: label, isComparisonStale: isStale };
  }, [marketCondition?.comparisonTime, timeSlice]);
  const comparisonUnavailable = marketCondition?.comparisonUnavailable ?? null;
  const canUseHistoricalComparison = timeSlice !== "TODAY" && !!marketCondition?.comparisonTime;
  useEffect(() => {
    if (timeSlice !== "TODAY" && !canUseHistoricalComparison && heatmapSort === "historical") {
      setHeatmapSort("current");
    }
  }, [timeSlice, canUseHistoricalComparison, heatmapSort]);

  return (
    <div className={cn("h-screen flex flex-col bg-slate-950", isFullscreen && "fixed inset-0 z-50")}>
      {/* Main App Navigation */}
      <SentinelHeader showSentiment={false} />
      
      {/* Market Condition Header - RAI, Regime, Metrics */}
      <HeaderBar 
        summary={marketSummary} 
        themes={themes} 
        lastUpdated={lastUpdated} 
        marketSession={pollingStatus?.marketSession} 
      />

      {/* Error Banner - shown when API fails */}
      {themesError && (
        <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/30 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-4 h-4 text-red-400" />
            <div>
              <span className="text-sm text-red-400 font-medium">Unable to connect to market data API</span>
              <span className="text-xs text-muted-foreground ml-2">Using cached/mock data as fallback</span>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={handleRetry}
            disabled={isRetrying}
            className="text-xs gap-1.5 border-red-500/30 hover:bg-red-500/10"
          >
            <RefreshCw className={cn("w-3 h-3", isRetrying && "animate-spin")} />
            {isRetrying ? "Retrying..." : "Retry"}
          </Button>
        </div>
      )}

      {/* Comparison availability banner */}
      {!themesError && comparisonUnavailable && (
        <div className="px-4 py-2 bg-yellow-500/10 border-b border-yellow-500/30 flex items-center gap-2 shrink-0">
          <AlertCircle className="w-4 h-4 text-yellow-400" />
          <span className="text-xs text-yellow-300">{comparisonUnavailable}</span>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-900/50 border-b border-slate-700/50 shrink-0">
        <div className="flex items-center gap-4">
          <Tooltip>
            <TooltipTrigger>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">Market Condition</span>
                <span className="text-xs text-muted-foreground">/ Flow Mode</span>
                {shouldUseLive ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400">LIVE</span>
                ) : (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400">MOCK</span>
                )}
                {shouldUseLive && isStale && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-400">STALE</span>
                )}
                <Info className="w-3 h-3 text-muted-foreground" />
              </div>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm">
              <p className="font-semibold mb-1">Market Condition Terminal</p>
              <p className="text-xs">Bloomberg-style capital narrative dashboard. {shouldUseLive ? "Using LIVE Alpaca data." : "Using MOCK data - server may not be running."}</p>
              {shouldUseLive && isStale && (
                <p className="text-xs mt-1 text-orange-400">Data is stale - last update was longer than expected. Will auto-refresh.</p>
              )}
              {pollingStatus && (
                <p className="text-xs mt-1 text-muted-foreground">
                  Polling: {pollingStatus.isPolling ? "Active" : "Stopped"} | 
                  Tickers: {pollingStatus.tickerCount} | 
                  Themes: {pollingStatus.themeCount}
                </p>
              )}
            </TooltipContent>
          </Tooltip>

          {/* Data Source Toggle */}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setUseLiveData(!useLiveData)}
          >
            {useLiveData ? "Switch to Mock" : "Switch to Live"}
          </Button>

          {/* Force Refresh */}
          {shouldUseLive && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => forceRefresh.mutate()}
                  disabled={forceRefresh.isPending}
                >
                  <RefreshCw className={cn("w-4 h-4", forceRefresh.isPending && "animate-spin")} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Force refresh all data</TooltipContent>
            </Tooltip>
          )}

          {/* Loading indicator - show subtle spinner during background refresh */}
          {isFetching && !themesError && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span className="text-xs">{isInitialLoading ? "Loading..." : ""}</span>
            </div>
          )}

          {/* Error indicator */}
          {themesError && (
            <Tooltip>
              <TooltipTrigger>
                <div className="flex items-center gap-1 text-red-400">
                  <AlertCircle className="w-4 h-4" />
                  <span className="text-xs">API Error</span>
                </div>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p className="font-semibold mb-1">Connection Error</p>
                <p className="text-xs text-red-400">{(themesError as Error).message}</p>
                <p className="text-xs text-muted-foreground mt-1">Mock data is being displayed as fallback.</p>
              </TooltipContent>
            </Tooltip>
          )}

          {/* Lens Mode Toggle */}
          <div className="flex items-center bg-slate-800/50 rounded-lg p-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-7 px-3 text-xs gap-1.5",
                    lensMode === "flow" && "bg-slate-700 text-cyan-400"
                  )}
                  onClick={() => handleLensMode("flow")}
                >
                  <TrendingUp className="w-3 h-3" />
                  FLOW
                </Button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p className="font-semibold">Flow Lens</p>
                <p className="text-xs">Sort by FlowScore (strength). Shows which themes have the strongest current capital flow. Default view.</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-7 px-3 text-xs gap-1.5",
                    lensMode === "rotation" && "bg-slate-700 text-purple-400"
                  )}
                  onClick={() => handleLensMode("rotation")}
                >
                  <ArrowUpDown className="w-3 h-3" />
                  ROTATION
                </Button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p className="font-semibold">Rotation Lens</p>
                <p className="text-xs">Sort by Δ Rank (fastest improving). Finds emerging narratives - themes climbing the leaderboard. This is what institutions chase.</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-7 px-3 text-xs gap-1.5",
                    lensMode === "concentration" && "bg-slate-700 text-yellow-400"
                  )}
                  onClick={() => handleLensMode("concentration")}
                >
                  <PieChart className="w-3 h-3" />
                  CONC
                </Button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p className="font-semibold">Concentration Lens</p>
                <p className="text-xs">Sort by Top-3 Contribution (narrow vs broad). High concentration = fragile, few names driving move. Low = healthy rotation.</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-7 px-3 text-xs gap-1.5",
                    lensMode === "accumulation" && "bg-slate-700 text-green-400"
                  )}
                  onClick={() => handleLensMode("accumulation")}
                >
                  <BarChart3 className="w-3 h-3" />
                  A/D
                </Button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p className="font-semibold">Accumulation/Distribution Lens</p>
                <p className="text-xs">Sort by consecutive accumulation/distribution days. Shows institutional commitment (William O'Neal style). High accumulation = sustained buying.</p>
              </TooltipContent>
            </Tooltip>
          </div>

          {/* A/D Filter */}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      "h-7 px-3 text-xs gap-1.5 border-slate-600/50 bg-slate-800/30",
                      accDistFilter !== null && "bg-green-500/20 border-green-500/40 text-green-300"
                    )}
                  >
                    <Filter className="w-3 h-3" />
                    {accDistFilter !== null ? `A/D ${accDistFilter}+` : "A/D Filter"}
                    <ChevronDown className="w-3 h-3" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Filter themes by accumulation/distribution streak</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setAccDistFilter(null)}>
                All Themes
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setAccDistFilter(3)}>
                A/D 3+ days
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setAccDistFilter(5)}>
                A/D 5+ days
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setAccDistFilter(7)}>
                A/D 7+ days
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Time Slice Selector — disabled for CONC and A/D modes */}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild disabled={timeSliceDisabledModes.has(lensMode)}>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={timeSliceDisabledModes.has(lensMode)}
                    className={cn(
                      "h-7 px-3 text-xs gap-1.5 border-slate-600/50 bg-slate-800/30",
                      timeSliceDisabledModes.has(lensMode) && "opacity-40 cursor-not-allowed"
                    )}
                  >
                    <Clock className="w-3 h-3" />
                    {timeSlice === "TODAY" && lastMarketDateLabel ? lastMarketDateLabel : timeSlice}
                    <ChevronDown className="w-3 h-3" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>
                {timeSliceDisabledModes.has(lensMode) ? (
                  <>
                    <p className="font-semibold">Not available in this mode</p>
                    <p className="text-xs">Concentration and A/D data are not stored historically. Switch to Flow or Rotation to use time slices.</p>
                  </>
                ) : (
                  <>
                    <p className="font-semibold">Time Slice</p>
                    <p className="text-xs">Select lookback period for returns and RS calculation</p>
                  </>
                )}
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="start" className="min-w-[140px]">
              {(Object.keys(TIME_SLICE_LABELS) as TimeSlice[]).map((slice) => (
                <DropdownMenuItem
                  key={slice}
                  onClick={() => handleTimeSlice(slice)}
                  className={cn(
                    "text-xs",
                    timeSlice === slice && "bg-slate-700"
                  )}
                >
                  <span className="font-mono w-8">{slice}</span>
                  <span className="text-muted-foreground ml-2">
                    {slice === "TODAY"
                      ? (isMarketClosed && lastMarketDateLabel ? `Last Close (${lastMarketDateLabel})` : "Today (Live)")
                      : slice === "1D" && isMarketClosed && lastMarketDateLabel
                        ? `vs Prior Close`
                        : TIME_SLICE_LABELS[slice]}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Search Ticker/Theme */}
          <Popover open={searchOpen} onOpenChange={setSearchOpen}>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-3 text-xs gap-1.5 border-slate-600/50 bg-slate-800/30"
                  >
                    <Search className="w-3 h-3" />
                    <span>Search</span>
                  </Button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent>
                <p className="font-semibold">Search Ticker or Theme</p>
                <p className="text-xs">Find any ticker or theme in the universe</p>
              </TooltipContent>
            </Tooltip>
            <PopoverContent className="w-[300px] p-0" align="start">
              <Command shouldFilter={false}>
                <CommandInput 
                  placeholder="Search ticker or theme..." 
                  value={searchQuery}
                  onValueChange={setSearchQuery}
                />
                <CommandList>
                  <CommandEmpty>No results found.</CommandEmpty>
                  
                  {searchResults.themes.length > 0 && (
                    <CommandGroup heading="Themes">
                      {searchResults.themes.map((theme) => (
                        <CommandItem
                          key={theme.id}
                          onSelect={() => handleSelectTheme(theme.id)}
                          className="cursor-pointer"
                        >
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-cyan-400" />
                            <span>{theme.name}</span>
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                  
                  {searchResults.tickers.length > 0 && (
                    <CommandGroup heading="Tickers">
                      {searchResults.tickers.map((ticker) => (
                        <CommandItem
                          key={ticker.symbol}
                          onSelect={() => handleSelectTicker(ticker.symbol, ticker.themeId)}
                          className="cursor-pointer"
                        >
                          <div className="flex items-center justify-between w-full gap-2">
                            <span className="font-mono font-semibold">{ticker.symbol}</span>
                            <span className="text-xs text-muted-foreground truncate">
                              {ticker.themes.length > 1 
                                ? ticker.themes.map(t => themes.find(th => th.id === t.theme)?.name?.split(' ')[0] || t.theme).join(', ')
                                : themes.find(t => t.id === ticker.themeId)?.name
                              }
                            </span>
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          {/* Size Filter */}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-3 text-xs gap-1.5 border-slate-600/50 bg-slate-800/30"
                  >
                    <Filter className="w-3 h-3" />
                    {sizeFilter}
                    <ChevronDown className="w-3 h-3" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>
                <p className="font-semibold">Size Filter</p>
                <p className="text-xs">Filter themes by market cap benchmark</p>
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="start" className="min-w-[160px]">
              {(Object.keys(SIZE_FILTER_LABELS) as SizeFilter[]).map((size) => (
                <DropdownMenuItem
                  key={size}
                  onClick={() => setSizeFilter(size)}
                  className={cn(
                    "text-xs",
                    sizeFilter === size && "bg-slate-700"
                  )}
                >
                  <span className="font-mono w-10">{size}</span>
                  <span className="text-muted-foreground ml-2 text-[10px]">{SIZE_FILTER_LABELS[size]}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center gap-2">
          {/* View Mode Toggle */}
          <div className="flex items-center bg-slate-800/50 rounded-lg p-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-7 px-2",
                    viewMode === "grid" && "bg-slate-700"
                  )}
                  onClick={() => setViewMode("grid")}
                >
                  <Grid3X3 className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Heatmap View - Visual grid of all themes</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-7 px-2",
                    viewMode === "table" && "bg-slate-700"
                  )}
                  onClick={() => setViewMode("table")}
                >
                  <List className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Table View - Sortable rotation table</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-7 px-2",
                    viewMode === "split" && "bg-slate-700"
                  )}
                  onClick={() => setViewMode("split")}
                >
                  <LayoutGrid className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Split View - All panels visible with resizable dividers</TooltipContent>
            </Tooltip>
          </div>

          {/* Fullscreen Toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsFullscreen(!isFullscreen)}
              >
                {isFullscreen ? (
                  <Minimize2 className="w-4 h-4" />
                ) : (
                  <Maximize2 className="w-4 h-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{isFullscreen ? "Exit Fullscreen (Esc)" : "Fullscreen Mode"}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Loading overlay - only show on initial load, not background refetches */}
      {isInitialLoading && !marketCondition && (
        <div className="absolute inset-0 bg-slate-950/50 flex items-center justify-center z-10 pointer-events-none">
          <div className="flex items-center gap-2 text-cyan-400">
            <RefreshCw className="w-5 h-5 animate-spin" />
            <span>Loading market data...</span>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 overflow-hidden p-2">
        {viewMode === "split" ? (
          <PanelGroup
            direction="vertical"
            className="h-full"
            autoSaveId="market-condition-layout"
          >
            {/* Top Section - Heatmap, Details, Members */}
            <Panel defaultSize={65} minSize={30}>
              <PanelGroup direction="horizontal" autoSaveId="market-condition-top">
                {/* Heatmap Panel */}
                <Panel defaultSize={45} minSize={25}>
                  <div className="h-full bg-slate-900/80 rounded-lg border border-slate-700/50 overflow-hidden flex flex-col">
                    <PanelHeader
                      title="Theme Heatmap"
                      tooltip="Visual grid of all 19 themes. Color = FlowScore (green=strong, red=weak). Click to select. Drag edges to resize panels."
                      subtitle={comparisonTimeLabel || undefined}
                      action={
                        <div className="flex items-center gap-2">
                          {/* Sort toggle — shown in Flow and Rotation modes */}
                          {(lensMode === "flow" || lensMode === "rotation") && (
                            <div className="flex items-center gap-1.5" style={{ marginRight: "100px", marginLeft: "16px" }}>
                              <span className={cn(
                                "text-[15px] select-none font-medium px-3",
                                timeSlice === "TODAY" ? "text-green-400" : "text-purple-300"
                              )}>
                                {timeSlice === "TODAY"
                                  ? (pollingStatus?.marketSession === "MARKET_HOURS" ? "LIVE" : pollingStatus?.marketSession === "AFTER_HOURS" ? "After Hours" : "Closed")
                                  : `${timeSlice} Sort:`}
                              </span>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    onClick={() => setHeatmapSort("current")}
                                    className={cn(
                                      "text-[15px] font-medium px-2 py-0.5 rounded transition-colors",
                                      heatmapSort === "current"
                                        ? "bg-green-500/20 text-green-400 border border-green-500/40"
                                        : "text-slate-500 hover:text-slate-300"
                                    )}
                                  >
                                    {lensMode === "rotation" && timeSlice === "TODAY"
                                      ? "Today (vs 9:30am open)"
                                      : (lastMarketDateLabel ?? "Today")}
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent className="text-xs">
                                  {lensMode === "flow"
                                    ? "Sort by today's live ThemeScore"
                                    : timeSlice === "TODAY"
                                      ? "Sort by rank position change (Δ Rank) vs 9:30am open"
                                      : "Sort by rank position change (Δ Rank)"}
                                </TooltipContent>
                              </Tooltip>
                              {timeSlice !== "TODAY" && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      onClick={() => {
                                        if (canUseHistoricalComparison) setHeatmapSort("historical");
                                      }}
                                      className={cn(
                                        "text-[15px] font-medium px-2 py-0.5 rounded transition-colors",
                                        !canUseHistoricalComparison && "opacity-40 cursor-not-allowed",
                                        heatmapSort === "historical"
                                          ? "bg-purple-500/20 text-purple-300 border border-purple-500/40"
                                          : "text-slate-500 hover:text-slate-300"
                                      )}
                                    >
                                      {marketCondition?.comparisonTime
                                        ? (() => {
                                            const d = new Date(marketCondition.comparisonTime!);
                                            const isSubDay = timeSlice === "15M" || timeSlice === "30M" || timeSlice === "1H";
                                            return isSubDay
                                              ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
                                              : `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
                                          })()
                                        : timeSlice}
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent className="text-xs">
                                    {!canUseHistoricalComparison
                                      ? `No ${timeSlice} baseline available yet`
                                      : (lensMode === "flow"
                                        ? `Sort by ThemeScore as of ${TIME_SLICE_LABELS[timeSlice]}`
                                        : `Sort by score improvement since ${TIME_SLICE_LABELS[timeSlice]}`)}
                                  </TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                          )}
                          {userInfo?.isAdmin && isComparisonStale && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-5 px-1.5 text-orange-400 hover:text-orange-300 hover:bg-orange-500/10"
                                  onClick={() => forceSnapshotMutation.mutate()}
                                  disabled={forceSnapshotMutation.isPending}
                                >
                                  <RefreshCw className={cn("w-3 h-3", forceSnapshotMutation.isPending && "animate-spin")} />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Force save snapshot (admin)</TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      }
                    />
                    <div className="flex-1 overflow-auto">
                      <ThemeHeatmapGrid
                        themes={sortedThemes}
                        selectedTheme={selectedTheme}
                        onThemeSelect={handleThemeSelect}
                        totalThemes={themes.length}
                        timeSlice={timeSlice}
                      />
                    </div>
                  </div>
                </Panel>

                <ResizeHandle direction="vertical" />

                {/* Details Panel */}
                <Panel defaultSize={35} minSize={20}>
                  <div className="h-full bg-slate-900/80 rounded-lg border border-slate-700/50 overflow-hidden flex flex-col">
                    <PanelHeader
                      title="Theme Details"
                      tooltip="Deep metrics for selected theme: Score breakdown, Rotation Delta, Leader Concentration, Signals. This is your decision context."
                    />
                    <div className="flex-1 overflow-auto">
                      <ThemeDetailPanel 
                        theme={selectedThemeData} 
                        members={selectedThemeTickers}
                        totalThemes={themes.length}
                        accDistStats={themeMembers?.accDistStats}
                        timeSlice={timeSlice}
                      />
                    </div>
                  </div>
                </Panel>

                <ResizeHandle direction="vertical" />

                {/* Members Panel */}
                <Panel defaultSize={20} minSize={15}>
                  <div className="h-full bg-slate-900/80 rounded-lg border border-slate-700/50 overflow-hidden flex flex-col">
                    <PanelHeader
                      title="Theme Members"
                      tooltip="Individual stocks in the selected theme. Sorted by LeaderScore. Click ticker to open chart. Green dot = strong leader."
                    />
                    <div className="flex-1 overflow-auto">
                      <TickerWorkbench
                        themeId={selectedTheme}
                        themeName={selectedThemeData?.name || null}
                        tickers={selectedThemeTickers}
                        onTickerSelect={handleTickerSelect}
                        onTickersAdded={handleTickersAdded}
                        isAdmin={userInfo?.isAdmin ?? false}
                        highlightedTicker={highlightedTicker}
                        timeSlice={timeSlice}
                        msSyncEnabled={msSyncEnabled}
                        onMsSyncToggle={() => setMsSyncEnabled(!msSyncEnabled)}
                        chartSyncEnabled={chartSyncEnabled}
                        onChartSyncToggle={() => setChartSyncEnabled(!chartSyncEnabled)}
                        analysisSyncEnabled={analysisSyncEnabled}
                        onAnalysisSyncToggle={() => setAnalysisSyncEnabled(!analysisSyncEnabled)}
                        onOpenAnalysis={(symbol) => setAnalysisSheetSymbol(symbol)}
                      />
                    </div>
                  </div>
                </Panel>
              </PanelGroup>
            </Panel>

            <ResizeHandle direction="horizontal" />

            {/* Bottom Section - Rotation Table */}
            <Panel defaultSize={35} minSize={20}>
              <div className="h-full bg-slate-900/80 rounded-lg border border-slate-700/50 overflow-hidden flex flex-col">
                <PanelHeader
                  title="Rotation Table"
                  tooltip="Full metrics table. Click column headers to sort. Δ Rank shows position change - this is rotation velocity. What institutions chase."
                />
                <div className="flex-1 overflow-auto">
                  <RotationTable
                    themes={sortedThemes}
                    selectedTheme={selectedTheme}
                    onThemeSelect={handleThemeSelect}
                    lensMode={lensMode}
                    timeSlice={timeSlice}
                  />
                </div>
              </div>
            </Panel>
          </PanelGroup>
        ) : viewMode === "grid" ? (
          <div className="h-full bg-slate-900/80 rounded-lg border border-slate-700/50 overflow-auto">
            <ThemeHeatmapGrid
              themes={sortedThemes}
              selectedTheme={selectedTheme}
              onThemeSelect={handleThemeSelect}
              totalThemes={themes.length}
              timeSlice={timeSlice}
            />
          </div>
        ) : (
          <div className="h-full bg-slate-900/80 rounded-lg border border-slate-700/50 overflow-auto">
            <RotationTable
              themes={sortedThemes}
              selectedTheme={selectedTheme}
              onThemeSelect={handleThemeSelect}
              lensMode={lensMode}
              timeSlice={timeSlice}
            />
          </div>
        )}
      </div>
      <AnalysisPanel
        variant="floating"
        symbol={analysisSheetSymbol}
        open={analysisSheetSymbol !== null}
        onOpenChange={(open) => !open && setAnalysisSheetSymbol(null)}
      />
    </div>
  );
}
