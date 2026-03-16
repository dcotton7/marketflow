/**
 * Setup Detection Module
 * Pattern detection with confidence scoring and stage labeling
 */

import type { ModuleResponse, SetupDetectionData, Signal } from "../types";
import { getDailyBars } from "../../../data-layer/daily-bars";
import { fetchTechnicalData } from "../../../sentinel/technicals";
import { detectCupAndHandle } from "@shared/patternDetection";

export async function runSetupDetection(symbol: string): Promise<ModuleResponse<SetupDetectionData>> {
  const start = Date.now();

  const [bars, technicals] = await Promise.all([
    getDailyBars(symbol, 120).catch(() => []),
    fetchTechnicalData(symbol).catch(() => null),
  ]);

  const patterns: SetupDetectionData["patterns"] = [];
  let primaryPattern: string | null = null;
  const rubricAutofill: Record<string, unknown> = {};

  if (bars.length >= 20) {
    // Check for VCP (Volatility Contraction Pattern)
    const vcpResult = detectVCP(bars);
    if (vcpResult.detected) {
      patterns.push({
        name: "VCP",
        confidence: vcpResult.confidence,
        stage: vcpResult.stage,
        entry: vcpResult.entry,
        stop: vcpResult.stop,
        target: vcpResult.target,
      });
    }

    // Check for Cup and Handle
    const candles = bars.map((b) => ({
      date: typeof b.date === "string" ? b.date : new Date(b.date).toISOString(),
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
    }));
    const cupResult = detectCupAndHandle(candles);
    if (cupResult.detected) {
      const completionPct = cupResult.completionPct ?? 50;
      const cupConf = Math.min(90, 50 + completionPct / 2);
      const isReady = completionPct >= 80;
      patterns.push({
        name: cupResult.cupOnly ? "Cup (No Handle)" : "Cup and Handle",
        confidence: cupConf,
        stage: cupResult.cupOnly ? "extended" : isReady ? "ready" : "forming",
        entry: cupResult.rightRimPrice ?? null,
        stop: cupResult.cupBottomPrice ?? null,
        target: cupResult.rightRimPrice ? cupResult.rightRimPrice * 1.15 : null,
      });
    }

    // Check for High Tight Flag
    const htfResult = detectHTF(bars);
    if (htfResult.detected) {
      patterns.push({
        name: "High Tight Flag",
        confidence: htfResult.confidence,
        stage: htfResult.stage,
        entry: htfResult.entry,
        stop: htfResult.stop,
        target: htfResult.target,
      });
    }

    // Check for Pullback to MA
    const pullbackResult = detectPullback(bars, technicals);
    if (pullbackResult.detected) {
      patterns.push({
        name: "Pullback",
        confidence: pullbackResult.confidence,
        stage: pullbackResult.stage,
        entry: pullbackResult.entry,
        stop: pullbackResult.stop,
        target: pullbackResult.target,
      });
    }

    // Check for Breakout
    const breakoutResult = detectBreakout(bars, technicals);
    if (breakoutResult.detected) {
      patterns.push({
        name: "Breakout",
        confidence: breakoutResult.confidence,
        stage: breakoutResult.stage,
        entry: breakoutResult.entry,
        stop: breakoutResult.stop,
        target: breakoutResult.target,
      });
    }
  }

  // Sort by confidence and pick primary
  patterns.sort((a, b) => b.confidence - a.confidence);
  if (patterns.length > 0) {
    primaryPattern = patterns[0].name;

    // Build rubric autofill from primary pattern
    const primary = patterns[0];
    if (primary.entry) rubricAutofill.suggestedEntry = primary.entry;
    if (primary.stop) rubricAutofill.suggestedStop = primary.stop;
    if (primary.target) rubricAutofill.suggestedTarget = primary.target;
    rubricAutofill.patternType = primary.name;
    rubricAutofill.patternStage = primary.stage;
  }

  // Determine signal
  let signal: Signal = "neutral";
  const flags: string[] = [];

  if (patterns.length > 0) {
    const topPattern = patterns[0];
    if (topPattern.confidence >= 70 && topPattern.stage === "ready") {
      signal = "bullish";
      flags.push("ACTIONABLE_SETUP");
    } else if (topPattern.confidence >= 60 && topPattern.stage === "forming") {
      signal = "bullish";
      flags.push("SETUP_FORMING");
    } else if (topPattern.stage === "extended") {
      signal = "warning";
      flags.push("EXTENDED_MOVE");
    }
  }

  const confidence = patterns.length > 0 ? patterns[0].confidence : 30;
  const summary = buildSetupSummary(symbol, patterns, primaryPattern);

  return {
    module_id: "setupDetection",
    ticker: symbol,
    signal,
    summary,
    confidence,
    flags,
    executionMs: Date.now() - start,
    data: {
      patterns,
      primaryPattern,
      rubricAutofill,
    },
  };
}

