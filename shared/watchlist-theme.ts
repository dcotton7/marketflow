/**
 * Watchlist theme display helpers (browser + server).
 * Keeps sector SPDR labels aligned between API and UI fallback when theme metadata is missing.
 */

/** Strip invisible chars / take first token so "XLB US" and odd DB values still resolve. */
export function normalizeWatchlistSymbol(raw: string): string {
  const s = raw
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim()
    .toUpperCase();
  const head = s.split(/[\s/]+/)[0] ?? s;
  return head || s;
}

/** GICS-style sector names for Select Sector SPDR tickers (last-resort theme label). */
const SECTOR_SPDR_THEME_LABEL: Readonly<Record<string, string>> = {
  XLB: "Materials",
  XLC: "Communication Services",
  XLE: "Energy",
  XLF: "Financials",
  XLI: "Industrials",
  XLK: "Technology",
  XLP: "Consumer Staples",
  XLRE: "Real Estate",
  XLU: "Utilities",
  XLV: "Health Care",
  XLY: "Consumer Discretionary",
  XLT: "Consumer Discretionary",
};

export function sectorSpdrThemeLabel(symbol: string): string {
  const u = normalizeWatchlistSymbol(symbol);
  return SECTOR_SPDR_THEME_LABEL[u] ?? "";
}
