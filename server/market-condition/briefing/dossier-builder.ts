import { and, eq } from "drizzle-orm";
import { getDb } from "../../db";
import { themeSnapshots } from "@shared/schema";
import { fetchCompanyNews } from "../../finnhub";
import type { ClusterId } from "../universe";
import {
  getMarketCondition,
  getClusterMembers,
  touchActivity,
  BENCHMARK_SYMBOLS,
  type BenchmarkSymbol,
} from "../engine/snapshot";
import type { ThemeMetrics } from "../engine/theme-score";
import {
  listIntradaySnapshotSlots,
  getOpenBaselineSnapshot,
  getCloseBaselineSnapshot,
  getLateSessionBaselineSnapshot,
  type HistoricalThemeMetrics,
} from "../engine/theme-snapshots";
import type { BriefingSessionContext } from "./session-context";
import { getMarketDateTime } from "../utils/theme-tracker-time";
import type {
  BriefingBenchmark,
  BriefingCatalyst,
  BriefingDataQuality,
  BriefingMemberMove,
  BriefingThemeRow,
  ThemeBriefingDossier,
} from "./types";
import { EXPECTED_INTRADAY_SLOTS } from "./types";

function toThemeRow(
  t: ThemeMetrics,
  deltaRankFromOpen: number,
  deltaRankLate: number
): BriefingThemeRow {
  return {
    id: t.id,
    name: t.name,
    rank: t.rank,
    score: t.score,
    medianPct: t.medianPct,
    rsVsBenchmark: t.rsVsBenchmark,
    breadthPct: t.breadthPct,
    deltaRankFromOpen,
    deltaRankLate,
    isNarrowLeadership: t.isNarrowLeadership,
    breakdownTier: t.breakdownWatch?.tier ?? null,
    trendState: t.trendState,
  };
}

function classifyRotation(benchmarks: BriefingBenchmark[]): string {
  const spy = benchmarks.find((b) => b.symbol === "SPY")?.changePct ?? 0;
  const qqq = benchmarks.find((b) => b.symbol === "QQQ")?.changePct ?? 0;
  const iwm = benchmarks.find((b) => b.symbol === "IWM")?.changePct ?? 0;
  const spread = iwm - qqq;
  if (spread > 1.5 && qqq < 0) return "small_cap_leadership_tech_weak";
  if (qqq < -0.5 && spy > 0) return "rotation_out_of_growth";
  if (qqq > 0.5 && spy > 0) return "growth_risk_on";
  if (spy < -0.3 && qqq < -0.3) return "broad_weakness";
  return "mixed_session";
}

function rotationLabel(character: string): string {
  switch (character) {
    case "small_cap_leadership_tech_weak":
      return "Small caps led while growth/QQQ lagged — classic breadth rotation.";
    case "rotation_out_of_growth":
      return "Value/broad market held up while growth names underperformed.";
    case "growth_risk_on":
      return "Growth and broad market advanced together.";
    case "broad_weakness":
      return "Broad risk-off tone across major indices.";
    default:
      return "Mixed session without a dominant index spread.";
  }
}

async function loadDailyCloseRows(marketDate: string) {
  const db = getDb();
  if (!db) return [];
  return db
    .select()
    .from(themeSnapshots)
    .where(and(eq(themeSnapshots.snapshotType, "daily_close"), eq(themeSnapshots.marketDate, marketDate)));
}

function historicalMetricsToThemes(
  metrics: Map<string, HistoricalThemeMetrics>,
  nameMap: Map<string, string>
): ThemeMetrics[] {
  const themes: ThemeMetrics[] = [];
  for (const [id, m] of metrics) {
    themes.push({
      id: id as ClusterId,
      name: nameMap.get(id) ?? id,
      rank: m.rank,
      score: m.score,
      medianPct: m.medianPct,
      rsVsBenchmark: m.rsVsBenchmark,
      breadthPct: m.breadthPct,
      deltaRank: 0,
      isNarrowLeadership: false,
      trendState: "Transition" as const,
    } as ThemeMetrics);
  }
  themes.sort((a, b) => a.rank - b.rank);
  return themes;
}

