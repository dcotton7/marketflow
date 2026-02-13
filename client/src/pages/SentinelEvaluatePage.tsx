import { useState, useEffect, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSentinelAuth } from "@/context/SentinelAuthContext";
import { useSystemSettings } from "@/context/SystemSettingsContext";
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
import { ArrowLeft, AlertTriangle, TrendingUp, TrendingDown, Minus, Loader2, DollarSign, Hash, Info, CheckCircle2, XCircle, Clock, Eye, ListPlus, ThumbsDown, Zap, Target, Shield, Lightbulb, ArrowUpCircle, AlertOctagon, X, ChevronDown, ChevronUp, Crosshair, Scissors, HelpCircle, Newspaper, Building2, ExternalLink, BarChart3, Activity } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  riskPerShare: string;
  firstTrimProfit: string | null;
  firstTrimProfitPerShare: string | null;
  targetProfit: string | null;
  targetProfitPerShare: string | null;
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

interface LogicalStopSuggestion {
  price: number;
  label: string;
  distancePercent: number;
  reasoning: string;
  rank: number;
}

interface LogicalStops {
  userStopEval: string;
  suggestions: LogicalStopSuggestion[];
}

interface LogicalTargetSuggestion {
  price: number;
  label: string;
  distancePercent: number;
  rrRatio?: string;
  meetsRules?: string;
  reasoning: string;
}

interface LogicalTargets {
  userTargetEval: string;
  ruleCompliance?: string;
  suggestions: LogicalTargetSuggestion[];
  partialProfitIdea: string | null;
}

interface TradeSnapshot {
  good: string[];
  bad: string[];
}

