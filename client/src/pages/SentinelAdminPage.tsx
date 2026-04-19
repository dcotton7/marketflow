import { useState, useEffect, useMemo } from "react";
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
import { CopyScreenButton } from "@/components/CopyScreenButton";
import { Brain, Settings, Users, Tags, ChevronDown, ChevronUp, CheckCircle2, XCircle, TrendingUp, Zap, History, Lightbulb, Loader2, Plus, RefreshCw, Database, Sparkles, Activity, AlertTriangle, BookOpen, LayoutGrid, Pencil } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { WorkspacePaletteAdminPanel } from "@/components/admin/WorkspacePaletteAdminPanel";
import {
  effectiveTierCaps,
  FEATURE_LABELS,
  FEATURE_ORDER,
  normalizeSentinelTier,
  SENTINEL_ACCESS_TIERS,
  tierFeatureRow,
  tierFeaturesForRole,
  tierRoleBundleEquals,
  tierTokensForRole,
  type SentinelAccessTier,
  type TierAccessOverrides,
  type TierFeatureRow,
} from "@shared/sentinelTierAccess";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";

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

interface ThoughtScoreRule {
  id: number;
  ruleKey: string;
  label: string;
  description: string | null;
  scoreValue: number;
  enabled: boolean;
}

interface ThoughtSelectionWeight {
  id: number;
  strategyKey: string;
  label: string;
  description: string | null;
  weightPercent: number;
  configN: number | null;
  enabled: boolean;
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
  email: string;
  isAdmin: boolean;
  isActive: boolean;
  tier: SentinelAccessTier;
  createdAt: string;
  totalRules: number;
  starterRulesCount: number;
  userRulesCount: number;
  needsSeeding: boolean;
  features: TierFeatureRow;
  tokensAllowed: number | null;
  tokensUsed: number;
}

const TIER_DISPLAY: Record<SentinelAccessTier, string> = {
  free: "Free",
  standard: "Standard",
  professional: "Professional",
  pro_plus: "Pro+",
};

