// ---------------------------------------------------------------------------
// Signal Workbench V2 — 9 checkpoint hit-rate analysis + MFE/MAE behavior
// ---------------------------------------------------------------------------

import React, { useState, useEffect, useMemo, useCallback, Component } from "react";
import { useSystemSettings } from "@/context/SystemSettingsContext";
import { cn } from "@/lib/utils";
import { FlaskConical, RefreshCw, ChevronRight, X, TrendingUp, TrendingDown, Minus, Activity, Sparkles, ChevronDown, Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DiscoveryCard } from "@/components/scanner/DiscoveryCard";
import { scannerPx, loadScannerFontOffset, saveScannerFontOffset } from "@/components/scanner/scanner-font-prefs";
import { ScannerFontSizeControl } from "@/components/scanner/ScannerFontSizeControl";
import type { DiscoveryCard as DiscoveryCardType } from "@shared/scanner-types";
import { DEFAULT_SCANNER_CONFIG, type ScannerConfig } from "@shared/scanner-config";
import { parseThemeRankN, type ThemeRankCut } from "@shared/scanner-theme-rank-filter";

// ── Types ────────────────────────────────────────────────────────────────────

interface SignalTypeStats {
  signalType: string;
  totalFired: number;
  tracked: number;
  episodes?: number;
  coverage?: number | null;
  hitRate: number | null;
  hitRateShrunk?: number | null;
  avgMove: number | null;
  medianMove?: number | null;
  avgPeakMove: number | null;
  avgGiveback: number | null;
  failRate: number | null;
  reversalRate: number | null;
  mfe3Rate: number | null;
  mae3Rate: number | null;
  confidence?: number | null;
  tier?: string | null;
  trust?: string | null;
}

interface CohortRow {
  signalType: string;
  dimension: string;
  bucket: string;
  episodes: number;
  tracked: number;
  hitRate: number | null;
  avgMove: number | null;
  confidence: number;
  tier: string;
}

interface WorkbenchCard extends DiscoveryCardType {
  priceAtSignal: number | null;
  price15m: number | null; move15m: number | null;
  price30m: number | null; move30m: number | null;
  price1hr: number | null; move1hr: number | null;
  price4hr: number | null; move4hr: number | null;
  priceD1Close: number | null; moveD1Close: number | null;
  priceD2Open: number | null; moveD2Open: number | null;
  priceD2Close: number | null; moveD2Close: number | null;
  price1w: number | null; move1w: number | null;
  price1mo: number | null; move1mo: number | null;
  peakMove: number | null;
  peakPrice: number | null;
  peakAt: string | null;
  worstDrawdown: number | null;
  troughPrice: number | null;
  troughAt: string | null;
  givebackPct: number | null;
  outcomeStatus: string | null;
  outcomeFailed: boolean | null;
  failedAt: string | null;
  regimeAtSignal: string | null;
  sessionAtSignal: string | null;
  raiAtSignal: number | null;
  outcomeTrackedAt: string | null;
}

type WindowKey = "15m" | "30m" | "1hr" | "4hr" | "d1_close" | "d2_open" | "d2_close" | "1w" | "1mo";
type StatusFilter = "all" | "profitable" | "reversed" | "failed" | "tracking" | "flat";
type SortMode = "newest" | "best_peak" | "worst_drawdown" | "biggest_giveback";

const WINDOW_OPTIONS: { value: WindowKey; label: string }[] = [
  { value: "15m", label: "15m" },
  { value: "30m", label: "30m" },
  { value: "1hr", label: "1hr" },
  { value: "4hr", label: "4hr" },
  { value: "d1_close", label: "D1 Close" },
  { value: "d2_open", label: "D2 Open" },
  { value: "d2_close", label: "D2 Close" },
  { value: "1w", label: "1W" },
  { value: "1mo", label: "1Mo" },
];

const SIGNAL_TYPE_LABELS: Record<string, string> = {
  gap: "Gap Up/Down",
  volume_spike: "Volume Surge",
  velocity_move: "Velocity Move",
  adr_blowout: "ADR Blowout",
  breadth_shift: "Breadth Shift",
  theme_acceleration: "Theme Acceleration",
  regime_change: "Regime Change",
  rai_shift: "RAI Shift",
  broad_weakness: "Broad Weakness",
  broad_strength: "Broad Strength",
  news_alert: "News Alert",
  ma_proximity: "MA Proximity",
  ur_ma_reclaim: "MA Reclaim",
  prev_day_high_break: "Prev Day High Break",
  prev_day_low_break: "Prev Day Low Break",
  five_day_high_break: "5-Day High Break",
  five_day_low_break: "5-Day Low Break",
  lod_bounce: "LOD Bounce",
  failed_breakout: "Failed Breakout",
  hod_fade: "HOD Fade",
  gap_down_continuation: "Gap Down Continuation",
  earnings_reaction: "Earnings Reaction",
  theme_earnings_density: "Theme Earnings Density",
  ipo_debut: "IPO Debut",
};

