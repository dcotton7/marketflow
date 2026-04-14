import type { ThemeRow, TimeSlice } from "@/data/mockThemeData";
import { cn } from "@/lib/utils";

const TIME_SLICE_LABELS: Record<TimeSlice, string> = {
  TODAY: "today (live)",
  "15M": "15 minutes",
  "30M": "30 minutes",
  "1H": "1 hour",
  "4H": "4 hours",
  "1D": "yesterday's close",
  "5D": "5 trading days",
  "10D": "10 trading days",
  "1W": "1 week",
  "1M": "1 month",
  "3M": "3 months",
  "6M": "6 months",
  YTD: "year to date",
};

export function ThemeMarketTooltipContent({
  theme,
  timeSlice,
  total,
  displayPct,
  isComp,
}: {
  theme: ThemeRow;
  timeSlice: TimeSlice;
  total: number;
  displayPct: number;
  isComp: boolean;
}) {
  const h = theme.historicalMetrics;

  return (
    <div className="text-xs space-y-2">
      <div className="font-semibold text-sm border-b border-slate-600/50 pb-1">{theme.name}</div>

      <div className="bg-slate-700/50 px-3 py-2 rounded border-l-2 border-cyan-400">
        {isComp && h ? (
          <>
            <div className="flex items-baseline gap-2">
              <span className={cn("text-2xl font-bold", displayPct >= 0 ? "text-green-400" : "text-red-400")}>
                {displayPct >= 0 ? "+" : ""}
                {displayPct.toFixed(2)}%
              </span>
              <span className="text-[11px] text-muted-foreground">Δ vs {timeSlice} ago</span>
            </div>
            <div className="text-[10px] text-muted-foreground mt-1 space-y-0.5">
              <div>
                Then ({timeSlice} ago):{" "}
                <span className="text-white">
                  {h.medianPct >= 0 ? "+" : ""}
                  {h.medianPct.toFixed(2)}%
                </span>
              </div>
              <div>
                Now (Today):{" "}
                <span className="text-white">
                  {theme.medianPct >= 0 ? "+" : ""}
                  {theme.medianPct.toFixed(2)}%
                </span>
              </div>
              <div className="italic text-slate-400">Positive = theme strengthened over period</div>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-cyan-400">
                {theme.medianPct >= 0 ? "+" : ""}
                {theme.medianPct.toFixed(2)}%
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

      <div className="flex items-center gap-2 pt-1">
        <span className="font-medium">FlowScore:</span>
        <span
          className={cn(
            "font-bold",
            theme.score >= 70 ? "text-green-400" : theme.score >= 50 ? "text-yellow-400" : "text-red-400"
          )}
        >
          {theme.score}/100
        </span>
        {isComp && h && (
          <span
            className={cn(
              "text-[10px]",
              theme.score - h.score > 0
                ? "text-green-400"
                : theme.score - h.score < 0
                  ? "text-red-400"
                  : "text-muted-foreground"
            )}
          >
            (Δ{theme.score - h.score > 0 ? "+" : ""}
            {Math.round(theme.score - h.score)})
          </span>
        )}
        <span className="text-muted-foreground">•</span>
        <span className="font-medium">Rank:</span>
        <span>
          {theme.rank} of {total}
        </span>
      </div>

      <div className="space-y-2 pt-2 border-t border-slate-600/50">
        <div className="font-medium text-[11px] text-slate-300 mb-1.5">
          {isComp ? "Metric Changes (Now − Then):" : "Bottom Metrics:"}
        </div>

        <div className="flex items-start gap-2">
          <span className="font-mono font-bold text-cyan-400 min-w-[16px]">{isComp ? "BΔ:" : "B:"}</span>
          <div className="flex-1">
            {isComp && h ? (
              <>
                <div
                  className={cn(
                    "font-medium",
                    theme.breadthPct - h.breadthPct > 0
                      ? "text-green-400"
                      : theme.breadthPct - h.breadthPct < 0
                        ? "text-red-400"
                        : ""
                  )}
                >
                  {(theme.breadthPct - h.breadthPct) >= 0 ? "+" : ""}
                  {(theme.breadthPct - h.breadthPct).toFixed(2)}%
                </div>
                <div className="text-[10px] text-muted-foreground">
                  Then: {h.breadthPct.toFixed(2)}% → Now: {theme.breadthPct.toFixed(2)}%
                </div>
              </>
            ) : (
              <>
                <div className="font-medium">{theme.breadthPct.toFixed(2)}%</div>
                <div className="text-[10px] text-muted-foreground">
                  % of stocks green. &gt;60% = healthy, &lt;40% = weak/narrow.
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex items-start gap-2">
          <span className="font-mono font-bold text-purple-400 min-w-[16px]">{isComp ? "RSΔ:" : "RS:"}</span>
          <div className="flex-1">
            {isComp && h ? (
              <>
                <div
                  className={cn(
                    "font-medium",
                    theme.rsVsSpy - h.rsVsBenchmark > 0
                      ? "text-green-400"
                      : theme.rsVsSpy - h.rsVsBenchmark < 0
                        ? "text-red-400"
                        : ""
                  )}
                >
                  {(theme.rsVsSpy - h.rsVsBenchmark) >= 0 ? "+" : ""}
                  {(theme.rsVsSpy - h.rsVsBenchmark).toFixed(2)}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  Then: {h.rsVsBenchmark >= 0 ? "+" : ""}
                  {h.rsVsBenchmark.toFixed(2)} → Now: {theme.rsVsSpy >= 0 ? "+" : ""}
                  {theme.rsVsSpy.toFixed(2)}
                </div>
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
            <span
              className={cn(
                "font-mono font-bold min-w-[16px]",
                theme.accDistDays > 0 ? "text-green-400" : "text-red-400"
              )}
            >
              {theme.accDistDays > 0 ? "A:" : "D:"}
            </span>
            <div className="flex-1">
              <div className="font-medium">{Math.abs(theme.accDistDays)} days</div>
              <div className="text-[10px] text-muted-foreground">
                {theme.accDistDays > 0 ? "Accumulation" : "Distribution"} streak (William O&apos;Neal style).
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="text-[10px] text-muted-foreground italic pt-2 border-t border-slate-600/50">
        <div>• Card color = FlowScore (green = strong, red = weak)</div>
        <div>• Bottom bar = magnitude of {isComp ? "change vs period" : "% move"}</div>
        {isComp && <div className="text-yellow-300">• In Comparison mode: values = Now − Then</div>}
      </div>

      {theme.deltaRank !== 0 && (
        <div
          className={cn(
            "text-[11px] pt-2 border-t border-slate-600/50 font-medium",
            theme.deltaRank > 0 ? "text-green-400" : "text-red-400"
          )}
        >
          {theme.deltaRank > 0 ? "↑ Rising" : "↓ Falling"} {Math.abs(theme.deltaRank)} positions
          <span className="text-muted-foreground text-[10px] ml-1">(rotation signal)</span>
        </div>
      )}
    </div>
  );
}
