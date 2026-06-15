import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useChartSetupEnrich } from "@/hooks/useChartSetupEnrich";
import { buildChartSetupDossier } from "@/lib/chart-setup-dossier";
import type { ChartDataResponse, ChartMetrics } from "@/components/DualChartGrid";
import { CHART_FOOTER_FONT_DEFAULTS } from "@/lib/chart-footer-font-prefs";
import type { ChartSetupBaseMeta } from "@shared/chart-setup-base-meta";
import type { ChartSetupUrMeta } from "@shared/chart-setup-ur-meta";
import {
  CHART_SETUP_POSTURE_LABELS,
  type ChartSetupStructureMeta,
} from "@shared/chart-setup-structure-meta";
import type { BreakdownWatchAssessment } from "@shared/theme-breakdown-watch";
import type { TickerReviewResultRow } from "@/lib/ticker-review-engine";
import type { OptionalCriterionId } from "@/components/market-condition/ticker-review-criteria";
import { OPTIONAL_CRITERIA } from "@/components/market-condition/ticker-review-criteria";
import { SaveEnrichModelDialog } from "@/components/charts/SaveEnrichModelDialog";
import { EnrichStatusOverlay } from "@/components/charts/EnrichStatusOverlay";
import {
  CHART_ENRICH_CORRECTION_KINDS,
  CHART_ENRICH_LIFECYCLE_DISPLAY,
  CHART_ENRICH_LIFECYCLE_STAGES,
  CHART_ENRICH_PATTERN_DISPLAY,
  CHART_ENRICH_PATTERN_LABELS,
  formatEnrichConfidencePct,
  type ChartEnrichCorrectionKind,
  type ChartEnrichLifecycleStage,
  type ChartEnrichModelScope,
  type ChartEnrichPatternLabel,
  type ChartSetupEnrichResult,
} from "@shared/chart-setup-enrich";
import { cn } from "@/lib/utils";
import { EnrichHighlightedText } from "@/lib/enrich-text-highlight";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  RefreshCw,
  Sparkles,
  Star,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";

const OPTIONAL_LABEL = Object.fromEntries(
  OPTIONAL_CRITERIA.map((c) => [c.id, c.shortLabel])
) as Record<OptionalCriterionId, string>;

const CORRECTION_LABELS: Record<ChartEnrichCorrectionKind, string> = {
  wrong_timing: "Wrong timing",
  wrong_pattern: "Wrong pattern",
  too_generic: "Too generic",
  other: "Other",
};

export interface SetupInfoPanelProps {
  symbol: string;
  scanRow?: TickerReviewResultRow | null;
  dailyData?: ChartDataResponse;
  intradayData?: ChartDataResponse;
  chartMetrics?: ChartMetrics | null;
  intradayTimeframe: string;
  themeId?: string | null;
  themeRank?: number | null;
  chartsReady?: boolean;
  testIdPrefix?: string;
  contentFontPx?: number;
  fontSizeControl?: ReactNode;
  themeBreakdownWatch?: BreakdownWatchAssessment | null;
}

