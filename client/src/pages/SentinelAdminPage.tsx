import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { SentinelHeader } from "@/components/SentinelHeader";
import { Brain, Settings, Users, Tags, ChevronDown, ChevronUp, CheckCircle2, XCircle, TrendingUp, Zap, History, Lightbulb, Loader2 } from "lucide-react";

interface FactorWeight {
  id: number;
  factorKey: string;
  factorName: string;
  category: string;
  baseWeight: number;
  aiAdjustedWeight: number;
  autoAdjust: boolean;
  maxMagnitude: number | null;
  maxDrift: number | null;
  sampleSize: number;
  lastAiUpdate: string | null;
  description: string;
}

interface RuleModifier {
  id: number;
  factorId: number;
  factorName: string;
  whenRuleId: number;
  whenRuleName: string;
  weightModifier: number;
  confidence: number;
  sampleSize: number;
  isAiSuggested: boolean;
  isApproved: boolean;
}

interface WeightSuggestion {
  id: number;
  factorId: number;
  factorName: string;
  suggestionType: "weight_change" | "rule_modifier";
  currentValue: number;
  proposedValue: number;
  reasoning: string;
  confidenceScore: number;
  sampleSize: number;
  winRateDelta: number;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  whenRuleName?: string;
}

interface WeightHistory {
  id: number;
  factorName: string;
  changeType: string;
  oldValue: number;
  newValue: number;
  changedBy: string;
  changedAt: string;
  reason: string;
}

const MOCK_FACTORS: FactorWeight[] = [
  { id: 1, factorKey: "rr_ratio", factorName: "Risk/Reward Ratio", category: "Risk", baseWeight: 90, aiAdjustedWeight: 88, autoAdjust: false, maxMagnitude: null, maxDrift: null, sampleSize: 156, lastAiUpdate: "2024-01-15", description: "Minimum R:R threshold for trade approval" },
  { id: 2, factorKey: "ma_proximity_50", factorName: "Price vs 50 SMA", category: "Technical", baseWeight: 70, aiAdjustedWeight: 55, autoAdjust: true, maxMagnitude: 15, maxDrift: 30, sampleSize: 142, lastAiUpdate: "2024-01-20", description: "Distance from 50-day moving average" },
  { id: 3, factorKey: "stop_quality", factorName: "Stop Placement Quality", category: "Risk", baseWeight: 80, aiAdjustedWeight: 82, autoAdjust: false, maxMagnitude: null, maxDrift: null, sampleSize: 134, lastAiUpdate: "2024-01-18", description: "Stop at logical support level" },
  { id: 4, factorKey: "tight_stop", factorName: "Tight Stop (<0.5x ATR)", category: "Risk", baseWeight: 60, aiAdjustedWeight: 65, autoAdjust: true, maxMagnitude: 10, maxDrift: 25, sampleSize: 98, lastAiUpdate: "2024-01-22", description: "Stop tighter than half ATR" },
  { id: 5, factorKey: "position_sizing", factorName: "Position Size Risk", category: "Risk", baseWeight: 85, aiAdjustedWeight: 85, autoAdjust: false, maxMagnitude: null, maxDrift: null, sampleSize: 156, lastAiUpdate: null, description: "Account risk percentage" },
  { id: 6, factorKey: "entry_quality", factorName: "Entry Quality", category: "Technical", baseWeight: 75, aiAdjustedWeight: 72, autoAdjust: true, maxMagnitude: null, maxDrift: null, sampleSize: 128, lastAiUpdate: "2024-01-19", description: "Entry at defined trigger vs chasing" },
  { id: 7, factorKey: "ma_structure", factorName: "MA Structure (Bull/Bear)", category: "Technical", baseWeight: 65, aiAdjustedWeight: 68, autoAdjust: true, maxMagnitude: 10, maxDrift: 20, sampleSize: 145, lastAiUpdate: "2024-01-21", description: "21/50/200 MA alignment" },
  { id: 8, factorKey: "regime_alignment", factorName: "Market Regime Alignment", category: "Environment", baseWeight: 70, aiAdjustedWeight: 75, autoAdjust: true, maxMagnitude: 15, maxDrift: null, sampleSize: 156, lastAiUpdate: "2024-01-23", description: "Trade direction vs market trend" },
];

