import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import type { ChartMetrics, ChartDataResponse } from "@/components/DualChartGrid";

import { cn } from "@/lib/utils";

import type { TickerReviewResultRow } from "@/lib/ticker-review-engine";

import { SetupInfoPanel } from "@/components/charts/SetupInfoPanel";
import type { BreakdownWatchAssessment } from "@shared/theme-breakdown-watch";
import { ChartFooterFontSizeControl } from "@/components/ChartFooterFontSizeControl";
import { useSentinelAuth } from "@/context/SentinelAuthContext";
import {
  loadChartFooterFontPrefs,
  saveChartFooterFontPrefs,
  type ChartFooterFontPrefs,
  type ChartFooterFontSection,
} from "@/lib/chart-footer-font-prefs";



export interface ChartSetupEnrich {

  decisionBrief?: string;

  invalidation?: string;

}



export interface ChartSetupInfo {

  row?: TickerReviewResultRow;

  enrich?: ChartSetupEnrich;

}



/** Two stacked metric rows + gap; +15% vs prior 77px boxes. */

export const CHART_FOOTER_BOX_H = 89;

export const CHART_FOOTER_GAP = 5;

export const CHART_FOOTER_TOTAL_H = CHART_FOOTER_BOX_H * 2 + CHART_FOOTER_GAP;

/** Footer target = 1/7 of chart area; never below legacy minimum. Grows when Enrich expands. */
export function chartFooterTargetHeight(containerHeight: number): number {
  if (containerHeight <= 0) return CHART_FOOTER_TOTAL_H;
  return Math.max(CHART_FOOTER_TOTAL_H, Math.floor(containerHeight / 7));
}

export function chartFooterBoxHeight(targetFooterHeight: number): number {
  return Math.max(CHART_FOOTER_BOX_H, Math.floor((targetFooterHeight - CHART_FOOTER_GAP) / 2));
}



interface ChartInfoFooterProps {

  chartMetrics: ChartMetrics | null | undefined;

  setupInfo?: ChartSetupInfo | null;

  symbol?: string;

  dailyData?: ChartDataResponse;

  intradayData?: ChartDataResponse;

  intradayTimeframe?: string;

  themeId?: string | null;

  themeRank?: number | null;

  themeName?: string | null;

  totalThemes?: number | null;

  chartsReady?: boolean;

  testIdPrefix?: string;

  /** Min footer height from DualChartGrid (typically 1/7 of container). */
  footerTargetHeight?: number;

  /** Resizable layout: fill parent panel height; inner sections scroll instead of growing. */
  fillPanel?: boolean;

  onNavigateToTicker?: (ticker: string) => void;

  themeBreakdownWatch?: BreakdownWatchAssessment | null;

}



function formatVolumeShort(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return "N/A";
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return n.toLocaleString();
}

function todayVolumeFromDaily(dailyData?: ChartDataResponse): number | null {
  const candles = dailyData?.candles;
  if (!candles?.length) return null;
  const vol = candles[candles.length - 1]?.volume;
  return vol != null && Number.isFinite(vol) ? vol : null;
}

function epsSurpriseTone(s: string | undefined): string | undefined {
  if (!s || s === "N/A") return undefined;
  if (s.includes("+")) return "text-rs-green";
  if (s.includes("-")) return "text-rs-red";
  return undefined;
}

/** Footer metric line — scales with panel font control; wraps; one line-height gap between rows (via column gap). */
const FOOTER_METRIC_TEXT_CLASS =
  "text-[1em] leading-[1.2] font-normal break-words whitespace-normal";

function FooterInfoLine({
  label,
  value,
  valueClassName,
  testId,
}: {
  label: ReactNode;
  value: ReactNode;
  valueClassName?: string;
  testId?: string;
}) {
  return (
    <p
      className={cn("min-w-0 w-full text-left text-gray-300", FOOTER_METRIC_TEXT_CLASS)}
      data-testid={testId}
    >
      <span className="text-gray-400">{label}: </span>
      <span className={cn("text-gray-100", valueClassName)}>{value}</span>
    </p>
  );
}

