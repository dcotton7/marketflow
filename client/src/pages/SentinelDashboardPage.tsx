import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useSentinelAuth } from "@/context/SentinelAuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, LogOut, TrendingUp, TrendingDown, AlertTriangle, Clock, CheckCircle, Eye, Crosshair, BookOpen, X, DollarSign, Brain, Sparkles, Lightbulb } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { SentinelHeader } from "@/components/SentinelHeader";

interface TradeLabel {
  id: number;
  name: string;
  color: string;
  isAdminOnly?: boolean;
}

interface TradeWithEvaluation {
  id: number;
  symbol: string;
  direction: string;
  entryPrice: number;
  stopPrice?: number;
  targetPrice?: number;
  status: string;
  createdAt: string;
  labels?: TradeLabel[];
  latestEvaluation?: {
    score: number;
    recommendation: string;
    riskFlags: string[];
  };
}

interface TradeEvent {
  id: number;
  tradeId: number;
  eventType: string;
  description: string;
  createdAt: string;
  trade?: { symbol: string };
}

interface WatchlistItem {
  id: number;
  symbol: string;
  targetEntry?: number;
  stopPlan?: number;
  targetPlan?: number;
  alertPrice?: number;
  thesis?: string;
  priority: string;
  status: string;
  createdAt: string;
}

interface TradingRule {
  id: number;
  name: string;
  description?: string;
  category?: string;
  isActive: boolean;
  order: number;
  source?: string;
  severity?: string;
  isAutoReject?: boolean;
  ruleCode?: string;
  formula?: string;
}

interface DashboardData {
  considering: TradeWithEvaluation[];
  active: TradeWithEvaluation[];
  recentEvents: TradeEvent[];
}

interface RuleSuggestion {
  id: number;
  name: string;
  description?: string;
  category?: string;
  source: string;
  severity?: string;
  isAutoReject?: boolean;
  ruleCode?: string;
  formula?: string;
  confidenceScore?: number;
  adoptionCount?: number;
  supportingData?: {
    totalTrades?: number;
    winRate?: number;
    avgPnL?: number;
    sampleSize?: number;
    patternDescription?: string;
  };
  status: string;
}

function getScoreColor(score: number): string {
  if (score >= 70) return "text-green-500";
  if (score >= 50) return "text-yellow-500";
  return "text-red-500";
}

function getScoreBadgeVariant(score: number): "default" | "secondary" | "destructive" | "outline" {
  if (score >= 70) return "default";
  if (score >= 50) return "secondary";
  return "destructive";
}

