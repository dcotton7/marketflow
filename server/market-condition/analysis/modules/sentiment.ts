/**
 * Sentiment Module
 * Analyst consensus, price targets, short interest, put/call ratio
 */

import type { ModuleResponse, SentimentData, Signal } from "../types";
import { fetchRecommendations, fetchPriceTarget } from "../../../finnhub";
import { getQuote } from "../../../data-layer/quotes";

export async function runSentiment(symbol: string): Promise<ModuleResponse<SentimentData>> {
  const start = Date.now();

  const [recommendations, priceTargetData, quote] = await Promise.all([
    fetchRecommendations(symbol).catch(() => []),
    fetchPriceTarget(symbol).catch(() => null),
    getQuote(symbol).catch(() => null),
  ]);

  const currentPrice = quote?.price ?? 0;

  // Process analyst consensus (use most recent)
  const latest = recommendations[0];
  const analystConsensus: SentimentData["analystConsensus"] = {
    strongBuy: latest?.strongBuy ?? 0,
    buy: latest?.buy ?? 0,
    hold: latest?.hold ?? 0,
    sell: latest?.sell ?? 0,
    strongSell: latest?.strongSell ?? 0,
    rating: calculateRating(latest),
  };

  // Process price target
  let priceTarget: SentimentData["priceTarget"] = null;
  if (priceTargetData && currentPrice > 0) {
    const upside = ((priceTargetData.targetMean - currentPrice) / currentPrice) * 100;
    priceTarget = {
      mean: priceTargetData.targetMean,
      high: priceTargetData.targetHigh,
      low: priceTargetData.targetLow,
      upside,
    };
  }

  // Short interest and put/call ratio (placeholders — need external data sources)
  const shortInterest: number | null = null;
  const putCallRatio: number | null = null;

  // Determine signal
  let signal: Signal = "neutral";
  const flags: string[] = [];

  // Analyst rating signal
  if (analystConsensus.rating === "strong_buy" || analystConsensus.rating === "buy") {
    signal = "bullish";
    flags.push("ANALYST_BULLISH");
  } else if (analystConsensus.rating === "sell" || analystConsensus.rating === "strong_sell") {
    signal = "bearish";
    flags.push("ANALYST_BEARISH");
  }

  // Price target signal
  if (priceTarget) {
    if (priceTarget.upside >= 20) {
      flags.push("HIGH_UPSIDE_TARGET");
      if (signal !== "bearish") signal = "bullish";
    } else if (priceTarget.upside <= -10) {
      flags.push("BELOW_TARGET");
      if (signal !== "bullish") signal = "warning";
    }
  }

  const confidence = calculateSentimentConfidence(analystConsensus, priceTarget);
  const summary = buildSentimentSummary(symbol, analystConsensus, priceTarget, currentPrice);

  return {
    module_id: "sentiment",
    ticker: symbol,
    signal,
    summary,
    confidence,
    flags,
    executionMs: Date.now() - start,
    data: {
      analystConsensus,
      priceTarget,
      shortInterest,
      putCallRatio,
    },
  };
}

function calculateRating(
  rec: { strongBuy?: number; buy?: number; hold?: number; sell?: number; strongSell?: number } | undefined
): SentimentData["analystConsensus"]["rating"] {
  if (!rec) return "hold";

  const sb = rec.strongBuy ?? 0;
  const b = rec.buy ?? 0;
  const h = rec.hold ?? 0;
  const s = rec.sell ?? 0;
  const ss = rec.strongSell ?? 0;

  const total = sb + b + h + s + ss;
  if (total === 0) return "hold";

  // Weighted score: strongBuy=5, buy=4, hold=3, sell=2, strongSell=1
  const score = (sb * 5 + b * 4 + h * 3 + s * 2 + ss * 1) / total;

  if (score >= 4.5) return "strong_buy";
  if (score >= 3.5) return "buy";
  if (score >= 2.5) return "hold";
  if (score >= 1.5) return "sell";
  return "strong_sell";
}

function calculateSentimentConfidence(
  consensus: SentimentData["analystConsensus"],
  priceTarget: SentimentData["priceTarget"]
): number {
  let confidence = 40;

  // More analysts = more confidence
  const totalAnalysts = consensus.strongBuy + consensus.buy + consensus.hold + consensus.sell + consensus.strongSell;
  if (totalAnalysts >= 20) confidence += 25;
  else if (totalAnalysts >= 10) confidence += 15;
  else if (totalAnalysts >= 5) confidence += 10;

  // Strong consensus (most agree)
  const maxCount = Math.max(
    consensus.strongBuy + consensus.buy,
    consensus.hold,
    consensus.sell + consensus.strongSell
  );
  if (totalAnalysts > 0 && maxCount / totalAnalysts >= 0.7) {
    confidence += 15;
  }

  // Price target data available
  if (priceTarget) {
    confidence += 10;
  }

  return Math.max(0, Math.min(100, confidence));
}

function buildSentimentSummary(
  symbol: string,
  consensus: SentimentData["analystConsensus"],
  priceTarget: SentimentData["priceTarget"],
  currentPrice: number
): string {
  const parts: string[] = [];

  const totalAnalysts = consensus.strongBuy + consensus.buy + consensus.hold + consensus.sell + consensus.strongSell;

  if (totalAnalysts > 0) {
    const ratingLabel = consensus.rating.replace("_", " ").toUpperCase();
    parts.push(`Analyst consensus: ${ratingLabel} (${totalAnalysts} analysts).`);

    const buyCount = consensus.strongBuy + consensus.buy;
    const sellCount = consensus.sell + consensus.strongSell;
    parts.push(`Buy: ${buyCount}, Hold: ${consensus.hold}, Sell: ${sellCount}.`);
  } else {
    parts.push(`No analyst coverage found for ${symbol}.`);
  }

  if (priceTarget && currentPrice > 0) {
    const direction = priceTarget.upside >= 0 ? "upside" : "downside";
    parts.push(
      `Price target: $${priceTarget.mean.toFixed(2)} (${Math.abs(priceTarget.upside).toFixed(1)}% ${direction}).`
    );
    parts.push(`Range: $${priceTarget.low.toFixed(2)} – $${priceTarget.high.toFixed(2)}.`);
  }

  return parts.join(" ");
}
