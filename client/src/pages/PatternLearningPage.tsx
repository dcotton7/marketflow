import { useState, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useSentinelAuth } from "@/context/SentinelAuthContext";
import { useSystemSettings } from "@/context/SystemSettingsContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Brain, Send, Play, Save, RefreshCw, Loader2,
  ThumbsDown, ThumbsUp, Minus, Star, ChevronRight, ChevronLeft,
  TrendingUp, Clock, BarChart3, Target, AlertCircle, Plus, Edit, Check, X, ExternalLink,
  Gauge, Activity, Zap, CheckCircle2, XCircle
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { SentinelHeader } from "@/components/SentinelHeader";
import { PatternChart } from "@/components/PatternChart";
import { PATTERN_TYPES, PATTERN_TIMEFRAMES, RATING_LABELS, RATING_SCORE_RANGES, MARKET_PHASES, SECTOR_PERFORMANCE, SetupConfidence } from "@shared/schema";

interface Setup {
  id: number;
  patternType: string;
  timeframe: string;
  name: string;
  description?: string;
  formula?: string;
  requiredTechnicals?: {
    indicators: string[];
    overlays?: string[];
    volumeRequired?: boolean;
  };
  formulaParams?: Record<string, number | string | undefined>;
  version: number;
  isActive: boolean;
}

