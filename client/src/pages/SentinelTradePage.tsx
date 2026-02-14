import { useState, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSentinelAuth } from "@/context/SentinelAuthContext";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, AlertTriangle, CheckCircle, Clock, TrendingUp, TrendingDown, Edit2, X, Check, Loader2, DollarSign } from "lucide-react";
import { SentinelHeader } from "@/components/SentinelHeader";
import { useSystemSettings } from "@/context/SystemSettingsContext";

interface Trade {
  id: number;
  symbol: string;
  direction: string;
  entryPrice: number;
  stopPrice?: number;
  targetPrice?: number;
  positionSize?: number;
  thesis?: string;
  status: string;
  createdAt: string;
}

interface Evaluation {
  id: number;
  score: number;
  recommendation: string;
  reasoning: string;
  riskFlags: string[];
  keyPoints: string[];
  modelUsed: string;
  promptVersion: string;
  createdAt: string;
}

interface TradeEvent {
  id: number;
  eventType: string;
  oldValue?: string;
  newValue?: string;
  description: string;
  createdAt: string;
}

interface TradeDetail {
  trade: Trade;
  evaluations: Evaluation[];
  events: TradeEvent[];
}

interface TradingRule {
  id: number;
  name: string;
  description?: string;
  category?: string;
  isActive: boolean;
}

