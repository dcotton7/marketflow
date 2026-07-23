// ---------------------------------------------------------------------------
// News Signal Detector
//
// Polls Finnhub + FMP on a rotating schedule for tickers in the universe.
// Fires news_alert signals for high-severity headlines not yet seen.
// ---------------------------------------------------------------------------

import { randomUUID } from "crypto";
import type { Signal, NewsHeadline } from "@shared/scanner-types";
import { scoreHeadlineSeverity } from "@shared/catalyst-types";
import { getAllUniverseTickers } from "../market-condition/universe";
import type { SnapshotFrame } from "./signal-producer";
import {
  filterHeadlinesForSymbol,
  normalizeTickerList,
} from "./news-relevance";

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY ?? "";
const FMP_API_KEY = process.env.FMP_API_KEY ?? "";

const MIN_SEVERITY_TO_FIRE = 3;
const BATCH_SIZE = 20;
const COOLDOWN_MS = 60 * 60_000;

const MAX_SEEN_HEADLINES = 2000;
const MAX_SEEN_GLOBAL = 1000;
const MAX_COOLDOWNS = 500;

let rotationIndex = 0;
const seenHeadlines = new Map<string, number>();
const cooldowns = new Map<string, number>();

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function headlineKey(headline: string, symbol: string): string {
  return `${symbol}:${headline.slice(0, 60).toLowerCase()}`;
}

function globalHeadlineKey(headline: string): string {
  return headline.slice(0, 80).toLowerCase().replace(/\s+/g, " ").trim();
}

// Tracks first-fire timestamp per normalized headline — each headline fires at most once
const seenGlobalHeadlines = new Map<string, number>();

function pruneSeenHeadlines(): void {
  const cutoff = Date.now() - 12 * 60 * 60_000;
  for (const [k, ts] of seenHeadlines) {
    if (ts < cutoff) seenHeadlines.delete(k);
  }
  for (const [k, ts] of seenGlobalHeadlines) {
    if (ts < cutoff) seenGlobalHeadlines.delete(k);
  }
  for (const [k, ts] of cooldowns) {
    if (ts < cutoff) cooldowns.delete(k);
  }

  // Hard cap: evict oldest entries if still over limit
  if (seenHeadlines.size > MAX_SEEN_HEADLINES) {
    const sorted = [...seenHeadlines.entries()].sort((a, b) => a[1] - b[1]);
    const toRemove = sorted.slice(0, seenHeadlines.size - MAX_SEEN_HEADLINES);
    for (const [k] of toRemove) seenHeadlines.delete(k);
  }
  if (seenGlobalHeadlines.size > MAX_SEEN_GLOBAL) {
    const sorted = [...seenGlobalHeadlines.entries()].sort((a, b) => a[1] - b[1]);
    const toRemove = sorted.slice(0, seenGlobalHeadlines.size - MAX_SEEN_GLOBAL);
    for (const [k] of toRemove) seenGlobalHeadlines.delete(k);
  }
  if (cooldowns.size > MAX_COOLDOWNS) {
    const sorted = [...cooldowns.entries()].sort((a, b) => a[1] - b[1]);
    const toRemove = sorted.slice(0, cooldowns.size - MAX_COOLDOWNS);
    for (const [k] of toRemove) cooldowns.delete(k);
  }
}

/**
 * Check if a headline is actually about the queried ticker.
 * Reject headlines that are about other companies returned tangentially.
 */
const BROAD_ARTICLE_THRESHOLD = 8;

function isRelevantHeadline(hl: NewsHeadline, symbol: string): boolean {
  const text = hl.headline.toUpperCase();

  // Reject broad market articles (8+ related tickers) from per-ticker signals.
  // These are "Trump traded 327 stocks" / "S&P 500 roundup" type articles —
  // they mention your ticker but aren't ABOUT your ticker.
  if (hl.relatedTickers && hl.relatedTickers.length >= BROAD_ARTICLE_THRESHOLD) {
    return false;
  }

  // Direct ticker mention in headline text — strong relevance
  const tickerPattern = new RegExp(`\\b${symbol}\\b`);
  if (tickerPattern.test(text)) return true;

  // Finnhub's `related` field lists tickers the article covers
  if (hl.relatedTickers && hl.relatedTickers.length > 0) {
    const related = hl.relatedTickers.map((t) => t.toUpperCase().trim());
    if (related.includes(symbol)) return true;
    if (related.length > 0 && !related.includes(symbol)) return false;
  }

  return false;
}

