import OpenAI from "openai";
import { SYSTEM_PROMPT, HISTORICAL_SYSTEM_PROMPT, PROMPT_VERSION, buildEvaluationPrompt, type MarketContext } from "./prompts";
import { sentinelModels } from "./models";
import { fetchMarketSentiment, fetchSectorSentiment } from "./sentiment";
import { fetchTechnicalData } from "./technicals";
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
  const isHistorical = request.historicalAnalysis || false;
  
  // Fetch all context data in parallel
  const [
    user,
    activePositions,
    watchlist,
    rules,
    marketSentiment,
    sectorSentiment,
    technicalData
  ] = await Promise.all([
    sentinelModels.getUserById(userId),
    sentinelModels.getTradesByStatus(userId, "active"),
    sentinelModels.getWatchlistByUser(userId),
    sentinelModels.getActiveRulesByUser(userId),
    fetchMarketSentiment().catch(() => null),
    fetchSectorSentiment(request.symbol).catch(() => null),
    fetchTechnicalData(request.symbol).catch(() => null),
  ]);

  const accountSize = user?.accountSize || 1000000;

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
      id: r.id,
      name: r.name,
      category: r.category || undefined,
      description: r.description || undefined,
      severity: r.severity || undefined,
    })),
    accountSize,
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
    marketContext,
    technicalData
  );

  const systemPrompt = isHistorical ? HISTORICAL_SYSTEM_PROMPT : SYSTEM_PROMPT;

  const response = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: 2500, // Increased for richer responses
  });

  const content = response.choices[0]?.message?.content || "{}";
  console.log("[Sentinel Eval] Raw AI response:", content.substring(0, 500));
  
  let parsed: any;
  
  try {
    parsed = JSON.parse(content);
    console.log("[Sentinel Eval] Parsed response keys:", Object.keys(parsed));
  } catch (err) {
    console.error("[Sentinel Eval] JSON parse error:", err);
    parsed = {
      score: 50,
      reasoning: "Failed to parse AI response. Please try again.",
      riskFlags: ["PARSE_ERROR"],
      recommendation: "caution"
    };
  }
  
  // Ensure required fields exist
  if (!parsed.reasoning || !parsed.score) {
    console.error("[Sentinel Eval] Missing required fields in response:", parsed);
    // If we have technical summary or rule checklist but no reasoning, build from those
    let fallbackReasoning = "";
    if (parsed.technicalSummary) {
      fallbackReasoning += "Technical Analysis:\n";
      if (parsed.technicalSummary.maStructure) fallbackReasoning += `• MA Structure: ${parsed.technicalSummary.maStructure}\n`;
      if (parsed.technicalSummary.calculatedRR) fallbackReasoning += `• R:R Ratio: ${parsed.technicalSummary.calculatedRR}\n`;
      if (parsed.technicalSummary.dollarRisk) fallbackReasoning += `• Dollar Risk: ${parsed.technicalSummary.dollarRisk}\n`;
    }
    if (parsed.ruleChecklist && parsed.ruleChecklist.length > 0) {
      fallbackReasoning += "\nRule Checklist:\n";
      for (const item of parsed.ruleChecklist) {
        fallbackReasoning += `• ${item.rule}: ${item.status}\n`;
      }
    }
    
    parsed = {
      score: parsed.score || 50,
      reasoning: parsed.reasoning || fallbackReasoning || "AI response was incomplete. Please try again.",
      riskFlags: parsed.riskFlags || [],
      recommendation: parsed.recommendation || "caution",
      technicalSummary: parsed.technicalSummary,
      ruleChecklist: parsed.ruleChecklist,
    };
  }
  
  // Map historical recommendation values to standard ones
  const historicalRecommendationMap: Record<string, string> = {
    "excellent_process": "proceed",
    "good_process": "proceed",
    "needs_improvement": "caution",
    "poor_process": "avoid",
  };
  if (parsed.recommendation && historicalRecommendationMap[parsed.recommendation]) {
    parsed.recommendation = historicalRecommendationMap[parsed.recommendation];
  }

  // Build reasoning with technical summary if available
  let reasoning = parsed.reasoning || "No reasoning provided";
  
  // Append technical summary if provided
  if (parsed.technicalSummary) {
    const ts = parsed.technicalSummary;
    reasoning += `\n\n📊 Technical Summary:`;
    if (ts.maStructure) reasoning += `\n• MA Structure: ${ts.maStructure}`;
    if (ts.calculatedRR) reasoning += `\n• R:R Ratio: ${ts.calculatedRR}`;
    if (ts.dollarRisk) reasoning += `\n• Dollar Risk: ${ts.dollarRisk}`;
    if (ts.percentRisk) reasoning += `\n• Account Risk: ${ts.percentRisk}`;
    if (ts.stopQuality) reasoning += `\n• Stop Quality: ${ts.stopQuality}`;
    if (ts.suggestedStop) reasoning += `\n• Suggested Stop: ${ts.suggestedStop}`;
  }

  // Append rule checklist if provided
  if (parsed.ruleChecklist && Array.isArray(parsed.ruleChecklist) && parsed.ruleChecklist.length > 0) {
    reasoning += `\n\n📋 Rule Checklist:`;
    for (const item of parsed.ruleChecklist) {
      const icon = item.status === 'followed' ? '✅' : item.status === 'violated' ? '❌' : '➖';
      reasoning += `\n${icon} ${item.rule}${item.note ? ` - ${item.note}` : ''}`;
    }
  }

  const evaluation: EvaluationResult = {
    score: Math.min(100, Math.max(0, parsed.score || 50)),
    reasoning,
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
    description: `${request.deepEval ? 'Deep ' : ''}${isHistorical ? 'Historical ' : ''}Evaluation: Score ${evaluation.score}/100 - ${evaluation.recommendation.toUpperCase()}`,
  });

  return { evaluation, tradeId: finalTradeId };
}
