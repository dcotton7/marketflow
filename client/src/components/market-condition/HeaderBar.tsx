// Market Condition Header Bar - Shows market regime, RAI, and summary metrics
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MarketConditionSummary, MarketRegime, ThemeRow, MegaCapOverlay } from "@/data/mockThemeData";
import { TrendingUp, TrendingDown, Activity, Clock, Gauge, Crown, Moon, Sun, BarChart3 } from "lucide-react";
import type { MarketSession, UniverseParticipation } from "@/hooks/useMarketCondition";
import { MarketFlowButton } from "./MarketFlowButton";
import { ThemeColorChip } from "@/components/theme/ThemeColorChip";
import { localSlotHeaderStyle } from "@/lib/local-slot-style";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";

interface HeaderBarProps {
  summary: MarketConditionSummary;
  themes: ThemeRow[];
  lastUpdated?: Date;
  marketSession?: MarketSession;
  universeParticipation?: UniverseParticipation | null;
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

function estimateParticipationFromThemes(themes: ThemeRow[]): { pctUp: number; pctDown: number } {
  if (themes.length === 0) return { pctUp: 50, pctDown: 50 };
  const weight = themes.reduce((s, t) => s + Math.max(1, t.coreCount || 1), 0);
  const pctUp =
    themes.reduce((s, t) => s + (t.breadthPct / 100) * Math.max(1, t.coreCount || 1), 0) / weight * 100;
  return { pctUp: Math.round(pctUp * 10) / 10, pctDown: Math.round((100 - pctUp) * 10) / 10 };
}

/** Shared chip shell — RAI, Mega, breadth, session, regime badges align to this footprint. */
const REGIME_CHIP =
  "flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-slate-600/50 bg-slate-800/50";

function SessionBadge({ marketSession }: { marketSession?: MarketSession }) {
  const session = marketSession ?? "CLOSED";
  const isOpen = session === "MARKET_HOURS";
  const isAfterHours = session === "AFTER_HOURS";

  return (
    <Tooltip>
      <TooltipTrigger>
        <div
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-semibold ${
            isOpen
              ? "bg-green-500/15 border-green-500/35 text-green-300"
              : isAfterHours
                ? "bg-rs-pink/20 border-rs-pink/40 text-rs-pink"
                : "border-slate-600/50 bg-slate-800/50 text-slate-300"
          }`}
          data-ui-region="marketFlow:sessionBadge"
        >
          {isOpen ? (
            <>
              <Sun className="w-4 h-4" />
              <span>OPEN</span>
            </>
          ) : isAfterHours ? (
            <>
              <Moon className="w-4 h-4" />
              <span>AFTER</span>
            </>
          ) : (
            <>
              <Moon className="w-4 h-4" />
              <span>CLOSE</span>
            </>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <p className="text-xs">
          {isOpen ? (
            <>
              <span className="font-semibold">Market open</span>
              <br />
              Regular session 9:30 AM – 4:00 PM ET.
            </>
          ) : isAfterHours ? (
            <>
              <span className="font-semibold">After-hours (4:00 PM – 8:00 PM ET)</span>
              <br />
              Prices reflect extended-hours trading; volume may be lighter.
            </>
          ) : (
            <>
              <span className="font-semibold">Market closed</span>
              <br />
              Showing last regular-session close. Opens weekdays 9:30 AM ET.
            </>
          )}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

function UniverseBreadthBar({
  pctUp,
  pctDown,
  pctFlat = 0,
  total,
}: {
  pctUp: number;
  pctDown: number;
  pctFlat?: number;
  total?: number;
}) {
  const totalPct = pctUp + pctDown + pctFlat;
  const upShare = totalPct > 0 ? (pctUp / totalPct) * 100 : 50;
  const flatShare = totalPct > 0 ? (pctFlat / totalPct) * 100 : 0;
  const downShare = totalPct > 0 ? (pctDown / totalPct) * 100 : 50;

  return (
    <Tooltip>
      <TooltipTrigger>
        <div className={REGIME_CHIP} data-ui-region="marketFlow:universeBreadthBar">
          <BarChart3 className="h-4 w-4 shrink-0 text-cyan-400" />
          <div className="flex min-w-[5.25rem] flex-col gap-0.5">
            <div className="flex items-center gap-2 whitespace-nowrap">
              <span className="text-xs text-muted-foreground">ADV</span>
              <span className="flex items-center gap-1 font-mono text-sm font-bold tabular-nums leading-none">
                <span className="text-green-400">{pctUp.toFixed(0)}↑</span>
                <span className="text-[10px] font-normal text-muted-foreground">/</span>
                <span className="text-red-400">{pctDown.toFixed(0)}↓</span>
              </span>
            </div>
            <div className="flex h-1 w-full overflow-hidden rounded-full bg-slate-700">
              <div className="h-full bg-green-500" style={{ width: `${upShare}%` }} />
              {flatShare >= 0.5 ? (
                <div className="h-full bg-slate-500" style={{ width: `${flatShare}%` }} />
              ) : null}
              <div className="h-full bg-red-500" style={{ width: `${downShare}%` }} />
            </div>
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <p className="font-semibold mb-1">Universe breadth</p>
        <p className="text-xs">
          {total != null && total > 0
            ? `${total} tracked tickers: ${pctUp.toFixed(1)}% up, ${pctDown.toFixed(1)}% down${
                pctFlat >= 0.5 ? `, ${pctFlat.toFixed(1)}% flat` : ""
              } on the session.`
            : `${pctUp.toFixed(1)}% of theme members up vs down (estimate).`}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

export function HeaderBar({
  summary,
  themes,
  lastUpdated,
  marketSession,
  universeParticipation,
}: HeaderBarProps) {
  const regimeIcon =
    summary.regime === "RISK_ON" ? (
      <TrendingUp className="w-5 h-5" />
    ) : summary.regime === "RISK_OFF" ? (
      <TrendingDown className="w-5 h-5" />
    ) : (
      <Activity className="w-5 h-5" />
    );

  const totalThemes = themes.length;
  const strongThemes = themes.filter((t) => t.score >= 70).length;
  const weakThemes = themes.filter((t) => t.score < 40).length;
  const strongPct = Math.round((strongThemes / totalThemes) * 100);
  const weakPct = Math.round((weakThemes / totalThemes) * 100);

  const isBifurcated = strongPct > 25 && weakPct > 25;
  const isHealthy = strongPct > 40 && weakPct < 20;
  const isWeak = weakPct > 40;

  const { rai, megaOverlay } = summary;
  const responsive = useResponsiveLayout();

  const breadth = useMemo(() => {
    if (universeParticipation && universeParticipation.total > 0) {
      return {
        pctUp: universeParticipation.pctUp,
        pctDown: universeParticipation.pctDown,
        pctFlat: universeParticipation.pctFlat,
        total: universeParticipation.total,
      };
    }
    const est = estimateParticipationFromThemes(themes);
    return { ...est, pctFlat: 0, total: undefined as number | undefined };
  }, [universeParticipation, themes]);

  return (
    <div
      className={`flex items-center justify-between ${responsive.isCompact ? "p-2 gap-2" : "px-3 py-1 gap-3"} border-b border-slate-700/50 flex-wrap`}
      style={localSlotHeaderStyle("marketFlow:regimeBar")}
      data-ui-region="marketFlow:regimeBar"
    >
      {/* Left: Market Flow → Session → RAI → Mega → Breadth bar → Risk On */}
      <div className="flex items-center gap-2.5 flex-wrap">
        <ThemeColorChip slotId="marketFlow:regimeBar" />
        <div className="pr-3 border-r border-slate-600/50" data-ui-region="marketFlow:regimeBranding">
          <MarketFlowButton variant="branding" />
        </div>

        <SessionBadge marketSession={marketSession} />

        <Tooltip>
          <TooltipTrigger>
            <div className={REGIME_CHIP} data-ui-region="marketFlow:raiGauge">
              <Gauge className={`w-4 h-4 ${getRaiColor(rai.score)}`} />
              <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">RAI</span>
                  <span className={`text-sm font-bold ${getRaiColor(rai.score)}`}>{rai.score}</span>
                  <div className="w-10 h-1 bg-slate-700 rounded overflow-hidden">
                    <div className={`h-full ${getRaiBg(rai.score)}`} style={{ width: `${rai.score}%` }} />
                  </div>
              </div>
              <Badge
                variant="outline"
                className={`text-[9px] ml-1 ${
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
            <p className="font-semibold mb-2">Risk Appetite Index (RAI) - {rai.score}/100</p>
            <p className="text-xs mb-2">
              Independent regime score that influences position sizing and aggressiveness.
            </p>
            <div className="text-xs space-y-1 border-t border-slate-600 pt-2">
              <div className="flex justify-between">
                <span>Trend Position:</span>
                <span>{rai.components.trendPosition}/20</span>
              </div>
              <div className="flex justify-between">
                <span>Small vs Large:</span>
                <span>{rai.components.smallVsLarge}/20</span>
              </div>
              <div className="flex justify-between">
                <span>Spec Leadership:</span>
                <span>{rai.components.specLeadership}/20</span>
              </div>
              <div className="flex justify-between">
                <span>Market Breadth:</span>
                <span>{rai.components.marketBreadth}/20</span>
              </div>
              <div className="flex justify-between">
                <span>Volatility Regime:</span>
                <span>{rai.components.volatilityRegime}/20</span>
              </div>
            </div>
            <div className="text-xs mt-2 pt-2 border-t border-slate-600">
              <span className="text-muted-foreground">Risk Multiplier:</span>
              <span className="ml-1 font-bold">{rai.riskMultiplier.toFixed(2)}x</span>
            </div>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger>
            <div
              className={`${REGIME_CHIP} border-slate-600/30 bg-slate-800/30`}
              data-ui-region="marketFlow:megaOverlay"
            >
              <Crown className="w-4 h-4 text-yellow-500" />
              <span className="text-xs text-muted-foreground">MEGA</span>
              <span className={`text-sm font-bold ${getMegaColor(megaOverlay.status)}`}>
                {megaOverlay.status}
              </span>
              <span
                className={`text-xs font-medium ${megaOverlay.medianPct >= 0 ? "text-green-400" : "text-red-400"}`}
              >
                {megaOverlay.medianPct >= 0 ? "+" : ""}
                {megaOverlay.medianPct.toFixed(2)}%
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <p className="font-semibold mb-1">Mega Cap Overlay</p>
            <p className="text-xs mb-2">AAPL, MSFT, NVDA, AMZN, GOOGL, META, TSLA, AVGO</p>
            <p className="text-xs">
              Mega caps are an overlay, not a theme. They provide market context but don&apos;t compete in
              theme rankings.
            </p>
            <p className="text-xs mt-1">Breadth: {megaOverlay.breadthPct.toFixed(2)}% green</p>
          </TooltipContent>
        </Tooltip>

        <UniverseBreadthBar
          pctUp={breadth.pctUp}
          pctDown={breadth.pctDown}
          pctFlat={breadth.pctFlat}
          total={breadth.total}
        />

        <Tooltip>
          <TooltipTrigger>
            <div
              className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md border ${getRegimeBg(summary.regime)}`}
              data-ui-region="marketFlow:regimeBadge"
            >
              <span className={getRegimeColor(summary.regime)}>{regimeIcon}</span>
              <span className={`text-sm font-bold ${getRegimeColor(summary.regime)}`}>
                {summary.regime.replace("_", " ")}
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <p className="font-semibold mb-1">Market Regime</p>
            <p className="text-xs">
              RISK ON = Broad strength, favorable for long setups. NEUTRAL = Mixed signals. RISK OFF =
              Defensive posture recommended.
            </p>
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Center section: Key Metrics — hidden on compact screens */}
      <div className={`flex items-center gap-3${responsive.isCompact ? " hidden" : ""}`}>
        <div className="flex items-center gap-2" data-ui-region="marketFlow:benchmarkStrip">
          <Tooltip>
            <TooltipTrigger>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-muted-foreground">QQQ</span>
                <span
                  className={`text-sm font-medium ${(summary.benchmarks?.QQQ?.changePct ?? 0) >= 0 ? "text-green-400" : "text-red-400"}`}
                >
                  {(summary.benchmarks?.QQQ?.changePct ?? 0) >= 0 ? "+" : ""}
                  {(summary.benchmarks?.QQQ?.changePct ?? 0).toFixed(2)}%
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent>Nasdaq 100 ETF (Tech-heavy)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-muted-foreground">IWM</span>
                <span
                  className={`text-sm font-medium ${(summary.benchmarks?.IWM?.changePct ?? 0) >= 0 ? "text-green-400" : "text-red-400"}`}
                >
                  {(summary.benchmarks?.IWM?.changePct ?? 0) >= 0 ? "+" : ""}
                  {(summary.benchmarks?.IWM?.changePct ?? 0).toFixed(2)}%
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent>Russell 2000 ETF (Small Caps)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-muted-foreground">MDY</span>
                <span
                  className={`text-sm font-medium ${(summary.benchmarks?.MDY?.changePct ?? 0) >= 0 ? "text-green-400" : "text-red-400"}`}
                >
                  {(summary.benchmarks?.MDY?.changePct ?? 0) >= 0 ? "+" : ""}
                  {(summary.benchmarks?.MDY?.changePct ?? 0).toFixed(2)}%
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent>S&P MidCap 400 ETF</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-muted-foreground">SPY</span>
                <span
                  className={`text-sm font-medium ${summary.spyPct >= 0 ? "text-green-400" : "text-red-400"}`}
                >
                  {summary.spyPct >= 0 ? "+" : ""}
                  {summary.spyPct.toFixed(2)}%
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent>S&P 500 ETF</TooltipContent>
          </Tooltip>
        </div>

        <div className="w-px h-4 bg-slate-600" />

        <Tooltip>
          <TooltipTrigger>
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-slate-600/30 bg-slate-800/30">
              <TrendingUp className="w-3.5 h-3.5 text-green-400" />
              <span className="text-xs text-muted-foreground">Flow Score: &gt;70</span>
              <span
                className={`text-sm font-bold ${strongPct >= 40 ? "text-green-400" : strongPct >= 25 ? "text-yellow-400" : "text-red-400"}`}
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
          <TooltipTrigger>
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-slate-600/30 bg-slate-800/30">
              <TrendingDown className="w-3.5 h-3.5 text-red-400" />
              <span className="text-xs text-muted-foreground">Flow Score: &lt;40</span>
              <span
                className={`text-sm font-bold ${weakPct < 20 ? "text-green-400" : weakPct < 30 ? "text-yellow-400" : "text-red-400"}`}
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
          <>
            <div className="w-px h-4 bg-slate-600" />
            <Badge
              variant="outline"
              className={`text-[9px] ${
                isHealthy
                  ? "bg-green-500/10 border-green-500/30 text-green-400"
                  : isBifurcated
                    ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-400"
                    : "bg-red-500/10 border-red-500/30 text-red-400"
              }`}
            >
              {isHealthy ? "HEALTHY" : isBifurcated ? "BIFURCATED" : "WEAK"}
            </Badge>
          </>
        )}
      </div>

      {/* Right section: Top/Bottom + Timestamp */}
      <div className="flex items-center gap-3">
        <Tooltip>
          <TooltipTrigger>
            <div className="flex items-center gap-3 text-sm">
              <div className="flex items-center gap-1">
                <TrendingUp className="w-4 h-4 text-green-400" />
                <span className="text-green-400 font-semibold">{summary.topTheme.replace(/_/g, " ")}</span>
              </div>
              <div className="flex items-center gap-1">
                <TrendingDown className="w-4 h-4 text-red-400" />
                <span className="text-red-400 font-semibold">{summary.bottomTheme.replace(/_/g, " ")}</span>
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent>Top and bottom themes by FlowScore</TooltipContent>
        </Tooltip>

        {lastUpdated && (
          <div className="flex items-center gap-1 text-[15px] text-muted-foreground">
            <Clock className="w-4 h-4" />
            {lastUpdated.toLocaleTimeString()}
          </div>
        )}
      </div>
    </div>
  );
}
