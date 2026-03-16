/**
 * Volume Module
 * RVOL, volume trend, dry-up detection, ATR/ADR
 */

import type { ModuleResponse, VolumeData, Signal } from "../types";
import { fetchTechnicalData } from "../../../sentinel/technicals";
import { getQuote } from "../../../data-layer/quotes";
import { getDailyBars } from "../../../data-layer/daily-bars";

export async function runVolume(symbol: string): Promise<ModuleResponse<VolumeData>> {
  const start = Date.now();

  const [technicals, quote, bars] = await Promise.all([
    fetchTechnicalData(symbol).catch(() => null),
    getQuote(symbol).catch(() => null),
    getDailyBars(symbol, 30).catch(() => []),
  ]);

  const currentPrice = quote?.price ?? technicals?.currentPrice ?? 0;
  const changePct = quote?.changePct ?? 0;

  const avgVolume20 = technicals?.avgVolume20 ?? 0;
  const atr14 = technicals?.atr14 ?? 0;
  const adr20 = technicals?.adr20 ?? 0;

  // Calculate today's volume and RVOL
  // Use quote volume if available, otherwise estimate from bars
  let todayVolume = 0;
  if (bars.length > 0) {
    const lastBar = bars[bars.length - 1];
    todayVolume = lastBar.volume;
  }

  const rvol = avgVolume20 > 0 ? todayVolume / avgVolume20 : 0;

  // Detect volume trend (accumulation vs distribution)
  const volumeTrend = detectVolumeTrend(bars);

  // Detect volume dry-up (contraction before breakout)
  const dryUpDetected = detectDryUp(bars, avgVolume20);

  // Determine signal
  let signal: Signal = "neutral";
  const flags: string[] = [];

  if (rvol >= 2 && changePct > 0) {
    signal = "bullish";
    flags.push("HIGH_VOLUME_UP");
  } else if (rvol >= 2 && changePct < 0) {
    signal = "bearish";
    flags.push("HIGH_VOLUME_DOWN");
  } else if (dryUpDetected) {
    signal = "bullish";
    flags.push("VOLUME_DRY_UP");
  }

  if (volumeTrend === "accumulation") {
    flags.push("ACCUMULATION_TREND");
  } else if (volumeTrend === "distribution") {
    flags.push("DISTRIBUTION_TREND");
  }

  const confidence = calculateVolumeConfidence(rvol, volumeTrend, dryUpDetected, changePct);

  const summary = buildVolumeSummary(symbol, currentPrice, changePct, rvol, volumeTrend, dryUpDetected, atr14);

  return {
    module_id: "volume",
    ticker: symbol,
    signal,
    summary,
    confidence,
    flags,
    executionMs: Date.now() - start,
    data: {
      currentPrice,
      changePct,
      rvol,
      avgVolume20,
      todayVolume,
      volumeTrend,
      dryUpDetected,
      atr14,
      adr20,
    },
  };
}

function detectVolumeTrend(
  bars: Array<{ close: number; open: number; volume: number }>
): "accumulation" | "distribution" | "neutral" {
  if (bars.length < 10) return "neutral";

  const recent = bars.slice(-10);
  let accDays = 0;
  let distDays = 0;

  for (const bar of recent) {
    const isUp = bar.close > bar.open;
    if (isUp) accDays++;
    else distDays++;
  }

  // Weight by volume
  let accVolume = 0;
  let distVolume = 0;
  for (const bar of recent) {
    if (bar.close > bar.open) accVolume += bar.volume;
    else distVolume += bar.volume;
  }

  if (accVolume > distVolume * 1.3) return "accumulation";
  if (distVolume > accVolume * 1.3) return "distribution";
  return "neutral";
}

function detectDryUp(
  bars: Array<{ volume: number }>,
  avgVolume: number
): boolean {
  if (bars.length < 5 || avgVolume === 0) return false;

  const recent5 = bars.slice(-5);
  const avgRecent = recent5.reduce((sum, b) => sum + b.volume, 0) / 5;

  // Volume contraction: recent volume < 60% of 20-day avg
  return avgRecent < avgVolume * 0.6;
}

function calculateVolumeConfidence(
  rvol: number,
  trend: string,
  dryUp: boolean,
  changePct: number
): number {
  let score = 50;

  // High conviction when volume confirms price
  if (rvol >= 1.5 && changePct > 0) score += 20;
  else if (rvol >= 1.5 && changePct < 0) score += 15;
  else if (rvol < 0.5) score -= 10;

  if (trend === "accumulation") score += 10;
  else if (trend === "distribution") score -= 10;

  if (dryUp) score += 15; // Dry-up often precedes breakouts

  return Math.max(0, Math.min(100, score));
}

function buildVolumeSummary(
  symbol: string,
  price: number,
  changePct: number,
  rvol: number,
  trend: string,
  dryUp: boolean,
  atr14: number
): string {
  const parts: string[] = [];

  const direction = changePct >= 0 ? "up" : "down";
  parts.push(`${symbol} at $${price.toFixed(2)}, ${direction} ${Math.abs(changePct).toFixed(2)}% today.`);

  const rvolLabel = rvol >= 2 ? "very high" : rvol >= 1.5 ? "elevated" : rvol >= 0.8 ? "average" : "below average";
  parts.push(`Volume is ${rvolLabel} (${rvol.toFixed(2)}x avg).`);

  if (dryUp) {
    parts.push("Volume dry-up detected (potential setup forming).");
  }

  if (trend === "accumulation") {
    parts.push("Recent volume pattern shows accumulation.");
  } else if (trend === "distribution") {
    parts.push("Recent volume pattern shows distribution.");
  }

  if (atr14 > 0) {
    parts.push(`ATR(14): $${atr14.toFixed(2)}.`);
  }

  return parts.join(" ");
}
