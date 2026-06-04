import type { ThemeRow } from "@/data/mockThemeData";

/** Primary chart ETF when a sub-theme is selected in MarketFlow. */
export const SUBTHEME_PRIMARY_CHART_ETF: Record<string, string> = {
  SEMIS_MEMORY: "DRAM",
};

const ETF_PROXY_FALLBACK_ORDER = ["direct", "adjacent", "macro", "hedge"] as const;

function pushUnique(out: string[], raw: string | null | undefined) {
  const sym = raw?.trim().toUpperCase();
  if (!sym || out.includes(sym)) return;
  out.push(sym);
}

/**
 * Ordered chart symbol candidates: sub-theme ETF override, theme ETFs (direct → adjacent → macro),
 * then member tickers (leaders first when provided).
 */
export function getThemeChartSymbolCandidates(
  theme: Pick<ThemeRow, "etfProxies">,
  options?: {
    subthemeId?: string | null;
    memberSymbols?: string[];
  }
): string[] {
  const out: string[] = [];

  if (options?.subthemeId) {
    pushUnique(out, SUBTHEME_PRIMARY_CHART_ETF[options.subthemeId]);
  }

  const proxies = theme.etfProxies ?? [];
  for (const proxyType of ETF_PROXY_FALLBACK_ORDER) {
    for (const p of proxies) {
      if ((p.proxyType ?? "").trim().toLowerCase() === proxyType) {
        pushUnique(out, p.symbol);
      }
    }
  }

  for (const sym of options?.memberSymbols ?? []) {
    pushUnique(out, sym);
  }

  return out;
}

/** @deprecated Prefer getThemeChartSymbolCandidates for chart loading with fallbacks. */
export function getLeadingDirectEtfSymbol(theme: Pick<ThemeRow, "etfProxies">): string | null {
  return getThemeChartSymbolCandidates(theme)[0] ?? null;
}
