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

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY ?? "";
const FMP_API_KEY = process.env.FMP_API_KEY ?? "";

const MIN_SEVERITY_TO_FIRE = 5;
const BATCH_SIZE = 8;
const COOLDOWN_MS = 60 * 60_000;

let rotationIndex = 0;
const seenHeadlines = new Map<string, number>();
const cooldowns = new Map<string, number>();

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function headlineKey(headline: string, symbol: string): string {
  return `${symbol}:${headline.slice(0, 60).toLowerCase()}`;
}

function pruneSeenHeadlines(): void {
  const cutoff = Date.now() - 12 * 60 * 60_000;
  for (const [k, ts] of seenHeadlines) {
    if (ts < cutoff) seenHeadlines.delete(k);
  }
}

/**
 * Check if a headline is actually about the queried ticker.
 * Reject headlines that are about other companies returned tangentially.
 */
function isRelevantHeadline(hl: NewsHeadline, symbol: string): boolean {
  const text = hl.headline.toUpperCase();

  // Direct ticker mention in headline text — strong relevance
  // Use word boundary to avoid matching substrings (e.g. "ALK" inside "WALK")
  const tickerPattern = new RegExp(`\\b${symbol}\\b`);
  if (tickerPattern.test(text)) return true;

  // Finnhub's `related` field lists tickers the article covers
  if (hl.relatedTickers && hl.relatedTickers.length > 0) {
    const related = hl.relatedTickers.map((t) => t.toUpperCase().trim());
    // If the article lists related tickers and our symbol is among them, relevant
    if (related.includes(symbol)) return true;
    // If the article lists related tickers but our symbol is NOT among them, reject
    if (related.length > 0 && !related.includes(symbol)) return false;
  }

  // Fallback: headline doesn't mention ticker and no related field — ambiguous, reject
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
      relatedTickers: item.related ? String(item.related).split(",").map((s: string) => s.trim()) : [symbol],
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
    return (data ?? []).slice(0, 5).map((item) => ({
      source: "fmp" as const,
      headline: item.title ?? item.headline ?? "",
      url: item.url ?? item.link ?? "",
      publishedAt: item.publishedDate ?? item.date ?? "",
      relatedTickers: Array.isArray(item.tickers) ? item.tickers : [symbol],
    }));
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
    const { symbol, headlines } = r.value;
    if (headlines.length === 0) continue;

    // Check cooldown
    const cdKey = `news_alert:${symbol}`;
    const lastFired = cooldowns.get(cdKey);
    if (lastFired && Date.now() - lastFired < COOLDOWN_MS) continue;

    // Score and filter
    let bestHeadline: NewsHeadline | null = null;
    let bestSeverity = 0;
    const corroborated = headlines.some(h => h.source === "finnhub") && headlines.some(h => h.source === "fmp");

    for (const hl of headlines) {
      if (!hl.headline) continue;
      if (!isRelevantHeadline(hl, symbol)) continue;

      const key = headlineKey(hl.headline, symbol);
      if (seenHeadlines.has(key)) continue;

      const severity = scoreHeadlineSeverity(hl.headline);
      if (severity > bestSeverity) {
        bestSeverity = severity;
        bestHeadline = hl;
      }
      seenHeadlines.set(key, Date.now());
    }

    if (!bestHeadline || bestSeverity < MIN_SEVERITY_TO_FIRE) continue;

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
