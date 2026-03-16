import { Express, Request, Response } from "express";
import { db, isDatabaseAvailable } from "../db";
import { scannerThoughts, scannerIdeas, scannerFavorites, scanChartRatings, scanTuningHistory, scanSessions, sentinelUsers, indicatorLearningSummary, thoughtScoreRules, thoughtSelectionWeights, indicatorExecutionStats, optimizerDisplaySettings, bigideaSetups, bigideaSetupIndicators, bigideaExtractedIdeas, bigideaValidationRatings, uploads, setupUploads, userIndicators, indicatorApprovalQueue, type ExtractedThought } from "@shared/schema";
import { fetchMarketSentiment } from "../sentinel/sentiment";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { INDICATOR_LIBRARY, CandleData, normalizeResult, IndicatorDefinition } from "./indicators";
import { evaluateDslIndicator, validateDslDefinition, DslLogicDefinition } from "./dsl-evaluator";
import { evaluateScanQuality } from "./quality";
import { getUniverseTickers } from "./universes";
import OpenAI from "openai";
import * as alpaca from "../alpaca";
import * as fundamentals from "../fundamentals";
import { getDailyBars, getIntradayBars } from "../data-layer";
import { shouldAutoOptimize, autoOptimizeThoughtOrder, recordThoughtPerformance, OptimizationContext } from "./queryOptimizer";
import { extractIdeasFromText, suggestIndicatorMappings } from "./extraction";

function getOpenAI(): OpenAI | null {
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  if (!apiKey) return null;
  return new OpenAI({ apiKey, baseURL });
}

const ohlcvCache = new Map<string, { data: CandleData[]; timestamp: number }>();
const CACHE_TTL = 60 * 60 * 1000;
const INTRADAY_CACHE_TTL = 5 * 60 * 1000;

const INTRADAY_INDICATORS = ["ITD-1", "ITD-2", "ITD-3"];

/**
 * Check if criteria contain intraday-only indicators and validate/correct timeframe
 */
function validateIntradayIndicators(
  criteria: any[],
  timeframe: string
): { correctedTimeframe: string; warning: string | null } {
  if (!Array.isArray(criteria)) {
    return { correctedTimeframe: timeframe, warning: null };
  }
  
  const hasIntradayIndicator = criteria.some(
    (c: any) => c.indicatorId && INTRADAY_INDICATORS.includes(c.indicatorId)
  );
  
  const isIntradayTimeframe = ["5min", "15min", "30min"].includes(timeframe);
  
  if (hasIntradayIndicator && !isIntradayTimeframe) {
    const intradayIndicatorNames = criteria
      .filter((c: any) => INTRADAY_INDICATORS.includes(c.indicatorId))
      .map((c: any) => c.label || c.indicatorId)
      .join(", ");
    
    return {
      correctedTimeframe: "5min",
      warning: `Intraday indicators (${intradayIndicatorNames}) detected with daily timeframe. Auto-corrected to 5min. These indicators require intraday data (5min/15min/30min) to produce meaningful results.`
    };
  }
  
  return { correctedTimeframe: timeframe, warning: null };
}

/**
 * Validate AI's indicator selection against user's actual intent
 * Catches obvious mismatches before returning to user
 */
