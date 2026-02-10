import { Express, Request, Response } from "express";
import { db, isDatabaseAvailable } from "../db";
import { scannerThoughts, scannerIdeas, scannerFavorites } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { INDICATOR_LIBRARY, CandleData } from "./indicators";
import OpenAI from "openai";

let yahooFinance: any = null;
async function getYahooFinance() {
  if (!yahooFinance) {
    const mod = await import("yahoo-finance2");
    yahooFinance = mod.default || mod;
  }
  return yahooFinance;
}

function getOpenAI(): OpenAI | null {
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  if (!apiKey) return null;
  return new OpenAI({ apiKey, baseURL });
}

const ohlcvCache = new Map<string, { data: CandleData[]; timestamp: number }>();
const CACHE_TTL = 60 * 60 * 1000;

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

async function fetchOHLCV(symbol: string): Promise<CandleData[]> {
  const cached = ohlcvCache.get(symbol);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - 1);

    const yf = await getYahooFinance();
    const result = await yf.chart(symbol, {
      period1: startDate,
      period2: endDate,
      interval: "1d",
    });

    const candles: CandleData[] = ((result as any).quotes || [])
      .filter((q: any) => q.open != null && q.high != null && q.low != null && q.close != null)
      .map((q: any) => ({
        date: new Date(q.date).toISOString().split("T")[0],
        open: q.open,
        high: q.high,
        low: q.low,
        close: q.close,
        volume: q.volume || 0,
      }))
      .reverse();

    ohlcvCache.set(symbol, { data: candles, timestamp: Date.now() });
    return candles;
  } catch (err) {
    console.error(`Failed to fetch OHLCV for ${symbol}:`, err);
    return [];
  }
}

function evaluateThoughtCriteria(
  criteria: any[],
  candles: CandleData[],
  benchmarkCandles?: CandleData[]
): boolean {
  if (!criteria || criteria.length === 0) return false;

  for (const criterion of criteria) {
    const indicator = INDICATOR_LIBRARY.find((ind) => ind.id === criterion.indicatorId);
    if (!indicator) continue;

    const paramValues: Record<string, any> = {};
    for (const p of criterion.params || []) {
      paramValues[p.name] = p.value;
    }

    let result = indicator.evaluate(candles, paramValues, benchmarkCandles);
    if (criterion.inverted) result = !result;
    if (!result) return false;
  }

  return true;
}

