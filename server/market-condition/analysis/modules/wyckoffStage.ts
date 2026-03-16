/**
 * Wyckoff Stage Detection Module
 * Identifies market phase: Accumulation, Markup, Distribution, Markdown
 * With sub-phase detection (A-E) and event recognition (springs, upthrusts, etc.)
 */

import type { ModuleResponse, WyckoffStageData, WyckoffStage, WyckoffPhase, WyckoffEvent, Signal } from "../types";
import { getDailyBars } from "../../../data-layer/daily-bars";
import { fetchTechnicalData } from "../../../sentinel/technicals";
import { getTickerAccDistMap } from "../../utils/ticker-acc-dist-loader";

interface Bar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface TradingRange {
  high: number;
  low: number;
  midpoint: number;
  widthPct: number;
  daysInRange: number;
  isValid: boolean;
  startIdx: number;
  endIdx: number;
}

export async function runWyckoffStage(symbol: string): Promise<ModuleResponse<WyckoffStageData>> {
  const start = Date.now();

  const [bars, technicals, accDistMap] = await Promise.all([
    getDailyBars(symbol, 150).catch(() => []),
    fetchTechnicalData(symbol).catch(() => null),
    getTickerAccDistMap([symbol]).catch(() => new Map()),
  ]);

  if (bars.length < 40) {
    return createUnknownResult(symbol, Date.now() - start, "Insufficient data");
  }

  const currentPrice = bars[0]?.close ?? 0;
  const adStreak = accDistMap.get(symbol) ?? 0;

  // Step 1: Detect the current trading range
  const tradingRange = detectTradingRange(bars);

  // Step 2: Analyze prior trend before the range
  const priorTrend = analyzePriorTrend(bars, tradingRange);

  // Step 3: Analyze volume character within the range
  const volumeAnalysis = analyzeVolumeCharacter(bars.slice(0, tradingRange.daysInRange + 5));

  // Step 4: Determine price position relative to range
  const pricePosition = determinePricePosition(currentPrice, tradingRange);

  // Step 5: Detect Wyckoff events (springs, upthrusts, tests)
  const events = detectWyckoffEvents(bars, tradingRange);

  // Step 6: Determine the Wyckoff stage
  const { stage, phase, confidence } = determineStage(
    priorTrend,
    volumeAnalysis,
    pricePosition,
    tradingRange,
    events,
    adStreak
  );

  // Step 7: Build summary and signal
  const stageLabel = buildStageLabel(stage, phase);
  const signal = stageToSignal(stage, phase);
  const flags = buildFlags(stage, phase, events, volumeAnalysis, adStreak);
  const summary = buildSummary(symbol, stage, phase, priorTrend, tradingRange, events, currentPrice);

  // Calculate breakout/breakdown levels and distances
  const breakoutLevel = tradingRange.isValid ? tradingRange.high : null;
  const breakdownLevel = tradingRange.isValid ? tradingRange.low : null;
  const distanceFromBreakout = breakoutLevel ? ((breakoutLevel - currentPrice) / currentPrice) * 100 : null;
  const distanceFromBreakdown = breakdownLevel ? ((currentPrice - breakdownLevel) / currentPrice) * 100 : null;

  return {
    module_id: "wyckoffStage",
    ticker: symbol,
    signal,
    summary,
    confidence,
    flags,
    executionMs: Date.now() - start,
    data: {
      stage,
      phase,
      stageLabel,
      priorTrend: priorTrend.direction,
      priorTrendPct: priorTrend.magnitude,
      priorTrendDays: priorTrend.days,
      tradingRange: {
        high: tradingRange.high,
        low: tradingRange.low,
        midpoint: tradingRange.midpoint,
        widthPct: tradingRange.widthPct,
        daysInRange: tradingRange.daysInRange,
        isValid: tradingRange.isValid,
      },
      volumeCharacter: volumeAnalysis.character,
      upVolumeRatio: volumeAnalysis.upVolumeRatio,
      breakoutLevel,
      breakdownLevel,
      events,
      pricePosition,
      distanceFromBreakout,
      distanceFromBreakdown,
    },
  };
}

