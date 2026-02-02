import OpenAI from "openai";
import { SYSTEM_PROMPT, HISTORICAL_SYSTEM_PROMPT, PROMPT_VERSION, buildEvaluationPrompt, type MarketContext } from "./prompts";
import { sentinelModels } from "./models";
import { fetchMarketSentiment, fetchSectorSentiment, fetchHistoricalMarketSentiment, fetchHistoricalSectorSentiment } from "./sentiment";
import { fetchTechnicalData, fetchHistoricalTechnicalData } from "./technicals";
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
  
  // Parse historical date if provided
  let historicalDate: Date | null = null;
  if (isHistorical && request.tradeDate) {
    historicalDate = new Date(request.tradeDate);
    if (request.tradeTime) {
      const [hours, minutes] = request.tradeTime.split(':').map(Number);
      historicalDate.setHours(hours, minutes, 0, 0);
    }
  }
  
  // Fetch all context data in parallel
  // Use historical data fetchers if a historical date is provided
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
    historicalDate 
      ? fetchHistoricalMarketSentiment(historicalDate).catch(() => null)
      : fetchMarketSentiment().catch(() => null),
    historicalDate
      ? fetchHistoricalSectorSentiment(request.symbol, historicalDate).catch(() => null)
      : fetchSectorSentiment(request.symbol).catch(() => null),
    historicalDate
      ? fetchHistoricalTechnicalData(request.symbol, historicalDate).catch(() => null)
      : fetchTechnicalData(request.symbol).catch(() => null),
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
    technicalData,
    historicalDate
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
      status: "YELLOW",
      confidence: "LOW",
      modelTag: "UNKNOWN",
      whyBullets: [],
      riskFlags: [{ flag: "PARSE_ERROR", severity: "high", detail: "Failed to parse AI response" }],
      improvements: ["Please try again"],
      ruleChecklist: [],
    };
  }
  
  // Map status to recommendation for backwards compatibility
  const statusToRecommendation: Record<string, 'proceed' | 'caution' | 'avoid'> = {
    "GREEN": "proceed",
    "YELLOW": "caution",
    "RED": "avoid",
  };
  
  // Map historical recommendation values
  const historicalRecommendationMap: Record<string, 'proceed' | 'caution' | 'avoid'> = {
    "excellent_process": "proceed",
    "good_process": "proceed",
    "needs_improvement": "caution",
    "poor_process": "avoid",
  };
  
  // Determine recommendation from status or explicit field
  let recommendation: 'proceed' | 'caution' | 'avoid' = "caution";
  if (parsed.status && statusToRecommendation[parsed.status]) {
    recommendation = statusToRecommendation[parsed.status];
  } else if (parsed.recommendation && historicalRecommendationMap[parsed.recommendation]) {
    recommendation = historicalRecommendationMap[parsed.recommendation];
  } else if (["proceed", "caution", "avoid"].includes(parsed.recommendation)) {
    recommendation = parsed.recommendation;
  }
  
  // Build reasoning - prefer parsed.reasoning if available (especially for historical analysis)
  let reasoning = "";
  if (parsed.reasoning && typeof parsed.reasoning === 'string' && parsed.reasoning.trim().length > 0) {
    reasoning = parsed.reasoning;
  } else if (parsed.whyBullets && Array.isArray(parsed.whyBullets) && parsed.whyBullets.length > 0) {
    reasoning = "• " + parsed.whyBullets.join("\n• ");
  }
  
  // Add improvements section to reasoning if using synthesized reasoning
  if (!parsed.reasoning && parsed.improvements && Array.isArray(parsed.improvements) && parsed.improvements.length > 0) {
    reasoning += "\n\nWhat would make this better:\n• " + parsed.improvements.join("\n• ");
  }
  
  // Normalize riskFlags - support both old string[] and new object[] format
  let normalizedRiskFlags: { flag: string; severity: 'high' | 'medium' | 'low'; detail: string }[] = [];
  if (Array.isArray(parsed.riskFlags)) {
    normalizedRiskFlags = parsed.riskFlags.map((rf: any) => {
      if (typeof rf === 'string') {
        return { flag: rf, severity: 'medium' as const, detail: rf };
      }
      const severity = (['high', 'medium', 'low'].includes(rf.severity) ? rf.severity : 'medium') as 'high' | 'medium' | 'low';
      return {
        flag: rf.flag || 'UNKNOWN',
        severity,
        detail: rf.detail || rf.flag || '',
      };
    });
  }
  
  // Ensure rule checklist is properly formatted
  const ruleChecklist = Array.isArray(parsed.ruleChecklist) 
    ? parsed.ruleChecklist.map((item: any) => ({
        rule: item.rule || 'Unknown rule',
        status: ['followed', 'violated', 'na'].includes(item.status) ? item.status : 'na',
        note: item.note || undefined,
      }))
    : [];

  const evaluation: EvaluationResult = {
    // Core decision gate
    score: Math.min(100, Math.max(0, parsed.score || 50)),
    status: ['GREEN', 'YELLOW', 'RED'].includes(parsed.status) ? parsed.status : 'YELLOW',
    confidence: ['HIGH', 'MEDIUM', 'LOW'].includes(parsed.confidence) ? parsed.confidence : 'MEDIUM',
    modelTag: ['BREAKOUT', 'RECLAIM', 'CUP_AND_HANDLE', 'PULLBACK', 'EPISODIC_PIVOT', 'UNKNOWN'].includes(parsed.modelTag) 
      ? parsed.modelTag : 'UNKNOWN',
    
    // User's plan summary
    planSummary: parsed.planSummary || {
      entry: `$${request.entryPrice.toFixed(2)}`,
      stop: request.stopPrice 
        ? `$${request.stopPrice.toFixed(2)}` 
        : request.stopPriceLevel 
          ? request.stopPriceLevel.replace(/_/g, ' ') 
          : 'Not set',
      riskPerShare: request.stopPrice 
        ? `$${Math.abs(request.entryPrice - request.stopPrice).toFixed(2)} (${(Math.abs(request.entryPrice - request.stopPrice) / request.entryPrice * 100).toFixed(1)}%)`
        : 'N/A',
      target: request.targetPrice 
        ? `$${request.targetPrice.toFixed(2)}` 
        : request.targetPriceLevel 
          ? request.targetPriceLevel.replace(/_/g, ' ')
          : null,
      rrRatio: request.stopPrice && request.targetPrice
        ? `${(Math.abs(request.targetPrice - request.entryPrice) / Math.abs(request.entryPrice - request.stopPrice)).toFixed(1)}:1`
        : null,
    },
    
    // Structured feedback
    whyBullets: Array.isArray(parsed.whyBullets) ? parsed.whyBullets : [],
    riskFlags: normalizedRiskFlags,
    improvements: Array.isArray(parsed.improvements) ? parsed.improvements : [],
    ruleChecklist,
    
    // Legacy fields
    recommendation,
    reasoning: reasoning || "Evaluation complete. See structured feedback above.",
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

  // Convert riskFlags to string[] for database storage (dashboard compatibility)
  const riskFlagsForDb = evaluation.riskFlags.map(rf => 
    typeof rf === 'string' ? rf : rf.flag
  );

  await sentinelModels.createEvaluation({
    tradeId: finalTradeId,
    userId,
    model: evaluation.model,
    promptVersion: evaluation.promptVersion,
    score: evaluation.score,
    reasoning: evaluation.reasoning,
    riskFlags: riskFlagsForDb,
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