function TradeCard({ trade }: { trade: TradeWithEvaluation }) {
  return (
    <Link href={`/sentinel/evaluate?tradeId=${trade.id}`}>
      <Card className="hover-elevate cursor-pointer" data-testid={`card-trade-${trade.id}`}>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="font-bold text-lg" data-testid={`text-symbol-${trade.id}`}>{trade.symbol}</span>
              <Badge variant={trade.direction === "long" ? "default" : "destructive"} data-testid={`badge-direction-${trade.id}`}>
                {trade.direction === "long" ? (
                  <><TrendingUp className="w-3 h-3 mr-1" /> LONG</>
                ) : (
                  <><TrendingDown className="w-3 h-3 mr-1" /> SHORT</>
                )}
              </Badge>
            </div>
            {trade.latestEvaluation && (
              <Badge variant={getScoreBadgeVariant(trade.latestEvaluation.score)} data-testid={`badge-score-${trade.id}`}>
                {trade.latestEvaluation.score}/100
              </Badge>
            )}
          </div>

          {/* Display labels */}
          {trade.labels && trade.labels.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {trade.labels.map((label) => (
                <span
                  key={label.id}
                  className="px-2 py-0.5 text-xs rounded-full text-white"
                  style={{ backgroundColor: label.color }}
                  data-testid={`label-${trade.id}-${label.id}`}
                >
                  {label.name}
                </span>
              ))}
            </div>
          )}

          <div className="text-sm text-muted-foreground space-y-1">
            <div>Entry: ${trade.entryPrice.toFixed(2)}</div>
            <div className="flex gap-4">
              {trade.stopPrice && <span>Stop: ${trade.stopPrice.toFixed(2)}</span>}
              {trade.targetPrice && <span>Target: ${trade.targetPrice.toFixed(2)}</span>}
            </div>
          </div>

          {trade.latestEvaluation && trade.latestEvaluation.riskFlags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {trade.latestEvaluation.riskFlags.slice(0, 3).map((flag, i) => (
                <Badge key={i} variant="outline" className="text-xs" data-testid={`badge-risk-${trade.id}-${i}`}>
                  <AlertTriangle className="w-3 h-3 mr-1 text-yellow-500" />
                  {flag}
                </Badge>
              ))}
            </div>
          )}

          {trade.latestEvaluation && (
            <div className="mt-2 text-sm">
              <span className={getScoreColor(trade.latestEvaluation.score)}>
                {trade.latestEvaluation.recommendation}
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}

function EventItem({ event }: { event: TradeEvent }) {
  const getEventIcon = () => {
    switch (event.eventType) {
      case "status_change": return <CheckCircle className="w-4 h-4 text-blue-500" />;
      case "stop_update": return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
      case "target_update": return <TrendingUp className="w-4 h-4 text-green-500" />;
      default: return <Clock className="w-4 h-4 text-muted-foreground" />;
    }
  };

  return (
    <div className="flex items-start gap-3 py-2 border-b last:border-0" data-testid={`event-${event.id}`}>
      {getEventIcon()}
      <div className="flex-1">
        <div className="flex items-center gap-2">
          {event.trade && (
            <Badge variant="outline" className="text-xs">{event.trade.symbol}</Badge>
          )}
          <span className="text-sm">{event.description}</span>
        </div>
        <span className="text-xs text-muted-foreground">
          {new Date(event.createdAt).toLocaleString()}
        </span>
      </div>
    </div>
  );
}

function WatchlistCard({ item, onDelete }: { item: WatchlistItem; onDelete: (id: number) => void }) {
  const priorityColors = {
    high: "text-red-500 bg-red-500/10",
    medium: "text-yellow-500 bg-yellow-500/10",
    low: "text-green-500 bg-green-500/10",
  };

  return (
    <Card className="hover-elevate" data-testid={`card-watchlist-${item.id}`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4 text-muted-foreground" />
            <span className="font-bold text-lg" data-testid={`text-watchlist-symbol-${item.id}`}>{item.symbol}</span>
            <Badge className={priorityColors[item.priority as keyof typeof priorityColors] || priorityColors.medium}>
              {item.priority}
            </Badge>
          </div>
          <Button variant="ghost" size="icon" onClick={() => onDelete(item.id)} data-testid={`button-delete-watchlist-${item.id}`}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="text-sm text-muted-foreground space-y-1">
          {item.targetEntry && <div>Target Entry: ${item.targetEntry.toFixed(2)}</div>}
          {item.alertPrice && <div>Alert at: ${item.alertPrice.toFixed(2)}</div>}
          <div className="flex gap-4">
            {item.stopPlan && <span>Stop Plan: ${item.stopPlan.toFixed(2)}</span>}
            {item.targetPlan && <span>Target Plan: ${item.targetPlan.toFixed(2)}</span>}
          </div>
        </div>

        {item.thesis && (
          <div className="mt-2 text-sm text-muted-foreground italic line-clamp-2">
            {item.thesis}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RuleItem({ rule, onToggle, onDelete }: { rule: TradingRule; onToggle: (id: number, active: boolean) => void; onDelete: (id: number) => void }) {
  const categoryColors: Record<string, string> = {
    entry: "bg-blue-500/10 text-blue-500",
    exit: "bg-green-500/10 text-green-500",
    sizing: "bg-purple-500/10 text-purple-500",
    risk: "bg-red-500/10 text-red-500",
    general: "bg-muted text-muted-foreground",
    auto_reject: "bg-red-600/20 text-red-600",
    profit_taking: "bg-emerald-500/10 text-emerald-500",
    stop_loss: "bg-orange-500/10 text-orange-500",
    ma_structure: "bg-cyan-500/10 text-cyan-500",
    base_quality: "bg-indigo-500/10 text-indigo-500",
    breakout: "bg-teal-500/10 text-teal-500",
    position_sizing: "bg-violet-500/10 text-violet-500",
    market_regime: "bg-amber-500/10 text-amber-500",
  };

  const severityColors: Record<string, string> = {
    auto_reject: "bg-red-600 text-white",
    critical: "bg-orange-500 text-white",
    warning: "bg-yellow-500/20 text-yellow-600",
    info: "bg-blue-500/20 text-blue-500",
  };

  const sourceLabels: Record<string, string> = {
    starter: "Starter",
    user: "Custom",
    ai_collective: "AI Learned",
    ai_agentic: "AI Agent",
  };

  return (
    <div className={`flex items-center justify-between p-3 border rounded-md ${!rule.isActive ? 'opacity-50' : ''} ${rule.isAutoReject ? 'border-red-500/30' : ''}`} data-testid={`rule-${rule.id}`}>
      <div className="flex items-center gap-3 flex-1">
        <input
          type="checkbox"
          checked={rule.isActive}
          onChange={(e) => onToggle(rule.id, e.target.checked)}
          className="w-4 h-4"
          data-testid={`checkbox-rule-${rule.id}`}
        />
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {rule.isAutoReject && (
              <Badge className="bg-red-600 text-white text-xs">AUTO-REJECT</Badge>
            )}
            <span className="font-medium">{rule.name}</span>
            {rule.category && (
              <Badge className={`${categoryColors[rule.category] || categoryColors.general} text-xs`}>
                {rule.category.replace('_', ' ')}
              </Badge>
            )}
            {rule.source && rule.source !== 'user' && (
              <Badge variant="outline" className="text-xs">
                {sourceLabels[rule.source] || rule.source}
              </Badge>
            )}
            {rule.severity && rule.severity !== 'warning' && !rule.isAutoReject && (
              <Badge className={`${severityColors[rule.severity] || ''} text-xs`}>
                {rule.severity}
              </Badge>
            )}
          </div>
          {rule.description && (
            <p className="text-sm text-muted-foreground mt-1">{rule.description}</p>
          )}
          {rule.formula && (
            <p className="text-xs text-muted-foreground mt-1 font-mono bg-muted/50 px-2 py-1 rounded inline-block">
              {rule.formula}
            </p>
          )}
        </div>
      </div>
      <Button variant="ghost" size="icon" onClick={() => onDelete(rule.id)} data-testid={`button-delete-rule-${rule.id}`}>
        <X className="w-4 h-4" />
      </Button>
    </div>
  );
}

export default function SentinelDashboardPage() {
  const [, setLocation] = useLocation();
  const { user, logout } = useSentinelAuth();
  const [activeTab, setActiveTab] = useState("active");
  const { toast } = useToast();

  // Dialogs
  const [showAddWatchlist, setShowAddWatchlist] = useState(false);
  const [showAddRule, setShowAddRule] = useState(false);
  const [watchlistForm, setWatchlistForm] = useState({ symbol: "", targetEntry: "", thesis: "", priority: "medium" });
  const [ruleForm, setRuleForm] = useState({ name: "", description: "", category: "entry" });
  const [ruleFilter, setRuleFilter] = useState<string>("all");
  const [selectedLabelFilter, setSelectedLabelFilter] = useState<number | null>(null);

  const { data: dashboard, isLoading, error } = useQuery<DashboardData>({
    queryKey: ["/api/sentinel/dashboard"],
  });

  const { data: watchlist = [] } = useQuery<WatchlistItem[]>({
    queryKey: ["/api/sentinel/watchlist"],
  });

  const { data: rules = [] } = useQuery<TradingRule[]>({
    queryKey: ["/api/sentinel/rules"],
  });

  const { data: suggestions = [] } = useQuery<RuleSuggestion[]>({
    queryKey: ["/api/sentinel/suggestions"],
  });

  const { data: allLabels = [] } = useQuery<TradeLabel[]>({
    queryKey: ["/api/sentinel/labels"],
  });

  // Filter trades by label
  const filterTradesByLabel = (trades: TradeWithEvaluation[] | undefined) => {
    if (!trades || selectedLabelFilter === null) return trades;
    return trades.filter(trade => 
      trade.labels?.some(label => label.id === selectedLabelFilter)
    );
  };

  const filteredConsidering = filterTradesByLabel(dashboard?.considering);
  const filteredActive = filterTradesByLabel(dashboard?.active);

  // Mutations
  const addWatchlistMutation = useMutation({
    mutationFn: async (data: { symbol: string; targetEntry?: number; thesis?: string; priority: string }) => {
      return apiRequest("POST", "/api/sentinel/watchlist", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/watchlist"] });
      setShowAddWatchlist(false);
      setWatchlistForm({ symbol: "", targetEntry: "", thesis: "", priority: "medium" });
      toast({ title: "Added to watchlist" });
    },
  });

  const deleteWatchlistMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/sentinel/watchlist/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/watchlist"] });
      toast({ title: "Removed from watchlist" });
    },
  });

  const addRuleMutation = useMutation({
    mutationFn: async (data: { name: string; description?: string; category?: string }) => {
      return apiRequest("POST", "/api/sentinel/rules", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/rules"] });
      setShowAddRule(false);
      setRuleForm({ name: "", description: "", category: "entry" });
      toast({ title: "Rule added" });
    },
  });

  const toggleRuleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => {
      return apiRequest("PATCH", `/api/sentinel/rules/${id}`, { isActive });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/rules"] });
    },
  });

  const deleteRuleMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/sentinel/rules/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/rules"] });
      toast({ title: "Rule deleted" });
    },
  });

  const adoptSuggestionMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("POST", `/api/sentinel/suggestions/${id}/adopt`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/suggestions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/rules"] });
      toast({ title: "Rule adopted to your rulebook" });
    },
  });

  const dismissSuggestionMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("POST", `/api/sentinel/suggestions/${id}/dismiss`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/suggestions"] });
      toast({ title: "Suggestion dismissed" });
    },
  });

  const analyzeRulesMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/sentinel/ai/analyze-rules");
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/suggestions"] });
      toast({ title: data.message || "AI analysis complete" });
    },
  });

  const handleLogout = async () => {
    await logout();
    setLocation("/sentinel/login");
  };

  const handleAddWatchlist = () => {
    if (!watchlistForm.symbol) return;
    addWatchlistMutation.mutate({
      symbol: watchlistForm.symbol.toUpperCase(),
      targetEntry: watchlistForm.targetEntry ? parseFloat(watchlistForm.targetEntry) : undefined,
      thesis: watchlistForm.thesis || undefined,
      priority: watchlistForm.priority,
    });
  };

  const handleAddRule = () => {
    if (!ruleForm.name) return;
    addRuleMutation.mutate({
      name: ruleForm.name,
      description: ruleForm.description || undefined,
      category: ruleForm.category,
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Loading dashboard...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-destructive">Failed to load dashboard</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
          <SentinelHeader showSentiment={true} />
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground" data-testid="text-username">
              {user?.username}
            </span>
            <Button variant="outline" size="sm" onClick={handleLogout} data-testid="button-logout">
              <LogOut className="w-4 h-4 mr-2" />
              Logout
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold">Dashboard</h2>
          <Button onClick={() => setLocation("/sentinel/evaluate")} data-testid="button-new-evaluation">
            <Plus className="w-4 h-4 mr-2" />
            New Evaluation
          </Button>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="flex-wrap">
            <TabsTrigger value="active" data-testid="tab-active">
              <Crosshair className="w-4 h-4 mr-1" />
              Active ({dashboard?.active.length || 0})
            </TabsTrigger>
            <TabsTrigger value="watching" data-testid="tab-watching">
              <Eye className="w-4 h-4 mr-1" />
              Watching ({watchlist.length})
            </TabsTrigger>
            <TabsTrigger value="considering" data-testid="tab-considering">
              Considering ({dashboard?.considering.length || 0})
            </TabsTrigger>
            <TabsTrigger value="rules" data-testid="tab-rules">
              <BookOpen className="w-4 h-4 mr-1" />
              My Rules ({rules.length})
            </TabsTrigger>
            <TabsTrigger value="ai" data-testid="tab-ai">
              <Brain className="w-4 h-4 mr-1" />
              AI Insights
            </TabsTrigger>
            <TabsTrigger value="events" data-testid="tab-events">
              Events
            </TabsTrigger>
          </TabsList>

          <TabsContent value="considering" className="space-y-4">
            {/* Label filter grid */}
            {allLabels.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-4" data-testid="label-filter-grid">
                <Button
                  size="sm"
                  variant={selectedLabelFilter === null ? "default" : "outline"}
                  onClick={() => setSelectedLabelFilter(null)}
                  data-testid="label-filter-all"
                >
                  All
                </Button>
                {allLabels.map((label) => (
                  <Button
                    key={label.id}
                    size="sm"
                    variant={selectedLabelFilter === label.id ? "default" : "outline"}
                    onClick={() => setSelectedLabelFilter(label.id)}
                    className="gap-1"
                    data-testid={`label-filter-${label.id}`}
                  >
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: label.color }}
                    />
                    {label.name}
                    {label.isAdminOnly && <span className="text-xs opacity-70">(admin)</span>}
                  </Button>
                ))}
              </div>
            )}
            {filteredConsidering?.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-center text-muted-foreground">
                  {selectedLabelFilter !== null
                    ? "No trades with this label."
                    : "No trades under consideration. Click \"New Evaluation\" to get started."}
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {filteredConsidering?.map((trade) => (
                  <TradeCard key={trade.id} trade={trade} />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="active" className="space-y-4">
            {/* Label filter grid for active trades */}
            {allLabels.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-4" data-testid="label-filter-grid-active">
                <Button
                  size="sm"
                  variant={selectedLabelFilter === null ? "default" : "outline"}
                  onClick={() => setSelectedLabelFilter(null)}
                  data-testid="label-filter-all-active"
                >
                  All
                </Button>
                {allLabels.map((label) => (
                  <Button
                    key={label.id}
                    size="sm"
                    variant={selectedLabelFilter === label.id ? "default" : "outline"}
                    onClick={() => setSelectedLabelFilter(label.id)}
                    className="gap-1"
                    data-testid={`label-filter-active-${label.id}`}
                  >
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: label.color }}
                    />
                    {label.name}
                  </Button>
                ))}
              </div>
            )}
            {filteredActive?.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-center text-muted-foreground">
                  {selectedLabelFilter !== null
                    ? "No active trades with this label."
                    : "No active trades. Commit a trade to start tracking it."}
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {filteredActive?.map((trade) => (
                  <TradeCard key={trade.id} trade={trade} />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="watching" className="space-y-4">
            <div className="flex justify-end">
              <Button onClick={() => setShowAddWatchlist(true)} data-testid="button-add-watchlist">
                <Plus className="w-4 h-4 mr-2" />
                Add to Watchlist
              </Button>
            </div>
            {watchlist.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-center text-muted-foreground">
                  No stocks on your watchlist. Add setups you're monitoring for entry.
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {watchlist.map((item) => (
                  <WatchlistCard key={item.id} item={item} onDelete={(id) => deleteWatchlistMutation.mutate(id)} />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="rules" className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-1">
                {[
                  { value: "all", label: "All" },
                  { value: "auto_reject", label: "Auto-Reject" },
                  { value: "entry", label: "Entry" },
                  { value: "exit", label: "Exit" },
                  { value: "profit_taking", label: "Profit" },
                  { value: "stop_loss", label: "Stop" },
                  { value: "position_sizing", label: "Sizing" },
                  { value: "ma_structure", label: "MA" },
                  { value: "base_quality", label: "Base" },
                  { value: "breakout", label: "Breakout" },
                  { value: "market_regime", label: "Regime" },
                ].map((cat) => (
                  <Button
                    key={cat.value}
                    size="sm"
                    variant={ruleFilter === cat.value ? "default" : "outline"}
                    onClick={() => setRuleFilter(cat.value)}
                    data-testid={`button-filter-${cat.value}`}
                    className="text-xs"
                  >
                    {cat.label}
                  </Button>
                ))}
              </div>
              <Button onClick={() => setShowAddRule(true)} data-testid="button-add-rule">
                <Plus className="w-4 h-4 mr-2" />
                Add Rule
              </Button>
            </div>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  My Trading Rules
                  <Badge variant="outline" className="text-xs">{rules.length} rules</Badge>
                </CardTitle>
                <CardDescription>Define your rules. Track adherence. Build discipline.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {rules.length === 0 ? (
                  <div className="text-center text-muted-foreground py-4">
                    No rules defined yet. Add your trading rules to track discipline.
                  </div>
                ) : (
                  <>
                    {rules
                      .filter((r) => ruleFilter === "all" || r.category === ruleFilter)
                      .map((rule) => (
                        <RuleItem
                          key={rule.id}
                          rule={rule}
                          onToggle={(id, isActive) => toggleRuleMutation.mutate({ id, isActive })}
                          onDelete={(id) => deleteRuleMutation.mutate(id)}
                        />
                      ))}
                    {rules.filter((r) => ruleFilter === "all" || r.category === ruleFilter).length === 0 && (
                      <div className="text-center text-muted-foreground py-4">
                        No rules in this category
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="events">
            <Card>
              <CardHeader>
                <CardTitle>Recent Activity</CardTitle>
                <CardDescription>Your latest trade events and updates</CardDescription>
              </CardHeader>
              <CardContent>
                {dashboard?.recentEvents.length === 0 ? (
                  <div className="text-center text-muted-foreground py-4">
                    No recent events
                  </div>
                ) : (
                  <div className="space-y-1">
                    {dashboard?.recentEvents.map((event) => (
                      <EventItem key={event.id} event={event} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="ai" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-purple-500" />
                  AI-Suggested Rules
                </CardTitle>
                <CardDescription>
                  Rules learned from collective trading patterns across all users. Adopt rules that resonate with your style.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-end">
                  <Button 
                    onClick={() => analyzeRulesMutation.mutate()}
                    disabled={analyzeRulesMutation.isPending}
                    data-testid="button-analyze-rules"
                  >
                    <Brain className="w-4 h-4 mr-2" />
                    {analyzeRulesMutation.isPending ? "Analyzing..." : "Analyze Rule Patterns"}
                  </Button>
                </div>

                {suggestions.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Lightbulb className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p className="font-medium">No AI suggestions yet</p>
                    <p className="text-sm mt-1">Keep trading and closing trades to generate rule performance data.</p>
                    <p className="text-sm mt-1">Click "Analyze Rule Patterns" to generate suggestions based on your trading history.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {suggestions.map((suggestion) => (
                      <div 
                        key={suggestion.id} 
                        className="border rounded-lg p-4 bg-purple-500/5 border-purple-500/20"
                        data-testid={`suggestion-${suggestion.id}`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 flex-wrap mb-2">
                              <span className="font-medium">{suggestion.name}</span>
                              {suggestion.category && (
                                <Badge variant="outline" className="text-xs">{suggestion.category}</Badge>
                              )}
                              {suggestion.confidenceScore && (
                                <Badge className="bg-purple-500/20 text-purple-600 text-xs">
                                  {(suggestion.confidenceScore * 100).toFixed(0)}% confidence
                                </Badge>
                              )}
                              {suggestion.adoptionCount !== undefined && suggestion.adoptionCount > 0 && (
                                <Badge variant="secondary" className="text-xs">
                                  {suggestion.adoptionCount} adopted
                                </Badge>
                              )}
                            </div>
                            {suggestion.description && (
                              <p className="text-sm text-muted-foreground">{suggestion.description}</p>
                            )}
                            {suggestion.formula && (
                              <p className="text-xs font-mono bg-muted/50 px-2 py-1 rounded mt-2 inline-block">
                                {suggestion.formula}
                              </p>
                            )}
                            {suggestion.supportingData?.patternDescription && (
                              <p className="text-xs text-muted-foreground mt-2 italic">
                                Evidence: {suggestion.supportingData.patternDescription}
                              </p>
                            )}
                          </div>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={() => adoptSuggestionMutation.mutate(suggestion.id)}
                              disabled={adoptSuggestionMutation.isPending}
                              data-testid={`button-adopt-${suggestion.id}`}
                            >
                              <Plus className="w-4 h-4 mr-1" />
                              Adopt
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => dismissSuggestionMutation.mutate(suggestion.id)}
                              disabled={dismissSuggestionMutation.isPending}
                              data-testid={`button-dismiss-${suggestion.id}`}
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>How AI Learning Works</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p><strong>1. Trade & Track:</strong> As you close trades and record rule adherence, we track which rules correlate with wins.</p>
                <p><strong>2. Collective Patterns:</strong> Anonymized data from all users reveals which rules most reliably predict success.</p>
                <p><strong>3. AI Suggestions:</strong> Our AI analyzes patterns and suggests new rules with high win-rate correlation.</p>
                <p><strong>4. You Decide:</strong> Review suggestions and adopt the ones that fit your trading style.</p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <div className="mt-8 text-center">
          <a
            href="/"
            className="text-sm text-muted-foreground hover:text-foreground"
            data-testid="link-scanner"
          >
            Go to AI Swing Scanner
          </a>
        </div>
      </main>

      {/* Add to Watchlist Dialog */}
      <Dialog open={showAddWatchlist} onOpenChange={setShowAddWatchlist}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add to Watchlist</DialogTitle>
            <DialogDescription>Add a setup you're monitoring for entry</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="watchlist-symbol">Symbol</Label>
              <Input
                id="watchlist-symbol"
                placeholder="AAPL"
                value={watchlistForm.symbol}
                onChange={(e) => setWatchlistForm({ ...watchlistForm, symbol: e.target.value.toUpperCase() })}
                data-testid="input-watchlist-symbol"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="watchlist-entry">Target Entry Price</Label>
              <Input
                id="watchlist-entry"
                type="number"
                step="0.01"
                placeholder="150.00"
                value={watchlistForm.targetEntry}
                onChange={(e) => setWatchlistForm({ ...watchlistForm, targetEntry: e.target.value })}
                data-testid="input-watchlist-entry"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="watchlist-priority">Priority</Label>
              <Select value={watchlistForm.priority} onValueChange={(v) => setWatchlistForm({ ...watchlistForm, priority: v })}>
                <SelectTrigger data-testid="select-watchlist-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="watchlist-thesis">Thesis / Notes</Label>
              <Textarea
                id="watchlist-thesis"
                placeholder="Why are you watching this setup?"
                value={watchlistForm.thesis}
                onChange={(e) => setWatchlistForm({ ...watchlistForm, thesis: e.target.value })}
                data-testid="input-watchlist-thesis"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddWatchlist(false)}>Cancel</Button>
            <Button onClick={handleAddWatchlist} disabled={!watchlistForm.symbol || addWatchlistMutation.isPending} data-testid="button-confirm-add-watchlist">
              {addWatchlistMutation.isPending ? "Adding..." : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Rule Dialog */}
      <Dialog open={showAddRule} onOpenChange={setShowAddRule}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Trading Rule</DialogTitle>
            <DialogDescription>Define a rule to track your discipline</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="rule-name">Rule</Label>
              <Input
                id="rule-name"
                placeholder="e.g., Wait for pullback to 21 EMA"
                value={ruleForm.name}
                onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })}
                data-testid="input-rule-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rule-category">Category</Label>
              <Select value={ruleForm.category} onValueChange={(v) => setRuleForm({ ...ruleForm, category: v })}>
                <SelectTrigger data-testid="select-rule-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto_reject">Auto-Reject (Trade Fails)</SelectItem>
                  <SelectItem value="entry">Entry Timing</SelectItem>
                  <SelectItem value="exit">Exit / Profit Taking</SelectItem>
                  <SelectItem value="stop_loss">Stop Loss</SelectItem>
                  <SelectItem value="risk">Risk Management</SelectItem>
                  <SelectItem value="position_sizing">Position Sizing</SelectItem>
                  <SelectItem value="ma_structure">MA Structure</SelectItem>
                  <SelectItem value="base_quality">Base / Pattern Quality</SelectItem>
                  <SelectItem value="breakout">Breakout</SelectItem>
                  <SelectItem value="market_regime">Market Regime</SelectItem>
                  <SelectItem value="general">General</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rule-description">Description (optional)</Label>
              <Textarea
                id="rule-description"
                placeholder="More details about this rule..."
                value={ruleForm.description}
                onChange={(e) => setRuleForm({ ...ruleForm, description: e.target.value })}
                data-testid="input-rule-description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddRule(false)}>Cancel</Button>
            <Button onClick={handleAddRule} disabled={!ruleForm.name || addRuleMutation.isPending} data-testid="button-confirm-add-rule">
              {addRuleMutation.isPending ? "Adding..." : "Add Rule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
