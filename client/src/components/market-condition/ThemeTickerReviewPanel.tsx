import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FloatingOverlayPanel, laptopOverlayDefault } from "@/components/FloatingOverlayPanel";
import { TickerReviewRow } from "@/components/market-condition/TickerReviewRow";
import {
  OPTIONAL_CRITERIA,
  REQUIRED_CRITERIA,
  SCAN_MODE_LABELS,
  TICKER_REVIEW_PRESETS,
  defaultEnabledOptional,
  defaultEnabledRequired,
  type OptionalCriterionId,
  type RequiredCriterionId,
  type TickerReviewPresetId,
  type TickerReviewScanMode,
} from "@/components/market-condition/ticker-review-criteria";
import type { TickerRow } from "@/data/mockThemeData";
import { useTickerReviewScan } from "@/hooks/useTickerReview";
import type { TickerReviewResultRow } from "@/lib/ticker-review-engine";
import { cn } from "@/lib/utils";
import { TickerReviewChartViewer } from "@/components/market-condition/TickerReviewChartViewer";
import { ChevronDown, Loader2, Play, Sparkles, BarChart3, Star } from "lucide-react";
import { MiniMaSettingsDialog } from "@/components/MiniMaSettingsDialog";
import {
  MiniChartControlBar,
  normalizeMiniChartControlInterval,
  type MiniChartControlInterval,
} from "@/components/MiniChartControlBar";
import {
  readPersistedThemeChartsInterval,
  writePersistedThemeChartsInterval,
} from "@/lib/live-theme-charts";
import { useThemeDailyWatchlist } from "@/hooks/useThemeDailyWatchlist";
import { useToast } from "@/hooks/use-toast";
import type { MarketSessionKind } from "@shared/theme-daily-watchlist";
import { useAdminTheme } from "@/context/SystemSettingsContext";
import { useThemeEditorOptional } from "@/context/ThemeEditorContext";
import { ThemeColorChip } from "@/components/theme/ThemeColorChip";

const STORAGE_KEY = "theme-ticker-review-floating-v2";
const MAX_CHART_ROWS = 10;

const RAI_CHIP: Record<
  NonNullable<ThemeTickerReviewPanelProps["raiLabel"]>,
  { label: string; className: string }
> = {
  AGGRESSIVE: { label: "Risk-on", className: "text-green-300 border-green-500/40" },
  NEUTRAL: { label: "Neutral", className: "text-slate-300 border-slate-500/40" },
  DEFENSIVE: { label: "Risk-off", className: "text-amber-300 border-amber-500/40" },
};

interface ThemeTickerReviewPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  themeId: string | null;
  themeName: string | null;
  scopeLabel: string;
  memberScope?: "leaders" | "theme" | "subtheme";
  tickers: TickerRow[];
  themeMedianPct?: number;
  themeRank?: number;
  themeName?: string | null;
  totalThemes?: number | null;
  themeBreakdownWatch?: import("@shared/theme-breakdown-watch").BreakdownWatchAssessment | null;
  raiLabel?: "AGGRESSIVE" | "NEUTRAL" | "DEFENSIVE";
  onOpenAnalysis?: (symbol: string) => void;
  /** Theme member list onclick modes — Review on chart respects these (same as ticker row clicks). */
  chartSyncEnabled?: boolean;
  msSyncEnabled?: boolean;
  analysisSyncEnabled?: boolean;
  onSyncToChart?: (symbol: string, options?: { symOrder?: string[] }) => void;
  onSyncToMarketSurge?: (symbol: string) => void;
  marketSession?: MarketSessionKind;
}

function CriteriaBadge({
  label,
  description,
  active,
  locked,
  onToggle,
  variant,
}: {
  label: string;
  description: string;
  active: boolean;
  locked?: boolean;
  onToggle: () => void;
  variant: "required" | "optional";
}) {
  return (
    <button
      type="button"
      disabled={locked}
      title={description}
      onClick={onToggle}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
        locked && "cursor-default opacity-80",
        active
          ? variant === "required"
            ? "border-slate-500 bg-slate-600/50 text-slate-100"
            : "border-green-500/50 bg-green-500/15 text-green-200"
          : "border-slate-600/60 bg-transparent text-muted-foreground line-through opacity-50 hover:opacity-70"
      )}
    >
      {label}
    </button>
  );
}

