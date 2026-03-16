/**
 * Market Context Module
 * Sector rank, theme membership, regime, RAI, RS vs SPY
 */

import type { ModuleResponse, MarketContextData, Signal } from "../types";
import { getFundamentals } from "../../../fundamentals";
import { getSectorPerformance } from "../../exports";
import { getThemesForSymbol } from "../../utils/theme-db-loader";
import { getMarketRegimeForScanner } from "../../exports";
import { getQuote, getSPYQuote } from "../../../data-layer/quotes";

export async function runMarketContext(symbol: string): Promise<ModuleResponse<MarketContextData>> {
  const start = Date.now();

  const [fundamentals, sectorPerf, themes, regime, quote, spyQuote] = await Promise.all([
    getFundamentals(symbol).catch(() => ({ sector: "Unknown", industry: "Unknown", marketCap: 0, companyName: symbol })),
    getSectorPerformance(),
    Promise.resolve(getThemesForSymbol(symbol)),
    Promise.resolve(getMarketRegimeForScanner()),
    getQuote(symbol).catch(() => null),
    getSPYQuote().catch(() => null),
  ]);

  const companyName = fundamentals.companyName || symbol;
  const sectorRow = sectorPerf.find((s) => s.sector === fundamentals.sector);
  const sectorRank = sectorRow?.rank ?? 11;
  const sectorChangePct = sectorRow?.changePct ?? 0;

  const stockChangePct = quote?.changePct ?? 0;
  const spyChangePct = spyQuote?.changePct ?? 0;
  const rsVsSpy = stockChangePct - spyChangePct;

  // Determine signal
  let signal: Signal = "neutral";
  const flags: string[] = [];

  if (regime.regime === "RISK_ON" && sectorRank <= 3 && rsVsSpy > 0) {
    signal = "bullish";
  } else if (regime.regime === "RISK_OFF") {
    signal = "bearish";
    flags.push("REGIME_RISK_OFF");
  } else if (sectorRank >= 9) {
    signal = "warning";
    flags.push("WEAK_SECTOR");
  }

  if (themes.length === 0) {
    flags.push("NO_THEME_MEMBERSHIP");
  }

  const confidence = calculateContextConfidence(regime.regime, sectorRank, rsVsSpy, themes.length);

  const summary = buildContextSummary(
    symbol,
    fundamentals.sector,
    sectorRank,
    sectorChangePct,
    themes,
    regime.regime,
    regime.raiScore,
    rsVsSpy
  );

  return {
    module_id: "marketContext",
    ticker: symbol,
    signal,
    summary,
    confidence,
    flags,
    executionMs: Date.now() - start,
    data: {
      companyName,
      sector: fundamentals.sector,
      industry: fundamentals.industry,
      themes,
      sectorRank,
      sectorChangePct,
      sectorPerformance: sectorPerf,
      regime: regime.regime,
      raiScore: regime.raiScore,
      raiLabel: regime.raiLabel,
      spyChangePct,
      rsVsSpy,
    },
  };
}

function calculateContextConfidence(
  regime: string,
  sectorRank: number,
  rsVsSpy: number,
  themeCount: number
): number {
  let score = 50;

  // Regime alignment
  if (regime === "RISK_ON") score += 15;
  else if (regime === "RISK_OFF") score -= 15;

  // Sector strength
  if (sectorRank <= 3) score += 15;
  else if (sectorRank <= 6) score += 5;
  else if (sectorRank >= 9) score -= 15;

  // Relative strength
  if (rsVsSpy > 2) score += 10;
  else if (rsVsSpy > 0) score += 5;
  else if (rsVsSpy < -2) score -= 10;

  // Theme membership
  if (themeCount > 0) score += 5;

  return Math.max(0, Math.min(100, score));
}

function buildContextSummary(
  symbol: string,
  sector: string,
  sectorRank: number,
  sectorChangePct: number,
  themes: Array<{ id: string; name: string }>,
  regime: string,
  raiScore: number,
  rsVsSpy: number
): string {
  const parts: string[] = [];

  // Sector context
  const sectorDirection = sectorChangePct >= 0 ? "up" : "down";
  parts.push(`${symbol} is in ${sector} (rank #${sectorRank}/11, ${sectorDirection} ${Math.abs(sectorChangePct).toFixed(2)}% today).`);

  // Theme context
  if (themes.length > 0) {
    const themeNames = themes.slice(0, 3).map((t) => t.name).join(", ");
    parts.push(`Themes: ${themeNames}.`);
  }

  // Regime context
  const regimeLabel = regime === "RISK_ON" ? "risk-on" : regime === "RISK_OFF" ? "risk-off" : "neutral";
  parts.push(`Market regime: ${regimeLabel} (RAI ${raiScore.toFixed(0)}).`);

  // RS context
  const rsLabel = rsVsSpy > 1 ? "outperforming" : rsVsSpy < -1 ? "underperforming" : "in-line with";
  parts.push(`${symbol} is ${rsLabel} SPY by ${rsVsSpy >= 0 ? "+" : ""}${rsVsSpy.toFixed(2)}%.`);

  return parts.join(" ");
}