function EnrichBaseMetaBlock({ meta }: { meta: ChartSetupBaseMeta }) {
  if (!meta.detected || meta.summaryLines.length === 0) return null;

  return (
    <div
      className={cn(
        "rounded border p-2 space-y-1.5",
        meta.powerSetup
          ? "border-cyan-500/40 bg-cyan-950/20"
          : "border-green-500/30 bg-green-950/15"
      )}
    >
      <span
        className={cn(
          "text-[0.72em] font-semibold uppercase tracking-wide block",
          meta.powerSetup ? "text-cyan-300/95" : "text-green-400/90"
        )}
      >
        {meta.powerSetup ? "Power setup — base + 200d reclaim" : "Base structure"}
      </span>
      <ul className="text-[0.875em] text-green-200/95 space-y-0.5 list-disc pl-4">
        {meta.summaryLines.map((line) => (
          <li
            key={line}
            className={line.startsWith("Power setup:") ? "text-cyan-100/95" : undefined}
          >
            <EnrichHighlightedText text={line} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function EnrichUrMetaBlock({ meta }: { meta: ChartSetupUrMeta }) {
  if (!meta.detected || meta.summaryLines.length === 0) return null;

  return (
    <div
      className={cn(
        "rounded border p-2 space-y-1.5",
        meta.buyableNow
          ? "border-emerald-500/45 bg-emerald-950/25"
          : "border-amber-500/35 bg-amber-950/15"
      )}
    >
      <span
        className={cn(
          "text-[0.72em] font-semibold uppercase tracking-wide block",
          meta.buyableNow ? "text-emerald-300/95" : "text-amber-300/90"
        )}
      >
        {meta.buyableNow ? "U&R — buyable now" : "U&R pattern"}
      </span>
      <ul className="text-[0.875em] text-slate-200 space-y-0.5 list-disc pl-4">
        {meta.summaryLines.map((line) => (
          <li key={line}>
            <EnrichHighlightedText text={line} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function EnrichStructureMetaBlock({ meta }: { meta: ChartSetupStructureMeta }) {
  const hasContent =
    meta.longSetupNegatives.length > 0 ||
    meta.shortSetupIdeas.length > 0 ||
    meta.postureHint !== "unclear";
  if (!hasContent) return null;

  return (
    <div className="rounded border border-slate-700/50 bg-slate-900/35 p-2 space-y-1.5">
      <span className="text-[0.72em] uppercase tracking-wide text-muted-foreground block">
        Structure meta
      </span>
      {meta.postureHint !== "unclear" && (
        <p className="text-[0.875em] text-slate-300 leading-snug">
          <EnrichHighlightedText text={CHART_SETUP_POSTURE_LABELS[meta.postureHint]} />
        </p>
      )}
      {meta.longSetupNegatives.length > 0 && (
        <ul className="text-[0.875em] text-slate-300 space-y-0.5 list-disc pl-4">
          {meta.longSetupNegatives.map((line) => (
            <li key={line}>
              <EnrichHighlightedText text={line} />
            </li>
          ))}
        </ul>
      )}
      {meta.shortSetupIdeas.length > 0 && (
        <ul className="text-[0.875em] text-amber-300/85 space-y-0.5 list-disc pl-4">
          {meta.shortSetupIdeas.map((line) => (
            <li key={line}>
              <EnrichHighlightedText text={line} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function scanSummaryOneLine(row: TickerReviewResultRow): string {
  const tags = row.firedOptional
    .slice(0, 3)
    .map((id) => OPTIONAL_LABEL[id] ?? id)
    .join(" · ");
  const lead = row.setupNarrative.split(".")[0]?.trim() ?? row.setupNarrative;
  const short = lead.length > 72 ? `${lead.slice(0, 72)}…` : lead;
  return tags ? `${short} (${tags})` : short;
}

export function SetupInfoPanel({
  symbol,
  scanRow,
  dailyData,
  intradayData,
  chartMetrics,
  intradayTimeframe,
  themeId,
  themeRank,
  chartsReady = true,
  testIdPrefix = "",
  contentFontPx = CHART_FOOTER_FONT_DEFAULTS.setup,
  fontSizeControl,
  themeBreakdownWatch,
}: SetupInfoPanelProps) {
  const pid = testIdPrefix ? `${testIdPrefix}-` : "";
  const { toast } = useToast();
  const {
    enriching,
    enrichError,
    enrichErrorMessage,
    enrichStatusLog,
    enrich,
    getCached,
    invalidate,
    submitFeedback,
    saveModel,
  } = useChartSetupEnrich();

  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [scanCollapsed, setScanCollapsed] = useState(true);
  const [includeVisual, setIncludeVisual] = useState(() => {
    try {
      return localStorage.getItem("chart-enrich-include-visual") === "1";
    } catch {
      return false;
    }
  });
  const [enrichEntry, setEnrichEntry] = useState<{
    result: ChartSetupEnrichResult;
    enrichRunId: number | null;
    dossier: ReturnType<typeof buildChartSetupDossier>;
  } | null>(null);
  const [helpful, setHelpful] = useState<"up" | "down" | null>(null);
  const [correctionKind, setCorrectionKind] = useState<ChartEnrichCorrectionKind | null>(null);
  const [showLifecycleFix, setShowLifecycleFix] = useState(false);
  const [showPatternFix, setShowPatternFix] = useState(false);
  const [lastFeedbackId, setLastFeedbackId] = useState<number | null>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const [modelSavedLabel, setModelSavedLabel] = useState<string | null>(null);
  const [modelPrefill, setModelPrefill] = useState<{
    scopes?: ChartEnrichModelScope[];
    lifecycle?: ChartEnrichLifecycleStage | null;
    pattern?: ChartEnrichPatternLabel | null;
  }>({});

  const sym = symbol.toUpperCase();
  const enrichResultRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setHelpful(null);
    setCorrectionKind(null);
    setShowLifecycleFix(false);
    setShowPatternFix(false);
    setLastFeedbackId(null);
    setModelSavedLabel(null);
    const cached = getCached(sym, includeVisual);
    setEnrichEntry(cached);
    setScanCollapsed(!!cached);
  }, [sym, includeVisual, getCached]);

  const persistVisualPref = useCallback((v: boolean) => {
    setIncludeVisual(v);
    try {
      localStorage.setItem("chart-enrich-include-visual", v ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  const runEnrich = useCallback(
    async (force = false) => {
      if (!sym) {
        toast({ title: "No symbol selected", variant: "destructive" });
        return;
      }
      if (!chartsReady) {
        toast({
          title: "Charts still loading",
          description: "Enrich unlocks once daily price history is ready.",
          variant: "destructive",
        });
        return;
      }
      if (force) invalidate(sym);
      const dossier = buildChartSetupDossier({
        symbol: sym,
        intradayTimeframe,
        includeVisual,
        dailyData,
        intradayData,
        chartMetrics,
        scanRow,
        themeId,
        themeRank,
        themeBreakdownWatch,
      });
      try {
        const entry = await enrich(dossier);
        setEnrichEntry(entry);
        setScanCollapsed(true);
        setHelpful(null);
        setCorrectionKind(null);
        toast({ title: "Setup analysis ready" });
        requestAnimationFrame(() => {
          enrichResultRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Enrich failed";
        toast({ title: "Enrich failed", description: msg, variant: "destructive" });
      }
    },
    [
      chartsReady,
      sym,
      invalidate,
      intradayTimeframe,
      includeVisual,
      dailyData,
      intradayData,
      chartMetrics,
      scanRow,
      themeId,
      themeRank,
      themeBreakdownWatch,
      enrich,
      toast,
    ]
  );

  const sendFeedback = useCallback(
    async (opts: {
      helpful: "up" | "down";
      correctionKind?: ChartEnrichCorrectionKind | null;
      correctedLifecycle?: ChartEnrichLifecycleStage | null;
      correctedPattern?: ChartEnrichPatternLabel | null;
    }) => {
      if (!enrichEntry) return;
      try {
        const res = await submitFeedback({
          enrichRunId: enrichEntry.enrichRunId,
          symbol: sym,
          helpful: opts.helpful,
          correctionKind: opts.correctionKind ?? null,
          correctedLifecycle: opts.correctedLifecycle ?? null,
          correctedPattern: opts.correctedPattern ?? null,
          enrichSnapshot: enrichEntry.result,
          dossier: enrichEntry.dossier,
        });
        setLastFeedbackId(res.feedbackId);
        setHelpful(opts.helpful);
        toast({ title: "Feedback saved — helps future similar setups" });
      } catch {
        toast({ title: "Could not save feedback", variant: "destructive" });
      }
    },
    [enrichEntry, submitFeedback, sym, toast]
  );

  const handleThumbsUp = () => void sendFeedback({ helpful: "up" });

  const handleCorrectionChip = (kind: ChartEnrichCorrectionKind) => {
    setCorrectionKind(kind);
    setHelpful("down");
    if (kind === "wrong_timing") setShowLifecycleFix(true);
    if (kind === "wrong_pattern") setShowPatternFix(true);
    if (kind === "too_generic" || kind === "other") {
      void sendFeedback({ helpful: "down", correctionKind: kind });
    }
  };

  const handleLifecycleSave = (stage: ChartEnrichLifecycleStage) => {
    void sendFeedback({
      helpful: "down",
      correctionKind: correctionKind ?? "wrong_timing",
      correctedLifecycle: stage,
    });
    setShowLifecycleFix(false);
    setModelPrefill({ scopes: ["lifecycle"], lifecycle: stage });
  };

  const handlePatternSave = (pattern: ChartEnrichPatternLabel) => {
    void sendFeedback({
      helpful: "down",
      correctionKind: correctionKind ?? "wrong_pattern",
      correctedPattern: pattern,
    });
    setShowPatternFix(false);
    setModelPrefill({ scopes: ["pattern"], pattern });
  };

  const enrichResult = enrichEntry?.result ?? null;
  const hasScan = !!scanRow;

  return (
    <>
      <EnrichStatusOverlay
        open={enriching}
        symbol={sym}
        statusLog={enrichStatusLog}
        active={enriching}
      />
      <div
        className="border border-border rounded p-2.5 overflow-hidden bg-background flex flex-col text-left w-full min-h-0 flex-1"
        data-testid={`${pid}box3-setup-info`}
      >
        <div className="flex w-full items-center gap-2 shrink-0 mb-1.5">
          <button
            type="button"
            onClick={() => setPanelCollapsed((c) => !c)}
            className="flex items-center gap-2 text-left text-muted-foreground hover:text-slate-200 transition-colors min-w-0 flex-1"
            aria-expanded={!panelCollapsed}
          >
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Setup Info
            </span>
            {enrichResult && !enriching ? (
              <Badge
                variant="outline"
                className="h-5 px-1.5 text-[10px] font-medium text-cyan-300 border-cyan-500/40"
              >
                AI
              </Badge>
            ) : null}
            <ChevronDown
              className={cn("ml-auto h-4 w-4 shrink-0 transition-transform", panelCollapsed && "rotate-180")}
            />
          </button>

          <div className="flex items-center gap-1 shrink-0">
            {fontSizeControl}
            {enrichResult && (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                title="Re-analyze"
                onClick={() => void runEnrich(true)}
                disabled={enriching}
              >
                <RefreshCw className={cn("h-3.5 w-3.5", enriching && "animate-spin")} />
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="default"
              className="h-7 text-xs gap-1"
              disabled={enriching}
              title={
                chartsReady
                  ? enrichResult
                    ? "Re-run setup analysis"
                    : "Analyze this chart setup"
                  : "Waiting for daily chart data…"
              }
              onClick={() => void runEnrich(!!enrichResult)}
              data-testid={`${pid}button-enrich`}
            >
              {enriching ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              Enrich
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" size="icon" variant="outline" className="h-7 w-7" title="Enrich options">
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuCheckboxItem
                  checked={includeVisual}
                  onCheckedChange={(c) => persistVisualPref(!!c)}
                >
                  Include visual read
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {!panelCollapsed && (
          <div
            className="flex-1 min-h-0 overflow-y-auto space-y-2 text-left pr-0.5"
            style={{ fontSize: contentFontPx }}
          >
            {enrichError && !enriching && (
              <p className="text-[0.875em] text-destructive">
                {enrichErrorMessage ?? "Analysis failed — retry Enrich."}
              </p>
            )}

            {/* State C: enrich result — shown above scan so it is not buried */}
            {enrichResult && !enriching && (
              <div
                ref={enrichResultRef}
                className="rounded border border-cyan-500/30 bg-cyan-950/20 p-2.5 space-y-2"
              >
                <span className="text-[0.72em] uppercase tracking-wide text-cyan-400/90 block">
                  AI analysis
                </span>
                {enrichResult.baseMeta?.detected && enrichResult.baseMeta.summaryLines.length > 0 ? (
                  <EnrichBaseMetaBlock meta={enrichResult.baseMeta} />
                ) : null}

                {enrichResult.urMeta?.detected && enrichResult.urMeta.summaryLines.length > 0 ? (
                  <EnrichUrMetaBlock meta={enrichResult.urMeta} />
                ) : null}

                <p className="text-[1em] text-slate-100 leading-snug">
                  <EnrichHighlightedText text={enrichResult.recommendation} />
                </p>
                <p className="text-[1em] text-amber-300/90 leading-snug">
                  Invalidation:{" "}
                  <EnrichHighlightedText text={enrichResult.invalidation} />
                </p>
                <p className="text-[0.875em] text-slate-400">
                  {CHART_ENRICH_PATTERN_DISPLAY[enrichResult.patternLabel]}
                  {" · "}
                  {enrichResult.patternCleanliness}
                  {enrichResult.patternConfidencePct != null &&
                    ` · ${formatEnrichConfidencePct(enrichResult.patternConfidencePct)}`}
                  {" · "}
                  {CHART_ENRICH_LIFECYCLE_DISPLAY[enrichResult.lifecycleStage]}
                </p>

                {enrichResult.structureMeta ? (
                  <EnrichStructureMetaBlock meta={enrichResult.structureMeta} />
                ) : null}

                <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-700/40">
                  <span className="text-[0.875em] text-muted-foreground">Helpful?</span>
                  <Button
                    type="button"
                    size="icon"
                    variant={helpful === "up" ? "default" : "ghost"}
                    className="h-7 w-7"
                    onClick={handleThumbsUp}
                    data-testid={`${pid}button-enrich-thumbs-up`}
                  >
                    <ThumbsUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant={helpful === "down" ? "destructive" : "ghost"}
                    className="h-7 w-7"
                    onClick={() => setHelpful("down")}
                    data-testid={`${pid}button-enrich-thumbs-down`}
                  >
                    <ThumbsDown className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 text-[0.85em] gap-1 text-amber-400/90 hover:text-amber-300"
                    onClick={() => {
                      setModelPrefill(
                        helpful === "down" && correctionKind === "wrong_timing"
                          ? { scopes: ["lifecycle"] }
                          : helpful === "down" && correctionKind === "wrong_pattern"
                            ? { scopes: ["pattern"] }
                            : { scopes: ["full_read"] }
                      );
                      setModelOpen(true);
                    }}
                  >
                    <Star className="h-3 w-3" />
                    Save as model
                  </Button>
                </div>

                {helpful === "up" && (
                  <p className="text-[0.875em] text-green-400/90">Feedback saved — helps future similar setups.</p>
                )}

                {helpful === "down" && !correctionKind && (
                  <>
                    <p className="text-[0.875em] text-muted-foreground">What was off?</p>
                    <div className="flex flex-wrap gap-1.5">
                    {CHART_ENRICH_CORRECTION_KINDS.map((kind) => (
                      <Button
                        key={kind}
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-[0.85em]"
                        onClick={() => handleCorrectionChip(kind)}
                      >
                        {CORRECTION_LABELS[kind]}
                      </Button>
                    ))}
                    </div>
                  </>
                )}

                {modelSavedLabel && (
                  <p className="text-[0.875em] text-amber-300/90">{modelSavedLabel}</p>
                )}

                {showLifecycleFix && (
                  <div className="flex flex-wrap gap-1.5">
                    {CHART_ENRICH_LIFECYCLE_STAGES.map((stage) => (
                      <Button
                        key={stage}
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-[0.85em]"
                        onClick={() => handleLifecycleSave(stage)}
                      >
                        {CHART_ENRICH_LIFECYCLE_DISPLAY[stage]}
                      </Button>
                    ))}
                  </div>
                )}

                {showPatternFix && (
                  <div className="flex flex-wrap gap-1.5">
                    {CHART_ENRICH_PATTERN_LABELS.map((pattern) => (
                      <Button
                        key={pattern}
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-[0.85em]"
                        onClick={() => handlePatternSave(pattern)}
                      >
                        {CHART_ENRICH_PATTERN_DISPLAY[pattern]}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* State A: scan context */}
            {hasScan && (
              <div className="rounded border border-slate-700/50 bg-slate-900/40">
                <button
                  type="button"
                  className="flex w-full items-start gap-2 px-2.5 py-2 text-left text-[1em] text-slate-300"
                  onClick={() => setScanCollapsed((c) => !c)}
                >
                  {scanCollapsed ? (
                    <ChevronRight className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
                  )}
                  <div className="min-w-0 flex-1">
                    <span className="text-[0.72em] uppercase tracking-wide text-muted-foreground block mb-0.5">
                      Scan Analysis
                    </span>
                    {scanCollapsed ? (
                      <span className="leading-snug">{scanSummaryOneLine(scanRow!)}</span>
                    ) : (
                      <p className="leading-snug text-slate-200">{scanRow!.setupNarrative}</p>
                    )}
                  </div>
                </button>
                {!scanCollapsed && scanRow!.summaryLines?.length ? (
                  <div className="px-2.5 pb-2 space-y-0.5">
                    {scanRow!.summaryLines.map((line, i) => (
                      <p key={i} className="text-[0.875em] text-slate-400">
                        {line}
                      </p>
                    ))}
                  </div>
                ) : null}
              </div>
            )}

            {!hasScan && !enrichResult && !enriching && (
              <p className="text-[1em] text-muted-foreground leading-snug">
                Click Enrich to analyze this chart setup, or star tickers in Ticker Review for scan context.
              </p>
            )}

            {hasScan && scanRow!.firedOptional?.length ? (
              <div className="flex flex-wrap justify-start gap-1.5 pt-0.5">
                {scanRow!.firedOptional.map((id) => (
                  <Badge
                    key={id}
                    variant="secondary"
                    className="text-[0.8em] px-2 py-0.5 bg-green-500/15 text-green-300 border-green-500/30"
                  >
                    {OPTIONAL_LABEL[id] ?? id}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </div>

      <SaveEnrichModelDialog
        open={modelOpen}
        onOpenChange={setModelOpen}
        symbol={sym}
        enrichResult={enrichResult}
        dossier={enrichEntry?.dossier ?? null}
        enrichRunId={enrichEntry?.enrichRunId ?? null}
        feedbackId={lastFeedbackId}
        prefillScopes={modelPrefill.scopes}
        prefillLifecycle={modelPrefill.lifecycle}
        prefillPattern={modelPrefill.pattern}
        onSave={async (payload) => {
          if (!enrichEntry) return;
          try {
            await saveModel({
              enrichRunId: enrichEntry.enrichRunId,
              feedbackId: lastFeedbackId,
              symbol: sym,
              tier: payload.tier,
              scopes: payload.scopes,
              patternLabel: payload.patternLabel,
              patternCleanliness: payload.patternCleanliness,
              lifecycleStage: payload.lifecycleStage,
              note: payload.note,
              enrichSnapshot: enrichEntry.result,
              dossier: enrichEntry.dossier,
            });
            const tierLabel = payload.tier.charAt(0).toUpperCase() + payload.tier.slice(1);
            setModelSavedLabel(`${tierLabel} model saved — used on future Enrich runs.`);
            toast({ title: "Model saved", description: `${tierLabel} tier · ${payload.scopes.join(", ")}` });
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Model save failed";
            toast({ title: "Could not save model", description: msg, variant: "destructive" });
            throw err;
          }
        }}
      />
    </>
  );
}
