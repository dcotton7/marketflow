// Ticker Workbench - Shows member tickers for a selected theme with drill-down
import { TickerRow } from "@/data/mockThemeData";
import { useState, useMemo, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowUpRight, Star, Users, ChevronUp, ChevronDown, Plus, Info, Crown, Cpu, Trophy, Loader2, AlertTriangle, ExternalLink, LineChart, FileText } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useMarketConditionSettings } from "@/hooks/useMarketCondition";

export type MaColumnKey = "ema10d" | "ema20d" | "sma50d" | "sma200d";

const MA_OPTIONS: { value: MaColumnKey; label: string }[] = [
  { value: "ema10d", label: "10d EMA" },
  { value: "ema20d", label: "20d EMA" },
  { value: "sma50d", label: "50d SMA" },
  { value: "sma200d", label: "200d SMA" },
];

const MA_KEY_TO_FIELD: Record<MaColumnKey, keyof TickerRow> = {
  ema10d: "pctVsEma10d",
  ema20d: "pctVsEma20d",
  sma50d: "pctVsSma50d",
  sma200d: "pctVsSma200d",
};

function getPctVsMa(ticker: TickerRow, key: MaColumnKey): number | null | undefined {
  return ticker[MA_KEY_TO_FIELD[key]];
}

// Static overlay memberships
const MEGA_TICKERS = new Set(["AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "TSLA", "AVGO"]);
const MEMORY_TICKERS = new Set(["MU", "SNDK"]);

// Get overlay badges for a ticker
function getOverlayBadges(symbol: string): Array<{ id: string; label: string; color: string; icon: React.ReactNode; tooltip: string }> {
  const badges: Array<{ id: string; label: string; color: string; icon: React.ReactNode; tooltip: string }> = [];
  
  if (MEGA_TICKERS.has(symbol)) {
    badges.push({
      id: "mega",
      label: "M",
      color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
      icon: <Crown className="w-2.5 h-2.5" />,
      tooltip: "Mega Cap Overlay - Top 8 by market cap"
    });
  }
  
  if (MEMORY_TICKERS.has(symbol)) {
    badges.push({
      id: "memory",
      label: "MEM",
      color: "bg-purple-500/20 text-purple-400 border-purple-500/30",
      icon: <Cpu className="w-2.5 h-2.5" />,
      tooltip: "Memory Overlay - Memory semiconductor specialist"
    });
  }
  
  return badges;
}

interface TickerWorkbenchProps {
  themeId: string | null;
  themeName: string | null;
  tickers: TickerRow[];
  onTickerSelect: (symbol: string) => void;
  onTickersAdded?: () => void;
  isAdmin?: boolean;
  highlightedTicker?: string | null;
  timeSlice?: string;
  // Pop-out charting controls
  msSyncEnabled?: boolean;
  onMsSyncToggle?: () => void;
  chartSyncEnabled?: boolean;
  onChartSyncToggle?: () => void;
  analysisSyncEnabled?: boolean;
  onAnalysisSyncToggle?: () => void;
  onOpenAnalysis?: (symbol: string) => void;
}

interface ConflictInfo {
  ticker: string;
  existingTheme: string;
  isCore: boolean;
}

interface AddTickersResponse {
  success: boolean;
  added?: string[];
  skipped?: string[];
  conflicts?: ConflictInfo[];
  message?: string;
}

type SortKey = "symbol" | "price" | "pct" | "leaderScore" | "rsVsSpy" | "volExp" | "momentum" | "rsRank" | "contributionPct" | "accDistDays" | "ma1" | "ma2";
type SortDirection = "asc" | "desc";

function getMomentumColor(momentum: TickerRow["momentum"]): string {
  switch (momentum) {
    case "Above":
      return "text-green-400";
    case "Below":
      return "text-red-400";
    default:
      return "text-muted-foreground";
  }
}

// Leader score dot color
function getLeaderDotColor(score: number): string {
  if (score >= 80) return "bg-green-500";
  if (score >= 70) return "bg-green-400";
  if (score >= 60) return "bg-yellow-500";
  if (score >= 50) return "bg-orange-500";
  return "bg-red-500";
}

// Column tooltips
const COLUMN_TOOLTIPS: Record<string, string> = {
  symbol: "Stock ticker symbol. ★ = Core member (always in theme). 1° = Primary theme assignment.",
  price: "Current price. When a time slice is selected, shows dollar change over the period.",
  pct: "Today's price change %. When a time slice is selected, shows the period return % from the start of that period to now.",
  leaderScore: "LeaderScore (0-100): RS×0.35 + Volume×0.25 + Momentum×0.25 + Accel×0.15. Above 70 = leader candidate.",
  rsVsSpy: "Relative Strength vs SPY. Positive = outperforming the market.",
  volExp: "Volume Expansion vs 20-day average. 1.5x+ indicates institutional interest.",
  momentum: "VWAP/EMA alignment. Above = price above key MAs. Below = price below.",
  rsRank: "RS Rank within theme. #1 = strongest relative strength. Trophy icon for top 3.",
  contributionPct: "Contribution % to theme move. Shows how much of the positive return comes from this ticker.",
  accDistDays: "Accumulation/Distribution streak (William O'Neal style).",
  ma1: "Price % above or below the selected moving average. White box when within threshold.",
  ma2: "Price % above or below the selected moving average. White box when within threshold.",
};

function SortableHeader({
  label,
  sortKey,
  currentSort,
  currentDir,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  currentSort: SortKey;
  currentDir: SortDirection;
  onSort: (key: SortKey) => void;
}) {
  const isActive = currentSort === sortKey;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <TableHead
          className="cursor-pointer hover:bg-slate-700/30 select-none whitespace-nowrap text-xs"
          onClick={() => onSort(sortKey)}
        >
          <div className="flex items-center gap-1">
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
        {COLUMN_TOOLTIPS[sortKey]}
      </TooltipContent>
    </Tooltip>
  );
}

export function TickerWorkbench({
  themeId,
  themeName,
  tickers,
  onTickerSelect,
  onTickersAdded,
  isAdmin = false,
  highlightedTicker = null,
  timeSlice = "TODAY",
  msSyncEnabled = false,
  onMsSyncToggle,
  chartSyncEnabled = false,
  onChartSyncToggle,
  analysisSyncEnabled = false,
  onAnalysisSyncToggle,
  onOpenAnalysis,
}: TickerWorkbenchProps) {
  const isHistorical = timeSlice !== "TODAY";
  const { toast } = useToast();
  const { data: settings } = useMarketConditionSettings();
  const maBoldThreshold = settings?.maBoldThresholdPct ?? 0.5;

  const [sortKey, setSortKey] = useState<SortKey>("leaderScore");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");
  const [showCoreOnly, setShowCoreOnly] = useState(false);
  const [maCol1, setMaCol1] = useState<MaColumnKey>("ema20d");
  const [maCol2, setMaCol2] = useState<MaColumnKey>("sma50d");
  const highlightedRowRef = useRef<HTMLTableRowElement>(null);
  
  // Add Tickers dialog state
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [tickerInput, setTickerInput] = useState("");
  const [conflicts, setConflicts] = useState<ConflictInfo[]>([]);
  const [showConflictDialog, setShowConflictDialog] = useState(false);
  const [pendingTickers, setPendingTickers] = useState<string[]>([]);
  
  // Add tickers mutation
  const addTickersMutation = useMutation({
    mutationFn: async ({ tickers, force }: { tickers: string[]; force?: boolean }) => {
      const res = await fetch(`/api/market-condition/themes/${themeId}/add-tickers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers, force }),
      });
      if (!res.ok) throw new Error("Failed to add tickers");
      return res.json() as Promise<AddTickersResponse>;
    },
    onSuccess: (data) => {
      if (!data.success && data.conflicts && data.conflicts.length > 0) {
        // Show conflict dialog
        setConflicts(data.conflicts);
        setShowConflictDialog(true);
      } else if (data.success) {
        // Success - close dialog and refresh
        setAddDialogOpen(false);
        setTickerInput("");
        toast({
          title: "Tickers Added",
          description: data.message || `Added ${data.added?.length || 0} ticker(s)`,
        });
        onTickersAdded?.();
      }
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to add tickers. Please try again.",
        variant: "destructive",
      });
    },
  });
  
  const handleAddTickers = () => {
    const tickers = tickerInput
      .split(",")
      .map(t => t.trim().toUpperCase())
      .filter(t => t.length > 0);
    
    if (tickers.length === 0) {
      toast({ title: "No tickers", description: "Please enter at least one ticker", variant: "destructive" });
      return;
    }
    
    setPendingTickers(tickers);
    addTickersMutation.mutate({ tickers, force: false });
  };
  
  const handleForceAdd = () => {
    setShowConflictDialog(false);
    addTickersMutation.mutate({ tickers: pendingTickers, force: true });
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "symbol" ? "asc" : "desc");
    }
  };

  const filteredTickers = useMemo(() => {
    let result = showCoreOnly ? tickers.filter((t) => t.isCore) : tickers;
    return result.sort((a, b) => {
      let aVal: string | number | boolean | null | undefined;
      let bVal: string | number | boolean | null | undefined;
      if (sortKey === "ma1") {
        aVal = getPctVsMa(a, maCol1);
        bVal = getPctVsMa(b, maCol1);
      } else if (sortKey === "ma2") {
        aVal = getPctVsMa(a, maCol2);
        bVal = getPctVsMa(b, maCol2);
      } else if (sortKey === "price" && isHistorical) {
        // Sort by dollar change when in historical mode
        aVal = (a.price != null && a.historicalPrice != null) ? a.price - a.historicalPrice : -Infinity;
        bVal = (b.price != null && b.historicalPrice != null) ? b.price - b.historicalPrice : -Infinity;
      } else if (sortKey === "pct" && isHistorical) {
        // Sort by period return when in historical mode
        aVal = a.historicalPct ?? a.pct;
        bVal = b.historicalPct ?? b.pct;
      } else {
        aVal = a[sortKey as keyof TickerRow];
        bVal = b[sortKey as keyof TickerRow];
      }
      const aNum = typeof aVal === "number" ? aVal : (aVal == null ? -Infinity : 0);
      const bNum = typeof bVal === "number" ? bVal : (bVal == null ? -Infinity : 0);
      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      }
      if (sortKey === "ma1" || sortKey === "ma2" || sortKey === "price") {
        return sortDir === "asc" ? aNum - bNum : bNum - aNum;
      }
      if (typeof aVal === "boolean" && typeof bVal === "boolean") {
        return sortDir === "asc" ? (aVal ? 1 : -1) - (bVal ? 1 : -1) : (bVal ? 1 : -1) - (aVal ? 1 : -1);
      }
      return 0;
    });
  }, [tickers, sortKey, sortDir, showCoreOnly, maCol1, maCol2, isHistorical]);

  // Find max absolute pct for scaling background bars
  const maxAbsPct = useMemo(() => {
    return Math.max(...tickers.map((t) => Math.abs(t.pct)), 1);
  }, [tickers]);

  // Auto-scroll to highlighted ticker
  useEffect(() => {
    if (highlightedTicker && highlightedRowRef.current) {
      highlightedRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlightedTicker]);

  if (!themeName) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>Select a theme to view members</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Choose OnClick Action */}
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-slate-700/30 bg-slate-800/30">
        <span className="text-xs text-muted-foreground">Choose OnClick Action:</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onMsSyncToggle}
              className={cn(
                "text-xs px-3 py-1 rounded transition-colors flex items-center",
                msSyncEnabled
                  ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                  : "bg-slate-700/30 text-muted-foreground hover:text-foreground"
              )}
            >
              <ExternalLink className="w-3.5 h-3.5 mr-1.5 shrink-0" />
              MarketSurge
            </button>
          </TooltipTrigger>
          <TooltipContent>
            Open MarketSurge in a popup window. Clicking tickers will drive that window.
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onChartSyncToggle}
              className={cn(
                "text-xs px-3 py-1 rounded transition-colors flex items-center",
                chartSyncEnabled
                  ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                  : "bg-slate-700/30 text-muted-foreground hover:text-foreground"
              )}
            >
              <LineChart className="w-3.5 h-3.5 mr-1.5 shrink-0" />
              Internal Charts
            </button>
          </TooltipTrigger>
          <TooltipContent>
            Open internal charts in a popup window. Clicking tickers will drive that window.
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onAnalysisSyncToggle}
              className={cn(
                "text-xs px-3 py-1 rounded transition-colors flex items-center",
                analysisSyncEnabled
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                  : "bg-slate-700/30 text-muted-foreground hover:text-foreground"
              )}
            >
              <FileText className="w-3.5 h-3.5 mr-1.5 shrink-0" />
              Detailed Analysis
            </button>
          </TooltipTrigger>
          <TooltipContent>
            Open MarketFlow AI analysis in a side panel. Clicking a ticker opens the analysis sheet.
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between p-2 border-b border-slate-700/50">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">{themeName}</h3>
          <Badge variant="outline" className="text-xs">
            {tickers.length} members
          </Badge>
          {/* Icon Legend */}
          <Tooltip>
            <TooltipTrigger>
              <Info className="w-3.5 h-3.5 text-muted-foreground hover:text-cyan-400 cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs">
              <p className="font-semibold mb-2">Icon Legend</p>
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-500" />
                  <span>LeaderScore 80+ (top leader)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-yellow-500" />
                  <span>LeaderScore 60-79 (emerging)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-red-500" />
                  <span>LeaderScore &lt;50 (lagging)</span>
                </div>
                <div className="flex items-center gap-2">
                  <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
                  <span>Core member (permanent)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-cyan-400 font-medium">1°</span>
                  <span>Primary theme assignment</span>
                </div>
                <div className="border-t border-slate-600 pt-1.5 mt-1.5">
                  <p className="text-muted-foreground mb-1">Overlays:</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center px-1 py-0.5 rounded text-[8px] font-medium border bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
                    <Crown className="w-2.5 h-2.5" />
                  </span>
                  <span>Mega Cap (top 8 by market cap)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center px-1 py-0.5 rounded text-[8px] font-medium border bg-purple-500/20 text-purple-400 border-purple-500/30">
                    <Cpu className="w-2.5 h-2.5" />
                  </span>
                  <span>Memory semiconductor</span>
                </div>
              </div>
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setShowCoreOnly(!showCoreOnly)}
                className={cn(
                  "text-xs px-2 py-1 rounded transition-colors",
                  showCoreOnly
                    ? "bg-cyan-500/20 text-cyan-400"
                    : "bg-slate-700/30 text-muted-foreground hover:text-foreground"
                )}
              >
                {showCoreOnly ? "Core Only" : "All Members"}
              </button>
            </TooltipTrigger>
            <TooltipContent>
              Toggle between showing all theme members or only core (permanent) members
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 bg-slate-900">
            <TableRow className="border-slate-700/50 hover:bg-transparent">
              <SortableHeader label="Symbol" sortKey="symbol" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
              <SortableHeader label={isHistorical ? `Price Chg (${timeSlice})` : "Price"} sortKey="price" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
              <SortableHeader label={isHistorical ? `Pct (${timeSlice})` : "Pct"} sortKey="pct" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
              <SortableHeader label="RS#" sortKey="rsRank" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
              <SortableHeader label="Contr" sortKey="contributionPct" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
              <SortableHeader label="Leader" sortKey="leaderScore" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
              <SortableHeader label="Vol (D Close/Today)" sortKey="volExp" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
              <SortableHeader label="A/D" sortKey="accDistDays" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
              <TableHead className="text-xs">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex flex-col gap-0.5">
                      <div
                        className="flex items-center gap-1 cursor-pointer hover:bg-slate-700/30 rounded px-1 -mx-1"
                        onClick={() => handleSort("ma1")}
                      >
                        <span className="text-muted-foreground">MA 1</span>
                        {sortKey === "ma1" && (
                          sortDir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                        )}
                      </div>
                      <div onClick={(e) => e.stopPropagation()}>
                        <Select value={maCol1} onValueChange={(v) => setMaCol1(v as MaColumnKey)}>
                          <SelectTrigger className="h-7 text-[10px] w-[90px] min-w-[90px] border-slate-600 bg-slate-800/50">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {MA_OPTIONS.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value} className="text-xs">
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs text-xs">
                    {COLUMN_TOOLTIPS.ma1}
                  </TooltipContent>
                </Tooltip>
              </TableHead>
              <TableHead className="text-xs">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex flex-col gap-0.5">
                      <div
                        className="flex items-center gap-1 cursor-pointer hover:bg-slate-700/30 rounded px-1 -mx-1"
                        onClick={() => handleSort("ma2")}
                      >
                        <span className="text-muted-foreground">MA 2</span>
                        {sortKey === "ma2" && (
                          sortDir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                        )}
                      </div>
                      <div onClick={(e) => e.stopPropagation()}>
                        <Select value={maCol2} onValueChange={(v) => setMaCol2(v as MaColumnKey)}>
                          <SelectTrigger className="h-7 text-[10px] w-[90px] min-w-[90px] border-slate-600 bg-slate-800/50">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {MA_OPTIONS.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value} className="text-xs">
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs text-xs">
                    {COLUMN_TOOLTIPS.ma2}
                  </TooltipContent>
                </Tooltip>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredTickers.map((ticker) => {
              const isHighlighted = highlightedTicker === ticker.symbol;
              return (
                <TableRow
                  key={ticker.symbol}
                  ref={isHighlighted ? highlightedRowRef : null}
                  className={cn(
                    "cursor-pointer border-slate-700/30 hover:bg-slate-800/50 transition-colors group",
                    isHighlighted && "bg-green-500/10 border-green-500/40 ring-1 ring-green-500/30"
                  )}
                  onClick={() => {
                    onTickerSelect(ticker.symbol);
                    if (analysisSyncEnabled && onOpenAnalysis) onOpenAnalysis(ticker.symbol);
                  }}
                >
            
                {/* Symbol with LeaderScore dot */}
                <TableCell className="font-medium">
                  <div className="flex items-center gap-1.5">
                    {/* LeaderScore indicator dot */}
                    <Tooltip>
                      <TooltipTrigger>
                        <div className={cn("w-2 h-2 rounded-full flex-shrink-0", getLeaderDotColor(ticker.leaderScore))} />
                      </TooltipTrigger>
                      <TooltipContent>
                        LeaderScore: {ticker.leaderScore}
                      </TooltipContent>
                    </Tooltip>
                    <span className="font-mono">{ticker.symbol}</span>
                    {ticker.isCore && (
                      <Tooltip>
                        <TooltipTrigger>
                          <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
                        </TooltipTrigger>
                        <TooltipContent>Core member (always in theme)</TooltipContent>
                      </Tooltip>
                    )}
                    {ticker.isPrimary && (
                      <Tooltip>
                        <TooltipTrigger>
                          <span className="text-[9px] text-cyan-400">1°</span>
                        </TooltipTrigger>
                        <TooltipContent>Primary theme assignment</TooltipContent>
                      </Tooltip>
                    )}
                    {/* Overlay Badges */}
                    {getOverlayBadges(ticker.symbol).map((badge) => (
                      <Tooltip key={badge.id}>
                        <TooltipTrigger>
                          <span className={cn(
                            "inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[8px] font-medium border",
                            badge.color
                          )}>
                            {badge.icon}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>{badge.tooltip}</TooltipContent>
                      </Tooltip>
                    ))}
                    <ArrowUpRight className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate max-w-[100px] ml-3.5">
                    {ticker.name}
                  </div>
                </TableCell>

                {/* Price — dollar change when historical, current price otherwise */}
                <TableCell className="font-mono text-xs">
                  {isHistorical && ticker.price != null ? (() => {
                    // Prefer explicit historicalPrice
                    let histPrice = ticker.historicalPrice;
                    // If historicalPrice missing but historicalPct present, reconstruct it
                    if ((histPrice === null || histPrice === undefined) && ticker.historicalPct != null) {
                      const pct = Number(ticker.historicalPct);
                      if (!isNaN(pct) && pct !== -100) {
                        histPrice = ticker.price / (1 + pct / 100);
                      }
                    }

                    if (histPrice != null) {
                      const diff = ticker.price - histPrice;
                      return (
                        <span className={diff >= 0 ? "text-green-400" : "text-red-400"}>
                          {diff >= 0 ? "+" : ""}{diff >= 0 ? `$${diff.toFixed(2)}` : `-$${Math.abs(diff).toFixed(2)}`}
                        </span>
                      );
                    }

                    // Fallback: show current price if no historical info available
                    return ticker.price != null ? `$${ticker.price.toFixed(2)}` : "-";
                  })() : (
                    ticker.price != null ? `$${ticker.price.toFixed(2)}` : "-"
                  )}
                </TableCell>

                {/* Pct — period return when historical, daily pct otherwise */}
                {isHistorical && ticker.historicalPct != null ? (
                  <TableCell className="relative p-0">
                    <div
                      className={cn(
                        "absolute inset-y-0 left-0 opacity-20",
                        ticker.historicalPct >= 0 ? "bg-green-500" : "bg-red-500"
                      )}
                      style={{ width: `${Math.min((Math.abs(ticker.historicalPct) / Math.max(maxAbsPct, 1)) * 100, 100)}%` }}
                    />
                    <div className="relative px-2 py-2 font-mono text-xs">
                      <span className={ticker.historicalPct >= 0 ? "text-green-400" : "text-red-400"}>
                        {ticker.historicalPct >= 0 ? "+" : ""}{ticker.historicalPct.toFixed(2)}%
                      </span>
                    </div>
                  </TableCell>
                ) : (
                  <TableCell className="relative p-0">
                    <div
                      className={cn(
                        "absolute inset-y-0 left-0 opacity-20",
                        ticker.pct >= 0 ? "bg-green-500" : "bg-red-500"
                      )}
                      style={{ width: `${(Math.abs(ticker.pct) / maxAbsPct) * 100}%` }}
                    />
                    <div className="relative px-2 py-2 font-mono text-xs">
                      <span className={ticker.pct >= 0 ? "text-green-400" : "text-red-400"}>
                        {ticker.pct >= 0 ? "+" : ""}{ticker.pct.toFixed(2)}%
                      </span>
                    </div>
                  </TableCell>
                )}

                {/* RS Rank with trophy for top 3 */}
                <TableCell className="font-mono text-[10px]">
                  <div className="flex items-center gap-1">
                    {ticker.rsRank !== undefined && ticker.rsRank <= 3 ? (
                      <Tooltip>
                        <TooltipTrigger>
                          <Trophy className={cn(
                            "w-3 h-3",
                            ticker.rsRank === 1 ? "text-yellow-400" :
                            ticker.rsRank === 2 ? "text-slate-300" :
                            "text-amber-600"
                          )} />
                        </TooltipTrigger>
                        <TooltipContent>
                          #{ticker.rsRank} RS within theme
                        </TooltipContent>
                      </Tooltip>
                    ) : null}
                    <span className={cn(
                      ticker.rsRank !== undefined && ticker.rsRank <= 3 ? "text-cyan-400 font-medium" : "text-muted-foreground"
                    )}>
                      {ticker.rsRank !== undefined ? `#${ticker.rsRank}` : "-"}
                    </span>
                  </div>
                </TableCell>

                {/* Contribution % */}
                <TableCell className="font-mono text-[13px]">
                  {ticker.contributionPct !== undefined && ticker.contributionPct > 0 ? (
                    <Tooltip>
                      <TooltipTrigger>
                        <span className={cn(
                          ticker.contributionPct >= 0.2 ? "text-yellow-400 font-medium" : "text-muted-foreground"
                        )}>
                          {(ticker.contributionPct * 100).toFixed(1)}%
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        Contributes {(ticker.contributionPct * 100).toFixed(1)}% of positive theme move
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </TableCell>

                {/* Leader Score with bar */}
                <TableCell>
                  <div className="flex items-center gap-1">
                    <div className="w-10 h-1.5 bg-slate-700 rounded overflow-hidden">
                      <div
                        className={cn("h-full", getLeaderDotColor(ticker.leaderScore))}
                        style={{ width: `${ticker.leaderScore}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-mono w-5">{ticker.leaderScore}</span>
                  </div>
                </TableCell>

                {/* Volume — always show D-Close/Today split */}
                <TableCell className="font-mono text-[11px]">
                  {ticker.prevDayVolExp != null ? (
                    <>
                      <span className="text-muted-foreground">{ticker.prevDayVolExp.toFixed(2)}x</span>
                      <span className="text-muted-foreground mx-0.5">/</span>
                      <span className={ticker.volExp >= 1.5 ? "text-cyan-400" : "text-muted-foreground"}>{ticker.volExp.toFixed(2)}x</span>
                    </>
                  ) : (
                    <span className={ticker.volExp >= 1.5 ? "text-cyan-400" : "text-muted-foreground"}>
                      {ticker.volExp.toFixed(2)}x
                    </span>
                  )}
                </TableCell>

                {/* A/D */}
                <TableCell>
                  <Tooltip>
                    <TooltipTrigger>
                      <div className={cn(
                        "font-mono text-[13px] font-semibold text-center",
                        !ticker.accDistDays || ticker.accDistDays === 0 ? "text-slate-500" :
                        ticker.accDistDays > 0 ? (
                          ticker.accDistDays >= 3 ? "text-green-300" : "text-green-500"
                        ) : (
                          ticker.accDistDays <= -3 ? "text-red-300" : "text-red-500"
                        )
                      )}>
                        {!ticker.accDistDays || ticker.accDistDays === 0 ? "—" :
                          `${ticker.accDistDays > 0 ? "A" : "D"}:${Math.abs(ticker.accDistDays)}`
                        }
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="font-semibold">Accumulation/Distribution</p>
                      <p className="text-xs">
                        {!ticker.accDistDays || ticker.accDistDays === 0 
                          ? "No streak (flat or first day)"
                          : ticker.accDistDays > 0
                          ? `${ticker.accDistDays} consecutive accumulation days (William O'Neal style)`
                          : `${Math.abs(ticker.accDistDays)} consecutive distribution days (William O'Neal style)`
                        }
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TableCell>

                {/* MA 1 */}
                <TableCell>
                  {(() => {
                    const pct = getPctVsMa(ticker, maCol1);
                    const isNearMa = pct != null && Math.abs(pct) <= maBoldThreshold;
                    return (
                      <span className={cn(
                        "font-mono text-xs inline-block",
                        pct == null ? "text-muted-foreground" : pct >= 0 ? "text-green-400" : "text-red-400",
                        isNearMa && "border border-white rounded px-1"
                      )}>
                        {pct != null ? (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%" : "-"}
                      </span>
                    );
                  })()}
                </TableCell>

                {/* MA 2 */}
                <TableCell>
                  {(() => {
                    const pct = getPctVsMa(ticker, maCol2);
                    const isNearMa = pct != null && Math.abs(pct) <= maBoldThreshold;
                    return (
                      <span className={cn(
                        "font-mono text-xs inline-block",
                        pct == null ? "text-muted-foreground" : pct >= 0 ? "text-green-400" : "text-red-400",
                        isNearMa && "border border-white rounded px-1"
                      )}>
                        {pct != null ? (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%" : "-"}
                      </span>
                    );
                  })()}
                </TableCell>
              </TableRow>
            );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Footer with Add Tickers button (admin only) */}
      {isAdmin && themeId && (
        <div className="p-2 border-t border-slate-700/50">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                variant="ghost" 
                size="sm" 
                className="w-full text-xs text-muted-foreground hover:text-cyan-400"
                onClick={() => setAddDialogOpen(true)}
              >
                <Plus className="w-3 h-3 mr-1" />
                Add Tickers
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Add tickers to this theme's candidate pool (Admin)
            </TooltipContent>
          </Tooltip>
        </div>
      )}
      
      {/* Add Tickers Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Tickers to {themeName}</DialogTitle>
            <DialogDescription>
              Enter ticker symbols separated by commas. They will be added to the candidate pool.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder="e.g. AAPL, MSFT, NVDA"
              value={tickerInput}
              onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && handleAddTickers()}
              disabled={addTickersMutation.isPending}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleAddTickers}
              disabled={addTickersMutation.isPending || !tickerInput.trim()}
            >
              {addTickersMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Checking...
                </>
              ) : (
                "Add"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Conflict Confirmation Dialog */}
      <AlertDialog open={showConflictDialog} onOpenChange={setShowConflictDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-500" />
              Tickers Already Exist
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p className="mb-3">The following tickers already exist in other themes:</p>
                <div className="space-y-1 max-h-48 overflow-auto">
                  {conflicts.map((c) => (
                    <div key={c.ticker} className="flex items-center gap-2 text-sm">
                      <span className="font-mono font-bold">{c.ticker}</span>
                      <span className="text-muted-foreground">→</span>
                      <span>{c.existingTheme}</span>
                      {c.isCore && (
                        <Badge variant="outline" className="text-[10px]">Core</Badge>
                      )}
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-sm">
                  Do you want to add them anyway? (They will appear in multiple themes)
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setShowConflictDialog(false);
              setConflicts([]);
            }}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleForceAdd}>
              Add Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
