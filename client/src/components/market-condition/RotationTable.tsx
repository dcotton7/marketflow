// Rotation Table - Tabular view of all themes with sortable columns
import { ThemeRow, ThemeId, TimeSlice } from "@/data/mockThemeData";
import { useState, useMemo, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowUp, ArrowDown, ChevronUp, ChevronDown } from "lucide-react";

interface RotationTableProps {
  themes: ThemeRow[];
  selectedTheme: ThemeId | null;
  onThemeSelect: (themeId: ThemeId) => void;
  lensMode?: string;
  timeSlice?: TimeSlice;
}

type SortKey = "rank" | "deltaRank" | "name" | "medianPct" | "score" | "breadthPct" | "rsVsSpy" | "volExp" | "acceleration" | "accDistDays";
type SortDirection = "asc" | "desc";

// Base column tooltips (used in 1D / non-diff mode)
const COLUMN_TOOLTIPS: Record<SortKey, string> = {
  rank: "Current rank by Flow Score. Lower = stronger theme.",
  deltaRank: "Rotation Delta: Position change vs prior period. Positive = climbing (emerging narrative). Negative = fading. This is what institutions chase.",
  name: "Theme name. Click to select and view details.",
  medianPct: "Median price change across all theme members. Uses median to avoid single-stock skew.",
  score: "ThemeScore (0-100): Breadth (0-30) + RS vs SPY (0-30) + Volume Expansion (0-20) + Acceleration (0-20)",
  breadthPct: "% of theme members trading green. 60%+ is strong, below 40% is weak breadth.",
  rsVsSpy: "Relative Strength vs SPY. Positive = outperforming the market.",
  volExp: "Volume Expansion vs 20-day average. 1.5x+ indicates institutional interest.",
  acceleration: "Rate of change in theme metrics vs prior period. Positive = momentum building.",
  accDistDays: "Accumulation/Distribution streak (William O'Neal style). Consecutive positive days = accumulation, negative = distribution. Shows institutional commitment.",
};

// Diff mode tooltip overrides
const DIFF_COLUMN_TOOLTIPS: Partial<Record<SortKey, string>> = {
  medianPct: "Difference in median % vs the selected period. Now − Then. Positive = theme strengthened, Negative = weakened. Sort uses this diff.",
  score: "Difference in ThemeScore vs the selected period. Now − Then. Positive = score improved, Negative = declined.",
  breadthPct: "Difference in breadth % vs the selected period. Now − Then. Positive = more stocks are green now than before.",
  rsVsSpy: "Difference in Relative Strength vs the selected period. Now − Then. Positive = outperformance increased, Negative = lost ground to SPY.",
};

// Format a diff value with sign prefix and optional suffix
function fmtDiff(diff: number, decimals = 2, suffix = ""): string {
  if (Math.abs(diff) < 0.005) return "—";
  return `${diff > 0 ? "+" : ""}${diff.toFixed(decimals)}${suffix}`;
}

// Compute diff (Now - Then) for historical sort keys
function getDiffValue(theme: ThemeRow, key: SortKey): number | undefined {
  const h = theme.historicalMetrics;
  if (!h) return undefined;
  switch (key) {
    case "medianPct": return theme.medianPct - h.medianPct;
    case "score":     return theme.score - h.score;
    case "breadthPct": return theme.breadthPct - h.breadthPct;
    case "rsVsSpy":   return theme.rsVsSpy - h.rsVsBenchmark;
    default: return undefined;
  }
}

const DIFF_SORT_KEYS = new Set<SortKey>(["medianPct", "score", "breadthPct", "rsVsSpy"]);

