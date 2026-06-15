import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { MiniChart, type StartHereInterval } from "@/components/MiniChart";
import type { ThemeRow } from "@/data/mockThemeData";
import {
  getThemeChartSymbolCandidates,
  formatAtrx50maLine,
  type LiveThemeChartsSnapshotKey,
} from "@/lib/live-theme-charts";
import type { ThemeMemberHighlight } from "@/lib/theme-member-highlights";
import type { ThemeAccDistStats } from "@/lib/theme-actionable-model";
import {
  actionableSegmentScores,
  ACTIONABLE_SEGMENT_LABELS,
  computeThemeActionableModel,
} from "@/lib/theme-actionable-model";
import { getPulseToneByBandId, getScoreBandIndex, PULSE_BAND_ORDER } from "@/lib/pulse-scale";
import { mergeEtfBreakdownFlags, computeThemeBreakdownWatch } from "@shared/theme-breakdown-watch";
import type { EtfStructureFlags } from "@shared/theme-breakdown-watch";
import type { LiveThemeChartsColumnKey } from "@/lib/live-theme-charts";
import { BreakdownWatchBadge } from "@/components/market-condition/BreakdownWatchBadge";
import type { MiniChartEtfStructure } from "@/components/MiniChart";
import { AlertTriangle, BarChart3, TrendingDown, TrendingUp } from "lucide-react";

export type LiveThemeChartsDensity = "compact" | "popout";

const DENSITY = {
  compact: {
    chartMinH: "min-h-[120px]",
    headerName: "text-xs",
    headerSymbol: "text-[10px]",
    rank: "text-lg font-bold tabular-nums",
    rankMeta: "text-[10px]",
    panel: "text-[10px]",
    segmentLabel: "w-[4.5rem] text-[9px]",
    segmentBar: "h-1.5",
    chip: "text-[9px]",
    chipIcon: "h-2.5 w-2.5",
    adrs: "text-[10px]",
    badge: "h-5 px-1.5 text-[9px]",
  },
  popout: {
    chartMinH: "min-h-[220px]",
    headerName: "text-sm",
    headerSymbol: "text-xs",
    rank: "text-3xl font-bold tabular-nums leading-none",
    rankMeta: "text-sm",
    panel: "text-sm",
    segmentLabel: "w-[5.5rem] text-xs",
    segmentBar: "h-2.5",
    chip: "text-xs",
    chipIcon: "h-3.5 w-3.5",
    adrs: "text-sm",
    badge: "h-6 px-2 text-xs",
  },
} as const;

