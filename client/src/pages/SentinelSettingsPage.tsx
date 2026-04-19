import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useSystemSettings } from "@/context/SystemSettingsContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SentinelHeader } from "@/components/SentinelHeader";
import { Settings, DollarSign, Percent, TrendingUp, Shield, Calculator, Save, Loader2, KeyRound } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useSentinelAuth } from "@/context/SentinelAuthContext";

interface UserSettings {
  accountSize: number | null;
  maxAccountRiskPercent: number | null;
  avgPositionSize: number | null;
  riskProfileCompleted: boolean | null;
  tier: string;
}

interface UsageInfo {
  canUse: boolean;
  used: number;
  limit: number;
  tier: string;
}

export default function SentinelSettingsPage() {
  const { toast } = useToast();
  const { refreshUser } = useSentinelAuth();
  const { systemSettings } = useSystemSettings();
  
  const [accountSize, setAccountSize] = useState("");
  const [maxRiskPercent, setMaxRiskPercent] = useState("");
  const [avgPositionSize, setAvgPositionSize] = useState("");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  
  // Fetch user settings (uses default queryFn from queryClient)
  const { data: settings, isLoading } = useQuery<UserSettings>({
    queryKey: ["/api/sentinel/user-settings"],
  });

  // Fetch Ivy eval usage (uses default queryFn from queryClient)
  const { data: usage } = useQuery<UsageInfo>({
    queryKey: ["/api/sentinel/ivy-eval/usage"],
  });

  // Load current values
  useEffect(() => {
    if (settings) {
      if (settings.accountSize) setAccountSize(settings.accountSize.toString());
      if (settings.maxAccountRiskPercent) setMaxRiskPercent(settings.maxAccountRiskPercent.toString());
      if (settings.avgPositionSize) setAvgPositionSize(settings.avgPositionSize.toString());
    }
  }, [settings]);

  // Save mutation
  const changePasswordMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/change-password", {
        currentPassword: currentPassword,
        newPassword: newPassword,
      });
      return res.json();
    },
    onSuccess: async () => {
      toast({
        title: "Password updated",
        description: "Your session was refreshed for security.",
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      await refreshUser();
    },
    onError: (error: Error) => {
      let msg = error.message || "Failed to change password";
      const m = /^(\d+):\s*(\{.*\})\s*$/s.exec(msg);
      if (m?.[2]) {
        try {
          const j = JSON.parse(m[2]) as { error?: string };
          if (j.error) msg = j.error;
        } catch {
          /* keep */
        }
      }
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (data: Partial<UserSettings>) => {
      const res = await apiRequest("PATCH", "/api/sentinel/user-settings", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Settings saved", description: "Your risk profile has been updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/user-settings"] });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to save settings", variant: "destructive" });
    },
  });

  const handleSave = () => {
    const data: any = { riskProfileCompleted: true };
    if (accountSize) data.accountSize = parseFloat(accountSize);
    if (maxRiskPercent) data.maxAccountRiskPercent = parseFloat(maxRiskPercent);
    if (avgPositionSize) data.avgPositionSize = parseFloat(avgPositionSize);
    saveMutation.mutate(data);
  };

  // Calculate preview values
  const account = parseFloat(accountSize) || 100000;
  const riskPct = parseFloat(maxRiskPercent) || 2;
  const maxDollarRisk = account * (riskPct / 100);
  const position = parseFloat(avgPositionSize) || account * 0.05; // default 5% of account

  // Example trade preview
  const exampleEntry = 50;
  const exampleStopDistance = exampleEntry * 0.03; // 3% stop
  const sharesFromRisk = Math.floor(maxDollarRisk / exampleStopDistance);
  const sharesFromPosition = Math.floor(position / exampleEntry);

  // Get theme colors from system settings
  const panelBg = systemSettings?.overlayColor || "#1e3a5f";
  const panelOpacity = (systemSettings?.overlayTransparency ?? 75) / 100;
  const borderColor = systemSettings?.secondaryOverlayColor || "#e8e8e8";
  const textColor = systemSettings?.textColorNormal || "#ffffff";

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <SentinelHeader />
        <div className="flex items-center justify-center h-[80vh]">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SentinelHeader />
      
      <div className="container max-w-4xl mx-auto py-8 px-4">
        <div className="flex items-center gap-3 mb-6">
          <Settings className="w-8 h-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">User Settings</h1>
            <p className="text-muted-foreground">Configure your risk profile for personalized trade analysis</p>
          </div>
        </div>

        <div className="grid gap-6">
          {/* Subscription Tier Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5" />
                Subscription Tier
              </CardTitle>
              <CardDescription>Your current plan and Ivy Stock Eval usage</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Badge variant={settings?.tier === 'admin' ? 'default' : settings?.tier === 'pro' ? 'default' : 'secondary'} className="text-sm">
                    {(settings?.tier || 'free').toUpperCase()}
                  </Badge>
                  {settings?.riskProfileCompleted && (
                    <Badge variant="outline" className="text-green-500 border-green-500">
                      Risk Profile Complete
                    </Badge>
                  )}
                </div>
                {usage && (
                  <div className="text-right">
                    <p className="text-sm text-muted-foreground">Ivy Evals this month</p>
                    <p className="text-lg font-semibold">
                      {usage.used} / {usage.limit === -1 ? '∞' : usage.limit}
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="w-5 h-5" />
                Security
              </CardTitle>
              <CardDescription>Change the password you use to sign in</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="currentPassword">Current password</Label>
                <Input
                  id="currentPassword"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="newPassword">New password</Label>
                <Input
                  id="newPassword"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  minLength={8}
                />
                <p className="text-xs text-muted-foreground">At least 8 characters</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmNewPassword">Confirm new password</Label>
                <Input
                  id="confirmNewPassword"
                  type="password"
                  autoComplete="new-password"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  minLength={8}
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                disabled={
                  changePasswordMutation.isPending ||
                  !currentPassword ||
                  newPassword.length < 8 ||
                  newPassword !== confirmNewPassword
                }
                onClick={() => {
                  if (newPassword !== confirmNewPassword) {
                    toast({ title: "Passwords do not match", variant: "destructive" });
                    return;
                  }
                  changePasswordMutation.mutate();
                }}
              >
                {changePasswordMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Updating…
                  </>
                ) : (
                  "Update password"
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Risk Profile Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calculator className="w-5 h-5" />
                Risk Profile
              </CardTitle>
              <CardDescription>
                These settings help Ivy provide personalized risk calculations for your trades
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Account Size */}
              <div className="space-y-2">
                <Label htmlFor="accountSize" className="flex items-center gap-2">
                  <DollarSign className="w-4 h-4" />
                  Account Size
                </Label>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">$</span>
                  <Input
                    id="accountSize"
                    type="number"
                    value={accountSize}
                    onChange={(e) => setAccountSize(e.target.value)}
                    placeholder="100000"
                    className="max-w-xs"
                  />
                </div>
                <p className="text-xs text-muted-foreground">Total trading capital available</p>
              </div>

              {/* Max Risk % */}
              <div className="space-y-2">
                <Label htmlFor="maxRisk" className="flex items-center gap-2">
                  <Percent className="w-4 h-4" />
                  Max Account Risk %
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="maxRisk"
                    type="number"
                    step="0.1"
                    min="0.1"
                    max="10"
                    value={maxRiskPercent}
                    onChange={(e) => setMaxRiskPercent(e.target.value)}
                    placeholder="2"
                    className="max-w-xs"
                  />
                  <span className="text-muted-foreground">%</span>
                </div>
                <p className="text-xs text-muted-foreground">Maximum % of account to risk per trade (typically 1-2%)</p>
              </div>

              {/* Average Position Size */}
              <div className="space-y-2">
                <Label htmlFor="avgPosition" className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" />
                  Average Position Size (Optional)
                </Label>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">$</span>
                  <Input
                    id="avgPosition"
                    type="number"
                    value={avgPositionSize}
                    onChange={(e) => setAvgPositionSize(e.target.value)}
                    placeholder="5000"
                    className="max-w-xs"
                  />
                </div>
                <p className="text-xs text-muted-foreground">Typical dollar amount per position (leave blank to calculate from risk)</p>
              </div>

              <Button onClick={handleSave} disabled={saveMutation.isPending} className="w-full">
                {saveMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    Save Risk Profile
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Preview Card */}
          <Card style={{ 
            backgroundColor: `${panelBg}${Math.round(panelOpacity * 255).toString(16).padStart(2, '0')}`,
            borderColor: borderColor,
          }}>
            <CardHeader>
              <CardTitle style={{ color: textColor }} className="flex items-center gap-2">
                <Calculator className="w-5 h-5" />
                Risk Calculation Preview
              </CardTitle>
              <CardDescription style={{ color: `${textColor}99` }}>
                Example calculation for a $50 stock with 3% stop
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <p className="text-xs" style={{ color: `${textColor}99` }}>Max Dollar Risk</p>
                  <p className="text-lg font-mono font-semibold" style={{ color: textColor }}>
                    ${maxDollarRisk.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs" style={{ color: `${textColor}99` }}>Shares (by risk)</p>
                  <p className="text-lg font-mono font-semibold" style={{ color: textColor }}>
                    {sharesFromRisk.toLocaleString()}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs" style={{ color: `${textColor}99` }}>Position Value (by risk)</p>
                  <p className="text-lg font-mono font-semibold" style={{ color: textColor }}>
                    ${(sharesFromRisk * exampleEntry).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs" style={{ color: `${textColor}99` }}>Shares (by avg position)</p>
                  <p className="text-lg font-mono font-semibold" style={{ color: textColor }}>
                    {sharesFromPosition.toLocaleString()}
                  </p>
                </div>
              </div>
              <div className="mt-4 p-3 rounded bg-black/20">
                <p className="text-xs" style={{ color: `${textColor}99` }}>
                  On a $50 stock with a 3% stop ($1.50 risk per share):
                </p>
                <ul className="text-xs mt-2 space-y-1" style={{ color: `${textColor}cc` }}>
                  <li>• Risk-based: {sharesFromRisk} shares = ${(sharesFromRisk * 1.5).toFixed(0)} max loss</li>
                  <li>• Position-based: {sharesFromPosition} shares = ${(sharesFromPosition * 1.5).toFixed(0)} max loss</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
