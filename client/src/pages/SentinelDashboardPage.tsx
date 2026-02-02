import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useSentinelAuth } from "@/context/SentinelAuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, LogOut, TrendingUp, TrendingDown, AlertTriangle, Clock, CheckCircle } from "lucide-react";

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

export default function SentinelDashboardPage() {
  const [, setLocation] = useLocation();
  const { user, logout } = useSentinelAuth();
  const [activeTab, setActiveTab] = useState("considering");

  const { data: dashboard, isLoading, error } = useQuery<DashboardData>({
    queryKey: ["/api/sentinel/dashboard"],
  });

  const handleLogout = async () => {
    await logout();
    setLocation("/sentinel/login");
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
          <TabsList>
            <TabsTrigger value="considering" data-testid="tab-considering">
              Considering ({dashboard?.considering.length || 0})
            </TabsTrigger>
            <TabsTrigger value="active" data-testid="tab-active">
              Active ({dashboard?.active.length || 0})
            </TabsTrigger>
            <TabsTrigger value="events" data-testid="tab-events">
              Recent Events
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
    </div>
  );
}
