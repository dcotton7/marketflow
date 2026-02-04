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
  Sparkles, TrendingUp, TrendingDown, ArrowUpDown, Loader2,
  MessageSquare, Send, Trash2, Tag, Layers, Merge,
  ArrowUpCircle, ArrowDownCircle
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
  strategyTags?: string[];
  isGlobal?: boolean;
  isDeleted?: boolean;
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

interface AIChatMessage {
  role: "user" | "assistant";
  content: string;
}

export default function SentinelRulesPage() {
  const { user, logout } = useSentinelAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("system");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showAIChatDialog, setShowAIChatDialog] = useState(false);
  const [showSimilarityDialog, setShowSimilarityDialog] = useState(false);
  const [showDeletedRules, setShowDeletedRules] = useState(false);
  const [selectedRule, setSelectedRule] = useState<TradingRule | null>(null);
  const [similarRules, setSimilarRules] = useState<(TradingRule & { similarityScore: number; reason: string })[]>([]);
  const [checkingSimilarity, setCheckingSimilarity] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(["auto_reject"]));
  const [expandedMyRulesCategories, setExpandedMyRulesCategories] = useState<Set<string>>(new Set(["general"]));
  
  const [aiChatMessages, setAIChatMessages] = useState<AIChatMessage[]>([]);
  const [aiChatInput, setAIChatInput] = useState("");
  const [aiChatLoading, setAIChatLoading] = useState(false);
  const [newStrategyTag, setNewStrategyTag] = useState("");
  const [showConsolidationDialog, setShowConsolidationDialog] = useState(false);
  const [consolidationSuggestions, setConsolidationSuggestions] = useState<Array<{
    ruleIds: number[];
    rules: Array<{ id: number; name: string; description?: string | null; category?: string | null; performance?: { totalTrades: number; winRate?: number | null; avgPnL?: number | null } | null }>;
    reason: string;
    performanceIssue?: string;
    suggestedMerge?: { name: string; description: string };
  }>>([]);
  const [loadingConsolidation, setLoadingConsolidation] = useState(false);
  const [selectedConsolidation, setSelectedConsolidation] = useState<{
    ruleIds: number[];
    suggestedMerge?: { name: string; description: string };
  } | null>(null);
  const [customMerge, setCustomMerge] = useState({ name: "", description: "" });
  
  const [newRule, setNewRule] = useState({
    name: "",
    description: "",
    category: "general",
    severity: "warning",
    ruleType: "swing",
    directionTags: ["long"] as string[],
    strategyTags: [] as string[],
    formula: "",
  });
  const [createAsSystem, setCreateAsSystem] = useState(false); // Admin: create as system rule
  
  // Edit user rule state
  const [showEditUserRuleDialog, setShowEditUserRuleDialog] = useState(false);
  const [editUserRule, setEditUserRule] = useState<{
    id: number;
    name: string;
    description: string;
    category: string;
  } | null>(null);
  
  // Admin: Promote/demote confirmation
  const [confirmPromote, setConfirmPromote] = useState<{ rule: TradingRule; action: 'promote' | 'demote' } | null>(null);

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
  const userRulesAll = rules.filter(r => r.source === "user");
  const userRulesActive = userRulesAll.filter(r => !r.isDeleted);
  const userRulesDeleted = userRulesAll.filter(r => r.isDeleted);
  const userRules = showDeletedRules ? userRulesAll : userRulesActive;
  const aiRules = rules.filter(r => (r.source === "ai_collective" || r.source === "ai_agentic") && !r.isDeleted);

  const createRuleMutation = useMutation({
    mutationFn: async (data: typeof newRule & { asSystem?: boolean }) => {
      // Admin can create system rules directly
      if (data.asSystem && user?.isAdmin) {
        const response = await apiRequest("POST", "/api/sentinel/admin/rules", {
          name: data.name,
          description: data.description,
          category: data.category,
          severity: data.severity,
          ruleType: data.ruleType,
          directionTags: data.directionTags,
          strategyTags: data.strategyTags,
          formula: data.formula || null,
        });
        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw new Error(error.error || "Failed to create system rule");
        }
        return response.json();
      }
      
      // Standard personal rule creation
      return apiRequest("POST", "/api/sentinel/rules", {
        name: data.name,
        description: data.description,
        category: data.category,
        severity: data.severity,
        ruleType: data.ruleType,
        directionTags: data.directionTags,
        strategyTags: data.strategyTags,
        formula: data.formula || null,
        source: "user",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/rules"] });
      setShowCreateDialog(false);
      setNewRule({ name: "", description: "", category: "general", severity: "warning", ruleType: "swing", directionTags: ["long"], strategyTags: [], formula: "" });
      setCreateAsSystem(false);
      toast({ title: createAsSystem ? "System rule created" : "Rule created successfully" });
    },
    onError: (error: any) => {
      toast({ title: error?.message || "Failed to create rule", variant: "destructive" });
    },
  });

  const updateRuleMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<TradingRule> }) => {
      return apiRequest("PATCH", `/api/sentinel/rules/${id}`, data);
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
      return apiRequest("POST", "/api/sentinel/rules/overrides", data);
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
      return apiRequest("DELETE", `/api/sentinel/rules/overrides/${ruleCode}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/rules/overrides"] });
      toast({ title: "Rule restored to default" });
    },
    onError: () => {
      toast({ title: "Failed to restore rule", variant: "destructive" });
    },
  });

  const softDeleteRuleMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("PATCH", `/api/sentinel/rules/${id}`, { isDeleted: true });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/rules"] });
      toast({ title: "Rule archived" });
    },
    onError: () => {
      toast({ title: "Failed to archive rule", variant: "destructive" });
    },
  });

  const restoreRuleMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("PATCH", `/api/sentinel/rules/${id}`, { isDeleted: false });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/rules"] });
      toast({ title: "Rule restored" });
    },
    onError: () => {
      toast({ title: "Failed to restore rule", variant: "destructive" });
    },
  });

  // Admin: Promote rule to system
  const promoteRuleMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest("POST", `/api/sentinel/admin/rules/${id}/promote`);
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Failed to promote rule");
      }
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/rules"] });
      toast({ title: data.message || "Rule promoted to system" });
    },
    onError: (error: any) => {
      toast({ title: error?.message || "Failed to promote rule", variant: "destructive" });
    },
  });

  // Admin: Demote rule to personal
  const demoteRuleMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest("POST", `/api/sentinel/admin/rules/${id}/demote`);
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Failed to demote rule");
      }
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/rules"] });
      toast({ title: data.message || "Rule demoted to personal" });
    },
    onError: (error: any) => {
      toast({ title: error?.message || "Failed to demote rule", variant: "destructive" });
    },
  });

  const adoptSuggestionMutation = useMutation({
    mutationFn: async (suggestionId: number) => {
      return apiRequest("POST", `/api/sentinel/suggestions/${suggestionId}/adopt`);
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

  const loadConsolidationSuggestions = async () => {
    setLoadingConsolidation(true);
    try {
      const response = await apiRequest("POST", "/api/sentinel/rules/consolidation-suggestions");
      const data = await response.json();
      setConsolidationSuggestions(data.suggestions || []);
      if (data.suggestions?.length > 0) {
        setShowConsolidationDialog(true);
      } else {
        toast({ title: "No consolidation opportunities found", description: "Your rules are well-organized" });
      }
    } catch {
      toast({ title: "Failed to analyze rules", variant: "destructive" });
    } finally {
      setLoadingConsolidation(false);
    }
  };

  const executeConsolidation = async (ruleIds: number[], newRuleName: string, newRuleDescription: string) => {
    try {
      const response = await apiRequest("POST", "/api/sentinel/rules/consolidate", {
        ruleIds,
        newRule: {
          name: newRuleName,
          description: newRuleDescription,
        }
      });
      const data = await response.json();
      if (data.success) {
        queryClient.invalidateQueries({ queryKey: ["/api/sentinel/rules"] });
        toast({ title: "Rules consolidated", description: data.message });
        setShowConsolidationDialog(false);
        setSelectedConsolidation(null);
        setConsolidationSuggestions(prev => prev.filter(s => !s.ruleIds.every(id => ruleIds.includes(id))));
      }
    } catch {
      toast({ title: "Failed to consolidate rules", variant: "destructive" });
    }
  };

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

  const toggleMyRulesCategory = (category: string) => {
    const newExpanded = new Set(expandedMyRulesCategories);
    if (newExpanded.has(category)) {
      newExpanded.delete(category);
    } else {
      newExpanded.add(category);
    }
    setExpandedMyRulesCategories(newExpanded);
  };

  const handleAIChatSubmit = async () => {
    if (!aiChatInput.trim() || aiChatLoading) return;
    
    const userMessage = aiChatInput.trim();
    setAIChatMessages(prev => [...prev, { role: "user", content: userMessage }]);
    setAIChatInput("");
    setAIChatLoading(true);
    
    try {
      const response = await fetch("/api/sentinel/rules/ai-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMessage, conversationHistory: aiChatMessages }),
      });
      
      if (!response.ok) {
        throw new Error("Failed to get AI response");
      }
      
      const data = await response.json();
      setAIChatMessages(prev => [...prev, { role: "assistant", content: data.response }]);
      
      if (data.suggestedRule) {
        setNewRule({
          name: data.suggestedRule.name || "",
          description: data.suggestedRule.description || "",
          category: data.suggestedRule.category || "general",
          severity: data.suggestedRule.severity || "warning",
          ruleType: data.suggestedRule.ruleType || "swing",
          directionTags: data.suggestedRule.directionTags || ["long"],
          strategyTags: data.suggestedRule.strategyTags || [],
          formula: data.suggestedRule.formula || "",
        });
        setShowAIChatDialog(false);
        setShowCreateDialog(true);
        toast({ title: "AI has drafted a rule for you to review" });
      }
    } catch (error) {
      toast({ title: "Failed to get AI response", variant: "destructive" });
    } finally {
      setAIChatLoading(false);
    }
  };

  const addStrategyTag = () => {
    const tag = newStrategyTag.trim().toLowerCase().replace(/\s+/g, "-");
    if (tag && tag.length <= 20 && !newRule.strategyTags.includes(tag)) {
      setNewRule({ ...newRule, strategyTags: [...newRule.strategyTags, tag] });
      setNewStrategyTag("");
    } else if (tag.length > 20) {
      toast({ title: "Strategy tag must be 20 characters or less", variant: "destructive" });
    }
  };

  const removeStrategyTag = (tag: string) => {
    setNewRule({ ...newRule, strategyTags: newRule.strategyTags.filter(t => t !== tag) });
  };

  // Check for similar rules before creating
  const checkSimilarityAndCreate = async () => {
    if (!newRule.name.trim() || !newRule.description.trim()) {
      toast({ title: "Name and description are required", variant: "destructive" });
      return;
    }

    setCheckingSimilarity(true);
    try {
      const response = await fetch("/api/sentinel/rules/check-similarity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: newRule.name,
          description: newRule.description,
          category: newRule.category
        }),
      });

      if (!response.ok) {
        // If similarity check fails, just create the rule
        createRuleMutation.mutate({ ...newRule, asSystem: createAsSystem });
        return;
      }

      const data = await response.json();
      
      if (data.hasSimilar && data.similarRules.length > 0) {
        setSimilarRules(data.similarRules);
        setShowCreateDialog(false); // Close create dialog first
        setShowSimilarityDialog(true);
      } else {
        // No similar rules, create directly
        createRuleMutation.mutate({ ...newRule, asSystem: createAsSystem });
      }
    } catch {
      // If error, create directly
      createRuleMutation.mutate({ ...newRule, asSystem: createAsSystem });
    } finally {
      setCheckingSimilarity(false);
    }
  };

  // Force create without checking similarity
  const forceCreateRule = () => {
    setShowSimilarityDialog(false);
    createRuleMutation.mutate({ ...newRule, asSystem: createAsSystem });
  };

  // Replace existing rule with new one
  const replaceWithNewRule = (existingRuleId: number) => {
    const ruleToReplace = similarRules.find(r => r.id === existingRuleId);
    if (!ruleToReplace) return;
    
    // Confirm before replacing
    if (!window.confirm(`Are you sure you want to archive "${ruleToReplace.name}" and create the new rule?`)) {
      return;
    }
    
    setShowSimilarityDialog(false);
    // First archive the existing rule, then create new one
    softDeleteRuleMutation.mutate(existingRuleId, {
      onSuccess: () => {
        createRuleMutation.mutate({ ...newRule, asSystem: createAsSystem });
        toast({ title: `Replaced "${ruleToReplace.name}" with new rule` });
      },
      onError: () => {
        toast({ title: "Failed to archive existing rule", variant: "destructive" });
        // Re-open similarity dialog on error
        setShowSimilarityDialog(true);
      }
    });
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
    const isDeleted = rule.isDeleted;
    
    return (
      <div 
        key={rule.id}
        className={`p-3 rounded-md border ${isDeleted ? "bg-muted/20 opacity-50" : displayRule.isActive ? "bg-card" : "bg-muted/30 opacity-60"} ${hasOverride ? "border-primary/30" : "border-border"}`}
        data-testid={`rule-card-${rule.id}`}
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5">
            {getSeverityIcon(displayRule.severity)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`font-medium ${isDeleted || !displayRule.isActive ? "line-through text-muted-foreground" : ""}`}>
                {displayRule.name}
              </span>
              {isDeleted && (
                <Badge variant="secondary" className="text-xs bg-red-500/10 text-red-500">Archived</Badge>
              )}
              {hasOverride && !isDeleted && (
                <Badge variant="outline" className="text-xs">Customized</Badge>
              )}
              {!displayRule.isActive && !isDeleted && (
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
              {rule.strategyTags?.map(tag => (
                <Badge key={tag} variant="secondary" className="text-xs">
                  <Tag className="w-3 h-3 mr-1" />
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
          {showEdit && (
            <div className="flex items-center gap-1">
              {isDeleted ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-7 w-7"
                      onClick={() => restoreRuleMutation.mutate(rule.id)}
                      data-testid={`button-restore-deleted-${rule.id}`}
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Restore this rule</TooltipContent>
                </Tooltip>
              ) : isStarter ? (
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
                  {/* Admin: Demote system rule to personal */}
                  {user?.isAdmin && rule.source === 'starter' && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-7 w-7 text-amber-500"
                          onClick={() => setConfirmPromote({ rule, action: 'demote' })}
                          disabled={demoteRuleMutation.isPending}
                          data-testid={`button-demote-rule-${rule.id}`}
                        >
                          <ArrowDownCircle className="w-3.5 h-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Demote to personal rule</TooltipContent>
                    </Tooltip>
                  )}
                </>
              ) : (
                <>
                  <Switch
                    checked={displayRule.isActive}
                    onCheckedChange={(checked) => updateRuleMutation.mutate({ id: rule.id, data: { isActive: checked } })}
                    data-testid={`switch-rule-active-${rule.id}`}
                  />
                  {/* Edit user rule */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-7 w-7"
                        onClick={() => {
                          setEditUserRule({
                            id: rule.id,
                            name: rule.name,
                            description: rule.description || "",
                            category: rule.category || "general",
                          });
                          setShowEditUserRuleDialog(true);
                        }}
                        data-testid={`button-edit-rule-${rule.id}`}
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Edit rule</TooltipContent>
                  </Tooltip>
                  {/* Admin: Promote personal rule to system */}
                  {user?.isAdmin && rule.source === 'user' && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-7 w-7 text-amber-500"
                          onClick={() => setConfirmPromote({ rule, action: 'promote' })}
                          disabled={promoteRuleMutation.isPending}
                          data-testid={`button-promote-rule-${rule.id}`}
                        >
                          <ArrowUpCircle className="w-3.5 h-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Promote to system rule</TooltipContent>
                    </Tooltip>
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-7 w-7 text-destructive"
                        onClick={() => softDeleteRuleMutation.mutate(rule.id)}
                        data-testid={`button-archive-rule-${rule.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Archive rule</TooltipContent>
                  </Tooltip>
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
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <CardTitle className="text-lg">My Custom Rules</CardTitle>
                    <CardDescription>
                      {userRulesActive.length} active rules{userRulesDeleted.length > 0 && `, ${userRulesDeleted.length} archived`}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button 
                      variant="outline" 
                      onClick={() => {
                        setAIChatMessages([{ role: "assistant", content: "I can help you create trading rules. Describe your trading strategy, patterns you trade, or rules you want to follow. I'll help you formalize them into clear, actionable rules.\n\nFor example:\n- \"I want a rule about waiting for volume confirmation on breakouts\"\n- \"Help me create rules for taking profits\"\n- \"I need a rule about not trading in the first 30 minutes\"" }]);
                        setShowAIChatDialog(true);
                      }} 
                      data-testid="button-ai-chat"
                    >
                      <MessageSquare className="w-4 h-4 mr-2" />
                      Ask AI
                    </Button>
                    <Button onClick={() => setShowCreateDialog(true)} data-testid="button-create-rule">
                      <Plus className="w-4 h-4 mr-2" />
                      Add Rule
                    </Button>
                  </div>
                </div>
                {userRulesDeleted.length > 0 && (
                  <div className="flex items-center gap-2 mt-2">
                    <Switch
                      id="show-deleted"
                      checked={showDeletedRules}
                      onCheckedChange={setShowDeletedRules}
                    />
                    <Label htmlFor="show-deleted" className="text-sm text-muted-foreground cursor-pointer">
                      Show archived rules ({userRulesDeleted.length})
                    </Label>
                  </div>
                )}
              </CardHeader>
              <CardContent>
                {userRulesActive.length === 0 && !showDeletedRules ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <BookOpen className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p className="font-medium">No custom rules yet</p>
                    <p className="text-sm">Create rules based on your trading experience or ask AI for help</p>
                  </div>
                ) : (
                  <ScrollArea className="h-[calc(100vh-420px)]">
                    <div className="space-y-4">
                      {RULE_CATEGORIES.map(cat => {
                        const categoryRules = userRules.filter(r => r.category === cat.value);
                        if (categoryRules.length === 0) return null;
                        const isExpanded = expandedMyRulesCategories.has(cat.value);
                        
                        return (
                          <div key={cat.value} className="border rounded-lg">
                            <button
                              className="w-full flex items-center justify-between p-3 hover-elevate"
                              onClick={() => toggleMyRulesCategory(cat.value)}
                              data-testid={`my-rules-category-toggle-${cat.value}`}
                            >
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{cat.label}</span>
                                <Badge variant="secondary" className="text-xs">{categoryRules.length}</Badge>
                              </div>
                              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            </button>
                            {isExpanded && (
                              <div className="px-3 pb-3 space-y-2">
                                {categoryRules.map(rule => renderRuleCard(rule, true, false))}
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

          <TabsContent value="ai" className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Sparkles className="w-5 h-5 text-primary" />
                      AI-Suggested Rules
                    </CardTitle>
                    <CardDescription>
                      Rules discovered through pattern analysis of trading performance
                    </CardDescription>
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={loadConsolidationSuggestions}
                    disabled={loadingConsolidation}
                    data-testid="button-analyze-consolidation"
                  >
                    {loadingConsolidation ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <Layers className="w-4 h-4 mr-2" />
                        Optimize Rules
                      </>
                    )}
                  </Button>
                </div>
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
                    checked={(user as { communityOptIn?: boolean })?.communityOptIn || false}
                    onCheckedChange={(checked) => {
                      apiRequest("PATCH", "/api/sentinel/user/community-opt-in", { optIn: checked })
                        .then(() => {
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
            <div>
              <Label>Strategy Tags</Label>
              <p className="text-xs text-muted-foreground mb-2">Add tags to organize rules by strategy (max 20 characters each)</p>
              <div className="flex items-center gap-2">
                <Input
                  value={newStrategyTag}
                  onChange={(e) => setNewStrategyTag(e.target.value)}
                  placeholder="e.g., breakout, momentum"
                  className="flex-1"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addStrategyTag();
                    }
                  }}
                  data-testid="input-strategy-tag"
                />
                <Button type="button" variant="outline" size="sm" onClick={addStrategyTag} data-testid="button-add-tag">
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
              {newRule.strategyTags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {newRule.strategyTags.map(tag => (
                    <Badge key={tag} variant="secondary" className="text-xs">
                      <Tag className="w-3 h-3 mr-1" />
                      {tag}
                      <button
                        type="button"
                        className="ml-1 hover:text-destructive"
                        onClick={() => removeStrategyTag(tag)}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
          
          {/* Admin: Create as system rule toggle */}
          {user?.isAdmin && (
            <div className="pt-4 border-t">
              <Label className="text-amber-500 text-sm flex items-center gap-2">
                <Shield className="w-4 h-4" />
                Admin Options
              </Label>
              <label className="flex items-center gap-2 mt-2 cursor-pointer">
                <Switch
                  checked={createAsSystem}
                  onCheckedChange={setCreateAsSystem}
                  data-testid="switch-create-as-system"
                />
                <span className="text-sm">
                  Create as system rule (visible to all users)
                </span>
              </label>
            </div>
          )}
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
            <Button 
              onClick={checkSimilarityAndCreate}
              disabled={!newRule.name.trim() || newRule.directionTags.length === 0 || createRuleMutation.isPending || checkingSimilarity}
              data-testid="button-save-rule"
            >
              {checkingSimilarity ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Checking...
                </>
              ) : createAsSystem ? (
                "Create System Rule"
              ) : (
                "Create Rule"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Similar Rules Dialog */}
      <Dialog open={showSimilarityDialog} onOpenChange={setShowSimilarityDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-500" />
              Similar Rules Found
            </DialogTitle>
            <DialogDescription>
              We found existing rules that are similar to the one you're creating. Would you like to:
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-3 max-h-60 overflow-y-auto">
            {similarRules.map((rule) => (
              <div key={rule.id} className="p-3 border rounded-lg space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{rule.name}</span>
                  <Badge variant="outline" className="text-xs">
                    {Math.round(rule.similarityScore * 100)}% similar
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">{rule.description?.slice(0, 100)}...</p>
                <p className="text-xs text-yellow-600">{rule.reason}</p>
                <Button 
                  size="sm" 
                  variant="outline" 
                  onClick={() => replaceWithNewRule(rule.id)}
                  data-testid={`button-replace-rule-${rule.id}`}
                >
                  Replace with new rule
                </Button>
              </div>
            ))}
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setShowSimilarityDialog(false)}>
              Cancel
            </Button>
            <Button variant="secondary" onClick={forceCreateRule} data-testid="button-keep-both">
              Keep Both (Create Anyway)
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

      {/* Edit User Rule Dialog */}
      <Dialog open={showEditUserRuleDialog} onOpenChange={setShowEditUserRuleDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Rule</DialogTitle>
            <DialogDescription>
              Update your trading rule details
            </DialogDescription>
          </DialogHeader>
          {editUserRule && (
            <div className="space-y-4">
              <div>
                <Label>Rule Name</Label>
                <Input
                  value={editUserRule.name}
                  onChange={(e) => setEditUserRule({ ...editUserRule, name: e.target.value })}
                  placeholder="Enter rule name"
                  data-testid="input-edit-rule-name"
                />
              </div>
              <div>
                <Label>Description</Label>
                <Textarea
                  value={editUserRule.description}
                  onChange={(e) => setEditUserRule({ ...editUserRule, description: e.target.value })}
                  placeholder="Describe your rule..."
                  rows={3}
                  data-testid="input-edit-rule-description"
                />
              </div>
              <div>
                <Label>Category</Label>
                <Select 
                  value={editUserRule.category}
                  onValueChange={(v) => setEditUserRule({ ...editUserRule, category: v })}
                >
                  <SelectTrigger data-testid="select-edit-rule-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RULE_CATEGORIES.map(cat => (
                      <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditUserRuleDialog(false)}>Cancel</Button>
            <Button 
              onClick={() => {
                if (editUserRule) {
                  updateRuleMutation.mutate({
                    id: editUserRule.id,
                    data: {
                      name: editUserRule.name,
                      description: editUserRule.description,
                      category: editUserRule.category,
                    }
                  });
                  setShowEditUserRuleDialog(false);
                }
              }}
              disabled={updateRuleMutation.isPending || !editUserRule?.name}
              data-testid="button-save-edit-rule"
            >
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showAIChatDialog} onOpenChange={setShowAIChatDialog}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-primary" />
              AI Rule Assistant
            </DialogTitle>
            <DialogDescription>
              Describe your trading rules and I'll help formalize them
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="flex-1 min-h-[300px] max-h-[400px] p-4 border rounded-lg">
            <div className="space-y-4">
              {aiChatMessages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] p-3 rounded-lg ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted"
                    }`}
                  >
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  </div>
                </div>
              ))}
              {aiChatLoading && (
                <div className="flex justify-start">
                  <div className="bg-muted p-3 rounded-lg">
                    <Loader2 className="w-4 h-4 animate-spin" />
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
          <div className="flex items-center gap-2 mt-4">
            <Input
              value={aiChatInput}
              onChange={(e) => setAIChatInput(e.target.value)}
              placeholder="Describe your trading rule..."
              className="flex-1"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleAIChatSubmit();
                }
              }}
              disabled={aiChatLoading}
              data-testid="input-ai-chat"
            />
            <Button 
              onClick={handleAIChatSubmit} 
              disabled={!aiChatInput.trim() || aiChatLoading}
              data-testid="button-send-ai-chat"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            This assistant only discusses trading rules and strategies. Off-topic questions will be politely declined.
          </p>
        </DialogContent>
      </Dialog>

      <Dialog open={showConsolidationDialog} onOpenChange={setShowConsolidationDialog}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Merge className="w-5 h-5 text-primary" />
              Rule Consolidation Suggestions
            </DialogTitle>
            <DialogDescription>
              These rules have been identified as candidates for merging based on similarity and performance
            </DialogDescription>
          </DialogHeader>
          
          <ScrollArea className="flex-1 min-h-[200px] max-h-[50vh]">
            {consolidationSuggestions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Layers className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No consolidation opportunities found</p>
              </div>
            ) : (
              <div className="space-y-4 pr-4">
                {consolidationSuggestions.map((suggestion, idx) => (
                  <Card key={idx} className="border">
                    <CardContent className="pt-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 space-y-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline" className="text-xs">
                              {suggestion.rules.length} rules
                            </Badge>
                            {suggestion.performanceIssue && (
                              <Badge variant="destructive" className="text-xs">
                                {suggestion.performanceIssue}
                              </Badge>
                            )}
                          </div>
                          
                          <p className="text-sm text-muted-foreground">{suggestion.reason}</p>
                          
                          <div className="space-y-1 mt-2">
                            <p className="text-xs font-medium text-muted-foreground">Rules to merge:</p>
                            {suggestion.rules.map(rule => (
                              <div key={rule.id} className="flex items-center gap-2 text-sm bg-muted/50 px-2 py-1 rounded">
                                <span className="font-medium">{rule.name}</span>
                                {rule.performance && (
                                  <span className="text-xs text-muted-foreground">
                                    ({rule.performance.totalTrades} trades, 
                                    {rule.performance.winRate !== null && rule.performance.winRate !== undefined 
                                      ? ` ${Math.round(rule.performance.winRate * 100)}% win` 
                                      : ' no data'})
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                          
                          {suggestion.suggestedMerge && (
                            <div className="mt-3 p-2 border rounded bg-card">
                              <p className="text-xs font-medium text-primary mb-1">Suggested merged rule:</p>
                              <p className="font-medium text-sm">{suggestion.suggestedMerge.name}</p>
                              <p className="text-sm text-muted-foreground">{suggestion.suggestedMerge.description}</p>
                            </div>
                          )}
                        </div>
                        
                        <Button
                          size="sm"
                          onClick={() => {
                            if (suggestion.suggestedMerge) {
                              executeConsolidation(
                                suggestion.ruleIds,
                                suggestion.suggestedMerge.name,
                                suggestion.suggestedMerge.description
                              );
                            } else {
                              setSelectedConsolidation({
                                ruleIds: suggestion.ruleIds,
                                suggestedMerge: undefined
                              });
                              setCustomMerge({ name: "", description: "" });
                            }
                          }}
                          data-testid={`button-consolidate-${idx}`}
                        >
                          <Merge className="w-3.5 h-3.5 mr-1" />
                          {suggestion.suggestedMerge ? "Merge" : "Customize & Merge"}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </ScrollArea>
          
          {selectedConsolidation && !selectedConsolidation.suggestedMerge && (
            <div className="border-t pt-4 mt-4 space-y-3">
              <p className="text-sm font-medium">Create merged rule for {selectedConsolidation.ruleIds.length} selected rules:</p>
              <div>
                <Label>Rule Name</Label>
                <Input
                  value={customMerge.name}
                  onChange={(e) => setCustomMerge(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Enter name for the merged rule"
                  data-testid="input-merge-name"
                />
              </div>
              <div>
                <Label>Description</Label>
                <Textarea
                  value={customMerge.description}
                  onChange={(e) => setCustomMerge(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Describe what this combined rule enforces..."
                  rows={2}
                  data-testid="input-merge-description"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedConsolidation(null)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={!customMerge.name.trim() || !customMerge.description.trim()}
                  onClick={() => {
                    executeConsolidation(
                      selectedConsolidation.ruleIds,
                      customMerge.name.trim(),
                      customMerge.description.trim()
                    );
                    setSelectedConsolidation(null);
                  }}
                  data-testid="button-confirm-custom-merge"
                >
                  <Merge className="w-3.5 h-3.5 mr-1" />
                  Create Merged Rule
                </Button>
              </div>
            </div>
          )}
          
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => {
              setShowConsolidationDialog(false);
              setSelectedConsolidation(null);
            }}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Admin: Promote/Demote Confirmation Dialog */}
      <Dialog open={!!confirmPromote} onOpenChange={(open) => !open && setConfirmPromote(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {confirmPromote?.action === 'promote' ? (
                <ArrowUpCircle className="w-5 h-5 text-amber-500" />
              ) : (
                <ArrowDownCircle className="w-5 h-5 text-amber-500" />
              )}
              {confirmPromote?.action === 'promote' ? 'Promote to System Rule' : 'Demote to Personal Rule'}
            </DialogTitle>
            <DialogDescription>
              {confirmPromote?.action === 'promote' 
                ? 'This will make the rule visible to all users as a system rule. System rules can be customized but not deleted by regular users.'
                : 'This will convert the system rule back to a personal rule. It will no longer be visible to other users.'}
            </DialogDescription>
          </DialogHeader>
          
          {confirmPromote && (
            <div className="p-3 border rounded-lg bg-muted/30">
              <div className="font-medium">{confirmPromote.rule.name}</div>
              {confirmPromote.rule.description && (
                <p className="text-sm text-muted-foreground mt-1">{confirmPromote.rule.description}</p>
              )}
            </div>
          )}
          
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmPromote(null)}>
              Cancel
            </Button>
            <Button 
              variant={confirmPromote?.action === 'promote' ? 'default' : 'secondary'}
              onClick={() => {
                if (confirmPromote) {
                  if (confirmPromote.action === 'promote') {
                    promoteRuleMutation.mutate(confirmPromote.rule.id);
                  } else {
                    demoteRuleMutation.mutate(confirmPromote.rule.id);
                  }
                  setConfirmPromote(null);
                }
              }}
              disabled={promoteRuleMutation.isPending || demoteRuleMutation.isPending}
              data-testid={`button-confirm-${confirmPromote?.action}`}
            >
              {confirmPromote?.action === 'promote' ? 'Promote Rule' : 'Demote Rule'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