function SortHeader({
  label,
  sortKey,
  currentSort,
  currentDir,
  onSort,
  highlight,
  isHistorical,
}: {
  label: string;
  sortKey: SortKey;
  currentSort: SortKey | null;
  currentDir: SortDirection;
  onSort: (key: SortKey) => void;
  highlight?: boolean;
  isHistorical?: boolean;
}) {
  const isActive = currentSort === sortKey;
  const tooltip = (isHistorical && DIFF_COLUMN_TOOLTIPS[sortKey]) || COLUMN_TOOLTIPS[sortKey];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <TableHead
          className={cn(
            "cursor-pointer hover:bg-slate-700/30 select-none whitespace-nowrap",
            highlight && "bg-purple-500/10"
          )}
          onClick={() => onSort(sortKey)}
        >
          <div className={cn("flex items-center gap-1", highlight && "text-purple-400")}>
            {label}
            {isActive && (
              currentDir === "asc" ? (
                <ChevronUp className="w-3 h-3" />
              ) : (
                <ChevronDown className="w-3 h-3" />
              )
            )}
          </div>
        </TableHead>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

// A diff cell that shows Now−Then with tooltip breakdown
function DiffCell({
  diff,
  thenVal,
  nowVal,
  metricLabel,
  timeSlice,
  decimals = 2,
  suffix = "",
  isScore = false,
}: {
  diff: number;
  thenVal: number;
  nowVal: number;
  metricLabel: string;
  timeSlice: string;
  decimals?: number;
  suffix?: string;
  isScore?: boolean;
}) {
  const isZero = Math.abs(diff) < 0.005;
  const colorClass = isZero
    ? "text-muted-foreground"
    : diff > 0
    ? "text-green-400"
    : "text-red-400";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <TableCell className={cn("font-mono text-xs cursor-help", colorClass)}>
          {isScore ? (
            <span>{isZero ? "—" : `${diff > 0 ? "+" : ""}${Math.round(diff)}`}</span>
          ) : (
            <span>{fmtDiff(diff, decimals, suffix)}</span>
          )}
        </TableCell>
      </TooltipTrigger>
      <TooltipContent side="left" className="text-xs space-y-1">
        <div className="font-semibold border-b border-slate-600/50 pb-1">{metricLabel}</div>
        <div className="text-muted-foreground">Then ({timeSlice} ago): <span className="text-white">{thenVal > 0 ? "+" : ""}{isScore ? Math.round(thenVal) : thenVal.toFixed(decimals)}{suffix}</span></div>
        <div className="text-muted-foreground">Now (Today):&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; <span className="text-white">{nowVal > 0 ? "+" : ""}{isScore ? Math.round(nowVal) : nowVal.toFixed(decimals)}{suffix}</span></div>
        <div className={cn("font-semibold border-t border-slate-600/50 pt-1", colorClass)}>
          Change: {isScore ? (isZero ? "—" : `${diff > 0 ? "+" : ""}${Math.round(diff)}`) : fmtDiff(diff, decimals, suffix)}
        </div>
        <div className="text-[10px] text-muted-foreground italic">Positive = strengthened vs {timeSlice} ago</div>
      </TooltipContent>
    </Tooltip>
  );
}