function detectTradingRange(bars: Bar[]): TradingRange {
  // Look for consolidation in last 40-60 bars
  const lookbackPeriods = [40, 30, 50, 60];
  
  for (const lookback of lookbackPeriods) {
    if (bars.length < lookback) continue;
    
    const rangeBars = bars.slice(0, lookback);
    const highs = rangeBars.map(b => b.high);
    const lows = rangeBars.map(b => b.low);
    
    const rangeHigh = Math.max(...highs);
    const rangeLow = Math.min(...lows);
    const widthPct = ((rangeHigh - rangeLow) / rangeLow) * 100;
    
    // A valid trading range is typically 8-25% wide
    if (widthPct >= 5 && widthPct <= 30) {
      // Verify it's actually consolidating (price touching both ends)
      const upperTouches = rangeBars.filter(b => b.high >= rangeHigh * 0.98).length;
      const lowerTouches = rangeBars.filter(b => b.low <= rangeLow * 1.02).length;
      
      if (upperTouches >= 2 && lowerTouches >= 2) {
        return {
          high: rangeHigh,
          low: rangeLow,
          midpoint: (rangeHigh + rangeLow) / 2,
          widthPct,
          daysInRange: lookback,
          isValid: true,
          startIdx: 0,
          endIdx: lookback - 1,
        };
      }
    }
  }
  
  // Fallback: use last 30 bars even if not ideal
  const fallbackBars = bars.slice(0, 30);
  const rangeHigh = Math.max(...fallbackBars.map(b => b.high));
  const rangeLow = Math.min(...fallbackBars.map(b => b.low));
  
  return {
    high: rangeHigh,
    low: rangeLow,
    midpoint: (rangeHigh + rangeLow) / 2,
    widthPct: ((rangeHigh - rangeLow) / rangeLow) * 100,
    daysInRange: 30,
    isValid: false,
    startIdx: 0,
    endIdx: 29,
  };
}

function analyzePriorTrend(bars: Bar[], range: TradingRange): { direction: "uptrend" | "downtrend" | "sideways"; magnitude: number; days: number } {
  // Look at bars BEFORE the trading range
  const priorBars = bars.slice(range.daysInRange, Math.min(range.daysInRange + 60, bars.length));
  
  if (priorBars.length < 10) {
    return { direction: "sideways", magnitude: 0, days: 0 };
  }
  
  const startPrice = priorBars[priorBars.length - 1].close;
  const endPrice = priorBars[0].close;
  const changePct = ((endPrice - startPrice) / startPrice) * 100;
  
  let direction: "uptrend" | "downtrend" | "sideways" = "sideways";
  
  // Use 10% threshold for clearer trend detection
  if (changePct >= 10) {
    direction = "uptrend";
  } else if (changePct <= -10) {
    direction = "downtrend";
  }
  
  return {
    direction,
    magnitude: changePct,
    days: priorBars.length,
  };
}

function analyzeVolumeCharacter(bars: Bar[]): { character: "accumulation" | "distribution" | "neutral"; upVolumeRatio: number } {
  if (bars.length < 5) {
    return { character: "neutral", upVolumeRatio: 1 };
  }
  
  let upVolume = 0;
  let downVolume = 0;
  
  for (const bar of bars) {
    const isUp = bar.close > bar.open;
    if (isUp) {
      upVolume += bar.volume;
    } else {
      downVolume += bar.volume;
    }
  }
  
  const ratio = downVolume > 0 ? upVolume / downVolume : upVolume > 0 ? 2 : 1;
  
  let character: "accumulation" | "distribution" | "neutral" = "neutral";
  
  // Use 1.15/0.85 thresholds for more sensitive detection
  if (ratio >= 1.15) {
    character = "accumulation";
  } else if (ratio <= 0.85) {
    character = "distribution";
  }
  
  return { character, upVolumeRatio: ratio };
}

function determinePricePosition(price: number, range: TradingRange): "above_range" | "in_range" | "below_range" {
  const buffer = range.widthPct * 0.02; // 2% buffer
  
  if (price > range.high * (1 + buffer / 100)) {
    return "above_range";
  }
  if (price < range.low * (1 - buffer / 100)) {
    return "below_range";
  }
  return "in_range";
}

