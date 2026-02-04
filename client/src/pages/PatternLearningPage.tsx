import { useState, useCallback } from "react";
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
import { 
  Brain, Send, Play, Save, RefreshCw, Loader2,
  ThumbsDown, ThumbsUp, Minus, Star, ChevronRight,
  TrendingUp, Clock, BarChart3, Target, AlertCircle
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { SentinelHeader } from "@/components/SentinelHeader";
import { MiniChart } from "@/components/MiniChart";
import { PATTERN_TYPES, PATTERN_TIMEFRAMES, RATING_LABELS } from "@shared/schema";

interface PatternRule {
  id: number;
  patternType: string;
  timeframe: string;
  name: string;
  description?: string;
  formulaParams: Record<string, number | string | undefined>;
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
  
  const [selectedPatternType, setSelectedPatternType] = useState("breakout_pullback");
  const [selectedTimeframe, setSelectedTimeframe] = useState("daily");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: "I'm ready to help you define and test pattern rules. What pattern would you like to work on?" }
  ]);
  const [chatInput, setChatInput] = useState("");
  const [isAiThinking, setIsAiThinking] = useState(false);
  
  const [currentRule, setCurrentRule] = useState<Partial<PatternRule>>({
    patternType: "breakout_pullback",
    timeframe: "daily",
    name: "Breakout with Pullback",
    formulaParams: {
      breakoutMinPct: 0.003,
      breakoutMaxPct: 0.02,
      volumeRatio: 1.3,
      pullbackMinDepth: 0.3,
      pullbackMaxDepth: 0.7,
      maDistance: 0.001,
      maPeriod: 20,
      maType: "ema",
      entryConfirmPct: 0.25,
      invalidationPct: 0.003,
    }
  });
  
  const [patternMatches, setPatternMatches] = useState<PatternMatch[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [ratings, setRatings] = useState<Record<string, number>>({});

  const { data: savedRules, isLoading: rulesLoading } = useQuery<PatternRule[]>({
    queryKey: ['/api/pattern-learning/rules'],
  });

  const { data: confidence } = useQuery({
    queryKey: ['/api/pattern-learning/confidence', currentRule?.id],
    enabled: !!currentRule?.id,
  });

  const saveRuleMutation = useMutation({
    mutationFn: async (rule: Partial<PatternRule>) => {
      const response = await apiRequest('POST', '/api/pattern-learning/rules', rule);
      if (!response.ok) throw new Error('Failed to save rule');
      return response.json();
    },
    onSuccess: (data) => {
      toast({ title: "Rule Saved", description: `Rule "${data.name}" saved successfully` });
      setCurrentRule(data);
      queryClient.invalidateQueries({ queryKey: ['/api/pattern-learning/rules'] });
    },
    onError: (error: any) => {
      toast({ title: "Save Failed", description: error.message, variant: "destructive" });
    },
  });

  const runTestMutation = useMutation({
    mutationFn: async (params: { patternType: string; timeframe: string; formulaParams: any }) => {
      const response = await apiRequest('POST', '/api/pattern-learning/scan', params);
      if (!response.ok) throw new Error('Scan failed');
      return response.json();
    },
    onSuccess: (data) => {
      setPatternMatches(data.matches || []);
      if (data.ruleId) {
        setCurrentRule(prev => ({ ...prev, id: data.ruleId }));
      }
      toast({ title: "Scan Complete", description: `Found ${data.matches?.length || 0} pattern matches` });
    },
    onError: (error: any) => {
      toast({ title: "Scan Failed", description: error.message, variant: "destructive" });
    },
  });

  const saveRatingMutation = useMutation({
    mutationFn: async (data: { ticker: string; matchDate: string; rating: number; conditions: any }) => {
      const response = await apiRequest('POST', '/api/pattern-learning/ratings', {
        ruleId: currentRule.id,
        ...data
      });
      if (!response.ok) throw new Error('Failed to save rating');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/pattern-learning/confidence'] });
    },
  });

  const handleSendChat = useCallback(async () => {
    if (!chatInput.trim() || isAiThinking) return;
    
    const userMessage = chatInput.trim();
    setChatMessages(prev => [...prev, { role: "user", content: userMessage }]);
    setChatInput("");
    setIsAiThinking(true);
    
    try {
      const response = await apiRequest('POST', '/api/pattern-learning/chat', {
        message: userMessage,
        currentRule,
        patternType: selectedPatternType,
        timeframe: selectedTimeframe,
      });
      
      if (!response.ok) throw new Error('Failed to get AI response');
      const data = await response.json();
      
      setChatMessages(prev => [...prev, { role: "assistant", content: data.response }]);
      
      if (data.suggestedParams) {
        setCurrentRule(prev => ({
          ...prev,
          formulaParams: { ...prev.formulaParams, ...data.suggestedParams }
        }));
        toast({ title: "Parameters Updated", description: "AI has suggested new formula parameters" });
      }
    } catch (error) {
      setChatMessages(prev => [...prev, { 
        role: "assistant", 
        content: "Sorry, I encountered an error. Please try again." 
      }]);
    } finally {
      setIsAiThinking(false);
    }
  }, [chatInput, isAiThinking, currentRule, selectedPatternType, selectedTimeframe]);

  const handleRunTest = () => {
    setIsScanning(true);
    runTestMutation.mutate({
      patternType: selectedPatternType,
      timeframe: selectedTimeframe,
      formulaParams: currentRule.formulaParams || {},
    });
    setTimeout(() => setIsScanning(false), 1000);
  };

  const handleRating = (ticker: string, matchDate: string, rating: number, conditions: any) => {
    const key = `${ticker}-${matchDate}`;
    setRatings(prev => ({ ...prev, [key]: rating }));
    saveRatingMutation.mutate({ ticker, matchDate, rating, conditions });
  };

  const handleSaveRule = () => {
    saveRuleMutation.mutate({
      ...currentRule,
      patternType: selectedPatternType,
      timeframe: selectedTimeframe,
    });
  };

  const updateFormulaParam = (key: string, value: string) => {
    const numValue = parseFloat(value);
    setCurrentRule(prev => ({
      ...prev,
      formulaParams: {
        ...prev.formulaParams,
        [key]: isNaN(numValue) ? value : numValue
      }
    }));
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
              Define pattern rules, test on historical data, and teach the AI what works
            </p>
          </div>
          
          <div className="flex items-center gap-3">
            <Select value={selectedPatternType} onValueChange={setSelectedPatternType}>
              <SelectTrigger className="w-48" data-testid="select-pattern-type">
                <SelectValue placeholder="Pattern Type" />
              </SelectTrigger>
              <SelectContent>
                {PATTERN_TYPES.map(pt => (
                  <SelectItem key={pt.value} value={pt.value}>{pt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            <Select value={selectedTimeframe} onValueChange={setSelectedTimeframe}>
              <SelectTrigger className="w-32" data-testid="select-timeframe">
                <SelectValue placeholder="Timeframe" />
              </SelectTrigger>
              <SelectContent>
                {PATTERN_TIMEFRAMES.map(tf => (
                  <SelectItem key={tf.value} value={tf.value}>{tf.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-12 gap-4 h-[calc(100vh-180px)]">
          <div className="col-span-7">
            <Card className="h-full flex flex-col">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5" />
                    Pattern Matches
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={handleRunTest}
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
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPatternMatches([])}
                      data-testid="button-clear-matches"
                    >
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Clear
                    </Button>
                  </div>
                </div>
                <CardDescription>
                  Rate each pattern match: 1=Useless, 2=Elements, 3=Past Entry, 4=Good
                </CardDescription>
              </CardHeader>
              
              <CardContent className="flex-1 overflow-hidden">
                <ScrollArea className="h-full">
                  {patternMatches.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                      <BarChart3 className="h-12 w-12 mb-4 opacity-50" />
                      <p>No pattern matches yet</p>
                      <p className="text-sm">Configure your rule and click "Run Test"</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-4">
                      {patternMatches.map((match, idx) => {
                        const key = `${match.ticker}-${match.matchDate}`;
                        const currentRating = ratings[key];
                        
                        return (
                          <Card key={key} className="overflow-hidden">
                            <div className="h-32 bg-card">
                              <MiniChart 
                                symbol={match.ticker} 
                                timeframe={selectedTimeframe === "daily" ? "1d" : 
                                          selectedTimeframe === "weekly" ? "1wk" : 
                                          selectedTimeframe === "monthly" ? "1mo" : "1d"}
                              />
                            </div>
                            <CardContent className="p-3">
                              <div className="flex items-center justify-between mb-2">
                                <div>
                                  <span className="font-bold">{match.ticker}</span>
                                  <span className="text-xs text-muted-foreground ml-2">{match.matchDate}</span>
                                </div>
                                {currentRating && (
                                  <Badge className={RATING_COLORS[currentRating as keyof typeof RATING_COLORS]}>
                                    {RATING_LABELS[currentRating as keyof typeof RATING_LABELS]}
                                  </Badge>
                                )}
                              </div>
                              
                              <div className="text-xs text-muted-foreground mb-2 space-y-0.5">
                                {match.conditions.breakoutPct !== undefined && (
                                  <div>Breakout: {(match.conditions.breakoutPct * 100).toFixed(2)}%</div>
                                )}
                                {match.conditions.volumeRatio !== undefined && (
                                  <div>Volume: {match.conditions.volumeRatio.toFixed(1)}x avg</div>
                                )}
                                {match.conditions.pullbackDepth !== undefined && (
                                  <div>Pullback: {(match.conditions.pullbackDepth * 100).toFixed(1)}%</div>
                                )}
                              </div>
                              
                              <div className="flex gap-1">
                                {[1, 2, 3, 4].map(rating => {
                                  const Icon = RATING_ICONS[rating as keyof typeof RATING_ICONS];
                                  const isSelected = currentRating === rating;
                                  return (
                                    <Button
                                      key={rating}
                                      variant={isSelected ? "default" : "outline"}
                                      size="sm"
                                      className={`flex-1 ${isSelected ? RATING_COLORS[rating as keyof typeof RATING_COLORS] : ''}`}
                                      onClick={() => handleRating(match.ticker, match.matchDate, rating, match.conditions)}
                                      data-testid={`button-rate-${match.ticker}-${rating}`}
                                    >
                                      <Icon className="h-3 w-3" />
                                    </Button>
                                  );
                                })}
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </div>

          <div className="col-span-5 flex flex-col gap-4">
            <Card className="flex-1 flex flex-col">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Brain className="h-4 w-4" />
                  AI Assistant
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col overflow-hidden">
                <ScrollArea className="flex-1 pr-4">
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
                
                <div className="flex gap-2 mt-3 pt-3 border-t">
                  <Input
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Ask AI to adjust parameters..."
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

            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Target className="h-4 w-4" />
                    Rule Formula
                  </CardTitle>
                  <Button 
                    size="sm" 
                    onClick={handleSaveRule}
                    disabled={saveRuleMutation.isPending}
                    data-testid="button-save-rule"
                  >
                    {saveRuleMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4 mr-2" />
                    )}
                    Save Rule
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs">Rule Name</Label>
                    <Input
                      value={currentRule.name || ""}
                      onChange={(e) => setCurrentRule(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="Rule name"
                      className="h-8"
                      data-testid="input-rule-name"
                    />
                  </div>
                  
                  <Separator />
                  
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Breakout Min %</Label>
                      <Input
                        type="number"
                        step="0.001"
                        value={currentRule.formulaParams?.breakoutMinPct || 0}
                        onChange={(e) => updateFormulaParam("breakoutMinPct", e.target.value)}
                        className="h-8"
                        data-testid="input-breakout-min"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Breakout Max %</Label>
                      <Input
                        type="number"
                        step="0.001"
                        value={currentRule.formulaParams?.breakoutMaxPct || 0}
                        onChange={(e) => updateFormulaParam("breakoutMaxPct", e.target.value)}
                        className="h-8"
                        data-testid="input-breakout-max"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Volume Ratio</Label>
                      <Input
                        type="number"
                        step="0.1"
                        value={currentRule.formulaParams?.volumeRatio || 0}
                        onChange={(e) => updateFormulaParam("volumeRatio", e.target.value)}
                        className="h-8"
                        data-testid="input-volume-ratio"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Pullback Depth Min</Label>
                      <Input
                        type="number"
                        step="0.1"
                        value={currentRule.formulaParams?.pullbackMinDepth || 0}
                        onChange={(e) => updateFormulaParam("pullbackMinDepth", e.target.value)}
                        className="h-8"
                        data-testid="input-pullback-min"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">MA Distance %</Label>
                      <Input
                        type="number"
                        step="0.001"
                        value={currentRule.formulaParams?.maDistance || 0}
                        onChange={(e) => updateFormulaParam("maDistance", e.target.value)}
                        className="h-8"
                        data-testid="input-ma-distance"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">MA Period</Label>
                      <Input
                        type="number"
                        value={currentRule.formulaParams?.maPeriod || 20}
                        onChange={(e) => updateFormulaParam("maPeriod", e.target.value)}
                        className="h-8"
                        data-testid="input-ma-period"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Entry Confirm %</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={currentRule.formulaParams?.entryConfirmPct || 0}
                        onChange={(e) => updateFormulaParam("entryConfirmPct", e.target.value)}
                        className="h-8"
                        data-testid="input-entry-confirm"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Invalidation %</Label>
                      <Input
                        type="number"
                        step="0.001"
                        value={currentRule.formulaParams?.invalidationPct || 0}
                        onChange={(e) => updateFormulaParam("invalidationPct", e.target.value)}
                        className="h-8"
                        data-testid="input-invalidation"
                      />
                    </div>
                  </div>
                  
                  {confidence && (
                    <>
                      <Separator />
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Confidence</span>
                        <Badge variant="outline">{String((confidence as any).confidenceLevel || 'untested')}</Badge>
                      </div>
                      <div className="grid grid-cols-4 gap-2 text-center text-xs">
                        <div>
                          <div className="font-bold text-red-400">{String((confidence as any).rating1Count || 0)}</div>
                          <div className="text-muted-foreground">Useless</div>
                        </div>
                        <div>
                          <div className="font-bold text-yellow-400">{String((confidence as any).rating2Count || 0)}</div>
                          <div className="text-muted-foreground">Elements</div>
                        </div>
                        <div>
                          <div className="font-bold text-blue-400">{String((confidence as any).rating3Count || 0)}</div>
                          <div className="text-muted-foreground">Past</div>
                        </div>
                        <div>
                          <div className="font-bold text-green-400">{String((confidence as any).rating4Count || 0)}</div>
                          <div className="text-muted-foreground">Good</div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
