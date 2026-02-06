import OpenAI from "openai";
import { db } from "../db";
import { patternTrainingSetups, patternTrainingPoints, patternTrainingEvaluations } from "@shared/schema";
import { eq, and, desc, not, isNull } from "drizzle-orm";
import type { PatternTrainingSetup, PatternTrainingPoint, PatternTrainingEvaluation } from "@shared/schema";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

interface SetupWithPoints extends PatternTrainingSetup {
  points: PatternTrainingPoint[];
}

interface SimilarSetup {
  setupId: number;
  ticker: string;
  patternType: string;
  outcome: string;
  score: number;
  similarity: string;
}

interface PatternStats {
  totalSetups: number;
  setupsWithOutcomes: number;
  winRate: number;
  avgRR: number;
  byPatternType: Record<string, { count: number; wins: number; winRate: number; avgRR: number }>;
}

interface LearningContext {
  totalSetupsUsed: number;
  setupsWithOutcomes: number;
  similarSetupsFound: number;
  patternTypesKnown: string[];
}

interface EvaluationResult {
  score: number;
  confidence: number;
  rrRatio: number | null;
  verdict: string;
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  riskFlags: string[];
  similarSetups: SimilarSetup[];
  patternStats: PatternStats;
  learningContext: LearningContext;
}

async function getHistoricalSetups(userId: number, excludeSetupId: number): Promise<SetupWithPoints[]> {
  const setups = await db!.select().from(patternTrainingSetups)
    .where(and(
      eq(patternTrainingSetups.userId, userId),
      not(eq(patternTrainingSetups.id, excludeSetupId)),
    ))
    .orderBy(desc(patternTrainingSetups.createdAt))
    .limit(100);

  const setupsWithPoints: SetupWithPoints[] = [];
  for (const setup of setups) {
    const points = await db!.select().from(patternTrainingPoints)
      .where(eq(patternTrainingPoints.setupId, setup.id));
    setupsWithPoints.push({ ...setup, points });
  }
  return setupsWithPoints;
}

function computePatternStats(historicalSetups: SetupWithPoints[]): PatternStats {
  const withOutcomes = historicalSetups.filter(s => s.outcome && s.outcome !== 'pending');
  const wins = withOutcomes.filter(s => s.outcome === 'win');
  const rrValues = withOutcomes
    .map(s => (s.calculatedMetrics as any)?.riskReward)
    .filter((v): v is number => typeof v === 'number' && v > 0);

  const byPatternType: Record<string, { count: number; wins: number; winRate: number; avgRR: number }> = {};
  const rrCountByPattern: Record<string, number> = {};
  for (const setup of historicalSetups) {
    const pt = setup.patternType;
    if (!byPatternType[pt]) {
      byPatternType[pt] = { count: 0, wins: 0, winRate: 0, avgRR: 0 };
      rrCountByPattern[pt] = 0;
    }
    byPatternType[pt].count++;
    if (setup.outcome === 'win') byPatternType[pt].wins++;
    const rr = (setup.calculatedMetrics as any)?.riskReward;
    if (typeof rr === 'number' && rr > 0) {
      const prevCount = rrCountByPattern[pt];
      byPatternType[pt].avgRR = (byPatternType[pt].avgRR * prevCount + rr) / (prevCount + 1);
      rrCountByPattern[pt]++;
    }
  }
  for (const key of Object.keys(byPatternType)) {
    const entry = byPatternType[key];
    const withOutcome = historicalSetups.filter(s => s.patternType === key && s.outcome && s.outcome !== 'pending');
    entry.winRate = withOutcome.length > 0 ? (entry.wins / withOutcome.length) * 100 : 0;
  }

  return {
    totalSetups: historicalSetups.length,
    setupsWithOutcomes: withOutcomes.length,
    winRate: withOutcomes.length > 0 ? (wins.length / withOutcomes.length) * 100 : 0,
    avgRR: rrValues.length > 0 ? rrValues.reduce((a, b) => a + b, 0) / rrValues.length : 0,
    byPatternType,
  };
}