export default function SentinelTradePage() {
  const [, setLocation] = useLocation();
  const params = useParams<{ tradeId: string }>();
  const tradeId = parseInt(params.tradeId || "0");
  const { toast } = useToast();
  const { cssVariables } = useSystemSettings();
  const queryClient = useQueryClient();

  const [editingStop, setEditingStop] = useState(false);
  const [editingTarget, setEditingTarget] = useState(false);
  const [newStop, setNewStop] = useState("");
  const [newTarget, setNewTarget] = useState("");
  
  // Close trade dialog state
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const [exitPrice, setExitPrice] = useState("");
  const [outcome, setOutcome] = useState<"win" | "loss" | "breakeven">("win");
  const [closeNotes, setCloseNotes] = useState("");
  const [rulesFollowed, setRulesFollowed] = useState<Record<string, boolean>>({});

  const { data, isLoading, error } = useQuery<TradeDetail>({
    queryKey: ["/api/sentinel/trade", tradeId],
    enabled: tradeId > 0,
  });

  const { data: rules = [] } = useQuery<TradingRule[]>({
    queryKey: ["/api/sentinel/rules"],
  });

  // Initialize rulesFollowed when rules load
  useEffect(() => {
    if (rules.length > 0 && Object.keys(rulesFollowed).length === 0) {
      const initial: Record<string, boolean> = {};
      rules.filter(r => r.isActive).forEach(r => {
        initial[r.id.toString()] = true;
      });
      setRulesFollowed(initial);
    }
  }, [rules]);

  const updateMutation = useMutation({
    mutationFn: async (updates: any) => {
      const res = await apiRequest("PATCH", `/api/sentinel/trade/${tradeId}`, updates);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/trade", tradeId] });
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/dashboard"] });
      setEditingStop(false);
      setEditingTarget(false);
      toast({ title: "Updated", description: "Trade updated successfully" });
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed",
        description: error.message || "Failed to update trade",
        variant: "destructive",
      });
    },
  });

  const commitMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/sentinel/commit/${tradeId}`);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/trade", tradeId] });
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/dashboard"] });
      toast({ title: "Committed", description: "Trade is now active" });
    },
    onError: (error: any) => {
      toast({
        title: "Commit Failed",
        description: error.message || "Failed to commit trade",
        variant: "destructive",
      });
    },
  });

  const closeMutation = useMutation({
    mutationFn: async (closeData: { exitPrice: number; outcome: string; rulesFollowed?: Record<string, boolean>; notes?: string }) => {
      const res = await apiRequest("POST", `/api/sentinel/trade/${tradeId}/close`, closeData);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/trade", tradeId] });
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/dashboard"] });
      setShowCloseDialog(false);
      toast({ title: "Trade Closed", description: "Trade has been closed and recorded" });
    },
    onError: (error: any) => {
      toast({
        title: "Close Failed",
        description: error.message || "Failed to close trade",
        variant: "destructive",
      });
    },
  });

  const handleCloseTrade = () => {
    const price = parseFloat(exitPrice);
    if (isNaN(price) || price <= 0) {
      toast({ title: "Invalid exit price", variant: "destructive" });
      return;
    }
    closeMutation.mutate({
      exitPrice: price,
      outcome,
      rulesFollowed,
      notes: closeNotes || undefined,
    });
  };

  const handleSaveStop = () => {
    const price = parseFloat(newStop);
    if (!isNaN(price) && price > 0) {
      updateMutation.mutate({ stopPrice: price });
    }
  };

  const handleSaveTarget = () => {
    const price = parseFloat(newTarget);
    if (!isNaN(price) && price > 0) {
      updateMutation.mutate({ targetPrice: price });
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 70) return "text-rs-green";
    if (score >= 50) return "text-rs-yellow";
    return "text-rs-red";
  };

  const getEventIcon = (eventType: string) => {
    switch (eventType) {
      case "status_change": return <CheckCircle className="w-4 h-4 text-blue-500" />;
      case "stop_update": return <AlertTriangle className="w-4 h-4 text-rs-yellow" />;
      case "target_update": return <TrendingUp className="w-4 h-4 text-rs-green" />;
      case "evaluation": return <Clock className="w-4 h-4 text-purple-500" />;
      default: return <Clock className="w-4 h-4 text-muted-foreground" />;
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-destructive">Failed to load trade</div>
      </div>
    );
  }

  const { trade, evaluations, events } = data;
  const latestEval = evaluations[0];

  return (
    <div className="min-h-screen sentinel-page" style={{ backgroundColor: cssVariables.backgroundColor, '--logo-opacity': cssVariables.logoOpacity, '--overlay-bg': cssVariables.overlayBg } as React.CSSProperties}>
      <SentinelHeader showSentiment={true} />
      <div className="flex items-center justify-between gap-3 px-4 py-2 border-b flex-wrap" style={{ backgroundColor: cssVariables.headerBg }}>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/sentinel")} data-testid="button-back">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className="font-bold tracking-tight" style={{ color: cssVariables.textColorTitle, fontSize: cssVariables.fontSizeTitle }} data-testid="text-symbol">{trade.symbol}</h1>
          <Badge variant={trade.direction === "long" ? "default" : "destructive"}>
            {trade.direction === "long" ? (
              <><TrendingUp className="w-3 h-3 mr-1" /> LONG</>
            ) : (
              <><TrendingDown className="w-3 h-3 mr-1" /> SHORT</>
            )}
          </Badge>
          <Badge variant="outline" data-testid="badge-status">{trade.status}</Badge>
        </div>
        <div className="flex items-center gap-2">
          {trade.status === "considering" && (
            <Button size="sm" onClick={() => commitMutation.mutate()} disabled={commitMutation.isPending} data-testid="button-commit">
              {commitMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Commit Trade"}
            </Button>
          )}
          {trade.status === "active" && (
            <Button size="sm" variant="outline" onClick={() => setShowCloseDialog(true)} data-testid="button-close">
              <DollarSign className="w-4 h-4 mr-2" />
              Close Trade
            </Button>
          )}
        </div>
      </div>

      <main className="container mx-auto px-4 py-6">
        <div className="grid gap-6 md:grid-cols-3">
          <div className="md:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Trade Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <Label style={{ color: cssVariables.textColorSmall, fontSize: cssVariables.fontSizeSmall }}>Entry Price</Label>
                    <p className="font-medium" style={{ color: cssVariables.textColorNormal, fontSize: cssVariables.fontSizeNormal }} data-testid="text-entry">${trade.entryPrice.toFixed(2)}</p>
                  </div>

                  <div>
                    <Label style={{ color: cssVariables.textColorSmall, fontSize: cssVariables.fontSizeSmall }}>Stop Price</Label>
                    {editingStop ? (
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          step="0.01"
                          value={newStop}
                          onChange={(e) => setNewStop(e.target.value)}
                          className="h-8 w-24"
                          data-testid="input-stop"
                        />
                        <Button size="icon" variant="ghost" onClick={handleSaveStop} disabled={updateMutation.isPending}>
                          <Check className="w-4 h-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => setEditingStop(false)}>
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <p className="text-lg font-medium" data-testid="text-stop">
                          {trade.stopPrice ? `$${trade.stopPrice.toFixed(2)}` : "-"}
                        </p>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => {
                            setNewStop(trade.stopPrice?.toString() || "");
                            setEditingStop(true);
                          }}
                          data-testid="button-edit-stop"
                        >
                          <Edit2 className="w-3 h-3" />
                        </Button>
                      </div>
                    )}
                  </div>

                  <div>
                    <Label style={{ color: cssVariables.textColorSmall, fontSize: cssVariables.fontSizeSmall }}>Target Price</Label>
                    {editingTarget ? (
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          step="0.01"
                          value={newTarget}
                          onChange={(e) => setNewTarget(e.target.value)}
                          className="h-8 w-24"
                          data-testid="input-target"
                        />
                        <Button size="icon" variant="ghost" onClick={handleSaveTarget} disabled={updateMutation.isPending}>
                          <Check className="w-4 h-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => setEditingTarget(false)}>
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <p className="text-lg font-medium" data-testid="text-target">
                          {trade.targetPrice ? `$${trade.targetPrice.toFixed(2)}` : "-"}
                        </p>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => {
                            setNewTarget(trade.targetPrice?.toString() || "");
                            setEditingTarget(true);
                          }}
                          data-testid="button-edit-target"
                        >
                          <Edit2 className="w-3 h-3" />
                        </Button>
                      </div>
                    )}
                  </div>

                  <div>
                    <Label style={{ color: cssVariables.textColorSmall, fontSize: cssVariables.fontSizeSmall }}>Position Size</Label>
                    <p className="font-medium" style={{ color: cssVariables.textColorNormal, fontSize: cssVariables.fontSizeNormal }} data-testid="text-size">
                      {trade.positionSize ? `$${trade.positionSize.toLocaleString()}` : "-"}
                    </p>
                  </div>
                </div>

                {trade.thesis && (
                  <div>
                    <Label style={{ color: cssVariables.textColorSmall, fontSize: cssVariables.fontSizeSmall }}>Thesis</Label>
                    <p className="mt-1" style={{ color: cssVariables.textColorNormal, fontSize: cssVariables.fontSizeNormal }} data-testid="text-thesis">{trade.thesis}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {latestEval && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>Latest Evaluation</CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">{latestEval.modelUsed}</Badge>
                      <span className={`text-2xl font-bold ${getScoreColor(latestEval.score)}`} data-testid="text-score">
                        {latestEval.score}/100
                      </span>
                    </div>
                  </div>
                  <CardDescription>
                    {new Date(latestEval.createdAt).toLocaleString()}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="p-3 bg-muted rounded-md">
                    <p className={`font-medium ${getScoreColor(latestEval.score)}`} data-testid="text-recommendation">
                      {latestEval.recommendation}
                    </p>
                  </div>

                  <div>
                    <p data-testid="text-reasoning" style={{ color: cssVariables.textColorNormal, fontSize: cssVariables.fontSizeNormal }}>
                      {latestEval.reasoning}
                    </p>
                  </div>

                  {latestEval.riskFlags.length > 0 && (
                    <div>
                      <p className="font-medium mb-2 flex items-center gap-1">
                        <AlertTriangle className="w-4 h-4 text-rs-yellow" />
                        Risk Flags
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {latestEval.riskFlags.map((flag, i) => (
                          <Badge key={i} variant="outline" className="text-xs">
                            {flag}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {latestEval.keyPoints.length > 0 && (
                    <div>
                      <p className="font-medium mb-2 flex items-center gap-1">
                        <CheckCircle className="w-4 h-4 text-rs-green" />
                        Key Points
                      </p>
                      <ul className="text-sm space-y-1">
                        {latestEval.keyPoints.map((point, i) => (
                          <li key={i} className="text-muted-foreground">• {point}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          <div>
            <Card>
              <CardHeader>
                <CardTitle>Event History</CardTitle>
                <CardDescription>Timeline of trade events</CardDescription>
              </CardHeader>
              <CardContent>
                {events.length === 0 ? (
                  <p className="text-muted-foreground text-center py-4">No events yet</p>
                ) : (
                  <div className="space-y-3">
                    {events.map((event) => (
                      <div key={event.id} className="flex items-start gap-3 pb-3 border-b last:border-0" data-testid={`event-${event.id}`}>
                        {getEventIcon(event.eventType)}
                        <div className="flex-1">
                          <p style={{ color: cssVariables.textColorNormal, fontSize: cssVariables.fontSizeNormal }}>{event.description}</p>
                          <p style={{ color: cssVariables.textColorTiny, fontSize: cssVariables.fontSizeTiny }}>
                            {new Date(event.createdAt).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {evaluations.length > 1 && (
              <Card className="mt-4">
                <CardHeader>
                  <CardTitle>Evaluation History</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {evaluations.slice(1).map((ev) => (
                      <div key={ev.id} className="flex items-center justify-between py-2 border-b last:border-0">
                        <div>
                          <Badge variant="outline" className="text-xs">{ev.modelUsed}</Badge>
                          <p className="mt-1" style={{ color: cssVariables.textColorTiny, fontSize: cssVariables.fontSizeTiny }}>
                            {new Date(ev.createdAt).toLocaleString()}
                          </p>
                        </div>
                        <span className={`font-bold ${getScoreColor(ev.score)}`}>
                          {ev.score}/100
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </main>

      {/* Close Trade Dialog */}
      <Dialog open={showCloseDialog} onOpenChange={setShowCloseDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Close Trade: {data?.trade.symbol}</DialogTitle>
            <DialogDescription>Record the outcome and review your rule adherence</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="exit-price">Exit Price</Label>
                <Input
                  id="exit-price"
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={exitPrice}
                  onChange={(e) => setExitPrice(e.target.value)}
                  data-testid="input-exit-price"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="outcome">Outcome</Label>
                <Select value={outcome} onValueChange={(v) => setOutcome(v as typeof outcome)}>
                  <SelectTrigger id="outcome" data-testid="select-outcome">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="win">Win</SelectItem>
                    <SelectItem value="loss">Loss</SelectItem>
                    <SelectItem value="breakeven">Breakeven</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {rules.filter(r => r.isActive).length > 0 && (
              <div className="space-y-2">
                <Label>Did you follow your rules?</Label>
                <div className="space-y-2 max-h-40 overflow-y-auto border rounded-md p-2">
                  {rules.filter(r => r.isActive).map((rule) => (
                    <div key={rule.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`rule-${rule.id}`}
                        checked={rulesFollowed[rule.id.toString()] ?? true}
                        onCheckedChange={(checked) => {
                          setRulesFollowed(prev => ({
                            ...prev,
                            [rule.id.toString()]: checked === true,
                          }));
                        }}
                        data-testid={`checkbox-close-rule-${rule.id}`}
                      />
                      <label htmlFor={`rule-${rule.id}`} className="text-sm flex-1 cursor-pointer">
                        {rule.name}
                        {rule.category && (
                          <Badge variant="outline" className="ml-2 text-xs">{rule.category}</Badge>
                        )}
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="close-notes">Notes (optional)</Label>
              <Textarea
                id="close-notes"
                placeholder="What did you learn? What would you do differently?"
                value={closeNotes}
                onChange={(e) => setCloseNotes(e.target.value)}
                data-testid="input-close-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCloseDialog(false)}>Cancel</Button>
            <Button 
              onClick={handleCloseTrade} 
              disabled={!exitPrice || closeMutation.isPending}
              data-testid="button-confirm-close"
            >
              {closeMutation.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Closing...</>
              ) : (
                "Close Trade"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