function detectWyckoffEvents(bars: Bar[], range: TradingRange): WyckoffEvent[] {
  const events: WyckoffEvent[] = [];
  const rangeBars = bars.slice(0, range.daysInRange + 5);
  
  // Calculate average volume for context
  const avgVolume = rangeBars.reduce((sum, b) => sum + b.volume, 0) / rangeBars.length;
  
  for (let i = 1; i < rangeBars.length - 1; i++) {
    const prev = rangeBars[i + 1];
    const curr = rangeBars[i];
    const next = rangeBars[i - 1];
    
    // SPRING: Quick dip below support, immediate recovery (bullish)
    if (curr.low < range.low * 0.99 && curr.close > range.low && next.close > curr.close) {
      events.push({
        type: "spring",
        date: curr.date,
        price: curr.low,
        description: `Spring at $${curr.low.toFixed(2)} - dipped below support and recovered`,
      });
    }
    
    // SHAKEOUT: More aggressive spring with volume
    if (curr.low < range.low * 0.97 && curr.close > range.low * 0.99 && curr.volume > avgVolume * 1.3) {
      events.push({
        type: "shakeout",
        date: curr.date,
        price: curr.low,
        description: `Shakeout at $${curr.low.toFixed(2)} - high volume flush below support`,
      });
    }
    
    // UPTHRUST: Quick spike above resistance, immediate rejection (bearish)
    if (curr.high > range.high * 1.01 && curr.close < range.high && next.close < curr.close) {
      events.push({
        type: "upthrust",
        date: curr.date,
        price: curr.high,
        description: `Upthrust at $${curr.high.toFixed(2)} - spiked above resistance and failed`,
      });
    }
    
    // SIGN OF STRENGTH (SOS): High volume breakout above range
    if (curr.close > range.high && curr.volume > avgVolume * 1.5 && next.close > curr.close) {
      events.push({
        type: "sign_of_strength",
        date: curr.date,
        price: curr.close,
        description: `Sign of Strength at $${curr.close.toFixed(2)} - high volume breakout`,
      });
    }
    
    // SIGN OF WEAKNESS (SOW): High volume breakdown below range
    if (curr.close < range.low && curr.volume > avgVolume * 1.5 && next.close < curr.close) {
      events.push({
        type: "sign_of_weakness",
        date: curr.date,
        price: curr.close,
        description: `Sign of Weakness at $${curr.close.toFixed(2)} - high volume breakdown`,
      });
    }
    
    // TEST: Low volume retest of spring/shakeout low
    const hasSpring = events.some(e => e.type === "spring" || e.type === "shakeout");
    if (hasSpring && curr.low < range.low * 1.02 && curr.volume < avgVolume * 0.7 && next.close > curr.close) {
      events.push({
        type: "test",
        date: curr.date,
        price: curr.low,
        description: `Successful test at $${curr.low.toFixed(2)} - low volume retest held`,
      });
    }
  }
  
  // Check for breakout/breakdown at the end
  const recentBars = bars.slice(0, 5);
  const lastClose = recentBars[0]?.close ?? 0;
  const avgRecentVolume = recentBars.reduce((sum, b) => sum + b.volume, 0) / recentBars.length;
  
  if (lastClose > range.high * 1.02 && avgRecentVolume > avgVolume * 1.2) {
    events.unshift({
      type: "breakout",
      date: recentBars[0].date,
      price: lastClose,
      description: `Breakout confirmed at $${lastClose.toFixed(2)} above range high`,
    });
  }
  
  if (lastClose < range.low * 0.98 && avgRecentVolume > avgVolume * 1.2) {
    events.unshift({
      type: "breakdown",
      date: recentBars[0].date,
      price: lastClose,
      description: `Breakdown confirmed at $${lastClose.toFixed(2)} below range low`,
    });
  }
  
  return events.slice(0, 5); // Limit to 5 most recent events
}

