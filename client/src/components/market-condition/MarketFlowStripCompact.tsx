// Compact Flow / regime strip for Start Here widget (subset of HeaderBar)
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  MarketConditionSummary,
  MarketRegime,
  ThemeRow,
  MegaCapOverlay,
} from "@/data/mockThemeData";
import { TrendingUp, TrendingDown, Activity, Clock, Gauge, Crown, Moon, Sun } from "lucide-react";
import type { MarketSession } from "@/hooks/useMarketCondition";

export interface MarketFlowStripCompactProps {
  summary: MarketConditionSummary;
  themes: ThemeRow[];
  lastUpdated?: Date;
  marketSession?: MarketSession;
}

function getRegimeColor(regime: MarketRegime): string {
  switch (regime) {
    case "RISK_ON":
      return "text-green-400";
    case "RISK_OFF":
      return "text-red-400";
    default:
      return "text-yellow-400";
  }
}

function getRegimeBg(regime: MarketRegime): string {
  switch (regime) {
    case "RISK_ON":
      return "bg-green-500/20 border-green-500/40";
    case "RISK_OFF":
      return "bg-red-500/20 border-red-500/40";
    default:
      return "bg-yellow-500/20 border-yellow-500/40";
  }
}

function getRaiColor(score: number): string {
  if (score >= 70) return "text-green-400";
  if (score >= 50) return "text-yellow-400";
  if (score >= 30) return "text-orange-400";
  return "text-red-400";
}

function getRaiBg(score: number): string {
  if (score >= 70) return "bg-green-500";
  if (score >= 50) return "bg-yellow-500";
  if (score >= 30) return "bg-orange-500";
  return "bg-red-500";
}

function getMegaColor(status: MegaCapOverlay["status"]): string {
  switch (status) {
    case "LEADING":
      return "text-green-400";
    case "LAGGING":
      return "text-red-400";
    default:
      return "text-muted-foreground";
  }
}

