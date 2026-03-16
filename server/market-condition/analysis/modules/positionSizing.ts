/**
 * Position Sizing Module
 * R:R calculation, suggested shares, risk dollars
 */

import type { ModuleResponse, PositionSizingData, Signal, SetupDetectionData } from "../types";
import { fetchTechnicalData } from "../../../sentinel/technicals";
import { getQuote } from "../../../data-layer/quotes";

const DEFAULT_ACCOUNT_SIZE = 100000;
const DEFAULT_RISK_PCT = 1; // 1% of account per trade

export async function runPositionSizing(
  symbol: string,
  setupData?: SetupDetectionData
): Promise<ModuleResponse<PositionSizingData>> {
  const start = Date.now();

  const [technicals, quote] = await Promise.all([
    fetchTechnicalData(symbol).catch(() => null),
    getQuote(symbol).catch(() => null),
  ]);

  const currentPrice = quote?.price ?? technicals?.currentPrice ?? 0;
  const atr14 = technicals?.atr14 ?? 0;

  // Get entry/stop/target from setup detection if available
  let entry = currentPrice;
  let stop: number | null = null;
  let target: number | null = null;

  if (setupData?.patterns?.length) {
    const primary = setupData.patterns[0];
    if (primary.entry) entry = primary.entry;
    if (primary.stop) stop = primary.stop;
    if (primary.target) target = primary.target;
  }

  // If no stop from setup, use ATR-based stop
  if (!stop && atr14 > 0) {
    stop = currentPrice - atr14 * 1.5;
  }

  // Calculate position sizing
  const riskDollarsPerAccount = DEFAULT_ACCOUNT_SIZE * (DEFAULT_RISK_PCT / 100);
  const riskPerShare = stop ? Math.abs(entry - stop) : atr14 * 1.5;
  const stopDistance = entry > 0 ? (riskPerShare / entry) * 100 : 0;

  let suggestedShares = 0;
  if (riskPerShare > 0) {
    suggestedShares = Math.floor(riskDollarsPerAccount / riskPerShare);
  }

  const suggestedDollars = suggestedShares * entry;
  const riskDollars = suggestedShares * riskPerShare;
  const riskPct = DEFAULT_RISK_PCT;

  // Calculate R:R
  let rrRatio: number | null = null;
  let targetDistance: number | null = null;

  if (target && stop && entry > 0) {
    const reward = Math.abs(target - entry);
    const risk = Math.abs(entry - stop);
    if (risk > 0) {
      rrRatio = Math.round((reward / risk) * 100) / 100;
      targetDistance = (reward / entry) * 100;
    }
  }

  // Determine signal
  let signal: Signal = "informational";
  const flags: string[] = [];

  if (rrRatio !== null) {
    if (rrRatio >= 3) {
      signal = "bullish";
      flags.push("EXCELLENT_RR");
    } else if (rrRatio >= 2) {
      flags.push("GOOD_RR");
    } else if (rrRatio < 1) {
      signal = "warning";
      flags.push("POOR_RR");
    }
  }

  if (stopDistance > 8) {
    flags.push("WIDE_STOP");
  } else if (stopDistance < 2 && stopDistance > 0) {
    flags.push("TIGHT_STOP");
  }

  const confidence = calculateSizingConfidence(rrRatio, stop !== null, target !== null);
  const summary = buildSizingSummary(symbol, entry, stop, target, suggestedShares, rrRatio, riskPct);

  return {
    module_id: "positionSizing",
    ticker: symbol,
    signal,
    summary,
    confidence,
    flags,
    executionMs: Date.now() - start,
    data: {
      suggestedShares,
      suggestedDollars,
      riskPerShare,
      riskDollars,
      riskPct,
      rrRatio,
      stopDistance,
      targetDistance,
    },
  };
}

function calculateSizingConfidence(
  rrRatio: number | null,
  hasStop: boolean,
  hasTarget: boolean
): number {
  let confidence = 50;

  if (hasStop) confidence += 20;
  if (hasTarget) confidence += 15;

  if (rrRatio !== null) {
    if (rrRatio >= 2) confidence += 15;
    else if (rrRatio >= 1) confidence += 5;
    else confidence -= 10;
  }

  return Math.max(0, Math.min(100, confidence));
}

function buildSizingSummary(
  symbol: string,
  entry: number,
  stop: number | null,
  target: number | null,
  shares: number,
  rrRatio: number | null,
  riskPct: number
): string {
  const parts: string[] = [];

  parts.push(`Position sizing for ${symbol} (${riskPct}% risk per trade, $${DEFAULT_ACCOUNT_SIZE.toLocaleString()} account).`);

  if (entry > 0) {
    parts.push(`Entry: $${entry.toFixed(2)}.`);
  }

  if (stop) {
    const stopDist = entry > 0 ? ((entry - stop) / entry * 100).toFixed(1) : "?";
    parts.push(`Stop: $${stop.toFixed(2)} (${stopDist}% risk).`);
  }

  if (target) {
    const targetDist = entry > 0 ? ((target - entry) / entry * 100).toFixed(1) : "?";
    parts.push(`Target: $${target.toFixed(2)} (${targetDist}% reward).`);
  }

  if (rrRatio !== null) {
    const rrLabel = rrRatio >= 3 ? "excellent" : rrRatio >= 2 ? "good" : rrRatio >= 1 ? "acceptable" : "poor";
    parts.push(`R:R ratio: ${rrRatio.toFixed(2)}:1 (${rrLabel}).`);
  }

  if (shares > 0) {
    parts.push(`Suggested position: ${shares} shares ($${(shares * entry).toLocaleString()}).`);
  }

  return parts.join(" ");
}
