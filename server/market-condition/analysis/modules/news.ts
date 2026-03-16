/**
 * News Module
 * Company news with sentiment scoring
 */

import type { ModuleResponse, NewsData, Signal } from "../types";
import { fetchCompanyNews } from "../../../finnhub";

export async function runNews(symbol: string): Promise<ModuleResponse<NewsData>> {
  const start = Date.now();

  const newsItems = await fetchCompanyNews(symbol, 7).catch(() => []);

  // Score each news item
  const scoredItems: NewsData["items"] = newsItems.slice(0, 10).map((item) => {
    const sentiment = scoreHeadlineSentiment(item.headline);
    return {
      headline: item.headline,
      source: item.source,
      datetime: new Date(item.datetime * 1000).toISOString(),
      sentiment: sentiment.label,
      impactLevel: determineImpact(item.headline),
    };
  });

  // Calculate overall sentiment
  const sentimentScores = scoredItems.map((item) => {
    if (item.sentiment === "positive") return 1;
    if (item.sentiment === "negative") return -1;
    return 0;
  });

  const avgScore = sentimentScores.length > 0
    ? sentimentScores.reduce((a, b) => a + b, 0) / sentimentScores.length
    : 0;

  const overallSentiment: "positive" | "negative" | "neutral" =
    avgScore > 0.2 ? "positive" : avgScore < -0.2 ? "negative" : "neutral";

  const sentimentScore = Math.round(avgScore * 100);

  // Determine signal
  let signal: Signal = "neutral";
  const flags: string[] = [];

  if (avgScore > 0.3) {
    signal = "bullish";
    flags.push("POSITIVE_NEWS_FLOW");
  } else if (avgScore < -0.3) {
    signal = "bearish";
    flags.push("NEGATIVE_NEWS_FLOW");
  }

  // Check for high-impact news
  const highImpact = scoredItems.filter((item) => item.impactLevel === "high");
  if (highImpact.length > 0) {
    flags.push("HIGH_IMPACT_NEWS");
  }

  const confidence = calculateNewsConfidence(scoredItems.length, avgScore, highImpact.length);
  const summary = buildNewsSummary(symbol, scoredItems, overallSentiment, sentimentScore);

  return {
    module_id: "news",
    ticker: symbol,
    signal,
    summary,
    confidence,
    flags,
    executionMs: Date.now() - start,
    data: {
      items: scoredItems,
      overallSentiment,
      sentimentScore,
    },
  };
}

interface SentimentResult {
  label: "positive" | "negative" | "neutral";
  score: number;
}

function scoreHeadlineSentiment(headline: string): SentimentResult {
  const lower = headline.toLowerCase();

  // Positive keywords
  const positiveWords = [
    "upgrade", "beat", "surge", "rally", "record", "growth", "strong", "outperform",
    "buy", "bullish", "profit", "gain", "win", "breakthrough", "innovative", "exceeds",
    "positive", "optimistic", "success", "boost", "momentum", "expand", "dividend",
  ];

  // Negative keywords
  const negativeWords = [
    "downgrade", "miss", "plunge", "crash", "weak", "underperform", "sell", "bearish",
    "loss", "decline", "warning", "concern", "risk", "cut", "layoff", "lawsuit",
    "investigation", "recall", "negative", "pessimistic", "fail", "default", "bankruptcy",
  ];

  let positiveCount = 0;
  let negativeCount = 0;

  for (const word of positiveWords) {
    if (lower.includes(word)) positiveCount++;
  }

  for (const word of negativeWords) {
    if (lower.includes(word)) negativeCount++;
  }

  const score = positiveCount - negativeCount;

  if (score > 0) return { label: "positive", score };
  if (score < 0) return { label: "negative", score };
  return { label: "neutral", score: 0 };
}

function determineImpact(headline: string): "high" | "medium" | "low" {
  const lower = headline.toLowerCase();

  // High impact keywords
  const highImpact = [
    "earnings", "guidance", "acquisition", "merger", "fda", "approval", "patent",
    "lawsuit", "sec", "investigation", "ceo", "cfo", "bankruptcy", "dividend",
    "buyback", "split", "analyst", "upgrade", "downgrade", "target",
  ];

  for (const word of highImpact) {
    if (lower.includes(word)) return "high";
  }

  // Medium impact
  const mediumImpact = [
    "partnership", "contract", "expansion", "product", "launch", "revenue",
    "growth", "market", "industry", "competition",
  ];

  for (const word of mediumImpact) {
    if (lower.includes(word)) return "medium";
  }

  return "low";
}

function calculateNewsConfidence(itemCount: number, avgScore: number, highImpactCount: number): number {
  let confidence = 40;

  // More news = more signal
  if (itemCount >= 5) confidence += 15;
  else if (itemCount >= 2) confidence += 10;
  else if (itemCount === 0) confidence -= 20;

  // Stronger sentiment = higher confidence in the signal
  confidence += Math.abs(avgScore) * 30;

  // High impact news adds confidence
  confidence += highImpactCount * 5;

  return Math.max(0, Math.min(100, Math.round(confidence)));
}

function buildNewsSummary(
  symbol: string,
  items: NewsData["items"],
  overall: string,
  score: number
): string {
  if (items.length === 0) {
    return `No recent news found for ${symbol} in the past 7 days.`;
  }

  const parts: string[] = [];

  parts.push(`${items.length} news items for ${symbol} (past 7 days).`);
  parts.push(`Overall sentiment: ${overall} (score: ${score > 0 ? "+" : ""}${score}).`);

  const highImpact = items.filter((i) => i.impactLevel === "high");
  if (highImpact.length > 0) {
    parts.push(`${highImpact.length} high-impact headline(s).`);
  }

  // Show most recent headline
  if (items[0]) {
    const snippet = items[0].headline.length > 80
      ? items[0].headline.slice(0, 77) + "..."
      : items[0].headline;
    parts.push(`Latest: "${snippet}"`);
  }

  return parts.join(" ");
}