function determineStage(
  priorTrend: { direction: string; magnitude: number },
  volumeAnalysis: { character: string; upVolumeRatio: number },
  pricePosition: string,
  range: TradingRange,
  events: WyckoffEvent[],
  adStreak: number
): { stage: WyckoffStage; phase: WyckoffPhase; confidence: number } {
  
  const hasSpring = events.some(e => e.type === "spring" || e.type === "shakeout");
  const hasTest = events.some(e => e.type === "test");
  const hasSOS = events.some(e => e.type === "sign_of_strength" || e.type === "breakout");
  const hasUpthrust = events.some(e => e.type === "upthrust");
  const hasSOW = events.some(e => e.type === "sign_of_weakness" || e.type === "breakdown");
  
  let stage: WyckoffStage = "unknown";
  let phase: WyckoffPhase = null;
  let confidence = 40;
  
  // ACCUMULATION: Prior downtrend + in range + accumulation volume
  if (priorTrend.direction === "downtrend" && pricePosition === "in_range" && volumeAnalysis.character === "accumulation") {
    stage = "accumulation";
    confidence = 60;
    
    // Determine phase
    if (hasSpring && hasTest && hasSOS) {
      phase = "E"; // Ready to break out
      confidence = 85;
    } else if (hasSpring && hasTest) {
      phase = "D"; // Last Point of Support
      confidence = 80;
    } else if (hasSpring) {
      phase = "C"; // Spring/Test phase
      confidence = 75;
    } else if (range.daysInRange > 20) {
      phase = "B"; // Secondary test, building cause
      confidence = 65;
    } else {
      phase = "A"; // Selling climax, automatic rally
      confidence = 55;
    }
  }
  
  // MARKUP: Broke out of accumulation OR in uptrend after consolidation
  else if (
    (priorTrend.direction === "downtrend" && pricePosition === "above_range" && volumeAnalysis.character === "accumulation") ||
    (hasSOS && pricePosition === "above_range")
  ) {
    stage = "markup";
    confidence = 70;
    phase = null; // Markup doesn't have traditional phases
    
    if (adStreak >= 3) confidence += 10;
    if (hasSOS) confidence += 5;
  }
  
  // DISTRIBUTION: Prior uptrend + in range + distribution volume
  else if (priorTrend.direction === "uptrend" && pricePosition === "in_range" && volumeAnalysis.character === "distribution") {
    stage = "distribution";
    confidence = 60;
    
    // Determine phase
    if (hasUpthrust && hasSOW) {
      phase = "E"; // Ready to break down
      confidence = 85;
    } else if (hasUpthrust) {
      phase = "C"; // Upthrust phase
      confidence = 75;
    } else if (range.daysInRange > 20) {
      phase = "B"; // Secondary test, building cause
      confidence = 65;
    } else {
      phase = "A"; // Preliminary supply
      confidence = 55;
    }
  }
  
  // MARKDOWN: Broke down from distribution OR in downtrend after consolidation
  else if (
    (priorTrend.direction === "uptrend" && pricePosition === "below_range" && volumeAnalysis.character === "distribution") ||
    (hasSOW && pricePosition === "below_range")
  ) {
    stage = "markdown";
    confidence = 70;
    phase = null;
    
    if (adStreak <= -3) confidence += 10;
    if (hasSOW) confidence += 5;
  }
  
  // Edge cases
  else if (pricePosition === "above_range" && volumeAnalysis.character === "accumulation") {
    stage = "markup";
    confidence = 55;
  } else if (pricePosition === "below_range" && volumeAnalysis.character === "distribution") {
    stage = "markdown";
    confidence = 55;
  } else if (pricePosition === "in_range") {
    // In range but unclear - use volume character and A/D streak
    if (volumeAnalysis.character === "accumulation") {
      stage = "accumulation";
      phase = adStreak > 0 ? "B" : "A";
      confidence = 50 + (adStreak > 0 ? 5 : 0);
    } else if (volumeAnalysis.character === "distribution") {
      stage = "distribution";
      phase = adStreak < 0 ? "B" : "A";
      confidence = 50 + (adStreak < 0 ? 5 : 0);
    } else if (adStreak >= 3) {
      // Neutral volume but strong buying streak
      stage = "accumulation";
      phase = "B";
      confidence = 45;
    } else if (adStreak <= -3) {
      // Neutral volume but strong selling streak
      stage = "distribution";
      phase = "B";
      confidence = 45;
    }
    // If A/D streak is moderate, check if prior trend gives hints
    else if (priorTrend.direction === "downtrend" && priorTrend.magnitude <= -5) {
      stage = "accumulation";
      phase = "A";
      confidence = 40;
    } else if (priorTrend.direction === "uptrend" && priorTrend.magnitude >= 5) {
      stage = "distribution";
      phase = "A";
      confidence = 40;
    }
  }
  
  return { stage, phase, confidence: Math.min(100, confidence) };
}

function buildStageLabel(stage: WyckoffStage, phase: WyckoffPhase): string {
  const stageLabels: Record<WyckoffStage, string> = {
    accumulation: "Stage 1: Accumulation",
    markup: "Stage 2: Markup",
    distribution: "Stage 3: Distribution",
    markdown: "Stage 4: Markdown",
    unknown: "Unknown Stage",
  };
  
  let label = stageLabels[stage];
  if (phase) {
    label += ` (Phase ${phase})`;
  }
  
  return label;
}

function stageToSignal(stage: WyckoffStage, phase: WyckoffPhase): Signal {
  switch (stage) {
    case "accumulation":
      if (phase === "C" || phase === "D" || phase === "E") return "bullish";
      return "neutral";
    case "markup":
      return "bullish";
    case "distribution":
      if (phase === "C" || phase === "D" || phase === "E") return "bearish";
      return "warning";
    case "markdown":
      return "bearish";
    default:
      return "neutral";
  }
}

