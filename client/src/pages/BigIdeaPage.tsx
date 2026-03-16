import { useState, useCallback, useRef, useMemo, useEffect, Component, type ReactNode, type ErrorInfo } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Node,
  Edge,
  Handle,
  Position,
  NodeProps,
  EdgeProps,
  getBezierPath,
  EdgeLabelRenderer,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { SentinelHeader } from "@/components/SentinelHeader";
import { useSystemSettings } from "@/context/SystemSettingsContext";
import { OptimizerMetricsOverlay } from "@/components/OptimizerMetricsOverlay";
import { AskIvyOverlay } from "@/components/AskIvyOverlay";
import { CopyScreenButton } from "@/components/CopyScreenButton";
import { NoIndicatorFoundDialog } from "@/components/bigidea/NoIndicatorFoundDialog";
import { CustomIndicatorPreviewDialog } from "@/components/bigidea/CustomIndicatorPreviewDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel, SelectSeparator } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ChartCandle, ChartIndicators, ChartMarker, DiamondMarker, PriceLevelLine, BaseZone } from "@/components/TradingChart";
import { DualChartGrid, type ChartMetrics } from "@/components/DualChartGrid";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useMarketSurgeSync } from "@/hooks/useMarketSurgeSync";
import { useWatchlist, useAddToWatchlist, useRemoveFromWatchlist, useUpdateWatchlist, useAddToWatchlistWithTradePlan, useSelectedWatchlistId, useWatchlists } from "@/hooks/use-watchlist";
import { WatchlistSelector } from "@/components/WatchlistSelector";
import { BulkAddToWatchlist } from "@/components/BulkAddToWatchlist";
import {
  TrendingUp,
  BarChart3,
  Crosshair,
  Zap,
  Activity,
  Plus,
  Play,
  Save,
  Loader2,
  Music,
  Sparkles,
  GripVertical,
  Ban,
  ArrowDown,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
  Target,
  X,
  HelpCircle,
  Trash2,
  Link2,
  Unlink,
  CornerDownRight,
  CheckCircle2,
  XCircle,
  ThumbsUp,
  ThumbsDown,
  ExternalLink,
  Lightbulb,
  EyeOff,
  Eye,
  Star,
  Layers,
  Minus,
  ClipboardCopy,
  ChevronsDownUp,
  ChevronsUpDown,
  Info,
  Camera,
  GraduationCap,
  Send,
  MessageSquare,
  Newspaper,
} from "lucide-react";
import type {
  ScannerThought,
  ScannerIdea,
  ScannerCriterion,
  ScannerCriterionParam,
  IdeaNode,
  IdeaEdge,
} from "@shared/schema";

const CATEGORY_ICONS: Record<string, typeof TrendingUp> = {
  "Moving Averages": TrendingUp,
  "Volume": BarChart3,
  "Price Action": Crosshair,
  "Relative Strength": Zap,
  "Volatility": Activity,
  "Consolidation": Layers,
  "Momentum": Zap,
  "Value": Target,
  "Trend": TrendingUp,
  "Custom": SlidersHorizontal,
};

const CATEGORY_ORDER = ["Moving Averages", "Volume", "Price Action", "Relative Strength", "Volatility", "Consolidation", "Momentum", "Value", "Trend", "Custom"];

function getScoreColor(score: number): string {
  if (score < 0) return "text-rs-red";
  if (score <= 20) return "text-foreground";
  if (score <= 100) return "text-rs-yellow";
  return "text-rs-green";
}

const INDEX_OPTIONS = [
  { value: "sp500", label: "S&P 500" },
  { value: "russell2000", label: "Russell 2000" },
  { value: "russell3000", label: "Russell 3000" },
];

const PARAM_DESCRIPTIONS: Record<string, string> = {
  period: "Number of bars used in the calculation. For Base Detection (PA-3): the maximum base length to scan for — 20 bars ≈ 1 month. For Close Clustering (PA-15): how many recent bars to check for tight closes — when connected to Base Detection, automatically uses each stock's detected base length. For moving averages and other indicators: the smoothing window.",
  direction: "Above = price must be higher than indicator; Below = must be lower.",
  maType: "SMA weights all bars equally; EMA gives more weight to recent bars, reacting faster to changes.",
  minPct: "Minimum % distance from indicator. Lower = looser (accepts stocks closer); higher = tighter (requires further away).",
  maxPct: "Maximum % distance from indicator. Higher = looser (allows stocks further away); lower = tighter.",
  slopeDays: "Bars to measure trend angle. More bars = smoother slope (looser); fewer = more sensitive (tighter).",
  minSlope: "Minimum slope %. Lower = looser (accepts flatter trends); higher = tighter (needs steeper angle).",
  order: "Bullish = short MA above long MA (uptrend); Bearish = short below long (downtrend).",
  ma1: "Shortest moving average period. Smaller values react faster to price changes.",
  ma2: "Middle moving average period. Should be between the short and long MA.",
  ma3: "Longest moving average period. Larger values represent the overall trend.",
  fastPeriod: "Shorter MA period. Reacts faster to price changes.",
  slowPeriod: "Longer MA period. Shows the bigger-picture trend direction.",
  maxDistance: "Max gap between MAs (%). Higher = looser (allows wider spread); lower = tighter (MAs must be close).",
  lookback: "How far back to look (in bars). For Base Depth (PA-4): the window to find the highest high — 60 bars ≈ 3 months; larger catches bigger moves. For Base Count (PA-5): the history to scan for base formations. For Breakout (PA-7): how many recent bars to check for a breakout candle (1-3 = just happened; 10 = within last 2 weeks).",
  crossType: "Bullish = fast MA crosses above slow (golden cross); Bearish = fast crosses below (death cross).",
  minMultiple: "Min volume vs average. Lower = looser (accepts lower volume); higher = tighter (needs bigger spikes).",
  recentPeriod: "Recent bars to measure. More bars = smoother reading (looser); fewer = more current snapshot (tighter).",
  baselineBars: "Window of bars used as the 'normal' baseline to compare against. When connected to Base Detection (PA-3), this automatically uses each stock's detected base length instead. Without a connection, uses this static value.",
  baselinePeriod: "Earlier bars used as baseline. More bars = broader comparison; fewer = more recent baseline.",
  threshold: "Min change % to trigger. Lower = looser (catches smaller moves); higher = tighter (needs bigger moves).",
  minRatio: "Min up/down volume ratio. >1.0 = accumulation (more buying than selling); <1.0 = distribution (more selling). 1.2 = mild buying; 1.5+ = strong institutional demand. Lower = looser; higher = tighter.",
  maxRatio: "Maximum allowed ratio of recent activity vs the baseline 'normal'. For Tightness Ratio (PA-14): compares recent daily candle size to historical average — 0.5 = candles are half their normal size (very tight); 0.8 = slightly compressed; 1.0 = no compression at all. For Volume Fade (PA-16): compares recent volume to historical average — 0.5 = volume is half of normal (very quiet); 0.9 = slightly below normal. Lower = stricter, fewer results.",
  ratioPeriod: "Bars for volume ratio calculation. More = smoother; fewer = more recent snapshot.",
  consolidationDays: "Min bars in the consolidation range. Fewer = looser; more = tighter (needs longer consolidation).",
  maxRange: "Max price range during consolidation (%). This is the ceiling for long bases (20+ bars). For shorter bases, the allowed range tightens automatically — a 5-bar base allows only ~30% of this value.",
  breakoutDir: "Direction of breakout: Up = bullish breakout; Down = bearish breakdown.",
  nearHighPct: "How close price must be to the high (%). Higher = looser (further from high OK); lower = tighter.",
  highLookback: "Bars to look back for the high. More = finds higher peaks (tighter); fewer = more recent (looser).",
  fromHigh: "Whether to measure the drop from the absolute highest price in the lookback window.",
  minDrop: "Min % drop from high. Lower = looser (catches shallow drops); higher = tighter (needs deeper pullback).",
  maxDrop: "Max % drop from high. Higher = looser (allows deeper drops); lower = tighter (limits the pullback).",
  minGain: "Minimum price gain (%) the stock must have made during the advance window. For Prior Advance (PA-12) and Smooth Advance (PA-13): 30% = solid run-up before the base; 50%+ = strong momentum leader. Lower values catch more stocks; higher values find only big movers.",
  days: "Number of bars to measure the change over. More = longer-term view; fewer = short-term.",
  aboveVWAP: "Whether price should be above or below the VWAP line.",
  gapDir: "Gap direction: Up = opened higher than previous close; Down = opened lower.",
  minGapPct: "Min gap size %. Lower = looser (catches small gaps); higher = tighter (needs larger gaps).",
  bodyRatio: "Min candle body vs total range. Lower = looser (allows more shadow); higher = tighter (needs solid body).",
  upperShadowMax: "Max upper shadow ratio. Higher = looser (allows more wick); lower = tighter (needs clean top).",
  lowerShadowMax: "Max lower shadow ratio. Higher = looser (allows more tail); lower = tighter (needs clean bottom).",
  pattern: "Type of candlestick pattern to detect.",
  tolerance: "Allowed deviation from exact match %. Higher = looser (more forgiving); lower = tighter (stricter match).",
  minRSI: "Min RSI value (0=oversold). Lower = looser (accepts weaker momentum); higher = tighter.",
  maxRSI: "Max RSI value (100=overbought). Higher = looser; lower = tighter (filters out hot stocks).",
  signalPeriod: "MACD signal line period. Larger = smoother, slower signals.",
  condition: "Signal condition to check for (crossover, histogram direction, etc.).",
  minADX: "Min ADX value. Lower = looser (accepts weaker trends); higher = tighter (needs strong trend).",
  requireBullish: "Only pass if +DI > -DI (bullish directional bias).",
  stdDev: "Bollinger Band width multiplier. Higher = wider bands (looser); lower = narrower (tighter).",
  maxWidth: "Max band width %. Higher = looser (allows wider bands); lower = tighter (needs tight squeeze).",
  minWidth: "Min band width %. Lower = looser; higher = tighter (filters out very narrow bands).",
  atrPeriod: "ATR calculation period. Larger = smoother ATR reading.",
  recentDays: "Recent bars to compare. More = smoother (looser); fewer = more sensitive (tighter).",
  baselineDays: "Earlier bars used as baseline. More = broader comparison period.",
  percentile: "Rank position in range (0-100). 50 = median, 90 = near top.",
  minPercentile: "Min percentile rank. Lower = looser (accepts lower rank); higher = tighter (needs top performers).",
  maxPercentile: "Max percentile rank. Higher = looser; lower = tighter (limits to a specific range).",
  rankPeriod: "Bars for the ranking window. More = longer comparison period.",
  avgPeriod: "Bars for the averaging window.",
  rsMinPct: "Min relative strength %. Lower = looser; higher = tighter (needs stronger outperformance).",
  benchmarkPeriod: "Benchmark comparison period in bars.",
  minPrice: "Min stock price. Lower = looser (includes cheaper stocks); higher = filters out penny stocks.",
  maxPrice: "Max stock price. Higher = looser; lower = filters out expensive stocks.",
  minVolume: "Min average daily volume. Lower = looser (includes thinly traded); higher = needs more liquid stocks.",
  minMarketCap: "Min market cap (millions). Lower = looser (includes small caps); higher = large caps only.",
  segments: "Number of contraction segments to detect in VCP. Fewer = looser (easier to find); more = tighter (needs more defined staircase pattern).",
  level: "Level type to measure distance from. VWAP = volume-weighted average price; Pivot = key support/resistance.",
  minDistance: "Min distance from reference level (%). Lower = looser; higher = tighter.",
  consolidationRange: "Max price range (high to low) allowed during a single base formation (%). Used by Base Count (PA-5) to define what counts as a base. 15% = standard; tighter values (8-10%) find only the flattest consolidations.",
  minBaseDays: "Minimum number of bars a consolidation must last to count as a base. Used by Base Count (PA-5). 10 bars ≈ 2 weeks. Fewer = catches short pauses; more = only counts well-formed, multi-week bases.",
  maxBases: "Maximum number of separate base formations allowed during the advance. Used by Base Count (PA-5). First and second bases are highest probability — later bases (3rd, 4th) often fail. Set to 2 for only early-stage stocks.",
  maxDepth: "Deepest allowed pullback from the high (%). Used by Base Depth (PA-4). 15% = shallow base (tight, institutional holding); 25% = moderate; 40%+ = deep correction. Shallower bases typically signal stronger demand.",
  minDepth: "Shallowest allowed pullback (%). Used by Base Depth (PA-4). Filters out stocks that haven't pulled back enough to form a real base. 3-5% = accept very tight bases; 10%+ = require a meaningful dip first.",
  dryUpDays: "Bars of declining volume needed. Fewer = looser; more = tighter.",
  surgeMultiple: "Min volume surge vs average. Lower = looser; higher = tighter (needs bigger volume spike).",
  volumeMultiple: "How much higher volume must be vs the 50-day average. Used by Breakout Detection (PA-7). 1.5× = moderate confirmation; 2× = strong institutional interest; 3×+ = very high conviction breakout. Only applies when Volume Confirm is turned on.",
  volumeConfirm: "When enabled, the breakout bar must have above-average volume (controlled by Volume Multiple). Helps filter out low-conviction breakouts that are more likely to fail.",
  priceUp: "Require price to close up on the signal bar.",
  minOutperformance: "Min outperformance vs benchmark (%). Lower = looser; higher = tighter.",
  minScore: "Min composite score. Lower = looser (more results); higher = tighter (only best).",
  maxMultiple: "Max volume vs 50-day average. For Volume Dry-Up (VOL-4): 0.5 = volume must be half of normal (very quiet); 0.8 = slightly below average. Lower = stricter (needs quieter volume); higher = looser.",
  minATR: "Min ATR value. Lower = looser; higher = needs more volatility.",
  maxATR: "Max ATR value. Higher = looser; lower = tighter (calmer stocks only).",
  maPeriod: "Moving average period used in the calculation. For Pullback to Level (PA-8): the MA line the stock is pulling back to (21 = 21-day EMA, a popular support level).",
  basePeriod: "Length of the consolidation range before the breakout (in bars). Used by Breakout Detection (PA-7). Should match your Base Detection period so the breakout is measured from the right zone. 20 bars ≈ 1 month of trading.",
  bbPeriod: "Bollinger Band period.",
  bbStdDev: "Bollinger Band standard deviation multiplier.",
  kcPeriod: "Keltner Channel period.",
  kcMult: "Keltner Channel ATR multiplier.",
  gapDirection: "Gap direction: Up = opened above prior close; Down = opened below.",
  skipBars: "How many recent bars to skip over (the base itself) before measuring the advance. If connected to a Base Detection thought, this automatically uses the per-stock detected base length instead. Otherwise, set manually to match your expected base size — 20 = skip 1 month of consolidation.",
  lookbackBars: "How far back to measure the advance that came before the base (in bars). 120 bars ≈ 6 months. This is the 'run-up' window — larger values require a longer sustained advance; smaller values catch shorter moves.",
  minPeriod: "Shortest acceptable base length in bars (hard floor: 5). Works alongside Min Base % of Lookback to set the effective minimum.",
  maxSlope: "Max allowed slope across the base (%). Measures how much the base drifts up or down. Lower = flatter bases only; higher = allows some tilt.",
  drifterPct: "Percentage of bars allowed to poke outside the range without breaking detection. Drifter bars (e.g. wicks, gap bars) are counted but don't expand the base high/low. 10% on a 20-bar base = 2 drifter bars allowed. This mainly affects how far the base extends (the detected length passed to downstream indicators like Prior Advance), not which stocks pass. To change pass/fail results, adjust Max Range %, Max Slope %, or Min Base Length instead.",
  minBasePct: "Detected base must be at least this % of the Max Base Length. Example: 50% on a 100-bar lookback requires at least a 50-bar base. At 0% (default), only the Min Base Length setting controls the minimum. Raise this to filter out bases that are too short relative to your lookback window.",
  maxDrawdown: "Maximum pullback from a rolling high allowed during the advance (%). Used by Smooth Advance (PA-13). 15% = very smooth staircase advance; 25% = allows normal corrections; 35%+ = tolerates volatile run-ups. Lower values find only the cleanest advances.",
  smaPeriod: "Moving average period used to check trend health during the advance. Used by Smooth Advance (PA-13). 50-day SMA is the institutional trend line — price staying above it shows strong demand. Shorter periods (20) are more sensitive; longer (200) is the big-picture trend.",
  minBarsAboveSMA: "What percentage of bars during the advance must close above the SMA (%). Used by Smooth Advance (PA-13). 70% = price was above the MA most of the time (healthy trend); 90% = very clean advance; 50% = allows more back-and-forth.",
  recentBars: "Number of recent bars that define the 'tight zone' being measured. For Tightness Ratio (PA-14): 5 bars = last week's candle sizes vs normal. For Volume Fade (PA-16): 10 bars = last 2 weeks of volume vs normal. Smaller = more sensitive to very recent action; larger = smoother read.",
  maxClusterPct: "Maximum allowed spread of closing prices (standard deviation as % of average close). Used by Close Clustering (PA-15). 1% = closes barely move day-to-day (very tight coil); 2% = reasonably clustered; 3%+ = loose, wandering closes. Think of it as how much the close 'jiggles' — lower = quieter.",
  skipRecentBars: "How many of the most recent bars to skip before searching for a historical base. Auto-links to PA-3's period when both are in the scan, preventing the historical base from overlapping with the current base detection zone. 0 = start from the most recent bar (may overlap); 20 = skip the last month.",
  maxRetracement: "Maximum % of the advance the stock can give back. Prevents 'advance then collapse' patterns where price ran up but dropped back down before forming a base. 50% = stock must retain at least half its gains; 75% = allows a deeper pullback; 100% (default) = no retracement check.",
};

interface DynamicDataConsumer {
  thoughtId: string;
  thoughtName: string;
  indicatorName: string;
  params: Array<{ label: string; dataKey: string; value: any }>;
}

interface DynamicDataProvider {
  providerId: string;
  providerName: string;
  providerIndicator: string;
  detectedValues: Record<string, any>;
  lookbackSetting?: number;
  lookbackLabel?: string;
  consumers: DynamicDataConsumer[];
}

interface CriterionResultItem {
  indicatorId: string;
  indicatorName: string;
  pass: boolean;
  inverted: boolean;
  diagnostics?: { value: string; threshold: string; detail?: string };
  cocHighlight?: { type: string; level?: number; startBar?: number; endBar?: number; barIndex?: number; gapPct?: number; barCount?: number; topPrice?: number; lowPrice?: number };
  cocHighlight2?: { type: string; level?: number; startBar?: number; endBar?: number };
}

interface ThoughtBreakdownItem {
  thoughtId: string;
  thoughtName: string;
  pass: boolean;
  criteriaResults: CriterionResultItem[];
}

interface ScanResultItem {
  symbol: string;
  name: string;
  price: number;
  passedPaths: string[];
  dynamicData?: DynamicDataProvider[];
  thoughtBreakdown?: ThoughtBreakdownItem[];
}

interface ScanResponse {
  results: ScanResultItem[];
  thoughtCounts: Record<string, number>;
  totalScanned: number;
  linkOverrides?: Array<{ thoughtId: string; thoughtName: string; paramName: string; indicatorId: string; originalValue: any; linkedValue: any; sourceName: string }>;
  dynamicDataFlows?: Array<{ provider: string; consumer: string; dataKey: string; description: string }>;
  funnelData?: any;
  sessionId?: number;
}

interface TuningSuggestion {
  type?: "param_change" | "add_criterion" | "remove_criterion";
  indicatorId: string;
  indicatorName: string;
  paramName?: string;
  currentValue?: number;
  suggestedValue?: number;
  reason: string;
  thoughtId?: string;
  criterion?: ScannerCriterion;
}

interface TuningResult {
  suggestions: TuningSuggestion[];
  overallAnalysis: string;
  tuningId: number;
}

interface QualityDimension {
  name: string;
  score: number;
  maxScore: number;
  grade: "A" | "B" | "C" | "D" | "F";
  details: string[];
  suggestions: string[];
}

interface ScanQualityResult {
  overallScore: number;
  maxScore: number;
  grade: "A" | "B" | "C" | "D" | "F";
  dimensions: QualityDimension[];
}

const GRADE_COLORS: Record<string, string> = {
  A: "text-rs-green",
  B: "text-rs-green",
  C: "text-rs-yellow",
  D: "text-rs-amber",
  F: "text-rs-red",
};

const GRADE_BG_COLORS: Record<string, string> = {
  A: "bg-rs-green/20 border-rs-green/30",
  B: "bg-rs-green/20 border-rs-green/30",
  C: "bg-rs-yellow/20 border-rs-yellow/30",
  D: "bg-rs-amber/20 border-rs-amber/30",
  F: "bg-rs-red/20 border-rs-red/30",
};

function getCategoryIcon(category: string) {
  const Icon = CATEGORY_ICONS[category] || SlidersHorizontal;
  return <Icon className="h-4 w-4" />;
}

