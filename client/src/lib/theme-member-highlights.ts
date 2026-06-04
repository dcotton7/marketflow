import type { TickerMetrics } from "@/hooks/useMarketCondition";
import type { ThemeRow } from "@/data/mockThemeData";

export interface ThemeMemberHighlight {
  symbol: string;
  pctChange: number;
  rsVsSpy: number;
  tag?: "leader" | "laggard" | "narrow-driver";
}

export function pickThemeMemberHighlights(
  members: TickerMetrics[],
  theme: ThemeRow,
  limit = 4
): ThemeMemberHighlight[] {
  if (!members.length) return [];

  const sorted = [...members].sort((a, b) => b.pctChange - a.pctChange);
  const top = sorted.slice(0, Math.min(3, limit));
  const bottom =
    limit > 3 && sorted.length > 3
      ? [sorted[sorted.length - 1]!]
      : [];

  const narrowDriverSymbols = new Set<string>();
  if (theme.isNarrowLeadership && top.length >= 2) {
    for (const m of top.slice(0, 3)) {
      if (m.pctChange > 0) narrowDriverSymbols.add(m.symbol);
    }
  }

  const picks: ThemeMemberHighlight[] = [];
  for (const m of top) {
    picks.push({
      symbol: m.symbol,
      pctChange: m.pctChange,
      rsVsSpy: m.rsVsBenchmark ?? m.rsVsSpy ?? 0,
      tag: narrowDriverSymbols.has(m.symbol) ? "narrow-driver" : "leader",
    });
  }
  for (const m of bottom) {
    if (picks.some((p) => p.symbol === m.symbol)) continue;
    picks.push({
      symbol: m.symbol,
      pctChange: m.pctChange,
      rsVsSpy: m.rsVsBenchmark ?? m.rsVsSpy ?? 0,
      tag: "laggard",
    });
  }

  return picks.slice(0, limit);
}
