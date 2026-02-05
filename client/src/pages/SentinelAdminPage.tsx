import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
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
import { Brain, Settings, Users, Tags, ChevronDown, ChevronUp, CheckCircle2, XCircle, TrendingUp, Zap, History, Lightbulb, Loader2, Plus, RefreshCw, Database } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface TnnFactor {
  id: number;
  factorType: string;
  factorKey: string;
  factorName: string;
  description: string | null;
  category: string | null;
  baseWeight: number;
  aiAdjustedWeight: number | null;
  autoAdjust: boolean | null;
  maxMagnitude: number | null;
  maxDrift: number | null;
  sampleSize: number | null;
  lastAiUpdate: string | null;
  order: number | null;
  isActive: boolean | null;
}

interface TnnModifier {
  id: number;
  factorKey: string;
  factorName: string;
  whenCondition: string;
  whenConditionName: string;
  weightModifier: number;
  source: string;
  confidence: number | null;
  sampleSize: number | null;
  winRateImpact: number | null;
  isActive: boolean | null;
  createdBy: string | null;
  notes: string | null;
}

interface TnnSuggestion {
  id: number;
  suggestionType: string;
  factorKey: string;
  factorName: string;
  whenCondition: string | null;
  whenConditionName: string | null;
  currentValue: number;
  proposedValue: number;
  confidenceScore: number;
  reasoning: string;
  supportingData: {
    sampleSize: number;
    winRateWithChange: number;
    winRateWithout: number;
    avgPnLImpact: number;
  } | null;
  status: string;
  reviewedBy: number | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
}

interface TnnHistory {
  id: number;
  changeType: string;
  factorKey: string | null;
  factorName: string | null;
  oldValue: string | null;
  newValue: string | null;
  changedBy: string;
  reason: string | null;
  createdAt: string;
}

interface TnnSetting {
  id: number;
  settingKey: string;
  settingValue: string;
  description: string | null;
}

const MARKET_CONDITIONS = [
  { key: "choppy_daily", name: "Choppy Daily Market" },
  { key: "choppy_weekly", name: "Choppy Weekly Market" },
  { key: "trending_weekly", name: "Trending Weekly Market" },
  { key: "risk_on", name: "Risk-On Environment" },
  { key: "risk_off", name: "Risk-Off Environment" },
  { key: "oversold_market", name: "Oversold Market Conditions" },
  { key: "volatility_stress", name: "High Volatility/VIX Stress" },
  { key: "narrow_leadership", name: "Narrow Market Leadership" },
];

interface SystemSettings {
  overlayColor: string;
  overlayTransparency: number;
  backgroundColor: string;
  logoTransparency: number;
}

