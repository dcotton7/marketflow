/**
 * Fund Flow Module
 * Theme flow, sector flow, A/D streak, institutional activity
 */

import type { ModuleResponse, FundFlowData, Signal } from "../types";
import { getThemesForSymbol } from "../../utils/theme-db-loader";
import { getTickerAccDistMap } from "../../utils/ticker-acc-dist-loader";
import { getAllThemes } from "../../engine/snapshot";
import { getSectorAndIndustry } from "../../../fundamentals";
import { getSectorPerformance } from "../../exports";

export async function runFundFlow(symbol: string): Promise<ModuleResponse<FundFlowData>> {
  const start = Date.now();

  const [themes, accDistMap, allThemes, sectorIndustry, sectorPerf] = await Promise.all([
    Promise.resolve(getThemesForSymbol(symbol)),
    getTickerAccDistMap([symbol]).catch(() => new Map()),
    Promise.resolve(getAllThemes()),
    getSectorAndIndustry(symbol).catch(() => ({ sector: "Unknown", industry: "Unknown" })),
    getSectorPerformance(),
  ]);

  // Get ticker's A/D streak
  const accDistStreak = accDistMap.get(symbol) ?? 0;

  // Determine theme flow from theme scores
  let themeFlow: FundFlowData["themeFlow"] = "neutral";
  if (themes.length > 0) {
    const themeIds = themes.map((t) => t.id);
    const themeScores = allThemes
      .filter((t) => themeIds.includes(t.id))
      .map((t) => t.score);

    if (themeScores.length > 0) {
      const avgScore = themeScores.reduce((a, b) => a + b, 0) / themeScores.length;
      if (avgScore >= 60) themeFlow = "inflow";
      else if (avgScore <= 40) themeFlow = "outflow";
    }
  }

  // Determine sector flow from sector performance
  let sectorFlow: FundFlowData["sectorFlow"] = "neutral";
  const sectorRow = sectorPerf.find((s) => s.sector === sectorIndustry.sector);
  if (sectorRow) {
    if (sectorRow.changePct >= 0.5) sectorFlow = "inflow";
    else if (sectorRow.changePct <= -0.5) sectorFlow = "outflow";
  }

  // Determine institutional activity from A/D streak
  let institutionalActivity: FundFlowData["institutionalActivity"] = "neutral";
  if (accDistStreak >= 3) {
    institutionalActivity = "accumulation";
  } else if (accDistStreak <= -3) {
    institutionalActivity = "distribution";
  }

  // Determine signal
  let signal: Signal = "neutral";
  const flags: string[] = [];

  if (themeFlow === "inflow" && sectorFlow === "inflow") {
    signal = "bullish";
    flags.push("STRONG_FLOW_TAILWIND");
  } else if (themeFlow === "outflow" || sectorFlow === "outflow") {
    if (themeFlow === "outflow" && sectorFlow === "outflow") {
      signal = "bearish";
      flags.push("FLOW_HEADWIND");
    } else {
      signal = "warning";
      flags.push("MIXED_FLOW");
    }
  }

  if (institutionalActivity === "accumulation") {
    flags.push("INSTITUTIONAL_ACCUMULATION");
    if (signal !== "bearish") signal = "bullish";
  } else if (institutionalActivity === "distribution") {
    flags.push("INSTITUTIONAL_DISTRIBUTION");
    if (signal !== "bullish") signal = "bearish";
  }

  const confidence = calculateFlowConfidence(themeFlow, sectorFlow, institutionalActivity, accDistStreak);
  const summary = buildFlowSummary(symbol, themeFlow, sectorFlow, accDistStreak, institutionalActivity);

  return {
    module_id: "fundFlow",
    ticker: symbol,
    signal,
    summary,
    confidence,
    flags,
    executionMs: Date.now() - start,
    data: {
      themeFlow,
      sectorFlow,
      accDistStreak,
      institutionalActivity,
    },
  };
}

function calculateFlowConfidence(
  themeFlow: string,
  sectorFlow: string,
  instActivity: string,
  adStreak: number
): number {
  let confidence = 50;

  // Alignment of flows
  if (themeFlow === sectorFlow && themeFlow !== "neutral") {
    confidence += 15;
  }

  // Strong A/D streak
  const absStreak = Math.abs(adStreak);
  if (absStreak >= 5) confidence += 20;
  else if (absStreak >= 3) confidence += 10;

  // Institutional activity confirmation
  if (instActivity !== "neutral") {
    confidence += 10;
  }

  return Math.max(0, Math.min(100, confidence));
}

function buildFlowSummary(
  symbol: string,
  themeFlow: string,
  sectorFlow: string,
  adStreak: number,
  instActivity: string
): string {
  const parts: string[] = [];

  // Theme flow
  if (themeFlow === "inflow") {
    parts.push(`Theme flow: inflow (rotation into ${symbol}'s themes).`);
  } else if (themeFlow === "outflow") {
    parts.push(`Theme flow: outflow (rotation away from ${symbol}'s themes).`);
  } else {
    parts.push("Theme flow: neutral.");
  }

  // Sector flow
  if (sectorFlow === "inflow") {
    parts.push("Sector is seeing buying.");
  } else if (sectorFlow === "outflow") {
    parts.push("Sector is under pressure.");
  }

  // A/D streak
  if (adStreak !== 0) {
    const direction = adStreak > 0 ? "accumulation" : "distribution";
    parts.push(`A/D streak: ${Math.abs(adStreak)} days of ${direction}.`);
  }

  // Institutional summary
  if (instActivity === "accumulation") {
    parts.push("Signs of institutional accumulation.");
  } else if (instActivity === "distribution") {
    parts.push("Signs of institutional distribution.");
  }

  return parts.join(" ");
}