function buildSignalCriteria(cfg: ScannerConfig | null): Record<string, string> {
  const c = cfg ?? DEFAULT_SCANNER_CONFIG;
  return {
    gap: `Gap ≥${c.gapThresholdPct}% from prev close at open. Urgent if ≥5% with high volume. Cooldown: ${c.gapCooldownMin}min.`,
    volume_spike: `Intraday volume ≥${c.volumeSpikeThreshold}x the 14d average. Cooldown: ${c.volumeSpikeCooldownMin}min.`,
    velocity_move: `Price moves ≥${c.velocityThresholdPct}% within ${c.velocityWindowFrames} frames. Cooldown: ${c.velocityCooldownMin}min.`,
    adr_blowout: `Today's range exceeds ${c.adrBlowoutThreshold}x the 14d ADR. Cooldown: ${c.adrBlowoutCooldownMin}min.`,
    breadth_shift: `Theme A/D ratio shifts ≥${c.breadthShiftThreshold} over ${c.breadthShiftWindowFrames} frames. Cooldown: ${c.breadthShiftCooldownMin}min.`,
    theme_acceleration: `Theme score changes ≥${c.themeAccelThreshold} pts between snapshots. "Bouncing" if score <30, "Surging" if strong. Cooldown: ${c.themeAccelCooldownMin}min.`,
    regime_change: "Market regime shifts (e.g., NEUTRAL → AGGRESSIVE or DEFENSIVE). Cooldown: 30min.",
    rai_shift: `RAI shifts ≥${c.raiShiftThreshold} pts over ${c.raiShiftWindowFrames} frames. Cooldown: ${c.raiShiftCooldownMin}min.`,
    broad_weakness: `≥${c.broadMoveThemeCount} themes declining. Cooldown: ${c.broadMoveCooldownMin}min.`,
    broad_strength: `≥${c.broadMoveThemeCount} themes advancing. Cooldown: ${c.broadMoveCooldownMin}min.`,
    news_alert: "Headline severity ≥3 from Finnhub/FMP. Corroboration boosts score. Cooldown: 60min per ticker.",
    ma_proximity: `Price within ${c.maProximityThresholdPct}% of 20d/50d/200d SMA. Repeats every ${c.maProximityCooldownMin}min intraday.`,
    ur_ma_reclaim: `Price reclaims key SMA after ≥3 frames below. 50d: within ${c.maReclaim50dMaxExtPct}%, 200d: within ${c.maReclaim200dMaxExtPct}%. Cooldown: ${c.maReclaimCooldownMin}min.`,
    prev_day_high_break: `Price breaks ≥${c.breakClearancePct}% above prev day high AND above 200d SMA. ${c.breakConfirmFrames}-frame hold. Cooldown: ${c.breakCooldownMin}min.`,
    prev_day_low_break: `Price breaks ≥${c.breakClearancePct}% below prev day low. Priority if below 50d+200d. ${c.breakConfirmFrames}-frame hold. Cooldown: ${c.breakCooldownMin}min.`,
    five_day_high_break: `Price breaks ≥${c.breakClearancePct}% above 5-day high AND above 200d SMA. ${c.breakConfirmFrames}-frame hold. Cooldown: ${c.breakCooldownMin}min.`,
    five_day_low_break: `Price breaks ≥${c.breakClearancePct}% below 5-day low. Priority if below 50d+200d. ${c.breakConfirmFrames}-frame hold. Cooldown: ${c.breakCooldownMin}min.`,
    lod_bounce: `Stock up ≥${c.lodBounceTier1Pct}% (tier 1) or ≥${c.lodBounceTier2Pct}% (tier 2) from LOD (peak). Max ${c.lodBounceMaxAtrExt}x ATR. Clears if back within ${c.lodBounceGiveUpPct}% of LOD or peak ≥${c.lodBounceClearMaxPct}% / over ATR. Cooldown: ${c.lodBounceCooldownMin}min.`,
    failed_breakout: `Broke above prev day high then reversed ≥${c.failedBreakoutReversalPct}% back below. Lookback: ${c.failedBreakoutLookbackMin}-${c.failedBreakoutLookbackMax} frames. Cooldown: ${c.failedBreakoutCooldownMin}min.`,
    hod_fade: `Faded ≥${c.hodFadeMinPct}% from HOD after ${c.hodFadeMinFramesSinceHod}+ frames. Cooldown: ${c.hodFadeCooldownMin}min.`,
    gap_down_continuation: `Gapped down ≥${c.gapDownContinuationMinGapPct}%, continued ≥${c.gapDownContinuationMinFadePct}% below open after ${c.gapDownContinuationMinFrames} frames. Cooldown: ${c.gapDownContinuationCooldownMin}min.`,
    earnings_reaction: "Post-earnings price reaction — EPS/revenue beat or miss with significant move.",
    theme_earnings_density: "Multiple tickers in a theme reporting earnings within the same week.",
    ipo_debut: `New IPO from FMP calendar. Min market cap: $${c.ipoMinMarketCapM}M. Urgent if >$1B.`,
  };
}

function hitRateColor(rate: number | null | undefined): string {
  if (rate == null) return "text-slate-500";
  if (rate >= 0.65) return "text-emerald-400";
  if (rate >= 0.40) return "text-amber-400";
  return "text-red-400";
}