const MOCK_MODIFIERS: RuleModifier[] = [
  { id: 1, factorId: 4, factorName: "Tight Stop", whenRuleId: 101, whenRuleName: "Choppy Market Regime", weightModifier: 25, confidence: 78, sampleSize: 47, isAiSuggested: true, isApproved: true },
  { id: 2, factorId: 6, factorName: "Entry Quality", whenRuleId: 102, whenRuleName: "Extended from 21 EMA", weightModifier: -15, confidence: 72, sampleSize: 38, isAiSuggested: true, isApproved: true },
  { id: 3, factorId: 8, factorName: "Market Regime Alignment", whenRuleId: 103, whenRuleName: "Weekly Tailwind", weightModifier: 10, confidence: 81, sampleSize: 62, isAiSuggested: false, isApproved: true },
];

const MOCK_SUGGESTIONS: WeightSuggestion[] = [
  { id: 1, factorId: 2, factorName: "Price vs 50 SMA", suggestionType: "weight_change", currentValue: 55, proposedValue: 48, reasoning: "Trades 5-8% away from 50 SMA showed similar win rates to 3% trades. Recommend reducing importance.", confidenceScore: 76, sampleSize: 34, winRateDelta: -2.1, status: "pending", createdAt: "2024-01-24" },
  { id: 2, factorId: 4, factorName: "Tight Stop", suggestionType: "rule_modifier", currentValue: 65, proposedValue: 90, reasoning: "When paired with 'Trending Weekly' rule, tight stops have 82% win rate vs 58% baseline.", confidenceScore: 84, sampleSize: 28, winRateDelta: 24, status: "pending", createdAt: "2024-01-23", whenRuleName: "Trending Weekly" },
];

const MOCK_HISTORY: WeightHistory[] = [
  { id: 1, factorName: "Price vs 50 SMA", changeType: "AI Adjustment", oldValue: 70, newValue: 55, changedBy: "AI (auto)", changedAt: "2024-01-20", reason: "5% distance trades perform similarly to 3%" },
  { id: 2, factorName: "Tight Stop", changeType: "Modifier Added", oldValue: 0, newValue: 25, changedBy: "Admin", changedAt: "2024-01-18", reason: "Approved AI suggestion for choppy market modifier" },
  { id: 3, factorName: "Entry Quality", changeType: "AI Adjustment", oldValue: 75, newValue: 72, changedBy: "AI (auto)", changedAt: "2024-01-19", reason: "Slight reduction based on pullback entry success" },
];

