import type { ChartDataResponse, ChartMetrics } from "@/components/DualChartGrid";

import type { TickerReviewResultRow } from "@/lib/ticker-review-engine";

import type { ChartEnrichBarSummary, ChartSetupEnrichDossier } from "@shared/chart-setup-enrich";

import { resolveChartSetupBaseMeta } from "@shared/chart-setup-base-meta";
import { resolveChartSetupUrMeta } from "@shared/chart-setup-ur-meta";
import { computeChartSetupStructureMeta } from "@shared/chart-setup-structure-meta";

import type { BreakdownWatchAssessment } from "@shared/theme-breakdown-watch";



function summarizeBars(candles: ChartDataResponse["candles"] | undefined, max = 30): ChartEnrichBarSummary[] {

  if (!candles?.length) return [];

  const tail = candles.slice(-max);

  return tail.map((c) => ({

    date: String(c.date),

    open: Number(c.open),

    high: Number(c.high),

    low: Number(c.low),

    close: Number(c.close),

    volume: Number(c.volume ?? 0),

  }));

}



export function buildChartSetupDossier(input: {

  symbol: string;

  intradayTimeframe: string;

  includeVisual?: boolean;

  dailyData?: ChartDataResponse;

  intradayData?: ChartDataResponse;

  chartMetrics?: ChartMetrics | null;

  scanRow?: TickerReviewResultRow | null;

  themeId?: string | null;

  themeRank?: number | null;

  themeBreakdownWatch?: BreakdownWatchAssessment | null;

}): ChartSetupEnrichDossier {

  const row = input.scanRow;

  const dailyCandles = input.dailyData?.candles;

  const indicators = input.dailyData?.indicators;



  const baseMeta = resolveChartSetupBaseMeta({
    dailyCandles,
    sma200Series: indicators?.sma200,
    sma50Series: indicators?.sma50,
    lastSessionPct: row?.lastSessionPct ?? null,
    pctVs20: row?.structure?.pctVs20 ?? input.chartMetrics?.extensionFrom20d ?? null,
    pctVs50: row?.structure?.pctVs50 ?? input.chartMetrics?.extensionFrom50dPct ?? null,
    pctVs200: row?.structure?.pctVs200 ?? input.chartMetrics?.extensionFrom200d ?? null,
    scanRow: row,
  });

  const urMeta = resolveChartSetupUrMeta({
    dailyCandles,
    sma21Series: indicators?.sma21,
    sma50Series: indicators?.sma50,
    scanRow: row,
  });

  const structureMeta = computeChartSetupStructureMeta({

    dailyCloses: dailyCandles?.map((c) => Number(c.close)).filter((n) => Number.isFinite(n)),

    sma20Series: indicators?.sma21,

    sma50Series: indicators?.sma50,

    sma200Series: indicators?.sma200,

    currentPrice: input.chartMetrics?.currentPrice,

    pctVs20: row?.structure?.pctVs20 ?? input.chartMetrics?.extensionFrom20d ?? null,

    pctVs50: row?.structure?.pctVs50 ?? input.chartMetrics?.extensionFrom50dPct ?? null,

    pctVs200: row?.structure?.pctVs200 ?? input.chartMetrics?.extensionFrom200d ?? null,

    rsVsSpy: input.chartMetrics?.rsVsSpy ?? row?.rs?.vsSpy ?? null,

    lastSessionPct: row?.lastSessionPct ?? null,

    urReclaimInPlay: urMeta.detected || urMeta.buyableNow || (row?.firedOptional?.includes("O5") ?? false),

    themeBreakdownWatch: input.themeBreakdownWatch ?? null,

    baseBelow200dBuilt: baseMeta.baseBelow200d ?? false,

    reclaim200dOnLastBar: baseMeta.reclaim200d?.justOnLastBar ?? false,

    powerSetup: baseMeta.powerSetup ?? false,

  });



  return {

    symbol: input.symbol.toUpperCase(),

    intradayTimeframe: input.intradayTimeframe,

    includeVisual: Boolean(input.includeVisual),

    dailyBars: summarizeBars(dailyCandles, 120),

    intradayBars: summarizeBars(input.intradayData?.candles, 40),

    metrics: input.chartMetrics

      ? {

          currentPrice: input.chartMetrics.currentPrice,

          adr20Pct: input.chartMetrics.adr20Pct,

          extensionFrom50dPct: input.chartMetrics.extensionFrom50dPct,

          extensionFrom50dAdr: input.chartMetrics.extensionFrom50dAdr,

          extensionFrom20d: input.chartMetrics.extensionFrom20d,

          extensionFrom200d: input.chartMetrics.extensionFrom200d,

          rsVsSpy: input.chartMetrics.rsVsSpy,

          themeRank: input.chartMetrics.themeRank,

          themeName: input.chartMetrics.themeName,

          sectorEtf: input.chartMetrics.sectorEtf,

        }

      : null,

    scanRow: row

      ? {

          symbol: row.symbol,

          bucket: row.bucket,

          setupNarrative: row.setupNarrative,

          summaryLines: row.summaryLines,

          firedOptional: row.firedOptional,

          patternHits: row.patternHits,

          structure: row.structure,

          rs: row.rs,

          lastSessionPct: row.lastSessionPct,

        }

      : null,

    themeId: input.themeId ?? null,

    themeRank: input.themeRank ?? null,

    structureMeta,

    baseMeta,

    urMeta,

  };

}


