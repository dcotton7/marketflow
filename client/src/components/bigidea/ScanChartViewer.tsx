import { useState, useCallback, useRef, useMemo, useEffect, Component, type ReactNode, type ErrorInfo } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useSystemSettings } from "@/context/SystemSettingsContext";
import { AskIvyOverlay } from "@/components/AskIvyOverlay";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ChartCandle, ChartIndicators, ChartMarker, DiamondMarker, PriceLevelLine, BaseZone } from "@/components/TradingChart";
import { DualChartGrid, type ChartMetrics } from "@/components/DualChartGrid";
import { usePersistedIntradayTimeframe } from "@/hooks/usePersistedIntradayTimeframe";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useMarketSurgeSync } from "@/hooks/useMarketSurgeSync";
import { useWatchlist, useAddToWatchlist, useRemoveFromWatchlist, useUpdateWatchlist, useAddToWatchlistWithTradePlan, useSelectedWatchlistId, useWatchlists } from "@/hooks/use-watchlist";
import { isTradePlanEnabled, buildWatchlistTradePlanLines } from "@/lib/trade-plan-feature";
import { WatchlistSelector } from "@/components/WatchlistSelector";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  CheckCircle2,
  XCircle,
  ThumbsUp,
  ThumbsDown,
  ExternalLink,
  ClipboardCopy,
  Info,
  Camera,
  GraduationCap,
  Newspaper,
  Sparkles,
  Loader2,
  X,
} from "lucide-react";

export interface DynamicDataConsumer {
  thoughtId: string;
  thoughtName: string;
  indicatorName: string;
  params: Array<{ label: string; dataKey: string; value: any }>;
}

export interface DynamicDataProvider {
  providerId: string;
  providerName: string;
  providerIndicator: string;
  detectedValues: Record<string, any>;
  lookbackSetting?: number;
  lookbackLabel?: string;
  consumers: DynamicDataConsumer[];
}

export interface CriterionResultItem {
  indicatorId: string;
  indicatorName: string;
  pass: boolean;
  inverted: boolean;
  diagnostics?: { value: string; threshold: string; detail?: string };
  cocHighlight?: { type: string; level?: number; startBar?: number; endBar?: number; barIndex?: number; gapPct?: number; barCount?: number; topPrice?: number; lowPrice?: number; undercutBar?: number; rallyBar?: number; touchBar?: number };
  cocHighlight2?: { type: string; level?: number; startBar?: number; endBar?: number };
}

export interface ThoughtBreakdownItem {
  thoughtId: string;
  thoughtName: string;
  pass: boolean;
  criteriaResults: CriterionResultItem[];
}

export interface ScanResultItem {
  symbol: string;
  name: string;
  ticker?: string;
  price: number;
  passedPaths: string[];
  dynamicData?: DynamicDataProvider[];
  thoughtBreakdown?: ThoughtBreakdownItem[];
}

