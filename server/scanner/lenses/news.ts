// ---------------------------------------------------------------------------
// Lens: News (dual-source — Finnhub + FMP)
// Pulls recent headlines for the signal's subject from both sources.
// Corroboration scoring: higher confidence when both report same catalyst.
// ---------------------------------------------------------------------------

import type { Signal, NewsResult, NewsHeadline } from "@shared/scanner-types";
import type { Lens } from "./types";
import {
  filterHeadlinesForSymbol,
  normalizeTickerList,
} from "../news-relevance";

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY ?? "";
const FMP_API_KEY = process.env.FMP_API_KEY ?? "";

const NEWS_CACHE = new Map<string, { data: NewsResult; ts: number }>();
const NEWS_CACHE_TTL_MS = 5 * 60_000;
const NEWS_CACHE_MAX = 50;

function todayStr(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

async function fetchFinnhubNews(symbol: string): Promise<NewsHeadline[]> {
  if (!FINNHUB_API_KEY) return [];
  try {
    const from = todayStr();
    const to = todayStr();
    const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&token=${FINNHUB_API_KEY}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const data = await res.json() as any[];
    return (data ?? []).slice(0, 5).map((item) => {
      const related = item.related
        ? String(item.related).split(",").map((s: string) => s.trim())
        : [];
      return {
        source: "finnhub" as const,
        headline: item.headline ?? "",
        url: item.url ?? "",
        publishedAt: item.datetime
          ? new Date(item.datetime * 1000).toISOString()
          : "",
        // Never invent the query symbol — empty means "untagged"
        relatedTickers: related,
      };
    });
  } catch {
    return [];
  }
}

async function fetchFmpNews(symbol: string): Promise<NewsHeadline[]> {
  if (!FMP_API_KEY) return [];
  try {
    const url = `https://financialmodelingprep.com/stable/news/stock?tickers=${encodeURIComponent(symbol)}&limit=5&apikey=${FMP_API_KEY}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const data = await res.json() as any[];
    return (data ?? []).slice(0, 5).map((item) => {
      const fromList = normalizeTickerList(item.tickers);
      const single =
        typeof item.symbol === "string" && item.symbol.trim()
          ? [item.symbol.trim().toUpperCase()]
          : [];
      return {
        source: "fmp" as const,
        headline: item.title ?? item.headline ?? "",
        url: item.url ?? item.link ?? "",
        publishedAt: item.publishedDate ?? item.date ?? "",
        // Do NOT fall back to the queried symbol — FMP often returns general
        // wires with no tickers; stamping the query caused Samsung→CEG etc.
        relatedTickers: fromList.length > 0 ? fromList : single,
      };
    });
  } catch {
    return [];
  }
}

export const newsLens: Lens = {
  id: "news",

  async apply(signal: Signal): Promise<NewsResult | null> {
    if (signal.subjectKind !== "ticker") return null;

    const symbol = signal.subject;

    // Check cache
    const cached = NEWS_CACHE.get(symbol);
    if (cached && Date.now() - cached.ts < NEWS_CACHE_TTL_MS) {
      return cached.data;
    }

    const [finnhubNews, fmpNews] = await Promise.all([
      fetchFinnhubNews(symbol),
      fetchFmpNews(symbol),
    ]);

    const headlines = filterHeadlinesForSymbol(symbol, [
      ...finnhubNews,
      ...fmpNews,
    ]);
    const finnhubRelevant = headlines.filter((h) => h.source === "finnhub");
    const fmpRelevant = headlines.filter((h) => h.source === "fmp");
    const sourceCount =
      (finnhubRelevant.length > 0 ? 1 : 0) + (fmpRelevant.length > 0 ? 1 : 0);

    // Corroboration only when both sources have *relevant* headlines
    const corroborated = finnhubRelevant.length > 0 && fmpRelevant.length > 0;

    const result: NewsResult = { headlines, corroborated, sourceCount };

    // Cache with LRU eviction
    if (NEWS_CACHE.size >= NEWS_CACHE_MAX) {
      const oldest = NEWS_CACHE.keys().next().value;
      if (oldest) NEWS_CACHE.delete(oldest);
    }
    NEWS_CACHE.set(symbol, { data: result, ts: Date.now() });

    return result;
  },
};
