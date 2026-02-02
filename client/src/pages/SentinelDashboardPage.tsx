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
import { Plus, LogOut, TrendingUp, TrendingDown, AlertTriangle, Clock, CheckCircle, Eye, Crosshair, BookOpen, X, DollarSign } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface TradeWithEvaluation {
  id: number;
  symbol: string;
  direction: string;
  entryPrice: number;
  stopPrice?: number;
  targetPrice?: number;
  status: string;
  createdAt: string;
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
}

interface DashboardData {
  considering: TradeWithEvaluation[];
  active: TradeWithEvaluation[];
  recentEvents: TradeEvent[];
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
    <Link href={`/sentinel/trade/${trade.id}`}>
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
  const categoryColors = {
    entry: "bg-blue-500/10 text-blue-500",
    exit: "bg-green-500/10 text-green-500",
    sizing: "bg-purple-500/10 text-purple-500",
    risk: "bg-red-500/10 text-red-500",
    general: "bg-muted text-muted-foreground",
  };

  return (
    <div className={`flex items-center justify-between p-3 border rounded-md ${!rule.isActive ? 'opacity-50' : ''}`} data-testid={`rule-${rule.id}`}>
      <div className="flex items-center gap-3 flex-1">
        <input
          type="checkbox"
          checked={rule.isActive}
          onChange={(e) => onToggle(rule.id, e.target.checked)}
          className="w-4 h-4"
          data-testid={`checkbox-rule-${rule.id}`}
        />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{rule.name}</span>
            {rule.category && (
              <Badge className={categoryColors[rule.category as keyof typeof categoryColors] || categoryColors.general}>
                {rule.category}
              </Badge>
            )}
          </div>
          {rule.description && (
            <p className="text-sm text-muted-foreground mt-1">{rule.description}</p>
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

  const { data: dashboard, isLoading, error } = useQuery<DashboardData>({
    queryKey: ["/api/sentinel/dashboard"],
  });

  const { data: watchlist = [] } = useQuery<WatchlistItem[]>({
    queryKey: ["/api/sentinel/watchlist"],
  });

  const { data: rules = [] } = useQuery<TradingRule[]>({
    queryKey: ["/api/sentinel/rules"],
  });

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
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-dashboard-title">SENTINEL</h1>
            <p className="text-sm text-muted-foreground italic">Judgment before risk.</p>
          </div>
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
            <TabsTrigger value="events" data-testid="tab-events">
              Events
            </TabsTrigger>
          </TabsList>

          <TabsContent value="considering" className="space-y-4">
            {dashboard?.considering.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-center text-muted-foreground">
                  No trades under consideration. Click "New Evaluation" to get started.
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {dashboard?.considering.map((trade) => (
                  <TradeCard key={trade.id} trade={trade} />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="active" className="space-y-4">
            {dashboard?.active.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-center text-muted-foreground">
                  No active trades. Commit a trade to start tracking it.
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {dashboard?.active.map((trade) => (
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
            <div className="flex justify-end">
              <Button onClick={() => setShowAddRule(true)} data-testid="button-add-rule">
                <Plus className="w-4 h-4 mr-2" />
                Add Rule
              </Button>
            </div>
            <Card>
              <CardHeader>
                <CardTitle>My Trading Rules</CardTitle>
                <CardDescription>Define your rules. Track adherence. Build discipline.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {rules.length === 0 ? (
                  <div className="text-center text-muted-foreground py-4">
                    No rules defined yet. Add your trading rules to track discipline.
                  </div>
                ) : (
                  rules.map((rule) => (
                    <RuleItem
                      key={rule.id}
                      rule={rule}
                      onToggle={(id, isActive) => toggleRuleMutation.mutate({ id, isActive })}
                      onDelete={(id) => deleteRuleMutation.mutate(id)}
                    />
                  ))
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
                  <SelectItem value="entry">Entry</SelectItem>
                  <SelectItem value="exit">Exit</SelectItem>
                  <SelectItem value="sizing">Position Sizing</SelectItem>
                  <SelectItem value="risk">Risk Management</SelectItem>
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
