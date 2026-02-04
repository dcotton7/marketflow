import { useState, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useSentinelAuth } from "@/context/SentinelAuthContext";
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
import { 
  Brain, Send, Play, Save, RefreshCw, Loader2,
  ThumbsDown, ThumbsUp, Minus, Star, ChevronRight, ChevronLeft,
  TrendingUp, Clock, BarChart3, Target, AlertCircle, Plus, Edit, Check, X, ExternalLink
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { SentinelHeader } from "@/components/SentinelHeader";
import { PATTERN_TYPES, PATTERN_TIMEFRAMES, RATING_LABELS, SetupConfidence } from "@shared/schema";

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

const RATING_COLORS = {
  1: "bg-red-500/20 border-red-500 text-red-400",
  2: "bg-yellow-500/20 border-yellow-500 text-yellow-400",
  3: "bg-blue-500/20 border-blue-500 text-blue-400",
  4: "bg-green-500/20 border-green-500 text-green-400",
};

const RATING_ICONS = {
  1: ThumbsDown,
  2: Minus,
  3: Clock,
  4: Star,
};

export default function PatternLearningPage() {
  const { user } = useSentinelAuth();
  const { toast } = useToast();
  
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
    
    return `https://www.tradingview.com/chart/?symbol=${ticker}&interval=D${uniqueStudies ? `&studies=${uniqueStudies}` : ''}`;
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
    
    // Return unique studies as URL-encoded JSON array
    const uniqueStudies = Array.from(new Set(studies));
    return encodeURIComponent(JSON.stringify(uniqueStudies));
  };

  return (
    <div className="min-h-screen bg-background">
      <SentinelHeader />
      
      <div className="container mx-auto p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Brain className="h-6 w-6" />
              Pattern Learning
            </h1>
            <p className="text-muted-foreground">
              Define setups, review chart matches, provide feedback - AI learns what works
            </p>
          </div>
          
          <div className="flex items-center gap-3">
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
                        <Check className="h-3 w-3 text-green-500" />
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

        <div className="grid grid-cols-12 gap-4 h-[calc(100vh-280px)]">
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
                    
                    <div className="flex-1 bg-card rounded-lg border overflow-hidden mb-4" style={{ minHeight: '350px' }}>
                      <iframe
                        src={`https://s.tradingview.com/widgetembed/?frameElementId=tradingview_widget&symbol=${currentMatch.ticker}&interval=D&theme=dark&style=1&timezone=Etc%2FUTC&withdateranges=1&hide_side_toolbar=1&allow_symbol_change=1&details=0&studies=${getWidgetStudies()}&show_popup_button=1`}
                        className="w-full h-full border-0"
                        title={`Chart for ${currentMatch.ticker}`}
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
            <Card className="flex flex-col" style={{ maxHeight: '600px' }}>
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
                <ScrollArea className="flex-1 pr-4" style={{ maxHeight: '280px' }}>
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
                        <div className="font-bold text-red-400">{confidence.rating1Count || 0}</div>
                        <div className="text-muted-foreground">Useless</div>
                      </div>
                      <div>
                        <div className="font-bold text-yellow-400">{confidence.rating2Count || 0}</div>
                        <div className="text-muted-foreground">Elements</div>
                      </div>
                      <div>
                        <div className="font-bold text-blue-400">{confidence.rating3Count || 0}</div>
                        <div className="text-muted-foreground">Past</div>
                      </div>
                      <div>
                        <div className="font-bold text-green-400">{confidence.rating4Count || 0}</div>
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
      </div>
    </div>
  );
}