function deltaRankMaps(
  closeMetrics: Map<string, HistoricalThemeMetrics>,
  baselineMetrics: Map<string, HistoricalThemeMetrics> | undefined
): Map<ClusterId, number> {
  const deltas = new Map<ClusterId, number>();
  if (!baselineMetrics) return deltas;
  for (const [id, close] of closeMetrics) {
    const base = baselineMetrics.get(id);
    if (base !== undefined) {
      deltas.set(id as ClusterId, base.rank - close.rank);
    }
  }
  return deltas;
}

function buildTopMembers(storyThemes: BriefingThemeRow[]): BriefingMemberMove[] {
  const moves: BriefingMemberMove[] = [];
  for (const theme of storyThemes.slice(0, 5)) {
    const members = getClusterMembers(theme.id);
    if (!members.length) continue;
    const sorted = [...members].sort((a, b) => b.rsVsBenchmark - a.rsVsBenchmark);
    const leaders = sorted.slice(0, 2);
    const draggers = sorted.slice(-2).filter((m) => m.pctChange < 0);
    for (const m of leaders) {
      moves.push({
        symbol: m.symbol,
        themeId: theme.id,
        themeName: theme.name,
        pctChange: m.pctChange,
        rsVsBenchmark: m.rsVsBenchmark,
        role: "leader",
      });
    }
    for (const m of draggers) {
      moves.push({
        symbol: m.symbol,
        themeId: theme.id,
        themeName: theme.name,
        pctChange: m.pctChange,
        rsVsBenchmark: m.rsVsBenchmark,
        role: "dragger",
      });
    }
  }
  return moves;
}

async function buildCatalysts(
  themes: BriefingThemeRow[],
  topMembers: BriefingMemberMove[],
  rotationCharacter: string
): Promise<BriefingCatalyst[]> {
  const catalysts: BriefingCatalyst[] = [];

  catalysts.push({
    themeId: themes[0]?.id ?? ("SPACE_FRONTIER" as ClusterId),
    themeName: "Market",
    symbols: ["SPY", "QQQ", "IWM"],
    type: "rotation",
    headline: rotationLabel(rotationCharacter),
    confidence: "medium",
    direction: "context",
  });

  const symbols = new Set<string>();
  for (const m of topMembers.filter((x) => Math.abs(x.pctChange) >= 3).slice(0, 6)) {
    symbols.add(m.symbol);
  }

  const symbolList = Array.from(symbols).slice(0, 4);
  const newsResults = await Promise.allSettled(
    symbolList.map(async (sym) => {
      const member = topMembers.find((m) => m.symbol === sym);
      if (!member) return null;
      const news = await fetchCompanyNews(sym, 2);
      const headline = news[0]?.headline;
      if (!headline) return null;
      const move = member.pctChange;
      return {
        themeId: member.themeId,
        themeName: member.themeName,
        symbols: [sym],
        type: "news" as const,
        headline: headline.slice(0, 200),
        confidence: (Math.abs(move) >= 8 ? "high" : "medium") as BriefingCatalyst["confidence"],
        direction: (move >= 0 ? "supports_strength" : "supports_weakness") as BriefingCatalyst["direction"],
      };
    })
  );

  for (const result of newsResults) {
    if (result.status === "fulfilled" && result.value) {
      catalysts.push(result.value);
    }
  }

  return catalysts.slice(0, 12);
}