function formatPct(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function formatRate(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${Math.round(n * 100)}%`;
}

const STATS_COLUMN_HELP: { key: string; label: string; align: "left" | "right"; tip: string }[] = [
  {
    key: "signalType",
    label: "Signal Type",
    align: "left",
    tip: "Scanner detector that fired. Hover a row name for that signal’s rules.",
  },
  {
    key: "fired",
    label: "Fired",
    align: "right",
    tip: "Raw discovery cards in range, including repeats of the same symbol on the same day.",
  },
  {
    key: "eps",
    label: "Eps",
    align: "right",
    tip: "Unique episodes = first fire per signal type + symbol + ET calendar day. Use this for ranking, not Fired.",
  },
  {
    key: "tracked",
    label: "Tracked",
    align: "right",
    tip: "Episodes that have an outcome filled at the selected window (e.g. 30m).",
  },
  {
    key: "cov",
    label: "Cov",
    align: "right",
    tip: "Coverage = Tracked ÷ Eps. Low coverage means many episodes still lack a price at this window.",
  },
  {
    key: "hit",
    label: "Hit%",
    align: "right",
    tip: "Share of tracked episodes whose direction-adjusted move met the Hit % threshold. Shorts are flipped so up is favorable.",
  },
  {
    key: "edge",
    label: "Edge",
    align: "right",
    tip: "Average direction-adjusted move at the selected window. Positive = favorable for the signal’s long/short direction.",
  },
  {
    key: "peak",
    label: "Peak",
    align: "right",
    tip: "Average max favorable excursion (MFE) after the signal, within the measured horizon.",
  },
  {
    key: "give",
    label: "Give",
    align: "right",
    tip: "Average giveback from peak MFE back toward entry — how much of the best move was typically lost.",
  },
  {
    key: "tier",
    label: "Tier",
    align: "right",
    tip: "Evidence tier from hit rate, edge, and sample size: strong / watch / weak / unknown. Provisional until V3 outcomes dominate.",
  },
  {
    key: "conf",
    label: "Conf",
    align: "right",
    tip: "Sample-size confidence (0–1). Higher means enough tracked episodes to trust the tier more.",
  },
];

function StatsHeaderCell({ label, tip, align }: { label: string; tip: string; align: "left" | "right" }) {
  return (
    <th
      className={cn(
        "px-2 py-2 font-medium",
        align === "left" ? "text-left px-3" : "text-right"
      )}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(
              "cursor-help border-b border-dotted border-slate-500/70 outline-none",
              align === "right" && "ml-auto"
            )}
          >
            {label}
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          className="max-w-xs border-slate-700 bg-slate-900 text-xs leading-snug text-slate-100"
        >
          {tip}
        </TooltipContent>
      </Tooltip>
    </th>
  );
}

/** America/New_York calendar YYYY-MM-DD for "today" in Lab filters. */
function etCalendarYmd(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * Last N Mon–Fri sessions back from ET today (holidays not excluded).
 * Instant fallback until /workbench/lookback resolves true market days.
 */
function defaultLabFromDate(tradingDaysBack: number): string {
  const todayEt = etCalendarYmd();
  const [y, m, day] = todayEt.split("-").map(Number);
  const cursor = new Date(Date.UTC(y!, m! - 1, day!));
  let left = tradingDaysBack;
  while (left > 0) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) left--;
  }
  return cursor.toISOString().slice(0, 10);
}

// ── Error boundary ───────────────────────────────────────────────────────────

class WorkbenchErrorBoundary extends Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) return <div className="p-8 text-red-400 bg-slate-950 h-screen"><h1 className="text-xl font-bold mb-4">Workbench Error</h1><pre className="text-sm whitespace-pre-wrap">{this.state.error.message}{"\n"}{this.state.error.stack}</pre></div>;
    return this.props.children;
  }
}

// ── Main component ───────────────────────────────────────────────────────────

function SignalWorkbenchInner() {
  const { cssVariables } = useSystemSettings();
  const [fo, setFo] = useState(() => loadScannerFontOffset());
  const handleFontChange = (newOffset: number) => {
    saveScannerFontOffset(newOffset);
    setFo(newOffset);
  };

  // Filters — default 30m over last ~5 sessions (market calendar soft-updates from)
  const [fromDate, setFromDate] = useState(() => defaultLabFromDate(5));
  const [toDate, setToDate] = useState(() => etCalendarYmd());
  const [hitThreshold, setHitThreshold] = useState(0.5);
  const [sessionFilter, setSessionFilter] = useState("all");
  const [minSamples, setMinSamples] = useState(5);
  const [window, setWindow] = useState<WindowKey>("30m");

  // Data
  const [stats, setStats] = useState<SignalTypeStats[]>([]);
  const [cohorts, setCohorts] = useState<CohortRow[]>([]);
  const [qualityWarnings, setQualityWarnings] = useState<string[]>([]);
  const [trustUsed, setTrustUsed] = useState<string>("provisional");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedSignal, setSelectedSignal] = useState<string | null>(null);
  const [cards, setCards] = useState<WorkbenchCard[]>([]);
  const [cardsLoading, setCardsLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [scannerConfig, setScannerConfig] = useState<ScannerConfig | null>(null);
  const [trustMode, setTrustMode] = useState<"auto" | "provisional" | "trusted" | "all">("auto");
  const [themeRankCut, setThemeRankCut] = useState<ThemeRankCut>("all");
  const [themeRankN, setThemeRankN] = useState(5);
  const [cohortDimension, setCohortDimension] = useState<string>("score");

  // AI Lab state
  const [aiLabExpanded, setAiLabExpanded] = useState(false);
  const [aiMode, setAiMode] = useState<"idle" | "analyzing" | "asking">("idle");
  const [aiResponse, setAiResponse] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [userQuestion, setUserQuestion] = useState("");
  const [showQuestionInput, setShowQuestionInput] = useState(false);

  // Fetch live scanner config for tooltip thresholds
  useEffect(() => {
    fetch("/api/scanner/config").then(r => r.ok ? r.json() : null).then(d => {
      if (d?.config) setScannerConfig(d.config);
    }).catch(() => {});
  }, []);

  const signalCriteria = useMemo(() => buildSignalCriteria(scannerConfig), [scannerConfig]);

  // Fetch hit rates (table first; cohorts lazy when a signal is selected)
  const fetchHitRates = useCallback(async (opts?: { cohorts?: boolean }) => {
    const wantCohorts = opts?.cohorts === true;
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams({
        from: fromDate,
        to: toDate,
        hit_threshold: String(hitThreshold),
        min_samples: String(minSamples),
        session: sessionFilter,
        window,
        trust: trustMode,
        cohorts: wantCohorts ? "1" : "0",
        theme_rank_cut: themeRankCut,
        theme_rank_n: String(themeRankN),
      });
      const res = await fetch(`/api/scanner/workbench/hit-rates?${params}&_t=${Date.now()}`, {
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) {
        const data = await res.json();
        setStats(data.signalTypes ?? []);
        if (wantCohorts) setCohorts(data.cohorts ?? []);
        else setCohorts([]);
        setQualityWarnings(data.qualityWarnings ?? []);
        setTrustUsed(data.trustUsed ?? "provisional");
        if (!(data.signalTypes ?? []).length) {
          setLoadError("Query returned no signal rows for this range/window.");
        }
      } else {
        setStats([]);
        setCohorts([]);
        setLoadError(`Hit-rates failed (${res.status}). Server may need a restart.`);
      }
    } catch (err) {
      setStats([]);
      setCohorts([]);
      const name = err instanceof Error ? err.name : "";
      setLoadError(
        name === "TimeoutError" || name === "AbortError"
          ? "Hit-rates timed out — DB connection likely saturated; restart LOCAL server."
          : "Hit-rates request failed — check LOCAL server logs."
      );
    }
    setLoading(false);
  }, [fromDate, toDate, hitThreshold, minSamples, sessionFilter, window, trustMode, themeRankCut, themeRankN]);

  // Fetch cards for selected signal type
  const fetchCards = useCallback(async (signalType: string) => {
    setCardsLoading(true);
    try {
      const params = new URLSearchParams({
        signal_type: signalType,
        from: fromDate,
        to: toDate,
        status: statusFilter,
        limit: "50",
        theme_rank_cut: themeRankCut,
        theme_rank_n: String(themeRankN),
      });
      const res = await fetch(`/api/scanner/workbench/cards?${params}&_t=${Date.now()}`, {
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) {
        const data = await res.json();
        setCards(data.cards ?? []);
      }
    } catch { /* ignore */ }
    setCardsLoading(false);
  }, [fromDate, toDate, statusFilter, themeRankCut, themeRankN]);

  // Soft-resolve true US equity market days (do not block the first aggregate)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/scanner/workbench/lookback?days=5", {
          signal: AbortSignal.timeout(2500),
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        if (typeof data.from === "string") setFromDate((prev) => (prev === data.from ? prev : data.from));
        if (typeof data.to === "string") setToDate((prev) => (prev === data.to ? prev : data.to));
      } catch {
        /* keep weekday fallback */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    document.title = "Signals Lab";
    void fetchHitRates({ cohorts: !!selectedSignal });
  }, [fetchHitRates, selectedSignal]);

  // Auto-refresh every 90 seconds (aggregates are cached server-side for 60s)
  useEffect(() => {
    const interval = setInterval(() => {
      void fetchHitRates({ cohorts: !!selectedSignal });
      if (selectedSignal) fetchCards(selectedSignal);
    }, 90_000);
    return () => clearInterval(interval);
  }, [fetchHitRates, fetchCards, selectedSignal]);

  useEffect(() => {
    if (selectedSignal) void fetchCards(selectedSignal);
  }, [selectedSignal, fetchCards]);

  const selectedCohorts = useMemo(() => {
    if (!selectedSignal) return [];
    return cohorts.filter((c) => c.signalType === selectedSignal && c.dimension === cohortDimension);
  }, [cohorts, selectedSignal, cohortDimension]);

  const sortedStats = useMemo(() => {
    const copy = [...stats];
    copy.sort((a, b) => {
      const tierRank = (t?: string | null) =>
        t === "strong" ? 0 : t === "watch" ? 1 : t === "weak" ? 3 : 2;
      const tr = tierRank(a.tier) - tierRank(b.tier);
      if (tr !== 0) return tr;
      return (b.hitRateShrunk ?? b.hitRate ?? -1) - (a.hitRateShrunk ?? a.hitRate ?? -1);
    });
    return copy;
  }, [stats]);

  const sortedCards = useMemo(() => {
    const sorted = [...cards];
    switch (sortMode) {
      case "best_peak": sorted.sort((a, b) => (b.peakMove ?? 0) - (a.peakMove ?? 0)); break;
      case "worst_drawdown": sorted.sort((a, b) => (a.worstDrawdown ?? 0) - (b.worstDrawdown ?? 0)); break;
      case "biggest_giveback": sorted.sort((a, b) => (b.givebackPct ?? 0) - (a.givebackPct ?? 0)); break;
      default: break; // newest = default order from API
    }
    return sorted;
  }, [cards, sortMode]);

  const handleAiAnalyze = useCallback(async () => {
    setAiLoading(true);
    setAiMode("analyzing");
    setAiResponse(null);
    setShowQuestionInput(false);
    try {
      const res = await fetch("/api/scanner/workbench/ai-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "analyze",
          stats,
          cards: (sortedCards.length > 0 ? sortedCards : cards).slice(0, 200),
          window,
          hitThreshold,
          dateRange: { from: fromDate, to: toDate },
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setAiResponse(data.analysis);
      } else {
        setAiResponse(`Error: ${data.error ?? "Analysis failed"}`);
      }
    } catch {
      setAiResponse("Error: Failed to connect to AI service");
    }
    setAiLoading(false);
    setAiMode("idle");
  }, [stats, cards, sortedCards, window, hitThreshold, fromDate, toDate]);

  const handleAiQuestion = useCallback(async () => {
    if (!userQuestion.trim()) return;
    setAiLoading(true);
    setAiMode("asking");
    setAiResponse(null);
    try {
      const res = await fetch("/api/scanner/workbench/ai-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "question",
          question: userQuestion.trim(),
          stats,
          cards: (sortedCards.length > 0 ? sortedCards : cards).slice(0, 200),
          window,
          hitThreshold,
          dateRange: { from: fromDate, to: toDate },
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setAiResponse(data.analysis);
      } else {
        setAiResponse(`Error: ${data.error ?? "Analysis failed"}`);
      }
    } catch {
      setAiResponse("Error: Failed to connect to AI service");
    }
    setAiLoading(false);
    setAiMode("idle");
  }, [userQuestion, stats, cards, sortedCards, window, hitThreshold, fromDate, toDate]);

  return (
    <div className="flex flex-col h-dvh min-h-0" style={{ backgroundColor: cssVariables.mainBg, color: cssVariables.primaryText }}>
      {/* Header */}
      <div
        className="flex items-center justify-between gap-3 px-4 py-2.5 shrink-0 border-b"
        style={{ backgroundColor: cssVariables.headerBg, borderColor: cssVariables.borderOnSecondary }}
      >
        <div className="flex items-center gap-2">
          <FlaskConical className="h-5 w-5 text-purple-400" />
          <h1 className="font-bold text-base" style={{ color: cssVariables.textTitle }}>Signals Lab</h1>
          <span className="text-xs px-2 py-0.5 rounded bg-purple-900/30 text-purple-300 font-medium">V3 — Evidence</span>
          <span
            className={cn(
              "text-[10px] px-2 py-0.5 rounded font-medium uppercase",
              trustUsed === "trusted" ? "bg-emerald-900/30 text-emerald-300" : "bg-amber-900/30 text-amber-300"
            )}
          >
            {trustUsed}
          </span>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Timeframe selector */}
          <label className="flex items-center gap-1.5 text-xs" style={{ color: cssVariables.textSmall }}>
            Window
            <select
              value={window}
              onChange={(e) => setWindow(e.target.value as WindowKey)}
              className="h-7 rounded border border-slate-700 bg-slate-900 px-2 text-xs font-medium"
              style={{ color: cssVariables.textTitle }}
            >
              {WINDOW_OPTIONS.map((w) => (
                <option key={w.value} value={w.value}>{w.label}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs" style={{ color: cssVariables.textSmall }}>
            From
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-7 rounded border border-slate-700 bg-slate-900 px-2 text-xs" style={{ color: cssVariables.textTitle }} />
          </label>
          <label className="flex items-center gap-1.5 text-xs" style={{ color: cssVariables.textSmall }}>
            To
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-7 rounded border border-slate-700 bg-slate-900 px-2 text-xs" style={{ color: cssVariables.textTitle }} />
          </label>
          <label className="flex items-center gap-1.5 text-xs" style={{ color: cssVariables.textSmall }}>
            Hit %
            <input
              type="number" min={0.1} max={20} step={0.1} value={hitThreshold}
              onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) setHitThreshold(v); }}
              className="w-16 h-7 rounded border border-slate-700 bg-slate-900 px-2 text-xs text-right tabular-nums"
              style={{ color: cssVariables.textTitle }}
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs" style={{ color: cssVariables.textSmall }}>
            Session
            <select value={sessionFilter} onChange={(e) => setSessionFilter(e.target.value)} className="h-7 rounded border border-slate-700 bg-slate-900 px-2 text-xs" style={{ color: cssVariables.textTitle }}>
              <option value="all">All</option>
              <option value="pre_market">Pre-market</option>
              <option value="open_drive">Open Drive</option>
              <option value="mid_morning">Mid Morning</option>
              <option value="midday">Midday</option>
              <option value="power_hour">Power Hour</option>
              <option value="close">Close</option>
              <option value="after_hours">After Hours</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs" style={{ color: cssVariables.textSmall }} title="Theme rank at fire vs ~26 Flow themes. Leading 5 = ranks 1–5. Lowest 5 = weakest 5 (or bottom ~20% if rank is missing).">
            Themes
            <select value={themeRankCut} onChange={(e) => setThemeRankCut(e.target.value as ThemeRankCut)} className="h-7 rounded border border-slate-700 bg-slate-900 px-2 text-xs" style={{ color: cssVariables.textTitle }}>
              <option value="all">All</option>
              <option value="leading">Leading</option>
              <option value="lowest">Lowest</option>
            </select>
            <input
              type="number"
              min={1}
              max={26}
              disabled={themeRankCut === "all"}
              value={themeRankN}
              onChange={(e) => setThemeRankN(parseThemeRankN(e.target.value, themeRankN))}
              className="w-12 h-7 rounded border border-slate-700 bg-slate-900 px-2 text-xs text-right disabled:opacity-40"
              style={{ color: cssVariables.textTitle }}
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs" style={{ color: cssVariables.textSmall }}>
            Trust
            <select value={trustMode} onChange={(e) => setTrustMode(e.target.value as typeof trustMode)} className="h-7 rounded border border-slate-700 bg-slate-900 px-2 text-xs" style={{ color: cssVariables.textTitle }}>
              <option value="auto">Auto</option>
              <option value="provisional">Provisional</option>
              <option value="trusted">Trusted V3</option>
              <option value="all">All</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs" style={{ color: cssVariables.textSmall }}>
            Min
            <input type="number" min={1} max={100} value={minSamples} onChange={(e) => setMinSamples(parseInt(e.target.value, 10))} className="w-12 h-7 rounded border border-slate-700 bg-slate-900 px-2 text-xs text-right" style={{ color: cssVariables.textTitle }} />
          </label>
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-purple-400 hover:text-purple-300 hover:bg-purple-900/20" onClick={() => void fetchHitRates({ cohorts: !!selectedSignal })}>
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
          <ScannerFontSizeControl value={fo} onChange={handleFontChange} />
        </div>
      </div>

      {loadError && (
        <div className="px-4 py-1.5 border-b text-[11px] shrink-0" style={{ borderColor: cssVariables.borderOnSecondary, backgroundColor: "rgba(239,68,68,0.08)", color: "#fca5a5" }}>
          {loadError}
        </div>
      )}

      {qualityWarnings.length > 0 && (
        <div className="px-4 py-1.5 border-b text-[11px] space-y-0.5 shrink-0" style={{ borderColor: cssVariables.borderOnSecondary, backgroundColor: "rgba(245,158,11,0.06)", color: "#fbbf24" }}>
          {qualityWarnings.slice(0, 4).map((w, i) => (
            <div key={i}>⚠ {w}</div>
          ))}
        </div>
      )}

      {/* Main content: two panels */}
      <div className="flex flex-1 min-h-0" style={{ fontSize: scannerPx("card", fo) }}>
        {/* Left panel: stats table */}
        <div className="w-[55%] border-r overflow-y-auto" style={{ borderColor: cssVariables.borderOnSecondary }}>
          <TooltipProvider delayDuration={200}>
          <table className="w-full">
            <thead className="sticky top-0" style={{ backgroundColor: cssVariables.headerBg }}>
              <tr style={{ color: cssVariables.textSmall }}>
                  {STATS_COLUMN_HELP.map((col) => (
                    <StatsHeaderCell key={col.key} label={col.label} tip={col.tip} align={col.align} />
                  ))}
                <th className="w-5" />
              </tr>
            </thead>
            <tbody>
              {sortedStats.length === 0 && !loading && (
                <tr>
                  <td colSpan={12} className="text-center py-12" style={{ color: cssVariables.textSmall }}>
                    {loadError
                      ? "Could not load evidence for this range."
                      : "No data yet. Signals need time to accumulate outcomes."}
                  </td>
                </tr>
              )}
              {sortedStats.length === 0 && loading && (
                <tr>
                  <td colSpan={12} className="text-center py-12" style={{ color: cssVariables.textSmall }}>
                    Loading evidence…
                  </td>
                </tr>
              )}
              {sortedStats.map((s) => {
                const isSelected = selectedSignal === s.signalType;
                return (
                  <tr
                    key={s.signalType}
                    className={cn(
                      "cursor-pointer transition-colors border-b",
                      isSelected ? "bg-purple-900/20" : "hover:bg-slate-800/40"
                    )}
                    style={{ borderColor: "rgba(100,116,139,0.15)" }}
                    onClick={() => setSelectedSignal(isSelected ? null : s.signalType)}
                  >
                    <td
                      className="px-3 py-2 font-medium cursor-help"
                      style={{ color: cssVariables.textTitle }}
                      title={signalCriteria[s.signalType] ?? ""}
                    >
                      {SIGNAL_TYPE_LABELS[s.signalType] ?? s.signalType}
                    </td>
                    <td className="text-right px-2 py-2 tabular-nums" style={{ color: cssVariables.textSmall }}>{s.totalFired}</td>
                    <td className="text-right px-2 py-2 tabular-nums" style={{ color: cssVariables.textSmall }}>{s.episodes ?? "—"}</td>
                    <td className="text-right px-2 py-2 tabular-nums" style={{ color: cssVariables.textSmall }}>{s.tracked}</td>
                    <td className="text-right px-2 py-2 tabular-nums" style={{ color: cssVariables.textSmall }}>
                      {s.coverage != null ? `${Math.round(s.coverage * 100)}%` : "—"}
                    </td>
                    <td className={cn("text-right px-2 py-2 tabular-nums font-medium", hitRateColor(s.hitRateShrunk ?? s.hitRate))}>
                      {formatRate(s.hitRateShrunk ?? s.hitRate)}
                    </td>
                    <td className="text-right px-2 py-2 tabular-nums" style={{ color: cssVariables.textSmall }}>
                      {formatPct(s.avgMove)}
                    </td>
                    <td className="text-right px-2 py-2 tabular-nums text-cyan-400">
                      {s.avgPeakMove != null ? `+${s.avgPeakMove.toFixed(1)}%` : "—"}
                    </td>
                    <td className="text-right px-2 py-2 tabular-nums text-amber-400">
                      {s.avgGiveback != null ? `${s.avgGiveback.toFixed(1)}%` : "—"}
                    </td>
                    <td className={cn(
                      "text-right px-2 py-2 text-[10px] font-bold uppercase",
                      s.tier === "strong" ? "text-emerald-400" :
                      s.tier === "watch" ? "text-cyan-400" :
                      s.tier === "weak" ? "text-red-400" : "text-slate-500"
                    )}>
                      {s.tier ?? "—"}
                    </td>
                    <td className="text-right px-2 py-2 tabular-nums" style={{ color: cssVariables.textTiny }}>
                      {s.confidence != null ? s.confidence.toFixed(2) : "—"}
                    </td>
                    <td className="px-1">
                      <ChevronRight className={cn("h-3 w-3 transition-transform", isSelected && "rotate-90")} style={{ color: cssVariables.textTiny }} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </TooltipProvider>
        </div>

        {/* Right panel: card drill-down */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {!selectedSignal ? (
            <div className="flex flex-col items-center justify-center h-full gap-3" style={{ color: cssVariables.textSmall }}>
              <FlaskConical className="h-10 w-10 text-slate-600" />
              <p className="text-sm">Select a signal type to drill into individual cards</p>
            </div>
          ) : (
            <>
              {/* Drill-down header */}
              <div className="flex items-center justify-between px-3 py-2 border-b shrink-0" style={{ borderColor: cssVariables.borderOnSecondary }}>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm" style={{ color: cssVariables.textTitle }}>
                    {SIGNAL_TYPE_LABELS[selectedSignal] ?? selectedSignal}
                  </span>
                  <span className="text-xs tabular-nums" style={{ color: cssVariables.textTiny }}>
                    {cards.length} cards
                  </span>
                  <select
                    value={cohortDimension}
                    onChange={(e) => setCohortDimension(e.target.value)}
                    className="h-6 rounded border border-slate-700 bg-slate-900 px-1.5 text-[10px]"
                    style={{ color: cssVariables.textTitle }}
                    title="Cohort dimension"
                  >
                    <option value="score">Score</option>
                    <option value="session">Session</option>
                    <option value="theme">Theme</option>
                    <option value="ma">MA</option>
                    <option value="regime">Regime</option>
                    <option value="liquidity">Liquidity</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  {(["all", "profitable", "reversed", "failed", "tracking", "flat"] as StatusFilter[]).map((f) => (
                    <button
                      key={f}
                      className={cn(
                        "px-2 py-0.5 rounded text-[10px] font-medium capitalize transition-colors",
                        statusFilter === f
                          ? "bg-purple-800/40 text-purple-300 ring-1 ring-purple-600/50"
                          : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
                      )}
                      onClick={() => setStatusFilter(f)}
                    >
                      {f === "all" ? "All" : f}
                    </button>
                  ))}
                  <select
                    value={sortMode}
                    onChange={(e) => setSortMode(e.target.value as SortMode)}
                    className="h-6 rounded border border-slate-700 bg-slate-900 px-1.5 text-xs"
                    style={{ color: cssVariables.textTitle }}
                  >
                    <option value="newest">Newest</option>
                    <option value="best_peak">Best Peak</option>
                    <option value="worst_drawdown">Worst Drawdown</option>
                    <option value="biggest_giveback">Biggest Giveback</option>
                  </select>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-slate-400 hover:text-slate-200" onClick={() => setSelectedSignal(null)} title="Close drill-down">
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {/* Cards list */}
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {selectedCohorts.length > 0 && (
                  <div className="rounded border border-slate-700/40 p-2 mb-1">
                    <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">
                      Cohorts · {cohortDimension}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedCohorts.map((c) => (
                        <span
                          key={`${c.dimension}-${c.bucket}`}
                          className={cn(
                            "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] tabular-nums border",
                            c.tier === "strong" ? "border-emerald-700/50 text-emerald-300" :
                            c.tier === "weak" ? "border-red-700/50 text-red-300" :
                            "border-slate-700/50 text-slate-300"
                          )}
                          title={`n=${c.tracked} conf=${c.confidence.toFixed(2)}`}
                        >
                          <span className="font-medium">{c.bucket}</span>
                          <span>{c.hitRate != null ? `${Math.round(c.hitRate * 100)}%` : "—"}</span>
                          <span className="text-slate-500">{formatPct(c.avgMove)}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {cardsLoading && (
                  <div className="flex items-center justify-center py-8" style={{ color: cssVariables.textSmall }}>Loading...</div>
                )}
                {!cardsLoading && sortedCards.length === 0 && (
                  <div className="flex items-center justify-center py-8" style={{ color: cssVariables.textSmall }}>No cards match filters</div>
                )}
                {sortedCards.map((card) => (
                  <WorkbenchCardItem key={card.id} card={card} fo={fo} cssVariables={cssVariables} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── AI Lab Section ──────────────────────────────────────────────── */}
      <div
        className="shrink-0 border-t"
        style={{ borderColor: cssVariables.borderOnSecondary }}
      >
        <button
          type="button"
          onClick={() => setAiLabExpanded(e => !e)}
          className="flex items-center gap-2 w-full px-4 py-2 text-left hover:bg-slate-800/30 transition-colors"
        >
          <Sparkles className="h-4 w-4 text-purple-400" />
          <span className="text-sm font-bold uppercase tracking-wide" style={{ color: "rgb(125,211,252)" }}>
            AI Lab
          </span>
          <ChevronDown className={cn("h-4 w-4 transition-transform", !aiLabExpanded && "-rotate-90")} style={{ color: cssVariables.textSmall }} />
          {aiLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-purple-400 ml-auto" />}
        </button>

        {aiLabExpanded && (
          <div className="px-4 pb-3 space-y-2.5">
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 text-purple-400 hover:text-purple-300 hover:bg-purple-900/20 border border-purple-700/30"
                onClick={handleAiAnalyze}
                disabled={aiLoading || stats.length === 0}
                style={{ fontSize: scannerPx("small", fo) }}
              >
                {aiLoading && aiMode === "analyzing" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                Analyze Performance
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "h-7 gap-1.5 border border-slate-700/40",
                  showQuestionInput ? "text-cyan-400 bg-cyan-950/20 border-cyan-700/30" : "text-slate-400 hover:text-slate-200"
                )}
                onClick={() => setShowQuestionInput(q => !q)}
                style={{ fontSize: scannerPx("small", fo) }}
              >
                <Send className="h-3 w-3" />
                Ask a Question
              </Button>
              {stats.length === 0 && (
                <span className="text-[11px] text-slate-500">Load signal data first</span>
              )}
            </div>

            {showQuestionInput && (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={userQuestion}
                  onChange={e => setUserQuestion(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !aiLoading) handleAiQuestion(); }}
                  placeholder="e.g., Which signals have the best follow-through? Are LOD bounces worth trading?"
                  className="flex-1 h-8 rounded border border-slate-700/60 bg-slate-900/80 px-3 text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-purple-700/50"
                  style={{ fontSize: scannerPx("small", fo) }}
                  disabled={aiLoading}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-3 text-purple-400 hover:text-purple-300 hover:bg-purple-900/20 border border-purple-700/30"
                  onClick={handleAiQuestion}
                  disabled={aiLoading || !userQuestion.trim()}
                >
                  {aiLoading && aiMode === "asking" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                </Button>
              </div>
            )}

            {(aiLoading || aiResponse) && (
              <div
                className="rounded border p-3 max-h-[300px] overflow-y-auto"
                style={{
                  borderColor: aiResponse?.startsWith("Error:") ? "rgba(239,68,68,0.3)" : "rgba(168,85,247,0.3)",
                  backgroundColor: aiResponse?.startsWith("Error:") ? "rgba(239,68,68,0.05)" : "rgba(168,85,247,0.05)",
                }}
              >
                {aiLoading && !aiResponse && (
                  <div className="flex items-center gap-2 py-2">
                    <Loader2 className="h-4 w-4 animate-spin text-purple-400" />
                    <span style={{ color: cssVariables.textSmall, fontSize: scannerPx("small", fo) }}>
                      {aiMode === "analyzing" ? "Analyzing signal performance..." : "Thinking..."}
                    </span>
                  </div>
                )}
                {aiResponse && (
                  <pre
                    className="whitespace-pre-wrap font-sans leading-relaxed"
                    style={{
                      color: aiResponse.startsWith("Error:") ? "rgb(248,113,113)" : cssVariables.primaryText,
                      fontSize: scannerPx("small", fo),
                    }}
                  >
                    {aiResponse}
                  </pre>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Individual card component ────────────────────────────────────────────────

function WorkbenchCardItem({ card, fo, cssVariables }: { card: WorkbenchCard; fo: number; cssVariables: any }) {
  const [expanded, setExpanded] = useState(false);

  const checkpoints: { label: string; move: number | null }[] = [
    { label: "15m", move: card.move15m },
    { label: "30m", move: card.move30m },
    { label: "1hr", move: card.move1hr },
    { label: "4hr", move: card.move4hr },
    { label: "D1C", move: card.moveD1Close },
    { label: "D2O", move: card.moveD2Open },
    { label: "D2C", move: card.moveD2Close },
    { label: "1W", move: card.move1w },
    { label: "1Mo", move: card.move1mo },
  ];

  const direction = card.direction as "up" | "down" | "neutral";

  return (
    <div className="rounded-lg border overflow-hidden" style={{ borderColor: "rgba(100,116,139,0.2)" }}>
      {/* Header row: direction + status + behavior summary */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-900/50">
        {/* Direction tag */}
        <DirectionBadge direction={direction} />
        {/* Status badge */}
        <StatusBadge status={card.outcomeStatus} worstDrawdown={card.worstDrawdown} />
        {/* Behavior summary */}
        <div className="flex-1 text-[10px] tabular-nums font-mono" style={{ color: cssVariables.textSmall }}>
          {card.peakMove != null && (
            <span className="text-cyan-400">Peak: +{card.peakMove.toFixed(1)}%</span>
          )}
          {card.peakAt && (
            <span className="ml-1 text-slate-500">
              at {new Date(card.peakAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
            </span>
          )}
          {card.givebackPct != null && card.givebackPct > 0 && (
            <span className="ml-2 text-amber-400">Give: {card.givebackPct.toFixed(1)}%</span>
          )}
          {card.worstDrawdown != null && card.worstDrawdown < 0 && (
            <span className="ml-2 text-red-400">DD: {card.worstDrawdown.toFixed(1)}%</span>
          )}
        </div>
        {/* Entry price */}
        {card.priceAtSignal != null && (
          <span className="text-[10px] tabular-nums" style={{ color: cssVariables.textTiny }}>
            Entry: ${card.priceAtSignal.toFixed(2)}
          </span>
        )}
      </div>

      {/* 9 Checkpoint badges */}
      <div className="flex items-center gap-1 px-3 py-1.5 flex-wrap">
        {checkpoints.map((cp) => (
          <CheckpointBadge key={cp.label} label={cp.label} move={cp.move} direction={direction} />
        ))}
      </div>

      {/* Collapsible discovery card */}
      <div
        className="px-3 py-1 cursor-pointer text-[10px] font-medium text-slate-400 hover:text-slate-200"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? "▾ Hide signal details" : "▸ " + card.headline}
      </div>
      {expanded && (
        <div className="px-1 pb-1">
          <DiscoveryCard
            card={card}
            fontSize={scannerPx("card", fo)}
            headlineFontSize={scannerPx("headline", fo)}
            globalExpanded={false}
          />
        </div>
      )}
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function DirectionBadge({ direction }: { direction: "up" | "down" | "neutral" }) {
  if (direction === "up") {
    return (
      <span className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold bg-emerald-900/40 text-emerald-400">
        <TrendingUp className="h-2.5 w-2.5" /> LONG
      </span>
    );
  }
  if (direction === "down") {
    return (
      <span className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold bg-red-900/40 text-red-400">
        <TrendingDown className="h-2.5 w-2.5" /> SHORT
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold bg-slate-700/40 text-slate-400">
      <Minus className="h-2.5 w-2.5" /> NEUTRAL
    </span>
  );
}

function StatusBadge({ status, worstDrawdown }: { status: string | null; worstDrawdown: number | null }) {
  switch (status) {
    case "profitable":
      return <span className="rounded px-1.5 py-0.5 text-[10px] font-bold bg-emerald-900/30 text-emerald-400">PROFITABLE</span>;
    case "reversed":
      return <span className="rounded px-1.5 py-0.5 text-[10px] font-bold bg-amber-900/30 text-amber-400">REVERSED</span>;
    case "failed":
      return (
        <span className="rounded px-1.5 py-0.5 text-[10px] font-bold bg-red-900/30 text-red-400">
          FAILED {worstDrawdown != null ? `(${worstDrawdown.toFixed(1)}%)` : ""}
        </span>
      );
    case "flat":
      return <span className="rounded px-1.5 py-0.5 text-[10px] font-bold bg-slate-700/40 text-slate-400">FLAT</span>;
    case "tracking":
      return (
        <span className="rounded px-1.5 py-0.5 text-[10px] font-bold bg-cyan-900/30 text-cyan-400 animate-pulse">
          <Activity className="inline h-2.5 w-2.5 mr-0.5" />TRACKING
        </span>
      );
    default:
      return <span className="rounded px-1.5 py-0.5 text-[10px] font-bold bg-slate-700/40 text-slate-500">—</span>;
  }
}

function CheckpointBadge({ label, move, direction }: { label: string; move: number | null; direction: "up" | "down" | "neutral" }) {
  if (move == null) {
    return (
      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-medium bg-slate-800/50 text-slate-500 tabular-nums">
        {label}: —
      </span>
    );
  }

  let isFavorable = false;
  if (direction === "up") isFavorable = move >= 0;
  else if (direction === "down") isFavorable = move <= 0;
  else isFavorable = move >= 0;

  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold tabular-nums",
        isFavorable ? "bg-emerald-900/30 text-emerald-400" : "bg-red-900/30 text-red-400"
      )}
    >
      {label}: {move >= 0 ? "+" : ""}{move.toFixed(1)}%
    </span>
  );
}

// ── Export ────────────────────────────────────────────────────────────────────

export default function SignalWorkbenchPage() {
  return (
    <WorkbenchErrorBoundary>
      <SignalWorkbenchInner />
    </WorkbenchErrorBoundary>
  );
}
