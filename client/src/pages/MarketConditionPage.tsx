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
  ThemeDetailPanelActionable,
  RotationTable,
  TickerWorkbench,
  ThemeRaceLanes,
  FlowMapPanel,
  FlowMapFocusBox,
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
import { Grid3X3, List, LayoutGrid, Maximize2, Minimize2, TrendingUp, ArrowUpDown, PieChart, Info, GripVertical, GripHorizontal, RefreshCw, AlertCircle, Clock, Filter, ChevronDown, BarChart3, Search, Car, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import type { FlowMapFocusData } from "@/components/market-condition/FlowMapPanel";

type ViewMode = "grid" | "table" | "split";
type LensMode = "flow" | "rotation" | "flowMap" | "concentration" | "accumulation" | "race";

// Time slice label mapping
const TIME_SLICE_LABELS: Record<TimeSlice, string> = {
  "TODAY": "Today (Live)",
  "15M": "15 Minutes",
  "30M": "30 Minutes",
  "1H": "1 Hour",
  "4H": "4 Hours",
  "1D": "vs Yesterday",
  "5D": "5 Days",
  "10D": "10 Days",
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
      {action ? <div className="ml-auto flex items-center gap-2">{action}</div> : null}
    </div>
  );
}

export default function MarketConditionPage() {
  const [, navigate] = useLocation();
  const [selectedTheme, setSelectedTheme] = useState<ThemeId | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [lensMode, setLensMode] = useState<LensMode>("flowMap");
  const timeSliceDisabledModes = new Set<LensMode>(["flowMap", "concentration", "accumulation", "race"]);
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
  const [isRacePopoutOpen, setIsRacePopoutOpen] = useState(false);
  const [isRacePopoutMaximized, setIsRacePopoutMaximized] = useState(false);
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
  const [flowMapFocusData, setFlowMapFocusData] = useState<FlowMapFocusData | null>(null);
  const [flowMapCenterTab, setFlowMapCenterTab] = useState<"flowFocus" | "actionableDetails" | "legacyDetails">("flowFocus");
  const [showFocusedPanel, setShowFocusedPanel] = useState(true);
  const [showMembersPanel, setShowMembersPanel] = useState(true);
  const [showRotationTablePanel, setShowRotationTablePanel] = useState(true);
  const { syncToMarketSurge } = useMarketSurgeSync();
  const { syncToChart } = useChartPopout();

  // Live data hooks - pass time slice and size filter to API
  // Use isFetching for spinner, isLoading only for initial load overlay
  const { data: pollingStatus } = usePollingStatus();
  const { data: marketCondition, isLoading: themesLoading, isFetching: themesFetching, error: themesError, refetch: refetchThemes } = useMarketCondition({ 
    timeSlice, 
    sizeFilter,
    rotationBaseline:
      (lensMode === "rotation" || lensMode === "race") && timeSlice === "TODAY"
        ? "open930"
        : undefined,
  });
  const { data: rai, isLoading: raiLoading, isFetching: raiFetching } = useRAI();
  const { data: themeMembers, refetch: refetchMembers } = useThemeMembers(selectedTheme as ClusterId | null, timeSlice);
  const forceRefresh = useForceRefresh();
  const { toast } = useToast();
  const splitPanelsHiddenCount =
    (showFocusedPanel ? 0 : 1) + (showMembersPanel ? 0 : 1) + (showRotationTablePanel ? 0 : 1);
  
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

      case "race":
        return themesCopy.sort((a, b) => {
          if (b.acceleration !== a.acceleration) return b.acceleration - a.acceleration;
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

  const racePopoutStyle = isRacePopoutMaximized
    ? {
        width: "calc(100vw - 1rem)",
        height: "calc(100dvh - 1rem)",
        maxWidth: "calc(100vw - 1rem)",
        maxHeight: "calc(100dvh - 1rem)",
      }
    : {
        width: "min(1180px, calc(100vw - 2rem))",
        height: "min(860px, calc(100dvh - 2rem))",
        minWidth: "min(680px, calc(100vw - 2rem))",
        minHeight: "min(520px, calc(100dvh - 2rem))",
        maxWidth: "calc(100vw - 1rem)",
        maxHeight: "calc(100dvh - 1rem)",
        resize: "both" as const,
      };

  const renderThemeRaceLanes = () => (
    <ThemeRaceLanes
      themes={sortedThemes}
      selectedTheme={selectedTheme}
      onThemeSelect={handleThemeSelect}
      totalThemes={themes.length}
      isFetching={themesFetching}
      tooltipTimeSlice={timeSlice}
    />
  );

  const renderSplitTopSection = () => (
    <PanelGroup direction="horizontal" autoSaveId="market-condition-top">
      <Panel defaultSize={45} minSize={25}>
        <div className="h-full bg-slate-900/80 rounded-lg border border-slate-700/50 overflow-hidden flex flex-col">
          <PanelHeader
            title={lensMode === "race" ? "Theme race" : lensMode === "flowMap" ? "Theme Flow Map" : "Theme Heatmap"}
            tooltip={
              lensMode === "race"
                ? "Theme race: scrub hourly or daily snapshot history, or use live data when history is empty. Click a lane to select a theme."
                : lensMode === "flowMap"
                  ? "Theme-to-theme flow matrix. Sort Theme/Strength/timeframes, set a global comp baseline, then click cells for route details."
                  : "Visual grid of all 19 themes. Color = FlowScore (green=strong, red=weak). Click to select. Drag edges to resize panels."
            }
            subtitle={lensMode === "race" || lensMode === "flowMap" ? undefined : comparisonTimeLabel || undefined}
            action={
              <div className="flex items-center gap-2">
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
                {lensMode === "race" && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-cyan-300 hover:bg-cyan-500/10 hover:text-cyan-200"
                        onClick={() => setIsRacePopoutOpen(true)}
                      >
                        <Maximize2 className="mr-1 h-3.5 w-3.5" />
                        Expand
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Open Theme Race in a resizable pop-out</TooltipContent>
                  </Tooltip>
                )}
              </div>
            }
          />
          <div className="flex-1 overflow-auto min-h-0">
            {lensMode === "race" ? (
              renderThemeRaceLanes()
            ) : lensMode === "flowMap" ? (
              <FlowMapPanel
                selectedTheme={selectedTheme}
                onThemeSelect={handleThemeSelect}
                sizeFilter={sizeFilter}
                onFocusDataChange={setFlowMapFocusData}
              />
            ) : (
              <ThemeHeatmapGrid
                themes={sortedThemes}
                selectedTheme={selectedTheme}
                onThemeSelect={handleThemeSelect}
                totalThemes={themes.length}
                timeSlice={timeSlice}
              />
            )}
          </div>
        </div>
      </Panel>

      {showFocusedPanel && (
        <>
          <ResizeHandle direction="vertical" />
          <Panel defaultSize={showMembersPanel ? 35 : 45} minSize={20}>
            <div className="h-full bg-slate-900/80 rounded-lg border border-slate-700/50 overflow-hidden flex flex-col">
              <PanelHeader
                title={lensMode === "flowMap" ? "Focused Theme" : "Theme Details"}
                tooltip={
                  lensMode === "flowMap"
                    ? "Focused flow box: top inflow/outflow routes and selected route driver breakdown."
                    : "Deep metrics for selected theme: Score breakdown, Rotation Delta, Leader Concentration, Signals. This is your decision context."
                }
                action={
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-slate-300 hover:bg-slate-700/60 hover:text-slate-100"
                        onClick={() => setShowFocusedPanel(false)}
                      >
                        <EyeOff className="mr-1 h-3.5 w-3.5" />
                        Hide
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Hide Focused Theme panel</TooltipContent>
                  </Tooltip>
                }
              />
              <div className="flex-1 overflow-auto">
                {lensMode === "flowMap" ? (
                  <div className="flex h-full min-h-0 flex-col">
                    <div className="border-b border-slate-700/40 px-2 py-1.5">
                      <div className="inline-flex items-center rounded border border-slate-700/60 bg-slate-800/40 p-0.5">
                        <button
                          className={cn(
                            "rounded px-2.5 py-1 text-[11px] font-medium",
                            flowMapCenterTab === "flowFocus"
                              ? "bg-cyan-500/20 text-cyan-200"
                              : "text-slate-300 hover:text-slate-100"
                          )}
                          onClick={() => setFlowMapCenterTab("flowFocus")}
                        >
                          Flow Focus
                        </button>
                        <button
                          className={cn(
                            "rounded px-2.5 py-1 text-[11px] font-medium",
                            flowMapCenterTab === "actionableDetails"
                              ? "bg-cyan-500/20 text-cyan-200"
                              : "text-slate-300 hover:text-slate-100"
                          )}
                          onClick={() => setFlowMapCenterTab("actionableDetails")}
                        >
                          Actionable Details
                        </button>
                        <button
                          className={cn(
                            "rounded px-2.5 py-1 text-[11px] font-medium",
                            flowMapCenterTab === "legacyDetails"
                              ? "bg-cyan-500/20 text-cyan-200"
                              : "text-slate-300 hover:text-slate-100"
                          )}
                          onClick={() => setFlowMapCenterTab("legacyDetails")}
                        >
                          Legacy Details
                        </button>
                      </div>
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto">
                      {flowMapCenterTab === "flowFocus" ? (
                        <FlowMapFocusBox data={flowMapFocusData} />
                      ) : flowMapCenterTab === "actionableDetails" ? (
                        <ThemeDetailPanelActionable
                          theme={selectedThemeData}
                          members={selectedThemeTickers}
                          totalThemes={themes.length}
                          accDistStats={themeMembers?.accDistStats}
                          timeSlice={timeSlice}
                        />
                      ) : (
                        <ThemeDetailPanel
                          theme={selectedThemeData}
                          members={selectedThemeTickers}
                          totalThemes={themes.length}
                          accDistStats={themeMembers?.accDistStats}
                          timeSlice={timeSlice}
                        />
                      )}
                    </div>
                  </div>
                ) : (
                  <ThemeDetailPanel 
                    theme={selectedThemeData} 
                    members={selectedThemeTickers}
                    totalThemes={themes.length}
                    accDistStats={themeMembers?.accDistStats}
                    timeSlice={timeSlice}
                  />
                )}
              </div>
            </div>
          </Panel>
        </>
      )}

      {showMembersPanel && (
        <>
          <ResizeHandle direction="vertical" />
          <Panel defaultSize={showFocusedPanel ? 20 : 28} minSize={15}>
            <div className="h-full bg-slate-900/80 rounded-lg border border-slate-700/50 overflow-hidden flex flex-col">
              <PanelHeader
                title="Theme Members"
                tooltip="Individual stocks in the selected theme. Sorted by LeaderScore. Click ticker to open chart. Green dot = strong leader."
                action={
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-slate-300 hover:bg-slate-700/60 hover:text-slate-100"
                        onClick={() => setShowMembersPanel(false)}
                      >
                        <EyeOff className="mr-1 h-3.5 w-3.5" />
                        Hide
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Hide Theme Members panel</TooltipContent>
                  </Tooltip>
                }
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
        </>
      )}
    </PanelGroup>
  );

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
                    lensMode === "flowMap" && "bg-slate-700 text-cyan-300"
                  )}
                  onClick={() => handleLensMode("flowMap")}
                >
                  <LayoutGrid className="w-3 h-3" />
                  FLOW MAP
                </Button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p className="font-semibold">Flow Map Lens</p>
                <p className="text-xs">
                  Theme-to-theme rotation matrix with sortable timeframe columns, route scoring, and comp-vs timeframe baseline.
                </p>
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
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-7 px-3 text-xs gap-1.5",
                    lensMode === "race" && "bg-slate-700 text-amber-400"
                  )}
                  onClick={() => handleLensMode("race")}
                >
                  <Car className="w-3 h-3" />
                  RACE
                </Button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p className="font-semibold">Race view</p>
                <p className="text-xs">
                  Timeline from stored snapshots when available; otherwise live metrics. Lanes use RS momentum between frames; live edge highlights the current acceleration leader.
                </p>
              </TooltipContent>
            </Tooltip>
          </div>

          {/* A/D Filter */}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild disabled={lensMode === "race" || lensMode === "flowMap"}>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={lensMode === "race" || lensMode === "flowMap"}
                    className={cn(
                      "h-7 px-3 text-xs gap-1.5 border-slate-600/50 bg-slate-800/30",
                      accDistFilter !== null && "bg-green-500/20 border-green-500/40 text-green-300",
                      (lensMode === "race" || lensMode === "flowMap") && "opacity-40 cursor-not-allowed"
                    )}
                  >
                    <Filter className="w-3 h-3" />
                    {accDistFilter !== null ? `A/D ${accDistFilter}+` : "A/D Filter"}
                    <ChevronDown className="w-3 h-3" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>
                {lensMode === "race" || lensMode === "flowMap"
                  ? "Not available in this mode"
                  : "Filter themes by accumulation/distribution streak"}
              </TooltipContent>
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
                    <p className="text-xs">
                      {lensMode === "race"
                        ? "Race mode has its own timeline controls below the visualization."
                        : lensMode === "flowMap"
                          ? "Flow Map has built-in matrix controls and snapshot comparators."
                        : "Concentration and A/D data are not stored historically. Switch to Flow or Rotation to use time slices."}
                    </p>
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
                <DropdownMenuTrigger asChild disabled={lensMode === "race"}>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={lensMode === "race"}
                    className={cn(
                      "h-7 px-3 text-xs gap-1.5 border-slate-600/50 bg-slate-800/30",
                      lensMode === "race" && "opacity-40 cursor-not-allowed"
                    )}
                  >
                    <Filter className="w-3 h-3" />
                    {sizeFilter}
                    <ChevronDown className="w-3 h-3" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>
                {lensMode === "race" ? (
                  <>
                    <p className="font-semibold">Not available in Race mode</p>
                    <p className="text-xs">Race displays all themes</p>
                  </>
                ) : (
                  <>
                    <p className="font-semibold">Size Filter</p>
                    <p className="text-xs">Filter themes by market cap benchmark</p>
                  </>
                )}
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
          {viewMode === "split" && splitPanelsHiddenCount > 0 && (
            <div className="flex items-center gap-1 rounded-lg border border-slate-700/60 bg-slate-800/40 px-2 py-1">
              <span className="px-1 text-[11px] text-slate-400">Show:</span>
              {!showFocusedPanel && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-2 text-xs text-slate-200 hover:bg-slate-700"
                  onClick={() => setShowFocusedPanel(true)}
                >
                  <Eye className="h-3 w-3" />
                  Focused Theme
                </Button>
              )}
              {!showMembersPanel && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-2 text-xs text-slate-200 hover:bg-slate-700"
                  onClick={() => setShowMembersPanel(true)}
                >
                  <Eye className="h-3 w-3" />
                  Theme Members
                </Button>
              )}
              {!showRotationTablePanel && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-2 text-xs text-slate-200 hover:bg-slate-700"
                  onClick={() => setShowRotationTablePanel(true)}
                >
                  <Eye className="h-3 w-3" />
                  Rotation Table
                </Button>
              )}
              {splitPanelsHiddenCount > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs text-cyan-300 hover:bg-cyan-500/10 hover:text-cyan-200"
                  onClick={() => {
                    setShowFocusedPanel(true);
                    setShowMembersPanel(true);
                    setShowRotationTablePanel(true);
                  }}
                >
                  Show All
                </Button>
              )}
            </div>
          )}

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
          showRotationTablePanel ? (
            <PanelGroup
              direction="vertical"
              className="h-full"
              autoSaveId="market-condition-layout"
            >
              <Panel defaultSize={65} minSize={30}>
                {renderSplitTopSection()}
              </Panel>

              <ResizeHandle direction="horizontal" />

              <Panel defaultSize={35} minSize={20}>
                <div className="h-full bg-slate-900/80 rounded-lg border border-slate-700/50 overflow-hidden flex flex-col">
                  <PanelHeader
                    title="Rotation Table"
                    tooltip="Full metrics table. Click column headers to sort. Δ Rank shows position change - this is rotation velocity. What institutions chase."
                    action={
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-slate-300 hover:bg-slate-700/60 hover:text-slate-100"
                            onClick={() => setShowRotationTablePanel(false)}
                          >
                            <EyeOff className="mr-1 h-3.5 w-3.5" />
                            Hide
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Hide Rotation Table panel</TooltipContent>
                      </Tooltip>
                    }
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
          ) : (
            <div className="h-full">
              {renderSplitTopSection()}
            </div>
          )
        ) : lensMode === "flowMap" ? (
          <div className="h-full bg-slate-900/80 rounded-lg border border-slate-700/50 overflow-hidden">
            <FlowMapPanel
              selectedTheme={selectedTheme}
              onThemeSelect={handleThemeSelect}
              sizeFilter={sizeFilter}
              onFocusDataChange={setFlowMapFocusData}
            />
          </div>
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
      <Dialog
        open={isRacePopoutOpen}
        onOpenChange={(open) => {
          setIsRacePopoutOpen(open);
          if (!open) setIsRacePopoutMaximized(false);
        }}
      >
        <DialogContent
          className={cn(
            "flex max-w-none flex-col gap-0 overflow-hidden border border-slate-700/70 bg-slate-950/95 p-0 shadow-2xl",
            isRacePopoutMaximized
              ? "h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)]"
              : "w-auto"
          )}
          style={racePopoutStyle}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>Theme Race pop-out</DialogTitle>
            <DialogDescription>
              Resizable Theme Race view with vertical scrolling and maximize or restore controls.
            </DialogDescription>
          </DialogHeader>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-14 top-3 z-20 h-8 w-8 text-slate-300 hover:bg-slate-800 hover:text-slate-100"
                onClick={() => setIsRacePopoutMaximized((value) => !value)}
              >
                {isRacePopoutMaximized ? (
                  <Minimize2 className="h-4 w-4" />
                ) : (
                  <Maximize2 className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {isRacePopoutMaximized ? "Restore pop-out size" : "Maximize pop-out"}
            </TooltipContent>
          </Tooltip>
          <div className="flex items-start justify-between gap-3 border-b border-slate-700/60 bg-slate-900/80 px-4 py-3 pr-24">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-slate-100">Theme Race</h2>
              <p className="text-xs text-slate-400">
                Pop-out view for the full race tool. Resize the window and scroll vertically through all themes.
              </p>
            </div>
            <div className="shrink-0 text-[11px] text-slate-500">
              {isRacePopoutMaximized ? "Maximized" : "Resizable"}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {renderThemeRaceLanes()}
          </div>
        </DialogContent>
      </Dialog>
      <AnalysisPanel
        variant="floating"
        symbol={analysisSheetSymbol}
        open={analysisSheetSymbol !== null}
        onOpenChange={(open) => !open && setAnalysisSheetSymbol(null)}
      />
    </div>
  );
}
