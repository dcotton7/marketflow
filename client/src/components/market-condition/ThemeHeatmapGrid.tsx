// Theme Heatmap Grid - Visual grid showing all 17 themes with color-coded performance
import { ThemeRow, ThemeId, ThemeTier, TimeSlice } from "@/data/mockThemeData";
import type { MarketSession } from "@/hooks/useMarketCondition";
import { cn } from "@/lib/utils";
import { ArrowUp, ArrowDown, Minus } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ThemeMarketTooltipContent } from "@/components/market-condition/ThemeMarketTooltipContent";
import { getThemeRaceIcon } from "@/components/market-condition/themeRaceIcons";

interface ThemeHeatmapGridProps {
  themes: ThemeRow[];
  selectedTheme: ThemeId | null;
  onThemeSelect: (themeId: ThemeId) => void;
  totalThemes?: number;
  timeSlice: TimeSlice;
  marketSession?: MarketSession;
}

function getScoreColor(score: number): string {
  if (score >= 80) return "bg-green-500/80 hover:bg-green-500";
  if (score >= 70) return "bg-green-500/50 hover:bg-green-500/70";
  if (score >= 60) return "bg-green-500/30 hover:bg-green-500/50";
  if (score >= 50) return "bg-yellow-500/40 hover:bg-yellow-500/60";
  if (score >= 40) return "bg-orange-500/40 hover:bg-orange-500/60";
  if (score >= 30) return "bg-red-500/50 hover:bg-red-500/70";
  return "bg-red-500/70 hover:bg-red-500";
}

function getPctColor(pct: number): string {
  if (pct >= 2) return "text-green-300";
  if (pct >= 1) return "text-green-400";
  if (pct > 0) return "text-green-500";
  if (pct > -1) return "text-red-500";
  if (pct > -2) return "text-red-400";
  return "text-red-300";
}

function getTierBadgeColor(tier: ThemeTier): string {
  switch (tier) {
    case "Macro":
      return "bg-blue-500/20 text-blue-300";
    case "Structural":
      return "bg-purple-500/20 text-purple-300";
    case "Narrative":
      return "bg-cyan-500/20 text-cyan-300";
  }
}

function DeltaRankIcon({ delta }: { delta: number }) {
  if (delta > 0) {
    return (
      <span className="flex items-center text-green-400 text-[10px]">
        <ArrowUp className="w-3 h-3" />
        {delta}
      </span>
    );
  }
  if (delta < 0) {
    return (
      <span className="flex items-center text-red-400 text-[10px]">
        <ArrowDown className="w-3 h-3" />
        {Math.abs(delta)}
      </span>
    );
  }
  return (
    <span className="flex items-center text-muted-foreground text-[10px]">
      <Minus className="w-3 h-3" />
    </span>
  );
}

