import { useMemo } from "react";
import {
  useMarketCondition,
  useRAI,
  usePollingStatus,
  type ThemeMetrics,
} from "@/hooks/useMarketCondition";
import {
  MOCK_THEMES,
  MOCK_MARKET_SUMMARY,
  type ThemeRow,
  type ThemeId,
  type MarketConditionSummary,
} from "@/data/mockThemeData";

function convertToThemeRow(theme: ThemeMetrics): ThemeRow {
  return {
    id: theme.id as ThemeId,
    name: theme.name,
    tier: theme.tier,
    medianPct: theme.medianPct,
    score: theme.score,
    baseScore: theme.baseScore,
    breadthPct: theme.breadthPct,
    pctAbove50d: theme.pctAbove50d,
    pctAbove200d: theme.pctAbove200d,
    rsVsSpy: theme.rsVsBenchmark ?? theme.rsVsSpy ?? 0,
    volExp: theme.volExp ?? 1.0,
    acceleration: theme.acceleration,
    accDistDays: theme.accDistDays ?? 0,
    rank: theme.rank,
    deltaRank: theme.deltaRank,
    percentile: theme.percentile,
    penaltyFactor: theme.penaltyFactor,
    narrowLeadershipMultiplier: theme.narrowLeadershipMultiplier,
    reasonCodes: theme.reasonCodes as ThemeRow["reasonCodes"],
    coreCount: theme.coreCount,
    leaderCount: theme.greenCount,
    top3Contribution: theme.top3Contribution,
    top3Concentration: theme.top3Concentration ?? 0,
    isNarrowLeadership: theme.isNarrowLeadership ?? false,
    trendState: theme.trendState,
    bullCount: theme.bullCount,
    transitionCount: theme.transitionCount,
    bearCount: theme.bearCount,
    etfProxies: theme.etfProxies as ThemeRow["etfProxies"],
    historicalMetrics: theme.historicalMetrics,
  };
}

/** Live themes + summary for Start Here Market Flow strip (TODAY / all caps). */
export function useMarketFlowStripData() {
  const { data: pollingStatus } = usePollingStatus();
  const {
    data: marketCondition,
    isLoading: themesLoading,
    error: themesError,
  } = useMarketCondition({ timeSlice: "TODAY", sizeFilter: "ALL" });
  const { data: rai, isLoading: raiLoading } = useRAI();

  const hasLiveData =
    !themesError && !!marketCondition?.themes && marketCondition.themes.length > 0;

  const themes: ThemeRow[] = useMemo(() => {
    if (hasLiveData && marketCondition?.themes) {
      return marketCondition.themes.map(convertToThemeRow);
    }
    return MOCK_THEMES;
  }, [hasLiveData, marketCondition]);

  const marketSummary: MarketConditionSummary = useMemo(() => {
    if (hasLiveData && marketCondition && rai) {
      const sortedThemes = [...themes].sort((a, b) => b.score - a.score);
      return {
        regime:
          rai.label === "AGGRESSIVE"
            ? "RISK_ON"
            : rai.label === "DEFENSIVE"
              ? "RISK_OFF"
              : "NEUTRAL",
        spyPct: marketCondition.spyBenchmark?.changePct || 0,
        benchmarks: marketCondition.benchmarks as MarketConditionSummary["benchmarks"],
        overallBreadth:
          themes.length > 0
            ? themes.reduce((sum, t) => sum + t.breadthPct, 0) / themes.length
            : 50,
        leadersCount: themes.filter((t) => t.score >= 70).length,
        weakCount: themes.filter((t) => t.score < 40).length,
        topTheme: sortedThemes[0]?.id || "SEMIS",
        bottomTheme: sortedThemes[sortedThemes.length - 1]?.id || "ENERGY",
        rai: {
          score: rai.score,
          components: rai.components,
          label: rai.label,
          riskMultiplier: rai.riskMultiplier,
        },
        megaOverlay: MOCK_MARKET_SUMMARY.megaOverlay,
      } satisfies MarketConditionSummary;
    }
    return MOCK_MARKET_SUMMARY;
  }, [hasLiveData, marketCondition, rai, themes]);

  const lastUpdated = marketCondition?.lastUpdated
    ? new Date(marketCondition.lastUpdated)
    : undefined;

  return {
    summary: marketSummary,
    themes,
    lastUpdated,
    marketSession: pollingStatus?.marketSession,
    isLoading: themesLoading || raiLoading,
    hasLiveData,
    apiError: themesError,
  };
}
