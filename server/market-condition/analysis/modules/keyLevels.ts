/**
 * Key Levels Module
 * Support, resistance, MAs, 52wk high/low
 */

import type { ModuleResponse, KeyLevelData, Signal } from "../types";
import { getKeyLevels as fetchKeyLevels } from "../../../sentinel/technicals";
import { getQuote } from "../../../data-layer/quotes";

export async function runKeyLevels(symbol: string): Promise<ModuleResponse<KeyLevelData>> {
  const start = Date.now();

  const [levels, quote] = await Promise.all([
    fetchKeyLevels(symbol),
    getQuote(symbol).catch(() => null),
  ]);

  const currentPrice = quote?.price ?? 0;

  // Find nearest support and resistance
  const supports = levels.filter((l) => l.price < currentPrice && (l.type === "support" || l.type === "ma"));
  const resistances = levels.filter((l) => l.price > currentPrice && (l.type === "resistance" || l.type === "ma"));

  const nearestSupport = supports.length > 0 ? Math.max(...supports.map((l) => l.price)) : null;
  const nearestResistance = resistances.length > 0 ? Math.min(...resistances.map((l) => l.price)) : null;

  // Determine signal based on position relative to levels
  let signal: Signal = "neutral";
  const flags: string[] = [];

  if (nearestSupport && nearestResistance) {
    const supportDist = ((currentPrice - nearestSupport) / currentPrice) * 100;
    const resistDist = ((nearestResistance - currentPrice) / currentPrice) * 100;

    if (supportDist < 2) {
      signal = "bullish";
      flags.push("NEAR_SUPPORT");
    } else if (resistDist < 2) {
      signal = "warning";
      flags.push("NEAR_RESISTANCE");
    }
  }

  // Check if near 52-week high
  const high52w = levels.find((l) => l.label.includes("52W High"));
  if (high52w && currentPrice > 0) {
    const distTo52wHigh = ((high52w.price - currentPrice) / currentPrice) * 100;
    if (distTo52wHigh < 3) {
      flags.push("NEAR_52W_HIGH");
    }
  }

  // Check MA alignment
  const ma50 = levels.find((l) => l.label.includes("SMA 50"));
  const ma200 = levels.find((l) => l.label.includes("SMA 200"));
  if (ma50 && ma200 && currentPrice > 0) {
    if (currentPrice > ma50.price && ma50.price > ma200.price) {
      flags.push("BULLISH_MA_STACK");
    } else if (currentPrice < ma50.price && ma50.price < ma200.price) {
      flags.push("BEARISH_MA_STACK");
      if (signal !== "bullish") signal = "bearish";
    }
  }

  const confidence = calculateLevelConfidence(levels, currentPrice, nearestSupport, nearestResistance);

  const summary = buildLevelsSummary(symbol, levels.length, currentPrice, nearestSupport, nearestResistance, flags);

  return {
    module_id: "keyLevels",
    ticker: symbol,
    signal,
    summary,
    confidence,
    flags,
    executionMs: Date.now() - start,
    data: {
      levels: levels.map((l) => ({
        price: l.price,
        type: l.type,
        label: l.label,
        significance: l.significance,
        distancePct: l.distancePct,
        source: l.source,
      })),
      nearestSupport,
      nearestResistance,
      currentPrice,
    },
  };
}

function calculateLevelConfidence(
  levels: Array<{ significance: string }>,
  currentPrice: number,
  nearestSupport: number | null,
  nearestResistance: number | null
): number {
  let score = 50;

  // More levels = more context
  if (levels.length >= 10) score += 10;
  else if (levels.length >= 5) score += 5;

  // Major levels nearby increase confidence in the analysis
  const majorLevels = levels.filter((l) => l.significance === "major");
  score += Math.min(majorLevels.length * 5, 20);

  // Good risk/reward setup (closer to support than resistance)
  if (nearestSupport && nearestResistance && currentPrice > 0) {
    const supportDist = (currentPrice - nearestSupport) / currentPrice;
    const resistDist = (nearestResistance - currentPrice) / currentPrice;
    if (resistDist > supportDist * 2) {
      score += 15; // Good R:R potential
    }
  }

  return Math.max(0, Math.min(100, score));
}

function buildLevelsSummary(
  symbol: string,
  levelCount: number,
  currentPrice: number,
  nearestSupport: number | null,
  nearestResistance: number | null,
  flags: string[]
): string {
  const parts: string[] = [];

  parts.push(`${levelCount} key price levels identified for ${symbol}.`);

  if (nearestSupport && currentPrice > 0) {
    const dist = ((currentPrice - nearestSupport) / currentPrice) * 100;
    parts.push(`Nearest support at $${nearestSupport.toFixed(2)} (${dist.toFixed(1)}% below).`);
  }

  if (nearestResistance && currentPrice > 0) {
    const dist = ((nearestResistance - currentPrice) / currentPrice) * 100;
    parts.push(`Nearest resistance at $${nearestResistance.toFixed(2)} (${dist.toFixed(1)}% above).`);
  }

  if (flags.includes("BULLISH_MA_STACK")) {
    parts.push("Price above 50 SMA above 200 SMA (bullish structure).");
  } else if (flags.includes("BEARISH_MA_STACK")) {
    parts.push("Price below 50 SMA below 200 SMA (bearish structure).");
  }

  if (flags.includes("NEAR_52W_HIGH")) {
    parts.push("Trading near 52-week highs.");
  }

  return parts.join(" ");
}
