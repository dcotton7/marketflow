import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { formatMarketCap } from "@/components/DualChartGrid";
import type { QuarterlyEarning } from "@/components/DualChartGrid";
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
import { useQuery } from "@tanstack/react-query";
import { ThemeTabContent } from "@/components/charts/ThemeTabContent";

type SetupTab = "ai" | "fundamentals" | "theme";

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
    meta.earningsRisk != null ||
    meta.postureHint !== "unclear";
  if (!hasContent) return null;

  const earnings = meta.earningsRisk;
  const earningsLineClass =
    earnings?.severity === "red"
      ? "text-red-300"
      : earnings?.severity === "yellow"
        ? "text-amber-300"
        : "text-slate-300";

  return (
    <div className="rounded border border-slate-700/50 bg-slate-900/35 p-2 space-y-1.5">
      <span className="text-[0.72em] uppercase tracking-wide text-muted-foreground block">
        Structure meta
      </span>
      {earnings && (
        <div
          className={cn(
            "rounded border px-2 py-1.5 text-[0.875em] leading-snug font-medium",
            earnings.severity === "red"
              ? "border-red-500/50 bg-red-950/35 text-red-200"
              : "border-amber-500/45 bg-amber-950/30 text-amber-100"
          )}
          data-testid="enrich-earnings-risk"
        >
          <span className="text-[0.72em] uppercase tracking-wide opacity-90 block mb-0.5">
            {earnings.severity === "red" ? "Earnings — RED" : "Earnings — YELLOW"}
          </span>
          {earnings.label}
        </div>
      )}
      {meta.postureHint !== "unclear" && (
        <p className="text-[0.875em] text-slate-300 leading-snug">
          <EnrichHighlightedText text={CHART_SETUP_POSTURE_LABELS[meta.postureHint]} />
        </p>
      )}
      {meta.longSetupNegatives.length > 0 && (
        <ul className="text-[0.875em] text-slate-300 space-y-0.5 list-disc pl-4">
          {meta.longSetupNegatives.map((line) => (
            <li
              key={line}
              className={
                earnings && line === earnings.label ? earningsLineClass : undefined
              }
            >
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

function formatRevenue(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

function FundSectionHeader({ label }: { label: string }) {
  return (
    <span className="text-[0.72em] uppercase tracking-wide text-sky-400/80 font-semibold block pb-0.5 mb-1 border-b border-slate-700/30">
      {label}
    </span>
  );
}

function FundamentalsTabContent({ metrics, symbol }: { metrics: ChartMetrics | null | undefined; symbol: string }) {
  const [descExpanded, setDescExpanded] = useState(false);

  // Recalculate nextEarningsDays relative to today (server value is a snapshot)
  const nextEarnings = useMemo(() => {
    if (!metrics?.nextEarningsDate || metrics.nextEarningsDate === "N/A") return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const nextDate = new Date(metrics.nextEarningsDate + "T00:00:00");
    const daysUntil = Math.ceil((nextDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (daysUntil < 0) return null; // past date — suppress
    return { date: metrics.nextEarningsDate, days: daysUntil, time: metrics.earningsTime };
  }, [metrics?.nextEarningsDate, metrics?.earningsTime]);

  if (!metrics) {
    return (
      <p className="text-[0.875em] text-muted-foreground">
        Waiting for chart data…
      </p>
    );
  }

  const desc = metrics.companyDescription || null;
  const descTruncated = desc && desc.length > 200 && !descExpanded
    ? `${desc.slice(0, 200)}…`
    : desc;

  const epsBeat = metrics.epsActual != null && metrics.epsEstimate != null
    ? metrics.epsActual >= metrics.epsEstimate
    : null;
  const revBeat = metrics.revenueActual != null && metrics.revenueEstimate != null
    ? metrics.revenueActual >= metrics.revenueEstimate
    : null;

  const epsSurprisePct = metrics.epsActual != null && metrics.epsEstimate != null && metrics.epsEstimate !== 0
    ? ((metrics.epsActual - metrics.epsEstimate) / Math.abs(metrics.epsEstimate)) * 100
    : null;
  const revSurprisePct = metrics.revenueActual != null && metrics.revenueEstimate != null && metrics.revenueEstimate !== 0
    ? ((metrics.revenueActual - metrics.revenueEstimate) / Math.abs(metrics.revenueEstimate)) * 100
    : null;

  return (
    <div className="space-y-3">
      {/* ── Company Profile ── */}
      <div className="space-y-1">
        <FundSectionHeader label="Company Profile" />
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-[1em] font-medium text-slate-100">
            {metrics.companyName || symbol}
          </span>
        </div>
        {(metrics.sectorName || metrics.industryName) && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {metrics.sectorName && (
              <span className="text-[0.75em] px-1.5 py-0.5 rounded bg-sky-900/30 text-sky-300 border border-sky-700/30">
                {metrics.sectorName}
              </span>
            )}
            {metrics.industryName && metrics.industryName !== "Unknown" && (
              <span className="text-[0.75em] px-1.5 py-0.5 rounded bg-slate-800/50 text-slate-300 border border-slate-700/30">
                {metrics.industryName}
              </span>
            )}
          </div>
        )}
        {descTruncated && (
          <p className="text-[0.82em] text-slate-400 leading-snug mt-1">
            {descTruncated}
            {desc && desc.length > 200 && (
              <button
                type="button"
                className="ml-1 text-sky-400/80 hover:text-sky-300 text-[0.9em]"
                onClick={() => setDescExpanded((e) => !e)}
              >
                {descExpanded ? "less" : "more"}
              </button>
            )}
          </p>
        )}
      </div>

      {/* ── 52-Week Range ── */}
      {metrics.week52High != null && metrics.week52Low != null && metrics.week52High > metrics.week52Low && (
        <div className="space-y-1">
          <FundSectionHeader label="52-Week Range" />
          <Week52RangeBar low={metrics.week52Low} high={metrics.week52High} current={metrics.currentPrice} />
        </div>
      )}

      {/* ── Key Metrics Grid: 4 × label:value per row, tight vertical ── */}
      <div className="space-y-0.5">
        <FundSectionHeader label="Key Metrics" />
        <div className="grid grid-cols-4 gap-x-2 gap-y-0.5">
          {metrics.marketCap > 0 && (
            <FundMetric label="Mkt Cap" value={formatMarketCap(metrics.marketCap)} />
          )}
          {metrics.pe != null && (
            <FundMetric
              label="P/E"
              value={metrics.pe.toFixed(1)}
              valueClass={metrics.pe > 50 ? "text-red-400" : metrics.pe > 30 ? "text-amber-400" : undefined}
            />
          )}
          {metrics.beta != null && (
            <FundMetric
              label="Beta"
              value={metrics.beta.toFixed(2)}
              valueClass={metrics.beta > 2 ? "text-amber-400" : undefined}
            />
          )}
          {metrics.debtToEquity != null && (
            <FundMetric
              label="D/E"
              value={metrics.debtToEquity.toFixed(2)}
              valueClass={metrics.debtToEquity > 2 ? "text-red-400" : metrics.debtToEquity > 1 ? "text-amber-400" : undefined}
            />
          )}
          {metrics.preTaxMargin != null && (
            <FundMetric
              label="Margin"
              value={`${metrics.preTaxMargin.toFixed(1)}%`}
              valueClass={metrics.preTaxMargin < 0 ? "text-red-400" : metrics.preTaxMargin > 20 ? "text-green-400" : undefined}
            />
          )}
          {metrics.roe != null && (
            <FundMetric
              label="ROE"
              value={`${metrics.roe.toFixed(1)}%`}
              valueClass={metrics.roe > 15 ? "text-green-400" : metrics.roe >= 5 ? "text-amber-400" : "text-red-400"}
            />
          )}
          {metrics.dividendYield != null && metrics.dividendYield > 0 && (
            <FundMetric
              label="Div"
              value={`${metrics.dividendYield.toFixed(2)}%`}
              valueClass={metrics.dividendYield > 4 ? "text-green-400" : undefined}
            />
          )}
          {metrics.analystConsensus && metrics.analystConsensus !== "N/A" && (
            <FundMetric
              label="Analysts"
              value={metrics.analystConsensus}
              valueClass={
                metrics.analystConsensus.includes("Buy") ? "text-green-400"
                : metrics.analystConsensus.includes("Sell") ? "text-red-400"
                : undefined
              }
            />
          )}
          {metrics.targetPrice != null && (
            <FundMetric label="Target" value={`$${metrics.targetPrice.toFixed(2)}`} />
          )}
          {metrics.salesGrowth3QYoY && metrics.salesGrowth3QYoY !== "N/A" && (
            <FundMetric
              label="Rev"
              value={metrics.salesGrowth3QYoY}
              valueClass={metrics.salesGrowth3QYoY.startsWith("+") ? "text-green-400" : metrics.salesGrowth3QYoY.startsWith("-") ? "text-red-400" : undefined}
            />
          )}
          {metrics.epsCurrentQYoY && metrics.epsCurrentQYoY !== "N/A" && (
            <FundMetric
              label="EPS YoY"
              value={metrics.epsCurrentQYoY}
              valueClass={metrics.epsCurrentQYoY.startsWith("+") ? "text-green-400" : metrics.epsCurrentQYoY.startsWith("-") ? "text-red-400" : undefined}
            />
          )}
        </div>
      </div>

      {/* ── Earnings Detail ── */}
      <div className="space-y-1">
        <FundSectionHeader label="Earnings" />
        <div className="rounded border border-slate-700/40 bg-slate-900/25 p-2 space-y-1.5">
          {metrics.earningsApplicable === false ? (
            <p className="text-[0.85em] text-slate-400 leading-snug">
              Not applicable — ETF / fund (no corporate earnings). Vendor EPS rows are suppressed so they cannot mislead a position.
            </p>
          ) : metrics.earningsHistory && metrics.earningsHistory.length > 0 ? (
            <EarningsHistoryTable history={metrics.earningsHistory} />
          ) : metrics.lastEarningsDate ? (
            <div className="space-y-1">
              <p className="text-[0.85em] text-slate-300">
                <span className="text-slate-500">Last reported: </span>
                {metrics.lastEarningsDate}
              </p>

              {metrics.epsActual != null && (
                <div className="flex items-center gap-1.5 flex-wrap text-[0.85em]">
                  <span className="text-slate-500 w-8">EPS</span>
                  <span className={cn("font-mono font-medium", epsBeat ? "text-green-400" : "text-red-400")}>
                    ${metrics.epsActual.toFixed(2)}
                  </span>
                  {metrics.epsEstimate != null && (
                    <>
                      <span className="text-slate-600">vs</span>
                      <span className="font-mono text-slate-400">${metrics.epsEstimate.toFixed(2)}</span>
                      <span className={cn(
                        "text-[0.9em] font-bold px-1 py-px rounded",
                        epsBeat
                          ? "bg-green-900/30 text-green-400 border border-green-700/30"
                          : "bg-red-900/30 text-red-400 border border-red-700/30"
                      )}>
                        {epsBeat ? "BEAT" : "MISS"}
                        {epsSurprisePct != null && ` ${epsSurprisePct >= 0 ? "+" : ""}${epsSurprisePct.toFixed(1)}%`}
                      </span>
                    </>
                  )}
                </div>
              )}

              {metrics.revenueActual != null && (
                <div className="flex items-center gap-1.5 flex-wrap text-[0.85em]">
                  <span className="text-slate-500 w-8">Rev</span>
                  <span className={cn("font-mono font-medium", revBeat ? "text-green-400" : "text-red-400")}>
                    {formatRevenue(metrics.revenueActual)}
                  </span>
                  {metrics.revenueEstimate != null && (
                    <>
                      <span className="text-slate-600">vs</span>
                      <span className="font-mono text-slate-400">{formatRevenue(metrics.revenueEstimate)}</span>
                      <span className={cn(
                        "text-[0.9em] font-bold px-1 py-px rounded",
                        revBeat
                          ? "bg-green-900/30 text-green-400 border border-green-700/30"
                          : "bg-red-900/30 text-red-400 border border-red-700/30"
                      )}>
                        {revBeat ? "BEAT" : "MISS"}
                        {revSurprisePct != null && ` ${revSurprisePct >= 0 ? "+" : ""}${revSurprisePct.toFixed(1)}%`}
                      </span>
                    </>
                  )}
                </div>
              )}

              {metrics.lastEpsSurprise && metrics.lastEpsSurprise !== "N/A" && !metrics.epsActual && (
                <p className="text-[0.85em]">
                  <span className="text-slate-500">Surprise: </span>
                  <span className={metrics.lastEpsSurprise.startsWith("+") ? "text-green-400" : "text-red-400"}>
                    {metrics.lastEpsSurprise}
                  </span>
                </p>
              )}
            </div>
          ) : (
            <p className="text-[0.85em] text-muted-foreground">No verified recent earnings on file</p>
          )}

          {/* Next earnings (recalculated client-side, past dates suppressed) */}
          {metrics.earningsApplicable !== false && nextEarnings && (
            <div className="pt-1 border-t border-slate-700/30">
              <p className="text-[0.85em] text-slate-300">
                <span className="text-slate-500">Next: </span>
                <span className="font-medium">{nextEarnings.date}</span>
                <span className={cn(
                  "ml-1 text-[0.9em] font-bold px-1 py-px rounded",
                  nextEarnings.days <= 7
                    ? "bg-amber-900/30 text-amber-400 border border-amber-700/30"
                    : "text-slate-400"
                )}>
                  {nextEarnings.days === 0 ? "TODAY" : `in ${nextEarnings.days}d`}
                </span>
                {nextEarnings.time === "bmo" && <span className="text-slate-500 ml-1">BMO</span>}
                {nextEarnings.time === "amc" && <span className="text-slate-500 ml-1">AMC</span>}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Industry Peers ── */}
      {metrics.industryPeers && metrics.industryPeers.length > 0 && (
        <div className="space-y-1">
          <FundSectionHeader label="Industry Peers" />
          <div className="flex flex-wrap gap-1.5">
            {metrics.industryPeers.slice(0, 8).map((p) => (
              <span
                key={p.symbol}
                className="text-[0.8em] px-1.5 py-0.5 rounded bg-slate-800/50 text-slate-300 border border-slate-700/30 font-mono"
              >
                {p.symbol}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Upcoming Earnings (current + peers) ── */}
      <UpcomingEarningsSection
        currentSymbol={symbol}
        currentNextDate={metrics.nextEarningsDate}
        currentNextDays={metrics.nextEarningsDays}
        currentEarningsTime={metrics.earningsTime}
        peerSymbols={metrics.industryPeers?.map((p) => p.symbol) ?? []}
      />
    </div>
  );
}

function Week52RangeBar({ low, high, current }: { low: number; high: number; current: number }) {
  const range = high - low;
  const pct = range > 0 ? Math.max(0, Math.min(100, ((current - low) / range) * 100)) : 50;

  return (
    <div className="rounded border border-slate-700/40 bg-slate-900/25 px-2 py-1.5">
      <div className="flex items-center gap-2 text-[0.82em]">
        <span className="font-mono text-slate-400 shrink-0">${low.toFixed(2)}</span>
        <div className="relative flex-1 h-2 rounded-full bg-slate-700/60 overflow-hidden">
          <div
            className="absolute left-0 top-0 h-full rounded-full bg-gradient-to-r from-red-500/60 via-amber-500/60 to-green-500/60"
            style={{ width: "100%" }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-sky-400 border border-sky-200 shadow-sm shadow-sky-400/50"
            style={{ left: `calc(${pct}% - 5px)` }}
            title={`Current: $${current.toFixed(2)} (${pct.toFixed(0)}% of 52w range)`}
          />
        </div>
        <span className="font-mono text-slate-400 shrink-0">${high.toFixed(2)}</span>
      </div>
      <p className="text-[0.72em] text-slate-500 text-center mt-0.5">
        Current ${current.toFixed(2)} — {pct.toFixed(0)}% of range
      </p>
    </div>
  );
}

function FundMetric({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <p className="min-w-0 truncate text-[0.85em] leading-tight text-left">
      <span className="text-slate-500">{label}: </span>
      <span className={cn("font-medium text-slate-200", valueClass)}>{value}</span>
    </p>
  );
}

function EarningsHistoryTable({ history }: { history: QuarterlyEarning[] }) {
  return (
    <div className="space-y-1">
      {history.map((q) => {
        const epsBeat = q.epsActual != null && q.epsEstimate != null
          ? q.epsActual >= q.epsEstimate
          : null;
        const epsSurprisePct = q.epsActual != null && q.epsEstimate != null && q.epsEstimate !== 0
          ? ((q.epsActual - q.epsEstimate) / Math.abs(q.epsEstimate)) * 100
          : null;
        const revBeat = q.revenueActual != null && q.revenueEstimate != null
          ? q.revenueActual >= q.revenueEstimate
          : null;

        return (
          <div key={q.date} className="flex items-center gap-2 flex-wrap text-[0.82em] leading-snug">
            <span className="text-slate-400 font-medium w-12 shrink-0">{q.quarter}</span>

            {q.epsActual != null && (
              <>
                <span className="text-slate-500">EPS</span>
                <span className={cn("font-mono", epsBeat != null ? (epsBeat ? "text-green-400" : "text-red-400") : "text-slate-300")}>
                  ${q.epsActual.toFixed(2)}
                </span>
                {q.epsEstimate != null && (
                  <>
                    <span className="text-slate-600">vs</span>
                    <span className="font-mono text-slate-400">${q.epsEstimate.toFixed(2)}</span>
                    <span className={cn(
                      "text-[0.85em] font-bold px-1 py-px rounded",
                      epsBeat
                        ? "bg-green-900/30 text-green-400 border border-green-700/30"
                        : "bg-red-900/30 text-red-400 border border-red-700/30"
                    )}>
                      {epsBeat ? "BEAT" : "MISS"}
                      {epsSurprisePct != null && ` ${epsSurprisePct >= 0 ? "+" : ""}${epsSurprisePct.toFixed(1)}%`}
                    </span>
                  </>
                )}
              </>
            )}

            {q.revenueActual != null && (
              <>
                <span className="text-slate-600 ml-1">Rev</span>
                <span className={cn("font-mono", revBeat != null ? (revBeat ? "text-green-400" : "text-red-400") : "text-slate-300")}>
                  {formatRevenue(q.revenueActual)}
                </span>
                {q.revenueEstimate != null && (
                  <>
                    <span className="text-slate-600">vs</span>
                    <span className="font-mono text-slate-400">{formatRevenue(q.revenueEstimate)}</span>
                    <span className={cn(
                      "text-[0.85em] font-bold px-1 py-px rounded",
                      revBeat
                        ? "bg-green-900/30 text-green-400 border border-green-700/30"
                        : "bg-red-900/30 text-red-400 border border-red-700/30"
                    )}>
                      {revBeat ? "BEAT" : "MISS"}
                    </span>
                  </>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface UpcomingEarningsEntry {
  symbol: string;
  nextEarningsDate: string | null;
  nextEarningsDays: number;
  earningsTime: string | null;
}

function formatEarningsDateShort(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function UpcomingEarningsSection({
  currentSymbol,
  currentNextDate,
  currentNextDays,
  currentEarningsTime,
  peerSymbols,
}: {
  currentSymbol: string;
  currentNextDate?: string | null;
  currentNextDays?: number;
  currentEarningsTime?: string | null;
  peerSymbols: string[];
}) {
  const symbolsParam = useMemo(
    () => peerSymbols.filter((s) => s !== currentSymbol).slice(0, 8).join(","),
    [peerSymbols, currentSymbol]
  );

  const { data: peerEarnings } = useQuery<{ earnings: UpcomingEarningsEntry[] }>({
    queryKey: ["/api/scanner/upcoming-earnings", symbolsParam],
    queryFn: async () => {
      if (!symbolsParam) return { earnings: [] };
      const res = await fetch(`/api/scanner/upcoming-earnings?symbols=${encodeURIComponent(symbolsParam)}`);
      if (!res.ok) return { earnings: [] };
      return res.json();
    },
    enabled: symbolsParam.length > 0,
    staleTime: 60 * 60 * 1000,
  });

  const allEntries = useMemo(() => {
    const entries: UpcomingEarningsEntry[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();

    // Recalculate days relative to today and filter out past dates
    const recalcDays = (dateStr: string | null): number => {
      if (!dateStr || dateStr === "N/A") return -1;
      return Math.ceil((new Date(dateStr + "T00:00:00").getTime() - todayMs) / (1000 * 60 * 60 * 24));
    };

    if (currentNextDate && currentNextDate !== "N/A") {
      const days = recalcDays(currentNextDate);
      if (days >= 0) {
        entries.push({
          symbol: currentSymbol,
          nextEarningsDate: currentNextDate,
          nextEarningsDays: days,
          earningsTime: currentEarningsTime ?? null,
        });
      }
    }

    if (peerEarnings?.earnings) {
      for (const e of peerEarnings.earnings) {
        if (e.symbol === currentSymbol) continue;
        if (!e.nextEarningsDate) continue;
        const days = recalcDays(e.nextEarningsDate);
        if (days < 0) continue;
        entries.push({ ...e, nextEarningsDays: days });
      }
    }

    return entries.sort((a, b) => a.nextEarningsDays - b.nextEarningsDays);
  }, [currentSymbol, currentNextDate, currentNextDays, currentEarningsTime, peerEarnings]);

  if (allEntries.length === 0) return null;

  return (
    <div className="space-y-1">
      <FundSectionHeader label="Upcoming Earnings" />
      <div className="rounded border border-slate-700/40 bg-slate-900/25 p-2 space-y-0.5">
        {allEntries.map((e) => {
          const isToday = e.nextEarningsDays === 0;
          const isUrgent = e.nextEarningsDays <= 2;
          const isWarning = e.nextEarningsDays <= 7;
          const isCurrent = e.symbol === currentSymbol;

          return (
            <div
              key={e.symbol}
              className={cn(
                "flex items-center gap-2 text-[0.85em] leading-snug",
                isCurrent && "font-medium"
              )}
            >
              <span
                className={cn(
                  "font-mono w-12 shrink-0",
                  isCurrent ? "text-sky-300" : "text-slate-300"
                )}
              >
                {e.symbol}
              </span>
              <span className="text-slate-400 w-16 shrink-0">
                {e.nextEarningsDate ? formatEarningsDateShort(e.nextEarningsDate) : "—"}
              </span>
              {isToday ? (
                <span className="text-[0.85em] font-bold px-1.5 py-px rounded bg-red-900/40 text-red-300 border border-red-700/40">
                  TODAY
                </span>
              ) : (
                <span
                  className={cn(
                    "text-[0.85em] font-medium",
                    isUrgent
                      ? "text-red-400"
                      : isWarning
                        ? "text-amber-400"
                        : "text-slate-500"
                  )}
                >
                  ({e.nextEarningsDays}d)
                </span>
              )}
              {e.earningsTime && (
                <span className="text-slate-500 text-[0.85em] uppercase">
                  {e.earningsTime}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
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
  const [activeTab, setActiveTab] = useState<SetupTab>(() => "fundamentals");
  const [pendingAiEnrich, setPendingAiEnrich] = useState(false);
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
    setPendingAiEnrich(false);
    const cached = getCached(sym, includeVisual);
    setEnrichEntry(cached);
    setScanCollapsed(!!cached);
    setActiveTab(cached ? "ai" : "fundamentals");
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
        setActiveTab("ai");
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

  const requestAiAnalysis = useCallback(() => {
    setActiveTab("ai");
    if (enrichEntry || enriching || !sym) return;
    if (!chartsReady) {
      setPendingAiEnrich(true);
      return;
    }
    void runEnrich(false);
  }, [enrichEntry, enriching, sym, chartsReady, runEnrich]);

  useEffect(() => {
    if (!pendingAiEnrich) return;
    if (!chartsReady || enriching || !sym) return;
    setPendingAiEnrich(false);
    if (enrichEntry) return;
    void runEnrich(false);
  }, [pendingAiEnrich, chartsReady, enriching, sym, enrichEntry, runEnrich]);

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
            className="flex items-center gap-1 text-left text-muted-foreground hover:text-slate-200 transition-colors min-w-0"
            aria-expanded={!panelCollapsed}
          >
            <span className="text-sm font-semibold uppercase tracking-wide text-sky-400">
              Setup Info
            </span>
            <ChevronDown
              className={cn("h-4 w-4 shrink-0 transition-transform", panelCollapsed && "rotate-180")}
            />
          </button>

          {/* Tab switcher */}
          {!panelCollapsed && (
            <div className="flex items-center gap-0.5 ml-1">
              <button
                type="button"
                onClick={requestAiAnalysis}
                className={cn(
                  "px-2 py-0.5 text-[11px] font-medium rounded transition-colors",
                  activeTab === "ai"
                    ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                    : "text-slate-400 hover:text-slate-200 border border-transparent"
                )}
              >
                AI Analysis
                {enrichResult && !enriching && (
                  <Sparkles className="inline-block ml-0.5 h-2.5 w-2.5" />
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPendingAiEnrich(false);
                  setActiveTab("fundamentals");
                }}
                className={cn(
                  "px-2 py-0.5 text-[11px] font-medium rounded transition-colors",
                  activeTab === "fundamentals"
                    ? "bg-sky-500/20 text-sky-300 border border-sky-500/40"
                    : "text-slate-400 hover:text-slate-200 border border-transparent"
                )}
              >
                Fundamentals
              </button>
              <button
                type="button"
                onClick={() => {
                  setPendingAiEnrich(false);
                  setActiveTab("theme");
                }}
                className={cn(
                  "px-2 py-0.5 text-[11px] font-medium rounded transition-colors",
                  activeTab === "theme"
                    ? "bg-violet-500/20 text-violet-300 border border-violet-500/40"
                    : "text-slate-400 hover:text-slate-200 border border-transparent"
                )}
              >
                Theme
              </button>
            </div>
          )}

          <div className="flex items-center gap-1 shrink-0 ml-auto">
            {fontSizeControl}
            {activeTab === "ai" && enrichResult && (
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
            {activeTab === "ai" && (
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
            )}
            {activeTab === "ai" && (
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
            )}
          </div>
        </div>

        {!panelCollapsed && activeTab === "fundamentals" && (
          <div
            className="flex-1 min-h-0 overflow-y-auto text-left pr-0.5"
            style={{ fontSize: contentFontPx }}
          >
            <FundamentalsTabContent metrics={chartMetrics} symbol={sym} />
          </div>
        )}

        {!panelCollapsed && activeTab === "theme" && (
          <div
            className="flex-1 min-h-0 overflow-y-auto text-left pr-0.5"
            style={{ fontSize: contentFontPx }}
          >
            <ThemeTabContent symbol={sym} />
          </div>
        )}

        {!panelCollapsed && activeTab === "ai" && (
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