export function ThemeHeatmapGrid({
  themes,
  selectedTheme,
  onThemeSelect,
  totalThemes,
  timeSlice,
  marketSession,
}: ThemeHeatmapGridProps) {
  const total = totalThemes || themes.length;
  const isHistorical = timeSlice !== "TODAY";

  // In comparison mode, scale bars by diff magnitude; otherwise by current pct
  const displayValues = themes.map(t => {
    const h = t.historicalMetrics;
    return isHistorical && h ? t.medianPct - h.medianPct : t.medianPct;
  });
  const maxAbsVal = Math.max(...displayValues.map(v => Math.abs(v)), 1);

  return (
    <div className="h-full overflow-auto p-2">
      <div className="grid grid-cols-3 gap-2">
        {themes.map((theme, idx) => {
          const h = theme.historicalMetrics;
          const displayPct = displayValues[idx];
          const isComp = isHistorical && h != null;
          const RaceIcon = getThemeRaceIcon(theme.id);

          return (
            <Tooltip key={theme.id}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onThemeSelect(theme.id)}
                  className={cn(
                    "relative p-3 rounded-lg border transition-all text-left",
                    getScoreColor(theme.score),
                    selectedTheme === theme.id
                      ? "ring-2 ring-cyan-400 border-cyan-400"
                      : "border-slate-600/30"
                  )}
                >
                  {/* Rank badge with total */}
                  <div className="absolute top-1 left-1 flex items-center gap-1">
                    <span className={cn(
                      "text-[10px] font-bold",
                      isComp && h ? "text-purple-300" : "text-white/80"
                    )}>
                      {isComp && h ? `[${timeSlice}] ${h.rank}` : `${theme.rank}/${total}`}
                    </span>
                    <DeltaRankIcon delta={theme.deltaRank} />
                  </div>

                  {/* Tier badge + race icon (matches RACE lens) */}
                  <div className="absolute top-1 right-1 flex items-center gap-1">
                    <RaceIcon className="w-3 h-3 text-white/70 shrink-0" aria-hidden />
                    <span className={cn("text-[9px] px-1.5 py-0.5 rounded", getTierBadgeColor(theme.tier))}>
                      {theme.tier[0]}
                    </span>
                  </div>

                  {/* Theme name + main value */}
                  <div className="mt-4 text-center">
                    <div className="text-sm font-semibold text-white truncate">{theme.name}</div>
                    <div className={cn("text-lg font-bold mt-1", getPctColor(displayPct))}>
                      {isComp && <span className="text-[10px] font-normal text-white/50 mr-0.5">Δ</span>}
                      {displayPct >= 0 ? "+" : ""}{displayPct.toFixed(2)}%
                    </div>
                  </div>

                  {/* Bottom metrics — diffs when comparison, current for Vol/A/D */}
                  <div className="mt-2 flex justify-center gap-2 text-[10px] text-white/70">
                    {isComp && h ? (
                      <>
                        <span className={cn(theme.breadthPct - h.breadthPct > 0 ? "text-green-400/80" : theme.breadthPct - h.breadthPct < 0 ? "text-red-400/80" : "")}>
                          BΔ:{(theme.breadthPct - h.breadthPct) >= 0 ? "+" : ""}{(theme.breadthPct - h.breadthPct).toFixed(1)}%
                        </span>
                        <span className={cn(theme.rsVsSpy - h.rsVsBenchmark > 0 ? "text-green-400/80" : theme.rsVsSpy - h.rsVsBenchmark < 0 ? "text-red-400/80" : "")}>
                          RSΔ:{(theme.rsVsSpy - h.rsVsBenchmark) >= 0 ? "+" : ""}{(theme.rsVsSpy - h.rsVsBenchmark).toFixed(2)}
                        </span>
                        <span>V:{theme.volExp.toFixed(1)}x</span>
                      </>
                    ) : (
                      <>
                        <span>B:{theme.breadthPct.toFixed(2)}%</span>
                        <span>RS:{theme.rsVsSpy > 0 ? "+" : ""}{theme.rsVsSpy.toFixed(2)}</span>
                        <span>V:{theme.volExp.toFixed(2)}x</span>
                        <span className={cn(
                          "font-semibold",
                          theme.accDistDays === 0 ? "text-slate-500" :
                          theme.accDistDays > 0 ? (theme.accDistDays >= 3 ? "text-green-300" : "text-green-500")
                            : (theme.accDistDays <= -3 ? "text-red-300" : "text-red-500")
                        )}>
                          {theme.accDistDays > 0 ? "A" : theme.accDistDays < 0 ? "D" : "A/D"}:{Math.abs(theme.accDistDays)}
                        </span>
                      </>
                    )}
                  </div>

                  {/* Magnitude bar */}
                  <div className="mt-2 w-full h-1 bg-black/30 rounded overflow-hidden">
                    <div
                      className={cn("h-full transition-all", displayPct >= 0 ? "bg-green-400/70" : "bg-red-400/70")}
                      style={{ width: `${(Math.abs(displayPct) / maxAbsVal) * 100}%` }}
                    />
                  </div>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-md">
                <ThemeMarketTooltipContent
                  theme={theme}
                  timeSlice={timeSlice}
                  total={total}
                  displayPct={displayPct}
                  isComp={isComp}
                />
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
