import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSentinelAuth } from "@/context/SentinelAuthContext";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, AlertTriangle, TrendingUp, TrendingDown, Minus, Loader2, DollarSign, Hash, Info, CheckCircle2, XCircle, Clock, Eye, ListPlus, ThumbsDown, Zap, Target, Shield, Lightbulb, ArrowUpCircle, AlertOctagon, X } from "lucide-react";
import { SentinelHeader } from "@/components/SentinelHeader";

interface SectorTrend {
  sector: string;
  etf: string;
  state: 1 | 0 | -1;
  stateName: "Tailwind" | "Neutral" | "Headwind";
  confidence: "strong" | "moderate" | "weak";
  price: number;
  ma50: number;
  ma200: number;
}

interface RiskFlagDetail {
  flag: string;
  severity: 'high' | 'medium' | 'low';
  tier?: 'fatal' | 'contextual' | 'missing_input';
  detail: string;
}

interface RuleCheckItem {
  rule: string;
  status: 'followed' | 'violated' | 'na';
  note?: string;
}

interface PlanSummary {
  entry: string;
  stop: string;
  riskPerShare: string;
  firstTrim?: string | null;
  target: string | null;
  rrRatio: string | null;
}

interface VerdictSummary {
  verdict: string;
  primaryBlockers: string[];
}

interface MoneyBreakdown {
  totalRisk: string;
  firstTrimProfit: string | null;
  targetProfit: string | null;
  totalPotentialProfit: string;
}

interface ProcessAnalysis {
  entryExecution: string;
  stopManagement: string;
  targetManagement: string;
  emotionalControl: string;
  rulesFollowed: number;
  rulesViolated: number;
}

interface EvaluationResult {
  tradeId: number;
  evaluation: {
    // Core decision gate
    score: number;
    status: 'GREEN' | 'YELLOW' | 'RED';
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
    modelTag: 'BREAKOUT' | 'RECLAIM' | 'CUP_AND_HANDLE' | 'PULLBACK' | 'EPISODIC_PIVOT' | 'UNKNOWN';
    instrumentType?: 'ETF' | 'STOCK' | 'INDEX';
    
    // Verdict summary - primary blockers at top
    verdictSummary?: VerdictSummary;
    
    // Money breakdown - real dollars
    moneyBreakdown?: MoneyBreakdown;
    
    // User's plan summary
    planSummary?: PlanSummary;
    
    // Structured feedback
    whyBullets?: string[];
    riskFlags: RiskFlagDetail[] | string[];
    improvements?: string[];
    fixesToPass?: string[];
    ruleChecklist?: RuleCheckItem[];
    
    // Process analysis for historical trades
    processAnalysis?: ProcessAnalysis;
    
    // Legacy fields
    recommendation: string;
    reasoning: string;
    model: string;
    promptVersion: string;
  };
}

interface TickerInfo {
  symbol: string;
  name: string;
  currentPrice: number;
  previousClose: number;
  sector: string;
  industry: string;
  description: string;
}

const STOP_PRICE_CHOICES = [
  { value: "LOD_TODAY", label: "LOD Today" },
  { value: "LOD_YESTERDAY", label: "LOD Yesterday" },
  { value: "LOD_WEEKLY", label: "LOD Weekly" },
  { value: "5_DMA", label: "5 DMA" },
  { value: "10_DMA", label: "10 DMA" },
  { value: "21_DMA", label: "21 DMA" },
  { value: "50_DMA", label: "50 DMA" },
  { value: "6_20_DOWN_CROSS", label: "6/20 (5 min) Down Cross" },
  { value: "MACD_DOWN_CROSS", label: "MACD Cross Down" },
];

const TARGET_PRICE_CHOICES = [
  { value: "PREV_DAY_HIGH", label: "Previous Day High" },
  { value: "5_DAY_HIGH", label: "Past 5 Day High" },
  { value: "RR_1_5X", label: "1.5x Risk/Reward" },
  { value: "RR_2X", label: "2x Risk/Reward" },
  { value: "RR_3X", label: "3x Risk/Reward" },
];

const TARGET_PROFIT_CHOICES = [
  { value: "EXTENDED_8X_50DMA", label: "Extended 8% over 50 DMA" },
  { value: "PREV_DAY_HIGH", label: "Previous Day High" },
  { value: "5_DAY_HIGH", label: "Past 5 Day High" },
  { value: "RR_5X", label: "5x Risk/Reward" },
  { value: "RR_8X", label: "8x Risk/Reward" },
  { value: "RR_10X", label: "10x Risk/Reward" },
];

