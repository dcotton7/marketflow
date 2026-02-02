import OpenAI from "openai";
import { SYSTEM_PROMPT, PROMPT_VERSION, buildEvaluationPrompt, type MarketContext } from "./prompts";
import { sentinelModels } from "./models";
import { fetchMarketSentiment, fetchSectorSentiment } from "./sentiment";
import type { EvaluationRequest, EvaluationResult } from "./types";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export async function evaluateTrade(
  request: EvaluationRequest,
  userId: number,
  tradeId?: number
): Promise<{ evaluation: EvaluationResult; tradeId: number }> {
  const model = request.deepEval ? "gpt-5.2" : "gpt-5.1";
  
  // Fetch trader context and market context in parallel
  const [activePositions, watchlist, rules, marketSentiment, sectorSentiment] = await Promise.all([
    sentinelModels.getTradesByStatus(userId, "active"),
    sentinelModels.getWatchlistByUser(userId),
    sentinelModels.getActiveRulesByUser(userId),
    fetchMarketSentiment().catch(() => null),
    fetchSectorSentiment(request.symbol).catch(() => null),
  ]);

  const traderContext = {
    activePositions: activePositions.map(p => ({
      symbol: p.symbol,
      direction: p.direction,
      entryPrice: p.entryPrice,
    })),
    watchlist: watchlist.map(w => ({
      symbol: w.symbol,
      thesis: w.thesis || undefined,
    })),
    rules: rules.map(r => ({
      name: r.name,
      category: r.category || undefined,
    })),
  };

  // Build market context for AI evaluation
  const marketContext: MarketContext | undefined = marketSentiment ? {
    weekly: {
      state: marketSentiment.weekly.state,
      stateName: marketSentiment.weekly.stateName,
      confidence: marketSentiment.weekly.confidence,
    },
    daily: {
      state: marketSentiment.daily.state,
      confidence: marketSentiment.daily.confidence,
      canaryTags: marketSentiment.daily.canaryTags,
    },
    sector: sectorSentiment ? {
      sector: sectorSentiment.sector,
      etf: sectorSentiment.etf,
      state: sectorSentiment.state,
      stateName: sectorSentiment.stateName,
      confidence: sectorSentiment.confidence,
    } : undefined,
    summary: marketSentiment.summary,
  } : undefined;

  const userPrompt = buildEvaluationPrompt(
    request.symbol,
    request.direction,
    request.entryPrice,
    request.stopPrice,
    request.stopPriceLevel,
    request.targetPrice,
    request.targetPriceLevel,
    request.positionSize,
    request.positionSizeUnit,
    request.thesis,
    traderContext,
    marketContext
  );

  const response = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt }
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: 1500,
  });

  const content = response.choices[0]?.message?.content || "{}";
  let parsed: any;
  
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = {
      score: 50,
      reasoning: "Failed to parse AI response. Please try again.",
      riskFlags: ["PARSE_ERROR"],
      recommendation: "caution"
    };
  }

  const evaluation: EvaluationResult = {
    score: Math.min(100, Math.max(0, parsed.score || 50)),
    reasoning: parsed.reasoning || "No reasoning provided",
    riskFlags: Array.isArray(parsed.riskFlags) ? parsed.riskFlags : [],
    recommendation: ["proceed", "caution", "avoid"].includes(parsed.recommendation) 
      ? parsed.recommendation 
      : "caution",
    model,
    promptVersion: PROMPT_VERSION,
  };

  let finalTradeId = tradeId;
  
  if (!finalTradeId) {
    const trade = await sentinelModels.createTrade({
      userId,
      symbol: request.symbol.toUpperCase(),
      direction: request.direction,
      entryPrice: request.entryPrice,
      stopPrice: request.stopPrice,
      targetPrice: request.targetPrice,
      positionSize: request.positionSize,
      thesis: request.thesis,
      status: "considering",
    });
    finalTradeId = trade.id;
  }

  await sentinelModels.createEvaluation({
    tradeId: finalTradeId,
    userId,
    model: evaluation.model,
    promptVersion: evaluation.promptVersion,
    score: evaluation.score,
    reasoning: evaluation.reasoning,
    riskFlags: evaluation.riskFlags,
    recommendation: evaluation.recommendation,
    isDeepEval: request.deepEval || false,
  });

  await sentinelModels.createEvent({
    tradeId: finalTradeId,
    userId,
    eventType: "evaluation",
    newValue: evaluation.recommendation,
    description: `${request.deepEval ? 'Deep ' : ''}Evaluation: Score ${evaluation.score}/100 - ${evaluation.recommendation.toUpperCase()}`,
  });

  return { evaluation, tradeId: finalTradeId };
}
