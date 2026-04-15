import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useSearch, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useSentinelDailyChartData, useSentinelIntradayChartData } from "@/hooks/use-sentinel-chart-data";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useMarketSurgeSync } from "@/hooks/useMarketSurgeSync";
import { useAddToWatchlist, useRemoveFromWatchlist, useUpdateWatchlist, useAddToWatchlistWithTradePlan, useSelectedWatchlistId, useWatchlists, WATCHLIST_MANAGER_STORAGE_KEY, useNamedWatchlistItems, type SentinelWatchlistItem } from "@/hooks/use-watchlist";
import { WatchlistSelector } from "@/components/WatchlistSelector";
import { SentinelHeader } from "@/components/SentinelHeader";
import { CopyScreenButton } from "@/components/CopyScreenButton";
import { DualChartGrid, ChartMetrics } from "@/components/DualChartGrid";
import { AskIvyOverlay } from "@/components/AskIvyOverlay";
import { useSystemSettings } from "@/context/SystemSettingsContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Search, Sparkles, Eye, X, ExternalLink, Star, ChevronLeft, ChevronRight, ChevronDown, Newspaper, Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";


export default function SentinelChartsPage() {
  const { cssVariables } = useSystemSettings();
  const { toast } = useToast();
  const { syncToMarketSurge } = useMarketSurgeSync();
  const [, navigate] = useLocation();
  const searchString = useSearch();
  const urlParams = new URLSearchParams(searchString);
  const initialSymbol = urlParams.get("symbol") || "";

  const [tickerInput, setTickerInput] = useState(initialSymbol);
  const [activeSymbol, setActiveSymbol] = useState(initialSymbol.toUpperCase());
  const [intradayTimeframe, setIntradayTimeframe] = useState("5min");
  const [showETH, setShowETHState] = useState<boolean>(() => {
    try {
      return localStorage.getItem("sentinelChartsShowETH") === "true";
    } catch {
      return false;
    }
  });
  const onShowETHChange = useCallback((next: boolean) => {
    setShowETHState(next);
    try {
      localStorage.setItem("sentinelChartsShowETH", String(next));
    } catch {
      /* ignore */
    }
  }, []);
  const [msSyncEnabled, setMsSyncEnabled] = useState(false);
  const [newsOpen, setNewsOpen] = useState(false);
  // Persist Trade Plan open state in localStorage
  const [askIvyOpen, setAskIvyOpenState] = useState(() => {
    try {
      return localStorage.getItem("askIvyOverlayOpen") === "true";
    } catch { return false; }
  });
  const setAskIvyOpen = (value: boolean | ((prev: boolean) => boolean)) => {
    setAskIvyOpenState((prev) => {
      const newValue = typeof value === "function" ? value(prev) : value;
      try { localStorage.setItem("askIvyOverlayOpen", String(newValue)); } catch {}
      return newValue;
    });
  };
  const [ivyEntryLevel, setIvyEntryLevel] = useState<{ price: number; label: string; type?: string } | null>(null);
  const [ivyStopLevel, setIvyStopLevel] = useState<{ price: number; label: string; type?: string } | null>(null);
  const [ivyTargetLevel, setIvyTargetLevel] = useState<{ price: number; label: string } | null>(null);
  
  // Chart click state for Trade Plan
  const [ivyChartClick, setIvyChartClick] = useState<{ price: number; timestamp: number } | null>(null);
  const [ivyActiveClickField, setIvyActiveClickField] = useState<"entry" | "stop" | "target" | null>(null);

  // Watchlist navigation state
  const [navigationMode, setNavigationMode] = useState<'single' | 'watchlist'>('single');
  const [currentWatchlistIndex, setCurrentWatchlistIndex] = useState(0);
  const [navigationWatchlistId, setNavigationWatchlistId] = useState<number | null>(() => {
    const wlId = urlParams.get("watchlistId");
    return wlId ? parseInt(wlId, 10) : null;
  });

  /** Symbol order from Watchlist Manager table when opening via Load in Charts (matches overlay top→bottom) */
  const [chartWatchlistSymOrder, setChartWatchlistSymOrder] = useState<string[] | null>(null);

  const [watchlistManagerSelectedId] = useSelectedWatchlistId(WATCHLIST_MANAGER_STORAGE_KEY);
  const { data: watchlistsForManager } = useWatchlists();
  const effectiveManagerWatchlistId = useMemo(() => {
    if (watchlistManagerSelectedId != null && watchlistsForManager?.some((w) => w.id === watchlistManagerSelectedId)) {
      return watchlistManagerSelectedId;
    }
    const defaultWl = watchlistsForManager?.find((wl) => wl.isDefault);
    return defaultWl?.id ?? watchlistsForManager?.[0]?.id ?? null;
  }, [watchlistManagerSelectedId, watchlistsForManager]);

  const navWlEnabled =
    typeof navigationWatchlistId === "number" && !Number.isNaN(navigationWatchlistId);
  const managerWlEnabled =
    typeof effectiveManagerWatchlistId === "number" && !Number.isNaN(effectiveManagerWatchlistId);

  const { data: managerScopeItems, isFetched: managerWlFetched } =
    useNamedWatchlistItems(effectiveManagerWatchlistId);
  const { data: navigationWatchlist, isFetched: navigationWlFetched } =
    useNamedWatchlistItems(navigationWatchlistId);

  /** Wait for watchlist fetches before Trade Plan hydrates from localStorage (avoids wrong ticker's draft). */
  const tradePlanWatchlistReady = useMemo(
    () =>
      (!navWlEnabled || navigationWlFetched) && (!managerWlEnabled || managerWlFetched),
    [navWlEnabled, navigationWlFetched, managerWlEnabled, managerWlFetched]
  );

  const watchlistNavOrdered = useMemo(() => {
    if (!navigationWatchlist?.length) return [];
    if (chartWatchlistSymOrder?.length) {
      const bySym = new Map(navigationWatchlist.map((w) => [w.symbol.toUpperCase(), w]));
      return chartWatchlistSymOrder
        .map((s) => bySym.get(s.toUpperCase()))
        .filter((x): x is SentinelWatchlistItem => x != null);
    }
    return [...navigationWatchlist].sort((a, b) =>
      a.symbol.localeCompare(b.symbol, undefined, { sensitivity: "base" })
    );
  }, [navigationWatchlist, chartWatchlistSymOrder]);

  const { mutate: addToWatchlist, isPending: isAddingToWatchlist } = useAddToWatchlist();
  const { mutate: removeFromWatchlist, isPending: isRemovingFromWatchlist } = useRemoveFromWatchlist();
  const { mutate: updateWatchlist } = useUpdateWatchlist();
  const { mutate: addToWatchlistWithTradePlan } = useAddToWatchlistWithTradePlan();

  const watchlistItem = useMemo(() => {
    const sym = activeSymbol.toUpperCase();
    if (navigationMode === "watchlist" && navigationWatchlist?.length) {
      return navigationWatchlist.find((item) => item.symbol.toUpperCase() === sym);
    }
    return managerScopeItems?.find((item) => item.symbol.toUpperCase() === sym);
  }, [navigationMode, navigationWatchlist, managerScopeItems, activeSymbol]);

  const isWatchlisted = !!watchlistItem;

  // Get saved trade plan from watchlist item - memoized to prevent infinite loops
  const savedTradePlan = useMemo(() => {
    if (!watchlistItem) return null;
    if (watchlistItem.symbol.toUpperCase() !== activeSymbol.toUpperCase()) return null;
    const hasData = watchlistItem.targetEntry || watchlistItem.stopPlan || watchlistItem.targetPlan;
    if (!hasData) return null;
    return {
      entry: watchlistItem.targetEntry,
      stop: watchlistItem.stopPlan,
      target: watchlistItem.targetPlan,
    };
  }, [
    activeSymbol,
    watchlistItem?.id,
    watchlistItem?.symbol,
    watchlistItem?.targetEntry,
    watchlistItem?.stopPlan,
    watchlistItem?.targetPlan,
  ]);

  // Track previous symbol to detect changes
  const [prevSymbol, setPrevSymbol] = useState(activeSymbol);
  
  // Clear levels when symbol changes (save is handled by AskIvyOverlay)
  useEffect(() => {
    if (activeSymbol !== prevSymbol) {
      setPrevSymbol(activeSymbol);
      // Clear levels for new symbol - AskIvyOverlay handles save before it clears
      setIvyEntryLevel(null);
      setIvyStopLevel(null);
      setIvyTargetLevel(null);
    }
  }, [activeSymbol, prevSymbol]);
  
  // NOTE: Price lines loading is handled by AskIvyOverlay via savedTradePlan prop
  // AskIvyOverlay calls onSelectionChange to update ivyEntryLevel/Stop/Target

  // React to URL changes (for popout window driving from Flow page)
  useEffect(() => {
    const urlParams = new URLSearchParams(searchString);
    const newSymbol = urlParams.get("symbol")?.toUpperCase() || "";
    if (newSymbol && newSymbol !== activeSymbol) {
      setActiveSymbol(newSymbol);
      setTickerInput(newSymbol);
    }
  }, [searchString]);

  // Listen for postMessage from parent window (popout mode - no page reload)
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Security: only accept messages from same origin
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === 'SYMBOL_CHANGE') {
        const newSymbol = event.data.symbol?.toUpperCase();
        if (newSymbol && newSymbol !== activeSymbol) {
          setActiveSymbol(newSymbol);
          setTickerInput(newSymbol);
        }
      }
    };
    
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [activeSymbol]);

  // Handler to save trade plan to watchlist
  // Can optionally pass watchlistItemId for saving when symbol is changing
  const handleSaveTradePlan = useCallback((data: { entry?: number; stop?: number; target?: number; watchlistItemId?: number; symbol?: string }) => {
    const targetId = data.watchlistItemId ?? watchlistItem?.id;
    const targetSymbol = data.symbol ?? activeSymbol;
    
    console.log('[Charts] handleSaveTradePlan called:', { 
      data, 
      targetId, 
      targetSymbol,
      currentWatchlistItemId: watchlistItem?.id,
      currentSymbol: activeSymbol 
    });
    
    if (targetId) {
      console.log('[Charts] Updating watchlist item', targetId);
      updateWatchlist({ 
        id: targetId, 
        data: { 
          targetEntry: data.entry, 
          stopPlan: data.stop, 
          targetPlan: data.target 
        } 
      });
    } else if (data.entry || data.stop || data.target) {
      console.log('[Charts] Adding new watchlist item for', targetSymbol);
      addToWatchlistWithTradePlan({ 
        symbol: targetSymbol, 
        targetEntry: data.entry, 
        stopPlan: data.stop, 
        targetPlan: data.target,
        watchlistId: navigationWatchlistId ?? effectiveManagerWatchlistId ?? undefined,
      });
    }
  }, [watchlistItem, updateWatchlist, addToWatchlistWithTradePlan, activeSymbol, navigationWatchlistId, effectiveManagerWatchlistId]);

  // Handler to clear trade plan
  const handleClearTradePlan = useCallback(() => {
    setIvyEntryLevel(null);
    setIvyStopLevel(null);
    setIvyTargetLevel(null);
    if (isWatchlisted && watchlistItem) {
      updateWatchlist({ 
        id: watchlistItem.id, 
        data: { 
          targetEntry: null, 
          stopPlan: null, 
          targetPlan: null 
        } 
      });
    }
  }, [isWatchlisted, watchlistItem, updateWatchlist]);

  const handleIvySelectionChange = useCallback((
    entry: { price: number; label: string; type?: string } | null,
    stop: { price: number; label: string; type?: string } | null,
    target?: { price: number; label: string } | null
  ) => {
    setIvyEntryLevel(entry);
    setIvyStopLevel(stop);
    setIvyTargetLevel(target ?? null);
  }, []);

  // Auto-save trade plan when levels change (debounced)
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedRef = useRef<string>("");
  const lastSavedSymbolRef = useRef<string>("");
  
  // Reset auto-save refs when symbol changes to prevent cross-symbol saves
  useEffect(() => {
    if (activeSymbol !== lastSavedSymbolRef.current) {
      lastSavedSymbolRef.current = activeSymbol;
      lastSavedRef.current = "";
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
        autoSaveTimeoutRef.current = null;
      }
    }
  }, [activeSymbol]);
  
  useEffect(() => {
    // Skip if no symbol or overlay not open
    if (!activeSymbol || !askIvyOpen) return;
    
    // Skip if all levels are null (nothing to save)
    if (!ivyEntryLevel && !ivyStopLevel && !ivyTargetLevel) return;
    
    // Create a signature including symbol to prevent cross-symbol saves
    const currentSignature = JSON.stringify({
      symbol: activeSymbol,
      entry: ivyEntryLevel?.price,
      stop: ivyStopLevel?.price,
      target: ivyTargetLevel?.price,
    });
    
    // Skip if nothing changed from last save
    if (currentSignature === lastSavedRef.current) return;
    
    // Clear existing timeout
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }
    
    // Capture current values for the timeout callback
    const symbolToSave = activeSymbol;
    const entryToSave = ivyEntryLevel?.price;
    const stopToSave = ivyStopLevel?.price;
    const targetToSave = ivyTargetLevel?.price;
    const watchlistItemToSave = watchlistItem;
    const isWatchlistedNow = isWatchlisted;
    
    // Debounce save by 1 second
    autoSaveTimeoutRef.current = setTimeout(() => {
      // Double-check symbol hasn't changed during debounce
      if (symbolToSave !== activeSymbol) return;
      
      if (isWatchlistedNow && watchlistItemToSave) {
        updateWatchlist({ 
          id: watchlistItemToSave.id, 
          data: { 
            targetEntry: entryToSave ?? null, 
            stopPlan: stopToSave ?? null, 
            targetPlan: targetToSave ?? null
          } 
        });
      } else if (entryToSave || stopToSave || targetToSave) {
        // Auto-add to default watchlist with trade plan
        addToWatchlistWithTradePlan({ 
          symbol: symbolToSave, 
          targetEntry: entryToSave, 
          stopPlan: stopToSave, 
          targetPlan: targetToSave 
        });
      }
      
      lastSavedRef.current = currentSignature;
    }, 1000);
    
    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, [activeSymbol, askIvyOpen, ivyEntryLevel, ivyStopLevel, ivyTargetLevel, isWatchlisted, watchlistItem, updateWatchlist, addToWatchlistWithTradePlan]);

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

  const handleClose = useCallback(() => {
    setActiveSymbol("");
    setTickerInput("");
  }, []);

  const { data: dailyData, isLoading: dailyLoading } = useSentinelDailyChartData(
    activeSymbol || undefined,
    {
      staleTime: 5 * 60 * 1000,
      refetchInterval: 5 * 60 * 1000,
    }
  );

  const {
    data: intradayData,
    isLoading: intradayLoading,
    isFetching: intradayFetching,
  } = useSentinelIntradayChartData(
    activeSymbol || undefined,
    intradayTimeframe,
    showETH,
    {
      staleTime: 60 * 1000,
      refetchOnWindowFocus: true,
      refetchInterval: 30 * 1000,
      refetchIntervalInBackground: true,
    }
  );

  const { data: chartMetrics } = useQuery<ChartMetrics>({
    queryKey: ["/api/sentinel/trade-chart-metrics", activeSymbol, intradayTimeframe, showETH],
    enabled: !!activeSymbol,
    queryFn: async () => {
      const p = new URLSearchParams({
        ticker: activeSymbol,
        timeframe: intradayTimeframe,
      });
      if (showETH) p.set("includeETH", "true");
      const res = await fetch(`/api/sentinel/trade-chart-metrics?${p}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch metrics");
      return res.json();
    },
    staleTime: 60 * 1000,
  });

  // News query - only fetch when panel is open (lazy loading)
  interface NewsArticle {
    id: number;
    headline: string;
    summary: string;
    source: string;
    url: string;
    datetime: number;
    image: string;
  }
  
  const { data: newsData, isLoading: newsLoading } = useQuery<NewsArticle[]>({
    queryKey: ["/api/news", activeSymbol],
    enabled: newsOpen && !!activeSymbol,
    queryFn: async () => {
      const res = await fetch(`/api/news/${activeSymbol}?days=14`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch news");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const handleNavigateToTicker = useCallback((ticker: string) => {
    setTickerInput(ticker);
    setActiveSymbol(ticker);
  }, []);

  // Auto-sync to MarketSurge when ticker changes
  useEffect(() => {
    if (msSyncEnabled && activeSymbol) {
      syncToMarketSurge(activeSymbol, 'day');
    }
  }, [msSyncEnabled, activeSymbol, syncToMarketSurge]);

  // Open watchlist navigation from URL (Load in Charts); symOrder matches overlay table order
  useEffect(() => {
    const p = new URLSearchParams(searchString);
    const source = p.get("source");
    if (source !== "watchlist") return;

    const wlId = p.get("watchlistId");
    if (wlId) setNavigationWatchlistId(parseInt(wlId, 10));

    if (!navigationWatchlist?.length) return;

    const symOrderRaw = p.get("symOrder");
    const parsedSymOrder = symOrderRaw
      ? symOrderRaw.split(",").map((s) => s.trim()).filter(Boolean)
      : null;

    if (parsedSymOrder?.length) setChartWatchlistSymOrder(parsedSymOrder);
    else setChartWatchlistSymOrder(null);

    let ordered: SentinelWatchlistItem[];
    if (parsedSymOrder?.length) {
      const bySym = new Map(navigationWatchlist.map((w) => [w.symbol.toUpperCase(), w]));
      ordered = parsedSymOrder
        .map((s) => bySym.get(s.toUpperCase()))
        .filter((x): x is SentinelWatchlistItem => x != null);
    } else {
      ordered = [...navigationWatchlist].sort((a, b) =>
        a.symbol.localeCompare(b.symbol, undefined, { sensitivity: "base" })
      );
    }

    if (!ordered.length) return;

    setNavigationMode("watchlist");
    const symbol = p.get("symbol");
    if (symbol) {
      const symUp = symbol.toUpperCase();
      const index = ordered.findIndex((w) => w.symbol.toUpperCase() === symUp);
      if (index >= 0) {
        setCurrentWatchlistIndex(index);
        const resolved = ordered[index].symbol;
        setActiveSymbol(resolved);
        setTickerInput(resolved);
      } else {
        setCurrentWatchlistIndex(0);
        setActiveSymbol(ordered[0].symbol);
        setTickerInput(ordered[0].symbol);
      }
    } else {
      setCurrentWatchlistIndex(0);
      setActiveSymbol(ordered[0].symbol);
      setTickerInput(ordered[0].symbol);
    }

    window.history.replaceState({}, "", "/sentinel/charts");
  }, [searchString, navigationWatchlist]);

  // Navigation handlers
  const handleNavigatePrev = useCallback(() => {
    if (navigationMode === 'watchlist' && watchlistNavOrdered.length) {
      const newIndex = Math.max(0, currentWatchlistIndex - 1);
      setCurrentWatchlistIndex(newIndex);
      const sym = watchlistNavOrdered[newIndex].symbol;
      setActiveSymbol(sym);
      setTickerInput(sym);
      if (msSyncEnabled) {
        syncToMarketSurge(sym, 'day');
      }
    }
  }, [navigationMode, watchlistNavOrdered, currentWatchlistIndex, msSyncEnabled, syncToMarketSurge]);

  const handleNavigateNext = useCallback(() => {
    if (navigationMode === 'watchlist' && watchlistNavOrdered.length) {
      const newIndex = Math.min(watchlistNavOrdered.length - 1, currentWatchlistIndex + 1);
      setCurrentWatchlistIndex(newIndex);
      const sym = watchlistNavOrdered[newIndex].symbol;
      setActiveSymbol(sym);
      setTickerInput(sym);
      if (msSyncEnabled) {
        syncToMarketSurge(sym, 'day');
      }
    }
  }, [navigationMode, watchlistNavOrdered, currentWatchlistIndex, msSyncEnabled, syncToMarketSurge]);

  // Keyboard navigation
  useEffect(() => {
    if (navigationMode !== 'watchlist') return;
    
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handleNavigatePrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleNavigateNext();
      }
    };
    
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigationMode, handleNavigatePrev, handleNavigateNext]);

  const currentPrice = dailyData?.candles?.length ? dailyData.candles[dailyData.candles.length - 1].close : 0;
  const chartsNavExtra = activeSymbol ? (
    <div className="flex items-center gap-1.5">
      {/* Watchlist navigation controls */}
      {navigationMode === 'watchlist' && watchlistNavOrdered.length > 0 && (
        <>
          <Button
            size="icon"
            variant="outline"
            disabled={currentWatchlistIndex === 0}
            onClick={handleNavigatePrev}
            data-testid="button-watchlist-prev"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground px-2" data-testid="text-watchlist-position">
            {currentWatchlistIndex + 1} of {watchlistNavOrdered.length}
          </span>
          <Button
            size="icon"
            variant="outline"
            disabled={currentWatchlistIndex === watchlistNavOrdered.length - 1}
            onClick={handleNavigateNext}
            data-testid="button-watchlist-next"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <div className="w-px h-6 bg-border mx-1" />
        </>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            style={{
              backgroundColor: askIvyOpen ? 'rgba(251, 191, 36, 0.2)' : undefined,
              borderColor: askIvyOpen ? '#fbbf24' : undefined,
              color: askIvyOpen ? '#fbbf24' : undefined,
            }}
            onClick={() => setAskIvyOpen((v) => !v)}
            data-testid="button-chart-evaluate"
          >
            <Sparkles className="h-3.5 w-3.5" style={{ color: '#fbbf24' }} />
            <span>Trade Plan</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-sm">Set entry, stop & target levels</p>
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            style={{
              backgroundColor: newsOpen ? 'rgba(59, 130, 246, 0.2)' : undefined,
              borderColor: newsOpen ? '#3b82f6' : undefined,
              color: newsOpen ? '#3b82f6' : undefined,
            }}
            onClick={() => setNewsOpen((v) => !v)}
            data-testid="button-chart-news"
          >
            <Newspaper className="h-3.5 w-3.5" />
            <span>News</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-sm">View recent news for {activeSymbol}</p>
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <div>
            <WatchlistSelector 
              symbol={activeSymbol} 
              storageKey="standaloneWatchlistId"
            />
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-sm">Add/remove from watchlist</p>
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant={msSyncEnabled ? "default" : "outline"}
            className="gap-1.5"
            onClick={() => {
              const newState = !msSyncEnabled;
              setMsSyncEnabled(newState);
              if (newState && activeSymbol) {
                syncToMarketSurge(activeSymbol, 'day');
                toast({
                  title: 'MarketSurge Sync Active',
                  description: 'Ticker changes will update MarketSurge window'
                });
              }
            }}
            data-testid="button-chart-marketsurge"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            <span>MarketSurge</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-sm">Sync ticker changes to MarketSurge window</p>
        </TooltipContent>
      </Tooltip>
    </div>
  ) : null;

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden" style={cssVariables as any}>
      <SentinelHeader showSentiment={false} />

      <div className="flex-shrink-0 flex items-center gap-3 px-4 py-2 border-b border-border" style={{ backgroundColor: cssVariables.headerBg }}>
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

        <div className="ml-auto flex items-center gap-2">
          <CopyScreenButton />
          {activeSymbol && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={handleClose}
                  data-testid="button-chart-close"
                >
                  <X className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-sm">Close chart and clear ticker</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
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
          <div className="relative flex-1 min-h-0 flex flex-col">
            <DualChartGrid
              symbol={activeSymbol}
              dailyData={dailyData}
              dailyLoading={dailyLoading}
              intradayData={intradayData}
              intradayLoading={intradayLoading}
              intradayFetching={intradayFetching}
              chartMetrics={chartMetrics ?? null}
              intradayTimeframe={intradayTimeframe}
              onIntradayTimeframeChange={setIntradayTimeframe}
              showETH={showETH}
              onShowETHChange={onShowETHChange}
              showExtendedHoursControls
              showIntradayMaBasisToggle
              onNavigateToTicker={handleNavigateToTicker}
              navExtra={chartsNavExtra}
              dailyChartProps={{
                priceLines: [
                  ...(ivyEntryLevel ? [{ price: ivyEntryLevel.price, color: "rgba(34, 197, 94, 0.8)", label: `Entry: ${ivyEntryLevel.label}` }] : []),
                  ...(ivyStopLevel ? [{ price: ivyStopLevel.price, color: "rgba(239, 68, 68, 0.8)", label: `Stop: ${ivyStopLevel.label}` }] : []),
                  ...(ivyTargetLevel ? [{ price: ivyTargetLevel.price, color: "rgba(34, 197, 94, 0.6)", label: `Target: ${ivyTargetLevel.label}` }] : []),
                ],
                onCandleClick: ivyActiveClickField ? (_candle: any, clickedPrice: number) => {
                  setIvyChartClick({ price: clickedPrice, timestamp: Date.now() });
                } : undefined,
              }}
              intradayChartProps={{
                priceLines: [
                  ...(ivyEntryLevel ? [{ price: ivyEntryLevel.price, color: "rgba(34, 197, 94, 0.8)", label: `Entry: ${ivyEntryLevel.label}` }] : []),
                  ...(ivyStopLevel ? [{ price: ivyStopLevel.price, color: "rgba(239, 68, 68, 0.8)", label: `Stop: ${ivyStopLevel.label}` }] : []),
                  ...(ivyTargetLevel ? [{ price: ivyTargetLevel.price, color: "rgba(34, 197, 94, 0.6)", label: `Target: ${ivyTargetLevel.label}` }] : []),
                ],
                onCandleClick: ivyActiveClickField ? (_candle: any, clickedPrice: number) => {
                  setIvyChartClick({ price: clickedPrice, timestamp: Date.now() });
                } : undefined,
              }}
              testIdPrefix="chart"
              alertTradePlanPreview={savedTradePlan ? { mode: "single", ...savedTradePlan } : null}
              alertWatchlistId={watchlistItem?.watchlistId ?? navigationWatchlistId}
            />
            <AskIvyOverlay
              open={askIvyOpen}
              onOpenChange={setAskIvyOpen}
              symbol={activeSymbol}
              currentPrice={currentPrice}
              chartCandles={dailyData?.candles}
              onSelectionChange={handleIvySelectionChange}
              chartClickEvent={ivyChartClick}
              onChartClickModeChange={(field) => {
                setIvyActiveClickField(field);
                if (!field) setIvyChartClick(null);
              }}
              isWatchlisted={isWatchlisted}
              watchlistItemId={watchlistItem?.id}
              onSaveTradePlan={handleSaveTradePlan}
              onClearTradePlan={handleClearTradePlan}
              savedTradePlan={savedTradePlan}
              tradePlanWatchlistReady={tradePlanWatchlistReady}
            />
            
            {/* News Panel */}
            {newsOpen && (
              <div 
                className="fixed top-16 right-4 w-96 max-h-[70vh] rounded-lg border shadow-xl overflow-hidden z-50"
                style={{ backgroundColor: cssVariables.overlayBg, borderColor: cssVariables.secondaryOverlayColor }}
              >
                <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: cssVariables.secondaryOverlayColor, backgroundColor: cssVariables.headerBg }}>
                  <div className="flex items-center gap-2">
                    <Newspaper className="h-4 w-4 text-blue-400" />
                    <span className="font-semibold" style={{ color: cssVariables.textColorHeader }}>News - {activeSymbol}</span>
                  </div>
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setNewsOpen(false)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <ScrollArea className="h-[calc(70vh-48px)]">
                  <div className="p-3 space-y-3">
                    {newsLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      </div>
                    ) : !newsData || newsData.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground text-sm">
                        No recent news found for {activeSymbol}
                      </div>
                    ) : (
                      newsData.slice(0, 20).map((article) => (
                        <a
                          key={article.id}
                          href={article.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block p-3 rounded-md border hover:bg-slate-800/50 transition-colors"
                          style={{ borderColor: `${cssVariables.secondaryOverlayColor}66` }}
                        >
                          <div className="flex gap-3">
                            {article.image && (
                              <img 
                                src={article.image} 
                                alt="" 
                                className="w-16 h-16 object-cover rounded flex-shrink-0"
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                              />
                            )}
                            <div className="flex-1 min-w-0">
                              <h4 className="text-sm font-medium line-clamp-2 mb-1" style={{ color: cssVariables.textColorNormal }}>
                                {article.headline}
                              </h4>
                              <p className="text-xs line-clamp-2 mb-2" style={{ color: cssVariables.textColorSmall }}>
                                {article.summary}
                              </p>
                              <div className="flex items-center gap-2 text-xs" style={{ color: cssVariables.textColorTiny }}>
                                <span>{article.source}</span>
                                <span>•</span>
                                <span>{new Date(article.datetime * 1000).toLocaleDateString()}</span>
                              </div>
                            </div>
                          </div>
                        </a>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