export function RotationTable({
  themes,
  selectedTheme,
  onThemeSelect,
  lensMode,
  timeSlice = "TODAY",
}: RotationTableProps) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDirection>("desc");
  const isHistorical = timeSlice !== "TODAY";

  useEffect(() => {
    setSortKey(null);
  }, [lensMode]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "rank" || key === "name" ? "asc" : "desc");
    }
  };

  const sortedThemes = useMemo(() => {
    if (sortKey === null) return themes;

    return [...themes].sort((a, b) => {
      let aVal: number | string | undefined;
      let bVal: number | string | undefined;

      if (isHistorical && DIFF_SORT_KEYS.has(sortKey)) {
        // Sort by diff value (Now - Then) in comparison mode
        aVal = getDiffValue(a, sortKey) ?? (a[sortKey] as number);
        bVal = getDiffValue(b, sortKey) ?? (b[sortKey] as number);
      } else {
        aVal = a[sortKey];
        bVal = b[sortKey];
      }

      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      }
      return 0;
    });
  }, [themes, sortKey, sortDir, isHistorical]);

  return (
    <div className="h-full overflow-auto">
      <Table>
        <TableHeader className="sticky top-0 bg-slate-900">
          <TableRow className="border-slate-700/50 hover:bg-transparent">
            <SortHeader label="#" sortKey="rank" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} isHistorical={isHistorical} />
            <SortHeader label="Δ Rank" sortKey="deltaRank" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} highlight isHistorical={isHistorical} />
            <SortHeader label="Theme" sortKey="name" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} isHistorical={isHistorical} />
            <SortHeader label={isHistorical ? `Pct Δ (${timeSlice})` : "Pct"} sortKey="medianPct" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} isHistorical={isHistorical} />
            <SortHeader label={isHistorical ? `Score Δ (${timeSlice})` : "Score"} sortKey="score" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} isHistorical={isHistorical} />
            <SortHeader label={isHistorical ? `Breadth Δ (${timeSlice})` : "Breadth"} sortKey="breadthPct" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} isHistorical={isHistorical} />
            <SortHeader label={isHistorical ? `RS Δ (${timeSlice})` : "RS"} sortKey="rsVsSpy" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} isHistorical={isHistorical} />
            <SortHeader label="Vol" sortKey="volExp" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} isHistorical={isHistorical} />
            <SortHeader label="A/D" sortKey="accDistDays" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} isHistorical={isHistorical} />
            <SortHeader label="Accel" sortKey="acceleration" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} isHistorical={isHistorical} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedThemes.map((theme) => {
            const h = theme.historicalMetrics;
            return (
              <TableRow
                key={theme.id}
                className={cn(
                  "cursor-pointer border-slate-700/30 transition-colors",
                  selectedTheme === theme.id
                    ? "bg-cyan-500/20 hover:bg-cyan-500/30"
                    : "hover:bg-slate-800/50"
                )}
                onClick={() => onThemeSelect(theme.id)}
              >
                {/* Rank */}
                <TableCell className="font-mono text-xs">{theme.rank}</TableCell>

                {/* Delta Rank */}
                <TableCell className={cn(
                  "font-mono text-xs font-bold",
                  theme.deltaRank > 0 ? "bg-green-500/10" : theme.deltaRank < 0 ? "bg-red-500/10" : ""
                )}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-1 cursor-help">
                        {theme.deltaRank > 0 ? (
                          <><ArrowUp className="w-3 h-3 text-green-400" /><span className="text-green-400">+{theme.deltaRank}</span></>
                        ) : theme.deltaRank < 0 ? (
                          <><ArrowDown className="w-3 h-3 text-red-400" /><span className="text-red-400">{theme.deltaRank}</span></>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="text-xs">
                      <div className="font-semibold">Rotation Delta</div>
                      <div className="text-muted-foreground">Rank changed by {theme.deltaRank > 0 ? "+" : ""}{theme.deltaRank} positions vs {timeSlice} ago</div>
                      <div className="text-[10px] italic text-muted-foreground mt-0.5">Positive = climbing rankings</div>
                    </TooltipContent>
                  </Tooltip>
                </TableCell>

                {/* Name */}
                <TableCell className="font-medium max-w-[140px] truncate" title={theme.name}>
                  {theme.name}
                </TableCell>

                {/* Median Pct — diff when historical */}
                {isHistorical && h ? (
                  <DiffCell
                    diff={theme.medianPct - h.medianPct}
                    thenVal={h.medianPct}
                    nowVal={theme.medianPct}
                    metricLabel="Median % Change"
                    timeSlice={timeSlice}
                    suffix="%"
                  />
                ) : (
                  <TableCell className={cn("font-mono text-xs", theme.medianPct >= 0 ? "text-green-400" : "text-red-400")}>
                    {theme.medianPct >= 0 ? "+" : ""}{theme.medianPct.toFixed(2)}%
                  </TableCell>
                )}

                {/* Score — diff when historical */}
                {isHistorical && h ? (
                  <DiffCell
                    diff={theme.score - h.score}
                    thenVal={h.score}
                    nowVal={theme.score}
                    metricLabel="Theme Score"
                    timeSlice={timeSlice}
                    isScore
                  />
                ) : (
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="w-12 h-2 bg-slate-700 rounded overflow-hidden">
                        <div
                          className={cn(
                            "h-full transition-all",
                            theme.score >= 70 ? "bg-green-500" : theme.score >= 50 ? "bg-yellow-500" : "bg-red-500"
                          )}
                          style={{ width: `${theme.score}%` }}
                        />
                      </div>
                      <span className="text-xs font-mono w-6">{theme.score}</span>
                    </div>
                  </TableCell>
                )}

                {/* Breadth — diff when historical */}
                {isHistorical && h ? (
                  <DiffCell
                    diff={theme.breadthPct - h.breadthPct}
                    thenVal={h.breadthPct}
                    nowVal={theme.breadthPct}
                    metricLabel="Breadth %"
                    timeSlice={timeSlice}
                    suffix="%"
                  />
                ) : (
                  <TableCell className={cn("font-mono text-xs", theme.breadthPct >= 60 ? "text-green-400" : theme.breadthPct >= 40 ? "text-yellow-400" : "text-red-400")}>
                    {theme.breadthPct.toFixed(2)}%
                  </TableCell>
                )}

                {/* RS vs SPY — diff when historical */}
                {isHistorical && h ? (
                  <DiffCell
                    diff={theme.rsVsSpy - h.rsVsBenchmark}
                    thenVal={h.rsVsBenchmark}
                    nowVal={theme.rsVsSpy}
                    metricLabel="RS vs SPY"
                    timeSlice={timeSlice}
                  />
                ) : (
                  <TableCell className={cn("font-mono text-xs", theme.rsVsSpy >= 0 ? "text-green-400" : "text-red-400")}>
                    {theme.rsVsSpy >= 0 ? "+" : ""}{theme.rsVsSpy.toFixed(2)}
                  </TableCell>
                )}

                {/* Volume — always current */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <TableCell className={cn(
                      "font-mono text-xs cursor-help",
                      theme.volExp >= 1.5 ? "text-cyan-400" : theme.volExp >= 1 ? "text-foreground" : "text-yellow-400"
                    )}>
                      {theme.volExp.toFixed(2)}x{isHistorical && <span className="text-[9px] text-muted-foreground ml-0.5">T</span>}
                    </TableCell>
                  </TooltipTrigger>
                  <TooltipContent side="left" className="text-xs">
                    <div className="font-semibold">Volume Expansion</div>
                    <div className="text-muted-foreground">Current volume vs 20-day average. 1.5x+ = institutional interest.</div>
                    {isHistorical && <div className="text-yellow-400 text-[10px] mt-1">Showing today's value — not stored historically.</div>}
                  </TooltipContent>
                </Tooltip>

                {/* A/D — always current */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <TableCell className={cn(
                      "font-mono text-xs font-semibold text-center cursor-help",
                      !theme.accDistDays || theme.accDistDays === 0 ? "text-slate-500" :
                      theme.accDistDays > 0 ? (theme.accDistDays >= 3 ? "text-green-300" : "text-green-500")
                        : (theme.accDistDays <= -3 ? "text-red-300" : "text-red-500")
                    )}>
                      {!theme.accDistDays || theme.accDistDays === 0 ? "—" :
                        `${theme.accDistDays > 0 ? "A" : "D"}:${Math.abs(theme.accDistDays)}`}
                      {isHistorical && <span className="text-[9px] text-muted-foreground ml-0.5">T</span>}
                    </TableCell>
                  </TooltipTrigger>
                  <TooltipContent side="left" className="text-xs">
                    <div className="font-semibold">Accumulation / Distribution</div>
                    <div className="text-muted-foreground">Consecutive A/D days (William O'Neal style). A = accumulation, D = distribution.</div>
                    {isHistorical && <div className="text-yellow-400 text-[10px] mt-1">Showing today's value — not stored historically.</div>}
                  </TooltipContent>
                </Tooltip>

                {/* Acceleration — always current */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <TableCell className={cn(
                      "font-mono text-xs cursor-help",
                      theme.acceleration > 0 ? "text-green-400" : theme.acceleration < 0 ? "text-red-400" : "text-muted-foreground"
                    )}>
                      {theme.acceleration > 0 ? "+" : ""}{theme.acceleration}
                      {isHistorical && <span className="text-[9px] text-muted-foreground ml-0.5">T</span>}
                    </TableCell>
                  </TooltipTrigger>
                  <TooltipContent side="left" className="text-xs">
                    <div className="font-semibold">Acceleration</div>
                    <div className="text-muted-foreground">Rate of change in theme metrics. Positive = momentum building.</div>
                    {isHistorical && <div className="text-yellow-400 text-[10px] mt-1">Showing today's value — not stored historically.</div>}
                  </TooltipContent>
                </Tooltip>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
