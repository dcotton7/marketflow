// Theme Heatmap Grid - Visual grid showing all 17 themes with color-coded performance
import { ThemeRow, ThemeId, ThemeTier, TimeSlice } from "@/data/mockThemeData";
import type { MarketSession } from "@/hooks/useMarketCondition";
import { cn } from "@/lib/utils";
import { ArrowUp, ArrowDown, Minus } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// Time slice label mapping
const TIME_SLICE_LABELS: Record<TimeSlice, string> = {
  "TODAY": "today (live)",
  "15M": "15 minutes",
  "30M": "30 minutes",
  "1H": "1 hour",
  "1D": "yesterday's close",
  "1W": "1 week",
  "1M": "1 month",
  "3M": "3 months",
  "6M": "6 months",
  "YTD": "year to date",
};

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

                  {/* Tier badge */}
                  <div className="absolute top-1 right-1">
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
                <div className="text-xs space-y-2">
                  <div className="font-semibold text-sm border-b border-slate-600/50 pb-1">{theme.name}</div>

                  {/* Main % block */}
                  <div className="bg-slate-700/50 px-3 py-2 rounded border-l-2 border-cyan-400">
                    {isComp && h ? (
                      <>
                        <div className="flex items-baseline gap-2">
                          <span className={cn("text-2xl font-bold", displayPct >= 0 ? "text-green-400" : "text-red-400")}>
                            {displayPct >= 0 ? "+" : ""}{displayPct.toFixed(2)}%
                          </span>
                          <span className="text-[11px] text-muted-foreground">Δ vs {timeSlice} ago</span>
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-1 space-y-0.5">
                          <div>Then ({timeSlice} ago): <span className="text-white">{h.medianPct >= 0 ? "+" : ""}{h.medianPct.toFixed(2)}%</span></div>
                          <div>Now (Today): <span className="text-white">{theme.medianPct >= 0 ? "+" : ""}{theme.medianPct.toFixed(2)}%</span></div>
                          <div className="italic text-slate-400">Positive = theme strengthened over period</div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex items-baseline gap-2">
                          <span className="text-2xl font-bold text-cyan-400">
                            {theme.medianPct >= 0 ? "+" : ""}{theme.medianPct.toFixed(2)}%
                          </span>
                          <span className="text-[11px] text-muted-foreground">({timeSlice})</span>
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                          <div className="font-medium text-white/90">Median Price Change</div>
                          <div>Middle value of all stock returns over {TIME_SLICE_LABELS[timeSlice].toLowerCase()}</div>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Score & Rank */}
                  <div className="flex items-center gap-2 pt-1">
                    <span className="font-medium">FlowScore:</span>
                    <span className={cn("font-bold", theme.score >= 70 ? "text-green-400" : theme.score >= 50 ? "text-yellow-400" : "text-red-400")}>
                      {theme.score}/100
                    </span>
                    {isComp && h && (
                      <span className={cn("text-[10px]", theme.score - h.score > 0 ? "text-green-400" : theme.score - h.score < 0 ? "text-red-400" : "text-muted-foreground")}>
                        (Δ{theme.score - h.score > 0 ? "+" : ""}{Math.round(theme.score - h.score)})
                      </span>
                    )}
                    <span className="text-muted-foreground">•</span>
                    <span className="font-medium">Rank:</span>
                    <span>{theme.rank} of {total}</span>
                  </div>

                  {/* Bottom metrics detail */}
                  <div className="space-y-2 pt-2 border-t border-slate-600/50">
                    <div className="font-medium text-[11px] text-slate-300 mb-1.5">{isComp ? "Metric Changes (Now − Then):" : "Bottom Metrics:"}</div>

                    <div className="flex items-start gap-2">
                      <span className="font-mono font-bold text-cyan-400 min-w-[16px]">{isComp ? "BΔ:" : "B:"}</span>
                      <div className="flex-1">
                        {isComp && h ? (
                          <>
                            <div className={cn("font-medium", theme.breadthPct - h.breadthPct > 0 ? "text-green-400" : theme.breadthPct - h.breadthPct < 0 ? "text-red-400" : "")}>
                              {(theme.breadthPct - h.breadthPct) >= 0 ? "+" : ""}{(theme.breadthPct - h.breadthPct).toFixed(2)}%
                            </div>
                            <div className="text-[10px] text-muted-foreground">Then: {h.breadthPct.toFixed(2)}% → Now: {theme.breadthPct.toFixed(2)}%</div>
                          </>
                        ) : (
                          <>
                            <div className="font-medium">{theme.breadthPct.toFixed(2)}%</div>
                            <div className="text-[10px] text-muted-foreground">% of stocks green. &gt;60% = healthy, &lt;40% = weak/narrow.</div>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex items-start gap-2">
                      <span className="font-mono font-bold text-purple-400 min-w-[16px]">{isComp ? "RSΔ:" : "RS:"}</span>
                      <div className="flex-1">
                        {isComp && h ? (
                          <>
                            <div className={cn("font-medium", theme.rsVsSpy - h.rsVsBenchmark > 0 ? "text-green-400" : theme.rsVsSpy - h.rsVsBenchmark < 0 ? "text-red-400" : "")}>
                              {(theme.rsVsSpy - h.rsVsBenchmark) >= 0 ? "+" : ""}{(theme.rsVsSpy - h.rsVsBenchmark).toFixed(2)}
                            </div>
                            <div className="text-[10px] text-muted-foreground">Then: {h.rsVsBenchmark >= 0 ? "+" : ""}{h.rsVsBenchmark.toFixed(2)} → Now: {theme.rsVsSpy >= 0 ? "+" : ""}{theme.rsVsSpy.toFixed(2)}</div>
                          </>
                        ) : (
                          <>
                            <div className="font-medium">{theme.rsVsSpy > 0 ? "+" : ""}{theme.rsVsSpy.toFixed(2)}</div>
                            <div className="text-[10px] text-muted-foreground">vs SPY. Positive = outperforming market.</div>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex items-start gap-2">
                      <span className="font-mono font-bold text-amber-400 min-w-[16px]">V:</span>
                      <div className="flex-1">
                        <div className="font-medium">{theme.volExp.toFixed(2)}x</div>
                        <div className="text-[10px] text-muted-foreground">
                          Volume vs 20d avg. &gt;1.5x = institutional interest.
                          {isComp && <span className="text-yellow-300 ml-1">(Today — not stored historically)</span>}
                        </div>
                      </div>
                    </div>

                    {!isComp && theme.accDistDays !== 0 && (
                      <div className="flex items-start gap-2">
                        <span className={cn("font-mono font-bold min-w-[16px]", theme.accDistDays > 0 ? "text-green-400" : "text-red-400")}>
                          {theme.accDistDays > 0 ? "A:" : "D:"}
                        </span>
                        <div className="flex-1">
                          <div className="font-medium">{Math.abs(theme.accDistDays)} days</div>
                          <div className="text-[10px] text-muted-foreground">
                            {theme.accDistDays > 0 ? "Accumulation" : "Distribution"} streak (William O'Neal style).
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Legend */}
                  <div className="text-[10px] text-muted-foreground italic pt-2 border-t border-slate-600/50">
                    <div>• Card color = FlowScore (green = strong, red = weak)</div>
                    <div>• Bottom bar = magnitude of {isComp ? "change vs period" : "% move"}</div>
                    {isComp && <div className="text-yellow-300">• In Comparison mode: values = Now − Then</div>}
                  </div>

                  {theme.deltaRank !== 0 && (
                    <div className={cn("text-[11px] pt-2 border-t border-slate-600/50 font-medium", theme.deltaRank > 0 ? "text-green-400" : "text-red-400")}>
                      {theme.deltaRank > 0 ? "↑ Rising" : "↓ Falling"} {Math.abs(theme.deltaRank)} positions
                      <span className="text-muted-foreground text-[10px] ml-1">(rotation signal)</span>
                    </div>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