function FooterColumn({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col items-start justify-start gap-[1em] border-l border-border/40 pl-3 first:border-l-0 first:pl-0">
      {children}
    </div>
  );
}

function FooterDivider() {
  return <hr className="w-full border-t border-slate-500/60 my-0" />;
}



export function ChartInfoFooter({

  chartMetrics,

  setupInfo,

  symbol = "",

  dailyData,

  intradayData,

  intradayTimeframe = "5min",

  themeId,

  themeRank,

  themeName,

  totalThemes,

  chartsReady = true,

  testIdPrefix = "",

  footerTargetHeight,

  fillPanel = false,

  onNavigateToTicker,

  themeBreakdownWatch,

}: ChartInfoFooterProps) {

  const pid = testIdPrefix ? `${testIdPrefix}-` : "";
  const { user } = useSentinelAuth();

  // Self-fetch theme rank when not provided via props
  const needsThemeLookup = themeRank == null && !!symbol;
  const { data: tickerThemeData } = useQuery<{
    themeId: string | null;
    themeName: string | null;
    rank: number | null;
    totalThemes: number | null;
  }>({
    queryKey: ["/api/market-condition/ticker-theme", symbol],
    queryFn: async () => {
      const res = await fetch(`/api/market-condition/ticker-theme/${symbol}`);
      if (!res.ok) return { themeId: null, themeName: null, rank: null, totalThemes: null };
      return res.json();
    },
    enabled: needsThemeLookup,
    staleTime: 60_000,
  });

  const resolvedThemeRank = themeRank ?? tickerThemeData?.rank ?? null;
  const resolvedThemeName = themeName ?? tickerThemeData?.themeName ?? null;
  const resolvedTotalThemes = totalThemes ?? tickerThemeData?.totalThemes ?? null;
  const [fontPrefs, setFontPrefs] = useState<ChartFooterFontPrefs>(() => loadChartFooterFontPrefs(undefined));

  useEffect(() => {
    setFontPrefs(loadChartFooterFontPrefs(user?.id));
  }, [user?.id]);

  const setFontSection = useCallback(
    (section: ChartFooterFontSection, px: number) => {
      setFontPrefs((prev) => {
        const next = { ...prev, [section]: px };
        saveChartFooterFontPrefs(user?.id, next);
        return next;
      });
    },
    [user?.id]
  );

  const row = setupInfo?.row;

  const targetH = footerTargetHeight ?? CHART_FOOTER_TOTAL_H;

  const todayVol = todayVolumeFromDaily(dailyData);
  const volTodayLabel =
    todayVol != null && chartMetrics?.avgVolume14d
      ? `${formatVolumeShort(todayVol)} (${(todayVol / chartMetrics.avgVolume14d).toFixed(2)}x)`
      : todayVol != null
        ? formatVolumeShort(todayVol)
        : "N/A";

  const amGapPct = (() => {
    const candles = dailyData?.candles;
    if (!candles || candles.length < 2) return null;
    const today = candles[candles.length - 1]!;
    const yesterday = candles[candles.length - 2]!;
    if (!yesterday.close || yesterday.close === 0) return null;
    return ((today.open - yesterday.close) / yesterday.close) * 100;
  })();

  const { pctFromLOD, pctFromHOD } = (() => {
    const candles = dailyData?.candles;
    if (!candles?.length || !chartMetrics?.currentPrice) return { pctFromLOD: null, pctFromHOD: null };
    const today = candles[candles.length - 1]!;
    const price = chartMetrics.currentPrice;
    const lod = today.low;
    const hod = today.high;
    return {
      pctFromLOD: lod > 0 ? ((price - lod) / lod) * 100 : null,
      pctFromHOD: hod > 0 ? ((price - hod) / hod) * 100 : null,
    };
  })();

  const rthPct = (() => {
    const candles = dailyData?.candles;
    if (!candles?.length || !chartMetrics?.currentPrice) return null;
    const today = candles[candles.length - 1]!;
    const todayOpen = today.open;
    if (!todayOpen || todayOpen === 0) return null;
    return ((chartMetrics.currentPrice - todayOpen) / todayOpen) * 100;
  })();

  const ethPct = (() => {
    if (!chartMetrics?.currentPrice) return null;
    // Find regular session close from intraday candles (last candle at or before 4:00 PM ET)
    const iCandles = intradayData?.candles;
    if (!iCandles?.length) return null;
    let rthClose: number | null = null;
    for (let i = iCandles.length - 1; i >= 0; i--) {
      const c = iCandles[i]!;
      const d = new Date(c.timestamp * 1000);
      const etH = parseInt(d.toLocaleString("en-US", { timeZone: "America/New_York", hour: "2-digit", hour12: false }), 10);
      const etM = parseInt(d.toLocaleString("en-US", { timeZone: "America/New_York", minute: "2-digit" }), 10);
      if (etH < 16 || (etH === 16 && etM === 0)) {
        rthClose = c.close;
        break;
      }
    }
    if (!rthClose || rthClose === 0) return null;
    const pct = ((chartMetrics.currentPrice - rthClose) / rthClose) * 100;
    if (Math.abs(pct) < 0.005) return null;
    return pct;
  })();

  const handleSectorClick = () => {

    if (chartMetrics?.sectorEtf && chartMetrics.sectorEtf !== "N/A" && onNavigateToTicker) {

      onNavigateToTicker(chartMetrics.sectorEtf);

    }

  };



  const panelClass = fillPanel
    ? "h-full min-h-0 overflow-hidden"
    : "flex-shrink-0";
  const boxClass = fillPanel
    ? "h-full min-h-0 overflow-y-auto overflow-x-hidden"
    : "flex-1 min-h-0";

  return (

    <div

      className={cn(
        panelClass,
        "grid grid-cols-2 gap-3 text-left items-stretch",
        !fillPanel && "flex-shrink-0"
      )}

      style={fillPanel ? { marginTop: CHART_FOOTER_GAP } : {
        minHeight: targetH,
        height: "fit-content",
        marginTop: CHART_FOOTER_GAP,
      }}

      data-testid={`${pid}fundamentals-row`}

    >

      <div
        className="flex min-w-0 min-h-0 flex-col"
        style={fillPanel ? undefined : { minHeight: targetH }}
      >
        <div
          className={cn(
            "flex flex-col rounded border border-border bg-background px-3 py-3 text-left",
            boxClass
          )}
          style={fillPanel ? { fontSize: fontPrefs.metrics } : { minHeight: targetH, fontSize: fontPrefs.metrics }}
          data-testid={`${pid}box-daily-metrics`}
        >
          <div className="mb-1.5 flex shrink-0 items-center justify-between gap-2">
            <span className="text-sm font-semibold uppercase tracking-wide text-sky-400">
              Daily metrics
            </span>
            <ChartFooterFontSizeControl
              section="metrics"
              value={fontPrefs.metrics}
              onChange={(px) => setFontSection("metrics", px)}
            />
          </div>
          {chartMetrics ? (
            <div className="grid w-full min-h-0 flex-1 grid-cols-3 items-start gap-x-3 overflow-y-auto overflow-x-hidden pr-0.5">
              <FooterColumn>
                <FooterInfoLine
                  label="14d Avg Vol"
                  value={formatVolumeShort(chartMetrics.avgVolume14d)}
                  testId={`${pid}metric-avg-vol-14d`}
                />
                <FooterInfoLine
                  label="Vol today"
                  value={volTodayLabel}
                  testId={`${pid}metric-vol-today`}
                />
                <FooterDivider />
                <FooterInfoLine
                  label="ADR (14d avg)"
                  value={
                    (chartMetrics.adr14Pct ?? chartMetrics.adr20Pct) != null
                      ? `${(chartMetrics.adr14Pct ?? chartMetrics.adr20Pct)?.toFixed(2)}%  ·  $${(chartMetrics.adr14Dollar ?? chartMetrics.adr20Dollar)?.toFixed(2)}`
                      : "N/A"
                  }
                  testId={`${pid}metric-adr14`}
                />
                <FooterInfoLine
                  label="ADRx50d"
                  value={
                    chartMetrics.extensionFrom50dAdr != null
                      ? `${chartMetrics.extensionFrom50dAdr >= 0 ? "+" : ""}${chartMetrics.extensionFrom50dAdr}`
                      : "N/A"
                  }
                  valueClassName={
                    chartMetrics.extensionFrom50dAdr == null ? undefined
                    : chartMetrics.extensionFrom50dAdr < 0 ? "text-rs-red"
                    : chartMetrics.extensionFrom50dAdr <= 3 ? "text-rs-green"
                    : "text-rs-yellow"
                  }
                  testId={`${pid}metric-50d-adr`}
                />
                <FooterInfoLine
                  label="ADRx20d"
                  value={
                    chartMetrics.extensionFrom20dAdr != null
                      ? `${chartMetrics.extensionFrom20dAdr >= 0 ? "+" : ""}${chartMetrics.extensionFrom20dAdr}`
                      : "N/A"
                  }
                  valueClassName={
                    chartMetrics.extensionFrom20dAdr == null ? undefined
                    : (chartMetrics.extensionFrom20dAdr < -2 || chartMetrics.extensionFrom20dAdr > 10) ? "text-rs-red"
                    : "text-rs-green"
                  }
                  testId={`${pid}metric-20d-adr`}
                />
                <FooterDivider />
                <FooterInfoLine
                  label={<>RTH<span title="% change from pre-market high to close (Regular Trading Hours)" className="cursor-help">*</span></>}
                  value={
                    rthPct != null
                      ? `${rthPct >= 0 ? "+" : ""}${rthPct.toFixed(2)}%`
                      : "—"
                  }
                  valueClassName={rthPct != null ? (rthPct >= 0 ? "text-rs-green" : "text-rs-red") : undefined}
                  testId={`${pid}metric-rth-pct`}
                />
                <FooterInfoLine
                  label={<>ETH<span title="% change since market close (Extended Trading Hours)" className="cursor-help">*</span></>}
                  value={
                    ethPct != null
                      ? `${ethPct >= 0 ? "+" : ""}${ethPct.toFixed(2)}%`
                      : "—"
                  }
                  valueClassName={ethPct != null ? (ethPct >= 0 ? "text-rs-green" : "text-rs-red") : undefined}
                  testId={`${pid}metric-eth-pct`}
                />
                <FooterDivider />
                <FooterInfoLine
                  label="% from LOD"
                  value={
                    pctFromLOD != null
                      ? `+${pctFromLOD.toFixed(2)}%`
                      : "N/A"
                  }
                  valueClassName={pctFromLOD != null ? "text-rs-green" : undefined}
                  testId={`${pid}metric-pct-lod`}
                />
                <FooterInfoLine
                  label="% from HOD"
                  value={
                    pctFromHOD != null
                      ? `${pctFromHOD >= 0 ? "+" : ""}${pctFromHOD.toFixed(2)}%`
                      : "N/A"
                  }
                  valueClassName={pctFromHOD != null && pctFromHOD < 0 ? "text-rs-red" : pctFromHOD != null ? "text-rs-green" : undefined}
                  testId={`${pid}metric-pct-hod`}
                />
              </FooterColumn>

              <FooterColumn>
                <FooterInfoLine
                  label="Last earnings"
                  value={chartMetrics.lastEpsSurprise}
                  valueClassName={epsSurpriseTone(chartMetrics.lastEpsSurprise)}
                  testId={`${pid}metric-eps-surprise`}
                />
                <FooterInfoLine
                  label="Next earnings"
                  value={
                    chartMetrics.nextEarningsDate !== "N/A"
                      ? `${chartMetrics.nextEarningsDate} (${chartMetrics.nextEarningsDays}d)${
                          chartMetrics.earningsTime === "bmo" ? " BMO"
                          : chartMetrics.earningsTime === "amc" ? " AMC"
                          : ""
                        }`
                      : "N/A"
                  }
                  valueClassName={
                    chartMetrics.nextEarningsDays >= 0 && chartMetrics.nextEarningsDays <= 7
                      ? "text-rs-yellow"
                      : undefined
                  }
                  testId={`${pid}metric-next-earnings`}
                />
                <FooterDivider />
                <FooterInfoLine
                  label="AM Gap"
                  value={
                    amGapPct != null
                      ? `${amGapPct >= 0 ? "+" : ""}${amGapPct.toFixed(2)}%`
                      : "N/A"
                  }
                  valueClassName={
                    amGapPct == null ? undefined
                    : amGapPct >= 0 ? "text-rs-green"
                    : "text-rs-red"
                  }
                  testId={`${pid}metric-am-gap`}
                />
                <FooterInfoLine
                  label="Theme Rank"
                  value={
                    resolvedThemeRank != null
                      ? `#${resolvedThemeRank}${resolvedTotalThemes ? ` / ${resolvedTotalThemes}` : ""}${resolvedThemeName ? ` · ${resolvedThemeName}` : ""}`
                      : "N/A"
                  }
                  valueClassName={
                    resolvedThemeRank == null ? undefined
                    : resolvedThemeRank <= 5 ? "text-rs-green"
                    : resolvedThemeRank <= 14 ? "text-gray-100"
                    : "text-rs-red"
                  }
                  testId={`${pid}metric-theme-rank`}
                />
              </FooterColumn>

              <FooterColumn>
                <FooterInfoLine
                  label="RS vs SPY"
                  value={
                    chartMetrics.rsVsSpy != null
                      ? `${chartMetrics.rsVsSpy >= 0 ? "+" : ""}${chartMetrics.rsVsSpy.toFixed(2)}%`
                      : chartMetrics.rsMomentum != null
                        ? `${chartMetrics.rsMomentum >= 0 ? "+" : ""}${chartMetrics.rsMomentum}%`
                        : "N/A"
                  }
                  valueClassName={
                    (chartMetrics.rsVsSpy ?? chartMetrics.rsMomentum ?? 0) >= 0
                      ? "text-rs-green"
                      : "text-rs-red"
                  }
                  testId={`${pid}metric-rs-spy`}
                />
                <FooterInfoLine
                  label="Sector"
                  value={
                    chartMetrics.sectorEtf !== "N/A" ? (
                      <span>
                        <span
                          className="cursor-pointer underline decoration-dotted"
                          onClick={handleSectorClick}
                          data-testid={`${pid}link-sector-etf`}
                        >
                          {chartMetrics.sectorEtf}
                        </span>
                        {chartMetrics.sectorName ? ` · ${chartMetrics.sectorName}` : ""}
                      </span>
                    ) : (
                      "N/A"
                    )
                  }
                  testId={`${pid}metric-sector-etf`}
                />
              </FooterColumn>
            </div>
          ) : null}
        </div>
      </div>



      <div

        className="min-h-0 flex flex-col h-full"

        style={fillPanel ? undefined : { minHeight: targetH }}

      >

        <SetupInfoPanel

          symbol={symbol}

          scanRow={row}

          dailyData={dailyData}

          intradayData={intradayData}

          chartMetrics={chartMetrics}

          intradayTimeframe={intradayTimeframe}

          themeId={themeId}

          themeRank={themeRank}

          chartsReady={chartsReady}

          testIdPrefix={testIdPrefix}

          contentFontPx={fontPrefs.setup}

          fontSizeControl={
            <ChartFooterFontSizeControl
              section="setup"
              value={fontPrefs.setup}
              onChange={(px) => setFontSection("setup", px)}
            />
          }

          themeBreakdownWatch={themeBreakdownWatch}

        />

      </div>

    </div>

  );

}