export function MarketFlowStripCompact({
  summary,
  themes,
  lastUpdated,
  marketSession,
}: MarketFlowStripCompactProps) {
  const regimeIcon =
    summary.regime === "RISK_ON" ? (
      <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5" />
    ) : summary.regime === "RISK_OFF" ? (
      <TrendingDown className="w-4 h-4 sm:w-5 sm:h-5" />
    ) : (
      <Activity className="w-4 h-4 sm:w-5 sm:h-5" />
    );

  const totalThemes = themes.length;
  const strongThemes = themes.filter((t) => t.score >= 70).length;
  const weakThemes = themes.filter((t) => t.score < 40).length;
  const strongPct = totalThemes > 0 ? Math.round((strongThemes / totalThemes) * 100) : 0;
  const weakPct = totalThemes > 0 ? Math.round((weakThemes / totalThemes) * 100) : 0;

  const isBifurcated = strongPct > 25 && weakPct > 25;
  const isHealthy = strongPct > 40 && weakPct < 20;
  const isWeak = weakPct > 40;

  const { rai, megaOverlay } = summary;

  return (
    <div className="flex flex-col gap-2.5 rounded-md border border-slate-700/50 bg-slate-900/80 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className={`flex cursor-default items-center gap-1.5 rounded-lg border px-2 py-1 sm:px-2.5 sm:py-1.5 ${getRegimeBg(
                summary.regime
              )}`}
            >
              <span className={getRegimeColor(summary.regime)}>{regimeIcon}</span>
              <span className={`text-xs font-bold sm:text-sm ${getRegimeColor(summary.regime)}`}>
                {summary.regime.replace("_", " ")}
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <p className="mb-1 font-semibold">Market Regime</p>
            <p className="text-xs">
              RISK ON = Broad strength. NEUTRAL = Mixed. RISK OFF = Defensive posture.
            </p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex cursor-default items-center gap-2 rounded-lg border border-slate-600/50 bg-slate-800/50 px-2 py-1 sm:px-2.5 sm:py-1.5">
              <Gauge className={`h-3.5 w-3.5 sm:h-4 sm:w-4 ${getRaiColor(rai.score)}`} />
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground">RAI</span>
                  <span className={`text-sm font-bold sm:text-lg ${getRaiColor(rai.score)}`}>
                    {rai.score}
                  </span>
                </div>
                <div className="h-1 w-14 overflow-hidden rounded bg-slate-700 sm:w-16">
                  <div className={`h-full ${getRaiBg(rai.score)}`} style={{ width: `${rai.score}%` }} />
                </div>
              </div>
              <Badge
                variant="outline"
                className={`ml-0.5 text-[8px] sm:text-[9px] ${
                  rai.label === "AGGRESSIVE"
                    ? "border-green-500/30 text-green-400"
                    : rai.label === "DEFENSIVE"
                      ? "border-red-500/30 text-red-400"
                      : "border-yellow-500/30 text-yellow-400"
                }`}
              >
                {rai.label}
              </Badge>
            </div>
          </TooltipTrigger>
          <TooltipContent className="max-w-sm">
            <p className="mb-2 font-semibold">Risk Appetite Index — {rai.score}/100</p>
            <p className="text-xs text-muted-foreground">
              Risk multiplier: <span className="font-bold text-foreground">{rai.riskMultiplier.toFixed(2)}x</span>
            </p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex cursor-default items-center gap-1.5 rounded-lg border border-slate-600/30 bg-slate-800/30 px-2 py-1 sm:gap-2 sm:px-2.5 sm:py-1.5">
              <Crown className="h-3.5 w-3.5 text-yellow-500 sm:h-4 sm:w-4" />
              <span className="text-[10px] text-muted-foreground">MEGA</span>
              <span className={`text-xs font-bold sm:text-sm ${getMegaColor(megaOverlay.status)}`}>
                {megaOverlay.status}
              </span>
              <span
                className={`text-[10px] font-medium sm:text-xs ${
                  megaOverlay.medianPct >= 0 ? "text-green-400" : "text-red-400"
                }`}
              >
                {megaOverlay.medianPct >= 0 ? "+" : ""}
                {megaOverlay.medianPct.toFixed(2)}%
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <p className="mb-1 font-semibold">Mega Cap Overlay</p>
            <p className="text-xs">Top 8 by market cap — context only, not a ranked theme.</p>
            <p className="mt-1 text-xs">Breadth: {megaOverlay.breadthPct.toFixed(0)}% green</p>
          </TooltipContent>
        </Tooltip>

        {marketSession && marketSession !== "MARKET_HOURS" && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-semibold sm:text-xs ${
                  marketSession === "AFTER_HOURS"
                    ? "border-purple-500/40 bg-purple-500/20 text-purple-300"
                    : "border-slate-600/50 bg-slate-700/50 text-slate-300"
                }`}
              >
                {marketSession === "AFTER_HOURS" ? (
                  <>
                    <Moon className="h-3.5 w-3.5" />
                    <span>AH</span>
                  </>
                ) : (
                  <>
                    <Sun className="h-3.5 w-3.5" />
                    <span>CLOSED</span>
                  </>
                )}
              </div>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">
              {marketSession === "AFTER_HOURS"
                ? "After-hours session (lower volume / wider spreads)."
                : "Market closed — data from last regular session."}
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-700/40 pt-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex cursor-default items-center gap-1.5 rounded-lg border border-slate-600/30 bg-slate-800/30 px-2 py-1">
              <TrendingUp className="h-3.5 w-3.5 text-green-400" />
              <span className="text-[10px] text-muted-foreground sm:text-xs">Flow &gt;70</span>
              <span
                className={`text-xs font-bold sm:text-sm ${
                  strongPct >= 40 ? "text-green-400" : strongPct >= 25 ? "text-yellow-400" : "text-red-400"
                }`}
              >
                {strongPct}%
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            {strongThemes} of {totalThemes} themes with FlowScore ≥70
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex cursor-default items-center gap-1.5 rounded-lg border border-slate-600/30 bg-slate-800/30 px-2 py-1">
              <TrendingDown className="h-3.5 w-3.5 text-red-400" />
              <span className="text-[10px] text-muted-foreground sm:text-xs">Flow &lt;40</span>
              <span
                className={`text-xs font-bold sm:text-sm ${
                  weakPct < 20 ? "text-green-400" : weakPct < 30 ? "text-yellow-400" : "text-red-400"
                }`}
              >
                {weakPct}%
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            {weakThemes} of {totalThemes} themes with FlowScore &lt;40
          </TooltipContent>
        </Tooltip>

        {(isBifurcated || isHealthy || isWeak) && (
          <Badge
            variant="outline"
            className={`text-[9px] ${
              isHealthy
                ? "border-green-500/30 bg-green-500/10 text-green-400"
                : isBifurcated
                  ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-400"
                  : "border-red-500/30 bg-red-500/10 text-red-400"
            }`}
          >
            {isHealthy ? "HEALTHY" : isBifurcated ? "BIFURCATED" : "WEAK"}
          </Badge>
        )}

        <div className="min-w-[1px] flex-1" />

        {lastUpdated && (
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground sm:text-xs">
            <Clock className="h-3 w-3 shrink-0" />
            {lastUpdated.toLocaleTimeString()}
          </div>
        )}
      </div>
    </div>
  );
}
