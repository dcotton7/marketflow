import { getAllThemes } from "../market-condition/engine/snapshot";
import { getThemeMembersFromCache } from "../market-condition/utils/theme-db-loader";
import type { ClusterId } from "../market-condition/universe";
import { getUniverseTickers } from "./universes";

export interface MarketFlowThemeSummary {
  id: string;
  name: string;
  rank: number;
  score: number;
  memberCount: number;
}

export interface MarketFlowUniverseResult {
  tickers: string[];
  themes: MarketFlowThemeSummary[];
  topN: number;
  coreOnly: boolean;
}

const MARKETFLOW_UNIVERSE_RE = /^marketflow-top-(\d+)(?:-(core|candidates))?$/;

export function parseMarketFlowUniverse(universe: string): { topN: number; coreOnly: boolean } | null {
  const match = universe.match(MARKETFLOW_UNIVERSE_RE);
  if (!match) return null;
  return {
    topN: Math.max(1, Math.min(10, parseInt(match[1], 10))),
    coreOnly: match[2] === "core",
  };
}

export function isMarketFlowUniverse(universe: string): boolean {
  return MARKETFLOW_UNIVERSE_RE.test(universe);
}

export function marketFlowUniverseLabel(topN: number, coreOnly = false): string {
  const scope = coreOnly ? " (core only)" : "";
  return `MarketFlow Top ${topN}${scope}`;
}

/**
 * Resolve tickers from the leading N themes by Flow rank/score.
 */
export function resolveMarketFlowUniverseTickers(topN: number, coreOnly = false): MarketFlowUniverseResult {
  const leadingThemes = [...getAllThemes()]
    .sort((a, b) => {
      const rankA = a.rank || 999;
      const rankB = b.rank || 999;
      if (rankA !== rankB) return rankA - rankB;
      return b.score - a.score;
    })
    .slice(0, topN);

  const tickers = new Set<string>();
  const themes: MarketFlowThemeSummary[] = [];

  for (const theme of leadingThemes) {
    const members = getThemeMembersFromCache(theme.id as ClusterId);
    const filtered = coreOnly ? members.filter((m) => m.isCore) : members;
    filtered.forEach((m) => tickers.add(m.symbol.toUpperCase()));
    themes.push({
      id: theme.id,
      name: theme.name,
      rank: theme.rank,
      score: theme.score,
      memberCount: filtered.length,
    });
  }

  return {
    tickers: Array.from(tickers).sort(),
    themes,
    topN,
    coreOnly,
  };
}

export function resolveScanUniverseTickers(
  universe: string,
  customTickers?: string[] | null
): { tickers: string[]; marketFlow?: MarketFlowUniverseResult } {
  if (customTickers && customTickers.length > 0) {
    return { tickers: customTickers.map((t) => t.toUpperCase()) };
  }

  const parsed = parseMarketFlowUniverse(universe);
  if (parsed) {
    const marketFlow = resolveMarketFlowUniverseTickers(parsed.topN, parsed.coreOnly);
    return { tickers: marketFlow.tickers, marketFlow };
  }

  return { tickers: getUniverseTickers(universe) };
}
