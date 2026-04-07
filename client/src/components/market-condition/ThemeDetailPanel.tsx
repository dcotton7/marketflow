// Theme Detail Panel - Shows detailed metrics for a selected theme
import { useState } from "react";
import { ThemeRow, ReasonCode, ThemeTier, TickerRow, ETFProxy, TrendState } from "@/data/mockThemeData";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertBuilderDialog } from "@/components/alerts/AlertBuilderDialog";
import { useLocation } from "wouter";
import {
  TrendingUp,
  TrendingDown,
  Activity,
  Users,
  Zap,
  Target,
  AlertTriangle,
  ArrowUpDown,
  PieChart,
  Info,
  Layers,
  CircleDot,
  ExternalLink,
  Bell,
} from "lucide-react";

// ETF Proxy type colors
const ETF_TYPE_COLORS: Record<string, string> = {
  direct: "bg-green-500/20 text-green-400 border-green-500/30",
  adjacent: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  macro: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  hedge: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
};

// Trend state colors
const TREND_STATE_CONFIG: Record<TrendState, { color: string; bg: string; label: string }> = {
  Bull: { color: "text-green-400", bg: "bg-green-500/20 border-green-500/30", label: "Bullish" },
  Transition: { color: "text-yellow-400", bg: "bg-yellow-500/20 border-yellow-500/30", label: "In Transition" },
  Bear: { color: "text-red-400", bg: "bg-red-500/20 border-red-500/30", label: "Bearish" },
};

interface AccDistStats {
  total: number;
  accumulation3Plus: number;
  distribution3Plus: number;
  accumulationPct: number;
  distributionPct: number;
}

interface ThemeDetailPanelProps {
  theme: ThemeRow | null;
  members?: TickerRow[];
  totalThemes?: number;
  accDistStats?: AccDistStats;
  highlightedTicker?: string | null;
  timeSlice?: string;
}

