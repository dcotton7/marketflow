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
import { ArrowLeft, AlertTriangle, TrendingUp, TrendingDown, Minus, Loader2, DollarSign, Hash, Info } from "lucide-react";
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

interface EvaluationResult {
  tradeId: number;
  evaluation: {
    score: number;
    recommendation: string;
    reasoning: string;
    riskFlags: string[];
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
  { value: "RR_2X", label: "2x Risk/Reward" },
  { value: "RR_3X", label: "3x Risk/Reward" },
  { value: "RR_4X", label: "4x Risk/Reward" },
  { value: "RR_5X", label: "5x Risk/Reward" },
  { value: "RR_8X", label: "8x Risk/Reward" },
  { value: "RR_10X", label: "10x Risk/Reward" },
];

export default function SentinelEvaluatePage() {
  const [, setLocation] = useLocation();
  const { user } = useSentinelAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

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
  
  // Position size
  const [positionSizeUnit, setPositionSizeUnit] = useState<"shares" | "dollars">("shares");
  const [positionSize, setPositionSize] = useState("");
  
  const [thesis, setThesis] = useState("");
  const [deepEval, setDeepEval] = useState(false);

  const [result, setResult] = useState<EvaluationResult | null>(null);

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
    mutationFn: async (tradeId: number) => {
      const res = await apiRequest("POST", `/api/sentinel/commit/${tradeId}`);
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
    };

    // Stop price - either amount or choice
    if (stopPriceMode === "amount" && stopPrice) {
      data.stopPrice = parseFloat(stopPrice);
    } else if (stopPriceMode === "choice" && stopPriceChoice) {
      data.stopPriceLevel = stopPriceChoice;
    }

    // Target price - either amount or choice
    if (targetPriceMode === "amount" && targetPrice) {
      data.targetPrice = parseFloat(targetPrice);
    } else if (targetPriceMode === "choice" && targetPriceChoice) {
      data.targetPriceLevel = targetPriceChoice;
    }

    // Position size with unit
    if (positionSize) {
      data.positionSize = parseFloat(positionSize);
      data.positionSizeUnit = positionSizeUnit;
    }
    if (thesis) data.thesis = thesis;

    evaluateMutation.mutate(data);
  };

  const handleCommit = () => {
    if (result?.tradeId) {
      commitMutation.mutate(result.tradeId);
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
                      Evaluate Trade
                    </>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>

          <div className="space-y-4">
            {result ? (
              <>
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle data-testid="text-result-title">Evaluation Result</CardTitle>
                      <Badge variant="outline" className="text-xs" data-testid="badge-model">
                        {result.evaluation.model}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-lg font-medium" data-testid="text-symbol-result">{symbol.toUpperCase()}</span>
                      <div className="flex items-center gap-2">
                        <Badge variant={direction === "long" ? "default" : "destructive"} data-testid="badge-direction">
                          {direction.toUpperCase()}
                        </Badge>
                        <span className={`text-3xl font-bold ${getScoreColor(result.evaluation.score)}`} data-testid="text-score">
                          {result.evaluation.score}
                        </span>
                        <span className="text-muted-foreground">/100</span>
                      </div>
                    </div>

                    <div className="p-3 bg-muted rounded-md">
                      <p className="font-medium mb-1">Recommendation</p>
                      <p className={`text-lg font-semibold uppercase ${getScoreColor(result.evaluation.score)}`} data-testid="text-recommendation">
                        {result.evaluation.recommendation}
                      </p>
                    </div>

                    <div>
                      <p className="font-medium mb-2">Reasoning</p>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap" data-testid="text-reasoning">
                        {result.evaluation.reasoning}
                      </p>
                    </div>

                    {result.evaluation.riskFlags && result.evaluation.riskFlags.length > 0 && (
                      <div>
                        <p className="font-medium mb-2 flex items-center gap-1">
                          <AlertTriangle className="w-4 h-4 text-yellow-500" />
                          Risk Flags
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {result.evaluation.riskFlags.map((flag, i) => (
                            <Badge key={i} variant="outline" className="text-xs" data-testid={`badge-risk-${i}`}>
                              {flag}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <div className="flex gap-4">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => setLocation("/sentinel/dashboard")}
                    data-testid="button-keep-considering"
                  >
                    Keep Considering
                  </Button>
                  <Button
                    className="flex-1"
                    onClick={handleCommit}
                    disabled={commitMutation.isPending}
                    data-testid="button-commit"
                  >
                    {commitMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Committing...
                      </>
                    ) : (
                      "Commit Trade"
                    )}
                  </Button>
                </div>
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