class ChartErrorBoundary extends Component<
  { children: ReactNode; onClose: () => void },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode; onClose: () => void }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ScanChartViewer] Chart render error:", error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-4">
          <p className="text-destructive text-sm">Chart failed to load</p>
          <p className="text-muted-foreground text-xs max-w-md text-center">{this.state.error?.message}</p>
          <Button variant="outline" size="sm" onClick={() => this.props.onClose()}>Close</Button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function ScanChartViewer({
  results,
  currentIndex,
  open,
  onOpenChange,
  onIndexChange,
  sessionId,
  tuningActive,
  trainingMode,
  sourceSetupId,
  sourceSetupName,
  navigationMode,
  onNavigationModeChange,
}: {
  results: ScanResultItem[];
  currentIndex: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onIndexChange: (idx: number) => void;
  sessionId?: number;
  tuningActive?: boolean;
  trainingMode?: boolean;
  sourceSetupId?: number;
  sourceSetupName?: string;
  navigationMode?: 'scan' | 'watchlist';
  onNavigationModeChange?: (mode: 'scan' | 'watchlist') => void;
}) {
  const [intradayTimeframe, setIntradayTimeframe] = usePersistedIntradayTimeframe();
  const [showETH, setShowETH] = useState(false);
  const [chartRatings, setChartRatings] = useState<Record<string, "up" | "down">>({});
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
  
  const [expandedThoughts, setExpandedThoughts] = useState<Record<string, boolean>>({});
  const [tickerDebugOpen, setTickerDebugOpen] = useState(false);

  useEffect(() => { setTickerDebugOpen(false); }, [currentIndex]);
  
  // Debug logging - must be at top with other hooks
  useEffect(() => {
    if (open) {
      console.log("[ScanChartViewer] Opened with:", { currentIndex, symbol: results[currentIndex]?.symbol, resultsLength: results.length });
    }
  }, [open, currentIndex, results]);

  const { cssVariables } = useSystemSettings();
  const { toast } = useToast();
  const { syncToMarketSurge } = useMarketSurgeSync();
  const [msSyncEnabled, setMsSyncEnabled] = useState(false);

  // Watchlist integration
  const { data: watchlist, isFetched: watchlistFetched } = useWatchlist();
  const { mutate: addToWatchlist, isPending: isAddingToWatchlist } = useAddToWatchlist();
  const { mutate: removeFromWatchlist, isPending: isRemovingFromWatchlist } = useRemoveFromWatchlist();
  const { mutate: updateWatchlist } = useUpdateWatchlist();
  const { mutate: addToWatchlistWithTradePlan } = useAddToWatchlistWithTradePlan();
  
  // Fetch setup's Ivy config for context-aware suggestions
  const { data: setupConfig } = useQuery<{
    id: number;
    name: string;
    ivyEntryStrategy?: string | null;
    ivyStopStrategy?: string | null;
    ivyTargetStrategy?: string | null;
    ivyContextNotes?: string | null;
    ivyApproved?: boolean;
  }>({
    queryKey: ["/api/bigidea/setups", sourceSetupId],
    enabled: !!sourceSetupId,
  });

  // Navigation mode state
  const [activeNavigationMode, setActiveNavigationMode] = useState(navigationMode || 'scan');

  // Compute navigation list based on mode
  const navigationList = useMemo((): ScanResultItem[] => {
    if (activeNavigationMode === 'watchlist' && watchlist) {
      return watchlist.map((w) => ({ symbol: w.symbol, name: w.symbol, price: 0, passedPaths: [] as string[] }));
    }
    return results;
  }, [activeNavigationMode, watchlist, results]);

  const chartWindowRef = useRef<HTMLDivElement>(null);
  const [thresholdToastShown, setThresholdToastShown] = useState(false);
  const [commitReadyBanner, setCommitReadyBanner] = useState<string | null>(null);
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => { if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current); };
  }, []);

  const ratingMutation = useMutation({
    mutationFn: async ({ symbol, rating, price, indicatorSnapshot }: { symbol: string; rating: "up" | "down"; price: number; indicatorSnapshot?: any }) => {
      const res = await apiRequest("POST", "/api/bigidea/chart-rating", {
        symbol,
        rating,
        price,
        sessionId,
        indicatorSnapshot: indicatorSnapshot || null,
        ratingType: trainingMode ? "admin" : "user",
        trainingMode: trainingMode || false,
        sourceSetupId: sourceSetupId || null,
      });
      return res.json();
    },
    onSuccess: (_data, variables) => {
      setChartRatings(prev => {
        const updated = { ...prev, [variables.symbol]: variables.rating };
        const ratedCount = Object.keys(updated).length;
        const total = results.length;
        const threshold = Math.max(1, Math.ceil(total * 0.3));
        if (tuningActive && ratedCount >= threshold && !thresholdToastShown) {
          setThresholdToastShown(true);
          setCommitReadyBanner(`You've rated ${ratedCount} of ${total} charts — enough to save & commit your tuning changes.`);
          if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
          bannerTimerRef.current = setTimeout(() => setCommitReadyBanner(null), 5000);
        }
        return updated;
      });
    },
    onError: () => {
      toast({ title: "Rating failed", description: "Could not save your chart rating. Please try again.", variant: "destructive" });
    },
  });

  const current = navigationList[currentIndex];
  const symbol = current?.symbol || "";

  type ChartDataResponse = { candles: ChartCandle[]; indicators: ChartIndicators; ticker: string; timeframe: string };

  const { data: dailyData, isLoading: dailyLoading } = useQuery<ChartDataResponse>({
    queryKey: ["/api/sentinel/chart-data", symbol, "daily"],
    enabled: open && !!symbol,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchInterval: 5 * 60 * 1000,
    queryFn: async () => {
      console.log(`[ScanChartViewer] Fetching daily data for ${symbol}`);
      const res = await fetch(`/api/sentinel/chart-data?ticker=${symbol}&timeframe=daily&_=${Date.now()}`, { 
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' }
      });
      if (!res.ok) {
        console.error(`[ScanChartViewer] Daily data fetch failed: ${res.status} ${res.statusText}`);
        throw new Error("Failed to fetch daily chart data");
      }
      const data = await res.json();
      console.log(`[ScanChartViewer] Daily data loaded: ${data.candles?.length || 0} candles`);
      if (data.candles?.length > 0) {
        const first = new Date(data.candles[0].timestamp * 1000);
        const last = new Date(data.candles[data.candles.length - 1].timestamp * 1000);
        console.log(`[ScanChartViewer] Daily range: ${first.toLocaleDateString()} to ${last.toLocaleDateString()}`);
      }
      return data;
    },
    staleTime: 0,
  });

  const {
    data: intradayData,
    isLoading: intradayLoading,
    isFetching: intradayFetching,
  } = useQuery<ChartDataResponse>({
    queryKey: ["/api/sentinel/chart-data", symbol, intradayTimeframe, showETH],
    enabled: open && !!symbol,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: 30 * 1000,
    refetchIntervalInBackground: true,
    queryFn: async () => {
      const params = new URLSearchParams({ ticker: symbol!, timeframe: intradayTimeframe, _: Date.now().toString() });
      if (showETH) params.set('includeETH', 'true');
      console.log(`[ScanChartViewer] Fetching intraday data for ${symbol} (${intradayTimeframe}, ETH=${showETH})`);
      const res = await fetch(`/api/sentinel/chart-data?${params}`, { 
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' }
      });
      if (!res.ok) {
        console.error(`[ScanChartViewer] Intraday data fetch failed: ${res.status} ${res.statusText}`);
        throw new Error("Failed to fetch intraday chart data");
      }
      const data = await res.json();
      console.log(`[ScanChartViewer] Intraday data loaded: ${data.candles?.length || 0} candles`);
      if (data.candles?.length > 0) {
        const first = new Date(data.candles[0].timestamp * 1000);
        const last = new Date(data.candles[data.candles.length - 1].timestamp * 1000);
        console.log(`[ScanChartViewer] Intraday range: ${first.toLocaleString()} to ${last.toLocaleString()}`);
      }
      return data;
    },
    staleTime: 0,
  });

  const { data: chartMetrics } = useQuery<ChartMetrics>({
    queryKey: ["/api/sentinel/trade-chart-metrics", symbol, intradayTimeframe, showETH],
    enabled: open && !!symbol,
    queryFn: async () => {
      console.log(`[ScanChartViewer] Fetching metrics for ${symbol}`);
      const p = new URLSearchParams({ ticker: symbol, timeframe: intradayTimeframe });
      if (showETH) p.set("includeETH", "true");
      const res = await fetch(`/api/sentinel/trade-chart-metrics?${p}`, { credentials: "include" });
      if (!res.ok) {
        console.error(`[ScanChartViewer] Metrics fetch failed: ${res.status} ${res.statusText}`);
        throw new Error("Failed to fetch metrics");
      }
      const data = await res.json();
      console.log(`[ScanChartViewer] Metrics loaded:`, data);
      console.log(`[ScanChartViewer] Metrics keys:`, Object.keys(data));
      console.log(`[ScanChartViewer] Sample values - PE: ${data.pe}, Market Cap: ${data.marketCap}, Target Price: ${data.targetPrice}`);
      return data;
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
    queryKey: ["/api/news", symbol],
    enabled: open && newsOpen && !!symbol,
    queryFn: async () => {
      const res = await fetch(`/api/news/${symbol}?days=14`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch news");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        onIndexChange(Math.max(0, currentIndex - 1));
      } else if (e.key === "ArrowRight") {
        onIndexChange(Math.min(results.length - 1, currentIndex + 1));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, currentIndex, results.length, onIndexChange]);

  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", handler);
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => overlayRef.current?.focus());
    return () => {
      window.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
    };
  }, [open, onOpenChange]);

  // Auto-sync to MarketSurge when navigating stocks
  useEffect(() => {
    if (open && msSyncEnabled && results.length > 0) {
      const currentStock = results[currentIndex];
      if (currentStock?.ticker || currentStock?.symbol) {
        syncToMarketSurge(currentStock.ticker || currentStock.symbol, 'day');
      }
    }
  }, [open, currentIndex, msSyncEnabled, results, syncToMarketSurge]);

  const dayChange = useMemo(() => {
    if (!dailyData || dailyData.candles.length < 2) return null;
    const last = dailyData.candles[dailyData.candles.length - 1];
    const prev = dailyData.candles[dailyData.candles.length - 2];
    const change = last.close - prev.close;
    const changePct = (change / prev.close) * 100;
    return { price: last.close, change, changePct };
  }, [dailyData]);

  const cocAnnotations = useMemo(() => {
    if (!current?.thoughtBreakdown) return { markers: [] as ChartMarker[], diamondMarkers: [] as DiamondMarker[], priceLines: [] as PriceLevelLine[], resistanceLines: [] as { startTime: number; startPrice: number; endTime: number; endPrice: number }[], baseZones: [] as BaseZone[] };

    const markers: ChartMarker[] = [];
    const diamondMarkers: DiamondMarker[] = [];
    const priceLines: PriceLevelLine[] = [];
    const resistanceLines: { startTime: number; startPrice: number; endTime: number; endPrice: number }[] = [];
    const baseZones: BaseZone[] = [];

    const BASE_ZONE_COLORS = [
      "#22c55e",
      "#3b82f6",
      "#a855f7",
      "#f59e0b",
      "#06b6d4",
      "#ec4899",
    ];

    const ideaHasBase = current.thoughtBreakdown.some((t: any) =>
      t.criteriaResults?.some((cr: any) => (cr.indicatorId === "PA-3" || cr.indicatorId === "PA-4" || cr.indicatorId === "CB-1"))
    );

    let zoneColorIdx = 0;
    for (const thought of current.thoughtBreakdown) {
      if (!thought.pass) continue;
      for (const cr of thought.criteriaResults) {
        if (!cr.pass || !cr.cocHighlight) continue;
        const h = cr.cocHighlight;
        if (ideaHasBase && cr.indicatorId !== "PA-3" && cr.indicatorId !== "PA-4" && cr.indicatorId !== "CB-1") continue;

        if (h.type === "baseZone" && h.topPrice && h.lowPrice && h.startBar !== undefined) {
          if (dailyData) {
            const len = dailyData.candles.length;
            const olderIdx = Math.max(0, len - 1 - h.startBar);
            const newerIdx = Math.min(len - 1, len - 1 - (h.endBar ?? 0));
            if (olderIdx >= 0 && newerIdx >= olderIdx && newerIdx < len) {
              const olderCandle = dailyData.candles[olderIdx];
              const newerCandle = dailyData.candles[newerIdx];
              if (olderCandle && newerCandle) {
                const color = BASE_ZONE_COLORS[zoneColorIdx % BASE_ZONE_COLORS.length];
                zoneColorIdx++;
                baseZones.push({
                  startTime: olderCandle.timestamp,
                  endTime: newerCandle.timestamp,
                  topPrice: h.topPrice,
                  lowPrice: h.lowPrice,
                  color,
                  label: cr.indicatorName,
                });
              }
            }
          }
        }

        if (h.type === "resistanceLine" && h.level && h.startBar !== undefined) {
          if (dailyData) {
            const len = dailyData.candles.length;
            const olderIdx = Math.max(0, len - 1 - h.startBar);
            const newerIdx = Math.min(len - 1, len - 1 - (h.endBar ?? 0));
            if (olderIdx >= 0 && newerIdx >= olderIdx && newerIdx < len) {
              const olderCandle = dailyData.candles[olderIdx];
              const newerCandle = dailyData.candles[newerIdx];
              if (olderCandle && newerCandle) {
                resistanceLines.push({
                  startTime: olderCandle.timestamp,
                  startPrice: h.level,
                  endTime: newerCandle.timestamp,
                  endPrice: h.level,
                });
              }
            }
          }
        }

        if (cr.cocHighlight2 && cr.cocHighlight2.type === "supportLine" && cr.cocHighlight2.level && cr.cocHighlight2.startBar !== undefined) {
          const h2 = cr.cocHighlight2;
          if (dailyData) {
            const len2 = dailyData.candles.length;
            const olderIdx2 = Math.max(0, len2 - 1 - h2.startBar!);
            const newerIdx2 = Math.min(len2 - 1, len2 - 1 - (h2.endBar ?? 0));
            if (olderIdx2 >= 0 && newerIdx2 >= olderIdx2 && newerIdx2 < len2) {
              const olderCandle2 = dailyData.candles[olderIdx2];
              const newerCandle2 = dailyData.candles[newerIdx2];
              if (olderCandle2 && newerCandle2) {
                resistanceLines.push({
                  startTime: olderCandle2.timestamp,
                  startPrice: h2.level!,
                  endTime: newerCandle2.timestamp,
                  endPrice: h2.level!,
                });
              }
            }
          }
        }

        if (h.type === "gapCircle" && h.barIndex !== undefined) {
          if (dailyData && dailyData.candles.length > h.barIndex) {
            const candle = dailyData.candles[dailyData.candles.length - 1 - h.barIndex];
            if (candle) {
              const label = cr.indicatorId === "PA-17"
                ? (h.gapPct ? `WP ${h.gapPct.toFixed(1)}%` : "Wedge Pop")
                : (h.gapPct ? `Gap ${h.gapPct.toFixed(1)}%` : "Gap");
              diamondMarkers.push({
                time: candle.timestamp,
                price: candle.low,
                color: "rgba(234, 179, 8, 0.5)",
                size: 100,
                text: label,
                textColor: "#ffffff",
              });
            }
          }
        }

        if (h.type === "pullbackCircle" && h.barCount) {
          if (dailyData) {
            const count = Math.min(h.barCount, dailyData.candles.length);
            for (let i = dailyData.candles.length - count; i < dailyData.candles.length; i++) {
              diamondMarkers.push({
                time: dailyData.candles[i].timestamp,
                price: dailyData.candles[i].low,
                color: "rgba(234, 179, 8, 0.5)",
                size: 100,
                text: i === dailyData.candles.length - count ? cr.indicatorName || "PB" : "",
                textColor: "#ffffff",
              });
            }
          }
        }

        // Undercut & Rally pattern (PA-19)
        if (h.type === "urPattern" && h.undercutBar !== undefined && h.rallyBar !== undefined) {
          if (dailyData) {
            const len = dailyData.candles.length;
            
            // Diamond on undercut bar (where price dipped below MA) - red/orange
            const undercutIdx = len - 1 - h.undercutBar;
            if (undercutIdx >= 0 && undercutIdx < len) {
              const undercutCandle = dailyData.candles[undercutIdx];
              diamondMarkers.push({
                time: undercutCandle.timestamp,
                price: undercutCandle.low,
                color: "rgba(239, 68, 68, 0.7)", // Red for undercut
                size: 50,
                text: "Undercut",
                textColor: "#ffffff",
              });
            }
            
            // Diamond on rally bar (where price crossed back above MA) - green
            const rallyIdx = len - 1 - h.rallyBar;
            if (rallyIdx >= 0 && rallyIdx < len) {
              const rallyCandle = dailyData.candles[rallyIdx];
              diamondMarkers.push({
                time: rallyCandle.timestamp,
                price: rallyCandle.high,
                color: "rgba(34, 197, 94, 0.7)", // Green for rally
                size: 50,
                text: "Rally",
                textColor: "#ffffff",
              });
            }
          }
        }

        // Pullback to MA pattern (PA-20)
        if (h.type === "pullbackPattern" && h.touchBar !== undefined) {
          if (dailyData) {
            const len = dailyData.candles.length;
            
            // Diamond on touch bar (where price touched the MA) - yellow
            const touchIdx = len - 1 - h.touchBar;
            if (touchIdx >= 0 && touchIdx < len) {
              const touchCandle = dailyData.candles[touchIdx];
              diamondMarkers.push({
                time: touchCandle.timestamp,
                price: touchCandle.low,
                color: "rgba(234, 179, 8, 0.7)", // Yellow for MA touch
                size: 50,
                text: "PB Touch",
                textColor: "#ffffff",
              });
            }
          }
        }
      }
    }

    const dedupedBaseZones = baseZones.filter((zone, idx) => {
      for (let j = 0; j < idx; j++) {
        const prev = baseZones[j];
        const timeOverlap = Math.abs(zone.startTime - prev.startTime) < 86400 * 5 && Math.abs(zone.endTime - prev.endTime) < 86400 * 5;
        const priceOverlap = Math.abs(zone.topPrice - prev.topPrice) / prev.topPrice < 0.02 && Math.abs(zone.lowPrice - prev.lowPrice) / prev.lowPrice < 0.02;
        if (timeOverlap && priceOverlap) return false;
      }
      return true;
    });

    return { markers, diamondMarkers, priceLines, resistanceLines, baseZones: dedupedBaseZones };
  }, [current?.thoughtBreakdown, dailyData]);

  // Define callbacks BEFORE early return - hooks must always be called
  const handleCopyChartWindow = useCallback(async () => {
    const el = chartWindowRef.current;
    if (!el) return;
    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(el, {
        backgroundColor: null,
        useCORS: true,
        scale: 2,
        logging: false,
      });
      canvas.toBlob(async (blob) => {
        if (!blob) { toast({ title: "Failed to capture image" }); return; }
        try {
          await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
          toast({ title: "Chart copied to clipboard as image" });
        } catch {
          const link = document.createElement("a");
          link.download = `${symbol}_chart.png`;
          link.href = canvas.toDataURL("image/png");
          link.click();
          toast({ title: "Chart saved as image (clipboard not available)" });
        }
      }, "image/png");
    } catch {
      toast({ title: "Failed to capture chart" });
    }
  }, [symbol, toast]);

  const handleCopyTickerDebugText = useCallback(async () => {
    if (!current?.thoughtBreakdown) return;
    const lines: string[] = [];
    lines.push(`Ticker Debug: ${symbol}`);
    current.thoughtBreakdown.forEach((thought) => {
      const passCount = thought.criteriaResults.filter((c: any) => c.pass).length;
      const totalCount = thought.criteriaResults.length;
      lines.push(`\n${thought.pass ? "PASS" : "FAIL"} ${thought.thoughtName} (${passCount}/${totalCount})`);
      thought.criteriaResults.forEach((cr: any) => {
        const diag = cr.diagnostics;
        lines.push(`  ${cr.pass ? "+" : "-"} ${cr.indicatorName}${cr.inverted ? " [INV]" : ""}${diag ? ` — val: ${diag.value}, thresh: ${diag.threshold}${diag.detail ? `, ${diag.detail}` : ""}` : ""}`);
      });
    });
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      toast({ title: "Ticker debug info copied to clipboard" });
    } catch {
      toast({ title: "Failed to copy debug text" });
    }
  }, [current, symbol, toast]);

  // Compute watchlist status
  const isWatchlisted = watchlist?.some(item => item.symbol === symbol);
  const watchlistItem = watchlist?.find(item => item.symbol === symbol);

  // Get saved trade plan from watchlist item - memoized to prevent infinite loops
  const savedTradePlan = useMemo(() => {
    if (!watchlistItem) return null;
    if (watchlistItem.symbol.toUpperCase() !== symbol.toUpperCase()) return null;
    const hasData = watchlistItem.targetEntry || watchlistItem.stopPlan || watchlistItem.targetPlan;
    if (!hasData) return null;
    return {
      entry: watchlistItem.targetEntry,
      stop: watchlistItem.stopPlan,
      target: watchlistItem.targetPlan,
    };
  }, [
    symbol,
    watchlistItem?.id,
    watchlistItem?.symbol,
    watchlistItem?.targetEntry,
    watchlistItem?.stopPlan,
    watchlistItem?.targetPlan,
  ]);

  // NOTE: Price lines loading is handled by AskIvyOverlay via savedTradePlan prop
  // AskIvyOverlay calls onSelectionChange to update ivyEntryLevel/Stop/Target

  // Handler to save trade plan to watchlist
  const handleSaveTradePlan = useCallback((data: { entry?: number; stop?: number; target?: number }) => {
    if (isWatchlisted && watchlistItem) {
      updateWatchlist({ 
        id: watchlistItem.id, 
        data: { 
          targetEntry: data.entry, 
          stopPlan: data.stop, 
          targetPlan: data.target 
        } 
      });
      toast({ title: "Saved", description: "Trade plan saved to watchlist" });
    } else {
      addToWatchlistWithTradePlan({ 
        symbol, 
        targetEntry: data.entry, 
        stopPlan: data.stop, 
        targetPlan: data.target 
      });
    }
  }, [isWatchlisted, watchlistItem, updateWatchlist, addToWatchlistWithTradePlan, symbol, toast]);

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

  const ivyTradePlanPriceLines = useMemo(() => {
    return buildWatchlistTradePlanLines({
      liveEntry: ivyEntryLevel?.price,
      liveStop: ivyStopLevel?.price,
      liveTarget: ivyTargetLevel?.price,
      saved: savedTradePlan,
    });
  }, [ivyEntryLevel, ivyStopLevel, ivyTargetLevel, savedTradePlan]);

  const ivyChartClickHandler = isTradePlanEnabled() && ivyActiveClickField
    ? (_candle: unknown, clickedPrice: number) => {
        setIvyChartClick({ price: clickedPrice, timestamp: Date.now() });
      }
    : undefined;

  // NOW safe to return early - all hooks have been called
  if (!open) return null;
  
  // Safety check: if no symbol or no current result, close and return null
  if (!symbol || !current) {
    console.warn("[ScanChartViewer] No symbol or current result, closing viewer");
    setTimeout(() => onOpenChange(false), 0);
    return null;
  }

  const scanNavExtra = (
    <div className="flex items-center gap-2 flex-shrink-0">
      <Button
        size="sm"
        variant={activeNavigationMode === 'watchlist' ? 'default' : 'outline'}
        onClick={() => {
          const newMode = activeNavigationMode === 'watchlist' ? 'scan' : 'watchlist';
          setActiveNavigationMode(newMode);
          onNavigationModeChange?.(newMode);
          if (currentIndex >= navigationList.length) {
            onIndexChange(0);
          }
        }}
        disabled={!watchlist || watchlist.length === 0}
        data-testid="button-nav-mode-toggle"
      >
        {activeNavigationMode === 'watchlist' ? '⭐ Watchlist' : '🔍 Scan'}
      </Button>
      <Button
        size="icon"
        variant="outline"
        disabled={currentIndex === 0}
        onClick={() => onIndexChange(currentIndex - 1)}
        data-testid="button-chart-prev"
      >
        <ChevronLeft className="h-4 w-4" style={{ color: cssVariables.secondaryOverlayColor }} />
      </Button>
      <span className="text-sm" style={{ color: cssVariables.textColorSmall }} data-testid="text-chart-position">
        {currentIndex + 1} of {navigationList.length}
        {activeNavigationMode === 'watchlist' && ' (Watchlist)'}
      </span>
      <Button
        size="icon"
        variant="outline"
        disabled={currentIndex === navigationList.length - 1}
        onClick={() => onIndexChange(currentIndex + 1)}
        data-testid="button-chart-next"
      >
        <ChevronRight className="h-4 w-4" style={{ color: cssVariables.secondaryOverlayColor }} />
      </Button>
      <div className="flex items-center gap-1 border rounded-md px-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className={`toggle-elevate ${chartRatings[symbol] === "up" ? "toggle-elevated text-rs-green" : ""}`}
              onClick={() => {
                const price = dayChange?.price ?? current?.price ?? 0;
                const indicatorSnapshot = current?.thoughtBreakdown || null;
                ratingMutation.mutate({ symbol, rating: "up", price, indicatorSnapshot });
              }}
              disabled={ratingMutation.isPending}
              data-testid="button-chart-thumbsup"
            >
              <ThumbsUp className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-sm">Good scan result — this chart looks promising. Your ratings help AI tune scan parameters over time.</p>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className={`toggle-elevate ${chartRatings[symbol] === "down" ? "toggle-elevated text-rs-red" : ""}`}
              onClick={() => {
                const price = dayChange?.price ?? current?.price ?? 0;
                const indicatorSnapshot = current?.thoughtBreakdown || null;
                ratingMutation.mutate({ symbol, rating: "down", price, indicatorSnapshot });
              }}
              disabled={ratingMutation.isPending}
              data-testid="button-chart-thumbsdown"
            >
              <ThumbsDown className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-sm">Poor scan result — this chart doesn't fit what you're looking for. Helps AI learn your preferences.</p>
          </TooltipContent>
        </Tooltip>
      </div>
      {isTradePlanEnabled() ? (
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
      ) : null}
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
          <p className="text-sm">View recent news for {symbol}</p>
        </TooltipContent>
      </Tooltip>
      <WatchlistSelector symbol={symbol} />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant={msSyncEnabled ? "default" : "outline"}
            className="gap-1.5"
            onClick={() => {
              const newState = !msSyncEnabled;
              setMsSyncEnabled(newState);
              if (newState && symbol) {
                syncToMarketSurge(symbol, 'day');
                toast({
                  title: 'MarketSurge Sync Active',
                  description: 'Navigate with arrow keys to sync'
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
      {(() => {
        const ratedCount = Object.keys(chartRatings).length;
        const total = results.length;
        const threshold = Math.max(1, Math.ceil(total * 0.3));
        const meetsThreshold = ratedCount >= threshold;
        if (ratedCount === 0 && !tuningActive) return null;
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1.5 text-xs cursor-default" data-testid="text-rating-progress">
                <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${Math.min(100, (ratedCount / Math.max(1, total)) * 100)}%`, backgroundColor: meetsThreshold ? "hsl(var(--rs-green))" : "hsl(var(--muted-foreground) / 0.5)" }}
                  />
                </div>
                <span className={meetsThreshold ? "text-rs-green" : "text-muted-foreground"}>
                  {ratedCount}/{total}
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs">
              <p className="text-sm">
                {meetsThreshold
                  ? `You've rated ${ratedCount} of ${total} charts — enough to commit tuning. Rate more for better AI learning.`
                  : `Rate at least ${threshold} of ${total} charts (30%) before you can save & commit tuning changes.`}
              </p>
            </TooltipContent>
          </Tooltip>
        );
      })()}
    </div>
  );

  const scanUpperPane = (
    <div className="flex items-center gap-1 h-full overflow-x-auto overflow-y-hidden">
      {current?.passedPaths.map((p) => (
        <Badge key={p} variant="outline" className="text-[10px]">
          {p}
        </Badge>
      ))}
    </div>
  );

  const scanLowerPane = current?.thoughtBreakdown && current.thoughtBreakdown.length > 0 ? (
    <div className="flex items-center gap-2 h-full overflow-x-auto overflow-y-hidden px-2 text-[10px] rounded-md border border-blue-800/40 bg-blue-950/15" data-testid="thought-breakdown-strip">
      <button
        className="flex-shrink-0 p-0.5 rounded hover-elevate"
        onClick={() => setTickerDebugOpen(v => !v)}
        data-testid="button-ticker-debug-info"
      >
        <Info className="h-3 w-3 text-blue-400" />
      </button>
      {current.thoughtBreakdown.map((thought) => {
        const passCount = thought.criteriaResults.filter((c: any) => c.pass).length;
        const totalCount = thought.criteriaResults.length;
        return (
          <div key={thought.thoughtId} className="flex items-center gap-1 flex-shrink-0 whitespace-nowrap">
            {thought.pass ? (
              <CheckCircle2 className="h-2.5 w-2.5 text-rs-green flex-shrink-0" />
            ) : (
              <XCircle className="h-2.5 w-2.5 text-rs-red flex-shrink-0" />
            )}
            <span className="font-medium text-foreground/90">{thought.thoughtName}</span>
            <span className={`font-semibold ${passCount === totalCount ? "text-rs-green" : "text-rs-amber"}`}>
              {passCount}/{totalCount}
            </span>
          </div>
        );
      })}
    </div>
  ) : undefined;

  const tickerDebugPanel = tickerDebugOpen && current?.thoughtBreakdown && current.thoughtBreakdown.length > 0 ? (
    <div
      className="absolute left-4 bottom-14 w-[480px] max-h-[420px] overflow-auto rounded-md border bg-popover shadow-lg z-50"
      data-testid="ticker-debug-overlay"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Ticker Debug — {symbol}</span>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon" variant="ghost" onClick={handleCopyTickerDebugText} data-testid="button-copy-ticker-debug-text">
                <ClipboardCopy className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top"><p>Copy debug text to clipboard</p></TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon" variant="ghost" onClick={handleCopyChartWindow} data-testid="button-copy-chart-image">
                <Camera className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top"><p>Copy entire chart window as image to clipboard</p></TooltipContent>
          </Tooltip>
          <Button size="icon" variant="ghost" onClick={() => setTickerDebugOpen(false)} data-testid="button-close-ticker-debug">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="px-3 py-2 space-y-2 text-[10px] font-mono text-muted-foreground leading-relaxed">
        {current.thoughtBreakdown.map((thought) => {
          const passCount = thought.criteriaResults.filter((c: any) => c.pass).length;
          const totalCount = thought.criteriaResults.length;
          return (
            <div key={thought.thoughtId} className="border-t border-dashed pt-1 first:border-t-0 first:pt-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                {thought.pass ? (
                  <CheckCircle2 className="h-2.5 w-2.5 text-rs-green flex-shrink-0" />
                ) : (
                  <XCircle className="h-2.5 w-2.5 text-rs-red flex-shrink-0" />
                )}
                <span className="font-semibold text-foreground">{thought.thoughtName}</span>
                <span className={`font-semibold ${passCount === totalCount ? "text-rs-green" : "text-rs-amber"}`}>
                  {passCount}/{totalCount}
                </span>
              </div>
              <div className="ml-4 mt-1 space-y-0.5">
                {thought.criteriaResults.map((cr: any, ci: number) => (
                  <div key={ci} className="flex items-start gap-1.5">
                    {cr.pass ? (
                      <CheckCircle2 className="h-2 w-2 text-rs-green flex-shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="h-2 w-2 text-rs-red flex-shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1">
                      <span className="text-foreground/80">{cr.indicatorName}</span>
                      {cr.inverted && <span className="text-rs-yellow ml-1">[INV]</span>}
                      {cr.diagnostics && (
                        <div className="ml-2 text-muted-foreground/70">
                          <span className="text-foreground/60">val: </span>
                          <span className={cr.pass ? "text-rs-green" : "text-rs-red"}>{cr.diagnostics.value}</span>
                          <span className="text-foreground/60 ml-1.5">thresh: </span>
                          <span>{cr.diagnostics.threshold}</span>
                          {cr.diagnostics.detail && (
                            <span className="text-muted-foreground/50 ml-1.5">{cr.diagnostics.detail}</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  ) : null;

  return createPortal(
    <div
      ref={overlayRef}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ outline: "none" }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      data-testid="scan-chart-overlay"
    >
      <div className="absolute inset-0 bg-black/80 z-0" />
      {commitReadyBanner && (
        <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none" data-testid="commit-ready-banner">
          <div className="bg-background/95 border border-rs-green/30 rounded-lg px-6 py-4 shadow-2xl max-w-md text-center animate-in fade-in zoom-in-95 duration-300">
            <div className="flex items-center justify-center gap-2 mb-1">
              <CheckCircle2 className="h-5 w-5 text-rs-green" />
              <span className="text-sm font-semibold text-rs-green">Ready to Commit</span>
            </div>
            <p className="text-xs text-muted-foreground">{commitReadyBanner}</p>
          </div>
        </div>
      )}
      {trainingMode && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 pointer-events-none" data-testid="training-mode-banner">
          <div className="bg-purple-950/95 border border-purple-500/50 rounded-lg px-6 py-3 shadow-2xl animate-in slide-in-from-top-2 duration-300">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-purple-500/20">
                <GraduationCap className="h-4 w-4 text-purple-400" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-purple-300">AI Training Mode</span>
                  <Badge variant="outline" className="text-[10px] border-purple-500/50 text-purple-300">ADMIN</Badge>
                </div>
                {sourceSetupName && (
                  <p className="text-xs text-purple-400/80">Validating setup: {sourceSetupName}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      <div ref={chartWindowRef} className="relative z-10 w-[95vw] max-w-[95vw] h-[90vh] bg-background border rounded-md shadow-lg flex flex-col pt-12 px-4 pb-4">
        <Button
          variant="ghost"
          size="sm"
          className="absolute top-2 left-2 z-[70] gap-1.5 bg-background/90 hover:bg-background"
          onClick={() => onOpenChange(false)}
          data-testid="button-back-screen-results"
        >
          <ChevronsLeft className="h-4 w-4" />
          Screen Results
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="absolute top-2 right-2 z-[70] bg-background/90 hover:bg-background"
          onClick={() => onOpenChange(false)}
          data-testid="button-chart-close"
        >
          <X className="h-6 w-6" />
        </Button>
        <ChartErrorBoundary key={`scan-chart-viewer-${symbol}`} onClose={() => onOpenChange(false)}>
        <div className="relative flex-1 min-h-0 flex flex-col">
          <DualChartGrid
            symbol={symbol}
            dailyData={dailyData}
            dailyLoading={dailyLoading}
            intradayData={intradayData}
            intradayLoading={intradayLoading}
            intradayFetching={intradayFetching}
            chartMetrics={chartMetrics ?? null}
            intradayTimeframe={intradayTimeframe}
            onIntradayTimeframeChange={(tf) => {
              if (tf === "5min" || tf === "15min" || tf === "30min") setIntradayTimeframe(tf);
            }}
            showETH={showETH}
            onShowETHChange={setShowETH}
            showExtendedHoursControls
            showIntradayMaBasisToggle={false}
            upperPane={scanUpperPane}
            navExtra={scanNavExtra}
            lowerPane={scanLowerPane}
            alertTradePlanPreview={
              isTradePlanEnabled() && savedTradePlan
                ? { mode: "single", ...savedTradePlan }
                : null
            }
            alertWatchlistId={watchlistItem?.watchlistId ?? null}
            dailyChartProps={{
              markers: cocAnnotations.markers,
              diamondMarkers: cocAnnotations.diamondMarkers,
              priceLines: [...(cocAnnotations.priceLines || []), ...ivyTradePlanPriceLines],
              resistanceLines: cocAnnotations.resistanceLines,
              baseZones: cocAnnotations.baseZones,
              onCandleClick: ivyChartClickHandler,
            }}
            intradayChartProps={{
              priceLines: ivyTradePlanPriceLines,
              onCandleClick: ivyChartClickHandler,
            }}
            testIdPrefix="scan"
          />
          {isTradePlanEnabled() ? (
          <AskIvyOverlay
            open={askIvyOpen}
            onOpenChange={setAskIvyOpen}
            symbol={symbol}
            currentPrice={dayChange?.price ?? current?.price ?? 0}
            chartCandles={dailyData?.candles}
            onSelectionChange={handleIvySelectionChange}
            chartClickEvent={ivyChartClick}
            onChartClickModeChange={(field) => {
              setIvyActiveClickField(field);
            }}
            setupContext={setupConfig ? {
              setupId: setupConfig.id,
              setupName: setupConfig.name,
              ivyEntryStrategy: setupConfig.ivyEntryStrategy,
              ivyStopStrategy: setupConfig.ivyStopStrategy,
              ivyTargetStrategy: setupConfig.ivyTargetStrategy,
              ivyContextNotes: setupConfig.ivyContextNotes,
              ivyApproved: setupConfig.ivyApproved,
            } : undefined}
            isWatchlisted={isWatchlisted}
            watchlistItemId={watchlistItem?.id}
            onSaveTradePlan={handleSaveTradePlan}
            onClearTradePlan={handleClearTradePlan}
            savedTradePlan={savedTradePlan}
            tradePlanWatchlistReady={watchlistFetched}
          />
          ) : null}
          
          {/* News Panel */}
          {newsOpen && (
            <div 
              className="fixed top-16 right-4 w-96 max-h-[70vh] rounded-lg border shadow-xl overflow-hidden z-50"
              style={{ backgroundColor: cssVariables.overlayBg, borderColor: cssVariables.secondaryOverlayColor }}
            >
              <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: cssVariables.secondaryOverlayColor, backgroundColor: cssVariables.headerBg }}>
                <div className="flex items-center gap-2">
                  <Newspaper className="h-4 w-4 text-blue-400" />
                  <span className="font-semibold" style={{ color: cssVariables.textColorHeader }}>News - {symbol}</span>
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
                      No recent news found for {symbol}
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
        </ChartErrorBoundary>
        {tickerDebugPanel}
      </div>
    </div>,
    document.body
  );
}
