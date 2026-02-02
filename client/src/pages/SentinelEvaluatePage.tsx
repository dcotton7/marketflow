import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, AlertTriangle, TrendingUp, Loader2 } from "lucide-react";

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

export default function SentinelEvaluatePage() {
  const [, setLocation] = useLocation();
  const { user } = useSentinelAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [symbol, setSymbol] = useState("");
  const [direction, setDirection] = useState<"long" | "short">("long");
  const [entryPrice, setEntryPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const [positionSize, setPositionSize] = useState("");
  const [thesis, setThesis] = useState("");
  const [deepEval, setDeepEval] = useState(false);

  const [result, setResult] = useState<EvaluationResult | null>(null);

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

    if (stopPrice) data.stopPrice = parseFloat(stopPrice);
    if (targetPrice) data.targetPrice = parseFloat(targetPrice);
    if (positionSize) data.positionSize = parseFloat(positionSize);
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

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/sentinel/dashboard")} data-testid="button-back">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Evaluate Trade</h1>
            <p className="text-sm text-muted-foreground">Get AI judgment on your trade idea</p>
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

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="stopPrice">Stop Price (optional)</Label>
                    <Input
                      id="stopPrice"
                      type="number"
                      step="0.01"
                      data-testid="input-stop-price"
                      value={stopPrice}
                      onChange={(e) => setStopPrice(e.target.value)}
                      placeholder="145.00"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="targetPrice">Target Price (optional)</Label>
                    <Input
                      id="targetPrice"
                      type="number"
                      step="0.01"
                      data-testid="input-target-price"
                      value={targetPrice}
                      onChange={(e) => setTargetPrice(e.target.value)}
                      placeholder="165.00"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="positionSize">Position Size $ (optional)</Label>
                  <Input
                    id="positionSize"
                    type="number"
                    step="1"
                    data-testid="input-position-size"
                    value={positionSize}
                    onChange={(e) => setPositionSize(e.target.value)}
                    placeholder="10000"
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