function UsersTab() {
  const { toast } = useToast();
  const [editUser, setEditUser] = useState<AdminUser | null>(null);
  const [draftTier, setDraftTier] = useState<SentinelAccessTier>("free");
  const [draftIsAdmin, setDraftIsAdmin] = useState(false);
  const [draftIsActive, setDraftIsActive] = useState(true);
  const [draftRoleFeatures, setDraftRoleFeatures] = useState<TierFeatureRow>(() =>
    tierFeaturesForRole("free", undefined)
  );
  const [draftTokensAllowed, setDraftTokensAllowed] = useState<number | null>(null);

  const { data: me } = useQuery<{ id: number }>({
    queryKey: ["/api/sentinel/me"],
    retry: false,
  });

  const { data: tierRoleDefaults } = useQuery<{ overrides: TierAccessOverrides }>({
    queryKey: ["/api/sentinel/admin/tier-role-defaults"],
    retry: false,
    staleTime: Infinity,
  });

  const { data: users, isLoading, isError, error, refetch } = useQuery<AdminUser[]>({
    queryKey: ["/api/sentinel/admin/users"],
    retry: false,
  });

  const openEditor = (user: AdminUser) => {
    setEditUser(user);
    setDraftTier(normalizeSentinelTier(user.tier));
    setDraftIsAdmin(user.isAdmin);
    setDraftIsActive(user.isActive);
  };

  useEffect(() => {
    if (!editUser) return;
    const o = tierRoleDefaults?.overrides;
    const t = normalizeSentinelTier(draftTier);
    setDraftRoleFeatures(tierFeaturesForRole(t, o));
    setDraftTokensAllowed(tierTokensForRole(t, o));
  }, [editUser?.id, draftTier, tierRoleDefaults]);

  const previewMergedOverrides = useMemo(() => {
    const base = tierRoleDefaults?.overrides ?? {};
    const t = normalizeSentinelTier(draftTier);
    return {
      ...base,
      [t]: { features: draftRoleFeatures, tokensAllowed: draftTokensAllowed },
    } as TierAccessOverrides;
  }, [tierRoleDefaults, draftTier, draftRoleFeatures, draftTokensAllowed]);

  const previewCaps = useMemo(
    () => effectiveTierCaps(normalizeSentinelTier(draftTier), draftIsAdmin, previewMergedOverrides),
    [draftTier, draftIsAdmin, previewMergedOverrides]
  );

  const roleDirty = useMemo(() => {
    const o = tierRoleDefaults?.overrides;
    const t = normalizeSentinelTier(draftTier);
    return !tierRoleBundleEquals(
      draftRoleFeatures,
      draftTokensAllowed,
      tierFeaturesForRole(t, o),
      tierTokensForRole(t, o)
    );
  }, [draftRoleFeatures, draftTokensAllowed, draftTier, tierRoleDefaults]);

  const parseApiErrorMessage = (err: Error) => {
    let msg = err.message || "Request failed";
    if (msg === "Failed to fetch" || msg.includes("NetworkError")) {
      msg =
        "Could not reach the server (network). Restart dev with `npm run dev`, try http://127.0.0.1:5000 if localhost fails, or set LISTEN_HOST.";
    }
    const m = /^(\d+):\s*(\{.*\})\s*$/s.exec(msg);
    if (m?.[2]) {
      try {
        const j = JSON.parse(m[2]) as { error?: string };
        if (j.error) msg = j.error;
      } catch {
        /* keep raw */
      }
    }
    return msg;
  };

  const patchUserMutation = useMutation({
    mutationFn: async (payload: {
      id: number;
      tier: SentinelAccessTier;
      isAdmin: boolean;
      isActive: boolean;
    }) => {
      const res = await apiRequest("PUT", `/api/sentinel/admin/users/${payload.id}`, {
        tier: payload.tier,
        isAdmin: payload.isAdmin,
        isActive: payload.isActive,
      });
      return res.json() as Promise<AdminUser>;
    },
    onSuccess: () => {
      toast({ title: "User updated", description: "Tier and access flags saved." });
      setEditUser(null);
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/admin/users"] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: parseApiErrorMessage(err), variant: "destructive" });
    },
  });

  const saveTierRoleMutation = useMutation({
    mutationFn: async () => {
      const tier = normalizeSentinelTier(draftTier);
      const res = await apiRequest("PUT", "/api/sentinel/admin/tier-role-defaults", {
        tier,
        features: draftRoleFeatures,
        tokensAllowed: draftTokensAllowed,
      });
      return res.json() as Promise<{ overrides: TierAccessOverrides }>;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/sentinel/admin/tier-role-defaults"], data);
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/admin/users"] });
      const t = normalizeSentinelTier(draftTier);
      toast({
        title: "Tier role saved",
        description: `Feature defaults for ${TIER_DISPLAY[t] ?? t} are updated for all users on that tier.`,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: parseApiErrorMessage(err), variant: "destructive" });
    },
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
    onError: (e: Error) => {
      toast({ title: "Error", description: e.message || "Failed to seed rules", variant: "destructive" });
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
          <CardDescription data-testid="text-users-desc">
            Tier, feature access, and account flags (admin tools stay admin-gated)
          </CardDescription>
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
              className="flex flex-col gap-3 p-3 rounded-lg bg-muted/30 border sm:flex-row sm:items-center sm:justify-between"
              data-testid={`card-user-${user.id}`}
            >
              <div className="flex flex-col gap-1 min-w-0">
                <span className="font-medium flex flex-wrap items-center gap-2" data-testid={`text-username-${user.id}`}>
                  {user.username}
                  {me?.id === user.id && (
                    <Badge variant="outline" className="text-xs font-normal">
                      You
                    </Badge>
                  )}
                  {user.isAdmin && <Badge variant="secondary" className="text-xs">Admin</Badge>}
                  {!user.isActive && (
                    <Badge variant="destructive" className="text-xs">
                      Inactive
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-xs">
                    {TIER_DISPLAY[user.tier] ?? user.tier}
                  </Badge>
                </span>
                <span className="text-xs text-muted-foreground truncate" title={user.email}>
                  {user.email}
                </span>
                <span className="text-xs text-muted-foreground">
                  Joined {new Date(user.createdAt).toLocaleDateString()}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant="outline" className="text-xs">
                    {user.starterRulesCount} Starter
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    {user.userRulesCount} Custom
                  </Badge>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => openEditor(user)}
                  data-testid={`button-edit-user-${user.id}`}
                >
                  <Pencil className="w-4 h-4 mr-1" />
                  Edit
                </Button>

                {user.needsSeeding ? (
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
                ) : (
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

        <Dialog
          open={!!editUser}
          onOpenChange={(open) => {
            if (!open) setEditUser(null);
          }}
        >
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit user</DialogTitle>
              <DialogDescription>
                {editUser ? (
                  <>
                    <span className="font-medium text-foreground">{editUser.username}</span>
                    <span className="text-muted-foreground"> — {editUser.email}</span>
                  </>
                ) : null}
              </DialogDescription>
            </DialogHeader>

            {editUser && (
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label htmlFor="admin-user-tier">Access tier</Label>
                  <Select
                    key={editUser.id}
                    value={normalizeSentinelTier(draftTier)}
                    onValueChange={(v) => setDraftTier(v as SentinelAccessTier)}
                  >
                    <SelectTrigger id="admin-user-tier" data-testid="select-user-tier">
                      <SelectValue placeholder="Select tier" />
                    </SelectTrigger>
                    <SelectContent>
                      {SENTINEL_ACCESS_TIERS.map((t) => (
                        <SelectItem key={t} value={t}>
                          {TIER_DISPLAY[t]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between gap-4 rounded-md border p-3">
                  <div>
                    <p className="text-sm font-medium">Administrator</p>
                    <p className="text-xs text-muted-foreground">Full product access; Sentinel admin routes</p>
                  </div>
                  <Switch checked={draftIsAdmin} onCheckedChange={setDraftIsAdmin} data-testid="switch-user-admin" />
                </div>

                <div className="flex items-center justify-between gap-4 rounded-md border p-3">
                  <div>
                    <p className="text-sm font-medium">Account active</p>
                    <p className="text-xs text-muted-foreground">Inactive users cannot sign in</p>
                  </div>
                  <Switch checked={draftIsActive} onCheckedChange={setDraftIsActive} data-testid="switch-user-active" />
                </div>

                <div className="space-y-3 rounded-md border p-3">
                  <div>
                    <p className="text-sm font-medium">Role defaults for selected tier</p>
                    <p className="text-xs text-muted-foreground">
                      Applies to every account on the access tier you picked above. Choosing a different tier reloads
                      that tier&apos;s saved preset (built-in defaults plus any admin overrides).
                    </p>
                  </div>
                  <div className="grid gap-2">
                    {FEATURE_ORDER.map((key) => (
                      <label key={key} className="flex items-center gap-2 text-sm cursor-pointer">
                        <Checkbox
                          checked={draftRoleFeatures[key]}
                          onCheckedChange={(v) =>
                            setDraftRoleFeatures((prev) => ({ ...prev, [key]: v === true }))
                          }
                          data-testid={`checkbox-tier-feature-${key}`}
                        />
                        <span>{FEATURE_LABELS[key]}</span>
                      </label>
                    ))}
                  </div>
                  <div className="space-y-2">
                    <Label>Max alerts (tier default)</Label>
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <Checkbox
                          checked={draftRoleFeatures.maxAlerts === null}
                          onCheckedChange={(v) => {
                            if (v === true) {
                              setDraftRoleFeatures((prev) => ({ ...prev, maxAlerts: null }));
                            } else {
                              const t = normalizeSentinelTier(draftTier);
                              const fromMatrix = tierFeatureRow(t).maxAlerts;
                              setDraftRoleFeatures((prev) => ({
                                ...prev,
                                maxAlerts: fromMatrix === null ? 0 : fromMatrix,
                              }));
                            }
                          }}
                        />
                        <span>Unlimited</span>
                      </label>
                      {draftRoleFeatures.maxAlerts !== null && (
                        <Input
                          type="number"
                          min={0}
                          className="w-24 h-8"
                          value={draftRoleFeatures.maxAlerts}
                          onChange={(e) => {
                            const n = parseInt(e.target.value, 10);
                            setDraftRoleFeatures((prev) => ({
                              ...prev,
                              maxAlerts: Number.isFinite(n) ? Math.max(0, n) : 0,
                            }));
                          }}
                          data-testid="input-tier-max-alerts"
                        />
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Tokens allowed (tier default)</Label>
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <Checkbox
                          checked={draftTokensAllowed === null}
                          onCheckedChange={(v) => {
                            setDraftTokensAllowed(v === true ? null : 0);
                          }}
                        />
                        <span>Unlimited</span>
                      </label>
                      {draftTokensAllowed !== null && (
                        <Input
                          type="number"
                          min={0}
                          className="w-28 h-8"
                          value={draftTokensAllowed}
                          onChange={(e) => {
                            const n = parseInt(e.target.value, 10);
                            setDraftTokensAllowed(Number.isFinite(n) ? Math.max(0, n) : 0);
                          }}
                          data-testid="input-tier-tokens"
                        />
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium">Effective access (preview)</p>
                  <p className="text-xs text-muted-foreground">
                    Administrators always see every feature and unlimited alerts in the product; token cap below still
                    follows the tier role unless you grant unlimited tokens.
                  </p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Feature</TableHead>
                        <TableHead className="text-right">Access</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {FEATURE_ORDER.map((key) => (
                        <TableRow key={key}>
                          <TableCell className="text-muted-foreground">{FEATURE_LABELS[key]}</TableCell>
                          <TableCell className="text-right">
                            {previewCaps.features[key] ? (
                              <span className="text-rs-green">Yes</span>
                            ) : (
                              <span className="text-muted-foreground">No</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow>
                        <TableCell className="text-muted-foreground">Alerts (max)</TableCell>
                        <TableCell className="text-right">
                          {previewCaps.features.maxAlerts === null ? (
                            <span>Unlimited</span>
                          ) : (
                            <span>{previewCaps.features.maxAlerts}</span>
                          )}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="text-muted-foreground">Tokens</TableCell>
                        <TableCell className="text-right">
                          {previewCaps.tokensAllowed === null ? (
                            <span>Unlimited</span>
                          ) : (
                            <span>{previewCaps.tokensAllowed}</span>
                          )}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>

                <div className="pt-1">
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full"
                    disabled={!roleDirty || saveTierRoleMutation.isPending}
                    onClick={() => saveTierRoleMutation.mutate()}
                    data-testid="button-save-tier-role-defaults"
                  >
                    {saveTierRoleMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      "Change features for role"
                    )}
                  </Button>
                </div>

                <DialogFooter className="gap-2 sm:gap-0">
                  <Button type="button" variant="outline" onClick={() => setEditUser(null)}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    disabled={patchUserMutation.isPending}
                    onClick={() =>
                      patchUserMutation.mutate({
                        id: editUser.id,
                        tier: normalizeSentinelTier(draftTier),
                        isAdmin: draftIsAdmin,
                        isActive: draftIsActive,
                      })
                    }
                    data-testid="button-save-user"
                  >
                    {patchUserMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      "Save changes"
                    )}
                  </Button>
                </DialogFooter>
              </div>
            )}
          </DialogContent>
        </Dialog>
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
            className="min-h-[9.5rem] rounded-lg flex items-center justify-center relative py-6 px-8"
            style={{ backgroundColor: localSettings.backgroundColor }}
          >
            <div
              className="absolute inset-0 flex items-center justify-center py-5 px-6"
              style={{ opacity: (100 - localSettings.logoTransparency) / 100 }}
            >
              <img
                src="/structuremap-logo.png"
                alt="StructureMap"
                className="structuremap-wordmark-glow max-h-[6.5rem] w-auto max-w-[min(100%,22rem)] object-contain"
              />
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

function QueryOptimizerPanel() {
  const { toast } = useToast();
  const [localSettings, setLocalSettings] = useState<any>(null);
  
  const { data: settings, isLoading: settingsLoading, refetch: refetchSettings } = useQuery<any>({
    queryKey: ["/api/bigidea/optimizer-display-settings"],
  });

  const { data: stats, isLoading: statsLoading } = useQuery<any>({
    queryKey: ["/api/bigidea/optimizer-stats"],
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const updateSettingsMutation = useMutation({
    mutationFn: async (updates: any) => {
      const res = await apiRequest("PATCH", "/api/admin/optimizer-display-settings", updates);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Settings updated", description: "Optimizer display settings saved successfully" });
      refetchSettings();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update settings", variant: "destructive" });
    },
  });

  useEffect(() => {
    if (settings) {
      setLocalSettings(settings);
    }
  }, [settings]);

  if (settingsLoading || !localSettings) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const handleSettingChange = (key: string, value: any) => {
    const updated = { ...localSettings, [key]: value };
    setLocalSettings(updated);
  };

  const handleMetricChange = (key: string, value: boolean) => {
    const updated = {
      ...localSettings,
      metrics: { ...localSettings.metrics, [key]: value },
    };
    setLocalSettings(updated);
  };

  const handleSaveSettings = () => {
    // Flatten the settings structure for the API
    const updates: any = {
      showOptimizerOverlay: localSettings.showOverlay,
      showOverallImprovement: localSettings.metrics.overallImprovement,
      showWeeklyImprovement: localSettings.metrics.weeklyImprovement,
      showConfidenceLevel: localSettings.metrics.confidenceLevel,
      showScanStats: localSettings.metrics.scanStats,
      showLiveOptimization: localSettings.metrics.liveOptimization,
      showAchievementBadges: localSettings.metrics.achievementBadges,
      overlayPosition: localSettings.position,
      overlayStyle: localSettings.style,
      overlayTheme: localSettings.theme,
    };

    // If admin override is enabled, also save admin-specific settings
    if (localSettings.adminOverrideEnabled) {
      updates.adminShowOverallImprovement = localSettings.metrics.overallImprovement;
      updates.adminShowWeeklyImprovement = localSettings.metrics.weeklyImprovement;
      updates.adminShowConfidenceLevel = localSettings.metrics.confidenceLevel;
      updates.adminShowScanStats = localSettings.metrics.scanStats;
      updates.adminShowLiveOptimization = localSettings.metrics.liveOptimization;
      updates.adminShowAchievementBadges = localSettings.metrics.achievementBadges;
      updates.adminShowDebugInfo = localSettings.metrics.debugInfo;
    }

    updateSettingsMutation.mutate(updates);
  };

  return (
    <div className="space-y-6">
      {/* Stats Overview */}
      {stats && !statsLoading && (
        <Card className="bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border-cyan-500/30">
          <CardHeader>
            <div className="flex items-center gap-3">
              <Activity className="w-6 h-6 text-cyan-400" />
              <div>
                <CardTitle>Query Optimizer Performance</CardTitle>
                <CardDescription>Real-time learning statistics from Big Idea Scanner</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Overall Improvement</div>
                <div className="text-2xl font-semibold text-emerald-400">+{stats.overallImprovement}%</div>
              </div>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">This Week</div>
                <div className={`text-2xl font-semibold ${stats.weeklyImprovement >= 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {stats.weeklyImprovement >= 0 ? '+' : ''}{stats.weeklyImprovement}%
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Confidence</div>
                <div className="text-2xl font-semibold text-cyan-400">{stats.avgConfidence}%</div>
              </div>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Total Scans</div>
                <div className="text-2xl font-semibold text-white">{stats.totalScans.toLocaleString()}</div>
              </div>
            </div>
            {stats.topImprovedIndicator && (
              <div className="mt-4 pt-4 border-t border-cyan-500/20">
                <div className="text-xs text-muted-foreground mb-1">Top Performer</div>
                <div className="flex items-center justify-between">
                  <div className="font-medium text-cyan-300">{stats.topImprovedIndicator.name}</div>
                  <Badge variant="outline" className="text-emerald-400 border-emerald-400/50">
                    {stats.topImprovedIndicator.selectivity}% selectivity
                  </Badge>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Display Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Display Settings</CardTitle>
          <CardDescription>Control what metrics are shown on the Big Idea Scanner canvas</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Master Toggle */}
          <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/30">
            <div>
              <Label className="text-base font-semibold">Show Optimizer Overlay</Label>
              <p className="text-sm text-muted-foreground mt-1">Master toggle for all optimizer metrics display</p>
            </div>
            <Switch
              checked={localSettings.showOverlay}
              onCheckedChange={(checked) => handleSettingChange('showOverlay', checked)}
            />
          </div>

          {/* Admin Override */}
          {localSettings.isAdmin && (
            <div className="flex items-center justify-between p-4 border rounded-lg bg-purple-500/10 border-purple-500/30">
              <div>
                <Label className="text-base font-semibold">Admin Override Mode</Label>
                <p className="text-sm text-muted-foreground mt-1">Use different settings for admin vs regular users</p>
              </div>
              <Switch
                checked={localSettings.adminOverrideEnabled}
                onCheckedChange={(checked) => handleSettingChange('adminOverrideEnabled', checked)}
              />
            </div>
          )}

          {/* Metric Toggles */}
          <div className="space-y-3">
            <Label className="text-base font-semibold">Visible Metrics</Label>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="overall-improvement" className="font-normal">Overall Improvement %</Label>
                <Switch
                  id="overall-improvement"
                  checked={localSettings.metrics.overallImprovement}
                  onCheckedChange={(checked) => handleMetricChange('overallImprovement', checked)}
                  disabled={!localSettings.showOverlay}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="weekly-improvement" className="font-normal">Weekly Improvement %</Label>
                <Switch
                  id="weekly-improvement"
                  checked={localSettings.metrics.weeklyImprovement}
                  onCheckedChange={(checked) => handleMetricChange('weeklyImprovement', checked)}
                  disabled={!localSettings.showOverlay}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="confidence-level" className="font-normal">Confidence Level</Label>
                <Switch
                  id="confidence-level"
                  checked={localSettings.metrics.confidenceLevel}
                  onCheckedChange={(checked) => handleMetricChange('confidenceLevel', checked)}
                  disabled={!localSettings.showOverlay}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="scan-stats" className="font-normal">Scan Statistics</Label>
                <Switch
                  id="scan-stats"
                  checked={localSettings.metrics.scanStats}
                  onCheckedChange={(checked) => handleMetricChange('scanStats', checked)}
                  disabled={!localSettings.showOverlay}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="live-optimization" className="font-normal">Live Optimization Messages</Label>
                <Switch
                  id="live-optimization"
                  checked={localSettings.metrics.liveOptimization}
                  onCheckedChange={(checked) => handleMetricChange('liveOptimization', checked)}
                  disabled={!localSettings.showOverlay}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="achievement-badges" className="font-normal">Achievement Badges</Label>
                <Switch
                  id="achievement-badges"
                  checked={localSettings.metrics.achievementBadges}
                  onCheckedChange={(checked) => handleMetricChange('achievementBadges', checked)}
                  disabled={!localSettings.showOverlay}
                />
              </div>
              {localSettings.isAdmin && (
                <div className="flex items-center justify-between p-2 rounded bg-purple-500/10">
                  <Label htmlFor="debug-info" className="font-normal text-purple-300">Debug Info (Admin Only)</Label>
                  <Switch
                    id="debug-info"
                    checked={localSettings.metrics.debugInfo}
                    onCheckedChange={(checked) => handleMetricChange('debugInfo', checked)}
                    disabled={!localSettings.showOverlay}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Display Style */}
          <div className="space-y-3">
            <Label className="text-base font-semibold">Display Style</Label>
            <Select
              value={localSettings.style}
              onValueChange={(value) => handleSettingChange('style', value)}
              disabled={!localSettings.showOverlay}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="minimal">Minimal (Single line)</SelectItem>
                <SelectItem value="compact">Compact (3-4 lines)</SelectItem>
                <SelectItem value="detailed">Detailed (Full stats)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Theme */}
          <div className="space-y-3">
            <Label className="text-base font-semibold">Theme</Label>
            <Select
              value={localSettings.theme}
              onValueChange={(value) => handleSettingChange('theme', value)}
              disabled={!localSettings.showOverlay}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="matrix">Matrix (Green)</SelectItem>
                <SelectItem value="cyberpunk">Cyberpunk (Cyan)</SelectItem>
                <SelectItem value="minimal">Minimal (Gray)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Position */}
          <div className="space-y-3">
            <Label className="text-base font-semibold">Position</Label>
            <Select
              value={localSettings.position}
              onValueChange={(value) => handleSettingChange('position', value)}
              disabled={!localSettings.showOverlay}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bottom-center">Bottom Center</SelectItem>
                <SelectItem value="bottom-right">Bottom Right</SelectItem>
                <SelectItem value="bottom-left">Bottom Left</SelectItem>
                <SelectItem value="top-right">Top Right</SelectItem>
                <SelectItem value="top-left">Top Left</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Save Button */}
          <div className="pt-4 border-t">
            <Button
              onClick={handleSaveSettings}
              disabled={updateSettingsMutation.isPending}
              className="w-full"
            >
              {updateSettingsMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save Settings
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Indicator Performance Table */}
      {stats && stats.indicators && stats.indicators.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Indicator Performance</CardTitle>
            <CardDescription>Detailed performance metrics for each indicator in the library</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-2 font-semibold">Indicator</th>
                    <th className="text-left py-2 px-2 font-semibold">Category</th>
                    <th className="text-right py-2 px-2 font-semibold">Pass Rate</th>
                    <th className="text-right py-2 px-2 font-semibold">Selectivity</th>
                    <th className="text-right py-2 px-2 font-semibold">Avg Time</th>
                    <th className="text-right py-2 px-2 font-semibold">Evaluations</th>
                    <th className="text-right py-2 px-2 font-semibold">Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.indicators
                    .sort((a: any, b: any) => b.selectivity - a.selectivity)
                    .map((indicator: any) => (
                    <tr key={indicator.id} className="border-b border-muted/30">
                      <td className="py-2 px-2 font-mono text-xs">{indicator.name}</td>
                      <td className="py-2 px-2">
                        <Badge variant="outline" className="text-xs">{indicator.category}</Badge>
                      </td>
                      <td className="py-2 px-2 text-right font-mono">{indicator.passRate}%</td>
                      <td className="py-2 px-2 text-right">
                        <span className={`font-semibold ${
                          indicator.selectivity >= 70 ? 'text-emerald-400' :
                          indicator.selectivity >= 50 ? 'text-cyan-400' :
                          'text-amber-400'
                        }`}>
                          {indicator.selectivity}%
                        </span>
                      </td>
                      <td className="py-2 px-2 text-right font-mono text-muted-foreground">{indicator.avgTimeMs}ms</td>
                      <td className="py-2 px-2 text-right font-mono text-muted-foreground">{indicator.evaluations.toLocaleString()}</td>
                      <td className="py-2 px-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-xs">{indicator.confidence}%</span>
                          <div className="w-12 bg-muted rounded-full h-1.5">
                            <div
                              className={`h-1.5 rounded-full ${
                                indicator.confidence >= 85 ? 'bg-emerald-500' :
                                indicator.confidence >= 70 ? 'bg-cyan-500' :
                                indicator.confidence >= 50 ? 'bg-blue-500' :
                                'bg-amber-500'
                              }`}
                              style={{ width: `${indicator.confidence}%` }}
                            />
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// === ASK IVY RULES PANEL ===
// Interface matching the backend AskIvyOverlaySettings
interface AskIvyRulesSettings {
  enableMinerviniCheatEntries: boolean;
  enableEma620Entry: boolean;
  ema620AllowedTimeframe: "5min_only" | "all_intraday";
  entryBufferPct: number;
  // Qullaggie Entry Rules
  enableOrhEntry: boolean;
  orhTimeframe: "5min" | "60min" | "both";
  enableMaSurfEntry: boolean;
  maSurfMaxDistancePct: number;
  // Stops
  include21EmaStop: boolean;
  include50SmaStop: boolean;
  includeAtrStop: boolean;
  atrStopMultiple: number;
  stopMaOffsetDollars: number;
  stop21Label: string;
  // Qullaggie Stop Rules
  enforceAtrStopCap: boolean;
  enforceAdrStopCap: boolean;
  // Targets
  alwaysInclude8RTarget: boolean;
  includeSwingHighTargets: boolean;
  swingHighTargetCount: number;
  include52wTarget: boolean;
  includeWeeklyTarget: boolean;
  include5DayTarget: boolean;
  include8xAdrTarget: boolean;
  adr8TargetBreakoutOnly: boolean;
  warnIfNoChartTargets: boolean;
  // Target Display / Filtering
  minRrThreshold: number;
  targetDisplayLimit: number;
  prioritizeChartTargets: boolean;
  include8xAdrOver50Target: boolean;
  // Risk Warnings
  warn200DsmaBelow: boolean;
  // Qullaggie Position Management
  suggestPartialProfits: boolean;
  partialProfitDays: number;
  includeTrailMaCloseStop: boolean;
  trailMaClosePeriod: number;
  // Extension
  extendedThresholdAdr: number;
  profitTakingThresholdAdr: number;
  showExtendedWarning: boolean;
  chartPriceScaleSide: "left" | "right";
  overlayResizable: boolean;
}

function AskIvyRulesPanel() {
  const { toast } = useToast();
  const [localSettings, setLocalSettings] = useState<AskIvyRulesSettings | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  const { data: settings, isLoading, refetch } = useQuery<AskIvyRulesSettings>({
    queryKey: ["/api/admin/ask-ivy-settings"],
  });

  const updateMutation = useMutation({
    mutationFn: async (updates: Partial<AskIvyRulesSettings>) => {
      const res = await apiRequest("PATCH", "/api/admin/ask-ivy-settings", updates);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Settings saved", description: "Trade Plan rules have been updated successfully." });
      setHasChanges(false);
      refetch();
    },
    onError: (err: Error) => {
      toast({ title: "Failed to save", description: err.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    if (settings) {
      setLocalSettings(settings);
      setHasChanges(false);
    }
  }, [settings]);

  if (isLoading || !localSettings) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const handleChange = <K extends keyof AskIvyRulesSettings>(key: K, value: AskIvyRulesSettings[K]) => {
    setLocalSettings((prev) => prev ? { ...prev, [key]: value } : prev);
    setHasChanges(true);
  };

  const handleSave = () => {
    if (localSettings) {
      updateMutation.mutate(localSettings);
    }
  };

  const handleCancel = () => {
    if (settings) {
      setLocalSettings(settings);
      setHasChanges(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Overview Card */}
      <Card className="bg-gradient-to-r from-amber-500/10 to-orange-500/10 border-amber-500/30">
        <CardHeader>
          <div className="flex items-center gap-3">
            <Lightbulb className="w-6 h-6 text-amber-400" />
            <div>
              <CardTitle>Trade Plan Rules</CardTitle>
              <CardDescription>Configure entry, stop, and target suggestion logic for the Trade Plan overlay</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0 text-sm text-muted-foreground space-y-1">
          <p><span className="font-medium text-foreground">Affects:</span> all Trade Plan overlay suggestions on charts (entries, stops, profit targets, extension warnings).</p>
          <p><span className="font-medium text-foreground">How:</span> toggle rules on/off, adjust thresholds and labels. Changes apply globally after save.</p>
          <p><span className="font-medium text-foreground">Scope:</span> global (all users see the same suggestion logic).</p>
        </CardContent>
      </Card>

      {/* Save/Cancel Bar */}
      {hasChanges && (
        <div className="sticky top-0 z-10 flex items-center justify-between p-3 bg-amber-500/20 border border-amber-500/40 rounded-lg">
          <span className="text-sm font-medium text-amber-200">You have unsaved changes</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleCancel} disabled={updateMutation.isPending}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Save Changes
            </Button>
          </div>
        </div>
      )}

      {/* Entry Rules */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-emerald-400" />
            Entry Rules
          </CardTitle>
          <CardDescription>Configure how entry suggestions are generated</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Minervini Cheat Entries */}
            <div className="flex items-center justify-between p-3 border rounded-lg">
              <div>
                <Label className="font-medium">Enable Minervini Cheat Entries</Label>
                <p className="text-xs text-muted-foreground mt-1">Include High/Mid/Low cheat entry suggestions</p>
              </div>
              <Switch
                checked={localSettings.enableMinerviniCheatEntries}
                onCheckedChange={(v) => handleChange("enableMinerviniCheatEntries", v)}
              />
            </div>

            {/* 6/20 EMA Entry */}
            <div className="flex items-center justify-between p-3 border rounded-lg">
              <div>
                <Label className="font-medium">Enable 6/20 EMA Entry Tactic</Label>
                <p className="text-xs text-muted-foreground mt-1">Suggest EMA cross-up as entry trigger</p>
              </div>
              <Switch
                checked={localSettings.enableEma620Entry}
                onCheckedChange={(v) => handleChange("enableEma620Entry", v)}
              />
            </div>
          </div>

          {/* 6/20 EMA Timeframe */}
          <div className="flex items-center justify-between p-3 border rounded-lg">
            <div>
              <Label className="font-medium">6/20 EMA Timeframe Restriction</Label>
              <p className="text-xs text-muted-foreground mt-1">When to show the 6/20 EMA entry tactic</p>
            </div>
            <Select
              value={localSettings.ema620AllowedTimeframe}
              onValueChange={(v) => handleChange("ema620AllowedTimeframe", v as "5min_only" | "all_intraday")}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="5min_only">5-min only</SelectItem>
                <SelectItem value="all_intraday">All intraday</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Entry Buffer */}
          <div className="p-3 border rounded-lg space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <Label className="font-medium">Entry Buffer (breakout styles)</Label>
                <p className="text-xs text-muted-foreground mt-1">Added to base high, prior day high, etc.</p>
              </div>
              <span className="font-mono text-sm">{(localSettings.entryBufferPct * 100).toFixed(2)}%</span>
            </div>
            <Slider
              value={[localSettings.entryBufferPct * 100]}
              onValueChange={([v]) => handleChange("entryBufferPct", v / 100)}
              min={0}
              max={1}
              step={0.05}
              className="w-full"
            />
          </div>

          {/* Qullaggie Entry Rules Section */}
          <div className="pt-4 border-t">
            <h4 className="text-sm font-semibold text-amber-400 mb-3">Qullaggie Entry Rules</h4>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Opening Range High Entry */}
              <div className="flex items-center justify-between p-3 border rounded-lg border-amber-500/30">
                <div>
                  <Label className="font-medium">Enable ORH Entry</Label>
                  <p className="text-xs text-muted-foreground mt-1">Opening Range High breakout entries (Qullaggie)</p>
                </div>
                <Switch
                  checked={localSettings.enableOrhEntry}
                  onCheckedChange={(v) => handleChange("enableOrhEntry", v)}
                />
              </div>

              {/* MA Surf Zone Entry */}
              <div className="flex items-center justify-between p-3 border rounded-lg border-amber-500/30">
                <div>
                  <Label className="font-medium">Enable MA Surf Entry</Label>
                  <p className="text-xs text-muted-foreground mt-1">Entry when price surfing rising 10/20 MAs</p>
                </div>
                <Switch
                  checked={localSettings.enableMaSurfEntry}
                  onCheckedChange={(v) => handleChange("enableMaSurfEntry", v)}
                />
              </div>
            </div>

            {/* ORH Timeframe */}
            <div className="flex items-center justify-between p-3 border rounded-lg border-amber-500/30 mt-4">
              <div>
                <Label className="font-medium">ORH Timeframe</Label>
                <p className="text-xs text-muted-foreground mt-1">Which opening range high to suggest</p>
              </div>
              <Select
                value={localSettings.orhTimeframe}
                onValueChange={(v) => handleChange("orhTimeframe", v as "5min" | "60min" | "both")}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5min">5-min</SelectItem>
                  <SelectItem value="60min">60-min</SelectItem>
                  <SelectItem value="both">Both</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* MA Surf Max Distance */}
            <div className="p-3 border rounded-lg border-amber-500/30 space-y-2 mt-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="font-medium">MA Surf Max Distance %</Label>
                  <p className="text-xs text-muted-foreground mt-1">Max distance from MA to be considered "surfing"</p>
                </div>
                <span className="font-mono text-sm">{localSettings.maSurfMaxDistancePct}%</span>
              </div>
              <Slider
                value={[localSettings.maSurfMaxDistancePct]}
                onValueChange={([v]) => handleChange("maSurfMaxDistancePct", v)}
                min={0.5}
                max={5}
                step={0.5}
                className="w-full"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stop Rules */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <XCircle className="w-5 h-5 text-red-400" />
            Stop Rules
          </CardTitle>
          <CardDescription>Configure how stop-loss suggestions are generated</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* 21 EMA Stop */}
            <div className="flex items-center justify-between p-3 border rounded-lg">
              <div>
                <Label className="font-medium">Include 21 EMA Stop</Label>
              </div>
              <Switch
                checked={localSettings.include21EmaStop}
                onCheckedChange={(v) => handleChange("include21EmaStop", v)}
              />
            </div>

            {/* 50 SMA Stop */}
            <div className="flex items-center justify-between p-3 border rounded-lg">
              <div>
                <Label className="font-medium">Include 50 SMA Stop</Label>
              </div>
              <Switch
                checked={localSettings.include50SmaStop}
                onCheckedChange={(v) => handleChange("include50SmaStop", v)}
              />
            </div>

            {/* ATR Stop */}
            <div className="flex items-center justify-between p-3 border rounded-lg">
              <div>
                <Label className="font-medium">Include ATR Stop</Label>
              </div>
              <Switch
                checked={localSettings.includeAtrStop}
                onCheckedChange={(v) => handleChange("includeAtrStop", v)}
              />
            </div>
          </div>

          {/* ATR Multiple */}
          <div className="p-3 border rounded-lg space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <Label className="font-medium">ATR Stop Multiple</Label>
                <p className="text-xs text-muted-foreground mt-1">Stop = Entry - (ATR × multiple)</p>
              </div>
              <span className="font-mono text-sm">{localSettings.atrStopMultiple.toFixed(1)}×</span>
            </div>
            <Slider
              value={[localSettings.atrStopMultiple]}
              onValueChange={([v]) => handleChange("atrStopMultiple", v)}
              min={0.5}
              max={5}
              step={0.1}
              className="w-full"
            />
          </div>

          {/* MA Offset */}
          <div className="p-3 border rounded-lg space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <Label className="font-medium">Stop MA Offset (dollars)</Label>
                <p className="text-xs text-muted-foreground mt-1">Buffer below MA for stop placement</p>
              </div>
              <span className="font-mono text-sm">${localSettings.stopMaOffsetDollars.toFixed(2)}</span>
            </div>
            <Slider
              value={[localSettings.stopMaOffsetDollars]}
              onValueChange={([v]) => handleChange("stopMaOffsetDollars", v)}
              min={0}
              max={2}
              step={0.05}
              className="w-full"
            />
          </div>

          {/* 21 EMA Label */}
          <div className="p-3 border rounded-lg">
            <Label className="font-medium">21 EMA Stop Label</Label>
            <p className="text-xs text-muted-foreground mt-1 mb-2">The label shown for the 21 EMA stop suggestion</p>
            <Input
              value={localSettings.stop21Label}
              onChange={(e) => handleChange("stop21Label", e.target.value)}
              placeholder="e.g., 21 EMA"
              className="max-w-xs"
            />
          </div>

          {/* Qullaggie Stop Rules Section */}
          <div className="pt-4 border-t">
            <h4 className="text-sm font-semibold text-amber-400 mb-3">Qullaggie Stop Rules</h4>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Enforce ATR Stop Cap */}
              <div className="flex items-center justify-between p-3 border rounded-lg border-amber-500/30">
                <div>
                  <Label className="font-medium">Enforce ATR Stop Cap</Label>
                  <p className="text-xs text-muted-foreground mt-1">Warn if stop exceeds 1× ATR (Qullaggie rule)</p>
                </div>
                <Switch
                  checked={localSettings.enforceAtrStopCap}
                  onCheckedChange={(v) => handleChange("enforceAtrStopCap", v)}
                />
              </div>

              {/* Enforce ADR Stop Cap */}
              <div className="flex items-center justify-between p-3 border rounded-lg border-amber-500/30">
                <div>
                  <Label className="font-medium">Enforce ADR Stop Cap</Label>
                  <p className="text-xs text-muted-foreground mt-1">Warn if stop exceeds 1× ADR%</p>
                </div>
                <Switch
                  checked={localSettings.enforceAdrStopCap}
                  onCheckedChange={(v) => handleChange("enforceAdrStopCap", v)}
                />
              </div>
            </div>

            <p className="text-xs text-muted-foreground mt-3 px-3">
              Qullaggie rule: "Stop should not be wider than the ATR or ADR% of the stock." These warnings help avoid trades where risk/reward mechanics get out of whack.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Target / Take Profit Rules */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-cyan-400" />
            Take Profit / Target Rules
          </CardTitle>
          <CardDescription>Configure how profit target suggestions are generated</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Always include 8R */}
            <div className="flex items-center justify-between p-3 border rounded-lg">
              <div>
                <Label className="font-medium">Always Include 8R Target</Label>
                <p className="text-xs text-muted-foreground mt-1">Target = Entry + 8×(Entry - Stop)</p>
              </div>
              <Switch
                checked={localSettings.alwaysInclude8RTarget}
                onCheckedChange={(v) => handleChange("alwaysInclude8RTarget", v)}
              />
            </div>

            {/* Swing high targets */}
            <div className="flex items-center justify-between p-3 border rounded-lg">
              <div>
                <Label className="font-medium">Include Swing High Targets</Label>
                <p className="text-xs text-muted-foreground mt-1">Prior swing highs as TP levels</p>
              </div>
              <Switch
                checked={localSettings.includeSwingHighTargets}
                onCheckedChange={(v) => handleChange("includeSwingHighTargets", v)}
              />
            </div>

            {/* 52-week high */}
            <div className="flex items-center justify-between p-3 border rounded-lg">
              <div>
                <Label className="font-medium">Include 52-Week High</Label>
              </div>
              <Switch
                checked={localSettings.include52wTarget}
                onCheckedChange={(v) => handleChange("include52wTarget", v)}
              />
            </div>

            {/* Weekly high */}
            <div className="flex items-center justify-between p-3 border rounded-lg">
              <div>
                <Label className="font-medium">Include Weekly High</Label>
              </div>
              <Switch
                checked={localSettings.includeWeeklyTarget}
                onCheckedChange={(v) => handleChange("includeWeeklyTarget", v)}
              />
            </div>

            {/* 5-day high */}
            <div className="flex items-center justify-between p-3 border rounded-lg">
              <div>
                <Label className="font-medium">Include 5-Day High</Label>
              </div>
              <Switch
                checked={localSettings.include5DayTarget}
                onCheckedChange={(v) => handleChange("include5DayTarget", v)}
              />
            </div>

            {/* 8x ADR target */}
            <div className="flex items-center justify-between p-3 border rounded-lg">
              <div>
                <Label className="font-medium">Include 8× ADR Target</Label>
              </div>
              <Switch
                checked={localSettings.include8xAdrTarget}
                onCheckedChange={(v) => handleChange("include8xAdrTarget", v)}
              />
            </div>
          </div>

          {/* Swing high count */}
          <div className="p-3 border rounded-lg space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <Label className="font-medium">Max Swing High Targets</Label>
                <p className="text-xs text-muted-foreground mt-1">Number of nearest swing highs to include</p>
              </div>
              <span className="font-mono text-sm">{localSettings.swingHighTargetCount}</span>
            </div>
            <Slider
              value={[localSettings.swingHighTargetCount]}
              onValueChange={([v]) => handleChange("swingHighTargetCount", v)}
              min={0}
              max={10}
              step={1}
              className="w-full"
            />
          </div>

          {/* 8x ADR breakout only */}
          <div className="flex items-center justify-between p-3 border rounded-lg">
            <div>
              <Label className="font-medium">8× ADR Target: Breakouts Only</Label>
              <p className="text-xs text-muted-foreground mt-1">Only show 8× ADR for breakout setups, not pullbacks</p>
            </div>
            <Switch
              checked={localSettings.adr8TargetBreakoutOnly}
              onCheckedChange={(v) => handleChange("adr8TargetBreakoutOnly", v)}
            />
          </div>

          {/* Warn if no chart targets */}
          <div className="flex items-center justify-between p-3 border rounded-lg">
            <div>
              <Label className="font-medium">Warn When No Chart-Based Targets Exist</Label>
              <p className="text-xs text-muted-foreground mt-1">Show warning at/near ATH or when no swing highs above entry</p>
            </div>
            <Switch
              checked={localSettings.warnIfNoChartTargets}
              onCheckedChange={(v) => handleChange("warnIfNoChartTargets", v)}
            />
          </div>

          {/* Target Display / Filtering Section */}
          <div className="pt-4 border-t">
            <h4 className="text-sm font-semibold text-cyan-400 mb-3">Target Display & Filtering</h4>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Prioritize Chart Targets */}
              <div className="flex items-center justify-between p-3 border rounded-lg border-cyan-500/30">
                <div>
                  <Label className="font-medium">Prioritize Chart-Based Targets</Label>
                  <p className="text-xs text-muted-foreground mt-1">Show swing highs, 52W, etc. before R:R math targets</p>
                </div>
                <Switch
                  checked={localSettings.prioritizeChartTargets}
                  onCheckedChange={(v) => handleChange("prioritizeChartTargets", v)}
                />
              </div>

              {/* 8x ADR > 50 Target */}
              <div className="flex items-center justify-between p-3 border rounded-lg border-cyan-500/30">
                <div>
                  <Label className="font-medium">Include 8× ADR &gt; 50 SMA</Label>
                  <p className="text-xs text-muted-foreground mt-1">Profit-taking zone: 8× ADR above 50-day SMA</p>
                </div>
                <Switch
                  checked={localSettings.include8xAdrOver50Target}
                  onCheckedChange={(v) => handleChange("include8xAdrOver50Target", v)}
                />
              </div>
            </div>

            {/* Min R:R Threshold */}
            <div className="p-3 border rounded-lg border-cyan-500/30 space-y-2 mt-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="font-medium">Minimum R:R Threshold</Label>
                  <p className="text-xs text-muted-foreground mt-1">Only show targets at or above this R:R (hides small targets)</p>
                </div>
                <span className="font-mono text-sm">{localSettings.minRrThreshold}:1</span>
              </div>
              <Slider
                value={[localSettings.minRrThreshold]}
                onValueChange={([v]) => handleChange("minRrThreshold", v)}
                min={1}
                max={5}
                step={0.5}
                className="w-full"
              />
            </div>

            {/* Target Display Limit */}
            <div className="p-3 border rounded-lg border-cyan-500/30 space-y-2 mt-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="font-medium">Target Display Limit</Label>
                  <p className="text-xs text-muted-foreground mt-1">Max number of targets to show in overlay</p>
                </div>
                <span className="font-mono text-sm">{localSettings.targetDisplayLimit}</span>
              </div>
              <Slider
                value={[localSettings.targetDisplayLimit]}
                onValueChange={([v]) => handleChange("targetDisplayLimit", v)}
                min={3}
                max={15}
                step={1}
                className="w-full"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Risk Warnings Section */}
      <Card className="border-yellow-500/30">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-yellow-400" />
            Risk Warnings
          </CardTitle>
          <CardDescription>Configure when to warn about higher-risk setups</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 200 DSMA Warning */}
          <div className="flex items-center justify-between p-3 border rounded-lg border-yellow-500/30">
            <div>
              <Label className="font-medium">Warn Below 200 DSMA</Label>
              <p className="text-xs text-muted-foreground mt-1">Alert on longs trading below the 200-day SMA (higher risk)</p>
            </div>
            <Switch
              checked={localSettings.warn200DsmaBelow}
              onCheckedChange={(v) => handleChange("warn200DsmaBelow", v)}
            />
          </div>
          <p className="text-xs text-muted-foreground px-3">
            Long setups below the 200 DSMA have lower odds. A breakthrough could signal opportunity, but watch for pullback &amp; bounce confirmation.
          </p>
        </CardContent>
      </Card>

      {/* Qullaggie Position Management */}
      <Card className="border-amber-500/30">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-amber-400" />
            Qullaggie Position Management
          </CardTitle>
          <CardDescription>
            Configure Qullaggie's exit rules: partial profit taking and trailing stop on MA close
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Partial Profits */}
            <div className="flex items-center justify-between p-3 border rounded-lg border-amber-500/30">
              <div>
                <Label className="font-medium">Suggest Partial Profits</Label>
                <p className="text-xs text-muted-foreground mt-1">Remind to sell 1/3 to 1/2 after N days</p>
              </div>
              <Switch
                checked={localSettings.suggestPartialProfits}
                onCheckedChange={(v) => handleChange("suggestPartialProfits", v)}
              />
            </div>

            {/* Trail MA Close Stop */}
            <div className="flex items-center justify-between p-3 border rounded-lg border-amber-500/30">
              <div>
                <Label className="font-medium">Include Trail MA Close Stop</Label>
                <p className="text-xs text-muted-foreground mt-1">Exit on first close below MA (not intraday breach)</p>
              </div>
              <Switch
                checked={localSettings.includeTrailMaCloseStop}
                onCheckedChange={(v) => handleChange("includeTrailMaCloseStop", v)}
              />
            </div>
          </div>

          {/* Partial Profit Days */}
          <div className="p-3 border rounded-lg border-amber-500/30 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <Label className="font-medium">Partial Profit Days</Label>
                <p className="text-xs text-muted-foreground mt-1">Suggest partial profit after this many days (Qullaggie: 3-5 days)</p>
              </div>
              <span className="font-mono text-sm">{localSettings.partialProfitDays} days</span>
            </div>
            <Slider
              value={[localSettings.partialProfitDays]}
              onValueChange={([v]) => handleChange("partialProfitDays", v)}
              min={2}
              max={10}
              step={1}
              className="w-full"
            />
          </div>

          {/* Trail MA Period */}
          <div className="p-3 border rounded-lg border-amber-500/30">
            <Label className="font-medium">Trail MA Period</Label>
            <p className="text-xs text-muted-foreground mt-1 mb-2">Which MA to use for trailing stop (10=faster, 20=slower)</p>
            <Select
              value={String(localSettings.trailMaClosePeriod)}
              onValueChange={(v) => handleChange("trailMaClosePeriod", parseInt(v))}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10-day</SelectItem>
                <SelectItem value="20">20-day</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <p className="text-xs text-muted-foreground px-3">
            Qullaggie's exit strategy: "Sell 1/3 to 1/2 after 3-5 days, move stop to break-even. Trail remainder with 10 or 20-day MA. Exit on first CLOSE below MA."
          </p>
        </CardContent>
      </Card>

      {/* Extension / Risk Flags */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Zap className="w-5 h-5 text-amber-400" />
            Extension & Risk Flags
          </CardTitle>
          <CardDescription>Configure extended stock and profit-taking zone thresholds</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Extended threshold */}
          <div className="p-3 border rounded-lg space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <Label className="font-medium">Extended Threshold (× ADR above 50DSMA)</Label>
                <p className="text-xs text-muted-foreground mt-1">Stock is "extended" when this far above 50-day SMA</p>
              </div>
              <span className="font-mono text-sm">{localSettings.extendedThresholdAdr}× ADR</span>
            </div>
            <Slider
              value={[localSettings.extendedThresholdAdr]}
              onValueChange={([v]) => handleChange("extendedThresholdAdr", v)}
              min={2}
              max={10}
              step={0.5}
              className="w-full"
            />
          </div>

          {/* Profit-taking threshold */}
          <div className="p-3 border rounded-lg space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <Label className="font-medium">Profit-Taking Zone (× ADR)</Label>
                <p className="text-xs text-muted-foreground mt-1">Consider taking profits when gain exceeds this multiple of ADR</p>
              </div>
              <span className="font-mono text-sm">{localSettings.profitTakingThresholdAdr}× ADR</span>
            </div>
            <Slider
              value={[localSettings.profitTakingThresholdAdr]}
              onValueChange={([v]) => handleChange("profitTakingThresholdAdr", v)}
              min={3}
              max={15}
              step={0.5}
              className="w-full"
            />
          </div>

          {/* Show extended warning */}
          <div className="flex items-center justify-between p-3 border rounded-lg">
            <div>
              <Label className="font-medium">Always Show Extended Warning</Label>
              <p className="text-xs text-muted-foreground mt-1">Display warning in overlay when stock is extended</p>
            </div>
            <Switch
              checked={localSettings.showExtendedWarning}
              onCheckedChange={(v) => handleChange("showExtendedWarning", v)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Display / UX Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Settings className="w-5 h-5 text-blue-400" />
            Display / UX Settings
          </CardTitle>
          <CardDescription>Configure chart and overlay appearance for Trade Plan</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Chart price scale side */}
          <div className="flex items-center justify-between p-3 border rounded-lg">
            <div>
              <Label className="font-medium">Chart Price Scale Side</Label>
              <p className="text-xs text-muted-foreground mt-1">Where to display price labels on the chart</p>
            </div>
            <Select
              value={localSettings.chartPriceScaleSide}
              onValueChange={(v) => handleChange("chartPriceScaleSide", v as "left" | "right")}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="left">Left</SelectItem>
                <SelectItem value="right">Right</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Overlay resizable */}
          <div className="flex items-center justify-between p-3 border rounded-lg">
            <div>
              <Label className="font-medium">Overlay Resizable</Label>
              <p className="text-xs text-muted-foreground mt-1">Allow users to resize the Trade Plan overlay with constraints</p>
            </div>
            <Switch
              checked={localSettings.overlayResizable}
              onCheckedChange={(v) => handleChange("overlayResizable", v)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Bottom Save Bar (sticky) */}
      {hasChanges && (
        <div className="sticky bottom-4 flex items-center justify-end gap-2 p-3 bg-background/95 border rounded-lg shadow-lg">
          <Button variant="outline" onClick={handleCancel} disabled={updateMutation.isPending}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Save Trade Plan Rules
          </Button>
        </div>
      )}
    </div>
  );
}

function MarketConditionPanel() {
  const { toast } = useToast();
  const [settings, setSettings] = useState({
    pollIntervalMs: 60000,
    marketHoursPollIntervalMs: 60000,
    offHoursPollIntervalMs: 300000,
    enableStreaming: false,
    showRaiInHeader: true,
    autoStartPolling: true,
    maBoldThresholdPct: 0.5,
    clientThemesRefetchIntervalMs: 60000,
    clientTickersRefetchIntervalMs: 60000,
  });
  const [hasChanges, setHasChanges] = useState(false);

  // Fetch current settings
  const { data: currentSettings, isLoading } = useQuery<{
    pollIntervalMs?: number;
    marketHoursPollIntervalMs?: number;
    offHoursPollIntervalMs?: number;
    enableStreaming: boolean;
    showRaiInHeader: boolean;
    autoStartPolling: boolean;
    maBoldThresholdPct?: number;
    clientThemesRefetchIntervalMs?: number;
    clientTickersRefetchIntervalMs?: number;
  }>({
    queryKey: ["/api/market-condition/settings"],
  });

  // Fetch polling status
  const { data: status, refetch: refetchStatus } = useQuery<{
    isPolling: boolean;
    intervalMs: number;
    lastUpdate: string | null;
    tickerCount: number;
    themeCount: number;
    universeSize: number;
  }>({
    queryKey: ["/api/market-condition/status"],
    refetchInterval: 5000,
  });

  // Update settings mutation
  const updateMutation = useMutation({
    mutationFn: async (newSettings: Partial<typeof settings>) => {
      const res = await apiRequest("PUT", "/api/market-condition/settings", newSettings);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/market-condition/settings"] });
      queryClient.invalidateQueries({ queryKey: ["market-condition", "settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/market-condition/status"] });
      toast({ title: "Settings saved", description: "Market Condition settings updated" });
      setHasChanges(false);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to save", description: err.message, variant: "destructive" });
    },
  });

  // Start/stop polling mutations
  const startMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/market-condition/start");
      return res.json();
    },
    onSuccess: () => {
      refetchStatus();
      toast({ title: "Polling started" });
    },
  });

  const stopMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/market-condition/stop");
      return res.json();
    },
    onSuccess: () => {
      refetchStatus();
      toast({ title: "Polling stopped" });
    },
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/market-condition/refresh");
      return res.json();
    },
    onSuccess: () => {
      refetchStatus();
      toast({ title: "Refresh complete" });
    },
  });

  // Sync local state with fetched settings
  useEffect(() => {
    if (currentSettings) {
      setSettings((prev) => ({
        ...prev,
        pollIntervalMs: currentSettings.pollIntervalMs ?? currentSettings.marketHoursPollIntervalMs ?? 60000,
        marketHoursPollIntervalMs: currentSettings.marketHoursPollIntervalMs ?? currentSettings.pollIntervalMs ?? 60000,
        offHoursPollIntervalMs: currentSettings.offHoursPollIntervalMs ?? 300000,
        enableStreaming: currentSettings.enableStreaming ?? false,
        showRaiInHeader: currentSettings.showRaiInHeader ?? true,
        autoStartPolling: currentSettings.autoStartPolling ?? true,
        maBoldThresholdPct: currentSettings.maBoldThresholdPct ?? 0.5,
        clientThemesRefetchIntervalMs: currentSettings.clientThemesRefetchIntervalMs ?? 60000,
        clientTickersRefetchIntervalMs: currentSettings.clientTickersRefetchIntervalMs ?? 60000,
      }));
    }
  }, [currentSettings]);

  const handleChange = (key: keyof typeof settings, value: any) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const handleSave = () => {
    updateMutation.mutate(settings);
  };

  const handleCancel = () => {
    if (currentSettings) {
      setSettings(currentSettings);
    }
    setHasChanges(false);
  };

  const pollIntervalOptions = [
    { value: 10000, label: "10 seconds" },
    { value: 15000, label: "15 seconds" },
    { value: 20000, label: "20 seconds" },
    { value: 30000, label: "30 seconds" },
    { value: 60000, label: "1 minute" },
    { value: 120000, label: "2 minutes" },
    { value: 300000, label: "5 minutes" },
  ];
  const clientRefetchOptions = [
    { value: 15000, label: "15 seconds" },
    { value: 30000, label: "30 seconds" },
    { value: 60000, label: "1 minute" },
    { value: 120000, label: "2 minutes" },
    { value: 300000, label: "5 minutes" },
  ];

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Overview Card */}
      <Card className="bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border-cyan-500/30">
        <CardHeader>
          <div className="flex items-center gap-3">
            <Activity className="w-6 h-6 text-cyan-400" />
            <div>
              <CardTitle>Market Condition Terminal</CardTitle>
              <CardDescription>Capital narrative & risk engine settings</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0 text-sm text-muted-foreground space-y-1">
          <p><span className="font-medium text-foreground">Affects:</span> Market Condition page data, RAI (Risk Appetite Index), theme scores, and Scanner regime indicators.</p>
          <p><span className="font-medium text-foreground">How:</span> Polls Alpaca API for all 19 behavior clusters (~180 tickers) at the configured interval.</p>
          <p><span className="font-medium text-foreground">Scope:</span> Global data feed - all users see the same market condition data.</p>
        </CardContent>
      </Card>

      {/* Status Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <RefreshCw className="w-5 h-5" />
            Polling Status
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-3 border rounded-lg">
              <Label className="text-xs text-muted-foreground">Status</Label>
              <p className={`font-medium ${status?.isPolling ? "text-green-400" : "text-yellow-400"}`}>
                {status?.isPolling ? "Active" : "Stopped"}
              </p>
            </div>
            <div className="p-3 border rounded-lg">
              <Label className="text-xs text-muted-foreground">Interval</Label>
              <p className="font-medium">{status?.intervalMs ? `${status.intervalMs / 1000}s` : "—"}</p>
            </div>
            <div className="p-3 border rounded-lg">
              <Label className="text-xs text-muted-foreground">Tickers</Label>
              <p className="font-medium">{status?.tickerCount || 0} / {status?.universeSize || 0}</p>
            </div>
            <div className="p-3 border rounded-lg">
              <Label className="text-xs text-muted-foreground">Themes</Label>
              <p className="font-medium">{status?.themeCount || 0}</p>
            </div>
          </div>

          {status?.lastUpdate && (
            <p className="text-xs text-muted-foreground">
              Last update: {new Date(status.lastUpdate).toLocaleTimeString()}
            </p>
          )}

          <div className="flex gap-2">
            {status?.isPolling ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => stopMutation.mutate()}
                disabled={stopMutation.isPending}
              >
                Stop Polling
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => startMutation.mutate()}
                disabled={startMutation.isPending}
              >
                Start Polling
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
              Force Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Settings Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Settings className="w-5 h-5" />
            Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Market Hours Poll Interval */}
          <div className="flex items-center justify-between p-3 border rounded-lg">
            <div>
              <Label className="font-medium">Market Hours Poll Interval</Label>
              <p className="text-xs text-muted-foreground mt-1">How often to fetch market data during market hours (9:30–16:00 ET)</p>
            </div>
            <Select
              value={String(settings.marketHoursPollIntervalMs)}
              onValueChange={(v) => handleChange("marketHoursPollIntervalMs", parseInt(v))}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pollIntervalOptions.map((opt) => (
                  <SelectItem key={opt.value} value={String(opt.value)}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Off Hours Poll Interval */}
          <div className="flex items-center justify-between p-3 border rounded-lg">
            <div>
              <Label className="font-medium">Off Hours Poll Interval</Label>
              <p className="text-xs text-muted-foreground mt-1">How often to fetch when market is closed (pre/post/after hours)</p>
            </div>
            <Select
              value={String(settings.offHoursPollIntervalMs)}
              onValueChange={(v) => handleChange("offHoursPollIntervalMs", parseInt(v))}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pollIntervalOptions.map((opt) => (
                  <SelectItem key={opt.value} value={String(opt.value)}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* MA Highlight Threshold */}
          <div className="flex items-center justify-between p-3 border rounded-lg">
            <div>
              <Label className="font-medium">MA Highlight Threshold (%)</Label>
              <p className="text-xs text-muted-foreground mt-1">White box around % when price is within this % of the moving average (ticker table)</p>
            </div>
            <Input
              type="number"
              min={0}
              max={5}
              step={0.1}
              value={settings.maBoldThresholdPct}
              onChange={(e) => handleChange("maBoldThresholdPct", parseFloat(e.target.value) || 0.5)}
              className="w-24"
            />
          </div>

          {/* Client Themes Refetch */}
          <div className="flex items-center justify-between p-3 border rounded-lg">
            <div>
              <Label className="font-medium">Client Themes Refetch</Label>
              <p className="text-xs text-muted-foreground mt-1">How often the client refetches theme list (Market Condition page)</p>
            </div>
            <Select
              value={String(settings.clientThemesRefetchIntervalMs)}
              onValueChange={(v) => handleChange("clientThemesRefetchIntervalMs", parseInt(v))}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {clientRefetchOptions.map((opt) => (
                  <SelectItem key={opt.value} value={String(opt.value)}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Client Tickers Refetch */}
          <div className="flex items-center justify-between p-3 border rounded-lg">
            <div>
              <Label className="font-medium">Client Tickers Refetch</Label>
              <p className="text-xs text-muted-foreground mt-1">How often the client refetches ticker members when viewing a theme</p>
            </div>
            <Select
              value={String(settings.clientTickersRefetchIntervalMs)}
              onValueChange={(v) => handleChange("clientTickersRefetchIntervalMs", parseInt(v))}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {clientRefetchOptions.map((opt) => (
                  <SelectItem key={opt.value} value={String(opt.value)}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Auto Start */}
          <div className="flex items-center justify-between p-3 border rounded-lg">
            <div>
              <Label className="font-medium">Auto-Start Polling</Label>
              <p className="text-xs text-muted-foreground mt-1">Start polling automatically when server starts</p>
            </div>
            <Switch
              checked={settings.autoStartPolling}
              onCheckedChange={(v) => handleChange("autoStartPolling", v)}
            />
          </div>

          {/* Show RAI in Header */}
          <div className="flex items-center justify-between p-3 border rounded-lg">
            <div>
              <Label className="font-medium">Show RAI in Header</Label>
              <p className="text-xs text-muted-foreground mt-1">Display Risk Appetite Index in the Market Condition header bar</p>
            </div>
            <Switch
              checked={settings.showRaiInHeader}
              onCheckedChange={(v) => handleChange("showRaiInHeader", v)}
            />
          </div>

          {/* Enable Streaming (future) */}
          <div className="flex items-center justify-between p-3 border rounded-lg opacity-50">
            <div>
              <Label className="font-medium">Enable Leader Streaming</Label>
              <p className="text-xs text-muted-foreground mt-1">Stream real-time updates for leader tickers (coming soon)</p>
            </div>
            <Switch
              checked={settings.enableStreaming}
              onCheckedChange={(v) => handleChange("enableStreaming", v)}
              disabled
            />
          </div>
        </CardContent>
      </Card>

      {/* Save Bar */}
      {hasChanges && (
        <div className="sticky bottom-4 flex items-center justify-end gap-2 p-3 bg-background/95 border rounded-lg shadow-lg">
          <Button variant="outline" onClick={handleCancel} disabled={updateMutation.isPending}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Save Settings
          </Button>
        </div>
      )}
    </div>
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
  const [tnnSubTab, setTnnSubTab] = useState("discipline");
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

  const { data: scoreRules } = useQuery<ThoughtScoreRule[]>({
    queryKey: ["/api/bigidea/score-rules"],
    enabled: !!userInfo?.isAdmin,
  });

  const { data: selectionWeights } = useQuery<ThoughtSelectionWeight[]>({
    queryKey: ["/api/bigidea/selection-weights"],
    enabled: !!userInfo?.isAdmin,
  });

  const { data: scoreStats } = useQuery<{
    thoughts: { total: number; scored: number; totalPoints: number };
    sessions: { allTime: number; today: number; thisWeek: number };
    ratings: { allTime: number; today: number; thisWeek: number };
  }>({
    queryKey: ["/api/bigidea/thought-scores/stats"],
    enabled: !!userInfo?.isAdmin,
  });

  const updateScoreRuleMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: number; updates: Partial<ThoughtScoreRule> }) => {
      const res = await apiRequest("PUT", `/api/bigidea/score-rules/${id}`, updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bigidea/score-rules"] });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update rule", description: err.message, variant: "destructive" });
    },
  });

  const updateSelectionWeightMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: number; updates: Partial<ThoughtSelectionWeight> }) => {
      const res = await apiRequest("PUT", `/api/bigidea/selection-weights/${id}`, updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bigidea/selection-weights"] });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update weight", description: err.message, variant: "destructive" });
    },
  });

  const backfillMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/bigidea/thought-scores/backfill");
      return res.json();
    },
    onSuccess: (data: { stats: { ratingsProcessed: number; sessionsProcessed: number; thoughtsScored: number } }) => {
      toast({ title: "Backfill complete", description: `Processed ${data.stats.ratingsProcessed} ratings, ${data.stats.sessionsProcessed} sessions, scored ${data.stats.thoughtsScored} thoughts` });
      queryClient.invalidateQueries({ queryKey: ["/api/bigidea/thought-scores/stats"] });
    },
    onError: (err: Error) => {
      toast({ title: "Backfill failed", description: err.message, variant: "destructive" });
    },
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
            <CopyScreenButton />
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
          <Button onClick={() => navigate("/sentinel/setup-library")} variant="outline" data-testid="button-setup-library">
            <BookOpen className="w-4 h-4 mr-2" />
            Setup Library
          </Button>
        </div>

        <div
          className="mb-6 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground space-y-1"
          data-testid="help-admin-overview"
        >
          <p><span className="font-medium text-foreground">What this page does:</span> controls global AI tuning (TNN + Big Idea scoring/optimizer), plus per-user UI appearance and user utilities.</p>
          <p><span className="font-medium text-foreground">Scope:</span> most TNN / scoring / optimizer settings affect <span className="font-medium">all users</span>; <span className="font-medium">Workspace colors</span> sets Start Here link-lane colors for everyone; System Settings affects <span className="font-medium">your account’s UI theme</span>.</p>
          <p><span className="font-medium text-foreground">Safety:</span> these do not “set price levels” — they tune how the system scores, selects, and displays outputs.</p>
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
            <TabsTrigger value="query-optimizer" className="gap-2" data-testid="tab-query-optimizer">
              <Activity className="w-4 h-4" />
              Query Optimizer
            </TabsTrigger>
            <TabsTrigger value="ask-ivy-rules" className="gap-2" data-testid="tab-ask-ivy-rules">
              <Lightbulb className="w-4 h-4" />
              Trade Plan Rules
            </TabsTrigger>
            <TabsTrigger value="market-condition" className="gap-2" data-testid="tab-market-condition">
              <Activity className="w-4 h-4" />
              Market Condition
            </TabsTrigger>
            <TabsTrigger value="workspace-colors" className="gap-2" data-testid="tab-workspace-colors">
              <LayoutGrid className="w-4 h-4" />
              Workspace colors
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
                  <CardContent className="pt-0 text-sm text-muted-foreground space-y-1" data-testid="help-tnn-overview">
                    <p><span className="font-medium text-foreground">Affects:</span> how strongly different rule categories and setup types influence scoring/feedback loops.</p>
                    <p><span className="font-medium text-foreground">How:</span> you set baselines; AI can optionally auto-adjust within limits; you approve/reject AI suggestions.</p>
                    <p><span className="font-medium text-foreground">Scope:</span> global (applies across users and scans).</p>
                  </CardContent>
                </Card>

                <Tabs value={tnnSubTab} onValueChange={setTnnSubTab}>
                  <TabsList>
                    <TabsTrigger value="discipline" className="gap-2" data-testid="tab-tnn-discipline">
                      <TrendingUp className="w-4 h-4" />
                      Discipline
                    </TabsTrigger>
                    <TabsTrigger value="ai-scoring" className="gap-2" data-testid="tab-tnn-ai-scoring">
                      <Sparkles className="w-4 h-4" />
                      AI Score Weighting
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="discipline">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="lg:col-span-2 space-y-4">
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-lg flex items-center gap-2" data-testid="text-discipline-title">
                          <TrendingUp className="w-5 h-5" />
                          Discipline Factors ({disciplineFactors.length})
                        </CardTitle>
                        <CardDescription>
                          <div className="space-y-1">
                            <p>Rule category weights for process evaluation (how “important” each discipline bucket is).</p>
                            <p><span className="font-medium text-foreground">Affects:</span> trade/idea evaluation emphasis and learning attribution.</p>
                            <p><span className="font-medium text-foreground">How:</span> Base Weight is your baseline; AI Weight is what the system currently uses; Auto lets AI adjust within limits.</p>
                          </div>
                        </CardDescription>
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
                        <CardDescription>
                          <div className="space-y-1">
                            <p>Weights for different trade setup patterns (e.g., breakout vs pullback).</p>
                            <p><span className="font-medium text-foreground">Affects:</span> how the system prioritizes outcomes by setup type when learning.</p>
                            <p><span className="font-medium text-foreground">How:</span> same Base vs AI Weight concept as Discipline Factors.</p>
                          </div>
                        </CardDescription>
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
                        <CardDescription data-testid="text-modifiers-desc">
                          <div className="space-y-1">
                            <p>Weight adjustments when setup types meet specific market conditions (regime-aware tuning).</p>
                            <p><span className="font-medium text-foreground">Affects:</span> which setups are favored in choppy / risk-off / trending conditions.</p>
                            <p><span className="font-medium text-foreground">How:</span> modifier adds +/- points to a setup factor when the condition is active.</p>
                          </div>
                        </CardDescription>
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
                        <CardDescription data-testid="text-suggestions-desc">
                          <div className="space-y-1">
                            <p>Pending weight adjustment proposals generated from observed performance.</p>
                            <p><span className="font-medium text-foreground">Affects:</span> whether AI can change weights (only approved suggestions become active).</p>
                            <p><span className="font-medium text-foreground">How:</span> approve = apply now; reject = discard; “Run AI Analysis” generates new candidates.</p>
                          </div>
                        </CardDescription>
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
                        <CardDescription>
                          <div className="space-y-1">
                            <p>Audit log of tuning changes (who changed what and when).</p>
                            <p><span className="font-medium text-foreground">Affects:</span> nothing directly — this is for traceability.</p>
                          </div>
                        </CardDescription>
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
                  </TabsContent>

                  <TabsContent value="ai-scoring" data-testid="content-ai-scoring">
                    <div className="space-y-6">
                      {scoreStats && (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="score-stats-grid">
                          <Card>
                            <CardContent className="p-4">
                              <div className="text-xs text-muted-foreground mb-1">Scored Thoughts</div>
                              <div className="text-2xl font-bold" data-testid="stat-scored-thoughts">{scoreStats.thoughts.scored} <span className="text-sm font-normal text-muted-foreground">/ {scoreStats.thoughts.total}</span></div>
                              <div className="text-xs text-muted-foreground mt-1">{scoreStats.thoughts.totalPoints} total pts</div>
                            </CardContent>
                          </Card>
                          <Card>
                            <CardContent className="p-4">
                              <div className="text-xs text-muted-foreground mb-1">Scans Today</div>
                              <div className="text-2xl font-bold" data-testid="stat-scans-today">{scoreStats.sessions.today}</div>
                              <div className="text-xs text-muted-foreground mt-1">{scoreStats.sessions.thisWeek} this week</div>
                            </CardContent>
                          </Card>
                          <Card>
                            <CardContent className="p-4">
                              <div className="text-xs text-muted-foreground mb-1">Ratings Today</div>
                              <div className="text-2xl font-bold" data-testid="stat-ratings-today">{scoreStats.ratings.today}</div>
                              <div className="text-xs text-muted-foreground mt-1">{scoreStats.ratings.thisWeek} this week</div>
                            </CardContent>
                          </Card>
                          <Card>
                            <CardContent className="p-4">
                              <div className="text-xs text-muted-foreground mb-1">All Time Events</div>
                              <div className="text-2xl font-bold" data-testid="stat-all-time">{scoreStats.sessions.allTime + scoreStats.ratings.allTime}</div>
                              <div className="text-xs text-muted-foreground mt-1">{scoreStats.sessions.allTime} scans, {scoreStats.ratings.allTime} ratings</div>
                            </CardContent>
                          </Card>
                        </div>
                      )}
                      <Card>
                        <CardHeader className="pb-3">
                          <CardTitle className="text-lg flex items-center gap-2" data-testid="text-scoring-rules-title">
                            <TrendingUp className="w-5 h-5" />
                            Thought Scoring Rules
                          </CardTitle>
                          <CardDescription>
                            <div className="space-y-1">
                              <p>Configure how thoughts earn or lose score points.</p>
                              <p><span className="font-medium text-foreground">Affects:</span> Big Idea scan scoring + what gets rewarded by feedback (ratings/watchlist).</p>
                              <p><span className="font-medium text-foreground">How:</span> enable/disable rules and set point values; higher points = stronger influence.</p>
                            </div>
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-3">
                            {!scoreRules ? (
                              <div className="flex items-center justify-center py-8">
                                <Loader2 className="w-6 h-6 animate-spin" />
                              </div>
                            ) : scoreRules.map(rule => (
                              <div key={rule.id} className="flex items-center justify-between p-3 border rounded-lg gap-3" data-testid={`score-rule-${rule.ruleKey}`}>
                                <div className="flex items-center gap-3 flex-1 min-w-0">
                                  <Switch
                                    checked={rule.enabled}
                                    onCheckedChange={(checked) => updateScoreRuleMutation.mutate({ id: rule.id, updates: { enabled: checked } })}
                                    data-testid={`switch-rule-${rule.ruleKey}`}
                                  />
                                  <div className="min-w-0">
                                    <div className="font-medium text-sm" data-testid={`text-rule-label-${rule.ruleKey}`}>{rule.label}</div>
                                    {rule.description && <div className="text-xs text-muted-foreground truncate">{rule.description}</div>}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  <Input
                                    type="number"
                                    value={rule.scoreValue}
                                    onChange={(e) => {
                                      const val = parseInt(e.target.value);
                                      if (!isNaN(val)) updateScoreRuleMutation.mutate({ id: rule.id, updates: { scoreValue: val } });
                                    }}
                                    className="w-20 text-center font-bold"
                                    data-testid={`input-rule-value-${rule.ruleKey}`}
                                  />
                                  <span className="text-xs text-muted-foreground">pts</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>

                      <Card>
                        <CardHeader className="pb-3">
                          <CardTitle className="text-lg flex items-center gap-2" data-testid="text-selection-weights-title">
                            <Sparkles className="w-5 h-5 text-purple-400" />
                            AI Thought Selection Weights
                          </CardTitle>
                          <CardDescription>
                            <div className="space-y-1">
                              <p>How the AI chooses thoughts when generating ideas. Percentages should sum to 100%.</p>
                              <p><span className="font-medium text-foreground">Affects:</span> which thoughts make it into a scan and how diverse/strict results are.</p>
                              <p><span className="font-medium text-foreground">How:</span> enable strategies and allocate % weight; some strategies have extra settings (e.g., top-N).</p>
                            </div>
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-3">
                            {!selectionWeights ? (
                              <div className="flex items-center justify-center py-8">
                                <Loader2 className="w-6 h-6 animate-spin" />
                              </div>
                            ) : (
                              <>
                                {selectionWeights.map(weight => (
                                  <div key={weight.id} className="flex items-center justify-between p-3 border rounded-lg gap-3" data-testid={`selection-weight-${weight.strategyKey}`}>
                                    <div className="flex items-center gap-3 flex-1 min-w-0">
                                      <Switch
                                        checked={weight.enabled}
                                        onCheckedChange={(checked) => updateSelectionWeightMutation.mutate({ id: weight.id, updates: { enabled: checked } })}
                                        data-testid={`switch-weight-${weight.strategyKey}`}
                                      />
                                      <div className="min-w-0">
                                        <div className="font-medium text-sm" data-testid={`text-weight-label-${weight.strategyKey}`}>{weight.label}</div>
                                        {weight.description && <div className="text-xs text-muted-foreground truncate">{weight.description}</div>}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2 flex-shrink-0">
                                      <Input
                                        type="number"
                                        value={weight.weightPercent}
                                        min={0}
                                        max={100}
                                        onChange={(e) => {
                                          const val = parseInt(e.target.value);
                                          if (!isNaN(val) && val >= 0 && val <= 100) updateSelectionWeightMutation.mutate({ id: weight.id, updates: { weightPercent: val } });
                                        }}
                                        className="w-20 text-center font-bold"
                                        data-testid={`input-weight-percent-${weight.strategyKey}`}
                                      />
                                      <span className="text-xs text-muted-foreground">%</span>
                                      {weight.strategyKey === "random_top_n" && (
                                        <div className="flex items-center gap-1 ml-2">
                                          <span className="text-xs text-muted-foreground">N:</span>
                                          <Input
                                            type="number"
                                            value={weight.configN ?? 3}
                                            min={1}
                                            max={20}
                                            onChange={(e) => {
                                              const val = parseInt(e.target.value);
                                              if (!isNaN(val) && val >= 1) updateSelectionWeightMutation.mutate({ id: weight.id, updates: { configN: val } });
                                            }}
                                            className="w-16 text-center"
                                            data-testid={`input-weight-config-n-${weight.strategyKey}`}
                                          />
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                ))}
                                {(() => {
                                  const total = selectionWeights.filter(w => w.enabled).reduce((sum, w) => sum + w.weightPercent, 0);
                                  return (
                                    <div className={`text-sm text-right font-medium ${total === 100 ? 'text-rs-green' : 'text-rs-amber'}`} data-testid="text-weight-total">
                                      Total: {total}% {total !== 100 && "(should be 100%)"}
                                    </div>
                                  );
                                })()}
                              </>
                            )}
                          </div>
                        </CardContent>
                      </Card>

                      <Card>
                        <CardContent className="pt-4">
                          <div className="flex items-center justify-between gap-4 flex-wrap">
                            <div>
                              <p className="text-rs-normal font-medium">Retroactive Backfill</p>
                              <p className="text-rs-small text-muted-foreground">Apply current scoring rules to all existing chart ratings and scan sessions. Scores are additive — run once after initial setup.</p>
                              <p className="text-xs text-muted-foreground mt-1"><span className="font-medium text-foreground">Note:</span> this is a bulk job; expect it to take time on large histories.</p>
                            </div>
                            <Button
                              variant="outline"
                              data-testid="button-backfill-scores"
                              disabled={backfillMutation.isPending}
                              onClick={() => backfillMutation.mutate()}
                            >
                              {backfillMutation.isPending ? "Running..." : "Backfill Scores"}
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  </TabsContent>
                </Tabs>
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
                <CardDescription data-testid="text-labels-desc">
                  <div className="space-y-1">
                    <p>Create and manage trade labels (tags) used across trades, watchlists, and analysis.</p>
                    <p><span className="font-medium text-foreground">Affects:</span> organization and filtering — not scan results.</p>
                  </div>
                </CardDescription>
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

          <TabsContent value="query-optimizer" data-testid="content-query-optimizer">
            <QueryOptimizerPanel />
          </TabsContent>

          <TabsContent value="ask-ivy-rules" data-testid="content-ask-ivy-rules">
            <AskIvyRulesPanel />
          </TabsContent>
          <TabsContent value="market-condition" data-testid="content-market-condition">
            <MarketConditionPanel />
          </TabsContent>

          <TabsContent value="workspace-colors" data-testid="content-workspace-colors">
            <WorkspacePaletteAdminPanel />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