interface PatternResult {
  detected: boolean;
  confidence: number;
  stage: "forming" | "ready" | "triggered" | "extended";
  entry: number | null;
  stop: number | null;
  target: number | null;
}

function detectVCP(bars: Array<{ high: number; low: number; close: number; volume: number }>): PatternResult {
  if (bars.length < 30) return { detected: false, confidence: 0, stage: "forming", entry: null, stop: null, target: null };

  const recent30 = bars.slice(-30);
  const ranges: number[] = [];

  // Calculate weekly ranges
  for (let i = 0; i < 4; i++) {
    const weekBars = recent30.slice(i * 7, (i + 1) * 7);
    if (weekBars.length > 0) {
      const weekHigh = Math.max(...weekBars.map((b) => b.high));
      const weekLow = Math.min(...weekBars.map((b) => b.low));
      ranges.push(weekHigh - weekLow);
    }
  }

  // Check for contracting ranges
  let contracting = true;
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i] > ranges[i - 1] * 0.9) {
      contracting = false;
      break;
    }
  }

  if (!contracting) return { detected: false, confidence: 0, stage: "forming", entry: null, stop: null, target: null };

  const currentPrice = bars[bars.length - 1].close;
  const pivotHigh = Math.max(...recent30.map((b) => b.high));
  const recentLow = Math.min(...bars.slice(-10).map((b) => b.low));

  const distToPivot = ((pivotHigh - currentPrice) / currentPrice) * 100;
  const confidence = Math.min(90, 50 + (4 - ranges.length) * 10 + (distToPivot < 3 ? 20 : 0));

  let stage: PatternResult["stage"] = "forming";
  if (distToPivot < 2) stage = "ready";
  if (currentPrice > pivotHigh) stage = "triggered";
  if (currentPrice > pivotHigh * 1.1) stage = "extended";

  return {
    detected: true,
    confidence,
    stage,
    entry: pivotHigh,
    stop: recentLow * 0.98,
    target: pivotHigh * 1.15,
  };
}

function detectHTF(bars: Array<{ high: number; low: number; close: number; open: number }>): PatternResult {
  if (bars.length < 40) return { detected: false, confidence: 0, stage: "forming", entry: null, stop: null, target: null };

  // Look for 100%+ gain in 8 weeks followed by tight consolidation
  const lookback = bars.slice(-40);
  const low20 = Math.min(...lookback.slice(0, 20).map((b) => b.low));
  const high20 = Math.max(...lookback.slice(0, 20).map((b) => b.high));
  const gainPct = ((high20 - low20) / low20) * 100;

  if (gainPct < 100) return { detected: false, confidence: 0, stage: "forming", entry: null, stop: null, target: null };

  // Check flag tightness (last 10 bars)
  const flag = lookback.slice(-10);
  const flagHigh = Math.max(...flag.map((b) => b.high));
  const flagLow = Math.min(...flag.map((b) => b.low));
  const flagRange = ((flagHigh - flagLow) / flagHigh) * 100;

  if (flagRange > 15) return { detected: false, confidence: 0, stage: "forming", entry: null, stop: null, target: null };

  const currentPrice = bars[bars.length - 1].close;
  const confidence = Math.min(90, 60 + (15 - flagRange) * 2);

  let stage: PatternResult["stage"] = "forming";
  if (flagRange < 10 && currentPrice > flagHigh * 0.98) stage = "ready";
  if (currentPrice > flagHigh) stage = "triggered";

  return {
    detected: true,
    confidence,
    stage,
    entry: flagHigh,
    stop: flagLow * 0.97,
    target: flagHigh * 1.2,
  };
}

