import { useState } from "react";
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
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { 
  BookOpen, Shield, Brain, Users, Plus, Edit3, RotateCcw, Check, X, 
  AlertTriangle, Info, AlertCircle, Ban, ChevronDown, ChevronUp,
  Sparkles, TrendingUp, TrendingDown, ArrowUpDown, Loader2
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { SentinelHeader } from "@/components/SentinelHeader";

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
  ruleType?: string;
  directionTags?: string[];
  isGlobal?: boolean;
}

interface RuleOverride {
  id: number;
  userId: number;
  ruleCode: string;
  customName?: string;
  customDescription?: string;
  customSeverity?: string;
  isDisabled?: boolean;
  customFormula?: string;
  notes?: string;
}

interface RuleSuggestion {
  id: number;
  name: string;
  description?: string;
  category?: string;
  severity?: string;
  confidenceScore: number;
  status: string;
  supportingData?: {
    totalTrades?: number;
    winRate?: number;
    patternDescription?: string;
  };
}

const RULE_CATEGORIES = [
  { value: "auto_reject", label: "Structural Requirements" },
  { value: "profit_taking", label: "Profit Taking" },
  { value: "stop_loss", label: "Stop Loss" },
  { value: "ma_structure", label: "MA Structure" },
  { value: "base_quality", label: "Base Quality" },
  { value: "breakout", label: "Breakout" },
  { value: "position_sizing", label: "Position Sizing" },
  { value: "entry", label: "Entry" },
  { value: "exit", label: "Exit" },
  { value: "risk", label: "Risk" },
  { value: "market_regime", label: "Market Regime" },
  { value: "general", label: "General" },
];

const SEVERITY_LEVELS = [
  { value: "auto_reject", label: "Structural Issue", color: "text-red-500", bgColor: "bg-red-500/10" },
  { value: "critical", label: "Critical", color: "text-orange-500", bgColor: "bg-orange-500/10" },
  { value: "warning", label: "Warning", color: "text-yellow-500", bgColor: "bg-yellow-500/10" },
  { value: "info", label: "Info", color: "text-blue-500", bgColor: "bg-blue-500/10" },
];

const RULE_TYPES = [
  { value: "all", label: "All Trades" },
  { value: "swing", label: "Swing" },
  { value: "intraday", label: "Intraday" },
  { value: "long_term", label: "Long Term" },
];