export async function buildThemeBriefingDossier(
  session: BriefingSessionContext
): Promise<ThemeBriefingDossier> {
  touchActivity();

  const warnings: string[] = [];
  let openComparisonTime: string | null = null;
  let lateComparisonTime: string | null = null;
  let openBaselineAvailable = false;
  let lateBaselineAvailable = false;
  let dailyCloseAvailable = false;

  const slots = await listIntradaySnapshotSlots(session.referenceSession);
  const slotCount = slots.length;

  if (session.sessionFallbackNote) {
    warnings.push(session.sessionFallbackNote);
  }

  if (slotCount === 0) {
    warnings.push(
      `No 15-minute theme snapshots stored for ${session.referenceSession} — intraday rotation sections omitted.`
    );
  } else if (slotCount < EXPECTED_INTRADAY_SLOTS * 0.5) {
    warnings.push(`Partial intraday tape: ${slotCount}/${EXPECTED_INTRADAY_SLOTS} snapshot slots stored.`);
  }

  let baseThemes: ThemeMetrics[] = [];
  let openDeltaById = new Map<ClusterId, number>();
  let lateDeltaById = new Map<ClusterId, number>();
  let benchmarks: BriefingBenchmark[] = [];

  if (session.mode === "post") {
    const sessionDate = session.referenceSession;
    const nameMap = new Map<string, string>();
    for (const t of getMarketCondition().themes) nameMap.set(t.id, t.name);

    const [closeSnap, openSnap, lateSnap] = await Promise.all([
      getCloseBaselineSnapshot(sessionDate),
      getOpenBaselineSnapshot(sessionDate),
      getLateSessionBaselineSnapshot(sessionDate),
    ]);

    if (closeSnap?.metrics.size) {
      baseThemes = historicalMetricsToThemes(closeSnap.metrics, nameMap);
      dailyCloseAvailable = true;
    } else {
      const dailyRows = await loadDailyCloseRows(sessionDate);
      dailyCloseAvailable = dailyRows.length > 0;
      if (dailyCloseAvailable) {
        baseThemes = dailyRows.map((row) => ({
          id: row.themeId as ClusterId,
          name: nameMap.get(row.themeId) ?? row.themeId,
          rank: row.rank,
          score: row.score ?? 0,
          medianPct: row.medianPct ?? 0,
          rsVsBenchmark: row.rsVsBenchmark ?? 0,
          breadthPct: row.breadthPct ?? 0,
          deltaRank: 0,
          isNarrowLeadership: false,
          trendState: "Transition" as const,
        })) as ThemeMetrics[];
        baseThemes.sort((a, b) => a.rank - b.rank);
      } else {
        warnings.push(
          `No stored close snapshot for ${sessionDate} — using latest live theme ranks as fallback.`
        );
        baseThemes = getMarketCondition().themes;
      }
    }

    if (closeSnap && openSnap) {
      openDeltaById = deltaRankMaps(closeSnap.metrics, openSnap.metrics);
      openComparisonTime = openSnap.comparisonTime;
      openBaselineAvailable = !!openComparisonTime;
    } else if (!openSnap) {
      warnings.push(
        `No open baseline (≥9:30 ET) stored for ${sessionDate} — open→close rotation omitted.`
      );
    }

    if (closeSnap && lateSnap) {
      lateDeltaById = deltaRankMaps(closeSnap.metrics, lateSnap.metrics);
      lateComparisonTime = lateSnap.comparisonTime;
      lateBaselineAvailable = !!lateComparisonTime;
    } else if (slotCount >= 2 && !lateSnap) {
      warnings.push(`Late-session baseline unavailable for ${sessionDate}.`);
    }

    const { date: todayEt } = getMarketDateTime();
    const liveBm = getMarketCondition().benchmarks ?? {};
    benchmarks = BENCHMARK_SYMBOLS.map((symbol: BenchmarkSymbol) => ({
      symbol,
      changePct: liveBm[symbol]?.changePct ?? 0,
      price: liveBm[symbol]?.price,
    }));
    if (sessionDate !== todayEt) {
      warnings.push(
        `Index strip uses latest live quotes; theme ranks and rotation are from stored ${sessionDate} session.`
      );
    }
  } else {
    const dailyRows = await loadDailyCloseRows(session.referenceSession);
    dailyCloseAvailable = dailyRows.length > 0;

    if (dailyCloseAvailable) {
      const nameMap = new Map<string, string>();
      for (const t of getMarketCondition().themes) nameMap.set(t.id, t.name);

      baseThemes = dailyRows.map((row) => ({
        id: row.themeId as ClusterId,
        name: nameMap.get(row.themeId) ?? row.themeId,
        rank: row.rank,
        score: row.score ?? 0,
        medianPct: row.medianPct ?? 0,
        rsVsBenchmark: row.rsVsBenchmark ?? 0,
        breadthPct: row.breadthPct ?? 0,
        deltaRank: 0,
        isNarrowLeadership: false,
        trendState: "Transition" as const,
      })) as ThemeMetrics[];

      baseThemes.sort((a, b) => a.rank - b.rank);
    } else {
      warnings.push(
        `No daily_close snapshot for ${session.referenceSession} — using latest live theme ranks as fallback.`
      );
      baseThemes = getMarketCondition().themes;
    }

    if (slots.length >= 2) {
      lateBaselineAvailable = true;
      lateComparisonTime = slots[slots.length - 2]?.at ?? null;
    }

    const bm = getMarketCondition().benchmarks ?? {};
    benchmarks = BENCHMARK_SYMBOLS.map((symbol: BenchmarkSymbol) => ({
      symbol,
      changePct: bm[symbol]?.changePct ?? 0,
      price: bm[symbol]?.price,
    }));
    warnings.push("Pre-market mode: theme ranks reflect prior RTH close; overnight moves are not re-ranked.");
  }

  const themeRows: BriefingThemeRow[] = baseThemes.map((t) =>
    toThemeRow(
      t,
      openDeltaById.get(t.id) ?? 0,
      lateDeltaById.get(t.id) ?? 0
    )
  );

  themeRows.sort((a, b) => a.rank - b.rank);

  const leaders = themeRows.slice(0, 5);
  const laggards = [...themeRows].sort((a, b) => b.rank - a.rank).slice(0, 5);
  const lateRotators = [...themeRows]
    .filter((t) => t.deltaRankLate !== 0)
    .sort((a, b) => b.deltaRankLate - a.deltaRankLate);
  const openRotators = [...themeRows]
    .filter((t) => t.deltaRankFromOpen !== 0)
    .sort((a, b) => b.deltaRankFromOpen - a.deltaRankFromOpen);

  const rotationCharacter = classifyRotation(benchmarks);
  const storyThemes = [...leaders, ...lateRotators.slice(0, 3), ...laggards.slice(0, 2)];
  const uniqueStory = Array.from(new Map(storyThemes.map((t) => [t.id, t])).values());
  const topMembers = buildTopMembers(uniqueStory);
  const catalysts = await buildCatalysts(themeRows, topMembers, rotationCharacter);

  const synthesisAvailable = !!(
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY
  );

  const dataQuality: BriefingDataQuality = {
    intradaySlots: {
      available: slotCount,
      expected: EXPECTED_INTRADAY_SLOTS,
      complete: slotCount >= EXPECTED_INTRADAY_SLOTS * 0.9,
    },
    dailyCloseAvailable,
    openBaselineAvailable,
    lateBaselineAvailable,
    extendedQuotesAvailable: false,
    synthesisAvailable,
    warnings,
  };

  return {
    mode: session.mode,
    referenceSession: session.referenceSession,
    priorSession: session.priorSession,
    generatedAt: new Date().toISOString(),
    terminalState: session.terminalState,
    rotationCharacter,
    benchmarks,
    comparisonTimeOpen: openComparisonTime,
    comparisonTimeLate: lateComparisonTime,
    themes: themeRows,
    leaders,
    laggards,
    lateRotators,
    openRotators,
    topMembers,
    catalysts,
    dataQuality,
  };
}