async function fetchFinnhubNews(symbol: string): Promise<NewsHeadline[]> {
  if (!FINNHUB_API_KEY) return [];
  try {
    const d = todayStr();
    const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${d}&to=${d}&token=${FINNHUB_API_KEY}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const data = (await res.json()) as any[];
    return (data ?? []).slice(0, 5).map((item) => ({
      source: "finnhub" as const,
      headline: item.headline ?? "",
      url: item.url ?? "",
      publishedAt: item.datetime ? new Date(item.datetime * 1000).toISOString() : "",
      relatedTickers: item.related
        ? String(item.related).split(",").map((s: string) => s.trim())
        : [],
    }));
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
    const data = (await res.json()) as any[];
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
        relatedTickers: fromList.length > 0 ? fromList : single,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Called each scanner cycle. Fetches news for a rotating batch of tickers
 * and returns news_alert signals for high-severity unseen headlines.
 * Pass the current frame so price metrics (% today, % from LOD) are embedded.
 */
export async function detectNewsAlerts(frame?: SnapshotFrame): Promise<Signal[]> {
  const tickers = getAllUniverseTickers();
  if (tickers.length === 0) return [];

  // Rotate through universe in batches
  const start = rotationIndex % tickers.length;
  const batch = [];
  for (let i = 0; i < BATCH_SIZE && i < tickers.length; i++) {
    batch.push(tickers[(start + i) % tickers.length]!);
  }
  rotationIndex += BATCH_SIZE;

  // Periodic cleanup
  if (rotationIndex % 100 === 0) pruneSeenHeadlines();

  const signals: Signal[] = [];

  // Fetch news for batch in parallel
  const results = await Promise.allSettled(
    batch.map(async (symbol) => {
      const [finnhub, fmp] = await Promise.all([
        fetchFinnhubNews(symbol),
        fetchFmpNews(symbol),
      ]);
      return { symbol, headlines: [...finnhub, ...fmp] };
    })
  );

  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    const { symbol, headlines: rawHeadlines } = r.value;
    const headlines = filterHeadlinesForSymbol(symbol, rawHeadlines);
    if (headlines.length === 0) continue;

    // Check cooldown
    const cdKey = `news_alert:${symbol}`;
    const lastFired = cooldowns.get(cdKey);
    if (lastFired && Date.now() - lastFired < COOLDOWN_MS) continue;

    // Score and filter
    let bestHeadline: NewsHeadline | null = null;
    let bestSeverity = 0;
    const corroborated =
      headlines.some((h) => h.source === "finnhub") &&
      headlines.some((h) => h.source === "fmp");

    for (const hl of headlines) {
      if (!hl.headline) continue;
      if (!isRelevantHeadline(hl, symbol)) continue;

      const key = headlineKey(hl.headline, symbol);
      if (seenHeadlines.has(key)) continue;

      // Global dedup: same headline text fires at most once across all tickers
      const gKey = globalHeadlineKey(hl.headline);
      if (seenGlobalHeadlines.has(gKey)) continue;

      const severity = scoreHeadlineSeverity(hl.headline);
      if (severity > bestSeverity) {
        bestSeverity = severity;
        bestHeadline = hl;
      }
      seenHeadlines.set(key, Date.now());
    }

    if (!bestHeadline || bestSeverity < MIN_SEVERITY_TO_FIRE) continue;

    // Mark global headline as fired (store timestamp for pruning)
    const gKey = globalHeadlineKey(bestHeadline.headline);
    seenGlobalHeadlines.set(gKey, Date.now());

    cooldowns.set(cdKey, Date.now());

    // Attach price metrics from current frame if available
    const tf = frame?.tickers.get(symbol);
    const changePct = tf?.changePct ?? null;
    // Only compute LOD% when we have real intraday low data (non-zero, less than price)
    const hasLodData = tf && tf.todayLow > 0 && tf.todayLow <= tf.price;
    const pctFromLod = hasLodData
      ? ((tf!.price - tf!.todayLow) / tf!.todayLow) * 100
      : null;

    signals.push({
      id: randomUUID(),
      type: "news_alert",
      subjectKind: "ticker",
      subject: symbol,
      magnitude: bestSeverity,
      direction: (changePct ?? 0) > 0.3 ? "up" : (changePct ?? 0) < -0.3 ? "down" : "neutral",
      timestamp: new Date(),
      meta: {
        headline: bestHeadline.headline,
        url: bestHeadline.url,
        source: bestHeadline.source,
        severity: bestSeverity,
        corroborated,
        totalHeadlines: headlines.length,
        publishedAt: bestHeadline.publishedAt,
        changePct,
        pctFromLod,
        price: tf?.price ?? 0,
      },
    });
  }

  if (signals.length > 0) {
    console.log(`[Scanner/News] ${signals.length} news alert(s): ${signals.map(s => `${s.subject} (sev ${s.magnitude})`).join(", ")}`);
  }

  return signals;
}
