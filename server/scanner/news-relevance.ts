/**
 * FMP's stock-news endpoint often returns general market wires for any ticker
 * query and omits a real tickers list. We used to stamp the queried symbol onto
 * those rows — which glued Samsung foldable headlines onto CEG / NXE / etc.
 */

import type { NewsHeadline } from "@shared/scanner-types";

/** Normalize provider ticker lists (strings or { symbol } objects). */
export function normalizeTickerList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item.trim()) {
      out.push(item.trim().toUpperCase());
    } else if (item && typeof item === "object" && "symbol" in item) {
      const s = String((item as { symbol: unknown }).symbol ?? "").trim();
      if (s) out.push(s.toUpperCase());
    }
  }
  return out;
}

function symbolMentionedInText(sym: string, text: string): boolean {
  // $CEG, (CEG), CEG:, or token CEG — avoids matching inside longer words
  const re = new RegExp(
    `(?:^|[^A-Za-z0-9])\\$${sym}(?:[^A-Za-z0-9]|$)|` +
      `(?:^|[^A-Za-z0-9])\\(${sym}\\)|` +
      `(?:^|[^A-Za-z0-9])${sym}(?::|[^A-Za-z0-9]|$)`,
    "i"
  );
  return re.test(text);
}

/**
 * True when the headline is plausibly about `symbol`.
 * Provider ticker tags alone are not trusted (FMP often mis-tags general wires).
 * The symbol must appear in the headline/body; short tickers also need a tag.
 */
export function isHeadlineRelevantToSymbol(
  symbol: string,
  headline: string,
  relatedTickers: string[] = [],
  body = ""
): boolean {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return false;

  const text = `${headline} ${body}`;
  const mentioned = symbolMentionedInText(sym, text);
  if (!mentioned) return false;

  // Short tickers ("K","V") match too many English tokens — require provider tag too
  if (sym.length <= 2) {
    return relatedTickers.map((t) => t.toUpperCase()).includes(sym);
  }

  return true;
}

export function filterHeadlinesForSymbol(
  symbol: string,
  headlines: NewsHeadline[]
): NewsHeadline[] {
  return headlines.filter((h) =>
    isHeadlineRelevantToSymbol(symbol, h.headline, h.relatedTickers ?? [])
  );
}