export default function SentinelRulesPage() {
  const { user, logout } = useSentinelAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("system");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [selectedRule, setSelectedRule] = useState<TradingRule | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(["auto_reject"]));
  
  const [newRule, setNewRule] = useState({
    name: "",
    description: "",
    category: "general",
    severity: "warning",
    ruleType: "swing",
    directionTags: ["long"],
    formula: "",
  });

  const [editOverride, setEditOverride] = useState({
    customName: "",
    customDescription: "",
    customSeverity: "",
    isDisabled: false,
    customFormula: "",
    notes: "",
  });

  const { data: rules = [], isLoading: rulesLoading } = useQuery<TradingRule[]>({
    queryKey: ["/api/sentinel/rules"],
  });

  const { data: overrides = [], isLoading: overridesLoading } = useQuery<RuleOverride[]>({
    queryKey: ["/api/sentinel/rules/overrides"],
  });

  const { data: suggestions = [], isLoading: suggestionsLoading } = useQuery<RuleSuggestion[]>({
    queryKey: ["/api/sentinel/suggestions"],
  });

  const { data: globalRules = [], isLoading: globalRulesLoading } = useQuery<TradingRule[]>({
    queryKey: ["/api/sentinel/rules/global"],
  });

  const isSystemTabLoading = rulesLoading || overridesLoading;
  const isAITabLoading = suggestionsLoading;
  const isCommunityTabLoading = globalRulesLoading;

  const starterRules = rules.filter(r => r.source === "starter");
  const userRules = rules.filter(r => r.source === "user");
  const aiRules = rules.filter(r => r.source === "ai_collective" || r.source === "ai_agentic");

  const createRuleMutation = useMutation({
    mutationFn: async (data: typeof newRule) => {
      return apiRequest("/api/sentinel/rules", {
        method: "POST",
        body: JSON.stringify({
          name: data.name,
          description: data.description,
          category: data.category,
          severity: data.severity,
          ruleType: data.ruleType,
          directionTags: data.directionTags,
          formula: data.formula || null,
          source: "user",
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/rules"] });
      setShowCreateDialog(false);
      setNewRule({ name: "", description: "", category: "general", severity: "warning", ruleType: "swing", directionTags: ["long"], formula: "" });
      toast({ title: "Rule created successfully" });
    },
    onError: () => {
      toast({ title: "Failed to create rule", variant: "destructive" });
    },
  });

  const updateRuleMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<TradingRule> }) => {
      return apiRequest(`/api/sentinel/rules/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/rules"] });
      toast({ title: "Rule updated" });
    },
    onError: () => {
      toast({ title: "Failed to update rule", variant: "destructive" });
    },
  });

  const saveOverrideMutation = useMutation({
    mutationFn: async (data: { ruleCode: string } & typeof editOverride) => {
      return apiRequest("/api/sentinel/rules/overrides", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/rules/overrides"] });
      setShowEditDialog(false);
      toast({ title: "Override saved" });
    },
    onError: () => {
      toast({ title: "Failed to save override", variant: "destructive" });
    },
  });

  const restoreOverrideMutation = useMutation({
    mutationFn: async (ruleCode: string) => {
      return apiRequest(`/api/sentinel/rules/overrides/${ruleCode}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/rules/overrides"] });
      toast({ title: "Rule restored to default" });
    },
    onError: () => {
      toast({ title: "Failed to restore rule", variant: "destructive" });
    },
  });

  const deleteRuleMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest(`/api/sentinel/rules/${id}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/rules"] });
      toast({ title: "Rule deleted" });
    },
    onError: () => {
      toast({ title: "Failed to delete rule", variant: "destructive" });
    },
  });

  const adoptSuggestionMutation = useMutation({
    mutationFn: async (suggestionId: number) => {
      return apiRequest(`/api/sentinel/suggestions/${suggestionId}/adopt`, {
        method: "POST",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/rules"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/suggestions"] });
      toast({ title: "Rule adopted successfully" });
    },
    onError: () => {
      toast({ title: "Failed to adopt rule", variant: "destructive" });
    },
  });

  const getOverrideForRule = (ruleCode?: string) => {
    if (!ruleCode) return null;
    return overrides.find(o => o.ruleCode === ruleCode);
  };

  const getRuleWithOverride = (rule: TradingRule) => {
    const override = getOverrideForRule(rule.ruleCode);
    if (!override) return rule;
    return {
      ...rule,
      name: override.customName || rule.name,
      description: override.customDescription || rule.description,
      severity: override.customSeverity || rule.severity,
      formula: override.customFormula || rule.formula,
      isActive: !override.isDisabled,
    };
  };

  const getSeverityIcon = (severity?: string) => {
    switch (severity) {
      case "auto_reject": return <Ban className="w-4 h-4 text-red-500" />;
      case "critical": return <AlertCircle className="w-4 h-4 text-orange-500" />;
      case "warning": return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
      case "info": return <Info className="w-4 h-4 text-blue-500" />;
      default: return <Info className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getSeverityLabel = (severity?: string) => {
    const level = SEVERITY_LEVELS.find(l => l.value === severity);
    return level?.label || severity || "Info";
  };

  const getCategoryLabel = (category?: string) => {
    const cat = RULE_CATEGORIES.find(c => c.value === category);
    return cat?.label || category || "General";
  };

  const toggleCategory = (category: string) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(category)) {
      newExpanded.delete(category);
    } else {
      newExpanded.add(category);
    }
    setExpandedCategories(newExpanded);
  };

  const openEditOverride = (rule: TradingRule) => {
    setSelectedRule(rule);
    const override = getOverrideForRule(rule.ruleCode);
    setEditOverride({
      customName: override?.customName || "",
      customDescription: override?.customDescription || "",
      customSeverity: override?.customSeverity || "",
      isDisabled: override?.isDisabled || false,
      customFormula: override?.customFormula || "",
      notes: override?.notes || "",
    });
    setShowEditDialog(true);
  };

  const groupRulesByCategory = (rulesList: TradingRule[]) => {
    const grouped: Record<string, TradingRule[]> = {};
    for (const rule of rulesList) {
      const cat = rule.category || "general";
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(getRuleWithOverride(rule));
    }
    return grouped;
  };

  const renderRuleCard = (rule: TradingRule, showEdit = false, isStarter = false) => {
    const override = getOverrideForRule(rule.ruleCode);
    const hasOverride = !!override;
    const displayRule = getRuleWithOverride(rule);
    
    return (
      <div 
        key={rule.id}
        className={`p-3 rounded-md border ${displayRule.isActive ? "bg-card" : "bg-muted/30 opacity-60"} ${hasOverride ? "border-primary/30" : "border-border"}`}
        data-testid={`rule-card-${rule.id}`}
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5">
            {getSeverityIcon(displayRule.severity)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`font-medium ${!displayRule.isActive ? "line-through text-muted-foreground" : ""}`}>
                {displayRule.name}
              </span>
              {hasOverride && (
                <Badge variant="outline" className="text-xs">Customized</Badge>
              )}
              {!displayRule.isActive && (
                <Badge variant="secondary" className="text-xs">Disabled</Badge>
              )}
            </div>
            {displayRule.description && (
              <p className="text-sm text-muted-foreground mt-1">{displayRule.description}</p>
            )}
            {displayRule.formula && (
              <code className="text-xs bg-muted px-1.5 py-0.5 rounded mt-1 inline-block font-mono">
                {displayRule.formula}
              </code>
            )}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {displayRule.ruleType && displayRule.ruleType !== "all" && (
                <Badge variant="outline" className="text-xs">
                  {RULE_TYPES.find(t => t.value === displayRule.ruleType)?.label}
                </Badge>
              )}
              {displayRule.directionTags?.map(tag => (
                <Badge key={tag} variant="outline" className="text-xs">
                  {tag === "long" ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
          {showEdit && (
            <div className="flex items-center gap-1">
              {isStarter && (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-7 w-7"
                        onClick={() => openEditOverride(rule)}
                        data-testid={`button-edit-rule-${rule.id}`}
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Customize this rule</TooltipContent>
                  </Tooltip>
                  {hasOverride && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-7 w-7"
                          onClick={() => restoreOverrideMutation.mutate(rule.ruleCode!)}
                          data-testid={`button-restore-rule-${rule.id}`}
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Restore to default</TooltipContent>
                    </Tooltip>
                  )}
                </>
              )}
              {!isStarter && (
                <>
                  <Switch
                    checked={displayRule.isActive}
                    onCheckedChange={(checked) => updateRuleMutation.mutate({ id: rule.id, data: { isActive: checked } })}
                    data-testid={`switch-rule-active-${rule.id}`}
                  />
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-7 w-7 text-destructive"
                    onClick={() => deleteRuleMutation.mutate(rule.id)}
                    data-testid={`button-delete-rule-${rule.id}`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <SentinelHeader />
      
      <div className="container mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Trading Rules</h1>
            <p className="text-muted-foreground">Manage your trading discipline and evaluation criteria</p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-4 mb-6">
            <TabsTrigger value="system" className="flex items-center gap-2" data-testid="tab-system-rules">
              <Shield className="w-4 h-4" />
              <span className="hidden sm:inline">Base System</span>
              <span className="sm:hidden">System</span>
            </TabsTrigger>
            <TabsTrigger value="personal" className="flex items-center gap-2" data-testid="tab-my-rules">
              <BookOpen className="w-4 h-4" />
              <span className="hidden sm:inline">My Rules</span>
              <span className="sm:hidden">Mine</span>
            </TabsTrigger>
            <TabsTrigger value="ai" className="flex items-center gap-2" data-testid="tab-ai-rules">
              <Brain className="w-4 h-4" />
              <span className="hidden sm:inline">AI Rules</span>
              <span className="sm:hidden">AI</span>
            </TabsTrigger>
            <TabsTrigger value="community" className="flex items-center gap-2" data-testid="tab-community-rules">
              <Users className="w-4 h-4" />
              <span className="hidden sm:inline">Community</span>
              <span className="sm:hidden">Comm.</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="system" className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Base System Rules</CardTitle>
                <CardDescription>
                  {isSystemTabLoading ? "Loading rules..." : `${starterRules.length} rules from the starter rulebook. Customize or disable rules to fit your trading style.`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isSystemTabLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <ScrollArea className="h-[calc(100vh-340px)]">
                    <div className="space-y-4">
                      {RULE_CATEGORIES.map(cat => {
                        const categoryRules = starterRules.filter(r => r.category === cat.value);
                        if (categoryRules.length === 0) return null;
                        const isExpanded = expandedCategories.has(cat.value);
                        
                        return (
                          <div key={cat.value} className="border rounded-lg">
                            <button
                              className="w-full flex items-center justify-between p-3 hover-elevate"
                              onClick={() => toggleCategory(cat.value)}
                              data-testid={`category-toggle-${cat.value}`}
                            >
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{cat.label}</span>
                                <Badge variant="secondary" className="text-xs">{categoryRules.length}</Badge>
                              </div>
                              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            </button>
                            {isExpanded && (
                              <div className="px-3 pb-3 space-y-2">
                                {categoryRules.map(rule => renderRuleCard(rule, true, true))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="personal" className="space-y-4">
            <Card>
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-lg">My Custom Rules</CardTitle>
                  <CardDescription>
                    {userRules.length} personal rules you've created
                  </CardDescription>
                </div>
                <Button onClick={() => setShowCreateDialog(true)} data-testid="button-create-rule">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Rule
                </Button>
              </CardHeader>
              <CardContent>
                {userRules.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <BookOpen className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p className="font-medium">No custom rules yet</p>
                    <p className="text-sm">Create rules based on your trading experience</p>
                  </div>
                ) : (
                  <ScrollArea className="h-[calc(100vh-380px)]">
                    <div className="space-y-2">
                      {userRules.map(rule => renderRuleCard(rule, true, false))}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="ai" className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-primary" />
                  AI-Suggested Rules
                </CardTitle>
                <CardDescription>
                  Rules discovered through pattern analysis of trading performance
                </CardDescription>
              </CardHeader>
              <CardContent>
                {suggestions.length === 0 && aiRules.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Brain className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p className="font-medium">No AI suggestions yet</p>
                    <p className="text-sm">Complete more trades to enable pattern analysis</p>
                  </div>
                ) : (
                  <ScrollArea className="h-[calc(100vh-380px)]">
                    <div className="space-y-4">
                      {suggestions.filter(s => s.status === "pending").length > 0 && (
                        <div>
                          <h3 className="font-medium mb-3">Pending Suggestions</h3>
                          <div className="space-y-2">
                            {suggestions.filter(s => s.status === "pending").map(suggestion => (
                              <div key={suggestion.id} className="p-3 rounded-md border bg-card">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2">
                                      <span className="font-medium">{suggestion.name}</span>
                                      <Badge variant="outline" className="text-xs">
                                        {Math.round((suggestion.confidenceScore || 0) * 100)}% confidence
                                      </Badge>
                                    </div>
                                    {suggestion.description && (
                                      <p className="text-sm text-muted-foreground mt-1">{suggestion.description}</p>
                                    )}
                                    {suggestion.supportingData && (
                                      <p className="text-xs text-muted-foreground mt-1">
                                        Based on {suggestion.supportingData.totalTrades} trades • {suggestion.supportingData.winRate}% win rate
                                      </p>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <Button
                                      size="sm"
                                      onClick={() => adoptSuggestionMutation.mutate(suggestion.id)}
                                      disabled={adoptSuggestionMutation.isPending}
                                      data-testid={`button-adopt-suggestion-${suggestion.id}`}
                                    >
                                      <Check className="w-3.5 h-3.5 mr-1" />
                                      Adopt
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {aiRules.length > 0 && (
                        <div>
                          <h3 className="font-medium mb-3">Adopted AI Rules</h3>
                          <div className="space-y-2">
                            {aiRules.map(rule => renderRuleCard(rule, true, false))}
                          </div>
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="community" className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Users className="w-5 h-5" />
                  Community Rules
                </CardTitle>
                <CardDescription>
                  Rules shared by the trading community. Opt-in to share your rule performance anonymously.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg mb-4">
                  <div>
                    <p className="font-medium">Contribute to Community Learning</p>
                    <p className="text-sm text-muted-foreground">
                      Share your anonymous rule performance data to help discover winning patterns
                    </p>
                  </div>
                  <Switch 
                    checked={user?.communityOptIn || false}
                    onCheckedChange={(checked) => {
                      apiRequest("/api/sentinel/user/community-opt-in", {
                        method: "PATCH",
                        body: JSON.stringify({ optIn: checked }),
                      }).then(() => {
                        queryClient.invalidateQueries({ queryKey: ["/api/sentinel/user"] });
                        toast({ title: checked ? "Opted in to community sharing" : "Opted out of community sharing" });
                      });
                    }}
                    data-testid="switch-community-opt-in"
                  />
                </div>
                
                {globalRules.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p className="font-medium">No community rules available yet</p>
                    <p className="text-sm">Check back later as the community grows</p>
                  </div>
                ) : (
                  <ScrollArea className="h-[calc(100vh-440px)]">
                    <div className="space-y-2">
                      {globalRules.map(rule => renderRuleCard(rule, false, false))}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create New Rule</DialogTitle>
            <DialogDescription>
              Add a personal trading rule to your rulebook
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Rule Name</Label>
              <Input
                value={newRule.name}
                onChange={(e) => setNewRule({ ...newRule, name: e.target.value })}
                placeholder="e.g., Wait for volume confirmation"
                data-testid="input-rule-name"
              />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea
                value={newRule.description}
                onChange={(e) => setNewRule({ ...newRule, description: e.target.value })}
                placeholder="Explain what this rule means and when to apply it..."
                rows={3}
                data-testid="input-rule-description"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Category</Label>
                <Select value={newRule.category} onValueChange={(v) => setNewRule({ ...newRule, category: v })}>
                  <SelectTrigger data-testid="select-rule-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RULE_CATEGORIES.map(cat => (
                      <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Severity</Label>
                <Select value={newRule.severity} onValueChange={(v) => setNewRule({ ...newRule, severity: v })}>
                  <SelectTrigger data-testid="select-rule-severity">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SEVERITY_LEVELS.map(level => (
                      <SelectItem key={level.value} value={level.value}>{level.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Trade Type</Label>
                <Select value={newRule.ruleType} onValueChange={(v) => setNewRule({ ...newRule, ruleType: v })}>
                  <SelectTrigger data-testid="select-rule-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RULE_TYPES.map(type => (
                      <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Direction</Label>
                <div className="flex items-center gap-2 mt-2">
                  <Button
                    type="button"
                    variant={newRule.directionTags.includes("long") ? "default" : "outline"}
                    size="sm"
                    onClick={() => {
                      const tags = newRule.directionTags.includes("long")
                        ? newRule.directionTags.filter(t => t !== "long")
                        : [...newRule.directionTags, "long"];
                      if (tags.length > 0) setNewRule({ ...newRule, directionTags: tags });
                    }}
                    data-testid="button-direction-long"
                  >
                    <TrendingUp className="w-3 h-3 mr-1" />
                    Long
                  </Button>
                  <Button
                    type="button"
                    variant={newRule.directionTags.includes("short") ? "default" : "outline"}
                    size="sm"
                    onClick={() => {
                      const tags = newRule.directionTags.includes("short")
                        ? newRule.directionTags.filter(t => t !== "short")
                        : [...newRule.directionTags, "short"];
                      if (tags.length > 0) setNewRule({ ...newRule, directionTags: tags });
                    }}
                    data-testid="button-direction-short"
                  >
                    <TrendingDown className="w-3 h-3 mr-1" />
                    Short
                  </Button>
                </div>
              </div>
            </div>
            <div>
              <Label>Formula (optional)</Label>
              <Input
                value={newRule.formula}
                onChange={(e) => setNewRule({ ...newRule, formula: e.target.value })}
                placeholder="e.g., R:R = (Target - Entry) / (Entry - Stop) ≥ 3"
                data-testid="input-rule-formula"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
            <Button 
              onClick={() => createRuleMutation.mutate(newRule)}
              disabled={!newRule.name.trim() || createRuleMutation.isPending}
              data-testid="button-save-rule"
            >
              Create Rule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Customize Rule</DialogTitle>
            <DialogDescription>
              Personalize this system rule. Your changes will override the defaults.
            </DialogDescription>
          </DialogHeader>
          {selectedRule && (
            <div className="space-y-4">
              <div className="p-3 bg-muted/30 rounded-lg">
                <p className="text-sm font-medium text-muted-foreground">Original Rule</p>
                <p className="font-medium">{selectedRule.name}</p>
              </div>
              
              <div className="flex items-center justify-between p-3 border rounded-lg">
                <div>
                  <p className="font-medium">Disable this rule</p>
                  <p className="text-sm text-muted-foreground">Rule will be skipped during evaluations</p>
                </div>
                <Switch
                  checked={editOverride.isDisabled}
                  onCheckedChange={(checked) => setEditOverride({ ...editOverride, isDisabled: checked })}
                  data-testid="switch-disable-rule"
                />
              </div>

              <div>
                <Label>Custom Name (optional)</Label>
                <Input
                  value={editOverride.customName}
                  onChange={(e) => setEditOverride({ ...editOverride, customName: e.target.value })}
                  placeholder={selectedRule.name}
                  data-testid="input-override-name"
                />
              </div>
              <div>
                <Label>Custom Description (optional)</Label>
                <Textarea
                  value={editOverride.customDescription}
                  onChange={(e) => setEditOverride({ ...editOverride, customDescription: e.target.value })}
                  placeholder={selectedRule.description || "Add your own description..."}
                  rows={2}
                  data-testid="input-override-description"
                />
              </div>
              <div>
                <Label>Custom Severity (optional)</Label>
                <Select 
                  value={editOverride.customSeverity || ""}
                  onValueChange={(v) => setEditOverride({ ...editOverride, customSeverity: v })}
                >
                  <SelectTrigger data-testid="select-override-severity">
                    <SelectValue placeholder={getSeverityLabel(selectedRule.severity)} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Use default</SelectItem>
                    {SEVERITY_LEVELS.map(level => (
                      <SelectItem key={level.value} value={level.value}>{level.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Personal Notes</Label>
                <Textarea
                  value={editOverride.notes}
                  onChange={(e) => setEditOverride({ ...editOverride, notes: e.target.value })}
                  placeholder="Add notes about how you apply this rule..."
                  rows={2}
                  data-testid="input-override-notes"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>Cancel</Button>
            <Button 
              onClick={() => {
                if (selectedRule?.ruleCode) {
                  saveOverrideMutation.mutate({
                    ruleCode: selectedRule.ruleCode,
                    ...editOverride,
                  });
                }
              }}
              disabled={saveOverrideMutation.isPending}
              data-testid="button-save-override"
            >
              Save Customization
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