function validateAISelection(
  userPrompt: string,
  thoughts: any[]
): { valid: boolean; errors: string[]; triggerCustomIndicator: boolean } {
  const errors: string[] = [];
  const promptLower = userPrompt.toLowerCase();
  
  // Keywords indicating user wants both directions
  const wantsBothDirections = /\b(any direction|either direction|both ways|above or below|below or above|crosses? (either|any)|any cross)\b/i.test(promptLower);
  
  // Keywords indicating user wants intraday
  const wantsIntraday = /\b(intraday|today|session|this session|5[ -]?min|15[ -]?min|30[ -]?min)\b/i.test(promptLower);
  
  // Keywords indicating user wants simple price change measurement
  const wantsPriceChange = /\b(price (up|down|increased?|decreased?|gained?|lost|change[ds]?)|stock (up|down)|gained? \d+%|\d+% (gain|increase|rise|advance))\b/i.test(promptLower);
  
  // Indicator IDs that only support one direction
  const DIRECTIONAL_INDICATORS: Record<string, string[]> = {
    "MA-1": ["direction"],
    "MA-2": ["direction"], 
    "MA-9": ["crossType"],
    "RS-5": ["condition"],
  };
  
  // Indicators that should NOT be used for price change requests
  const NOT_FOR_PRICE_CHANGE = ["PA-3", "PA-4", "PA-5", "PA-6", "PA-7", "PA-8"];
  
  for (const thought of thoughts) {
    const timeframe = thought.timeframe || "daily";
    const criteria = thought.criteria || [];
    
    for (const criterion of criteria) {
      const indId = criterion.indicatorId;
      const params = criterion.params || [];
      
      // Check 1: Direction mismatch
      if (wantsBothDirections && DIRECTIONAL_INDICATORS[indId]) {
        const dirParam = DIRECTIONAL_INDICATORS[indId];
        for (const paramName of dirParam) {
          const param = params.find((p: any) => p.name === paramName);
          if (param && param.value && !["any", "both"].includes(String(param.value).toLowerCase())) {
            errors.push(`User wanted "any direction" but ${indId} is set to "${param.value}" only. The indicator should support both directions or use a different indicator.`);
          }
        }
      }
      
      // Check 2: Intraday indicator on daily timeframe
      if (INTRADAY_INDICATORS.includes(indId) && timeframe === "daily") {
        errors.push(`${indId} is an intraday indicator but timeframe is "daily". Intraday indicators (VWAP, ORB) need intraday timeframes (5min/15min/30min).`);
      }
      
      // Check 3: User wants intraday but timeframe is daily
      if (wantsIntraday && timeframe === "daily" && INTRADAY_INDICATORS.includes(indId)) {
        errors.push(`User mentioned intraday context but timeframe is "daily". Should be 5min/15min/30min.`);
      }
      
      // Check 4: Using wrong indicator for price change
      if (wantsPriceChange && NOT_FOR_PRICE_CHANGE.includes(indId)) {
        errors.push(`User wants to measure price change but ${indId} is for consolidation/base detection, not price change measurement. No existing indicator measures simple "price up X% over N days" - needs custom indicator.`);
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    triggerCustomIndicator: errors.length > 0
  };
}

/**
 * Get merged indicator library (core + user's custom indicators)
 */
async function getMergedIndicatorLibrary(userId: number): Promise<IndicatorDefinition[]> {
  if (!isDatabaseAvailable()) {
    return INDICATOR_LIBRARY;
  }

  try {
    const customIndicators = await db
      .select()
      .from(userIndicators)
      .where(eq(userIndicators.userId, userId));

    const customIndicatorDefs: IndicatorDefinition[] = customIndicators.map(ind => ({
      id: ind.customId,
      name: `${ind.name} (Custom)`,
      category: ind.category as any,
      description: ind.description,
      params: ind.params as any[] || [],
      provides: (ind as any).provides || [],
      consumes: (ind as any).consumes || [],
      evaluate: (candles: CandleData[], params: Record<string, any>, _benchmarkCandles?: CandleData[], upstreamData?: Record<string, any>) => {
        return evaluateDslIndicator(ind.logicDefinition as any, candles, params, upstreamData);
      },
    }));

    return [...INDICATOR_LIBRARY, ...customIndicatorDefs];
  } catch (error) {
    console.error('[getMergedIndicatorLibrary] Error loading custom indicators:', error);
    return INDICATOR_LIBRARY;
  }
}

const ARCHETYPE_KEYWORDS: [RegExp, string][] = [
  [/vcp|volatility\s*contraction/i, "vcp"],
  [/flat\s*(base|consolidat)/i, "flat-base"],
  [/cup\s*(and|&)\s*handle/i, "cup-handle"],
  [/high\s*tight\s*flag/i, "high-tight-flag"],
  [/breakout/i, "breakout"],
  [/coil/i, "coiling-base"],
  [/volume\s*dry/i, "volume-dryup"],
  [/volume\s*surg|volume\s*spike/i, "volume-surge"],
  [/tight\s*(price|range)/i, "tight-action"],
  [/relative\s*strength|rs\s*lead/i, "rs-leader"],
  [/sma\s*above|above\s*sma|moving\s*average|trend/i, "trend-filter"],
  [/earnings|eps|revenue/i, "fundamental-filter"],
  [/gap\s*up|opening\s*gap/i, "gap-up"],
  [/pullback|retrace/i, "pullback"],
  [/momentum|rate\s*of\s*change|roc/i, "momentum"],
  [/adr|average\s*daily\s*range/i, "adr-filter"],
  [/range\s*contract|narrow/i, "range-contraction"],
  [/price\s*above|above.*price/i, "price-filter"],
];

function extractArchetypeTags(thoughtNames: string[]): string[] {
  const tags = new Set<string>();
  for (const name of thoughtNames) {
    for (const [pattern, tag] of ARCHETYPE_KEYWORDS) {
      if (pattern.test(name)) tags.add(tag);
    }
  }
  return Array.from(tags).sort();
}

function buildMarketRegimeSnapshot(sentiment: any): any {
  return {
    weeklyTrend: sentiment.weekly?.stateName || "Neutral",
    dailyBasket: sentiment.daily?.state || "MIXED",
    choppiness: sentiment.choppiness?.daily?.state || "MIXED",
    spyPrice: sentiment.weekly?.price || 0,
  };
}


function getIntervalConfig(timeframe: string): { interval: string; lookbackDays: number; cacheTTL: number } {
  switch (timeframe) {
    case "5min":
      return { interval: "5m", lookbackDays: 60, cacheTTL: INTRADAY_CACHE_TTL };
    case "15min":
      return { interval: "15m", lookbackDays: 60, cacheTTL: INTRADAY_CACHE_TTL };
    case "30min":
      return { interval: "30m", lookbackDays: 60, cacheTTL: INTRADAY_CACHE_TTL };
    default:
      return { interval: "1d", lookbackDays: 365, cacheTTL: CACHE_TTL };
  }
}

async function fetchOHLCV(symbol: string, timeframe: string = "daily"): Promise<CandleData[]> {
  const cacheKey = `${symbol}:${timeframe}`;
  const cached = ohlcvCache.get(cacheKey);
  const { interval, lookbackDays, cacheTTL } = getIntervalConfig(timeframe);

  if (cached && Date.now() - cached.timestamp < cacheTTL) {
    return cached.data;
  }

  try {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - lookbackDays);

    let candles: CandleData[] = [];

    if (timeframe === "daily") {
      const dataLayerBars = await getDailyBars(symbol, lookbackDays);
      
      if (dataLayerBars && dataLayerBars.length >= 50) {
        candles = dataLayerBars.map((b) => ({
          date: b.date,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
          volume: b.volume || 0,
        }));
      } else {
        const bars = await alpaca.getAlpacaIntradayData(symbol, startDate, endDate, interval, true);
        candles = bars
          .map((b) => ({
            date: b.date,
            open: b.open,
            high: b.high,
            low: b.low,
            close: b.close,
            volume: b.volume || 0,
          }))
          .reverse();
      }
    } else {
      const intradayBars = await getIntradayBars(symbol, interval, startDate, endDate, true);
      candles = intradayBars
        .map((b) => ({
          date: b.timestamp,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
          volume: b.volume || 0,
        }))
        .reverse();
    }

    ohlcvCache.set(cacheKey, { data: candles, timestamp: Date.now() });
    return candles;
  } catch (err) {
    console.error(`Failed to fetch OHLCV for ${symbol} (${timeframe}):`, err);
    return [];
  }
}

function repairCriterion(criterion: any): { indicatorId: string; params: Record<string, any> } {
  const paramValues: Record<string, any> = {};
  const rawParams = criterion.params || [];
  for (const p of rawParams) {
    paramValues[p.name] = p.value;
  }

  const indDef = INDICATOR_LIBRARY.find((i) => i.id === criterion.indicatorId);
  if (indDef) {
    const canonicalNames = new Set(indDef.params.map((mp) => mp.name));
    const hasStale = rawParams.some((p: any) => !canonicalNames.has(p.name));
    if (hasStale) {
      for (let idx = 0; idx < rawParams.length; idx++) {
        const p = rawParams[idx];
        if (!canonicalNames.has(p.name) && idx < indDef.params.length) {
          delete paramValues[p.name];
          paramValues[indDef.params[idx].name] = p.value;
        }
      }
    }
  }

  if (criterion.indicatorId === "MA-6" && (paramValues.maxDistance === 0 || paramValues.maxDistance === undefined)) {
    return {
      indicatorId: "MA-8",
      params: {
        fastPeriod: paramValues.fastPeriod ?? 50,
        slowPeriod: paramValues.slowPeriod ?? 200,
        maType: paramValues.maType ?? "sma",
        direction: "fast_above_slow",
      },
    };
  }

  if (criterion.indicatorId === "PA-11" && paramValues.maxDistance === 0) {
    paramValues.maxDistance = 3;
  }

  for (const ind of INDICATOR_LIBRARY) {
    if (ind.id === criterion.indicatorId) {
      for (const paramDef of ind.params) {
        if (
          paramDef.type === "number" &&
          paramDef.name.toLowerCase().includes("max") &&
          paramValues[paramDef.name] === 0 &&
          paramDef.defaultValue !== 0
        ) {
          paramValues[paramDef.name] = paramDef.defaultValue;
        }
      }
      break;
    }
  }

  return { indicatorId: criterion.indicatorId, params: paramValues };
}

type CriterionResult = {
  indicatorId: string;
  indicatorName: string;
  pass: boolean;
  inverted: boolean;
  diagnostics?: { value: string; threshold: string; detail?: string };
  cocHighlight?: { type: string; level?: number; startBar?: number; endBar?: number; barIndex?: number; gapPct?: number; barCount?: number; topPrice?: number; lowPrice?: number };
  cocHighlight2?: { type: string; level?: number; startBar?: number; endBar?: number };
};

type ThoughtEvalResult = {
  pass: boolean;
  allMuted: boolean;
  outputData: Record<string, any>;
  criteriaResults: CriterionResult[];
};

function evaluateThoughtCriteria(
  criteria: any[],
  candles: CandleData[],
  benchmarkCandles?: CandleData[],
  candlesByTimeframe?: Record<string, CandleData[]>,
  upstreamData?: Record<string, any>,
  indicatorLibrary?: IndicatorDefinition[]
): ThoughtEvalResult {
  if (!criteria || criteria.length === 0) return { pass: false, allMuted: false, outputData: {}, criteriaResults: [] };

  const activeCriteria = criteria.filter((c: any) => !c.muted);
  if (activeCriteria.length === 0) return { pass: true, allMuted: true, outputData: {}, criteriaResults: [] };

  const library = indicatorLibrary || INDICATOR_LIBRARY;
  const outputData: Record<string, any> = {};
  const criteriaResults: CriterionResult[] = [];
  let allPass = true;

  const CONSUMER_IDS_EVAL = new Set(["PA-12", "PA-13", "PA-14", "PA-15", "PA-16"]);

  for (const criterion of activeCriteria) {
    const repaired = repairCriterion(criterion);
    const indicator = library.find((ind) => ind.id === repaired.indicatorId);
    if (!indicator) continue;

    if (CONSUMER_IDS_EVAL.has(repaired.indicatorId) && (!upstreamData || Object.keys(upstreamData).length === 0)) {
      criteriaResults.push({
        indicatorId: indicator.id,
        indicatorName: criterion.label || indicator.name,
        pass: true,
        inverted: !!criterion.inverted,
        diagnostics: { value: "skipped", threshold: "no upstream data", detail: "Consumer indicator skipped — no provider (PA-3/PA-7) connected upstream" },
      });
      continue;
    }

    const overrideTf = criterion.timeframeOverride;
    const useCandles = (overrideTf && candlesByTimeframe && candlesByTimeframe[overrideTf])
      ? candlesByTimeframe[overrideTf]
      : candles;

    const rawResult = indicator.evaluate(useCandles, repaired.params, benchmarkCandles, upstreamData);
    const normalized = normalizeResult(rawResult);

    const diagnostics = normalized.data?._diagnostics as { value: string; threshold: string; detail?: string } | undefined;
    const cocHighlight = normalized.data?._cocHighlight as CriterionResult["cocHighlight"] | undefined;
    const cocHighlight2 = normalized.data?._cocHighlight2 as CriterionResult["cocHighlight2"] | undefined;

    if (normalized.data) {
      const { _diagnostics, _cocHighlight, _cocHighlight2, ...rest } = normalized.data;
      Object.assign(outputData, rest);
    }

    let pass = normalized.pass;
    if (criterion.inverted) pass = !pass;

    criteriaResults.push({
      indicatorId: indicator.id,
      indicatorName: criterion.label || indicator.name,
      pass,
      inverted: !!criterion.inverted,
      diagnostics,
      ...(pass && cocHighlight ? { cocHighlight } : {}),
      ...(pass && cocHighlight2 ? { cocHighlight2 } : {}),
    });

    if (!pass) allPass = false;
  }

  return { pass: allPass, allMuted: false, outputData, criteriaResults };
}

async function upsertIndicatorLearningSummary(record: any) {
  if (!db) return;
  const accepted = (record.acceptedSuggestions || []) as any[];
  if (accepted.length === 0) return;

  const indicatorIds = new Set(accepted.map((s: any) => s.indicatorId));
  const retainedUp = (record.retainedUpSymbols || []).length;
  const droppedUp = (record.droppedUpSymbols || []).length;
  const retentionRate = retainedUp + droppedUp > 0 ? retainedUp / (retainedUp + droppedUp) : null;
  const resultDelta = record.resultCountAfter != null && record.resultCountBefore != null
    ? record.resultCountAfter - record.resultCountBefore : null;

  const regime = record.marketRegime as any;
  const regimeKey = regime ? `${regime.weeklyTrend}/${regime.dailyBasket}` : "Unknown";
  const universeKey = record.universe || "unknown";
  const archetypes = (record.archetypeTags || []) as string[];

  for (const indId of Array.from(indicatorIds)) {
    const indSuggestions = accepted.filter((s: any) => s.indicatorId === indId);
    const indName = indSuggestions[0]?.indicatorName || indId;

    const existing = await db.select().from(indicatorLearningSummary)
      .where(eq(indicatorLearningSummary.indicatorId, indId)).limit(1);

    if (existing.length === 0) {
      const paramStats: Record<string, any> = {};
      for (const s of indSuggestions) {
        const dir = Number(s.suggestedValue) < Number(s.currentValue) ? "tightened" : "loosened";
        paramStats[s.paramName] = {
          tightened: dir === "tightened" ? 1 : 0,
          loosened: dir === "loosened" ? 1 : 0,
          avgAccepted: Number(s.suggestedValue),
          lastAccepted: Number(s.suggestedValue),
          count: 1,
        };
      }

      const regimePerf: Record<string, any> = {};
      regimePerf[regimeKey] = { accepted: 1, retention: retentionRate, count: 1 };

      const universePerf: Record<string, any> = {};
      universePerf[universeKey] = { accepted: 1, avgRetention: retentionRate, count: 1 };

      const archetypePerf: Record<string, any> = {};
      for (const tag of archetypes) {
        archetypePerf[tag] = { accepted: 1, retention: retentionRate, count: 1 };
      }

      await db.insert(indicatorLearningSummary).values({
        indicatorId: indId,
        indicatorName: indName,
        totalAccepted: 1,
        totalDiscarded: 0,
        paramStats,
        avgRetentionRate: retentionRate,
        avgResultDelta: resultDelta,
        regimePerformance: regimePerf,
        universePerformance: universePerf,
        archetypePerformance: archetypePerf,
        avoidParams: null,
      });
    } else {
      const ex = existing[0];
      const ps = (ex.paramStats as Record<string, any>) || {};
      for (const s of indSuggestions) {
        const dir = Number(s.suggestedValue) < Number(s.currentValue) ? "tightened" : "loosened";
        if (!ps[s.paramName]) {
          ps[s.paramName] = { tightened: 0, loosened: 0, avgAccepted: 0, lastAccepted: 0, count: 0 };
        }
        const p = ps[s.paramName];
        if (dir === "tightened") p.tightened++;
        else p.loosened++;
        p.lastAccepted = Number(s.suggestedValue);
        p.avgAccepted = ((p.avgAccepted * p.count) + Number(s.suggestedValue)) / (p.count + 1);
        p.count++;
      }

      const newTotal = (ex.totalAccepted || 0) + 1;
      const newRetention = retentionRate != null
        ? (((ex.avgRetentionRate || 0) * (ex.totalAccepted || 0)) + retentionRate) / newTotal
        : ex.avgRetentionRate;
      const newResultDelta = resultDelta != null
        ? (((ex.avgResultDelta || 0) * (ex.totalAccepted || 0)) + resultDelta) / newTotal
        : ex.avgResultDelta;

      const rp = (ex.regimePerformance as Record<string, any>) || {};
      if (!rp[regimeKey]) rp[regimeKey] = { accepted: 0, retention: null, count: 0 };
      rp[regimeKey].accepted++;
      rp[regimeKey].count++;
      if (retentionRate != null) {
        rp[regimeKey].retention = rp[regimeKey].retention != null
          ? ((rp[regimeKey].retention * (rp[regimeKey].count - 1)) + retentionRate) / rp[regimeKey].count
          : retentionRate;
      }

      const up = (ex.universePerformance as Record<string, any>) || {};
      if (!up[universeKey]) up[universeKey] = { accepted: 0, avgRetention: null, count: 0 };
      up[universeKey].accepted++;
      up[universeKey].count++;
      if (retentionRate != null) {
        up[universeKey].avgRetention = up[universeKey].avgRetention != null
          ? ((up[universeKey].avgRetention * (up[universeKey].count - 1)) + retentionRate) / up[universeKey].count
          : retentionRate;
      }

      const ap = (ex.archetypePerformance as Record<string, any>) || {};
      for (const tag of archetypes) {
        if (!ap[tag]) ap[tag] = { accepted: 0, retention: null, count: 0 };
        ap[tag].accepted++;
        ap[tag].count++;
        if (retentionRate != null) {
          ap[tag].retention = ap[tag].retention != null
            ? ((ap[tag].retention * (ap[tag].count - 1)) + retentionRate) / ap[tag].count
            : retentionRate;
        }
      }

      await db.update(indicatorLearningSummary).set({
        indicatorName: indName,
        totalAccepted: newTotal,
        paramStats: ps,
        avgRetentionRate: newRetention,
        avgResultDelta: newResultDelta,
        regimePerformance: rp,
        universePerformance: up,
        archetypePerformance: ap,
        updatedAt: new Date(),
      }).where(eq(indicatorLearningSummary.indicatorId, indId));
    }
  }
}

export function registerBigIdeaRoutes(app: Express): void {
  app.get("/api/bigidea/thoughts", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      if (!isDatabaseAvailable() || !db) {
        return res.status(500).json({ error: "Database not available" });
      }

      const thoughts = await db
        .select()
        .from(scannerThoughts)
        .where(eq(scannerThoughts.userId, userId))
        .orderBy(sql`${scannerThoughts.score} DESC NULLS LAST`);

      res.json(thoughts);
    } catch (error) {
      console.error("Error fetching thoughts:", error);
      res.status(500).json({ error: "Failed to fetch thoughts" });
    }
  });

  app.post("/api/bigidea/thoughts", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      if (!isDatabaseAvailable() || !db) {
        return res.status(500).json({ error: "Database not available" });
      }

      const { name, category, description, criteria, timeframe, aiPrompt } = req.body;
      if (!name || !category || !criteria) {
        return res.status(400).json({ error: "name, category, and criteria are required" });
      }

      // Validate and auto-correct timeframe for intraday indicators
      const { correctedTimeframe, warning } = validateIntradayIndicators(
        criteria,
        timeframe || "daily"
      );

      const [thought] = await db
        .insert(scannerThoughts)
        .values({ userId, name, category, description: description || null, aiPrompt: aiPrompt || null, criteria, timeframe: correctedTimeframe })
        .returning();

      res.status(201).json({ ...thought, timeframeWarning: warning });
    } catch (error) {
      console.error("Error creating thought:", error);
      res.status(500).json({ error: "Failed to create thought" });
    }
  });

  app.patch("/api/bigidea/thoughts/:id", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      if (!isDatabaseAvailable() || !db) {
        return res.status(500).json({ error: "Database not available" });
      }

      const id = parseInt(String(req.params.id));
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

      const existing = await db
        .select()
        .from(scannerThoughts)
        .where(and(eq(scannerThoughts.id, id), eq(scannerThoughts.userId, userId)));

      if (existing.length === 0) {
        return res.status(404).json({ error: "Thought not found" });
      }

      const updates: any = { updatedAt: new Date() };
      if (req.body.name !== undefined) updates.name = req.body.name;
      if (req.body.category !== undefined) updates.category = req.body.category;
      if (req.body.description !== undefined) updates.description = req.body.description;
      if (req.body.criteria !== undefined) updates.criteria = req.body.criteria;
      if (req.body.timeframe !== undefined) updates.timeframe = req.body.timeframe;
      if (req.body.aiPrompt !== undefined) updates.aiPrompt = req.body.aiPrompt;

      // Validate and auto-correct timeframe for intraday indicators
      const criteriaToCheck = updates.criteria || existing[0].criteria;
      const timeframeToCheck = updates.timeframe || existing[0].timeframe || "daily";
      const { correctedTimeframe, warning } = validateIntradayIndicators(
        criteriaToCheck as any[],
        timeframeToCheck
      );
      if (correctedTimeframe !== timeframeToCheck) {
        updates.timeframe = correctedTimeframe;
      }

      const [updated] = await db
        .update(scannerThoughts)
        .set(updates)
        .where(and(eq(scannerThoughts.id, id), eq(scannerThoughts.userId, userId)))
        .returning();

      res.json({ ...updated, timeframeWarning: warning });
    } catch (error) {
      console.error("Error updating thought:", error);
      res.status(500).json({ error: "Failed to update thought" });
    }
  });

  app.delete("/api/bigidea/thoughts/:id", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      if (!isDatabaseAvailable() || !db) {
        return res.status(500).json({ error: "Database not available" });
      }

      const id = parseInt(String(req.params.id));
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

      const deleted = await db
        .delete(scannerThoughts)
        .where(and(eq(scannerThoughts.id, id), eq(scannerThoughts.userId, userId)))
        .returning();

      res.json({ success: true, alreadyDeleted: deleted.length === 0 });
    } catch (error) {
      console.error("Error deleting thought:", error);
      res.status(500).json({ error: "Failed to delete thought" });
    }
  });

  app.get("/api/bigidea/ideas", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      if (!isDatabaseAvailable() || !db) {
        return res.status(500).json({ error: "Database not available" });
      }

      const ideas = await db
        .select()
        .from(scannerIdeas)
        .where(eq(scannerIdeas.userId, userId));

      res.json(ideas);
    } catch (error) {
      console.error("Error fetching ideas:", error);
      res.status(500).json({ error: "Failed to fetch ideas" });
    }
  });

  app.get("/api/bigidea/ideas/:id", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      if (!isDatabaseAvailable() || !db) {
        return res.status(500).json({ error: "Database not available" });
      }

      const id = parseInt(String(req.params.id));
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

      const [idea] = await db
        .select()
        .from(scannerIdeas)
        .where(and(eq(scannerIdeas.id, id), eq(scannerIdeas.userId, userId)));

      if (!idea) {
        return res.status(404).json({ error: "Idea not found" });
      }

      res.json(idea);
    } catch (error) {
      console.error("Error fetching idea:", error);
      res.status(500).json({ error: "Failed to fetch idea" });
    }
  });

  app.post("/api/bigidea/ideas", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      if (!isDatabaseAvailable() || !db) {
        return res.status(500).json({ error: "Database not available" });
      }

      const { name, description, universe, nodes, edges } = req.body;
      if (!name || !nodes || !edges) {
        return res.status(400).json({ error: "name, nodes, and edges are required" });
      }

      const [idea] = await db
        .insert(scannerIdeas)
        .values({
          userId,
          name,
          description: description || null,
          universe: universe || "sp500",
          nodes,
          edges,
        })
        .returning();

      try {
        const thoughtIds = (nodes as any[]).filter((n: any) => n.type === "thought" && n.thoughtId).map((n: any) => n.thoughtId as number);
        if (thoughtIds.length > 0) {
          await touchThoughtsLastUsed(thoughtIds);
          const rules = await getScoreRulesMap();
          const modifiedRule = rules["idea_save_modified"];
          if (modifiedRule?.enabled && modifiedRule.scoreValue !== 0) {
            const modifiedIds = await detectModifiedThoughts(nodes as any[]);
            if (modifiedIds.length > 0) {
              await applyScoreToThoughts(modifiedIds, modifiedRule.scoreValue);
            }
          }
        }
      } catch (scoreErr) {
        console.error("Error scoring thoughts on idea create:", scoreErr);
      }

      res.status(201).json(idea);
    } catch (error) {
      console.error("Error creating idea:", error);
      res.status(500).json({ error: "Failed to create idea" });
    }
  });

  app.patch("/api/bigidea/ideas/:id", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      if (!isDatabaseAvailable() || !db) {
        return res.status(500).json({ error: "Database not available" });
      }

      const id = parseInt(String(req.params.id));
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

      const existing = await db
        .select()
        .from(scannerIdeas)
        .where(and(eq(scannerIdeas.id, id), eq(scannerIdeas.userId, userId)));

      if (existing.length === 0) {
        return res.status(404).json({ error: "Idea not found" });
      }

      const updates: any = { updatedAt: new Date() };
      if (req.body.name !== undefined) updates.name = req.body.name;
      if (req.body.description !== undefined) updates.description = req.body.description;
      if (req.body.universe !== undefined) updates.universe = req.body.universe;
      if (req.body.nodes !== undefined) updates.nodes = req.body.nodes;
      if (req.body.edges !== undefined) updates.edges = req.body.edges;

      const [updated] = await db
        .update(scannerIdeas)
        .set(updates)
        .where(and(eq(scannerIdeas.id, id), eq(scannerIdeas.userId, userId)))
        .returning();

      // Score thoughts on idea update
      try {
        const newNodes = (req.body.nodes || updated.nodes) as any[];
        const thoughtIds = newNodes.filter((n: any) => n.type === "thought" && n.thoughtId).map((n: any) => n.thoughtId as number);
        if (thoughtIds.length > 0) {
          await touchThoughtsLastUsed(thoughtIds);
          const rules = await getScoreRulesMap();
          const modifiedRule = rules["idea_save_modified"];
          if (modifiedRule?.enabled && modifiedRule.scoreValue !== 0) {
            const modifiedIds = await detectModifiedThoughts(newNodes as any[]);
            if (modifiedIds.length > 0) {
              await applyScoreToThoughts(modifiedIds, modifiedRule.scoreValue);
            }
          }
        }
      } catch (scoreErr) {
        console.error("Error scoring thoughts on idea update:", scoreErr);
      }

      res.json(updated);
    } catch (error) {
      console.error("Error updating idea:", error);
      res.status(500).json({ error: "Failed to update idea" });
    }
  });

  app.delete("/api/bigidea/ideas/:id", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      if (!isDatabaseAvailable() || !db) {
        return res.status(500).json({ error: "Database not available" });
      }

      const id = parseInt(String(req.params.id));
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

      const deleted = await db
        .delete(scannerIdeas)
        .where(and(eq(scannerIdeas.id, id), eq(scannerIdeas.userId, userId)))
        .returning();

      if (deleted.length === 0) {
        return res.status(404).json({ error: "Idea not found" });
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting idea:", error);
      res.status(500).json({ error: "Failed to delete idea" });
    }
  });

  app.post("/api/bigidea/quality", (req: Request, res: Response) => {
    try {
      const { nodes, edges } = req.body;
      if (!nodes || !Array.isArray(nodes)) {
        return res.status(400).json({ error: "nodes array is required" });
      }
      const result = evaluateScanQuality(nodes, edges || []);
      res.json(result);
    } catch (error) {
      console.error("Error evaluating scan quality:", error);
      res.status(500).json({ error: "Failed to evaluate scan quality" });
    }
  });

  app.get("/api/bigidea/indicators", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId || 1;
      const mergedLibrary = await getMergedIndicatorLibrary(userId);

      const indicators = mergedLibrary.map((ind) => ({
        id: ind.id,
        name: ind.name,
        category: ind.category,
        description: ind.description,
        params: ind.params,
        provides: ind.provides || [],
        consumes: ind.consumes || [],
      }));
      res.json(indicators);
    } catch (error) {
      console.error("Error fetching indicators:", error);
      res.status(500).json({ error: "Failed to fetch indicators" });
    }
  });

  app.post("/api/bigidea/ai/create-thought", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) {
        console.error("[BigIdea AI] Auth failed - no userId in session. Session ID:", req.sessionID, "Session keys:", Object.keys(req.session || {}));
        return res.status(401).json({ error: "Not logged in. Please refresh the page and try again." });
      }

      const { description } = req.body;
      if (!description) {
        return res.status(400).json({ error: "description is required" });
      }

      const mergedLibrary = await getMergedIndicatorLibrary(userId);
      const indicatorSummary = mergedLibrary.map((ind) => ({
        id: ind.id,
        name: ind.name,
        category: ind.category,
        description: ind.description,
        provides: ind.provides,
        consumes: ind.consumes,
        params: ind.params.map((p) => ({
          name: p.name,
          label: p.label,
          type: p.type,
          defaultValue: p.defaultValue,
          options: p.options,
          min: p.min,
          max: p.max,
          step: p.step,
        })),
      }));

      const systemPrompt = `You are a stock screening assistant. The user will describe a trading idea or screening concept in plain English. Your job is to translate it into one or more structured "Thought" definitions using the available indicator library.

Available indicators:
${JSON.stringify(indicatorSummary, null, 2)}

CRITICAL: DATA-LINKING AND MULTI-THOUGHT SPLITTING — HARD RULES
Some indicators "provide" dynamic data (e.g. PA-3 outputs detectedPeriod — the detected base length) and others "consume" that data (e.g. PA-12, PA-13, PA-14, PA-15, PA-16 consume detectedPeriod). Data can ONLY flow between SEPARATE thoughts connected by an edge — it does NOT work within the same thought.

PROVIDER indicators: PA-3, PA-7
CONSUMER indicators: PA-12, PA-13, PA-14, PA-15, PA-16

HARD RULE 1: A consumer indicator must NEVER be in the same thought as its provider. If the user's idea includes ANY provider AND ANY consumer from the lists above, you MUST split them:
- Thought A (upstream): Contains the PROVIDER indicator (PA-3 or PA-7) and any non-linked indicators (MA-*, VOL-* etc.)
- Thought B (downstream): Contains ALL consumer indicators (PA-12, PA-13, PA-14, PA-15, PA-16) — every single one goes here, no exceptions
- Edge: A → B

This is mandatory even if there is only ONE consumer. For example, if the idea uses PA-3 + PA-16, that is TWO thoughts with an edge, never one thought.

HARD RULE 2: A consumer indicator must ALWAYS have a provider indicator (PA-3 or PA-7) in its DIRECT upstream thought. If you use PA-12, PA-13, PA-14, PA-15, or PA-16, there MUST be an edge from a thought containing PA-3 or PA-7 directly to the thought containing the consumer. NEVER place consumer indicators in a thought that only has non-provider thoughts upstream (like MA or RS thoughts). If the user's idea doesn't mention a base/consolidation/breakout, do NOT use consumer indicators — use the simpler alternatives instead:
- Instead of PA-14 (Tightness Ratio — requires PA-3 upstream): Use VLT-2 (ATR Contraction) or VLT-1 (Bollinger Band Width)
- Instead of PA-16 (Volume Fade — requires PA-3 upstream): Use VOL-4 (Volume Dry-Up) — this works standalone without data-linking
- Instead of PA-12 (Prior Advance — requires PA-3 upstream): Use MA-4 (MA Slope) to check trend strength
- Instead of PA-15 (Close Clustering — requires PA-3 upstream): Use VLT-4 (Squeeze Detection)
ALWAYS prefer standalone indicators (VOL-4, VLT-2, VLT-1, etc.) over consumer indicators unless the user explicitly asks for base-linked analysis. Consumer indicators add complexity and can fail silently if wired incorrectly.

The data-linking relationships:
- PA-3 (Consolidation / Base Detection) PROVIDES detectedPeriod
- PA-7 (Breakout Detection) PROVIDES detectedPeriod
- CB-1 (Find Base) PROVIDES baseStartBar, baseEndBar, baseTopPrice, baseLowPrice — scans backward/forward through price history to locate consolidation bases; supports chaining (consume baseStartBar from an upstream CB-1 to find a second base after a move)
- PA-12 (Prior Price Advance) CONSUMES detectedPeriod → skipBars OR baseStartBar (from CB-1)
- PA-13 (Smooth Trending Advance) CONSUMES detectedPeriod → skipBars OR baseStartBar (from CB-1)
- PA-14 (Tightness Ratio) CONSUMES detectedPeriod → baselineBars
- PA-15 (Close Clustering) CONSUMES detectedPeriod → period
- PA-16 (Volume Fade) CONSUMES detectedPeriod → baselineBars

You must respond with valid JSON. When the idea needs multiple thoughts, use this format:
{
  "thoughts": [
    {
      "thoughtKey": "A",
      "name": "Short descriptive name",
      "category": "One of: Momentum, Value, Trend, Volatility, Volume, Consolidation, Custom",
      "description": "What this thought screens for",
      "criteria": [...]
    },
    {
      "thoughtKey": "B",
      "name": "Short descriptive name",
      "category": "...",
      "description": "...",
      "criteria": [...]
    }
  ],
  "edges": [
    { "from": "A", "to": "B" }
  ]
}

When only a single thought is needed (no data-linking), use this simpler format:
{
  "thoughts": [
    {
      "thoughtKey": "A",
      "name": "Short descriptive name",
      "category": "...",
      "description": "...",
      "criteria": [...]
    }
  ],
  "edges": []
}

Each criterion in a thought follows this structure:
{
  "indicatorId": "The indicator ID from the library",
  "label": "Human readable label for this criterion",
  "inverted": false,
  "timeframeOverride": "daily or omit",
  "params": [
    {
      "name": "param name matching the indicator",
      "label": "param label",
      "type": "number|select|boolean",
      "value": "the value to use",
      "min": "copy min from indicator definition (for number params)",
      "max": "copy max from indicator definition (for number params)",
      "step": "copy step from indicator definition (for number params)"
    }
  ]
}

IMPORTANT: For every number param, you MUST copy the min, max, and step values from the indicator definition. This ensures the UI slider allows the correct range and precision (e.g. step 0.05 for ratio params instead of integer-only).

TIMEFRAME OVERRIDE RULE:
Each criterion can optionally specify a "timeframeOverride" field. When set to "daily", this criterion will evaluate against daily candles even when the thought itself runs on an intraday timeframe (5min, 15min, 30min). This is critical for criteria that reference daily-level indicators like the 50-day SMA, 200-day SMA, daily RSI, etc. If the user mentions "daily" bars, "daily SMA", "D1", "50-day", "200-day", or similar daily-level references, set timeframeOverride to "daily". Omit the field entirely when the criterion should use the thought's own timeframe.

CRITICAL RULE FOR NAMES AND DESCRIPTIONS:
Both the thought "name" and "description" fields MUST accurately describe what the chosen indicators and parameters actually measure — NOT what the user asked for. If the user asks for "stocks that pulled back to the 50 SMA and held" but the best available indicator only checks proximity to the SMA (not a pullback/bounce/hold pattern), the name must say "Price near 50 SMA" (not "Pullback to 50 SMA") and the description must say "Screens for stocks whose price is currently within X% of the 50 SMA" rather than claiming it detects a pullback or hold. Never oversell or exaggerate what the criteria can detect in names or descriptions. Be precise and honest about what the screening actually does.

Examples of BAD vs GOOD names:
- BAD: "Pullback to 10 EMA" (MA-3 doesn't detect pullbacks, just proximity)
  GOOD: "Price near 10 EMA"
- BAD: "Bounce off 21 SMA" (MA-3 doesn't detect bounces)
  GOOD: "Price near 21 SMA"
- BAD: "Held at support" (no indicator detects "holding")
  GOOD: "Price near support level"

IMPORTANT GUIDELINES for indicator selection:
- For "price crossed above/below a moving average" (e.g. "price crossed above the 50 SMA", "price broke below the 20 EMA"), ALWAYS use MA-9 (Price Crosses MA). Set crossType to "above" or "below". Do NOT use MA-7 for this — MA-7 is only for two MAs crossing each other.
- To compare two moving averages (e.g. "50 SMA above 200 SMA", "EMA cross", "golden cross"), use MA-8 (MA Comparison) with the direction parameter. Do NOT use MA-6 for this purpose.
- MA-7 (MA Crossover) is ONLY for detecting when two MAs cross each other (golden cross / death cross). It does NOT detect price crossing a single MA.
- MA-6 (MA Distance/Convergence) is ONLY for measuring how close two MAs are to each other in percentage terms. It does NOT check which one is above the other.
- MA-1/MA-2 compare PRICE vs a single MA, not two MAs against each other.
- When the user says "MA above/below another MA", always use MA-8 with direction "fast_above_slow" or "fast_below_slow".
- For golden cross detection, use MA-8 with fastPeriod=50, slowPeriod=200, direction=fast_above_slow.
- PATTERN PRIORITY: When the user mentions BOTH a trader's name AND a specific pattern name, ALWAYS prioritize the specific pattern name. The pattern name tells you exactly what they want.

- TRADER NAME → PATTERNS MAPPING: When a user mentions a trader's name WITHOUT a specific pattern, create multiple OR thoughts covering that trader's signature patterns. Use permissive parameters for each.

  OLIVER KELL patterns:
    - "EMA Crossback": MA-9 (crossType="above", maPeriod=21, maType="ema", lookbackBars=5)
    - "Wedge Pop": PA-17 (minGapPct=1, minWedgeBars=5)
  
  QULLAMAGGIE / KRISTJAN KULLAMÄGI patterns:
    - "Episodic Pivot": Use gap detection + volume surge (VOL-5 minMultiple=1.5) + price near highs (PA-6 maxDistance=10)
    - "ORB Breakout": Flag as ORB pattern, note intraday timeframe needed
    - "Tight Range Breakout": PA-3 (base detection, maxRange=10) + PA-14 (tightness)
  
  MARK MINERVINI patterns:
    - "VCP": PA-3 (base) + PA-14 (tightness ratio, showing contractions)
    - "Trend Template": MA-1 (above 50 & 200 SMA) + MA-8 (50 above 200) + MA-4 (rising 200 SMA) + PA-6 (within 25% of highs)
  
  WILLIAM O'NEIL / IBD / CAN SLIM patterns:
    - "Cup and Handle": PA-1 (cup and handle detection)
    - "Flat Base": PA-3 (maxRange=15, minPeriod=20)
    - "Pocket Pivot": Volume surge (VOL-5) + price reclaiming prior pivot
  
  DAN ZANGER patterns:
    - "Bull Flag": PA-2 (flag detection) + strong prior move
    - "Channel Breakout": Breakout from ascending channel

  When creating for a trader name alone, structure thoughts as OR (any pattern matches). In description note: "Combines [Trader]'s signature patterns: [list them]."

- EMA CROSSBACK / MA RECLAIM: When user mentions "EMA crossback", "crossback", "cross back", "reclaim the EMA", "reclaim the 10/20/21", use MA-9 (Price Crosses MA) with crossType="above" and the appropriate MA period (typically 10, 20, or 21 EMA). This detects price crossing back above the EMA after a pullback. The core EMA Crossback pattern does NOT require a gap — it's simply price closing back above the EMA.
- PA-17 (Wedge Pop Detection) is a comprehensive multi-phase pattern detector. Use it when the user SPECIFICALLY mentions: "wedge pop", "money pattern", "gap through EMAs", "volatility contraction then breakout through EMAs", or "gap up through declining MAs". PA-17 handles the entire setup (wedge formation, range contraction, volume dry-up) AND trigger (EMA reclaim on volume surge) in a SINGLE criterion — do NOT decompose a wedge pop into multiple separate criteria. PA-17 returns rich diagnostic data (pop type, gap %, volume ratio, wedge duration, range contraction, position vs 200 DMA). It is a standalone indicator with no data-linking requirements. NOTE: Do NOT automatically use PA-17 just because someone mentions "Oliver Kell" — he teaches multiple patterns. Only use PA-17 if the user explicitly mentions wedge pop or gap-related terminology.

CRITICAL RULE FOR CRITERIA COUNT:
Generate exactly as many criteria as the user's idea requires — no more, no less. If the user asks for something specific and narrow like "price within 1% of the 50 SMA", that is ONE criterion. Do NOT pad with extra filters the user didn't ask for. If the user describes something compound like "breakout with volume above rising 50 SMA", that naturally decomposes into multiple criteria. Only use indicatorId values from the indicator library provided above — never invent indicator IDs.

MULTI-THOUGHT SPLITTING EXAMPLES:
- "Flat base with shrinking ranges and volume dry-up" → 2 thoughts:
  Thought A: PA-3 (Base Detection) — the provider ONLY
  Thought B: PA-14 (Tightness Ratio) + PA-16 (Volume Fade) — ALL consumers go here
  Edge: A → B
- "Tight base above 50 SMA with volume dry-up and a strong prior advance" → 2 thoughts:
  Thought A: PA-3 (Base Detection) + MA-1 (above 50 SMA) — provider + independent indicator
  Thought B: PA-16 (Volume Fade) + PA-13 (Smooth Advance) — ALL consumers go here, NEVER with the provider
  Edge: A → B
- "Base with a strong prior advance" → 2 thoughts:
  Thought A: PA-3 (Base Detection) — provider
  Thought B: PA-12 (Prior Advance) — consumer, even though it's just one consumer it MUST be separate
  Edge: A → B

SINGLE-THOUGHT EXAMPLES (no data links needed):
- "Price within 1% of 50 SMA" → 1 thought, 1 criterion: MA-3
- "Strong uptrend" → 1 thought, 3 criteria: MA-1 + MA-8 + MA-4
- "Breakout with volume" → 1 thought, 2 criteria: PA-7 + VOL-5

The number of criteria and thoughts should match the complexity of the idea. Simple ideas get 1 thought with 1 criterion. Complex ideas with data-linking get multiple thoughts with edges.

CRITICAL: PARAMETER TUNING PHILOSOPHY
A scan returning 0 results is USELESS to the user. Always err on the side of PERMISSIVE parameters that return 10-50 results, which the user can then tighten. Never stack tight filters — each additional criterion multiplies the filtering effect.

PARAMETER GUIDANCE BY INDICATOR:
- PA-3 (Consolidation/Base Detection): Use maxRange 20-30% (not the tight 15% default). Use period 40-60 for max base length. Set minPeriod to 5-10. Set maxSlope to 8-10% to allow gentle upward-drifting bases. minBasePct should be 0 unless specifically requested.
- PA-4 (Base Depth): Use maxDepth 30-35% for swing setups. Only use tight depths (10-15%) if user explicitly says "shallow" or "tight pullback". Set minDepth to 3-5% to exclude completely flat stocks.
- VOL-4 (Volume Dry-Up): Use maxMultiple 0.75-0.85 (not the strict 0.5 default). Volume dry-up of 0.5x is extremely rare — most healthy consolidations show 0.6-0.8x average volume.
- VOL-3 (Up/Down Volume Ratio): Use minRatio 1.0-1.2 for accumulation bias. Don't set above 1.5 unless the user explicitly wants very strong accumulation.
- PA-6 (Distance from 52-Week High): Use maxDistance 25-30% as default. Stocks 25% off highs can still be excellent setups.
- MA-3 (Price vs MA Distance): For "price near MA" use 0-5% range. For "price above MA" use minPct 0 and maxPct 30-50% (wide) unless user specifies proximity.
- MA-4 (MA Slope): Use minSlope 0.05-0.1% for "rising MA". Don't use values above 0.3% — that's extremely steep and rare.
- RS-1/RS-2 (Relative Strength): Use minRS 0 or small positive values. Only use minRS > 5 if user says "strong" RS. Values above 15 are very restrictive.
- PA-2 (ATR Percent): Use minPct 1.5 and maxPct 10-12% for normal volatility range. Don't set maxPct below 6% unless user specifically wants low-volatility stocks.
- VLT-1/VLT-2 (Volatility Contraction): Use ratio 0.6-0.8 for contraction detection, not extremely tight values.

CRITERIA DISTRIBUTION ACROSS THOUGHTS:
When creating multiple thoughts, distribute criteria evenly. Avoid putting 7+ criteria in one thought and 1-2 in another. A thought with 6+ criteria is very likely to return 0 results because every criterion must pass simultaneously. Aim for 3-4 criteria per thought maximum.

If the user describes a momentum/Quallamaggie-style setup (and NO consumer indicators like PA-14, PA-15, PA-16 are needed), structure as:
- Thought A (Trend): MA structure (2-3 criteria: price above MAs, MAs rising, MA stacking)
- Thought B (Base/Consolidation): Base quality (2-3 criteria: PA-3 base detection, PA-4 depth, VOL-4 volume dry-up)
- Thought C (Strength): Relative strength + accumulation (2 criteria: RS vs market, up/down volume)
Connect: A → Results, B → Results, C → Results (AND at Results intersects them all)

If consumer indicators ARE needed (PA-14 Tightness, PA-15 Close Clustering, PA-16 Volume Fade), remember the DATA-LINKING HARD RULES above: PA-3 must be in a separate upstream thought, consumers in a downstream thought with an edge between them. Example:
- Thought A (Trend): MA structure (2-3 criteria)
- Thought B (Base Provider): PA-3 only (base detection — the data provider)
- Thought C (Base Quality — downstream): PA-14 + PA-16 + VOL-4 (consumers + non-linked indicators)
- Thought D (Strength): RS + volume ratio
Connect: A → Results, B → C (data-link edge), C → Results, D → Results

CRITICAL: OR LOGIC AND AMBIGUITY EXPANSION
Edges between thoughts can specify "logicType": "AND" (default) or "logicType": "OR". Use OR edges when the user describes alternative conditions that should any-match.

AMBIGUITY EXPANSION RULE: Expansion into multiple OR alternatives depends on whether the ambiguous term is the CORE CONCEPT or a SUPPORTING DETAIL.

CORE CONCEPT = the ambiguous term IS the main thing the user is asking about. The entire idea centers on it.
SUPPORTING DETAIL = the ambiguous term is ONE piece of a larger multi-step idea. The user mentioned it in passing.

When the ambiguous term is the CORE CONCEPT (the entire idea revolves around it), expand into OR alternatives:
- "Find stocks that pulled back to a moving average" → The whole idea IS about the MA pullback. Expand to 10 EMA, 21 EMA, 50 SMA as OR alternatives.
- "Stocks near a support level" → The whole idea IS about support. Expand.

When the ambiguous term is a SUPPORTING DETAIL in a larger idea, pick ONE sensible default — do NOT expand:
- "Uptrend stocks that gapped up and pulled back to a MA" → The idea has 3 parts (uptrend + gap + pullback). The MA is one detail. Pick 21 EMA as the default (most commonly used swing MA) and create ONE thought. The user can change the period later.
- "Breakout above a MA with volume" → Two parts. Pick 50 SMA as a reasonable default for breakout context. ONE thought.

DEFAULT MA PICKS (when not expanding):
- For pullback/bounce context: 21 EMA (standard swing trading MA)
- For trend/breakout context: 50 SMA (standard trend MA)
- For short-term momentum: 10 EMA

ALWAYS expand for explicit OR language:
- "either X or Y" / "X or Y" → Explicit OR logic. Create separate thoughts for X and Y, connect with OR edges.
- "one of the key MAs" / "any moving average" / "multiple MAs" → User explicitly wants alternatives. Expand.

IMPORTANT RULES FOR OR EDGES:
- "RESULTS" is the ONLY special reserved key. Use "RESULTS" as the edge target to connect directly to the Results node on the canvas.
- If you want OR logic, you MUST provide explicit edges with "logicType": "OR". Thoughts without explicit edges auto-connect to Results with AND logic by default.
- Do NOT invent other special keys. Edge targets must be either a thoughtKey from your thoughts array, or "RESULTS".

CRITICAL RULE — OR EDGES MUST TARGET "RESULTS" (NOT intermediate thoughts):
OR edges should ALWAYS have "RESULTS" as the target. NEVER create OR edges between intermediate thoughts (e.g., from a prerequisite thought to alternative thoughts). This produces broken scan logic where the prerequisite substitutes for the alternative's own criteria.

WRONG — intermediate OR edges (NEVER DO THIS):
  Thought A: "Overnight Gap Up"
  Thought B: "Pullback to 10 EMA"
  Thought C: "Pullback to 21 EMA"
  Thought D: "Pullback to 50 SMA"
  "edges": [
    { "from": "A", "to": "B", "logicType": "OR" },
    { "from": "A", "to": "C", "logicType": "OR" },
    { "from": "A", "to": "D", "logicType": "OR" }
  ]
  BUG: This makes Gap Up an OR-alternative to each pullback, so stocks pass without any pullback if they gapped up. The pullbacks auto-connect to Results with AND, requiring ALL THREE to pass. Completely wrong.

CORRECT — flat OR edges to RESULTS:
  Thought A: "Overnight Gap Up" (no explicit edges → auto-connects to Results with AND, always required)
  Thought B: "Pullback to 10 EMA"
  Thought C: "Pullback to 21 EMA"
  Thought D: "Pullback to 50 SMA"
  "edges": [
    { "from": "B", "to": "RESULTS", "logicType": "OR" },
    { "from": "C", "to": "RESULTS", "logicType": "OR" },
    { "from": "D", "to": "RESULTS", "logicType": "OR" }
  ]
  CORRECT: Gap Up is required (AND). Any ONE pullback is sufficient (OR). Final: Gap Up AND (PB 10 OR PB 21 OR PB 50).

PREREQUISITE vs ALTERNATIVE pattern:
- Prerequisite thoughts (gap up, uptrend, base quality) = mandatory filters. Give them NO explicit edges so they auto-connect to Results with AND.
- Alternative thoughts (different MA pullbacks, different base types) = any-one-of options. Give each an explicit edge to RESULTS with "logicType": "OR".
- NEVER connect a prerequisite thought to alternative thoughts with OR edges. That makes the prerequisite an alternative instead of a requirement.

THOUGHT TIMEFRAME DETECTION — CRITICAL:
Each thought has a "timeframe" field. Valid values are: "daily", "5min", "15min", "30min".
Default to "daily" ONLY when nothing in the description suggests a shorter timeframe.
You MUST detect intraday timeframe references from the user's description and set the thought timeframe accordingly:
- "5-min", "5 min", "5-minute", "5m", "five minute" → timeframe: "5min"
- "15-min", "15 min", "15-minute", "15m", "fifteen minute" → timeframe: "15min"
- "30-min", "30 min", "30-minute", "30m", "thirty minute" → timeframe: "30min"
- "intraday", "session", "today", "this session" (without specific timeframe) → timeframe: "5min"
- "daily", "D1", "day", or no timeframe mentioned → timeframe: "daily"

INTRADAY INDICATOR RULE — CRITICAL:
When using ITD-* (Intraday category) indicators like ITD-1 (Opening Range Breakout), ITD-2 (VWAP Position), or ITD-3 (Gap Detection for intraday), the thought timeframe MUST be set to an intraday value ("5min", "15min", or "30min"). These indicators are designed for intraday candles and will produce meaningless results on daily data. If the user requests VWAP, ORB, or other ITD-* indicators without specifying a timeframe, default to "5min".
When the user's description contains a combined/multi-part idea where SOME parts reference an intraday timeframe and others reference daily, split into separate thoughts with the appropriate timeframe on each.

MULTI-TIMEFRAME PATTERN:
When the user wants a daily filter (e.g., gap up) combined with an intraday check (e.g., pullback to MA), set the timeframe field on each thought independently:
  Thought A: "Overnight Gap Up" — timeframe: "daily" (no explicit edges → AND required)
  Thought B: "Price near 21 EMA" — timeframe: "5min" (no explicit edges → AND required)
  "edges": []
  The scan engine evaluates each thought on its specified timeframe. Daily prerequisite + intraday filter is a powerful pattern.

If the user explicitly requests multiple intraday alternatives (e.g., "pulled back to either the 10 EMA or the 50 SMA intraday"), THEN use OR:
  Thought A: "Overnight Gap Up" — timeframe: "daily"
  Thought B: "Near 10 EMA" — timeframe: "5min"
  Thought C: "Near 50 SMA" — timeframe: "5min"
  "edges": [
    { "from": "B", "to": "RESULTS", "logicType": "OR" },
    { "from": "C", "to": "RESULTS", "logicType": "OR" }
  ]

Example (CORE CONCEPT — expand): User says "Find stocks that pulled back to a moving average"
The ENTIRE idea is about the MA pullback. Expand into SEPARATE thoughts with OR edges.
CRITICAL: Each alternative MUST be its own thought. Do NOT put multiple MA-3 criteria in one thought — criteria within a thought are ANDed (all must pass), which would require a stock to be near ALL MAs at once. Instead, create separate thoughts so OR logic works (any ONE MA match is sufficient):
  Thought A: "Near 10 EMA" — 1 criterion: MA-3 with period=10, maType=ema, maxPct=2
  Thought B: "Near 21 EMA" — 1 criterion: MA-3 with period=21, maType=ema, maxPct=2
  Thought C: "Near 50 SMA" — 1 criterion: MA-3 with period=50, maType=sma, maxPct=2
  "edges": [
    { "from": "A", "to": "RESULTS", "logicType": "OR" },
    { "from": "B", "to": "RESULTS", "logicType": "OR" },
    { "from": "C", "to": "RESULTS", "logicType": "OR" }
  ]
  A ticker passes if it is near ANY ONE of these MAs (OR logic). THREE thoughts, not one.

WRONG way to expand (NEVER do this):
  Thought A: "Near key MAs" — 3 criteria: MA-3(10), MA-3(21), MA-3(50)
  This requires a stock to be near ALL THREE MAs simultaneously (AND), which is almost impossible and not what the user wants.

Example (SUPPORTING DETAIL — don't expand): User says "Uptrend stocks that gapped up and pulled back to a MA and held"
The idea has 3 distinct parts: uptrend + gap + pullback. The MA is a supporting detail. Pick ONE default (21 EMA for pullback context). Do NOT create 3 pullback thoughts.
  Thought A (thoughtKey "A"): "Uptrend Filter" — MA-1 (price above 50 SMA) + MA-8 (50 above 200) + MA-4 (MA slope rising)
  Thought B (thoughtKey "B"): "Overnight Gap Up" — PA-10 gap detection
  Thought C (thoughtKey "C"): "Price near 21 EMA" — MA-3 with period=21, maType=ema, minPct=-2, maxPct=2
  No explicit edges needed — all 3 auto-connect to Results with AND logic.
  "edges": []
  Final scan behavior: Uptrend AND Gap Up AND Near 21 EMA. Simple and matches the user's intent.

Example (EXPLICIT OR — expand): User says "Uptrend stocks that gapped up and pulled back to either the 10 EMA or the 21 EMA"
The user explicitly said "either... or..." — this IS an OR request:
  Thought A: "Uptrend Filter" — MA-1 + MA-8 + MA-4
  Thought B: "Overnight Gap Up" — PA-10
  Thought C: "Near 10 EMA" — MA-3 with period=10, maType=ema
  Thought D: "Near 21 EMA" — MA-3 with period=21, maType=ema
  A and B have no explicit edges → AND.
  "edges": [
    { "from": "C", "to": "RESULTS", "logicType": "OR" },
    { "from": "D", "to": "RESULTS", "logicType": "OR" }
  ]
  Final: Uptrend AND Gap Up AND (Near 10 EMA OR Near 21 EMA).

When the user IS specific (e.g., "pulled back to the 21 EMA"), do NOT expand — just use the specified value in a single thought.

CRITICAL: You MUST return an "edges" array in your JSON response. If you omit edges, ALL thoughts auto-connect to Results with AND logic, which is WRONG for alternative thoughts. When you have 2+ thoughts that represent alternatives (same indicator, different params), you MUST include explicit OR edges for them. NEVER rely on the default — always return edges.

EDGE FORMAT WITH LOGIC TYPE:
Each edge can optionally include a logicType field:
{ "from": "A", "to": "RESULTS", "logicType": "OR" }
{ "from": "B", "to": "RESULTS" }  // defaults to AND
{ "from": "C", "to": "D", "logicType": "AND" }  // AND is valid for thought-to-thought (data-link) edges

Use OR ONLY on edges targeting RESULTS when the user describes alternatives. Use AND (or omit logicType) for prerequisite/data-link thought-to-thought edges.

When creating OR branches, keep each branch thought focused on ONE specific alternative (e.g., one MA period per thought). Don't combine multiple alternatives into one thought — that defeats the purpose of OR logic.

Select the most appropriate indicators and set parameters that match the user's description. Set inverted to true when the user wants the opposite of what the indicator normally checks (e.g., "price below the 50 SMA" when the indicator checks "above").

MISSING INDICATOR HANDLING:
If you cannot find ANY suitable indicator in the library above that reasonably matches the user's request, you MUST return a special response format to indicate that a custom indicator should be created:
{
  "needsCustomIndicator": true,
  "requestDescription": "Brief description of what the user wants (1-2 sentences)",
  "suggestedIndicatorName": "Suggested name for the new indicator",
  "category": "Suggested category",
  "reason": "Brief explanation of why no existing indicator matches"
}

ONLY use this format when NO indicator in the library can reasonably achieve what the user wants. Do not suggest custom indicators for requests that can be solved by combining existing indicators creatively. For example:
- "3 consecutive up days" → NO existing indicator → needsCustomIndicator: true
- "price up/down X% over last N days/bars" → NO existing indicator → needsCustomIndicator: true (PA-3 is for sideways consolidation, PA-12/PA-18 require upstream base context — neither measures simple price change over a period)
- "price above 50 SMA" → MA-1 exists → use MA-1, do NOT suggest custom
- "volume spike" → VOL-5 exists → use VOL-5, do NOT suggest custom

CRITICAL — DO NOT USE THESE INDICATORS FOR PRICE CHANGE:
- PA-3 (Consolidation/Base Detection) detects SIDEWAYS consolidation zones, NOT price increases/decreases
- PA-12 (Prior Price Advance) measures advance BEFORE a base and requires PA-3 upstream
- PA-18 (Price Change Over Period) measures change AFTER a pattern and requires upstream context
If the user asks for simple "price increased/decreased by X% over the last N bars/days", return needsCustomIndicator: true.

Be very strict about this — only suggest a custom indicator when it is genuinely impossible to fulfill the request with the available library.`;

      const openai = getOpenAI();
      if (!openai) {
        return res.status(500).json({ error: "AI service not configured. Please ensure OpenAI API key is set." });
      }

      let existingThoughtsContext = "";
      try {
        const suggestedThoughts = await selectThoughtsByWeight(userId, 8);
        if (suggestedThoughts.length > 0) {
          const summaries = suggestedThoughts.map(t => {
            const criteriaDesc = (t.criteria as any[] || []).map((c: any) => {
              const ind = INDICATOR_LIBRARY.find(i => i.id === c.indicatorId);
              const paramStr = (c.params || []).map((p: any) => `${p.name}=${p.value}`).join(", ");
              return `${ind?.name || c.indicatorId}(${paramStr})${c.inverted ? " [inverted]" : ""}`;
            }).join("; ");
            return `- EXISTING_THOUGHT_ID=${t.id} "${t.name}" (category: ${t.category}, score: ${t.score}, timeframe: ${t.timeframe || "daily"}): ${t.description || "no description"}. Criteria: [${criteriaDesc}]`;
          }).join("\n");
          existingThoughtsContext = `\n\nEXISTING THOUGHT REUSE RULES:
The user has these highly-rated existing thoughts. When generating your response, for EACH thought you would create, check these existing thoughts first:
- If an existing thought is a VERY CLOSE match (same indicators, similar parameters, same purpose), REUSE it by setting "reuseThoughtId" to its EXISTING_THOUGHT_ID instead of generating new criteria. A reused thought needs only: { "thoughtKey": "A", "reuseThoughtId": 42 }
- If no existing thought is close enough, generate new criteria as normal.
- "Very close" means: covers the same concept with the same or nearly identical indicators. Small parameter differences (e.g. period 20 vs 21) count as close. Different indicator choices or different concepts do NOT count as close.
- When in doubt, generate new — only reuse when the match is clearly strong.

Existing thoughts:
${summaries}`;
        }
      } catch (e) {
        // Non-critical, continue without existing thoughts context
      }

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt + existingThoughtsContext },
          { role: "user", content: description },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
      });

      const content = completion.choices[0]?.message?.content;
      if (!content) {
        return res.status(500).json({ error: "AI returned empty response" });
      }

      const parsed = JSON.parse(content);

      // Check if AI indicates a custom indicator is needed
      if (parsed.needsCustomIndicator) {
        return res.json({
          needsCustomIndicator: true,
          requestDescription: parsed.requestDescription || description,
          suggestedIndicatorName: parsed.suggestedIndicatorName || "Custom Indicator",
          category: parsed.category || "Custom",
          reason: parsed.reason || "No matching indicator found in library",
          originalRequest: description,
        });
      }

      let result: any;
      if (parsed.thoughts && Array.isArray(parsed.thoughts)) {
        result = parsed;
      } else {
        result = {
          thoughts: [{ thoughtKey: "A", ...parsed }],
          edges: [],
        };
      }

      // Validate AI selection against user's intent - catch obvious mismatches
      const validation = validateAISelection(description, result.thoughts);
      if (!validation.valid) {
        console.warn(`[BigIdea AI] Validation failed for "${description}":`, validation.errors);
        // Return as needing custom indicator with explanation
        return res.json({
          needsCustomIndicator: true,
          requestDescription: description,
          suggestedIndicatorName: "Custom Filter",
          category: "Custom",
          reason: validation.errors.join(" "),
          originalRequest: description,
          validationErrors: validation.errors,
        });
      }

      // Resolve reused thoughts: replace reuseThoughtId references with full thought data from DB
      for (let i = 0; i < result.thoughts.length; i++) {
        const t = result.thoughts[i];
        if (t.reuseThoughtId && isDatabaseAvailable() && db) {
          try {
            const [existing] = await db.select().from(scannerThoughts).where(eq(scannerThoughts.id, t.reuseThoughtId));
            if (existing) {
              result.thoughts[i] = {
                thoughtKey: t.thoughtKey,
                name: existing.name,
                category: existing.category,
                description: existing.description,
                criteria: existing.criteria,
                timeframe: existing.timeframe,
                reuseThoughtId: existing.id,
              };
              console.log(`[BigIdea AI] Reusing existing thought #${existing.id} "${existing.name}" (score: ${existing.score})`);
            }
          } catch (e) {
            console.error(`[BigIdea AI] Failed to look up reused thought #${t.reuseThoughtId}:`, e);
          }
        }
      }

      const PROVIDER_IDS = new Set(["PA-3", "PA-7"]);
      const CONSUMER_IDS = new Set(["PA-12", "PA-13", "PA-14", "PA-15", "PA-16"]);
      const fixedThoughts: any[] = [];
      const fixedEdges: any[] = [...(result.edges || [])];
      const usedKeys = new Set(result.thoughts.map((t: any) => t.thoughtKey));

      const nextUnusedKey = (): string => {
        for (let i = 0; i < 26; i++) {
          const key = String.fromCharCode(65 + i);
          if (!usedKeys.has(key)) {
            usedKeys.add(key);
            return key;
          }
        }
        const fallback = `X${usedKeys.size}`;
        usedKeys.add(fallback);
        return fallback;
      }

      for (const thought of result.thoughts) {
        const criteria = thought.criteria || [];
        const hasProvider = criteria.some((c: any) => PROVIDER_IDS.has(c.indicatorId));
        const hasConsumer = criteria.some((c: any) => CONSUMER_IDS.has(c.indicatorId));

        if (hasProvider && hasConsumer) {
          const providerCriteria = criteria.filter((c: any) => PROVIDER_IDS.has(c.indicatorId) || !CONSUMER_IDS.has(c.indicatorId));
          const consumerCriteria = criteria.filter((c: any) => CONSUMER_IDS.has(c.indicatorId));
          const providerKey = thought.thoughtKey || nextUnusedKey();
          const consumerKey = nextUnusedKey();

          const consumerNames = consumerCriteria.map((c: any) => {
            const ind = INDICATOR_LIBRARY.find(i => i.id === c.indicatorId);
            return ind?.name || c.indicatorId;
          });

          fixedThoughts.push({
            ...thought,
            thoughtKey: providerKey,
            criteria: providerCriteria,
          });
          fixedThoughts.push({
            thoughtKey: consumerKey,
            name: consumerNames.join(" + "),
            category: thought.category || "Custom",
            description: `Data-linked filters: ${consumerNames.join(", ")}`,
            criteria: consumerCriteria,
          });

          for (const edge of fixedEdges) {
            if (edge.from === thought.thoughtKey) {
              edge.from = consumerKey;
            }
          }
          fixedEdges.push({ from: providerKey, to: consumerKey });
          console.log(`[BigIdea AI] Auto-split thought "${thought.name}" — provider/consumer violation fixed`);
        } else {
          fixedThoughts.push(thought);
        }
      }

      const indicatorGroups = new Map<string, string[]>();
      for (const thought of fixedThoughts) {
        const criteria = thought.criteria || [];
        if (criteria.length === 1) {
          const indId = criteria[0].indicatorId;
          if (!indicatorGroups.has(indId)) indicatorGroups.set(indId, []);
          indicatorGroups.get(indId)!.push(thought.thoughtKey);
        }
      }
      for (const [indId, keys] of Array.from(indicatorGroups.entries())) {
        if (keys.length >= 2) {
          const hasAnyExplicitEdge = keys.some((k: string) =>
            fixedEdges.some((e: any) => e.from === k)
          );
          if (!hasAnyExplicitEdge) {
            for (const key of keys) {
              fixedEdges.push({ from: key, to: "RESULTS", logicType: "OR" });
            }
            console.log(`[BigIdea AI] Auto-OR: ${keys.length} thoughts with indicator ${indId} auto-connected with OR to RESULTS`);
          }
        }
      }

      res.json({ thoughts: fixedThoughts, edges: fixedEdges });
    } catch (error: any) {
      console.error("[BigIdea AI] Error creating thought:", error?.message || error);
      if (error?.status === 401 || error?.code === 'invalid_api_key') {
        return res.status(500).json({ error: "AI service credentials are invalid. Please check the API key configuration." });
      }
      if (error?.status === 429) {
        return res.status(429).json({ error: "AI rate limit reached. Please wait a moment and try again." });
      }
      res.status(500).json({ error: "Failed to generate thought definition. " + (error?.message || "") });
    }
  });

  // Refine a proposal through iterative conversation
  app.post("/api/bigidea/ai/refine-proposal", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) {
        return res.status(401).json({ error: "Not logged in. Please refresh the page and try again." });
      }

      const { currentProposal, message, conversationHistory, originalDescription } = req.body;
      if (!currentProposal || !message) {
        return res.status(400).json({ error: "currentProposal and message are required" });
      }

      const openai = getOpenAI();
      if (!openai) {
        return res.status(500).json({ error: "AI service not configured. Please ensure OpenAI API key is set." });
      }

      const mergedLibrary = await getMergedIndicatorLibrary(userId);
      const indicatorSummary = mergedLibrary.map((ind) => ({
        id: ind.id,
        name: ind.name,
        category: ind.category,
        description: ind.description,
        params: ind.params.map((p) => ({
          name: p.name,
          label: p.label,
          type: p.type,
          defaultValue: p.defaultValue,
          options: p.options,
          min: p.min,
          max: p.max,
          step: p.step,
        })),
      }));

      const systemPrompt = `You are a helpful stock screening assistant refining scan criteria through conversation. Your job is to CLOSE THE LOOP — don't just silently apply changes, explain what they mean for the user's scan.

CURRENT PROPOSAL:
Original description: "${originalDescription || 'Not provided'}"
${JSON.stringify(currentProposal, null, 2)}

AVAILABLE INDICATORS:
${JSON.stringify(indicatorSummary, null, 2)}

RESPONSE GUIDELINES — ALWAYS CLOSE THE LOOP:
Your response should be conversational and informative. After making changes, explain:
1. What you changed (briefly)
2. How it affects the scan (will it narrow/widen results? is it required or optional?)
3. Any relevant tips or follow-up options

EXAMPLES OF GOOD RESPONSES:
- "Added Wedge Pop as an optional OR condition — your scan will now catch stocks that EITHER cross the 21 EMA OR gap through it with wedge characteristics. This broadens your net. Want me to make it required instead (AND logic)?"
- "Removed the volume filter. This will return more results since we're no longer filtering by volume surge. If you're getting too many, we can add a different volume check."
- "Tightened RSI from 30-70 to 50-70. This focuses on stocks with stronger momentum, which should reduce results but improve quality. The scan currently has 3 required conditions."
- "Added minimum price > $20. Good call for avoiding penny stocks. Current setup: EMA crossback + price filter. Want to add anything else?"

EXAMPLES OF BAD RESPONSES (don't do these):
- "Done." (too terse, no context)
- "Added wedge pop." (what does that mean for the scan?)
- "Updated." (updated what? how?)

LOGIC EXPLANATION:
- Multiple thoughts with no explicit edges = AND logic (all must pass)
- Thoughts connected to RESULTS with "logicType": "OR" = any one can pass
- When user asks to make something "optional" or "nice to have", use OR edges to RESULTS
- When user asks to make something "required", use AND (no explicit edges, or edge without logicType)

WEIGHTING/PRIORITY:
Our scan system uses binary pass/fail, not weighted scoring. BUT you can explain alternatives:
- "Optional" = OR logic, broadens results
- "Required" = AND logic, filters strictly
- If user asks about weighting, explain: "The scanner uses pass/fail logic, but I can make this optional (OR) so it catches stocks with or without it. After the scan, you can sort results by which criteria they matched."

RULES:
- Return the FULL updated proposal structure (thoughts + edges) - don't return partial updates
- Maintain the same JSON structure: { "thoughts": [...], "edges": [...] }
- Each thought needs: thoughtKey, name, category, description, criteria, timeframe (optional)
- Each criterion needs: indicatorId, label, params (array with name, label, type, value, min, max, step)
- For number params, always include min, max, step from the indicator definition
- When user says "remove X" or "drop X", remove that criterion or thought entirely
- When user says "add X", add a new criterion or thought as appropriate
- When user says "change X to Y" or "make X tighter/looser", modify the relevant parameter
- When user says "yes", "looks good", "perfect", or similar, return proposal unchanged with an encouraging response like "Great, ready to scan!"
- For OR logic: add edge { "from": "thoughtKey", "to": "RESULTS", "logicType": "OR" }

Respond with valid JSON in this format:
{
  "response": "Your helpful, loop-closing message here",
  "proposal": {
    "thoughts": [...],
    "edges": [...]
  }
}`;

      // Build conversation context
      const messages: any[] = [{ role: "system", content: systemPrompt }];
      
      // Add conversation history for context
      if (conversationHistory && Array.isArray(conversationHistory)) {
        for (const msg of conversationHistory.slice(-6)) { // Keep last 6 messages for context
          messages.push({
            role: msg.role === "user" ? "user" : "assistant",
            content: msg.content,
          });
        }
      }
      
      // Add current user message
      messages.push({ role: "user", content: message });

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages,
        response_format: { type: "json_object" },
        temperature: 0.3,
      });

      const content = completion.choices[0]?.message?.content;
      if (!content) {
        return res.status(500).json({ error: "AI returned empty response" });
      }

      const parsed = JSON.parse(content);
      
      // Validate the response structure
      if (!parsed.proposal || !parsed.proposal.thoughts) {
        return res.json({
          response: parsed.response || "I couldn't process that request. Could you rephrase?",
          proposal: currentProposal, // Return unchanged if parsing fails
        });
      }

      // Validate and fix proposal structure (same fixes as create-thought)
      const PROVIDER_IDS = new Set(["PA-3", "PA-7"]);
      const CONSUMER_IDS = new Set(["PA-12", "PA-13", "PA-14", "PA-15", "PA-16"]);
      const result = parsed.proposal;
      const fixedThoughts: any[] = [];
      const fixedEdges: any[] = [...(result.edges || [])];
      const usedKeys = new Set(result.thoughts.map((t: any) => t.thoughtKey));

      const nextUnusedKey = (): string => {
        for (let i = 0; i < 26; i++) {
          const key = String.fromCharCode(65 + i);
          if (!usedKeys.has(key)) {
            usedKeys.add(key);
            return key;
          }
        }
        return `X${usedKeys.size}`;
      };

      for (const thought of result.thoughts) {
        const criteria = thought.criteria || [];
        const hasProvider = criteria.some((c: any) => PROVIDER_IDS.has(c.indicatorId));
        const hasConsumer = criteria.some((c: any) => CONSUMER_IDS.has(c.indicatorId));

        if (hasProvider && hasConsumer) {
          // Auto-split provider/consumer violations
          const providerCriteria = criteria.filter((c: any) => PROVIDER_IDS.has(c.indicatorId) || !CONSUMER_IDS.has(c.indicatorId));
          const consumerCriteria = criteria.filter((c: any) => CONSUMER_IDS.has(c.indicatorId));
          const providerKey = thought.thoughtKey || nextUnusedKey();
          const consumerKey = nextUnusedKey();

          fixedThoughts.push({ ...thought, thoughtKey: providerKey, criteria: providerCriteria });
          fixedThoughts.push({
            thoughtKey: consumerKey,
            name: consumerCriteria.map((c: any) => INDICATOR_LIBRARY.find(i => i.id === c.indicatorId)?.name || c.indicatorId).join(" + "),
            category: thought.category || "Custom",
            description: "Data-linked filters",
            criteria: consumerCriteria,
            timeframe: thought.timeframe,
          });
          fixedEdges.push({ from: providerKey, to: consumerKey });
        } else {
          fixedThoughts.push(thought);
        }
      }

      res.json({
        response: parsed.response || "Updated!",
        proposal: { thoughts: fixedThoughts, edges: fixedEdges },
      });
    } catch (error: any) {
      console.error("[BigIdea AI] Error refining proposal:", error?.message || error);
      res.status(500).json({ error: "Failed to refine proposal. " + (error?.message || "") });
    }
  });

  app.post("/api/bigidea/ai/restate-thought", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) {
        return res.status(401).json({ error: "Not logged in. Please refresh the page and try again." });
      }

      const { instruction, currentCriteria, currentName, currentDescription } = req.body;
      if (!instruction) {
        return res.status(400).json({ error: "instruction is required" });
      }

      const mergedLibrary = await getMergedIndicatorLibrary(userId);
      const indicatorSummary = mergedLibrary.map((ind) => ({
        id: ind.id,
        name: ind.name,
        category: ind.category,
        description: ind.description,
        params: ind.params.map((p) => ({
          name: p.name,
          label: p.label,
          type: p.type,
          defaultValue: p.defaultValue,
          options: p.options,
          min: p.min,
          max: p.max,
          step: p.step,
        })),
      }));

      const systemPrompt = `You are a stock screening assistant. The user has an EXISTING thought (screening filter) on their canvas and wants to MODIFY it. Your job is to adjust the existing criteria based on their instruction.

Available indicators:
${JSON.stringify(indicatorSummary, null, 2)}

The user's CURRENT thought is:
Name: ${currentName || "Unnamed"}
Description: ${currentDescription || "No description"}
Current criteria: ${JSON.stringify(currentCriteria || [], null, 2)}

The user will give you an instruction like "make it looser", "tighten the filters", "add volume check", "remove the RSI criterion", etc.

You must respond with valid JSON in this exact format:
{
  "name": "Updated short descriptive name",
  "category": "One of: Momentum, Value, Trend, Volatility, Volume, Consolidation, Custom",
  "description": "Updated description of what this thought screens for",
  "criteria": [... updated criteria array ...]
}

RULES:
- This modifies a SINGLE existing thought. Never return multiple thoughts or edges.
- When the user says "make it looser" or "relax filters": widen thresholds, lower minimums, increase tolerances, increase max ranges.
- When the user says "make it tighter" or "stricter": narrow thresholds, raise minimums, decrease tolerances.
- When the user says "add X": keep existing criteria and add new ones.
- When the user says "remove X": remove matching criteria.
- Preserve all existing criteria that the user didn't ask to change — only modify the relevant parameters.
- The "description" field MUST accurately describe what the criteria actually measure.
- Only use indicatorId values from the indicator library provided above.

Each criterion follows this structure:
{
  "indicatorId": "The indicator ID from the library",
  "label": "Human readable label",
  "inverted": false,
  "timeframeOverride": "daily or omit",
  "params": [
    {
      "name": "param name matching the indicator",
      "label": "param label",
      "type": "number|select|boolean",
      "value": "the value to use",
      "min": "copy min from indicator definition (for number params)",
      "max": "copy max from indicator definition (for number params)",
      "step": "copy step from indicator definition (for number params)"
    }
  ]
}

IMPORTANT: For every number param, you MUST copy the min, max, and step values from the indicator definition. This ensures the UI slider allows the correct range and precision.`;

      const openai = getOpenAI();
      if (!openai) {
        return res.status(500).json({ error: "AI service not configured." });
      }

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: instruction },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
      });

      const content = completion.choices[0]?.message?.content;
      if (!content) {
        return res.status(500).json({ error: "AI returned empty response" });
      }

      const parsed = JSON.parse(content);
      res.json(parsed);
    } catch (error: any) {
      console.error("[BigIdea AI] Error restating thought:", error?.message || error);
      if (error?.status === 429) {
        return res.status(429).json({ error: "AI rate limit reached. Please wait a moment and try again." });
      }
      res.status(500).json({ error: "Failed to restate thought. " + (error?.message || "") });
    }
  });

  app.post("/api/bigidea/scan", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const mergedIndicatorLibrary = await getMergedIndicatorLibrary(userId);

      const { nodes, edges, universe, ideaId, customTickers } = req.body;
      if (!nodes || !edges || (!universe && !customTickers)) {
        return res.status(400).json({ error: "nodes, edges, and universe (or customTickers) are required" });
      }

      const tickers = customTickers && Array.isArray(customTickers) && customTickers.length > 0
        ? customTickers.map((t: string) => t.toUpperCase())
        : getUniverseTickers(universe);
      if (tickers.length === 0) {
        return res.status(400).json({ error: "Invalid universe or empty watchlist" });
      }

      const thoughtNodes = nodes.filter((n: any) => n.type === "thought" && (n.thoughtCriteria || n.isMuted));

      const linkOverrides: Array<{ thoughtId: string; thoughtName: string; paramName: string; indicatorId: string; originalValue: any; linkedValue: any; sourceName: string }> = [];

      const providerMap: Map<string, Array<{ nodeId: string; nodeName: string; indicatorId: string; indicatorName: string; paramName: string; paramValue: any }>> = new Map();
      for (const tn of thoughtNodes) {
        for (const c of (tn.thoughtCriteria || [])) {
          if (c.muted) continue;
          const indDef = INDICATOR_LIBRARY.find((ind) => ind.id === c.indicatorId);
          if (!indDef?.provides) continue;
          for (const prov of indDef.provides) {
            const paramVal = (c.params || []).find((p: any) => p.name === prov.paramName);
            if (paramVal) {
              if (!providerMap.has(prov.linkType)) providerMap.set(prov.linkType, []);
              providerMap.get(prov.linkType)!.push({
                nodeId: tn.id,
                nodeName: tn.thoughtName || "Unnamed",
                indicatorId: c.indicatorId,
                indicatorName: c.label || indDef.name,
                paramName: prov.paramName,
                paramValue: paramVal.value,
              });
            }
          }
        }
      }

      for (const tn of thoughtNodes) {
        for (const c of (tn.thoughtCriteria || [])) {
          const indDef = INDICATOR_LIBRARY.find((ind) => ind.id === c.indicatorId);
          for (const p of (c.params || [])) {
            if (!p.autoLink && indDef) {
              const metaParam = indDef.params.find((mp) => mp.name === p.name);
              if (metaParam?.autoLink) {
                p.autoLink = metaParam.autoLink;
                if (p.autoLinked === undefined) p.autoLinked = true;
              }
            }
            if (!p.autoLink || p.autoLinked === false) continue;
            const sources = (providerMap.get(p.autoLink.linkType) || []).filter((s: any) => s.nodeId !== tn.id);
            if (sources.length === 0) continue;
            let chosen: any;
            if (p.linkedThoughtId) {
              chosen = sources.find((s: any) => s.nodeId === p.linkedThoughtId);
            }
            if (!chosen) {
              chosen = sources.reduce((a: any, b: any) => (Number(a.paramValue) > Number(b.paramValue) ? a : b));
            }
            if (chosen) {
              const originalValue = p.value;
              p.value = chosen.paramValue;
              linkOverrides.push({
                thoughtId: tn.id,
                thoughtName: tn.thoughtName || "Unnamed",
                paramName: p.name,
                indicatorId: c.indicatorId,
                originalValue,
                linkedValue: chosen.paramValue,
                sourceName: `${chosen.nodeName} → ${chosen.indicatorName} (${chosen.paramName}=${chosen.paramValue})`,
              });
            }
          }
        }
      }

      if (linkOverrides.length > 0) {
        console.log(`[BigIdea Scan] Auto-link overrides:`, linkOverrides.map(o => `${o.thoughtName}/${o.paramName}: ${o.originalValue} → ${o.linkedValue} (from ${o.sourceName})`));
      }

      const CONSUMER_INDICATOR_IDS = new Set(["PA-12", "PA-13", "PA-14", "PA-15", "PA-16"]);
      const PROVIDER_INDICATOR_IDS_SCAN = new Set(["PA-3", "PA-7"]);

      const topoSort = (nodeList: typeof thoughtNodes, edgeList: typeof edges) => {
        const inDegree: Record<string, number> = {};
        const adj: Record<string, string[]> = {};
        for (const n of nodeList) {
          inDegree[n.id] = 0;
          adj[n.id] = [];
        }
        for (const e of edgeList) {
          const src = e.source;
          const tgt = e.target;
          if (inDegree[tgt] !== undefined && adj[src] !== undefined) {
            inDegree[tgt]++;
            adj[src].push(tgt);
          }
        }
        const queue: string[] = [];
        for (const id of Object.keys(inDegree)) {
          if (inDegree[id] === 0) queue.push(id);
        }
        const sorted: string[] = [];
        while (queue.length > 0) {
          const cur = queue.shift()!;
          sorted.push(cur);
          for (const next of adj[cur]) {
            inDegree[next]--;
            if (inDegree[next] === 0) queue.push(next);
          }
        }
        if (sorted.length < nodeList.length) {
          for (const n of nodeList) {
            if (!sorted.includes(n.id)) sorted.push(n.id);
          }
        }
        return sorted;
      };

      const thoughtEdges = edges.filter((e: any) => {
        const srcIsThought = thoughtNodes.some((n: any) => n.id === e.source);
        const tgtIsThought = thoughtNodes.some((n: any) => n.id === e.target);
        return srcIsThought && tgtIsThought;
      });
      let evalOrder = topoSort(thoughtNodes, thoughtEdges);
      let sortedThoughtNodes = evalOrder.map((id: string) => thoughtNodes.find((n: any) => n.id === id)!).filter(Boolean);
      let optimizedEdges = thoughtEdges;
      
      console.log(`[BigIdea Scan] Initial evaluation order: ${sortedThoughtNodes.map((n: any) => `"${n.thoughtName}"`).join(" → ")}`);
      
      // AUTO-OPTIMIZATION: Check if we should reorder thoughts for efficiency
      if (shouldAutoOptimize(thoughtNodes, edges)) {
        try {
          // Fetch market sentiment for optimization context
          let marketRegime: any = undefined;
          try {
            const sentiment = await fetchMarketSentiment();
            marketRegime = buildMarketRegimeSnapshot(sentiment);
          } catch (e) {
            console.warn(`[QueryOptimizer] Could not fetch market sentiment for optimization context`);
          }
          
          const optimizationContext: OptimizationContext = {
            universe: universe || 'unknown',
            marketRegime,
            timeframe: thoughtNodes[0]?.thoughtTimeframe || 'daily',
          };
          
          const optimized = await autoOptimizeThoughtOrder(thoughtNodes, edges, optimizationContext);
          
          // Use optimized order and edges (keep all edges including connections to Results)
          sortedThoughtNodes = optimized.nodes;
          optimizedEdges = optimized.edges;
          
          console.log(`[BigIdea Scan] ✨ AUTO-OPTIMIZED evaluation order: ${sortedThoughtNodes.map((n: any) => `"${n.thoughtName}"`).join(" → ")}`);
        } catch (error) {
          console.error(`[QueryOptimizer] Optimization failed, using topological order:`, error);
        }
      } else {
        console.log(`[BigIdea Scan] Using graph-defined order (no optimization needed)`);
      }

      const downstreamMap: Record<string, string[]> = {};
      for (const n of thoughtNodes) downstreamMap[n.id] = [];
      for (const e of optimizedEdges) {
        if (downstreamMap[e.source]) downstreamMap[e.source].push(e.target);
      }
      const getTransitiveDownstream = (nodeId: string): string[] => {
        const result = new Set<string>();
        const queue = [...(downstreamMap[nodeId] || [])];
        while (queue.length > 0) {
          const cur = queue.shift()!;
          if (!result.has(cur)) {
            result.add(cur);
            const children = downstreamMap[cur] || [];
            for (let ci = 0; ci < children.length; ci++) queue.push(children[ci]);
          }
        }
        return Array.from(result);
      };

      for (const tn of sortedThoughtNodes) {
        const hasConsumer = (tn.thoughtCriteria || []).some((c: any) => CONSUMER_INDICATOR_IDS.has(c.indicatorId));
        if (hasConsumer) {
          const upstreamIds = edges.filter((e: any) => e.target === tn.id).map((e: any) => e.source);
          const upstreamThoughts = upstreamIds.map((id: string) => thoughtNodes.find((n: any) => n.id === id)).filter(Boolean);
          const hasProviderUpstream = upstreamThoughts.some((ut: any) =>
            (ut.thoughtCriteria || []).some((c: any) => PROVIDER_INDICATOR_IDS_SCAN.has(c.indicatorId))
          );
          if (!hasProviderUpstream) {
            console.warn(`[BigIdea Scan] WARNING: Thought "${tn.thoughtName}" has consumer indicators but no provider (PA-3/PA-7) in upstream thoughts. Consumer criteria will be skipped.`);
          }
        }
      }

      const timeframesNeeded = new Set<string>();
      for (const tn of thoughtNodes) {
        timeframesNeeded.add(tn.thoughtTimeframe || "daily");
        for (const c of (tn.thoughtCriteria || [])) {
          if (c.timeframeOverride) timeframesNeeded.add(c.timeframeOverride);
        }
      }
      const timeframesArray = Array.from(timeframesNeeded);
      console.log(`[BigIdea Scan] Universe: ${universe}, tickers: ${tickers.length}, thought nodes: ${thoughtNodes.length}, timeframes: [${timeframesArray.join(", ")}]`);
      for (const tn of thoughtNodes) {
        console.log(`[BigIdea Scan] Thought: "${tn.thoughtName}" (${tn.id}, tf=${tn.thoughtTimeframe || "daily"}), criteria:`, JSON.stringify(tn.thoughtCriteria?.map((c: any) => ({ id: c.indicatorId, label: c.label, params: c.params?.map((p: any) => `${p.name}=${p.value}`) }))));
      }

      let spyCandles: CandleData[] = [];
      try {
        spyCandles = await fetchOHLCV("SPY");
        console.log(`[BigIdea Scan] SPY candles: ${spyCandles.length}`);
      } catch (e) {
        console.warn("Could not fetch SPY benchmark data");
      }

      const results: Array<{ symbol: string; name: string; price: number; passedPaths: string[] }> = [];
      const thoughtCounts: Record<string, number> = {};
      const funnelData: {
        totalTickers: number;
        fetchFails: number;
        tooFewCandles: number;
        perThought: Record<string, { name: string; passed: number; failed: number; evaluated: number; skipped: number; failedTickers: string[] }>;
        perIndicator: Record<string, { name: string; passed: number; failed: number; diagnosticSamples: Array<{ symbol: string; value: string; threshold: string }> }>;
      } = {
        totalTickers: tickers.length,
        fetchFails: 0,
        tooFewCandles: 0,
        perThought: {},
        perIndicator: {},
      };

      for (const node of thoughtNodes) {
        thoughtCounts[node.id] = 0;
        funnelData.perThought[node.id] = { name: node.thoughtName || "Unnamed", passed: 0, failed: 0, evaluated: 0, skipped: 0, failedTickers: [] };
      }
      
      // Track execution performance for query optimizer learning
      const indicatorPerformance: Record<string, { totalTimeMs: number; evaluations: number; passes: number }> = {};
      for (const node of thoughtNodes) {
        for (const criterion of (node.thoughtCriteria || [])) {
          if (!criterion.muted && !indicatorPerformance[criterion.indicatorId]) {
            indicatorPerformance[criterion.indicatorId] = { totalTimeMs: 0, evaluations: 0, passes: 0 };
          }
        }
      }

      let fetchFailCount = 0;
      let tooFewCandlesCount = 0;
      // Batch size controls how many tickers we evaluate in parallel per batch.
      // Lower this if you see DB / external API contention. 12 is a conservative default for upgraded DBs.
      const BATCH_SIZE = 12;
      
      // Check if any FND-* indicators are used (needed for market cap stats)
      const hasFundamentalIndicators = sortedThoughtNodes.some((node: any) => 
        (node.thoughtCriteria || []).some((c: any) => 
          !c.muted && c.indicatorId && c.indicatorId.startsWith("FND-")
        )
      );
      
      // Track market cap data availability for debugging
      let marketCapStats = { total: 0, hasData: 0, missing: 0, sampleValues: [] as Array<{ symbol: string; marketCap: number }> };

      // Pre-fetch market caps from FMP in one batch so FND-1 works even when Finnhub is rate-limited or fails
      let fmpMarketCaps: Map<string, number> = new Map();
      if (hasFundamentalIndicators) {
        try {
          fmpMarketCaps = await fundamentals.fetchMarketCapsBatchFromFMP(tickers);
          if (fmpMarketCaps.size > 0) {
            console.log(`[BigIdea Scan] FMP batch market cap: ${fmpMarketCaps.size}/${tickers.length} symbols`);
          }
        } catch (e) {
          console.warn("[BigIdea Scan] FMP batch market cap failed:", e);
        }
      }

      for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
        const batch = tickers.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(
          batch.map(async (symbol) => {
            try {
              const candlesByTimeframe: Record<string, CandleData[]> = {};
              const fetchTimeframe = async (tf: string): Promise<CandleData[]> => {
                if (!(tf in candlesByTimeframe)) {
                  candlesByTimeframe[tf] = await fetchOHLCV(symbol, tf);
                }
                return candlesByTimeframe[tf];
              };

              if (timeframesNeeded.has("daily")) {
                const dailyCandles = await fetchTimeframe("daily");
                if (dailyCandles.length < 20) {
                  tooFewCandlesCount++;
                  if (timeframesNeeded.size === 1) return null;
                }
              }

              const nodeResults: Record<string, boolean> = {};
              const nodeOutputData: Record<string, Record<string, any>> = {};
              const nodeCriteriaResults: Record<string, CriterionResult[]> = {};
              const effectivelyMutedNodes = new Set<string>();
              const skippedNodes = new Set<string>();

              // Fetch fundamental data if any FND-* indicators are used
              let fundamentalData: any = null;
              
              if (hasFundamentalIndicators) {
                try {
                  // Use getFundamentals only: 1 API call per symbol (profile). Avoid getExtendedFundamentals
                  // here to prevent rate limiting (it does 5 calls/symbol → 125+ concurrent for a batch).
                  const basic = await fundamentals.getFundamentals(symbol);
                  fundamentalData = {
                    ...basic,
                    daysToEarnings: undefined as number | undefined,
                  };

                  // If Finnhub/cache had no market cap, use FMP batch result so FND-1 can still pass
                  const fmpCap = fmpMarketCaps.get(symbol) ?? fmpMarketCaps.get(symbol.toUpperCase());
                  if ((!fundamentalData.marketCap || fundamentalData.marketCap === 0) && fmpCap && fmpCap > 0) {
                    fundamentalData.marketCap = fmpCap;
                  }

                  marketCapStats.total++;
                  if (fundamentalData.marketCap && fundamentalData.marketCap > 0) {
                    marketCapStats.hasData++;
                    if (marketCapStats.sampleValues.length < 5) {
                      marketCapStats.sampleValues.push({ symbol, marketCap: fundamentalData.marketCap });
                    }
                  } else {
                    marketCapStats.missing++;
                    if (marketCapStats.missing <= 10) {
                      console.warn(`[BigIdea Scan] ${symbol}: No market cap (got ${fundamentalData?.marketCap ?? 'undefined'})`);
                    }
                  }
                } catch (error) {
                  marketCapStats.total++;
                  marketCapStats.missing++;
                  console.warn(`[BigIdea Scan] Failed to fetch fundamental data for ${symbol}:`, error);
                  fundamentalData = null;
                }
              }

              for (const node of sortedThoughtNodes) {
                if (skippedNodes.has(node.id)) {
                  nodeResults[node.id] = false;
                  if (funnelData.perThought[node.id]) funnelData.perThought[node.id].skipped++;
                  continue;
                }

                if (node.isMuted) {
                  nodeResults[node.id] = true;
                  effectivelyMutedNodes.add(node.id);
                  if (funnelData.perThought[node.id]) funnelData.perThought[node.id].evaluated++;
                  continue;
                }
                const tf = node.thoughtTimeframe || "daily";
                const candles = await fetchTimeframe(tf);
                const minBars = tf === "daily" ? 20 : 10;
                if (candles.length < minBars) {
                  nodeResults[node.id] = false;
                  const downstream = getTransitiveDownstream(node.id);
                  for (const dId of downstream) skippedNodes.add(dId);
                  continue;
                }

                for (const c of (node.thoughtCriteria || [])) {
                  if (c.timeframeOverride && c.timeframeOverride !== tf) {
                    await fetchTimeframe(c.timeframeOverride);
                  }
                }

                // Use optimizedEdges to respect sequential dependencies from optimizer
                const upstreamNodes = optimizedEdges
                  .filter((e: any) => e.target === node.id)
                  .map((e: any) => e.source)
                  .filter((srcId: string) => thoughtNodes.some((n: any) => n.id === srcId)); // Only thought nodes, not Results
                
                // If this node has upstream dependencies, check if all upstream nodes passed
                // If any upstream node failed, skip this node (sequential filtering)
                if (upstreamNodes.length > 0) {
                  const allUpstreamPassed = upstreamNodes.every((srcId: string) => nodeResults[srcId] === true);
                  if (!allUpstreamPassed) {
                    // At least one upstream node failed, skip this node
                    skippedNodes.add(node.id);
                    nodeResults[node.id] = false;
                    if (funnelData.perThought[node.id]) funnelData.perThought[node.id].skipped++;
                    continue;
                  }
                }
                
                const mergedUpstream: Record<string, any> = {};
                const incomingEdges = optimizedEdges.filter((e: any) => e.target === node.id);
                
                for (const srcId of upstreamNodes) {
                  const srcData = nodeOutputData[srcId];
                  if (srcData) {
                    Object.assign(mergedUpstream, srcData);
                    
                    // Apply link tolerance if specified on the edge
                    const edge = incomingEdges.find((e: any) => e.source === srcId);
                    if (edge?.linkTolerance !== undefined) {
                      mergedUpstream._linkTolerance = edge.linkTolerance;
                      mergedUpstream._linkToleranceType = edge.linkToleranceType || "bars";
                    }
                  }
                }
                
                // Add fundamental data if available (always include if fetched, even if no upstream nodes)
                if (fundamentalData) {
                  mergedUpstream.fundamentalData = fundamentalData;
                }

                const evalStartTime = Date.now();
                const evalResult = evaluateThoughtCriteria(
                  node.thoughtCriteria,
                  candles,
                  spyCandles.length > 0 ? spyCandles : undefined,
                  candlesByTimeframe,
                  // Always pass mergedUpstream if it has any data (including fundamentalData), otherwise undefined
                  Object.keys(mergedUpstream).length > 0 ? mergedUpstream : undefined,
                  mergedIndicatorLibrary
                );
                const evalTimeMs = Date.now() - evalStartTime;

                if (evalResult.allMuted) {
                  effectivelyMutedNodes.add(node.id);
                }
                let passed = evalResult.pass;
                if (node.isNot) passed = !passed;
                nodeResults[node.id] = passed;
                nodeCriteriaResults[node.id] = evalResult.criteriaResults;
                if (funnelData.perThought[node.id]) funnelData.perThought[node.id].evaluated++;
                if (passed) {
                  thoughtCounts[node.id]++;
                  if (funnelData.perThought[node.id]) funnelData.perThought[node.id].passed++;
                } else {
                  if (funnelData.perThought[node.id]) {
                    funnelData.perThought[node.id].failed++;
                    if (funnelData.perThought[node.id].failedTickers.length < 10) {
                      funnelData.perThought[node.id].failedTickers.push(symbol);
                    }
                  }
                  const downstream = getTransitiveDownstream(node.id);
                  for (const dId of downstream) skippedNodes.add(dId);
                }

                for (const cr of evalResult.criteriaResults) {
                  if (!funnelData.perIndicator[cr.indicatorId]) {
                    funnelData.perIndicator[cr.indicatorId] = { name: cr.indicatorName, passed: 0, failed: 0, diagnosticSamples: [] };
                  }
                  const indFunnel = funnelData.perIndicator[cr.indicatorId];
                  const effectivePass = cr.pass;
                  if (effectivePass) {
                    indFunnel.passed++;
                  } else {
                    indFunnel.failed++;
                    if (cr.diagnostics && indFunnel.diagnosticSamples.length < 5) {
                      indFunnel.diagnosticSamples.push({ symbol, value: cr.diagnostics.value, threshold: cr.diagnostics.threshold });
                    }
                  }
                  
                  // Track performance for query optimizer
                  if (indicatorPerformance[cr.indicatorId]) {
                    indicatorPerformance[cr.indicatorId].evaluations++;
                    indicatorPerformance[cr.indicatorId].totalTimeMs += evalTimeMs / evalResult.criteriaResults.length; // Divide time among all indicators
                    if (effectivePass) {
                      indicatorPerformance[cr.indicatorId].passes++;
                    }
                  }
                }
                if (evalResult.outputData && Object.keys(evalResult.outputData).length > 0) {
                  nodeOutputData[node.id] = evalResult.outputData;
                }
              }

              const resultsNode = nodes.find((n: any) => n.type === "results");
              if (!resultsNode) return null;

              const intermediateOrEdges = edges.filter((e: any) => e.logicType === "OR" && e.target !== resultsNode.id);
              if (intermediateOrEdges.length > 0) {
                for (const badEdge of intermediateOrEdges) {
                  const targetNode = badEdge.target;
                  const existingEdgeToResults = edges.find((e: any) => e.source === targetNode && e.target === resultsNode.id);
                  if (existingEdgeToResults) {
                    existingEdgeToResults.logicType = "OR";
                  } else {
                    edges.push({ id: `auto-or-${targetNode}`, source: targetNode, target: resultsNode.id, logicType: "OR" });
                  }
                  badEdge.logicType = "AND";
                }
                const sourceNodes = Array.from(new Set(intermediateOrEdges.map((e: any) => e.source)));
                for (const srcId of sourceNodes) {
                  const hasEdgeToResults = edges.some((e: any) => e.source === srcId && e.target === resultsNode.id);
                  if (!hasEdgeToResults) {
                    edges.push({ id: `auto-and-${srcId}`, source: srcId, target: resultsNode.id, logicType: "AND" });
                  }
                }
              }

              const anyEdgeToResults = edges.some((e: any) => e.target === resultsNode.id);
              if (!anyEdgeToResults) return null;

              const computeEffectivePass = (nodeId: string, visited: Set<string> = new Set()): boolean => {
                if (visited.has(nodeId)) return nodeResults[nodeId] ?? false;
                visited.add(nodeId);

                const incoming = edges.filter((e: any) => e.target === nodeId);
                const ownResult = nodeResults[nodeId];
                const isResultsNode = nodeId === resultsNode.id;

                if (incoming.length === 0) {
                  return ownResult ?? false;
                }

                const andEdges = incoming.filter((e: any) => (e.logicType || "AND") === "AND");
                const orEdges = incoming.filter((e: any) => e.logicType === "OR");

                const copyVisited = () => { const s = new Set<string>(); visited.forEach(v => s.add(v)); return s; };

                const andPass = andEdges.length === 0 || andEdges.every((e: any) =>
                  computeEffectivePass(e.source, copyVisited())
                );

                const activeOrEdges = orEdges.filter((e: any) => !effectivelyMutedNodes.has(e.source));
                let orPass: boolean;
                if (orEdges.length === 0) {
                  orPass = true;
                } else if (activeOrEdges.length === 0) {
                  orPass = true;
                } else {
                  orPass = activeOrEdges.some((e: any) =>
                    computeEffectivePass(e.source, copyVisited())
                  );
                }

                if (isResultsNode) {
                  return andPass && orPass;
                }

                if (ownResult === undefined) {
                  return andPass && orPass;
                }

                return ownResult && andPass && orPass;
              };

              const collectPassedPaths = (nodeId: string, visited: Set<string> = new Set()): string[] => {
                if (visited.has(nodeId)) return [];
                visited.add(nodeId);
                const paths: string[] = [];
                const incoming = edges.filter((e: any) => e.target === nodeId);
                for (const e of incoming) {
                  const srcNode = thoughtNodes.find((n: any) => n.id === e.source);
                  if (srcNode && nodeResults[srcNode.id] === true) {
                    paths.push(srcNode.thoughtName || srcNode.id);
                  }
                  const cvs = new Set<string>(); visited.forEach(v => cvs.add(v));
                  paths.push(...collectPassedPaths(e.source, cvs));
                }
                const unique: string[] = [];
                const seen = new Set<string>();
                for (const p of paths) { if (!seen.has(p)) { seen.add(p); unique.push(p); } }
                return unique;
              };

              const passesFlow = computeEffectivePass(resultsNode.id);
              const passedPaths = passesFlow ? collectPassedPaths(resultsNode.id) : [];

              if (passesFlow) {
                const priceCandles = candlesByTimeframe["daily"] || candlesByTimeframe[timeframesArray[0]] || [];

                const dynamicData: Array<{
                  providerId: string;
                  providerName: string;
                  providerIndicator: string;
                  detectedValues: Record<string, any>;
                  lookbackSetting?: number;
                  lookbackLabel?: string;
                  consumers: Array<{
                    thoughtId: string;
                    thoughtName: string;
                    indicatorName: string;
                    params: Array<{ label: string; dataKey: string; value: any }>;
                  }>;
                }> = [];

                for (const tn of thoughtNodes) {
                  const outData = nodeOutputData[tn.id];
                  if (!outData || Object.keys(outData).length === 0) continue;

                  let providerIndicatorName = "";
                  let lookbackSetting: number | undefined;
                  let lookbackLabel: string | undefined;
                  for (const c of (tn.thoughtCriteria || [])) {
                    const indDef = INDICATOR_LIBRARY.find((ind) => ind.id === c.indicatorId);
                    if (indDef?.provides && indDef.provides.length > 0) {
                      providerIndicatorName = c.label || indDef.name;
                      const provMeta = indDef.provides[0];
                      const lookbackParam = (c.params || []).find((p: any) => p.name === provMeta.paramName);
                      const paramMeta = indDef.params.find((p) => p.name === provMeta.paramName);
                      lookbackSetting = lookbackParam?.value;
                      lookbackLabel = paramMeta?.label;
                      break;
                    }
                  }

                  const consumers: typeof dynamicData[number]["consumers"] = [];
                  const connectedThoughtIds = new Set<string>();
                  for (const e of edges) {
                    if (e.source === tn.id) {
                      const targetNode = thoughtNodes.find((n: any) => n.id === e.target);
                      if (targetNode) connectedThoughtIds.add(targetNode.id);
                    }
                    if (e.target === tn.id) {
                      const sourceNode = thoughtNodes.find((n: any) => n.id === e.source);
                      if (sourceNode) connectedThoughtIds.add(sourceNode.id);
                    }
                  }
                  for (const connId of Array.from(connectedThoughtIds)) {
                    const downNode = thoughtNodes.find((n: any) => n.id === connId);
                    if (!downNode) continue;
                    for (const c of (downNode.thoughtCriteria || [])) {
                      if (c.muted) continue;
                      const indDef = INDICATOR_LIBRARY.find((ind) => ind.id === c.indicatorId);
                      if (!indDef?.consumes) continue;
                      const consumedParams: Array<{ label: string; dataKey: string; value: any }> = [];
                      for (const cons of indDef.consumes) {
                        if (outData[cons.dataKey] !== undefined) {
                          const paramMeta = indDef.params.find((p) => p.name === cons.paramName);
                          consumedParams.push({
                            label: paramMeta?.label || cons.paramName,
                            dataKey: cons.dataKey,
                            value: outData[cons.dataKey],
                          });
                        }
                      }
                      if (consumedParams.length > 0) {
                        consumers.push({
                          thoughtId: downNode.id,
                          thoughtName: downNode.thoughtName || "Unnamed",
                          indicatorName: c.label || indDef.name,
                          params: consumedParams,
                        });
                      }
                    }
                  }

                  dynamicData.push({
                    providerId: tn.id,
                    providerName: tn.thoughtName || "Unnamed",
                    providerIndicator: providerIndicatorName,
                    detectedValues: outData,
                    lookbackSetting,
                    lookbackLabel,
                    consumers,
                  });
                }

                const thoughtBreakdown: Array<{
                  thoughtId: string;
                  thoughtName: string;
                  pass: boolean;
                  criteriaResults: CriterionResult[];
                }> = [];
                for (const tn of thoughtNodes) {
                  thoughtBreakdown.push({
                    thoughtId: tn.id,
                    thoughtName: tn.thoughtName || "Unnamed",
                    pass: nodeResults[tn.id] ?? false,
                    criteriaResults: nodeCriteriaResults[tn.id] || [],
                  });
                }

                return {
                  symbol,
                  name: symbol,
                  price: priceCandles.length > 0 ? priceCandles[0].close : 0,
                  passedPaths,
                  dynamicData: dynamicData.length > 0 ? dynamicData : undefined,
                  thoughtBreakdown,
                };
              }

              return null;
            } catch (err: any) {
              fetchFailCount++;
              if (fetchFailCount <= 3) console.error(`[BigIdea Scan] Fetch error for ${symbol}:`, err?.message || err);
              return null;
            }
          })
        );

        for (const r of batchResults) {
          if (r) results.push(r);
        }
      }

      // Log market cap statistics if FND indicators were used
      if (hasFundamentalIndicators && marketCapStats.total > 0) {
        console.log(`[BigIdea Scan] Market Cap Data Summary: ${marketCapStats.hasData}/${marketCapStats.total} stocks have market cap data (${marketCapStats.missing} missing)`);
        if (marketCapStats.sampleValues.length > 0) {
          const sampleStr = marketCapStats.sampleValues.map(s => `${s.symbol}: $${(s.marketCap / 1e9).toFixed(1)}B`).join(', ');
          console.log(`[BigIdea Scan] Sample market caps: ${sampleStr}`);
        }
        if (marketCapStats.missing > 0) {
          console.warn(`[BigIdea Scan] ⚠️  ${marketCapStats.missing} stocks missing market cap data - FND-1 filter will exclude them`);
        }
      }

      const dynamicDataFlows: Array<{ provider: string; consumer: string; dataKey: string; description: string }> = [];
      for (const tn of thoughtNodes) {
        for (const c of (tn.thoughtCriteria || [])) {
          if (c.muted) continue;
          const indDef = INDICATOR_LIBRARY.find((ind) => ind.id === c.indicatorId);
          if (!indDef?.consumes) continue;
          for (const cons of indDef.consumes) {
            const upstreamIds = edges.filter((e: any) => e.target === tn.id).map((e: any) => e.source);
            for (const srcId of upstreamIds) {
              const srcNode = thoughtNodes.find((n: any) => n.id === srcId);
              if (!srcNode) continue;
              for (const sc of (srcNode.thoughtCriteria || [])) {
                const srcInd = INDICATOR_LIBRARY.find((ind) => ind.id === sc.indicatorId);
                if (!srcInd?.provides) continue;
                if (srcInd.provides.length > 0) {
                  dynamicDataFlows.push({
                    provider: `${srcNode.thoughtName || "Unnamed"} (${srcInd.name})`,
                    consumer: `${tn.thoughtName || "Unnamed"} (${indDef.name})`,
                    dataKey: cons.dataKey,
                    description: `${cons.paramName} uses per-stock ${cons.dataKey} from upstream`,
                  });
                }
              }
            }
          }
        }
      }

      funnelData.fetchFails = fetchFailCount;
      funnelData.tooFewCandles = tooFewCandlesCount;

      console.log(`[BigIdea Scan] Complete: ${results.length} results from ${tickers.length} tickers (fetchFails=${fetchFailCount}, tooFewCandles=${tooFewCandlesCount})`);
      console.log(`[BigIdea Scan] ThoughtCounts:`, JSON.stringify(thoughtCounts));
      if (dynamicDataFlows.length > 0) {
        console.log(`[BigIdea Scan] Dynamic data flows:`, dynamicDataFlows.map(d => `${d.provider} → ${d.consumer}: ${d.dataKey}`));
      }

      let sessionId: number | undefined;
      if (userId && isDatabaseAvailable() && db) {
        try {
          const resultSymbols = results.map((r: any) => r.symbol);
          const [session] = await db
            .insert(scanSessions)
            .values({
              userId,
              ideaId: ideaId ? parseInt(String(ideaId)) : undefined,
              scanConfig: { nodes, edges, universe },
              resultCount: results.length,
              resultSymbols,
              funnelData,
            })
            .returning();
          sessionId = session.id;
          console.log(`[BigIdea Scan] Session ${sessionId} created with ${results.length} results`);

          // Rule 2: Score non-muted thoughts when scan returned results
          if (results.length > 0) {
            try {
              const rules = await getScoreRulesMap();
              const rule = rules["scan_returned_data"];
              if (rule?.enabled && rule.scoreValue !== 0) {
                const nonMutedThoughtIds = nodes
                  .filter((n: any) => n.type === "thought" && n.thoughtId && !n.isMuted)
                  .map((n: any) => n.thoughtId as number);
                if (nonMutedThoughtIds.length > 0) {
                  await applyScoreToThoughts(nonMutedThoughtIds, rule.scoreValue);
                }
              }
            } catch (scoreErr) {
              console.error("[BigIdea Scan] Error scoring thoughts for results:", scoreErr);
            }
          }
        } catch (err: any) {
          console.error("[BigIdea Scan] Failed to create session:", err?.message);
        }
      }

      // Record performance metrics for query optimizer learning (async, don't block response)
      (async () => {
        try {
          let marketRegime: any = undefined;
          try {
            const sentiment = await fetchMarketSentiment();
            marketRegime = buildMarketRegimeSnapshot(sentiment);
          } catch (e) {
            // Ignore sentiment fetch errors
          }
          
          for (const [indicatorId, perf] of Object.entries(indicatorPerformance)) {
            if (perf.evaluations > 0) {
              await recordThoughtPerformance(indicatorId, {
                executionTimeMs: perf.totalTimeMs / perf.evaluations,
                passed: perf.passes,
                evaluated: perf.evaluations,
                universe: universe || 'unknown',
                marketRegime,
                timeframe: thoughtNodes[0]?.thoughtTimeframe || 'daily',
              });
            }
          }
        } catch (error) {
          console.error('[QueryOptimizer] Failed to record performance metrics:', error);
        }
      })();

      // Enhanced debug info for troubleshooting
      // Fetch idea-level info (name, description)
      let ideaInfo: { name: string; description: string | null } | null = null;
      if (ideaId && isDatabaseAvailable() && db) {
        try {
          const [idea] = await db
            .select({ name: scannerIdeas.name, description: scannerIdeas.description })
            .from(scannerIdeas)
            .where(eq(scannerIdeas.id, ideaId))
            .limit(1);
          if (idea) {
            ideaInfo = { name: idea.name, description: idea.description };
          }
        } catch (err) {
          console.error('[BigIdea Scan] Failed to fetch idea info:', err);
        }
      }
      
      // Fetch per-thought aiPrompt from scanner_thoughts (the original user prompts)
      const thoughtPrompts: Map<number, { aiPrompt: string | null; description: string | null }> = new Map();
      const thoughtIdsFromNodes = nodes
        .filter((n: any) => n.type === "thought" && n.thoughtId)
        .map((n: any) => n.thoughtId as number);
      
      if (thoughtIdsFromNodes.length > 0 && isDatabaseAvailable() && db) {
        try {
          const thoughts = await db
            .select({ id: scannerThoughts.id, aiPrompt: scannerThoughts.aiPrompt, description: scannerThoughts.description })
            .from(scannerThoughts)
            .where(inArray(scannerThoughts.id, thoughtIdsFromNodes));
          for (const t of thoughts) {
            thoughtPrompts.set(t.id, { aiPrompt: t.aiPrompt, description: t.description });
          }
        } catch (err) {
          console.error('[BigIdea Scan] Failed to fetch thought prompts:', err);
        }
      }

      const enhancedDebugInfo = {
        // Idea-level info
        ideaName: ideaInfo?.name || null,
        ideaDescription: ideaInfo?.description || null,
        
        // Canvas layout
        thoughtNodes: sortedThoughtNodes.map((n: any) => {
          const thoughtData = n.thoughtId ? thoughtPrompts.get(n.thoughtId) : null;
          return {
            id: n.id,
            thoughtId: n.thoughtId || null,
            name: n.thoughtName,
            timeframe: n.thoughtTimeframe,
            muted: n.isMuted,
            aiPrompt: thoughtData?.aiPrompt || null,
            description: thoughtData?.description || null,
            criteria: (n.thoughtCriteria || []).map((c: any) => {
              const ind = INDICATOR_LIBRARY.find((i) => i.id === c.indicatorId);
              return {
                indicatorId: c.indicatorId,
                indicatorName: ind?.name || 'Unknown',
                label: c.label,
                muted: c.muted,
                inverted: c.inverted,
                params: c.params
              };
            })
          };
        }),
        edges: optimizedEdges.map((e: any) => ({
          source: e.source,
          target: e.target,
          logic: e.logicType
        })),
        evalOrder: sortedThoughtNodes.map((n: any) => n.thoughtName),
        
        // Full criteria with descriptions
        fullCriteria: sortedThoughtNodes.map((n: any) => {
          const thoughtData = n.thoughtId ? thoughtPrompts.get(n.thoughtId) : null;
          return {
            thought: n.thoughtName,
            timeframe: n.thoughtTimeframe,
            aiPrompt: thoughtData?.aiPrompt || null,
            criteria: (n.thoughtCriteria || []).map((c: any) => {
              const ind = INDICATOR_LIBRARY.find((i) => i.id === c.indicatorId);
              return {
                id: c.indicatorId,
                name: ind?.name || 'Unknown',
                description: ind?.description || '',
                category: ind?.category || '',
                params: c.params
              };
            })
          };
        })
      };

      res.json({ results, thoughtCounts, linkOverrides, dynamicDataFlows, funnelData, sessionId, debugInfo: enhancedDebugInfo });
    } catch (error) {
      console.error("Error executing scan:", error);
      res.status(500).json({ error: "Failed to execute scan" });
    }
  });

  app.post("/api/bigidea/favorites", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      if (!isDatabaseAvailable() || !db) {
        return res.status(500).json({ error: "Database not available" });
      }

      const { ideaId, symbol } = req.body;
      if (!ideaId || !symbol) {
        return res.status(400).json({ error: "ideaId and symbol are required" });
      }

      const [favorite] = await db
        .insert(scannerFavorites)
        .values({ userId, ideaId, symbol })
        .returning();

      res.status(201).json(favorite);
    } catch (error) {
      console.error("Error adding favorite:", error);
      res.status(500).json({ error: "Failed to add favorite" });
    }
  });

  app.get("/api/bigidea/favorites/:ideaId", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      if (!isDatabaseAvailable() || !db) {
        return res.status(500).json({ error: "Database not available" });
      }

      const ideaId = parseInt(String(req.params.ideaId));
      if (isNaN(ideaId)) return res.status(400).json({ error: "Invalid ideaId" });

      const favorites = await db
        .select()
        .from(scannerFavorites)
        .where(and(eq(scannerFavorites.ideaId, ideaId), eq(scannerFavorites.userId, userId)));

      res.json(favorites);
    } catch (error) {
      console.error("Error fetching favorites:", error);
      res.status(500).json({ error: "Failed to fetch favorites" });
    }
  });

  app.delete("/api/bigidea/favorites/:id", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      if (!isDatabaseAvailable() || !db) {
        return res.status(500).json({ error: "Database not available" });
      }

      const id = parseInt(String(req.params.id));
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

      const deleted = await db
        .delete(scannerFavorites)
        .where(and(eq(scannerFavorites.id, id), eq(scannerFavorites.userId, userId)))
        .returning();

      if (deleted.length === 0) {
        return res.status(404).json({ error: "Favorite not found" });
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting favorite:", error);
      res.status(500).json({ error: "Failed to delete favorite" });
    }
  });

  // === CHART RATING ENDPOINTS ===

  app.post("/api/bigidea/chart-rating", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      if (!isDatabaseAvailable() || !db) return res.status(500).json({ error: "Database not available" });

      const { symbol, rating, ideaId, sessionId, scanConfig, indicatorSnapshot, price, ratingType, trainingMode, sourceSetupId } = req.body;
      if (!symbol || !rating || !["up", "down"].includes(rating)) {
        return res.status(400).json({ error: "symbol and rating ('up'|'down') are required" });
      }

      const [record] = await db
        .insert(scanChartRatings)
        .values({
          userId,
          symbol,
          rating,
          ideaId: ideaId || null,
          sessionId: sessionId || null,
          scanConfig: scanConfig || null,
          indicatorSnapshot: indicatorSnapshot || null,
          price: price || null,
          ratingType: ratingType || "user",
          trainingMode: trainingMode || false,
          sourceSetupId: sourceSetupId || null,
        })
        .returning();

      // Rule 3: Score thoughts on chart thumbs-up/down
      if (ideaId) {
        try {
          const rules = await getScoreRulesMap();
          const ruleKey = rating === "up" ? "chart_thumbs_up" : "chart_thumbs_down";
          const rule = rules[ruleKey];
          if (rule?.enabled && rule.scoreValue !== 0) {
            const idea = await db.select().from(scannerIdeas).where(eq(scannerIdeas.id, ideaId));
            if (idea.length > 0) {
              const ideaNodes = idea[0].nodes as any[];
              const nonMutedThoughtIds = ideaNodes
                .filter((n: any) => n.type === "thought" && n.thoughtId && !n.isMuted)
                .map((n: any) => n.thoughtId as number);
              if (nonMutedThoughtIds.length > 0) {
                await applyScoreToThoughts(nonMutedThoughtIds, rule.scoreValue);
              }
            }
          }
        } catch (scoreErr) {
          console.error("Error scoring thoughts for chart rating:", scoreErr);
        }
      }

      res.status(201).json(record);
    } catch (error) {
      console.error("Error saving chart rating:", error);
      res.status(500).json({ error: "Failed to save chart rating" });
    }
  });

  app.get("/api/bigidea/chart-ratings/summary", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      if (!isDatabaseAvailable() || !db) return res.status(500).json({ error: "Database not available" });

      const rawIdeaId = req.query.ideaId ? parseInt(String(req.query.ideaId)) : undefined;
      const ideaId = rawIdeaId !== undefined && !isNaN(rawIdeaId) ? rawIdeaId : undefined;

      const conditions = [eq(scanChartRatings.userId, userId)];
      if (ideaId !== undefined) conditions.push(eq(scanChartRatings.ideaId, ideaId));

      const ratings = await db
        .select({
          rating: scanChartRatings.rating,
          count: sql<number>`count(*)::int`,
        })
        .from(scanChartRatings)
        .where(conditions.length > 1 ? and(...conditions) : conditions[0])
        .groupBy(scanChartRatings.rating);

      const upCount = ratings.find(r => r.rating === "up")?.count || 0;
      const downCount = ratings.find(r => r.rating === "down")?.count || 0;

      res.json({ up: upCount, down: downCount, total: upCount + downCount });
    } catch (error) {
      console.error("Error fetching chart rating summary:", error);
      res.status(500).json({ error: "Failed to fetch chart ratings" });
    }
  });

  // === CHART RATINGS FOR SESSION ===
  app.get("/api/bigidea/chart-ratings-for-session", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      if (!isDatabaseAvailable() || !db) return res.status(500).json({ error: "Database not available" });

      const sessionId = req.query.sessionId ? parseInt(String(req.query.sessionId)) : undefined;
      if (!sessionId || isNaN(sessionId)) return res.json([]);

      const ratings = await db
        .select()
        .from(scanChartRatings)
        .where(
          and(
            eq(scanChartRatings.userId, userId),
            eq(scanChartRatings.sessionId, sessionId)
          )
        );

      res.json(ratings);
    } catch (error) {
      console.error("Error fetching session ratings:", error);
      res.status(500).json({ error: "Failed to fetch session ratings" });
    }
  });

  // === AI SCAN TUNING ENDPOINT ===

  app.post("/api/bigidea/scan-tune", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      if (!isDatabaseAvailable() || !db) return res.status(500).json({ error: "Database not available" });

      const user = await db.select().from(sentinelUsers).where(eq(sentinelUsers.id, userId)).limit(1);
      const userTier = user[0]?.tier || "standard";
      if (userTier !== "pro" && userTier !== "admin" && !user[0]?.isAdmin) {
        return res.status(403).json({ error: "Scan tuning requires Pro or Admin tier" });
      }

      const openai = getOpenAI();
      if (!openai) return res.status(500).json({ error: "AI service not available" });

      const { nodes, edges, funnelData, resultCount, universe, ratings, userInstruction, sessionId } = req.body;
      if (!nodes || !funnelData) {
        return res.status(400).json({ error: "nodes and funnelData are required" });
      }

      const thoughtNodes = nodes.filter((n: any) => n.type === "thought" && (n.thoughtCriteria || n.isMuted));

      const indicatorMeta: Array<{ id: string; name: string; category: string; currentParams: any[]; bounds: any[] }> = [];
      for (const tn of thoughtNodes) {
        for (const c of (tn.thoughtCriteria || [])) {
          if (c.muted) continue;
          const indDef = INDICATOR_LIBRARY.find((ind) => ind.id === c.indicatorId);
          if (!indDef) continue;
          const currentParams = (c.params || []).map((p: any) => ({
            name: p.name,
            value: p.value,
            autoLinked: !!p.autoLinked,
          }));
          const bounds = indDef.params.map(p => ({
            name: p.name,
            label: p.label,
            min: p.min,
            max: p.max,
            step: p.step,
            defaultValue: p.defaultValue,
          }));
          indicatorMeta.push({
            id: c.indicatorId,
            name: c.label || indDef.name,
            category: indDef.category,
            currentParams,
            bounds,
          });
        }
      }

      const ratingSummary = ratings
        ? `User has rated ${ratings.up || 0} charts thumbs-up and ${ratings.down || 0} charts thumbs-down from this scan.`
        : "No chart ratings available yet.";

      let learningContext = "";
      try {
        const indIds = indicatorMeta.map((m: any) => m.id);
        if (indIds.length > 0) {
          const summaries = await db.select().from(indicatorLearningSummary)
            .where(sql`${indicatorLearningSummary.indicatorId} = ANY(${indIds})`);

          let currentRegime: any = null;
          try {
            const sentiment = await fetchMarketSentiment();
            currentRegime = buildMarketRegimeSnapshot(sentiment);
          } catch (_) {}

          const currentRegimeKey = currentRegime
            ? `${currentRegime.weeklyTrend}/${currentRegime.dailyBasket}` : null;

          const lines: string[] = [];
          for (const summary of summaries) {
            const indName = summary.indicatorName || summary.indicatorId;
            lines.push(`\n--- ${indName} (${summary.indicatorId}) [ALL-TIME SUMMARY] ---`);
            lines.push(`Total: ${summary.totalAccepted} accepted, ${summary.totalDiscarded} discarded`);

            const ps = (summary.paramStats as Record<string, any>) || {};
            for (const [param, st] of Object.entries(ps)) {
              lines.push(`  ${param}: tightened ${st.tightened}x, loosened ${st.loosened}x, avg accepted: ${Number(st.avgAccepted).toFixed(3)}, last: ${Number(st.lastAccepted).toFixed(3)}`);
            }

            if (summary.avgRetentionRate != null) {
              lines.push(`  Overall thumbs-up retention: ${(summary.avgRetentionRate * 100).toFixed(0)}%`);
            }

            if (currentRegimeKey && summary.regimePerformance) {
              const rp = (summary.regimePerformance as Record<string, any>)[currentRegimeKey];
              if (rp) {
                lines.push(`  CURRENT REGIME (${currentRegimeKey}): ${rp.accepted} accepted sessions, retention: ${rp.retention != null ? (rp.retention * 100).toFixed(0) + "%" : "N/A"}`);
              }
            }

            if (universe && summary.universePerformance) {
              const up = (summary.universePerformance as Record<string, any>)[universe];
              if (up) {
                lines.push(`  CURRENT UNIVERSE (${universe}): ${up.accepted} accepted, retention: ${up.avgRetention != null ? (up.avgRetention * 100).toFixed(0) + "%" : "N/A"}`);
              }
            }

            const archetypes = extractArchetypeTags(thoughtNodes.map((tn: any) => tn.thoughtName || tn.id));
            if (archetypes.length > 0 && summary.archetypePerformance) {
              const ap = summary.archetypePerformance as Record<string, any>;
              for (const tag of archetypes) {
                if (ap[tag]) {
                  lines.push(`  ARCHETYPE (${tag}): ${ap[tag].accepted} accepted, retention: ${ap[tag].retention != null ? (ap[tag].retention * 100).toFixed(0) + "%" : "N/A"}`);
                }
              }
            }

            if (summary.avoidParams) {
              lines.push(`  AVOID PARAMS: ${JSON.stringify(summary.avoidParams)}`);
            }
          }

          const recentHistory = await db
            .select()
            .from(scanTuningHistory)
            .where(
              and(
                sql`${scanTuningHistory.outcome} IS NOT NULL`,
                sql`${scanTuningHistory.adminApproved} IS NOT FALSE`
              )
            )
            .orderBy(sql`${scanTuningHistory.createdAt} DESC`)
            .limit(30);

          for (const h of recentHistory) {
            const appliedSuggs = (h.acceptedSuggestions as any[]) || [];
            const relevantSuggs = appliedSuggs.filter((s: any) => indIds.includes(s.indicatorId));
            if (relevantSuggs.length === 0) continue;
            const retained = (h.retainedUpSymbols || []).length;
            const dropped = (h.droppedUpSymbols || []).length;
            const ret = retained + dropped > 0 ? `${(retained / (retained + dropped) * 100).toFixed(0)}%` : "N/A";
            lines.push(`\n[RECENT ${h.outcome?.toUpperCase()}] regime=${JSON.stringify(h.marketRegime)}, universe=${h.universe}, retention=${ret}`);
            for (const s of relevantSuggs) {
              lines.push(`  ${s.indicatorId}.${s.paramName}: ${s.currentValue} → ${s.suggestedValue}`);
            }
          }

          if (lines.length > 0) {
            learningContext = `\n\nHISTORICAL LEARNING DATA (all-time summaries + recent sessions, bucketed by market regime, universe, archetype):\n${lines.join("\n")}`;
          }
        }
      } catch (histErr) {
        console.warn("[Tuning] Failed to fetch learning context:", histErr);
      }

      const systemPrompt = `You are a stock scanner tuning assistant. Analyze the scan configuration and failure funnel data to suggest parameter adjustments, criterion additions, or criterion removals that will improve scan results quality.

CRITICAL CONSTRAINT — INDICATOR EXISTENCE:
- "param_change" suggestions can ONLY reference indicators that exist in "Indicator metadata with current params" — these are the ONLY indicators currently on the canvas
- Do NOT suggest param_change for indicators not in that list — the user doesn't have them on their canvas
- If you want to suggest a new indicator, use "add_criterion" instead

RULES:
- Never suggest changing auto-linked parameters (marked autoLinked: true) — they are dynamically set per-stock
- All suggested param values MUST be within the min/max bounds provided
- Suggest at most 7 changes total (param_change + add_criterion + remove_criterion combined)
- Focus on the indicators that reject the most stocks (highest rejection rate)
- Use diagnostic samples to understand WHY stocks are being rejected
- If the scan produces too few results, suggest loosening the tightest filters or removing overly restrictive criteria
- If too many results, suggest tightening the weakest filters or adding new filtering criteria
- Consider the user's chart ratings when available
- When historical learning data is available, use it to inform your suggestions — prefer parameter directions and values that led to accepted sessions and good thumbs-up retention
- Pay special attention to CURRENT REGIME, CURRENT UNIVERSE, and ARCHETYPE sections — these show how parameters performed in conditions similar to right now
- If a regime or archetype shows low retention, consider adjusting parameters differently than all-time averages suggest
- AVOID suggesting parameter changes that were previously discarded by users or listed in AVOID PARAMS
- For add_criterion: suggest an indicator from the "Available indicators NOT currently on canvas" list that would complement the existing scan. Include the indicatorId, indicatorName, and a full criterion object with default params
- For remove_criterion: suggest removing a criterion that is overly restrictive or redundant. Specify which thought/node contains it via thoughtId

USER INSTRUCTION HANDLING:
When the user provides a specific instruction, prioritize their request over generic funnel analysis.

CRITICAL: If the user asks to ADD something or describes a filter that IS NOT in "Indicator metadata with current params", you MUST use "add_criterion" (not "param_change"). 
- "param_change" = ONLY for adjusting existing params on indicators ALREADY on the canvas
- "add_criterion" = for adding NEW indicators that aren't on the canvas yet

Common add requests and their indicators:
- "add price above/below X SMA" → add_criterion with MA-1 (SMA Value), direction: above/below, period: X
- "add price above/below X EMA" → add_criterion with MA-2 (EMA Value), direction: above/below, period: X  
- "add price crossed above/below X MA" → add_criterion with MA-9 (Price Crosses MA)
- "add RSI above/below X" or "RSI filter" → add_criterion with RS-4 (RSI Range)
- "add volume surge" or "high volume" → add_criterion with VOL-5 (Volume Spike)
- "add near 52-week high" → add_criterion with PA-6 (Distance from 52-Week High)
- "add MA slope" or "rising MA" → add_criterion with MA-4 (MA Slope)

When creating add_criterion, include thoughtId (pick the first thought node) and a full criterion object with appropriate params.

SUGGESTION TYPES:
1. "param_change" — adjust a parameter value on an existing criterion
2. "add_criterion" — add a new criterion to an existing thought node (provide the full criterion object)
3. "remove_criterion" — remove an existing criterion from a thought node

Return a JSON object with this exact structure:
{
  "suggestions": [
    {
      "type": "param_change",
      "indicatorId": "string",
      "indicatorName": "string",
      "paramName": "string",
      "currentValue": number,
      "suggestedValue": number,
      "reason": "string (1-2 sentences explaining the change)"
    },
    {
      "type": "add_criterion",
      "indicatorId": "string",
      "indicatorName": "string",
      "thoughtId": "string (the node id to add to)",
      "criterion": { "indicatorId": "string", "label": "string", "params": [...] },
      "reason": "string (1-2 sentences explaining why this criterion helps)"
    },
    {
      "type": "remove_criterion",
      "indicatorId": "string",
      "indicatorName": "string",
      "thoughtId": "string (the node id containing the criterion)",
      "reason": "string (1-2 sentences explaining why this criterion should be removed)"
    }
  ],
  "overallAnalysis": "string (2-3 sentences about the scan's filtering behavior)"
}`;

      const usedIndicatorIds = new Set(indicatorMeta.map(m => m.id));
      const availableIndicators = INDICATOR_LIBRARY
        .filter(ind => !usedIndicatorIds.has(ind.id))
        .map(ind => ({
          id: ind.id,
          name: ind.name,
          category: ind.category,
          params: ind.params.map(p => ({ name: p.name, label: p.label, type: p.type, defaultValue: p.defaultValue, min: p.min, max: p.max, step: p.step, options: p.options })),
        }));

      const thoughtNodeSummary = thoughtNodes.map((tn: any) => ({
        nodeId: tn.id,
        thoughtName: tn.thoughtName || tn.label || tn.id,
        criteria: (tn.thoughtCriteria || []).map((c: any) => ({ indicatorId: c.indicatorId, label: c.label })),
      }));

      const userMessage = `Scan configuration:
Universe: ${universe || "unknown"} (${funnelData.totalTickers} tickers)
Results found: ${resultCount || 0}

Thought nodes on canvas (use nodeId for thoughtId in add/remove suggestions):
${JSON.stringify(thoughtNodeSummary, null, 2)}

Indicator metadata with current params and bounds:
${JSON.stringify(indicatorMeta, null, 2)}

Available indicators NOT currently on canvas (for add_criterion suggestions):
${JSON.stringify(availableIndicators.slice(0, 20), null, 2)}

Failure funnel per indicator:
${JSON.stringify(funnelData.perIndicator, null, 2)}

Failure funnel per thought:
${JSON.stringify(funnelData.perThought, null, 2)}

${ratingSummary}${learningContext}

${userInstruction ? `User's specific instruction: "${userInstruction}"` : "No specific instruction — analyze the funnel data and suggest the most impactful improvements."}`;

      const completion = await openai.chat.completions.create({
        model: "gpt-5.1",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
        max_completion_tokens: 2500,
      });

      const responseText = completion.choices[0]?.message?.content || "{}";
      let aiResult: any;
      try {
        aiResult = JSON.parse(responseText);
      } catch {
        aiResult = { suggestions: [], overallAnalysis: "Failed to parse AI response" };
      }

      if (aiResult.suggestions && Array.isArray(aiResult.suggestions)) {
        aiResult.suggestions = aiResult.suggestions.filter((s: any) => {
          if (!s.indicatorId) return false;
          s.type = s.type || "param_change";
          s.reason = s.reason || "Suggested by AI";

          if (s.type === "param_change") {
            if (!s.paramName || s.suggestedValue === undefined) return false;
            const val = Number(s.suggestedValue);
            if (isNaN(val)) return false;
            s.suggestedValue = val;

            const indMeta = indicatorMeta.find(m => m.id === s.indicatorId);
            if (!indMeta) {
              console.warn(`[Tuning] Filtered out param_change for ${s.indicatorId} - indicator not on canvas`);
              return false;
            }
            const param = indMeta.currentParams.find((p: any) => p.name === s.paramName);
            if (!param) {
              console.warn(`[Tuning] Filtered out param_change for ${s.indicatorId}.${s.paramName} - param not found on this indicator`);
              return false;
            }
            if (param.autoLinked) return false;
            const bound = indMeta.bounds.find((b: any) => b.name === s.paramName);
            if (bound) {
              s.suggestedValue = Math.max(bound.min, Math.min(bound.max, s.suggestedValue));
              if (bound.step && bound.step >= 1) {
                s.suggestedValue = Math.round(s.suggestedValue / bound.step) * bound.step;
              }
            }
            s.currentValue = param?.value ?? s.currentValue;
            s.indicatorName = s.indicatorName || indMeta.name;
            return true;
          }

          if (s.type === "add_criterion") {
            const indDef = INDICATOR_LIBRARY.find(ind => ind.id === s.indicatorId);
            if (!indDef) return false;
            s.indicatorName = s.indicatorName || indDef.name;
            if (!s.criterion) {
              s.criterion = {
                indicatorId: indDef.id,
                label: indDef.name,
                params: indDef.params.map(p => ({
                  name: p.name,
                  label: p.label,
                  type: p.type,
                  value: p.defaultValue,
                  min: p.min,
                  max: p.max,
                  step: p.step,
                  options: p.options,
                })),
              };
            }
            if (!s.thoughtId) {
              s.thoughtId = thoughtNodes[0]?.id || null;
            }
            return !!s.thoughtId;
          }

          if (s.type === "remove_criterion") {
            s.indicatorName = s.indicatorName || s.indicatorId;
            if (!s.thoughtId) {
              const matchNode = thoughtNodes.find((tn: any) =>
                (tn.thoughtCriteria || []).some((c: any) => c.indicatorId === s.indicatorId)
              );
              s.thoughtId = matchNode?.id || null;
            }
            return !!s.thoughtId;
          }

          return false;
        });
      } else {
        aiResult.suggestions = [];
      }

      const thoughtNodeNames = thoughtNodes.map((tn: any) => tn.thoughtName || tn.id);
      const archetypeTags = extractArchetypeTags(thoughtNodeNames);

      let marketRegime = null;
      try {
        const sentiment = await fetchMarketSentiment();
        marketRegime = buildMarketRegimeSnapshot(sentiment);
      } catch (e) {
        console.warn("[Tuning] Failed to fetch market regime:", e);
      }

      const [historyRecord] = await db
        .insert(scanTuningHistory)
        .values({
          userId,
          sessionId: sessionId || null,
          scanConfig: { nodes, edges, universe },
          funnelData,
          aiSuggestions: aiResult,
          resultCountBefore: resultCount || 0,
          thoughtsInvolved: thoughtNodeNames,
          universe: universe || null,
          archetypeTags: archetypeTags.length > 0 ? archetypeTags : null,
          marketRegime,
        })
        .returning();

      res.json({ ...aiResult, tuningId: historyRecord.id });
    } catch (error) {
      console.error("Error in scan tuning:", error);
      res.status(500).json({ error: "Failed to generate scan tuning suggestions" });
    }
  });

  app.patch("/api/bigidea/scan-tune/:id/feedback", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      if (!isDatabaseAvailable() || !db) return res.status(500).json({ error: "Database not available" });

      const id = parseInt(String(req.params.id));
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

      const { feedback, acceptedSuggestions, resultCountAfter } = req.body;

      const updated = await db
        .update(scanTuningHistory)
        .set({
          userFeedback: feedback || null,
          acceptedSuggestions: acceptedSuggestions || null,
          resultCountAfter: resultCountAfter || null,
        })
        .where(and(eq(scanTuningHistory.id, id), eq(scanTuningHistory.userId, userId)))
        .returning();

      if (updated.length === 0) return res.status(404).json({ error: "Tuning record not found" });
      res.json(updated[0]);
    } catch (error) {
      console.error("Error updating tuning feedback:", error);
      res.status(500).json({ error: "Failed to update feedback" });
    }
  });

  // === TUNING COMMIT ENDPOINT ===
  app.patch("/api/bigidea/scan-tune/:id/commit", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      if (!isDatabaseAvailable() || !db) return res.status(500).json({ error: "Database not available" });

      const id = parseInt(String(req.params.id));
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

      const {
        outcome,
        acceptedSuggestions,
        skippedSuggestions,
        configBefore,
        configAfter,
        resultCountAfter,
        retainedUpSymbols,
        droppedUpSymbols,
        droppedDownSymbols,
        retainedDownSymbols,
        newSymbols,
        ratingsCount,
      } = req.body;

      if (!outcome || !["accepted", "discarded"].includes(outcome)) {
        return res.status(400).json({ error: "outcome must be 'accepted' or 'discarded'" });
      }

      const user = await db.select().from(sentinelUsers).where(eq(sentinelUsers.id, userId)).limit(1);
      const userTier = user[0]?.tier || "standard";
      const isAdmin = userTier === "admin" || !!user[0]?.isAdmin;
      const adminApproved = isAdmin ? true : null;

      const accepted = (acceptedSuggestions || []) as any[];
      const totalSuggested = accepted.length + ((skippedSuggestions || []) as any[]).length;
      const acceptanceRatio = totalSuggested > 0 ? accepted.length / totalSuggested : 0;

      const tuningDirections: Record<string, { direction: string; params: string[] }> = {};
      for (const s of accepted) {
        if (!tuningDirections[s.indicatorId]) tuningDirections[s.indicatorId] = { direction: "unchanged", params: [] };
        const td = tuningDirections[s.indicatorId];
        td.params.push(s.paramName);
        if (Number(s.suggestedValue) < Number(s.currentValue)) td.direction = "tightened";
        else if (Number(s.suggestedValue) > Number(s.currentValue)) td.direction = td.direction === "tightened" ? "mixed" : "loosened";
      }

      const updated = await db
        .update(scanTuningHistory)
        .set({
          outcome,
          acceptedSuggestions: acceptedSuggestions || null,
          skippedSuggestions: skippedSuggestions || null,
          configBefore: configBefore || null,
          configAfter: configAfter || null,
          resultCountAfter: resultCountAfter ?? null,
          retainedUpSymbols: retainedUpSymbols || null,
          droppedUpSymbols: droppedUpSymbols || null,
          droppedDownSymbols: droppedDownSymbols || null,
          retainedDownSymbols: retainedDownSymbols || null,
          newSymbols: newSymbols || null,
          ratingsCount: ratingsCount ?? null,
          adminApproved,
          tuningDirections: Object.keys(tuningDirections).length > 0 ? tuningDirections : null,
          acceptanceRatio,
        })
        .where(and(eq(scanTuningHistory.id, id), eq(scanTuningHistory.userId, userId)))
        .returning();

      if (updated.length === 0) return res.status(404).json({ error: "Tuning record not found" });

      if (outcome === "accepted" && adminApproved) {
        try {
          await upsertIndicatorLearningSummary(updated[0]);
        } catch (e) {
          console.warn("[Tuning] Failed to update learning summary:", e);
        }
      }

      res.json(updated[0]);
    } catch (error) {
      console.error("Error committing tuning:", error);
      res.status(500).json({ error: "Failed to commit tuning" });
    }
  });

  // === TUNING HISTORY FOR AI CONTEXT (Phase 3 - Hybrid) ===
  app.get("/api/bigidea/scan-tune/history/:indicatorIds", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      if (!isDatabaseAvailable() || !db) return res.status(500).json({ error: "Database not available" });

      const rawIds = req.params.indicatorIds;
      const indicatorIds = (Array.isArray(rawIds) ? rawIds.join(",") : rawIds).split(",").filter(Boolean);
      if (indicatorIds.length === 0) return res.json({ history: {}, summaries: {} });

      const summaries = await db.select().from(indicatorLearningSummary)
        .where(sql`${indicatorLearningSummary.indicatorId} = ANY(${indicatorIds})`);

      const summaryMap: Record<string, any> = {};
      for (const s of summaries) {
        summaryMap[s.indicatorId] = {
          indicatorId: s.indicatorId,
          indicatorName: s.indicatorName,
          totalAccepted: s.totalAccepted,
          totalDiscarded: s.totalDiscarded,
          paramStats: s.paramStats,
          avgRetentionRate: s.avgRetentionRate,
          avgResultDelta: s.avgResultDelta,
          regimePerformance: s.regimePerformance,
          universePerformance: s.universePerformance,
          archetypePerformance: s.archetypePerformance,
          avoidParams: s.avoidParams,
        };
      }

      const recentHistory = await db
        .select()
        .from(scanTuningHistory)
        .where(
          and(
            sql`${scanTuningHistory.outcome} IS NOT NULL`,
            sql`${scanTuningHistory.adminApproved} IS NOT FALSE`
          )
        )
        .orderBy(sql`${scanTuningHistory.createdAt} DESC`)
        .limit(30);

      const perIndicator: Record<string, any> = {};
      for (const indId of indicatorIds) {
        const relevant = recentHistory.filter((h) => {
          const suggestions = (h.aiSuggestions as any)?.suggestions || [];
          const accepted = (h.acceptedSuggestions as any) || [];
          return [...suggestions, ...accepted].some((s: any) => s.indicatorId === indId);
        });
        if (relevant.length === 0) continue;

        perIndicator[indId] = {
          indicatorId: indId,
          recentSessions: relevant.length,
          recentAccepted: relevant.filter((h) => h.outcome === "accepted").length,
          recentDiscarded: relevant.filter((h) => h.outcome === "discarded").length,
          recentSuggestions: relevant.map(h => ({
            outcome: h.outcome,
            accepted: h.acceptedSuggestions,
            skipped: h.skippedSuggestions,
            regime: h.marketRegime,
            universe: h.universe,
            archetypes: h.archetypeTags,
            retainedUp: (h.retainedUpSymbols || []).length,
            droppedUp: (h.droppedUpSymbols || []).length,
            resultDelta: h.resultCountAfter != null && h.resultCountBefore != null
              ? h.resultCountAfter - h.resultCountBefore : null,
            date: h.createdAt,
          })),
        };
      }

      res.json({ history: perIndicator, summaries: summaryMap });
    } catch (error) {
      console.error("Error fetching tuning history:", error);
      res.status(500).json({ error: "Failed to fetch tuning history" });
    }
  });

  // === ADMIN TUNING REVIEW QUEUE ===
  app.get("/api/bigidea/scan-tune/pending-reviews", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      if (!isDatabaseAvailable() || !db) return res.status(500).json({ error: "Database not available" });

      const user = await db.select().from(sentinelUsers).where(eq(sentinelUsers.id, userId)).limit(1);
      if (!user[0]?.isAdmin && user[0]?.tier !== "admin") {
        return res.status(403).json({ error: "Admin access required" });
      }

      const pending = await db
        .select()
        .from(scanTuningHistory)
        .where(
          and(
            eq(scanTuningHistory.outcome, "accepted"),
            sql`${scanTuningHistory.adminApproved} IS NULL`
          )
        )
        .orderBy(sql`${scanTuningHistory.createdAt} DESC`)
        .limit(50);

      const enriched = await Promise.all(pending.map(async (p) => {
        const submitter = await db!.select({ username: sentinelUsers.username }).from(sentinelUsers).where(eq(sentinelUsers.id, p.userId)).limit(1);
        return { ...p, submitterUsername: submitter[0]?.username || "Unknown" };
      }));

      res.json(enriched);
    } catch (error) {
      console.error("Error fetching pending reviews:", error);
      res.status(500).json({ error: "Failed to fetch pending reviews" });
    }
  });

  app.patch("/api/bigidea/scan-tune/:id/admin-review", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      if (!isDatabaseAvailable() || !db) return res.status(500).json({ error: "Database not available" });

      const user = await db.select().from(sentinelUsers).where(eq(sentinelUsers.id, userId)).limit(1);
      if (!user[0]?.isAdmin && user[0]?.tier !== "admin") {
        return res.status(403).json({ error: "Admin access required" });
      }

      const id = parseInt(String(req.params.id));
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

      const { approved } = req.body;
      if (typeof approved !== "boolean") return res.status(400).json({ error: "approved must be boolean" });

      const updated = await db
        .update(scanTuningHistory)
        .set({ adminApproved: approved })
        .where(eq(scanTuningHistory.id, id))
        .returning();

      if (updated.length === 0) return res.status(404).json({ error: "Tuning record not found" });

      if (approved && updated[0].outcome === "accepted") {
        try {
          await upsertIndicatorLearningSummary(updated[0]);
        } catch (e) {
          console.warn("[Admin Review] Failed to update learning summary:", e);
        }
      }

      res.json(updated[0]);
    } catch (error) {
      console.error("Error in admin review:", error);
      res.status(500).json({ error: "Failed to update review" });
    }
  });

  // === ADMIN TUNING HISTORY (full log) ===
  app.get("/api/bigidea/scan-tune/all-history", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      if (!isDatabaseAvailable() || !db) return res.status(500).json({ error: "Database not available" });

      const user = await db.select().from(sentinelUsers).where(eq(sentinelUsers.id, userId)).limit(1);
      if (!user[0]?.isAdmin && user[0]?.tier !== "admin") {
        return res.status(403).json({ error: "Admin access required" });
      }

      const allHistory = await db
        .select()
        .from(scanTuningHistory)
        .where(sql`${scanTuningHistory.outcome} IS NOT NULL`)
        .orderBy(sql`${scanTuningHistory.createdAt} DESC`)
        .limit(100);

      const enriched = await Promise.all(allHistory.map(async (h) => {
        const submitter = await db!.select({ username: sentinelUsers.username }).from(sentinelUsers).where(eq(sentinelUsers.id, h.userId)).limit(1);
        return { ...h, submitterUsername: submitter[0]?.username || "Unknown" };
      }));

      res.json(enriched);
    } catch (error) {
      console.error("Error fetching all tuning history:", error);
      res.status(500).json({ error: "Failed to fetch tuning history" });
    }
  });

  // === PRESET SCAN TEMPLATES ===

  const SCAN_PRESETS = [
    {
      id: "vcp_classic",
      name: "VCP - Volatility Contraction",
      description: "Mark Minervini's VCP pattern: stock trending above key MAs, with tightening price range and declining volume. The classic institutional accumulation setup.",
      category: "Breakout",
      difficulty: "intermediate",
      nodes: [
        {
          id: "t1",
          type: "thought",
          thoughtName: "Trend Filter",
          thoughtCategory: "Moving Averages",
          thoughtCriteria: [
            { indicatorId: "MA-1", label: "Price > 50 SMA", params: [{ name: "period", value: 50 }, { name: "maType", value: "sma" }, { name: "position", value: "above" }] },
            { indicatorId: "MA-1", label: "Price > 200 SMA", params: [{ name: "period", value: 200 }, { name: "maType", value: "sma" }, { name: "position", value: "above" }] },
            { indicatorId: "MA-3", label: "50 SMA > 200 SMA", params: [{ name: "fastPeriod", value: 50 }, { name: "slowPeriod", value: 200 }, { name: "relationship", value: "above" }] },
          ],
          position: { x: 100, y: 100 },
        },
        {
          id: "t2",
          type: "thought",
          thoughtName: "Base Detection",
          thoughtCategory: "Price Action",
          thoughtCriteria: [
            { indicatorId: "PA-3", label: "Consolidation Base", params: [{ name: "period", value: 30 }, { name: "minPeriod", value: 10 }, { name: "maxRange", value: 15 }, { name: "maxSlope", value: 5 }, { name: "drifterPct", value: 10 }, { name: "minBasePct", value: 0 }] },
          ],
          position: { x: 100, y: 250 },
        },
        {
          id: "t3",
          type: "thought",
          thoughtName: "Volume Contraction",
          thoughtCategory: "Volume",
          thoughtCriteria: [
            { indicatorId: "PA-16", label: "Volume Fade", params: [{ name: "recentBars", value: 20 }, { name: "baselineBars", value: 50 }, { name: "maxRatio", value: 0.8 }] },
            { indicatorId: "PA-14", label: "Tightness Ratio", params: [{ name: "recentBars", value: 20 }, { name: "baselineBars", value: 50 }, { name: "maxRatio", value: 0.7 }] },
          ],
          position: { x: 100, y: 400 },
        },
        { id: "results", type: "results", position: { x: 100, y: 550 } },
      ],
      edges: [
        { id: "e1", source: "t1", target: "t2", logicType: "AND" },
        { id: "e2", source: "t2", target: "t3", logicType: "AND" },
        { id: "e3", source: "t3", target: "results", logicType: "AND" },
      ],
      suggestedUniverse: "sp500",
    },
    {
      id: "high_tight_flag",
      name: "High Tight Flag",
      description: "William O'Neil's HTF: stock doubles in 4-8 weeks then pulls back less than 25%. One of the most powerful but rare patterns. Filters for strong prior advance with shallow correction.",
      category: "Breakout",
      difficulty: "advanced",
      nodes: [
        {
          id: "t1",
          type: "thought",
          thoughtName: "Strong Prior Advance",
          thoughtCategory: "Price Action",
          thoughtCriteria: [
            { indicatorId: "PA-12", label: "Prior Advance 80%+", params: [{ name: "lookback", value: 60 }, { name: "minGain", value: 80 }] },
          ],
          position: { x: 100, y: 100 },
        },
        {
          id: "t2",
          type: "thought",
          thoughtName: "Shallow Pullback",
          thoughtCategory: "Price Action",
          thoughtCriteria: [
            { indicatorId: "PA-4", label: "Base Depth < 25%", params: [{ name: "lookback", value: 40 }, { name: "maxDepth", value: 25 }, { name: "minDepth", value: 5 }] },
          ],
          position: { x: 100, y: 250 },
        },
        {
          id: "t3",
          type: "thought",
          thoughtName: "Above Key MAs",
          thoughtCategory: "Moving Averages",
          thoughtCriteria: [
            { indicatorId: "MA-1", label: "Price > 50 SMA", params: [{ name: "period", value: 50 }, { name: "maType", value: "sma" }, { name: "position", value: "above" }] },
          ],
          position: { x: 100, y: 400 },
        },
        { id: "results", type: "results", position: { x: 100, y: 550 } },
      ],
      edges: [
        { id: "e1", source: "t1", target: "t2", logicType: "AND" },
        { id: "e2", source: "t2", target: "t3", logicType: "AND" },
        { id: "e3", source: "t3", target: "results", logicType: "AND" },
      ],
      suggestedUniverse: "sp500",
    },
    {
      id: "relative_strength_leader",
      name: "RS Leader - Institutional Quality",
      description: "Finds stocks showing relative strength vs. the market with accumulation volume. These are the names institutions are building positions in. Combines trend, RS, and volume analysis.",
      category: "Momentum",
      difficulty: "beginner",
      nodes: [
        {
          id: "t1",
          type: "thought",
          thoughtName: "Strong Trend",
          thoughtCategory: "Moving Averages",
          thoughtCriteria: [
            { indicatorId: "MA-1", label: "Price > 21 EMA", params: [{ name: "period", value: 21 }, { name: "maType", value: "ema" }, { name: "position", value: "above" }] },
            { indicatorId: "MA-1", label: "Price > 50 SMA", params: [{ name: "period", value: 50 }, { name: "maType", value: "sma" }, { name: "position", value: "above" }] },
          ],
          position: { x: 100, y: 100 },
        },
        {
          id: "t2",
          type: "thought",
          thoughtName: "Relative Strength",
          thoughtCategory: "Relative Strength",
          thoughtCriteria: [
            { indicatorId: "RS-1", label: "RS vs SPY > 1.5", params: [{ name: "period", value: 60 }, { name: "minRS", value: 1.5 }] },
          ],
          position: { x: 100, y: 250 },
        },
        { id: "results", type: "results", position: { x: 100, y: 400 } },
      ],
      edges: [
        { id: "e1", source: "t1", target: "t2", logicType: "AND" },
        { id: "e2", source: "t2", target: "results", logicType: "AND" },
      ],
      suggestedUniverse: "nasdaq100",
    },
    {
      id: "coiling_base",
      name: "Coiling Base - Quiet Before the Storm",
      description: "Detects stocks in tight consolidation with shrinking volume and narrow daily ranges. These compressed springs often produce explosive breakout moves. Combines base detection with multiple tightness filters.",
      category: "Breakout",
      difficulty: "intermediate",
      nodes: [
        {
          id: "t1",
          type: "thought",
          thoughtName: "Base Detection",
          thoughtCategory: "Price Action",
          thoughtCriteria: [
            { indicatorId: "PA-3", label: "Consolidation Base", params: [{ name: "period", value: 25 }, { name: "minPeriod", value: 8 }, { name: "maxRange", value: 10 }, { name: "maxSlope", value: 4 }, { name: "drifterPct", value: 8 }, { name: "minBasePct", value: 0 }] },
          ],
          position: { x: 100, y: 100 },
        },
        {
          id: "t2",
          type: "thought",
          thoughtName: "Tightness Confirmation",
          thoughtCategory: "Volatility",
          thoughtCriteria: [
            { indicatorId: "PA-14", label: "Tight Range", params: [{ name: "recentBars", value: 15 }, { name: "baselineBars", value: 50 }, { name: "maxRatio", value: 0.6 }] },
            { indicatorId: "PA-15", label: "Close Clustering", params: [{ name: "period", value: 15 }, { name: "maxClusterPct", value: 1.5 }] },
            { indicatorId: "PA-16", label: "Volume Fade", params: [{ name: "recentBars", value: 15 }, { name: "baselineBars", value: 50 }, { name: "maxRatio", value: 0.7 }] },
          ],
          position: { x: 100, y: 250 },
        },
        {
          id: "t3",
          type: "thought",
          thoughtName: "Trend Confirmation",
          thoughtCategory: "Moving Averages",
          thoughtCriteria: [
            { indicatorId: "MA-1", label: "Price > 50 SMA", params: [{ name: "period", value: 50 }, { name: "maType", value: "sma" }, { name: "position", value: "above" }] },
          ],
          position: { x: 100, y: 400 },
        },
        { id: "results", type: "results", position: { x: 100, y: 550 } },
      ],
      edges: [
        { id: "e1", source: "t1", target: "t2", logicType: "AND" },
        { id: "e2", source: "t2", target: "t3", logicType: "AND" },
        { id: "e3", source: "t3", target: "results", logicType: "AND" },
      ],
      suggestedUniverse: "sp500",
    },
  ];

  app.get("/api/bigidea/presets", async (_req: Request, res: Response) => {
    res.json(SCAN_PRESETS.map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      category: p.category,
      difficulty: p.difficulty,
      suggestedUniverse: p.suggestedUniverse,
      thoughtCount: p.nodes.filter(n => n.type === "thought").length,
    })));
  });

  app.get("/api/bigidea/presets/:id", async (req: Request, res: Response) => {
    const preset = SCAN_PRESETS.find(p => p.id === req.params.id);
    if (!preset) return res.status(404).json({ error: "Preset not found" });
    res.json(preset);
  });

  // === THOUGHT SCORE RULES & SELECTION WEIGHTS ===

  async function seedScoreRulesIfNeeded() {
    if (!isDatabaseAvailable() || !db) return;
    const existing = await db.select().from(thoughtScoreRules);
    if (existing.length > 0) return;
    await db.insert(thoughtScoreRules).values([
      { ruleKey: "idea_save_modified", label: "Thought modified before save", description: "Applied when a thought's settings were changed (by user or AI tuning) before the idea is saved", scoreValue: 3, enabled: true },
      { ruleKey: "scan_returned_data", label: "Idea scan returned results", description: "Applied to all non-muted thoughts when the idea's scan finds at least one matching stock", scoreValue: 1, enabled: true },
      { ruleKey: "chart_thumbs_up", label: "Chart received thumbs up", description: "Applied to all non-muted thoughts when a user gives a scan result chart a thumbs-up rating", scoreValue: 1, enabled: true },
      { ruleKey: "chart_thumbs_down", label: "Chart received thumbs down", description: "Applied to all non-muted thoughts when a user gives a scan result chart a thumbs-down rating", scoreValue: -1, enabled: true },
    ]);
  }

  async function seedSelectionWeightsIfNeeded() {
    if (!isDatabaseAvailable() || !db) return;
    const existing = await db.select().from(thoughtSelectionWeights);
    if (existing.length > 0) return;
    await db.insert(thoughtSelectionWeights).values([
      { strategyKey: "random", label: "Random thought", description: "Pick any thought for this indicator regardless of score — pure exploration", weightPercent: 30, configN: null, enabled: true },
      { strategyKey: "random_top_n", label: "Random among highest N", description: "Pick randomly from the top N highest-scored thoughts for this indicator", weightPercent: 33, configN: 3, enabled: true },
      { strategyKey: "highest_rated", label: "Highest rated", description: "Always pick the #1 highest-scored thought for this indicator — pure exploitation", weightPercent: 34, configN: null, enabled: true },
    ]);
  }

  seedScoreRulesIfNeeded().catch(e => console.error("Failed to seed score rules:", e));
  seedSelectionWeightsIfNeeded().catch(e => console.error("Failed to seed selection weights:", e));

  app.get("/api/bigidea/score-rules", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      if (!isDatabaseAvailable() || !db) return res.status(500).json({ error: "Database not available" });
      const rules = await db.select().from(thoughtScoreRules);
      res.json(rules);
    } catch (error) {
      console.error("Error fetching score rules:", error);
      res.status(500).json({ error: "Failed to fetch score rules" });
    }
  });

  app.put("/api/bigidea/score-rules/:id", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      if (!isDatabaseAvailable() || !db) return res.status(500).json({ error: "Database not available" });
      const user = await db.select().from(sentinelUsers).where(eq(sentinelUsers.id, userId));
      if (!user.length || (user[0].tier !== "admin" && !user[0].isAdmin)) return res.status(403).json({ error: "Admin only" });

      const id = parseInt(String(req.params.id));
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

      const updates: any = {};
      if (req.body.scoreValue !== undefined) updates.scoreValue = req.body.scoreValue;
      if (req.body.enabled !== undefined) updates.enabled = req.body.enabled;
      if (req.body.label !== undefined) updates.label = req.body.label;
      if (req.body.description !== undefined) updates.description = req.body.description;

      const [updated] = await db.update(thoughtScoreRules).set(updates).where(eq(thoughtScoreRules.id, id)).returning();
      res.json(updated);
    } catch (error) {
      console.error("Error updating score rule:", error);
      res.status(500).json({ error: "Failed to update score rule" });
    }
  });

  app.get("/api/bigidea/selection-weights", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      if (!isDatabaseAvailable() || !db) return res.status(500).json({ error: "Database not available" });
      const weights = await db.select().from(thoughtSelectionWeights);
      res.json(weights);
    } catch (error) {
      console.error("Error fetching selection weights:", error);
      res.status(500).json({ error: "Failed to fetch selection weights" });
    }
  });

  app.put("/api/bigidea/selection-weights/:id", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      if (!isDatabaseAvailable() || !db) return res.status(500).json({ error: "Database not available" });
      const user = await db.select().from(sentinelUsers).where(eq(sentinelUsers.id, userId));
      if (!user.length || (user[0].tier !== "admin" && !user[0].isAdmin)) return res.status(403).json({ error: "Admin only" });

      const id = parseInt(String(req.params.id));
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

      const updates: any = {};
      if (req.body.weightPercent !== undefined) updates.weightPercent = req.body.weightPercent;
      if (req.body.configN !== undefined) updates.configN = req.body.configN;
      if (req.body.enabled !== undefined) updates.enabled = req.body.enabled;
      if (req.body.label !== undefined) updates.label = req.body.label;
      if (req.body.description !== undefined) updates.description = req.body.description;

      const [updated] = await db.update(thoughtSelectionWeights).set(updates).where(eq(thoughtSelectionWeights.id, id)).returning();
      res.json(updated);
    } catch (error) {
      console.error("Error updating selection weight:", error);
      res.status(500).json({ error: "Failed to update selection weight" });
    }
  });

  // Admin endpoint: backfill thought scores from historical chart_ratings and scan_sessions
  app.post("/api/bigidea/thought-scores/backfill", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      if (!isDatabaseAvailable() || !db) return res.status(500).json({ error: "Database not available" });
      const user = await db.select().from(sentinelUsers).where(eq(sentinelUsers.id, userId));
      if (!user.length || (user[0].tier !== "admin" && !user[0].isAdmin)) return res.status(403).json({ error: "Admin only" });

      const rules = await getScoreRulesMap();
      const stats = { ratingsProcessed: 0, sessionsProcessed: 0, thoughtsScored: 0 };

      const allThoughts = await db.select({ id: scannerThoughts.id, name: scannerThoughts.name }).from(scannerThoughts);
      const thoughtNameToId = new Map<string, number>();
      for (const t of allThoughts) {
        thoughtNameToId.set(t.name.toLowerCase().trim(), t.id);
      }

      const resolveThoughtIdsFromNodes = (nodes: any[]): number[] => {
        const ids: number[] = [];
        const seen = new Set<number>();
        for (const n of nodes) {
          if (n.type !== "thought" || n.isMuted) continue;
          let resolved: number | undefined;
          if (n.thoughtId && typeof n.thoughtId === "number") {
            resolved = n.thoughtId;
          } else if (n.thoughtName) {
            resolved = thoughtNameToId.get(n.thoughtName.toLowerCase().trim());
          }
          if (resolved && !seen.has(resolved)) {
            seen.add(resolved);
            ids.push(resolved);
          }
        }
        return ids;
      };

      // Backfill from chart_ratings (Rule 3)
      const upRule = rules["chart_thumbs_up"];
      const downRule = rules["chart_thumbs_down"];
      if ((upRule?.enabled || downRule?.enabled)) {
        const ratings = await db.select().from(scanChartRatings);
        for (const r of ratings) {
          let tIds: number[] = [];
          if (r.ideaId) {
            const idea = await db.select().from(scannerIdeas).where(eq(scannerIdeas.id, r.ideaId));
            if (idea.length) {
              tIds = resolveThoughtIdsFromNodes(idea[0].nodes as any[]);
            }
          }
          if (tIds.length === 0 && r.sessionId) {
            const session = await db.select().from(scanSessions).where(eq(scanSessions.id, r.sessionId));
            if (session.length) {
              const config = session[0].scanConfig as any;
              if (config?.nodes) {
                tIds = resolveThoughtIdsFromNodes(config.nodes as any[]);
              }
            }
          }
          if (tIds.length === 0) continue;
          const rule = r.rating === "up" ? upRule : downRule;
          if (rule?.enabled && rule.scoreValue !== 0) {
            await applyScoreToThoughts(tIds, rule.scoreValue);
            stats.thoughtsScored += tIds.length;
          }
          stats.ratingsProcessed++;
        }
      }

      // Backfill from scan_sessions with results > 0 (Rule 2)
      const scanRule = rules["scan_returned_data"];
      if (scanRule?.enabled && scanRule.scoreValue !== 0) {
        const sessions = await db.select().from(scanSessions).where(sql`${scanSessions.resultCount} > 0`);
        for (const s of sessions) {
          const config = s.scanConfig as any;
          if (!config?.nodes) continue;
          const tIds = resolveThoughtIdsFromNodes(config.nodes as any[]);
          if (tIds.length === 0) continue;
          await applyScoreToThoughts(tIds, scanRule.scoreValue);
          stats.thoughtsScored += tIds.length;
          stats.sessionsProcessed++;
        }
      }

      res.json({ success: true, stats });
    } catch (error) {
      console.error("Error backfilling thought scores:", error);
      res.status(500).json({ error: "Failed to backfill scores" });
    }
  });

  app.get("/api/bigidea/thought-scores/stats", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      if (!isDatabaseAvailable() || !db) return res.status(500).json({ error: "Database not available" });

      const now = new Date();
      const todayStart = new Date(now);
      todayStart.setUTCHours(0, 0, 0, 0);
      const weekStart = new Date(now);
      weekStart.setUTCDate(now.getUTCDate() - now.getUTCDay());
      weekStart.setUTCHours(0, 0, 0, 0);

      const thoughtStats = await db.select({
        total: sql<number>`count(*)`,
        scored: sql<number>`count(case when ${scannerThoughts.score} != 0 then 1 end)`,
        totalPoints: sql<number>`coalesce(sum(${scannerThoughts.score}), 0)`,
      }).from(scannerThoughts);

      const sessionCounts = await db.select({
        allTime: sql<number>`count(*)`,
        today: sql<number>`count(case when ${scanSessions.createdAt} >= ${todayStart} then 1 end)`,
        thisWeek: sql<number>`count(case when ${scanSessions.createdAt} >= ${weekStart} then 1 end)`,
      }).from(scanSessions).where(sql`${scanSessions.resultCount} > 0`);

      const ratingCounts = await db.select({
        allTime: sql<number>`count(*)`,
        today: sql<number>`count(case when ${scanChartRatings.createdAt} >= ${todayStart} then 1 end)`,
        thisWeek: sql<number>`count(case when ${scanChartRatings.createdAt} >= ${weekStart} then 1 end)`,
      }).from(scanChartRatings);

      res.json({
        thoughts: thoughtStats[0],
        sessions: sessionCounts[0],
        ratings: ratingCounts[0],
      });
    } catch (error) {
      console.error("Error fetching score stats:", error);
      res.status(500).json({ error: "Failed to fetch score stats" });
    }
  });

  // Get query optimizer statistics
  app.get("/api/bigidea/optimizer-stats", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      if (!isDatabaseAvailable() || !db) return res.status(500).json({ error: "Database not available" });

      const stats = await db.select().from(indicatorExecutionStats);
      
      const totalEvaluations = stats.reduce((sum, s) => sum + s.totalEvaluations, 0);
      const avgConfidence = stats.length > 0 
        ? stats.reduce((sum, s) => sum + Math.min(1.0, s.totalEvaluations / 1000), 0) / stats.length
        : 0;
      
      // Calculate overall improvement (compare baseline vs current selectivity)
      // Baseline assumption: all thoughts run on full universe (no optimization)
      // Current: using learned selectivity to estimate actual evaluations
      const baselineEvaluationsPerScan = stats.length * 500; // Assume 500 stock universe, all thoughts run on all stocks
      const optimizedEvaluationsPerScan = stats.reduce((sum, s) => {
        // Estimate how many stocks this indicator sees (cumulative selectivity)
        const positionFactor = Math.max(0.1, 1 - s.selectivityScore * 0.7);
        return sum + (500 * positionFactor);
      }, 0);
      
      const overallImprovement = baselineEvaluationsPerScan > 0
        ? ((baselineEvaluationsPerScan - optimizedEvaluationsPerScan) / baselineEvaluationsPerScan) * 100
        : 0;
      
      // Calculate weekly improvement (compare last 7 days vs previous 7 days)
      const now = new Date();
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - 7);
      const twoWeeksStart = new Date(now);
      twoWeeksStart.setDate(now.getDate() - 14);
      
      const recentSessions = await db.select()
        .from(scanSessions)
        .where(sql`${scanSessions.createdAt} >= ${weekStart}`)
        .orderBy(desc(scanSessions.createdAt))
        .limit(100);
      
      const previousSessions = await db.select()
        .from(scanSessions)
        .where(sql`${scanSessions.createdAt} >= ${twoWeeksStart} AND ${scanSessions.createdAt} < ${weekStart}`)
        .orderBy(desc(scanSessions.createdAt))
        .limit(100);
      
      const avgRecentEvals = recentSessions.length > 0
        ? recentSessions.reduce((sum, s) => sum + (s.totalEvaluations || 0), 0) / recentSessions.length
        : 0;
      
      const avgPreviousEvals = previousSessions.length > 0
        ? previousSessions.reduce((sum, s) => sum + (s.totalEvaluations || 0), 0) / previousSessions.length
        : avgRecentEvals;
      
      const weeklyImprovement = avgPreviousEvals > 0
        ? ((avgPreviousEvals - avgRecentEvals) / avgPreviousEvals) * 100
        : 0;
      
      // Find top improved indicator
      const sortedBySelectivity = [...stats].sort((a, b) => b.selectivityScore - a.selectivityScore);
      const topImproved = sortedBySelectivity[0];
      
      // Calculate total scans
      const totalScans = await db.select({
        count: sql<number>`count(*)`,
      }).from(scanSessions);
      
      res.json({
        totalScans: totalScans[0]?.count || 0,
        totalEvaluations,
        avgConfidence: Math.round(avgConfidence * 100),
        overallImprovement: Math.round(overallImprovement * 100) / 100,
        weeklyImprovement: Math.round(weeklyImprovement * 100) / 100,
        topImprovedIndicator: topImproved ? {
          id: topImproved.indicatorId,
          name: topImproved.indicatorName,
          selectivity: Math.round(topImproved.selectivityScore * 100),
        } : null,
        indicators: stats.map(s => ({
          id: s.indicatorId,
          name: s.indicatorName,
          category: s.category,
          avgTimeMs: Math.round(s.avgExecutionTimeMs * 10) / 10,
          passRate: Math.round(s.avgPassRate * 100),
          selectivity: Math.round(s.selectivityScore * 100),
          evaluations: s.totalEvaluations,
          confidence: Math.round(Math.min(1.0, s.totalEvaluations / 1000) * 100),
        })),
      });
    } catch (error) {
      console.error("Error fetching optimizer stats:", error);
      res.status(500).json({ error: "Failed to fetch optimizer stats" });
    }
  });

  // Get optimizer display settings (respects admin override)
  app.get("/api/bigidea/optimizer-display-settings", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      if (!isDatabaseAvailable() || !db) return res.status(500).json({ error: "Database not available" });

      // Get user info
      const user = await db.select().from(sentinelUsers).where(eq(sentinelUsers.id, userId)).limit(1);
      const isAdmin = user[0]?.isAdmin || false;

      // Get settings (create default if doesn't exist)
      let settings = await db.select().from(optimizerDisplaySettings).limit(1);
      if (settings.length === 0) {
        await db.insert(optimizerDisplaySettings).values({});
        settings = await db.select().from(optimizerDisplaySettings).limit(1);
      }

      const setting = settings[0];

      // If admin and override is enabled, use admin-specific settings
      if (isAdmin && setting.adminOverrideEnabled) {
        return res.json({
          showOverlay: setting.showOptimizerOverlay,
          metrics: {
            overallImprovement: setting.adminShowOverallImprovement,
            weeklyImprovement: setting.adminShowWeeklyImprovement,
            confidenceLevel: setting.adminShowConfidenceLevel,
            scanStats: setting.adminShowScanStats,
            liveOptimization: setting.adminShowLiveOptimization,
            achievementBadges: setting.adminShowAchievementBadges,
            debugInfo: setting.adminShowDebugInfo,
          },
          position: setting.overlayPosition,
          style: setting.overlayStyle,
          theme: setting.overlayTheme,
          isAdmin: true,
        });
      }

      // Otherwise, use global settings (for all regular users)
      return res.json({
        showOverlay: setting.showOptimizerOverlay,
        metrics: {
          overallImprovement: setting.showOverallImprovement,
          weeklyImprovement: setting.showWeeklyImprovement,
          confidenceLevel: setting.showConfidenceLevel,
          scanStats: setting.showScanStats,
          liveOptimization: setting.showLiveOptimization,
          achievementBadges: setting.showAchievementBadges,
          debugInfo: false, // Never show debug to non-admin
        },
        position: setting.overlayPosition,
        style: setting.overlayStyle,
        theme: setting.overlayTheme,
        isAdmin: false,
      });
    } catch (error) {
      console.error("Error fetching optimizer display settings:", error);
      res.status(500).json({ error: "Failed to fetch display settings" });
    }
  });

  // Update optimizer display settings (admin only)
  app.patch("/api/admin/optimizer-display-settings", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      if (!isDatabaseAvailable() || !db) return res.status(500).json({ error: "Database not available" });

      const user = await db.select().from(sentinelUsers).where(eq(sentinelUsers.id, userId)).limit(1);
      if (!user[0]?.isAdmin) {
        return res.status(403).json({ error: "Admin access required" });
      }

      const updates = req.body;
      
      // Get or create settings
      let settings = await db.select().from(optimizerDisplaySettings).limit(1);
      if (settings.length === 0) {
        await db.insert(optimizerDisplaySettings).values(updates);
      } else {
        await db.update(optimizerDisplaySettings)
          .set({ ...updates, updatedAt: new Date() })
          .where(eq(optimizerDisplaySettings.id, settings[0].id));
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Error updating optimizer display settings:", error);
      res.status(500).json({ error: "Failed to update settings" });
    }
  });

  // Helper: get score rules as a keyed map for use in scoring logic
  async function getScoreRulesMap(): Promise<Record<string, { scoreValue: number; enabled: boolean }>> {
    if (!isDatabaseAvailable() || !db) return {};
    const rules = await db.select().from(thoughtScoreRules);
    const map: Record<string, { scoreValue: number; enabled: boolean }> = {};
    for (const r of rules) {
      map[r.ruleKey] = { scoreValue: r.scoreValue, enabled: r.enabled };
    }
    return map;
  }

  // Helper: apply score delta to thoughts by IDs
  async function applyScoreToThoughts(thoughtIds: number[], delta: number) {
    if (!isDatabaseAvailable() || !db || thoughtIds.length === 0 || delta === 0) return;
    await db.update(scannerThoughts)
      .set({ score: sql`${scannerThoughts.score} + ${delta}` })
      .where(sql`${scannerThoughts.id} IN (${sql.join(thoughtIds.map(id => sql`${id}`), sql`, `)})`);
  }

  // Helper: update lastUsedAt for thoughts by IDs
  async function touchThoughtsLastUsed(thoughtIds: number[]) {
    if (!isDatabaseAvailable() || !db || thoughtIds.length === 0) return;
    await db.update(scannerThoughts)
      .set({ lastUsedAt: new Date() })
      .where(sql`${scannerThoughts.id} IN (${sql.join(thoughtIds.map(id => sql`${id}`), sql`, `)})`);
  }

  async function selectThoughtsByWeight(userId: number, count: number): Promise<any[]> {
    if (!isDatabaseAvailable() || !db || count <= 0) return [];
    const allThoughts = await db.select().from(scannerThoughts)
      .where(eq(scannerThoughts.userId, userId))
      .orderBy(sql`${scannerThoughts.score} DESC NULLS LAST`);
    if (allThoughts.length === 0) return [];

    const weights = await db.select().from(thoughtSelectionWeights);
    const weightMap: Record<string, { weightPercent: number; configN: number | null; enabled: boolean }> = {};
    for (const w of weights) {
      weightMap[w.strategyKey] = { weightPercent: w.weightPercent, configN: w.configN, enabled: w.enabled };
    }

    const selected: any[] = [];
    const usedIds = new Set<number>();

    const pickRandom = (pool: any[]): any | null => {
      const available = pool.filter(t => !usedIds.has(t.id));
      if (available.length === 0) return null;
      const pick = available[Math.floor(Math.random() * available.length)];
      usedIds.add(pick.id);
      return pick;
    };

    for (let i = 0; i < count; i++) {
      const roll = Math.random() * 100;
      let cumulative = 0;
      let picked: any = null;

      const pure = weightMap["pure_random"];
      if (pure?.enabled) {
        cumulative += pure.weightPercent;
        if (roll < cumulative) {
          picked = pickRandom(allThoughts);
        }
      }

      if (!picked) {
        const topN = weightMap["top_n_random"];
        if (topN?.enabled) {
          cumulative += topN.weightPercent;
          if (roll < cumulative) {
            const n = topN.configN || 3;
            const topPool = allThoughts.slice(0, Math.min(n, allThoughts.length));
            picked = pickRandom(topPool);
          }
        }
      }

      if (!picked) {
        const highest = weightMap["highest_rated"];
        if (highest?.enabled) {
          const available = allThoughts.filter(t => !usedIds.has(t.id));
          if (available.length > 0) {
            picked = available[0];
            usedIds.add(picked.id);
          }
        }
      }

      if (!picked) {
        picked = pickRandom(allThoughts);
      }

      if (picked) selected.push(picked);
    }

    return selected;
  }

  app.get("/api/bigidea/thoughts/ai-selection", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      if (!isDatabaseAvailable() || !db) return res.status(500).json({ error: "Database not available" });

      const count = Math.min(parseInt(String(req.query.count || "3")), 10);
      const selected = await selectThoughtsByWeight(userId, count);
      res.json(selected);
    } catch (error) {
      console.error("Error selecting thoughts:", error);
      res.status(500).json({ error: "Failed to select thoughts" });
    }
  });

  async function detectModifiedThoughts(ideaNodes: any[]): Promise<number[]> {
    if (!isDatabaseAvailable() || !db) return [];
    const thoughtNodes = ideaNodes.filter((n: any) => n.type === "thought" && n.thoughtId);
    if (thoughtNodes.length === 0) return [];
    const ids = thoughtNodes.map((n: any) => n.thoughtId as number);
    const stored = await db.select({ id: scannerThoughts.id, criteria: scannerThoughts.criteria })
      .from(scannerThoughts)
      .where(sql`${scannerThoughts.id} IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`);
    const storedMap = new Map(stored.map(s => [s.id, JSON.stringify(s.criteria || [])]));
    const modified: number[] = [];
    for (const n of thoughtNodes) {
      const storedCriteria = storedMap.get(n.thoughtId);
      const nodeCriteria = JSON.stringify(n.thoughtCriteria || []);
      if (storedCriteria && storedCriteria !== nodeCriteria) {
        modified.push(n.thoughtId);
      }
    }
    return modified;
  }

  // =============================================================================
  // AI Training System - Setup Library Routes
  // =============================================================================

  // Get all setups (optionally filter by status)
  app.get("/api/bigidea/setups", async (req: Request, res: Response) => {
    try {
      if (!isDatabaseAvailable() || !db) {
        return res.status(500).json({ error: "Database not available" });
      }

      const status = req.query.status as string | undefined;
      
      let query = db.select().from(bigideaSetups).orderBy(desc(bigideaSetups.updatedAt));
      
      if (status) {
        const setups = await db.select().from(bigideaSetups)
          .where(eq(bigideaSetups.status, status))
          .orderBy(desc(bigideaSetups.updatedAt));
        return res.json(setups);
      }
      
      const setups = await query;
      res.json(setups);
    } catch (error) {
      console.error("Error fetching setups:", error);
      res.status(500).json({ error: "Failed to fetch setups" });
    }
  });

  // Get single setup by ID (includes indicators)
  app.get("/api/bigidea/setups/:id", async (req: Request, res: Response) => {
    try {
      if (!isDatabaseAvailable() || !db) {
        return res.status(500).json({ error: "Database not available" });
      }

      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid setup ID" });
      }

      const [setup] = await db.select().from(bigideaSetups).where(eq(bigideaSetups.id, id));
      if (!setup) {
        return res.status(404).json({ error: "Setup not found" });
      }

      // Fetch associated indicators
      const indicators = await db.select().from(bigideaSetupIndicators)
        .where(eq(bigideaSetupIndicators.setupId, id));

      res.json({ ...setup, indicators });
    } catch (error) {
      console.error("Error fetching setup:", error);
      res.status(500).json({ error: "Failed to fetch setup" });
    }
  });

  // Create new setup
  app.post("/api/bigidea/setups", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      if (!isDatabaseAvailable() || !db) {
        return res.status(500).json({ error: "Database not available" });
      }

      const { name, description, exampleCharts, extractedRules, indicators } = req.body;
      
      if (!name) {
        return res.status(400).json({ error: "Name is required" });
      }

      // Generate slug from name
      const slug = name.toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

      // Check for existing slug
      const [existing] = await db.select().from(bigideaSetups)
        .where(eq(bigideaSetups.slug, slug));
      if (existing) {
        return res.status(400).json({ error: "A setup with this name already exists" });
      }

      const [setup] = await db.insert(bigideaSetups).values({
        name,
        slug,
        description,
        exampleCharts,
        extractedRules,
        createdBy: userId,
        status: "draft",
        version: 1,
      }).returning();

      // Insert indicators if provided
      if (indicators && Array.isArray(indicators)) {
        for (const ind of indicators) {
          await db.insert(bigideaSetupIndicators).values({
            setupId: setup.id,
            indicatorId: ind.indicatorId,
            params: ind.params,
            required: ind.required ?? true,
            weight: ind.weight ?? 1.0,
            notes: ind.notes,
          });
        }
      }

      // Fetch the full setup with indicators
      const fullIndicators = await db.select().from(bigideaSetupIndicators)
        .where(eq(bigideaSetupIndicators.setupId, setup.id));

      res.status(201).json({ ...setup, indicators: fullIndicators });
    } catch (error) {
      console.error("Error creating setup:", error);
      res.status(500).json({ error: "Failed to create setup" });
    }
  });

  // Update setup
  app.patch("/api/bigidea/setups/:id", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      if (!isDatabaseAvailable() || !db) {
        return res.status(500).json({ error: "Database not available" });
      }

      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid setup ID" });
      }

      const { 
        name, description, exampleCharts, extractedRules, status, indicators,
        ivyEntryStrategy, ivyStopStrategy, ivyTargetStrategy, ivyContextNotes, ivyApproved
      } = req.body;

      // Build update object
      const updates: any = { updatedAt: new Date() };
      if (name !== undefined) {
        updates.name = name;
        updates.slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      }
      if (description !== undefined) updates.description = description;
      if (exampleCharts !== undefined) updates.exampleCharts = exampleCharts;
      if (extractedRules !== undefined) updates.extractedRules = extractedRules;
      if (status !== undefined) updates.status = status;
      
      // Ivy AI Integration fields
      if (ivyEntryStrategy !== undefined) updates.ivyEntryStrategy = ivyEntryStrategy;
      if (ivyStopStrategy !== undefined) updates.ivyStopStrategy = ivyStopStrategy;
      if (ivyTargetStrategy !== undefined) updates.ivyTargetStrategy = ivyTargetStrategy;
      if (ivyContextNotes !== undefined) updates.ivyContextNotes = ivyContextNotes;
      if (ivyApproved !== undefined) updates.ivyApproved = ivyApproved;

      const [setup] = await db.update(bigideaSetups)
        .set(updates)
        .where(eq(bigideaSetups.id, id))
        .returning();

      if (!setup) {
        return res.status(404).json({ error: "Setup not found" });
      }

      // Update indicators if provided
      if (indicators !== undefined && Array.isArray(indicators)) {
        // Delete existing indicators
        await db.delete(bigideaSetupIndicators)
          .where(eq(bigideaSetupIndicators.setupId, id));

        // Insert new indicators
        for (const ind of indicators) {
          await db.insert(bigideaSetupIndicators).values({
            setupId: id,
            indicatorId: ind.indicatorId,
            params: ind.params,
            required: ind.required ?? true,
            weight: ind.weight ?? 1.0,
            notes: ind.notes,
          });
        }
      }

      // Fetch updated indicators
      const updatedIndicators = await db.select().from(bigideaSetupIndicators)
        .where(eq(bigideaSetupIndicators.setupId, id));

      res.json({ ...setup, indicators: updatedIndicators });
    } catch (error) {
      console.error("Error updating setup:", error);
      res.status(500).json({ error: "Failed to update setup" });
    }
  });

  // Delete setup
  app.delete("/api/bigidea/setups/:id", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      if (!isDatabaseAvailable() || !db) {
        return res.status(500).json({ error: "Database not available" });
      }

      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid setup ID" });
      }

      // Delete associated indicators first
      await db.delete(bigideaSetupIndicators)
        .where(eq(bigideaSetupIndicators.setupId, id));

      // Delete setup
      const result = await db.delete(bigideaSetups)
        .where(eq(bigideaSetups.id, id))
        .returning();

      if (result.length === 0) {
        return res.status(404).json({ error: "Setup not found" });
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting setup:", error);
      res.status(500).json({ error: "Failed to delete setup" });
    }
  });

  // Activate setup (change status to "active")
  app.post("/api/bigidea/setups/:id/activate", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      if (!isDatabaseAvailable() || !db) {
        return res.status(500).json({ error: "Database not available" });
      }

      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid setup ID" });
      }

      const [setup] = await db.update(bigideaSetups)
        .set({ status: "active", updatedAt: new Date() })
        .where(eq(bigideaSetups.id, id))
        .returning();

      if (!setup) {
        return res.status(404).json({ error: "Setup not found" });
      }

      res.json(setup);
    } catch (error) {
      console.error("Error activating setup:", error);
      res.status(500).json({ error: "Failed to activate setup" });
    }
  });

  // Archive setup
  app.post("/api/bigidea/setups/:id/archive", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      if (!isDatabaseAvailable() || !db) {
        return res.status(500).json({ error: "Database not available" });
      }

      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid setup ID" });
      }

      const [setup] = await db.update(bigideaSetups)
        .set({ status: "archived", updatedAt: new Date() })
        .where(eq(bigideaSetups.id, id))
        .returning();

      if (!setup) {
        return res.status(404).json({ error: "Setup not found" });
      }

      res.json(setup);
    } catch (error) {
      console.error("Error archiving setup:", error);
      res.status(500).json({ error: "Failed to archive setup" });
    }
  });

  // Get indicator library (for selecting indicators when creating setups)
  app.get("/api/bigidea/setup-indicators", (_req: Request, res: Response) => {
    const library = Object.entries(INDICATOR_LIBRARY).map(([id, ind]) => ({
      id,
      name: ind.name,
      category: ind.category,
      defaultParams: ind.defaultParams,
    }));
    res.json(library);
  });

  // =============================================================================
  // AI Extraction Endpoints (Phase 2)
  // =============================================================================

  // Preview analysis - returns AI understanding before creating Ideas
  app.post("/api/bigidea/setups/:id/preview-analysis", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      if (!isDatabaseAvailable() || !db) {
        return res.status(500).json({ error: "Database not available" });
      }

      const setupId = parseInt(req.params.id);
      if (isNaN(setupId)) {
        return res.status(400).json({ error: "Invalid setup ID" });
      }

      // Get the setup
      const [setup] = await db.select().from(bigideaSetups).where(eq(bigideaSetups.id, setupId));
      if (!setup) {
        return res.status(404).json({ error: "Setup not found" });
      }

      // Get all uploads linked to this setup that have extracted text
      const links = await db.select().from(setupUploads).where(eq(setupUploads.setupId, setupId));
      const linkedUploads = [];
      for (const link of links) {
        const [upload] = await db.select().from(uploads).where(and(
          eq(uploads.id, link.uploadId),
          eq(uploads.processingStatus, "completed")
        ));
        if (upload) linkedUploads.push(upload);
      }

      // Combine all extracted text
      let allText = "";
      if (setup.description) {
        allText += `SETUP DESCRIPTION:\n${setup.description}\n\n`;
      }
      for (const upload of linkedUploads) {
        if (upload.extractedText) {
          allText += `DOCUMENT: ${upload.filename}\n${upload.extractedText}\n\n`;
        }
      }

      if (!allText.trim()) {
        return res.status(400).json({ error: "No content to analyze. Upload documents with extracted text first." });
      }

      const openai = getOpenAI();
      if (!openai) {
        return res.status(500).json({ error: "OpenAI not configured" });
      }

      // Build indicator library summary
      const indicatorSummary = INDICATOR_LIBRARY.map(ind => 
        `- ${ind.id}: ${ind.name} (${ind.category})`
      ).join("\n");

      const systemPrompt = `You are an expert trading system architect. Analyze this trading methodology document and summarize your understanding.

CRITICAL: First determine if this document describes:
- ONE core pattern/setup with variations/examples
- OR multiple DISTINCT patterns/setups

Most trading articles describe ONE setup with examples. Don't create separate Ideas for each example.

AVAILABLE INDICATORS:
${indicatorSummary}

Respond with JSON:
{
  "summary": "Your analysis summary explaining what you found. Start with 'I found [X] distinct pattern(s)...' Be clear about whether examples are variations of ONE idea or separate ideas.",
  "proposedIdeas": [
    {
      "name": "Pattern Name",
      "description": "What this scans for",
      "thoughts": [
        {
          "name": "Thought Name",
          "description": "What this checks",
          "indicators": [
            { "id": "indicator_id", "name": "Display Name", "params": {} }
          ]
        }
      ],
      "confidence": 85
    }
  ],
  "documentContext": "Brief summary of source material"
}`;

      const userPrompt = `Analyze this trading methodology for "${setup.name}":

${allText}

Remember: Most articles describe ONE setup with examples. Be conservative - only propose multiple Ideas if they are truly different patterns.`;

      console.log(`[Preview] Analyzing documents for "${setup.name}"...`);

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        max_tokens: 3000,
        temperature: 0.3,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });

      const rawResponse = response.choices[0]?.message?.content || "";
      
      // Parse JSON
      let jsonStr = rawResponse;
      const jsonMatch = rawResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) jsonStr = jsonMatch[1].trim();

      let preview;
      try {
        preview = JSON.parse(jsonStr);
      } catch {
        // If JSON parsing fails, return the raw response as summary
        preview = {
          summary: rawResponse,
          proposedIdeas: [],
          documentContext: setup.name,
        };
      }

      // Validate indicator IDs
      for (const idea of preview.proposedIdeas || []) {
        for (const thought of idea.thoughts || []) {
          thought.indicators = (thought.indicators || []).filter((ind: any) => {
            const exists = INDICATOR_LIBRARY.some(lib => lib.id === ind.id);
            if (!exists) console.warn(`[Preview] Unknown indicator: ${ind.id}`);
            return exists;
          });
        }
      }

      console.log(`[Preview] Proposed ${preview.proposedIdeas?.length || 0} Ideas`);
      res.json(preview);
    } catch (error: any) {
      console.error("Error in preview analysis:", error);
      res.status(500).json({ error: error?.message || "Analysis failed" });
    }
  });

  // Refine analysis based on user feedback
  app.post("/api/bigidea/setups/:id/refine-analysis", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const { message, currentPreview } = req.body;
      if (!message || !currentPreview) {
        return res.status(400).json({ error: "Message and currentPreview required" });
      }

      const openai = getOpenAI();
      if (!openai) {
        return res.status(500).json({ error: "OpenAI not configured" });
      }

      const indicatorSummary = INDICATOR_LIBRARY.map(ind => 
        `- ${ind.id}: ${ind.name} (${ind.category})`
      ).join("\n");

      const systemPrompt = `You are refining a trading scan definition based on user feedback.

CURRENT PROPOSED IDEAS:
${JSON.stringify(currentPreview.proposedIdeas, null, 2)}

AVAILABLE INDICATORS:
${indicatorSummary}

Based on user feedback, update the proposed Ideas. Common requests:
- "This is one idea, not three" → Combine into single Idea with multiple Thoughts
- "Add [indicator]" → Add to appropriate Thought
- "Change [param]" → Update parameter values
- "Remove [idea/thought]" → Remove from list

Respond with JSON:
{
  "response": "Brief explanation of changes made",
  "updatedPreview": {
    "summary": "Updated summary",
    "proposedIdeas": [...updated ideas...],
    "documentContext": "..."
  }
}

If no changes needed, return response without updatedPreview.`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        max_tokens: 2500,
        temperature: 0.3,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message },
        ],
      });

      const rawResponse = response.choices[0]?.message?.content || "";
      
      let jsonStr = rawResponse;
      const jsonMatch = rawResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) jsonStr = jsonMatch[1].trim();

      let result;
      try {
        result = JSON.parse(jsonStr);
      } catch {
        result = { response: rawResponse };
      }

      // Validate indicator IDs in updated preview
      if (result.updatedPreview?.proposedIdeas) {
        for (const idea of result.updatedPreview.proposedIdeas) {
          for (const thought of idea.thoughts || []) {
            thought.indicators = (thought.indicators || []).filter((ind: any) => {
              return INDICATOR_LIBRARY.some(lib => lib.id === ind.id);
            });
          }
        }
      }

      res.json(result);
    } catch (error: any) {
      console.error("Error refining analysis:", error);
      res.status(500).json({ error: error?.message || "Refinement failed" });
    }
  });

  // Create Ideas from confirmed preview
  app.post("/api/bigidea/setups/:id/create-from-preview", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      if (!isDatabaseAvailable() || !db) {
        return res.status(500).json({ error: "Database not available" });
      }

      const setupId = parseInt(req.params.id);
      if (isNaN(setupId)) {
        return res.status(400).json({ error: "Invalid setup ID" });
      }

      const { preview, clearExisting } = req.body;
      if (!preview || !preview.proposedIdeas) {
        return res.status(400).json({ error: "Preview with proposedIdeas required" });
      }

      // Clear existing Ideas if requested
      if (clearExisting) {
        await db.delete(bigideaExtractedIdeas).where(eq(bigideaExtractedIdeas.setupId, setupId));
        console.log(`[Create] Cleared existing Ideas for setup ${setupId}`);
      }

      // Create new Ideas
      const createdIdeas = [];
      for (const idea of preview.proposedIdeas) {
        // Add UUIDs to thoughts if missing
        const thoughts = (idea.thoughts || []).map((t: any, idx: number) => ({
          id: t.id || `thought-${idx + 1}`,
          name: t.name,
          description: t.description,
          indicators: t.indicators || [],
        }));

        const [created] = await db.insert(bigideaExtractedIdeas).values({
          setupId,
          name: idea.name,
          description: idea.description,
          thoughts: thoughts as ExtractedThought[],
          confidence: idea.confidence || 80,
          aiModel: "gpt-4o",
          aiPromptVersion: "v2.0-preview",
          status: "draft",
        }).returning();

        createdIdeas.push(created);
      }

      console.log(`[Create] Created ${createdIdeas.length} Ideas for setup ${setupId}`);
      res.json({ created: createdIdeas.length, ideas: createdIdeas });
    } catch (error: any) {
      console.error("Error creating Ideas:", error);
      res.status(500).json({ error: error?.message || "Creation failed" });
    }
  });

  // Legacy: Analyze setup documents and extract Ideas (direct, no preview)
  app.post("/api/bigidea/setups/:id/analyze", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      if (!isDatabaseAvailable() || !db) {
        return res.status(500).json({ error: "Database not available" });
      }

      const setupId = parseInt(req.params.id);
      if (isNaN(setupId)) {
        return res.status(400).json({ error: "Invalid setup ID" });
      }

      // Get the setup
      const [setup] = await db.select().from(bigideaSetups).where(eq(bigideaSetups.id, setupId));
      if (!setup) {
        return res.status(404).json({ error: "Setup not found" });
      }

      // Get all uploads linked to this setup that have extracted text
      const links = await db.select()
        .from(setupUploads)
        .where(eq(setupUploads.setupId, setupId));
      
      const linkedUploads = [];
      for (const link of links) {
        const [upload] = await db.select()
          .from(uploads)
          .where(and(
            eq(uploads.id, link.uploadId),
            eq(uploads.processingStatus, "completed")
          ));
        if (upload) {
          linkedUploads.push(upload);
        }
      }

      // Combine all extracted text
      let allText = "";
      const uploadIds: number[] = [];
      
      // Add setup description
      if (setup.description) {
        allText += `SETUP DESCRIPTION:\n${setup.description}\n\n`;
      }
      
      // Add extracted text from documents
      for (const upload of linkedUploads) {
        if (upload.extractedText) {
          allText += `DOCUMENT: ${upload.filename}\n${upload.extractedText}\n\n`;
          uploadIds.push(upload.id);
        }
      }
      
      if (!allText.trim()) {
        return res.status(400).json({ 
          error: "No content to analyze. Upload documents with extracted text first." 
        });
      }

      console.log(`[Analyze] Processing ${uploadIds.length} documents for setup "${setup.name}"`);

      // Run AI extraction
      const extraction = await extractIdeasFromText(allText, setup.name);
      
      // Store extracted ideas in database
      const createdIdeas = [];
      for (const idea of extraction.ideas) {
        const [created] = await db.insert(bigideaExtractedIdeas).values({
          setupId,
          name: idea.name,
          description: idea.description,
          thoughts: idea.thoughts as ExtractedThought[],
          confidence: idea.confidence,
          sourceDocumentId: uploadIds[0] || null,
          aiModel: extraction.model,
          aiPromptVersion: extraction.promptVersion,
          status: "draft",
        }).returning();
        
        createdIdeas.push(created);
      }

      res.json({
        message: `Extracted ${createdIdeas.length} Ideas from ${uploadIds.length} documents`,
        ideas: createdIdeas,
        model: extraction.model,
      });
    } catch (error: any) {
      console.error("Error analyzing setup:", error);
      res.status(500).json({ error: error?.message || "Failed to analyze setup" });
    }
  });

  // Get extracted ideas for a setup
  app.get("/api/bigidea/setups/:id/extracted-ideas", async (req: Request, res: Response) => {
    try {
      if (!isDatabaseAvailable() || !db) {
        return res.status(500).json({ error: "Database not available" });
      }

      const setupId = parseInt(req.params.id);
      if (isNaN(setupId)) {
        return res.status(400).json({ error: "Invalid setup ID" });
      }

      const ideas = await db.select()
        .from(bigideaExtractedIdeas)
        .where(eq(bigideaExtractedIdeas.setupId, setupId))
        .orderBy(desc(bigideaExtractedIdeas.createdAt));

      res.json(ideas);
    } catch (error) {
      console.error("Error fetching extracted ideas:", error);
      res.status(500).json({ error: "Failed to fetch extracted ideas" });
    }
  });

  // Update an extracted idea (edit thoughts, name, etc.)
  app.put("/api/bigidea/extracted-ideas/:id", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      if (!isDatabaseAvailable() || !db) {
        return res.status(500).json({ error: "Database not available" });
      }

      const ideaId = parseInt(req.params.id);
      if (isNaN(ideaId)) {
        return res.status(400).json({ error: "Invalid idea ID" });
      }

      const { name, description, thoughts, status } = req.body;
      
      const updateData: any = {};
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (thoughts !== undefined) updateData.thoughts = thoughts;
      if (status !== undefined) updateData.status = status;

      const [updated] = await db.update(bigideaExtractedIdeas)
        .set(updateData)
        .where(eq(bigideaExtractedIdeas.id, ideaId))
        .returning();

      if (!updated) {
        return res.status(404).json({ error: "Idea not found" });
      }

      res.json(updated);
    } catch (error) {
      console.error("Error updating extracted idea:", error);
      res.status(500).json({ error: "Failed to update idea" });
    }
  });

  // Delete an extracted idea
  app.delete("/api/bigidea/extracted-ideas/:id", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      if (!isDatabaseAvailable() || !db) {
        return res.status(500).json({ error: "Database not available" });
      }

      const ideaId = parseInt(req.params.id);
      if (isNaN(ideaId)) {
        return res.status(400).json({ error: "Invalid idea ID" });
      }

      const [deleted] = await db.delete(bigideaExtractedIdeas)
        .where(eq(bigideaExtractedIdeas.id, ideaId))
        .returning();

      if (!deleted) {
        return res.status(404).json({ error: "Idea not found" });
      }

      res.json({ success: true, deleted });
    } catch (error) {
      console.error("Error deleting extracted idea:", error);
      res.status(500).json({ error: "Failed to delete idea" });
    }
  });

  // Approve an extracted idea (ready for validation)
  app.post("/api/bigidea/extracted-ideas/:id/approve", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      if (!isDatabaseAvailable() || !db) {
        return res.status(500).json({ error: "Database not available" });
      }

      const ideaId = parseInt(req.params.id);
      if (isNaN(ideaId)) {
        return res.status(400).json({ error: "Invalid idea ID" });
      }

      const [updated] = await db.update(bigideaExtractedIdeas)
        .set({ 
          status: "approved",
          approvedAt: new Date(),
          approvedBy: userId,
        })
        .where(eq(bigideaExtractedIdeas.id, ideaId))
        .returning();

      if (!updated) {
        return res.status(404).json({ error: "Idea not found" });
      }

      res.json(updated);
    } catch (error) {
      console.error("Error approving idea:", error);
      res.status(500).json({ error: "Failed to approve idea" });
    }
  });

  // Start validation session (Training Mode)
  app.post("/api/bigidea/extracted-ideas/:id/start-validation", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      if (!isDatabaseAvailable() || !db) {
        return res.status(500).json({ error: "Database not available" });
      }

      const ideaId = parseInt(req.params.id);
      if (isNaN(ideaId)) {
        return res.status(400).json({ error: "Invalid idea ID" });
      }

      // Update status to validating
      const [updated] = await db.update(bigideaExtractedIdeas)
        .set({ status: "validating" })
        .where(eq(bigideaExtractedIdeas.id, ideaId))
        .returning();

      if (!updated) {
        return res.status(404).json({ error: "Idea not found" });
      }

      res.json({
        message: "Validation mode started",
        idea: updated,
      });
    } catch (error) {
      console.error("Error starting validation:", error);
      res.status(500).json({ error: "Failed to start validation" });
    }
  });

  // Record validation rating
  app.post("/api/bigidea/extracted-ideas/:id/rate", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      if (!isDatabaseAvailable() || !db) {
        return res.status(500).json({ error: "Database not available" });
      }

      const ideaId = parseInt(req.params.id);
      if (isNaN(ideaId)) {
        return res.status(400).json({ error: "Invalid idea ID" });
      }

      const { symbol, rating, price, indicatorSnapshot, notes } = req.body;
      if (!symbol || !rating || !["up", "down"].includes(rating)) {
        return res.status(400).json({ error: "Invalid rating data" });
      }

      // Insert rating
      const [created] = await db.insert(bigideaValidationRatings).values({
        extractedIdeaId: ideaId,
        userId,
        symbol,
        rating,
        price,
        indicatorSnapshot,
        notes,
      }).returning();

      // Update validation stats on the idea
      const allRatings = await db.select()
        .from(bigideaValidationRatings)
        .where(eq(bigideaValidationRatings.extractedIdeaId, ideaId));

      const totalRated = allRatings.length;
      const thumbsUp = allRatings.filter(r => r.rating === "up").length;
      const thumbsDown = allRatings.filter(r => r.rating === "down").length;
      const hitRate = totalRated > 0 ? (thumbsUp / totalRated) * 100 : 0;

      await db.update(bigideaExtractedIdeas)
        .set({
          validationStats: { totalRated, thumbsUp, thumbsDown, hitRate },
        })
        .where(eq(bigideaExtractedIdeas.id, ideaId));

      res.json({
        rating: created,
        stats: { totalRated, thumbsUp, thumbsDown, hitRate },
      });
    } catch (error) {
      console.error("Error recording rating:", error);
      res.status(500).json({ error: "Failed to record rating" });
    }
  });

  // Get validation ratings for an idea
  app.get("/api/bigidea/extracted-ideas/:id/ratings", async (req: Request, res: Response) => {
    try {
      if (!isDatabaseAvailable() || !db) {
        return res.status(500).json({ error: "Database not available" });
      }

      const ideaId = parseInt(req.params.id);
      if (isNaN(ideaId)) {
        return res.status(400).json({ error: "Invalid idea ID" });
      }

      const ratings = await db.select()
        .from(bigideaValidationRatings)
        .where(eq(bigideaValidationRatings.extractedIdeaId, ideaId))
        .orderBy(desc(bigideaValidationRatings.createdAt));

      res.json(ratings);
    } catch (error) {
      console.error("Error fetching ratings:", error);
      res.status(500).json({ error: "Failed to fetch ratings" });
    }
  });

  // Push approved idea to scanner as a runnable Idea
  app.post("/api/bigidea/extracted-ideas/:id/push-to-scanner", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      if (!isDatabaseAvailable() || !db) {
        return res.status(500).json({ error: "Database not available" });
      }

      const ideaId = parseInt(req.params.id);
      if (isNaN(ideaId)) {
        return res.status(400).json({ error: "Invalid idea ID" });
      }

      // Get the extracted idea
      const [extractedIdea] = await db.select()
        .from(bigideaExtractedIdeas)
        .where(eq(bigideaExtractedIdeas.id, ideaId));

      if (!extractedIdea) {
        return res.status(404).json({ error: "Idea not found" });
      }

      if (extractedIdea.status !== "approved" && extractedIdea.status !== "validating") {
        return res.status(400).json({ error: "Idea must be approved or validated before pushing to scanner" });
      }

      // Convert extracted thoughts to scanner format
      const thoughts = extractedIdea.thoughts as ExtractedThought[];
      
      // Create a Thought in the scanner for each thought in the idea
      const createdThoughtIds: number[] = [];
      
      for (const thought of thoughts) {
        // Convert indicators to scanner criteria format
        const criteria = thought.indicators.map(ind => ({
          indicatorId: ind.id,
          label: ind.name,
          inverted: false,
          muted: false,
          params: Object.entries(ind.params || {}).map(([name, value]) => ({
            name,
            label: name,
            type: typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "select",
            value,
          })),
        }));

        // Validate and auto-correct timeframe for intraday indicators
        const { correctedTimeframe } = validateIntradayIndicators(criteria, "daily");

        // Create scanner thought
        const [createdThought] = await db.insert(scannerThoughts).values({
          userId,
          name: thought.name,
          category: "AI Extracted",
          description: thought.description || `Extracted from ${extractedIdea.name}`,
          criteria: criteria as any,
          timeframe: correctedTimeframe,
        }).returning();

        createdThoughtIds.push(createdThought.id);
      }

      // Create scanner idea with all thoughts as nodes
      const nodes = createdThoughtIds.map((thoughtId, idx) => ({
        id: `node-${idx}`,
        type: "thought" as const,
        thoughtId,
        thoughtName: thoughts[idx].name,
        thoughtCategory: "AI Extracted",
        thoughtDescription: thoughts[idx].description,
        position: { x: 100 + idx * 250, y: 150 },
      }));

      // Add results node
      nodes.push({
        id: "results",
        type: "results" as const,
        thoughtId: 0,
        thoughtName: "Results",
        thoughtCategory: "",
        thoughtDescription: "",
        position: { x: 100 + thoughts.length * 125, y: 350 },
      });

      // Create edges - all thoughts connect to results with OR logic
      const edges = thoughts.map((_, idx) => ({
        id: `edge-${idx}`,
        source: `node-${idx}`,
        target: "results",
        logicType: "OR" as const,
      }));

      const [scannerIdea] = await db.insert(scannerIdeas).values({
        userId,
        name: extractedIdea.name,
        description: extractedIdea.description || `Extracted from setup library`,
        universe: "sp500",
        nodes: nodes as any,
        edges: edges as any,
      }).returning();

      // Update extracted idea with push info
      await db.update(bigideaExtractedIdeas)
        .set({
          status: "pushed",
          pushedToIdeaId: scannerIdea.id,
          pushedAt: new Date(),
          pushedBy: userId,
        })
        .where(eq(bigideaExtractedIdeas.id, ideaId));

      res.json({
        message: `Successfully pushed "${extractedIdea.name}" to scanner`,
        scannerIdeaId: scannerIdea.id,
        thoughtsCreated: createdThoughtIds.length,
      });
    } catch (error) {
      console.error("Error pushing to scanner:", error);
      res.status(500).json({ error: "Failed to push to scanner" });
    }
  });

  // Suggest indicator mappings for a concept
  app.post("/api/bigidea/suggest-mappings", async (req: Request, res: Response) => {
    try {
      const { concept } = req.body;
      if (!concept) {
        return res.status(400).json({ error: "Concept description required" });
      }

      const mappings = await suggestIndicatorMappings(concept);
      res.json({ mappings });
    } catch (error: any) {
      console.error("Error suggesting mappings:", error);
      res.status(500).json({ error: error?.message || "Failed to suggest mappings" });
    }
  });

  // Refine an extracted idea with AI assistance
  app.post("/api/bigidea/extracted-ideas/:id/refine", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const ideaId = parseInt(req.params.id);
      if (isNaN(ideaId)) {
        return res.status(400).json({ error: "Invalid idea ID" });
      }

      const { message, currentIdea } = req.body;
      if (!message || !currentIdea) {
        return res.status(400).json({ error: "Message and currentIdea required" });
      }

      const openai = getOpenAI();
      if (!openai) {
        return res.status(500).json({ error: "OpenAI not configured" });
      }

      // Build indicator library summary for context
      const indicatorSummary = INDICATOR_LIBRARY.map(ind => 
        `- ${ind.id}: ${ind.name} (${ind.category}) - ${ind.description}`
      ).join("\n");

      const systemPrompt = `You are an expert trading system architect helping refine scan definitions.

CURRENT IDEA:
Name: ${currentIdea.name}
Description: ${currentIdea.description || "None"}
Thoughts: ${JSON.stringify(currentIdea.thoughts, null, 2)}

AVAILABLE INDICATORS:
${indicatorSummary}

RULES:
1. Each Idea = 1+ Thoughts (OR logic between thoughts)
2. Each Thought = 1+ Indicators (AND logic within thought)
3. Only use indicator IDs from the library above
4. Return the COMPLETE updated idea structure when making changes

When the user asks to modify the idea, respond with:
1. A brief explanation of the changes
2. If changes were made, include the full updated idea as JSON in a code block

Format for updates:
\`\`\`json
{
  "name": "Idea Name",
  "description": "Description",
  "thoughts": [
    {
      "id": "uuid",
      "name": "Thought Name",
      "description": "What this checks",
      "indicators": [
        { "id": "indicator_id", "name": "Display Name", "params": {} }
      ]
    }
  ]
}
\`\`\``;

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        max_tokens: 2048,
        temperature: 0.3,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message },
        ],
      });

      const aiResponse = response.choices[0]?.message?.content || "";
      
      // Try to extract updated idea from response
      const jsonMatch = aiResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
      let updatedIdea = null;
      
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1].trim());
          if (parsed.thoughts && Array.isArray(parsed.thoughts)) {
            // Validate indicator IDs
            for (const thought of parsed.thoughts) {
              if (!thought.id) thought.id = crypto.randomUUID();
              thought.indicators = (thought.indicators || []).filter((ind: any) => {
                const exists = INDICATOR_LIBRARY.some(lib => lib.id === ind.id);
                if (!exists) console.warn(`[Refine] Removing unknown indicator: ${ind.id}`);
                return exists;
              });
            }
            
            updatedIdea = {
              ...currentIdea,
              name: parsed.name || currentIdea.name,
              description: parsed.description || currentIdea.description,
              thoughts: parsed.thoughts,
            };
          }
        } catch (e) {
          console.error("[Refine] Failed to parse JSON from response:", e);
        }
      }

      // Clean response text (remove JSON block for display)
      let responseText = aiResponse.replace(/```(?:json)?\s*[\s\S]*?```/g, "").trim();
      if (!responseText) {
        responseText = updatedIdea 
          ? "I've updated the idea based on your request. Review the changes on the right."
          : "I couldn't make changes based on that request. Could you be more specific?";
      }

      res.json({
        response: responseText,
        updatedIdea,
      });
    } catch (error: any) {
      console.error("Error refining idea:", error);
      res.status(500).json({ error: error?.message || "Failed to refine idea" });
    }
  });

  // =============================================================================
  // Custom Indicators API
  // =============================================================================

  // Create a new custom indicator
  app.post("/api/bigidea/custom-indicators", async (req: Request, res: Response) => {
    try {
      if (!isDatabaseAvailable()) {
        return res.status(503).json({ error: "Database not available" });
      }

      const { name, category, description, params, logicDefinition, aiPrompt, aiModel, provides, consumes } = req.body;
      const userId = (req.user as any)?.id || 1;

      if (!name || !category || !description || !logicDefinition) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      const validation = validateDslDefinition(logicDefinition);
      if (!validation.valid) {
        return res.status(400).json({ 
          error: "Invalid logic definition", 
          details: validation.errors 
        });
      }

      const customId = `CUSTOM-${userId}-${Date.now()}`;

      const [indicator] = await db.insert(userIndicators).values({
        userId,
        customId,
        name,
        category,
        description,
        params: params || [],
        logicType: "rule_based",
        logicDefinition,
        provides: provides || [],
        consumes: consumes || [],
        aiGenerated: true,
        aiModel: aiModel || "gpt-4o",
        aiPrompt,
        timesUsed: 0,
      }).returning();

      res.json({ 
        success: true, 
        indicator,
      });
    } catch (error: any) {
      console.error("Error creating custom indicator:", error);
      res.status(500).json({ error: error?.message || "Failed to create custom indicator" });
    }
  });

  // List user's custom indicators
  app.get("/api/bigidea/custom-indicators", async (req: Request, res: Response) => {
    try {
      if (!isDatabaseAvailable()) {
        return res.status(503).json({ error: "Database not available" });
      }

      const userId = (req.user as any)?.id || 1;

      const indicators = await db
        .select()
        .from(userIndicators)
        .where(eq(userIndicators.userId, userId))
        .orderBy(desc(userIndicators.createdAt));

      res.json({ indicators });
    } catch (error: any) {
      console.error("Error fetching custom indicators:", error);
      res.status(500).json({ error: error?.message || "Failed to fetch custom indicators" });
    }
  });

  // Test/preview a custom indicator on a specific symbol
  app.post("/api/bigidea/custom-indicators/test", async (req: Request, res: Response) => {
    try {
      const { symbol, logicDefinition, params, timeframe } = req.body;

      if (!symbol || !logicDefinition) {
        return res.status(400).json({ error: "Missing symbol or logicDefinition" });
      }

      const validation = validateDslDefinition(logicDefinition);
      if (!validation.valid) {
        return res.status(400).json({ 
          error: "Invalid logic definition", 
          details: validation.errors 
        });
      }

      const candles = await fetchOHLCV(symbol, timeframe || "daily");
      const result = evaluateDslIndicator(logicDefinition, candles, params || {});

      res.json({ 
        success: true, 
        pass: result.pass,
        data: result.data,
        symbol,
        dataPoints: candles.length,
      });
    } catch (error: any) {
      console.error("Error testing custom indicator:", error);
      res.status(500).json({ error: error?.message || "Failed to test custom indicator" });
    }
  });

  // Generate a custom indicator using AI
  app.post("/api/bigidea/custom-indicators/generate", async (req: Request, res: Response) => {
    console.log("[CustomIndicator] Generate endpoint called with:", JSON.stringify(req.body, null, 2));
    try {
      const { requestText, existingIndicators } = req.body;
      const openai = getOpenAI();

      if (!openai) {
        console.error("[CustomIndicator] OpenAI not configured");
        return res.status(503).json({ error: "AI integration not configured" });
      }

      if (!requestText) {
        console.error("[CustomIndicator] Missing requestText");
        return res.status(400).json({ error: "Missing requestText" });
      }

      const systemPrompt = `You are an expert in technical analysis and indicator design. Your task is to create a custom indicator definition based on the user's request.

Available DSL Conditions:
- PRICE_ABOVE, PRICE_BELOW, PRICE_BETWEEN
- CLOSE_ABOVE_OPEN, CLOSE_BELOW_OPEN
- VOLUME_ABOVE_AVG, VOLUME_ABOVE_THRESHOLD
- CONSECUTIVE_UP_DAYS, CONSECUTIVE_DOWN_DAYS
- SMA_CROSS_ABOVE, SMA_CROSS_BELOW, EMA_CROSS_ABOVE, EMA_CROSS_BELOW
- PRICE_ABOVE_SMA, PRICE_BELOW_SMA, PRICE_ABOVE_EMA, PRICE_BELOW_EMA
- GAP_UP, GAP_DOWN, GAP_UP_PCT, GAP_DOWN_PCT
- HIGHER_HIGH, LOWER_LOW, HIGHER_LOW, LOWER_HIGH
- RANGE_EXPANSION, RANGE_CONTRACTION
- BREAKOUT_NEW_HIGH, BREAKDOWN_NEW_LOW
- INSIDE_BAR, OUTSIDE_BAR, DOJI, HAMMER, SHOOTING_STAR
- ENGULFING_BULL, ENGULFING_BEAR
- MOMENTUM_INCREASING, MOMENTUM_DECREASING
- PRICE_CHANGE_PCT (computes % change from N bars ago to current close)

Parameters you can use in rules:
- lookback: number of bars to look back
- period: MA period or window size
- period2: secondary MA period
- consecutiveDays: number of consecutive days
- minGapPct: minimum gap percentage
- threshold: generic numeric threshold
- minChangePct: minimum price change percentage
- maxChangePct: maximum price change percentage

CRITICAL PARAMETER RULES:
1. ALL numeric parameters MUST have WIDE, FLEXIBLE ranges:
   - min should be 0.01 or lower (never higher than 1 unless meaningless)
   - max should be at least 1000 (use 10000 for percentages, 500 for periods)
   - step should be small (0.01 for percentages, 1 for integers)
2. Every parameter should be fully adjustable by the user.
3. Include a reasonable defaultValue that makes sense for the user's request.

DATA LINKING (REQUIRED - for chaining with other indicators):
ALWAYS include both provides and consumes arrays - this makes indicators chain-ready:
- "provides": Array of outputs this indicator passes to downstream indicators
  Format: [{ "linkType": "sequenceOffset", "paramName": "period" }]
  Common linkTypes: "basePeriod", "sequenceOffset", "priceChange", "patternBar"
  ALWAYS include at least one output using the main period/lookback/window param
- "consumes": Array of inputs this indicator can receive from upstream indicators
  Format: [{ "paramName": "skipBars", "dataKey": "detectedPeriod" }]
  Common dataKeys: "detectedPeriod", "baseStartBar", "baseEndBar", "patternEndBar"
  ALWAYS include at least one input - add a "skipBars" param if needed to receive upstream data
- Even simple indicators should have provides/consumes so they can be used in sequences later.

Return ONLY a JSON object with this structure (no markdown, no explanation):
{
  "name": "Indicator name",
  "category": "Price Action" | "Volume" | "Momentum" | "Consolidation",
  "description": "Brief description",
  "params": [
    {
      "name": "skipBars",
      "label": "Skip Recent Bars",
      "type": "number",
      "defaultValue": 0,
      "min": 0,
      "max": 500,
      "step": 1
    },
    {
      "name": "minChangePct",
      "label": "Min Change %",
      "type": "number",
      "defaultValue": 15,
      "min": 0.01,
      "max": 10000,
      "step": 0.1
    },
    {
      "name": "period",
      "label": "Period (bars)",
      "type": "number",
      "defaultValue": 20,
      "min": 1,
      "max": 500,
      "step": 1
    }
  ],
  "logicDefinition": {
    "rules": [
      {
        "condition": "PRICE_CHANGE_PCT",
        "lookback": "{period}",
        "threshold": "{minChangePct}"
      }
    ],
    "combineLogic": "AND"
  },
  "provides": [{ "linkType": "sequenceOffset", "paramName": "period" }],
  "consumes": [{ "paramName": "skipBars", "dataKey": "detectedPeriod" }]
}`;

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { 
            role: "user", 
            content: `User request: "${requestText}"\n\nExisting indicators (DO NOT recreate these):\n${existingIndicators?.map((ind: any) => `- ${ind.name}: ${ind.description}`).join('\n') || 'None'}` 
          },
        ],
        temperature: 0.2,
      });

      const aiResponse = completion.choices[0]?.message?.content || "";
      
      const jsonMatch = aiResponse.match(/```(?:json)?\s*([\s\S]*?)```/) || aiResponse.match(/(\{[\s\S]*\})/);
      if (!jsonMatch) {
        return res.status(500).json({ error: "AI did not return valid JSON" });
      }

      const indicatorDef = JSON.parse(jsonMatch[1].trim());

      const validation = validateDslDefinition(indicatorDef.logicDefinition);
      if (!validation.valid) {
        return res.status(400).json({ 
          error: "Generated indicator has invalid logic", 
          details: validation.errors 
        });
      }

      console.log("[CustomIndicator] Successfully generated:", indicatorDef.name);
      res.json({
        success: true,
        indicator: indicatorDef,
        aiModel: "gpt-4o",
      });
    } catch (error: any) {
      console.error("[CustomIndicator] Error generating custom indicator:", error);
      console.error("[CustomIndicator] Stack:", error.stack);
      res.status(500).json({ error: error?.message || "Failed to generate custom indicator" });
    }
  });

  // Increment usage counter for a custom indicator
  app.post("/api/bigidea/custom-indicators/:id/use", async (req: Request, res: Response) => {
    try {
      if (!isDatabaseAvailable()) {
        return res.status(503).json({ error: "Database not available" });
      }

      const indicatorId = parseInt(req.params.id);
      const { passed } = req.body;

      const [indicator] = await db
        .select()
        .from(userIndicators)
        .where(eq(userIndicators.id, indicatorId));

      if (!indicator) {
        return res.status(404).json({ error: "Indicator not found" });
      }

      const timesUsed = (indicator.timesUsed || 0) + 1;
      const totalEvaluations = (indicator.totalEvaluations || 0) + 1;
      const totalPasses = (indicator.totalPasses || 0) + (passed ? 1 : 0);
      const avgPassRate = totalPasses / totalEvaluations;

      const updates: any = {
        timesUsed,
        totalEvaluations,
        totalPasses,
        avgPassRate,
        lastUsedAt: new Date(),
      };

      // Auto-submit to approval queue after 5 uses
      if (timesUsed === 5 && !indicator.autoSubmittedAt && !indicator.isAdminApproved) {
        updates.autoSubmittedAt = new Date();
        
        await db.insert(indicatorApprovalQueue).values({
          indicatorId: indicator.id,
          submittedAt: new Date(),
        });

        console.log(`[Custom Indicator] Auto-submitted indicator ${indicator.customId} to approval queue after 5 uses`);
      }

      await db
        .update(userIndicators)
        .set(updates)
        .where(eq(userIndicators.id, indicatorId));

      res.json({ success: true, timesUsed, autoSubmitted: timesUsed === 5 });
    } catch (error: any) {
      console.error("Error incrementing indicator usage:", error);
      res.status(500).json({ error: error?.message || "Failed to update indicator usage" });
    }
  });

  // Get approval queue (admin only)
  app.get("/api/bigidea/custom-indicators/approval-queue", async (req: Request, res: Response) => {
    try {
      if (!isDatabaseAvailable()) {
        return res.status(503).json({ error: "Database not available" });
      }

      const user = req.user as any;
      if (!user?.isAdmin) {
        return res.status(403).json({ error: "Admin access required" });
      }

      const queue = await db
        .select({
          queueItem: indicatorApprovalQueue,
          indicator: userIndicators,
          creator: {
            id: sentinelUsers.id,
            username: sentinelUsers.username,
            email: sentinelUsers.email,
          },
        })
        .from(indicatorApprovalQueue)
        .leftJoin(userIndicators, eq(indicatorApprovalQueue.indicatorId, userIndicators.id))
        .leftJoin(sentinelUsers, eq(userIndicators.userId, sentinelUsers.id))
        .where(sql`${indicatorApprovalQueue.decision} IS NULL`)
        .orderBy(desc(indicatorApprovalQueue.submittedAt));

      res.json({ queue });
    } catch (error: any) {
      console.error("Error fetching approval queue:", error);
      res.status(500).json({ error: error?.message || "Failed to fetch approval queue" });
    }
  });

  // Approve/reject a custom indicator (admin only)
  app.post("/api/bigidea/custom-indicators/review/:queueId", async (req: Request, res: Response) => {
    try {
      if (!isDatabaseAvailable()) {
        return res.status(503).json({ error: "Database not available" });
      }

      const user = req.user as any;
      if (!user?.isAdmin) {
        return res.status(403).json({ error: "Admin access required" });
      }

      const queueId = parseInt(req.params.queueId);
      const { decision, reviewNotes, rejectionReason } = req.body;

      if (!["approved", "rejected", "needs_revision"].includes(decision)) {
        return res.status(400).json({ error: "Invalid decision" });
      }

      const [queueItem] = await db
        .select()
        .from(indicatorApprovalQueue)
        .where(eq(indicatorApprovalQueue.id, queueId));

      if (!queueItem) {
        return res.status(404).json({ error: "Queue item not found" });
      }

      await db
        .update(indicatorApprovalQueue)
        .set({
          decision,
          reviewNotes,
          rejectionReason,
          reviewedAt: new Date(),
          reviewedBy: user.id,
        })
        .where(eq(indicatorApprovalQueue.id, queueId));

      if (decision === "approved") {
        await db
          .update(userIndicators)
          .set({
            isAdminApproved: true,
            approvedByAdminId: user.id,
            approvedAt: new Date(),
          })
          .where(eq(userIndicators.id, queueItem.indicatorId));
      }

      res.json({ success: true, decision });
    } catch (error: any) {
      console.error("Error reviewing custom indicator:", error);
      res.status(500).json({ error: error?.message || "Failed to review indicator" });
    }
  });
}