const REASON_CODE_LABELS: Record<ReasonCode, { label: string; color: string; description: string }> = {
  BREADTH_STRONG: { label: "Strong Breadth", color: "bg-green-500/20 text-green-400 border-green-500/30", description: "70%+ of theme members are green" },
  BREADTH_WEAK: { label: "Weak Breadth", color: "bg-red-500/20 text-red-400 border-red-500/30", description: "Less than 50% of members are green" },
  RS_POS: { label: "RS Positive", color: "bg-green-500/20 text-green-400 border-green-500/30", description: "Theme outperforming SPY" },
  RS_NEG: { label: "RS Negative", color: "bg-red-500/20 text-red-400 border-red-500/30", description: "Theme underperforming SPY" },
  VOL_EXPAND: { label: "Volume Expanding", color: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30", description: "Volume 1.5x+ above 20-day average" },
  VOL_DRY: { label: "Volume Dry", color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30", description: "Volume below 20-day average" },
  ACCEL_POS: { label: "Accelerating", color: "bg-green-500/20 text-green-400 border-green-500/30", description: "Momentum increasing vs prior period" },
  ACCEL_NEG: { label: "Decelerating", color: "bg-red-500/20 text-red-400 border-red-500/30", description: "Momentum decreasing vs prior period" },
  LEADER_ROTATION: { label: "Leader Rotation", color: "bg-purple-500/20 text-purple-400 border-purple-500/30", description: "Leadership changing within theme" },
  NEW_HIGHS: { label: "New Highs", color: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30", description: "Multiple members hitting new highs" },
};

function MetricRow({
  label,
  value,
  icon,
  color,
  tooltip,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color?: string;
  tooltip?: string;
}) {
  const content = (
    <div className="flex items-center justify-between py-2 border-b border-slate-700/30 last:border-0">
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        {icon}
        {label}
        {tooltip && <Info className="w-3 h-3 opacity-50" />}
      </div>
      <span className={`text-[14px] font-medium ${color || "text-foreground"}`}>{value}</span>
    </div>
  );

  if (tooltip) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="cursor-help">{content}</div>
        </TooltipTrigger>
        <TooltipContent side="left" className="max-w-xs text-xs">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    );
  }

  return content;
}

export function ThemeDetailPanel({ theme, members = [], totalThemes = 17, accDistStats, timeSlice = "TODAY" }: ThemeDetailPanelProps) {
  const isHistorical = timeSlice !== "TODAY";
  const h = theme?.historicalMetrics;
  const [, setLocation] = useLocation();
  const [alertDialogOpen, setAlertDialogOpen] = useState(false);
  
  if (!theme) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <Target className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>Select a theme to view details</p>
        </div>
      </div>
    );
  }

  const tierColors: Record<ThemeTier, string> = {
    Macro: "bg-blue-500/20 text-blue-400",
    Structural: "bg-purple-500/20 text-purple-400",
    Narrative: "bg-cyan-500/20 text-cyan-400",
  };

  // Use backend's top3Contribution value (0-1, positive returns only)
  const top3Pct = Math.round((theme.top3Contribution ?? 0) * 100);
  const isNarrow = (theme.top3Contribution ?? 0) > 0.5;

  // Calculate percentile (normalized rank)
  const percentile = Math.round(((totalThemes - theme.rank + 1) / totalThemes) * 100);
  const percentileSuffix = percentile === 1 ? "st" : percentile === 2 ? "nd" : percentile === 3 ? "rd" : 
    (percentile >= 11 && percentile <= 13) ? "th" : 
    percentile % 10 === 1 ? "st" : percentile % 10 === 2 ? "nd" : percentile % 10 === 3 ? "rd" : "th";

  return (
    <div className="h-full overflow-auto p-3 space-y-3">
      {/* Header with Name, Rank and Percentile */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground">{theme.name}</h2>
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className={tierColors[theme.tier]}>
              {theme.tier}
            </Badge>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => setAlertDialogOpen(true)}
            >
              <Bell className="w-3.5 h-3.5" />
              Alert Theme Group
            </Button>
          </div>
        </div>
        <Tooltip>
          <TooltipTrigger>
            <div className="text-right">
              <div className="text-2xl font-bold text-foreground">#{theme.rank}</div>
              <div className="text-xs text-cyan-400 font-medium">{percentile}{percentileSuffix} percentile</div>
              <div className="text-[10px] text-muted-foreground">of {totalThemes} themes</div>
            </div>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <p className="font-semibold">Rank & Percentile</p>
            <p className="text-xs">Rank #{theme.rank} = {percentile}{percentileSuffix} percentile. Percentile normalizes across any theme count - useful as the system grows.</p>
          </TooltipContent>
        </Tooltip>
      </div>

      {/* PROMINENT: Rotation Delta */}
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={`p-3 rounded-lg border ${
            theme.deltaRank > 0 
              ? "bg-green-500/10 border-green-500/30" 
              : theme.deltaRank < 0 
              ? "bg-red-500/10 border-red-500/30" 
              : "bg-slate-800/50 border-slate-700/30"
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ArrowUpDown className="w-4 h-4" />
                <span className="text-sm font-medium">{isHistorical ? `Rotation Data (${timeSlice}) vs Today` : "Rotation Delta"}</span>
              </div>
              <div className={`text-xl font-bold ${
                theme.deltaRank > 0 
                  ? "text-green-400" 
                  : theme.deltaRank < 0 
                  ? "text-red-400" 
                  : "text-muted-foreground"
              }`}>
                {theme.deltaRank > 0 ? "+" : ""}{theme.deltaRank}
              </div>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {theme.deltaRank > 0 
                ? `Climbing ${theme.deltaRank} positions vs prior period`
                : theme.deltaRank < 0 
                ? `Falling ${Math.abs(theme.deltaRank)} positions vs prior period`
                : "Holding steady in rankings"}
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p>Rotation Delta shows how many rank positions this theme moved vs the prior lookback period. Positive = emerging narrative. Negative = fading theme.</p>
        </TooltipContent>
      </Tooltip>

      <AlertBuilderDialog
        open={alertDialogOpen}
        onOpenChange={setAlertDialogOpen}
        suggestedName={`${theme.name} group alert`}
        targetScope={{
          mode: "group",
          targetType: "theme",
          sourceClient: "market_flow",
          label: theme.name,
          themeId: theme.id,
          themeName: theme.name,
          symbols: members.map((member) => member.symbol),
          memberCount: members.length,
        }}
      />

      {/* Leader Concentration */}
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={`p-3 rounded-lg border ${
            isNarrow 
              ? "bg-yellow-500/10 border-yellow-500/30" 
              : "bg-slate-800/50 border-slate-700/30"
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <PieChart className="w-4 h-4" />
                <span className="text-sm font-medium">{isHistorical ? `Top 3 Contribution (${timeSlice}) vs Today` : "Top 3 Contribution"}</span>
              </div>
              <div className={`text-xl font-bold ${
                isNarrow ? "text-yellow-400" : "text-foreground"
              }`}>
                {top3Pct}%
              </div>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {isNarrow 
                ? "Narrow leadership — move driven by few names"
                : "Broad leadership — healthy participation"}
            </div>
            {/* Visual bar */}
            <div className="mt-2 w-full h-1.5 bg-slate-700 rounded overflow-hidden">
              <div 
                className={`h-full transition-all ${
                  isNarrow ? "bg-yellow-500" : "bg-green-500"
                }`}
                style={{ width: `${top3Pct}%` }}
              />
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p>Shows what % of the theme's move comes from the top 3 performers. Below 40% = broad, healthy rotation. Above 50% = narrow, fragile leadership.</p>
        </TooltipContent>
      </Tooltip>

      {/* Score Card */}
      <Card className="bg-slate-800/50 border-slate-700/30">
        <CardHeader className="pb-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <CardTitle className="text-sm flex items-center gap-2 cursor-help">
                {isHistorical ? `Theme Score (${timeSlice}) vs Today` : "Theme Score"}
                <Info className="w-3 h-3 opacity-50" />
              </CardTitle>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p>Composite score (0-100) based on: Breadth (0-30) + RS vs SPY (0-30) + Volume Expansion (0-20) + Acceleration (0-20)</p>
              {isHistorical && h && <p className="mt-1 text-yellow-300">Showing change (Now − Then). Then: {Math.round(h.score)} → Now: {theme.score} → Δ {theme.score - h.score > 0 ? "+" : ""}{Math.round(theme.score - h.score)}</p>}
            </TooltipContent>
          </Tooltip>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Progress value={theme.score} className="h-3 flex-1" />
            {isHistorical && h ? (() => {
              const diff = theme.score - h.score;
              const isZero = Math.abs(diff) < 0.5;
              return (
                <span className={`text-lg font-bold min-w-[40px] font-mono ${isZero ? "text-muted-foreground" : diff > 0 ? "text-green-400" : "text-red-400"}`}>
                  {isZero ? "—" : `${diff > 0 ? "+" : ""}${Math.round(diff)}`}
                </span>
              );
            })() : (
              <span className="text-lg font-bold min-w-[40px]">{theme.score}</span>
            )}
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="mt-2 text-xs text-muted-foreground cursor-help">
                Penalty Factor: {theme.penaltyFactor.toFixed(2)}x
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>Weight applied to setups in this theme. Score 80+ = 1.0x, 60-79 = 0.85x, 40-59 = 0.65x, below 40 = 0.40x</p>
            </TooltipContent>
          </Tooltip>
        </CardContent>
      </Card>

      {/* Key Metrics */}
      <Card className="bg-slate-800/50 border-slate-700/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{isHistorical ? `Key Metrics (${timeSlice}) vs Today` : "Key Metrics"}</CardTitle>
        </CardHeader>
        <CardContent className="p-3">
          {/* Median Change */}
          {isHistorical && h ? (() => {
            const diff = theme.medianPct - h.medianPct;
            const isZero = Math.abs(diff) < 0.005;
            return (
              <MetricRow
                label={`Median Change (vs ${timeSlice})`}
                value={isZero ? "—" : `${diff > 0 ? "+" : ""}${diff.toFixed(2)}%`}
                icon={diff >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                color={isZero ? "text-muted-foreground" : diff > 0 ? "text-green-400" : "text-red-400"}
                tooltip={`Change in median %. Then (${timeSlice} ago): ${h.medianPct >= 0 ? "+" : ""}${h.medianPct.toFixed(2)}% → Now: ${theme.medianPct >= 0 ? "+" : ""}${theme.medianPct.toFixed(2)}% → Δ ${diff >= 0 ? "+" : ""}${diff.toFixed(2)}%. Positive = theme strengthened.`}
              />
            );
          })() : (
            <MetricRow
              label="Median Change"
              value={`${theme.medianPct >= 0 ? "+" : ""}${theme.medianPct.toFixed(2)}%`}
              icon={theme.medianPct >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
              color={theme.medianPct >= 0 ? "text-green-400" : "text-red-400"}
              tooltip="Median price change across all theme members. Uses median to avoid single-stock skew."
            />
          )}

          {/* Breadth */}
          {isHistorical && h ? (() => {
            const diff = theme.breadthPct - h.breadthPct;
            const isZero = Math.abs(diff) < 0.005;
            return (
              <MetricRow
                label={`Breadth (vs ${timeSlice})`}
                value={isZero ? "—" : `${diff > 0 ? "+" : ""}${diff.toFixed(2)}%`}
                icon={<Activity className="w-4 h-4" />}
                color={isZero ? "text-muted-foreground" : diff > 0 ? "text-green-400" : "text-red-400"}
                tooltip={`Change in breadth %. Then (${timeSlice} ago): ${h.breadthPct.toFixed(2)}% → Now: ${theme.breadthPct.toFixed(2)}% → Δ ${diff >= 0 ? "+" : ""}${diff.toFixed(2)}%. Positive = more stocks green now than before.`}
              />
            );
          })() : (
            <MetricRow
              label="Breadth"
              value={`${theme.breadthPct.toFixed(2)}%`}
              icon={<Activity className="w-4 h-4" />}
              color={theme.breadthPct >= 60 ? "text-green-400" : theme.breadthPct >= 40 ? "text-yellow-400" : "text-red-400"}
              tooltip="% of theme members trading green. 60%+ is strong, below 40% is weak."
            />
          )}

          {/* RS vs SPY */}
          {isHistorical && h ? (() => {
            const diff = theme.rsVsSpy - h.rsVsBenchmark;
            const isZero = Math.abs(diff) < 0.005;
            return (
              <MetricRow
                label={`RS vs SPY (vs ${timeSlice})`}
                value={isZero ? "—" : `${diff > 0 ? "+" : ""}${diff.toFixed(2)}`}
                icon={<Target className="w-4 h-4" />}
                color={isZero ? "text-muted-foreground" : diff > 0 ? "text-green-400" : "text-red-400"}
                tooltip={`Change in RS vs SPY. Then (${timeSlice} ago): ${h.rsVsBenchmark >= 0 ? "+" : ""}${h.rsVsBenchmark.toFixed(2)} → Now: ${theme.rsVsSpy >= 0 ? "+" : ""}${theme.rsVsSpy.toFixed(2)} → Δ ${diff >= 0 ? "+" : ""}${diff.toFixed(2)}. Positive = outperformance increased.`}
              />
            );
          })() : (
            <MetricRow
              label="RS vs SPY"
              value={`${theme.rsVsSpy >= 0 ? "+" : ""}${theme.rsVsSpy.toFixed(2)}`}
              icon={<Target className="w-4 h-4" />}
              color={theme.rsVsSpy >= 0 ? "text-green-400" : "text-red-400"}
              tooltip="Relative Strength vs SPY. Positive = outperforming the market. This is how institutions identify sector rotation."
            />
          )}

          {/* Volume Expansion — always current */}
          <MetricRow
            label={isHistorical ? "Vol Exp (Today)" : "Volume Expansion"}
            value={`${theme.volExp.toFixed(2)}x`}
            icon={<Zap className="w-4 h-4" />}
            color={theme.volExp >= 1.5 ? "text-cyan-400" : theme.volExp >= 1 ? "text-foreground" : "text-yellow-400"}
            tooltip={isHistorical
              ? "Volume expansion vs 20-day average. Showing today's value — volume data is not stored historically."
              : "Today's median volume vs 20-day average. 1.5x+ indicates institutional interest."}
          />

          {/* Acceleration — always current */}
          <MetricRow
            label={isHistorical ? "Acceleration (Today)" : "Acceleration"}
            value={theme.acceleration > 0 ? `+${theme.acceleration}` : theme.acceleration.toString()}
            icon={theme.acceleration >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
            color={theme.acceleration > 0 ? "text-green-400" : theme.acceleration < 0 ? "text-red-400" : "text-muted-foreground"}
            tooltip={isHistorical
              ? "Rate of change in theme metrics. Showing today's value — acceleration is not stored historically."
              : "Rate of change in theme metrics vs prior period. Positive = improving, negative = fading."}
          />

          {/* A/D Aggregate Stats — always current */}
          {accDistStats && (
            <>
              <MetricRow
                label={isHistorical ? "3d+ Acc (Today)" : "3d+ Acc"}
                value={`${accDistStats.accumulationPct.toFixed(1)}% (${accDistStats.accumulation3Plus}/${accDistStats.total})`}
                icon={<TrendingUp className="w-4 h-4" />}
                color="text-green-400"
                tooltip={isHistorical
                  ? "% of tickers with 3+ days of consecutive accumulation. Showing today's value — A/D streaks are not stored historically."
                  : "% of tickers with 3+ days of consecutive accumulation (William O'Neal style)"}
              />
              <MetricRow
                label={isHistorical ? "3d+ Dist (Today)" : "3d+ Dist"}
                value={`${accDistStats.distributionPct.toFixed(1)}% (${accDistStats.distribution3Plus}/${accDistStats.total})`}
                icon={<TrendingDown className="w-4 h-4" />}
                color="text-red-400"
                tooltip={isHistorical
                  ? "% of tickers with 3+ days of consecutive distribution. Showing today's value — A/D streaks are not stored historically."
                  : "% of tickers with 3+ days of consecutive distribution (William O'Neal style)"}
              />
            </>
          )}
        </CardContent>
      </Card>

      {/* Trend State */}
      {theme.trendState && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className={`p-3 rounded-lg border ${TREND_STATE_CONFIG[theme.trendState].bg}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CircleDot className="w-4 h-4" />
                  <span className="text-sm font-medium">Trend State</span>
                </div>
                <Badge 
                  variant="outline" 
                  className={`${TREND_STATE_CONFIG[theme.trendState].color} border-current`}
                >
                  {theme.trendState}
                </Badge>
              </div>
              {(theme.bullCount !== undefined || theme.bearCount !== undefined) && (
                <div className="mt-2 flex gap-3 text-xs">
                  <span className="text-green-400">{theme.bullCount ?? 0} Bull</span>
                  <span className="text-yellow-400">{theme.transitionCount ?? 0} Trans</span>
                  <span className="text-red-400">{theme.bearCount ?? 0} Bear</span>
                </div>
              )}
            </div>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <p className="font-semibold">Theme Trend State</p>
            <p className="text-xs">Aggregated from member positions vs 50d and 200d SMAs:</p>
            <p className="text-xs mt-1">Bull = above both | Transition = mixed | Bear = below both</p>
          </TooltipContent>
        </Tooltip>
      )}

      {/* Member counts */}
      <Card className="bg-slate-800/50 border-slate-700/30">
        <CardHeader className="pb-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <CardTitle className="text-sm flex items-center gap-2 cursor-help">
                <Users className="w-4 h-4" />
                Members
                <Info className="w-3 h-3 opacity-50" />
              </CardTitle>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p>Core = permanent theme members. Leaders = dynamically selected top performers from the candidate pool.</p>
            </TooltipContent>
          </Tooltip>
        </CardHeader>
        <CardContent className="p-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Core Members</span>
            <span className="font-medium">{theme.coreCount}</span>
          </div>
          <div className="flex justify-between text-sm mt-2">
            <span className="text-muted-foreground">Active Leaders</span>
            <span className="font-medium text-cyan-400">{theme.leaderCount}</span>
          </div>
        </CardContent>
      </Card>

      {/* ETF Proxies */}
      {theme.etfProxies && theme.etfProxies.length > 0 && (
        <Card className="bg-slate-800/50 border-slate-700/30">
          <CardHeader className="pb-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <CardTitle className="text-sm flex items-center gap-2 cursor-help">
                  <Layers className="w-4 h-4" />
                  ETF Proxies
                  <Info className="w-3 h-3 opacity-50" />
                </CardTitle>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p className="font-semibold">ETF Proxies by Type</p>
                <p className="text-xs mt-1">
                  <span className="text-green-400">Direct</span> = Pure theme exposure<br />
                  <span className="text-blue-400">Adjacent</span> = Related exposure<br />
                  <span className="text-purple-400">Macro</span> = Broad sector/market<br />
                  <span className="text-yellow-400">Hedge</span> = Inverse correlation
                </p>
              </TooltipContent>
            </Tooltip>
          </CardHeader>
          <CardContent className="p-3">
            <div className="space-y-2">
              {theme.etfProxies.map((proxy) => (
                <div 
                  key={proxy.symbol} 
                  className="flex items-center justify-between gap-2 p-1.5 -mx-1.5 rounded hover:bg-slate-700/50 cursor-pointer transition-colors group"
                  onClick={() => setLocation(`/sentinel/charts?symbol=${proxy.symbol}`)}
                >
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge 
                      variant="outline" 
                      className={`text-[10px] px-1 ${ETF_TYPE_COLORS[proxy.proxyType]}`}
                    >
                      {proxy.proxyType}
                    </Badge>
                    <span className="font-mono text-sm font-medium group-hover:text-cyan-400 transition-colors">
                      {proxy.symbol}
                    </span>
                    <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-50 transition-opacity" />
                  </div>
                  <span className="text-xs text-muted-foreground truncate flex-1 text-right min-w-0">
                    {proxy.name}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Reason Codes / Signals */}
      {theme.reasonCodes.length > 0 && (
        <Card className="bg-slate-800/50 border-slate-700/30">
          <CardHeader className="pb-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <CardTitle className="text-sm flex items-center gap-2 cursor-help">
                  <AlertTriangle className="w-4 h-4" />
                  Signals
                  <Info className="w-3 h-3 opacity-50" />
                </CardTitle>
              </TooltipTrigger>
              <TooltipContent>
                <p>Auto-generated flags based on current theme metrics</p>
              </TooltipContent>
            </Tooltip>
          </CardHeader>
          <CardContent className="p-3">
            <div className="flex flex-wrap gap-2">
              {theme.reasonCodes.map((code) => (
                <Tooltip key={code}>
                  <TooltipTrigger>
                    <Badge
                      variant="outline"
                      className={REASON_CODE_LABELS[code].color}
                    >
                      {REASON_CODE_LABELS[code].label}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    {REASON_CODE_LABELS[code].description}
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