interface PatternMatch {
  ticker: string;
  matchDate: string;
  conditions: {
    breakoutPct?: number;
    volumeRatio?: number;
    pullbackDepth?: number;
    maDistance?: number;
  };
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// V2 Interfaces
interface MasterSetup {
  id: number;
  name: string;
  description?: string;
  defaultStages?: string[];
  invalidationRules?: Record<string, any>;
}

interface SetupVariant {
  id: number;
  masterSetupId: number;
  name: string;
  timeframe: string;
  duration?: string;
  chartPeriod: string;
}

interface FormationStage {
  id: number;
  masterSetupId: number;
  stageType: string;
  stageOrder: number;
  description?: string;
  isTerminal: boolean;
  scoreModifier: number;
  typicalMinDuration?: number;
  typicalMaxDuration?: number;
  tooLongThreshold?: number;
}

interface RatingResult {
  ticker: string;
  setupName: string;
  variantName: string;
  formationStage?: string;
  scores: Record<string, number>;
  breakdown: Record<string, number>;
  totalScore: number;
  rawScore: number;
  humanRating: number;
  humanRatingLabel: string;
  confidence: number;
  summary: string;
  keyStrengths: string[];
  keyWeaknesses: string[];
  recommendation: string;
  stageModifier: number;
}

const RATING_COLORS = {
  1: "bg-rs-red/20 border-rs-red text-rs-red",
  2: "bg-rs-amber/20 border-rs-amber text-rs-amber",
  3: "bg-rs-yellow/20 border-rs-yellow text-rs-yellow",
  4: "bg-blue-500/20 border-blue-500 text-blue-400",
  5: "bg-rs-green/20 border-rs-green text-rs-green",
};

const RATING_ICONS = {
  1: XCircle,
  2: ThumbsDown,
  3: Minus,
  4: Clock,
  5: Star,
};

const SCORE_COLORS: Record<string, string> = {
  proceed: "text-rs-green",
  wait: "text-rs-yellow",
  avoid: "text-rs-red",
};

export default function PatternLearningPage() {
  const { user } = useSentinelAuth();
  const { toast } = useToast();
  const { settings: systemSettings, cssVariables } = useSystemSettings();
  
  const [activeTab, setActiveTab] = useState<string>("v2");
  
  // V2 State
  const [selectedMasterSetupId, setSelectedMasterSetupId] = useState<number | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<number | null>(null);
  const [selectedStageId, setSelectedStageId] = useState<number | null>(null);
  const [ratingTicker, setRatingTicker] = useState<string>("");
  const [ratingContext, setRatingContext] = useState<string>("");
  const [ratingMarketPhase, setRatingMarketPhase] = useState<string>("");
  const [ratingSectorPerf, setRatingSectorPerf] = useState<string>("");
  const [ratingStockStage, setRatingStockStage] = useState<string>("1");
  const [ratingPriorAttempts, setRatingPriorAttempts] = useState<number>(0);
  const [ratingResult, setRatingResult] = useState<RatingResult | null>(null);
  const [isRating, setIsRating] = useState(false);
  
  // Legacy V1 State
  const [selectedSetupId, setSelectedSetupId] = useState<number | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  
  const [newSetup, setNewSetup] = useState({
    name: "",
    description: "",
    formula: "",
    patternType: "custom",
    timeframe: "daily",
  });
  
  const [currentFormula, setCurrentFormula] = useState<Record<string, any> | null>(null);
  const [extractedTechnicals, setExtractedTechnicals] = useState<string[]>([]);
  const [chartTimeframe, setChartTimeframe] = useState<string>("D");
  const [chartPeriod, setChartPeriod] = useState<string>("6mo");
  
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: "I'm ready to help you refine your trading setup. Select a setup or create a new one, then run a test to find matches. Rate the matches and provide feedback - I'll learn from your input to improve the detection formula." }
  ]);
  const [chatInput, setChatInput] = useState("");
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [feedbackInput, setFeedbackInput] = useState("");
  
  const [patternMatches, setPatternMatches] = useState<PatternMatch[]>([]);
  const [ratings, setRatings] = useState<Record<string, { rating: number; feedback: string }>>({});

  const { data: setups = [], isLoading: setupsLoading } = useQuery<Setup[]>({
    queryKey: ['/api/pattern-learning/rules'],
  });

  const selectedSetup = setups.find(s => s.id === selectedSetupId);

  const { data: confidence } = useQuery<SetupConfidence | null>({
    queryKey: ['/api/pattern-learning/confidence', selectedSetupId],
    enabled: !!selectedSetupId,
  });

  // V2 Queries
  const { data: masterSetups = [] } = useQuery<MasterSetup[]>({
    queryKey: ['/api/pattern-learning/v2/setups'],
  });

  const { data: variants = [] } = useQuery<SetupVariant[]>({
    queryKey: ['/api/pattern-learning/v2/variants', selectedMasterSetupId],
    enabled: !!selectedMasterSetupId,
  });

  const { data: stages = [] } = useQuery<FormationStage[]>({
    queryKey: ['/api/pattern-learning/v2/stages', selectedMasterSetupId],
    enabled: !!selectedMasterSetupId,
  });

  const selectedMasterSetup = masterSetups.find(s => s.id === selectedMasterSetupId);
  const selectedVariant = variants.find(v => v.id === selectedVariantId);
  const selectedStage = stages.find(s => s.id === selectedStageId);

  // Auto-select first variant when master setup changes
  useEffect(() => {
    if (variants.length > 0 && !selectedVariantId) {
      setSelectedVariantId(variants[0].id);
      setChartTimeframe(variants[0].timeframe === 'daily' ? 'D' : variants[0].timeframe === 'weekly' ? 'W' : 'D');
      setChartPeriod(variants[0].chartPeriod || '6mo');
    }
  }, [variants, selectedVariantId]);

  // Update chart settings when variant changes
  useEffect(() => {
    if (selectedVariant) {
      const tf = selectedVariant.timeframe;
      setChartTimeframe(tf === 'daily' ? 'D' : tf === 'weekly' ? 'W' : tf === 'intraday_5m' ? '5' : tf === 'intraday_15m' ? '15' : 'D');
      setChartPeriod(selectedVariant.chartPeriod || '6mo');
    }
  }, [selectedVariant]);

  const handleRatePattern = async () => {
    if (!ratingTicker || !selectedVariantId) {
      toast({ title: "Missing Info", description: "Please enter a ticker and select a variant", variant: "destructive" });
      return;
    }
    
    setIsRating(true);
    try {
      const response = await apiRequest('POST', '/api/pattern-learning/v2/rate', {
        ticker: ratingTicker.toUpperCase(),
        variantId: selectedVariantId,
        formationStageId: selectedStageId,
        chartContext: ratingContext,
        marketPhase: ratingMarketPhase,
        sectorPerformance: ratingSectorPerf,
        stockStage: ratingStockStage,
        priorAttemptCount: ratingPriorAttempts,
      });
      
      if (!response.ok) throw new Error('Rating failed');
      const result = await response.json();
      setRatingResult(result);
      toast({ title: "Pattern Rated", description: `Score: ${result.totalScore}/100 (${result.recommendation})` });
    } catch (error) {
      toast({ title: "Rating Failed", description: "Could not rate the pattern", variant: "destructive" });
    } finally {
      setIsRating(false);
    }
  };

  const handleSaveExample = async () => {
    if (!ratingResult || !selectedVariantId) return;
    
    try {
      const response = await apiRequest('POST', '/api/pattern-learning/v2/save-example', {
        ticker: ratingTicker.toUpperCase(),
        setupVariantId: selectedVariantId,
        formationStageId: selectedStageId,
        humanRating: ratingResult.humanRating,
        aiScore: ratingResult.totalScore,
        criteriaScores: ratingResult.scores,
        chartContext: ratingContext,
        marketPhase: ratingMarketPhase,
        sectorPerformance: ratingSectorPerf,
        stockStage: ratingStockStage,
        priorAttemptCount: ratingPriorAttempts,
      });
      
      if (!response.ok) throw new Error('Failed to save');
      toast({ title: "Example Saved", description: "This rating has been saved for learning" });
    } catch (error) {
      toast({ title: "Save Failed", description: "Could not save the example", variant: "destructive" });
    }
  };

  const createSetupMutation = useMutation({
    mutationFn: async (setup: typeof newSetup) => {
      const response = await apiRequest('POST', '/api/pattern-learning/rules', setup);
      if (!response.ok) throw new Error('Failed to create setup');
      return response.json();
    },
    onSuccess: (data) => {
      toast({ title: "Setup Created", description: `"${data.name}" has been created` });
      setSelectedSetupId(data.id);
      setShowCreateDialog(false);
      setNewSetup({
        name: "",
        description: "",
        formula: "",
        patternType: "custom",
        timeframe: "daily",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/pattern-learning/rules'] });
    },
    onError: (error: Error) => {
      toast({ title: "Creation Failed", description: error.message, variant: "destructive" });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => {
      const setup = setups.find(s => s.id === id);
      if (!setup) throw new Error('Setup not found');
      const response = await apiRequest('POST', '/api/pattern-learning/rules', {
        ...setup,
        isActive,
      });
      if (!response.ok) throw new Error('Failed to update setup');
      return response.json();
    },
    onSuccess: (data) => {
      toast({ title: data.isActive ? "Setup Activated" : "Setup Deactivated" });
      queryClient.invalidateQueries({ queryKey: ['/api/pattern-learning/rules'] });
    },
  });

  const runTestMutation = useMutation({
    mutationFn: async (setupId: number) => {
      const setup = setups.find(s => s.id === setupId);
      if (!setup) throw new Error('Setup not found');
      const response = await apiRequest('POST', '/api/pattern-learning/scan', {
        patternType: setup.patternType,
        timeframe: setup.timeframe,
        formulaParams: setup.formulaParams || {},
        ruleId: setupId,
      });
      if (!response.ok) throw new Error('Scan failed');
      return response.json();
    },
    onSuccess: (data) => {
      setPatternMatches(data.matches || []);
      setCurrentMatchIndex(0);
      toast({ title: "Scan Complete", description: `Found ${data.matches?.length || 0} pattern matches` });
    },
    onError: (error: Error) => {
      toast({ title: "Scan Failed", description: error.message, variant: "destructive" });
    },
  });

  const saveRatingMutation = useMutation({
    mutationFn: async (data: { ticker: string; matchDate: string; rating: number; feedback: string; conditions: any }) => {
      const response = await apiRequest('POST', '/api/pattern-learning/ratings', {
        ruleId: selectedSetupId,
        ...data
      });
      if (!response.ok) throw new Error('Failed to save rating');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/pattern-learning/confidence'] });
    },
  });

  useEffect(() => {
    if (selectedSetup?.description && chatMessages.length <= 1) {
      setChatInput(selectedSetup.description);
    }
    if (selectedSetup?.formulaParams) {
      setCurrentFormula(selectedSetup.formulaParams as Record<string, any>);
    } else {
      setCurrentFormula(null);
    }
    if (selectedSetup?.requiredTechnicals) {
      const techs = (selectedSetup.requiredTechnicals as any)?.indicators || [];
      setExtractedTechnicals(techs);
    } else {
      setExtractedTechnicals([]);
    }
  }, [selectedSetup]);

  const handleSendChat = useCallback(async () => {
    if (!chatInput.trim() || isAiThinking) return;
    
    const userMessage = chatInput.trim();
    setChatMessages(prev => [...prev, { role: "user", content: userMessage }]);
    setChatInput("");
    setIsAiThinking(true);
    
    try {
      const response = await apiRequest('POST', '/api/pattern-learning/chat', {
        message: userMessage,
        setupId: selectedSetupId,
        currentSetup: selectedSetup,
        recentRatings: Object.entries(ratings).slice(-10).map(([key, val]) => ({
          key,
          ...val
        })),
      });
      
      if (!response.ok) throw new Error('Failed to get AI response');
      const data = await response.json();
      
      setChatMessages(prev => [...prev, { role: "assistant", content: data.response }]);
      
      if (data.formulaUpdate) {
        toast({ 
          title: "Formula Updated", 
          description: "AI has improved the detection formula based on your feedback" 
        });
        queryClient.invalidateQueries({ queryKey: ['/api/pattern-learning/rules'] });
      }
      
      if (data.extractedTechnicals && data.extractedTechnicals.length > 0) {
        setExtractedTechnicals(data.extractedTechnicals);
      }
      
      if (data.extractedTimeframe) {
        setChartTimeframe(data.extractedTimeframe);
      }
      
      if (data.extractedChartPeriod) {
        setChartPeriod(data.extractedChartPeriod);
      }
      
      if (data.proposedFormula) {
        setCurrentFormula(data.proposedFormula);
      }
    } catch (error) {
      setChatMessages(prev => [...prev, { 
        role: "assistant", 
        content: "Sorry, I encountered an error. Please try again." 
      }]);
    } finally {
      setIsAiThinking(false);
    }
  }, [chatInput, isAiThinking, selectedSetupId, selectedSetup, ratings]);

  const handleRating = (ticker: string, matchDate: string, rating: number) => {
    const key = `${ticker}-${matchDate}`;
    const currentMatch = patternMatches[currentMatchIndex];
    const feedback = feedbackInput.trim();
    
    setRatings(prev => ({ ...prev, [key]: { rating, feedback } }));
    saveRatingMutation.mutate({ 
      ticker, 
      matchDate, 
      rating, 
      feedback,
      conditions: currentMatch?.conditions || {}
    });
    setFeedbackInput("");
    
    if (currentMatchIndex < patternMatches.length - 1) {
      setCurrentMatchIndex(prev => prev + 1);
    }
  };

  const currentMatch = patternMatches[currentMatchIndex];
  const currentMatchKey = currentMatch ? `${currentMatch.ticker}-${currentMatch.matchDate}` : '';
  const currentRating = ratings[currentMatchKey];

  const getTradingViewUrl = (ticker: string, date: string) => {
    const technicals = extractedTechnicals.length > 0 
      ? extractedTechnicals 
      : (selectedSetup?.requiredTechnicals?.indicators || []);
    const studies = technicals.map(t => {
      const tLower = t.toLowerCase();
      if (tLower.includes('ema')) return 'MAExp@tv-basicstudies';
      if (tLower.includes('sma') || tLower.includes('ma')) return 'MASimple@tv-basicstudies';
      if (tLower.includes('vwap')) return 'VWAP@tv-basicstudies';
      if (tLower.includes('rsi')) return 'RSI@tv-basicstudies';
      if (tLower.includes('macd')) return 'MACD@tv-basicstudies';
      if (tLower.includes('volume') || tLower.includes('vol')) return 'Volume@tv-basicstudies';
      if (tLower.includes('bollinger') || tLower.includes('bb')) return 'BB@tv-basicstudies';
      if (tLower.includes('atr')) return 'ATR@tv-basicstudies';
      return '';
    }).filter(Boolean);
    
    // Remove duplicates
    const uniqueStudies = Array.from(new Set(studies)).join(',');
    
    return `https://www.tradingview.com/chart/?symbol=${ticker}&interval=${chartTimeframe}${uniqueStudies ? `&studies=${uniqueStudies}` : ''}`;
  };
  
  // Generate studies string for embedded widget
  const getWidgetStudies = () => {
    const technicals = extractedTechnicals.length > 0 
      ? extractedTechnicals 
      : (selectedSetup?.requiredTechnicals?.indicators || []);
    const studies = technicals.map(t => {
      const tLower = t.toLowerCase();
      if (tLower.includes('ema')) return 'MAExp@tv-basicstudies';
      if (tLower.includes('sma') || tLower.includes('ma')) return 'MASimple@tv-basicstudies';
      if (tLower.includes('vwap')) return 'VWAP@tv-basicstudies';
      if (tLower.includes('rsi')) return 'RSI@tv-basicstudies';
      if (tLower.includes('macd')) return 'MACD@tv-basicstudies';
      if (tLower.includes('volume') || tLower.includes('vol')) return 'Volume@tv-basicstudies';
      if (tLower.includes('bollinger') || tLower.includes('bb')) return 'BB@tv-basicstudies';
      if (tLower.includes('atr')) return 'ATR@tv-basicstudies';
      return '';
    }).filter(Boolean);
    
    // Return unique studies as URL-encoded comma-separated string for TradingView widget
    const uniqueStudies = Array.from(new Set(studies));
    return encodeURIComponent(uniqueStudies.join(','));
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
      <SentinelHeader />
      
      <div className="container mx-auto p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Brain className="h-6 w-6" />
              Pattern Learning
            </h1>
            <p className="text-muted-foreground">
              Rate patterns, track formation stages, learn from AI-powered scoring
            </p>
          </div>
          
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="v2" data-testid="tab-v2">
                <Gauge className="h-4 w-4 mr-2" />
                Pattern Rating
              </TabsTrigger>
              <TabsTrigger value="legacy" data-testid="tab-legacy">
                <BarChart3 className="h-4 w-4 mr-2" />
                Setup Builder
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {activeTab === "v2" && (
          <div className="space-y-4">
            {/* V2 Setup Selection Row */}
            <Card>
              <CardContent className="py-4">
                <div className="grid grid-cols-12 gap-4">
                  <div className="col-span-3">
                    <Label className="text-xs text-muted-foreground mb-1 block">Pattern Type</Label>
                    <Select 
                      value={selectedMasterSetupId?.toString() || ""} 
                      onValueChange={(v) => {
                        setSelectedMasterSetupId(v ? parseInt(v) : null);
                        setSelectedVariantId(null);
                        setSelectedStageId(null);
                        setRatingResult(null);
                      }}
                    >
                      <SelectTrigger data-testid="select-master-setup">
                        <SelectValue placeholder="Select pattern..." />
                      </SelectTrigger>
                      <SelectContent>
                        {masterSetups.map(setup => (
                          <SelectItem key={setup.id} value={setup.id.toString()}>
                            {setup.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="col-span-3">
                    <Label className="text-xs text-muted-foreground mb-1 block">Timeframe Variant</Label>
                    <Select 
                      value={selectedVariantId?.toString() || ""} 
                      onValueChange={(v) => setSelectedVariantId(v ? parseInt(v) : null)}
                      disabled={!selectedMasterSetupId}
                    >
                      <SelectTrigger data-testid="select-variant">
                        <SelectValue placeholder="Select variant..." />
                      </SelectTrigger>
                      <SelectContent>
                        {variants.map(variant => (
                          <SelectItem key={variant.id} value={variant.id.toString()}>
                            {variant.name} ({variant.duration || 'standard'})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="col-span-3">
                    <Label className="text-xs text-muted-foreground mb-1 block">Formation Stage</Label>
                    <Select 
                      value={selectedStageId?.toString() || "none"} 
                      onValueChange={(v) => setSelectedStageId(v && v !== "none" ? parseInt(v) : null)}
                      disabled={!selectedMasterSetupId}
                    >
                      <SelectTrigger data-testid="select-stage">
                        <SelectValue placeholder="Select stage..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Not specified</SelectItem>
                        {stages.map(stage => (
                          <SelectItem key={stage.id} value={stage.id.toString()}>
                            {stage.stageOrder}. {stage.stageType.replace(/_/g, ' ')}
                            {stage.isTerminal && ' (terminal)'}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="col-span-3">
                    <Label className="text-xs text-muted-foreground mb-1 block">Ticker Symbol</Label>
                    <div className="flex gap-2">
                      <Input
                        value={ratingTicker}
                        onChange={(e) => setRatingTicker(e.target.value.toUpperCase())}
                        placeholder="AAPL"
                        className="flex-1"
                        data-testid="input-ticker"
                      />
                      <Button 
                        onClick={handleRatePattern}
                        disabled={isRating || !ratingTicker || !selectedVariantId}
                        data-testid="button-rate"
                      >
                        {isRating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                </div>
                
                {selectedMasterSetup && (
                  <p className="text-xs text-muted-foreground mt-2">
                    {selectedMasterSetup.description}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* V2 Main Content */}
            <div className="grid grid-cols-12 gap-4" style={{ height: '600px' }}>
              {/* Chart + Context Panel */}
              <div className="col-span-7">
                <Card className="h-full flex flex-col">
                  <CardHeader className="pb-2 flex-shrink-0">
                    <div className="flex items-center justify-between">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <BarChart3 className="h-4 w-4" />
                        {ratingTicker || 'Chart Preview'}
                        {selectedVariant && (
                          <Badge variant="outline" className="ml-2 text-xs font-normal">
                            {selectedVariant.timeframe === 'daily' ? 'Daily' : 
                             selectedVariant.timeframe === 'weekly' ? 'Weekly' : 
                             selectedVariant.timeframe === 'intraday' ? 'Intraday' : 
                             selectedVariant.timeframe}
                            {selectedVariant.chartPeriod && ` • ${selectedVariant.chartPeriod}`}
                          </Badge>
                        )}
                      </CardTitle>
                      {ratingTicker && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => window.open(`https://www.tradingview.com/chart/?symbol=${ratingTicker}&interval=${chartTimeframe}`, '_blank')}
                          data-testid="button-open-tradingview"
                        >
                          <ExternalLink className="h-4 w-4 mr-2" />
                          TradingView
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  
                  <CardContent className="flex-1 flex flex-col overflow-hidden">
                    {ratingTicker ? (
                      <div className="bg-card rounded-lg border overflow-hidden flex-1">
                        <PatternChart 
                          symbol={ratingTicker}
                          indicators={[]}
                          height={300}
                          timeframe={chartTimeframe}
                          chartPeriod={chartPeriod}
                        />
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                        <Target className="h-12 w-12 mb-4 opacity-50" />
                        <p>Enter a ticker to view chart</p>
                      </div>
                    )}
                    
                    <Separator className="my-3" />
                    
                    {/* Context Fields */}
                    <div className="grid grid-cols-4 gap-3">
                      <div>
                        <Label className="text-xs">Market Phase</Label>
                        <Select value={ratingMarketPhase} onValueChange={setRatingMarketPhase}>
                          <SelectTrigger className="h-8" data-testid="select-market-phase">
                            <SelectValue placeholder="Select..." />
                          </SelectTrigger>
                          <SelectContent>
                            {MARKET_PHASES.map(phase => (
                              <SelectItem key={phase.value} value={phase.value}>{phase.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs">Sector Trend</Label>
                        <Select value={ratingSectorPerf} onValueChange={setRatingSectorPerf}>
                          <SelectTrigger className="h-8" data-testid="select-sector">
                            <SelectValue placeholder="Select..." />
                          </SelectTrigger>
                          <SelectContent>
                            {SECTOR_PERFORMANCE.map(perf => (
                              <SelectItem key={perf.value} value={perf.value}>{perf.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs">Stock Stage</Label>
                        <Select value={ratingStockStage} onValueChange={setRatingStockStage}>
                          <SelectTrigger className="h-8" data-testid="select-stock-stage">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="1">Stage 1 (Base)</SelectItem>
                            <SelectItem value="2">Stage 2 (Advance)</SelectItem>
                            <SelectItem value="3">Stage 3 (Top)</SelectItem>
                            <SelectItem value="4">Stage 4 (Decline)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs">Prior Attempts</Label>
                        <Input
                          type="number"
                          min="0"
                          value={ratingPriorAttempts}
                          onChange={(e) => setRatingPriorAttempts(parseInt(e.target.value) || 0)}
                          className="h-8"
                          data-testid="input-prior-attempts"
                        />
                      </div>
                    </div>
                    
                    <div className="mt-3">
                      <Label className="text-xs">Chart Context Notes</Label>
                      <Textarea
                        value={ratingContext}
                        onChange={(e) => setRatingContext(e.target.value)}
                        placeholder="Any relevant chart observations..."
                        rows={2}
                        data-testid="textarea-context"
                      />
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Rating Results Panel */}
              <div className="col-span-5">
                <Card className="h-full flex flex-col">
                  <CardHeader className="pb-2 flex-shrink-0">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Gauge className="h-4 w-4" />
                      AI Pattern Score
                    </CardTitle>
                    <CardDescription>
                      100-point weighted scoring across 5 categories
                    </CardDescription>
                  </CardHeader>
                  
                  <CardContent className="flex-1 overflow-auto">
                    {ratingResult ? (
                      <div className="space-y-4">
                        {/* Score Display */}
                        <div className="text-center p-4 bg-muted/50 rounded-lg">
                          <div className={`text-5xl font-bold ${SCORE_COLORS[ratingResult.recommendation]}`}>
                            {ratingResult.totalScore}
                          </div>
                          <div className="text-sm text-muted-foreground mt-1">
                            out of 100
                          </div>
                          <div className="flex items-center justify-center gap-2 mt-2">
                            <Badge className={RATING_COLORS[ratingResult.humanRating as keyof typeof RATING_COLORS]}>
                              {ratingResult.humanRatingLabel}
                            </Badge>
                            <Badge variant={
                              ratingResult.recommendation === 'proceed' ? 'default' :
                              ratingResult.recommendation === 'wait' ? 'secondary' : 'destructive'
                            }>
                              {ratingResult.recommendation.toUpperCase()}
                            </Badge>
                          </div>
                          {ratingResult.stageModifier !== 1.0 && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Stage modifier: {ratingResult.stageModifier.toFixed(2)}x (raw: {ratingResult.rawScore})
                            </p>
                          )}
                        </div>
                        
                        {/* Category Breakdown */}
                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground">Category Breakdown</Label>
                          {Object.entries(ratingResult.breakdown).map(([category, score]) => (
                            <div key={category} className="flex items-center gap-2">
                              <span className="text-xs w-32 truncate capitalize">
                                {category.replace(/_/g, ' ')}
                              </span>
                              <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                                <div 
                                  className="h-full bg-primary transition-all" 
                                  style={{ width: `${(score / 20) * 100}%` }}
                                />
                              </div>
                              <span className="text-xs font-mono w-8">{score}/20</span>
                            </div>
                          ))}
                        </div>
                        
                        {/* Summary */}
                        {ratingResult.summary && (
                          <div className="p-3 bg-muted/30 rounded-lg">
                            <p className="text-sm">{ratingResult.summary}</p>
                          </div>
                        )}
                        
                        {/* Strengths & Weaknesses */}
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label className="text-xs text-rs-green flex items-center gap-1">
                              <CheckCircle2 className="h-3 w-3" /> Strengths
                            </Label>
                            <ul className="text-xs space-y-1 mt-1">
                              {ratingResult.keyStrengths.map((s, i) => (
                                <li key={i} className="text-muted-foreground">• {s}</li>
                              ))}
                            </ul>
                          </div>
                          <div>
                            <Label className="text-xs text-rs-red flex items-center gap-1">
                              <AlertCircle className="h-3 w-3" /> Weaknesses
                            </Label>
                            <ul className="text-xs space-y-1 mt-1">
                              {ratingResult.keyWeaknesses.map((w, i) => (
                                <li key={i} className="text-muted-foreground">• {w}</li>
                              ))}
                            </ul>
                          </div>
                        </div>
                        
                        <Button 
                          className="w-full" 
                          onClick={handleSaveExample}
                          data-testid="button-save-example"
                        >
                          <Save className="h-4 w-4 mr-2" />
                          Save as Training Example
                        </Button>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                        <Gauge className="h-12 w-12 mb-4 opacity-50" />
                        <p>Select a pattern and ticker</p>
                        <p className="text-sm">then click Rate to get AI scoring</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        )}

        {activeTab === "legacy" && (
          <>
            {/* Legacy V1 Setup Selection */}
            <div className="flex items-center gap-3 mb-4">
              <Select 
                value={selectedSetupId?.toString() || ""} 
                onValueChange={(v) => setSelectedSetupId(v ? parseInt(v) : null)}
              >
                <SelectTrigger className="w-64" data-testid="select-setup">
                  <SelectValue placeholder="Select a Setup..." />
                </SelectTrigger>
                <SelectContent>
                  {setups.map(setup => (
                    <SelectItem key={setup.id} value={setup.id.toString()}>
                      <div className="flex items-center gap-2">
                        {setup.isActive ? (
                          <Check className="h-3 w-3 text-rs-green" />
                        ) : (
                          <X className="h-3 w-3 text-muted-foreground" />
                        )}
                        {setup.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

            <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
              <DialogTrigger asChild>
                <Button variant="outline" data-testid="button-new-setup">
                  <Plus className="h-4 w-4 mr-2" />
                  New Setup
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Create New Setup</DialogTitle>
                  <DialogDescription>
                    Define a trading setup. Describe what you're looking for in plain English - 
                    the AI will build the detection formula.
                  </DialogDescription>
                </DialogHeader>
                
                <div className="space-y-4 py-4">
                  <div>
                    <Label>Setup Name</Label>
                    <Input
                      value={newSetup.name}
                      onChange={(e) => setNewSetup(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="e.g., VWAP Reclaim after Morning Dip"
                      data-testid="input-new-setup-name"
                    />
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Pattern Type</Label>
                      <Select 
                        value={newSetup.patternType} 
                        onValueChange={(v) => setNewSetup(prev => ({ ...prev, patternType: v }))}
                      >
                        <SelectTrigger data-testid="select-new-pattern-type">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PATTERN_TYPES.map(pt => (
                            <SelectItem key={pt.value} value={pt.value}>{pt.label}</SelectItem>
                          ))}
                          <SelectItem value="custom">Custom</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Timeframe</Label>
                      <Select 
                        value={newSetup.timeframe} 
                        onValueChange={(v) => setNewSetup(prev => ({ ...prev, timeframe: v }))}
                      >
                        <SelectTrigger data-testid="select-new-timeframe">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PATTERN_TIMEFRAMES.map(tf => (
                            <SelectItem key={tf.value} value={tf.value}>{tf.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  
                  <div>
                    <Label>Description (How would you explain this setup?)</Label>
                    <Textarea
                      value={newSetup.description}
                      onChange={(e) => setNewSetup(prev => ({ ...prev, description: e.target.value }))}
                      placeholder="e.g., Look for stocks that gap down in the morning, drop below the 21 EMA, then reclaim VWAP with above-average volume. Entry is when price holds above VWAP for 5 minutes."
                      rows={4}
                      data-testid="textarea-new-setup-description"
                    />
                  </div>
                  
                  <p className="text-sm text-muted-foreground">
                    The AI will automatically discover which technical indicators are relevant 
                    based on your description and conversation.
                  </p>
                </div>
                
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
                    Cancel
                  </Button>
                  <Button 
                    onClick={() => createSetupMutation.mutate(newSetup)}
                    disabled={!newSetup.name || createSetupMutation.isPending}
                    data-testid="button-create-setup"
                  >
                    {createSetupMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : null}
                    Create Setup
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

        {selectedSetup && (
          <Card className="mb-4">
            <CardContent className="py-3">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <h3 className="font-semibold">{selectedSetup.name}</h3>
                    <Badge variant="outline">{selectedSetup.patternType}</Badge>
                    <Badge variant="outline">{selectedSetup.timeframe}</Badge>
                    {confidence && (
                      <Badge variant={
                        confidence.confidenceLevel === 'high' ? 'default' :
                        confidence.confidenceLevel === 'medium' ? 'secondary' : 'outline'
                      }>
                        {confidence.confidenceLevel} confidence
                      </Badge>
                    )}
                  </div>
                  {selectedSetup.description && (
                    <p className="text-sm text-muted-foreground mt-1">{selectedSetup.description}</p>
                  )}
                </div>
                
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="active-toggle" className="text-sm">Active</Label>
                    <Switch
                      id="active-toggle"
                      checked={selectedSetup.isActive}
                      onCheckedChange={(checked) => toggleActiveMutation.mutate({ id: selectedSetup.id, isActive: checked })}
                      data-testid="switch-active"
                    />
                  </div>
                  
                  <Button 
                    onClick={() => selectedSetupId && runTestMutation.mutate(selectedSetupId)}
                    disabled={runTestMutation.isPending}
                    data-testid="button-run-test"
                  >
                    {runTestMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4 mr-2" />
                    )}
                    Run Test
                  </Button>
                </div>
              </div>
              
              {extractedTechnicals.length > 0 && (
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-xs text-muted-foreground">AI-detected Technicals:</span>
                  {extractedTechnicals.map(ind => (
                    <Badge key={ind} variant="secondary" className="text-xs">{ind}</Badge>
                  ))}
                </div>
              )}
              
              {currentFormula && Object.keys(currentFormula).length > 0 && (
                <div className="mt-3 p-3 bg-muted/50 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                      <Target className="h-3 w-3" />
                      Formula Parameters
                    </span>
                    <Badge variant="outline" className="text-xs">AI-generated</Badge>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    {Object.entries(currentFormula).map(([key, value]) => (
                      <div key={key} className="flex flex-col p-2 bg-background rounded border">
                        <span className="text-muted-foreground capitalize">
                          {key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim()}
                        </span>
                        <span className="font-mono font-medium">
                          {typeof value === 'number' ? value.toFixed(3) : String(value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-12 gap-4" style={{ height: '560px' }}>
          <div className="col-span-7">
            <Card className="h-full flex flex-col">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5" />
                    Pattern Match Review
                  </CardTitle>
                  {patternMatches.length > 0 && (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="icon"
                        disabled={currentMatchIndex === 0}
                        onClick={() => setCurrentMatchIndex(prev => prev - 1)}
                        data-testid="button-prev-match"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <span className="text-sm tabular-nums">
                        {currentMatchIndex + 1} / {patternMatches.length}
                      </span>
                      <Button
                        variant="outline"
                        size="icon"
                        disabled={currentMatchIndex === patternMatches.length - 1}
                        onClick={() => setCurrentMatchIndex(prev => prev + 1)}
                        data-testid="button-next-match"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
                <CardDescription>
                  Rate each match: 1=Useless, 2=Some Elements, 3=Good but Past Entry, 4=Valid Setup
                </CardDescription>
              </CardHeader>
              
              <CardContent className="flex-1 flex flex-col overflow-hidden">
                {!selectedSetup ? (
                  <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                    <Target className="h-12 w-12 mb-4 opacity-50" />
                    <p>Select a setup to begin</p>
                  </div>
                ) : patternMatches.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                    <BarChart3 className="h-12 w-12 mb-4 opacity-50" />
                    <p>No pattern matches yet</p>
                    <p className="text-sm">Click "Run Test" to find matches</p>
                  </div>
                ) : currentMatch ? (
                  <div className="flex flex-col h-full">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <span className="text-xl font-bold">{currentMatch.ticker}</span>
                        <Badge variant="outline">{currentMatch.matchDate}</Badge>
                        <Badge variant="secondary" data-testid="badge-timeframe">
                          {chartTimeframe === "D" ? "Daily" : 
                           chartTimeframe === "W" ? "Weekly" : 
                           chartTimeframe === "60" ? "1H" : 
                           chartTimeframe === "15" ? "15m" : 
                           chartTimeframe === "5" ? "5m" : chartTimeframe}
                        </Badge>
                        {currentRating && (
                          <Badge className={RATING_COLORS[currentRating.rating as keyof typeof RATING_COLORS]}>
                            {RATING_LABELS[currentRating.rating as keyof typeof RATING_LABELS]}
                          </Badge>
                        )}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => window.open(getTradingViewUrl(currentMatch.ticker, currentMatch.matchDate), '_blank')}
                        data-testid="button-open-chart"
                      >
                        <ExternalLink className="h-4 w-4 mr-2" />
                        Open in TradingView
                      </Button>
                    </div>
                    
                    <div className="bg-card rounded-lg border overflow-hidden mb-2">
                      <PatternChart 
                        symbol={currentMatch.ticker}
                        indicators={extractedTechnicals.length > 0 ? extractedTechnicals : (selectedSetup?.requiredTechnicals?.indicators || [])}
                        height={350}
                        timeframe={chartTimeframe}
                        chartPeriod={chartPeriod}
                      />
                    </div>
                    
                    <div className="space-y-3">
                      <div>
                        <Label className="text-sm mb-2 block">Your Feedback (helps AI learn)</Label>
                        <Textarea
                          value={feedbackInput}
                          onChange={(e) => setFeedbackInput(e.target.value)}
                          placeholder="e.g., Entry was too early, volume spike happened after the breakout, would prefer tighter consolidation..."
                          rows={2}
                          data-testid="textarea-feedback"
                        />
                      </div>
                      
                      <div className="flex gap-2">
                        {[1, 2, 3, 4].map(rating => {
                          const Icon = RATING_ICONS[rating as keyof typeof RATING_ICONS];
                          const isSelected = currentRating?.rating === rating;
                          const label = RATING_LABELS[rating as keyof typeof RATING_LABELS];
                          return (
                            <Button
                              key={rating}
                              variant={isSelected ? "default" : "outline"}
                              className={`flex-1 ${isSelected ? RATING_COLORS[rating as keyof typeof RATING_COLORS] : ''}`}
                              onClick={() => handleRating(currentMatch.ticker, currentMatch.matchDate, rating)}
                              data-testid={`button-rate-${rating}`}
                            >
                              <Icon className="h-4 w-4 mr-2" />
                              {label}
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>

          <div className="col-span-5">
            <Card className="flex flex-col" style={{ height: '560px' }}>
              <CardHeader className="pb-2 flex-shrink-0">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Brain className="h-4 w-4" />
                  AI Assistant
                </CardTitle>
                <CardDescription>
                  Ask questions or request formula improvements based on your ratings
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col overflow-hidden min-h-0">
                <ScrollArea className="flex-1 pr-4 overflow-y-auto">
                  <div className="space-y-3">
                    {chatMessages.map((msg, idx) => (
                      <div 
                        key={idx}
                        className={`p-3 rounded-lg ${
                          msg.role === "user" 
                            ? "bg-primary/10 ml-8" 
                            : "bg-muted mr-8"
                        }`}
                      >
                        <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                      </div>
                    ))}
                    {isAiThinking && (
                      <div className="bg-muted p-3 rounded-lg mr-8 flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span className="text-sm text-muted-foreground">Thinking...</span>
                      </div>
                    )}
                  </div>
                </ScrollArea>
                
                <Separator className="my-3" />
                
                {confidence && (
                  <div className="mb-3">
                    <div className="flex items-center justify-between text-sm mb-2">
                      <span className="text-muted-foreground">Rating Stats</span>
                      <Badge variant="outline">{confidence.patternsRated || 0} rated</Badge>
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-center text-xs">
                      <div>
                        <div className="font-bold text-rs-red">{confidence.rating1Count || 0}</div>
                        <div className="text-muted-foreground">Useless</div>
                      </div>
                      <div>
                        <div className="font-bold text-rs-yellow">{confidence.rating2Count || 0}</div>
                        <div className="text-muted-foreground">Elements</div>
                      </div>
                      <div>
                        <div className="font-bold text-blue-400">{confidence.rating3Count || 0}</div>
                        <div className="text-muted-foreground">Past</div>
                      </div>
                      <div>
                        <div className="font-bold text-rs-green">{confidence.rating4Count || 0}</div>
                        <div className="text-muted-foreground">Good</div>
                      </div>
                    </div>
                  </div>
                )}
                
                <div className="flex gap-2">
                  <Input
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Ask AI to analyze ratings or improve the formula..."
                    onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSendChat()}
                    disabled={isAiThinking}
                    data-testid="input-chat"
                  />
                  <Button 
                    size="icon" 
                    onClick={handleSendChat}
                    disabled={isAiThinking || !chatInput.trim()}
                    data-testid="button-send-chat"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
          </>
        )}
      </div>
    </div>
  );
}