export default function SentinelAdminPage() {
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState("tnn");
  const [expandedFactors, setExpandedFactors] = useState<number[]>([]);
  const [suggestionAction, setSuggestionAction] = useState<{ id: number; value: number } | null>(null);

  const { data: userInfo, isLoading: userLoading } = useQuery<{ id: number; username: string; isAdmin: boolean }>({
    queryKey: ["/api/sentinel/me"],
  });

  if (userLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center" data-testid="container-loading">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin" data-testid="spinner-loading" />
          <span data-testid="text-loading">Loading admin tools...</span>
        </div>
      </div>
    );
  }

  if (!userInfo?.isAdmin) {
    navigate("/sentinel/dashboard");
    return null;
  }

  const toggleFactorExpand = (id: number) => {
    setExpandedFactors(prev => 
      prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]
    );
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case "Risk": return "bg-red-500/20 text-red-400 border-red-500/30";
      case "Technical": return "bg-blue-500/20 text-blue-400 border-blue-500/30";
      case "Environment": return "bg-purple-500/20 text-purple-400 border-purple-500/30";
      default: return "bg-muted text-muted-foreground";
    }
  };

  const getWeightColor = (weight: number) => {
    if (weight >= 80) return "text-green-400";
    if (weight >= 60) return "text-yellow-400";
    return "text-red-400";
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 80) return "text-green-400";
    if (confidence >= 65) return "text-yellow-400";
    return "text-orange-400";
  };

  return (
    <div className="min-h-screen bg-background">
      <SentinelHeader />
      
      <div className="container mx-auto p-6 max-w-7xl">
        <div className="flex items-center gap-3 mb-6" data-testid="container-admin-header">
          <Settings className="w-8 h-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-admin-title">Admin</h1>
            <p className="text-muted-foreground" data-testid="text-admin-subtitle">System configuration and AI tuning</p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6">
            <TabsTrigger value="tnn" className="gap-2" data-testid="tab-tnn">
              <Brain className="w-4 h-4" />
              TNN
            </TabsTrigger>
            <TabsTrigger value="labels" className="gap-2" data-testid="tab-labels">
              <Tags className="w-4 h-4" />
              Labels
            </TabsTrigger>
            <TabsTrigger value="users" className="gap-2" data-testid="tab-users">
              <Users className="w-4 h-4" />
              Users
            </TabsTrigger>
          </TabsList>

          <TabsContent value="tnn">
            <div className="space-y-6">
              <Card className="bg-gradient-to-r from-purple-500/10 to-blue-500/10 border-purple-500/30">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <Brain className="w-6 h-6 text-purple-400" />
                    <div>
                      <CardTitle data-testid="text-tnn-title">Trader Neural Network</CardTitle>
                      <CardDescription data-testid="text-tnn-desc">Adaptive factor weighting with AI-driven learning</CardDescription>
                    </div>
                  </div>
                </CardHeader>
              </Card>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-4">
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-lg flex items-center gap-2" data-testid="text-factor-weights-title">
                        <TrendingUp className="w-5 h-5" />
                        Factor Weights
                      </CardTitle>
                      <CardDescription data-testid="text-factor-weights-desc">Configure importance of each evaluation factor</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {MOCK_FACTORS.map(factor => (
                        <div 
                          key={factor.id} 
                          className="border rounded-lg overflow-hidden"
                          data-testid={`factor-${factor.factorKey}`}
                        >
                          <div 
                            className="flex items-center justify-between p-3 cursor-pointer hover-elevate"
                            onClick={() => toggleFactorExpand(factor.id)}
                            data-testid={`button-expand-${factor.factorKey}`}
                          >
                            <div className="flex items-center gap-3">
                              <Badge variant="outline" className={getCategoryColor(factor.category)} data-testid={`badge-category-${factor.factorKey}`}>
                                {factor.category}
                              </Badge>
                              <span className="font-medium" data-testid={`text-factor-name-${factor.factorKey}`}>{factor.factorName}</span>
                              {factor.autoAdjust && (
                                <Badge variant="outline" className="bg-purple-500/10 text-purple-400 border-purple-500/30 text-xs" data-testid={`badge-auto-${factor.factorKey}`}>
                                  <Zap className="w-3 h-3 mr-1" />
                                  Auto
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-4">
                              <div className="text-right">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm text-muted-foreground" data-testid={`label-header-base-${factor.factorKey}`}>Base:</span>
                                  <span className={`font-bold ${getWeightColor(factor.baseWeight)}`} data-testid={`text-base-weight-${factor.factorKey}`}>{factor.baseWeight}</span>
                                  {factor.aiAdjustedWeight !== factor.baseWeight && (
                                    <>
                                      <span className="text-muted-foreground" data-testid={`label-header-arrow-${factor.factorKey}`}>→</span>
                                      <span className={`font-bold ${getWeightColor(factor.aiAdjustedWeight)}`} data-testid={`text-ai-adjusted-${factor.factorKey}`}>{factor.aiAdjustedWeight}</span>
                                      <span className="text-xs text-muted-foreground" data-testid={`label-header-ai-tag-${factor.factorKey}`}>(AI)</span>
                                    </>
                                  )}
                                </div>
                                <span className="text-xs text-muted-foreground" data-testid={`text-sample-size-${factor.factorKey}`}>{factor.sampleSize} trades</span>
                              </div>
                              {expandedFactors.includes(factor.id) ? (
                                <ChevronUp className="w-4 h-4 text-muted-foreground" />
                              ) : (
                                <ChevronDown className="w-4 h-4 text-muted-foreground" />
                              )}
                            </div>
                          </div>

                          {expandedFactors.includes(factor.id) && (
                            <div className="border-t p-4 bg-muted/30 space-y-4" data-testid={`panel-factor-${factor.factorKey}`}>
                              <p className="text-sm text-muted-foreground" data-testid={`text-factor-desc-${factor.factorKey}`}>{factor.description}</p>
                              
                              <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                  <Label data-testid={`label-base-weight-${factor.factorKey}`}>Base Weight (0-100)</Label>
                                  <div className="flex items-center gap-3">
                                    <Slider 
                                      value={[factor.baseWeight]} 
                                      max={100} 
                                      step={5}
                                      className="flex-1"
                                      data-testid={`slider-base-weight-${factor.factorKey}`}
                                    />
                                    <Input 
                                      type="number" 
                                      value={factor.baseWeight}
                                      className="w-16 text-center"
                                      readOnly
                                      data-testid={`input-base-weight-${factor.factorKey}`}
                                    />
                                  </div>
                                </div>
                                
                                <div className="space-y-2">
                                  <Label data-testid={`label-ai-weight-${factor.factorKey}`}>Current AI Weight</Label>
                                  <div className="flex items-center gap-2 p-2 bg-muted rounded" data-testid={`container-ai-weight-${factor.factorKey}`}>
                                    <span className={`text-lg font-bold ${getWeightColor(factor.aiAdjustedWeight)}`} data-testid={`text-ai-weight-${factor.factorKey}`}>
                                      {factor.aiAdjustedWeight}
                                    </span>
                                    {factor.lastAiUpdate && (
                                      <span className="text-xs text-muted-foreground" data-testid={`text-ai-update-${factor.factorKey}`}>
                                        (updated {factor.lastAiUpdate})
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center justify-between pt-2 border-t">
                                <div className="flex items-center gap-3">
                                  <Switch checked={factor.autoAdjust} data-testid={`switch-auto-adjust-${factor.factorKey}`} />
                                  <Label data-testid={`label-auto-adjust-${factor.factorKey}`}>Allow AI Auto-Adjustment</Label>
                                </div>
                                
                                {factor.autoAdjust && (
                                  <div className="flex items-center gap-4">
                                    <div className="flex items-center gap-2">
                                      <Label className="text-xs" data-testid={`label-max-mag-${factor.factorKey}`}>Max per adjustment:</Label>
                                      <Input 
                                        type="number" 
                                        value={factor.maxMagnitude || ""} 
                                        placeholder="∞"
                                        className="w-16 text-center text-sm"
                                        data-testid={`input-max-magnitude-${factor.factorKey}`}
                                      />
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <Label className="text-xs" data-testid={`label-max-drift-${factor.factorKey}`}>Max drift from base:</Label>
                                      <Input 
                                        type="number" 
                                        value={factor.maxDrift || ""} 
                                        placeholder="∞"
                                        className="w-16 text-center text-sm"
                                        data-testid={`input-max-drift-${factor.factorKey}`}
                                      />
                                    </div>
                                  </div>
                                )}
                              </div>

                              <div className="flex justify-end gap-2 pt-2">
                                <Button variant="outline" size="sm" data-testid={`button-reset-${factor.factorKey}`}>Reset to Base</Button>
                                <Button size="sm" data-testid={`button-save-${factor.factorKey}`}>Save Changes</Button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-lg flex items-center gap-2" data-testid="text-modifiers-title">
                        <Zap className="w-5 h-5 text-yellow-400" />
                        Rule-to-Rule Modifiers
                      </CardTitle>
                      <CardDescription data-testid="text-modifiers-desc">Weight adjustments when specific rule combinations occur</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {MOCK_MODIFIERS.map(mod => (
                          <div key={mod.id} className="flex items-center justify-between p-3 border rounded-lg" data-testid={`modifier-${mod.id}`}>
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant="outline" data-testid={`badge-modifier-factor-${mod.id}`}>{mod.factorName}</Badge>
                              <span className="text-muted-foreground" data-testid={`label-modifier-when-${mod.id}`}>when</span>
                              <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/30" data-testid={`badge-modifier-rule-${mod.id}`}>
                                {mod.whenRuleName}
                              </Badge>
                              <span className="text-muted-foreground" data-testid={`label-modifier-triggered-${mod.id}`}>is triggered</span>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className={`font-bold ${mod.weightModifier > 0 ? 'text-green-400' : 'text-red-400'}`} data-testid={`text-modifier-value-${mod.id}`}>
                                {mod.weightModifier > 0 ? '+' : ''}{mod.weightModifier}
                              </span>
                              <span className={`text-xs ${getConfidenceColor(mod.confidence)}`} data-testid={`text-modifier-confidence-${mod.id}`}>
                                {mod.confidence}% conf
                              </span>
                              <span className="text-xs text-muted-foreground" data-testid={`text-modifier-sample-${mod.id}`}>
                                ({mod.sampleSize} trades)
                              </span>
                              {mod.isAiSuggested && (
                                <Badge variant="outline" className="text-xs bg-purple-500/10 text-purple-400" data-testid={`badge-modifier-ai-${mod.id}`}>AI</Badge>
                              )}
                            </div>
                          </div>
                        ))}
                        <Button variant="outline" className="w-full mt-3" data-testid="button-add-modifier">
                          + Add Manual Modifier
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <div className="space-y-4">
                  <Card className="border-yellow-500/30">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-lg flex items-center gap-2" data-testid="text-suggestions-title">
                        <Lightbulb className="w-5 h-5 text-yellow-400" />
                        AI Suggestions
                        <Badge className="ml-2" data-testid="badge-suggestions-count">{MOCK_SUGGESTIONS.filter(s => s.status === 'pending').length}</Badge>
                      </CardTitle>
                      <CardDescription data-testid="text-suggestions-desc">Pending weight adjustment proposals</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {MOCK_SUGGESTIONS.filter(s => s.status === 'pending').length === 0 && (
                        <p className="text-muted-foreground text-sm text-center py-4" data-testid="text-no-suggestions">No pending suggestions</p>
                      )}
                      {MOCK_SUGGESTIONS.filter(s => s.status === 'pending').map(suggestion => (
                        <div key={suggestion.id} className="p-3 border rounded-lg space-y-3" data-testid={`suggestion-${suggestion.id}`}>
                          <div className="flex items-center justify-between">
                            <Badge variant="outline" data-testid={`badge-suggestion-factor-${suggestion.id}`}>{suggestion.factorName}</Badge>
                            <span className={`text-xs ${getConfidenceColor(suggestion.confidenceScore)}`} data-testid={`text-suggestion-confidence-${suggestion.id}`}>
                              {suggestion.confidenceScore}% confidence
                            </span>
                          </div>
                          
                          {suggestion.whenRuleName && (
                            <div className="text-xs text-muted-foreground" data-testid={`text-suggestion-when-rule-${suggestion.id}`}>
                              When paired with: <span className="text-blue-400">{suggestion.whenRuleName}</span>
                            </div>
                          )}

                          <div className="flex items-center gap-2">
                            <span className="text-lg font-bold text-muted-foreground" data-testid={`text-current-value-${suggestion.id}`}>{suggestion.currentValue}</span>
                            <span className="text-muted-foreground" data-testid={`label-suggestion-arrow-${suggestion.id}`}>→</span>
                            <Input 
                              type="number" 
                              value={suggestionAction?.id === suggestion.id ? suggestionAction.value : suggestion.proposedValue}
                              onChange={(e) => setSuggestionAction({ id: suggestion.id, value: parseInt(e.target.value) || 0 })}
                              className="w-16 text-center font-bold"
                              data-testid={`input-proposed-value-${suggestion.id}`}
                            />
                            <span className={`text-sm ${suggestion.winRateDelta > 0 ? 'text-green-400' : 'text-red-400'}`} data-testid={`text-win-rate-delta-${suggestion.id}`}>
                              ({suggestion.winRateDelta > 0 ? '+' : ''}{suggestion.winRateDelta}% WR)
                            </span>
                          </div>

                          <p className="text-xs text-muted-foreground" data-testid={`text-reasoning-${suggestion.id}`}>{suggestion.reasoning}</p>
                          <p className="text-xs text-muted-foreground" data-testid={`text-suggestion-sample-${suggestion.id}`}>Based on {suggestion.sampleSize} trades</p>

                          <div className="flex gap-2">
                            <Button size="sm" className="flex-1 gap-1" data-testid={`button-approve-${suggestion.id}`}>
                              <CheckCircle2 className="w-3 h-3" />
                              Approve
                            </Button>
                            <Button size="sm" variant="outline" className="flex-1 gap-1" data-testid={`button-reject-${suggestion.id}`}>
                              <XCircle className="w-3 h-3" />
                              Reject
                            </Button>
                          </div>
                        </div>
                      ))}

                      <Button variant="outline" className="w-full gap-2" data-testid="button-analyze">
                        <Brain className="w-4 h-4" />
                        Run AI Analysis
                      </Button>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-lg flex items-center gap-2" data-testid="text-history-title">
                        <History className="w-5 h-5" />
                        Recent Changes
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {MOCK_HISTORY.map(entry => (
                        <div key={entry.id} className="p-2 border rounded text-sm" data-testid={`history-${entry.id}`}>
                          <div className="flex items-center justify-between">
                            <span className="font-medium" data-testid={`text-history-factor-${entry.id}`}>{entry.factorName}</span>
                            <span className="text-xs text-muted-foreground" data-testid={`text-history-date-${entry.id}`}>{entry.changedAt}</span>
                          </div>
                          <div className="flex items-center gap-2 text-xs mt-1">
                            <Badge variant="outline" className="text-xs" data-testid={`badge-history-type-${entry.id}`}>{entry.changeType}</Badge>
                            <span data-testid={`text-history-values-${entry.id}`}>{entry.oldValue} → {entry.newValue}</span>
                            <span className="text-muted-foreground" data-testid={`text-history-by-${entry.id}`}>by {entry.changedBy}</span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1" data-testid={`text-history-reason-${entry.id}`}>{entry.reason}</p>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="labels" data-testid="content-labels">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2" data-testid="text-labels-title">
                  <Tags className="w-5 h-5" />
                  Labels Management
                </CardTitle>
                <CardDescription data-testid="text-labels-desc">Create and manage trade labels</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground" data-testid="text-labels-coming-soon">Labels management coming soon...</p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="users" data-testid="content-users">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2" data-testid="text-users-title">
                  <Users className="w-5 h-5" />
                  User Management
                </CardTitle>
                <CardDescription data-testid="text-users-desc">Manage users and permissions</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground" data-testid="text-users-coming-soon">User management coming soon...</p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