function buildFlags(
  stage: WyckoffStage,
  phase: WyckoffPhase,
  events: WyckoffEvent[],
  volumeAnalysis: { character: string },
  adStreak: number
): string[] {
  const flags: string[] = [];
  
  // Stage flags
  if (stage === "accumulation") {
    flags.push("WYCKOFF_ACCUMULATION");
    if (phase === "C" || phase === "D") flags.push("LATE_ACCUMULATION");
  } else if (stage === "markup") {
    flags.push("WYCKOFF_MARKUP");
  } else if (stage === "distribution") {
    flags.push("WYCKOFF_DISTRIBUTION");
    if (phase === "C" || phase === "D") flags.push("LATE_DISTRIBUTION");
  } else if (stage === "markdown") {
    flags.push("WYCKOFF_MARKDOWN");
  }
  
  // Event flags
  if (events.some(e => e.type === "spring")) flags.push("SPRING_DETECTED");
  if (events.some(e => e.type === "upthrust")) flags.push("UPTHRUST_DETECTED");
  if (events.some(e => e.type === "sign_of_strength")) flags.push("SOS_DETECTED");
  if (events.some(e => e.type === "sign_of_weakness")) flags.push("SOW_DETECTED");
  if (events.some(e => e.type === "breakout")) flags.push("BREAKOUT_CONFIRMED");
  if (events.some(e => e.type === "breakdown")) flags.push("BREAKDOWN_CONFIRMED");
  
  // Volume flags
  if (volumeAnalysis.character === "accumulation") flags.push("VOLUME_ACCUMULATING");
  if (volumeAnalysis.character === "distribution") flags.push("VOLUME_DISTRIBUTING");
  
  // A/D streak
  if (adStreak >= 5) flags.push("STRONG_INSTITUTIONAL_BUYING");
  if (adStreak <= -5) flags.push("STRONG_INSTITUTIONAL_SELLING");
  
  return flags;
}

function buildSummary(
  symbol: string,
  stage: WyckoffStage,
  phase: WyckoffPhase,
  priorTrend: { direction: string; magnitude: number },
  range: TradingRange,
  events: WyckoffEvent[],
  currentPrice: number
): string {
  const parts: string[] = [];
  
  // Stage summary
  const stageDesc: Record<WyckoffStage, string> = {
    accumulation: "accumulation (smart money buying)",
    markup: "markup (uptrend in progress)",
    distribution: "distribution (smart money selling)",
    markdown: "markdown (downtrend in progress)",
    unknown: "an unclear stage",
  };
  
  parts.push(`${symbol} is in Wyckoff ${stageDesc[stage]}.`);
  
  // Phase detail
  if (phase) {
    const phaseDesc: Record<string, string> = {
      A: "Early phase — selling/buying climax occurred",
      B: "Building cause — range bound",
      C: "Testing phase — springs/upthrusts likely",
      D: "Last point of support/supply — breakout/breakdown imminent",
      E: "Transition phase — entering next stage",
    };
    parts.push(`Phase ${phase}: ${phaseDesc[phase]}.`);
  }
  
  // Range context
  if (range.isValid) {
    parts.push(`Trading range: $${range.low.toFixed(2)} - $${range.high.toFixed(2)} (${range.widthPct.toFixed(1)}% wide, ${range.daysInRange} days).`);
  }
  
  // Key events
  const recentEvent = events[0];
  if (recentEvent) {
    parts.push(`Recent event: ${recentEvent.description}.`);
  }
  
  // Actionable insight
  if (stage === "accumulation" && (phase === "C" || phase === "D")) {
    parts.push(`Watch for breakout above $${range.high.toFixed(2)}.`);
  } else if (stage === "distribution" && (phase === "C" || phase === "D")) {
    parts.push(`Watch for breakdown below $${range.low.toFixed(2)}.`);
  }
  
  return parts.join(" ");
}

function createUnknownResult(symbol: string, executionMs: number, reason: string): ModuleResponse<WyckoffStageData> {
  return {
    module_id: "wyckoffStage",
    ticker: symbol,
    signal: "neutral",
    summary: `Unable to determine Wyckoff stage for ${symbol}: ${reason}`,
    confidence: 20,
    flags: [],
    executionMs,
    data: {
      stage: "unknown",
      phase: null,
      stageLabel: "Unknown Stage",
      priorTrend: "sideways",
      priorTrendPct: 0,
      priorTrendDays: 0,
      tradingRange: {
        high: 0,
        low: 0,
        midpoint: 0,
        widthPct: 0,
        daysInRange: 0,
        isValid: false,
      },
      volumeCharacter: "neutral",
      upVolumeRatio: 1,
      breakoutLevel: null,
      breakdownLevel: null,
      events: [],
      pricePosition: "in_range",
      distanceFromBreakout: null,
      distanceFromBreakdown: null,
    },
  };
}