export function ThemeChartRow({
  theme,
  columnKey,
  snapshotKey,
  chartInterval,
  highlights,
  accDistStats,
  density = "compact",
  onOpenCharts,
}: {
  theme: ThemeRow;
  columnKey?: LiveThemeChartsColumnKey;
  snapshotKey: LiveThemeChartsSnapshotKey;
  chartInterval: StartHereInterval;
  highlights: ThemeMemberHighlight[];
  accDistStats?: ThemeAccDistStats | null;
  density?: LiveThemeChartsDensity;
  /** Open Sentinel dual charts overlay (with load status dialog). */
  onOpenCharts?: (symbol: string) => void;
}) {
  const d = DENSITY[density];
  const memberSymbols = useMemo(() => highlights.map((h) => h.symbol), [highlights]);

  const symbolCandidates = useMemo(
    () => getThemeChartSymbolCandidates(theme, { memberSymbols }),
    [theme, memberSymbols]
  );

  const [chartSymbolOverride, setChartSymbolOverride] = useState<string | null>(null);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [adrsFrom50, setAdrsFrom50] = useState<number | null>(null);
  const [etfFlags, setEtfFlags] = useState<EtfStructureFlags | null>(null);

  const activeCandidates = chartSymbolOverride ? [chartSymbolOverride] : symbolCandidates;
  const primaryEtf = symbolCandidates[0] ?? null;

  useEffect(() => {
    setChartSymbolOverride(null);
    setCandidateIndex(0);
  }, [theme.id]);

  useEffect(() => {
    setCandidateIndex(0);
  }, [symbolCandidates.join(",")]);

  const chartSymbol = activeCandidates[candidateIndex] ?? null;
  const showingMember = chartSymbolOverride != null || (chartSymbol != null && chartSymbol !== primaryEtf);

  const model = useMemo(
    () => computeThemeActionableModel(theme, accDistStats ?? null),
    [theme, accDistStats]
  );
  const segments = actionableSegmentScores(model);

  const themeBreakdown = useMemo(() => {
    const input = {
      trendState: theme.trendState,
      pctAbove50d: theme.pctAbove50d,
      pctAbove200d: theme.pctAbove200d,
      breadthPct: theme.breadthPct,
      medianPct: theme.medianPct,
      rsVsBenchmark: theme.rsVsSpy,
      deltaRank: theme.deltaRank,
      acceleration: theme.acceleration,
      accDistDays: theme.accDistDays,
      bearCount: theme.bearCount,
      totalCount: theme.coreCount,
      rank: theme.rank,
      distributionPct: accDistStats?.distributionPct,
    };
    if (theme.breakdownWatch && accDistStats == null) return theme.breakdownWatch;
    return computeThemeBreakdownWatch(input);
  }, [theme, accDistStats]);

  const mergedBreakdown = useMemo(
    () => mergeEtfBreakdownFlags(themeBreakdown, etfFlags ?? undefined),
    [themeBreakdown, etfFlags]
  );
  const showBreakdownBadge =
    mergedBreakdown.tier !== "none" &&
    (mergedBreakdown.tier !== "weak_laggard" || columnKey === "bottom");
  const etfAugmented =
    etfFlags != null &&
    (etfFlags.below50Sma || etfFlags.belowVwap || etfFlags.sessionRed) &&
    mergedBreakdown.score > (themeBreakdown?.score ?? 0);

  const handleEtfStructureChange = (flags: MiniChartEtfStructure | null) => {
    setEtfFlags(flags);
  };

  const rankDelta =
    theme.deltaRank > 0 ? `↑${theme.deltaRank}` : theme.deltaRank < 0 ? `↓${Math.abs(theme.deltaRank)}` : "—";
  const histRank = theme.historicalMetrics?.rank;
  const showPriorRank = histRank != null && histRank !== theme.rank;

  const adrsLine = formatAtrx50maLine(adrsFrom50);
  const adrsNegative = adrsFrom50 != null && adrsFrom50 < 0;

  const statusClass =
    model.status === "Tradeable"
      ? "bg-green-500/15 text-green-300 border-green-500/35"
      : model.status === "Watch"
        ? "bg-yellow-500/15 text-yellow-300 border-yellow-500/35"
        : "bg-red-500/15 text-red-300 border-red-500/35";

  return (
    <article
      className="rounded-md border border-border/60 bg-card/40 overflow-hidden"
      data-testid={`theme-chart-row-${theme.id}`}
    >
      <header className="flex items-center justify-between gap-2 border-b border-border/50 px-2 py-1.5">
        <div className="min-w-0 flex items-center gap-1.5">
          <span className={cn("truncate font-semibold", d.headerName)}>{theme.name}</span>
          {chartSymbol ? (
            <span
              className={cn(
                "font-mono",
                d.headerSymbol,
                showingMember ? "font-semibold text-cyan-300" : "text-muted-foreground"
              )}
            >
              {chartSymbol}
            </span>
          ) : null}
          {showingMember && primaryEtf && chartSymbol !== primaryEtf ? (
            <button
              type="button"
              className={cn(
                "start-here-no-drag text-muted-foreground underline-offset-2 hover:text-foreground hover:underline",
                d.headerSymbol
              )}
              title={`Show theme ETF ${primaryEtf} in chart`}
              onClick={() => {
                setChartSymbolOverride(null);
                setCandidateIndex(0);
              }}
            >
              ETF {primaryEtf}
            </button>
          ) : null}
        </div>
        <div className={cn("flex shrink-0 flex-col items-end gap-0.5 font-mono", d.rankMeta)}>
          <span className={cn(d.rank, "text-foreground")}>#{theme.rank}</span>
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                theme.deltaRank > 0 ? "text-green-400" : theme.deltaRank < 0 ? "text-red-400" : "text-muted-foreground"
              )}
            >
              {rankDelta}
            </span>
            {showPriorRank ? (
              <span className="text-muted-foreground">was #{histRank}</span>
            ) : null}
          </div>
        </div>
      </header>

      <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-2 p-2">
        <div className={cn(d.chartMinH, "min-w-0")}>
          {chartSymbol ? (
            <MiniChart
              key={`${chartSymbol}-${chartInterval}-${candidateIndex}`}
              symbol={chartSymbol}
              movingAverages2150200
              startHereInterval={chartInterval}
              fillContainer
              hideChangeFooter
              hideInfoBox
              showLeftPriceScale
              priceScaleTickCount={density === "popout" ? 5 : 4}
              onAdrsFrom50Change={setAdrsFrom50}
              onEtfStructureChange={handleEtfStructureChange}
              onNoData={() => {
                if (chartSymbolOverride) return;
                setCandidateIndex((idx) =>
                  idx < activeCandidates.length - 1 ? idx + 1 : idx
                );
              }}
            />
          ) : (
            <div
              className={cn(
                "flex h-full items-center justify-center text-muted-foreground",
                d.panel,
                d.chartMinH
              )}
            >
              No chart symbol — pick a member below
            </div>
          )}
        </div>

        <div className={cn("flex min-w-0 flex-col gap-1.5 leading-snug", d.panel)}>
          <div className="flex flex-wrap items-center gap-1">
            <Badge variant="outline" className={cn(d.badge, statusClass)}>
              {model.status}
            </Badge>
            {showBreakdownBadge ? (
              <BreakdownWatchBadge assessment={mergedBreakdown} size={density === "popout" ? "md" : "sm"} />
            ) : null}
            {theme.isNarrowLeadership ? (
              <span className="inline-flex items-center gap-0.5 text-amber-400">
                <AlertTriangle className={d.chipIcon} />
                Narrow
              </span>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 font-mono tabular-nums">
            <span className={cn(theme.medianPct >= 0 ? "text-green-400" : "text-red-400")}>
              {theme.medianPct >= 0 ? "+" : ""}
              {theme.medianPct.toFixed(2)}%
            </span>
            <span className="text-muted-foreground">
              A/D {theme.accDistDays >= 0 ? "+" : ""}
              {theme.accDistDays}d
            </span>
            <span className={cn(theme.rsVsSpy >= 0 ? "text-green-400" : "text-red-400")}>
              RS {theme.rsVsSpy >= 0 ? "+" : ""}
              {theme.rsVsSpy.toFixed(2)}
            </span>
            <span className="text-muted-foreground">Breadth {theme.breadthPct.toFixed(0)}%</span>
          </div>

          <div className="space-y-0.5">
            {ACTIONABLE_SEGMENT_LABELS.map((label, idx) => {
              const score = segments[idx] ?? 0;
              const band = getScoreBandIndex(score);
              const tone = getPulseToneByBandId(PULSE_BAND_ORDER[band] ?? PULSE_BAND_ORDER[0], "bar");
              return (
                <div key={label} className="flex items-center gap-1">
                  <span className={cn("shrink-0 truncate text-muted-foreground", d.segmentLabel)}>
                    {label}
                  </span>
                  <div className={cn("flex-1 overflow-hidden rounded-full bg-muted/40", d.segmentBar)}>
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${score}%`, backgroundColor: tone.bgHex }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <p className={cn("line-clamp-2 text-muted-foreground", density === "popout" ? "text-xs" : "text-[10px]")}>
            {model.verdict}
          </p>

          {showBreakdownBadge && mergedBreakdown.reasons.length > 0 ? (
            <p className={cn("font-mono text-muted-foreground", d.panel)}>
              {mergedBreakdown.reasons.join(" · ")}
              {etfAugmented ? " · ETF confirm" : ""}
            </p>
          ) : null}

          <p
            className={cn(
              "rounded px-1.5 py-0.5 font-mono leading-tight tabular-nums",
              d.adrs,
              adrsNegative
                ? "border border-red-400/25 bg-red-400/15 text-red-300"
                : "border border-green-400/25 bg-green-400/15 text-green-300"
            )}
          >
            {adrsLine}
          </p>

          {highlights.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1 pt-0.5">
              {highlights.map((h) => {
                const selected = chartSymbolOverride === h.symbol;
                return (
                  <div key={h.symbol} className="inline-flex items-center gap-0.5">
                    <button
                      type="button"
                      title={selected ? "Show theme ETF in chart" : `Load ${h.symbol} in chart`}
                      className={cn(
                        "start-here-no-drag inline-flex items-center gap-0.5 rounded border px-1 py-0.5 font-mono transition-colors",
                        d.chip,
                        selected
                          ? "border-cyan-500/60 bg-cyan-500/15 ring-1 ring-cyan-500/40"
                          : "border-border/60 bg-muted/30 hover:bg-muted/60"
                      )}
                      onClick={() =>
                        setChartSymbolOverride((prev) =>
                          prev === h.symbol ? null : h.symbol.toUpperCase()
                        )
                      }
                    >
                      {h.tag === "laggard" ? (
                        <TrendingDown className={cn(d.chipIcon, "text-red-400")} />
                      ) : (
                        <TrendingUp
                          className={cn(
                            d.chipIcon,
                            h.tag === "narrow-driver" ? "text-amber-400" : "text-green-400"
                          )}
                        />
                      )}
                      <span>{h.symbol}</span>
                      <span className={cn(h.pctChange >= 0 ? "text-green-400" : "text-red-400")}>
                        {h.pctChange >= 0 ? "+" : ""}
                        {h.pctChange.toFixed(1)}%
                      </span>
                    </button>
                    <button
                      type="button"
                      className="start-here-no-drag inline-flex rounded p-0.5 text-muted-foreground hover:text-foreground"
                      title={`Open ${h.symbol} in Sentinel charts`}
                      aria-label={`Open ${h.symbol} in Sentinel charts`}
                      onClick={() => onOpenCharts?.(h.symbol)}
                    >
                      <BarChart3 className={d.chipIcon} />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}
