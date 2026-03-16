// Market Condition Header Bar - Shows market regime, RAI, and summary metrics
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import { MarketConditionSummary, MarketRegime, ThemeRow, RiskAppetiteIndex, MegaCapOverlay } from "@/data/mockThemeData";
import { TrendingUp, TrendingDown, Activity, Clock, Gauge, Crown, Zap, Moon, Sun } from "lucide-react";
import type { MarketSession } from "@/hooks/useMarketCondition";
import { MarketFlowButton } from "./MarketFlowButton";

interface HeaderBarProps {
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
    case "LEADING": return "text-green-400";
    case "LAGGING": return "text-red-400";
    default: return "text-muted-foreground";
  }
}

export function HeaderBar({ summary, themes, lastUpdated, marketSession }: HeaderBarProps) {
  
  const regimeIcon =
    summary.regime === "RISK_ON" ? (
      <TrendingUp className="w-5 h-5" />
    ) : summary.regime === "RISK_OFF" ? (
      <TrendingDown className="w-5 h-5" />
    ) : (
      <Activity className="w-5 h-5" />
    );

  // Calculate health metrics
  const totalThemes = themes.length;
  const strongThemes = themes.filter(t => t.score >= 70).length;
  const weakThemes = themes.filter(t => t.score < 40).length;
  const strongPct = Math.round((strongThemes / totalThemes) * 100);
  const weakPct = Math.round((weakThemes / totalThemes) * 100);

  // Market health indicator
  const isBifurcated = strongPct > 25 && weakPct > 25;
  const isHealthy = strongPct > 40 && weakPct < 20;
  const isWeak = weakPct > 40;

  const { rai, megaOverlay } = summary;

  return (
    <div className="flex items-center justify-between p-3 bg-slate-900/80 border-b border-slate-700/50 gap-4 flex-wrap">
      {/* Left section: Branding + Regime + RAI */}
      <div className="flex items-center gap-3">
        {/* Market Flow Branding */}
        <div className="pr-4 border-r border-slate-600/50">
          <MarketFlowButton variant="branding" />
        </div>

        {/* Regime Badge */}
        <Tooltip>
          <TooltipTrigger>
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${getRegimeBg(
                summary.regime
              )}`}
            >
              <span className={getRegimeColor(summary.regime)}>{regimeIcon}</span>
              <span className={`text-sm font-bold ${getRegimeColor(summary.regime)}`}>
                {summary.regime.replace("_", " ")}
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <p className="font-semibold mb-1">Market Regime</p>
            <p className="text-xs">RISK ON = Broad strength, favorable for long setups. NEUTRAL = Mixed signals. RISK OFF = Defensive posture recommended.</p>
          </TooltipContent>
        </Tooltip>

        {/* RAI Gauge - NEW v3 */}
        <Tooltip>
          <TooltipTrigger>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-600/50 bg-slate-800/50">
              <Gauge className={`w-4 h-4 ${getRaiColor(rai.score)}`} />
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">RAI</span>
                  <span className={`text-lg font-bold ${getRaiColor(rai.score)}`}>{rai.score}</span>
                </div>
                <div className="w-16 h-1 bg-slate-700 rounded overflow-hidden">
                  <div 
                    className={`h-full ${getRaiBg(rai.score)}`}
                    style={{ width: `${rai.score}%` }}
                  />
                </div>
              </div>
              <Badge variant="outline" className={`text-[9px] ml-1 ${
                rai.label === "AGGRESSIVE" ? "border-green-500/30 text-green-400" :
                rai.label === "DEFENSIVE" ? "border-red-500/30 text-red-400" :
                "border-yellow-500/30 text-yellow-400"
              }`}>
                {rai.label}
              </Badge>
            </div>
          </TooltipTrigger>
          <TooltipContent className="max-w-sm">
            <p className="font-semibold mb-2">Risk Appetite Index (RAI) - {rai.score}/100</p>
            <p className="text-xs mb-2">Independent regime score that influences position sizing and aggressiveness.</p>
            <div className="text-xs space-y-1 border-t border-slate-600 pt-2">
              <div className="flex justify-between"><span>Trend Position:</span><span>{rai.components.trendPosition}/20</span></div>
              <div className="flex justify-between"><span>Small vs Large:</span><span>{rai.components.smallVsLarge}/20</span></div>
              <div className="flex justify-between"><span>Spec Leadership:</span><span>{rai.components.specLeadership}/20</span></div>
              <div className="flex justify-between"><span>Market Breadth:</span><span>{rai.components.marketBreadth}/20</span></div>
              <div className="flex justify-between"><span>Volatility Regime:</span><span>{rai.components.volatilityRegime}/20</span></div>
            </div>
            <div className="text-xs mt-2 pt-2 border-t border-slate-600">
              <span className="text-muted-foreground">Risk Multiplier:</span>
              <span className="ml-1 font-bold">{rai.riskMultiplier.toFixed(2)}x</span>
            </div>
          </TooltipContent>
        </Tooltip>

        {/* Mega Cap Overlay - v3 */}
        <Tooltip>
          <TooltipTrigger>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-600/30 bg-slate-800/30">
              <Crown className="w-4 h-4 text-yellow-500" />
              <span className="text-xs text-muted-foreground">MEGA</span>
              <span className={`text-sm font-bold ${getMegaColor(megaOverlay.status)}`}>
                {megaOverlay.status}
              </span>
              <span className={`text-xs font-medium ${megaOverlay.medianPct >= 0 ? "text-green-400" : "text-red-400"}`}>
                {megaOverlay.medianPct >= 0 ? "+" : ""}{megaOverlay.medianPct.toFixed(2)}%
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <p className="font-semibold mb-1">Mega Cap Overlay</p>
            <p className="text-xs mb-2">AAPL, MSFT, NVDA, AMZN, GOOGL, META, TSLA, AVGO</p>
            <p className="text-xs">Mega caps are an overlay, not a theme. They provide market context but don't compete in theme rankings.</p>
            <p className="text-xs mt-1">Breadth: {megaOverlay.breadthPct.toFixed(2)}% green</p>
          </TooltipContent>
        </Tooltip>

        {/* Market Session Badge */}
        {marketSession && marketSession !== "MARKET_HOURS" && (
          <Tooltip>
            <TooltipTrigger>
              <div className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold ${
                marketSession === "AFTER_HOURS"
                  ? "bg-purple-500/20 border-purple-500/40 text-purple-300"
                  : "bg-slate-700/50 border-slate-600/50 text-slate-300"
              }`}>
                {marketSession === "AFTER_HOURS" ? (
                  <>
                    <Moon className="w-4 h-4" />
                    <span>AFTERHOURS</span>
                  </>
                ) : (
                  <>
                    <Sun className="w-4 h-4" />
                    <span>CLOSE</span>
                  </>
                )}
              </div>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p className="text-xs">
                {marketSession === "AFTER_HOURS" ? (
                  <>
                    <span className="font-semibold">After-Hours Trading (4:00 PM - 8:00 PM ET)</span>
                    <br />
                    Data reflects current after-hours prices. Official market close was at 4:00 PM ET.
                    After-hours moves may have lower volume and wider spreads.
                  </>
                ) : (
                  <>
                    <span className="font-semibold">Market Closed</span>
                    <br />
                    Showing data from the last market close (4:00 PM ET). Market hours: 9:30 AM - 4:00 PM ET weekdays.
                  </>
                )}
              </p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Center section: Key Metrics */}
      <div className="flex items-center gap-3">
        {/* Major Index ETFs: QQQ, IWM, MDY, SPY */}
        <div className="flex items-center gap-2">
          {/* QQQ - Nasdaq 100 */}
          <Tooltip>
            <TooltipTrigger>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-muted-foreground">QQQ</span>
                <span className={`text-sm font-medium ${(summary.benchmarks?.QQQ?.changePct ?? 0) >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {(summary.benchmarks?.QQQ?.changePct ?? 0) >= 0 ? "+" : ""}{(summary.benchmarks?.QQQ?.changePct ?? 0).toFixed(2)}%
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent>Nasdaq 100 ETF (Tech-heavy)</TooltipContent>
          </Tooltip>

          {/* IWM - Russell 2000 */}
          <Tooltip>
            <TooltipTrigger>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-muted-foreground">IWM</span>
                <span className={`text-sm font-medium ${(summary.benchmarks?.IWM?.changePct ?? 0) >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {(summary.benchmarks?.IWM?.changePct ?? 0) >= 0 ? "+" : ""}{(summary.benchmarks?.IWM?.changePct ?? 0).toFixed(2)}%
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent>Russell 2000 ETF (Small Caps)</TooltipContent>
          </Tooltip>

          {/* MDY - Mid Cap */}
          <Tooltip>
            <TooltipTrigger>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-muted-foreground">MDY</span>
                <span className={`text-sm font-medium ${(summary.benchmarks?.MDY?.changePct ?? 0) >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {(summary.benchmarks?.MDY?.changePct ?? 0) >= 0 ? "+" : ""}{(summary.benchmarks?.MDY?.changePct ?? 0).toFixed(2)}%
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent>S&P MidCap 400 ETF</TooltipContent>
          </Tooltip>

          {/* SPY - S&P 500 */}
          <Tooltip>
            <TooltipTrigger>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-muted-foreground">SPY</span>
                <span className={`text-sm font-medium ${summary.spyPct >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {summary.spyPct >= 0 ? "+" : ""}{summary.spyPct.toFixed(2)}%
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent>S&P 500 ETF</TooltipContent>
          </Tooltip>
        </div>

        <div className="w-px h-4 bg-slate-600" />

        {/* Theme Health - Strong */}
        <Tooltip>
          <TooltipTrigger>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-600/30 bg-slate-800/30">
              <TrendingUp className="w-4 h-4 text-green-400" />
              <span className="text-xs text-muted-foreground">Flow Score: &gt;70</span>
              <span className={`text-sm font-bold ${strongPct >= 40 ? "text-green-400" : strongPct >= 25 ? "text-yellow-400" : "text-red-400"}`}>
                {strongPct}%
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent>{strongThemes} of {totalThemes} themes with FlowScore ≥70</TooltipContent>
        </Tooltip>

        {/* Theme Health - Weak */}
        <Tooltip>
          <TooltipTrigger>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-600/30 bg-slate-800/30">
              <TrendingDown className="w-4 h-4 text-red-400" />
              <span className="text-xs text-muted-foreground">Flow Score: &lt;40</span>
              <span className={`text-sm font-bold ${weakPct < 20 ? "text-green-400" : weakPct < 30 ? "text-yellow-400" : "text-red-400"}`}>
                {weakPct}%
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent>{weakThemes} of {totalThemes} themes with FlowScore &lt;40</TooltipContent>
        </Tooltip>

        {(isBifurcated || isHealthy || isWeak) && (
          <>
            <div className="w-px h-4 bg-slate-600" />
            <Badge variant="outline" className={`text-[9px] ${
              isHealthy ? "bg-green-500/10 border-green-500/30 text-green-400" :
              isBifurcated ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-400" :
              "bg-red-500/10 border-red-500/30 text-red-400"
            }`}>
              {isHealthy ? "HEALTHY" : isBifurcated ? "BIFURCATED" : "WEAK"}
            </Badge>
          </>
        )}
      </div>

      {/* Right section: Top/Bottom + Timestamp */}
      <div className="flex items-center gap-3">
        <Tooltip>
          <TooltipTrigger>
            <div className="flex items-center gap-3 text-base">
              <div className="flex items-center gap-1">
                <TrendingUp className="w-5 h-5 text-green-400" />
                <span className="text-green-400 font-semibold">{summary.topTheme.replace(/_/g, " ")}</span>
              </div>
              <div className="flex items-center gap-1">
                <TrendingDown className="w-5 h-5 text-red-400" />
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