export function ThemeTickerReviewPanel({
  open,
  onOpenChange,
  themeId,
  themeName,
  scopeLabel,
  memberScope = "theme",
  tickers,
  themeMedianPct = 0,
  themeRank,
  themeName: themeNameProp,
  totalThemes,
  themeBreakdownWatch,
  raiLabel,
  onOpenAnalysis,
  chartSyncEnabled = false,
  msSyncEnabled = false,
  analysisSyncEnabled = false,
  onSyncToChart,
  onSyncToMarketSurge,
  marketSession,
}: ThemeTickerReviewPanelProps) {
  const [scanMode, setScanMode] = useState<TickerReviewScanMode>("auto");
  const [enabledRequired, setEnabledRequired] = useState(defaultEnabledRequired);
  const [enabledOptional, setEnabledOptional] = useState(defaultEnabledOptional);
  const [results, setResults] = useState<TickerReviewResultRow[] | null>(null);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [effectiveMode, setEffectiveMode] = useState<string>("");
  const [patternEnriched, setPatternEnriched] = useState(false);
  const [scanWarnings, setScanWarnings] = useState<string[]>([]);
  const [hvcEnriched, setHvcEnriched] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [hasRun, setHasRun] = useState(false);
  const [chartInterval, setChartInterval] = useState<MiniChartControlInterval>(() => {
    const persisted = readPersistedThemeChartsInterval();
    return persisted ? normalizeMiniChartControlInterval(persisted) : "1d";
  });
  const [miniMaSettingsOpen, setMiniMaSettingsOpen] = useState(false);
  const [chartViewerOpen, setChartViewerOpen] = useState(false);
  const [chartViewerIndex, setChartViewerIndex] = useState(0);
  const [setupInfoExpanded, setSetupInfoExpanded] = useState(false);
  const [starredSymbols, setStarredSymbols] = useState<Set<string>>(new Set());
  const { toast } = useToast();
  const { secondaryBg, headerBg, borderOnSecondary } = useAdminTheme();
  const themeEditor = useThemeEditorOptional();
  const overlaySurfaceBg = themeEditor?.getSlotColor("marketFlow:overlayBg") ?? secondaryBg;
  const overlayTitleBarBg = themeEditor?.getSlotColor("marketFlow:overlayHeader") ?? headerBg;

  const { starredSymbolsFromWatchlist, syncStar, dailyListName } = useThemeDailyWatchlist(
    themeName,
    marketSession
  );

  const reviewScopeKey = useMemo(
    () =>
      `${themeId ?? ""}:${memberScope}:${[...tickers].map((t) => t.symbol.toUpperCase()).sort().join(",")}`,
    [themeId, memberScope, tickers]
  );
  const reviewScopeKeyRef = useRef(reviewScopeKey);
  useEffect(() => {
    reviewScopeKeyRef.current = reviewScopeKey;
  }, [reviewScopeKey]);

  useEffect(() => {
    setResults(null);
    setHasRun(false);
    setScanError(null);
    setHiddenCount(0);
    setEffectiveMode("");
    setPatternEnriched(false);
    setHvcEnriched(false);
    setScanWarnings([]);
    setChartViewerIndex(0);
  }, [reviewScopeKey]);

  // Only seed starred set when the review scope changes (different theme/member set).
  // Local optimistic state is authoritative during the session — don't overwrite on
  // every watchlist refetch or rapid-fire stars get clobbered by stale API responses.
  useEffect(() => {
    setStarredSymbols(new Set(starredSymbolsFromWatchlist));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewScopeKey]);

  const onChartIntervalChange = useCallback((interval: MiniChartControlInterval) => {
    setChartInterval(interval);
    writePersistedThemeChartsInterval(interval);
  }, []);

  const scanMutation = useTickerReviewScan();

  const optionalLabel = useMemo(
    () => Object.fromEntries(OPTIONAL_CRITERIA.map((c) => [c.id, c.shortLabel])),
    []
  );

  const starredQueueSymbols = useMemo(
    () =>
      (results ?? [])
        .filter((r) => starredSymbols.has(r.symbol.toUpperCase()))
        .map((r) => r.symbol.toUpperCase()),
    [results, starredSymbols]
  );

  const rowBySymbol = useMemo(() => {
    const map = new Map<string, TickerReviewResultRow>();
    for (const row of results ?? []) {
      map.set(row.symbol.toUpperCase(), row);
    }
    return map;
  }, [results]);

  const chartSymbolTags = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const row of results ?? []) {
      const sym = row.symbol.toUpperCase();
      out[sym] = row.firedOptional.map((id) => optionalLabel[id] ?? id);
    }
    return out;
  }, [results, optionalLabel]);

  const toggleStar = useCallback(
    async (row: TickerReviewResultRow) => {
      const sym = row.symbol.toUpperCase();
      const nextStarred = !starredSymbols.has(sym);
      setStarredSymbols((prev) => {
        const next = new Set(prev);
        if (nextStarred) next.add(sym);
        else next.delete(sym);
        return next;
      });
      try {
        await syncStar(row, nextStarred);
      } catch {
        setStarredSymbols((prev) => {
          const next = new Set(prev);
          if (nextStarred) next.delete(sym);
          else next.add(sym);
          return next;
        });
        toast({ title: "Watchlist sync failed", variant: "destructive" });
      }
    },
    [starredSymbols, syncStar, toast]
  );

  const starAll = useCallback(() => {
    if (!results?.length) return;
    void Promise.all(
      results.map(async (row) => {
        const sym = row.symbol.toUpperCase();
        if (!starredSymbols.has(sym)) {
          setStarredSymbols((prev) => new Set(prev).add(sym));
          await syncStar(row, true);
        }
      })
    );
  }, [results, starredSymbols, syncStar]);

  const clearStars = useCallback(() => {
    if (!results?.length) {
      setStarredSymbols(new Set());
      return;
    }
    void Promise.all(
      results
        .filter((row) => starredSymbols.has(row.symbol.toUpperCase()))
        .map(async (row) => {
          const sym = row.symbol.toUpperCase();
          setStarredSymbols((prev) => {
            const next = new Set(prev);
            next.delete(sym);
            return next;
          });
          await syncStar(row, false);
        })
    );
  }, [results, starredSymbols, syncStar]);

  const openSavedCharts = useCallback(
    (symbol?: string) => {
      if (!starredQueueSymbols.length || !results?.length) return;

      const symUp = (symbol ?? starredQueueSymbols[0]).toUpperCase();
      const idx = starredQueueSymbols.findIndex((s) => s === symUp);

      const opensInlineViewer =
        !chartSyncEnabled && !msSyncEnabled && !analysisSyncEnabled;

      if (opensInlineViewer) {
        setChartViewerIndex(idx >= 0 ? idx : 0);
        setChartViewerOpen(true);
      }

      if (analysisSyncEnabled && onOpenAnalysis) {
        onOpenAnalysis(symUp);
      }
      if (msSyncEnabled && onSyncToMarketSurge) {
        onSyncToMarketSurge(symUp);
      }
      if (chartSyncEnabled && onSyncToChart) {
        onSyncToChart(symUp, { symOrder: starredQueueSymbols });
      }
    },
    [
      starredQueueSymbols,
      results,
      analysisSyncEnabled,
      msSyncEnabled,
      chartSyncEnabled,
      onOpenAnalysis,
      onSyncToMarketSurge,
      onSyncToChart,
    ]
  );

  const toggleRequired = useCallback((id: RequiredCriterionId) => {
    setEnabledRequired((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setHasRun(false);
  }, []);

  const toggleOptional = useCallback((id: OptionalCriterionId) => {
    setEnabledOptional((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setHasRun(false);
  }, []);

  const applyPreset = useCallback((presetId: TickerReviewPresetId) => {
    const preset = TICKER_REVIEW_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setScanMode(preset.mode);
    setEnabledRequired(new Set(preset.required));
    setEnabledOptional(new Set(preset.optional));
    setHasRun(false);
  }, []);

  const runScan = useCallback(async () => {
    if (!tickers.length) return;
    const scopeAtStart = reviewScopeKeyRef.current;
    setScanError(null);
    try {
      const out = await scanMutation.mutateAsync({
        themeId,
        tickers,
        themeMedianPct,
        mode: scanMode,
        enabledRequired,
        enabledOptional,
        raiLabel,
        themeRank,
        scope: memberScope,
        maxResults: MAX_CHART_ROWS,
      });
      if (scopeAtStart !== reviewScopeKeyRef.current) return;
      setResults(out.results);
      setStarredSymbols((prev) => {
        const next = new Set<string>();
        for (const row of out.results) {
          const sym = row.symbol.toUpperCase();
          if (prev.has(sym)) next.add(sym);
        }
        return next;
      });
      setHiddenCount(out.hiddenCount);
      const modeKey = out.effectiveMode as TickerReviewScanMode;
      setEffectiveMode(SCAN_MODE_LABELS[modeKey] ?? out.effectiveMode);
      setHvcEnriched(Boolean(out.hvcEnriched));
      setPatternEnriched(Boolean(out.patternEnriched));
      setScanWarnings(out.warnings ?? []);
      setScanError(out.scanError ?? null);
      setHasRun(true);
    } catch (err) {
      if (scopeAtStart !== reviewScopeKeyRef.current) return;
      setResults([]);
      setHiddenCount(tickers.length);
      setScanError(err instanceof Error ? err.message : "Scan failed");
      setHasRun(true);
    }
  }, [
    tickers,
    themeMedianPct,
    scanMode,
    enabledRequired,
    enabledOptional,
    raiLabel,
    themeRank,
    themeId,
    memberScope,
    scanMutation,
  ]);

  const optionalEnabledCount = enabledOptional.size;
  const scanning = scanMutation.isPending;

  const raiChip = raiLabel ? RAI_CHIP[raiLabel] : null;

  const HEADER_TEXT = "text-sm font-medium leading-none";

  const titleBar = (
    <div className="flex items-center gap-2 min-w-0 flex-wrap flex-1">
      <Sparkles className="h-4 w-4 shrink-0 text-green-400" />
      <span className={cn(HEADER_TEXT, "shrink-0 text-foreground")}>Ticker Review</span>
      {themeName ? (
        <>
          <span className={cn(HEADER_TEXT, "text-muted-foreground shrink-0")}>|</span>
          <span className={cn(HEADER_TEXT, "truncate text-foreground")}>
            ThemeChart-{themeName}
          </span>
        </>
      ) : null}
      <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
        <Badge variant="outline" className="h-6 px-2 text-sm font-medium shrink-0">
          {scopeLabel}
        </Badge>
        {raiChip && (
          <Badge variant="outline" className={cn("h-6 px-2 text-sm font-medium shrink-0", raiChip.className)}>
            {raiChip.label}
          </Badge>
        )}
        {hasRun && effectiveMode && (
          <Badge variant="outline" className="h-6 px-2 text-sm font-medium text-cyan-300 border-cyan-500/40 shrink-0">
            {effectiveMode}
          </Badge>
        )}
      </div>
    </div>
  );

  const emptyMessage = useMemo(() => {
    if (!themeId) return "Select a theme first.";
    if (!tickers.length) return "No tickers in this scope.";
    if (!hasRun) return "Configure badges and run scan.";
    if (results?.length === 0) {
      if (scanError) return `Scan error: ${scanError}`;
      return "No names met watch criteria — try Full tape preset or disable Not extended.";
    }
    return null;
  }, [themeId, tickers.length, hasRun, results?.length, scanError]);

  return (
    <FloatingOverlayPanel
      open={open}
      onOpenChange={onOpenChange}
      storageKey={STORAGE_KEY}
      defaultState={laptopOverlayDefault()}
      titleBar={titleBar}
      className="flex flex-col"
      surfaceBg={overlaySurfaceBg}
      borderColor={borderOnSecondary}
      titleBarBg={overlayTitleBarBg}
      surfaceSlotId="marketFlow:overlayBg"
      titleBarSlotId="marketFlow:overlayHeader"
    >
      <div className="flex flex-col gap-4 min-h-0 flex-1 overflow-hidden -m-1 p-1">
        <div
          className="shrink-0 space-y-3 rounded-xl border border-slate-700/40 p-4"
          style={{ borderColor: borderOnSecondary }}
        >
          <div className="flex flex-wrap items-center gap-2.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 text-sm gap-1.5">
                  Preset
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {TICKER_REVIEW_PRESETS.map((p) => (
                  <DropdownMenuItem key={p.id} onClick={() => applyPreset(p.id)}>
                    {p.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Select value={scanMode} onValueChange={(v) => setScanMode(v as TickerReviewScanMode)}>
              <SelectTrigger className="h-9 w-[200px] text-sm">
                <SelectValue placeholder="Scan mode" />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SCAN_MODE_LABELS) as TickerReviewScanMode[]).map((m) => (
                  <SelectItem key={m} value={m} className="text-sm">
                    {SCAN_MODE_LABELS[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              size="sm"
              className="h-9 gap-2 bg-green-600 hover:bg-green-700 text-white ml-auto text-sm px-4"
              disabled={!tickers.length || scanning || optionalEnabledCount === 0}
              onClick={() => void runScan()}
              data-testid="button-run-ticker-review"
            >
              {scanning ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              Run scan
            </Button>
          </div>

          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2 font-medium">
              Required — all enabled must pass
            </p>
            <div className="flex flex-wrap gap-2">
              {REQUIRED_CRITERIA.map((c) => (
                <CriteriaBadge
                  key={c.id}
                  label={c.shortLabel}
                  description={c.description}
                  active={enabledRequired.has(c.id as RequiredCriterionId)}
                  locked={c.locked}
                  onToggle={() => toggleRequired(c.id as RequiredCriterionId)}
                  variant="required"
                />
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2 font-medium">
              Optional — at least one enabled must match ({optionalEnabledCount} on)
            </p>
            <div className="flex flex-wrap gap-2">
              {OPTIONAL_CRITERIA.map((c) => (
                <CriteriaBadge
                  key={c.id}
                  label={c.shortLabel}
                  description={c.description}
                  active={enabledOptional.has(c.id as OptionalCriterionId)}
                  onToggle={() => toggleOptional(c.id as OptionalCriterionId)}
                  variant="optional"
                />
              ))}
            </div>
          </div>

          <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>
              Universe: {tickers.length} tickers · top {MAX_CHART_ROWS} with charts · 2-column watch list
              {hasRun && patternEnriched ? " · bar-backed setup detection" : ""}
            </span>
            <span className="inline-flex items-center gap-1 rounded border border-slate-600/40 bg-slate-900/40 px-1.5 py-0.5">
              <span className="text-[10px] uppercase tracking-wide text-slate-500">Result card</span>
              <ThemeColorChip slotId="marketFlow:overlayResultCard" />
            </span>
            <span className="text-[10px] text-slate-500">
              Result cards use Admin → Secondary BG until you save a local override on Result card.
            </span>
            <span className="inline-flex items-center gap-1 rounded border border-slate-600/40 bg-slate-900/40 px-1.5 py-0.5">
              <span className="text-[10px] uppercase tracking-wide text-slate-500">Chart frame</span>
              <ThemeColorChip slotId="marketFlow:overlayChartChrome" />
            </span>
          </p>
          {hasRun && scanWarnings.length > 0 && (
            <p className="text-[11px] text-cyan-400/80 leading-relaxed">{scanWarnings.join(" · ")}</p>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden pr-1">
          {emptyMessage && (
            <p className="text-base text-muted-foreground text-center py-16">{emptyMessage}</p>
          )}
          {hasRun && results && results.length > 0 && (
            <>
              <div
                className="sticky top-0 backdrop-blur-sm py-2 z-10 mb-3 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-2"
                style={{ borderColor: borderOnSecondary }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm text-muted-foreground">
                    {results.length} watch · {hiddenCount} hidden
                    {starredSymbols.size > 0 ? ` · ${starredSymbols.size} starred` : ""}
                  </p>
                  {dailyListName && (
                    <span className="text-[11px] text-muted-foreground hidden sm:inline" title="Dated watchlist">
                      → {dailyListName}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button size="sm" variant="ghost" className="h-8 text-xs gap-1" onClick={starAll}>
                    <Star className="h-3.5 w-3.5" />
                    Star all
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-xs"
                    onClick={clearStars}
                    disabled={starredSymbols.size === 0}
                  >
                    Clear stars
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1.5 text-xs"
                    disabled={starredSymbols.size === 0}
                    onClick={() => openSavedCharts()}
                    data-testid="button-ticker-review-view-saved-charts"
                  >
                    <BarChart3 className="h-4 w-4" />
                    View Saved Charts
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 pb-2 auto-rows-fr max-[820px]:grid-cols-1">
                {results.map((row, index) => (
                  <TickerReviewRow
                    key={`${reviewScopeKey}-${row.symbol}`}
                    row={row}
                    compact
                    showChart={index < MAX_CHART_ROWS}
                    chartInterval={chartInterval}
                    onChartIntervalChange={onChartIntervalChange}
                    onOpenMaSettings={() => setMiniMaSettingsOpen(true)}
                    starred={starredSymbols.has(row.symbol.toUpperCase())}
                    onToggleStar={() => void toggleStar(row)}
                    onOpenChart={(symbol) => openSavedCharts(symbol)}
                    onOpenAnalysis={onOpenAnalysis}
                    infoExpanded={setupInfoExpanded}
                    onInfoExpandedChange={setSetupInfoExpanded}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      <MiniMaSettingsDialog open={miniMaSettingsOpen} onOpenChange={setMiniMaSettingsOpen} />
      <TickerReviewChartViewer
        open={chartViewerOpen}
        symbols={starredQueueSymbols}
        startIndex={chartViewerIndex}
        symbolTags={chartSymbolTags}
        themeId={themeId}
        themeRank={themeRank}
        themeName={themeNameProp}
        totalThemes={totalThemes}
        themeBreakdownWatch={themeBreakdownWatch}
        rowBySymbol={rowBySymbol}
        onClose={() => setChartViewerOpen(false)}
      />
    </FloatingOverlayPanel>
  );
}