function ThoughtNodeComponent({ data, selected }: NodeProps) {
  const isNot = data.isNot as boolean;
  const isMuted = data.isMuted as boolean;
  const passCount = data.passCount as number | undefined;
  const category = data.category as string;
  const allCriteria = (data.criteria as ScannerCriterion[]) || [];
  const activeCriteriaCount = allCriteria.filter(c => !c.muted).length;
  const mutedCount = allCriteria.length - activeCriteriaCount;
  const onClear = data.onClear as (() => void) | undefined;
  const onDelete = data.onDelete as (() => void) | undefined;

  return (
    <div
      className={`rounded-md border-2 px-3 py-2 min-w-[180px] ${
        isMuted
          ? "border-muted bg-muted/30 opacity-50"
          : isNot
          ? "border-rs-red bg-rs-red/10"
          : selected
          ? "border-primary bg-card"
          : "border-border bg-card"
      }`}
      data-testid={`node-thought-${data.nodeId}`}
    >
      <Handle type="target" position={Position.Left} className="!bg-muted-foreground !w-2 !h-2" />
      <div className="flex items-center gap-2 mb-1">
        {getCategoryIcon(category)}
        <span className={`text-sm font-medium truncate flex-1 ${isMuted ? "line-through text-muted-foreground" : ""}`}>{data.label as string}</span>
        <div className="flex items-center gap-0.5 shrink-0">
          {onClear && (
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={(e) => { e.stopPropagation(); onClear(); }}
              title="Remove from canvas"
              data-testid={`button-clear-node-${data.nodeId}`}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
          {onDelete && (
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 text-rs-red"
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              title="Delete from library"
              data-testid={`button-delete-node-${data.nodeId}`}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="outline" className="text-xs">
          {activeCriteriaCount} criteria{mutedCount > 0 ? ` (${mutedCount} muted)` : ""}
        </Badge>
        {!!data.timeframe && String(data.timeframe) !== "daily" && (
          <Badge variant="outline" className="text-[10px] bg-blue-500/20 text-blue-400 border-blue-500/30">
            {String(data.timeframe) === "5min" ? "5m" : String(data.timeframe) === "15min" ? "15m" : String(data.timeframe) === "30min" ? "30m" : String(data.timeframe)}
          </Badge>
        )}
        {passCount !== undefined && !isMuted && (
          <Badge
            variant="outline"
            className={`text-xs ${passCount > 0 ? "bg-rs-green/20 text-rs-green border-rs-green/30" : "text-muted-foreground"}`}
          >
            {passCount} pass
          </Badge>
        )}
        {isMuted && (
          <Badge variant="outline" className="text-xs bg-muted/50 text-muted-foreground border-muted">
            MUTED
          </Badge>
        )}
        {isNot && !isMuted && (
          <Badge variant="outline" className="text-xs bg-rs-red/20 text-rs-red border-rs-red/30">
            NOT
          </Badge>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="!bg-muted-foreground !w-2 !h-2" />
    </div>
  );
}

function ResultsNodeComponent({ data }: NodeProps) {
  const totalCount = data.totalCount as number | undefined;

  const countColor =
    totalCount === undefined
      ? "text-muted-foreground"
      : totalCount === 0
      ? "text-rs-red"
      : totalCount <= 50
      ? "text-rs-green"
      : "text-rs-yellow";

  return (
    <div
      className="rounded-md border-2 border-primary bg-primary/10 px-4 py-3 min-w-[140px] text-center"
      data-testid="node-results"
    >
      <Handle type="target" position={Position.Left} className="!bg-primary !w-2 !h-2" />
      <div className="flex items-center justify-center gap-2 mb-1">
        <Target className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">Results</span>
      </div>
      <span className={`text-2xl font-bold ${countColor}`}>
        {totalCount !== undefined ? totalCount : "--"}
      </span>
    </div>
  );
}

function LogicEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  style = {},
}: EdgeProps) {
  const logicType = (data?.logicType as string) || "AND";
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const isAnd = logicType === "AND";

  return (
    <>
      <path
        id={id}
        style={style}
        className={`react-flow__edge-path ${isAnd ? "stroke-blue-400" : "stroke-amber-400"}`}
        d={edgePath}
        strokeWidth={2}
        fill="none"
      />
      <EdgeLabelRenderer>
        <div
          className="absolute flex items-center gap-1"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: "all",
          }}
        >
          <div
            className={`text-xs font-bold px-2 py-0.5 rounded-md border cursor-pointer select-none ${
              isAnd
                ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
                : "bg-rs-amber/20 text-rs-amber border-rs-amber/30"
            }`}
            data-testid={`edge-label-${id}`}
            onClick={(e) => {
              e.stopPropagation();
              if (data?.onToggle) {
                (data.onToggle as () => void)();
              }
            }}
          >
            {logicType}
          </div>
          <button
            className="flex items-center justify-center w-7 h-7 rounded-full bg-rs-red/30 text-rs-red border-2 border-rs-red/50 cursor-pointer active-elevate-2 shadow-sm"
            onClick={(e) => {
              e.stopPropagation();
              if (data?.onDelete) {
                (data.onDelete as () => void)();
              }
            }}
            data-testid={`edge-delete-${id}`}
          >
            <X className="h-4 w-4" strokeWidth={3} />
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = {
  thought: ThoughtNodeComponent,
  results: ResultsNodeComponent,
};

const edgeTypes = {
  logic: LogicEdge,
};

const INITIAL_RESULTS_NODE: Node = {
  id: "results-node",
  type: "results",
  position: { x: 600, y: 200 },
  data: { totalCount: undefined },
  deletable: false,
};

export default function BigIdeaPage() {
  const { cssVariables } = useSystemSettings();
  const { toast } = useToast();
  const { data: userWatchlists } = useWatchlists();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([INITIAL_RESULTS_NODE]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const [ideaName, setIdeaName] = useState("Untitled Idea");
  const [loadedIdeaName, setLoadedIdeaName] = useState<string | null>(null);
  const [universe, setUniverse] = useState("sp500");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [previewThoughtId, setPreviewThoughtId] = useState<number | null>(null);
  const [currentIdeaId, setCurrentIdeaId] = useState<number | null>(null);
  const [renameForkOpen, setRenameForkOpen] = useState(false);

  const [scanResults, setScanResults] = useState<ScanResultItem[] | null>(null);
  const [scanTotalScanned, setScanTotalScanned] = useState(0);
  const [showResults, setShowResults] = useState(false);
  const [resultSort, setResultSort] = useState<"ticker" | "price">("ticker");
  const [resultSortDir, setResultSortDir] = useState<"asc" | "desc">("asc");

  const [chartViewerOpen, setChartViewerOpen] = useState(false);
  const [chartViewerIndex, setChartViewerIndex] = useState(0);
  const [chartNavigationMode, setChartNavigationMode] = useState<'scan' | 'watchlist'>('scan');

  const [thoughtsPanelWidth, setThoughtsPanelWidth] = useState(320);
  const thoughtsResizing = useRef(false);

  const handleThoughtsResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    thoughtsResizing.current = true;
    const startX = e.clientX;
    const startW = thoughtsPanelWidth;
    const onMove = (ev: PointerEvent) => {
      const delta = ev.clientX - startX;
      setThoughtsPanelWidth(Math.max(200, Math.min(500, startW + delta)));
    };
    const onUp = () => {
      thoughtsResizing.current = false;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }, [thoughtsPanelWidth]);

  const [detailPanelWidth, setDetailPanelWidth] = useState(340);
  const detailResizing = useRef(false);

  const handleDetailResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    detailResizing.current = true;
    const startX = e.clientX;
    const startW = detailPanelWidth;
    const onMove = (ev: PointerEvent) => {
      const delta = startX - ev.clientX;
      setDetailPanelWidth(Math.max(280, Math.min(600, startW + delta)));
    };
    const onUp = () => {
      detailResizing.current = false;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }, [detailPanelWidth]);

  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [aiDescription, setAiDescription] = useState("");
  const [aiProposal, setAiProposal] = useState<any>(null);
  const [refinementChat, setRefinementChat] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [refinementInput, setRefinementInput] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<{ thoughtId: number; name: string; nodeId?: string } | null>(null);
  const [customIndicatorDialog, setCustomIndicatorDialog] = useState<any>(null);
  const [customIndicatorPreview, setCustomIndicatorPreview] = useState<any>(null);
  const [restateText, setRestateText] = useState("");
  const [restateNodeId, setRestateNodeId] = useState<string | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugInfo, setDebugInfo] = useState<any>(null);
  const [qualityResult, setQualityResult] = useState<ScanQualityResult | null>(null);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [lastFunnelData, setLastFunnelData] = useState<any>(null);
  const [scanSessionId, setScanSessionId] = useState<number | undefined>(undefined);
  const [tuneDialogOpen, setTuneDialogOpen] = useState(false);
  const [tuneInstruction, setTuneInstruction] = useState("");
  const [tuneResult, setTuneResult] = useState<TuningResult | null>(null);
  const [acceptedTuneIndices, setAcceptedTuneIndices] = useState<Set<number>>(new Set());
  const [tuningDirty, setTuningDirty] = useState(false);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [tuningPreSnapshot, setTuningPreSnapshot] = useState<any>(null);
  const [tuningId, setTuningId] = useState<number | null>(null);
  const [preTuneResultCount, setPreTuneResultCount] = useState<number>(0);
  const [preTuneSymbols, setPreTuneSymbols] = useState<string[]>([]);
  const [tuneRescanDone, setTuneRescanDone] = useState(false);
  const [unsavedTuningDialog, setUnsavedTuningDialog] = useState(false);
  const [pendingNavAction, setPendingNavAction] = useState<(() => void) | null>(null);
  const [saveBeforeNewOpen, setSaveBeforeNewOpen] = useState(false);

  const { data: thoughts = [], isLoading: thoughtsLoading } = useQuery<ScannerThought[]>({
    queryKey: ["/api/bigidea/thoughts"],
  });

  const { data: ideas = [] } = useQuery<ScannerIdea[]>({
    queryKey: ["/api/bigidea/ideas"],
  });

  type IndicatorMeta = {
    id: string;
    name: string;
    description?: string;
    params: Array<{ name: string; label?: string; type?: string; defaultValue?: number; min?: number; max?: number; step?: number; autoLink?: { linkType: string; sourceParam?: string } }>;
    provides?: Array<{ linkType: string; paramName: string }>;
    consumes?: Array<{ paramName: string; dataKey: string }>;
  };
  const { data: indicatorLibrary = [] } = useQuery<IndicatorMeta[]>({
    queryKey: ["/api/bigidea/indicators"],
  });

  const { data: watchlist } = useWatchlist();

  // Handle deep link from dashboard
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const navMode = params.get('navMode');
    const symbol = params.get('symbol');
    
    if (navMode === 'watchlist' && symbol && watchlist) {
      setChartNavigationMode('watchlist');
      
      // Find index of symbol in watchlist
      const index = watchlist.findIndex(w => w.symbol === symbol);
      if (index >= 0) {
        // Convert watchlist to scan result format
        const watchlistResults = watchlist.map(w => ({
          symbol: w.symbol,
          price: 0,
          passedPaths: [] as string[],
        }));
        setScanResults(watchlistResults);
        setChartViewerIndex(index);
        setChartViewerOpen(true);
        
        // Clear URL params after handling
        window.history.replaceState({}, '', '/sentinel/bigidea');
      }
    }
  }, [watchlist]);

  useEffect(() => {
    if (indicatorLibrary.length === 0) return;
    setNodes((nds) =>
      nds.map((n) => {
        if (n.type !== "thought" || !n.data.criteria) return n;
        const criteria = (n.data.criteria as ScannerCriterion[]).map((c) => {
          const indMeta = indicatorLibrary.find((i) => i.id === c.indicatorId);
          if (!indMeta) return c;
          let changed = false;
          const newParams = c.params.map((p) => {
            if (p.autoLink) return p;
            const metaParam = indMeta.params.find((mp) => mp.name === p.name);
            if (metaParam?.autoLink) {
              changed = true;
              return { ...p, autoLink: metaParam.autoLink, autoLinked: p.autoLinked !== false };
            }
            return p;
          });
          return changed ? { ...c, params: newParams } : c;
        });
        return { ...n, data: { ...n.data, criteria } };
      })
    );
  }, [indicatorLibrary, setNodes]);

  const createThoughtMutation = useMutation({
    mutationFn: async (body: any) => {
      const res = await apiRequest("POST", "/api/bigidea/thoughts", body);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/bigidea/thoughts"] });
      setAiDialogOpen(false);
      setAiProposal(null);
      setAiDescription("");
      setRefinementChat([]);
      if (data?.timeframeWarning) {
        toast({ title: "Timeframe Auto-Corrected", description: data.timeframeWarning, duration: 8000 });
      } else {
        toast({ title: "Thought saved" });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Failed to save thought", description: err.message, variant: "destructive" });
    },
  });

  const saveAndPlaceMultiThoughts = useMutation({
    mutationFn: async (proposal: { thoughts: any[]; edges: any[] }) => {
      const savedThoughts: any[] = [];
      for (const t of proposal.thoughts) {
        if (t.reuseThoughtId) {
          savedThoughts.push({ ...t, id: t.reuseThoughtId, thoughtKey: t.thoughtKey });
          continue;
        }
        const res = await apiRequest("POST", "/api/bigidea/thoughts", {
          name: t.name,
          category: t.category,
          description: t.description,
          criteria: t.criteria,
          timeframe: t.timeframe || "daily",
          aiPrompt: aiDescription,
        });
        const saved = await res.json();
        savedThoughts.push({ ...saved, thoughtKey: t.thoughtKey });
      }
      return { savedThoughts, edges: proposal.edges };
    },
    onSuccess: ({ savedThoughts, edges }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/bigidea/thoughts"] });

      // Check for timeframe auto-correction warnings
      const warnings = savedThoughts.filter((t: any) => t.timeframeWarning);
      if (warnings.length > 0) {
        toast({
          title: "Timeframe Auto-Corrected",
          description: warnings[0].timeframeWarning,
          duration: 8000,
        });
      }

      const viewport = reactFlowInstance?.getViewport();
      const centerX = viewport ? (-viewport.x + 300) / (viewport.zoom || 1) : 300;
      const centerY = viewport ? (-viewport.y + 200) / (viewport.zoom || 1) : 200;

      const keyToNodeId: Record<string, string> = { "RESULTS": "results-node" };
      const newNodes: Node[] = savedThoughts.map((t, idx) => {
        const nodeId = `thought-${t.id}-${Date.now()}-${idx}`;
        keyToNodeId[t.thoughtKey] = nodeId;

        const enrichedCriteria = (t.criteria || []).map((c: ScannerCriterion) => {
          const indMeta = indicatorLibrary.find((i) => i.id === c.indicatorId);
          if (!indMeta) return c;
          return {
            ...c,
            params: c.params.map((p: any) => {
              const metaParam = indMeta.params.find((mp) => mp.name === p.name);
              if (metaParam?.autoLink) {
                return { ...p, autoLink: metaParam.autoLink, autoLinked: p.autoLinked !== false };
              }
              return p;
            }),
          };
        });

        return {
          id: nodeId,
          type: "thought",
          position: { x: centerX + idx * 320, y: centerY },
          data: {
            nodeId: t.id,
            label: t.name,
            category: t.category,
            description: t.description,
            criteria: enrichedCriteria,
            timeframe: t.timeframe || "daily",
            thoughtId: t.id,
            isNot: false,
            isMuted: false,
            passCount: undefined,
          },
        };
      });

      const makeEdgeCallbacks = (edgeId: string, logicType: string = "AND") => ({
        logicType,
        onToggle: () => {
          setEdges((eds) =>
            eds.map((e) => {
              if (e.id === edgeId) {
                const current = e.data?.logicType === "AND" ? "OR" : "AND";
                return { ...e, data: { ...e.data, logicType: current, onToggle: e.data?.onToggle, onDelete: e.data?.onDelete } };
              }
              return e;
            })
          );
        },
        onDelete: () => {
          setEdges((eds) => eds.filter((e) => e.id !== edgeId));
        },
      });

      const dataEdges: Edge[] = (edges || []).map((e: any) => {
        const edgeId = `e-${keyToNodeId[e.from]}-${keyToNodeId[e.to]}`;
        return {
          id: edgeId,
          source: keyToNodeId[e.from],
          target: keyToNodeId[e.to],
          type: "logic",
          data: makeEdgeCallbacks(edgeId, e.logicType || "AND"),
        };
      }).filter((e: Edge) => e.source && e.target);

      const resultsNodeId = "results-node";
      const hasOutgoingDataEdge = new Set<string>();
      dataEdges.forEach((e) => hasOutgoingDataEdge.add(e.source));

      const scanFlowEdges: Edge[] = newNodes
        .filter((n) => !hasOutgoingDataEdge.has(n.id))
        .map((n) => {
          const edgeId = `e-${n.id}-${resultsNodeId}`;
          return {
            id: edgeId,
            source: n.id,
            target: resultsNodeId,
            type: "logic",
            data: makeEdgeCallbacks(edgeId),
          };
        });

      setNodes((nds) => [...nds, ...newNodes]);
      setEdges((eds) => [...eds, ...dataEdges, ...scanFlowEdges]);

      setAiDialogOpen(false);
      setAiProposal(null);
      setAiDescription("");
      setRefinementChat([]);
      toast({ title: `${savedThoughts.length} thought${savedThoughts.length > 1 ? "s" : ""} saved and placed on canvas` });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to save thoughts", description: err.message, variant: "destructive" });
    },
  });

  const aiCreateMutation = useMutation({
    mutationFn: async (description: string) => {
      const res = await apiRequest("POST", "/api/bigidea/ai/create-thought", { description });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.needsCustomIndicator) {
        setCustomIndicatorDialog(data);
        setAiDialogOpen(false);
      } else {
        setAiProposal(data);
        setRefinementChat([]);
      }
    },
    onError: (err: Error) => {
      toast({ title: "AI generation failed", description: err.message, variant: "destructive" });
    },
  });

  const refineProposalMutation = useMutation({
    mutationFn: async ({ message }: { message: string }) => {
      const res = await apiRequest("POST", "/api/bigidea/ai/refine-proposal", {
        currentProposal: aiProposal,
        message,
        conversationHistory: refinementChat,
        originalDescription: aiDescription,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setRefinementChat(prev => [
        ...prev,
        { role: "user", content: refinementInput },
        { role: "assistant", content: data.response },
      ]);
      setAiProposal(data.proposal);
      setRefinementInput("");
    },
    onError: (err: Error) => {
      toast({ title: "AI refinement failed", description: err.message, variant: "destructive" });
    },
  });

  const restateMutation = useMutation({
    mutationFn: async ({ nodeId, description }: { nodeId: string; description: string }) => {
      const node = nodes.find(n => n.id === nodeId);
      const currentCriteria = node?.data?.criteria as ScannerCriterion[] | undefined;
      const currentName = node?.data?.label as string | undefined;
      const currentDescription = node?.data?.description as string | undefined;

      const aiRes = await apiRequest("POST", "/api/bigidea/ai/restate-thought", {
        instruction: description,
        currentCriteria: currentCriteria || [],
        currentName: currentName || "",
        currentDescription: currentDescription || "",
      });
      const aiData = await aiRes.json();

      const enrichedCriteria = (aiData.criteria || []).map((c: ScannerCriterion) => {
        const indMeta = indicatorLibrary.find((i) => i.id === c.indicatorId);
        if (!indMeta) return c;
        return {
          ...c,
          params: c.params.map((p: any) => {
            const metaParam = indMeta.params.find((mp) => mp.name === p.name);
            if (metaParam?.autoLink) {
              return { ...p, autoLink: metaParam.autoLink, autoLinked: p.autoLinked !== false };
            }
            return p;
          }),
        };
      });

      const thoughtId = node?.data?.thoughtId as number | undefined;
      if (thoughtId) {
        await apiRequest("PATCH", `/api/bigidea/thoughts/${thoughtId}`, {
          name: aiData.name,
          category: aiData.category,
          description: aiData.description,
          criteria: enrichedCriteria,
          aiPrompt: description,
        });
      }
      return { nodeId, aiData: { ...aiData, criteria: enrichedCriteria }, thoughtId };
    },
    onSuccess: ({ nodeId, aiData }, variables) => {
      setNodes(prev => prev.map(n => {
        if (n.id !== nodeId) return n;
        return {
          ...n,
          data: {
            ...n.data,
            label: n.data.userRenamed ? n.data.label : aiData.name,
            category: aiData.category,
            description: aiData.description,
            criteria: aiData.criteria,
            aiPrompt: variables.description,
          },
        };
      }));
      setRestateNodeId(null);
      setRestateText("");
      queryClient.invalidateQueries({ queryKey: ["/api/bigidea/thoughts"] });
      toast({ title: "Thought updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Restate failed", description: err.message, variant: "destructive" });
    },
  });

  const buildIdeaBody = useCallback(() => {
    const ideaNodes: IdeaNode[] = nodes.map((n) => ({
      id: n.id,
      type: n.type as "thought" | "results",
      thoughtId: n.data.thoughtId as number | undefined,
      thoughtName: n.data.label as string | undefined,
      thoughtCategory: n.data.category as string | undefined,
      thoughtDescription: n.data.description as string | undefined,
      thoughtCriteria: n.data.criteria as ScannerCriterion[] | undefined,
      thoughtTimeframe: (n.data.timeframe as string | undefined) || "daily",
      isNot: n.data.isNot as boolean | undefined,
      isMuted: n.data.isMuted as boolean | undefined,
      userRenamed: n.data.userRenamed as boolean | undefined,
      position: n.position,
      passCount: n.data.passCount as number | undefined,
    }));
    const ideaEdges: IdeaEdge[] = edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      logicType: (e.data?.logicType as "AND" | "OR") || "AND",
    }));
    return { name: ideaName, universe, nodes: ideaNodes, edges: ideaEdges };
  }, [nodes, edges, ideaName, universe]);

  const saveIdeaMutation = useMutation({
    mutationFn: async (mode?: "rename" | "fork") => {
      const body = buildIdeaBody();
      if (mode === "fork") {
        const res = await apiRequest("POST", "/api/bigidea/ideas", body);
        return res.json();
      }
      if (currentIdeaId) {
        const res = await apiRequest("PATCH", `/api/bigidea/ideas/${currentIdeaId}`, body);
        return res.json();
      }
      const res = await apiRequest("POST", "/api/bigidea/ideas", body);
      return res.json();
    },
    onSuccess: (data, mode) => {
      queryClient.invalidateQueries({ queryKey: ["/api/bigidea/ideas"] });
      if (mode === "fork" || (!currentIdeaId && data.id)) {
        setCurrentIdeaId(data.id);
      }
      setLoadedIdeaName(ideaName);
      toast({ title: mode === "fork" ? "Saved as new idea" : "Idea saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to save idea", description: err.message, variant: "destructive" });
    },
  });

  const handleSaveClick = useCallback(() => {
    if (currentIdeaId && loadedIdeaName && ideaName !== loadedIdeaName) {
      setRenameForkOpen(true);
    } else {
      saveIdeaMutation.mutate(undefined);
    }
  }, [currentIdeaId, loadedIdeaName, ideaName, saveIdeaMutation]);

  const commitTuningMutation = useMutation({
    mutationFn: async () => {
      const ideaNodes: IdeaNode[] = nodes.map((n) => ({
        id: n.id,
        type: n.type as "thought" | "results",
        thoughtId: n.data.thoughtId as number | undefined,
        thoughtName: n.data.label as string | undefined,
        thoughtCategory: n.data.category as string | undefined,
        thoughtDescription: n.data.description as string | undefined,
        thoughtCriteria: n.data.criteria as ScannerCriterion[] | undefined,
        thoughtTimeframe: (n.data.timeframe as string | undefined) || "daily",
        isNot: n.data.isNot as boolean | undefined,
        isMuted: n.data.isMuted as boolean | undefined,
        userRenamed: n.data.userRenamed as boolean | undefined,
        position: n.position,
        passCount: n.data.passCount as number | undefined,
      }));
      const ideaEdges: IdeaEdge[] = edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        logicType: (e.data?.logicType as "AND" | "OR") || "AND",
      }));
      const body = { name: ideaName, universe, nodes: ideaNodes, edges: ideaEdges };
      if (currentIdeaId) {
        await apiRequest("PATCH", `/api/bigidea/ideas/${currentIdeaId}`, body);
      } else {
        const res = await apiRequest("POST", "/api/bigidea/ideas", body);
        const data = await res.json();
        if (data.id) setCurrentIdeaId(data.id);
      }

      if (!tuningId) throw new Error("No tuning session to commit");

      const currentSymbols = (scanResults || []).map(r => r.symbol);
      const chartRatingsData = await fetch("/api/bigidea/chart-ratings-for-session?sessionId=" + (scanSessionId || ""), { credentials: "include" }).then(r => r.json()).catch(() => []);

      const upRated = (chartRatingsData || []).filter((r: any) => r.rating === "up").map((r: any) => r.symbol);
      const downRated = (chartRatingsData || []).filter((r: any) => r.rating === "down").map((r: any) => r.symbol);

      const retainedUpSymbols = upRated.filter((s: string) => currentSymbols.includes(s));
      const droppedUpSymbols = upRated.filter((s: string) => !currentSymbols.includes(s));
      const droppedDownSymbols = downRated.filter((s: string) => !currentSymbols.includes(s));
      const retainedDownSymbols = downRated.filter((s: string) => currentSymbols.includes(s));
      const newSymbols = currentSymbols.filter(s => !preTuneSymbols.includes(s));

      const acceptedSuggs = tuneResult?.suggestions.filter((_, i) => acceptedTuneIndices.has(i)).map(s => ({
        indicatorId: s.indicatorId,
        indicatorName: s.indicatorName,
        paramName: s.paramName,
        currentValue: s.currentValue,
        suggestedValue: s.suggestedValue,
      })) || [];
      const skippedSuggs = tuneResult?.suggestions.filter((_, i) => !acceptedTuneIndices.has(i)).map(s => ({
        indicatorId: s.indicatorId,
        indicatorName: s.indicatorName,
        paramName: s.paramName,
        currentValue: s.currentValue,
        suggestedValue: s.suggestedValue,
      })) || [];

      const ratingsCount = (chartRatingsData || []).length;

      const res = await apiRequest("PATCH", `/api/bigidea/scan-tune/${tuningId}/commit`, {
        outcome: "accepted",
        acceptedSuggestions: acceptedSuggs,
        skippedSuggestions: skippedSuggs,
        configBefore: tuningPreSnapshot,
        configAfter: nodes.filter(n => n.type === "thought").flatMap(n => {
          const criteria = (n.data.criteria as ScannerCriterion[]) || [];
          return criteria.flatMap(c => c.params.map(p => ({ indicatorId: c.indicatorId, paramName: p.name, value: p.value })));
        }),
        resultCountAfter: scanResults?.length || 0,
        retainedUpSymbols,
        droppedUpSymbols,
        droppedDownSymbols,
        retainedDownSymbols,
        newSymbols,
        ratingsCount,
      });
      return res.json();
    },
    onSuccess: () => {
      setTuningDirty(false);
      setTuningId(null);
      setTuningPreSnapshot(null);
      setTuneRescanDone(false);
      queryClient.invalidateQueries({ queryKey: ["/api/bigidea/ideas"] });
      toast({ title: "Tuning committed", description: "Your changes have been saved and will improve future AI suggestions." });
    },
    onError: (err: Error) => {
      toast({ title: "Commit failed", description: err.message, variant: "destructive" });
    },
  });

  const qualityMutation = useMutation({
    mutationFn: async () => {
      const ideaNodes = nodes.map((n) => ({
        id: n.id,
        type: n.type as "thought" | "results",
        thoughtId: n.data.thoughtId as number | undefined,
        thoughtName: n.data.label as string | undefined,
        thoughtCategory: n.data.category as string | undefined,
        thoughtCriteria: n.data.criteria as ScannerCriterion[] | undefined,
        isNot: n.data.isNot as boolean | undefined,
        isMuted: n.data.isMuted as boolean | undefined,
        passCount: n.data.passCount as number | undefined,
        position: n.position,
      }));
      const ideaEdges = edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        logicType: (e.data?.logicType as "AND" | "OR") || "AND",
      }));
      const res = await apiRequest("POST", "/api/bigidea/quality", { nodes: ideaNodes, edges: ideaEdges });
      return res.json();
    },
    onSuccess: (data: ScanQualityResult) => {
      setQualityResult(data);
      setQualityOpen(true);
    },
    onError: (err: Error) => {
      toast({ title: "Quality check failed", description: err.message, variant: "destructive" });
    },
  });

  const tuneMutation = useMutation({
    mutationFn: async () => {
      const ideaNodes = nodes.map((n) => ({
        id: n.id,
        type: n.type as "thought" | "results",
        thoughtId: n.data.thoughtId as number | undefined,
        thoughtName: n.data.label as string | undefined,
        thoughtCategory: n.data.category as string | undefined,
        thoughtCriteria: n.data.criteria as ScannerCriterion[] | undefined,
        isNot: n.data.isNot as boolean | undefined,
        isMuted: n.data.isMuted as boolean | undefined,
        passCount: n.data.passCount as number | undefined,
      }));
      const ideaEdges = edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        logicType: (e.data?.logicType as "AND" | "OR") || "AND",
      }));
      const res = await apiRequest("POST", "/api/bigidea/scan-tune", {
        nodes: ideaNodes,
        edges: ideaEdges,
        funnelData: lastFunnelData,
        resultCount: scanResults?.length || 0,
        universe,
        userInstruction: tuneInstruction || undefined,
        sessionId: scanSessionId || undefined,
      });
      return res.json();
    },
    onSuccess: (data: TuningResult) => {
      setTuneResult(data);
      setAcceptedTuneIndices(new Set());
      setTuningId(data.tuningId);
    },
    onError: (err: Error) => {
      if (err.message.includes("403")) {
        toast({ title: "Pro feature", description: "AI Scan Tuning requires a Pro or Admin account.", variant: "destructive" });
      } else {
        toast({ title: "Tuning failed", description: err.message, variant: "destructive" });
      }
    },
  });

  const handleClearIdea = useCallback(() => {
    setTuningDirty(false);
    setTuningId(null);
    setTuningPreSnapshot(null);
    setTuneRescanDone(false);
    setNodes([{ ...INITIAL_RESULTS_NODE }]);
    setEdges([]);
    setIdeaName("Untitled Idea");
    setLoadedIdeaName(null);
    setCurrentIdeaId(null);
    setScanResults(null);
    setShowResults(false);
    setDebugInfo(null);
    setQualityResult(null);
    setLastFunnelData(null);
    setScanSessionId(undefined);
    setSelectedNodeId(null);
    setDebugOpen(false);
    setQualityOpen(false);
    setClearConfirmOpen(false);
    toast({ title: "Canvas cleared" });
  }, [setNodes, setEdges, toast]);

  const normalizeCriteriaParams = useCallback((criteria: ScannerCriterion[]): ScannerCriterion[] => {
    return criteria.map((c) => {
      const indMeta = indicatorLibrary.find((i) => i.id === c.indicatorId);
      if (!indMeta) return c;
      const canonicalNames = new Set(indMeta.params.map((mp) => mp.name));
      const allMatch = c.params.every((p) => canonicalNames.has(p.name));
      if (allMatch) return c;
      const repairedParams = c.params.map((p, idx) => {
        if (canonicalNames.has(p.name)) return p;
        if (idx < indMeta.params.length) {
          return { ...p, name: indMeta.params[idx].name };
        }
        return p;
      });
      return { ...c, params: repairedParams };
    });
  }, [indicatorLibrary]);

  const handleAcceptSuggestion = useCallback((suggestion: TuningSuggestion, index: number) => {
    const suggType = suggestion.type || "param_change";
    let applied = false;

    if (suggType === "param_change") {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.type !== "thought" || !n.data.criteria) return n;
          const criteria = normalizeCriteriaParams(n.data.criteria as ScannerCriterion[]);
          const matchCriterion = criteria.find((c) =>
            c.indicatorId === suggestion.indicatorId &&
            c.params.some((p) => p.name === suggestion.paramName)
          );
          if (!matchCriterion) return n;
          applied = true;
          return {
            ...n,
            data: {
              ...n.data,
              criteria: criteria.map((c) => {
                if (c.indicatorId !== suggestion.indicatorId) return c;
                return {
                  ...c,
                  params: c.params.map((p) =>
                    p.name === suggestion.paramName ? { ...p, value: suggestion.suggestedValue } : p
                  ),
                };
              }),
            },
          };
        })
      );
      if (applied) {
        toast({ title: `Applied: ${suggestion.indicatorName} → ${suggestion.paramName} = ${suggestion.suggestedValue}` });
      }
    } else if (suggType === "add_criterion" && suggestion.criterion) {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== suggestion.thoughtId || n.type !== "thought") return n;
          const criteria = normalizeCriteriaParams(n.data.criteria as ScannerCriterion[]);
          applied = true;
          return {
            ...n,
            data: {
              ...n.data,
              criteria: [...criteria, suggestion.criterion!],
            },
          };
        })
      );
      if (applied) {
        toast({ title: `Added: ${suggestion.indicatorName} criterion` });
      }
    } else if (suggType === "remove_criterion") {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== suggestion.thoughtId || n.type !== "thought") return n;
          const criteria = normalizeCriteriaParams(n.data.criteria as ScannerCriterion[]);
          const removed = criteria.find((c) => c.indicatorId === suggestion.indicatorId);
          const filtered = criteria.filter((c) => c.indicatorId !== suggestion.indicatorId);
          if (filtered.length === criteria.length) return n;
          applied = true;
          if (removed) suggestion.criterion = removed;
          return {
            ...n,
            data: { ...n.data, criteria: filtered },
          };
        })
      );
      if (applied) {
        toast({ title: `Removed: ${suggestion.indicatorName} criterion` });
      }
    }

    if (applied) {
      setAcceptedTuneIndices((prev) => { const next = new Set(Array.from(prev)); next.add(index); return next; });
      setTuningDirty(true);
    } else {
      toast({ title: "Could not apply", description: `${suggestion.indicatorName} not found on canvas.`, variant: "destructive" });
    }
  }, [setNodes, toast, normalizeCriteriaParams]);

  const handleUndoSuggestion = useCallback((suggestion: TuningSuggestion, index: number) => {
    const suggType = suggestion.type || "param_change";

    if (suggType === "param_change") {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.type !== "thought" || !n.data.criteria) return n;
          const criteria = normalizeCriteriaParams(n.data.criteria as ScannerCriterion[]);
          const matchCriterion = criteria.find((c) =>
            c.indicatorId === suggestion.indicatorId &&
            c.params.some((p) => p.name === suggestion.paramName)
          );
          if (!matchCriterion) return n;
          return {
            ...n,
            data: {
              ...n.data,
              criteria: criteria.map((c) => {
                if (c.indicatorId !== suggestion.indicatorId) return c;
                return {
                  ...c,
                  params: c.params.map((p) =>
                    p.name === suggestion.paramName ? { ...p, value: suggestion.currentValue } : p
                  ),
                };
              }),
            },
          };
        })
      );
      toast({ title: `Undone: ${suggestion.indicatorName} → ${suggestion.paramName} reverted to ${suggestion.currentValue}` });
    } else if (suggType === "add_criterion") {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== suggestion.thoughtId || n.type !== "thought") return n;
          const criteria = normalizeCriteriaParams(n.data.criteria as ScannerCriterion[]);
          return {
            ...n,
            data: {
              ...n.data,
              criteria: criteria.filter((c) => c.indicatorId !== suggestion.indicatorId),
            },
          };
        })
      );
      toast({ title: `Undone: removed ${suggestion.indicatorName} criterion` });
    } else if (suggType === "remove_criterion" && suggestion.criterion) {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== suggestion.thoughtId || n.type !== "thought") return n;
          const criteria = normalizeCriteriaParams(n.data.criteria as ScannerCriterion[]);
          return {
            ...n,
            data: {
              ...n.data,
              criteria: [...criteria, suggestion.criterion!],
            },
          };
        })
      );
      toast({ title: `Undone: restored ${suggestion.indicatorName} criterion` });
    }

    setAcceptedTuneIndices((prev) => {
      const next = new Set(Array.from(prev));
      next.delete(index);
      if (next.size === 0) setTuningDirty(false);
      return next;
    });
  }, [setNodes, toast, normalizeCriteriaParams]);

  const handleApplyAll = useCallback(() => {
    if (!tuneResult) return;
    tuneResult.suggestions.forEach((s, i) => {
      if (!acceptedTuneIndices.has(i)) {
        handleAcceptSuggestion(s, i);
      }
    });
  }, [tuneResult, acceptedTuneIndices, handleAcceptSuggestion]);

  const handleCommitTuning = useCallback(() => {
    commitTuningMutation.mutate();
  }, [commitTuningMutation]);

  const handleDiscardTuning = useCallback(() => {
    if (tuningPreSnapshot && Array.isArray(tuningPreSnapshot)) {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.type !== "thought" || !n.data.criteria) return n;
          const criteria = n.data.criteria as ScannerCriterion[];
          return {
            ...n,
            data: {
              ...n.data,
              criteria: criteria.map((c) => {
                const origParams = tuningPreSnapshot.filter((sp: any) => sp.indicatorId === c.indicatorId);
                if (origParams.length === 0) return c;
                return {
                  ...c,
                  params: c.params.map((p) => {
                    const orig = origParams.find((op: any) => op.paramName === p.name);
                    return orig ? { ...p, value: orig.value } : p;
                  }),
                };
              }),
            },
          };
        })
      );
    }
    if (tuningId) {
      apiRequest("PATCH", `/api/bigidea/scan-tune/${tuningId}/commit`, { outcome: "discarded" }).catch(() => {});
    }
    setTuningDirty(false);
    setTuningId(null);
    setTuningPreSnapshot(null);
    setTuneRescanDone(false);
    setAcceptedTuneIndices(new Set());
    setTuneResult(null);
    toast({ title: "Tuning changes discarded", description: "Parameters reverted to their original values." });
  }, [tuningPreSnapshot, tuningId, setNodes, toast]);

  const deleteThoughtMutation = useMutation({
    mutationFn: async ({ thoughtId, nodeId }: { thoughtId: number; nodeId?: string }) => {
      try {
        await apiRequest("DELETE", `/api/bigidea/thoughts/${thoughtId}`);
      } catch (err: any) {
        if (err?.message?.includes("404")) {
          return { nodeId, alreadyDeleted: true };
        }
        throw err;
      }
      return { nodeId, alreadyDeleted: false };
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/bigidea/thoughts"] });
      if (variables.nodeId) {
        setNodes((nds) => nds.filter((n) => n.id !== variables.nodeId));
        setEdges((eds) => eds.filter((e) => e.source !== variables.nodeId && e.target !== variables.nodeId));
        setSelectedNodeId((prev) => (prev === variables.nodeId ? null : prev));
      }
      setDeleteConfirm(null);
      toast({ title: "Thought deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to delete thought", description: err.message, variant: "destructive" });
      setDeleteConfirm(null);
    },
  });

  const [deleteIdeaConfirm, setDeleteIdeaConfirm] = useState(false);
  const deleteIdeaMutation = useMutation({
    mutationFn: async (ideaId: number) => {
      await apiRequest("DELETE", `/api/bigidea/ideas/${ideaId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bigidea/ideas"] });
      handleClearIdea();
      setDeleteIdeaConfirm(false);
      toast({ title: "Idea deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to delete idea", description: err.message, variant: "destructive" });
      setDeleteIdeaConfirm(false);
    },
  });

  const scanMutation = useMutation({
    mutationFn: async () => {
      const scanNodes = nodes.map((n) => ({
        id: n.id,
        type: n.type,
        thoughtCriteria: n.data.criteria,
        thoughtName: n.data.label,
        thoughtTimeframe: n.data.timeframe || "daily",
        isNot: n.data.isNot,
        isMuted: n.data.isMuted,
      }));
      const scanEdges = edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        logicType: e.data?.logicType || "AND",
      }));

      const thoughtNodes = nodes.filter((n) => n.type === "thought");
      const resultsNode = nodes.find((n) => n.type === "results");
      const debugThoughts = thoughtNodes.map((n) => {
        const criteria = (n.data.criteria as ScannerCriterion[]) || [];
        const incomingEdge = edges.find((e) => e.source === n.id);
        return {
          nodeId: n.id,
          name: n.data.label as string,
          timeframe: (n.data.timeframe as string) || "daily",
          isNot: !!n.data.isNot,
          isMuted: !!n.data.isMuted,
          connectionTo: incomingEdge ? { target: incomingEdge.target, logicType: (incomingEdge.data as any)?.logicType || "AND" } : null,
          criteria: criteria.map((c) => ({
            indicator: c.indicatorId,
            label: c.label,
            muted: !!c.muted,
            inverted: !!c.inverted,
            tfOverride: c.timeframeOverride || null,
            params: Object.fromEntries((c.params || []).map((p) => [p.name, p.value])),
          })),
        };
      });

      const allConnections = edges.map((e) => {
        const srcNode = nodes.find((n) => n.id === e.source);
        const tgtNode = nodes.find((n) => n.id === e.target);
        return {
          from: (srcNode?.data.label as string) || e.source,
          to: tgtNode?.type === "results" ? "Results" : (tgtNode?.data.label as string) || e.target,
          logic: (e.data as any)?.logicType || "AND",
        };
      });

      const evalOrder: string[] = [];
      const visited = new Set<string>();
      const adj = new Map<string, string[]>();
      for (const e of edges) {
        if (!adj.has(e.target)) adj.set(e.target, []);
        adj.get(e.target)!.push(e.source);
      }
      const topoVisit = (id: string) => {
        if (visited.has(id)) return;
        visited.add(id);
        for (const dep of adj.get(id) || []) topoVisit(dep);
        const n = nodes.find((nd) => nd.id === id);
        if (n?.type === "thought") evalOrder.push(n.data.label as string);
      };
      if (resultsNode) topoVisit(resultsNode.id);

      const scanStartTime = Date.now();

      let scanBody: any = { nodes: scanNodes, edges: scanEdges, universe };
      if (universe.startsWith("watchlist-")) {
        const watchlistId = parseInt(universe.replace("watchlist-", ""));
        const wlRes = await apiRequest("GET", `/api/sentinel/watchlist?watchlistId=${watchlistId}`);
        const wlItems = await wlRes.json() as Array<{ symbol: string }>;
        const wlTickers = wlItems.map((w) => w.symbol.toUpperCase());
        if (wlTickers.length === 0) {
          toast({ title: "This watchlist is empty — add tickers first", variant: "destructive" });
          return;
        }
        scanBody = { nodes: scanNodes, edges: scanEdges, customTickers: wlTickers };
      }

      const res = await apiRequest("POST", "/api/bigidea/scan", scanBody);
      const data = await res.json() as ScanResponse;

      setDebugInfo({
        timestamp: new Date().toLocaleTimeString(),
        durationMs: Date.now() - scanStartTime,
        universe,
        thoughts: debugThoughts,
        connections: allConnections,
        evalOrder,
        totalScanned: data.totalScanned,
        matchCount: data.results.length,
        thoughtCounts: data.thoughtCounts || {},
        perThoughtFunnel: data.funnelData?.perThought || {},
        linkOverrides: data.linkOverrides || [],
        dynamicDataFlows: data.dynamicDataFlows || [],
        // Enhanced debug info from backend
        ideaName: (data as any).debugInfo?.ideaName || null,
        ideaDescription: (data as any).debugInfo?.ideaDescription || null,
        fullCriteria: (data as any).debugInfo?.fullCriteria || [],
        canvasNodes: (data as any).debugInfo?.thoughtNodes || [],
        canvasEdges: (data as any).debugInfo?.edges || [],
      });
      setDebugOpen(true);

      return data;
    },
    onSuccess: (data) => {
      setScanResults(data.results);
      setScanTotalScanned(data.totalScanned);
      setShowResults(true);
      setSelectedNodeId(null);
      if (data.funnelData) setLastFunnelData(data.funnelData);
      if (data.sessionId) setScanSessionId(data.sessionId);
      setNodes((nds) =>
        nds.map((n) => {
          if (n.type === "results") {
            return { ...n, data: { ...n.data, totalCount: data.results.length } };
          }
          if (n.type === "thought") {
            let updatedData: any = { ...n.data };
            if (data.thoughtCounts) {
              updatedData.passCount = data.thoughtCounts[n.id] ?? 0;
            }
            const nodeOverrides = (data.linkOverrides || []).filter((o) => o.thoughtId === n.id);
            if (nodeOverrides.length > 0 && updatedData.criteria) {
              updatedData.criteria = (updatedData.criteria as ScannerCriterion[]).map((c) => {
                const relevantOverrides = nodeOverrides.filter((o) => o.indicatorId === c.indicatorId);
                if (relevantOverrides.length === 0) return c;
                return {
                  ...c,
                  params: c.params.map((p) => {
                    const ov = relevantOverrides.find((o) => o.paramName === p.name);
                    if (ov) return { ...p, value: ov.linkedValue };
                    return p;
                  }),
                };
              });
            }
            return { ...n, data: updatedData };
          }
          return n;
        })
      );
      toast({ title: `Scan complete: ${data.results.length} matches` });
    },
    onError: (err: Error) => {
      toast({ title: "Scan failed", description: err.message, variant: "destructive" });
    },
  });

  const onConnect = useCallback(
    (params: Connection) => {
      const edgeId = `e-${params.source}-${params.target}`;
      const newEdge: Edge = {
        ...params,
        id: edgeId,
        type: "logic",
        data: {
          logicType: "AND",
          onToggle: () => {
            setEdges((eds) =>
              eds.map((e) => {
                if (e.id === edgeId) {
                  const current = e.data?.logicType === "AND" ? "OR" : "AND";
                  return { ...e, data: { ...e.data, logicType: current, onToggle: e.data?.onToggle, onDelete: e.data?.onDelete } };
                }
                return e;
              })
            );
          },
          onDelete: () => {
            setEdges((eds) => eds.filter((e) => e.id !== edgeId));
          },
        },
      } as Edge;
      setEdges((eds) => addEdge(newEdge, eds));
    },
    [setEdges]
  );

  const onNodeClick = useCallback((_: any, node: Node) => {
    if (node.type === "thought") {
      setSelectedNodeId(node.id);
      setShowResults(false);
      setPreviewThoughtId(null);
    } else if (node.type === "results") {
      setSelectedNodeId(null);
      setPreviewThoughtId(null);
      if (scanResults && scanResults.length > 0) {
        setShowResults(true);
      }
    }
  }, [scanResults]);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const thoughtData = event.dataTransfer.getData("application/bigidea-thought");
      if (!thoughtData || !reactFlowInstance) return;

      const thought: ScannerThought = JSON.parse(thoughtData);
      let position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const enrichedCriteria = (thought.criteria || []).map((c: ScannerCriterion) => {
        const indMeta = indicatorLibrary.find((i) => i.id === c.indicatorId);
        if (!indMeta) return c;
        return {
          ...c,
          params: c.params.map((p) => {
            const metaParam = indMeta.params.find((mp) => mp.name === p.name);
            if (metaParam?.autoLink) {
              return { ...p, autoLink: metaParam.autoLink, autoLinked: p.autoLinked !== false };
            }
            return p;
          }),
        };
      });

      const currentNodes = reactFlowInstance.getNodes();
      const currentEdges = reactFlowInstance.getEdges();
      const NODE_PROXIMITY_THRESHOLD = 600;
      const NODE_OFFSET_X = 280;
      const NODE_OFFSET_Y = 0;

      let nearestNode: Node | null = null;
      if (currentNodes.length > 0) {
        let nearestDist = Infinity;
        for (const n of currentNodes) {
          const dx = position.x - n.position.x;
          const dy = position.y - n.position.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < nearestDist) {
            nearestDist = dist;
            nearestNode = n;
          }
        }

        if (nearestDist > NODE_PROXIMITY_THRESHOLD && nearestNode) {
          position = {
            x: nearestNode.position.x + NODE_OFFSET_X,
            y: nearestNode.position.y + NODE_OFFSET_Y,
          };
        }
      }

      const newNodeId = `thought-${thought.id}-${Date.now()}`;

      const newNode: Node = {
        id: newNodeId,
        type: "thought",
        position,
        data: {
          nodeId: thought.id,
          label: thought.name,
          category: thought.category,
          description: thought.description,
          criteria: enrichedCriteria,
          timeframe: thought.timeframe || "daily",
          thoughtId: thought.id,
          isNot: false,
          isMuted: false,
          passCount: undefined,
        },
      };

      setNodes((nds) => [...nds, newNode]);

      if (currentNodes.length > 0) {
        const targetNodeIds = new Set(currentEdges.map((e) => e.target));
        const unconnectedAsTarget = currentNodes.filter((n) => !targetNodeIds.has(n.id));

        let connectTarget: Node | null = null;
        if (unconnectedAsTarget.length > 0) {
          let bestDist = Infinity;
          for (const n of unconnectedAsTarget) {
            const dx = position.x - n.position.x;
            const dy = position.y - n.position.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < bestDist) {
              bestDist = dist;
              connectTarget = n;
            }
          }
        } else if (nearestNode) {
          connectTarget = nearestNode;
        }

        if (connectTarget) {
          const edgeId = `e-${connectTarget.id}-${newNodeId}`;
          const autoEdge: Edge = {
            id: edgeId,
            source: connectTarget.id,
            target: newNodeId,
            type: "logic",
            data: {
              logicType: "AND",
              onToggle: () => {
                setEdges((eds) =>
                  eds.map((e) => {
                    if (e.id === edgeId) {
                      const current = e.data?.logicType === "AND" ? "OR" : "AND";
                      return { ...e, data: { ...e.data, logicType: current, onToggle: e.data?.onToggle, onDelete: e.data?.onDelete } };
                    }
                    return e;
                  })
                );
              },
              onDelete: () => {
                setEdges((eds) => eds.filter((e) => e.id !== edgeId));
              },
            },
          } as Edge;
          setEdges((eds) => addEdge(autoEdge, eds));
        }
      }
    },
    [reactFlowInstance, setNodes, setEdges, indicatorLibrary]
  );

  const addThoughtToCanvas = useCallback(
    (thought: ScannerThought) => {
      if (!reactFlowInstance) return;

      const currentNodes = reactFlowInstance.getNodes();
      const currentEdges = reactFlowInstance.getEdges();
      const NODE_OFFSET_X = 280;

      let position = { x: 100, y: 200 };

      if (currentNodes.length > 0) {
        let rightmostNode = currentNodes[0];
        for (const n of currentNodes) {
          if (n.position.x > rightmostNode.position.x) {
            rightmostNode = n;
          }
        }
        position = {
          x: rightmostNode.position.x + NODE_OFFSET_X,
          y: rightmostNode.position.y,
        };
      }

      const enrichedCriteria = (thought.criteria || []).map((c: ScannerCriterion) => {
        const indMeta = indicatorLibrary.find((i) => i.id === c.indicatorId);
        if (!indMeta) return c;
        return {
          ...c,
          params: c.params.map((p) => {
            const metaParam = indMeta.params.find((mp) => mp.name === p.name);
            if (metaParam?.autoLink) {
              return { ...p, autoLink: metaParam.autoLink, autoLinked: p.autoLinked !== false };
            }
            return p;
          }),
        };
      });

      const newNodeId = `thought-${thought.id}-${Date.now()}`;

      const newNode: Node = {
        id: newNodeId,
        type: "thought",
        position,
        data: {
          nodeId: thought.id,
          label: thought.name,
          category: thought.category,
          description: thought.description,
          criteria: enrichedCriteria,
          timeframe: thought.timeframe || "daily",
          thoughtId: thought.id,
          isNot: false,
          isMuted: false,
          passCount: undefined,
        },
      };

      setNodes((nds) => [...nds, newNode]);

      if (currentNodes.length > 0) {
        const targetNodeIds = new Set(currentEdges.map((edge: Edge) => edge.target));
        const unconnectedAsTarget = currentNodes.filter((node: Node) => !targetNodeIds.has(node.id));

        let connectTarget: Node | null = null;
        if (unconnectedAsTarget.length > 0) {
          let bestDist = Infinity;
          for (const n of unconnectedAsTarget) {
            const dx = position.x - n.position.x;
            const dy = position.y - n.position.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < bestDist) {
              bestDist = dist;
              connectTarget = n;
            }
          }
        }

        if (connectTarget) {
          const edgeId = `e-${connectTarget.id}-${newNodeId}`;
          const autoEdge: Edge = {
            id: edgeId,
            source: connectTarget.id,
            target: newNodeId,
            type: "logic",
            data: {
              logicType: "AND",
              onToggle: () => {
                setEdges((eds) =>
                  eds.map((e) => {
                    if (e.id === edgeId) {
                      const current = e.data?.logicType === "AND" ? "OR" : "AND";
                      return { ...e, data: { ...e.data, logicType: current, onToggle: e.data?.onToggle, onDelete: e.data?.onDelete } };
                    }
                    return e;
                  })
                );
              },
              onDelete: () => {
                setEdges((eds) => eds.filter((e) => e.id !== edgeId));
              },
            },
          } as Edge;
          setEdges((eds) => addEdge(autoEdge, eds));
        }
      }
    },
    [reactFlowInstance, setNodes, setEdges, indicatorLibrary]
  );

  const toggleNotOnNode = useCallback(
    (nodeId: string) => {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id === nodeId) {
            return { ...n, data: { ...n.data, isNot: !n.data.isNot } };
          }
          return n;
        })
      );
    },
    [setNodes]
  );

  const toggleMuteOnNode = useCallback(
    (nodeId: string) => {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id === nodeId) {
            return { ...n, data: { ...n.data, isMuted: !n.data.isMuted } };
          }
          return n;
        })
      );
    },
    [setNodes]
  );

  const updateNodeCriterionParam = useCallback(
    (nodeId: string, criterionIdx: number, paramName: string, value: any) => {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id === nodeId) {
            const criteria = [...(n.data.criteria as ScannerCriterion[])];
            const criterion = { ...criteria[criterionIdx] };
            criterion.params = criterion.params.map((p) =>
              p.name === paramName ? { ...p, value } : p
            );
            criteria[criterionIdx] = criterion;
            return { ...n, data: { ...n.data, criteria } };
          }
          return n;
        })
      );
    },
    [setNodes]
  );

  const findLinkSources = useCallback(
    (currentNodeId: string, linkType: string): Array<{ nodeId: string; nodeName: string; indicatorId: string; indicatorName: string; paramName: string; paramValue: number | string | boolean }> => {
      const sources: Array<{ nodeId: string; nodeName: string; indicatorId: string; indicatorName: string; paramName: string; paramValue: number | string | boolean }> = [];
      for (const node of nodes) {
        if (node.id === currentNodeId || node.type !== "thought") continue;
        const criteria = (node.data.criteria as ScannerCriterion[]) || [];
        for (const c of criteria) {
          if (c.muted) continue;
          const indMeta = indicatorLibrary.find((i) => i.id === c.indicatorId);
          if (!indMeta?.provides) continue;
          for (const prov of indMeta.provides) {
            if (prov.linkType === linkType) {
              const paramVal = c.params.find((p) => p.name === prov.paramName);
              if (paramVal !== undefined) {
                sources.push({
                  nodeId: node.id,
                  nodeName: String(node.data.label || "Unnamed"),
                  indicatorId: c.indicatorId,
                  indicatorName: c.label,
                  paramName: prov.paramName,
                  paramValue: paramVal.value,
                });
              }
            }
          }
        }
      }
      return sources;
    },
    [nodes, indicatorLibrary]
  );

  const updateParamLinkState = useCallback(
    (nodeId: string, criterionIdx: number, paramName: string, autoLinked: boolean, linkedThoughtId?: string) => {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id === nodeId) {
            const criteria = [...(n.data.criteria as ScannerCriterion[])];
            const criterion = { ...criteria[criterionIdx] };
            criterion.params = criterion.params.map((p) =>
              p.name === paramName ? { ...p, autoLinked, linkedThoughtId: linkedThoughtId || undefined } : p
            );
            criteria[criterionIdx] = criterion;
            return { ...n, data: { ...n.data, criteria } };
          }
          return n;
        })
      );
    },
    [setNodes]
  );

  const getLinkedValue = useCallback(
    (param: ScannerCriterionParam, currentNodeId: string): { value: number | string | boolean; sourceName: string } | null => {
      if (!param.autoLinked || !param.autoLink) return null;
      const sources = findLinkSources(currentNodeId, param.autoLink.linkType);
      if (param.linkedThoughtId) {
        const specific = sources.find((s) => s.nodeId === param.linkedThoughtId);
        if (specific) return { value: specific.paramValue, sourceName: `${specific.nodeName} → ${specific.indicatorName}` };
      }
      if (sources.length > 0) {
        const best = sources.reduce((a, b) => (Number(a.paramValue) > Number(b.paramValue) ? a : b));
        return { value: best.paramValue, sourceName: `${best.nodeName} → ${best.indicatorName}` };
      }
      return null;
    },
    [findLinkSources]
  );

  const toggleCriterionInvert = useCallback(
    (nodeId: string, criterionIdx: number) => {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id === nodeId) {
            const criteria = [...(n.data.criteria as ScannerCriterion[])];
            const criterion = { ...criteria[criterionIdx] };
            criterion.inverted = !criterion.inverted;
            criteria[criterionIdx] = criterion;
            return { ...n, data: { ...n.data, criteria } };
          }
          return n;
        })
      );
    },
    [setNodes]
  );

  const setCriterionTimeframeOverride = useCallback(
    (nodeId: string, criterionIdx: number, value: string | undefined) => {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id === nodeId) {
            const criteria = [...(n.data.criteria as ScannerCriterion[])];
            const criterion = { ...criteria[criterionIdx] };
            criterion.timeframeOverride = value;
            criteria[criterionIdx] = criterion;
            return { ...n, data: { ...n.data, criteria } };
          }
          return n;
        })
      );
    },
    [setNodes]
  );

  const toggleCriterionMute = useCallback(
    (nodeId: string, criterionIdx: number) => {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id === nodeId) {
            const criteria = [...(n.data.criteria as ScannerCriterion[])];
            const criterion = { ...criteria[criterionIdx] };
            criterion.muted = !criterion.muted;
            criteria[criterionIdx] = criterion;
            if (n.data.userRenamed) {
              return { ...n, data: { ...n.data, criteria } };
            }
            const active = criteria.filter(c => !c.muted);
            const newLabel = active.length === 0 ? "Empty Thought" : active.length === 1 ? active[0].label : active.length === 2 ? `${active[0].label} + ${active[1].label}` : `${active[0].label} + ${active.length - 1} more`;
            return { ...n, data: { ...n.data, criteria, label: newLabel } };
          }
          return n;
        })
      );
    },
    [setNodes]
  );

  const deleteCriterion = useCallback(
    (nodeId: string, criterionIdx: number) => {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id === nodeId) {
            const criteria = [...(n.data.criteria as ScannerCriterion[])];
            criteria.splice(criterionIdx, 1);
            if (n.data.userRenamed) {
              return { ...n, data: { ...n.data, criteria } };
            }
            const active = criteria.filter(c => !c.muted);
            const newLabel = active.length === 0 ? "Empty Thought" : active.length === 1 ? active[0].label : active.length === 2 ? `${active[0].label} + ${active[1].label}` : `${active[0].label} + ${active.length - 1} more`;
            return { ...n, data: { ...n.data, criteria, label: newLabel } };
          }
          return n;
        })
      );
    },
    [setNodes]
  );

  const generateTitleFromCriteria = useCallback((criteria: ScannerCriterion[]): string => {
    const active = criteria.filter(c => !c.muted);
    if (active.length === 0) return "Empty Thought";
    if (active.length === 1) return active[0].label;
    if (active.length === 2) return `${active[0].label} + ${active[1].label}`;
    return `${active[0].label} + ${active.length - 1} more`;
  }, []);

  const updateNodeTitle = useCallback(
    (nodeId: string) => {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id === nodeId) {
            const criteria = (n.data.criteria as ScannerCriterion[]) || [];
            const newLabel = generateTitleFromCriteria(criteria);
            return { ...n, data: { ...n.data, label: newLabel } };
          }
          return n;
        })
      );
    },
    [setNodes, generateTitleFromCriteria]
  );

  const loadIdeaInner = useCallback(
    (idea: ScannerIdea) => {
      setCurrentIdeaId(idea.id);
      setIdeaName(idea.name);
      setLoadedIdeaName(idea.name);
      setUniverse(idea.universe);

      const enrichCriteria = (criteria: ScannerCriterion[] | undefined) => {
        if (!criteria) return criteria;
        const normalized = normalizeCriteriaParams(criteria);
        return normalized.map((c) => {
          const indMeta = indicatorLibrary.find((i) => i.id === c.indicatorId);
          if (!indMeta) return c;
          return {
            ...c,
            params: c.params.map((p) => {
              const metaParam = indMeta.params.find((mp) => mp.name === p.name);
              if (metaParam?.autoLink) {
                return { ...p, autoLink: metaParam.autoLink, autoLinked: p.autoLinked !== false };
              }
              return p;
            }),
          };
        });
      };

      const loadedNodes: Node[] = (idea.nodes as IdeaNode[]).map((n) => ({
        id: n.id,
        type: n.type,
        position: n.position,
        data:
          n.type === "results"
            ? { totalCount: undefined }
            : {
                nodeId: n.thoughtId,
                label: n.thoughtName,
                category: n.thoughtCategory,
                description: n.thoughtDescription,
                criteria: enrichCriteria(n.thoughtCriteria),
                thoughtId: n.thoughtId,
                isNot: n.isNot || false,
                isMuted: n.isMuted || false,
                userRenamed: n.userRenamed || false,
                timeframe: n.thoughtTimeframe || "daily",
                passCount: undefined,
              },
        deletable: n.type !== "results",
      }));

      setNodes(loadedNodes);

      const loadedEdges: Edge[] = (idea.edges as IdeaEdge[]).map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: "logic",
        data: {
          logicType: e.logicType,
          onToggle: () => {
            setEdges((eds) =>
              eds.map((ed) => {
                if (ed.id === e.id) {
                  const current = ed.data?.logicType === "AND" ? "OR" : "AND";
                  return { ...ed, data: { ...ed.data, logicType: current, onToggle: ed.data?.onToggle, onDelete: ed.data?.onDelete } };
                }
                return ed;
              })
            );
          },
          onDelete: () => {
            setEdges((eds) => eds.filter((ed) => ed.id !== e.id));
          },
        },
      }));

      setEdges(loadedEdges);
      setScanResults(null);
      setShowResults(false);
      setSelectedNodeId(null);
      setQualityResult(null);
      setScanSessionId(undefined);
    },
    [setNodes, setEdges, indicatorLibrary]
  );

  const loadIdea = useCallback(
    (idea: ScannerIdea) => {
      if (tuningDirty) {
        setPendingNavAction(() => () => loadIdeaInner(idea));
        setUnsavedTuningDialog(true);
        return;
      }
      loadIdeaInner(idea);
    },
    [tuningDirty, loadIdeaInner]
  );

  const thoughtsByCategory = useMemo(() => {
    const grouped: Record<string, ScannerThought[]> = {};
    for (const t of thoughts) {
      if (!grouped[t.category]) grouped[t.category] = [];
      grouped[t.category].push(t);
    }
    return grouped;
  }, [thoughts]);

  const clearNodeFromCanvas = useCallback(
    (nodeId: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      if (selectedNodeId === nodeId) setSelectedNodeId(null);
    },
    [setNodes, setEdges, selectedNodeId]
  );

  const requestDeleteThought = useCallback(
    (nodeId: string, thoughtId: number, name: string) => {
      setDeleteConfirm({ thoughtId, name, nodeId });
    },
    []
  );

  const nodesWithCallbacks = useMemo(
    () =>
      nodes.map((n) => {
        if (n.type !== "thought") return n;
        return {
          ...n,
          data: {
            ...n.data,
            onClear: () => clearNodeFromCanvas(n.id),
            onDelete: () => requestDeleteThought(n.id, n.data.thoughtId as number, n.data.label as string),
          },
        };
      }),
    [nodes, clearNodeFromCanvas, requestDeleteThought]
  );

  const selectedNode = selectedNodeId ? nodesWithCallbacks.find((n) => n.id === selectedNodeId) : null;
  const previewThought = previewThoughtId ? thoughts.find((t) => t.id === previewThoughtId) : null;

  const sortedResults = useMemo(() => {
    if (!scanResults) return [];
    const sorted = [...scanResults];
    sorted.sort((a, b) => {
      if (resultSort === "ticker") {
        return resultSortDir === "asc" ? a.symbol.localeCompare(b.symbol) : b.symbol.localeCompare(a.symbol);
      }
      return resultSortDir === "asc" ? a.price - b.price : b.price - a.price;
    });
    return sorted;
  }, [scanResults, resultSort, resultSortDir]);

  const handleSortToggle = (field: "ticker" | "price") => {
    if (resultSort === field) {
      setResultSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setResultSort(field);
      setResultSortDir("asc");
    }
  };

  return (
    <div className="flex flex-col h-screen sentinel-page" style={{ backgroundColor: cssVariables.backgroundColor, '--logo-opacity': cssVariables.logoOpacity, '--overlay-bg': cssVariables.overlayBg } as React.CSSProperties}>
      <SentinelHeader showSentiment={false} />

      <div className="flex items-center gap-3 px-4 py-2 border-b flex-wrap" style={{ backgroundColor: cssVariables.headerBg }}>
        <CopyScreenButton className="flex-shrink-0" />
        <Input
          value={ideaName}
          onChange={(e) => setIdeaName(e.target.value)}
          placeholder="Idea Title..."
          className="w-48 text-sm font-medium"
          data-testid="input-idea-name"
        />

        <Select value={universe} onValueChange={setUniverse}>
          <SelectTrigger className="w-48" data-testid="select-universe">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Indexes</SelectLabel>
              {INDEX_OPTIONS.map((u) => (
                <SelectItem key={u.value} value={u.value} data-testid={`option-universe-${u.value}`}>
                  {u.label}
                </SelectItem>
              ))}
            </SelectGroup>
            {userWatchlists && userWatchlists.length > 0 && (
              <>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel>Watchlists</SelectLabel>
                  {userWatchlists.map((wl) => (
                    <SelectItem key={`watchlist-${wl.id}`} value={`watchlist-${wl.id}`} data-testid={`option-watchlist-${wl.id}`}>
                      {wl.name} {wl.isDefault && "(default)"}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </>
            )}
          </SelectContent>
        </Select>

        <Select
          value=""
          onValueChange={(val) => {
            const idea = ideas.find((i) => String(i.id) === val);
            if (idea) loadIdea(idea);
          }}
        >
          <SelectTrigger className="w-44" data-testid="select-load-idea">
            <div className="flex items-center gap-1.5">
              <span className="bulb-glow-badge-sm flex-shrink-0">
                <Lightbulb className="h-3.5 w-3.5 bulb-glow-icon" />
              </span>
              <SelectValue placeholder="List" />
            </div>
          </SelectTrigger>
          <SelectContent>
            {ideas.length > 0 ? ideas.map((idea) => (
              <SelectItem key={idea.id} value={String(idea.id)} data-testid={`option-idea-${idea.id}`}>
                {idea.name}
              </SelectItem>
            )) : (
              <SelectItem value="__none__" disabled>No saved ideas</SelectItem>
            )}
          </SelectContent>
        </Select>

        <Button
          onClick={() => scanMutation.mutate()}
          disabled={scanMutation.isPending}
          className="gap-2"
          data-testid="button-run-scan"
        >
          {scanMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          Run Scan
        </Button>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              onClick={handleSaveClick}
              disabled={saveIdeaMutation.isPending}
              className="gap-2 border-green-600/40 text-green-400"
              data-testid="button-save-idea"
            >
              {saveIdeaMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>Save this idea to your library</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              onClick={() => {
                if (tuningDirty) {
                  setPendingNavAction(() => () => setClearConfirmOpen(true));
                  setUnsavedTuningDialog(true);
                  return;
                }
                setClearConfirmOpen(true);
              }}
              disabled={nodes.filter(n => n.type === "thought").length === 0}
              className="gap-2"
              data-testid="button-clear-idea"
            >
              <Trash2 className="h-4 w-4" />
              Clear
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">
            <p>Removes all thoughts, connections, and results from the canvas. Starts fresh with an empty scan.</p>
          </TooltipContent>
        </Tooltip>

        <div className="h-6 w-px bg-border mx-1" />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              onClick={() => {
                if (!lastFunnelData) {
                  toast({ title: "Run a scan first", description: "AI Tune needs scan results and failure data to analyze. Run a scan, then try again.", variant: "destructive" });
                  return;
                }
                const snapshot: any[] = [];
                nodes.filter(n => n.type === "thought").forEach(n => {
                  const criteria = (n.data.criteria as ScannerCriterion[]) || [];
                  criteria.forEach(c => {
                    c.params.forEach(p => {
                      snapshot.push({ indicatorId: c.indicatorId, paramName: p.name, value: p.value });
                    });
                  });
                });
                setTuningPreSnapshot(snapshot);
                setPreTuneResultCount(scanResults?.length || 0);
                setPreTuneSymbols((scanResults || []).map(r => r.symbol));
                setTuneResult(null);
                setTuneInstruction("");
                setAcceptedTuneIndices(new Set());
                setTuneRescanDone(false);
                setTuneDialogOpen(true);
              }}
              disabled={tuneMutation.isPending || nodes.filter(n => n.type === "thought").length === 0 || !lastFunnelData}
              className="gap-2 border-yellow-600/40 text-yellow-400"
              data-testid="button-tune-scan"
            >
              {tuneMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Music className="h-4 w-4" />}
              Tune
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">
            <p>Uses AI to suggest parameter changes based on your scan's failure funnel data. Tell it to loosen, tighten, or adjust specific criteria. Requires Pro or Admin tier.</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              onClick={handleCommitTuning}
              disabled={!tuningDirty || commitTuningMutation.isPending || !tuneRescanDone}
              className="gap-2"
              data-testid="button-commit-tuning"
            >
              {commitTuningMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Save & Commit
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">
            <p>Commit your tuning changes to the learning system. Requires a rescan and chart review first.</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              onClick={() => qualityMutation.mutate()}
              disabled={qualityMutation.isPending || nodes.filter(n => n.type === "thought").length === 0}
              className="gap-2"
              data-testid="button-rate-quality"
            >
              {qualityMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Target className="h-4 w-4" />}
              Rate
              {qualityResult && (
                <span className={`font-bold ${GRADE_COLORS[qualityResult.grade]}`}>
                  {qualityResult.grade}
                </span>
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>Rate the quality of your scan idea across five dimensions</p>
          </TooltipContent>
        </Tooltip>

        {debugInfo && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="icon" data-testid="button-debug-overlay">
                <Info className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent side="bottom" align="end" className="w-[420px] max-h-[400px] overflow-auto p-0">
              <div className="flex items-center justify-between px-3 py-2 border-b">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Scan Debug</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      data-testid="button-copy-debug"
                      onClick={() => {
                        const lines: string[] = [];
                        lines.push(`Scan Debug — ${debugInfo.timestamp} — ${debugInfo.durationMs}ms — universe: ${debugInfo.universe}`);
                        lines.push(`Result: ${debugInfo.matchCount} / ${debugInfo.totalScanned}`);
                        
                        // Idea info if available
                        if (debugInfo.ideaName) {
                          lines.push(`\nIdea: "${debugInfo.ideaName}"`);
                          if (debugInfo.ideaDescription) {
                            lines.push(`Description: ${debugInfo.ideaDescription}`);
                          }
                        }
                        
                        if (debugInfo.evalOrder?.length > 0) {
                          lines.push(`\nEval Order: ${debugInfo.evalOrder.join(" → ")}`);
                        }
                        if (debugInfo.connections?.length > 0) {
                          lines.push(`\nThought Stems:`);
                          debugInfo.connections.forEach((c: any) => lines.push(`  ${c.from} ${c.logic} ${c.to}`));
                        }
                        
                        // Canvas Layout with full indicator details and per-thought AI prompts
                        if (debugInfo.fullCriteria?.length > 0) {
                          lines.push(`\nCanvas Layout & Criteria:`);
                          debugInfo.fullCriteria.forEach((thought: any) => {
                            lines.push(`\n${thought.thought} (${thought.timeframe || 'daily'}):`);
                            if (thought.aiPrompt) {
                              lines.push(`  Original Prompt: "${thought.aiPrompt}"`);
                            }
                            thought.criteria?.forEach((crit: any) => {
                              lines.push(`  ${crit.name} (${crit.id})`);
                              if (crit.description) {
                                lines.push(`    Desc: ${crit.description}`);
                              }
                              if (crit.params?.length > 0) {
                                crit.params.forEach((p: any) => {
                                  lines.push(`    ${p.label || p.name}: ${p.value}`);
                                });
                              }
                            });
                          });
                        }
                        
                        if (debugInfo.linkOverrides?.length > 0) {
                          lines.push(`\nAuto-Linked Params:`);
                          debugInfo.linkOverrides.forEach((o: any) => lines.push(`  ${o.thoughtName} / ${o.paramName}: ${o.originalValue} → ${o.linkedValue} (from: ${o.sourceName})`));
                        }
                        if (debugInfo.dynamicDataFlows?.length > 0) {
                          lines.push(`\nDynamic Per-Stock Data:`);
                          debugInfo.dynamicDataFlows.forEach((d: any) => lines.push(`  ${d.dataKey}: ${d.provider} → ${d.consumer} — ${d.description}`));
                        }
                        debugInfo.thoughts?.forEach((t: any) => {
                          const passCount = debugInfo.thoughtCounts[t.nodeId];
                          const funnel = debugInfo.perThoughtFunnel?.[t.nodeId];
                          const funnelStr = funnel ? ` — eval ${funnel.evaluated}/${debugInfo.totalScanned}${funnel.skipped > 0 ? `, ${funnel.skipped} skipped` : ""}` : "";
                          lines.push(`\nThought: ${t.name}${t.isNot ? " [NOT]" : ""} (${t.timeframe})${passCount !== undefined ? ` — ${passCount} pass` : ""}${funnelStr}`);
                          t.criteria?.forEach((c: any) => {
                            lines.push(`  ${c.muted ? "[MUTED] " : ""}${c.indicator}${c.inverted ? " INV" : ""}${c.tfOverride ? ` @${c.tfOverride}` : ""} — ${c.label}`);
                            const paramStr = Object.entries(c.params).map(([k, v]) => `${k}=${String(v)}`).join(", ");
                            if (paramStr) lines.push(`    ${paramStr}`);
                          });
                        });
                        navigator.clipboard.writeText(lines.join("\n"));
                        toast({ title: "Debug info copied to clipboard" });
                      }}
                    >
                      <ClipboardCopy className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p>Copy debug info to clipboard</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="px-3 py-2 space-y-2 text-[10px] font-mono text-muted-foreground leading-relaxed">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span>{debugInfo.timestamp}</span>
                  <span>{debugInfo.durationMs}ms</span>
                  <span>universe: {debugInfo.universe}</span>
                </div>
                <div className="border-t border-dashed pt-1">
                  <span className="font-semibold text-foreground">Result: {debugInfo.matchCount} / {debugInfo.totalScanned}</span>
                </div>
                {debugInfo.ideaName && (
                  <div className="border-t border-dashed pt-1">
                    <span className="font-semibold text-purple-400">Idea:</span>
                    <div className="ml-2 text-foreground/90">"{debugInfo.ideaName}"</div>
                    {debugInfo.ideaDescription && (
                      <div className="ml-2 text-foreground/70 italic text-[11px]">{debugInfo.ideaDescription}</div>
                    )}
                  </div>
                )}
                {debugInfo.evalOrder?.length > 0 && (
                  <div className="border-t border-dashed pt-1">
                    <span className="font-semibold text-foreground">Eval Order:</span>
                    <div className="ml-2">
                      {debugInfo.evalOrder.map((name: string, i: number) => (
                        <span key={i}>{i > 0 ? " → " : ""}{name}</span>
                      ))}
                    </div>
                  </div>
                )}
                {debugInfo.connections.length > 0 && (
                  <div className="border-t border-dashed pt-1">
                    <span className="font-semibold text-foreground">Thought Stems:</span>
                    {debugInfo.connections.map((c: any, i: number) => (
                      <div key={i} className="ml-2">
                        {c.from} <span className={c.logic === "OR" ? "text-rs-yellow" : "text-blue-400"}>{c.logic}</span> {c.to}
                      </div>
                    ))}
                  </div>
                )}
                {debugInfo.linkOverrides?.length > 0 && (
                  <div className="border-t border-dashed pt-1">
                    <span className="font-semibold text-blue-400">Auto-Linked Params:</span>
                    {debugInfo.linkOverrides.map((o: any, i: number) => (
                      <div key={i} className="ml-2">
                        <span className="text-foreground/80">{o.thoughtName}</span>
                        <span className="text-muted-foreground/60"> / {o.paramName}:</span>
                        <span className="text-rs-yellow"> {String(o.originalValue)}</span>
                        <span className="text-muted-foreground/60"> → </span>
                        <span className="text-blue-400">{String(o.linkedValue)}</span>
                        <div className="ml-3 text-muted-foreground/50">from: {o.sourceName}</div>
                      </div>
                    ))}
                  </div>
                )}
                {debugInfo.dynamicDataFlows?.length > 0 && (
                  <div className="border-t border-dashed pt-1">
                    <span className="font-semibold text-emerald-400">Dynamic Per-Stock Data:</span>
                    {debugInfo.dynamicDataFlows.map((d: any, i: number) => (
                      <div key={i} className="ml-2">
                        <span className="text-emerald-300">{d.dataKey}</span>
                        <span className="text-muted-foreground/60">: </span>
                        <span className="text-foreground/80">{d.provider}</span>
                        <span className="text-muted-foreground/60"> → </span>
                        <span className="text-foreground/80">{d.consumer}</span>
                        <div className="ml-3 text-muted-foreground/50">{d.description}</div>
                      </div>
                    ))}
                  </div>
                )}
                {debugInfo.canvasNodes?.length > 0 && (
                  <div className="border-t border-dashed pt-1">
                    <span className="font-semibold text-cyan-400">Canvas Layout:</span>
                    {debugInfo.canvasNodes.map((node: any, i: number) => (
                      <div key={i} className="ml-2 mt-1 border-l-2 border-cyan-500/30 pl-2">
                        <div className="text-foreground/90 font-medium">
                          {node.name} 
                          <span className="text-muted-foreground/60"> ({node.timeframe || 'daily'})</span>
                          {node.muted && <span className="text-muted-foreground/40"> [MUTED]</span>}
                        </div>
                        {node.criteria?.map((crit: any, ci: number) => (
                          <div key={ci} className="ml-3 mt-1">
                            <div className="flex items-start gap-1 flex-wrap">
                              <span className="text-blue-300 font-mono">{crit.indicatorId}</span>
                              <span className="text-muted-foreground/60">—</span>
                              <span className="text-foreground/80">{crit.indicatorName}</span>
                              {crit.muted && <span className="text-muted-foreground/40">[MUTED]</span>}
                              {crit.inverted && <span className="text-rs-yellow">[INV]</span>}
                            </div>
                            {crit.params?.length > 0 && (
                              <div className="ml-4 text-[9px] text-muted-foreground/50 mt-0.5">
                                {crit.params.map((p: any, pi: number) => (
                                  <span key={pi} className="mr-2">{p.label || p.name}={String(p.value)}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
                {debugInfo.fullCriteria?.length > 0 && (
                  <div className="border-t border-dashed pt-1">
                    <span className="font-semibold text-cyan-400">Canvas Layout:</span>
                    {debugInfo.fullCriteria.map((thought: any, i: number) => (
                      <div key={i} className="ml-2 mt-1">
                        <div className="text-foreground/90 font-medium">{thought.thought} <span className="text-muted-foreground/60">({thought.timeframe || 'daily'})</span></div>
                        {thought.aiPrompt && (
                          <div className="ml-2 text-purple-400/80 italic text-[9px]">Prompt: "{thought.aiPrompt}"</div>
                        )}
                        {thought.criteria?.map((crit: any, ci: number) => (
                          <div key={ci} className="ml-3 mt-0.5">
                            <span className="text-blue-300">{crit.id}</span>
                            <span className="text-muted-foreground/60"> — </span>
                            <span className="text-foreground/70">{crit.name}</span>
                            {crit.params?.length > 0 && (
                              <div className="ml-4 text-muted-foreground/50">
                                {crit.params.map((p: any, pi: number) => (
                                  <span key={pi} className="mr-2">{p.label || p.name}={String(p.value)}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
                {debugInfo.thoughts.map((t: any) => {
                  const passCount = debugInfo.thoughtCounts[t.nodeId];
                  const funnel = debugInfo.perThoughtFunnel?.[t.nodeId];
                  return (
                    <div key={t.nodeId} className="border-t border-dashed pt-1">
                      <div className="flex items-center gap-1 flex-wrap">
                        <span className="font-semibold text-foreground">{t.name}</span>
                        {t.isNot && <span className="text-rs-red">[NOT]</span>}
                        <span className="text-muted-foreground/60">({t.timeframe})</span>
                        {funnel && funnel.evaluated < debugInfo.totalScanned ? (
                          <span className="text-muted-foreground/60">eval {funnel.evaluated}</span>
                        ) : null}
                        {passCount !== undefined && (
                          <span className="text-rs-green">{passCount} pass</span>
                        )}
                        {funnel && funnel.skipped > 0 && (
                          <span className="text-muted-foreground/40">{funnel.skipped} skipped</span>
                        )}
                      </div>
                      {t.criteria.map((c: any, ci: number) => (
                        <div key={ci} className={`ml-2 ${c.muted ? "line-through opacity-50" : ""}`}>
                          <span className="text-foreground/80">{c.indicator}</span>
                          {c.inverted && <span className="text-rs-yellow"> INV</span>}
                          {c.tfOverride && <span className="text-cyan-400"> @{c.tfOverride}</span>}
                          <span className="text-muted-foreground/70"> {c.label}</span>
                          <div className="ml-3 text-muted-foreground/50">
                            {Object.entries(c.params).map(([k, v]) => (
                              <span key={k} className="mr-2">{k}={String(v)}</span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
        )}

        <div className="h-6 w-px bg-border mx-1" />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              onClick={() => setDeleteIdeaConfirm(true)}
              disabled={!currentIdeaId}
              className="gap-2 border-red-600/40 text-red-400"
              data-testid="button-delete-idea"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>Permanently delete the currently loaded saved idea</p>
          </TooltipContent>
        </Tooltip>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div
          className="border-r flex flex-col relative flex-shrink-0"
          style={{ backgroundColor: cssVariables.overlayBg, width: thoughtsPanelWidth }}
        >
          <div className="p-3 border-b">
            <Button
              onClick={() => {
                const hasContent = nodes.some(n => n.type !== "results");
                if (hasContent) {
                  setSaveBeforeNewOpen(true);
                } else {
                  setAiDialogOpen(true);
                }
              }}
              size="lg"
              className="w-full gap-2.5 text-sm font-semibold"
              data-testid="button-create-new-idea"
            >
              <span className="bulb-glow-badge">
                <Lightbulb className="h-5 w-5 bulb-glow-icon" />
              </span>
              Create New Idea
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto min-h-0">
            <div className="p-2 space-y-3">
              <div className="flex items-center gap-1.5 px-1">
                <span className="font-semibold uppercase tracking-wide flex-1" style={{ color: cssVariables.textColorSmall, fontSize: cssVariables.fontSizeSmall }}>Thought Library</span>
                {thoughts.length > 0 && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-5 w-5"
                        data-testid="button-collapse-all-categories"
                        onClick={() => {
                          const activeCats = CATEGORY_ORDER.filter((cat) => thoughtsByCategory[cat]?.length);
                          const allCollapsed = activeCats.every(cat => collapsedCategories.has(cat));
                          if (allCollapsed) {
                            setCollapsedCategories(new Set());
                          } else {
                            setCollapsedCategories(new Set(activeCats));
                          }
                        }}
                      >
                        {CATEGORY_ORDER.filter((cat) => thoughtsByCategory[cat]?.length).every(cat => collapsedCategories.has(cat))
                          ? <ChevronsUpDown className="h-3 w-3" />
                          : <ChevronsDownUp className="h-3 w-3" />
                        }
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      <p>{CATEGORY_ORDER.filter((cat) => thoughtsByCategory[cat]?.length).every(cat => collapsedCategories.has(cat)) ? "Expand all categories" : "Collapse all categories"}</p>
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
              {thoughtsLoading ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : thoughts.length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  No thoughts yet. Create one with AI!
                </div>
              ) : (
                CATEGORY_ORDER.filter((cat) => thoughtsByCategory[cat]?.length).map((cat) => {
                  const isCollapsed = collapsedCategories.has(cat);
                  return (
                  <div key={cat}>
                    <button
                      className="flex items-center gap-1.5 px-1 mb-1.5 w-full hover-elevate rounded py-0.5"
                      onClick={() => setCollapsedCategories(prev => {
                        const next = new Set(prev);
                        if (next.has(cat)) next.delete(cat); else next.add(cat);
                        return next;
                      })}
                      data-testid={`button-toggle-category-${cat.replace(/\s+/g, '-').toLowerCase()}`}
                    >
                      {isCollapsed ? <ChevronRight className="h-3 w-3 text-muted-foreground flex-shrink-0" /> : <ChevronDown className="h-3 w-3 text-muted-foreground flex-shrink-0" />}
                      {getCategoryIcon(cat)}
                      <span className="font-medium uppercase tracking-wide flex-1 text-left" style={{ color: cssVariables.textColorTiny, fontSize: cssVariables.fontSizeTiny }}>{cat}</span>
                      <span className="text-muted-foreground" style={{ fontSize: cssVariables.fontSizeTiny }}>{thoughtsByCategory[cat].length}</span>
                    </button>
                    {!isCollapsed && (
                    <div className="space-y-1">
                      {thoughtsByCategory[cat].map((thought) => (
                        <div
                          key={thought.id}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData("application/bigidea-thought", JSON.stringify(thought));
                            e.dataTransfer.effectAllowed = "move";
                          }}
                          onClick={() => {
                            setPreviewThoughtId(prev => prev === thought.id ? null : thought.id);
                            setSelectedNodeId(null);
                            setShowResults(false);
                          }}
                          className={`rounded-md border px-2.5 py-2 cursor-grab active:cursor-grabbing hover-elevate ${previewThoughtId === thought.id ? "border-primary/50 bg-primary/5" : ""}`}
                          data-testid={`thought-card-${thought.id}`}
                        >
                          <div className="flex items-center gap-1.5">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  className="flex-shrink-0 p-0.5 rounded text-rs-green hover:text-rs-green/80 transition-colors"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    e.preventDefault();
                                    addThoughtToCanvas(thought);
                                  }}
                                  data-testid={`button-add-thought-${thought.id}`}
                                >
                                  <Plus className="h-3.5 w-3.5" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="right">Add to canvas</TooltipContent>
                            </Tooltip>
                            <GripVertical className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                            <span className="text-sm font-medium truncate flex-1">{thought.name}</span>
                            {(thought as any).score !== undefined && (thought as any).score !== 0 && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className={`text-[10px] font-mono font-medium flex-shrink-0 ${getScoreColor((thought as any).score)}`} data-testid={`text-thought-score-${thought.id}`}>
                                    {(thought as any).score > 0 ? "+" : ""}{(thought as any).score}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent side="right">AI score: accumulated from modifications, scans, and chart ratings</TooltipContent>
                              </Tooltip>
                            )}
                            {thought.timeframe && thought.timeframe !== "daily" && (
                              <Badge variant="outline" className="text-[9px] px-1 py-0 flex-shrink-0">
                                {thought.timeframe === "5min" ? "5m" : thought.timeframe === "15min" ? "15m" : thought.timeframe === "30min" ? "30m" : thought.timeframe}
                              </Badge>
                            )}
                            <button
                              className="flex-shrink-0 p-0.5 rounded text-destructive/70 hover:text-destructive transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                setDeleteConfirm({ thoughtId: thought.id, name: thought.name });
                              }}
                              data-testid={`button-delete-thought-${thought.id}`}
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                          {thought.description && (
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 ml-[18px]">
                              {thought.description}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                    )}
                  </div>
                  );
                })
              )}
            </div>
            <div
              style={{ backgroundColor: cssVariables.secondaryOverlayColor + "18" }}
              data-testid="left-pane-lower"
            >
          </div>
          <div className="h-12 flex-shrink-0" />
          </div>
          <div
            className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-primary/20 active:bg-primary/30 z-10"
            onPointerDown={handleThoughtsResizeStart}
            data-testid="thoughts-resize-handle"
          />
        </div>

        <div className="flex-1 relative" ref={reactFlowWrapper}>
          <ReactFlow
            nodes={nodesWithCallbacks}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onInit={setReactFlowInstance}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            defaultEdgeOptions={{ type: "logic" }}
            fitView
            className="bg-background"
            data-testid="canvas-react-flow"
          >
            <Background gap={16} size={1} />
            <Controls data-testid="canvas-controls" />
            <OptimizerMetricsOverlay />
            <MiniMap
              nodeColor={(n) => {
                if (n.type === "results") return "hsl(var(--primary))";
                if (n.data?.isMuted) return "hsl(var(--muted) / 0.5)";
                if (n.data?.isNot) return "hsl(0, 80%, 50%)";
                return "hsl(var(--muted-foreground))";
              }}
              data-testid="canvas-minimap"
            />
          </ReactFlow>
        </div>

        {(showResults || selectedNode || previewThought) && (
          <div className="border-l flex flex-col relative" style={{ width: detailPanelWidth, backgroundColor: cssVariables.overlayBg }}>
            <div
              className="absolute top-0 left-0 w-1.5 h-full cursor-col-resize hover:bg-primary/20 active:bg-primary/30 z-10"
              onPointerDown={handleDetailResizeStart}
              data-testid="detail-resize-handle"
            />
            <div className="p-3 border-b flex items-center justify-between gap-2">
              <span className="font-semibold" style={{ color: cssVariables.textColorSection, fontSize: cssVariables.fontSizeSection }}>
                {showResults ? "Scan Results" : previewThought ? "Thought Preview" : "Thought Details"}
              </span>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => {
                  if (!showResults && !previewThought && scanResults && scanResults.length > 0) {
                    setSelectedNodeId(null);
                    setShowResults(true);
                  } else {
                    setShowResults(false);
                    setSelectedNodeId(null);
                    setPreviewThoughtId(null);
                  }
                }}
                data-testid="button-close-panel"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <ScrollArea className="flex-1">
              {showResults && scanResults && (
                <div className="p-3 pr-5 space-y-3">
                  <div className="text-center">
                    <span
                      className={`text-3xl font-bold ${
                        scanResults.length === 0
                          ? "text-rs-red"
                          : scanResults.length <= 50
                          ? "text-rs-green"
                          : "text-rs-yellow"
                      }`}
                      data-testid="text-scan-count"
                    >
                      {scanResults.length}
                    </span>
                    <p style={{ color: cssVariables.textColorTiny, fontSize: cssVariables.fontSizeTiny }}>
                      matches from {scanTotalScanned} scanned
                    </p>
                    {scanResults.length > 0 && (
                      <div className="mt-2">
                        <BulkAddToWatchlist 
                          symbols={scanResults.map(r => r.symbol)}
                        />
                      </div>
                    )}
                  </div>

                  {scanResults.length === 0 && (() => {
                    const thoughtNodes = nodes.filter((n) => n.type === "thought");
                    const resultsNodeId = nodes.find((n) => n.type === "results")?.id;
                    if (!resultsNodeId || thoughtNodes.length < 2) return null;
                    const indicatorGroups = new Map<string, string[]>();
                    for (const t of thoughtNodes) {
                      const criteria = (t.data.criteria as any[]) || [];
                      if (criteria.length === 1) {
                        const indId = criteria[0].indicatorId;
                        if (!indicatorGroups.has(indId)) indicatorGroups.set(indId, []);
                        indicatorGroups.get(indId)!.push(t.id);
                      }
                    }
                    const candidateGroups: { ids: string[]; names: string[] }[] = [];
                    for (const [, ids] of Array.from(indicatorGroups.entries())) {
                      if (ids.length >= 2) {
                        const allAnd = ids.every((id: string) => {
                          const edge = edges.find((e) => e.source === id && e.target === resultsNodeId);
                          return !edge || (edge.data?.logicType || "AND") === "AND";
                        });
                        if (allAnd) {
                          candidateGroups.push({
                            ids,
                            names: ids.map((id: string) => (nodes.find((n) => n.id === id)?.data.label as string) || id),
                          });
                        }
                      }
                    }
                    if (candidateGroups.length === 0) return null;
                    const switchToOr = (nodeIds: string[]) => {
                      setEdges((eds) => {
                        const updated = eds.map((e) => {
                          if (nodeIds.includes(e.source) && e.target === resultsNodeId) {
                            return { ...e, data: { ...e.data, logicType: "OR" } };
                          }
                          return e;
                        });
                        const existingSources = new Set(updated.filter((e) => e.target === resultsNodeId).map((e) => e.source));
                        const newEdges: Edge[] = [];
                        for (const nid of nodeIds) {
                          if (!existingSources.has(nid)) {
                            const edgeId = `e-${nid}-${resultsNodeId}-or`;
                            newEdges.push({
                              id: edgeId,
                              source: nid,
                              target: resultsNodeId!,
                              type: "logic",
                              data: {
                                logicType: "OR",
                                onToggle: () => {
                                  setEdges((es) =>
                                    es.map((e2) => {
                                      if (e2.id === edgeId) {
                                        const cur = e2.data?.logicType === "AND" ? "OR" : "AND";
                                        return { ...e2, data: { ...e2.data, logicType: cur } };
                                      }
                                      return e2;
                                    })
                                  );
                                },
                                onDelete: () => setEdges((es) => es.filter((e2) => e2.id !== edgeId)),
                              },
                            });
                          }
                        }
                        return [...updated, ...newEdges];
                      });
                    };
                    return (
                      <div className="rounded-md border border-rs-amber/30 bg-rs-amber/5 p-2 text-xs space-y-1.5" data-testid="or-suggestion-hint">
                        <p className="text-rs-amber font-medium">Similar thoughts are all AND-connected</p>
                        <p className="text-muted-foreground">These look like alternatives — a stock can only be near one MA at a time. Switch to OR so any one match counts.</p>
                        {candidateGroups.map((g, i) => (
                          <div key={i} className="flex items-center gap-2 flex-wrap">
                            <span className="text-muted-foreground">{g.names.join(", ")}</span>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 text-xs px-2"
                              data-testid={`button-switch-or-${i}`}
                              onClick={() => switchToOr(g.ids)}
                            >
                              Switch to OR
                            </Button>
                          </div>
                        ))}
                      </div>
                    );
                  })()}

                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleSortToggle("ticker")}
                      className="gap-1 text-xs"
                      data-testid="button-sort-ticker"
                    >
                      Ticker
                      {resultSort === "ticker" && <ArrowDown className={`h-3 w-3 ${resultSortDir === "desc" ? "rotate-180" : ""}`} />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleSortToggle("price")}
                      className="gap-1 text-xs"
                      data-testid="button-sort-price"
                    >
                      Price
                      {resultSort === "price" && <ArrowDown className={`h-3 w-3 ${resultSortDir === "desc" ? "rotate-180" : ""}`} />}
                    </Button>
                  </div>

                  <div className="space-y-1">
                    {sortedResults.map((r, idx) => (
                      <div
                        key={r.symbol}
                        className="flex items-center justify-between rounded-md border px-2.5 py-1.5 cursor-pointer hover-elevate"
                        data-testid={`result-stock-${r.symbol}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          setChartViewerIndex(idx);
                          setTimeout(() => setChartViewerOpen(true), 0);
                        }}
                      >
                        <div>
                          <span className="text-sm font-medium">{r.symbol}</span>
                          <div className="flex items-center gap-1 flex-wrap mt-0.5">
                            {r.passedPaths.map((p) => (
                              <Badge key={p} variant="outline" className="text-[10px] px-1 py-0">
                                {p}
                              </Badge>
                            ))}
                          </div>
                        </div>
                        <span className="text-sm font-mono text-muted-foreground">
                          ${r.price.toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!showResults && !selectedNode && previewThought && (
                <div className="p-3 pr-5 space-y-4 opacity-70" data-testid="thought-preview-panel">
                  <div className="rounded-md border border-dashed border-primary/40 bg-primary/5 px-3 py-2.5 text-center">
                    <GripVertical className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
                    <p className="text-xs text-muted-foreground font-medium">Drag onto canvas to adjust parameters</p>
                  </div>
                  <div>
                    <span className="text-sm font-semibold">{previewThought.name}</span>
                    {previewThought.description && (
                      <p className="text-xs text-muted-foreground mt-1">{previewThought.description}</p>
                    )}
                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                      {previewThought.timeframe && (
                        <Badge variant="outline" className="text-[10px]">
                          {previewThought.timeframe === "5min" ? "5m" : previewThought.timeframe === "15min" ? "15m" : previewThought.timeframe === "30min" ? "30m" : previewThought.timeframe}
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-[10px]">{previewThought.category}</Badge>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Criteria
                    </Label>
                    {(previewThought.criteria || []).map((criterion, idx) => {
                      const indMeta = indicatorLibrary.find((i) => i.id === criterion.indicatorId);
                      return (
                        <Card key={idx} className="overflow-visible">
                          <CardHeader className="p-2.5 pb-1.5">
                            <CardTitle className="text-xs">{criterion.label}</CardTitle>
                          </CardHeader>
                          <CardContent className="p-2.5 pt-0 space-y-2">
                            {indMeta?.description && (
                              <p className="text-[11px] text-muted-foreground/80 leading-relaxed pb-1 border-b border-border/40 mb-1">{indMeta.description}</p>
                            )}
                            {criterion.params.map((param) => (
                              <div key={param.name}>
                                <div className="flex items-center gap-1">
                                  <Label className="text-[11px] text-muted-foreground">{param.label}</Label>
                                  {PARAM_DESCRIPTIONS[param.name] && (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <HelpCircle className="h-3 w-3 text-muted-foreground/60 cursor-help shrink-0" />
                                      </TooltipTrigger>
                                      <TooltipContent side="top" align="end" className="max-w-[260px] text-xs">
                                        {PARAM_DESCRIPTIONS[param.name]}
                                      </TooltipContent>
                                    </Tooltip>
                                  )}
                                </div>
                                {param.type === "number" && (
                                  <div className="mt-1">
                                    <Slider
                                      disabled
                                      value={[param.value as number]}
                                      min={param.min ?? 0}
                                      max={param.max ?? 100}
                                      step={param.step ?? 1}
                                      className="pointer-events-none"
                                    />
                                    <span className="text-[10px] font-mono text-muted-foreground">{String(param.value)}</span>
                                  </div>
                                )}
                                {param.type === "select" && (
                                  <div className="mt-1">
                                    <Badge variant="secondary" className="text-[10px]">{String(param.value)}</Badge>
                                  </div>
                                )}
                                {param.type === "boolean" && (
                                  <div className="mt-1">
                                    <Badge variant={param.value ? "default" : "outline"} className="text-[10px]">{param.value ? "Yes" : "No"}</Badge>
                                  </div>
                                )}
                              </div>
                            ))}
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                  <Button
                    className="w-full gap-2"
                    onClick={() => {
                      addThoughtToCanvas(previewThought);
                      setPreviewThoughtId(null);
                    }}
                    data-testid="button-preview-add-to-canvas"
                  >
                    <Plus className="h-4 w-4" />
                    Add to Canvas
                  </Button>
                </div>
              )}

              {!showResults && selectedNode && selectedNode.type === "thought" && (
                <div className="p-3 pr-5 space-y-4">
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <Input
                        value={selectedNode.data.label as string}
                        onChange={(e) => {
                          const val = e.target.value;
                          setNodes((nds) => nds.map((n) =>
                            n.id === selectedNode.id ? { ...n, data: { ...n.data, label: val, userRenamed: true } } : n
                          ));
                        }}
                        className="text-sm font-semibold flex-1 border-transparent hover:border-border focus:border-border bg-transparent"
                        data-testid="input-thought-name"
                      />
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-[10px] shrink-0"
                            onClick={() => {
                              updateNodeTitle(selectedNode.id);
                              setNodes((nds) => nds.map((n) =>
                                n.id === selectedNode.id ? { ...n, data: { ...n.data, userRenamed: false } } : n
                              ));
                            }}
                            data-testid="button-auto-rename"
                          >
                            Auto-name
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top" align="end" className="max-w-[260px] text-xs">
                          Generate a name from the active criteria. Clears any custom name you set.
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    {selectedNode.data.description ? (
                      <p className="text-xs text-muted-foreground mt-1">
                        {String(selectedNode.data.description)}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => clearNodeFromCanvas(selectedNode.id)}
                      className="gap-1 text-xs"
                      data-testid="button-clear-selected"
                    >
                      <X className="h-3 w-3" />
                      Clear
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => requestDeleteThought(selectedNode.id, selectedNode.data.thoughtId as number, selectedNode.data.label as string)}
                      className="gap-1 text-xs"
                      data-testid="button-delete-selected"
                    >
                      <Trash2 className="h-3 w-3" />
                      Delete
                    </Button>
                    <Button
                      variant={selectedNode.data.isNot ? "destructive" : "outline"}
                      size="sm"
                      onClick={() => toggleNotOnNode(selectedNode.id)}
                      className="gap-1"
                      data-testid="button-toggle-not"
                    >
                      <Ban className="h-3 w-3" />
                      <span className="font-mono text-[11px]">[NOT]</span> {selectedNode.data.isNot ? "On" : "Off"}
                    </Button>
                    <Button
                      variant={selectedNode.data.isMuted ? "secondary" : "outline"}
                      size="sm"
                      onClick={() => toggleMuteOnNode(selectedNode.id)}
                      className="gap-1"
                      data-testid="button-toggle-mute"
                      title="Mute this thought so the scan skips it — useful for testing different combinations without removing thoughts"
                    >
                      <EyeOff className="h-3 w-3" />
                      {selectedNode.data.isMuted ? "Unmute" : "Mute"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const existingPrompt = (selectedNode.data as any).aiPrompt;
                        const matchingThought = thoughts.find(t => t.id === selectedNode.data.thoughtId);
                        setRestateText(existingPrompt || matchingThought?.aiPrompt || "");
                        setRestateNodeId(selectedNode.id);
                      }}
                      className="gap-1 text-xs"
                      data-testid="button-restate"
                    >
                      <Music className="h-3 w-3" />
                      Restate
                    </Button>
                  </div>

                  {restateNodeId === selectedNode.id && (
                    <div className="space-y-2 border border-border rounded p-2.5">
                      <Label className="text-xs text-muted-foreground">Describe what you want this thought to screen for:</Label>
                      <Textarea
                        value={restateText}
                        onChange={(e) => setRestateText(e.target.value)}
                        placeholder="e.g. stocks pulling back to 50 SMA with tight consolidation"
                        className="text-xs min-h-[60px]"
                        data-testid="textarea-restate"
                      />
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          onClick={() => restateMutation.mutate({ nodeId: selectedNode.id, description: restateText })}
                          disabled={!restateText.trim() || restateMutation.isPending}
                          className="gap-1 text-xs"
                          data-testid="button-restate-submit"
                        >
                          {restateMutation.isPending ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Music className="h-3 w-3" />
                          )}
                          Regenerate
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => { setRestateNodeId(null); setRestateText(""); }}
                          className="text-xs"
                          data-testid="button-restate-cancel"
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}

                  <div className="space-y-3">
                    <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Criteria
                    </Label>
                    {(selectedNode.data.criteria as ScannerCriterion[])?.map((criterion, idx) => (
                      <Card key={idx} className={`overflow-visible ${criterion.muted ? "opacity-40" : ""}`}>
                        <CardHeader className="p-2.5 pb-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <CardTitle className={`text-xs flex-1 ${criterion.muted ? "line-through" : ""}`}>{criterion.label}</CardTitle>
                            <div className="flex items-center gap-0.5">
                              <Button
                                variant={criterion.inverted ? "destructive" : "ghost"}
                                size="sm"
                                onClick={() => toggleCriterionInvert(selectedNode.id, idx)}
                                className="h-6 text-[10px] px-1.5"
                                data-testid={`button-invert-criterion-${idx}`}
                              >
                                {criterion.inverted ? "Inverted" : "Normal"}
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => toggleCriterionMute(selectedNode.id, idx)}
                                className="h-6 w-6"
                                data-testid={`button-mute-criterion-${idx}`}
                              >
                                <Ban className={`h-3 w-3 ${criterion.muted ? "text-rs-yellow" : ""}`} />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => deleteCriterion(selectedNode.id, idx)}
                                className="h-6 w-6"
                                data-testid={`button-delete-criterion-${idx}`}
                              >
                                <Trash2 className="h-3 w-3 text-destructive" />
                              </Button>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="p-2.5 pt-0 space-y-2">
                          {(() => {
                            const indMeta = indicatorLibrary.find((i) => i.id === criterion.indicatorId);
                            return indMeta?.description ? (
                              <p className="text-[11px] text-muted-foreground/80 leading-relaxed pb-1 border-b border-border/40 mb-1">{indMeta.description}</p>
                            ) : null;
                          })()}
                          <div>
                            <div className="flex items-center gap-1">
                              <Label className="text-[11px] text-muted-foreground">Data Timeframe</Label>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <HelpCircle className="h-3 w-3 text-muted-foreground/60 cursor-help shrink-0" />
                                </TooltipTrigger>
                                <TooltipContent side="top" align="end" className="max-w-[260px] text-xs">
                                  Override which candle timeframe this criterion evaluates against. Use "daily" on an intraday thought to check daily-level conditions like the daily 50 SMA.
                                </TooltipContent>
                              </Tooltip>
                            </div>
                            <Select
                              value={criterion.timeframeOverride || "__inherit__"}
                              onValueChange={(v) =>
                                setCriterionTimeframeOverride(selectedNode.id, idx, v === "__inherit__" ? undefined : v)
                              }
                            >
                              <SelectTrigger className="h-7 text-xs mt-1" data-testid={`select-tf-override-${idx}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__inherit__">Inherit from thought</SelectItem>
                                <SelectItem value="daily">Daily</SelectItem>
                                <SelectItem value="5min">5 min</SelectItem>
                                <SelectItem value="15min">15 min</SelectItem>
                                <SelectItem value="30min">30 min</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          {criterion.params.map((param) => {
                            const isLinkable = !!param.autoLink;
                            const isLinked = isLinkable && param.autoLinked !== false;
                            const linkedVal = isLinked ? getLinkedValue(param, selectedNode.id) : null;
                            const displayValue = linkedVal ? linkedVal.value : param.value;
                            const linkSources = isLinkable ? findLinkSources(selectedNode.id, param.autoLink!.linkType) : [];

                            return (
                            <div key={param.name}>
                              <div className="flex items-center gap-1">
                                <Label className="text-[11px] text-muted-foreground">{param.label}</Label>
                                {PARAM_DESCRIPTIONS[param.name] && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <HelpCircle className="h-3 w-3 text-muted-foreground/60 cursor-help shrink-0" data-testid={`help-${param.name}`} />
                                    </TooltipTrigger>
                                    <TooltipContent side="top" align="end" className="max-w-[260px] text-xs">
                                      {PARAM_DESCRIPTIONS[param.name]}
                                    </TooltipContent>
                                  </Tooltip>
                                )}
                                {isLinkable && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                        className={`ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                                          isLinked
                                            ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                                            : "bg-muted text-muted-foreground border border-transparent"
                                        }`}
                                        onClick={() => {
                                          if (isLinked) {
                                            updateParamLinkState(selectedNode.id, idx, param.name, false);
                                          } else {
                                            const autoTarget = linkSources.length === 1 ? linkSources[0].nodeId : undefined;
                                            updateParamLinkState(selectedNode.id, idx, param.name, true, autoTarget);
                                          }
                                        }}
                                        data-testid={`button-link-${param.name}-${idx}`}
                                      >
                                        {isLinked ? <Link2 className="h-3 w-3" /> : <Unlink className="h-3 w-3" />}
                                        {isLinked ? "Linked" : "Manual"}
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" align="end" className="max-w-[280px] text-xs">
                                      {isLinked
                                        ? "This value is auto-synced from a companion base indicator on the canvas. Click to switch to manual entry."
                                        : "Click to auto-link this value to a base indicator on the canvas."}
                                    </TooltipContent>
                                  </Tooltip>
                                )}
                              </div>
                              {isLinked && linkedVal && (
                                <div className="mt-1 flex items-center gap-1.5 text-[10px] text-blue-400">
                                  <Link2 className="h-3 w-3 shrink-0" />
                                  <span className="truncate">{linkedVal.sourceName} = {String(linkedVal.value)}</span>
                                </div>
                              )}
                              {(() => {
                                const meta = indicatorLibrary.find((m) => m.id === criterion.indicatorId);
                                const consumeEntry = meta?.consumes?.find((c) => c.paramName === param.name);
                                if (!consumeEntry) return null;
                                return (
                                  <div className="mt-1 flex items-center gap-1.5 text-[10px] text-emerald-400">
                                    <Zap className="h-3 w-3 shrink-0" />
                                    <span>Per-stock dynamic: uses <span className="font-medium">{consumeEntry.dataKey}</span> from upstream at scan time</span>
                                  </div>
                                );
                              })()}
                              {isLinked && !linkedVal && linkSources.length === 0 && (
                                <div className="mt-1 text-[10px] text-rs-yellow">
                                  No compatible source found on canvas. Add a base/consolidation thought.
                                </div>
                              )}
                              {isLinked && linkSources.length > 1 && (
                                <Select
                                  value={param.linkedThoughtId || "__auto__"}
                                  onValueChange={(v) =>
                                    updateParamLinkState(selectedNode.id, idx, param.name, true, v === "__auto__" ? undefined : v)
                                  }
                                >
                                  <SelectTrigger className="h-6 text-[10px] mt-1" data-testid={`select-link-source-${param.name}-${idx}`}>
                                    <SelectValue placeholder="Select source..." />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="__auto__">Auto (largest period)</SelectItem>
                                    {linkSources.map((src) => (
                                      <SelectItem key={src.nodeId} value={src.nodeId}>
                                        {src.nodeName} → {src.indicatorName} ({String(src.paramValue)})
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              )}
                              {param.type === "number" && (() => {
                                const indMeta = indicatorLibrary.find((m) => m.id === criterion.indicatorId);
                                const metaParam = indMeta?.params.find((mp) => mp.name === param.name);
                                const pMin = param.min ?? metaParam?.min ?? 0;
                                const pMax = param.max ?? metaParam?.max ?? 100;
                                const pStep = param.step ?? metaParam?.step ?? 1;
                                return (
                                <div className="flex items-center gap-2 mt-1">
                                  <Slider
                                    value={[Number(displayValue)]}
                                    min={pMin}
                                    max={pMax}
                                    step={pStep}
                                    onValueChange={([v]) =>
                                      updateNodeCriterionParam(selectedNode.id, idx, param.name, v)
                                    }
                                    className="flex-1"
                                    disabled={isLinked && !!linkedVal}
                                    data-testid={`slider-${param.name}-${idx}`}
                                  />
                                  <Input
                                    type="number"
                                    value={Number(displayValue)}
                                    min={pMin}
                                    max={pMax}
                                    step={pStep}
                                    disabled={isLinked && !!linkedVal}
                                    onChange={(e) => {
                                      const raw = e.target.value;
                                      if (raw === "" || raw === "-") return;
                                      let v = Number(raw);
                                      if (isNaN(v)) return;
                                      if (v > pMax) v = pMax;
                                      updateNodeCriterionParam(selectedNode.id, idx, param.name, v);
                                    }}
                                    onBlur={(e) => {
                                      let v = Number(e.target.value);
                                      if (isNaN(v) || v < pMin) {
                                        updateNodeCriterionParam(selectedNode.id, idx, param.name, pMin);
                                      }
                                    }}
                                    className={`w-14 h-6 text-xs font-mono text-right px-1 ${isLinked && linkedVal ? "text-blue-400" : ""}`}
                                    data-testid={`input-${param.name}-${idx}`}
                                  />
                                </div>
                                );
                              })()}
                              {param.type === "select" && param.options && (
                                <Select
                                  value={String(param.value)}
                                  onValueChange={(v) =>
                                    updateNodeCriterionParam(selectedNode.id, idx, param.name, v)
                                  }
                                >
                                  <SelectTrigger className="h-7 text-xs mt-1" data-testid={`select-${param.name}-${idx}`}>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {param.options.map((opt) => (
                                      <SelectItem key={opt} value={opt}>
                                        {opt}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              )}
                              {param.type === "boolean" && (
                                <Button
                                  variant={param.value ? "default" : "outline"}
                                  size="sm"
                                  className="mt-1 text-xs"
                                  onClick={() =>
                                    updateNodeCriterionParam(selectedNode.id, idx, param.name, !param.value)
                                  }
                                  data-testid={`toggle-${param.name}-${idx}`}
                                >
                                  {param.value ? "Yes" : "No"}
                                </Button>
                              )}
                            </div>
                            );
                          })}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
            </ScrollArea>
          </div>
        )}
      </div>

      <Dialog open={aiDialogOpen} onOpenChange={setAiDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Music className="h-5 w-5" />
              {nodes.some(n => n.type !== "results") ? "Add Thought with AI" : "Create New Idea"}
            </DialogTitle>
            <DialogDescription>
              Describe your screening idea in plain English and AI will generate the criteria.
            </DialogDescription>
          </DialogHeader>

          {!aiProposal ? (
            <div className="space-y-4">
              <Textarea
                placeholder='e.g., "Find stocks trading above their 50-day SMA with increasing volume and RSI between 50 and 70"'
                value={aiDescription}
                onChange={(e) => setAiDescription(e.target.value)}
                rows={4}
                data-testid="textarea-ai-description"
              />
              <DialogFooter>
                <Button
                  onClick={() => aiCreateMutation.mutate(aiDescription)}
                  disabled={!aiDescription.trim() || aiCreateMutation.isPending}
                  className="gap-2"
                  data-testid="button-ai-generate"
                >
                  {aiCreateMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Music className="h-4 w-4" />
                  )}
                  Generate
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
              {(aiProposal.thoughts || []).length > 1 && (
                <div className="px-3 py-2.5 rounded-md bg-accent/30 border border-accent/20 space-y-1.5">
                  <p className="text-sm font-medium">
                    Your screen idea will be {aiProposal.thoughts.length} separate thoughts.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    If, after we create these thoughts, you would like to mute any part of this idea, click on the thought and select "mute." You can toggle this on and off.
                  </p>
                </div>
              )}

              {(aiProposal.thoughts || []).map((thought: any, tIdx: number) => (
                <div key={thought.thoughtKey || tIdx} className="space-y-3">
                  {(aiProposal.thoughts || []).length > 1 && (
                    <div className="flex items-center gap-2 border-b border-border/60 pb-1">
                      <Badge variant="outline" className="text-[10px]">{thought.thoughtKey}</Badge>
                      <span className="text-xs font-semibold">{thought.name}</span>
                      {thought.reuseThoughtId && (
                        <Badge variant="secondary" className="text-[9px]" data-testid={`badge-reused-${tIdx}`}>Reusing existing</Badge>
                      )}
                    </div>
                  )}

                  {(aiProposal.thoughts || []).length === 1 && (
                    <div>
                      <Label className="text-xs text-muted-foreground">Name</Label>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{thought.name}</p>
                        {thought.reuseThoughtId && (
                          <Badge variant="secondary" className="text-[9px]" data-testid="badge-reused-single">Reusing existing</Badge>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-4 flex-wrap">
                    <div>
                      <Label className="text-xs text-muted-foreground">Category</Label>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {getCategoryIcon(thought.category)}
                        <span className="text-sm">{thought.category}</span>
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Timeframe</Label>
                      <Select
                        value={thought.timeframe || "daily"}
                        onValueChange={(v) => {
                          const updated = { ...aiProposal, thoughts: aiProposal.thoughts.map((t: any, i: number) =>
                            i === tIdx ? { ...t, timeframe: v } : t
                          )};
                          setAiProposal(updated);
                        }}
                      >
                        <SelectTrigger className="h-7 text-xs mt-1 w-32" data-testid={`select-ai-timeframe-${tIdx}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="daily">Daily</SelectItem>
                          <SelectItem value="5min">5 min</SelectItem>
                          <SelectItem value="15min">15 min</SelectItem>
                          <SelectItem value="30min">30 min</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div>
                    <Label className="text-xs text-muted-foreground">Description</Label>
                    <p className="text-sm">{thought.description}</p>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Criteria ({thought.criteria?.length || 0})
                    </Label>
                    {thought.criteria?.map((criterion: any, idx: number) => (
                      <Card key={idx} className="overflow-visible">
                        <CardContent className="p-2.5 space-y-2">
                          <span className="text-xs font-medium">{criterion.label}</span>
                          {criterion.params?.map((param: ScannerCriterionParam) => (
                            <div key={param.name}>
                              <div className="flex items-center gap-1">
                                <Label className="text-[11px] text-muted-foreground">{param.label}</Label>
                                {PARAM_DESCRIPTIONS[param.name] && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <HelpCircle className="h-3 w-3 text-muted-foreground/60 cursor-help shrink-0" data-testid={`ai-help-${param.name}-${tIdx}-${idx}`} />
                                    </TooltipTrigger>
                                    <TooltipContent side="top" align="end" className="max-w-[260px] text-xs">
                                      {PARAM_DESCRIPTIONS[param.name]}
                                    </TooltipContent>
                                  </Tooltip>
                                )}
                              </div>
                              {param.type === "number" && (() => {
                                const aiIndMeta = indicatorLibrary.find((m) => m.id === criterion.indicatorId);
                                const aiMetaParam = aiIndMeta?.params.find((mp) => mp.name === param.name);
                                const aiPMin = param.min ?? aiMetaParam?.min ?? 0;
                                const aiPMax = param.max ?? aiMetaParam?.max ?? 100;
                                const aiPStep = param.step ?? aiMetaParam?.step ?? 1;
                                return (
                                <div className="flex items-center gap-2 mt-1">
                                  <Slider
                                    value={[Number(param.value)]}
                                    min={aiPMin}
                                    max={aiPMax}
                                    step={aiPStep}
                                    onValueChange={([v]) => {
                                      const updated = { ...aiProposal, thoughts: aiProposal.thoughts.map((t: any, ti: number) => {
                                        if (ti !== tIdx) return t;
                                        return { ...t, criteria: t.criteria.map((c: any, ci: number) => {
                                          if (ci !== idx) return c;
                                          return { ...c, params: c.params.map((p: any) => p.name === param.name ? { ...p, value: v } : p) };
                                        })};
                                      })};
                                      setAiProposal(updated);
                                    }}
                                    className="flex-1"
                                    data-testid={`ai-slider-${param.name}-${tIdx}-${idx}`}
                                  />
                                  <Input
                                    type="number"
                                    value={Number(param.value)}
                                    min={aiPMin}
                                    max={aiPMax}
                                    step={aiPStep}
                                    onChange={(e) => {
                                      const raw = e.target.value;
                                      if (raw === "" || raw === "-") return;
                                      let v = Number(raw);
                                      if (isNaN(v)) return;
                                      if (v > aiPMax) v = aiPMax;
                                      const updated = { ...aiProposal, thoughts: aiProposal.thoughts.map((t: any, ti: number) => {
                                        if (ti !== tIdx) return t;
                                        return { ...t, criteria: t.criteria.map((c: any, ci: number) => {
                                          if (ci !== idx) return c;
                                          return { ...c, params: c.params.map((p: any) => p.name === param.name ? { ...p, value: v } : p) };
                                        })};
                                      })};
                                      setAiProposal(updated);
                                    }}
                                    onBlur={(e) => {
                                      let v = Number(e.target.value);
                                      if (isNaN(v) || v < aiPMin) {
                                        const updated = { ...aiProposal, thoughts: aiProposal.thoughts.map((t: any, ti: number) => {
                                          if (ti !== tIdx) return t;
                                          return { ...t, criteria: t.criteria.map((c: any, ci: number) => {
                                            if (ci !== idx) return c;
                                            return { ...c, params: c.params.map((p: any) => p.name === param.name ? { ...p, value: aiPMin } : p) };
                                          })};
                                        })};
                                        setAiProposal(updated);
                                      }
                                    }}
                                    className="w-14 h-6 text-xs font-mono text-right px-1"
                                    data-testid={`ai-input-${param.name}-${tIdx}-${idx}`}
                                  />
                                </div>
                                );
                              })()}
                              {param.type === "select" && param.options && (
                                <Select
                                  value={String(param.value)}
                                  onValueChange={(v) => {
                                    const updated = { ...aiProposal, thoughts: aiProposal.thoughts.map((t: any, ti: number) => {
                                      if (ti !== tIdx) return t;
                                      return { ...t, criteria: t.criteria.map((c: any, ci: number) => {
                                        if (ci !== idx) return c;
                                        return { ...c, params: c.params.map((p: any) => p.name === param.name ? { ...p, value: v } : p) };
                                      })};
                                    })};
                                    setAiProposal(updated);
                                  }}
                                >
                                  <SelectTrigger className="h-7 text-xs mt-1" data-testid={`ai-select-${param.name}-${tIdx}-${idx}`}>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {param.options.map((opt) => (
                                      <SelectItem key={opt} value={opt}>
                                        {opt}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              )}
                            </div>
                          ))}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              ))}

              {(aiProposal.edges || []).length > 0 && (
                <div className="space-y-1">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Data Links
                  </Label>
                  {aiProposal.edges.map((edge: any, eIdx: number) => {
                    const fromT = aiProposal.thoughts.find((t: any) => t.thoughtKey === edge.from);
                    const toT = aiProposal.thoughts.find((t: any) => t.thoughtKey === edge.to);
                    return (
                      <div key={eIdx} className="flex items-center gap-2 text-xs text-emerald-400">
                        <Zap className="h-3 w-3 shrink-0" />
                        <span>{fromT?.name || edge.from}</span>
                        <span className="text-muted-foreground">&rarr;</span>
                        <span>{toT?.name || edge.to}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Refinement Chat Section */}
              <div className="border-t border-border/60 pt-3 mt-3">
                <div className="flex items-center gap-2 mb-2">
                  <MessageSquare className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Refine with AI
                  </span>
                </div>
                
                {/* Conversation History */}
                {refinementChat.length > 0 && (
                  <div className="space-y-2 mb-3 max-h-32 overflow-y-auto">
                    {refinementChat.map((msg, idx) => (
                      <div
                        key={idx}
                        className={`text-xs px-2 py-1.5 rounded ${
                          msg.role === "user"
                            ? "bg-primary/10 text-primary ml-4"
                            : "bg-muted/50 mr-4"
                        }`}
                      >
                        {msg.content}
                      </div>
                    ))}
                  </div>
                )}

                {/* Refinement Input */}
                <div className="flex gap-2">
                  <Input
                    placeholder='e.g., "Also add RSI > 50" or "Remove the volume filter"'
                    value={refinementInput}
                    onChange={(e) => setRefinementInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && refinementInput.trim() && !refineProposalMutation.isPending) {
                        refineProposalMutation.mutate({ message: refinementInput.trim() });
                      }
                    }}
                    className="flex-1 h-8 text-sm"
                    data-testid="input-refinement"
                  />
                  <Button
                    size="sm"
                    onClick={() => refineProposalMutation.mutate({ message: refinementInput.trim() })}
                    disabled={!refinementInput.trim() || refineProposalMutation.isPending}
                    className="h-8 px-3"
                    data-testid="button-refine"
                  >
                    {refineProposalMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              <DialogFooter className="gap-2 mt-3">
                <Button
                  variant="outline"
                  onClick={() => {
                    setAiProposal(null);
                    setRefinementChat([]);
                  }}
                  data-testid="button-ai-back"
                >
                  Back
                </Button>
                <Button
                  onClick={() => saveAndPlaceMultiThoughts.mutate(aiProposal)}
                  disabled={saveAndPlaceMultiThoughts.isPending}
                  className="gap-2"
                  data-testid="button-save-thought"
                >
                  {saveAndPlaceMultiThoughts.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  Save & Place on Canvas
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {chartViewerOpen ? (
        <ScanChartViewer
          results={sortedResults}
          currentIndex={chartViewerIndex}
          open={chartViewerOpen}
          onOpenChange={setChartViewerOpen}
          onIndexChange={setChartViewerIndex}
          sessionId={scanSessionId}
          tuningActive={tuningDirty}
          navigationMode={chartNavigationMode}
          onNavigationModeChange={setChartNavigationMode}
        />
      ) : null}

      <Dialog open={qualityOpen && !!qualityResult} onOpenChange={setQualityOpen}>
        <DialogContent className="max-w-lg" style={{ backgroundColor: cssVariables.overlayBg, borderColor: cssVariables.secondaryOverlayColor }} data-testid="quality-overlay">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3" style={{ fontSize: cssVariables.fontSizeHeader, color: cssVariables.textColorHeader }}>
              Scan Quality
              {qualityResult && (
                <>
                  <span className={`text-2xl font-bold ${GRADE_COLORS[qualityResult.grade]}`}>{qualityResult.grade}</span>
                  <span className="text-sm font-normal" style={{ color: cssVariables.textColorSmall }}>{qualityResult.overallScore}/{qualityResult.maxScore}</span>
                </>
              )}
            </DialogTitle>
          </DialogHeader>
          {qualityResult && (
            <ScrollArea className="max-h-[60vh]">
              <div className="space-y-3 pr-3">
                {qualityResult.dimensions.map((dim) => (
                  <div key={dim.name} className="border-t border-dashed pt-2" data-testid={`quality-dim-${dim.name.replace(/\s+/g, "-").toLowerCase()}`}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold" style={{ fontSize: cssVariables.fontSizeNormal, color: cssVariables.textColorNormal }}>{dim.name}</span>
                      <span className={`font-bold text-xs px-1.5 py-0.5 rounded border ${GRADE_BG_COLORS[dim.grade]}`}>
                        {dim.grade}
                      </span>
                      <span style={{ fontSize: cssVariables.fontSizeTiny, color: cssVariables.textColorTiny }}>{dim.score}/{dim.maxScore}</span>
                    </div>
                    {dim.details.map((d, i) => (
                      <div key={i} className="ml-2 flex items-start gap-1 mt-0.5" style={{ fontSize: cssVariables.fontSizeSmall, color: cssVariables.textColorSmall }}>
                        <span className="text-foreground/40 flex-shrink-0">·</span>
                        <span>{d}</span>
                      </div>
                    ))}
                    {dim.suggestions.length > 0 && dim.suggestions.map((s, i) => (
                      <div key={`s-${i}`} className="ml-2 flex items-start gap-1 text-rs-amber mt-0.5" style={{ fontSize: cssVariables.fontSizeSmall }}>
                        <Music className="h-3 w-3 flex-shrink-0 mt-0.5" />
                        <span>{s}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setQualityOpen(false)} data-testid="button-close-quality">Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteConfirm} onOpenChange={(open) => { if (!open) setDeleteConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Thought</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to permanently delete "{deleteConfirm?.name}"? This will remove it from your library and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => {
                if (deleteConfirm) deleteThoughtMutation.mutate({ thoughtId: deleteConfirm.thoughtId, nodeId: deleteConfirm.nodeId });
              }}
              data-testid="button-confirm-delete"
            >
              {deleteThoughtMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteIdeaConfirm} onOpenChange={setDeleteIdeaConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Idea</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to permanently delete "{loadedIdeaName || ideaName}"? This will remove the saved idea and clear the canvas. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-idea">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => {
                if (currentIdeaId) deleteIdeaMutation.mutate(currentIdeaId);
              }}
              data-testid="button-confirm-delete-idea"
            >
              {deleteIdeaMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear Canvas</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove all thoughts, connections, and scan results from the canvas. Your saved thoughts in the library are not affected. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-clear">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={handleClearIdea}
              data-testid="button-confirm-clear"
            >
              Clear Canvas
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={saveBeforeNewOpen} onOpenChange={setSaveBeforeNewOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved Idea</AlertDialogTitle>
            <AlertDialogDescription>
              You have an idea on the canvas{currentIdeaId ? "" : " that hasn't been saved"}. What would you like to do before starting a new one?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel data-testid="button-cancel-new-idea">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => {
                setSaveBeforeNewOpen(false);
                handleClearIdea();
                setTimeout(() => setAiDialogOpen(true), 100);
              }}
              data-testid="button-discard-and-new"
            >
              Discard & Start New
            </AlertDialogAction>
            <AlertDialogAction
              onClick={async () => {
                setSaveBeforeNewOpen(false);
                try {
                  const body = buildIdeaBody();
                  if (currentIdeaId) {
                    await apiRequest("PATCH", `/api/bigidea/ideas/${currentIdeaId}`, body);
                  } else {
                    await apiRequest("POST", "/api/bigidea/ideas", body);
                  }
                  queryClient.invalidateQueries({ queryKey: ["/api/bigidea/ideas"] });
                  toast({ title: "Idea saved" });
                  handleClearIdea();
                  setTimeout(() => setAiDialogOpen(true), 100);
                } catch (err: any) {
                  toast({ title: "Failed to save idea", description: err?.message, variant: "destructive" });
                }
              }}
              data-testid="button-save-and-new"
            >
              Save & Start New
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={renameForkOpen} onOpenChange={setRenameForkOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Title Changed</AlertDialogTitle>
            <AlertDialogDescription>
              You changed the title from "{loadedIdeaName}" to "{ideaName}". Would you like to rename the existing idea or save this as a new copy?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel data-testid="button-cancel-rename-fork">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { setRenameForkOpen(false); saveIdeaMutation.mutate("rename"); }}
              data-testid="button-rename-idea"
            >
              Rename
            </AlertDialogAction>
            <AlertDialogAction
              className="bg-secondary text-secondary-foreground"
              onClick={() => { setRenameForkOpen(false); saveIdeaMutation.mutate("fork"); }}
              data-testid="button-fork-idea"
            >
              Save as New
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={tuneDialogOpen} onOpenChange={setTuneDialogOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Music className="h-5 w-5" />
              AI Scan Tuning
            </DialogTitle>
            <DialogDescription>
              Tell the AI how to adjust your scan. It analyzes your failure funnel data to suggest specific parameter changes.
            </DialogDescription>
          </DialogHeader>

          {!tuneResult ? (
            <div className="space-y-3">
              <div>
                <Label className="text-sm font-medium">What do you want?</Label>
                <IndicatorAutocompleteTextarea
                  value={tuneInstruction}
                  onChange={setTuneInstruction}
                  placeholder="e.g. 'Loosen the scan to get more results', 'Tighten volume criteria', 'Find tighter bases with less noise'..."
                  nodes={nodes}
                  indicatorLibrary={indicatorLibrary}
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Leave blank for automatic analysis based on your funnel data.
                </p>
              </div>

              {lastFunnelData && (
                <div className="rounded-md border p-2 text-[11px] text-muted-foreground space-y-0.5">
                  <p className="font-medium text-foreground text-xs">Scan Summary</p>
                  <p>Scanned: {lastFunnelData.totalTickers} tickers | Results: {scanResults?.length || 0}</p>
                  {lastFunnelData.perIndicator && Object.entries(lastFunnelData.perIndicator).slice(0, 5).map(([id, data]: [string, any]) => (
                    <p key={id}>
                      {data.name}: <span className="text-rs-green">{data.passed} pass</span> / <span className="text-rs-red">{data.failed} fail</span>
                    </p>
                  ))}
                </div>
              )}

              <DialogFooter>
                <Button
                  onClick={() => tuneMutation.mutate()}
                  disabled={tuneMutation.isPending}
                  className="gap-2"
                  data-testid="button-run-tune"
                >
                  {tuneMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Music className="h-4 w-4" />}
                  {tuneMutation.isPending ? "Analyzing..." : "Get Suggestions"}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto min-h-0 space-y-3">
              {tuneResult.overallAnalysis && (
                <div className="rounded-md border p-3 text-sm text-muted-foreground">
                  {tuneResult.overallAnalysis}
                </div>
              )}

              {tuneResult.suggestions.length === 0 ? (
                <div className="text-center py-4 text-sm text-muted-foreground">
                  No parameter adjustments suggested. Your scan configuration looks well-tuned.
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Suggested Changes</p>
                  {tuneResult.suggestions.map((s, i) => {
                    const isAccepted = acceptedTuneIndices.has(i);
                    
                    // Check if suggestion is still valid based on current canvas state
                    const canvasIndicatorIds = new Set(
                      nodes
                        .filter((n): n is Node => n.type === "thought")
                        .flatMap((n) => ((n.data?.criteria as ScannerCriterion[]) || []).map((c) => c.indicatorId))
                    );
                    
                    let isStale = false;
                    if (!s.type || s.type === "param_change" || s.type === "remove_criterion") {
                      // param_change and remove_criterion need the indicator to exist on canvas
                      isStale = !canvasIndicatorIds.has(s.indicatorId);
                    } else if (s.type === "add_criterion") {
                      // add_criterion needs the indicator to NOT exist (can't add duplicates)
                      isStale = canvasIndicatorIds.has(s.indicatorId);
                    }
                    
                    return (
                      <div
                        key={i}
                        className={`rounded-md border p-3 space-y-1.5 ${isAccepted ? "border-rs-green/30 bg-rs-green/10" : ""} ${isStale && !isAccepted ? "opacity-40 border-dashed" : ""}`}
                        data-testid={`tune-suggestion-${i}`}
                      >
                        {isStale && !isAccepted && (
                          <div className="text-[10px] text-amber-500 font-medium mb-1">
                            ⚠ Stale — canvas changed, this suggestion no longer applies
                          </div>
                        )}
                        {(!s.type || s.type === "param_change") && (
                          <>
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <div className="flex items-center gap-1.5">
                                <Badge variant="outline" className="text-[10px]">{s.indicatorName}</Badge>
                                <span className="text-sm font-medium">{s.paramName}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm text-muted-foreground line-through">{s.currentValue}</span>
                                <ArrowDown className="h-3 w-3 text-muted-foreground rotate-[-90deg]" />
                                <span className="text-sm font-bold">{s.suggestedValue}</span>
                              </div>
                            </div>
                            <p className="text-xs text-muted-foreground">{s.reason}</p>
                          </>
                        )}
                        {s.type === "add_criterion" && (
                          <>
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <div className="flex items-center gap-1.5">
                                <Plus className="h-3.5 w-3.5 text-rs-green" />
                                <Badge variant="outline" className="text-[10px] border-rs-green/50 text-rs-green">{s.indicatorName}</Badge>
                                <span className="text-sm font-medium text-rs-green">Add criterion</span>
                              </div>
                            </div>
                            <p className="text-xs text-muted-foreground">{s.reason}</p>
                          </>
                        )}
                        {s.type === "remove_criterion" && (
                          <>
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <div className="flex items-center gap-1.5">
                                <Minus className="h-3.5 w-3.5 text-rs-red" />
                                <Badge variant="outline" className="text-[10px] border-rs-red/50 text-rs-red">{s.indicatorName}</Badge>
                                <span className="text-sm font-medium text-rs-red">Remove criterion</span>
                              </div>
                            </div>
                            <p className="text-xs text-muted-foreground">{s.reason}</p>
                          </>
                        )}
                        {!isAccepted ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleAcceptSuggestion(s, i)}
                            className="gap-1.5"
                            disabled={isStale}
                            data-testid={`button-accept-suggestion-${i}`}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            {isStale ? "N/A" : "Apply"}
                          </Button>
                        ) : (
                          <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1.5 text-xs text-rs-green">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Applied
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleUndoSuggestion(s, i)}
                              className="gap-1 text-xs text-muted-foreground"
                              data-testid={`button-undo-suggestion-${i}`}
                            >
                              <X className="h-3 w-3" />
                              Undo
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <DialogFooter className="flex-col gap-2 sm:flex-col">
                {tuneResult.suggestions.length > 0 && (
                  <div className="flex items-center justify-between w-full text-xs text-muted-foreground">
                    <span>{acceptedTuneIndices.size} of {tuneResult.suggestions.length} applied</span>
                    {acceptedTuneIndices.size < tuneResult.suggestions.length && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleApplyAll}
                        className="gap-1.5"
                        data-testid="button-apply-all"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Apply All
                      </Button>
                    )}
                  </div>
                )}
                <div className="flex gap-2 w-full justify-end flex-wrap">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        onClick={() => { setTuneResult(null); setTuneInstruction(""); setAcceptedTuneIndices(new Set()); }}
                        data-testid="button-more-suggestions"
                      >
                        <Music className="h-4 w-4" />
                        More Suggestions
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-xs">
                      <p>Ask the AI for a fresh round of suggestions based on your current parameters.</p>
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        onClick={() => {
                          setTuneDialogOpen(false);
                          scanMutation.mutate();
                          setTuneRescanDone(true);
                          setTimeout(() => {
                            setChartViewerOpen(true);
                            setChartViewerIndex(0);
                          }, 500);
                        }}
                        disabled={acceptedTuneIndices.size === 0}
                        className="gap-2"
                        data-testid="button-review-on-chart"
                      >
                        <BarChart3 className="h-4 w-4" />
                        Review on Chart
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-xs">
                      <p>{acceptedTuneIndices.size === 0 ? "Apply at least one suggestion first." : "Closes this dialog, rescans with your changes, and opens the chart viewer so you can rate the results."}</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={unsavedTuningDialog} onOpenChange={setUnsavedTuningDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved Tuning Changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have uncommitted tuning changes. Would you like to save your idea and commit the tuning, or discard all changes?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel onClick={() => { setUnsavedTuningDialog(false); setPendingNavAction(null); }} data-testid="button-cancel-nav">
              Stay Here
            </AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={() => {
                handleDiscardTuning();
                setUnsavedTuningDialog(false);
                if (pendingNavAction) { pendingNavAction(); setPendingNavAction(null); }
              }}
              data-testid="button-discard-nav"
            >
              Cancel Changes
            </Button>
            <Button
              onClick={() => {
                commitTuningMutation.mutate();
                setUnsavedTuningDialog(false);
                if (pendingNavAction) { setTimeout(() => { pendingNavAction(); setPendingNavAction(null); }, 1000); }
              }}
              data-testid="button-commit-nav"
            >
              Save & Commit
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <NoIndicatorFoundDialog
        open={!!customIndicatorDialog}
        onClose={() => setCustomIndicatorDialog(null)}
        requestDescription={customIndicatorDialog?.requestDescription || ""}
        suggestedIndicatorName={customIndicatorDialog?.suggestedIndicatorName || ""}
        category={customIndicatorDialog?.category || ""}
        reason={customIndicatorDialog?.reason || ""}
        originalRequest={customIndicatorDialog?.originalRequest || ""}
        onIndicatorCreated={(indicator) => {
          setCustomIndicatorPreview({ indicator, aiPrompt: customIndicatorDialog.originalRequest });
          setCustomIndicatorDialog(null);
        }}
      />

      {customIndicatorPreview && (
        <CustomIndicatorPreviewDialog
          open={!!customIndicatorPreview}
          onClose={() => setCustomIndicatorPreview(null)}
          indicator={customIndicatorPreview.indicator}
          aiPrompt={customIndicatorPreview.aiPrompt || ""}
          onSaved={(savedIndicator) => {
            // Invalidate indicators cache first so the new indicator is available
            queryClient.invalidateQueries({ queryKey: ["/api/bigidea/indicators"] });
            
            // Automatically create a thought using the new indicator
            const thoughtData = {
              name: savedIndicator.name,
              category: savedIndicator.category || "Custom",
              description: savedIndicator.description || customIndicatorPreview.aiPrompt,
              timeframe: "daily",
              aiPrompt: customIndicatorPreview.aiPrompt,
              criteria: [{
                indicatorId: savedIndicator.customId,
                label: savedIndicator.name,
                muted: false,
                inverted: false,
                params: (savedIndicator.params || []).map((p: any) => ({
                  name: p.name,
                  label: p.label,
                  type: p.type,
                  value: p.defaultValue,
                  min: p.min,
                  max: p.max,
                  step: p.step,
                })),
              }],
            };
            
            // Use the saveAndPlaceMultiThoughts to create and place the thought
            saveAndPlaceMultiThoughts.mutate({
              thoughts: [{ ...thoughtData, thoughtKey: "custom-thought" }],
              edges: [{ source: "custom-thought", target: "RESULTS", logicType: "AND" }],
            });
            
            setCustomIndicatorPreview(null);
            toast({
              title: "Custom Indicator Created & Added",
              description: `"${savedIndicator.name}" has been saved and added to your canvas.`,
            });
          }}
        />
      )}
    </div>
  );
}

function IndicatorAutocompleteTextarea({
  value,
  onChange,
  placeholder,
  nodes,
  indicatorLibrary,
}: {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  nodes: any[];
  indicatorLibrary: any[];
}) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [cursorWord, setCursorWord] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const indicatorNames = useMemo(() => {
    const namesFromCanvas = new Set<string>();
    nodes.forEach((n) => {
      if (n.type !== "thought" || !n.data.criteria) return;
      (n.data.criteria as any[]).forEach((c) => {
        if (c.label) namesFromCanvas.add(c.label);
        const meta = indicatorLibrary.find((m: any) => m.id === c.indicatorId);
        if (meta?.name) namesFromCanvas.add(meta.name);
      });
    });
    indicatorLibrary.forEach((m: any) => {
      if (m.name) namesFromCanvas.add(m.name);
    });
    return Array.from(namesFromCanvas).sort();
  }, [nodes, indicatorLibrary]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    onChange(text);

    const pos = e.target.selectionStart || 0;
    const before = text.slice(0, pos);
    const wordMatch = before.match(/[\w-]+$/);
    const word = wordMatch ? wordMatch[0] : "";
    setCursorWord(word);

    if (word.length >= 2) {
      const lower = word.toLowerCase();
      const matches = indicatorNames.filter((n) => n.toLowerCase().includes(lower));
      setSuggestions(matches.slice(0, 6));
      setSelectedIdx(0);
    } else {
      setSuggestions([]);
    }
  }, [onChange, indicatorNames]);

  const insertSuggestion = useCallback((name: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const pos = el.selectionStart || 0;
    const before = value.slice(0, pos);
    const after = value.slice(pos);
    const wordMatch = before.match(/[\w-]+$/);
    const wordStart = wordMatch ? pos - wordMatch[0].length : pos;
    const newText = value.slice(0, wordStart) + name + after;
    onChange(newText);
    setSuggestions([]);
    setCursorWord("");
    setTimeout(() => {
      const newPos = wordStart + name.length;
      el.focus();
      el.setSelectionRange(newPos, newPos);
    }, 0);
  }, [value, onChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Tab" || e.key === "Enter") {
      if (suggestions[selectedIdx]) {
        e.preventDefault();
        insertSuggestion(suggestions[selectedIdx]);
      }
    } else if (e.key === "Escape") {
      setSuggestions([]);
    }
  }, [suggestions, selectedIdx, insertSuggestion]);

  return (
    <div className="relative mt-1.5">
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={() => setTimeout(() => setSuggestions([]), 150)}
        placeholder={placeholder}
        className="resize-none text-sm"
        rows={3}
        data-testid="input-tune-instruction"
      />
      {suggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-md border bg-popover shadow-md" data-testid="indicator-suggestions">
          {suggestions.map((name, i) => (
            <button
              key={name}
              type="button"
              className={`w-full text-left px-3 py-1.5 text-sm hover-elevate ${i === selectedIdx ? "bg-muted" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); insertSuggestion(name); }}
              data-testid={`suggestion-indicator-${name.replace(/\s+/g, "-").toLowerCase()}`}
            >
              <span className="font-medium">{name}</span>
              {cursorWord && (() => {
                const lower = name.toLowerCase();
                const idx = lower.indexOf(cursorWord.toLowerCase());
                if (idx >= 0) {
                  return (
                    <span className="text-muted-foreground text-xs ml-2">
                      match: "{name.slice(idx, idx + cursorWord.length)}"
                    </span>
                  );
                }
                return null;
              })()}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

class ChartErrorBoundary extends Component<
  { children: ReactNode; onClose: () => void },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode; onClose: () => void }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ScanChartViewer] Chart render error:", error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-4">
          <p className="text-destructive text-sm">Chart failed to load</p>
          <p className="text-muted-foreground text-xs max-w-md text-center">{this.state.error?.message}</p>
          <Button variant="outline" size="sm" onClick={() => this.props.onClose()}>Close</Button>
        </div>
      );
    }
    return this.props.children;
  }
}

function ScanChartViewer({
  results,
  currentIndex,
  open,
  onOpenChange,
  onIndexChange,
  sessionId,
  tuningActive,
  trainingMode,
  sourceSetupId,
  sourceSetupName,
  navigationMode,
  onNavigationModeChange,
}: {
  results: ScanResultItem[];
  currentIndex: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onIndexChange: (idx: number) => void;
  sessionId?: number;
  tuningActive?: boolean;
  trainingMode?: boolean;
  sourceSetupId?: number;
  sourceSetupName?: string;
  navigationMode?: 'scan' | 'watchlist';
  onNavigationModeChange?: (mode: 'scan' | 'watchlist') => void;
}) {
  const [intradayTimeframe, setIntradayTimeframe] = useState("15min");
  const [showETH, setShowETH] = useState(false);
  const [chartRatings, setChartRatings] = useState<Record<string, "up" | "down">>({});
  const [newsOpen, setNewsOpen] = useState(false);
  // Persist Trade Plan open state in localStorage
  const [askIvyOpen, setAskIvyOpenState] = useState(() => {
    try {
      return localStorage.getItem("askIvyOverlayOpen") === "true";
    } catch { return false; }
  });
  const setAskIvyOpen = (value: boolean | ((prev: boolean) => boolean)) => {
    setAskIvyOpenState((prev) => {
      const newValue = typeof value === "function" ? value(prev) : value;
      try { localStorage.setItem("askIvyOverlayOpen", String(newValue)); } catch {}
      return newValue;
    });
  };
  const [ivyEntryLevel, setIvyEntryLevel] = useState<{ price: number; label: string; type?: string } | null>(null);
  const [ivyStopLevel, setIvyStopLevel] = useState<{ price: number; label: string; type?: string } | null>(null);
  const [ivyTargetLevel, setIvyTargetLevel] = useState<{ price: number; label: string } | null>(null);
  
  // Chart click state for Trade Plan
  const [ivyChartClick, setIvyChartClick] = useState<{ price: number; timestamp: number } | null>(null);
  const [ivyActiveClickField, setIvyActiveClickField] = useState<"entry" | "stop" | "target" | null>(null);
  
  const [expandedThoughts, setExpandedThoughts] = useState<Record<string, boolean>>({});
  const [tickerDebugOpen, setTickerDebugOpen] = useState(false);

  useEffect(() => { setTickerDebugOpen(false); }, [currentIndex]);
  
  // Debug logging - must be at top with other hooks
  useEffect(() => {
    if (open) {
      console.log("[ScanChartViewer] Opened with:", { currentIndex, symbol: results[currentIndex]?.symbol, resultsLength: results.length });
    }
  }, [open, currentIndex, results]);

  const { cssVariables } = useSystemSettings();
  const { toast } = useToast();
  const { syncToMarketSurge } = useMarketSurgeSync();
  const [msSyncEnabled, setMsSyncEnabled] = useState(false);

  // Watchlist integration
  const { data: watchlist } = useWatchlist();
  const { mutate: addToWatchlist, isPending: isAddingToWatchlist } = useAddToWatchlist();
  const { mutate: removeFromWatchlist, isPending: isRemovingFromWatchlist } = useRemoveFromWatchlist();
  const { mutate: updateWatchlist } = useUpdateWatchlist();
  const { mutate: addToWatchlistWithTradePlan } = useAddToWatchlistWithTradePlan();
  
  // Fetch setup's Ivy config for context-aware suggestions
  const { data: setupConfig } = useQuery<{
    id: number;
    name: string;
    ivyEntryStrategy?: string | null;
    ivyStopStrategy?: string | null;
    ivyTargetStrategy?: string | null;
    ivyContextNotes?: string | null;
    ivyApproved?: boolean;
  }>({
    queryKey: ["/api/bigidea/setups", sourceSetupId],
    enabled: !!sourceSetupId,
  });

  // Navigation mode state
  const [activeNavigationMode, setActiveNavigationMode] = useState(navigationMode || 'scan');

  // Compute navigation list based on mode
  const navigationList = useMemo(() => {
    if (activeNavigationMode === 'watchlist' && watchlist) {
      return watchlist.map(w => ({ symbol: w.symbol, price: 0, passedPaths: [] as string[] }));
    }
    return results;
  }, [activeNavigationMode, watchlist, results]);

  const chartWindowRef = useRef<HTMLDivElement>(null);
  const [thresholdToastShown, setThresholdToastShown] = useState(false);
  const [commitReadyBanner, setCommitReadyBanner] = useState<string | null>(null);
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => { if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current); };
  }, []);

  const ratingMutation = useMutation({
    mutationFn: async ({ symbol, rating, price, indicatorSnapshot }: { symbol: string; rating: "up" | "down"; price: number; indicatorSnapshot?: any }) => {
      const res = await apiRequest("POST", "/api/bigidea/chart-rating", {
        symbol,
        rating,
        price,
        sessionId,
        indicatorSnapshot: indicatorSnapshot || null,
        ratingType: trainingMode ? "admin" : "user",
        trainingMode: trainingMode || false,
        sourceSetupId: sourceSetupId || null,
      });
      return res.json();
    },
    onSuccess: (_data, variables) => {
      setChartRatings(prev => {
        const updated = { ...prev, [variables.symbol]: variables.rating };
        const ratedCount = Object.keys(updated).length;
        const total = results.length;
        const threshold = Math.max(1, Math.ceil(total * 0.3));
        if (tuningActive && ratedCount >= threshold && !thresholdToastShown) {
          setThresholdToastShown(true);
          setCommitReadyBanner(`You've rated ${ratedCount} of ${total} charts — enough to save & commit your tuning changes.`);
          if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
          bannerTimerRef.current = setTimeout(() => setCommitReadyBanner(null), 5000);
        }
        return updated;
      });
    },
    onError: () => {
      toast({ title: "Rating failed", description: "Could not save your chart rating. Please try again.", variant: "destructive" });
    },
  });

  const current = navigationList[currentIndex];
  const symbol = current?.symbol || "";

  type ChartDataResponse = { candles: ChartCandle[]; indicators: ChartIndicators; ticker: string; timeframe: string };

  const { data: dailyData, isLoading: dailyLoading, error: dailyError } = useQuery<ChartDataResponse>({
    queryKey: ["/api/sentinel/chart-data", symbol, "daily"],
    enabled: open && !!symbol,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchInterval: 5 * 60 * 1000,
    queryFn: async () => {
      console.log(`[ScanChartViewer] Fetching daily data for ${symbol}`);
      const res = await fetch(`/api/sentinel/chart-data?ticker=${symbol}&timeframe=daily&_=${Date.now()}`, { 
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' }
      });
      if (!res.ok) {
        console.error(`[ScanChartViewer] Daily data fetch failed: ${res.status} ${res.statusText}`);
        throw new Error("Failed to fetch daily chart data");
      }
      const data = await res.json();
      console.log(`[ScanChartViewer] Daily data loaded: ${data.candles?.length || 0} candles`);
      if (data.candles?.length > 0) {
        const first = new Date(data.candles[0].timestamp * 1000);
        const last = new Date(data.candles[data.candles.length - 1].timestamp * 1000);
        console.log(`[ScanChartViewer] Daily range: ${first.toLocaleDateString()} to ${last.toLocaleDateString()}`);
      }
      return data;
    },
    staleTime: 0,
  });

  const { data: intradayData, isLoading: intradayLoading, error: intradayError } = useQuery<ChartDataResponse>({
    queryKey: ["/api/sentinel/chart-data", symbol, intradayTimeframe, showETH],
    enabled: open && !!symbol,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchInterval: 60 * 1000,
    queryFn: async () => {
      const params = new URLSearchParams({ ticker: symbol!, timeframe: intradayTimeframe, _: Date.now().toString() });
      if (showETH) params.set('includeETH', 'true');
      console.log(`[ScanChartViewer] Fetching intraday data for ${symbol} (${intradayTimeframe}, ETH=${showETH})`);
      const res = await fetch(`/api/sentinel/chart-data?${params}`, { 
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' }
      });
      if (!res.ok) {
        console.error(`[ScanChartViewer] Intraday data fetch failed: ${res.status} ${res.statusText}`);
        throw new Error("Failed to fetch intraday chart data");
      }
      const data = await res.json();
      console.log(`[ScanChartViewer] Intraday data loaded: ${data.candles?.length || 0} candles`);
      if (data.candles?.length > 0) {
        const first = new Date(data.candles[0].timestamp * 1000);
        const last = new Date(data.candles[data.candles.length - 1].timestamp * 1000);
        console.log(`[ScanChartViewer] Intraday range: ${first.toLocaleString()} to ${last.toLocaleString()}`);
      }
      return data;
    },
    staleTime: 0,
  });

  const { data: chartMetrics, error: metricsError } = useQuery<ChartMetrics>({
    queryKey: ["/api/sentinel/trade-chart-metrics", symbol, intradayTimeframe],
    enabled: open && !!symbol,
    queryFn: async () => {
      console.log(`[ScanChartViewer] Fetching metrics for ${symbol}`);
      const res = await fetch(`/api/sentinel/trade-chart-metrics?ticker=${symbol}&timeframe=${intradayTimeframe}`, { credentials: "include" });
      if (!res.ok) {
        console.error(`[ScanChartViewer] Metrics fetch failed: ${res.status} ${res.statusText}`);
        throw new Error("Failed to fetch metrics");
      }
      const data = await res.json();
      console.log(`[ScanChartViewer] Metrics loaded:`, data);
      console.log(`[ScanChartViewer] Metrics keys:`, Object.keys(data));
      console.log(`[ScanChartViewer] Sample values - PE: ${data.pe}, Market Cap: ${data.marketCap}, Target Price: ${data.targetPrice}`);
      return data;
    },
    staleTime: 60 * 1000,
  });

  // News query - only fetch when panel is open (lazy loading)
  interface NewsArticle {
    id: number;
    headline: string;
    summary: string;
    source: string;
    url: string;
    datetime: number;
    image: string;
  }
  
  const { data: newsData, isLoading: newsLoading } = useQuery<NewsArticle[]>({
    queryKey: ["/api/news", symbol],
    enabled: open && newsOpen && !!symbol,
    queryFn: async () => {
      const res = await fetch(`/api/news/${symbol}?days=14`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch news");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        onIndexChange(Math.max(0, currentIndex - 1));
      } else if (e.key === "ArrowRight") {
        onIndexChange(Math.min(results.length - 1, currentIndex + 1));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, currentIndex, results.length, onIndexChange]);

  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", handler);
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => overlayRef.current?.focus());
    return () => {
      window.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
    };
  }, [open, onOpenChange]);

  // Auto-sync to MarketSurge when navigating stocks
  useEffect(() => {
    if (open && msSyncEnabled && results.length > 0) {
      const currentStock = results[currentIndex];
      if (currentStock?.ticker || currentStock?.symbol) {
        syncToMarketSurge(currentStock.ticker || currentStock.symbol, 'day');
      }
    }
  }, [open, currentIndex, msSyncEnabled, results, syncToMarketSurge]);

  const dayChange = useMemo(() => {
    if (!dailyData || dailyData.candles.length < 2) return null;
    const last = dailyData.candles[dailyData.candles.length - 1];
    const prev = dailyData.candles[dailyData.candles.length - 2];
    const change = last.close - prev.close;
    const changePct = (change / prev.close) * 100;
    return { price: last.close, change, changePct };
  }, [dailyData]);

  const cocAnnotations = useMemo(() => {
    if (!current?.thoughtBreakdown) return { markers: [] as ChartMarker[], diamondMarkers: [] as DiamondMarker[], priceLines: [] as PriceLevelLine[], resistanceLines: [] as { startTime: number; startPrice: number; endTime: number; endPrice: number }[], baseZones: [] as BaseZone[] };

    const markers: ChartMarker[] = [];
    const diamondMarkers: DiamondMarker[] = [];
    const priceLines: PriceLevelLine[] = [];
    const resistanceLines: { startTime: number; startPrice: number; endTime: number; endPrice: number }[] = [];
    const baseZones: BaseZone[] = [];

    const BASE_ZONE_COLORS = [
      "#22c55e",
      "#3b82f6",
      "#a855f7",
      "#f59e0b",
      "#06b6d4",
      "#ec4899",
    ];

    const ideaHasBase = current.thoughtBreakdown.some((t: any) =>
      t.criteriaResults?.some((cr: any) => (cr.indicatorId === "PA-3" || cr.indicatorId === "PA-4" || cr.indicatorId === "CB-1"))
    );

    let zoneColorIdx = 0;
    for (const thought of current.thoughtBreakdown) {
      if (!thought.pass) continue;
      for (const cr of thought.criteriaResults) {
        if (!cr.pass || !cr.cocHighlight) continue;
        const h = cr.cocHighlight;
        if (ideaHasBase && cr.indicatorId !== "PA-3" && cr.indicatorId !== "PA-4" && cr.indicatorId !== "CB-1") continue;

        if (h.type === "baseZone" && h.topPrice && h.lowPrice && h.startBar !== undefined) {
          if (dailyData) {
            const len = dailyData.candles.length;
            const olderIdx = Math.max(0, len - 1 - h.startBar);
            const newerIdx = Math.min(len - 1, len - 1 - (h.endBar ?? 0));
            if (olderIdx >= 0 && newerIdx >= olderIdx && newerIdx < len) {
              const olderCandle = dailyData.candles[olderIdx];
              const newerCandle = dailyData.candles[newerIdx];
              if (olderCandle && newerCandle) {
                const color = BASE_ZONE_COLORS[zoneColorIdx % BASE_ZONE_COLORS.length];
                zoneColorIdx++;
                baseZones.push({
                  startTime: olderCandle.timestamp,
                  endTime: newerCandle.timestamp,
                  topPrice: h.topPrice,
                  lowPrice: h.lowPrice,
                  color,
                  label: cr.indicatorName,
                });
              }
            }
          }
        }

        if (h.type === "resistanceLine" && h.level && h.startBar !== undefined) {
          if (dailyData) {
            const len = dailyData.candles.length;
            const olderIdx = Math.max(0, len - 1 - h.startBar);
            const newerIdx = Math.min(len - 1, len - 1 - (h.endBar ?? 0));
            if (olderIdx >= 0 && newerIdx >= olderIdx && newerIdx < len) {
              const olderCandle = dailyData.candles[olderIdx];
              const newerCandle = dailyData.candles[newerIdx];
              if (olderCandle && newerCandle) {
                resistanceLines.push({
                  startTime: olderCandle.timestamp,
                  startPrice: h.level,
                  endTime: newerCandle.timestamp,
                  endPrice: h.level,
                });
              }
            }
          }
        }

        if (cr.cocHighlight2 && cr.cocHighlight2.type === "supportLine" && cr.cocHighlight2.level && cr.cocHighlight2.startBar !== undefined) {
          const h2 = cr.cocHighlight2;
          if (dailyData) {
            const len2 = dailyData.candles.length;
            const olderIdx2 = Math.max(0, len2 - 1 - h2.startBar!);
            const newerIdx2 = Math.min(len2 - 1, len2 - 1 - (h2.endBar ?? 0));
            if (olderIdx2 >= 0 && newerIdx2 >= olderIdx2 && newerIdx2 < len2) {
              const olderCandle2 = dailyData.candles[olderIdx2];
              const newerCandle2 = dailyData.candles[newerIdx2];
              if (olderCandle2 && newerCandle2) {
                resistanceLines.push({
                  startTime: olderCandle2.timestamp,
                  startPrice: h2.level!,
                  endTime: newerCandle2.timestamp,
                  endPrice: h2.level!,
                });
              }
            }
          }
        }

        if (h.type === "gapCircle" && h.barIndex !== undefined) {
          if (dailyData && dailyData.candles.length > h.barIndex) {
            const candle = dailyData.candles[dailyData.candles.length - 1 - h.barIndex];
            if (candle) {
              const label = cr.indicatorId === "PA-17"
                ? (h.gapPct ? `WP ${h.gapPct.toFixed(1)}%` : "Wedge Pop")
                : (h.gapPct ? `Gap ${h.gapPct.toFixed(1)}%` : "Gap");
              diamondMarkers.push({
                time: candle.timestamp,
                price: candle.low,
                color: "rgba(234, 179, 8, 0.5)",
                size: 100,
                text: label,
                textColor: "#ffffff",
              });
            }
          }
        }

        if (h.type === "pullbackCircle" && h.barCount) {
          if (dailyData) {
            const count = Math.min(h.barCount, dailyData.candles.length);
            for (let i = dailyData.candles.length - count; i < dailyData.candles.length; i++) {
              diamondMarkers.push({
                time: dailyData.candles[i].timestamp,
                price: dailyData.candles[i].low,
                color: "rgba(234, 179, 8, 0.5)",
                size: 100,
                text: i === dailyData.candles.length - count ? cr.indicatorName || "PB" : "",
                textColor: "#ffffff",
              });
            }
          }
        }

        // Undercut & Rally pattern (PA-19)
        if (h.type === "urPattern" && h.undercutBar !== undefined && h.rallyBar !== undefined) {
          if (dailyData) {
            const len = dailyData.candles.length;
            
            // Diamond on undercut bar (where price dipped below MA) - red/orange
            const undercutIdx = len - 1 - h.undercutBar;
            if (undercutIdx >= 0 && undercutIdx < len) {
              const undercutCandle = dailyData.candles[undercutIdx];
              diamondMarkers.push({
                time: undercutCandle.timestamp,
                price: undercutCandle.low,
                color: "rgba(239, 68, 68, 0.7)", // Red for undercut
                size: 50,
                text: "Undercut",
                textColor: "#ffffff",
              });
            }
            
            // Diamond on rally bar (where price crossed back above MA) - green
            const rallyIdx = len - 1 - h.rallyBar;
            if (rallyIdx >= 0 && rallyIdx < len) {
              const rallyCandle = dailyData.candles[rallyIdx];
              diamondMarkers.push({
                time: rallyCandle.timestamp,
                price: rallyCandle.high,
                color: "rgba(34, 197, 94, 0.7)", // Green for rally
                size: 50,
                text: "Rally",
                textColor: "#ffffff",
              });
            }
          }
        }

        // Pullback to MA pattern (PA-20)
        if (h.type === "pullbackPattern" && h.touchBar !== undefined) {
          if (dailyData) {
            const len = dailyData.candles.length;
            
            // Diamond on touch bar (where price touched the MA) - yellow
            const touchIdx = len - 1 - h.touchBar;
            if (touchIdx >= 0 && touchIdx < len) {
              const touchCandle = dailyData.candles[touchIdx];
              diamondMarkers.push({
                time: touchCandle.timestamp,
                price: touchCandle.low,
                color: "rgba(234, 179, 8, 0.7)", // Yellow for MA touch
                size: 50,
                text: "PB Touch",
                textColor: "#ffffff",
              });
            }
          }
        }
      }
    }

    const dedupedBaseZones = baseZones.filter((zone, idx) => {
      for (let j = 0; j < idx; j++) {
        const prev = baseZones[j];
        const timeOverlap = Math.abs(zone.startTime - prev.startTime) < 86400 * 5 && Math.abs(zone.endTime - prev.endTime) < 86400 * 5;
        const priceOverlap = Math.abs(zone.topPrice - prev.topPrice) / prev.topPrice < 0.02 && Math.abs(zone.lowPrice - prev.lowPrice) / prev.lowPrice < 0.02;
        if (timeOverlap && priceOverlap) return false;
      }
      return true;
    });

    return { markers, diamondMarkers, priceLines, resistanceLines, baseZones: dedupedBaseZones };
  }, [current?.thoughtBreakdown, dailyData]);

  // Define callbacks BEFORE early return - hooks must always be called
  const handleCopyChartWindow = useCallback(async () => {
    const el = chartWindowRef.current;
    if (!el) return;
    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(el, {
        backgroundColor: null,
        useCORS: true,
        scale: 2,
        logging: false,
      });
      canvas.toBlob(async (blob) => {
        if (!blob) { toast({ title: "Failed to capture image" }); return; }
        try {
          await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
          toast({ title: "Chart copied to clipboard as image" });
        } catch {
          const link = document.createElement("a");
          link.download = `${symbol}_chart.png`;
          link.href = canvas.toDataURL("image/png");
          link.click();
          toast({ title: "Chart saved as image (clipboard not available)" });
        }
      }, "image/png");
    } catch {
      toast({ title: "Failed to capture chart" });
    }
  }, [symbol, toast]);

  const handleCopyTickerDebugText = useCallback(async () => {
    if (!current?.thoughtBreakdown) return;
    const lines: string[] = [];
    lines.push(`Ticker Debug: ${symbol}`);
    current.thoughtBreakdown.forEach((thought) => {
      const passCount = thought.criteriaResults.filter((c: any) => c.pass).length;
      const totalCount = thought.criteriaResults.length;
      lines.push(`\n${thought.pass ? "PASS" : "FAIL"} ${thought.thoughtName} (${passCount}/${totalCount})`);
      thought.criteriaResults.forEach((cr: any) => {
        const diag = cr.diagnostics;
        lines.push(`  ${cr.pass ? "+" : "-"} ${cr.indicatorName}${cr.inverted ? " [INV]" : ""}${diag ? ` — val: ${diag.value}, thresh: ${diag.threshold}${diag.detail ? `, ${diag.detail}` : ""}` : ""}`);
      });
    });
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      toast({ title: "Ticker debug info copied to clipboard" });
    } catch {
      toast({ title: "Failed to copy debug text" });
    }
  }, [current, symbol, toast]);

  // Compute watchlist status
  const isWatchlisted = watchlist?.some(item => item.symbol === symbol);
  const watchlistItem = watchlist?.find(item => item.symbol === symbol);

  // Get saved trade plan from watchlist item - memoized to prevent infinite loops
  const savedTradePlan = useMemo(() => {
    if (!watchlistItem) return null;
    const hasData = watchlistItem.targetEntry || watchlistItem.stopPlan || watchlistItem.targetPlan;
    if (!hasData) return null;
    return {
      entry: watchlistItem.targetEntry,
      stop: watchlistItem.stopPlan,
      target: watchlistItem.targetPlan,
    };
  }, [watchlistItem?.targetEntry, watchlistItem?.stopPlan, watchlistItem?.targetPlan]);

  // NOTE: Price lines loading is handled by AskIvyOverlay via savedTradePlan prop
  // AskIvyOverlay calls onSelectionChange to update ivyEntryLevel/Stop/Target

  // Handler to save trade plan to watchlist
  const handleSaveTradePlan = useCallback((data: { entry?: number; stop?: number; target?: number }) => {
    if (isWatchlisted && watchlistItem) {
      updateWatchlist({ 
        id: watchlistItem.id, 
        data: { 
          targetEntry: data.entry, 
          stopPlan: data.stop, 
          targetPlan: data.target 
        } 
      });
      toast({ title: "Saved", description: "Trade plan saved to watchlist" });
    } else {
      addToWatchlistWithTradePlan({ 
        symbol, 
        targetEntry: data.entry, 
        stopPlan: data.stop, 
        targetPlan: data.target 
      });
    }
  }, [isWatchlisted, watchlistItem, updateWatchlist, addToWatchlistWithTradePlan, symbol, toast]);

  // Handler to clear trade plan
  const handleClearTradePlan = useCallback(() => {
    setIvyEntryLevel(null);
    setIvyStopLevel(null);
    setIvyTargetLevel(null);
    if (isWatchlisted && watchlistItem) {
      updateWatchlist({ 
        id: watchlistItem.id, 
        data: { 
          targetEntry: null, 
          stopPlan: null, 
          targetPlan: null 
        } 
      });
    }
  }, [isWatchlisted, watchlistItem, updateWatchlist]);

  const handleIvySelectionChange = useCallback((
    entry: { price: number; label: string; type?: string } | null,
    stop: { price: number; label: string; type?: string } | null,
    target: { price: number; label: string } | null
  ) => {
    setIvyEntryLevel(entry);
    setIvyStopLevel(stop);
    setIvyTargetLevel(target);
  }, []);

  // NOW safe to return early - all hooks have been called
  if (!open) return null;
  
  // Safety check: if no symbol or no current result, close and return null
  if (!symbol || !current) {
    console.warn("[ScanChartViewer] No symbol or current result, closing viewer");
    setTimeout(() => onOpenChange(false), 0);
    return null;
  }

  const scanNavExtra = (
    <div className="flex items-center gap-2 flex-shrink-0">
      <Button
        size="sm"
        variant={activeNavigationMode === 'watchlist' ? 'default' : 'outline'}
        onClick={() => {
          const newMode = activeNavigationMode === 'watchlist' ? 'scan' : 'watchlist';
          setActiveNavigationMode(newMode);
          onNavigationModeChange?.(newMode);
          if (currentIndex >= navigationList.length) {
            onIndexChange(0);
          }
        }}
        disabled={!watchlist || watchlist.length === 0}
        data-testid="button-nav-mode-toggle"
      >
        {activeNavigationMode === 'watchlist' ? '⭐ Watchlist' : '🔍 Scan'}
      </Button>
      <Button
        size="icon"
        variant="outline"
        disabled={currentIndex === 0}
        onClick={() => onIndexChange(currentIndex - 1)}
        data-testid="button-chart-prev"
      >
        <ChevronLeft className="h-4 w-4" style={{ color: cssVariables.secondaryOverlayColor }} />
      </Button>
      <span className="text-sm" style={{ color: cssVariables.textColorSmall }} data-testid="text-chart-position">
        {currentIndex + 1} of {navigationList.length}
        {activeNavigationMode === 'watchlist' && ' (Watchlist)'}
      </span>
      <Button
        size="icon"
        variant="outline"
        disabled={currentIndex === navigationList.length - 1}
        onClick={() => onIndexChange(currentIndex + 1)}
        data-testid="button-chart-next"
      >
        <ChevronRight className="h-4 w-4" style={{ color: cssVariables.secondaryOverlayColor }} />
      </Button>
      <div className="flex items-center gap-1 border rounded-md px-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className={`toggle-elevate ${chartRatings[symbol] === "up" ? "toggle-elevated text-rs-green" : ""}`}
              onClick={() => {
                const price = dayChange?.price ?? current?.price ?? 0;
                const indicatorSnapshot = current?.thoughtBreakdown || null;
                ratingMutation.mutate({ symbol, rating: "up", price, indicatorSnapshot });
              }}
              disabled={ratingMutation.isPending}
              data-testid="button-chart-thumbsup"
            >
              <ThumbsUp className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-sm">Good scan result — this chart looks promising. Your ratings help AI tune scan parameters over time.</p>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className={`toggle-elevate ${chartRatings[symbol] === "down" ? "toggle-elevated text-rs-red" : ""}`}
              onClick={() => {
                const price = dayChange?.price ?? current?.price ?? 0;
                const indicatorSnapshot = current?.thoughtBreakdown || null;
                ratingMutation.mutate({ symbol, rating: "down", price, indicatorSnapshot });
              }}
              disabled={ratingMutation.isPending}
              data-testid="button-chart-thumbsdown"
            >
              <ThumbsDown className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-sm">Poor scan result — this chart doesn't fit what you're looking for. Helps AI learn your preferences.</p>
          </TooltipContent>
        </Tooltip>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            style={{
              backgroundColor: askIvyOpen ? 'rgba(251, 191, 36, 0.2)' : undefined,
              borderColor: askIvyOpen ? '#fbbf24' : undefined,
              color: askIvyOpen ? '#fbbf24' : undefined,
            }}
            onClick={() => setAskIvyOpen((v) => !v)}
            data-testid="button-chart-evaluate"
          >
            <Sparkles className="h-3.5 w-3.5" style={{ color: '#fbbf24' }} />
            <span>Trade Plan</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-sm">Set entry, stop & target levels</p>
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            style={{
              backgroundColor: newsOpen ? 'rgba(59, 130, 246, 0.2)' : undefined,
              borderColor: newsOpen ? '#3b82f6' : undefined,
              color: newsOpen ? '#3b82f6' : undefined,
            }}
            onClick={() => setNewsOpen((v) => !v)}
            data-testid="button-chart-news"
          >
            <Newspaper className="h-3.5 w-3.5" />
            <span>News</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-sm">View recent news for {symbol}</p>
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <div>
            <WatchlistSelector 
              symbol={symbol} 
              storageKey="scanWatchlistId"
            />
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-sm">Add/remove from watchlist</p>
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant={msSyncEnabled ? "default" : "outline"}
            className="gap-1.5"
            onClick={() => {
              const newState = !msSyncEnabled;
              setMsSyncEnabled(newState);
              if (newState && symbol) {
                syncToMarketSurge(symbol, 'day');
                toast({
                  title: 'MarketSurge Sync Active',
                  description: 'Navigate with arrow keys to sync'
                });
              }
            }}
            data-testid="button-chart-marketsurge"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            <span>MarketSurge</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-sm">Sync ticker changes to MarketSurge window</p>
        </TooltipContent>
      </Tooltip>
      {(() => {
        const ratedCount = Object.keys(chartRatings).length;
        const total = results.length;
        const threshold = Math.max(1, Math.ceil(total * 0.3));
        const meetsThreshold = ratedCount >= threshold;
        if (ratedCount === 0 && !tuningActive) return null;
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1.5 text-xs cursor-default" data-testid="text-rating-progress">
                <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${Math.min(100, (ratedCount / Math.max(1, total)) * 100)}%`, backgroundColor: meetsThreshold ? "hsl(var(--rs-green))" : "hsl(var(--muted-foreground) / 0.5)" }}
                  />
                </div>
                <span className={meetsThreshold ? "text-rs-green" : "text-muted-foreground"}>
                  {ratedCount}/{total}
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs">
              <p className="text-sm">
                {meetsThreshold
                  ? `You've rated ${ratedCount} of ${total} charts — enough to commit tuning. Rate more for better AI learning.`
                  : `Rate at least ${threshold} of ${total} charts (30%) before you can save & commit tuning changes.`}
              </p>
            </TooltipContent>
          </Tooltip>
        );
      })()}
      <Button
        size="icon"
        variant="ghost"
        className="ml-auto"
        onClick={() => onOpenChange(false)}
        data-testid="button-chart-close"
      >
        <X className="h-8 w-8" />
      </Button>
    </div>
  );

  const scanUpperPane = (
    <div className="flex items-center gap-1 h-full overflow-x-auto overflow-y-hidden">
      {current?.passedPaths.map((p) => (
        <Badge key={p} variant="outline" className="text-[10px]">
          {p}
        </Badge>
      ))}
    </div>
  );

  const scanLowerPane = current?.thoughtBreakdown && current.thoughtBreakdown.length > 0 ? (
    <div className="flex items-center gap-2 h-full overflow-x-auto overflow-y-hidden px-2 text-[10px] rounded-md border border-blue-800/40 bg-blue-950/15" data-testid="thought-breakdown-strip">
      <button
        className="flex-shrink-0 p-0.5 rounded hover-elevate"
        onClick={() => setTickerDebugOpen(v => !v)}
        data-testid="button-ticker-debug-info"
      >
        <Info className="h-3 w-3 text-blue-400" />
      </button>
      {current.thoughtBreakdown.map((thought) => {
        const passCount = thought.criteriaResults.filter((c: any) => c.pass).length;
        const totalCount = thought.criteriaResults.length;
        return (
          <div key={thought.thoughtId} className="flex items-center gap-1 flex-shrink-0 whitespace-nowrap">
            {thought.pass ? (
              <CheckCircle2 className="h-2.5 w-2.5 text-rs-green flex-shrink-0" />
            ) : (
              <XCircle className="h-2.5 w-2.5 text-rs-red flex-shrink-0" />
            )}
            <span className="font-medium text-foreground/90">{thought.thoughtName}</span>
            <span className={`font-semibold ${passCount === totalCount ? "text-rs-green" : "text-rs-amber"}`}>
              {passCount}/{totalCount}
            </span>
          </div>
        );
      })}
    </div>
  ) : undefined;

  const tickerDebugPanel = tickerDebugOpen && current?.thoughtBreakdown && current.thoughtBreakdown.length > 0 ? (
    <div
      className="absolute left-4 bottom-14 w-[480px] max-h-[420px] overflow-auto rounded-md border bg-popover shadow-lg z-50"
      data-testid="ticker-debug-overlay"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Ticker Debug — {symbol}</span>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon" variant="ghost" onClick={handleCopyTickerDebugText} data-testid="button-copy-ticker-debug-text">
                <ClipboardCopy className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top"><p>Copy debug text to clipboard</p></TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon" variant="ghost" onClick={handleCopyChartWindow} data-testid="button-copy-chart-image">
                <Camera className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top"><p>Copy entire chart window as image to clipboard</p></TooltipContent>
          </Tooltip>
          <Button size="icon" variant="ghost" onClick={() => setTickerDebugOpen(false)} data-testid="button-close-ticker-debug">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="px-3 py-2 space-y-2 text-[10px] font-mono text-muted-foreground leading-relaxed">
        {current.thoughtBreakdown.map((thought) => {
          const passCount = thought.criteriaResults.filter((c: any) => c.pass).length;
          const totalCount = thought.criteriaResults.length;
          return (
            <div key={thought.thoughtId} className="border-t border-dashed pt-1 first:border-t-0 first:pt-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                {thought.pass ? (
                  <CheckCircle2 className="h-2.5 w-2.5 text-rs-green flex-shrink-0" />
                ) : (
                  <XCircle className="h-2.5 w-2.5 text-rs-red flex-shrink-0" />
                )}
                <span className="font-semibold text-foreground">{thought.thoughtName}</span>
                <span className={`font-semibold ${passCount === totalCount ? "text-rs-green" : "text-rs-amber"}`}>
                  {passCount}/{totalCount}
                </span>
              </div>
              <div className="ml-4 mt-1 space-y-0.5">
                {thought.criteriaResults.map((cr: any, ci: number) => (
                  <div key={ci} className="flex items-start gap-1.5">
                    {cr.pass ? (
                      <CheckCircle2 className="h-2 w-2 text-rs-green flex-shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="h-2 w-2 text-rs-red flex-shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1">
                      <span className="text-foreground/80">{cr.indicatorName}</span>
                      {cr.inverted && <span className="text-rs-yellow ml-1">[INV]</span>}
                      {cr.diagnostics && (
                        <div className="ml-2 text-muted-foreground/70">
                          <span className="text-foreground/60">val: </span>
                          <span className={cr.pass ? "text-rs-green" : "text-rs-red"}>{cr.diagnostics.value}</span>
                          <span className="text-foreground/60 ml-1.5">thresh: </span>
                          <span>{cr.diagnostics.threshold}</span>
                          {cr.diagnostics.detail && (
                            <span className="text-muted-foreground/50 ml-1.5">{cr.diagnostics.detail}</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  ) : null;

  return createPortal(
    <div
      ref={overlayRef}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ outline: "none" }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      data-testid="scan-chart-overlay"
    >
      <div className="absolute inset-0 bg-black/80 z-0" />
      {commitReadyBanner && (
        <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none" data-testid="commit-ready-banner">
          <div className="bg-background/95 border border-rs-green/30 rounded-lg px-6 py-4 shadow-2xl max-w-md text-center animate-in fade-in zoom-in-95 duration-300">
            <div className="flex items-center justify-center gap-2 mb-1">
              <CheckCircle2 className="h-5 w-5 text-rs-green" />
              <span className="text-sm font-semibold text-rs-green">Ready to Commit</span>
            </div>
            <p className="text-xs text-muted-foreground">{commitReadyBanner}</p>
          </div>
        </div>
      )}
      {trainingMode && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 pointer-events-none" data-testid="training-mode-banner">
          <div className="bg-purple-950/95 border border-purple-500/50 rounded-lg px-6 py-3 shadow-2xl animate-in slide-in-from-top-2 duration-300">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-purple-500/20">
                <GraduationCap className="h-4 w-4 text-purple-400" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-purple-300">AI Training Mode</span>
                  <Badge variant="outline" className="text-[10px] border-purple-500/50 text-purple-300">ADMIN</Badge>
                </div>
                {sourceSetupName && (
                  <p className="text-xs text-purple-400/80">Validating setup: {sourceSetupName}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      <div ref={chartWindowRef} className="relative z-10 w-[95vw] max-w-[95vw] h-[90vh] bg-background border rounded-md shadow-lg flex flex-col p-4">
        {/* Debug Status Panel */}
        <div className="absolute top-2 right-2 bg-blue-950/90 border border-blue-500/50 rounded px-3 py-2 text-xs font-mono z-50 max-w-md">
          <div className="font-bold text-blue-300 mb-1">Chart Debug Status</div>
          <div className="space-y-0.5 text-blue-200/80">
            <div>Symbol: <span className="text-white font-semibold">{symbol || "N/A"}</span></div>
            <div>Daily: {dailyLoading ? "⏳ Loading..." : dailyError ? `❌ Error: ${dailyError}` : dailyData ? `✅ ${dailyData.candles?.length || 0} candles` : "❓ No data"}</div>
            <div>Intraday: {intradayLoading ? "⏳ Loading..." : intradayError ? `❌ Error: ${intradayError}` : intradayData ? `✅ ${intradayData.candles?.length || 0} candles` : "❓ No data"}</div>
            <div>Metrics: {metricsError ? `❌ Error: ${metricsError}` : chartMetrics ? `✅ Loaded` : "❓ No data"}</div>
            {chartMetrics && (
              <div className="mt-2 pt-2 border-t border-blue-500/30 text-[10px]">
                <div>PE: {chartMetrics.pe ?? "null"}</div>
                <div>Market Cap: {chartMetrics.marketCap ?? "null"}</div>
                <div>Target: ${chartMetrics.targetPrice ?? "null"}</div>
                <div>D/E: {chartMetrics.debtToEquity ?? "null"}</div>
              </div>
            )}
            <div>Current Index: {currentIndex} / {results.length}</div>
          </div>
        </div>
        
        <ChartErrorBoundary key={`scan-chart-viewer-${symbol}`} onClose={() => onOpenChange(false)}>
        <div className="relative flex-1 min-h-0 flex flex-col">
          <DualChartGrid
            symbol={symbol}
            dailyData={dailyData}
            dailyLoading={dailyLoading}
            intradayData={intradayData}
            intradayLoading={intradayLoading}
            chartMetrics={chartMetrics ?? null}
            intradayTimeframe={intradayTimeframe}
            onIntradayTimeframeChange={setIntradayTimeframe}
            showETH={showETH}
            onShowETHChange={setShowETH}
            upperPane={scanUpperPane}
            navExtra={scanNavExtra}
            lowerPane={scanLowerPane}
            dailyChartProps={{
              markers: cocAnnotations.markers,
              diamondMarkers: cocAnnotations.diamondMarkers,
              priceLines: [
                ...(cocAnnotations.priceLines || []),
                ...(ivyEntryLevel ? [{ price: ivyEntryLevel.price, color: "rgba(34, 197, 94, 0.8)", label: `Entry: ${ivyEntryLevel.label}` }] : []),
                ...(ivyStopLevel ? [{ price: ivyStopLevel.price, color: "rgba(239, 68, 68, 0.8)", label: `Stop: ${ivyStopLevel.label}` }] : []),
                ...(ivyTargetLevel ? [{ price: ivyTargetLevel.price, color: "rgba(34, 197, 94, 0.6)", label: `Target: ${ivyTargetLevel.label}` }] : []),
              ],
              resistanceLines: cocAnnotations.resistanceLines,
              baseZones: cocAnnotations.baseZones,
              onCandleClick: ivyActiveClickField ? (_candle: any, clickedPrice: number) => {
                setIvyChartClick({ price: clickedPrice, timestamp: Date.now() });
              } : undefined,
            }}
            intradayChartProps={{
              priceLines: [
                ...(ivyEntryLevel ? [{ price: ivyEntryLevel.price, color: "rgba(34, 197, 94, 0.8)", label: `Entry: ${ivyEntryLevel.label}` }] : []),
                ...(ivyStopLevel ? [{ price: ivyStopLevel.price, color: "rgba(239, 68, 68, 0.8)", label: `Stop: ${ivyStopLevel.label}` }] : []),
                ...(ivyTargetLevel ? [{ price: ivyTargetLevel.price, color: "rgba(34, 197, 94, 0.6)", label: `Target: ${ivyTargetLevel.label}` }] : []),
              ],
              onCandleClick: ivyActiveClickField ? (_candle: any, clickedPrice: number) => {
                setIvyChartClick({ price: clickedPrice, timestamp: Date.now() });
              } : undefined,
            }}
            testIdPrefix="scan"
          />
          <AskIvyOverlay
            open={askIvyOpen}
            onOpenChange={setAskIvyOpen}
            symbol={symbol}
            currentPrice={dayChange?.price ?? current?.price ?? 0}
            chartCandles={dailyData?.candles}
            onSelectionChange={handleIvySelectionChange}
            chartClickEvent={ivyChartClick}
            onChartClickModeChange={(field) => {
              setIvyActiveClickField(field);
            }}
            setupContext={setupConfig ? {
              setupId: setupConfig.id,
              setupName: setupConfig.name,
              ivyEntryStrategy: setupConfig.ivyEntryStrategy,
              ivyStopStrategy: setupConfig.ivyStopStrategy,
              ivyTargetStrategy: setupConfig.ivyTargetStrategy,
              ivyContextNotes: setupConfig.ivyContextNotes,
              ivyApproved: setupConfig.ivyApproved,
            } : undefined}
            isWatchlisted={isWatchlisted}
            watchlistItemId={watchlistItem?.id}
            onSaveTradePlan={handleSaveTradePlan}
            onClearTradePlan={handleClearTradePlan}
            savedTradePlan={savedTradePlan}
          />
          
          {/* News Panel */}
          {newsOpen && (
            <div 
              className="fixed top-16 right-4 w-96 max-h-[70vh] rounded-lg border shadow-xl overflow-hidden z-50"
              style={{ backgroundColor: cssVariables.overlayBg, borderColor: cssVariables.secondaryOverlayColor }}
            >
              <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: cssVariables.secondaryOverlayColor, backgroundColor: cssVariables.headerBg }}>
                <div className="flex items-center gap-2">
                  <Newspaper className="h-4 w-4 text-blue-400" />
                  <span className="font-semibold" style={{ color: cssVariables.textColorHeader }}>News - {symbol}</span>
                </div>
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setNewsOpen(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <ScrollArea className="h-[calc(70vh-48px)]">
                <div className="p-3 space-y-3">
                  {newsLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : !newsData || newsData.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      No recent news found for {symbol}
                    </div>
                  ) : (
                    newsData.slice(0, 20).map((article) => (
                      <a
                        key={article.id}
                        href={article.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block p-3 rounded-md border hover:bg-slate-800/50 transition-colors"
                        style={{ borderColor: `${cssVariables.secondaryOverlayColor}66` }}
                      >
                        <div className="flex gap-3">
                          {article.image && (
                            <img 
                              src={article.image} 
                              alt="" 
                              className="w-16 h-16 object-cover rounded flex-shrink-0"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            <h4 className="text-sm font-medium line-clamp-2 mb-1" style={{ color: cssVariables.textColorNormal }}>
                              {article.headline}
                            </h4>
                            <p className="text-xs line-clamp-2 mb-2" style={{ color: cssVariables.textColorSmall }}>
                              {article.summary}
                            </p>
                            <div className="flex items-center gap-2 text-xs" style={{ color: cssVariables.textColorTiny }}>
                              <span>{article.source}</span>
                              <span>•</span>
                              <span>{new Date(article.datetime * 1000).toLocaleDateString()}</span>
                            </div>
                          </div>
                        </div>
                      </a>
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>
        </ChartErrorBoundary>
        {tickerDebugPanel}
      </div>
    </div>,
    document.body
  );
}
