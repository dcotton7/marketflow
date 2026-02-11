import { Express, Request, Response } from "express";
import { db, isDatabaseAvailable } from "../db";
import { scannerThoughts, scannerIdeas, scannerFavorites } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { INDICATOR_LIBRARY, CandleData } from "./indicators";
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

function evaluateThoughtCriteria(
  criteria: any[],
  candles: CandleData[],
  benchmarkCandles?: CandleData[],
  candlesByTimeframe?: Record<string, CandleData[]>
): boolean {
  if (!criteria || criteria.length === 0) return false;

  const activeCriteria = criteria.filter((c: any) => !c.muted);
  if (activeCriteria.length === 0) return false;

  for (const criterion of activeCriteria) {
    const repaired = repairCriterion(criterion);
    const indicator = INDICATOR_LIBRARY.find((ind) => ind.id === repaired.indicatorId);
    if (!indicator) continue;

    const overrideTf = criterion.timeframeOverride;
    const useCandles = (overrideTf && candlesByTimeframe && candlesByTimeframe[overrideTf])
      ? candlesByTimeframe[overrideTf]
      : candles;

    let result = indicator.evaluate(useCandles, repaired.params, benchmarkCandles);
    if (criterion.inverted) result = !result;
    if (!result) return false;
  }

  return true;
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

      const systemPrompt = `You are a stock screening assistant. The user will describe a trading idea or screening concept in plain English. Your job is to translate it into a structured "Thought" definition using the available indicator library.

Available indicators:
${JSON.stringify(indicatorSummary, null, 2)}

You must respond with valid JSON in this exact format:
{
  "name": "Short descriptive name for this thought",
  "category": "One of: Momentum, Value, Trend, Volatility, Volume, Custom",
  "description": "Plain English summary of what this thought screens for",
  "criteria": [
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

Examples:
- "Price within 1% of 50 SMA" → 1 criterion: MA-3 Price vs MA Distance: period=50, minPct=0, maxPct=1
- "Price above 50 SMA" → 1 criterion: MA-1 SMA Value: period=50, direction=above
- "Price crossed below the daily 50 SMA recently" → 1 criterion: MA-9 Price Crosses MA: maPeriod=50, maType=sma, lookback=5, crossType=below, timeframeOverride="daily"
- "Price broke above 20 EMA" → 1 criterion: MA-9 Price Crosses MA: maPeriod=20, maType=ema, lookback=3, crossType=above (no timeframeOverride since it uses the thought's timeframe)
- "Pullback to 50 SMA with volume dry-up in uptrend" → 3 criteria: (1) MA-3 proximity, (2) VOL-4 volume dry-up, (3) MA-1 above 200 SMA for uptrend context
- "Breakout with volume" → 2 criteria: (1) PA-7 Breakout Detection: basePeriod=20, lookback=3, (2) VOL-5 Volume Surge: period=50, surgeMultiple=2.0, priceUp=true
- "Strong uptrend" → 3 criteria: (1) MA-1 SMA Value: period=50, direction=above, (2) MA-8 MA Comparison: fastPeriod=50, slowPeriod=200, direction=fast_above_slow, (3) MA-4 MA Slope: period=50, slopeDays=10, minSlope=0.5

The number of criteria should match the complexity of the idea. Simple ideas get 1 criterion. Complex multi-condition ideas get as many as needed.

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

      const thought = JSON.parse(content);
      res.json(thought);
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

              for (const node of thoughtNodes) {
                const tf = node.thoughtTimeframe || "daily";
                const candles = candlesByTimeframe[tf] || [];
                const minBars = tf === "daily" ? 20 : 10;
                if (candles.length < minBars) {
                  nodeResults[node.id] = false;
                  continue;
                }
                let passed = evaluateThoughtCriteria(
                  node.thoughtCriteria,
                  candles,
                  spyCandles.length > 0 ? spyCandles : undefined,
                  candlesByTimeframe
                );
                if (node.isNot) passed = !passed;
                nodeResults[node.id] = passed;
                if (passed) thoughtCounts[node.id]++;
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
                return {
                  symbol,
                  name: symbol,
                  price: priceCandles.length > 0 ? priceCandles[0].close : 0,
                  passedPaths,
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

      console.log(`[BigIdea Scan] Complete: ${results.length} results from ${tickers.length} tickers (fetchFails=${fetchFailCount}, tooFewCandles=${tooFewCandlesCount})`);
      console.log(`[BigIdea Scan] ThoughtCounts:`, JSON.stringify(thoughtCounts));
      res.json({ results, thoughtCounts });
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
