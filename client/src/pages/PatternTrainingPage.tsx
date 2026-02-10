import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useSentinelAuth } from "@/context/SentinelAuthContext";
import { useSystemSettings } from "@/context/SystemSettingsContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Search, Loader2, Star, Save, Pencil, Trash2,
  Target, TrendingUp, TrendingDown, ArrowDown, ArrowUp,
  CheckCircle2, XCircle, RotateCcw, Plus, X, Filter,
  BarChart3, Activity, Gauge, Zap, Crosshair, Eye,
  Brain, ShieldAlert, Lightbulb, ThumbsUp, ThumbsDown, BookOpen
} from "lucide-react";
import { MaSettingsDialog } from "@/components/MaSettingsDialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { SentinelHeader } from "@/components/SentinelHeader";
import { TradingChart, type ChartCandle } from "@/components/TradingChart";
import {
  TRAINING_PATTERN_TYPES,
  TRAINING_TIMEFRAMES,
  TRAINING_POINT_ROLES,
  TRAINING_OUTCOMES,
} from "@shared/schema";

type PointRole = typeof TRAINING_POINT_ROLES[number]["value"];

interface PointData {
  pointRole: PointRole;
  price: number;
  pointDate: string;
  ohlcv?: { open: number; high: number; low: number; close: number; volume: number };
  percentFromEntry?: number;
  percentFrom50d?: number;
  percentFrom200d?: number;
  percentFromVwap?: number;
  nearestMa?: string;
  nearestMaDistance?: number;
  technicalData?: Record<string, number | undefined>;
  resistanceTouchCount?: number;
}

interface SetupData {
  id?: number;
  ticker: string;
  patternType: string;
  timeframe: string;
  rating?: number;
  outcome?: string;
  pnlPercent?: number;
  daysHeld?: number;
  notes?: string;
  tags?: string[];
  entryTactics?: { fiveMinEMACross?: boolean; macdCross?: boolean; other?: string };
  calculatedMetrics?: Record<string, number | string | undefined>;
  pointsSaved?: boolean;
  points?: PointData[];
  createdAt?: string;
}

interface EvaluationData {
  score: number;
  confidence: number;
  rrRatio: number | null;
  verdict: string;
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  riskFlags: string[];
  similarSetups: {
    setupId: number;
    ticker: string;
    patternType: string;
    outcome: string;
    score: number;
    similarity: string;
  }[];
  patternStats: {
    totalSetups: number;
    setupsWithOutcomes: number;
    winRate: number;
    avgRR: number;
    byPatternType: Record<string, { count: number; wins: number; winRate: number; avgRR: number }>;
  };
  learningContext: {
    totalSetupsUsed: number;
    setupsWithOutcomes: number;
    similarSetupsFound: number;
    patternTypesKnown: string[];
  };
}

const POINT_COLORS: Record<string, string> = {
  entry: "#22c55e",
  stop: "#ef4444",
  target: "#3b82f6",
  sell: "#f59e0b",
  support_bounce: "#a855f7",
  resistance_test: "#eab308",
  breakout_confirmed: "#06b6d4",
  breakdown: "#f97316",
};

const POINT_SHAPES: Record<string, "circle" | "arrowDown" | "arrowUp"> = {
  entry: "arrowUp",
  stop: "arrowDown",
  target: "arrowUp",
  sell: "arrowDown",
  support_bounce: "circle",
  resistance_test: "circle",
  breakout_confirmed: "arrowUp",
  breakdown: "arrowDown",
};

function getPointsForRole(points: PointData[], role: string): PointData[] {
  return points.filter(p => p.pointRole === role);
}

function getFirstEntry(points: PointData[]): PointData | undefined {
  return points.find(p => p.pointRole === "entry");
}

function hasRole(points: PointData[], role: string): boolean {
  return points.some(p => p.pointRole === role);
}

function isMultiPointRole(role: string): boolean {
  const roleDef = TRAINING_POINT_ROLES.find(r => r.value === role);
  return !!(roleDef && 'multiPoint' in roleDef && roleDef.multiPoint);
}

