import OpenAI from "openai";
import { SYSTEM_PROMPT, HISTORICAL_SYSTEM_PROMPT, PROMPT_VERSION, buildEvaluationPrompt, type MarketContext } from "./prompts";
import { sentinelModels } from "./models";
import { fetchMarketSentiment, fetchSectorSentiment, fetchHistoricalMarketSentiment, fetchHistoricalSectorSentiment } from "./sentiment";
import { fetchTechnicalData, fetchHistoricalTechnicalData } from "./technicals";
import { getWeightsForEvaluation, type TnnWeightContext } from "./tnn";
import type { EvaluationRequest, EvaluationResult } from "./types";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

// Infer setup type from thesis keywords (fallback if no explicit setupType provided)
function inferSetupType(thesis: string): string {
  const lower = thesis.toLowerCase();
  if (lower.includes("pullback") || lower.includes("pull back") || lower.includes("retest")) return "pullback";
  if (lower.includes("breakout") || lower.includes("break out") || lower.includes("new high")) return "breakout";
  if (lower.includes("reclaim") || lower.includes("recover")) return "reclaim";
  if (lower.includes("cup") || lower.includes("handle")) return "cup_and_handle";
  if (lower.includes("gap") || lower.includes("earnings") || lower.includes("catalyst") || lower.includes("pivot")) return "episodic_pivot";
  if (lower.includes("htf") || lower.includes("high tight") || lower.includes("tight flag")) return "high_tight_flag";
  if (lower.includes("vcp") || lower.includes("volatility contraction")) return "vcp";
  if (lower.includes("low cheat")) return "low_cheat";
  if (lower.includes("undercut") || lower.includes("rally")) return "undercut_rally";
  if (lower.includes("orb") || lower.includes("opening range")) return "orb";
  if (lower.includes("lost 50") || lower.includes("lost 50sma")) return "short_lost_50";
  if (lower.includes("lost 200") || lower.includes("lost 200sma")) return "short_lost_200";
  return "breakout"; // Default to breakout
}

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
    choppiness: marketSentiment.choppiness ? {
      daily: marketSentiment.choppiness.daily,
      weekly: marketSentiment.choppiness.weekly,
      recommendation: marketSentiment.choppiness.recommendation,
    } : undefined,
    summary: marketSentiment.summary,
  } : undefined;

  // Log technical data availability for debugging stop/target resolution
  if (technicalData) {
    console.log(`[Sentinel] Technical data for ${request.symbol}: LOD=$${technicalData.todayLow?.toFixed(2)}, 21DMA=$${technicalData.sma21?.toFixed(2)}`);
  } else {
    console.log(`[Sentinel] No technical data available for ${request.symbol}`);
  }
  
  // Log stop/target levels for debugging
  console.log(`[Sentinel] Stop: price=${request.stopPrice}, level=${request.stopPriceLevel}`);
  console.log(`[Sentinel] Target: price=${request.targetPrice}, level=${request.targetPriceLevel}`);

  // Derive active market conditions from sentiment for TNN
  const activeConditions: string[] = [];
  if (marketContext?.choppiness?.daily?.state === "CHOPPY") activeConditions.push("choppy_daily");
  if (marketContext?.choppiness?.weekly?.state === "CHOPPY") activeConditions.push("choppy_weekly");
  if (marketContext?.choppiness?.daily?.state === "TRENDING") activeConditions.push("trending_daily");
  if (marketContext?.choppiness?.weekly?.state === "TRENDING") activeConditions.push("trending_weekly");
  if (marketContext?.daily?.state === "RISK-ON") activeConditions.push("risk_on");
  if (marketContext?.daily?.state === "RISK-OFF") activeConditions.push("risk_off");
  if (marketContext?.daily?.canaryTags?.includes("Volatility Stress")) activeConditions.push("volatility_stress");
  if (marketContext?.daily?.canaryTags?.includes("Narrow Leadership")) activeConditions.push("narrow_leadership");
  
  // Use explicit setupType if provided, otherwise infer from thesis
  const setupType = request.setupType || inferSetupType(request.thesis || "");
  console.log(`[Sentinel] Setup type: ${setupType}${request.setupType ? " (explicit)" : " (inferred from thesis)"}`);
  
  // Fetch TNN weights for evaluation
  let tnnContext: TnnWeightContext | undefined;
  try {
    tnnContext = await getWeightsForEvaluation(setupType, activeConditions);
    console.log(`[Sentinel TNN] Active conditions: ${activeConditions.join(", ") || "none"}`);
    console.log(`[Sentinel TNN] Setup: ${setupType}, Applied modifiers: ${tnnContext.modifiers.length}`);
  } catch (e) {
    console.log("[Sentinel TNN] Could not fetch TNN weights, proceeding without");
  }

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
    historicalDate,
    tnnContext
  );

  const systemPrompt = isHistorical ? HISTORICAL_SYSTEM_PROMPT : SYSTEM_PROMPT;

  // Use higher token limit for base eval since gpt-5.1 may need more space
  // Deep eval (gpt-5.2) is more efficient and can work with 2500
  const maxTokens = request.deepEval ? 2500 : 4000;
  
  console.log(`[Sentinel Eval] Calling ${model} with max_tokens=${maxTokens}`);
  
  const response = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: maxTokens,
  });

  const content = response.choices[0]?.message?.content || "{}";
  const finishReason = response.choices[0]?.finish_reason;
  const usage = response.usage;
  
  console.log(`[Sentinel Eval] Model: ${model}, Finish reason: ${finishReason}`);
  console.log(`[Sentinel Eval] Usage: prompt=${usage?.prompt_tokens}, completion=${usage?.completion_tokens}, total=${usage?.total_tokens}`);
  console.log("[Sentinel Eval] Raw AI response length:", content.length);
  console.log("[Sentinel Eval] Raw AI response (first 1000 chars):", content.substring(0, 1000));
  
  let parsed: any;
  
  try {
    parsed = JSON.parse(content);
    console.log("[Sentinel Eval] Parsed response keys:", Object.keys(parsed));
    
    // Log presence of key fields for debugging
    const hasVerdictSummary = !!parsed.verdictSummary;
    const hasMoneyBreakdown = !!parsed.moneyBreakdown;
    const hasWhyBullets = Array.isArray(parsed.whyBullets) && parsed.whyBullets.length > 0;
    const hasRiskFlags = Array.isArray(parsed.riskFlags) && parsed.riskFlags.length > 0;
    console.log(`[Sentinel Eval] Key fields: verdictSummary=${hasVerdictSummary}, moneyBreakdown=${hasMoneyBreakdown}, whyBullets=${hasWhyBullets}, riskFlags=${hasRiskFlags}`);
    
    // Generate conservative fallbacks for missing key fields - never fabricate data
    const missingFields: string[] = [];
    
    // Only use explicitly provided values - don't fabricate or assume
    const resolvedStop = request.stopPrice || null;
    const resolvedTarget = request.targetPrice || null;
    const isIncomplete = !hasVerdictSummary || !hasMoneyBreakdown || !hasWhyBullets || !hasRiskFlags;
    
    // Generate fallback verdictSummary if missing - always provide this for UX
    if (!hasVerdictSummary) {
      missingFields.push('verdictSummary');
      const status = parsed.status || 'YELLOW';
      let verdict = isIncomplete 
        ? "AI evaluation returned limited data. Review the plan manually."
        : "Plan needs review.";
      if (status === 'GREEN' && !isIncomplete) {
        verdict = "Plan passes basic requirements. Proceed with defined risk.";
      } else if (status === 'RED') {
        verdict = "Plan has significant issues that need to be addressed before entry.";
      }
      parsed.verdictSummary = {
        verdict,
        primaryBlockers: hasRiskFlags 
          ? parsed.riskFlags.filter((rf: any) => rf.tier === 'fatal' || rf.severity === 'high').slice(0, 3).map((rf: any) => rf.flag || rf)
          : isIncomplete ? ["INCOMPLETE_EVALUATION"] : [],
      };
    }
    
    // Generate fallback moneyBreakdown ONLY if we have actual values - never fabricate
    if (!hasMoneyBreakdown && request.positionSize && request.entryPrice && resolvedStop && resolvedTarget) {
      missingFields.push('moneyBreakdown');
      const riskPerShare = Math.abs(request.entryPrice - resolvedStop);
      const totalRisk = riskPerShare * request.positionSize;
      const profitPerShare = resolvedTarget - request.entryPrice;
      parsed.moneyBreakdown = {
        totalRisk: `$${totalRisk.toFixed(2)}`,
        firstTrimProfit: profitPerShare > 0 ? `$${(profitPerShare * 0.3 * request.positionSize).toFixed(2)}` : null,
        targetProfit: profitPerShare > 0 ? `$${(profitPerShare * 0.7 * request.positionSize).toFixed(2)}` : null,
        totalPotentialProfit: profitPerShare > 0 ? `$${(profitPerShare * request.positionSize).toFixed(2)}` : null,
      };
    }
    
    // Generate fallback planSummary from actual provided values only
    const hasPlanSummary = !!parsed.planSummary;
    if (!hasPlanSummary && request.entryPrice) {
      missingFields.push('planSummary');
      const riskPerShare = resolvedStop ? Math.abs(request.entryPrice - resolvedStop) : null;
      const riskPct = (resolvedStop && riskPerShare) ? ((riskPerShare / request.entryPrice) * 100).toFixed(2) : null;
      const rrRatio = (resolvedStop && resolvedTarget && riskPerShare && riskPerShare > 0) 
        ? ((resolvedTarget - request.entryPrice) / riskPerShare).toFixed(2) 
        : null;
      parsed.planSummary = {
        entry: `$${request.entryPrice.toFixed(2)}`,
        stop: resolvedStop ? `$${resolvedStop.toFixed(2)}` : request.stopPriceLevel || 'Level-based',
        riskPerShare: riskPerShare ? `$${riskPerShare.toFixed(2)} (${riskPct}%)` : 'See level',
        firstTrim: null, // Don't fabricate first trim
        target: resolvedTarget ? `$${resolvedTarget.toFixed(2)}` : request.targetPriceLevel || null,
        rrRatio: rrRatio ? `${rrRatio}:1` : null,
      };
    }
    
    // Generate minimal whyBullets from actual data only
    if (!hasWhyBullets) {
      missingFields.push('whyBullets');
      const bullets: string[] = [];
      if (request.thesis && request.thesis.trim().length > 0) {
        bullets.push(request.thesis.substring(0, 150));
      }
      if (technicalData?.sma21 && technicalData?.sma50 && request.entryPrice > technicalData.sma21 && request.entryPrice > technicalData.sma50) {
        bullets.push("Price above key moving averages (21/50 DMA)");
      }
      if (bullets.length === 0) {
        bullets.push("AI analysis incomplete - review plan manually");
      }
      parsed.whyBullets = bullets;
    }
    
    // Generate riskFlags only from actual issues we can detect
    if (!hasRiskFlags) {
      missingFields.push('riskFlags');
      const flags: { flag: string; severity: string; tier: string; detail: string }[] = [];
      
      // Flag clearly known issues
      if (!request.stopPrice && !request.stopPriceLevel) {
        flags.push({ flag: "STOP_NOT_SPECIFIED", severity: "high", tier: "missing_input", detail: "No stop price or level provided" });
      }
      if (resolvedStop && request.entryPrice && request.direction === 'long') {
        const riskPct = ((request.entryPrice - resolvedStop) / request.entryPrice * 100);
        if (riskPct > 8) {
          flags.push({ flag: "WIDE_STOP", severity: "medium", tier: "contextual", detail: `Stop is ${riskPct.toFixed(1)}% from entry` });
        }
      }
      // Always flag that evaluation is incomplete
      flags.push({ flag: "EVALUATION_INCOMPLETE", severity: "low", tier: "missing_input", detail: "AI evaluation returned limited data - consider using Deep Eval" });
      parsed.riskFlags = flags;
    }
    
    if (missingFields.length > 0) {
      console.log(`[Sentinel Eval] Generated fallbacks for: ${missingFields.join(', ')}`);
    }
  } catch (err) {
    console.error("[Sentinel Eval] JSON parse error:", err);
    console.error("[Sentinel Eval] Raw content that failed to parse:", content);
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
  
  // Normalize riskFlags - support both old string[] and new object[] format with tier
  let normalizedRiskFlags: { flag: string; severity: 'high' | 'medium' | 'low'; tier?: 'fatal' | 'contextual' | 'missing_input'; detail: string }[] = [];
  if (Array.isArray(parsed.riskFlags)) {
    normalizedRiskFlags = parsed.riskFlags.map((rf: any) => {
      if (typeof rf === 'string') {
        return { flag: rf, severity: 'medium' as const, detail: rf };
      }
      const severity = (['high', 'medium', 'low'].includes(rf.severity) ? rf.severity : 'medium') as 'high' | 'medium' | 'low';
      const tier = (['fatal', 'contextual', 'missing_input'].includes(rf.tier) ? rf.tier : undefined) as 'fatal' | 'contextual' | 'missing_input' | undefined;
      return {
        flag: rf.flag || 'UNKNOWN',
        severity,
        tier,
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
    instrumentType: ['ETF', 'STOCK', 'INDEX'].includes(parsed.instrumentType) ? parsed.instrumentType : undefined,
    
    // Verdict summary - primary blockers at top
    verdictSummary: parsed.verdictSummary ? {
      verdict: parsed.verdictSummary.verdict || '',
      primaryBlockers: Array.isArray(parsed.verdictSummary.primaryBlockers) ? parsed.verdictSummary.primaryBlockers : [],
    } : undefined,
    
    // Money breakdown - real dollars
    moneyBreakdown: parsed.moneyBreakdown ? {
      totalRisk: parsed.moneyBreakdown.totalRisk || '$0',
      firstTrimProfit: parsed.moneyBreakdown.firstTrimProfit || null,
      targetProfit: parsed.moneyBreakdown.targetProfit || null,
      totalPotentialProfit: parsed.moneyBreakdown.totalPotentialProfit || '$0',
    } : undefined,
    
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
      firstTrim: request.targetPrice 
        ? `$${request.targetPrice.toFixed(2)}` 
        : null,
      target: request.targetProfitPrice 
        ? `$${request.targetProfitPrice.toFixed(2)}` 
        : request.targetProfitLevel 
          ? request.targetProfitLevel.replace(/_/g, ' ')
          : null,
      rrRatio: request.stopPrice && request.targetProfitPrice
        ? `${(Math.abs(request.targetProfitPrice - request.entryPrice) / Math.abs(request.entryPrice - request.stopPrice)).toFixed(1)}:1`
        : null,
    },
    
    // Structured feedback
    whyBullets: Array.isArray(parsed.whyBullets) ? parsed.whyBullets : [],
    riskFlags: normalizedRiskFlags,
    improvements: Array.isArray(parsed.improvements) ? parsed.improvements : [],
    fixesToPass: Array.isArray(parsed.fixesToPass) ? parsed.fixesToPass : [],
    ruleChecklist,
    
    // Process analysis for historical trades
    processAnalysis: parsed.processAnalysis ? {
      entryExecution: parsed.processAnalysis.entryExecution || '',
      stopManagement: parsed.processAnalysis.stopManagement || '',
      targetManagement: parsed.processAnalysis.targetManagement || '',
      emotionalControl: parsed.processAnalysis.emotionalControl || '',
      rulesFollowed: typeof parsed.processAnalysis.rulesFollowed === 'number' ? parsed.processAnalysis.rulesFollowed : 0,
      rulesViolated: typeof parsed.processAnalysis.rulesViolated === 'number' ? parsed.processAnalysis.rulesViolated : 0,
    } : undefined,
    
    // Legacy fields
    recommendation,
    reasoning: reasoning || "Evaluation complete. See structured feedback above.",
    model,
    promptVersion: PROMPT_VERSION,
  };

  let finalTradeId = tradeId;
  
  if (!finalTradeId) {
    // Build entry date from tradeDate and tradeTime if provided
    let entryDate: Date | undefined;
    if (request.tradeDate) {
      entryDate = new Date(request.tradeDate);
      if (request.tradeTime) {
        const [hours, minutes] = request.tradeTime.split(':').map(Number);
        entryDate.setHours(hours, minutes, 0, 0);
      }
    }
    
    // Create initial lot entry if we have date, position size, and entry price
    let lotEntries: Array<{
      id: string;
      dateTime: string;
      qty: string;
      buySell: "buy" | "sell";
      price: string;
    }> | undefined;
    
    if (entryDate && request.positionSize && request.entryPrice) {
      const lotId = `lot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      lotEntries = [{
        id: lotId,
        dateTime: entryDate.toISOString(),
        qty: request.positionSize.toString(),
        buySell: request.direction === 'long' ? 'buy' : 'sell',
        price: request.entryPrice.toString(),
      }];
    }
    
    const trade = await sentinelModels.createTrade({
      userId,
      symbol: request.symbol.toUpperCase(),
      direction: request.direction,
      entryPrice: request.entryPrice,
      entryDate,
      stopPrice: request.stopPrice,
      partialPrice: request.targetPrice, // First profit trim → partialPrice
      targetPrice: request.targetProfitPrice, // Full position exit → targetPrice
      targetProfitLevel: request.targetProfitLevel,
      positionSize: request.positionSize,
      thesis: request.thesis,
      setupType: setupType, // Store the setup type (explicit or inferred)
      status: "considering",
      lotEntries,
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
