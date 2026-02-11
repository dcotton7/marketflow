import { Express, Request, Response } from "express";
import { db, isDatabaseAvailable } from "../db";
import { scannerThoughts, scannerIdeas, scannerFavorites } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { INDICATOR_LIBRARY, CandleData, normalizeResult } from "./indicators";
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

function getUniverseTickers(universe: string): string[] {
  switch (universe) {
    case "dow30":
      return [
        "AAPL","AMGN","AXP","BA","CAT","CRM","CSCO","CVX","DIS","DOW",
        "GS","HD","HON","IBM","INTC","JNJ","JPM","KO","MCD","MMM",
        "MRK","MSFT","NKE","PG","TRV","UNH","V","VZ","WBA","WMT"
      ];
    case "nasdaq100":
      return [
        "AAPL","ABNB","ADBE","ADI","ADP","ADSK","AEP","AMAT","AMGN","AMZN",
        "ANSS","ARM","ASML","AVGO","AZN","BIIB","BKNG","BKR","CCEP","CDNS",
        "CDW","CEG","CHTR","CMCSA","COST","CPRT","CRWD","CSGP","CTAS","CTSH",
        "DASH","DDOG","DLTR","DXCM","EA","EXC","FANG","FAST","FTNT","GEHC",
        "GFS","GILD","GOOG","GOOGL","HON","IDXX","ILMN","INTC","INTU","ISRG",
        "KDP","KHC","KLAC","LIN","LRCX","LULU","MAR","MCHP","MDB","MDLZ",
        "MELI","META","MNST","MRNA","MRVL","MSFT","MU","NFLX","NVDA","NXPI",
        "ODFL","ON","ORLY","PANW","PAYX","PCAR","PDD","PEP","PYPL","QCOM",
        "REGN","ROP","ROST","SBUX","SNPS","SPLK","TEAM","TMUS","TSLA","TTD",
        "TTWO","TXN","VRSK","VRTX","WBD","WDAY","XEL","ZM","ZS"
      ];
    case "sp500":
      return [
        "AAPL","MSFT","AMZN","NVDA","GOOGL","META","TSLA","BRK.B","UNH","JNJ",
        "XOM","JPM","V","PG","MA","HD","CVX","MRK","ABBV","LLY",
        "PEP","KO","AVGO","COST","TMO","MCD","WMT","CSCO","ABT","CRM",
        "ACN","DHR","NEE","LIN","TXN","AMD","ADBE","PM","WFC","NFLX",
        "UPS","RTX","ORCL","HON","INTC","LOW","QCOM","BA","AMGN","IBM",
        "AMAT","CAT","GE","SBUX","MS","BLK","DE","GS","ISRG","MDLZ",
        "ADP","GILD","ADI","BKNG","VRTX","PLD","MMC","SYK","REGN","SCHW",
        "CB","LRCX","C","ZTS","TMUS","MO","CI","EOG","SO","DUK",
        "BDX","CME","BSX","CL","PGR","SLB","FIS","HUM","MCK","SNPS",
        "PYPL","EQIX","APD","AON","MU","ITW","ICE","KLAC","SHW","CDNS"
      ];
    case "russell2000":
      return [
        "AAON","AAXN","ABCB","ABTX","ACAD","ACIA","ACLS","AEIS","AERI","AGYS",
        "AIMC","AJRD","ALGT","AMED","AMPH","AMWD","ANAT","ANGO","APOG","AQUA",
        "ARCB","ARCO","ARES","ARLO","ARNC","AROC","ARWR","ASGN","ASTE","ATEX",
        "ATKR","AVAV","AVNS","AXNX","AYI","BBSI","BCEI","BCPC","BCRX","BEAT",
        "BHF","BJRI","BL","BLKB","BMCH","BOOT","BRKR","BSIG","BWA","CALX",
        "CARG","CARS","CASA","CATY","CBRL","CBU","CCB","CCOI","CENX","CERS",
        "CHCO","CHE","CHGG","CHH","CIEN","CIVB","CLBK","CLDX","CLNE","CLVS",
        "CMP","CNMD","CNNE","COHU","COLM","CONN","CORE","CORT","CRC","CREE",
        "CRK","CROX","CRS","CRVL","CSGP","CSII","CSWI","CTRE","CUBI","CVCO",
        "CVI","CVLT","CW","CWST","DCOM","DIOD","DLB","DNLI","DORM","DRH",
        "EAT","EBS","ECHO","EGP","EGOV","ELVT","ENSG","EPRT","ERF","ESGR",
        "ESSE","EVBG","EVRI","EXLS","EXPO","FARO","FATE","FBNC","FBP","FCFS",
        "FELE","FHB","FIBK","FIVE","FIVN","FLGT","FLR","FMBI","FNB","FOLD",
        "FORM","FOXF","FRME","FSS","FSTR","FTDR","FUL","GBX","GDEN","GEO",
        "GKOS","GLNG","GNRC","GNTX","GPI","GRWG","GTY","GWRE","HAIN","HALO",
        "HAYW","HBI","HCAT","HCSG","HELE","HESM","HHC","HIBB","HLI","HLNE",
        "HMN","HNI","HOMB","HP","HQY","HRI","HUBG","HWC","IAA","IART",
        "ICFI","ICUI","IIVI","INDB","INGN","INTA","IOSP","IPAR","IRWD","ITCI",
        "JBT","JBGS","JCOM","KFRC","KMT","KNX","KREF","KWR","LANC","LBRT",
        "LFUS","LGIH","LHCG","LIVN","LKFN","LNTH","LOPE","LPRO","LSTR","MATX"
      ];
    default:
      return [];
  }
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
  for (const p of criterion.params || []) {
    paramValues[p.name] = p.value;
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
  if (!criteria || criteria.length === 0) return { pass: false, outputData: {}, criteriaResults: [] };

  const activeCriteria = criteria.filter((c: any) => !c.muted);
  if (activeCriteria.length === 0) return { pass: false, outputData: {}, criteriaResults: [] };

  const outputData: Record<string, any> = {};
  const criteriaResults: CriterionResult[] = [];
  let allPass = true;

  for (const criterion of activeCriteria) {
    const repaired = repairCriterion(criterion);
    const indicator = INDICATOR_LIBRARY.find((ind) => ind.id === repaired.indicatorId);
    if (!indicator) continue;

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

  return { pass: allPass, outputData, criteriaResults };
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
        })),
      }));

      const systemPrompt = `You are a stock screening assistant. The user will describe a trading idea or screening concept in plain English. Your job is to translate it into one or more structured "Thought" definitions using the available indicator library.

Available indicators:
${JSON.stringify(indicatorSummary, null, 2)}

CRITICAL: DATA-LINKING AND MULTI-THOUGHT SPLITTING — HARD RULES
Some indicators "provide" dynamic data (e.g. PA-3 outputs detectedPeriod — the detected base length) and others "consume" that data (e.g. PA-12, PA-13, PA-14, PA-15, PA-16 consume detectedPeriod). Data can ONLY flow between SEPARATE thoughts connected by an edge — it does NOT work within the same thought.

PROVIDER indicators: PA-3, PA-7
CONSUMER indicators: PA-12, PA-13, PA-14, PA-15, PA-16

HARD RULE: A consumer indicator must NEVER be in the same thought as its provider. If the user's idea includes ANY provider AND ANY consumer from the lists above, you MUST split them:
- Thought A (upstream): Contains the PROVIDER indicator (PA-3 or PA-7) and any non-linked indicators (MA-*, VOL-* etc.)
- Thought B (downstream): Contains ALL consumer indicators (PA-12, PA-13, PA-14, PA-15, PA-16) — every single one goes here, no exceptions
- Edge: A → B

This is mandatory even if there is only ONE consumer. For example, if the idea uses PA-3 + PA-16, that is TWO thoughts with an edge, never one thought.

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
      "value": "the value to use"
    }
  ]
}

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
      "value": "the value to use"
    }
  ]
}`;

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

      const { nodes, edges, universe } = req.body;
      if (!nodes || !edges || !universe) {
        return res.status(400).json({ error: "nodes, edges, and universe are required" });
      }

      const tickers = getUniverseTickers(universe);
      if (tickers.length === 0) {
        return res.status(400).json({ error: "Invalid universe" });
      }

      const thoughtNodes = nodes.filter((n: any) => n.type === "thought" && n.thoughtCriteria);

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

      for (const node of thoughtNodes) {
        thoughtCounts[node.id] = 0;
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

              for (const node of thoughtNodes) {
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

                let passed = evalResult.pass;
                if (node.isNot) passed = !passed;
                nodeResults[node.id] = passed;
                nodeCriteriaResults[node.id] = evalResult.criteriaResults;
                if (passed) {
                  thoughtCounts[node.id]++;
                }
                if (evalResult.outputData && Object.keys(evalResult.outputData).length > 0) {
                  nodeOutputData[node.id] = evalResult.outputData;
                }
              }

              const resultsNode = nodes.find((n: any) => n.type === "results");
              if (!resultsNode) return null;

              const anyEdgeToResults = edges.some((e: any) => e.target === resultsNode.id);
              if (!anyEdgeToResults) return null;

              const computeEffectivePass = (nodeId: string, visited: Set<string> = new Set()): boolean => {
                if (visited.has(nodeId)) return nodeResults[nodeId] ?? false;
                visited.add(nodeId);

                const incoming = edges.filter((e: any) => e.target === nodeId);
                const ownResult = nodeResults[nodeId];

                if (incoming.length === 0) {
                  return ownResult ?? false;
                }

                const andEdges = incoming.filter((e: any) => (e.logicType || "AND") === "AND");
                const orEdges = incoming.filter((e: any) => e.logicType === "OR");

                const copyVisited = () => { const s = new Set<string>(); visited.forEach(v => s.add(v)); return s; };

                const andPass = andEdges.length === 0 || andEdges.every((e: any) =>
                  computeEffectivePass(e.source, copyVisited())
                );

                const orPass = orEdges.length === 0 || orEdges.some((e: any) =>
                  computeEffectivePass(e.source, copyVisited())
                );

                if (ownResult === undefined) {
                  return andPass && orPass;
                }

                if (orEdges.length > 0) {
                  return (ownResult || orPass) && andPass;
                } else {
                  return ownResult && andPass;
                }
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

      console.log(`[BigIdea Scan] Complete: ${results.length} results from ${tickers.length} tickers (fetchFails=${fetchFailCount}, tooFewCandles=${tooFewCandlesCount})`);
      console.log(`[BigIdea Scan] ThoughtCounts:`, JSON.stringify(thoughtCounts));
      if (dynamicDataFlows.length > 0) {
        console.log(`[BigIdea Scan] Dynamic data flows:`, dynamicDataFlows.map(d => `${d.provider} → ${d.consumer}: ${d.dataKey}`));
      }
      res.json({ results, thoughtCounts, linkOverrides, dynamicDataFlows });
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
}