function SystemSettingsTab() {
  const { toast } = useToast();
  const [localSettings, setLocalSettings] = useState<SystemSettings>({
    overlayColor: "#1e3a5f",
    overlayTransparency: 75,
    backgroundColor: "#0f172a",
    logoTransparency: 6
  });

  const { data: settings, isLoading } = useQuery<SystemSettings>({
    queryKey: ["/api/sentinel/settings/system"],
  });

  const updateSettingsMutation = useMutation({
    mutationFn: async (data: Partial<SystemSettings>) => {
      const res = await apiRequest("PATCH", "/api/sentinel/settings/system", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Settings Saved", description: "Your display settings have been updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/settings/system"] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save settings", variant: "destructive" });
    },
  });

  // Sync local state when settings load
  if (settings && !isLoading && 
      (localSettings.overlayColor !== settings.overlayColor ||
       localSettings.overlayTransparency !== settings.overlayTransparency ||
       localSettings.backgroundColor !== settings.backgroundColor ||
       localSettings.logoTransparency !== settings.logoTransparency)) {
    setLocalSettings(settings);
  }

  const handleSave = () => {
    updateSettingsMutation.mutate(localSettings);
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="w-5 h-5" />
          System Settings
        </CardTitle>
        <CardDescription>Customize the appearance of your RubricShield interface</CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <Label className="text-base font-medium">Overlay Background Color</Label>
            <p className="text-sm text-muted-foreground">Color for cards, dialogs, and overlays</p>
            <div className="flex items-center gap-4">
              <input
                type="color"
                value={localSettings.overlayColor}
                onChange={(e) => setLocalSettings(prev => ({ ...prev, overlayColor: e.target.value }))}
                className="w-16 h-10 rounded border cursor-pointer"
                data-testid="input-overlay-color"
              />
              <Input
                value={localSettings.overlayColor}
                onChange={(e) => setLocalSettings(prev => ({ ...prev, overlayColor: e.target.value }))}
                className="w-28 font-mono"
                data-testid="input-overlay-color-text"
              />
            </div>
          </div>

          <div className="space-y-4">
            <Label className="text-base font-medium">Overlay Transparency: {localSettings.overlayTransparency}%</Label>
            <p className="text-sm text-muted-foreground">How see-through cards and overlays appear</p>
            <Slider
              value={[localSettings.overlayTransparency]}
              onValueChange={([value]) => setLocalSettings(prev => ({ ...prev, overlayTransparency: value }))}
              min={0}
              max={100}
              step={5}
              className="w-full"
              data-testid="slider-overlay-transparency"
            />
          </div>

          <div className="space-y-4">
            <Label className="text-base font-medium">Page Background Color</Label>
            <p className="text-sm text-muted-foreground">Main background color for all pages</p>
            <div className="flex items-center gap-4">
              <input
                type="color"
                value={localSettings.backgroundColor}
                onChange={(e) => setLocalSettings(prev => ({ ...prev, backgroundColor: e.target.value }))}
                className="w-16 h-10 rounded border cursor-pointer"
                data-testid="input-bg-color"
              />
              <Input
                value={localSettings.backgroundColor}
                onChange={(e) => setLocalSettings(prev => ({ ...prev, backgroundColor: e.target.value }))}
                className="w-28 font-mono"
                data-testid="input-bg-color-text"
              />
            </div>
          </div>

          <div className="space-y-4">
            <Label className="text-base font-medium">Logo Transparency: {localSettings.logoTransparency}%</Label>
            <p className="text-sm text-muted-foreground">Visibility of the RubricShield watermark</p>
            <Slider
              value={[localSettings.logoTransparency]}
              onValueChange={([value]) => setLocalSettings(prev => ({ ...prev, logoTransparency: value }))}
              min={0}
              max={30}
              step={1}
              className="w-full"
              data-testid="slider-logo-transparency"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button 
            onClick={handleSave} 
            disabled={updateSettingsMutation.isPending}
            data-testid="button-save-settings"
          >
            {updateSettingsMutation.isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</>
            ) : (
              "Save Settings"
            )}
          </Button>
        </div>

        <div className="p-4 bg-muted/50 rounded-lg">
          <h4 className="font-medium mb-2">Preview</h4>
          <div 
            className="h-32 rounded-lg flex items-center justify-center relative overflow-hidden"
            style={{ backgroundColor: localSettings.backgroundColor }}
          >
            <div 
              className="absolute inset-0 flex items-center justify-center"
              style={{ opacity: localSettings.logoTransparency / 100 }}
            >
              <img src="/rubricshield-logo.png" alt="Watermark" className="w-24 h-24 object-contain" />
            </div>
            <div 
              className="px-6 py-3 rounded-lg z-10"
              style={{ 
                backgroundColor: `${localSettings.overlayColor}${Math.round(localSettings.overlayTransparency * 2.55).toString(16).padStart(2, '0')}`,
              }}
            >
              <span className="text-white">Sample Card</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SentinelAdminPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState("tnn");
  const [expandedFactors, setExpandedFactors] = useState<number[]>([]);
  const [suggestionAction, setSuggestionAction] = useState<{ id: number; value: number } | null>(null);
  const [showAddModifier, setShowAddModifier] = useState(false);
  const [newModifier, setNewModifier] = useState({
    factorKey: "",
    whenCondition: "",
    weightModifier: 0,
    notes: "",
  });
  // Local state for slider dragging - tracks value while dragging before committing
  const [draggingSliders, setDraggingSliders] = useState<Record<string, number>>({});

  const { data: userInfo, isLoading: userLoading } = useQuery<{ id: number; username: string; isAdmin: boolean }>({
    queryKey: ["/api/sentinel/me"],
  });

  const { data: factors, isLoading: factorsLoading } = useQuery<TnnFactor[]>({
    queryKey: ["/api/sentinel/tnn/factors"],
    enabled: !!userInfo?.isAdmin,
  });

  const { data: modifiers, isLoading: modifiersLoading } = useQuery<TnnModifier[]>({
    queryKey: ["/api/sentinel/tnn/modifiers"],
    enabled: !!userInfo?.isAdmin,
  });

  const { data: suggestions } = useQuery<TnnSuggestion[]>({
    queryKey: ["/api/sentinel/tnn/suggestions"],
    enabled: !!userInfo?.isAdmin,
  });

  const { data: history } = useQuery<TnnHistory[]>({
    queryKey: ["/api/sentinel/tnn/history"],
    enabled: !!userInfo?.isAdmin,
  });

  const { data: settings } = useQuery<TnnSetting[]>({
    queryKey: ["/api/sentinel/tnn/settings"],
    enabled: !!userInfo?.isAdmin,
  });

  const seedMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/sentinel/tnn/seed");
      return res.json();
    },
    onSuccess: (data: { seeded: boolean; message: string }) => {
      toast({ title: "TNN Initialized", description: data.message });
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/tnn/factors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/tnn/modifiers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/tnn/suggestions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/tnn/history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/tnn/settings"] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to initialize TNN", variant: "destructive" });
    },
  });

  const updateFactorMutation = useMutation({
    mutationFn: async ({ factorKey, updates }: { factorKey: string; updates: Record<string, unknown> }) => {
      const res = await apiRequest("PATCH", `/api/sentinel/tnn/factors/${factorKey}`, updates);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Factor Updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/tnn/factors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/tnn/history"] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update factor", variant: "destructive" });
    },
  });

  const createModifierMutation = useMutation({
    mutationFn: async (data: { factorKey: string; factorName: string; whenCondition: string; whenConditionName: string; weightModifier: number; notes?: string }) => {
      const res = await apiRequest("POST", "/api/sentinel/tnn/modifiers", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Modifier Created" });
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/tnn/modifiers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/tnn/history"] });
      setShowAddModifier(false);
      setNewModifier({ factorKey: "", whenCondition: "", weightModifier: 0, notes: "" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create modifier", variant: "destructive" });
    },
  });

  const reviewSuggestionMutation = useMutation({
    mutationFn: async ({ id, approved, notes }: { id: number; approved: boolean; notes?: string }) => {
      const res = await apiRequest("POST", `/api/sentinel/tnn/suggestions/${id}/review`, { approved, notes });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Suggestion Reviewed" });
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/tnn/suggestions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/tnn/factors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/tnn/modifiers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/tnn/history"] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to review suggestion", variant: "destructive" });
    },
  });

  const runAnalysisMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/sentinel/ai/analyze-rules");
      return res.json();
    },
    onSuccess: (data: { message: string; suggestions: unknown[] }) => {
      toast({ 
        title: "AI Analysis Complete", 
        description: data.message || `Generated ${data.suggestions?.length || 0} suggestions` 
      });
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/tnn/suggestions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/ai/insights"] });
    },
    onError: () => {
      toast({ title: "Analysis Failed", description: "AI analysis could not be completed. Need more trade data.", variant: "destructive" });
    },
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

  const toggleFactorExpand = (factorId: number) => {
    setExpandedFactors(prev => 
      prev.includes(factorId) 
        ? prev.filter(id => id !== factorId)
        : [...prev, factorId]
    );
  };

  const getCategoryColor = (category: string | null) => {
    switch (category) {
      case "structural": return "bg-red-500/20 text-red-400 border-red-500/30";
      case "entry": return "bg-green-500/20 text-green-400 border-green-500/30";
      case "exit": return "bg-blue-500/20 text-blue-400 border-blue-500/30";
      case "profit_taking": return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
      case "stop_loss": return "bg-orange-500/20 text-orange-400 border-orange-500/30";
      case "ma_structure": return "bg-cyan-500/20 text-cyan-400 border-cyan-500/30";
      case "base_quality": return "bg-purple-500/20 text-purple-400 border-purple-500/30";
      case "breakout": return "bg-pink-500/20 text-pink-400 border-pink-500/30";
      case "position_sizing": return "bg-indigo-500/20 text-indigo-400 border-indigo-500/30";
      case "market_regime": return "bg-teal-500/20 text-teal-400 border-teal-500/30";
      case "risk": return "bg-red-600/20 text-red-300 border-red-600/30";
      case "general": return "bg-gray-500/20 text-gray-400 border-gray-500/30";
      default: return "bg-muted text-muted-foreground";
    }
  };

  const getFactorTypeColor = (factorType: string) => {
    return factorType === "discipline" 
      ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
      : "bg-purple-500/20 text-purple-400 border-purple-500/30";
  };

  const getWeightColor = (weight: number | null) => {
    if (weight === null) return "text-muted-foreground";
    if (weight >= 80) return "text-green-400";
    if (weight >= 60) return "text-yellow-400";
    return "text-red-400";
  };

  const getConfidenceColor = (confidence: number | null) => {
    if (confidence === null) return "text-muted-foreground";
    if (confidence >= 80) return "text-green-400";
    if (confidence >= 65) return "text-yellow-400";
    return "text-orange-400";
  };

  const getSourceBadge = (source: string) => {
    switch (source) {
      case "manual": return <Badge variant="outline" className="text-xs">Manual</Badge>;
      case "ai_suggested": return <Badge variant="outline" className="text-xs bg-purple-500/10 text-purple-400">AI Suggested</Badge>;
      case "ai_confirmed": return <Badge variant="outline" className="text-xs bg-green-500/10 text-green-400">AI Confirmed</Badge>;
      default: return null;
    }
  };

  const disciplineFactors = factors?.filter(f => f.factorType === "discipline") || [];
  const setupTypeFactors = factors?.filter(f => f.factorType === "setup_type") || [];
  const pendingSuggestions = suggestions?.filter(s => s.status === "pending") || [];
  const recentHistory = history?.slice(0, 10) || [];

  const needsSeeding = !factorsLoading && (!factors || factors.length === 0);
  const needsSetupTypeSeeding = !factorsLoading && factors && factors.length > 0 && setupTypeFactors.length === 0;

  const handleCreateModifier = () => {
    const factor = factors?.find(f => f.factorKey === newModifier.factorKey);
    const condition = MARKET_CONDITIONS.find(c => c.key === newModifier.whenCondition);
    if (!factor || !condition) return;

    createModifierMutation.mutate({
      factorKey: newModifier.factorKey,
      factorName: factor.factorName,
      whenCondition: newModifier.whenCondition,
      whenConditionName: condition.name,
      weightModifier: newModifier.weightModifier,
      notes: newModifier.notes || undefined,
    });
  };

  return (
    <div className="min-h-screen bg-background rubricshield-bg sentinel-page">
      <SentinelHeader />
      
      <div className="container mx-auto p-6 max-w-7xl">
        <div className="flex items-center justify-between gap-3 mb-6" data-testid="container-admin-header">
          <div className="flex items-center gap-3">
            <Settings className="w-8 h-8 text-primary" />
            <div>
              <h1 className="text-2xl font-bold" data-testid="text-admin-title">Admin</h1>
              <p className="text-muted-foreground" data-testid="text-admin-subtitle">System configuration and AI tuning</p>
            </div>
          </div>
          {needsSeeding && (
            <Button onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending} data-testid="button-seed-tnn">
              {seedMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Database className="w-4 h-4 mr-2" />}
              Initialize TNN
            </Button>
          )}
          {needsSetupTypeSeeding && (
            <Button onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending} variant="outline" data-testid="button-seed-setup-types">
              {seedMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Database className="w-4 h-4 mr-2" />}
              Add Setup Types
            </Button>
          )}
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
            <TabsTrigger value="settings" className="gap-2" data-testid="tab-settings">
              <Settings className="w-4 h-4" />
              System Settings
            </TabsTrigger>
          </TabsList>

          <TabsContent value="tnn">
            {needsSeeding ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Database className="w-12 h-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">TNN Not Initialized</h3>
                  <p className="text-muted-foreground text-center mb-4">
                    Click the "Initialize TNN" button to set up the Trader Neural Network with default factors and modifiers.
                  </p>
                </CardContent>
              </Card>
            ) : (
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
                        <CardTitle className="text-lg flex items-center gap-2" data-testid="text-discipline-title">
                          <TrendingUp className="w-5 h-5" />
                          Discipline Factors ({disciplineFactors.length})
                        </CardTitle>
                        <CardDescription>Rule category weights for process evaluation</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {factorsLoading ? (
                          <div className="flex items-center justify-center py-8">
                            <Loader2 className="w-6 h-6 animate-spin" />
                          </div>
                        ) : (
                          disciplineFactors.map(factor => (
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
                                    {factor.category || "general"}
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
                                      <span className="text-sm text-muted-foreground">Base:</span>
                                      <span className={`font-bold ${getWeightColor(factor.baseWeight)}`} data-testid={`text-base-weight-${factor.factorKey}`}>{factor.baseWeight}</span>
                                      {factor.aiAdjustedWeight !== factor.baseWeight && (
                                        <>
                                          <span className="text-muted-foreground">→</span>
                                          <span className={`font-bold ${getWeightColor(factor.aiAdjustedWeight)}`} data-testid={`text-ai-adjusted-${factor.factorKey}`}>{factor.aiAdjustedWeight}</span>
                                          <span className="text-xs text-muted-foreground">(AI)</span>
                                        </>
                                      )}
                                    </div>
                                    <span className="text-xs text-muted-foreground" data-testid={`text-sample-size-${factor.factorKey}`}>{factor.sampleSize || 0} trades</span>
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
                                      <Label>Base Weight (0-100)</Label>
                                      <div className="flex items-center gap-3">
                                        <Slider 
                                          value={[draggingSliders[factor.factorKey] ?? factor.baseWeight]} 
                                          max={100} 
                                          step={5}
                                          className="flex-1"
                                          onValueChange={(value) => {
                                            setDraggingSliders(prev => ({ ...prev, [factor.factorKey]: value[0] }));
                                          }}
                                          onValueCommit={(value) => {
                                            updateFactorMutation.mutate({ factorKey: factor.factorKey, updates: { baseWeight: value[0] } });
                                            setDraggingSliders(prev => {
                                              const next = { ...prev };
                                              delete next[factor.factorKey];
                                              return next;
                                            });
                                          }}
                                          data-testid={`slider-base-weight-${factor.factorKey}`}
                                        />
                                        <span className="w-10 text-center font-bold">{draggingSliders[factor.factorKey] ?? factor.baseWeight}</span>
                                      </div>
                                    </div>
                                    
                                    <div className="space-y-2">
                                      <Label>Current AI Weight</Label>
                                      <div className="flex items-center gap-2 p-2 bg-muted rounded">
                                        <span className={`text-lg font-bold ${getWeightColor(factor.aiAdjustedWeight)}`} data-testid={`text-ai-weight-${factor.factorKey}`}>
                                          {factor.aiAdjustedWeight || factor.baseWeight}
                                        </span>
                                        {factor.lastAiUpdate && (
                                          <span className="text-xs text-muted-foreground">
                                            (updated {new Date(factor.lastAiUpdate).toLocaleDateString()})
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </div>

                                  <div className="flex items-center justify-between pt-2 border-t">
                                    <div className="flex items-center gap-3">
                                      <Switch 
                                        checked={factor.autoAdjust || false}
                                        onCheckedChange={(checked) => {
                                          updateFactorMutation.mutate({ factorKey: factor.factorKey, updates: { autoAdjust: checked } });
                                        }}
                                        data-testid={`switch-auto-adjust-${factor.factorKey}`} 
                                      />
                                      <Label>Allow AI Auto-Adjustment</Label>
                                    </div>
                                    
                                    {factor.autoAdjust && (
                                      <div className="flex items-center gap-4">
                                        <div className="flex items-center gap-2">
                                          <Label className="text-xs">Max per adjustment:</Label>
                                          <Input 
                                            type="number" 
                                            value={factor.maxMagnitude || ""} 
                                            placeholder="∞"
                                            className="w-16 text-center text-sm"
                                            onChange={(e) => {
                                              const val = e.target.value ? parseInt(e.target.value) : null;
                                              updateFactorMutation.mutate({ factorKey: factor.factorKey, updates: { maxMagnitude: val } });
                                            }}
                                            data-testid={`input-max-magnitude-${factor.factorKey}`}
                                          />
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <Label className="text-xs">Max drift from base:</Label>
                                          <Input 
                                            type="number" 
                                            value={factor.maxDrift || ""} 
                                            placeholder="∞"
                                            className="w-16 text-center text-sm"
                                            onChange={(e) => {
                                              const val = e.target.value ? parseInt(e.target.value) : null;
                                              updateFactorMutation.mutate({ factorKey: factor.factorKey, updates: { maxDrift: val } });
                                            }}
                                            data-testid={`input-max-drift-${factor.factorKey}`}
                                          />
                                        </div>
                                      </div>
                                    )}
                                  </div>

                                  <div className="flex justify-end gap-2 pt-2">
                                    <Button 
                                      variant="outline" 
                                      size="sm"
                                      onClick={() => {
                                        updateFactorMutation.mutate({ factorKey: factor.factorKey, updates: { aiAdjustedWeight: factor.baseWeight } });
                                      }}
                                      data-testid={`button-reset-${factor.factorKey}`}
                                    >
                                      Reset to Base
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </div>
                          ))
                        )}
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-lg flex items-center gap-2" data-testid="text-setup-title">
                          <Zap className="w-5 h-5 text-purple-400" />
                          Setup Type Factors ({setupTypeFactors.length})
                        </CardTitle>
                        <CardDescription>Weights for different trade setup patterns</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {setupTypeFactors.map(factor => (
                          <div 
                            key={factor.id} 
                            className="border rounded-lg overflow-hidden"
                            data-testid={`factor-${factor.factorKey}`}
                          >
                            <div 
                              className="flex items-center justify-between p-3 cursor-pointer hover-elevate"
                              onClick={() => toggleFactorExpand(factor.id)}
                            >
                              <div className="flex items-center gap-3">
                                <Badge variant="outline" className={getFactorTypeColor(factor.factorType)}>
                                  {factor.factorKey.replace(/_/g, " ")}
                                </Badge>
                                <span className="font-medium">{factor.factorName}</span>
                                {factor.autoAdjust && (
                                  <Badge variant="outline" className="bg-purple-500/10 text-purple-400 border-purple-500/30 text-xs">
                                    <Zap className="w-3 h-3 mr-1" />
                                    Auto
                                  </Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-4">
                                <div className="text-right">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm text-muted-foreground">Base:</span>
                                    <span className={`font-bold ${getWeightColor(factor.baseWeight)}`}>{factor.baseWeight}</span>
                                    {factor.aiAdjustedWeight !== factor.baseWeight && (
                                      <>
                                        <span className="text-muted-foreground">→</span>
                                        <span className={`font-bold ${getWeightColor(factor.aiAdjustedWeight)}`}>{factor.aiAdjustedWeight}</span>
                                        <span className="text-xs text-muted-foreground">(AI)</span>
                                      </>
                                    )}
                                  </div>
                                  <span className="text-xs text-muted-foreground">{factor.sampleSize || 0} trades</span>
                                </div>
                                {expandedFactors.includes(factor.id) ? (
                                  <ChevronUp className="w-4 h-4 text-muted-foreground" />
                                ) : (
                                  <ChevronDown className="w-4 h-4 text-muted-foreground" />
                                )}
                              </div>
                            </div>

                            {expandedFactors.includes(factor.id) && (
                              <div className="border-t p-4 bg-muted/30 space-y-4">
                                <p className="text-sm text-muted-foreground">{factor.description}</p>
                                
                                <div className="grid grid-cols-2 gap-4">
                                  <div className="space-y-2">
                                    <Label>Base Weight (0-100)</Label>
                                    <div className="flex items-center gap-3">
                                      <Slider 
                                        value={[draggingSliders[factor.factorKey] ?? factor.baseWeight]} 
                                        max={100} 
                                        step={5}
                                        className="flex-1"
                                        onValueChange={(value) => {
                                          setDraggingSliders(prev => ({ ...prev, [factor.factorKey]: value[0] }));
                                        }}
                                        onValueCommit={(value) => {
                                          updateFactorMutation.mutate({ factorKey: factor.factorKey, updates: { baseWeight: value[0] } });
                                          setDraggingSliders(prev => {
                                            const next = { ...prev };
                                            delete next[factor.factorKey];
                                            return next;
                                          });
                                        }}
                                      />
                                      <span className="w-10 text-center font-bold">{draggingSliders[factor.factorKey] ?? factor.baseWeight}</span>
                                    </div>
                                  </div>
                                  
                                  <div className="space-y-2">
                                    <Label>Current AI Weight</Label>
                                    <div className="flex items-center gap-2 p-2 bg-muted rounded">
                                      <span className={`text-lg font-bold ${getWeightColor(factor.aiAdjustedWeight)}`}>
                                        {factor.aiAdjustedWeight || factor.baseWeight}
                                      </span>
                                      {factor.lastAiUpdate && (
                                        <span className="text-xs text-muted-foreground">
                                          (updated {new Date(factor.lastAiUpdate).toLocaleDateString()})
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                <div className="flex items-center justify-between pt-2 border-t">
                                  <div className="flex items-center gap-3">
                                    <Switch 
                                      checked={factor.autoAdjust || false}
                                      onCheckedChange={(checked) => {
                                        updateFactorMutation.mutate({ factorKey: factor.factorKey, updates: { autoAdjust: checked } });
                                      }}
                                    />
                                    <Label>Allow AI Auto-Adjustment</Label>
                                  </div>
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
                          Contextual Modifiers ({modifiers?.length || 0})
                        </CardTitle>
                        <CardDescription data-testid="text-modifiers-desc">Weight adjustments when setup types meet specific market conditions</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          {modifiersLoading ? (
                            <div className="flex items-center justify-center py-8">
                              <Loader2 className="w-6 h-6 animate-spin" />
                            </div>
                          ) : modifiers?.length === 0 ? (
                            <p className="text-center text-muted-foreground py-4">No modifiers configured</p>
                          ) : (
                            modifiers?.map(mod => (
                              <div key={mod.id} className="flex items-center justify-between p-3 border rounded-lg" data-testid={`modifier-${mod.id}`}>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <Badge variant="outline">{mod.factorName}</Badge>
                                  <span className="text-muted-foreground">when</span>
                                  <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/30">
                                    {mod.whenConditionName}
                                  </Badge>
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className={`font-bold ${mod.weightModifier > 0 ? 'text-green-400' : 'text-red-400'}`}>
                                    {mod.weightModifier > 0 ? '+' : ''}{mod.weightModifier}
                                  </span>
                                  {mod.confidence && (
                                    <span className={`text-xs ${getConfidenceColor(mod.confidence)}`}>
                                      {mod.confidence}% conf
                                    </span>
                                  )}
                                  <span className="text-xs text-muted-foreground">
                                    ({mod.sampleSize || 0} trades)
                                  </span>
                                  {getSourceBadge(mod.source)}
                                </div>
                              </div>
                            ))
                          )}
                          
                          <Dialog open={showAddModifier} onOpenChange={setShowAddModifier}>
                            <DialogTrigger asChild>
                              <Button variant="outline" className="w-full mt-3" data-testid="button-add-modifier">
                                <Plus className="w-4 h-4 mr-2" />
                                Add Manual Modifier
                              </Button>
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>Add Contextual Modifier</DialogTitle>
                                <DialogDescription>Create a weight adjustment when a setup type meets a market condition</DialogDescription>
                              </DialogHeader>
                              <div className="space-y-4 py-4">
                                <div className="space-y-2">
                                  <Label>Setup Type Factor</Label>
                                  <Select value={newModifier.factorKey} onValueChange={(v) => setNewModifier(prev => ({ ...prev, factorKey: v }))}>
                                    <SelectTrigger data-testid="select-setup-type">
                                      <SelectValue placeholder="Select setup type..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {setupTypeFactors.map(f => (
                                        <SelectItem key={f.factorKey} value={f.factorKey} data-testid={`option-setup-${f.factorKey}`}>{f.factorName}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="space-y-2">
                                  <Label>Market Condition</Label>
                                  <Select value={newModifier.whenCondition} onValueChange={(v) => setNewModifier(prev => ({ ...prev, whenCondition: v }))}>
                                    <SelectTrigger data-testid="select-market-condition">
                                      <SelectValue placeholder="Select condition..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {MARKET_CONDITIONS.map(c => (
                                        <SelectItem key={c.key} value={c.key} data-testid={`option-condition-${c.key}`}>{c.name}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="space-y-2">
                                  <Label>Weight Modifier ({newModifier.weightModifier > 0 ? '+' : ''}{newModifier.weightModifier})</Label>
                                  <Slider 
                                    value={[newModifier.weightModifier]} 
                                    min={-50}
                                    max={50}
                                    step={5}
                                    onValueChange={(v) => setNewModifier(prev => ({ ...prev, weightModifier: v[0] }))}
                                    data-testid="slider-weight-modifier"
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label>Notes (optional)</Label>
                                  <Textarea 
                                    value={newModifier.notes}
                                    onChange={(e) => setNewModifier(prev => ({ ...prev, notes: e.target.value }))}
                                    placeholder="Why does this modifier make sense?"
                                    data-testid="textarea-modifier-notes"
                                  />
                                </div>
                              </div>
                              <DialogFooter>
                                <DialogClose asChild>
                                  <Button variant="outline">Cancel</Button>
                                </DialogClose>
                                <Button 
                                  onClick={handleCreateModifier}
                                  disabled={!newModifier.factorKey || !newModifier.whenCondition || createModifierMutation.isPending}
                                >
                                  {createModifierMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                                  Create Modifier
                                </Button>
                              </DialogFooter>
                            </DialogContent>
                          </Dialog>
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
                          <Badge className="ml-2" data-testid="badge-suggestions-count">{pendingSuggestions.length}</Badge>
                        </CardTitle>
                        <CardDescription data-testid="text-suggestions-desc">Pending weight adjustment proposals</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {pendingSuggestions.length === 0 ? (
                          <p className="text-muted-foreground text-sm text-center py-4" data-testid="text-no-suggestions">No pending suggestions</p>
                        ) : (
                          pendingSuggestions.map(suggestion => (
                            <div key={suggestion.id} className="p-3 border rounded-lg space-y-3" data-testid={`suggestion-${suggestion.id}`}>
                              <div className="flex items-center justify-between">
                                <Badge variant="outline">{suggestion.factorName}</Badge>
                                <span className={`text-xs ${getConfidenceColor(suggestion.confidenceScore)}`}>
                                  {suggestion.confidenceScore}% confidence
                                </span>
                              </div>
                              
                              {suggestion.whenConditionName && (
                                <div className="text-xs text-muted-foreground">
                                  When paired with: <span className="text-blue-400">{suggestion.whenConditionName}</span>
                                </div>
                              )}

                              <div className="flex items-center gap-2">
                                <span className="text-lg font-bold text-muted-foreground">{suggestion.currentValue}</span>
                                <span className="text-muted-foreground">→</span>
                                <Input 
                                  type="number" 
                                  value={suggestionAction?.id === suggestion.id ? suggestionAction.value : suggestion.proposedValue}
                                  onChange={(e) => setSuggestionAction({ id: suggestion.id, value: parseInt(e.target.value) || 0 })}
                                  className="w-16 text-center font-bold"
                                  data-testid={`input-proposed-value-${suggestion.id}`}
                                />
                              </div>

                              <p className="text-xs text-muted-foreground">{suggestion.reasoning}</p>
                              {suggestion.supportingData && (
                                <p className="text-xs text-muted-foreground">Based on {suggestion.supportingData.sampleSize} trades</p>
                              )}

                              <div className="flex gap-2">
                                <Button 
                                  size="sm" 
                                  className="flex-1 gap-1"
                                  onClick={() => reviewSuggestionMutation.mutate({ id: suggestion.id, approved: true })}
                                  disabled={reviewSuggestionMutation.isPending}
                                  data-testid={`button-approve-${suggestion.id}`}
                                >
                                  <CheckCircle2 className="w-3 h-3" />
                                  Approve
                                </Button>
                                <Button 
                                  size="sm" 
                                  variant="outline" 
                                  className="flex-1 gap-1"
                                  onClick={() => reviewSuggestionMutation.mutate({ id: suggestion.id, approved: false })}
                                  disabled={reviewSuggestionMutation.isPending}
                                  data-testid={`button-reject-${suggestion.id}`}
                                >
                                  <XCircle className="w-3 h-3" />
                                  Reject
                                </Button>
                              </div>
                            </div>
                          ))
                        )}

                        <Button 
                          variant="outline" 
                          className="w-full gap-2" 
                          onClick={() => runAnalysisMutation.mutate()}
                          disabled={runAnalysisMutation.isPending}
                          data-testid="button-analyze"
                        >
                          {runAnalysisMutation.isPending ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Brain className="w-4 h-4" />
                          )}
                          {runAnalysisMutation.isPending ? "Analyzing..." : "Run AI Analysis"}
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
                        {recentHistory.length === 0 ? (
                          <p className="text-center text-muted-foreground py-4">No changes yet</p>
                        ) : (
                          recentHistory.map(entry => (
                            <div key={entry.id} className="p-2 border rounded text-sm" data-testid={`history-${entry.id}`}>
                              <div className="flex items-center justify-between">
                                <span className="font-medium">{entry.factorName || entry.changeType}</span>
                                <span className="text-xs text-muted-foreground">{new Date(entry.createdAt).toLocaleDateString()}</span>
                              </div>
                              <div className="flex items-center gap-2 text-xs mt-1">
                                <Badge variant="outline" className="text-xs">{entry.changeType}</Badge>
                                {entry.oldValue && entry.newValue && (
                                  <span>{entry.oldValue} → {entry.newValue}</span>
                                )}
                                <span className="text-muted-foreground">by {entry.changedBy}</span>
                              </div>
                              {entry.reason && (
                                <p className="text-xs text-muted-foreground mt-1">{entry.reason}</p>
                              )}
                            </div>
                          ))
                        )}
                      </CardContent>
                    </Card>
                  </div>
                </div>
              </div>
            )}
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

          <TabsContent value="settings" data-testid="content-settings">
            <SystemSettingsTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