function findSimilarSetups(
  currentSetup: SetupWithPoints,
  historicalSetups: SetupWithPoints[]
): SimilarSetup[] {
  const candidates: { setup: SetupWithPoints; score: number; reasons: string[] }[] = [];

  for (const hist of historicalSetups) {
    if (!hist.outcome || hist.outcome === 'pending') continue;
    let score = 0;
    const reasons: string[] = [];

    if (hist.patternType === currentSetup.patternType) {
      score += 40;
      reasons.push("Same pattern type");
    }

    const currentMetrics = currentSetup.calculatedMetrics as any;
    const histMetrics = hist.calculatedMetrics as any;
    if (currentMetrics && histMetrics) {
      if (currentMetrics.maStacking && histMetrics.maStacking && currentMetrics.maStacking === histMetrics.maStacking) {
        score += 15;
        reasons.push("Same MA stacking");
      }
      if (typeof currentMetrics.riskReward === 'number' && typeof histMetrics.riskReward === 'number') {
        const rrDiff = Math.abs(currentMetrics.riskReward - histMetrics.riskReward);
        if (rrDiff < 0.5) { score += 10; reasons.push("Similar R/R ratio"); }
      }
      if (typeof currentMetrics.volumeRatio === 'number' && typeof histMetrics.volumeRatio === 'number') {
        const volDiff = Math.abs(currentMetrics.volumeRatio - histMetrics.volumeRatio);
        if (volDiff < 0.5) { score += 10; reasons.push("Similar volume profile"); }
      }
      if (typeof currentMetrics.atrPercent === 'number' && typeof histMetrics.atrPercent === 'number') {
        const atrDiff = Math.abs(currentMetrics.atrPercent - histMetrics.atrPercent);
        if (atrDiff < 1) { score += 5; reasons.push("Similar volatility"); }
      }
      if (typeof currentMetrics.baseDepthPct === 'number' && typeof histMetrics.baseDepthPct === 'number') {
        const depthDiff = Math.abs(currentMetrics.baseDepthPct - histMetrics.baseDepthPct);
        if (depthDiff < 5) { score += 10; reasons.push("Similar base depth"); }
      }
      if (typeof currentMetrics.pctFrom52wHigh === 'number' && typeof histMetrics.pctFrom52wHigh === 'number') {
        const highDiff = Math.abs(currentMetrics.pctFrom52wHigh - histMetrics.pctFrom52wHigh);
        if (highDiff < 10) { score += 10; reasons.push("Similar distance from 52w high"); }
      }
    }

    if (score >= 30) {
      candidates.push({ setup: hist, score, reasons });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, 5).map(c => ({
    setupId: c.setup.id,
    ticker: c.setup.ticker,
    patternType: c.setup.patternType,
    outcome: c.setup.outcome || 'unknown',
    score: c.score,
    similarity: c.reasons.join(", "),
  }));
}

function formatSetupForPrompt(setup: SetupWithPoints): string {
  const metrics = setup.calculatedMetrics as any;
  const lines: string[] = [];

  lines.push(`TICKER: ${setup.ticker}`);
  lines.push(`PATTERN TYPE: ${setup.patternType}`);
  lines.push(`TIMEFRAME: ${setup.timeframe}`);
  if (setup.notes) lines.push(`NOTES: ${setup.notes}`);
  if (setup.tags && (setup.tags as string[]).length > 0) lines.push(`TAGS: ${(setup.tags as string[]).join(', ')}`);

  if (metrics) {
    lines.push(`\n--- CALCULATED METRICS ---`);
    if (metrics.riskReward != null) lines.push(`Risk/Reward Ratio: ${metrics.riskReward.toFixed(2)}`);
    if (metrics.maStacking) lines.push(`MA Stacking: ${metrics.maStacking}`);
    if (metrics.volumeRatio != null) lines.push(`Volume Ratio (vs 50d avg): ${metrics.volumeRatio.toFixed(2)}`);
    if (metrics.atrPercent != null) lines.push(`ATR%: ${metrics.atrPercent.toFixed(2)}%`);
    if (metrics.baseDepthPct != null) lines.push(`Base Depth: ${metrics.baseDepthPct.toFixed(1)}%`);
    if (metrics.baseWidthDays != null) lines.push(`Base Width: ${metrics.baseWidthDays} days`);
    if (metrics.pctFrom52wHigh != null) lines.push(`% From 52w High: ${metrics.pctFrom52wHigh.toFixed(1)}%`);
    if (metrics.momentum5d != null) lines.push(`5d Momentum: ${metrics.momentum5d.toFixed(2)}%`);
    if (metrics.momentum20d != null) lines.push(`20d Momentum: ${metrics.momentum20d.toFixed(2)}%`);
    if (metrics.momentum50d != null) lines.push(`50d Momentum: ${metrics.momentum50d.toFixed(2)}%`);
    if (metrics.bollingerWidth != null) lines.push(`Bollinger Width: ${metrics.bollingerWidth.toFixed(2)}%`);
    if (metrics.rangeTightness != null) lines.push(`Range Tightness (10d/30d): ${metrics.rangeTightness.toFixed(1)}%`);
    if (metrics.upDownVolume) lines.push(`Entry Day Volume Direction: ${metrics.upDownVolume}`);
    if (metrics.consecutiveUpDays != null) lines.push(`Consecutive Up Days: ${metrics.consecutiveUpDays}`);
    if (metrics.ema6_20CrossStatus) lines.push(`EMA 6/20 Cross: ${metrics.ema6_20CrossStatus}`);
    if (metrics.macdCrossStatus) lines.push(`MACD Status: ${metrics.macdCrossStatus}`);
    if (metrics.rsVsSpy != null) lines.push(`RS vs SPY: ${metrics.rsVsSpy.toFixed(2)}%`);
    if (metrics.resistanceTouchCount != null) lines.push(`Resistance Touch Count: ${metrics.resistanceTouchCount}`);
  }

  if (setup.entryTactics) {
    const tactics = setup.entryTactics as any;
    const activeTactics: string[] = [];
    if (tactics.fiveMinEMACross) activeTactics.push("5min EMA Cross");
    if (tactics.macdCross) activeTactics.push("MACD Cross");
    if (tactics.other) activeTactics.push(tactics.other);
    if (activeTactics.length > 0) {
      lines.push(`\nENTRY TACTICS: ${activeTactics.join(', ')}`);
    }
  }

  if (setup.points.length > 0) {
    lines.push(`\n--- ANNOTATED POINTS ---`);
    for (const point of setup.points) {
      lines.push(`\n[${point.pointRole.toUpperCase()}] Price: $${point.price.toFixed(2)}, Date: ${point.pointDate}`);
      if (point.percentFromEntry != null) lines.push(`  % from Entry: ${point.percentFromEntry.toFixed(2)}%`);
      if (point.percentFrom50d != null) lines.push(`  % from 50d SMA: ${point.percentFrom50d.toFixed(2)}%`);
      if (point.percentFrom200d != null) lines.push(`  % from 200d SMA: ${point.percentFrom200d.toFixed(2)}%`);

      const tech = point.technicalData as any;
      if (tech) {
        const techLines: string[] = [];
        if (tech.rsi14 != null) techLines.push(`RSI14: ${tech.rsi14.toFixed(1)}`);
        if (tech.volumeRatio != null) techLines.push(`VolRatio: ${tech.volumeRatio.toFixed(2)}`);
        if (tech.atrPercent != null) techLines.push(`ATR%: ${tech.atrPercent.toFixed(2)}%`);
        if (tech.macdHistogram != null) techLines.push(`MACD Hist: ${tech.macdHistogram.toFixed(4)}`);
        if (tech.bollingerWidth != null) techLines.push(`BBWidth: ${tech.bollingerWidth.toFixed(2)}%`);
        if (tech.distSma50 != null) techLines.push(`Dist50d: ${tech.distSma50.toFixed(2)}%`);
        if (tech.distSma200 != null) techLines.push(`Dist200d: ${tech.distSma200.toFixed(2)}%`);
        if (techLines.length > 0) lines.push(`  Technicals: ${techLines.join(' | ')}`);
      }
    }
  }

  return lines.join('\n');
}

function formatHistoricalContext(
  historicalSetups: SetupWithPoints[],
  patternStats: PatternStats,
  similarSetups: SimilarSetup[]
): string {
  const lines: string[] = [];

  lines.push(`\n=== LEARNING CONTEXT ===`);
  lines.push(`Total setups in library: ${patternStats.totalSetups}`);
  lines.push(`Setups with outcomes: ${patternStats.setupsWithOutcomes}`);
  lines.push(`Overall win rate: ${patternStats.winRate.toFixed(1)}%`);
  lines.push(`Average R/R achieved: ${patternStats.avgRR.toFixed(2)}`);

  if (Object.keys(patternStats.byPatternType).length > 0) {
    lines.push(`\nPattern Type Performance:`);
    for (const [type, stats] of Object.entries(patternStats.byPatternType)) {
      lines.push(`  ${type}: ${stats.count} setups, ${stats.wins} wins (${stats.winRate.toFixed(0)}% WR), avg R/R: ${stats.avgRR.toFixed(2)}`);
    }
  }

  if (similarSetups.length > 0) {
    lines.push(`\n=== SIMILAR PAST SETUPS ===`);
    for (const sim of similarSetups) {
      lines.push(`  ${sim.ticker} (${sim.patternType}) - Outcome: ${sim.outcome}, Similarity: ${sim.similarity}`);
    }
  }

  const relevantHistorical = historicalSetups
    .filter(s => s.outcome && s.outcome !== 'pending')
    .slice(0, 10);

  if (relevantHistorical.length > 0) {
    lines.push(`\n=== RECENT HISTORICAL SETUPS WITH OUTCOMES ===`);
    for (const setup of relevantHistorical) {
      const metrics = setup.calculatedMetrics as any;
      const rr = metrics?.riskReward ? `R/R: ${metrics.riskReward.toFixed(2)}` : '';
      const pnl = setup.pnlPercent != null ? `PnL: ${setup.pnlPercent.toFixed(1)}%` : '';
      lines.push(`  ${setup.ticker} (${setup.patternType}) - ${setup.outcome} ${rr} ${pnl}`.trim());
    }
  }

  return lines.join('\n');
}

function buildSystemPrompt(): string {
  return `You are an expert technical analyst and trading coach specializing in chart pattern recognition, breakout analysis, and setup quality evaluation. You evaluate stock chart setups that a trader has annotated with key inflection points (Entry, Stop, Target, Support, Resistance, Breakout/Breakdown).

Your evaluation considers:
1. RISK/REWARD QUALITY: Is the R/R ratio favorable (ideally 3:1 or better)? Is the stop placement logical?
2. TECHNICAL CONDITIONS: MA stacking, volume confirmation, momentum alignment, volatility state
3. PATTERN QUALITY: Does the annotated pattern match textbook criteria? How clean is the formation?
4. ENTRY TIMING: Is the entry at an optimal point (breakout, pullback to support, etc.)?
5. STOP PLACEMENT: Is the stop at a logical technical level (below support, below MA, etc.)?
6. VOLUME: Is there volume confirmation at key points?
7. MARKET CONTEXT: How does momentum and relative strength look?

When historical data is available, personalize your evaluation:
- Reference similar past setups and their outcomes
- Compare this setup's metrics to the trader's historical averages
- Note if this pattern type has been a strength or weakness for this trader
- Suggest improvements based on what has worked and hasn't worked historically

You MUST respond with valid JSON matching this exact schema:
{
  "score": <integer 1-10, where 10 is a perfect textbook setup>,
  "confidence": <integer 1-100, your confidence in the score>,
  "rrRatio": <number or null, calculated risk/reward ratio>,
  "verdict": "<one of: STRONG_BUY, BUY, NEUTRAL, CAUTION, AVOID>",
  "strengths": ["<specific strength 1>", "<specific strength 2>", ...],
  "weaknesses": ["<specific weakness 1>", ...],
  "suggestions": ["<actionable suggestion 1>", ...],
  "riskFlags": ["<risk flag 1>", ...]
}

Be specific and actionable. Reference actual numbers from the technical data. Do not use generic platitudes.`;
}

export async function evaluateSetup(setupId: number, userId: number): Promise<EvaluationResult> {
  const [setup] = await db!.select().from(patternTrainingSetups)
    .where(and(eq(patternTrainingSetups.id, setupId), eq(patternTrainingSetups.userId, userId)));

  if (!setup) throw new Error("Setup not found");

  const points = await db!.select().from(patternTrainingPoints)
    .where(eq(patternTrainingPoints.setupId, setupId));

  const setupWithPoints: SetupWithPoints = { ...setup, points };

  const historicalSetups = await getHistoricalSetups(userId, setupId);
  const patternStats = computePatternStats(historicalSetups);
  const similarSetups = findSimilarSetups(setupWithPoints, historicalSetups);

  const setupText = formatSetupForPrompt(setupWithPoints);
  const historicalText = formatHistoricalContext(historicalSetups, patternStats, similarSetups);

  const userPrompt = `Evaluate this trading setup:\n\n${setupText}\n${historicalText}`;
  const systemPrompt = buildSystemPrompt();

  console.log(`[PatternEval] Evaluating setup ${setupId} (${setup.ticker} - ${setup.patternType})`);
  console.log(`[PatternEval] Learning context: ${historicalSetups.length} historical setups, ${similarSetups.length} similar found`);

  const response = await openai.chat.completions.create({
    model: "gpt-5.1",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: 2000,
    temperature: 0.3,
  });

  const content = response.choices[0]?.message?.content || "{}";
  const usage = response.usage;
  console.log(`[PatternEval] Usage: prompt=${usage?.prompt_tokens}, completion=${usage?.completion_tokens}`);

  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error("Failed to parse AI response");
    }
  }

  const learningContext: LearningContext = {
    totalSetupsUsed: historicalSetups.length,
    setupsWithOutcomes: patternStats.setupsWithOutcomes,
    similarSetupsFound: similarSetups.length,
    patternTypesKnown: Object.keys(patternStats.byPatternType),
  };

  const result: EvaluationResult = {
    score: Math.max(1, Math.min(10, parsed.score || 5)),
    confidence: Math.max(1, Math.min(100, parsed.confidence || 50)),
    rrRatio: typeof parsed.rrRatio === 'number' ? parsed.rrRatio : null,
    verdict: parsed.verdict || 'NEUTRAL',
    strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
    weaknesses: Array.isArray(parsed.weaknesses) ? parsed.weaknesses : [],
    suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
    riskFlags: Array.isArray(parsed.riskFlags) ? parsed.riskFlags : [],
    similarSetups,
    patternStats,
    learningContext,
  };

  await db!.delete(patternTrainingEvaluations)
    .where(and(
      eq(patternTrainingEvaluations.setupId, setupId),
      eq(patternTrainingEvaluations.userId, userId),
    ));

  await db!.insert(patternTrainingEvaluations).values({
    setupId,
    userId,
    score: result.score,
    confidence: result.confidence,
    rrRatio: result.rrRatio,
    verdict: result.verdict,
    strengths: result.strengths,
    weaknesses: result.weaknesses,
    suggestions: result.suggestions,
    riskFlags: result.riskFlags,
    similarSetups: result.similarSetups,
    patternStats: result.patternStats,
    learningContext: result.learningContext,
  });

  console.log(`[PatternEval] Setup ${setupId} scored ${result.score}/10 (${result.verdict}), confidence: ${result.confidence}%`);

  return result;
}

export async function getExistingEvaluation(setupId: number, userId: number): Promise<PatternTrainingEvaluation | null> {
  const [evaluation] = await db!.select().from(patternTrainingEvaluations)
    .where(and(
      eq(patternTrainingEvaluations.setupId, setupId),
      eq(patternTrainingEvaluations.userId, userId),
    ))
    .orderBy(desc(patternTrainingEvaluations.createdAt))
    .limit(1);

  return evaluation || null;
}