function detectPullback(
  bars: Array<{ high: number; low: number; close: number }>,
  technicals: { sma21?: number; sma50?: number } | null
): PatternResult {
  if (!technicals || bars.length < 20) {
    return { detected: false, confidence: 0, stage: "forming", entry: null, stop: null, target: null };
  }

  const currentPrice = bars[bars.length - 1].close;
  const sma21 = technicals.sma21 ?? 0;
  const sma50 = technicals.sma50 ?? 0;

  // Check if in uptrend (price was above MAs recently)
  const recent5 = bars.slice(-5);
  const wasAbove21 = recent5.some((b) => b.close > sma21);
  const nowNear21 = Math.abs((currentPrice - sma21) / sma21) < 0.02;

  if (!wasAbove21 || !nowNear21 || sma21 <= 0) {
    return { detected: false, confidence: 0, stage: "forming", entry: null, stop: null, target: null };
  }

  const confidence = 65;
  const recentHigh = Math.max(...bars.slice(-10).map((b) => b.high));

  return {
    detected: true,
    confidence,
    stage: "ready",
    entry: sma21,
    stop: sma50 > 0 ? sma50 * 0.98 : sma21 * 0.95,
    target: recentHigh,
  };
}

function detectBreakout(
  bars: Array<{ high: number; low: number; close: number; volume: number }>,
  technicals: { high52Week?: number } | null
): PatternResult {
  if (bars.length < 20) {
    return { detected: false, confidence: 0, stage: "forming", entry: null, stop: null, target: null };
  }

  const currentPrice = bars[bars.length - 1].close;
  const recent20High = Math.max(...bars.slice(-20).map((b) => b.high));
  const recent20Low = Math.min(...bars.slice(-20).map((b) => b.low));

  // Breaking out of range
  const breakingOut = currentPrice > recent20High * 0.98;
  if (!breakingOut) {
    return { detected: false, confidence: 0, stage: "forming", entry: null, stop: null, target: null };
  }

  // Volume confirmation
  const avgVol = bars.slice(-20).reduce((sum, b) => sum + b.volume, 0) / 20;
  const todayVol = bars[bars.length - 1].volume;
  const volConfirm = todayVol > avgVol * 1.3;

  const confidence = volConfirm ? 75 : 55;

  let stage: PatternResult["stage"] = "ready";
  if (currentPrice > recent20High) stage = "triggered";
  if (currentPrice > recent20High * 1.08) stage = "extended";

  const high52 = technicals?.high52Week ?? recent20High * 1.2;

  return {
    detected: true,
    confidence,
    stage,
    entry: recent20High,
    stop: recent20Low,
    target: high52,
  };
}

function buildSetupSummary(
  symbol: string,
  patterns: SetupDetectionData["patterns"],
  primaryPattern: string | null
): string {
  if (patterns.length === 0) {
    return `No clear technical patterns detected for ${symbol}. Consider monitoring for setup formation.`;
  }

  const parts: string[] = [];
  const top = patterns[0];

  parts.push(`Primary pattern: ${primaryPattern} (${top.confidence}% confidence, ${top.stage}).`);

  if (top.entry) {
    parts.push(`Suggested entry: $${top.entry.toFixed(2)}.`);
  }
  if (top.stop) {
    parts.push(`Suggested stop: $${top.stop.toFixed(2)}.`);
  }
  if (top.target) {
    parts.push(`Initial target: $${top.target.toFixed(2)}.`);
  }

  if (patterns.length > 1) {
    const others = patterns.slice(1, 3).map((p) => p.name).join(", ");
    parts.push(`Also detected: ${others}.`);
  }

  return parts.join(" ");
}