export default function PatternTrainingPage() {
  const { user } = useSentinelAuth();
  const { settings } = useSystemSettings();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("create");

  const [ticker, setTicker] = useState("");
  const [searchTicker, setSearchTicker] = useState("");
  const [timeframe, setTimeframe] = useState("daily");
  const [intradayTimeframe, setIntradayTimeframe] = useState("15min");
  const [chartLoaded, setChartLoaded] = useState(false);
  const [dualChartMode, setDualChartMode] = useState(false);

  const [activePointRole, setActivePointRole] = useState<PointRole | null>(null);
  const [points, setPoints] = useState<PointData[]>([]);
  const [pointsSaved, setPointsSaved] = useState(false);
  const [editingPoints, setEditingPoints] = useState(true);

  const [patternType, setPatternType] = useState("");
  const [rating, setRating] = useState(0);
  const [outcome, setOutcome] = useState("");
  const [pnlPercent, setPnlPercent] = useState("");
  const [daysHeld, setDaysHeld] = useState("");
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  const [fiveMinEMACross, setFiveMinEMACross] = useState(false);
  const [macdCross, setMacdCross] = useState(false);
  const [showMaSettings, setShowMaSettings] = useState(false);

  const [calculatedMetrics, setCalculatedMetrics] = useState<Record<string, number | string | undefined>>({});
  const [metricsLoading, setMetricsLoading] = useState(false);

  const { data: maSettingsData } = useQuery<any[]>({
    queryKey: ["/api/sentinel/ma-settings"],
  });

  const { data: chartPrefs } = useQuery<{ defaultBarsOnScreen: number }>({
    queryKey: ["/api/sentinel/chart-preferences"],
  });
  const maxBars = chartPrefs?.defaultBarsOnScreen ?? 200;

  const [currentSetupId, setCurrentSetupId] = useState<number | null>(null);

  const [evaluation, setEvaluation] = useState<EvaluationData | null>(null);
  const [evaluationLoading, setEvaluationLoading] = useState(false);

  const [libraryFilter, setLibraryFilter] = useState({ patternType: "", rating: 0, ticker: "" });

  const controlPointsRef = useRef<HTMLDivElement>(null);

  type ChartDataShape = {
    candles: ChartCandle[];
    indicators: {
      ema5: (number | null)[];
      ema10: (number | null)[];
      sma21: (number | null)[];
      sma50: (number | null)[];
      sma200: (number | null)[];
      avwapHigh?: (number | null)[];
      avwapLow?: (number | null)[];
    };
    ticker: string;
    timeframe: string;
  };

  const activeTimeframe = dualChartMode ? "daily" : timeframe;

  const { data: chartData, isLoading: chartLoading } = useQuery<ChartDataShape>({
    queryKey: ["/api/sentinel/pattern-training/chart-data", searchTicker, activeTimeframe],
    enabled: !!searchTicker,
    queryFn: async () => {
      const res = await fetch(`/api/sentinel/pattern-training/chart-data?ticker=${searchTicker}&timeframe=${activeTimeframe}`);
      if (!res.ok) throw new Error("Failed to fetch chart data");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: intradayChartData, isLoading: intradayChartLoading } = useQuery<ChartDataShape>({
    queryKey: ["/api/sentinel/pattern-training/chart-data", searchTicker, intradayTimeframe],
    enabled: !!searchTicker && dualChartMode,
    queryFn: async () => {
      const res = await fetch(`/api/sentinel/pattern-training/chart-data?ticker=${searchTicker}&timeframe=${intradayTimeframe}`);
      if (!res.ok) throw new Error("Failed to fetch intraday chart data");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: setups, isLoading: setupsLoading } = useQuery<SetupData[]>({
    queryKey: ["/api/sentinel/pattern-training/setups"],
  });

  const createSetupMutation = useMutation({
    mutationFn: async (data: Partial<SetupData>) => {
      const res = await apiRequest("POST", "/api/sentinel/pattern-training/setups", data);
      return res.json();
    },
    onSuccess: (data) => {
      setCurrentSetupId(data.id);
      toast({ title: "Setup created" });
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/pattern-training/setups"] });
    },
    onError: () => {
      toast({ title: "Failed to create setup", variant: "destructive" });
    },
  });

  const updateSetupMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<SetupData> }) => {
      const res = await apiRequest("PATCH", `/api/sentinel/pattern-training/setups/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Setup saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/pattern-training/setups"] });
    },
    onError: () => {
      toast({ title: "Failed to save setup", variant: "destructive" });
    },
  });

  const savePointsMutation = useMutation({
    mutationFn: async ({ setupId, points: pts }: { setupId: number; points: PointData[] }) => {
      const res = await apiRequest("POST", `/api/sentinel/pattern-training/setups/${setupId}/points`, { points: pts });
      return res.json();
    },
    onSuccess: () => {
      setPointsSaved(true);
      setEditingPoints(false);
      toast({ title: "Points saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/pattern-training/setups"] });
    },
    onError: () => {
      toast({ title: "Failed to save points", variant: "destructive" });
    },
  });

  const deleteSetupMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/sentinel/pattern-training/setups/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Setup deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/pattern-training/setups"] });
    },
  });

  const loadChart = useCallback(() => {
    if (ticker.trim()) {
      setSearchTicker(ticker.trim().toUpperCase());
      setChartLoaded(true);
      setPoints([]);
      setPointsSaved(false);
      setEditingPoints(true);
      setCurrentSetupId(null);
      setCalculatedMetrics({});
    }
  }, [ticker]);

  const handleCandleClick = useCallback(async (candle: ChartCandle, clickedPrice: number) => {
    if (!activePointRole || !editingPoints || !searchTicker) return;

    try {
      const res = await fetch("/api/sentinel/pattern-training/point-technicals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: searchTicker, pointDate: candle.date, timeframe }),
      });
      const techData = res.ok ? await res.json() : null;

      const firstEntry = getFirstEntry(points);
      const percentFromEntry = activePointRole !== "entry" && firstEntry
        ? ((clickedPrice - firstEntry.price) / firstEntry.price) * 100
        : 0;

      const newPoint: PointData = {
        pointRole: activePointRole,
        price: clickedPrice,
        pointDate: candle.date,
        ohlcv: techData?.ohlcv || { open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume },
        percentFromEntry: activePointRole === "entry" ? 0 : percentFromEntry,
        percentFrom50d: techData?.technicals?.distSma50,
        percentFrom200d: techData?.technicals?.distSma200,
        nearestMa: techData?.nearestMA?.name,
        nearestMaDistance: techData?.nearestMA?.distance,
        technicalData: techData?.technicals,
      };

      setPoints(prev => {
        const multi = isMultiPointRole(activePointRole!);
        let updated: PointData[];
        if (multi) {
          updated = [...prev, newPoint];
        } else {
          updated = [...prev.filter(p => p.pointRole !== activePointRole), newPoint];
        }
        if (activePointRole === "entry") {
          const entryPrice = clickedPrice;
          updated = updated.map(p => {
            if (p.pointRole !== "entry" && p.price) {
              return { ...p, percentFromEntry: ((p.price - entryPrice) / entryPrice) * 100 };
            }
            return p;
          });
        }
        return updated;
      });

      if (!isMultiPointRole(activePointRole)) {
        setActivePointRole(null);
      }
      toast({ title: `${TRAINING_POINT_ROLES.find(r => r.value === activePointRole)?.label} set: $${clickedPrice.toFixed(2)}` });
    } catch {
      toast({ title: "Failed to load technical data", variant: "destructive" });
    }
  }, [activePointRole, editingPoints, searchTicker, timeframe, points, toast]);

  const markers = useMemo(() => {
    return points.map((p, idx) => {
      const rolePoints = getPointsForRole(points, p.pointRole);
      const roleIdx = rolePoints.indexOf(p);
      const suffix = rolePoints.length > 1 ? ` #${roleIdx + 1}` : "";
      return {
        time: Math.floor(new Date(p.pointDate).getTime() / 1000),
        position: (POINT_SHAPES[p.pointRole] === "arrowDown" ? "belowBar" : "aboveBar") as "aboveBar" | "belowBar",
        color: POINT_COLORS[p.pointRole] || "#ffffff",
        shape: POINT_SHAPES[p.pointRole] || "circle" as "circle" | "arrowDown" | "arrowUp",
        text: `${TRAINING_POINT_ROLES.find(r => r.value === p.pointRole)?.label || p.pointRole}${suffix}`,
      };
    });
  }, [points]);

  const priceLines = useMemo(() => {
    return points.map((p, idx) => {
      const rolePoints = getPointsForRole(points, p.pointRole);
      const roleIdx = rolePoints.indexOf(p);
      const suffix = rolePoints.length > 1 ? ` #${roleIdx + 1}` : "";
      const label = TRAINING_POINT_ROLES.find(r => r.value === p.pointRole)?.label || p.pointRole;
      return {
        price: p.price,
        color: POINT_COLORS[p.pointRole] || "#ffffff",
        label: `${label}${suffix}: $${p.price.toFixed(2)}`,
      };
    });
  }, [points]);

  const handleSavePoints = async () => {
    const firstEntry = getFirstEntry(points);
    const firstStop = points.find(p => p.pointRole === "stop");
    const firstTarget = points.find(p => p.pointRole === "target");
    if (!firstEntry || !firstStop || !firstTarget) {
      toast({ title: "Entry, Stop, and Target are required", variant: "destructive" });
      return;
    }

    let setupId = currentSetupId;
    if (!setupId) {
      const setup = await createSetupMutation.mutateAsync({
        ticker: searchTicker,
        patternType: patternType || "other",
        timeframe,
      });
      setupId = setup.id;
    }

    await savePointsMutation.mutateAsync({ setupId: setupId!, points });

    setMetricsLoading(true);
    try {
      const resistancePoint = points.find(p => p.pointRole === "resistance_test");
      const res = await fetch("/api/sentinel/pattern-training/setup-metrics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: searchTicker,
          entryDate: firstEntry.pointDate,
          stopPrice: firstStop.price,
          targetPrice: firstTarget.price,
          entryPrice: firstEntry.price,
          resistancePrice: resistancePoint?.price,
        }),
      });
      if (res.ok) {
        const metrics = await res.json();
        setCalculatedMetrics(metrics);
        if (setupId) {
          await updateSetupMutation.mutateAsync({ id: setupId, data: { calculatedMetrics: metrics } });
        }
      }
    } catch {
      console.error("Failed to calculate metrics");
    }
    setMetricsLoading(false);
  };

  const handleSaveSetup = async () => {
    if (!currentSetupId) return;
    await updateSetupMutation.mutateAsync({
      id: currentSetupId,
      data: {
        patternType: patternType || "other",
        rating: rating || undefined,
        outcome: outcome || undefined,
        pnlPercent: pnlPercent ? parseFloat(pnlPercent) : undefined,
        daysHeld: daysHeld ? parseInt(daysHeld) : undefined,
        notes: notes || undefined,
        tags,
        entryTactics: { fiveMinEMACross, macdCross },
        calculatedMetrics,
      },
    });
  };

  const handleAIEvaluate = async () => {
    if (!currentSetupId) return;
    setEvaluationLoading(true);
    setEvaluation(null);
    try {
      const res = await apiRequest("POST", `/api/sentinel/pattern-training/setups/${currentSetupId}/evaluate`);
      const result = await res.json();
      setEvaluation(result);
      toast({ title: `AI Score: ${result.score}/10 — ${result.verdict}` });
    } catch (error: any) {
      toast({ title: "Evaluation failed", description: error.message || "Please try again", variant: "destructive" });
    } finally {
      setEvaluationLoading(false);
    }
  };

  const loadExistingEvaluation = async (setupId: number) => {
    try {
      const res = await fetch(`/api/sentinel/pattern-training/setups/${setupId}/evaluation`);
      if (res.ok) {
        const data = await res.json();
        setEvaluation(data);
      } else {
        setEvaluation(null);
      }
    } catch {
      setEvaluation(null);
    }
  };

  const handleLoadSetup = (setup: SetupData) => {
    setTicker(setup.ticker);
    setSearchTicker(setup.ticker);
    setTimeframe(setup.timeframe);
    setChartLoaded(true);
    setCurrentSetupId(setup.id || null);
    setPatternType(setup.patternType);
    setRating(setup.rating || 0);
    setOutcome(setup.outcome || "");
    setPnlPercent(setup.pnlPercent?.toString() || "");
    setDaysHeld(setup.daysHeld?.toString() || "");
    setNotes(setup.notes || "");
    setTags(setup.tags || []);
    setFiveMinEMACross(setup.entryTactics?.fiveMinEMACross || false);
    setMacdCross(setup.entryTactics?.macdCross || false);
    setCalculatedMetrics(setup.calculatedMetrics || {});
    setPointsSaved(setup.pointsSaved || false);
    setEditingPoints(!setup.pointsSaved);

    setPoints(setup.points || []);
    setActiveTab("create");
    setEvaluation(null);
    if (setup.id && setup.pointsSaved) {
      loadExistingEvaluation(setup.id);
      const hasMetrics = setup.calculatedMetrics && Object.keys(setup.calculatedMetrics).length > 0;
      if (!hasMetrics && setup.points && setup.points.length > 0) {
        const pts = setup.points;
        const entry = pts.find((p: any) => p.pointRole === "entry");
        const stop = pts.find((p: any) => p.pointRole === "stop");
        const target = pts.find((p: any) => p.pointRole === "target");
        const resistance = pts.find((p: any) => p.pointRole === "resistance_test");
        if (entry && stop && target) {
          const loadedId = setup.id;
          setMetricsLoading(true);
          fetch("/api/sentinel/pattern-training/setup-metrics", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ticker: setup.ticker,
              entryDate: entry.pointDate,
              stopPrice: stop.price,
              targetPrice: target.price,
              entryPrice: entry.price,
              resistancePrice: resistance?.price,
            }),
          }).then(async (res) => {
            if (res.ok) {
              const metrics = await res.json();
              setCalculatedMetrics(metrics);
              if (loadedId) {
                updateSetupMutation.mutateAsync({ id: loadedId, data: { calculatedMetrics: metrics } });
              }
            }
          }).catch(() => {
            console.error("Failed to auto-calculate metrics");
          }).finally(() => {
            setMetricsLoading(false);
          });
        }
      }
    }
  };

  const resetForm = () => {
    setTicker("");
    setSearchTicker("");
    setChartLoaded(false);
    setPoints([]);
    setPointsSaved(false);
    setEditingPoints(true);
    setCurrentSetupId(null);
    setCalculatedMetrics({});
    setPatternType("");
    setRating(0);
    setOutcome("");
    setPnlPercent("");
    setDaysHeld("");
    setNotes("");
    setTags([]);
    setFiveMinEMACross(false);
    setMacdCross(false);
    setActivePointRole(null);
    setEvaluation(null);
    setEvaluationLoading(false);
  };

  const filteredSetups = useMemo(() => {
    if (!setups) return [];
    return setups.filter(s => {
      if (libraryFilter.patternType && s.patternType !== libraryFilter.patternType) return false;
      if (libraryFilter.rating && (s.rating || 0) < libraryFilter.rating) return false;
      if (libraryFilter.ticker && !s.ticker.includes(libraryFilter.ticker.toUpperCase())) return false;
      return true;
    });
  }, [setups, libraryFilter]);

  const bgStyle: any = {};
  if (settings) {
    if (settings.backgroundColor) bgStyle.backgroundColor = settings.backgroundColor;
  }

  const hasRequiredPoints = hasRole(points, "entry") && hasRole(points, "stop") && hasRole(points, "target");

  return (
    <div className="min-h-screen bg-background" style={bgStyle}>
      <SentinelHeader />
      <div className="max-w-[1800px] mx-auto p-4">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
            <TabsList data-testid="tabs-pattern-training">
              <TabsTrigger value="create" data-testid="tab-create">
                <Crosshair className="w-4 h-4 mr-1.5" />
                Create Setup
              </TabsTrigger>
              <TabsTrigger value="library" data-testid="tab-library">
                <Eye className="w-4 h-4 mr-1.5" />
                Library ({setups?.length || 0})
              </TabsTrigger>
            </TabsList>
            {activeTab === "create" && (
              <Button variant="ghost" size="sm" onClick={resetForm} data-testid="button-new-setup">
                <Plus className="w-4 h-4 mr-1" />
                New Setup
              </Button>
            )}
          </div>

          <TabsContent value="create">
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Enter ticker (e.g. AMGN)"
                  value={ticker}
                  onChange={(e) => setTicker(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === "Enter" && loadChart()}
                  className="pl-9"
                  data-testid="input-ticker"
                />
              </div>
              {!dualChartMode && (
                <Select value={timeframe} onValueChange={setTimeframe}>
                  <SelectTrigger className="w-28" data-testid="select-timeframe">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRAINING_TIMEFRAMES.map(t => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Button onClick={loadChart} disabled={!ticker.trim() || chartLoading} data-testid="button-load-chart">
                {chartLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Load Chart"}
              </Button>
              <Button
                variant={dualChartMode ? "default" : "outline"}
                size="sm"
                onClick={() => setDualChartMode(!dualChartMode)}
                data-testid="button-dual-chart"
              >
                <BarChart3 className="w-4 h-4 mr-1" />
                Dual Chart
              </Button>
            </div>

            {chartLoaded && (
              <div className="flex gap-4 items-stretch">
                <div className="flex-1 min-w-0 flex flex-col">
                  {dualChartMode ? (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col">
                        <div className="text-xs text-muted-foreground mb-1 px-1 font-medium">Daily</div>
                        {chartLoading ? (
                          <Card className="flex-1">
                            <CardContent className="flex items-center justify-center h-[400px]">
                              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                            </CardContent>
                          </Card>
                        ) : chartData ? (
                          <TradingChart
                            data={chartData}
                            onCandleClick={editingPoints ? handleCandleClick : undefined}
                            markers={markers}
                            priceLines={priceLines}
                            timeframe="daily"
                            height={400}
                            showLegend={false}
                            maSettings={maSettingsData}
                            maxBars={maxBars}
                          />
                        ) : (
                          <Card>
                            <CardContent className="flex items-center justify-center h-[400px] text-muted-foreground text-sm">
                              No daily data
                            </CardContent>
                          </Card>
                        )}
                      </div>
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2 mb-1 px-1">
                          <span className="text-xs text-muted-foreground font-medium">Intraday</span>
                          <Select value={intradayTimeframe} onValueChange={setIntradayTimeframe}>
                            <SelectTrigger className="h-6 w-20 text-[10px]" data-testid="select-intraday-timeframe">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {TRAINING_TIMEFRAMES.filter(t => t.value !== "daily").map(t => (
                                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setShowMaSettings(true)} data-testid="button-ma-settings-pattern">
                            <svg width="16" height="16" viewBox="0 0 28 28" className="text-muted-foreground">
                              <path d="M4 14c2-4 4-8 6-4s4 8 6 4 4-8 6-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                              <path d="M4 20c2-2 4-4 6-2s4 4 6 2 4-4 6-2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.5"/>
                            </svg>
                          </Button>
                        </div>
                        {intradayChartLoading ? (
                          <Card className="flex-1">
                            <CardContent className="flex items-center justify-center h-[400px]">
                              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                            </CardContent>
                          </Card>
                        ) : intradayChartData ? (
                          <TradingChart
                            data={intradayChartData}
                            onCandleClick={editingPoints ? handleCandleClick : undefined}
                            markers={markers}
                            priceLines={priceLines}
                            timeframe={intradayTimeframe}
                            height={400}
                            showLegend={false}
                            maSettings={maSettingsData}
                            maxBars={maxBars}
                          />
                        ) : (
                          <Card>
                            <CardContent className="flex items-center justify-center h-[400px] text-muted-foreground text-sm">
                              No intraday data
                            </CardContent>
                          </Card>
                        )}
                        {(pointsSaved && (Object.keys(calculatedMetrics).length > 0 || metricsLoading)) && (
                          <Card className="mt-3">
                            <CardHeader className="pb-2">
                              <CardTitle className="text-sm font-medium text-muted-foreground">Calculated Data</CardTitle>
                            </CardHeader>
                            <CardContent>
                              {metricsLoading ? (
                                <div className="flex items-center justify-center py-4">
                                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                                </div>
                              ) : (
                                <div className="grid grid-cols-2 gap-2">
                                  <MetricCard label="Risk/Reward" value={calculatedMetrics.riskReward} format="ratio" />
                                  <MetricCard label="MA Stacking" value={calculatedMetrics.maStacking} format="text" />
                                  <MetricCard label="Volume Ratio" value={calculatedMetrics.volumeRatio} format="x" />
                                  <MetricCard label="Base Depth" value={calculatedMetrics.baseDepthPct} format="pct" />
                                  <MetricCard label="Base Width" value={calculatedMetrics.baseWidthDays} format="days" />
                                  <MetricCard label="ATR %" value={calculatedMetrics.atrPercent} format="pct" />
                                  <MetricCard label="RS vs SPY" value={calculatedMetrics.rsVsSpy} format="pct" />
                                  <MetricCard label="5d Momentum" value={calculatedMetrics.momentum5d} format="pct" />
                                  <MetricCard label="20d Momentum" value={calculatedMetrics.momentum20d} format="pct" />
                                  <MetricCard label="50d Momentum" value={calculatedMetrics.momentum50d} format="pct" />
                                  <MetricCard label="% from 52w Hi" value={calculatedMetrics.pctFrom52wHigh} format="pct" />
                                  <MetricCard label="Bollinger Width" value={calculatedMetrics.bollingerWidth} format="pct" />
                                  <MetricCard label="Range Tightness" value={calculatedMetrics.rangeTightness} format="pct" />
                                  <MetricCard label="Up/Down Vol" value={calculatedMetrics.upDownVolume} format="text" />
                                  <MetricCard label="Consec Up Days" value={calculatedMetrics.consecutiveUpDays} format="num" />
                                  {calculatedMetrics.ema6_20CrossStatus && (
                                    <MetricCard label="6/20 EMA Cross" value={calculatedMetrics.ema6_20CrossStatus} format="text" />
                                  )}
                                  {calculatedMetrics.macdCrossStatus && (
                                    <MetricCard label="MACD" value={calculatedMetrics.macdCrossStatus} format="text" />
                                  )}
                                  {calculatedMetrics.resistanceTouchCount !== undefined && (
                                    <MetricCard label="Resistance Touches" value={calculatedMetrics.resistanceTouchCount} format="num" />
                                  )}
                                </div>
                              )}
                            </CardContent>
                          </Card>
                        )}
                      </div>
                    </div>
                  ) : (
                    <>
                      {chartLoading ? (
                        <Card className="flex-1">
                          <CardContent className="flex items-center justify-center h-full">
                            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                          </CardContent>
                        </Card>
                      ) : chartData ? (
                        <TradingChart
                          data={chartData}
                          onCandleClick={editingPoints ? handleCandleClick : undefined}
                          markers={markers}
                          priceLines={priceLines}
                          timeframe={timeframe}
                          maSettings={maSettingsData}
                          maxBars={maxBars}
                        />
                      ) : (
                        <Card>
                          <CardContent className="flex items-center justify-center h-[500px] text-muted-foreground">
                            No data available for {searchTicker}
                          </CardContent>
                        </Card>
                      )}
                    </>
                  )}

                  {!dualChartMode && pointsSaved && (Object.keys(calculatedMetrics).length > 0 || metricsLoading) && (
                    <Card className="mt-4">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Calculated Data</CardTitle>
                      </CardHeader>
                      <CardContent>
                        {metricsLoading ? (
                          <div className="flex items-center justify-center py-4">
                            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                            <MetricCard label="Risk/Reward" value={calculatedMetrics.riskReward} format="ratio" />
                            <MetricCard label="MA Stacking" value={calculatedMetrics.maStacking} format="text" />
                            <MetricCard label="Volume Ratio" value={calculatedMetrics.volumeRatio} format="x" />
                            <MetricCard label="Base Depth" value={calculatedMetrics.baseDepthPct} format="pct" />
                            <MetricCard label="Base Width" value={calculatedMetrics.baseWidthDays} format="days" />
                            <MetricCard label="ATR %" value={calculatedMetrics.atrPercent} format="pct" />
                            <MetricCard label="RS vs SPY" value={calculatedMetrics.rsVsSpy} format="pct" />
                            <MetricCard label="5d Momentum" value={calculatedMetrics.momentum5d} format="pct" />
                            <MetricCard label="20d Momentum" value={calculatedMetrics.momentum20d} format="pct" />
                            <MetricCard label="50d Momentum" value={calculatedMetrics.momentum50d} format="pct" />
                            <MetricCard label="% from 52w Hi" value={calculatedMetrics.pctFrom52wHigh} format="pct" />
                            <MetricCard label="Bollinger Width" value={calculatedMetrics.bollingerWidth} format="pct" />
                            <MetricCard label="Range Tightness" value={calculatedMetrics.rangeTightness} format="pct" />
                            <MetricCard label="Up/Down Vol" value={calculatedMetrics.upDownVolume} format="text" />
                            <MetricCard label="Consec Up Days" value={calculatedMetrics.consecutiveUpDays} format="num" />
                            {calculatedMetrics.ema6_20CrossStatus && (
                              <MetricCard label="6/20 EMA Cross" value={calculatedMetrics.ema6_20CrossStatus} format="text" />
                            )}
                            {calculatedMetrics.macdCrossStatus && (
                              <MetricCard label="MACD" value={calculatedMetrics.macdCrossStatus} format="text" />
                            )}
                            {calculatedMetrics.resistanceTouchCount !== undefined && (
                              <MetricCard label="Resistance Touches" value={calculatedMetrics.resistanceTouchCount} format="num" />
                            )}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )}

                  {pointsSaved && currentSetupId && (
                    <div className="mt-4 space-y-4">
                      <Button
                        onClick={handleAIEvaluate}
                        disabled={evaluationLoading}
                        className="w-full gap-2"
                        variant={evaluation ? "outline" : "default"}
                        data-testid="button-ai-evaluate"
                      >
                        {evaluationLoading ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Brain className="w-4 h-4" />
                        )}
                        {evaluationLoading ? "Analyzing Setup..." : evaluation ? "Re-Evaluate with AI" : "AI Evaluate Setup"}
                      </Button>

                      {evaluation && (
                        <Card>
                          <CardHeader className="pb-3">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <CardTitle className="text-sm font-medium flex items-center gap-2">
                                <Brain className="w-4 h-4 text-purple-400" />
                                AI Evaluation
                              </CardTitle>
                              <div className="flex items-center gap-2 flex-wrap">
                                <VerdictBadge verdict={evaluation.verdict} />
                                <Badge variant="secondary" className="text-xs">
                                  {evaluation.confidence}% confidence
                                </Badge>
                              </div>
                            </div>
                          </CardHeader>
                          <CardContent className="space-y-4">
                            <div className="flex items-center gap-4 flex-wrap">
                              <ScoreDisplay score={evaluation.score} />
                              {evaluation.rrRatio != null && (
                                <div className="text-center">
                                  <div className="text-xs text-muted-foreground">R/R Ratio</div>
                                  <div className="text-lg font-bold">{evaluation.rrRatio.toFixed(2)}</div>
                                </div>
                              )}
                            </div>

                            {evaluation.strengths.length > 0 && (
                              <EvalSection
                                icon={<ThumbsUp className="w-3.5 h-3.5 text-green-400" />}
                                title="Strengths"
                                items={evaluation.strengths}
                                color="text-green-400"
                              />
                            )}

                            {evaluation.riskFlags.length > 0 && (
                              <EvalSection
                                icon={<ShieldAlert className="w-3.5 h-3.5 text-red-400" />}
                                title="Risk Flags"
                                items={evaluation.riskFlags}
                                color="text-red-400"
                              />
                            )}

                            {evaluation.weaknesses.length > 0 && (
                              <EvalSection
                                icon={<ThumbsDown className="w-3.5 h-3.5 text-amber-400" />}
                                title="Weaknesses"
                                items={evaluation.weaknesses}
                                color="text-amber-400"
                              />
                            )}

                            {evaluation.suggestions.length > 0 && (
                              <EvalSection
                                icon={<Lightbulb className="w-3.5 h-3.5 text-blue-400" />}
                                title="Suggestions"
                                items={evaluation.suggestions}
                                color="text-blue-400"
                              />
                            )}

                            {evaluation.similarSetups.length > 0 && (
                              <div>
                                <div className="flex items-center gap-1.5 mb-2">
                                  <BookOpen className="w-3.5 h-3.5 text-purple-400" />
                                  <span className="text-xs font-medium text-purple-400">Similar Past Setups</span>
                                </div>
                                <div className="space-y-1.5">
                                  {evaluation.similarSetups.map((s, i) => (
                                    <div key={i} className="flex items-center justify-between text-xs bg-muted/30 rounded-md px-2.5 py-1.5">
                                      <div className="flex items-center gap-2">
                                        <span className="font-medium">{s.ticker}</span>
                                        <span className="text-muted-foreground">{s.patternType}</span>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <Badge variant={s.outcome === 'win' ? 'default' : 'secondary'} className="text-[10px] px-1.5 py-0">
                                          {s.outcome}
                                        </Badge>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {evaluation.learningContext && (
                              <div className="border-t pt-3 mt-3">
                                <div className="flex items-center gap-1.5 mb-1.5">
                                  <Activity className="w-3 h-3 text-muted-foreground" />
                                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Learning Context</span>
                                </div>
                                <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                                  <span>{evaluation.learningContext.totalSetupsUsed} setups learned</span>
                                  <span>{evaluation.learningContext.setupsWithOutcomes} with outcomes</span>
                                  <span>{evaluation.learningContext.similarSetupsFound} similar found</span>
                                  {evaluation.learningContext.patternTypesKnown.length > 0 && (
                                    <span>{evaluation.learningContext.patternTypesKnown.length} pattern types known</span>
                                  )}
                                </div>
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      )}
                    </div>
                  )}

                  {pointsSaved && (
                    <Card className="mt-4">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Setup Details</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div>
                            <Label className="text-xs text-muted-foreground mb-1 block">Pattern Type</Label>
                            <Select value={patternType} onValueChange={setPatternType}>
                              <SelectTrigger data-testid="select-pattern-type">
                                <SelectValue placeholder="Select pattern" />
                              </SelectTrigger>
                              <SelectContent>
                                {TRAINING_PATTERN_TYPES.map(p => (
                                  <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground mb-1 block">Timeframe</Label>
                            <Input value={TRAINING_TIMEFRAMES.find(t => t.value === timeframe)?.label || timeframe} disabled />
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground mb-1 block">Rating</Label>
                            <div className="flex items-center gap-1 pt-1" data-testid="rating-stars">
                              {[1, 2, 3, 4, 5].map(s => (
                                <button
                                  key={s}
                                  onClick={() => setRating(s === rating ? 0 : s)}
                                  className="focus:outline-none"
                                  data-testid={`button-star-${s}`}
                                >
                                  <Star
                                    className={`w-5 h-5 ${s <= rating ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`}
                                  />
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div>
                            <Label className="text-xs text-muted-foreground mb-1 block">Outcome</Label>
                            <Select value={outcome} onValueChange={setOutcome}>
                              <SelectTrigger data-testid="select-outcome">
                                <SelectValue placeholder="Select outcome" />
                              </SelectTrigger>
                              <SelectContent>
                                {TRAINING_OUTCOMES.map(o => (
                                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground mb-1 block">% Gain/Loss</Label>
                            <Input
                              type="number"
                              placeholder="+22 or -5"
                              value={pnlPercent}
                              onChange={(e) => setPnlPercent(e.target.value)}
                              data-testid="input-pnl"
                            />
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground mb-1 block">Days Held</Label>
                            <Input
                              type="number"
                              placeholder="14"
                              value={daysHeld}
                              onChange={(e) => setDaysHeld(e.target.value)}
                              data-testid="input-days-held"
                            />
                          </div>
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground mb-1 block">Notes</Label>
                          <Textarea
                            placeholder="Tight handle with volume dry-up, MAs stacking..."
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            rows={3}
                            data-testid="textarea-notes"
                          />
                        </div>
                        <div className="flex items-center gap-4">
                          <Label className="text-xs text-muted-foreground">Entry Tactics:</Label>
                          <div className="flex items-center gap-2">
                            <Checkbox
                              id="ema-cross"
                              checked={fiveMinEMACross}
                              onCheckedChange={(c) => setFiveMinEMACross(!!c)}
                              data-testid="checkbox-ema-cross"
                            />
                            <Label htmlFor="ema-cross" className="text-xs">5min 6/20 EMA Cross</Label>
                          </div>
                          <div className="flex items-center gap-2">
                            <Checkbox
                              id="macd-cross"
                              checked={macdCross}
                              onCheckedChange={(c) => setMacdCross(!!c)}
                              data-testid="checkbox-macd-cross"
                            />
                            <Label htmlFor="macd-cross" className="text-xs">MACD Cross</Label>
                          </div>
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground mb-1 block">Tags</Label>
                          <div className="flex items-center gap-2 flex-wrap">
                            {tags.map(t => (
                              <Badge key={t} variant="secondary" className="gap-1">
                                {t}
                                <button onClick={() => setTags(tags.filter(x => x !== t))} className="ml-0.5">
                                  <X className="w-3 h-3" />
                                </button>
                              </Badge>
                            ))}
                            <div className="flex items-center gap-1">
                              <Input
                                value={newTag}
                                onChange={(e) => setNewTag(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && newTag.trim()) {
                                    setTags([...tags, newTag.trim()]);
                                    setNewTag("");
                                  }
                                }}
                                placeholder="Add tag"
                                className="h-7 w-24 text-xs"
                                data-testid="input-add-tag"
                              />
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  if (newTag.trim()) {
                                    setTags([...tags, newTag.trim()]);
                                    setNewTag("");
                                  }
                                }}
                                data-testid="button-add-tag"
                              >
                                <Plus className="w-3 h-3" />
                              </Button>
                            </div>
                          </div>
                        </div>
                        <div className="flex justify-end pt-2">
                          <Button onClick={handleSaveSetup} disabled={updateSetupMutation.isPending} data-testid="button-save-setup">
                            {updateSetupMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}
                            Save Setup
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>

                <div className="w-72 shrink-0" ref={controlPointsRef}>
                  <Card>
                    <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
                      <CardTitle className="text-sm font-medium">Setup Points</CardTitle>
                      {pointsSaved && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => { setEditingPoints(true); setPointsSaved(false); }}
                          data-testid="button-edit-points"
                        >
                          <Pencil className="w-3.5 h-3.5 mr-1" />
                          Edit
                        </Button>
                      )}
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {editingPoints && (
                        <p className="text-xs text-muted-foreground mb-2">Click a box, then click the chart</p>
                      )}
                      {TRAINING_POINT_ROLES.map(role => {
                        const rolePoints = getPointsForRole(points, role.value);
                        const isActive = activePointRole === role.value;
                        const multi = isMultiPointRole(role.value);

                        return (
                          <div
                            key={role.value}
                            className={`rounded-md border p-2.5 cursor-pointer transition-colors ${
                              isActive
                                ? "border-primary bg-primary/10"
                                : rolePoints.length > 0
                                ? "border-border"
                                : "border-dashed border-border/50"
                            }`}
                            onClick={() => {
                              if (editingPoints) {
                                setActivePointRole(isActive ? null : role.value);
                              }
                            }}
                            data-testid={`point-box-${role.value}`}
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <div
                                className="w-2.5 h-2.5 rounded-full"
                                style={{ backgroundColor: POINT_COLORS[role.value] }}
                              />
                              <span className="text-xs font-medium">{role.label}</span>
                              {role.required && <Badge variant="outline" className="text-[10px] px-1 py-0">REQ</Badge>}
                              {!role.required && <span className="text-[10px] text-muted-foreground">optional</span>}
                              {multi && rolePoints.length > 0 && (
                                <Badge variant="secondary" className="text-[10px] px-1 py-0">{rolePoints.length}</Badge>
                              )}
                            </div>
                            {rolePoints.length > 0 ? (
                              <div className="space-y-1.5 ml-4">
                                {rolePoints.map((point, pIdx) => (
                                  <div key={pIdx} className="space-y-0.5">
                                    {multi && rolePoints.length > 1 && (
                                      <div className="text-[10px] text-muted-foreground font-medium">#{pIdx + 1}</div>
                                    )}
                                    <div className="text-sm font-mono">${point.price.toFixed(2)}</div>
                                    {role.value === "entry" && (
                                      <>
                                        {point.percentFrom50d !== undefined && (
                                          <div className="text-[10px] text-muted-foreground">
                                            <span className={point.percentFrom50d >= 0 ? "text-green-400" : "text-red-400"}>
                                              {point.percentFrom50d >= 0 ? "+" : ""}{point.percentFrom50d.toFixed(1)}% from 50d
                                            </span>
                                          </div>
                                        )}
                                        {point.percentFrom200d !== undefined && (
                                          <div className="text-[10px] text-muted-foreground">
                                            <span className={point.percentFrom200d >= 0 ? "text-green-400" : "text-red-400"}>
                                              {point.percentFrom200d >= 0 ? "+" : ""}{point.percentFrom200d.toFixed(1)}% from 200d
                                            </span>
                                          </div>
                                        )}
                                      </>
                                    )}
                                    {(role.value === "stop" || role.value === "sell") && point.percentFromEntry !== undefined && (
                                      <div className="text-[10px] text-red-400">
                                        {point.percentFromEntry.toFixed(1)}% from entry
                                      </div>
                                    )}
                                    {role.value === "target" && point.percentFromEntry !== undefined && (
                                      <div className="text-[10px] text-green-400">
                                        +{point.percentFromEntry.toFixed(1)}% from entry
                                      </div>
                                    )}
                                    {role.value === "support_bounce" && (
                                      <>
                                        {point.nearestMa && (
                                          <div className="text-[10px] text-muted-foreground">
                                            Nearest: {point.nearestMa}
                                          </div>
                                        )}
                                        {point.percentFromEntry !== undefined && (
                                          <div className="text-[10px] text-muted-foreground">
                                            {point.percentFromEntry.toFixed(1)}% from entry
                                          </div>
                                        )}
                                      </>
                                    )}
                                    {role.value === "resistance_test" && point.percentFromEntry !== undefined && (
                                      <div className="text-[10px] text-yellow-400">
                                        {point.percentFromEntry >= 0 ? "+" : ""}{point.percentFromEntry.toFixed(1)}% from entry
                                      </div>
                                    )}
                                    {(role.value === "breakout_confirmed" || role.value === "breakdown") && point.percentFromEntry !== undefined && (
                                      <div className={`text-[10px] ${role.value === "breakout_confirmed" ? "text-cyan-400" : "text-orange-400"}`}>
                                        {point.percentFromEntry >= 0 ? "+" : ""}{point.percentFromEntry.toFixed(1)}% from entry
                                      </div>
                                    )}
                                    {editingPoints && (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setPoints(prev => {
                                            if (multi) {
                                              const rolePts = getPointsForRole(prev, role.value);
                                              const toRemove = rolePts[pIdx];
                                              return prev.filter(p => p !== toRemove);
                                            }
                                            return prev.filter(p => p.pointRole !== role.value);
                                          });
                                        }}
                                        className="text-[10px] text-muted-foreground hover:text-destructive mt-1"
                                        data-testid={`button-clear-${role.value}-${pIdx}`}
                                      >
                                        <RotateCcw className="w-3 h-3 inline mr-0.5" /> {multi && rolePoints.length > 1 ? "Remove" : "Reset"}
                                      </button>
                                    )}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="text-xs text-muted-foreground ml-4">
                                {editingPoints ? "— click chart —" : "Not set"}
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {editingPoints && (
                        <Button
                          className="w-full mt-3"
                          onClick={handleSavePoints}
                          disabled={!hasRequiredPoints || savePointsMutation.isPending}
                          data-testid="button-save-points"
                        >
                          {savePointsMutation.isPending ? (
                            <Loader2 className="w-4 h-4 animate-spin mr-1" />
                          ) : (
                            <Save className="w-4 h-4 mr-1" />
                          )}
                          Save Points
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="library">
            <div className="flex items-center gap-3 mb-4 flex-wrap">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  placeholder="Filter ticker"
                  value={libraryFilter.ticker}
                  onChange={(e) => setLibraryFilter(f => ({ ...f, ticker: e.target.value }))}
                  className="h-8 w-28 pl-8 text-xs"
                  data-testid="input-filter-ticker"
                />
              </div>
              <Select
                value={libraryFilter.patternType || "all"}
                onValueChange={(v) => setLibraryFilter(f => ({ ...f, patternType: v === "all" ? "" : v }))}
              >
                <SelectTrigger className="h-8 w-44 text-xs" data-testid="select-filter-pattern">
                  <SelectValue placeholder="All Patterns" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Patterns</SelectItem>
                  {TRAINING_PATTERN_TYPES.map(p => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={String(libraryFilter.rating || 0)}
                onValueChange={(v) => setLibraryFilter(f => ({ ...f, rating: parseInt(v) }))}
              >
                <SelectTrigger className="h-8 w-28 text-xs" data-testid="select-filter-rating">
                  <SelectValue placeholder="Min Rating" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Any Rating</SelectItem>
                  {[1, 2, 3, 4, 5].map(r => (
                    <SelectItem key={r} value={String(r)}>{r}+ Stars</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {setupsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            ) : filteredSetups.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Crosshair className="w-12 h-12 mb-3 opacity-30" />
                  <p className="text-sm">No setups yet. Create your first one!</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredSetups.map(setup => (
                  <Card
                    key={setup.id}
                    className="hover-elevate cursor-pointer"
                    onClick={() => handleLoadSetup(setup)}
                    data-testid={`card-setup-${setup.id}`}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-semibold text-sm">{setup.ticker}</span>
                          <Badge variant="outline" className="text-[10px]">
                            {TRAINING_PATTERN_TYPES.find(p => p.value === setup.patternType)?.label || setup.patternType}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-0.5">
                          {[1, 2, 3, 4, 5].map(s => (
                            <Star
                              key={s}
                              className={`w-3 h-3 ${s <= (setup.rating || 0) ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/30"}`}
                            />
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                        <Badge variant={setup.timeframe === "daily" ? "secondary" : "outline"} className="text-[10px]">
                          {setup.timeframe}
                        </Badge>
                        {setup.outcome && (
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${
                              setup.outcome === "win" ? "text-green-400 border-green-400/30" :
                              setup.outcome === "loss" ? "text-red-400 border-red-400/30" :
                              "text-muted-foreground"
                            }`}
                          >
                            {setup.outcome}{setup.pnlPercent ? ` ${setup.pnlPercent > 0 ? "+" : ""}${setup.pnlPercent}%` : ""}
                          </Badge>
                        )}
                        {setup.points && setup.points.length > 0 && (
                          <span>{setup.points.length} points</span>
                        )}
                      </div>
                      {setup.notes && (
                        <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{setup.notes}</p>
                      )}
                      {setup.tags && setup.tags.length > 0 && (
                        <div className="flex gap-1 mt-2 flex-wrap">
                          {setup.tags.slice(0, 3).map(t => (
                            <Badge key={t} variant="outline" className="text-[10px] px-1 py-0">{t}</Badge>
                          ))}
                          {setup.tags.length > 3 && (
                            <span className="text-[10px] text-muted-foreground">+{setup.tags.length - 3}</span>
                          )}
                        </div>
                      )}
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-[10px] text-muted-foreground">
                          {setup.createdAt ? new Date(setup.createdAt).toLocaleDateString() : ""}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (setup.id) deleteSetupMutation.mutate(setup.id);
                          }}
                          data-testid={`button-delete-setup-${setup.id}`}
                        >
                          <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
      <MaSettingsDialog open={showMaSettings} onOpenChange={setShowMaSettings} />
    </div>
  );
}

function VerdictBadge({ verdict }: { verdict: string }) {
  const config: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    STRONG_BUY: { label: "STRONG BUY", variant: "default" },
    BUY: { label: "BUY", variant: "default" },
    NEUTRAL: { label: "NEUTRAL", variant: "secondary" },
    CAUTION: { label: "CAUTION", variant: "outline" },
    AVOID: { label: "AVOID", variant: "destructive" },
  };
  const c = config[verdict] || { label: verdict, variant: "secondary" as const };
  return <Badge variant={c.variant} className="text-[10px] px-2 py-0">{c.label}</Badge>;
}

function ScoreDisplay({ score }: { score: number }) {
  const color = score >= 8 ? "text-green-400" : score >= 6 ? "text-blue-400" : score >= 4 ? "text-amber-400" : "text-red-400";
  const bgColor = score >= 8 ? "border-green-400/30" : score >= 6 ? "border-blue-400/30" : score >= 4 ? "border-amber-400/30" : "border-red-400/30";
  return (
    <div className={`flex items-center gap-1 border-2 ${bgColor} rounded-lg px-3 py-1.5`}>
      <span className={`text-2xl font-bold ${color}`}>{score}</span>
      <span className="text-xs text-muted-foreground">/10</span>
    </div>
  );
}

function EvalSection({ icon, title, items, color }: { icon: React.ReactNode; title: string; items: string[]; color: string }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        {icon}
        <span className={`text-xs font-medium ${color}`}>{title}</span>
      </div>
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li key={i} className="text-xs text-muted-foreground pl-5 relative before:content-[''] before:absolute before:left-1.5 before:top-[7px] before:w-1 before:h-1 before:rounded-full before:bg-muted-foreground/50">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function MetricCard({ label, value, format }: { label: string; value: any; format: string }) {
  if (value === undefined || value === null) return null;

  let displayValue = "";
  let colorClass = "text-foreground";

  switch (format) {
    case "pct":
      const num = typeof value === "number" ? value : parseFloat(value);
      displayValue = `${num >= 0 ? "+" : ""}${num.toFixed(1)}%`;
      colorClass = num >= 0 ? "text-green-400" : "text-red-400";
      break;
    case "ratio":
      displayValue = `${Number(value).toFixed(1)} : 1`;
      break;
    case "x":
      displayValue = `${Number(value).toFixed(1)}x`;
      break;
    case "days":
      displayValue = `${value} days`;
      break;
    case "num":
      displayValue = String(value);
      break;
    case "text":
      displayValue = String(value).replace(/_/g, " ");
      break;
    default:
      displayValue = String(value);
  }

  return (
    <div className="rounded-md border p-2.5">
      <div className="text-[10px] text-muted-foreground mb-0.5">{label}</div>
      <div className={`text-sm font-mono ${colorClass}`}>{displayValue}</div>
    </div>
  );
}