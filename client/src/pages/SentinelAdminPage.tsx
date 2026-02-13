import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useSystemSettings } from "@/context/SystemSettingsContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { SentinelHeader } from "@/components/SentinelHeader";
import { Brain, Settings, Users, Tags, ChevronDown, ChevronUp, CheckCircle2, XCircle, TrendingUp, Zap, History, Lightbulb, Loader2, Plus, RefreshCw, Database, Sparkles } from "lucide-react";
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
  secondaryOverlayColor: string;
  textColorTitle: string;
  textColorHeader: string;
  textColorSection: string;
  textColorNormal: string;
  textColorSmall: string;
  textColorTiny: string;
  fontSizeTitle: string;
  fontSizeHeader: string;
  fontSizeSection: string;
  fontSizeNormal: string;
  fontSizeSmall: string;
  fontSizeTiny: string;
}

interface AdminUser {
  id: number;
  username: string;
  isAdmin: boolean;
  createdAt: string;
  totalRules: number;
  starterRulesCount: number;
  userRulesCount: number;
  needsSeeding: boolean;
}

function UsersTab() {
  const { toast } = useToast();

  const { data: users, isLoading, isError, error, refetch } = useQuery<AdminUser[]>({
    queryKey: ["/api/sentinel/admin/users"],
    retry: false,
  });

  const seedRulesMutation = useMutation({
    mutationFn: async (userId: number) => {
      const res = await apiRequest("POST", `/api/sentinel/admin/seed-rules/${userId}`);
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Rules Seeded", description: data.message });
      refetch();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to seed rules", variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2" data-testid="text-users-title">
            <Users className="w-5 h-5" />
            User Management
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-4">
            <XCircle className="w-8 h-8 mx-auto mb-2 text-destructive" />
            <p className="text-muted-foreground">
              {(error as Error)?.message?.includes("403") 
                ? "Admin access required to view users" 
                : "Failed to load users"}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2" data-testid="text-users-title">
            <Users className="w-5 h-5" />
            User Management
          </CardTitle>
          <CardDescription data-testid="text-users-desc">Manage users and seed starter rules</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh-users">
          <RefreshCw className="w-4 h-4 mr-1" />
          Refresh
        </Button>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {users?.map((user) => (
            <div 
              key={user.id} 
              className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border"
              data-testid={`card-user-${user.id}`}
            >
              <div className="flex items-center gap-3">
                <div className="flex flex-col">
                  <span className="font-medium" data-testid={`text-username-${user.id}`}>
                    {user.username}
                    {user.isAdmin && (
                      <Badge variant="secondary" className="ml-2 text-xs">Admin</Badge>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Joined {new Date(user.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
              
              <div className="flex items-center gap-4">
                <div className="text-right text-sm">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {user.starterRulesCount} Starter
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {user.userRulesCount} Custom
                    </Badge>
                  </div>
                </div>
                
                {user.needsSeeding && (
                  <Button
                    size="sm"
                    onClick={() => seedRulesMutation.mutate(user.id)}
                    disabled={seedRulesMutation.isPending}
                    data-testid={`button-seed-${user.id}`}
                  >
                    {seedRulesMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <Database className="w-4 h-4 mr-1" />
                        Seed Rules
                      </>
                    )}
                  </Button>
                )}
                
                {!user.needsSeeding && (
                  <Badge variant="secondary" className="text-xs text-rs-green">
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                    Has Rules
                  </Badge>
                )}
              </div>
            </div>
          ))}
          
          {(!users || users.length === 0) && (
            <p className="text-muted-foreground text-center py-4">No users found</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function SystemSettingsTab() {
  const { toast } = useToast();
  const [localSettings, setLocalSettings] = useState<SystemSettings>({
    overlayColor: "#1e3a5f",
    overlayTransparency: 75,
    backgroundColor: "#0f172a",
    logoTransparency: 12,
    secondaryOverlayColor: "#e8e8e8",
    textColorTitle: "#ffffff",
    textColorHeader: "#ffffff",
    textColorSection: "#ffffff",
    textColorNormal: "#ffffff",
    textColorSmall: "#a1a1aa",
    textColorTiny: "#71717a",
    fontSizeTitle: "1.5rem",
    fontSizeHeader: "1.125rem",
    fontSizeSection: "1rem",
    fontSizeNormal: "0.875rem",
    fontSizeSmall: "0.8125rem",
    fontSizeTiny: "0.75rem",
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
  useEffect(() => {
    if (settings && !isLoading) {
      setLocalSettings(settings);
    }
  }, [settings, isLoading]);

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
              max={100}
              step={1}
              className="w-full"
              data-testid="slider-logo-transparency"
            />
          </div>

          <div className="space-y-4">
            <Label className="text-base font-medium">Secondary Overlay Color</Label>
            <p className="text-sm text-muted-foreground">Background color for secondary panels (e.g. BigIdea lower left pane)</p>
            <div className="flex items-center gap-4">
              <input
                type="color"
                value={localSettings.secondaryOverlayColor}
                onChange={(e) => setLocalSettings(prev => ({ ...prev, secondaryOverlayColor: e.target.value }))}
                className="w-16 h-10 rounded border cursor-pointer"
                data-testid="input-secondary-overlay-color"
              />
              <Input
                value={localSettings.secondaryOverlayColor}
                onChange={(e) => setLocalSettings(prev => ({ ...prev, secondaryOverlayColor: e.target.value }))}
                className="w-28 font-mono"
                data-testid="input-secondary-overlay-color-text"
              />
            </div>
          </div>
        </div>

        <div className="border-t pt-6">
          <h3 className="text-lg font-semibold mb-1">Text Colors & Sizes</h3>
          <p className="text-sm text-muted-foreground mb-4">Customize the text color and size hierarchy across the interface</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {([
              { colorKey: "textColorTitle" as const, sizeKey: "fontSizeTitle" as const, label: "Title", desc: "Largest text, page titles" },
              { colorKey: "textColorHeader" as const, sizeKey: "fontSizeHeader" as const, label: "Header", desc: "Page headers, major sections" },
              { colorKey: "textColorSection" as const, sizeKey: "fontSizeSection" as const, label: "Section Header", desc: "Sub-section labels" },
              { colorKey: "textColorNormal" as const, sizeKey: "fontSizeNormal" as const, label: "Normal", desc: "Standard reading text" },
              { colorKey: "textColorSmall" as const, sizeKey: "fontSizeSmall" as const, label: "Small", desc: "Supplementary info" },
              { colorKey: "textColorTiny" as const, sizeKey: "fontSizeTiny" as const, label: "Tiny", desc: "Timestamps, debug info" },
            ]).map((item) => (
              <div key={item.colorKey} className="space-y-2">
                <Label className="text-sm font-medium">{item.label}</Label>
                <p className="text-xs text-muted-foreground">{item.desc}</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    type="color"
                    value={localSettings[item.colorKey]}
                    onChange={(e) => setLocalSettings(prev => ({ ...prev, [item.colorKey]: e.target.value }))}
                    className="w-10 h-8 rounded border cursor-pointer flex-shrink-0"
                    data-testid={`input-${item.colorKey}`}
                  />
                  <Input
                    value={localSettings[item.colorKey]}
                    onChange={(e) => setLocalSettings(prev => ({ ...prev, [item.colorKey]: e.target.value }))}
                    className="w-24 font-mono text-xs"
                    data-testid={`input-${item.colorKey}-text`}
                  />
                  <Select
                    value={localSettings[item.sizeKey]}
                    onValueChange={(val) => setLocalSettings(prev => ({ ...prev, [item.sizeKey]: val }))}
                  >
                    <SelectTrigger className="w-24 text-xs" data-testid={`select-${item.sizeKey}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0.625rem">10px</SelectItem>
                      <SelectItem value="0.75rem">12px</SelectItem>
                      <SelectItem value="0.8125rem">13px</SelectItem>
                      <SelectItem value="0.875rem">14px</SelectItem>
                      <SelectItem value="1rem">16px</SelectItem>
                      <SelectItem value="1.125rem">18px</SelectItem>
                      <SelectItem value="1.25rem">20px</SelectItem>
                      <SelectItem value="1.5rem">24px</SelectItem>
                      <SelectItem value="1.875rem">30px</SelectItem>
                      <SelectItem value="2.25rem">36px</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <span
                  style={{ color: localSettings[item.colorKey], fontSize: localSettings[item.sizeKey] }}
                  data-testid={`sample-${item.colorKey}`}
                >
                  Sample
                </span>
              </div>
            ))}
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
              style={{ opacity: (100 - localSettings.logoTransparency) / 100 }}
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

function TuningReviewCard({ review, showActions, onApprove, onReject, isPending }: {
  review: any;
  showActions: boolean;
  onApprove?: (id: number) => void;
  onReject?: (id: number) => void;
  isPending?: boolean;
}) {
  const accepted = (review.acceptedSuggestions as any[]) || [];
  const skipped = (review.skippedSuggestions as any[]) || [];
  const retainedUp = (review.retainedUpSymbols || []).length;
  const droppedUp = (review.droppedUpSymbols || []).length;
  const resultDelta = review.resultCountAfter !== null ? (review.resultCountAfter - review.resultCountBefore) : null;

  const outcomeLabel = review.outcome === "accepted" ? "Committed" : review.outcome === "discarded" ? "Discarded" : review.outcome;
  const approvalLabel = review.adminApproved === true ? "Approved" : review.adminApproved === false ? "Rejected" : "Pending";

  return (
    <Card data-testid={`card-tuning-review-${review.id}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">{review.submitterUsername}</Badge>
            <span className="text-xs text-muted-foreground">
              {new Date(review.createdAt).toLocaleDateString()} {new Date(review.createdAt).toLocaleTimeString()}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {!showActions && (
              <>
                <Badge variant={review.outcome === "accepted" ? "default" : "secondary"} className="text-[10px]">
                  {outcomeLabel}
                </Badge>
                <Badge
                  variant="outline"
                  className={`text-[10px] ${review.adminApproved === true ? "text-rs-green" : review.adminApproved === false ? "text-rs-red" : "text-rs-yellow"}`}
                >
                  {approvalLabel}
                </Badge>
              </>
            )}
            {review.ratingsCount !== null && (
              <Badge variant="secondary" className="text-xs">{review.ratingsCount} charts rated</Badge>
            )}
            {resultDelta !== null && (
              <Badge variant="secondary" className={`text-xs ${resultDelta >= 0 ? "text-rs-green" : "text-rs-red"}`}>
                {resultDelta >= 0 ? "+" : ""}{resultDelta} results
              </Badge>
            )}
            {review.universe && (
              <Badge variant="outline" className="text-[10px]">{review.universe}</Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Applied Changes ({accepted.length})</p>
          {accepted.map((s: any, i: number) => (
            <div key={i} className="flex items-center gap-2 text-sm flex-wrap">
              <Badge variant="outline" className="text-[10px]">{s.indicatorName || s.indicatorId}</Badge>
              <span className="font-medium">{s.paramName}</span>
              <span className="text-muted-foreground line-through">{s.currentValue}</span>
              <span>→</span>
              <span className="font-bold">{s.suggestedValue}</span>
            </div>
          ))}
          {skipped.length > 0 && (
            <p className="text-xs text-muted-foreground mt-1">{skipped.length} suggestion{skipped.length !== 1 ? "s" : ""} skipped</p>
          )}
        </div>

        {(retainedUp > 0 || droppedUp > 0) && (
          <div className="flex items-center gap-3 text-xs">
            <span className="text-rs-green">Liked kept: {retainedUp}</span>
            <span className="text-rs-red">Liked lost: {droppedUp}</span>
          </div>
        )}

        {review.archetypeTags && review.archetypeTags.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            {review.archetypeTags.map((tag: string, i: number) => (
              <Badge key={i} variant="secondary" className="text-[10px]">{tag}</Badge>
            ))}
          </div>
        )}

        {showActions && onApprove && onReject && (
          <div className="flex items-center gap-2 justify-end">
            <Button
              variant="destructive"
              size="sm"
              onClick={() => onReject(review.id)}
              disabled={isPending}
              data-testid={`button-reject-review-${review.id}`}
            >
              <XCircle className="w-3.5 h-3.5 mr-1" />
              Reject
            </Button>
            <Button
              size="sm"
              onClick={() => onApprove(review.id)}
              disabled={isPending}
              data-testid={`button-approve-review-${review.id}`}
            >
              <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
              Approve
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TuningReviewPanel() {
  const { toast } = useToast();
  const [subTab, setSubTab] = useState("user-tunes");
  
  const { data: pendingReviews = [], isLoading: pendingLoading, refetch: refetchPending } = useQuery<any[]>({
    queryKey: ["/api/bigidea/scan-tune/pending-reviews"],
  });

  const { data: allHistory = [], isLoading: historyLoading, refetch: refetchHistory } = useQuery<any[]>({
    queryKey: ["/api/bigidea/scan-tune/all-history"],
    enabled: subTab === "tuning-history",
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ id, approved }: { id: number; approved: boolean }) => {
      const res = await apiRequest("PATCH", `/api/bigidea/scan-tune/${id}/admin-review`, { approved });
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/bigidea/scan-tune/pending-reviews"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bigidea/scan-tune/all-history"] });
      toast({ title: variables.approved ? "Tuning approved" : "Tuning rejected", description: variables.approved ? "This tuning data will now improve AI suggestions." : "This tuning data has been rejected." });
    },
    onError: (err: Error) => {
      toast({ title: "Review failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Tabs value={subTab} onValueChange={setSubTab} className="space-y-4">
      <TabsList data-testid="tabs-tuning-sub">
        <TabsTrigger value="user-tunes" className="gap-1.5" data-testid="tab-user-tunes">
          <Sparkles className="w-3.5 h-3.5" />
          User Tunes
          {pendingReviews.length > 0 && (
            <Badge variant="secondary" className="text-[10px] ml-1">{pendingReviews.length}</Badge>
          )}
        </TabsTrigger>
        <TabsTrigger value="tuning-history" className="gap-1.5" data-testid="tab-tuning-history">
          <History className="w-3.5 h-3.5" />
          Tuning History
        </TabsTrigger>
      </TabsList>

      <TabsContent value="user-tunes" data-testid="content-user-tunes">
        {pendingLoading ? (
          <Card>
            <CardContent className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </CardContent>
          </Card>
        ) : pendingReviews.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <CheckCircle2 className="w-12 h-12 text-rs-green mb-4" />
              <h3 className="text-lg font-semibold mb-2" data-testid="text-no-reviews">All Clear</h3>
              <p className="text-muted-foreground text-center" data-testid="text-no-reviews-desc">
                No pending tuning reviews. Pro user submissions will appear here for approval.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{pendingReviews.length} pending review{pendingReviews.length !== 1 ? "s" : ""}</p>
              <Button variant="outline" size="sm" onClick={() => refetchPending()} data-testid="button-refresh-reviews">
                <RefreshCw className="w-4 h-4" />
              </Button>
            </div>
            {pendingReviews.map((review: any) => (
              <TuningReviewCard
                key={review.id}
                review={review}
                showActions={true}
                onApprove={(id) => reviewMutation.mutate({ id, approved: true })}
                onReject={(id) => reviewMutation.mutate({ id, approved: false })}
                isPending={reviewMutation.isPending}
              />
            ))}
          </div>
        )}
      </TabsContent>

      <TabsContent value="tuning-history" data-testid="content-tuning-history">
        {historyLoading ? (
          <Card>
            <CardContent className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </CardContent>
          </Card>
        ) : allHistory.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <History className="w-12 h-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2" data-testid="text-no-history">No Tuning History</h3>
              <p className="text-muted-foreground text-center" data-testid="text-no-history-desc">
                Committed and discarded tuning sessions will appear here.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{allHistory.length} tuning record{allHistory.length !== 1 ? "s" : ""}</p>
              <Button variant="outline" size="sm" onClick={() => refetchHistory()} data-testid="button-refresh-history">
                <RefreshCw className="w-4 h-4" />
              </Button>
            </div>
            {allHistory.map((record: any) => (
              <TuningReviewCard
                key={record.id}
                review={record}
                showActions={false}
              />
            ))}
          </div>
        )}
      </TabsContent>
    </Tabs>
  );
}

export default function SentinelAdminPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { settings: systemSettings, cssVariables } = useSystemSettings();
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
      case "structural": return "bg-rs-red/20 text-rs-red border-rs-red/30";
      case "entry": return "bg-rs-green/20 text-rs-green border-rs-green/30";
      case "exit": return "bg-blue-500/20 text-blue-400 border-blue-500/30";
      case "profit_taking": return "bg-rs-yellow/20 text-rs-yellow border-rs-yellow/30";
      case "stop_loss": return "bg-rs-amber/20 text-rs-amber border-rs-amber/30";
      case "ma_structure": return "bg-cyan-500/20 text-cyan-400 border-cyan-500/30";
      case "base_quality": return "bg-purple-500/20 text-purple-400 border-purple-500/30";
      case "breakout": return "bg-pink-500/20 text-pink-400 border-pink-500/30";
      case "position_sizing": return "bg-indigo-500/20 text-indigo-400 border-indigo-500/30";
      case "market_regime": return "bg-teal-500/20 text-teal-400 border-teal-500/30";
      case "risk": return "bg-rs-red/20 text-rs-red border-rs-red/30";
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
    if (weight >= 80) return "text-rs-green";
    if (weight >= 60) return "text-rs-yellow";
    return "text-rs-red";
  };

  const getConfidenceColor = (confidence: number | null) => {
    if (confidence === null) return "text-muted-foreground";
    if (confidence >= 80) return "text-rs-green";
    if (confidence >= 65) return "text-rs-yellow";
    return "text-rs-amber";
  };

  const getSourceBadge = (source: string) => {
    switch (source) {
      case "manual": return <Badge variant="outline" className="text-xs">Manual</Badge>;
      case "ai_suggested": return <Badge variant="outline" className="text-xs bg-purple-500/10 text-purple-400">AI Suggested</Badge>;
      case "ai_confirmed": return <Badge variant="outline" className="text-xs bg-rs-green/10 text-rs-green">AI Confirmed</Badge>;
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
            <TabsTrigger value="tuning-reviews" className="gap-2" data-testid="tab-tuning-reviews">
              <Sparkles className="w-4 h-4" />
              Tuning Review
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
                          <Zap className="w-5 h-5 text-rs-yellow" />
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
                                  <span className={`font-bold ${mod.weightModifier > 0 ? 'text-rs-green' : 'text-rs-red'}`}>
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
                    <Card className="border-rs-yellow/30">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-lg flex items-center gap-2" data-testid="text-suggestions-title">
                          <Lightbulb className="w-5 h-5 text-rs-yellow" />
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
            <UsersTab />
          </TabsContent>

          <TabsContent value="settings" data-testid="content-settings">
            <SystemSettingsTab />
          </TabsContent>

          <TabsContent value="tuning-reviews" data-testid="content-tuning-reviews">
            <TuningReviewPanel />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
