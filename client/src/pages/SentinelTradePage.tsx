import { useState } from "react";
import { useLocation, useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSentinelAuth } from "@/context/SentinelAuthContext";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, AlertTriangle, CheckCircle, Clock, TrendingUp, TrendingDown, Edit2, X, Check, Loader2 } from "lucide-react";

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

export default function SentinelTradePage() {
  const [, setLocation] = useLocation();
  const params = useParams<{ tradeId: string }>();
  const tradeId = parseInt(params.tradeId || "0");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [editingStop, setEditingStop] = useState(false);
  const [editingTarget, setEditingTarget] = useState(false);
  const [newStop, setNewStop] = useState("");
  const [newTarget, setNewTarget] = useState("");

  const { data, isLoading, error } = useQuery<TradeDetail>({
    queryKey: ["/api/sentinel/trade", tradeId],
    enabled: tradeId > 0,
  });

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
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/sentinel/trade/${tradeId}`, { status: "closed" });
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/trade", tradeId] });
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/dashboard"] });
      toast({ title: "Closed", description: "Trade marked as closed" });
    },
    onError: (error: any) => {
      toast({
        title: "Close Failed",
        description: error.message || "Failed to close trade",
        variant: "destructive",
      });
    },
  });

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
    if (score >= 70) return "text-green-500";
    if (score >= 50) return "text-yellow-500";
    return "text-red-500";
  };

  const getEventIcon = (eventType: string) => {
    switch (eventType) {
      case "status_change": return <CheckCircle className="w-4 h-4 text-blue-500" />;
      case "stop_update": return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
      case "target_update": return <TrendingUp className="w-4 h-4 text-green-500" />;
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
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/sentinel")} data-testid="button-back">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight" data-testid="text-symbol">{trade.symbol}</h1>
              <Badge variant={trade.direction === "long" ? "default" : "destructive"}>
                {trade.direction === "long" ? (
                  <><TrendingUp className="w-3 h-3 mr-1" /> LONG</>
                ) : (
                  <><TrendingDown className="w-3 h-3 mr-1" /> SHORT</>
                )}
              </Badge>
              <Badge variant="outline" data-testid="badge-status">{trade.status}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Created {new Date(trade.createdAt).toLocaleDateString()}
            </p>
          </div>
          {trade.status === "considering" && (
            <Button onClick={() => commitMutation.mutate()} disabled={commitMutation.isPending} data-testid="button-commit">
              {commitMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Commit Trade"}
            </Button>
          )}
          {trade.status === "active" && (
            <Button variant="outline" onClick={() => closeMutation.mutate()} disabled={closeMutation.isPending} data-testid="button-close">
              {closeMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Close Trade"}
            </Button>
          )}
        </div>
      </header>

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
                    <Label className="text-muted-foreground">Entry Price</Label>
                    <p className="text-lg font-medium" data-testid="text-entry">${trade.entryPrice.toFixed(2)}</p>
                  </div>

                  <div>
                    <Label className="text-muted-foreground">Stop Price</Label>
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
                    <Label className="text-muted-foreground">Target Price</Label>
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
                    <Label className="text-muted-foreground">Position Size</Label>
                    <p className="text-lg font-medium" data-testid="text-size">
                      {trade.positionSize ? `$${trade.positionSize.toLocaleString()}` : "-"}
                    </p>
                  </div>
                </div>

                {trade.thesis && (
                  <div>
                    <Label className="text-muted-foreground">Thesis</Label>
                    <p className="text-sm mt-1" data-testid="text-thesis">{trade.thesis}</p>
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
                    <p className="text-sm text-muted-foreground" data-testid="text-reasoning">
                      {latestEval.reasoning}
                    </p>
                  </div>

                  {latestEval.riskFlags.length > 0 && (
                    <div>
                      <p className="font-medium mb-2 flex items-center gap-1">
                        <AlertTriangle className="w-4 h-4 text-yellow-500" />
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
                        <CheckCircle className="w-4 h-4 text-green-500" />
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
                          <p className="text-sm">{event.description}</p>
                          <p className="text-xs text-muted-foreground">
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
                          <p className="text-xs text-muted-foreground mt-1">
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
    </div>
  );
}