export function registerBigIdeaRoutes(app: Express): void {
  app.get("/api/bigidea/thoughts", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.sentinelUserId;
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
      const userId = (req.session as any)?.sentinelUserId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      if (!isDatabaseAvailable() || !db) {
        return res.status(500).json({ error: "Database not available" });
      }

      const { name, category, description, criteria } = req.body;
      if (!name || !category || !criteria) {
        return res.status(400).json({ error: "name, category, and criteria are required" });
      }

      const [thought] = await db
        .insert(scannerThoughts)
        .values({ userId, name, category, description: description || null, criteria })
        .returning();

      res.status(201).json(thought);
    } catch (error) {
      console.error("Error creating thought:", error);
      res.status(500).json({ error: "Failed to create thought" });
    }
  });

  app.patch("/api/bigidea/thoughts/:id", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.sentinelUserId;
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
      const userId = (req.session as any)?.sentinelUserId;
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

      if (deleted.length === 0) {
        return res.status(404).json({ error: "Thought not found" });
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting thought:", error);
      res.status(500).json({ error: "Failed to delete thought" });
    }
  });

  app.get("/api/bigidea/ideas", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.sentinelUserId;
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
      const userId = (req.session as any)?.sentinelUserId;
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
      const userId = (req.session as any)?.sentinelUserId;
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
      const userId = (req.session as any)?.sentinelUserId;
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
      const userId = (req.session as any)?.sentinelUserId;
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
      const userId = (req.session as any)?.sentinelUserId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

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

Select the most appropriate indicators and set parameters that match the user's description. Use multiple criteria when the description implies multiple conditions. Set inverted to true when the user wants the opposite of what the indicator normally checks (e.g., "price below the 50 SMA" when the indicator checks "above").`;

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
    } catch (error) {
      console.error("Error creating AI thought:", error);
      res.status(500).json({ error: "Failed to generate thought definition" });
    }
  });

  app.post("/api/bigidea/scan", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.sentinelUserId;
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

      let spyCandles: CandleData[] = [];
      try {
        spyCandles = await fetchOHLCV("SPY");
      } catch (e) {
        console.warn("Could not fetch SPY benchmark data");
      }

      const results: Array<{ symbol: string; name: string; price: number; passedPaths: string[] }> = [];
      const thoughtCounts: Record<string, number> = {};

      for (const node of thoughtNodes) {
        thoughtCounts[node.id] = 0;
      }

      const BATCH_SIZE = 10;
      for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
        const batch = tickers.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(
          batch.map(async (symbol) => {
            try {
              const candles = await fetchOHLCV(symbol);
              if (candles.length < 20) return null;

              const nodeResults: Record<string, boolean> = {};

              for (const node of thoughtNodes) {
                let passed = evaluateThoughtCriteria(
                  node.thoughtCriteria,
                  candles,
                  spyCandles.length > 0 ? spyCandles : undefined
                );
                if (node.isNot) passed = !passed;
                nodeResults[node.id] = passed;
                if (passed) thoughtCounts[node.id]++;
              }

              const resultsNode = nodes.find((n: any) => n.type === "results");
              if (!resultsNode) return null;

              const incomingEdges = edges.filter((e: any) => e.target === resultsNode.id);
              if (incomingEdges.length === 0) return null;

              let passesFlow = false;
              const passedPaths: string[] = [];

              const hasAndEdges = incomingEdges.some((e: any) => e.logicType === "AND");
              const hasOrEdges = incomingEdges.some((e: any) => e.logicType === "OR");

              if (hasAndEdges && !hasOrEdges) {
                passesFlow = incomingEdges.every((e: any) => nodeResults[e.source] === true);
                if (passesFlow) {
                  for (const e of incomingEdges) {
                    const srcNode = thoughtNodes.find((n: any) => n.id === e.source);
                    if (srcNode) passedPaths.push(srcNode.thoughtName || srcNode.id);
                  }
                }
              } else if (hasOrEdges && !hasAndEdges) {
                for (const e of incomingEdges) {
                  if (nodeResults[e.source] === true) {
                    passesFlow = true;
                    const srcNode = thoughtNodes.find((n: any) => n.id === e.source);
                    if (srcNode) passedPaths.push(srcNode.thoughtName || srcNode.id);
                  }
                }
              } else {
                const andEdges = incomingEdges.filter((e: any) => e.logicType === "AND");
                const orEdges = incomingEdges.filter((e: any) => e.logicType === "OR");

                const andPass = andEdges.length === 0 || andEdges.every((e: any) => nodeResults[e.source] === true);
                let orPass = orEdges.length === 0;

                for (const e of orEdges) {
                  if (nodeResults[e.source] === true) {
                    orPass = true;
                    const srcNode = thoughtNodes.find((n: any) => n.id === e.source);
                    if (srcNode) passedPaths.push(srcNode.thoughtName || srcNode.id);
                  }
                }

                if (andPass) {
                  for (const e of andEdges) {
                    const srcNode = thoughtNodes.find((n: any) => n.id === e.source);
                    if (srcNode) passedPaths.push(srcNode.thoughtName || srcNode.id);
                  }
                }

                passesFlow = andPass && orPass;
              }

              if (passesFlow) {
                return {
                  symbol,
                  name: symbol,
                  price: candles[0].close,
                  passedPaths,
                };
              }

              return null;
            } catch (err) {
              console.error(`Scan error for ${symbol}:`, err);
              return null;
            }
          })
        );

        for (const r of batchResults) {
          if (r) results.push(r);
        }
      }

      res.json({ results, thoughtCounts });
    } catch (error) {
      console.error("Error executing scan:", error);
      res.status(500).json({ error: "Failed to execute scan" });
    }
  });

  app.post("/api/bigidea/favorites", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.sentinelUserId;
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
      const userId = (req.session as any)?.sentinelUserId;
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
      const userId = (req.session as any)?.sentinelUserId;
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
