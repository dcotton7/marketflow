import { Express, Request, Response } from "express";
import { db, isDatabaseAvailable } from "../db";
import { scannerThoughts, scannerIdeas, scannerFavorites, scanChartRatings, scanTuningHistory, scanSessions, sentinelUsers, indicatorLearningSummary } from "@shared/schema";
import { fetchMarketSentiment } from "../sentinel/sentiment";
import { eq, and, desc, sql } from "drizzle-orm";
import { INDICATOR_LIBRARY, CandleData, normalizeResult } from "./indicators";
import { evaluateScanQuality } from "./quality";
import { getUniverseTickers } from "./universes";
import OpenAI from "openai";
import * as tiingo from "../tiingo";

function getOpenAI(): OpenAI | null {
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  if (!apiKey) return null;
  return new OpenAI({ apiKey, baseURL });
}

const ohlcvCache = new Map<string, { data: CandleData[]; timestamp: number }>();
const CACHE_TTL = 60 * 60 * 1000;
const INTRADAY_CACHE_TTL = 5 * 60 * 1000;

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

    const bars = await tiingo.getHistoricalBars(symbol, startDate, endDate, interval);

    const candles: CandleData[] = bars
      .map((b) => ({
        date: b.date,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume || 0,
      }))
      .reverse();

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
  upstreamData?: Record<string, any>
): ThoughtEvalResult {
  if (!criteria || criteria.length === 0) return { pass: false, allMuted: false, outputData: {}, criteriaResults: [] };

  const activeCriteria = criteria.filter((c: any) => !c.muted);
  if (activeCriteria.length === 0) return { pass: true, allMuted: true, outputData: {}, criteriaResults: [] };

  const outputData: Record<string, any> = {};
  const criteriaResults: CriterionResult[] = [];
  let allPass = true;

  const CONSUMER_IDS_EVAL = new Set(["PA-12", "PA-13", "PA-14", "PA-15", "PA-16"]);

  for (const criterion of activeCriteria) {
    const repaired = repairCriterion(criterion);
    const indicator = INDICATOR_LIBRARY.find((ind) => ind.id === repaired.indicatorId);
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

    if (normalized.data) {
      const { _diagnostics, ...rest } = normalized.data;
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
        .where(eq(scannerThoughts.userId, userId));

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

      const [thought] = await db
        .insert(scannerThoughts)
        .values({ userId, name, category, description: description || null, aiPrompt: aiPrompt || null, criteria, timeframe: timeframe || "daily" })
        .returning();

      res.status(201).json(thought);
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

      const [updated] = await db
        .update(scannerThoughts)
        .set(updates)
        .where(and(eq(scannerThoughts.id, id), eq(scannerThoughts.userId, userId)))
        .returning();

      res.json(updated);
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

  app.get("/api/bigidea/indicators", (_req: Request, res: Response) => {
    try {
      const indicators = INDICATOR_LIBRARY.map((ind) => ({
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

      const indicatorSummary = INDICATOR_LIBRARY.map((ind) => ({
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
- PA-12 (Prior Price Advance) CONSUMES detectedPeriod → skipBars
- PA-13 (Smooth Trending Advance) CONSUMES detectedPeriod → skipBars
- PA-14 (Tightness Ratio) CONSUMES detectedPeriod → baselineBars
- PA-15 (Close Clustering) CONSUMES detectedPeriod → period
- PA-16 (Volume Fade) CONSUMES detectedPeriod → baselineBars

You must respond with valid JSON. When the idea needs multiple thoughts, use this format:
{
  "thoughts": [
    {
      "thoughtKey": "A",
      "name": "Short descriptive name",
      "category": "One of: Momentum, Value, Trend, Volatility, Volume, Custom",
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

CRITICAL RULE FOR DESCRIPTIONS:
The "description" field MUST accurately describe what the chosen indicators and parameters actually measure — NOT what the user asked for. If the user asks for "stocks bouncing off the 50 SMA" but the best available indicator only checks proximity to the SMA (not a bounce/reversal), the description must say "Screens for stocks whose price is currently within X% of the 50 SMA" rather than claiming it detects a bounce. Never oversell or exaggerate what the criteria can detect. Be precise and honest about what the screening actually does.

IMPORTANT GUIDELINES for indicator selection:
- For "price crossed above/below a moving average" (e.g. "price crossed above the 50 SMA", "price broke below the 20 EMA"), ALWAYS use MA-9 (Price Crosses MA). Set crossType to "above" or "below". Do NOT use MA-7 for this — MA-7 is only for two MAs crossing each other.
- To compare two moving averages (e.g. "50 SMA above 200 SMA", "EMA cross", "golden cross"), use MA-8 (MA Comparison) with the direction parameter. Do NOT use MA-6 for this purpose.
- MA-7 (MA Crossover) is ONLY for detecting when two MAs cross each other (golden cross / death cross). It does NOT detect price crossing a single MA.
- MA-6 (MA Distance/Convergence) is ONLY for measuring how close two MAs are to each other in percentage terms. It does NOT check which one is above the other.
- MA-1/MA-2 compare PRICE vs a single MA, not two MAs against each other.
- When the user says "MA above/below another MA", always use MA-8 with direction "fast_above_slow" or "fast_below_slow".
- For golden cross detection, use MA-8 with fastPeriod=50, slowPeriod=200, direction=fast_above_slow.

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

AMBIGUITY EXPANSION RULE: When the user's description is vague about a specific parameter value (e.g., "a moving average" without specifying which period, "pulled back to an MA", "near a support level"), you MUST expand the ambiguity into multiple parallel thoughts connected by OR logic rather than arbitrarily picking one value.

Common ambiguity patterns to expand:
- "a moving average" / "an MA" / "the MA" (unspecified) → Create parallel thoughts for the most commonly used MAs: 10 EMA, 21 EMA, 50 SMA. Connect each with an OR edge to RESULTS.
- "pulled back to a moving average" → Multiple thoughts, each checking proximity to a different common MA period. Connect each with an OR edge to RESULTS.
- "either X or Y" / "X or Y" → Explicit OR logic. Create separate thoughts for X and Y, connect with OR edges.
- "a support level" (unspecified type) → OR branches for MA support, prior pivot support, etc.

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

MULTI-TIMEFRAME PATTERN:
When the user wants a daily filter (e.g., gap up) combined with intraday alternatives (e.g., pullback to MA), set the timeframe field on each thought independently:
  Thought A: "Overnight Gap Up" — timeframe: "daily" (no explicit edges → AND required)
  Thought B: "Pullback to 10 EMA" — timeframe: "intraday"
  Thought C: "Pullback to 21 EMA" — timeframe: "intraday"
  Thought D: "Pullback to 50 SMA" — timeframe: "intraday"
  "edges": [
    { "from": "B", "to": "RESULTS", "logicType": "OR" },
    { "from": "C", "to": "RESULTS", "logicType": "OR" },
    { "from": "D", "to": "RESULTS", "logicType": "OR" }
  ]
  The scan engine evaluates each thought on its specified timeframe. Daily prerequisite + intraday alternatives is a powerful pattern.

Example: User says "Find stocks that pulled back to a moving average"
BAD (picking one arbitrarily):
  Thought A: MA-3 with period=21 → Results
GOOD (expanding the ambiguity — each alternative gets its own thought with OR edges):
  Thought A: "Pullback to 10 EMA" — MA-3 with period=10, maType=ema, maxPct=2
  Thought B: "Pullback to 21 EMA" — MA-3 with period=21, maType=ema, maxPct=2
  Thought C: "Pullback to 50 SMA" — MA-3 with period=50, maType=sma, maxPct=2
  "edges": [
    { "from": "A", "to": "RESULTS", "logicType": "OR" },
    { "from": "B", "to": "RESULTS", "logicType": "OR" },
    { "from": "C", "to": "RESULTS", "logicType": "OR" }
  ]
  A ticker passes if it pulls back to ANY of these MAs (OR logic).

Example: User says "Find stocks in an uptrend that gapped up and pulled back to a moving average and either went into a base or are lingering around the MA"
This should produce 5+ thoughts:
  Thought A (thoughtKey "A"): "Uptrend Filter" — MA-1 (price above 50 SMA) + MA-8 (50 above 200) + MA-4 (MA slope rising)
  Thought B (thoughtKey "B"): "Overnight Gap Up" — gap detection criteria
  Thought C (thoughtKey "C"): "Pullback to 10 EMA" — MA-3 with period=10, maType=ema, maxPct=2
  Thought D (thoughtKey "D"): "Pullback to 21 EMA" — MA-3 with period=21, maType=ema, maxPct=2
  Thought E (thoughtKey "E"): "Pullback to 50 SMA" — MA-3 with period=50, maType=sma, maxPct=2
  A and B have NO explicit edges → they auto-connect to Results with AND logic (both required).
  C, D, E need explicit OR edges (any MA pullback is acceptable):
  "edges": [
    { "from": "C", "to": "RESULTS", "logicType": "OR" },
    { "from": "D", "to": "RESULTS", "logicType": "OR" },
    { "from": "E", "to": "RESULTS", "logicType": "OR" }
  ]
  Final scan behavior: A stock must pass Uptrend AND Gap Up AND (Pullback to 10 EMA OR Pullback to 21 EMA OR Pullback to 50 SMA).

When the user IS specific (e.g., "pulled back to the 21 EMA"), do NOT expand — just use the specified value in a single thought.

CRITICAL: You MUST return an "edges" array in your JSON response. If you omit edges, ALL thoughts auto-connect to Results with AND logic, which is WRONG for alternative thoughts. When you have 2+ thoughts that represent alternatives (same indicator, different params), you MUST include explicit OR edges for them. NEVER rely on the default — always return edges.

EDGE FORMAT WITH LOGIC TYPE:
Each edge can optionally include a logicType field:
{ "from": "A", "to": "RESULTS", "logicType": "OR" }
{ "from": "B", "to": "RESULTS" }  // defaults to AND
{ "from": "C", "to": "D", "logicType": "AND" }  // AND is valid for thought-to-thought (data-link) edges

Use OR ONLY on edges targeting RESULTS when the user describes alternatives. Use AND (or omit logicType) for prerequisite/data-link thought-to-thought edges.

When creating OR branches, keep each branch thought focused on ONE specific alternative (e.g., one MA period per thought). Don't combine multiple alternatives into one thought — that defeats the purpose of OR logic.

Select the most appropriate indicators and set parameters that match the user's description. Set inverted to true when the user wants the opposite of what the indicator normally checks (e.g., "price below the 50 SMA" when the indicator checks "above").`;

      const openai = getOpenAI();
      if (!openai) {
        return res.status(500).json({ error: "AI service not configured. Please ensure OpenAI API key is set." });
      }

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
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
      let result: any;
      if (parsed.thoughts && Array.isArray(parsed.thoughts)) {
        result = parsed;
      } else {
        result = {
          thoughts: [{ thoughtKey: "A", ...parsed }],
          edges: [],
        };
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

      const indicatorSummary = INDICATOR_LIBRARY.map((ind) => ({
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
  "category": "One of: Momentum, Value, Trend, Volatility, Volume, Custom",
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

      const { nodes, edges, universe, ideaId } = req.body;
      if (!nodes || !edges || !universe) {
        return res.status(400).json({ error: "nodes, edges, and universe are required" });
      }

      const tickers = getUniverseTickers(universe);
      if (tickers.length === 0) {
        return res.status(400).json({ error: "Invalid universe" });
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
      const evalOrder = topoSort(thoughtNodes, thoughtEdges);
      const sortedThoughtNodes = evalOrder.map((id: string) => thoughtNodes.find((n: any) => n.id === id)!).filter(Boolean);
      console.log(`[BigIdea Scan] Evaluation order: ${sortedThoughtNodes.map((n: any) => `"${n.thoughtName}"`).join(" → ")}`);

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
        perThought: Record<string, { name: string; passed: number; failed: number; failedTickers: string[] }>;
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
        funnelData.perThought[node.id] = { name: node.thoughtName || "Unnamed", passed: 0, failed: 0, failedTickers: [] };
      }

      let fetchFailCount = 0;
      let tooFewCandlesCount = 0;
      const BATCH_SIZE = 10;
      for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
        const batch = tickers.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(
          batch.map(async (symbol) => {
            try {
              const candlesByTimeframe: Record<string, CandleData[]> = {};
              for (const tf of timeframesArray) {
                candlesByTimeframe[tf] = await fetchOHLCV(symbol, tf);
              }

              const dailyCandles = candlesByTimeframe["daily"] || [];
              if (dailyCandles.length < 20 && timeframesNeeded.has("daily")) {
                tooFewCandlesCount++;
                if (timeframesNeeded.size === 1) return null;
              }

              const nodeResults: Record<string, boolean> = {};
              const nodeOutputData: Record<string, Record<string, any>> = {};
              const nodeCriteriaResults: Record<string, CriterionResult[]> = {};
              const effectivelyMutedNodes = new Set<string>();

              for (const node of sortedThoughtNodes) {
                if (node.isMuted) {
                  nodeResults[node.id] = true;
                  effectivelyMutedNodes.add(node.id);
                  continue;
                }
                const tf = node.thoughtTimeframe || "daily";
                const candles = candlesByTimeframe[tf] || [];
                const minBars = tf === "daily" ? 20 : 10;
                if (candles.length < minBars) {
                  nodeResults[node.id] = false;
                  continue;
                }

                const upstreamNodes = edges
                  .filter((e: any) => e.target === node.id)
                  .map((e: any) => e.source);
                const mergedUpstream: Record<string, any> = {};
                for (const srcId of upstreamNodes) {
                  const srcData = nodeOutputData[srcId];
                  if (srcData) Object.assign(mergedUpstream, srcData);
                }

                const evalResult = evaluateThoughtCriteria(
                  node.thoughtCriteria,
                  candles,
                  spyCandles.length > 0 ? spyCandles : undefined,
                  candlesByTimeframe,
                  Object.keys(mergedUpstream).length > 0 ? mergedUpstream : undefined
                );

                if (evalResult.allMuted) {
                  effectivelyMutedNodes.add(node.id);
                }
                let passed = evalResult.pass;
                if (node.isNot) passed = !passed;
                nodeResults[node.id] = passed;
                nodeCriteriaResults[node.id] = evalResult.criteriaResults;
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
                const prov = srcInd.provides.find((p) => p.linkType === "basePeriod");
                if (prov) {
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
        } catch (err: any) {
          console.error("[BigIdea Scan] Failed to create session:", err?.message);
        }
      }

      res.json({ results, thoughtCounts, linkOverrides, dynamicDataFlows, funnelData, sessionId });
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

      const { symbol, rating, ideaId, sessionId, scanConfig, indicatorSnapshot, price } = req.body;
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
        })
        .returning();

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

      const systemPrompt = `You are a stock scanner tuning assistant. Analyze the scan configuration and failure funnel data to suggest parameter adjustments that will improve scan results quality.

RULES:
- Never suggest changing auto-linked parameters (marked autoLinked: true) — they are dynamically set per-stock
- All suggested values MUST be within the min/max bounds provided
- Suggest at most 5 parameter changes
- Focus on the indicators that reject the most stocks (highest rejection rate)
- Use diagnostic samples to understand WHY stocks are being rejected
- If the scan produces too few results, suggest loosening the tightest filters
- If too many results, suggest tightening the weakest filters
- Consider the user's chart ratings when available
- When historical learning data is available, use it to inform your suggestions — prefer parameter directions and values that led to accepted sessions and good thumbs-up retention
- Pay special attention to CURRENT REGIME, CURRENT UNIVERSE, and ARCHETYPE sections — these show how parameters performed in conditions similar to right now
- If a regime or archetype shows low retention, consider adjusting parameters differently than all-time averages suggest
- AVOID suggesting parameter changes that were previously discarded by users or listed in AVOID PARAMS

Return a JSON object with this exact structure:
{
  "suggestions": [
    {
      "indicatorId": "string",
      "indicatorName": "string",
      "paramName": "string",
      "currentValue": number,
      "suggestedValue": number,
      "reason": "string (1-2 sentences explaining the change)"
    }
  ],
  "overallAnalysis": "string (2-3 sentences about the scan's filtering behavior)"
}`;

      const userMessage = `Scan configuration:
Universe: ${universe || "unknown"} (${funnelData.totalTickers} tickers)
Results found: ${resultCount || 0}

Indicator metadata with current params and bounds:
${JSON.stringify(indicatorMeta, null, 2)}

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
        max_completion_tokens: 1500,
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
          if (!s.indicatorId || !s.paramName || s.suggestedValue === undefined) return false;
          const val = Number(s.suggestedValue);
          if (isNaN(val)) return false;
          s.suggestedValue = val;

          const indMeta = indicatorMeta.find(m => m.id === s.indicatorId);
          if (!indMeta) return false;
          const param = indMeta.currentParams.find((p: any) => p.name === s.paramName);
          if (param?.autoLinked) return false;
          const bound = indMeta.bounds.find((b: any) => b.name === s.paramName);
          if (bound) {
            s.suggestedValue = Math.max(bound.min, Math.min(bound.max, s.suggestedValue));
            if (bound.step && bound.step >= 1) {
              s.suggestedValue = Math.round(s.suggestedValue / bound.step) * bound.step;
            }
          }
          s.currentValue = param?.value ?? s.currentValue;
          s.indicatorName = s.indicatorName || indMeta.name;
          s.reason = s.reason || "Parameter adjustment suggested by AI";
          return true;
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
}