interface EvaluationResult {
  tradeId: number;
  evaluation: {
    // Core decision gate
    score: number;
    status: 'GREEN' | 'YELLOW' | 'NEEDS_PLAN' | 'RED';
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
    
    tradeSnapshot?: TradeSnapshot;
    logicalStops?: LogicalStops;
    logicalTargets?: LogicalTargets;
    
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

interface StopSuggestion {
  price: number;
  label: string;
  description: string;
  riskPercent: number;
  rank: number;
}

interface TargetSuggestion {
  price: number;
  label: string;
  description: string;
  rrRatio: number;
  rank: number;
}

interface SuggestResponse {
  symbol: string;
  currentPrice: number;
  direction: "long" | "short";
  entryPrice: number;
  stopSuggestions: StopSuggestion[];
  targetSuggestions: TargetSuggestion[];
  positionSizeSuggestion?: {
    shares: number;
    dollarRisk: number;
    percentOfAccount: number;
  };
  technicalContext: string;
  fetchedAt: Date;
}

const STOP_PRICE_CHOICES = [
  { value: "LOD_TODAY", label: "LOD Today" },
  { value: "LOD_YESTERDAY", label: "Low of Yesterday" },
  { value: "ATR_1_5X", label: "1.5x ATR Stop" },
  { value: "5_DMA", label: "5d SMA" },
  { value: "10_DMA", label: "10d SMA" },
  { value: "20_DMA", label: "20d SMA" },
  { value: "50_DMA", label: "50d SMA" },
];

const TARGET_PRICE_CHOICES = [
  { value: "PREV_DAY_HIGH", label: "Previous Day High" },
  { value: "5_DAY_HIGH", label: "Past 5 Day High" },
  { value: "RR_1_5X", label: "1.5x Risk/Reward" },
  { value: "RR_2X", label: "2x Risk/Reward" },
  { value: "RR_3X", label: "3x Risk/Reward" },
];

const TARGET_PROFIT_CHOICES = [
  { value: "EXTENDED_8X_50DMA", label: "Extended 8x ADR over 50 DMA" },
  { value: "PREV_DAY_HIGH", label: "Previous Day High" },
  { value: "5_DAY_HIGH", label: "Past 5 Day High" },
  { value: "RR_5X", label: "5x Risk/Reward" },
  { value: "RR_8X", label: "8x Risk/Reward" },
  { value: "RR_10X", label: "10x Risk/Reward" },
];

function getTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function IndustryCompsTab({ symbol, onNavigateAway }: { symbol: string; onNavigateAway?: () => void }) {
  const [, setLocation] = useLocation();
  const { data: comps, isLoading } = useQuery<{
    sector: string;
    industry: string;
    etfs: { symbol: string; name: string; price: number; change: number; changePercent: number; volume: number }[];
    peers: { symbol: string; name: string; industry: string; price: number; change: number; changePercent: number; volume: number }[];
  }>({
    queryKey: ['/api/industry-comps', symbol],
    queryFn: async () => {
      const res = await fetch(`/api/industry-comps/${encodeURIComponent(symbol)}`);
      if (!res.ok) throw new Error('Failed to fetch comps');
      return res.json();
    },
    enabled: !!symbol,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!comps) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-muted-foreground">
          <Building2 className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>No industry data available for {symbol.toUpperCase()}</p>
        </CardContent>
      </Card>
    );
  }

  const CompRow = ({ item, showIndustry }: { item: { symbol: string; name: string; industry?: string; price: number; change: number; changePercent: number; volume: number }; showIndustry?: boolean }) => {
    const isPos = item.changePercent >= 0;
    return (
      <div 
        className="flex items-center justify-between gap-2 p-2.5 rounded-md border bg-muted/30 hover-elevate cursor-pointer flex-wrap"
        onClick={() => {
          if (onNavigateAway) onNavigateAway();
          sessionStorage.setItem('ivy_eval_return', JSON.stringify({
            returnTo: symbol,
            url: window.location.href,
          }));
          setLocation(`/symbol/${item.symbol}`);
        }}
        data-testid={`comp-row-${item.symbol}`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-bold font-mono text-sm text-primary">{item.symbol}</span>
          <span className="text-sm text-muted-foreground truncate">{item.name}</span>
          {showIndustry && item.industry && (
            <Badge variant="outline" className="text-xs shrink-0">{item.industry}</Badge>
          )}
        </div>
        <div className="flex items-center gap-3 text-sm shrink-0">
          <span className="font-mono font-bold">${item.price.toFixed(2)}</span>
          <span className={`flex items-center gap-1 font-mono font-medium ${isPos ? "text-rs-green" : "text-rs-red"}`}>
            {isPos ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {isPos ? "+" : ""}{item.change.toFixed(2)} ({item.changePercent.toFixed(2)}%)
          </span>
          <span className="text-xs text-muted-foreground">
            {item.volume > 1000000 ? `${(item.volume / 1000000).toFixed(1)}M` : `${(item.volume / 1000).toFixed(0)}K`}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Building2 className="w-4 h-4" />
        <span>{comps.sector}</span>
        <span className="text-muted-foreground/50">|</span>
        <span>{comps.industry}</span>
      </div>

      {comps.etfs.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-blue-400" />
              Sector ETFs
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {comps.etfs.map(etf => (
              <CompRow key={etf.symbol} item={etf} />
            ))}
          </CardContent>
        </Card>
      )}

      {comps.peers.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Building2 className="w-4 h-4 text-rs-amber" />
              Industry & Sector Peers
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {comps.peers.map(peer => (
              <CompRow key={peer.symbol} item={peer} showIndustry />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function NewsTab({ symbol }: { symbol: string }) {
  const { data: articles, isLoading } = useQuery<{
    id: number;
    title: string;
    url: string;
    source: string;
    publishedDate: string;
    description: string;
    tickers: string[];
  }[]>({
    queryKey: ['/api/news', symbol],
    queryFn: async () => {
      const res = await fetch(`/api/news/${encodeURIComponent(symbol)}`);
      if (!res.ok) throw new Error('Failed to fetch news');
      return res.json();
    },
    enabled: !!symbol,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!articles || articles.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-muted-foreground">
          <Newspaper className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>No recent news found for {symbol.toUpperCase()}</p>
          <p className="text-sm mt-2">News may not be available for all tickers.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {articles.map((article) => {
        const date = new Date(article.publishedDate);
        const timeAgo = getTimeAgo(date);
        return (
          <a
            key={article.id}
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block p-3 rounded-md border bg-muted/30 hover-elevate"
            data-testid={`news-article-${article.id}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <h4 className="text-sm font-medium text-foreground line-clamp-2">{article.title}</h4>
                {article.description && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{article.description}</p>
                )}
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <span className="text-xs text-muted-foreground">{article.source}</span>
                  <span className="text-xs text-muted-foreground/50">|</span>
                  <span className="text-xs text-muted-foreground">{timeAgo}</span>
                  {article.tickers.length > 1 && (
                    <div className="flex items-center gap-1">
                      {article.tickers.slice(0, 5).map(t => (
                        <Badge key={t} variant="outline" className="text-xs px-1 py-0">{t}</Badge>
                      ))}
                      {article.tickers.length > 5 && (
                        <span className="text-xs text-muted-foreground">+{article.tickers.length - 5}</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <ExternalLink className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
            </div>
          </a>
        );
      })}
    </div>
  );
}

export default function SentinelEvaluatePage() {
  const [, setLocation] = useLocation();
  const { user } = useSentinelAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { settings: systemSettings, cssVariables } = useSystemSettings();

  const urlParams = new URLSearchParams(window.location.search);
  const preloadTradeId = urlParams.get('tradeId');
  const fromParam = urlParams.get('from');
  const preloadSymbol = urlParams.get('symbol') || '';
  const preloadPrice = urlParams.get('price') || '';

  const [symbol, setSymbol] = useState(preloadSymbol);
  const [debouncedSymbol, setDebouncedSymbol] = useState(preloadSymbol ? preloadSymbol.toUpperCase() : "");
  const [direction, setDirection] = useState<"long" | "short">("long");
  const [entryPrice, setEntryPrice] = useState(preloadPrice);
  
  // Stop price
  const [stopPriceMode, setStopPriceMode] = useState<"amount" | "choice">("amount");
  const [stopPrice, setStopPrice] = useState("");
  const [stopPriceChoice, setStopPriceChoice] = useState("");
  const [stopLabel, setStopLabel] = useState("");
  
  // Target price
  const [targetPriceMode, setTargetPriceMode] = useState<"amount" | "choice">("amount");
  const [targetPrice, setTargetPrice] = useState("");
  const [targetPriceChoice, setTargetPriceChoice] = useState("");
  const [targetLabel, setTargetLabel] = useState("");
  
  // Target profit (full exit target)
  const [targetProfitMode, setTargetProfitMode] = useState<"amount" | "choice">("amount");
  const [targetProfitPrice, setTargetProfitPrice] = useState("");
  const [targetProfitChoice, setTargetProfitChoice] = useState("");
  const [targetProfitLabel, setTargetProfitLabel] = useState("");
  
  // Position size
  const [positionSizeUnit, setPositionSizeUnit] = useState<"shares" | "dollars">("shares");
  const [positionSize, setPositionSize] = useState("");
  
  const [thesis, setThesis] = useState("");
  const [setupType, setSetupType] = useState<string>("");
  const [deepEval, setDeepEval] = useState(false);
  const [historicalAnalysis, setHistoricalAnalysis] = useState(false);
  const [tradeDate, setTradeDate] = useState("");
  const [tradeTime, setTradeTime] = useState("");
  const [selectedLabelIds, setSelectedLabelIds] = useState<number[]>([]);
  const [historicalTags, setHistoricalTags] = useState<string[]>(["Historical"]);
  const [newTagInput, setNewTagInput] = useState("");
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);

  const [firstTrimExpanded, setFirstTrimExpanded] = useState(false);
  const [targetProfitExpanded, setTargetProfitExpanded] = useState(false);

  const [result, setResult] = useState<EvaluationResult | null>(null);
  const [isPreloaded, setIsPreloaded] = useState(false);
  const [ruleChecklistExpanded, setRuleChecklistExpanded] = useState(false);
  const [debugInfoExpanded, setDebugInfoExpanded] = useState(false);
  const [evalTab, setEvalTab] = useState("analysis");
  const [suggestions, setSuggestions] = useState<SuggestResponse | null>(null);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);

  // Restore saved evaluation state (when returning from chart/comp)
  useEffect(() => {
    if (fromParam === 'eval-return') {
      try {
        const saved = sessionStorage.getItem('ivy_eval_state');
        if (saved) {
          const state = JSON.parse(saved);
          if (state.symbol) setSymbol(state.symbol);
          if (state.debouncedSymbol) setDebouncedSymbol(state.debouncedSymbol);
          if (state.direction) setDirection(state.direction);
          if (state.entryPrice) setEntryPrice(state.entryPrice);
          if (state.stopPrice) setStopPrice(state.stopPrice);
          if (state.stopPriceMode) setStopPriceMode(state.stopPriceMode);
          if (state.stopPriceChoice) setStopPriceChoice(state.stopPriceChoice);
          if (state.stopLabel) setStopLabel(state.stopLabel);
          if (state.targetProfitPrice) setTargetProfitPrice(state.targetProfitPrice);
          if (state.targetProfitMode) setTargetProfitMode(state.targetProfitMode);
          if (state.targetProfitChoice) setTargetProfitChoice(state.targetProfitChoice);
          if (state.targetProfitLabel) setTargetProfitLabel(state.targetProfitLabel);
          if (state.targetPrice) setTargetPrice(state.targetPrice);
          if (state.targetPriceMode) setTargetPriceMode(state.targetPriceMode);
          if (state.targetPriceChoice) setTargetPriceChoice(state.targetPriceChoice);
          if (state.targetLabel) setTargetLabel(state.targetLabel);
          if (state.positionSize) setPositionSize(state.positionSize);
          if (state.positionSizeUnit) setPositionSizeUnit(state.positionSizeUnit);
          if (state.thesis) setThesis(state.thesis);
          if (state.setupType) setSetupType(state.setupType);
          if (state.deepEval != null) setDeepEval(state.deepEval);
          if (state.result) setResult(state.result);
          sessionStorage.removeItem('ivy_eval_state');
        }
      } catch (e) {
        console.error('Failed to restore eval state:', e);
      }
    }
  }, []);

  // Save evaluation state for returning later
  const saveEvalState = () => {
    try {
      const state = {
        symbol, debouncedSymbol, direction, entryPrice,
        stopPrice, stopPriceMode, stopPriceChoice, stopLabel,
        targetProfitPrice, targetProfitMode, targetProfitChoice, targetProfitLabel,
        targetPrice, targetPriceMode, targetPriceChoice, targetLabel,
        positionSize, positionSizeUnit, thesis, setupType, deepEval, result,
      };
      sessionStorage.setItem('ivy_eval_state', JSON.stringify(state));
    } catch (e) {
      console.error('Failed to save eval state:', e);
    }
  };

  // Fetch suggestions when symbol, direction, and entry are filled
  useEffect(() => {
    const entry = parseFloat(entryPrice);
    if (debouncedSymbol && debouncedSymbol.length >= 1 && direction && entry > 0) {
      setSuggestionsLoading(true);
      apiRequest("POST", "/api/sentinel/suggest", {
        symbol: debouncedSymbol.toUpperCase(),
        direction,
        entryPrice: entry,
        setupType: setupType || undefined,
      })
        .then((res) => res.json())
        .then((data) => {
          setSuggestions(data as SuggestResponse);
        })
        .catch((err) => {
          console.error("Failed to fetch suggestions:", err);
          setSuggestions(null);
        })
        .finally(() => {
          setSuggestionsLoading(false);
        });
    } else {
      setSuggestions(null);
    }
  }, [debouncedSymbol, direction, entryPrice, setupType]);

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
        if (trade.setupType) {
          setSetupType(trade.setupType);
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

  const prevSymbolRef = useRef<string | null>(null);
  useEffect(() => {
    if (tickerQuery.data?.currentPrice && debouncedSymbol) {
      if (prevSymbolRef.current !== debouncedSymbol) {
        setEntryPrice(tickerQuery.data.currentPrice.toFixed(2));
        prevSymbolRef.current = debouncedSymbol;
      }
    }
  }, [tickerQuery.data?.currentPrice, debouncedSymbol]);

  const evaluateMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/sentinel/evaluate", data);
      return await res.json();
    },
    onSuccess: (data) => {
      setResult(data);
      setRuleChecklistExpanded(false);
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
    if (setupType) data.setupType = setupType;

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
    if (score >= 70) return "text-rs-green";
    if (score >= 50) return "text-rs-yellow";
    return "text-rs-red";
  };

  const getSectorTrendColor = (state: 1 | 0 | -1) => {
    if (state === 1) return "bg-rs-green/20 text-rs-green border-rs-green/30";
    if (state === -1) return "bg-rs-red/20 text-rs-red border-rs-red/30";
    return "bg-rs-yellow/20 text-rs-yellow border-rs-yellow/30";
  };

  const SectorTrendIcon = ({ state }: { state: 1 | 0 | -1 }) => {
    if (state === 1) return <TrendingUp className="h-3 w-3" />;
    if (state === -1) return <TrendingDown className="h-3 w-3" />;
    return <Minus className="h-3 w-3" />;
  };

  return (
    <div 
      className="min-h-screen sentinel-page"
      style={{ 
        backgroundColor: cssVariables.backgroundColor,
        '--logo-opacity': cssVariables.logoOpacity,
        '--overlay-bg': cssVariables.overlayBg,
      } as React.CSSProperties}
    >
      {/* Watermark applied via background-image on container */}
      <header className="border-b" style={{ backgroundColor: cssVariables.headerBg }}>
        <div className="container mx-auto px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => {
              if (fromParam === 'bigidea') setLocation("/sentinel/bigidea");
              else if (fromParam === 'training') setLocation("/sentinel/pattern-training");
              else if (fromParam === 'watchlist') setLocation("/watchlist");
              else if (fromParam?.startsWith('trade:')) setLocation(`/sentinel/trade/${fromParam.split(':')[1]}`);
              else setLocation("/sentinel/dashboard");
            }} data-testid="button-back">
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <SentinelHeader showSentiment={true} />
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        {/* Ivy AI Branding */}
        <div className="mb-6">
          <h1 className="font-bold text-primary" style={{ fontSize: cssVariables.fontSizeTitle }} data-testid="ivy-ai-title">Ivy AI</h1>
          <p style={{ color: cssVariables.textColorSmall, fontSize: cssVariables.fontSizeSection }} data-testid="ivy-ai-subtitle">Advanced Trading Insights</p>
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
                            <span className="font-semibold" style={{ color: cssVariables.textColorHeader, fontSize: cssVariables.fontSizeHeader }} data-testid="text-ticker-name">{tickerQuery.data.name}</span>
                            <Badge variant="outline" className="text-xs" data-testid="badge-ticker-symbol">{tickerQuery.data.symbol}</Badge>
                          </div>
                          <div className="rs-ticker" data-testid="ticker-display">
                            <span className="rs-ticker-price" data-testid="text-current-price">
                              ${tickerQuery.data.currentPrice?.toFixed(2)}
                            </span>
                            {tickerQuery.data.previousClose > 0 && (() => {
                              const change = tickerQuery.data.currentPrice - tickerQuery.data.previousClose;
                              const changePct = (change / tickerQuery.data.previousClose) * 100;
                              const isPositive = change >= 0;
                              return (
                                <span className={isPositive ? 'rs-ticker-change-up' : 'rs-ticker-change-down'} data-testid="text-price-change">
                                  {isPositive ? '+' : ''}{change.toFixed(2)} ({isPositive ? '+' : ''}{changePct.toFixed(2)}%)
                                </span>
                              );
                            })()}
                          </div>
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
                  <Label htmlFor="setupType">Setup Type</Label>
                  <Select value={setupType} onValueChange={setSetupType}>
                    <SelectTrigger data-testid="select-setup-type">
                      <SelectValue placeholder="Select setup pattern..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="breakout">Breakout</SelectItem>
                      <SelectItem value="pullback">Pullback</SelectItem>
                      <SelectItem value="cup_and_handle">Cup and Handle</SelectItem>
                      <SelectItem value="vcp">VCP (Volatility Contraction Pattern)</SelectItem>
                      <SelectItem value="episodic_pivot">Episodic Pivot</SelectItem>
                      <SelectItem value="reclaim">Reclaim</SelectItem>
                      <SelectItem value="high_tight_flag">High Tight Flag</SelectItem>
                      <SelectItem value="low_cheat">Low Cheat Setup</SelectItem>
                      <SelectItem value="undercut_rally">Undercut and Rally</SelectItem>
                      <SelectItem value="orb">Opening Range Breakout (ORB)</SelectItem>
                      <SelectItem value="short_lost_50">SHORT: Lost 50 SMA</SelectItem>
                      <SelectItem value="short_lost_200">SHORT: Lost 200 SMA</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {suggestions?.technicalContext && (
                  <div className="p-2 bg-blue-500/10 border border-blue-500/30 rounded text-xs text-muted-foreground" data-testid="technical-context">
                    <div className="flex items-center gap-1 mb-1">
                      <Info className="w-3 h-3 text-blue-400" />
                      <span className="text-blue-400 font-medium">Technical Context</span>
                    </div>
                    {suggestions.technicalContext}
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

                <div className="space-y-3 p-3 bg-muted/30 rounded-md border">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Label className="font-medium">Position Size</Label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <HelpCircle className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs">
                          <p className="text-xs">How many shares or how much dollar value you're putting into this trade. Used to calculate total risk in real dollars.</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
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
                  {positionSize && entryPrice && (() => {
                    const entry = parseFloat(entryPrice);
                    const size = parseFloat(positionSize);
                    if (!entry || !size || entry <= 0 || size <= 0) return null;
                    const shares = positionSizeUnit === "shares" ? size : Math.round(size / entry);
                    const total = positionSizeUnit === "shares" ? size * entry : size;
                    return (
                      <p className="text-xs text-muted-foreground" data-testid="text-position-total">
                        {shares.toLocaleString()} shares x ${entry.toFixed(2)} = <span className="font-medium text-foreground">${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </p>
                    );
                  })()}
                  
                  {suggestions?.positionSizeSuggestion && stopPrice && (
                    <div className="flex items-center gap-2 mt-2">
                      <Zap className="w-3 h-3 text-rs-amber" />
                      <Badge
                        variant="outline"
                        className="cursor-pointer text-xs hover:bg-rs-amber/20 border-rs-amber/30"
                        onClick={() => {
                          setPositionSize(suggestions.positionSizeSuggestion!.shares.toString());
                          setPositionSizeUnit("shares");
                        }}
                        data-testid="badge-position-suggestion"
                      >
                        <span className="font-medium">1% Risk:</span>
                        <span className="ml-1">{suggestions.positionSizeSuggestion.shares} shares</span>
                        <span className="text-muted-foreground ml-1">(${suggestions.positionSizeSuggestion.dollarRisk})</span>
                      </Badge>
                    </div>
                  )}
                </div>
                <div className="space-y-3 p-3 bg-muted/30 rounded-md border">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Label className="font-medium">Stop Price</Label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <HelpCircle className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs">
                          <p className="text-xs">Where you'll exit if the trade goes against you. Choose a preset level or enter a specific price. Your stop should be at a logical support level.</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
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
                      onChange={(e) => { setStopPrice(e.target.value); setStopLabel(""); }}
                      placeholder="145.00"
                    />
                  ) : (
                    <Select value={stopPriceChoice} onValueChange={(v) => { setStopPriceChoice(v); setStopLabel(STOP_PRICE_CHOICES.find(c => c.value === v)?.label || ""); }}>
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
                  
                  {/* AI Stop Suggestions */}
                  {stopPriceMode === "amount" && (suggestionsLoading || (suggestions && suggestions.stopSuggestions.length > 0)) && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Zap className="w-3 h-3 text-rs-amber" />
                        <span className="text-xs text-muted-foreground">AI Suggestions</span>
                        {suggestionsLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                      </div>
                      <div className="flex flex-wrap gap-1.5" data-testid="stop-suggestions">
                        {suggestions?.stopSuggestions.slice(0, 5).map((s, i) => (
                          <Badge
                            key={i}
                            variant="outline"
                            className="cursor-pointer text-xs hover:bg-rs-red/20 border-rs-red/30"
                            onClick={() => {
                              setStopPrice(s.price.toString());
                              setStopPriceMode("amount");
                              setStopLabel(s.label);
                            }}
                            data-testid={`badge-stop-suggestion-${i}`}
                          >
                            <span className="font-medium">{s.label}</span>
                            <span className="text-muted-foreground ml-1">${s.price}</span>
                            <span className="text-rs-red ml-1">({s.riskPercent.toFixed(1)}%)</span>
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {/* Real-time risk calculation */}
                  {stopPriceMode === "amount" && stopPrice && entryPrice && (
                    <div className="mt-2 p-2 bg-rs-red/10 border border-rs-red/30 rounded text-sm" data-testid="risk-calculation">
                      {(() => {
                        const entry = parseFloat(entryPrice);
                        const stop = parseFloat(stopPrice);
                        const shares = positionSize 
                          ? (positionSizeUnit === "shares" 
                            ? parseFloat(positionSize) 
                            : Math.round(parseFloat(positionSize) / entry)) 
                          : 0;
                        const riskPerShare = direction === "long" ? entry - stop : stop - entry;
                        const totalRisk = shares > 0 ? riskPerShare * shares : 0;
                        
                        if (isNaN(entry) || isNaN(stop)) return null;
                        
                        return (
                          <div className="flex flex-col gap-1">
                            <span className="text-rs-red font-medium">
                              Risk: ${Math.abs(riskPerShare).toFixed(2)} / share
                            </span>
                            {shares > 0 && (
                              <span className="text-rs-red font-medium">
                                Total Risk: ${Math.abs(totalRisk).toFixed(2)} ({shares} shares)
                              </span>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>

                <div className="p-3 bg-muted/30 rounded-md border">
                  <div
                    className="flex items-center justify-between cursor-pointer"
                    onClick={() => setFirstTrimExpanded(!firstTrimExpanded)}
                    data-testid="toggle-first-trim"
                  >
                    <div className="flex items-center gap-1.5">
                      <Label className="font-medium cursor-pointer">First Profit Trim (optional)</Label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <HelpCircle className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs">
                          <p className="text-xs">Optional: Set a level to take partial profits (typically 30% of position). This locks in gains and reduces risk on the remaining position.</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    {firstTrimExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </div>
                  {firstTrimExpanded && (
                    <div className="space-y-3 mt-3">
                      <div className="flex items-center justify-end">
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
                          onChange={(e) => { setTargetPrice(e.target.value); setTargetLabel(""); }}
                          placeholder="165.00"
                        />
                      ) : (
                        <Select value={targetPriceChoice} onValueChange={(v) => { setTargetPriceChoice(v); setTargetLabel(TARGET_PRICE_CHOICES.find(c => c.value === v)?.label || ""); }}>
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
                      
                      {targetPriceMode === "amount" && targetPrice && entryPrice && (
                        <div className="mt-2 p-2 bg-rs-green/10 border border-rs-green/30 rounded text-sm" data-testid="first-trim-calculation">
                          {(() => {
                            const entry = parseFloat(entryPrice);
                            const target = parseFloat(targetPrice);
                            const shares = positionSize 
                              ? (positionSizeUnit === "shares" 
                                ? parseFloat(positionSize) 
                                : Math.round(parseFloat(positionSize) / entry)) 
                              : 0;
                            const gainPerShare = direction === "long" ? target - entry : entry - target;
                            const trimShares = Math.round(shares * 0.3);
                            const totalGain = trimShares > 0 ? gainPerShare * trimShares : 0;
                            
                            if (isNaN(entry) || isNaN(target)) return null;
                            
                            return (
                              <div className="flex flex-col gap-1">
                                <span className="text-rs-green font-medium">
                                  Gain: ${gainPerShare.toFixed(2)} / share
                                </span>
                                {shares > 0 && (
                                  <span className="text-rs-green font-medium">
                                    First Trim (30%): ${totalGain.toFixed(2)} ({trimShares} shares)
                                  </span>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      )}
                      
                      {targetPriceMode === "amount" && (suggestionsLoading || (suggestions && suggestions.targetSuggestions.length > 0)) && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <Target className="w-3 h-3 text-rs-green" />
                            <span className="text-xs text-muted-foreground">AI Suggestions</span>
                            {suggestionsLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                          </div>
                          <div className="flex flex-wrap gap-1.5" data-testid="target-suggestions">
                            {suggestions?.targetSuggestions.slice(0, 5).map((t, i) => (
                              <Badge
                                key={i}
                                variant="outline"
                                className="cursor-pointer text-xs hover:bg-rs-green/20 border-rs-green/30"
                                onClick={() => {
                                  setTargetPrice(t.price.toString());
                                  setTargetPriceMode("amount");
                                }}
                                data-testid={`badge-target-suggestion-${i}`}
                              >
                                <span className="font-medium">{t.label}</span>
                                <span className="text-muted-foreground ml-1">${t.price}</span>
                                <span className="text-rs-green ml-1">({t.rrRatio}:1)</span>
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="p-3 bg-muted/30 rounded-md border">
                  <div
                    className="flex items-center justify-between cursor-pointer"
                    onClick={() => setTargetProfitExpanded(!targetProfitExpanded)}
                    data-testid="toggle-target-profit"
                  >
                    <div className="flex items-center gap-1.5">
                      <Label className="font-medium cursor-pointer">Profit Target (optional)</Label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <HelpCircle className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs">
                          <p className="text-xs">Optional: Set your full exit target for the remaining position. If you set a first trim, this applies to the remaining 70% of shares.</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    {targetProfitExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </div>
                  {targetProfitExpanded && (
                    <div className="space-y-3 mt-3">
                      <div className="flex items-center justify-end">
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
                          onChange={(e) => { setTargetProfitPrice(e.target.value); setTargetProfitLabel(""); }}
                          placeholder="180.00"
                        />
                      ) : (
                        <Select value={targetProfitChoice} onValueChange={(v) => { setTargetProfitChoice(v); setTargetProfitLabel(TARGET_PROFIT_CHOICES.find(c => c.value === v)?.label || ""); }}>
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
                      
                      {targetProfitMode === "amount" && targetProfitPrice && entryPrice && (
                        <div className="mt-2 p-2 bg-rs-green/10 border border-rs-green/30 rounded text-sm" data-testid="target-profit-calculation">
                          {(() => {
                            const entry = parseFloat(entryPrice);
                            const target = parseFloat(targetProfitPrice);
                            const shares = positionSize 
                              ? (positionSizeUnit === "shares" 
                                ? parseFloat(positionSize) 
                                : Math.round(parseFloat(positionSize) / entry)) 
                              : 0;
                            const gainPerShare = direction === "long" ? target - entry : entry - target;
                            const remainingShares = Math.round(shares * 0.7);
                            const totalGain = remainingShares > 0 ? gainPerShare * remainingShares : 0;
                            
                            if (isNaN(entry) || isNaN(target)) return null;
                            
                            return (
                              <div className="flex flex-col gap-1">
                                <span className="text-rs-green font-medium">
                                  Gain: ${gainPerShare.toFixed(2)} / share
                                </span>
                                {shares > 0 && (
                                  <span className="text-rs-green font-medium">
                                    Target (70%): ${totalGain.toFixed(2)} ({remainingShares} shares)
                                  </span>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      )}
                      
                      {targetProfitMode === "amount" && (suggestionsLoading || (suggestions && suggestions.targetSuggestions.length > 0)) && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <Target className="w-3 h-3 text-rs-green" />
                            <span className="text-xs text-muted-foreground">AI Suggestions (Full Exit)</span>
                            {suggestionsLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                          </div>
                          <div className="flex flex-wrap gap-1.5" data-testid="target-profit-suggestions">
                            {suggestions?.targetSuggestions.slice(0, 5).map((t, i) => (
                              <Badge
                                key={i}
                                variant="outline"
                                className="cursor-pointer text-xs hover:bg-rs-green/20 border-rs-green/30"
                                onClick={() => {
                                  setTargetProfitPrice(t.price.toString());
                                  setTargetProfitMode("amount");
                                }}
                                data-testid={`badge-target-profit-suggestion-${i}`}
                              >
                                <span className="font-medium">{t.label}</span>
                                <span className="text-muted-foreground ml-1">${t.price}</span>
                                <span className="text-rs-green ml-1">({t.rrRatio}:1)</span>
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="thesis">Trade Thesis (optional)</Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        <p className="text-xs">What's your edge? Why are you taking this trade? Be specific about the catalyst, pattern, or setup you see.</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
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
                      <div className="flex items-center gap-1.5">
                        <Label htmlFor="deepEval" className="font-medium">Deep Evaluation</Label>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <HelpCircle className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs">
                            <p className="text-xs">Deep uses a more advanced AI model for nuanced pattern recognition, deeper contextual reasoning, and more thorough stop/target analysis. Standard is good for most trades.</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
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
                  result.evaluation.status === 'GREEN' ? 'border-l-[hsl(var(--rs-green))]' :
                  result.evaluation.status === 'RED' ? 'border-l-[hsl(var(--rs-red))]' :
                  result.evaluation.status === 'NEEDS_PLAN' ? 'border-l-[hsl(var(--rs-amber))]' : 'border-l-[hsl(var(--rs-yellow))]'
                }`}>
                  <CardContent className="pt-4">
                    {/* Ticker / Direction / Model Tag Header */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="font-bold" style={{ color: cssVariables.textColorTitle, fontSize: cssVariables.fontSizeTitle }} data-testid="text-symbol-result">{symbol.toUpperCase()}</span>
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
                    
                    {/* Verdict Summary - Risk Summary at top */}
                    {result.evaluation.verdictSummary && (
                      <div className={`p-3 rounded-md mb-3 ${
                        result.evaluation.status === 'GREEN' ? 'bg-rs-green/10 border border-rs-green/30' :
                        result.evaluation.status === 'RED' ? 'bg-rs-red/10 border border-rs-red/30' :
                        result.evaluation.status === 'NEEDS_PLAN' ? 'bg-rs-amber/10 border border-rs-amber/30' : 'bg-rs-yellow/10 border border-rs-yellow/30'
                      }`} data-testid="verdict-summary">
                        <p className="font-medium mb-1" style={{ color: cssVariables.textColorTiny, fontSize: cssVariables.fontSizeTiny }}>Verdict:</p>
                        <p className="font-medium" style={{ color: cssVariables.textColorNormal, fontSize: cssVariables.fontSizeNormal }}>{result.evaluation.verdictSummary.verdict}</p>
                        {result.evaluation.verdictSummary.primaryBlockers && result.evaluation.verdictSummary.primaryBlockers.length > 0 && (
                          <div className="mt-3">
                            <p className="font-medium mb-1.5" style={{ color: cssVariables.textColorTiny, fontSize: cssVariables.fontSizeTiny }}>Risk Summary</p>
                            <div className="flex flex-wrap gap-1.5">
                              {result.evaluation.verdictSummary.primaryBlockers.map((blocker, i) => (
                                <Badge key={i} variant="outline" className="text-xs border-rs-red/30 text-rs-red bg-rs-red/10" data-testid={`badge-risk-summary-${i}`}>
                                  {blocker}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Decision Gate - Top of results */}
                    <div className={`p-4 rounded-md mb-3 ${
                      result.evaluation.status === 'GREEN' ? 'bg-rs-green/10 border border-rs-green/30' :
                      result.evaluation.status === 'RED' ? 'bg-rs-red/10 border border-rs-red/30' :
                      result.evaluation.status === 'NEEDS_PLAN' ? 'bg-rs-amber/10 border border-rs-amber/30' : 'bg-rs-yellow/10 border border-rs-yellow/30'
                    }`} data-testid="decision-gate">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {result.evaluation.status === 'GREEN' ? (
                            <CheckCircle2 className="w-8 h-8 text-rs-green" />
                          ) : result.evaluation.status === 'RED' ? (
                            <XCircle className="w-8 h-8 text-rs-red" />
                          ) : result.evaluation.status === 'NEEDS_PLAN' ? (
                            <AlertTriangle className="w-8 h-8 text-rs-amber" />
                          ) : (
                            <AlertTriangle className="w-8 h-8 text-rs-yellow" />
                          )}
                          <div>
                            <p className={`font-bold ${
                              result.evaluation.status === 'GREEN' ? 'text-rs-green' :
                              result.evaluation.status === 'RED' ? 'text-rs-red' :
                              result.evaluation.status === 'NEEDS_PLAN' ? 'text-rs-amber' : 'text-rs-yellow'
                            }`} style={{ fontSize: cssVariables.fontSizeHeader }} data-testid="text-status">
                              {result.evaluation.status === 'NEEDS_PLAN' ? 'NEEDS PLAN' : result.evaluation.status}
                            </p>
                            <p style={{ color: cssVariables.textColorSmall, fontSize: cssVariables.fontSizeSmall }}>Decision Gate</p>
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

                    {/* Plan Summary */}
                    {result.evaluation.planSummary && (
                      <div className={`mb-3 p-3 rounded border ${
                        result.evaluation.status === 'GREEN' ? 'bg-rs-green/10 border-rs-green/30' :
                        result.evaluation.status === 'RED' ? 'bg-rs-red/10 border-rs-red/30' :
                        result.evaluation.status === 'NEEDS_PLAN' ? 'bg-rs-amber/10 border-rs-amber/30' : 'bg-rs-yellow/10 border-rs-yellow/30'
                      }`} data-testid="plan-summary">
                        <p className={`text-base font-semibold ${
                          result.evaluation.status === 'GREEN' ? 'text-rs-green' :
                          result.evaluation.status === 'RED' ? 'text-rs-red' :
                          result.evaluation.status === 'NEEDS_PLAN' ? 'text-rs-amber' : 'text-rs-yellow'
                        }`}>
                          Your Plan: Entry {result.evaluation.planSummary.entry}
                          {result.evaluation.planSummary.stop && <> | Stop {result.evaluation.planSummary.stop}{stopLabel ? <span className="text-muted-foreground text-sm"> ({stopLabel})</span> : null}</>}
                          {result.evaluation.planSummary.riskPerShare && <> | Risk/share {result.evaluation.planSummary.riskPerShare}</>}
                          {result.evaluation.planSummary.firstTrim && <> | First Trim {result.evaluation.planSummary.firstTrim}{targetLabel ? <span className="text-muted-foreground text-sm"> ({targetLabel})</span> : null}</>}
                          {result.evaluation.planSummary.target && <> | Target {result.evaluation.planSummary.target}{targetProfitLabel ? <span className="text-muted-foreground text-sm"> ({targetProfitLabel})</span> : null}</>}
                          {result.evaluation.planSummary.rrRatio && <> | R:R {result.evaluation.planSummary.rrRatio}</>}
                        </p>
                      </div>
                    )}

                    {/* Money Breakdown - Real Dollars */}
                    {result.evaluation.moneyBreakdown && (
                      <div className="p-3 rounded-md mb-3 bg-blue-500/10 border border-blue-500/30" data-testid="money-breakdown">
                        <p className="text-sm font-medium mb-2 flex items-center gap-2">
                          <DollarSign className="w-4 h-4 text-blue-400" />
                          Your Risk/Reward Breakdown
                        </p>
                        {(() => {
                          const planStop = result.evaluation.planSummary?.stop;
                          const planStopNum = planStop ? parseFloat(String(planStop).replace(/[^0-9.-]/g, '')) : 0;
                          const hasStop = (stopPrice && parseFloat(stopPrice) > 0) || (stopPriceChoice && stopPriceChoice !== "none") || (planStopNum > 0);
                          const hasTarget = (targetPrice && parseFloat(targetPrice) > 0) || (targetProfitPrice && parseFloat(targetProfitPrice) > 0) || (targetPriceChoice && targetPriceChoice !== "none") || (targetProfitChoice && targetProfitChoice !== "none");
                          const hasBoth = hasStop && hasTarget;
                          
                          if (!hasStop && !hasTarget) {
                            return (
                              <div className="text-sm text-rs-amber italic p-2 bg-rs-amber/10 rounded">
                                Define a stop loss and profit target to see your risk/reward breakdown. Check Ivy's suggested levels below.
                              </div>
                            );
                          }
                          
                          return (
                            <div className="space-y-2 text-sm">
                              {!hasStop && (
                                <div className="text-xs text-rs-amber italic mb-1">
                                  No stop defined — risk calculations require a stop loss level. See Ivy's suggestions below.
                                </div>
                              )}
                              {!hasTarget && (
                                <div className="text-xs text-rs-amber italic mb-1">
                                  No target defined — profit calculations require a target price. See Ivy's suggestions below.
                                </div>
                              )}
                              {hasStop && (
                                <div className="space-y-1">
                                  <div className="flex flex-wrap gap-x-2 gap-y-1 items-baseline">
                                    <span className="text-muted-foreground text-xs">Your Stop{stopLabel ? ` (${stopLabel})` : ''}:</span>
                                    <span className="font-bold text-rs-red">{result.evaluation.planSummary?.stop || stopPrice}</span>
                                  </div>
                                  <div className="flex flex-wrap gap-x-6 gap-y-1">
                                    <span>
                                      <span className="text-muted-foreground">Risking: </span>
                                      <span className="font-bold text-rs-red">
                                        {(() => {
                                          const rps = result.evaluation.planSummary?.riskPerShare;
                                          if (!rps) return "—";
                                          const num = parseFloat(String(rps).replace(/[^0-9.-]/g, ''));
                                          return isNaN(num) ? rps : `$${Math.abs(num).toFixed(2)}`;
                                        })()} / Share
                                      </span>
                                    </span>
                                    <span>
                                      <span className="text-muted-foreground">Total Risk: </span>
                                      <span className="font-bold text-rs-red">
                                        {(() => {
                                          const tr = result.evaluation.moneyBreakdown.totalRisk;
                                          if (!tr) return "—";
                                          const num = parseFloat(String(tr).replace(/[^0-9.-]/g, ''));
                                          return isNaN(num) ? tr : `$${Math.abs(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                                        })()}
                                      </span>
                                    </span>
                                  </div>
                                </div>
                              )}
                              
                              {hasTarget && (
                                <div className="space-y-1">
                                  {(targetLabel || targetProfitLabel) && (
                                    <div className="flex flex-wrap gap-x-4 gap-y-1 items-baseline">
                                      {targetLabel && result.evaluation.planSummary?.firstTrim && (
                                        <span>
                                          <span className="text-muted-foreground text-xs">Your First Trim ({targetLabel}):</span>{' '}
                                          <span className="font-bold text-rs-green">{result.evaluation.planSummary.firstTrim}</span>
                                        </span>
                                      )}
                                      {targetProfitLabel && result.evaluation.planSummary?.target && (
                                        <span>
                                          <span className="text-muted-foreground text-xs">Your Target ({targetProfitLabel}):</span>{' '}
                                          <span className="font-bold text-rs-green">{result.evaluation.planSummary.target}</span>
                                        </span>
                                      )}
                                    </div>
                                  )}
                                  <div className="flex flex-wrap gap-x-6 gap-y-1">
                                  {result.evaluation.moneyBreakdown.firstTrimProfitPerShare && (
                                    <span>
                                      <span className="text-muted-foreground">First Profit @ 30% Trim: </span>
                                      <span className="font-bold text-rs-green">
                                        {(() => {
                                          const val = result.evaluation.moneyBreakdown.firstTrimProfitPerShare;
                                          const num = parseFloat(String(val).replace(/[^0-9.-]/g, ''));
                                          return isNaN(num) ? `+${val}` : `+$${Math.abs(num).toFixed(2)}`;
                                        })()}/share
                                      </span>
                                    </span>
                                  )}
                                  {result.evaluation.moneyBreakdown.targetProfitPerShare && (
                                    <span>
                                      <span className="text-muted-foreground">Target @ 70%: </span>
                                      <span className="font-bold text-rs-green">
                                        {(() => {
                                          const val = result.evaluation.moneyBreakdown.targetProfitPerShare;
                                          const num = parseFloat(String(val).replace(/[^0-9.-]/g, ''));
                                          return isNaN(num) ? `+${val}` : `+$${Math.abs(num).toFixed(2)}`;
                                        })()}/share
                                      </span>
                                    </span>
                                  )}
                                  </div>
                                </div>
                              )}
                              
                              {hasBoth && (
                                <div className="pt-1 border-t border-blue-500/30">
                                  <span className="text-muted-foreground">Total Gain: </span>
                                  <span className="font-bold text-rs-green">
                                    {(() => {
                                      const val = result.evaluation.moneyBreakdown.totalPotentialProfit;
                                      if (!val) return "—";
                                      const num = parseFloat(String(val).replace(/[^0-9.-]/g, ''));
                                      return isNaN(num) ? `+${val}` : `+$${Math.abs(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                                    })()}
                                  </span>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                        
                        {/* More Info Section - How the numbers are calculated */}
                        <div className="mt-3 pt-2 border-t border-blue-500/20" data-testid="more-info">
                          <button
                            type="button"
                            className="text-xs text-white/40 hover:text-white/60 flex items-center gap-1 cursor-pointer"
                            onClick={() => setDebugInfoExpanded(!debugInfoExpanded)}
                            data-testid="button-toggle-more-info"
                          >
                            <ChevronDown className={`w-3 h-3 transition-transform ${debugInfoExpanded ? 'rotate-0' : '-rotate-90'}`} />
                            More Info
                          </button>
                          {debugInfoExpanded && (
                            <div className="text-xs text-white/70 space-y-2 mt-2">
                              <div className="space-y-1">
                                <p className="text-white/50 font-medium">How these numbers are calculated:</p>
                                {(() => {
                                  const entry = parseFloat(entryPrice) || 0;
                                  const stop = parseFloat(stopPrice) || 0;
                                  const target1 = parseFloat(targetPrice) || 0;
                                  const target2 = parseFloat(targetProfitPrice) || 0;
                                  const shares = positionSize 
                                    ? (positionSizeUnit === "shares" 
                                      ? parseFloat(positionSize) 
                                      : Math.round(parseFloat(positionSize) / entry)) 
                                    : 0;
                                  const hasStopVal = stop > 0;
                                  const hasTargetVal = target1 > 0 || target2 > 0;
                                  
                                  if (!hasStopVal && !hasTargetVal) {
                                    return <p className="text-rs-amber italic">Provide a stop loss and target price to see detailed calculations.</p>;
                                  }
                                  
                                  const riskPerShare = hasStopVal ? (direction === "long" ? entry - stop : stop - entry) : 0;
                                  const totalRisk = riskPerShare * shares;
                                  const firstTrimGain = target1 > 0 
                                    ? (direction === "long" ? (target1 - entry) * (shares * 0.3) : (entry - target1) * (shares * 0.3))
                                    : 0;
                                  const targetGain = target2 > 0 
                                    ? (direction === "long" ? (target2 - entry) * (shares * 0.7) : (entry - target2) * (shares * 0.7))
                                    : 0;
                                  const totalGain = firstTrimGain + targetGain;
                                  
                                  return (
                                    <>
                                      {hasStopVal ? (
                                        <>
                                          <p>Risk per share = |Entry ${entry.toFixed(2)} - Stop ${stop.toFixed(2)}| = <span className="text-rs-red font-medium">${Math.abs(riskPerShare).toFixed(2)}</span></p>
                                          <p>Total risk = ${Math.abs(riskPerShare).toFixed(2)} x {shares} shares = <span className="text-rs-red font-medium">${Math.abs(totalRisk).toFixed(2)}</span></p>
                                        </>
                                      ) : (
                                        <p className="text-rs-amber italic">No stop defined — risk per share not calculated</p>
                                      )}
                                      {target1 > 0 && (
                                        <p>First trim (30% of shares): sell {Math.round(shares * 0.3)} shares at ${target1.toFixed(2)} = <span className="text-rs-green">+${firstTrimGain.toFixed(2)}</span></p>
                                      )}
                                      {target2 > 0 && (
                                        <p>Remaining (70% of shares): sell {Math.round(shares * 0.7)} shares at ${target2.toFixed(2)} = <span className="text-rs-green">+${targetGain.toFixed(2)}</span></p>
                                      )}
                                      {hasTargetVal && <p>Total potential gain = <span className="text-rs-green font-medium">+${totalGain.toFixed(2)}</span></p>}
                                      {riskPerShare > 0 && totalGain > 0 && (
                                        <p>Overall R:R = {(totalGain / totalRisk).toFixed(1)}:1</p>
                                      )}
                                    </>
                                  );
                                })()}
                              </div>
                              {(stopPriceMode === "choice" || targetPriceMode === "choice" || targetProfitMode === "choice") && (
                                <div className="pt-1 border-t border-blue-500/10 text-white/40 italic">
                                  <p>Stop: {stopPriceMode !== "amount" ? `[${stopPriceChoice || "none"}] resolved to ${result.evaluation.planSummary?.stop || "pending"}` : "user entered"}</p>
                                  {targetPriceMode !== "amount" && <p>First Trim: [{targetPriceChoice || "none"}] resolved to {result.evaluation.planSummary?.firstTrim || "pending"}</p>}
                                  {targetProfitMode !== "amount" && <p>Target: [{targetProfitChoice || "none"}] resolved to {result.evaluation.planSummary?.target || "pending"}</p>}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Tabs value={evalTab} onValueChange={setEvalTab} className="w-full">
                  <TabsList className="w-full grid grid-cols-3">
                    <TabsTrigger value="analysis" data-testid="tab-analysis">Trade Analysis</TabsTrigger>
                    <TabsTrigger value="comps" data-testid="tab-comps">Industry Comps</TabsTrigger>
                    <TabsTrigger value="news" data-testid="tab-news">News</TabsTrigger>
                  </TabsList>

                  <TabsContent value="analysis" className="space-y-4 mt-4">
                {result.evaluation.tradeSnapshot ? (
                  <Card data-testid="trade-snapshot">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <TrendingUp className="w-4 h-4 text-rs-green" />
                        Trade Snapshot
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <CheckCircle2 className="w-4 h-4 text-rs-green" />
                            <span className="text-sm font-medium text-rs-green">What Works</span>
                          </div>
                          <ul className="space-y-1.5">
                            {result.evaluation.tradeSnapshot.good.map((item, i) => (
                              <li key={i} className="text-sm flex items-start gap-2">
                                <ArrowUpCircle className="w-4 h-4 text-rs-green mt-0.5 shrink-0" />
                                <span>{item}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <AlertTriangle className="w-4 h-4 text-rs-yellow" />
                            <span className="text-sm font-medium text-rs-yellow">Watch Out For</span>
                          </div>
                          <ul className="space-y-1.5">
                            {result.evaluation.tradeSnapshot.bad.map((item, i) => (
                              <li key={i} className="text-sm flex items-start gap-2">
                                <AlertTriangle className="w-4 h-4 text-rs-yellow mt-0.5 shrink-0" />
                                <span>{item}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ) : result.evaluation.whyBullets && result.evaluation.whyBullets.length > 0 ? (
                  <Card data-testid="trade-snapshot">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Target className="w-4 h-4 text-rs-green" />
                        Why This Could Work
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-1.5" data-testid="why-bullets">
                        {result.evaluation.whyBullets.map((bullet, i) => (
                          <li key={i} className="text-sm flex items-start gap-2">
                            <ArrowUpCircle className="w-4 h-4 text-rs-green mt-0.5 shrink-0" />
                            <span>{bullet}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                ) : null}

                {result.evaluation.logicalStops && (
                  <Card data-testid="logical-stops">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Crosshair className="w-4 h-4 text-rs-red" />
                        Stop Level Analysis
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="p-3 bg-muted/50 rounded-md text-sm text-foreground">
                        {result.evaluation.logicalStops.userStopEval}
                        {(() => {
                          const ep = parseFloat(entryPrice) || 0;
                          const sp = parseFloat(stopPrice) || 0;
                          const riskPS = ep > 0 && sp > 0 ? Math.abs(ep - sp) : 0;
                          const shares = positionSize && ep > 0
                            ? (positionSizeUnit === "shares" ? parseFloat(positionSize) || 0 : Math.round((parseFloat(positionSize) || 0) / ep))
                            : 0;
                          const totalRisk = riskPS * shares;
                          if (riskPS > 0) {
                            return (
                              <span className="block mt-2 text-rs-red font-medium">
                                Risk: ${riskPS.toFixed(2)}/share{shares > 0 ? ` | Total: $${totalRisk.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} at risk` : ''}
                              </span>
                            );
                          }
                          return null;
                        })()}
                      </div>
                      <p className="text-sm font-medium text-muted-foreground mt-1">Alternate Stop Options:</p>
                      <div className="space-y-2">
                        {result.evaluation.logicalStops.suggestions.map((s, i) => {
                          const rankColor = s.rank === 1 ? "bg-rs-yellow/20 text-rs-yellow border-rs-yellow/30" :
                            s.rank === 2 ? "bg-gray-400/20 text-gray-300 border-gray-400/30" :
                            "bg-rs-amber/20 text-rs-amber border-rs-amber/30";
                          const userStop = parseFloat(stopPrice) || 0;
                          const matchesUserStop = userStop > 0 && Math.abs(s.price - userStop) < 0.02;
                          const ep = parseFloat(entryPrice) || 0;
                          const stopRiskPS = ep > 0 && s.price > 0 ? Math.abs(ep - s.price) : 0;
                          const stopShares = positionSize && ep > 0
                            ? (positionSizeUnit === "shares" ? parseFloat(positionSize) || 0 : Math.round((parseFloat(positionSize) || 0) / ep))
                            : 0;
                          const stopTotalRisk = stopRiskPS * stopShares;
                          return (
                            <div key={i} className="p-3 rounded-md border bg-muted/30">
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <Badge variant="outline" className={`text-xs ${rankColor}`}>#{s.rank}</Badge>
                                <span className="font-medium text-sm">{s.label}</span>
                                <span className="text-sm font-bold text-rs-red">${s.price.toFixed(2)}</span>
                                <span className="text-xs text-muted-foreground">{s.distancePercent.toFixed(1)}% from entry</span>
                                {matchesUserStop && (
                                  <Badge variant="outline" className="text-xs bg-rs-green/10 text-rs-green border-rs-green/30">
                                    Confirms your stop
                                  </Badge>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground">{s.reasoning}</p>
                              {stopRiskPS > 0 && (
                                <span className="block mt-1 text-xs text-rs-red font-medium">
                                  Risk: ${stopRiskPS.toFixed(2)}/share{stopShares > 0 ? ` | Total: $${stopTotalRisk.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} at risk` : ''}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {result.evaluation.logicalTargets && (
                  <Card data-testid="logical-targets">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Target className="w-4 h-4 text-rs-green" />
                        Take Profit Targets
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="p-3 bg-muted/50 rounded-md text-sm text-foreground">
                        {result.evaluation.logicalTargets.userTargetEval}
                      </div>
                      {result.evaluation.logicalTargets.ruleCompliance && 
                       !result.evaluation.logicalTargets.ruleCompliance.toLowerCase().includes('no target rule') && (
                        <div className={`p-2 rounded-md text-sm font-medium flex items-center gap-2 ${
                          result.evaluation.logicalTargets.ruleCompliance.toLowerCase().includes('meets') 
                            ? 'bg-rs-green/10 text-rs-green border border-rs-green/30' 
                            : 'bg-rs-amber/10 text-rs-amber border border-rs-amber/30'
                        }`} data-testid="text-rule-compliance">
                          {result.evaluation.logicalTargets.ruleCompliance.toLowerCase().includes('meets') 
                            ? <CheckCircle2 className="w-4 h-4" />
                            : <AlertTriangle className="w-4 h-4" />
                          }
                          {result.evaluation.logicalTargets.ruleCompliance}
                        </div>
                      )}

                      {/* Target Price Summary Table */}
                      {(() => {
                        const ep = parseFloat(entryPrice) || 0;
                        const sp = parseFloat(stopPrice) || 0;
                        const isLong = direction === "long";
                        const riskPS = ep > 0 && sp > 0 ? Math.abs(ep - sp) : 0;
                        const shares = positionSize && ep > 0
                          ? (positionSizeUnit === "shares" ? parseFloat(positionSize) || 0 : Math.round((parseFloat(positionSize) || 0) / ep))
                          : 0;
                        const minRR = 2;
                        const minTargetPrice = riskPS > 0 && ep > 0 ? (isLong ? ep + (riskPS * minRR) : ep - (riskPS * minRR)) : 0;
                        const minProfitPerShare = minTargetPrice > 0 ? Math.abs(minTargetPrice - ep) : 0;
                        const minProfitPct = ep > 0 && minProfitPerShare > 0 ? (minProfitPerShare / ep * 100) : 0;
                        const minTotalProfit = minProfitPerShare * shares;

                        const userEnteredTP = parseFloat(targetProfitPrice) || 0;
                        const userTP = userEnteredTP;
                        const userProfitPS = userTP > 0 && ep > 0 ? Math.abs(userTP - ep) : 0;
                        const userProfitPct = ep > 0 && userProfitPS > 0 ? (userProfitPS / ep * 100) : 0;
                        const userTotalProfit = userProfitPS * shares;
                        const userTargetLabel = "Your Target";

                        const aiSugg = result.evaluation.logicalTargets.suggestions?.[0];
                        const aiTP = aiSugg?.price || 0;
                        const aiProfitPS = aiTP > 0 && ep > 0 ? Math.abs(aiTP - ep) : 0;
                        const aiProfitPct = ep > 0 && aiProfitPS > 0 ? (aiProfitPS / ep * 100) : 0;
                        const aiTotalProfit = aiProfitPS * shares;

                        return (
                          <div className="space-y-1.5">
                            {minTargetPrice > 0 && (
                              <div className="p-2.5 rounded-md border bg-muted/30 flex items-center justify-between flex-wrap gap-2" data-testid="min-target-rule">
                                <div className="flex items-center gap-2">
                                  <Shield className="w-4 h-4 text-blue-400 shrink-0" />
                                  <span className="text-sm font-medium">Min {minRR}:1 R:R Target</span>
                                </div>
                                <div className="flex items-center gap-3 text-sm">
                                  <span className="font-bold text-blue-400">${minTargetPrice.toFixed(2)}</span>
                                  <span className="text-muted-foreground">+${minProfitPerShare.toFixed(2)}/sh (+{minProfitPct.toFixed(1)}%)</span>
                                  {shares > 0 && <span className="text-rs-green font-medium">+${minTotalProfit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}
                                </div>
                              </div>
                            )}
                            {userTP > 0 && (
                              <div className="p-2.5 rounded-md border bg-muted/30 flex items-center justify-between flex-wrap gap-2" data-testid="user-target">
                                <div className="flex items-center gap-2">
                                  <Target className="w-4 h-4 text-rs-green shrink-0" />
                                  <span className="text-sm font-medium">{userTargetLabel}</span>
                                </div>
                                <div className="flex items-center gap-3 text-sm">
                                  <span className="font-bold text-rs-green">${userTP.toFixed(2)}</span>
                                  <span className="text-muted-foreground">+${userProfitPS.toFixed(2)}/sh (+{userProfitPct.toFixed(1)}%)</span>
                                  {shares > 0 && <span className="text-rs-green font-medium">+${userTotalProfit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}
                                  {riskPS > 0 && (
                                    <Badge variant="outline" className="text-xs bg-rs-green/10 text-rs-green border-rs-green/30">
                                      R:R {(userProfitPS / riskPS).toFixed(1)}:1
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            )}
                            {aiTP > 0 && aiTP !== userTP && (() => {
                              const resistPct = aiSugg?.distancePercent ?? aiProfitPct;
                              const rColor = resistPct < 3
                                ? { border: 'border-rs-red/30', bg: 'bg-rs-red/10', text: 'text-rs-red', badgeBg: 'bg-rs-red/10', badgeBorder: 'border-rs-red/30' }
                                : resistPct < 6
                                ? { border: 'border-rs-amber/30', bg: 'bg-rs-amber/10', text: 'text-rs-amber', badgeBg: 'bg-rs-amber/10', badgeBorder: 'border-rs-amber/30' }
                                : { border: 'border-rs-green/30', bg: 'bg-rs-green/10', text: 'text-rs-green', badgeBg: 'bg-rs-green/10', badgeBorder: 'border-rs-green/30' };
                              return (
                              <div className={`p-2.5 rounded-md border-2 ${rColor.border} ${rColor.bg} flex flex-col gap-1.5`} data-testid="ai-target">
                                <div className="flex items-center justify-between flex-wrap gap-2">
                                  <div className="flex items-center gap-2">
                                    <Zap className={`w-4 h-4 ${rColor.text} shrink-0`} />
                                    <span className={`text-sm font-bold ${rColor.text}`}>Key Resistance{aiSugg?.label ? `: ${aiSugg.label}` : ''}</span>
                                  </div>
                                  <div className="flex items-center gap-3 text-sm">
                                    <span className={`font-bold ${rColor.text}`}>${aiTP.toFixed(2)}</span>
                                    <span className="text-muted-foreground">{resistPct.toFixed(1)}% from entry</span>
                                    <span className="text-muted-foreground">+${aiProfitPS.toFixed(2)}/sh (+{aiProfitPct.toFixed(1)}%)</span>
                                    {shares > 0 && <span className={`${rColor.text} font-medium`}>+${aiTotalProfit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}
                                    {aiSugg?.rrRatio && (
                                      <Badge variant="outline" className={`text-xs ${rColor.badgeBg} ${rColor.text} ${rColor.badgeBorder}`}>
                                        R:R {aiSugg.rrRatio}
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                                {aiSugg?.reasoning && (
                                  <p className="text-xs text-foreground/80">{aiSugg.reasoning}</p>
                                )}
                              </div>
                              );
                            })()}
                          </div>
                        );
                      })()}

                      {result.evaluation.logicalTargets.suggestions.length > 1 && (
                        <div className="space-y-2 mt-2">
                          <p className="text-sm font-medium text-muted-foreground">Other Levels:</p>
                          {result.evaluation.logicalTargets.suggestions.slice(1).map((s, i) => {
                            const sPct = s.distancePercent ?? 0;
                            const sColor = sPct < 3
                              ? { text: 'text-rs-red', badgeBg: 'bg-rs-red/10', badgeBorder: 'border-rs-red/30', border: 'border-rs-red/30' }
                              : sPct < 6
                              ? { text: 'text-rs-amber', badgeBg: 'bg-rs-amber/10', badgeBorder: 'border-rs-amber/30', border: 'border-rs-amber/30' }
                              : { text: 'text-rs-green', badgeBg: 'bg-rs-green/10', badgeBorder: 'border-rs-green/30', border: 'border-rs-green/30' };
                            return (
                            <div key={i} className={`p-3 rounded-md border ${sColor.border} bg-muted/30`}>
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <span className="font-medium text-sm">{s.label}</span>
                                <span className={`text-sm font-bold ${sColor.text}`}>${s.price.toFixed(2)}</span>
                                <span className="text-xs text-muted-foreground">{sPct.toFixed(1)}% from entry</span>
                                {s.rrRatio && (
                                  <Badge variant="outline" className={`text-xs ${sColor.badgeBg} ${sColor.text} ${sColor.badgeBorder}`}>
                                    R:R {s.rrRatio}
                                  </Badge>
                                )}
                                {s.meetsRules != null && String(s.meetsRules).trim() && (
                                  (() => {
                                    const val = String(s.meetsRules).toLowerCase();
                                    const isPass = val === 'true' || val.includes('yes') || val.includes('meets');
                                    const isFail = val === 'false' || val.includes('no');
                                    return (
                                      <Badge variant="outline" className={`text-xs ${
                                        isPass
                                          ? 'bg-rs-green/10 text-rs-green border-rs-green/30'
                                          : 'bg-rs-amber/10 text-rs-amber border-rs-amber/30'
                                      }`}>
                                        {isPass ? 'Meets Rules' : isFail ? 'Below Target' : String(s.meetsRules)}
                                      </Badge>
                                    );
                                  })()
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground">{s.reasoning}</p>
                            </div>
                            );
                          })}
                        </div>
                      )}
                      {result.evaluation.logicalTargets.partialProfitIdea && (
                        <div className="p-3 rounded-md bg-rs-amber/10 border border-rs-amber/30">
                          <div className="flex items-center gap-2 mb-1">
                            <Scissors className="w-4 h-4 text-rs-amber" />
                            <span className="text-sm font-medium text-rs-amber">Partial Profit Idea</span>
                          </div>
                          <p className="text-sm text-foreground">{result.evaluation.logicalTargets.partialProfitIdea}</p>
                        </div>
                      )}
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
                          <Shield className="w-4 h-4 text-rs-yellow" />
                          Risk Assessment
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {fatalFlags.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-rs-red mb-1.5">Structural Issues (Must Fix)</p>
                            <div className="space-y-1.5" data-testid="risk-flags-fatal">
                              {fatalFlags.map((f, i) => (
                                <div key={i} className="p-2 rounded border bg-rs-red/10 border-rs-red/30">
                                  <div className="flex items-start gap-2">
                                    <AlertOctagon className="w-4 h-4 shrink-0 mt-0.5 text-rs-red" />
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
                            <p className="text-xs font-semibold text-rs-yellow mb-1.5">Contextual Concerns</p>
                            <div className="space-y-1.5" data-testid="risk-flags-contextual">
                              {contextualFlags.map((f, i) => (
                                <div key={i} className="p-2 rounded border bg-rs-yellow/10 border-rs-yellow/30">
                                  <div className="flex items-start gap-2">
                                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rs-yellow" />
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

                {/* Improvements Section */}
                {result.evaluation.improvements && result.evaluation.improvements.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2 text-rs-green">
                        <Lightbulb className="w-4 h-4 text-rs-green" />
                        What Would Make This Better
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-1.5" data-testid="improvements">
                        {result.evaluation.improvements.map((improvement, i) => (
                          <li key={i} className="text-sm flex items-start gap-2 text-foreground">
                            <Zap className="w-4 h-4 text-rs-green mt-0.5 shrink-0" />
                            <span>{improvement}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}

                {/* Rule Checklist Section - Collapsible */}
                {result.evaluation.ruleChecklist && result.evaluation.ruleChecklist.length > 0 && (() => {
                  const checklist = result.evaluation.ruleChecklist;
                  const followed = checklist.filter(r => r.status === 'followed').length;
                  const violated = checklist.filter(r => r.status === 'violated').length;
                  const applicable = followed + violated;
                  const naCount = checklist.filter(r => r.status === 'na').length;
                  const percentage = applicable > 0 ? Math.round((followed / applicable) * 100) : 100;
                  
                  // Quality label based on percentage
                  let qualityLabel: string;
                  let qualityColor: string;
                  if (percentage >= 95) {
                    qualityLabel = "Excellent";
                    qualityColor = "text-rs-green";
                  } else if (percentage >= 85) {
                    qualityLabel = "Solid";
                    qualityColor = "text-rs-green";
                  } else if (percentage >= 70) {
                    qualityLabel = "Acceptable";
                    qualityColor = "text-rs-yellow";
                  } else {
                    qualityLabel = "Needs Work";
                    qualityColor = "text-rs-red";
                  }
                  
                  return (
                    <Card>
                      <CardHeader 
                        className="pb-2 cursor-pointer hover-elevate" 
                        onClick={() => setRuleChecklistExpanded(!ruleChecklistExpanded)}
                        data-testid="rule-checklist-header"
                      >
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-base flex items-center gap-2">
                            <Info className="w-4 h-4" />
                            Rule Checklist
                          </CardTitle>
                          <div className="flex items-center gap-2">
                            <span className={`text-sm font-medium ${qualityColor}`} data-testid="text-quality-label">{qualityLabel}</span>
                            {ruleChecklistExpanded ? (
                              <ChevronUp className="w-4 h-4 text-muted-foreground" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-muted-foreground" />
                            )}
                          </div>
                        </div>
                        <CardDescription className="flex items-center gap-3 mt-1">
                          <span className="flex items-center gap-1" data-testid="text-rules-summary">
                            <CheckCircle2 className="w-3 h-3 text-rs-green" />
                            {followed} of {applicable} rules satisfied ({percentage}%)
                          </span>
                          {violated > 0 && (
                            <span className="flex items-center gap-1 text-rs-red" data-testid="text-rules-violated">
                              <XCircle className="w-3 h-3" />
                              {violated} violated
                            </span>
                          )}
                          {naCount > 0 && (
                            <span className="flex items-center gap-1 text-muted-foreground text-xs" data-testid="text-rules-na">
                              ({naCount} N/A)
                            </span>
                          )}
                        </CardDescription>
                      </CardHeader>
                      {ruleChecklistExpanded && (
                        <CardContent>
                          <div className="space-y-1" data-testid="rule-checklist">
                            {checklist.map((item, i) => (
                              <div key={i} className="flex items-center gap-2 text-sm py-1">
                                {item.status === 'followed' ? (
                                  <CheckCircle2 className="w-4 h-4 text-rs-green" />
                                ) : item.status === 'violated' ? (
                                  <XCircle className="w-4 h-4 text-rs-red" />
                                ) : (
                                  <Minus className="w-4 h-4 text-muted-foreground" />
                                )}
                                <span className={item.status === 'violated' ? 'text-rs-red' : ''}>{item.rule}</span>
                                {item.note && <span className="text-xs text-muted-foreground">- {item.note}</span>}
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      )}
                    </Card>
                  );
                })()}

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
                        onClick={async () => {
                          try {
                            await apiRequest("POST", "/api/sentinel/watchlist", {
                              symbol: symbol.toUpperCase(),
                              thesis: thesis || `Evaluated via Ivy AI - Score: ${result?.evaluation?.score || '?'}/100`,
                            });
                            toast({ title: "Added to Watchlist", description: `${symbol.toUpperCase()} added for monitoring` });
                          } catch (err: any) {
                            toast({ title: "Could not add to watchlist", description: err?.message || "Something went wrong", variant: "destructive" });
                          }
                        }}
                        data-testid="button-watchlist"
                      >
                        <ListPlus className="w-4 h-4" />
                        Add to Watchlist
                      </Button>
                      <Button
                        variant="outline"
                        className="gap-2 text-rs-red hover:text-rs-red col-span-2"
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
                  </TabsContent>

                  <TabsContent value="comps" className="mt-4">
                    <IndustryCompsTab symbol={symbol} onNavigateAway={saveEvalState} />
                  </TabsContent>

                  <TabsContent value="news" className="mt-4">
                    <NewsTab symbol={symbol} />
                  </TabsContent>
                </Tabs>
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