export default function SentinelEvaluatePage() {
  const [, setLocation] = useLocation();
  const { user } = useSentinelAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Get tradeId from URL query params for pre-loading trade data
  const urlParams = new URLSearchParams(window.location.search);
  const preloadTradeId = urlParams.get('tradeId');

  const [symbol, setSymbol] = useState("");
  const [debouncedSymbol, setDebouncedSymbol] = useState("");
  const [direction, setDirection] = useState<"long" | "short">("long");
  const [entryPrice, setEntryPrice] = useState("");
  
  // Stop price
  const [stopPriceMode, setStopPriceMode] = useState<"amount" | "choice">("amount");
  const [stopPrice, setStopPrice] = useState("");
  const [stopPriceChoice, setStopPriceChoice] = useState("");
  
  // Target price
  const [targetPriceMode, setTargetPriceMode] = useState<"amount" | "choice">("amount");
  const [targetPrice, setTargetPrice] = useState("");
  const [targetPriceChoice, setTargetPriceChoice] = useState("");
  
  // Target profit (full exit target)
  const [targetProfitMode, setTargetProfitMode] = useState<"amount" | "choice">("amount");
  const [targetProfitPrice, setTargetProfitPrice] = useState("");
  const [targetProfitChoice, setTargetProfitChoice] = useState("");
  
  // Position size
  const [positionSizeUnit, setPositionSizeUnit] = useState<"shares" | "dollars">("shares");
  const [positionSize, setPositionSize] = useState("");
  
  const [thesis, setThesis] = useState("");
  const [deepEval, setDeepEval] = useState(false);
  const [historicalAnalysis, setHistoricalAnalysis] = useState(false);
  const [tradeDate, setTradeDate] = useState("");
  const [tradeTime, setTradeTime] = useState("");
  const [selectedLabelIds, setSelectedLabelIds] = useState<number[]>([]);
  const [historicalTags, setHistoricalTags] = useState<string[]>(["Historical"]);
  const [newTagInput, setNewTagInput] = useState("");
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);

  const [result, setResult] = useState<EvaluationResult | null>(null);
  const [isPreloaded, setIsPreloaded] = useState(false);

  // Fetch available labels
  const labelsQuery = useQuery<{id: number; name: string; color: string; isAdminOnly: boolean}[]>({
    queryKey: ["/api/sentinel/labels"],
  });

  // Fetch user info for admin status
  const userInfoQuery = useQuery<{id: number; username: string; isAdmin: boolean}>({
    queryKey: ["/api/sentinel/me"],
  });

  // Fetch trade data if tradeId is in URL
  const preloadTradeQuery = useQuery({
    queryKey: ["/api/sentinel/trade", preloadTradeId],
    enabled: !!preloadTradeId && !isPreloaded,
  });

  // Pre-fill form when trade data loads
  useEffect(() => {
    if (preloadTradeQuery.data && !isPreloaded) {
      const trade = (preloadTradeQuery.data as any).trade;
      if (trade) {
        setSymbol(trade.symbol);
        setDebouncedSymbol(trade.symbol);
        setDirection(trade.direction);
        setEntryPrice(trade.entryPrice.toString());
        if (trade.stopPrice) {
          setStopPriceMode("amount");
          setStopPrice(trade.stopPrice.toString());
        }
        if (trade.targetPrice) {
          setTargetPriceMode("amount");
          setTargetPrice(trade.targetPrice.toString());
        }
        if (trade.positionSize) {
          setPositionSize(trade.positionSize.toString());
        }
        if (trade.thesis) {
          setThesis(trade.thesis);
        }
        setIsPreloaded(true);
        toast({ title: "Trade Loaded", description: `Loaded ${trade.symbol} trade for review` });
      }
    }
  }, [preloadTradeQuery.data, isPreloaded, toast]);

  // Debounce symbol for ticker lookup
  useEffect(() => {
    const timer = setTimeout(() => {
      if (symbol.length >= 1) {
        setDebouncedSymbol(symbol.toUpperCase());
      } else {
        setDebouncedSymbol("");
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [symbol]);

  // Async ticker lookup
  const tickerQuery = useQuery<TickerInfo>({
    queryKey: ["/api/sentinel/ticker", debouncedSymbol],
    queryFn: async () => {
      const res = await fetch(`/api/sentinel/ticker/${debouncedSymbol}`);
      if (!res.ok) throw new Error("Ticker not found");
      return res.json();
    },
    enabled: debouncedSymbol.length >= 1,
    staleTime: 60000,
    retry: false,
  });

  // Sector sentiment query - fetches live when ticker is entered
  const sectorQuery = useQuery<SectorTrend>({
    queryKey: ["/api/sentinel/sentiment/sector", debouncedSymbol],
    enabled: debouncedSymbol.length >= 1 && !!tickerQuery.data,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  // Auto-fill entry price when ticker loads
  useEffect(() => {
    if (tickerQuery.data?.currentPrice && !entryPrice) {
      setEntryPrice(tickerQuery.data.currentPrice.toFixed(2));
    }
  }, [tickerQuery.data?.currentPrice]);

  const evaluateMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/sentinel/evaluate", data);
      return await res.json();
    },
    onSuccess: (data) => {
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/dashboard"] });
    },
    onError: (error: any) => {
      toast({
        title: "Evaluation Failed",
        description: error.message || "Failed to evaluate trade",
        variant: "destructive",
      });
    },
  });

  const commitMutation = useMutation({
    mutationFn: async ({ tradeId, labelIds }: { tradeId: number; labelIds: number[] }) => {
      const res = await apiRequest("POST", `/api/sentinel/commit/${tradeId}`);
      // Save labels if any are selected
      if (labelIds.length > 0) {
        await apiRequest("POST", `/api/sentinel/trades/${tradeId}/labels`, { labelIds });
      }
      return await res.json();
    },
    onSuccess: () => {
      toast({ title: "Trade Committed", description: "Trade is now active" });
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/dashboard"] });
      setLocation("/sentinel/dashboard");
    },
    onError: (error: any) => {
      toast({
        title: "Commit Failed",
        description: error.message || "Failed to commit trade",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setResult(null);

    const data: any = {
      symbol: symbol.toUpperCase(),
      direction,
      entryPrice: parseFloat(entryPrice),
      deepEval,
      historicalAnalysis,
    };

    // Stop price - either amount or choice
    if (stopPriceMode === "amount" && stopPrice) {
      data.stopPrice = parseFloat(stopPrice);
    } else if (stopPriceMode === "choice" && stopPriceChoice) {
      data.stopPriceLevel = stopPriceChoice;
    }

    // First profit trim - either amount or choice
    if (targetPriceMode === "amount" && targetPrice) {
      data.targetPrice = parseFloat(targetPrice);
    } else if (targetPriceMode === "choice" && targetPriceChoice) {
      data.targetPriceLevel = targetPriceChoice;
    }
    
    // Target profit (full exit) - either amount or choice
    if (targetProfitMode === "amount" && targetProfitPrice) {
      data.targetProfitPrice = parseFloat(targetProfitPrice);
    } else if (targetProfitMode === "choice" && targetProfitChoice) {
      data.targetProfitLevel = targetProfitChoice;
    }

    // Position size with unit
    if (positionSize) {
      data.positionSize = parseFloat(positionSize);
      data.positionSizeUnit = positionSizeUnit;
    }
    if (thesis) data.thesis = thesis;

    // Add historical date/time if in historical mode
    if (historicalAnalysis) {
      if (tradeDate) data.tradeDate = tradeDate;
      if (tradeTime) data.tradeTime = tradeTime;
    }

    evaluateMutation.mutate(data);
  };

  const handleCommit = async () => {
    if (result?.tradeId) {
      try {
        const allLabelIds = [...selectedLabelIds];
        let createdNewLabels = false;
        
        for (const tag of historicalTags) {
          const existingLabel = labelsQuery.data?.find(l => l.name.toLowerCase() === tag.toLowerCase());
          if (existingLabel) {
            if (!allLabelIds.includes(existingLabel.id)) {
              allLabelIds.push(existingLabel.id);
            }
          } else {
            const randomColor = `#${Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0')}`;
            const newLabelRes = await apiRequest("POST", "/api/sentinel/labels", { 
              name: tag, 
              color: randomColor,
              description: "Auto-created from historical tag"
            });
            const newLabel = await newLabelRes.json();
            allLabelIds.push(newLabel.id);
            createdNewLabels = true;
          }
        }
        
        if (createdNewLabels) {
          queryClient.invalidateQueries({ queryKey: ["/api/sentinel/labels"] });
        }
        
        commitMutation.mutate({ tradeId: result.tradeId, labelIds: allLabelIds });
      } catch (error) {
        toast({
          title: "Error processing tags",
          description: "Failed to create some tags. Trade committed without them.",
          variant: "destructive"
        });
        commitMutation.mutate({ tradeId: result.tradeId, labelIds: selectedLabelIds });
      }
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 70) return "text-green-500";
    if (score >= 50) return "text-yellow-500";
    return "text-red-500";
  };

  const getSectorTrendColor = (state: 1 | 0 | -1) => {
    if (state === 1) return "bg-green-500/20 text-green-400 border-green-500/30";
    if (state === -1) return "bg-red-500/20 text-red-400 border-red-500/30";
    return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
  };

  const SectorTrendIcon = ({ state }: { state: 1 | 0 | -1 }) => {
    if (state === 1) return <TrendingUp className="h-3 w-3" />;
    if (state === -1) return <TrendingDown className="h-3 w-3" />;
    return <Minus className="h-3 w-3" />;
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => setLocation("/sentinel/dashboard")} data-testid="button-back">
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <SentinelHeader showSentiment={true} />
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        {/* Ivy AI Branding */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-primary" data-testid="ivy-ai-title">Ivy AI</h1>
          <p className="text-lg text-muted-foreground" data-testid="ivy-ai-subtitle">Advanced Trading Insights</p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Trade Details</CardTitle>
              <CardDescription>Enter your trade parameters for evaluation</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="symbol">Symbol</Label>
                    <Input
                      id="symbol"
                      data-testid="input-symbol"
                      value={symbol}
                      onChange={(e) => setSymbol(e.target.value)}
                      placeholder="AAPL"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="direction">Direction</Label>
                    <Select value={direction} onValueChange={(v) => setDirection(v as "long" | "short")}>
                      <SelectTrigger data-testid="select-direction">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="long">Long</SelectItem>
                        <SelectItem value="short">Short</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Ticker Info Display */}
                {debouncedSymbol && (
                  <div className="p-3 bg-muted/50 rounded-md border">
                    {tickerQuery.isLoading ? (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-sm">Loading ticker info...</span>
                      </div>
                    ) : tickerQuery.isError ? (
                      <div className="text-sm text-destructive">
                        Symbol not found
                      </div>
                    ) : tickerQuery.data ? (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-lg" data-testid="text-ticker-name">{tickerQuery.data.name}</span>
                            <Badge variant="outline" className="text-xs" data-testid="badge-ticker-symbol">{tickerQuery.data.symbol}</Badge>
                          </div>
                          <span className="text-xl font-bold text-primary" data-testid="text-current-price">
                            ${tickerQuery.data.currentPrice?.toFixed(2)}
                          </span>
                        </div>
                        <div className="flex gap-2 flex-wrap items-center">
                          <Badge variant="secondary" className="text-xs" data-testid="badge-sector">{tickerQuery.data.sector}</Badge>
                          <Badge variant="secondary" className="text-xs" data-testid="badge-industry">{tickerQuery.data.industry}</Badge>
                          
                          {sectorQuery.isLoading && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              Sector trend...
                            </span>
                          )}
                          {sectorQuery.data && (
                            <Badge 
                              variant="outline" 
                              className={`text-xs ${getSectorTrendColor(sectorQuery.data.state)}`}
                              data-testid="badge-sector-trend"
                            >
                              <SectorTrendIcon state={sectorQuery.data.state} />
                              <span className="ml-1">{sectorQuery.data.etf} {sectorQuery.data.stateName}</span>
                            </Badge>
                          )}
                        </div>
                        {tickerQuery.data.description && (
                          <p className="text-xs text-muted-foreground leading-relaxed" data-testid="text-description">
                            {tickerQuery.data.description}
                          </p>
                        )}
                      </div>
                    ) : null}
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="entryPrice">Entry Price</Label>
                  <Input
                    id="entryPrice"
                    type="number"
                    step="0.01"
                    data-testid="input-entry-price"
                    value={entryPrice}
                    onChange={(e) => setEntryPrice(e.target.value)}
                    placeholder="150.00"
                    required
                  />
                </div>

                {/* Stop Price with mode toggle */}
                <div className="space-y-3 p-3 bg-muted/30 rounded-md border">
                  <div className="flex items-center justify-between">
                    <Label className="font-medium">Stop Price</Label>
                    <RadioGroup
                      value={stopPriceMode}
                      onValueChange={(v) => setStopPriceMode(v as "amount" | "choice")}
                      className="flex gap-4"
                    >
                      <div className="flex items-center space-x-1">
                        <RadioGroupItem value="amount" id="stop-amount" />
                        <Label htmlFor="stop-amount" className="text-xs cursor-pointer">Amount</Label>
                      </div>
                      <div className="flex items-center space-x-1">
                        <RadioGroupItem value="choice" id="stop-choice" />
                        <Label htmlFor="stop-choice" className="text-xs cursor-pointer">Level</Label>
                      </div>
                    </RadioGroup>
                  </div>
                  {stopPriceMode === "amount" ? (
                    <Input
                      type="number"
                      step="0.01"
                      data-testid="input-stop-price"
                      value={stopPrice}
                      onChange={(e) => setStopPrice(e.target.value)}
                      placeholder="145.00"
                    />
                  ) : (
                    <Select value={stopPriceChoice} onValueChange={setStopPriceChoice}>
                      <SelectTrigger data-testid="select-stop-level">
                        <SelectValue placeholder="Select stop level..." />
                      </SelectTrigger>
                      <SelectContent>
                        {STOP_PRICE_CHOICES.map((choice) => (
                          <SelectItem key={choice.value} value={choice.value}>
                            {choice.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                {/* Target Price with mode toggle */}
                <div className="space-y-3 p-3 bg-muted/30 rounded-md border">
                  <div className="flex items-center justify-between">
                    <Label className="font-medium">First Profit Trim</Label>
                    <RadioGroup
                      value={targetPriceMode}
                      onValueChange={(v) => setTargetPriceMode(v as "amount" | "choice")}
                      className="flex gap-4"
                    >
                      <div className="flex items-center space-x-1">
                        <RadioGroupItem value="amount" id="target-amount" />
                        <Label htmlFor="target-amount" className="text-xs cursor-pointer">Amount</Label>
                      </div>
                      <div className="flex items-center space-x-1">
                        <RadioGroupItem value="choice" id="target-choice" />
                        <Label htmlFor="target-choice" className="text-xs cursor-pointer">Level</Label>
                      </div>
                    </RadioGroup>
                  </div>
                  {targetPriceMode === "amount" ? (
                    <Input
                      type="number"
                      step="0.01"
                      data-testid="input-target-price"
                      value={targetPrice}
                      onChange={(e) => setTargetPrice(e.target.value)}
                      placeholder="165.00"
                    />
                  ) : (
                    <Select value={targetPriceChoice} onValueChange={setTargetPriceChoice}>
                      <SelectTrigger data-testid="select-target-level">
                        <SelectValue placeholder="Select target level..." />
                      </SelectTrigger>
                      <SelectContent>
                        {TARGET_PRICE_CHOICES.map((choice) => (
                          <SelectItem key={choice.value} value={choice.value}>
                            {choice.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                {/* Target Profit - Full position exit target */}
                <div className="space-y-3 p-3 bg-muted/30 rounded-md border">
                  <div className="flex items-center justify-between">
                    <Label className="font-medium">Target Profit</Label>
                    <RadioGroup
                      value={targetProfitMode}
                      onValueChange={(v) => setTargetProfitMode(v as "amount" | "choice")}
                      className="flex gap-4"
                    >
                      <div className="flex items-center space-x-1">
                        <RadioGroupItem value="amount" id="profit-amount" />
                        <Label htmlFor="profit-amount" className="text-xs cursor-pointer">Amount</Label>
                      </div>
                      <div className="flex items-center space-x-1">
                        <RadioGroupItem value="choice" id="profit-choice" />
                        <Label htmlFor="profit-choice" className="text-xs cursor-pointer">Level</Label>
                      </div>
                    </RadioGroup>
                  </div>
                  <p className="text-xs text-muted-foreground">Full exit target (5x-8x R:R ideal)</p>
                  {targetProfitMode === "amount" ? (
                    <Input
                      type="number"
                      step="0.01"
                      data-testid="input-target-profit"
                      value={targetProfitPrice}
                      onChange={(e) => setTargetProfitPrice(e.target.value)}
                      placeholder="180.00"
                    />
                  ) : (
                    <Select value={targetProfitChoice} onValueChange={setTargetProfitChoice}>
                      <SelectTrigger data-testid="select-target-profit-level">
                        <SelectValue placeholder="Select target profit level..." />
                      </SelectTrigger>
                      <SelectContent>
                        {TARGET_PROFIT_CHOICES.map((choice) => (
                          <SelectItem key={choice.value} value={choice.value}>
                            {choice.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                {/* Position Size with unit toggle */}
                <div className="space-y-3 p-3 bg-muted/30 rounded-md border">
                  <div className="flex items-center justify-between">
                    <Label className="font-medium">Position Size</Label>
                    <div className="flex items-center gap-1 bg-muted rounded-md p-0.5">
                      <Button
                        type="button"
                        size="sm"
                        variant={positionSizeUnit === "shares" ? "default" : "ghost"}
                        className="h-7 px-2 gap-1"
                        onClick={() => setPositionSizeUnit("shares")}
                        data-testid="button-unit-shares"
                      >
                        <Hash className="w-3 h-3" />
                        <span className="text-xs">Shares</span>
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={positionSizeUnit === "dollars" ? "default" : "ghost"}
                        className="h-7 px-2 gap-1"
                        onClick={() => setPositionSizeUnit("dollars")}
                        data-testid="button-unit-dollars"
                      >
                        <DollarSign className="w-3 h-3" />
                        <span className="text-xs">Dollars</span>
                      </Button>
                    </div>
                  </div>
                  <Input
                    type="number"
                    step={positionSizeUnit === "shares" ? "1" : "0.01"}
                    data-testid="input-position-size"
                    value={positionSize}
                    onChange={(e) => setPositionSize(e.target.value)}
                    placeholder={positionSizeUnit === "shares" ? "100" : "10000"}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="thesis">Trade Thesis (optional)</Label>
                  <Textarea
                    id="thesis"
                    data-testid="input-thesis"
                    value={thesis}
                    onChange={(e) => setThesis(e.target.value)}
                    placeholder="Describe your reasoning for this trade..."
                    rows={3}
                  />
                </div>

                {/* Labels Selection */}
                {labelsQuery.data && labelsQuery.data.length > 0 && (
                  <div className="space-y-2">
                    <Label>Labels (optional)</Label>
                    <div className="flex flex-wrap gap-2" data-testid="label-selection">
                      {labelsQuery.data.map((label) => (
                        <button
                          key={label.id}
                          type="button"
                          onClick={() => {
                            setSelectedLabelIds(prev =>
                              prev.includes(label.id)
                                ? prev.filter(id => id !== label.id)
                                : [...prev, label.id]
                            );
                          }}
                          className={`px-3 py-1 text-sm rounded-full border transition-colors ${
                            selectedLabelIds.includes(label.id)
                              ? "border-transparent text-white"
                              : "border-border hover-elevate"
                          }`}
                          style={{
                            backgroundColor: selectedLabelIds.includes(label.id) ? label.color : "transparent",
                          }}
                          data-testid={`label-toggle-${label.id}`}
                        >
                          {label.name}
                          {label.isAdminOnly && (
                            <span className="ml-1 text-xs opacity-70">(admin)</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <div className="flex items-center justify-between p-3 bg-muted rounded-md">
                    <div>
                      <Label htmlFor="deepEval" className="font-medium">Deep Evaluation</Label>
                      <p className="text-xs text-muted-foreground">Use advanced AI model (gpt-5.2)</p>
                    </div>
                    <Switch
                      id="deepEval"
                      checked={deepEval}
                      onCheckedChange={setDeepEval}
                      data-testid="switch-deep-eval"
                    />
                  </div>
                  
                  <div className="space-y-3">
                    <div className="flex items-center justify-between p-3 bg-muted rounded-md">
                      <div>
                        <Label htmlFor="historicalAnalysis" className="font-medium">Historical Analysis</Label>
                        <p className="text-xs text-muted-foreground">Review a past trade for process quality</p>
                      </div>
                      <Switch
                        id="historicalAnalysis"
                        checked={historicalAnalysis}
                        onCheckedChange={setHistoricalAnalysis}
                        data-testid="switch-historical-analysis"
                      />
                    </div>
                    
                    {historicalAnalysis && (
                      <div className="p-3 bg-muted/50 rounded-md border space-y-3">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Clock className="w-4 h-4" />
                          <span>When did you take this trade?</span>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label htmlFor="tradeDate" className="text-xs">Date</Label>
                            <Input
                              id="tradeDate"
                              type="date"
                              value={tradeDate}
                              onChange={(e) => setTradeDate(e.target.value)}
                              max={new Date().toISOString().split('T')[0]}
                              data-testid="input-trade-date"
                              required={historicalAnalysis}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor="tradeTime" className="text-xs">Time (Market Hours)</Label>
                            <Input
                              id="tradeTime"
                              type="time"
                              value={tradeTime}
                              onChange={(e) => setTradeTime(e.target.value)}
                              data-testid="input-trade-time"
                            />
                          </div>
                        </div>
                        
                        {/* Historical Tags */}
                        <div className="space-y-2">
                          <Label className="text-xs">Tags</Label>
                          <div className="flex flex-wrap gap-1 mb-2">
                            {historicalTags.map((tag, idx) => (
                              <Badge 
                                key={idx} 
                                variant="secondary" 
                                className="text-xs cursor-pointer"
                                onClick={() => setHistoricalTags(historicalTags.filter((_, i) => i !== idx))}
                                data-testid={`badge-historical-tag-${idx}`}
                              >
                                {tag}
                                <X className="w-3 h-3 ml-1" />
                              </Badge>
                            ))}
                          </div>
                          <div className="relative">
                            <Input
                              placeholder="Add tag (e.g., Earnings Play, Gap Up)..."
                              value={newTagInput}
                              onChange={(e) => {
                                setNewTagInput(e.target.value);
                                setShowTagSuggestions(e.target.value.length > 0);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && newTagInput.trim()) {
                                  e.preventDefault();
                                  if (!historicalTags.includes(newTagInput.trim())) {
                                    setHistoricalTags([...historicalTags, newTagInput.trim()]);
                                  }
                                  setNewTagInput("");
                                  setShowTagSuggestions(false);
                                }
                              }}
                              onBlur={() => setTimeout(() => setShowTagSuggestions(false), 200)}
                              onFocus={() => setShowTagSuggestions(newTagInput.length > 0)}
                              data-testid="input-historical-tag"
                              className="text-sm"
                            />
                            {showTagSuggestions && labelsQuery.data && (
                              <div className="absolute z-10 w-full mt-1 bg-popover border rounded-md shadow-lg max-h-32 overflow-auto">
                                {labelsQuery.data
                                  .filter(label => 
                                    label.name.toLowerCase().includes(newTagInput.toLowerCase()) &&
                                    !historicalTags.includes(label.name)
                                  )
                                  .slice(0, 5)
                                  .map(label => (
                                    <div
                                      key={label.id}
                                      className="px-3 py-1.5 text-sm cursor-pointer hover:bg-muted"
                                      onClick={() => {
                                        setHistoricalTags([...historicalTags, label.name]);
                                        setNewTagInput("");
                                        setShowTagSuggestions(false);
                                      }}
                                      data-testid={`suggestion-tag-${label.id}`}
                                    >
                                      <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ backgroundColor: label.color }} />
                                      {label.name}
                                    </div>
                                  ))
                                }
                                {newTagInput.trim() && !labelsQuery.data.some(l => l.name.toLowerCase() === newTagInput.toLowerCase()) && (
                                  <div
                                    className="px-3 py-1.5 text-sm cursor-pointer hover:bg-muted text-muted-foreground"
                                    onClick={() => {
                                      setHistoricalTags([...historicalTags, newTagInput.trim()]);
                                      setNewTagInput("");
                                      setShowTagSuggestions(false);
                                    }}
                                  >
                                    Create "{newTagInput.trim()}"
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                        
                        <p className="text-xs text-muted-foreground">
                          Market data and sentiment will be pulled from this date/time for accurate analysis.
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={evaluateMutation.isPending}
                  data-testid="button-evaluate"
                >
                  {evaluateMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Evaluating...
                    </>
                  ) : (
                    <>
                      <TrendingUp className="w-4 h-4 mr-2" />
                      Ask Ivy
                    </>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>

          <div className="space-y-4">
            {result ? (
              <>
                {/* Header Section */}
                <Card className={`border-l-4 ${
                  result.evaluation.status === 'GREEN' ? 'border-l-green-500' :
                  result.evaluation.status === 'RED' ? 'border-l-red-500' : 'border-l-yellow-500'
                }`}>
                  <CardContent className="pt-4">
                    {/* Ticker / Direction / Model Tag Header */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xl font-bold" data-testid="text-symbol-result">{symbol.toUpperCase()}</span>
                        <Badge variant={direction === "long" ? "default" : "destructive"} data-testid="badge-direction">
                          {direction.toUpperCase()}
                        </Badge>
                        {result.evaluation.modelTag && result.evaluation.modelTag !== 'UNKNOWN' && (
                          <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/30" data-testid="badge-model-tag">
                            {result.evaluation.modelTag.replace('_', ' ')}
                          </Badge>
                        )}
                      </div>
                      <Badge variant="outline" className="text-xs" data-testid="badge-model">
                        {result.evaluation.model}
                      </Badge>
                    </div>
                    
                    {/* Verdict Summary - Primary blockers at top */}
                    {result.evaluation.verdictSummary && (
                      <div className={`p-3 rounded-md mb-3 ${
                        result.evaluation.status === 'GREEN' ? 'bg-green-500/10 border border-green-500/30' :
                        result.evaluation.status === 'RED' ? 'bg-red-500/10 border border-red-500/30' : 'bg-yellow-500/10 border border-yellow-500/30'
                      }`} data-testid="verdict-summary">
                        <p className="text-sm font-medium mb-1">Verdict:</p>
                        <p className="text-sm">{result.evaluation.verdictSummary.verdict}</p>
                        {result.evaluation.verdictSummary.primaryBlockers && result.evaluation.verdictSummary.primaryBlockers.length > 0 && (
                          <div className="mt-2">
                            <p className="text-xs font-medium text-red-400">Primary Blockers ({result.evaluation.verdictSummary.primaryBlockers.length}):</p>
                            <ul className="text-xs text-red-300 mt-1">
                              {result.evaluation.verdictSummary.primaryBlockers.map((blocker, i) => (
                                <li key={i}>• {blocker}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Money Breakdown - Real Dollars */}
                    {result.evaluation.moneyBreakdown && (
                      <div className="p-3 rounded-md mb-3 bg-blue-500/10 border border-blue-500/30" data-testid="money-breakdown">
                        <p className="text-sm font-medium mb-2 flex items-center gap-2">
                          <DollarSign className="w-4 h-4 text-blue-400" />
                          Your Risk/Reward Breakdown
                        </p>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div>
                            <span className="text-muted-foreground">Risking:</span>
                            <span className="font-bold text-red-400 ml-2">{result.evaluation.moneyBreakdown.totalRisk}</span>
                          </div>
                          {result.evaluation.moneyBreakdown.firstTrimProfit && (
                            <div>
                              <span className="text-muted-foreground">First Profit (30% trim):</span>
                              <span className="font-bold text-green-400 ml-2">+{result.evaluation.moneyBreakdown.firstTrimProfit}</span>
                            </div>
                          )}
                          {result.evaluation.moneyBreakdown.targetProfit && (
                            <div>
                              <span className="text-muted-foreground">Target (70%):</span>
                              <span className="font-bold text-green-400 ml-2">+{result.evaluation.moneyBreakdown.targetProfit}</span>
                            </div>
                          )}
                          <div className="col-span-2 pt-1 border-t border-blue-500/30">
                            <span className="text-muted-foreground">TOTAL if all hits:</span>
                            <span className="font-bold text-green-500 ml-2">+{result.evaluation.moneyBreakdown.totalPotentialProfit}</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Plan Summary */}
                    {result.evaluation.planSummary && (
                      <div className="text-sm text-muted-foreground mb-3 p-2 bg-muted/30 rounded" data-testid="plan-summary">
                        <span className="font-medium">Your Plan:</span>{' '}
                        Entry {result.evaluation.planSummary.entry} | Stop {result.evaluation.planSummary.stop} | Risk/share {result.evaluation.planSummary.riskPerShare}
                        {result.evaluation.planSummary.firstTrim && ` | First Trim ${result.evaluation.planSummary.firstTrim}`}
                        {result.evaluation.planSummary.target && ` | Target ${result.evaluation.planSummary.target}`}
                        {result.evaluation.planSummary.rrRatio && ` | R:R ${result.evaluation.planSummary.rrRatio}`}
                      </div>
                    )}

                    {/* Decision Gate */}
                    <div className={`p-4 rounded-md ${
                      result.evaluation.status === 'GREEN' ? 'bg-green-500/10 border border-green-500/30' :
                      result.evaluation.status === 'RED' ? 'bg-red-500/10 border border-red-500/30' : 'bg-yellow-500/10 border border-yellow-500/30'
                    }`} data-testid="decision-gate">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {result.evaluation.status === 'GREEN' ? (
                            <CheckCircle2 className="w-8 h-8 text-green-500" />
                          ) : result.evaluation.status === 'RED' ? (
                            <XCircle className="w-8 h-8 text-red-500" />
                          ) : (
                            <AlertTriangle className="w-8 h-8 text-yellow-500" />
                          )}
                          <div>
                            <p className={`text-lg font-bold ${
                              result.evaluation.status === 'GREEN' ? 'text-green-500' :
                              result.evaluation.status === 'RED' ? 'text-red-500' : 'text-yellow-500'
                            }`} data-testid="text-status">
                              {result.evaluation.status}
                            </p>
                            <p className="text-sm text-muted-foreground">Decision Gate</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className={`text-3xl font-bold ${getScoreColor(result.evaluation.score)}`} data-testid="text-score">
                            {result.evaluation.score}<span className="text-lg text-muted-foreground">/100</span>
                          </p>
                          <Badge variant="outline" className="text-xs mt-1" data-testid="badge-confidence">
                            {result.evaluation.confidence || 'MEDIUM'} Confidence
                          </Badge>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Why Section */}
                {result.evaluation.whyBullets && result.evaluation.whyBullets.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Target className="w-4 h-4 text-green-500" />
                        Why This Could Work
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-1.5" data-testid="why-bullets">
                        {result.evaluation.whyBullets.map((bullet, i) => (
                          <li key={i} className="text-sm flex items-start gap-2">
                            <ArrowUpCircle className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                            <span>{bullet}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}

                {/* Risk Flags Section - Tiered Display */}
                {result.evaluation.riskFlags && result.evaluation.riskFlags.length > 0 && (() => {
                  const flags = result.evaluation.riskFlags.map((flag) => {
                    const isDetailedFlag = typeof flag === 'object';
                    return {
                      severity: isDetailedFlag ? (flag as RiskFlagDetail).severity : 'medium',
                      tier: isDetailedFlag ? (flag as RiskFlagDetail).tier : undefined,
                      flagName: isDetailedFlag ? (flag as RiskFlagDetail).flag : flag,
                      detail: isDetailedFlag ? (flag as RiskFlagDetail).detail : flag,
                    };
                  });
                  const fatalFlags = flags.filter(f => f.tier === 'fatal' || f.severity === 'high');
                  const contextualFlags = flags.filter(f => f.tier === 'contextual' || (!f.tier && f.severity === 'medium'));
                  const missingFlags = flags.filter(f => f.tier === 'missing_input' || (!f.tier && f.severity === 'low'));
                  
                  return (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                          <Shield className="w-4 h-4 text-yellow-500" />
                          Risk Assessment
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {fatalFlags.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-red-400 mb-1.5">Structural Issues (Must Fix)</p>
                            <div className="space-y-1.5" data-testid="risk-flags-fatal">
                              {fatalFlags.map((f, i) => (
                                <div key={i} className="p-2 rounded border bg-red-500/10 border-red-500/30">
                                  <div className="flex items-start gap-2">
                                    <AlertOctagon className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />
                                    <div>
                                      <span className="font-medium text-sm">{String(f.flagName).replace(/_/g, ' ')}</span>
                                      <p className="text-xs text-muted-foreground mt-0.5">{f.detail}</p>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {contextualFlags.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-yellow-400 mb-1.5">Contextual Concerns</p>
                            <div className="space-y-1.5" data-testid="risk-flags-contextual">
                              {contextualFlags.map((f, i) => (
                                <div key={i} className="p-2 rounded border bg-yellow-500/10 border-yellow-500/30">
                                  <div className="flex items-start gap-2">
                                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-yellow-500" />
                                    <div>
                                      <span className="font-medium text-sm">{String(f.flagName).replace(/_/g, ' ')}</span>
                                      <p className="text-xs text-muted-foreground mt-0.5">{f.detail}</p>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {missingFlags.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-muted-foreground mb-1.5">Missing Information</p>
                            <div className="space-y-1.5" data-testid="risk-flags-missing">
                              {missingFlags.map((f, i) => (
                                <div key={i} className="p-2 rounded border bg-muted/50 border-muted">
                                  <div className="flex items-start gap-2">
                                    <Info className="w-4 h-4 shrink-0 mt-0.5 text-muted-foreground" />
                                    <div>
                                      <span className="font-medium text-sm">{String(f.flagName).replace(/_/g, ' ')}</span>
                                      <p className="text-xs text-muted-foreground mt-0.5">{f.detail}</p>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })()}

                {/* Fixes to Pass Section - Minimum changes to reach GREEN */}
                {result.evaluation.fixesToPass && result.evaluation.fixesToPass.length > 0 && (
                  <Card className="border-green-500/30">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Target className="w-4 h-4 text-green-500" />
                        Minimum Fixes to Pass
                      </CardTitle>
                      <p className="text-xs text-muted-foreground">Make these changes to reach GREEN</p>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-1.5" data-testid="fixes-to-pass">
                        {result.evaluation.fixesToPass.map((fix, i) => (
                          <li key={i} className="text-sm flex items-start gap-2">
                            <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                            <span>{fix}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}

                {/* Improvements Section */}
                {result.evaluation.improvements && result.evaluation.improvements.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Lightbulb className="w-4 h-4 text-blue-500" />
                        What Would Make This Better
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-1.5" data-testid="improvements">
                        {result.evaluation.improvements.map((improvement, i) => (
                          <li key={i} className="text-sm flex items-start gap-2">
                            <Zap className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                            <span>{improvement}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}

                {/* Rule Checklist Section */}
                {result.evaluation.ruleChecklist && result.evaluation.ruleChecklist.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Info className="w-4 h-4" />
                        Rule Checklist
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-1" data-testid="rule-checklist">
                        {result.evaluation.ruleChecklist.map((item, i) => (
                          <div key={i} className="flex items-center gap-2 text-sm py-1">
                            {item.status === 'followed' ? (
                              <CheckCircle2 className="w-4 h-4 text-green-500" />
                            ) : item.status === 'violated' ? (
                              <XCircle className="w-4 h-4 text-red-500" />
                            ) : (
                              <Minus className="w-4 h-4 text-muted-foreground" />
                            )}
                            <span className={item.status === 'violated' ? 'text-red-400' : ''}>{item.rule}</span>
                            {item.note && <span className="text-xs text-muted-foreground">- {item.note}</span>}
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Commitment Prompt - Action Buttons */}
                <Card className="bg-muted/30">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Commitment</CardTitle>
                    <CardDescription>Log your decision for analysis</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-2" data-testid="commitment-buttons">
                      <Button
                        className="gap-2"
                        onClick={handleCommit}
                        disabled={commitMutation.isPending}
                        data-testid="button-commit"
                      >
                        {commitMutation.isPending ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <CheckCircle2 className="w-4 h-4" />
                        )}
                        Commit Trade
                      </Button>
                      <Button
                        variant="outline"
                        className="gap-2"
                        onClick={() => {
                          setResult(null);
                          toast({ title: "Revise your plan", description: "Make adjustments and re-evaluate" });
                        }}
                        data-testid="button-revise"
                      >
                        <Eye className="w-4 h-4" />
                        Revise Plan
                      </Button>
                      <Button
                        variant="outline"
                        className="gap-2"
                        onClick={() => {
                          toast({ title: "Waiting for confirmation", description: "Monitor for better entry" });
                          setLocation("/sentinel/dashboard?tab=watchlist");
                        }}
                        data-testid="button-wait"
                      >
                        <Clock className="w-4 h-4" />
                        Wait for Confirmation
                      </Button>
                      <Button
                        variant="outline"
                        className="gap-2"
                        onClick={() => {
                          toast({ title: "Added to Watchlist", description: `${symbol.toUpperCase()} added for monitoring` });
                          setLocation("/sentinel/dashboard?tab=watchlist");
                        }}
                        data-testid="button-watchlist"
                      >
                        <ListPlus className="w-4 h-4" />
                        Add to Watchlist
                      </Button>
                      <Button
                        variant="outline"
                        className="gap-2 text-red-400 hover:text-red-300 col-span-2"
                        onClick={() => {
                          toast({ title: "Trade Passed", description: "Decision logged" });
                          setLocation("/sentinel/dashboard");
                        }}
                        data-testid="button-pass"
                      >
                        <ThumbsDown className="w-4 h-4" />
                        Pass on This Trade
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </>
            ) : (
              <Card>
                <CardContent className="p-8 text-center text-muted-foreground">
                  <TrendingUp className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>Enter your trade details and click "Evaluate Trade" to get AI judgment.</p>
                  <p className="text-sm mt-2">
                    Sentinel will analyze your trade idea and identify potential risks.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
