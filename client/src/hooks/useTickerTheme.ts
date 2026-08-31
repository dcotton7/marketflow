import { useQuery } from "@tanstack/react-query";

/**
 * How the theme was arrived at. "member" is the only one that is a fact: the
 * ticker is in the theme. "auto" came from its sector and industry, "llm" from
 * a model asked because nothing else placed it. Both of those are suggestions
 * and should be shown as such.
 */
export type TickerThemeSource = "member" | "auto" | "llm";

export interface TickerThemeInfo {
  themeId: string | null;
  themeName: string | null;
  rank: number | null;
  totalThemes: number | null;
  score?: number | null;
  medianPct?: number | null;
  breadthPct?: number | null;
  rsVsBenchmark?: number | null;
  acceleration?: number | null;
  source?: TickerThemeSource | null;
  /** What a guess was made from — an industry string, or "model". */
  basis?: string | null;
}

const EMPTY: TickerThemeInfo = {
  themeId: null,
  themeName: null,
  rank: null,
  totalThemes: null,
  source: null,
};

/**
 * Which theme a ticker sits in. Shared so the chart footer and the Theme tab
 * ask once between them rather than twice for the same answer.
 */
export function useTickerTheme(symbol: string | null | undefined) {
  return useQuery<TickerThemeInfo>({
    queryKey: ["/api/market-condition/ticker-theme", symbol],
    queryFn: async () => {
      const res = await fetch(`/api/market-condition/ticker-theme/${symbol}`);
      if (!res.ok) return EMPTY;
      return res.json();
    },
    enabled: !!symbol,
    staleTime: 60_000,
  });
}
