import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { DualChartGrid, ChartDataResponse, ChartMetrics } from "@/components/DualChartGrid";
import {
  Loader2, ThumbsUp, ThumbsDown, Play, ChevronRight,
  ChevronLeft, X, Sparkles, SkipForward, CheckCircle2, AlertCircle
} from "lucide-react";

interface ExtractedThought {
  id: string;
  name: string;
  description?: string;
  indicators: Array<{
    id: string;
    name: string;
    params: Record<string, any>;
  }>;
}

interface ExtractedIdea {
  id: number;
  setupId: number;
  name: string;
  description?: string;
  thoughts: ExtractedThought[];
  confidence?: number;
  status: string;
  validationStats?: {
    totalRated: number;
    thumbsUp: number;
    thumbsDown: number;
    hitRate: number;
  };
}

interface ScanResult {
  symbol: string;
  name?: string;
  price: number;
  matchedThoughts: string[];
  indicatorValues?: Record<string, any>;
}

interface ValidationModeProps {
  idea: ExtractedIdea;
  open: boolean;
  onClose: () => void;
}

export function ValidationMode({ idea, open, onClose }: ValidationModeProps) {
  const { toast } = useToast();
  const [universe, setUniverse] = useState("sp500");
  const [scanResults, setScanResults] = useState<ScanResult[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [chartRatings, setChartRatings] = useState<Record<string, "up" | "down">>({});
  const [showChartView, setShowChartView] = useState(false);
  const [lastSessionStats, setLastSessionStats] = useState<{ rated: number; up: number; down: number } | null>(null);

  const currentResult = scanResults[currentIndex];

  const rateMutation = useMutation({
    mutationFn: async (data: { symbol: string; rating: "up" | "down"; price: number }) => {
      const res = await apiRequest("POST", `/api/bigidea/extracted-ideas/${idea.id}/rate`, data);
      return res.json();
    },
    onSuccess: (data, variables) => {
      setChartRatings(prev => ({ ...prev, [variables.symbol]: variables.rating }));
      queryClient.invalidateQueries({ queryKey: [`/api/bigidea/setups/${idea.setupId}/extracted-ideas`] });
      toast({
        title: "Rating recorded",
        description: `Hit rate: ${data.stats.hitRate.toFixed(0)}% (${data.stats.totalRated} rated)`,
      });
    },
    onError: (error: any) => {
      toast({ title: "Rating failed", description: error.message, variant: "destructive" });
    },
  });

  const runScan = async () => {
    setIsScanning(true);
    setScanResults([]);
    setCurrentIndex(0);
    setChartRatings({});
    setLastSessionStats(null);
    
    try {
      const nodes: any[] = [];
      const edges: any[] = [];

      idea.thoughts.forEach((thought, idx) => {
        const criteria = thought.indicators.map((ind) => ({
          indicatorId: ind.id,
          label: ind.name,
          inverted: false,
          muted: false,
          params: Object.entries(ind.params || {}).map(([name, value]) => ({
            name,
            label: name,
            type: typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "select",
            value,
          })),
        }));

        nodes.push({
          id: `thought-${idx}`,
          type: "thought",
          thoughtId: idx,
          thoughtName: thought.name,
          thoughtCategory: "Validation",
          thoughtDescription: thought.description || "",
          thoughtCriteria: criteria,
          position: { x: 100 + idx * 250, y: 150 },
        });

        edges.push({
          id: `edge-${idx}`,
          source: `thought-${idx}`,
          target: "results",
          logicType: "OR",
        });
      });

      nodes.push({
        id: "results",
        type: "results",
        position: { x: 100 + idea.thoughts.length * 125, y: 350 },
      });

      const res = await apiRequest("POST", "/api/bigidea/scan", {
        nodes,
        edges,
        universe,
      });

      const data = await res.json();
      
      if (data.results && data.results.length > 0) {
        setScanResults(
          data.results.map((r: any) => ({
            symbol: r.symbol,
            name: r.companyName || r.symbol,
            price: r.lastPrice || 0,
            matchedThoughts: idea.thoughts.map((t) => t.name),
            indicatorValues: r.indicatorValues,
          }))
        );
        setShowChartView(true);
      } else {
        toast({
          title: "No results",
          description: "The scan returned no matching stocks. Try adjusting the criteria.",
        });
      }
    } catch (error: any) {
      toast({
        title: "Scan failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsScanning(false);
    }
  };

  const handleRate = (rating: "up" | "down") => {
    if (!currentResult) return;
    rateMutation.mutate({
      symbol: currentResult.symbol,
      rating,
      price: currentResult.price,
    });
  };

  const goNext = () => {
    if (currentIndex < scanResults.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const goPrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  useEffect(() => {
    if (!open) {
      setShowChartView(false);
      setScanResults([]);
      setCurrentIndex(0);
      setChartRatings({});
    }
  }, [open]);

  useEffect(() => {
    if (!showChartView) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        goNext();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        goPrev();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showChartView, currentIndex, scanResults.length]);

  if (showChartView && scanResults.length > 0) {
    return (
      <ValidationChartViewer
        idea={idea}
        results={scanResults}
        currentIndex={currentIndex}
        onIndexChange={setCurrentIndex}
        chartRatings={chartRatings}
        onRate={handleRate}
        ratingPending={rateMutation.isPending}
        onClose={() => {
          const up = Object.values(chartRatings).filter(r => r === "up").length;
          const down = Object.values(chartRatings).filter(r => r === "down").length;
          if (up + down > 0) {
            setLastSessionStats({ rated: up + down, up, down });
          }
          setShowChartView(false);
          onClose();
        }}
        onBack={() => {
          const up = Object.values(chartRatings).filter(r => r === "up").length;
          const down = Object.values(chartRatings).filter(r => r === "down").length;
          if (up + down > 0) {
            setLastSessionStats({ rated: up + down, up, down });
          }
          setShowChartView(false);
        }}
      />
    );
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-purple-500" />
            AI Training Mode: {idea.name}
          </DialogTitle>
          <DialogDescription>
            Run the idea as a scan and rate charts to validate its effectiveness
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Session completion message */}
          {lastSessionStats && (
            <div className="p-4 bg-green-950/30 border border-green-500/30 rounded-lg">
              <div className="flex items-center gap-3 mb-2">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                <span className="font-medium text-green-400">Validation session complete!</span>
              </div>
              <div className="text-sm text-gray-300">
                You rated {lastSessionStats.rated} charts: 
                <span className="text-green-400 ml-1">{lastSessionStats.up} good</span>
                {lastSessionStats.down > 0 && (
                  <span className="text-red-400 ml-1">/ {lastSessionStats.down} bad</span>
                )}
                {lastSessionStats.rated > 0 && (
                  <span className="text-gray-400 ml-2">
                    ({((lastSessionStats.up / lastSessionStats.rated) * 100).toFixed(0)}% hit rate this session)
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Overall stats */}
          {idea.validationStats && idea.validationStats.totalRated > 0 && (
            <div className="flex items-center gap-4 p-3 bg-slate-800 rounded-lg">
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-gray-400">Overall Hit Rate</span>
                  <span className="text-sm font-medium">
                    {idea.validationStats.hitRate.toFixed(0)}%
                  </span>
                </div>
                <Progress value={idea.validationStats.hitRate} className="h-2" />
              </div>
              <div className="text-right">
                <div className="text-sm">
                  <span className="text-green-400">{idea.validationStats.thumbsUp}</span>
                  {" / "}
                  <span className="text-red-400">{idea.validationStats.thumbsDown}</span>
                </div>
                <div className="text-xs text-gray-500">
                  {idea.validationStats.totalRated} total rated
                </div>
              </div>
            </div>
          )}

          {/* Run scan prompt */}
          {!lastSessionStats ? (
            <div className="text-center py-6">
              <Play className="h-12 w-12 mx-auto mb-4 text-purple-500 opacity-60" />
              <p className="text-lg text-gray-300">Run a scan to start validating</p>
              <p className="text-sm text-gray-500 mt-1">
                View charts and rate them with thumbs up/down
              </p>
            </div>
          ) : (
            <div className="text-center py-4 text-gray-400 text-sm">
              Run another scan on a different universe to continue validating
            </div>
          )}

          <div className="flex items-center gap-4">
            <div className="flex-1">
              <Label className="text-xs text-gray-500 mb-1 block">Universe</Label>
              <Select value={universe} onValueChange={setUniverse}>
                <SelectTrigger className="bg-slate-800 border-slate-700">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sp500">S&amp;P 500</SelectItem>
                  <SelectItem value="russell2000">Russell 2000</SelectItem>
                  <SelectItem value="russell3000">Russell 3000</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    onClick={runScan}
                    disabled={isScanning || idea.thoughts.length === 0}
                    className="bg-purple-600 hover:bg-purple-700 mt-5 disabled:opacity-50"
                  >
                    {isScanning ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Scanning...
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4 mr-2" />
                        Run Scan
                      </>
                    )}
                  </Button>
                </span>
              </TooltipTrigger>
              {idea.thoughts.length === 0 && (
                <TooltipContent>
                  <p>No scan criteria defined - use AI Refine to add thoughts/indicators</p>
                </TooltipContent>
              )}
            </Tooltip>
          </div>

          <div className="border border-slate-700 rounded-lg p-4">
            <Label className="text-xs text-gray-500 uppercase tracking-wide">
              Scan Criteria ({idea.thoughts.length} thoughts)
            </Label>
            {idea.thoughts.length === 0 ? (
              <div className="mt-3 text-center py-4 text-yellow-500">
                <AlertCircle className="h-6 w-6 mx-auto mb-2" />
                <p className="text-sm">No thoughts/indicators extracted for this idea.</p>
                <p className="text-xs text-gray-500 mt-1">Use "Refine with AI" to add scan criteria.</p>
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                {idea.thoughts.map((thought) => (
                  <div key={thought.id} className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-xs border-purple-500/50 text-purple-300">
                      {thought.name}
                    </Badge>
                    <ChevronRight className="h-3 w-3 text-gray-600" />
                    <div className="flex gap-1 flex-wrap">
                      {thought.indicators.length === 0 ? (
                        <span className="text-xs text-yellow-500">No indicators</span>
                      ) : (
                        thought.indicators.map((ind) => (
                          <Badge key={ind.id} className="bg-slate-700 text-xs">
                            {ind.name}
                          </Badge>
                        ))
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          {lastSessionStats && idea.validationStats && idea.validationStats.hitRate >= 70 && (
            <Button 
              className="bg-green-600 hover:bg-green-700"
              onClick={() => {
                onClose();
              }}
            >
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Done - Ready to Approve
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            {lastSessionStats ? "Close" : "Cancel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ValidationChartViewerProps {
  idea: ExtractedIdea;
  results: ScanResult[];
  currentIndex: number;
  onIndexChange: (idx: number) => void;
  chartRatings: Record<string, "up" | "down">;
  onRate: (rating: "up" | "down") => void;
  ratingPending: boolean;
  onClose: () => void;
  onBack: () => void;
}

function ValidationChartViewer({
  idea,
  results,
  currentIndex,
  onIndexChange,
  chartRatings,
  onRate,
  ratingPending,
  onClose,
  onBack,
}: ValidationChartViewerProps) {
  const current = results[currentIndex];
  const symbol = current?.symbol || "";
  const [intradayTimeframe, setIntradayTimeframe] = useState("15min");
  const [showETH, setShowETH] = useState(false);

  const { data: dailyData, isLoading: dailyLoading } = useQuery<ChartDataResponse>({
    queryKey: ["/api/sentinel/chart-data", symbol, "daily"],
    enabled: !!symbol,
    refetchOnMount: "always",
    refetchInterval: 5 * 60 * 1000,
    queryFn: async () => {
      const res = await fetch(`/api/sentinel/chart-data?ticker=${symbol}&timeframe=daily&_=${Date.now()}`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to fetch daily chart data");
      return res.json();
    },
  });

  const { data: intradayData, isLoading: intradayLoading } = useQuery<ChartDataResponse>({
    queryKey: ["/api/sentinel/chart-data", symbol, intradayTimeframe],
    enabled: !!symbol,
    refetchOnMount: "always",
    refetchInterval: 60 * 1000,
    queryFn: async () => {
      const res = await fetch(`/api/sentinel/chart-data?ticker=${symbol}&timeframe=${intradayTimeframe}&_=${Date.now()}`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to fetch intraday chart data");
      return res.json();
    },
  });

  const { data: chartMetrics } = useQuery<ChartMetrics>({
    queryKey: ["/api/stocks/chart-metrics", symbol],
    enabled: !!symbol,
    queryFn: async () => {
      const res = await fetch(`/api/stocks/chart-metrics?ticker=${symbol}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch metrics");
      return res.json();
    },
  });

  const ratedCount = Object.keys(chartRatings).length;
  const totalCount = results.length;
  const hitRate = ratedCount > 0
    ? (Object.values(chartRatings).filter(r => r === "up").length / ratedCount) * 100
    : 0;

  const navExtra = (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onIndexChange(Math.max(0, currentIndex - 1))}
        disabled={currentIndex === 0}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Badge variant="outline" className="text-xs">
        {currentIndex + 1} / {totalCount}
      </Badge>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onIndexChange(Math.min(totalCount - 1, currentIndex + 1))}
        disabled={currentIndex === totalCount - 1}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
      
      <div className="h-4 w-px bg-border mx-2" />
      
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onRate("down")}
            disabled={ratingPending}
            className={`px-3 border transition-all ${
              chartRatings[symbol] === "down"
                ? "border-red-500 bg-red-950/50 text-red-400"
                : "border-red-800/50 hover:border-red-600 hover:bg-red-950/30"
            }`}
          >
            <ThumbsDown className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Bad match - doesn't fit the setup</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onRate("up")}
            disabled={ratingPending}
            className={`px-3 border transition-all ${
              chartRatings[symbol] === "up"
                ? "border-green-500 bg-green-600 text-white"
                : "border-green-800/50 hover:border-green-600 hover:bg-green-950/30"
            }`}
          >
            <ThumbsUp className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Good match - fits the setup</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onIndexChange(Math.min(totalCount - 1, currentIndex + 1))}
            disabled={currentIndex === totalCount - 1}
          >
            <SkipForward className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Skip without rating</TooltipContent>
      </Tooltip>

      <div className="h-4 w-px bg-border mx-2" />
      
      <div className="flex items-center gap-2 text-xs">
        <span className="text-green-400">{Object.values(chartRatings).filter(r => r === "up").length}</span>
        <span className="text-muted-foreground">/</span>
        <span className="text-red-400">{Object.values(chartRatings).filter(r => r === "down").length}</span>
        {ratedCount > 0 && (
          <Badge className={`ml-1 ${hitRate >= 70 ? "bg-green-600" : hitRate >= 50 ? "bg-yellow-600" : "bg-red-600"}`}>
            {hitRate.toFixed(0)}%
          </Badge>
        )}
      </div>
    </div>
  );

  const upperPane = (
    <div className="flex items-center gap-2">
      <Badge variant="outline" className="border-purple-500/50 text-purple-300 text-xs">
        AI Training: {idea.name}
      </Badge>
    </div>
  );

  return createPortal(
    <TooltipProvider>
      <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center">
        {/* Training Mode Banner */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
          <div className="bg-purple-950/95 border border-purple-500/50 rounded-lg px-6 py-3 shadow-2xl animate-in slide-in-from-top-2 duration-300">
            <div className="flex items-center gap-3">
              <Sparkles className="h-5 w-5 text-purple-400" />
              <div>
                <span className="text-purple-200 font-medium">AI Training Mode</span>
                <span className="text-purple-400 ml-2 text-sm">• {idea.name}</span>
              </div>
              <Badge variant="outline" className="text-[10px] border-purple-500/50 text-purple-300">ADMIN</Badge>
            </div>
          </div>
        </div>

        <div className="relative z-10 w-[95vw] max-w-[95vw] h-[90vh] bg-background border rounded-md shadow-lg flex flex-col p-4">
          {/* Close/Back buttons */}
          <div className="absolute top-2 right-2 z-50 flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onBack}>
              <ChevronLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-5 w-5" />
            </Button>
          </div>

          {/* Chart Grid - matches ScanChartViewer structure exactly */}
          <div className="relative flex-1 min-h-0 flex flex-col">
            <DualChartGrid
              symbol={symbol}
              dailyData={dailyData}
              dailyLoading={dailyLoading}
              intradayData={intradayData}
              intradayLoading={intradayLoading}
              chartMetrics={chartMetrics ?? null}
              intradayTimeframe={intradayTimeframe}
              onIntradayTimeframeChange={setIntradayTimeframe}
              showETH={showETH}
              onShowETHChange={setShowETH}
              upperPane={upperPane}
              navExtra={navExtra}
              testIdPrefix="validation"
            />
          </div>
        </div>
      </div>
    </TooltipProvider>,
    document.body
  );
}
