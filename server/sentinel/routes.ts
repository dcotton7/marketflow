import type { Express, Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import bcrypt from "bcryptjs";
import { z } from "zod";
import OpenAI from "openai";
import { eq, and, or, not, inArray, sql, isNull, desc } from "drizzle-orm";
import { db } from "../db";
import { sentinelModels } from "./models";
import { evaluateTrade } from "./evaluate";
import { generateSuggestions, type SuggestRequest } from "./suggest";
import { startMonitoring } from "./monitor";
import { fetchMarketSentiment, fetchSectorSentiment, getSentimentCacheAge } from "./sentiment";
import type { EvaluationRequest, TradeUpdate, DashboardData, TradeWithEvaluation, EventWithTrade } from "./types";
import { sentinelTrades, sentinelTradeLabels, sentinelTradeToLabels, sentinelUsers, insertSentinelTradeLabelSchema, sentinelImportBatches, sentinelImportedTrades, sentinelAccountSettings, sentinelRulePerformance, sentinelRules, sentinelEvaluations, sentinelEvents, sentinelOrderLevels } from "@shared/schema";
import * as tnn from "./tnn";
import { parseCSV, detectBroker, type ParseResult, type BrokerId } from "./tradeImport";
import { fetchChartData, calculatePointTechnicals, calculateFullSetupMetrics, findNearestMA, calculateRSvsSPY, calculateAnchoredVWAPValues, countResistanceTouches } from "./patternTrainingEngine";
import { patternTrainingSetups, patternTrainingPoints } from "@shared/schema";

declare module "express-session" {
  interface SessionData {
    userId?: number;
    username?: string;
  }
}

const registerSchema = z.object({
  username: z.string().min(3).max(50),
  email: z.string().email(),
  password: z.string().min(6),
});

const loginSchema = z.object({
  username: z.string(),
  password: z.string(),
});

const evaluateSchema = z.object({
  symbol: z.string().min(1).max(10),
  direction: z.enum(["long", "short"]),
  entryPrice: z.number().positive(),
  stopPrice: z.number().positive().optional(),
  stopPriceLevel: z.string().optional(),
  targetPrice: z.number().positive().optional(), // First profit trim
  targetPriceLevel: z.string().optional(),
  targetProfitPrice: z.number().positive().optional(), // Full position exit target
  targetProfitLevel: z.string().optional(),
  positionSize: z.number().positive().optional(),
  positionSizeUnit: z.enum(["shares", "dollars"]).optional(),
  thesis: z.string().optional(),
  setupType: z.enum([
    "breakout", "pullback", "cup_and_handle", "vcp", "episodic_pivot", 
    "reclaim", "high_tight_flag", "low_cheat", "undercut_rally", "orb",
    "short_lost_50", "short_lost_200", "other"
  ]).optional(),
  deepEval: z.boolean().optional(),
  historicalAnalysis: z.boolean().optional(),
  tradeDate: z.string().optional(),
  tradeTime: z.string().optional(),
});

const lotEntrySchema = z.object({
  id: z.string(),
  dateTime: z.string(),
  qty: z.string(),
  buySell: z.enum(["buy", "sell"]),
  price: z.string(),
});

const updateTradeSchema = z.object({
  stopPrice: z.number().positive().optional(),
  partialPrice: z.number().positive().optional(),
  targetPrice: z.number().positive().optional(),
  entryPrice: z.number().positive().optional(),
  entryDate: z.string().optional(),
  exitPrice: z.number().positive().optional(),
  positionSize: z.number().positive().optional(),
  status: z.enum(["considering", "active", "closed"]).optional(),
  lotEntries: z.array(lotEntrySchema).optional(),
});

const closeTradeSchema = z.object({
  exitPrice: z.number().positive(),
  outcome: z.enum(["win", "loss", "breakeven"]),
  rulesFollowed: z.record(z.boolean()).optional(),
  notes: z.string().optional(),
});

const suggestSchema = z.object({
  symbol: z.string().min(1).max(10),
  direction: z.enum(["long", "short"]),
  entryPrice: z.number().positive(),
  setupType: z.string().optional(),
});

const watchlistSchema = z.object({
  symbol: z.string().min(1).max(10),
  targetEntry: z.number().positive().optional(),
  stopPlan: z.number().positive().optional(),
  targetPlan: z.number().positive().optional(),
  alertPrice: z.number().positive().optional(),
  thesis: z.string().optional(),
  priority: z.enum(["high", "medium", "low"]).optional(),
});

const ruleSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  category: z.enum([
    "entry", "exit", "sizing", "risk", "general", 
    "auto_reject", "profit_taking", "stop_loss", "ma_structure", 
    "base_quality", "breakout", "position_sizing", "market_regime"
  ]).optional(),
  order: z.number().optional(),
});

const importPreviewSchema = z.object({
  csvContent: z.string().min(1, "CSV content is required"),
  fileName: z.string().optional(),
  brokerId: z.enum(["FIDELITY", "SCHWAB", "ROBINHOOD", "fidelity", "schwab", "robinhood", "unknown"]).optional(),
  timestampOverride: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Invalid time format (HH:MM)").optional(),
});

const importConfirmSchema = z.object({
  csvContent: z.string().min(1, "CSV content is required"),
  fileName: z.string().optional(),
  brokerId: z.enum(["FIDELITY", "SCHWAB", "ROBINHOOD", "fidelity", "schwab", "robinhood", "unknown"]).optional(),
  timestampOverride: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Invalid time format (HH:MM)").optional(),
});

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

export function registerSentinelRoutes(app: Express): void {
  const PgSession = connectPgSimple(session);
  
  // Trust proxy for production (Replit uses reverse proxy)
  if (process.env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
  }
  
  app.use(
    session({
      store: new PgSession({
        conString: process.env.DATABASE_URL,
        tableName: "session",
        createTableIfMissing: true,
      }),
      secret: process.env.SESSION_SECRET || "sentinel-session-secret",
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: process.env.NODE_ENV === "production",
        httpOnly: true,
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      },
    })
  );

  // TEMPORARY: Password reset for testing - REMOVE AFTER USE
  app.post("/api/auth/temp-reset/:username", async (req: Request, res: Response) => {
    try {
      if (!db) {
        return res.status(500).json({ error: "Database not available" });
      }
      const username = req.params.username;
      const passwordHash = await bcrypt.hash("testpass123", 10);
      const result = await db.update(sentinelUsers)
        .set({ passwordHash })
        .where(eq(sentinelUsers.username, username))
        .returning({ id: sentinelUsers.id });
      if (result.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }
      res.json({ success: true, message: `Password reset to 'testpass123' for ${username}` });
    } catch (error) {
      console.error("Temp reset error:", error);
      res.status(500).json({ error: "Failed to reset password" });
    }
  });

  // TEMPORARY: Create session table if missing - REMOVE AFTER USE
  app.post("/api/admin/create-session-table", async (req: Request, res: Response) => {
    try {
      if (!db) {
        return res.status(500).json({ error: "Database not available" });
      }
      await db.execute(`
        CREATE TABLE IF NOT EXISTS session (
          sid VARCHAR NOT NULL PRIMARY KEY,
          sess JSONB NOT NULL,
          expire TIMESTAMP(6) NOT NULL
        )
      `);
      await db.execute(`CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON session ("expire")`);
      res.json({ success: true, message: "Session table created" });
    } catch (error: any) {
      console.error("Create session table error:", error);
      res.status(500).json({ error: error.message || "Failed to create session table" });
    }
  });

  app.post("/api/auth/register", async (req: Request, res: Response) => {
    try {
      const data = registerSchema.parse(req.body);

      const existingUser = await sentinelModels.getUserByUsername(data.username);
      if (existingUser) {
        return res.status(400).json({ error: "Username already exists" });
      }

      const existingEmail = await sentinelModels.getUserByEmail(data.email);
      if (existingEmail) {
        return res.status(400).json({ error: "Email already exists" });
      }

      const passwordHash = await bcrypt.hash(data.password, 10);
      const user = await sentinelModels.createUser({
        username: data.username,
        email: data.email,
        passwordHash,
      });

      // Seed starter rules for new user
      try {
        await sentinelModels.seedStarterRulesForUser(user.id);
        console.log(`[Sentinel] Seeded ${61} starter rules for user ${user.username}`);
      } catch (seedError) {
        console.error("Failed to seed starter rules:", seedError);
        // Don't fail registration if seeding fails
      }

      req.session.userId = user.id;
      req.session.username = user.username;

      req.session.save((err) => {
        if (err) {
          console.error("Session save error:", err);
          return res.status(500).json({ error: "Registration failed" });
        }
        res.status(201).json({ 
          id: user.id, 
          username: user.username, 
          email: user.email 
        });
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      console.error("Register error:", error);
      res.status(500).json({ error: "Registration failed" });
    }
  });

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      // Simplified login: username only (password not required for now)
      const { username } = req.body;
      
      if (!username || typeof username !== 'string') {
        return res.status(400).json({ error: "Username is required" });
      }

      const user = await sentinelModels.getUserByUsername(username);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }

      // Skip password validation for simplified development login
      // Password check removed for now - just validate username exists

      req.session.userId = user.id;
      req.session.username = user.username;
      
      req.session.save((err) => {
        if (err) {
          console.error("Session save error:", err);
          return res.status(500).json({ error: "Login failed" });
        }
        console.log("[Sentinel Auth] Session saved:", { userId: req.session.userId, sessionID: req.sessionID });
        res.json({ 
          id: user.id, 
          username: user.username, 
          email: user.email 
        });
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      console.error("Login error:", error);
      res.status(500).json({ error: "Login failed" });
    }
  });

  app.post("/api/auth/logout", (req: Request, res: Response) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ error: "Logout failed" });
      }
      res.json({ message: "Logged out" });
    });
  });

  app.get("/api/auth/me", requireAuth, async (req: Request, res: Response) => {
    const user = await sentinelModels.getUserById(req.session.userId!);
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }
    res.json({ id: user.id, username: user.username, email: user.email });
  });

  app.post("/api/sentinel/suggest", requireAuth, async (req: Request, res: Response) => {
    try {
      const data = suggestSchema.parse(req.body);
      console.log("[Sentinel] Suggest request:", data.symbol, data.direction, "entry:", data.entryPrice);
      
      const user = await sentinelModels.getUserById(req.session.userId!);
      const accountSize = user?.accountSize || 100000;
      
      const request: SuggestRequest = {
        symbol: data.symbol.toUpperCase(),
        direction: data.direction,
        entryPrice: data.entryPrice,
        setupType: data.setupType,
      };

      const suggestions = await generateSuggestions(request, accountSize);
      console.log("[Sentinel] Suggestions generated:", suggestions.stopSuggestions.length, "stops,", suggestions.targetSuggestions.length, "targets");
      res.json(suggestions);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      console.error("[Sentinel] Suggest error:", error);
      res.status(500).json({ error: "Failed to generate suggestions" });
    }
  });

  app.post("/api/sentinel/evaluate", requireAuth, async (req: Request, res: Response) => {
    try {
      const data = evaluateSchema.parse(req.body);
      console.log("[Sentinel] Evaluate request:", data.symbol, data.direction);
      
      const request: EvaluationRequest = {
        symbol: data.symbol,
        direction: data.direction,
        entryPrice: data.entryPrice,
        stopPrice: data.stopPrice,
        stopPriceLevel: data.stopPriceLevel,
        targetPrice: data.targetPrice, // First profit trim
        targetPriceLevel: data.targetPriceLevel,
        targetProfitPrice: data.targetProfitPrice, // Full position exit
        targetProfitLevel: data.targetProfitLevel,
        positionSize: data.positionSize,
        positionSizeUnit: data.positionSizeUnit,
        thesis: data.thesis,
        setupType: data.setupType,
        deepEval: data.deepEval,
        historicalAnalysis: data.historicalAnalysis,
        tradeDate: data.tradeDate,
        tradeTime: data.tradeTime,
      };

      const result = await evaluateTrade(request, req.session.userId!);
      console.log("[Sentinel] Evaluate complete - score:", result.evaluation.score);
      res.json(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      console.error("Evaluate error:", error);
      res.status(500).json({ error: "Evaluation failed" });
    }
  });

  app.post("/api/sentinel/commit/:tradeId", requireAuth, async (req: Request, res: Response) => {
    try {
      const tradeId = parseInt(req.params.tradeId as string);
      const trade = await sentinelModels.getTrade(tradeId);

      if (!trade) {
        return res.status(404).json({ error: "Trade not found" });
      }
      if (trade.userId !== req.session.userId) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const updatedTrade = await sentinelModels.updateTrade(tradeId, { status: "active" });

      await sentinelModels.createEvent({
        tradeId,
        userId: req.session.userId!,
        eventType: "status_change",
        oldValue: trade.status,
        newValue: "active",
        description: `Trade committed: ${trade.symbol} ${trade.direction.toUpperCase()}`,
      });

      res.json(updatedTrade);
    } catch (error) {
      console.error("Commit error:", error);
      res.status(500).json({ error: "Failed to commit trade" });
    }
  });

  // Create trade directly (without IVY evaluation)
  const createTradeSchema = z.object({
    symbol: z.string().min(1),
    direction: z.enum(["long", "short"]),
    entryPrice: z.number().positive(),
    positionSize: z.number().positive().optional(),
    stopPrice: z.number().positive().optional(),
    targetPrice: z.number().positive().optional(),
    partialPrice: z.number().positive().optional(),
    thesis: z.string().optional(),
    setupType: z.enum([
      "breakout", "pullback", "cup_and_handle", "vcp", "episodic_pivot", 
      "reclaim", "high_tight_flag", "low_cheat", "undercut_rally", "orb",
      "short_lost_50", "short_lost_200", "other"
    ]).optional(),
    tradeDate: z.string().optional(), // ISO date string
    tradeTime: z.string().optional(), // HH:MM format
    status: z.enum(["considering", "active"]).default("active"),
    accountName: z.string().optional(), // Trading account name
  });

  app.post("/api/sentinel/trades", requireAuth, async (req: Request, res: Response) => {
    try {
      const data = createTradeSchema.parse(req.body);
      const userId = req.session.userId!;

      // Validate accountName belongs to user if provided
      let validatedAccountName: string | undefined = undefined;
      if (data.accountName) {
        const userAccounts = await db!.select()
          .from(sentinelAccountSettings)
          .where(eq(sentinelAccountSettings.userId, userId));
        const validAccount = userAccounts.find(a => a.accountName === data.accountName);
        if (validAccount) {
          validatedAccountName = validAccount.accountName;
        }
        // If accountName provided but not valid, silently ignore (don't reject trade creation)
      }

      // Build entry date from tradeDate + tradeTime
      let entryDate: Date | undefined = undefined;
      if (data.tradeDate) {
        const dateStr = data.tradeDate;
        const timeStr = data.tradeTime || "09:30";
        entryDate = new Date(`${dateStr}T${timeStr}:00`);
      }

      // Build initial lot entries if position size and entry price provided
      const lotEntries = data.positionSize ? [{
        id: `lot_${Date.now()}`,
        dateTime: entryDate?.toISOString() || new Date().toISOString(),
        qty: String(data.positionSize),
        buySell: data.direction === "long" ? "buy" as const : "sell" as const,
        price: String(data.entryPrice),
      }] : undefined;

      const trade = await sentinelModels.createTrade({
        userId,
        symbol: data.symbol.toUpperCase(),
        direction: data.direction,
        entryPrice: data.entryPrice,
        entryDate,
        stopPrice: data.stopPrice,
        targetPrice: data.targetPrice,
        partialPrice: data.partialPrice,
        positionSize: data.positionSize,
        thesis: data.thesis,
        setupType: data.setupType,
        status: data.status,
        lotEntries,
        accountName: validatedAccountName,
      });

      await sentinelModels.createEvent({
        tradeId: trade.id,
        userId,
        eventType: "status_change",
        oldValue: null,
        newValue: data.status,
        description: `Trade created directly: ${trade.symbol} ${trade.direction.toUpperCase()} @ $${data.entryPrice}`,
      });

      res.json(trade);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid request data", details: error.errors });
      }
      console.error("Create trade error:", error);
      res.status(500).json({ error: "Failed to create trade" });
    }
  });

  app.get("/api/sentinel/dashboard", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const user = await sentinelModels.getUserById(userId);
      const isAdmin = user?.isAdmin ?? false;

      const allTrades = await db.select().from(sentinelTrades)
        .where(eq(sentinelTrades.userId, userId))
        .orderBy(desc(sentinelTrades.createdAt));

      const tradeIds = allTrades.map(t => t.id);

      if (tradeIds.length === 0) {
        const recentEvents = await sentinelModels.getRecentEvents(userId, 20);
        const dashboard: DashboardData = {
          considering: [],
          active: [],
          closed: [],
          recentEvents: recentEvents.map(e => ({ ...e, trade: undefined })),
        };
        return res.json(dashboard);
      }

      const labelCondition = isAdmin
        ? inArray(sentinelTradeToLabels.tradeId, tradeIds)
        : and(
            inArray(sentinelTradeToLabels.tradeId, tradeIds),
            eq(sentinelTradeLabels.isAdminOnly, false)
          );

      const [allEvals, allLabels, allBatches, allOrderLevels, recentEvents] = await Promise.all([
        db.select().from(sentinelEvaluations)
          .where(inArray(sentinelEvaluations.tradeId, tradeIds))
          .orderBy(desc(sentinelEvaluations.createdAt)),

        db.select({
            tradeId: sentinelTradeToLabels.tradeId,
            id: sentinelTradeLabels.id,
            name: sentinelTradeLabels.name,
            color: sentinelTradeLabels.color,
            isAdminOnly: sentinelTradeLabels.isAdminOnly,
          })
          .from(sentinelTradeToLabels)
          .innerJoin(sentinelTradeLabels, eq(sentinelTradeToLabels.labelId, sentinelTradeLabels.id))
          .where(labelCondition),

        db.select({ batchId: sentinelImportBatches.batchId, importName: sentinelImportBatches.importName })
          .from(sentinelImportBatches)
          .where(eq(sentinelImportBatches.userId, userId)),

        db.select().from(sentinelOrderLevels)
          .where(eq(sentinelOrderLevels.userId, userId))
          .orderBy(sentinelOrderLevels.price),

        sentinelModels.getRecentEvents(userId, 20),
      ]);

      const evalsByTrade = new Map<number, typeof allEvals[0]>();
      for (const ev of allEvals) {
        if (!evalsByTrade.has(ev.tradeId)) {
          evalsByTrade.set(ev.tradeId, ev);
        }
      }

      const labelsByTrade = new Map<number, typeof allLabels>();
      for (const label of allLabels) {
        const existing = labelsByTrade.get(label.tradeId) || [];
        existing.push(label);
        labelsByTrade.set(label.tradeId, existing);
      }

      const batchNameMap = new Map<string, string>();
      for (const b of allBatches) {
        if (b.importName) batchNameMap.set(b.batchId, b.importName);
      }

      const ordersByTrade = new Map<number, typeof allOrderLevels>();
      for (const ol of allOrderLevels) {
        const existing = ordersByTrade.get(ol.tradeId) || [];
        existing.push(ol);
        ordersByTrade.set(ol.tradeId, existing);
      }

      const tradeSymbolMap = new Map<number, string>();
      for (const t of allTrades) {
        tradeSymbolMap.set(t.id, t.symbol);
      }

      const enrichTrade = (trade: typeof allTrades[0]): TradeWithEvaluation => {
        const latestEval = evalsByTrade.get(trade.id);
        const labels = labelsByTrade.get(trade.id) || [];
        const importName = trade.importBatchId ? batchNameMap.get(trade.importBatchId) : undefined;
        const orderLevels = ordersByTrade.get(trade.id) || [];

        return {
          ...trade,
          labels,
          importName,
          orderLevels,
          latestEvaluation: latestEval ? {
            score: latestEval.score,
            recommendation: latestEval.recommendation,
            riskFlags: latestEval.riskFlags || [],
          } : undefined,
        };
      };

      const considering = allTrades.filter(t => t.status === "considering").map(enrichTrade);
      const active = allTrades.filter(t => t.status === "active").map(enrichTrade);
      const closed = allTrades.filter(t => t.status === "closed").map(enrichTrade);

      const missingEventTradeIds = recentEvents
        .map(e => e.tradeId)
        .filter(id => !tradeSymbolMap.has(id));
      if (missingEventTradeIds.length > 0) {
        const uniqueMissing = [...new Set(missingEventTradeIds)];
        const missingTrades = await db.select({ id: sentinelTrades.id, symbol: sentinelTrades.symbol })
          .from(sentinelTrades)
          .where(inArray(sentinelTrades.id, uniqueMissing));
        for (const t of missingTrades) {
          tradeSymbolMap.set(t.id, t.symbol);
        }
      }

      const eventsWithTrades: EventWithTrade[] = recentEvents.map(event => ({
        ...event,
        trade: tradeSymbolMap.has(event.tradeId) 
          ? { symbol: tradeSymbolMap.get(event.tradeId)! } 
          : undefined,
      }));

      const dashboard: DashboardData = {
        considering,
        active,
        closed,
        recentEvents: eventsWithTrades,
      };

      res.json(dashboard);
    } catch (error) {
      console.error("Dashboard error:", error);
      res.status(500).json({ error: "Failed to load dashboard" });
    }
  });

  // Get trade sources for filtering (hand entered + import batches with system-generated account tags)
  app.get("/api/sentinel/trades/sources", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      
      // Get all trades with account info
      const trades = await db!.select({
        source: sentinelTrades.source,
        importBatchId: sentinelTrades.importBatchId,
        accountName: sentinelTrades.accountName,
      }).from(sentinelTrades).where(eq(sentinelTrades.userId, userId));
      
      // Count hand-entered trades
      const handCount = trades.filter(t => !t.source || t.source === 'hand').length;
      
      // Get unique import batch IDs
      const importBatchIds = [...new Set(trades.filter(t => t.source === 'import' && t.importBatchId).map(t => t.importBatchId))];
      
      // Get batch details from sentinel_import_batches
      const sources: Array<{ id: string; name: string; count: number; isSystemTag?: boolean }> = [];
      
      // Always include "Hand" source
      sources.push({ id: 'hand', name: 'Hand Entered', count: handCount });
      
      // Add import batch sources with custom or default import names
      if (importBatchIds.length > 0) {
        const batches = await db!.select({
          batchId: sentinelImportBatches.batchId,
          fileName: sentinelImportBatches.fileName,
          importName: sentinelImportBatches.importName,
          createdAt: sentinelImportBatches.createdAt,
        }).from(sentinelImportBatches).where(
          and(
            eq(sentinelImportBatches.userId, userId),
            inArray(sentinelImportBatches.batchId, importBatchIds.filter((id): id is string => id !== null))
          )
        );
        
        for (const batch of batches) {
          const batchTrades = trades.filter(t => t.importBatchId === batch.batchId);
          const count = batchTrades.length;
          
          // Use importName if set, otherwise generate default from filename
          let name = batch.importName;
          if (!name) {
            // Generate default: "FILE" + last 4 chars of filename (without extension)
            const fileNameWithoutExt = batch.fileName.replace(/\.[^/.]+$/, "");
            const last4Chars = fileNameWithoutExt.slice(-4).toUpperCase();
            name = `FILE${last4Chars}`;
          }
          
          sources.push({
            id: batch.batchId,
            name,
            count,
            isSystemTag: true, // Marks this as a system-generated tag
          });
        }
      }
      
      res.json(sources);
    } catch (error) {
      console.error("Get trade sources error:", error);
      res.status(500).json({ error: "Failed to get trade sources" });
    }
  });

  // Delete trades by source (with optional date range)
  const dateStringSchema = z.string().refine((val) => {
    if (!val) return true;
    const date = new Date(val);
    return !isNaN(date.getTime());
  }, { message: "Invalid date format" });
  
  const deleteBySourceSchema = z.object({
    sourceId: z.string().min(1, "sourceId is required"),
    dateFrom: dateStringSchema.optional(),
    dateTo: dateStringSchema.optional(),
    confirmDelete: z.literal("DELETE"),
  });

  app.delete("/api/sentinel/trades/by-source", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      
      // Validate input
      const parseResult = deleteBySourceSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ 
          error: "Validation failed",
          details: parseResult.error.errors
        });
      }
      
      const { sourceId, dateFrom, dateTo } = parseResult.data;

      // Use transaction for cascading deletions
      const result = await db!.transaction(async (tx) => {
        // Build query conditions
        const conditions = [eq(sentinelTrades.userId, userId)];
        
        if (sourceId === 'hand') {
          // Delete hand-entered trades (source is null or 'hand')
          conditions.push(
            sql`(${sentinelTrades.source} IS NULL OR ${sentinelTrades.source} = 'hand')`
          );
        } else {
          // Delete trades from a specific import batch
          conditions.push(eq(sentinelTrades.importBatchId, sourceId));
        }

        // Add date range filters if provided
        if (dateFrom) {
          const fromDate = new Date(dateFrom);
          if (!isNaN(fromDate.getTime())) {
            conditions.push(sql`${sentinelTrades.createdAt} >= ${fromDate}`);
          }
        }
        if (dateTo) {
          const toDate = new Date(dateTo);
          if (!isNaN(toDate.getTime())) {
            toDate.setHours(23, 59, 59, 999); // End of day
            conditions.push(sql`${sentinelTrades.createdAt} <= ${toDate}`);
          }
        }

        // Get trade IDs that will be deleted
        const tradesToDelete = await tx.select({ id: sentinelTrades.id })
          .from(sentinelTrades)
          .where(and(...conditions));
        
        const tradeIds = tradesToDelete.map(t => t.id);
        
        if (tradeIds.length === 0) {
          return { deleted: 0 };
        }

        // Delete related records first (cascade)
        // Delete trade-to-label associations
        await tx.delete(sentinelTradeToLabels)
          .where(inArray(sentinelTradeToLabels.tradeId, tradeIds));
        
        // Delete evaluations
        await tx.delete(sentinelEvaluations)
          .where(inArray(sentinelEvaluations.tradeId, tradeIds));
        
        // Delete events
        await tx.delete(sentinelEvents)
          .where(inArray(sentinelEvents.tradeId, tradeIds));
        
        // Finally delete the trades
        const deletedTrades = await tx.delete(sentinelTrades)
          .where(and(...conditions))
          .returning({ id: sentinelTrades.id });

        return { deleted: deletedTrades.length };
      });

      res.json({ 
        success: true,
        deleted: result.deleted
      });
    } catch (error) {
      console.error("Delete trades by source error:", error);
      res.status(500).json({ error: "Failed to delete trades" });
    }
  });

  app.get("/api/sentinel/trade/:tradeId", requireAuth, async (req: Request, res: Response) => {
    try {
      const tradeId = parseInt(req.params.tradeId as string);
      const trade = await sentinelModels.getTrade(tradeId);

      if (!trade) {
        return res.status(404).json({ error: "Trade not found" });
      }
      if (trade.userId !== req.session.userId) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const [evaluations, events] = await Promise.all([
        sentinelModels.getEvaluationsByTrade(tradeId),
        sentinelModels.getEventsByTrade(tradeId),
      ]);

      res.json({ trade, evaluations, events });
    } catch (error) {
      console.error("Trade detail error:", error);
      res.status(500).json({ error: "Failed to load trade" });
    }
  });

  app.patch("/api/sentinel/trade/:tradeId", requireAuth, async (req: Request, res: Response) => {
    try {
      const tradeId = parseInt(req.params.tradeId as string);
      const data = updateTradeSchema.parse(req.body);

      const trade = await sentinelModels.getTrade(tradeId);
      if (!trade) {
        return res.status(404).json({ error: "Trade not found" });
      }
      if (trade.userId !== req.session.userId) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const updates: TradeUpdate = {};

      if (data.stopPrice !== undefined && data.stopPrice !== trade.stopPrice) {
        updates.stopPrice = data.stopPrice;
        await sentinelModels.createEvent({
          tradeId,
          userId: req.session.userId!,
          eventType: "stop_update",
          oldValue: trade.stopPrice?.toString() || "none",
          newValue: data.stopPrice.toString(),
          description: `Stop updated: $${trade.stopPrice?.toFixed(2) || 'none'} → $${data.stopPrice.toFixed(2)}`,
        });
      }

      if (data.partialPrice !== undefined && data.partialPrice !== trade.partialPrice) {
        updates.partialPrice = data.partialPrice;
        await sentinelModels.createEvent({
          tradeId,
          userId: req.session.userId!,
          eventType: "partial_update",
          oldValue: trade.partialPrice?.toString() || "none",
          newValue: data.partialPrice.toString(),
          description: `Partial updated: $${trade.partialPrice?.toFixed(2) || 'none'} → $${data.partialPrice.toFixed(2)}`,
        });
      }

      if (data.targetPrice !== undefined && data.targetPrice !== trade.targetPrice) {
        updates.targetPrice = data.targetPrice;
        await sentinelModels.createEvent({
          tradeId,
          userId: req.session.userId!,
          eventType: "target_update",
          oldValue: trade.targetPrice?.toString() || "none",
          newValue: data.targetPrice.toString(),
          description: `Target updated: $${trade.targetPrice?.toFixed(2) || 'none'} → $${data.targetPrice.toFixed(2)}`,
        });
      }

      if (data.status !== undefined && data.status !== trade.status) {
        updates.status = data.status;
        await sentinelModels.createEvent({
          tradeId,
          userId: req.session.userId!,
          eventType: "status_change",
          oldValue: trade.status,
          newValue: data.status,
          description: `Status changed: ${trade.status} → ${data.status}`,
        });
      }

      if (data.entryPrice !== undefined && data.entryPrice !== trade.entryPrice) {
        updates.entryPrice = data.entryPrice;
        await sentinelModels.createEvent({
          tradeId,
          userId: req.session.userId!,
          eventType: "entry_update",
          oldValue: trade.entryPrice.toString(),
          newValue: data.entryPrice.toString(),
          description: `Entry updated: $${trade.entryPrice.toFixed(2)} → $${data.entryPrice.toFixed(2)}`,
        });
      }

      if (data.positionSize !== undefined && data.positionSize !== trade.positionSize) {
        updates.positionSize = data.positionSize;
        await sentinelModels.createEvent({
          tradeId,
          userId: req.session.userId!,
          eventType: "position_update",
          oldValue: trade.positionSize?.toString() || "none",
          newValue: data.positionSize.toString(),
          description: `Position size updated: ${trade.positionSize || 'none'} → ${data.positionSize} shares`,
        });
      }

      if (data.entryDate !== undefined) {
        const newEntryDate = new Date(data.entryDate);
        (updates as any).entryDate = newEntryDate;
        await sentinelModels.createEvent({
          tradeId,
          userId: req.session.userId!,
          eventType: "entry_date_update",
          oldValue: trade.entryDate?.toISOString() || "none",
          newValue: newEntryDate.toISOString(),
          description: `Lot date updated`,
        });
      }

      if (data.exitPrice !== undefined && data.exitPrice !== trade.exitPrice) {
        (updates as any).exitPrice = data.exitPrice;
        await sentinelModels.createEvent({
          tradeId,
          userId: req.session.userId!,
          eventType: "exit_price_update",
          oldValue: trade.exitPrice?.toString() || "none",
          newValue: data.exitPrice.toString(),
          description: `Close price updated: $${trade.exitPrice?.toFixed(2) || 'none'} → $${data.exitPrice.toFixed(2)}`,
        });
      }

      // Save lot entries array for order grid persistence
      if (data.lotEntries !== undefined) {
        (updates as any).lotEntries = data.lotEntries;
      }

      const updatedTrade = await sentinelModels.updateTrade(tradeId, updates);
      res.json(updatedTrade);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      console.error("Update trade error:", error);
      res.status(500).json({ error: "Failed to update trade" });
    }
  });

  // Delete trade
  app.delete("/api/sentinel/trade/:tradeId", requireAuth, async (req: Request, res: Response) => {
    try {
      const tradeId = parseInt(req.params.tradeId as string);

      const trade = await sentinelModels.getTrade(tradeId);
      if (!trade) {
        return res.status(404).json({ error: "Trade not found" });
      }
      if (trade.userId !== req.session.userId) {
        return res.status(403).json({ error: "Forbidden" });
      }

      await sentinelModels.deleteTrade(tradeId);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete trade error:", error);
      res.status(500).json({ error: "Failed to delete trade" });
    }
  });

  // Close trade with outcome and rule adherence
  app.post("/api/sentinel/trade/:tradeId/close", requireAuth, async (req: Request, res: Response) => {
    try {
      const tradeId = parseInt(req.params.tradeId as string);
      const data = closeTradeSchema.parse(req.body);

      const trade = await sentinelModels.getTrade(tradeId);
      if (!trade) {
        return res.status(404).json({ error: "Trade not found" });
      }
      if (trade.userId !== req.session.userId) {
        return res.status(403).json({ error: "Forbidden" });
      }

      // Calculate P&L
      const positionSize = trade.positionSize || 0;
      let actualPnL = 0;
      if (positionSize > 0) {
        const priceDiff = trade.direction === 'long' 
          ? data.exitPrice - trade.entryPrice 
          : trade.entryPrice - data.exitPrice;
        actualPnL = priceDiff * positionSize;
      }

      const updatedTrade = await sentinelModels.updateTrade(tradeId, {
        status: "closed",
        exitPrice: data.exitPrice,
        exitDate: new Date(),
        actualPnL,
        outcome: data.outcome,
        rulesFollowed: data.rulesFollowed || {},
        notes: data.notes,
      });

      await sentinelModels.createEvent({
        tradeId,
        userId: req.session.userId!,
        eventType: "status_change",
        oldValue: trade.status,
        newValue: "closed",
        description: `Trade closed: ${trade.symbol} ${data.outcome.toUpperCase()} at $${data.exitPrice.toFixed(2)}`,
      });

      res.json(updatedTrade);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      console.error("Close trade error:", error);
      res.status(500).json({ error: "Failed to close trade" });
    }
  });

  // Watchlist routes
  app.get("/api/sentinel/watchlist", requireAuth, async (req: Request, res: Response) => {
    try {
      const items = await sentinelModels.getWatchlistByUser(req.session.userId!);
      res.json(items);
    } catch (error) {
      console.error("Watchlist error:", error);
      res.status(500).json({ error: "Failed to load watchlist" });
    }
  });

  app.post("/api/sentinel/watchlist", requireAuth, async (req: Request, res: Response) => {
    try {
      const data = watchlistSchema.parse(req.body);
      const item = await sentinelModels.createWatchlistItem({
        userId: req.session.userId!,
        symbol: data.symbol.toUpperCase(),
        targetEntry: data.targetEntry,
        stopPlan: data.stopPlan,
        targetPlan: data.targetPlan,
        alertPrice: data.alertPrice,
        thesis: data.thesis,
        priority: data.priority || "medium",
      });
      res.status(201).json(item);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      console.error("Create watchlist error:", error);
      res.status(500).json({ error: "Failed to create watchlist item" });
    }
  });

  app.patch("/api/sentinel/watchlist/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id as string);
      const item = await sentinelModels.getWatchlistItem(id);
      
      if (!item) {
        return res.status(404).json({ error: "Watchlist item not found" });
      }
      if (item.userId !== req.session.userId) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const data = watchlistSchema.partial().parse(req.body);
      const updated = await sentinelModels.updateWatchlistItem(id, data);
      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      console.error("Update watchlist error:", error);
      res.status(500).json({ error: "Failed to update watchlist item" });
    }
  });

  app.delete("/api/sentinel/watchlist/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id as string);
      const item = await sentinelModels.getWatchlistItem(id);
      
      if (!item) {
        return res.status(404).json({ error: "Watchlist item not found" });
      }
      if (item.userId !== req.session.userId) {
        return res.status(403).json({ error: "Forbidden" });
      }

      await sentinelModels.deleteWatchlistItem(id);
      res.json({ message: "Deleted" });
    } catch (error) {
      console.error("Delete watchlist error:", error);
      res.status(500).json({ error: "Failed to delete watchlist item" });
    }
  });

  // Rules routes
  app.get("/api/sentinel/rules", requireAuth, async (req: Request, res: Response) => {
    try {
      const rules = await sentinelModels.getRulesByUser(req.session.userId!);
      res.json(rules);
    } catch (error) {
      console.error("Rules error:", error);
      res.status(500).json({ error: "Failed to load rules" });
    }
  });

  app.post("/api/sentinel/rules", requireAuth, async (req: Request, res: Response) => {
    try {
      const data = ruleSchema.parse(req.body);
      const rule = await sentinelModels.createRule({
        userId: req.session.userId!,
        name: data.name,
        description: data.description,
        category: data.category,
        order: data.order || 0,
      });
      res.status(201).json(rule);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      console.error("Create rule error:", error);
      res.status(500).json({ error: "Failed to create rule" });
    }
  });

  app.patch("/api/sentinel/rules/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id as string);
      const existingRules = await sentinelModels.getRulesByUser(req.session.userId!);
      const rule = existingRules.find(r => r.id === id);
      
      if (!rule) {
        return res.status(404).json({ error: "Rule not found" });
      }

      // Firewall: Prevent non-admins from editing system rules directly
      // Users should use the overrides endpoint instead
      if (rule.source === 'starter' && !req.session.isAdmin) {
        return res.status(403).json({ 
          error: "Cannot edit system rules directly. Use the customize option to create a personal override." 
        });
      }

      const data = ruleSchema.partial().extend({ 
        isActive: z.boolean().optional(),
        isDeleted: z.boolean().optional(),
      }).parse(req.body);
      const updated = await sentinelModels.updateRule(id, data);
      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      console.error("Update rule error:", error);
      res.status(500).json({ error: "Failed to update rule" });
    }
  });

  app.delete("/api/sentinel/rules/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id as string);
      const existingRules = await sentinelModels.getRulesByUser(req.session.userId!);
      const rule = existingRules.find(r => r.id === id);
      
      if (!rule) {
        return res.status(404).json({ error: "Rule not found" });
      }

      // Firewall: Prevent non-admins from deleting system rules
      // Users can only disable system rules via overrides
      if (rule.source === 'starter' && !req.session.isAdmin) {
        return res.status(403).json({ 
          error: "Cannot delete system rules. Use the customize option to disable it for your account." 
        });
      }

      await sentinelModels.deleteRule(id);
      res.json({ message: "Deleted" });
    } catch (error) {
      console.error("Delete rule error:", error);
      res.status(500).json({ error: "Failed to delete rule" });
    }
  });

  // Get rules by source (system/user/ai/community tabs)
  app.get("/api/sentinel/rules/source/:source", requireAuth, async (req: Request, res: Response) => {
    try {
      const source = req.params.source as string;
      const rules = await sentinelModels.getRulesBySource(req.session.userId!, source);
      res.json(rules);
    } catch (error) {
      console.error("Get rules by source error:", error);
      res.status(500).json({ error: "Failed to load rules" });
    }
  });

  // Get all rule overrides for user
  app.get("/api/sentinel/rules/overrides", requireAuth, async (req: Request, res: Response) => {
    try {
      const overrides = await sentinelModels.getRuleOverridesByUser(req.session.userId!);
      res.json(overrides);
    } catch (error) {
      console.error("Get rule overrides error:", error);
      res.status(500).json({ error: "Failed to load rule overrides" });
    }
  });

  // Create or update rule override
  app.post("/api/sentinel/rules/overrides", requireAuth, async (req: Request, res: Response) => {
    try {
      const { ruleCode, customName, customDescription, customSeverity, isDisabled, customFormula, notes } = req.body;
      if (!ruleCode) {
        return res.status(400).json({ error: "Rule code is required" });
      }
      const override = await sentinelModels.upsertRuleOverride({
        userId: req.session.userId!,
        ruleCode,
        customName: customName || null,
        customDescription: customDescription || null,
        customSeverity: customSeverity || null,
        isDisabled: isDisabled || false,
        customFormula: customFormula || null,
        notes: notes || null,
      });
      res.json(override);
    } catch (error) {
      console.error("Create/update rule override error:", error);
      res.status(500).json({ error: "Failed to save rule override" });
    }
  });

  // Delete rule override (restore to default)
  app.delete("/api/sentinel/rules/overrides/:ruleCode", requireAuth, async (req: Request, res: Response) => {
    try {
      const ruleCode = req.params.ruleCode as string;
      await sentinelModels.deleteRuleOverride(req.session.userId!, ruleCode);
      res.json({ message: "Override deleted, rule restored to default" });
    } catch (error) {
      console.error("Delete rule override error:", error);
      res.status(500).json({ error: "Failed to delete rule override" });
    }
  });

  // Get global (community) rules
  app.get("/api/sentinel/rules/global", requireAuth, async (req: Request, res: Response) => {
    try {
      const rules = await sentinelModels.getGlobalRules();
      res.json(rules);
    } catch (error) {
      console.error("Get global rules error:", error);
      res.status(500).json({ error: "Failed to load global rules" });
    }
  });

  // Toggle community opt-in status
  app.patch("/api/sentinel/user/community-opt-in", requireAuth, async (req: Request, res: Response) => {
    try {
      const { optIn } = req.body;
      if (typeof optIn !== 'boolean') {
        return res.status(400).json({ error: "optIn must be a boolean" });
      }
      const user = await sentinelModels.updateCommunityOptIn(req.session.userId!, optIn);
      res.json({ communityOptIn: user?.communityOptIn });
    } catch (error) {
      console.error("Update community opt-in error:", error);
      res.status(500).json({ error: "Failed to update community opt-in status" });
    }
  });

  // Admin: Set rule as global
  app.patch("/api/sentinel/rules/:id/global", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await sentinelModels.getUserById(req.session.userId!);
      if (!user?.isAdmin) {
        return res.status(403).json({ error: "Admin access required" });
      }
      const id = parseInt(req.params.id as string);
      const { isGlobal } = req.body;
      if (typeof isGlobal !== 'boolean') {
        return res.status(400).json({ error: "isGlobal must be a boolean" });
      }
      const rule = await sentinelModels.setRuleGlobal(id, isGlobal);
      res.json(rule);
    } catch (error) {
      console.error("Set rule global error:", error);
      res.status(500).json({ error: "Failed to update rule global status" });
    }
  });

  // Admin: Promote a personal rule to system rule (source: 'user' -> 'starter')
  app.post("/api/sentinel/admin/rules/:id/promote", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await sentinelModels.getUserById(req.session.userId!);
      if (!user?.isAdmin) {
        return res.status(403).json({ error: "Admin access required" });
      }
      
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid rule ID" });
      }
      
      // Get the rule
      const [existingRule] = await db.select().from(sentinelRules).where(eq(sentinelRules.id, id));
      if (!existingRule) {
        return res.status(404).json({ error: "Rule not found" });
      }
      
      if (existingRule.source === 'starter') {
        return res.status(400).json({ error: "Rule is already a system rule" });
      }
      
      // Generate a ruleCode if not present (system rules need unique codes for tracking)
      const ruleCode = existingRule.ruleCode || `SYS_${existingRule.category?.toUpperCase() || 'GEN'}_${Date.now()}`;
      
      // Promote to system rule
      const [updated] = await db.update(sentinelRules)
        .set({ 
          source: 'starter',
          isGlobal: true,
          ruleCode,
          updatedAt: new Date()
        })
        .where(eq(sentinelRules.id, id))
        .returning();
      
      res.json({ 
        success: true, 
        rule: updated,
        message: `Rule "${updated.name}" promoted to system rule`
      });
    } catch (error) {
      console.error("Promote rule error:", error);
      res.status(500).json({ error: "Failed to promote rule" });
    }
  });

  // Admin: Demote a system rule to personal rule (source: 'starter' -> 'user')
  app.post("/api/sentinel/admin/rules/:id/demote", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await sentinelModels.getUserById(req.session.userId!);
      if (!user?.isAdmin) {
        return res.status(403).json({ error: "Admin access required" });
      }
      
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid rule ID" });
      }
      
      // Get the rule
      const [existingRule] = await db.select().from(sentinelRules).where(eq(sentinelRules.id, id));
      if (!existingRule) {
        return res.status(404).json({ error: "Rule not found" });
      }
      
      if (existingRule.source !== 'starter') {
        return res.status(400).json({ error: "Rule is not a system rule (cannot demote)" });
      }
      
      // Demote to personal rule
      const [updated] = await db.update(sentinelRules)
        .set({ 
          source: 'user',
          isGlobal: false,
          updatedAt: new Date()
        })
        .where(eq(sentinelRules.id, id))
        .returning();
      
      res.json({ 
        success: true, 
        rule: updated,
        message: `Rule "${updated.name}" demoted to personal rule`
      });
    } catch (error) {
      console.error("Demote rule error:", error);
      res.status(500).json({ error: "Failed to demote rule" });
    }
  });

  // Admin: Create a new system rule directly
  app.post("/api/sentinel/admin/rules", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await sentinelModels.getUserById(req.session.userId!);
      if (!user?.isAdmin) {
        return res.status(403).json({ error: "Admin access required" });
      }
      
      const systemRuleSchema = z.object({
        name: z.string().min(3).max(200),
        description: z.string().min(10).max(2000),
        category: z.string().optional(),
        severity: z.enum(['auto_reject', 'critical', 'warning', 'info']).default('warning'),
        ruleType: z.enum(['swing', 'intraday', 'long_term', 'all']).default('swing'),
        directionTags: z.array(z.string()).optional(),
        strategyTags: z.array(z.string()).optional(),
        formula: z.string().optional(),
        isAutoReject: z.boolean().default(false),
      });
      
      const result = systemRuleSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ error: result.error.errors[0].message });
      }
      
      const data = result.data;
      
      // Generate unique ruleCode for system rules
      const ruleCode = `SYS_${(data.category || 'gen').toUpperCase()}_${Date.now()}`;
      
      // Create system rule
      const [rule] = await db.insert(sentinelRules).values({
        userId: req.session.userId!,
        name: data.name,
        description: data.description,
        category: data.category || 'general',
        severity: data.severity,
        ruleType: data.ruleType,
        directionTags: data.directionTags,
        strategyTags: data.strategyTags,
        formula: data.formula,
        isAutoReject: data.isAutoReject,
        source: 'starter',
        ruleCode,
        isGlobal: true,
        isActive: true,
      }).returning();
      
      res.json({ 
        success: true, 
        rule,
        message: `System rule "${rule.name}" created successfully`
      });
    } catch (error) {
      console.error("Create system rule error:", error);
      res.status(500).json({ error: "Failed to create system rule" });
    }
  });

  // Admin: Get all system rules for management
  app.get("/api/sentinel/admin/rules", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await sentinelModels.getUserById(req.session.userId!);
      if (!user?.isAdmin) {
        return res.status(403).json({ error: "Admin access required" });
      }
      
      // Get all system rules (source: 'starter')
      const systemRules = await db.select().from(sentinelRules)
        .where(eq(sentinelRules.source, 'starter'))
        .orderBy(sentinelRules.category, sentinelRules.name);
      
      res.json(systemRules);
    } catch (error) {
      console.error("Get system rules error:", error);
      res.status(500).json({ error: "Failed to fetch system rules" });
    }
  });

  // Admin: Seed starter rules for a user who doesn't have them
  app.post("/api/sentinel/admin/seed-rules/:userId", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await sentinelModels.getUserById(req.session.userId!);
      if (!user?.isAdmin) {
        return res.status(403).json({ error: "Admin access required" });
      }
      
      const targetUserId = parseInt(req.params.userId as string);
      if (isNaN(targetUserId)) {
        return res.status(400).json({ error: "Invalid user ID" });
      }
      
      // Check if user exists
      const targetUser = await sentinelModels.getUserById(targetUserId);
      if (!targetUser) {
        return res.status(404).json({ error: "User not found" });
      }
      
      // Check if user already has starter rules
      const existingRules = await sentinelModels.getRulesByUser(targetUserId);
      const starterRules = existingRules.filter(r => r.source === 'starter');
      
      if (starterRules.length > 0) {
        return res.status(400).json({ 
          error: `User ${targetUser.username} already has ${starterRules.length} starter rules`
        });
      }
      
      // Seed starter rules
      const seededRules = await sentinelModels.seedStarterRulesForUser(targetUserId);
      
      res.json({ 
        success: true, 
        count: seededRules.length,
        message: `Seeded ${seededRules.length} starter rules for ${targetUser.username}`
      });
    } catch (error) {
      console.error("Seed rules error:", error);
      res.status(500).json({ error: "Failed to seed rules" });
    }
  });

  // Admin: Get all users with rule counts
  app.get("/api/sentinel/admin/users", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await sentinelModels.getUserById(req.session.userId!);
      if (!user?.isAdmin) {
        return res.status(403).json({ error: "Admin access required" });
      }
      
      // Get all users with their rule counts
      const users = await db.select({
        id: sentinelUsers.id,
        username: sentinelUsers.username,
        isAdmin: sentinelUsers.isAdmin,
        createdAt: sentinelUsers.createdAt,
      }).from(sentinelUsers);
      
      // Get rule counts for each user
      const usersWithCounts = await Promise.all(users.map(async (u) => {
        const rules = await sentinelModels.getRulesByUser(u.id);
        const starterRules = rules.filter(r => r.source === 'starter');
        const userRules = rules.filter(r => r.source === 'user');
        return {
          ...u,
          totalRules: rules.length,
          starterRulesCount: starterRules.length,
          userRulesCount: userRules.length,
          needsSeeding: starterRules.length === 0
        };
      }));
      
      res.json(usersWithCounts);
    } catch (error) {
      console.error("Get users error:", error);
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

  // System Settings - Get user's UI settings
  app.get("/api/sentinel/settings/system", requireAuth, async (req: Request, res: Response) => {
    try {
      const settings = await sentinelModels.getSystemSettings(req.session.userId!);
      // Return defaults if no settings exist
      res.json(settings || {
        overlayColor: "#1e3a5f",
        overlayTransparency: 75,
        backgroundColor: "#0f172a",
        logoTransparency: 6
      });
    } catch (error) {
      console.error("Get system settings error:", error);
      res.status(500).json({ error: "Failed to load settings" });
    }
  });

  // System Settings - Update user's UI settings
  app.patch("/api/sentinel/settings/system", requireAuth, async (req: Request, res: Response) => {
    try {
      const { overlayColor, overlayTransparency, backgroundColor, logoTransparency } = req.body;
      const settings = await sentinelModels.upsertSystemSettings(req.session.userId!, {
        overlayColor,
        overlayTransparency,
        backgroundColor,
        logoTransparency
      });
      res.json(settings);
    } catch (error) {
      console.error("Update system settings error:", error);
      res.status(500).json({ error: "Failed to save settings" });
    }
  });

  // AI Chat for rule creation assistance
  app.post("/api/sentinel/rules/ai-chat", requireAuth, async (req: Request, res: Response) => {
    try {
      const { message, conversationHistory = [] } = req.body;
      
      if (!message || typeof message !== 'string') {
        return res.status(400).json({ error: "Message is required" });
      }

      // Suggested rule validation schema
      const suggestedRuleSchema = z.object({
        name: z.string().min(1).max(200),
        description: z.string().min(1).max(2000),
        category: z.enum(['auto_reject', 'entry', 'exit', 'profit_taking', 'stop_loss', 'ma_structure', 'base_quality', 'breakout', 'position_sizing', 'market_regime', 'risk', 'general']),
        severity: z.enum(['auto_reject', 'critical', 'warning', 'info']),
        ruleType: z.enum(['swing', 'intraday', 'long_term', 'all']).optional().default('swing'),
        directionTags: z.array(z.enum(['long', 'short'])).min(1).optional().default(['long', 'short']),
        strategyTags: z.array(z.string().max(20)).optional().default([]),
        formula: z.string().nullable().optional()
      });

      // Check for OpenAI configuration
      const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
      const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
      if (!apiKey) {
        return res.status(500).json({ error: "AI service not configured. Please ensure OpenAI API key is set." });
      }

      const openai = new OpenAI({ apiKey, baseURL });

      const systemPrompt = `You are an expert trading rules assistant. Your sole purpose is to help traders formalize their trading rules.

IMPORTANT CONSTRAINTS:
1. ONLY discuss topics related to trading, investing, market analysis, risk management, and trading rules
2. If asked about non-trading topics (weather, cooking, politics, general chat, etc.), respond EXACTLY with: "I'm focused exclusively on helping you create trading rules. Let's discuss your trading approach - what criteria do you use when entering or exiting trades?"
3. Keep responses concise and actionable

When helping create a rule, extract these details:
- name: A clear, concise rule name (required)
- description: What the rule means and when to apply it (required)
- category: One of: auto_reject, entry, exit, profit_taking, stop_loss, ma_structure, base_quality, breakout, position_sizing, market_regime, risk, general
- severity: One of: auto_reject, critical, warning, info
- ruleType: One of: swing, intraday, long_term, all
- directionTags: Array containing "long" and/or "short" (at least one required)
- strategyTags: Short tags (max 20 chars each) to categorize the strategy, e.g., ["breakout", "momentum"]
- formula: Optional mathematical formula

When you have enough information to create a rule, include a JSON block like this:
\`\`\`json
{
  "suggestedRule": {
    "name": "Rule name",
    "description": "Description",
    "category": "entry",
    "severity": "warning",
    "ruleType": "swing",
    "directionTags": ["long"],
    "strategyTags": ["breakout"],
    "formula": null
  }
}
\`\`\`

For strategy tags: Ensure they are concise (1-2 words), relevant to trading, and descriptive of the strategy type. Examples: breakout, momentum, mean-reversion, trend-following, gap-play.`;

      const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
        { role: "system", content: systemPrompt },
        ...conversationHistory.map((msg: { role: string; content: string }) => ({
          role: msg.role as "user" | "assistant",
          content: msg.content
        })),
        { role: "user", content: message }
      ];

      const completion = await openai.chat.completions.create({
        model: "gpt-5.1",
        messages,
        max_completion_tokens: 1000,
      });

      const responseText = completion.choices[0]?.message?.content || "I couldn't generate a response.";
      
      // Extract and validate suggested rule - try all JSON blocks
      let suggestedRule = null;
      const jsonMatches = responseText.matchAll(/```json\s*([\s\S]*?)\s*```/g);
      for (const match of jsonMatches) {
        try {
          const parsed = JSON.parse(match[1]);
          if (parsed.suggestedRule) {
            const validated = suggestedRuleSchema.safeParse(parsed.suggestedRule);
            if (validated.success) {
              suggestedRule = validated.data;
              break;
            }
          }
        } catch (parseError) {
          // Try next JSON block
        }
      }

      // Clean response text by removing all JSON blocks
      const cleanResponse = responseText.replace(/```json\s*[\s\S]*?\s*```/g, '').trim();

      res.json({ 
        response: cleanResponse || (suggestedRule ? "I've prepared a rule for you. Click to review and customize it." : "How can I help you create a trading rule?"),
        suggestedRule 
      });
    } catch (error) {
      console.error("AI chat error:", error);
      res.status(500).json({ error: "Failed to get AI response" });
    }
  });

  // AI Rule Similarity Check - checks if a proposed rule is similar to existing rules
  app.post("/api/sentinel/rules/check-similarity", requireAuth, async (req: Request, res: Response) => {
    try {
      const { name, description, category } = req.body;
      
      // Validate and sanitize inputs
      const trimmedName = (name || '').trim();
      const trimmedDescription = (description || '').trim();
      
      if (!trimmedName || trimmedName.length < 3) {
        return res.status(400).json({ error: "Name must be at least 3 characters" });
      }
      if (!trimmedDescription || trimmedDescription.length < 10) {
        return res.status(400).json({ error: "Description must be at least 10 characters" });
      }

      // Get all existing rules for the user
      const existingRules = await sentinelModels.getRulesByUser(req.session.userId!);
      const activeRules = existingRules.filter(r => !r.isDeleted);
      
      if (activeRules.length === 0) {
        return res.json({ similarRules: [], hasSimilar: false });
      }

      // Check for OpenAI configuration
      const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
      const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
      if (!apiKey) {
        // If no AI, fall back to simple name matching
        const similar = activeRules.filter(r => {
          const nameSimilar = r.name.toLowerCase().includes(name.toLowerCase()) || 
                              name.toLowerCase().includes(r.name.toLowerCase());
          return nameSimilar;
        }).slice(0, 3);
        return res.json({ 
          similarRules: similar.map(r => ({ ...r, similarityScore: 0.7, reason: "Similar name" })),
          hasSimilar: similar.length > 0
        });
      }

      const openai = new OpenAI({ apiKey, baseURL });

      // Build a compact list of existing rules for the AI
      const rulesList = activeRules.map(r => ({
        id: r.id,
        name: r.name,
        description: r.description || '',
        category: r.category
      }));

      const prompt = `You are analyzing trading rules for semantic similarity.

PROPOSED NEW RULE:
Name: ${trimmedName}
Description: ${trimmedDescription}
Category: ${category || 'general'}

EXISTING RULES:
${JSON.stringify(rulesList, null, 2)}

Identify any existing rules that are semantically similar to the proposed rule. Consider:
- Rules about the same trading concept (even if worded differently)
- Rules that could conflict or overlap
- Rules that could be merged together

Return a JSON object with this structure:
{
  "similarRules": [
    {
      "id": <existing rule id>,
      "similarityScore": <0.0 to 1.0>,
      "reason": "<brief explanation of similarity>"
    }
  ]
}

Only include rules with similarityScore >= 0.5. If no similar rules, return {"similarRules": []}.
Return ONLY the JSON object, no other text.`;

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 500,
      });

      const responseText = completion.choices[0]?.message?.content || '{"similarRules": []}';
      
      let result;
      try {
        // Try to parse as JSON directly
        result = JSON.parse(responseText.trim());
      } catch {
        // Try to extract JSON from response
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          result = JSON.parse(jsonMatch[0]);
        } else {
          result = { similarRules: [] };
        }
      }

      // Enrich similar rules with safe rule data (filter out sensitive fields)
      const enrichedSimilar = (result.similarRules || [])
        .filter((s: { id: number; similarityScore: number; reason: string }) => 
          s.similarityScore >= 0.5 // Enforce minimum threshold server-side
        )
        .map((s: { id: number; similarityScore: number; reason: string }) => {
          const rule = activeRules.find(r => r.id === s.id);
          if (!rule) return null;
          // Return only safe fields
          return {
            id: rule.id,
            name: rule.name,
            description: rule.description,
            category: rule.category,
            severity: rule.severity,
            similarityScore: s.similarityScore,
            reason: s.reason
          };
        }).filter(Boolean);

      res.json({ 
        similarRules: enrichedSimilar,
        hasSimilar: enrichedSimilar.length > 0
      });
    } catch (error) {
      console.error("Similarity check error:", error);
      res.status(500).json({ error: "Failed to check similarity" });
    }
  });

  // === PERFORMANCE-BASED RULE CONSOLIDATION ===
  
  // Analyze rules for consolidation suggestions based on similarity and performance
  app.post("/api/sentinel/rules/consolidation-suggestions", requireAuth, async (req: Request, res: Response) => {
    try {
      // Get all active rules for the user
      const existingRules = await sentinelModels.getRulesByUser(req.session.userId!);
      const activeRules = existingRules.filter(r => !r.isDeleted && r.isActive);
      
      if (activeRules.length < 2) {
        return res.json({ suggestions: [], message: "Need at least 2 active rules to analyze" });
      }

      // Get rule performance stats - only use unique ruleCodes to avoid cross-tenant leakage
      // Note: Performance stats table is global, so we only query by unique ruleCode (not ruleName)
      // This prevents conflation with other users' rules that may have the same name
      const userRuleCodes = activeRules
        .map(r => r.ruleCode)
        .filter((code): code is string => !!code && code.length > 0);
      
      // Only query performance stats if we have unique ruleCodes
      let perfMap = new Map<string, { totalTrades: number; winRateWhenFollowed: number | null; avgPnLWhenFollowed: number | null }>();
      
      if (userRuleCodes.length > 0) {
        const performanceStats = await db.select().from(sentinelRulePerformance)
          .where(inArray(sentinelRulePerformance.ruleCode, userRuleCodes));
        
        performanceStats.forEach(p => {
          if (p.ruleCode) {
            perfMap.set(p.ruleCode, {
              totalTrades: p.totalTrades || 0,
              winRateWhenFollowed: p.winRateWhenFollowed,
              avgPnLWhenFollowed: p.avgPnLWhenFollowed,
            });
          }
        });
      }

      // Build enriched rules with performance data (only for rules with unique ruleCode)
      const enrichedRules = activeRules.map(rule => {
        // Only use performance data for rules with ruleCode to prevent cross-tenant data
        const perf = rule.ruleCode ? perfMap.get(rule.ruleCode) : null;
        return {
          ...rule,
          performance: perf ? {
            totalTrades: perf.totalTrades,
            winRateWhenFollowed: perf.winRateWhenFollowed,
            avgPnLWhenFollowed: perf.avgPnLWhenFollowed,
          } : null
        };
      });

      // Check for OpenAI configuration
      const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
      const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
      
      if (!apiKey) {
        // Fall back to simple category-based grouping
        const byCategory: Record<string, typeof enrichedRules> = {};
        enrichedRules.forEach(r => {
          const cat = r.category || 'general';
          if (!byCategory[cat]) byCategory[cat] = [];
          byCategory[cat].push(r);
        });

        const suggestions: Array<{
          ruleIds: number[];
          rules: Array<{ id: number; name: string; description?: string | null }>;
          reason: string;
          suggestedMerge?: { name: string; description: string };
          performanceIssue?: string;
        }> = [];

        // Find categories with multiple underperforming rules
        for (const [category, rules] of Object.entries(byCategory)) {
          if (rules.length >= 2) {
            const underperforming = rules.filter(r => {
              if (!r.performance || r.performance.totalTrades < 5) return false;
              return (r.performance.winRateWhenFollowed || 0) < 0.5;
            });
            
            if (underperforming.length >= 2) {
              suggestions.push({
                ruleIds: underperforming.map(r => r.id),
                rules: underperforming.map(r => ({ id: r.id, name: r.name, description: r.description })),
                reason: `Multiple ${category} rules with below-average performance`,
                performanceIssue: "Win rate below 50% when followed"
              });
            }
          }
        }

        return res.json({ suggestions, usedAI: false });
      }

      const openai = new OpenAI({ apiKey, baseURL });

      // Use AI to find semantic groupings and suggest consolidations
      const rulesForAI = enrichedRules.map(r => ({
        id: r.id,
        name: r.name,
        description: r.description || '',
        category: r.category,
        performance: r.performance ? {
          totalTrades: r.performance.totalTrades,
          winRate: r.performance.winRateWhenFollowed,
          avgPnL: r.performance.avgPnLWhenFollowed
        } : null
      }));

      const prompt = `You are analyzing trading rules for a trader to suggest consolidation opportunities.

RULES TO ANALYZE:
${JSON.stringify(rulesForAI, null, 2)}

Find groups of semantically similar rules that could benefit from consolidation. Prioritize:
1. Rules with overlapping concepts that could be merged into one clearer rule
2. Rules with poor performance (win rate < 50% or negative avg P&L) that could be combined
3. Rules that are redundant or contradictory

For each group you identify, suggest a merged rule that captures the essence of all rules in the group.

Return a JSON object with this structure:
{
  "suggestions": [
    {
      "ruleIds": [<array of rule ids to merge>],
      "reason": "<why these rules should be consolidated>",
      "performanceIssue": "<optional - what performance problem this addresses>",
      "suggestedMerge": {
        "name": "<proposed merged rule name>",
        "description": "<proposed merged rule description>"
      }
    }
  ]
}

Only include groups with 2+ rules that would genuinely benefit from consolidation.
Return ONLY valid JSON, no other text.`;

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 1500,
      });

      const responseText = completion.choices[0]?.message?.content || '{"suggestions": []}';
      
      let result;
      try {
        result = JSON.parse(responseText.trim());
      } catch {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          result = JSON.parse(jsonMatch[0]);
        } else {
          result = { suggestions: [] };
        }
      }

      // Enrich suggestions with full rule data
      const enrichedSuggestions = (result.suggestions || []).map((s: {
        ruleIds: number[];
        reason: string;
        performanceIssue?: string;
        suggestedMerge?: { name: string; description: string };
      }) => {
        const matchedRules = s.ruleIds
          .map(id => enrichedRules.find(r => r.id === id))
          .filter(Boolean);
        
        if (matchedRules.length < 2) return null;
        
        return {
          ruleIds: s.ruleIds,
          rules: matchedRules.map(r => ({
            id: r!.id,
            name: r!.name,
            description: r!.description,
            category: r!.category,
            performance: r!.performance
          })),
          reason: s.reason,
          performanceIssue: s.performanceIssue,
          suggestedMerge: s.suggestedMerge
        };
      }).filter(Boolean);

      res.json({ suggestions: enrichedSuggestions, usedAI: true });
    } catch (error) {
      console.error("Rule consolidation error:", error);
      res.status(500).json({ error: "Failed to analyze rules for consolidation" });
    }
  });

  // Execute rule consolidation - merge selected rules into a new one
  const consolidateSchema = z.object({
    ruleIds: z.array(z.number()).min(2, "Need at least 2 rule IDs to consolidate"),
    newRule: z.object({
      name: z.string().min(3, "Rule name must be at least 3 characters").max(200),
      description: z.string().min(10, "Description must be at least 10 characters").max(1000),
      category: z.string().optional(),
      severity: z.string().optional(),
      ruleType: z.string().optional(),
    })
  });

  app.post("/api/sentinel/rules/consolidate", requireAuth, async (req: Request, res: Response) => {
    try {
      const parseResult = consolidateSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ 
          error: parseResult.error.errors[0]?.message || "Invalid request data" 
        });
      }
      
      const { ruleIds, newRule } = parseResult.data;

      // Verify all rules belong to this user
      const userRules = await sentinelModels.getRulesByUser(req.session.userId!);
      const validRuleIds = ruleIds.filter(id => userRules.some(r => r.id === id));
      
      if (validRuleIds.length !== ruleIds.length) {
        return res.status(403).json({ error: "Some rules do not belong to you" });
      }

      // Get the rules being merged to inherit best properties
      const rulesToMerge = userRules.filter(r => validRuleIds.includes(r.id));
      
      // Determine best category and severity from merged rules
      const categories = rulesToMerge.map(r => r.category).filter(Boolean);
      const bestCategory = categories.length > 0 ? categories[0] : 'general';
      
      const severities = rulesToMerge.map(r => r.severity).filter(Boolean);
      const severityOrder = ['auto_reject', 'critical', 'warning', 'info'];
      const bestSeverity = severities.sort((a, b) => 
        severityOrder.indexOf(a!) - severityOrder.indexOf(b!)
      )[0] || 'warning';

      // Merge strategy tags from all rules
      const allStrategyTags = new Set<string>();
      rulesToMerge.forEach(r => {
        if (r.strategyTags) {
          r.strategyTags.forEach(t => allStrategyTags.add(t));
        }
      });

      // Create the new merged rule
      const [newMergedRule] = await db.insert(sentinelRules).values({
        userId: req.session.userId!,
        name: newRule.name,
        description: newRule.description,
        category: newRule.category || bestCategory,
        severity: newRule.severity || bestSeverity,
        source: 'user',
        ruleType: newRule.ruleType || 'swing',
        strategyTags: allStrategyTags.size > 0 ? Array.from(allStrategyTags) : null,
        isActive: true,
        isDeleted: false,
      }).returning();

      // Soft-delete the old rules (mark as deleted, keep for history)
      await db.update(sentinelRules)
        .set({ isDeleted: true })
        .where(inArray(sentinelRules.id, validRuleIds));

      res.json({
        success: true,
        newRule: newMergedRule,
        deletedRuleIds: validRuleIds,
        message: `Created "${newRule.name}" from ${validRuleIds.length} merged rules`
      });
    } catch (error) {
      console.error("Rule consolidation execute error:", error);
      res.status(500).json({ error: "Failed to consolidate rules" });
    }
  });

  // === TRADE TAGGING FOR AI LEARNING ===
  
  // Get untagged closed trades (for review queue)
  app.get("/api/sentinel/trades/untagged", requireAuth, async (req: Request, res: Response) => {
    try {
      const trades = await db.select().from(sentinelTrades)
        .where(and(
          eq(sentinelTrades.userId, req.session.userId!),
          eq(sentinelTrades.status, "closed"),
          or(
            eq(sentinelTrades.isTagged, false),
            isNull(sentinelTrades.isTagged)
          )
        ))
        .orderBy(desc(sentinelTrades.exitDate));
      res.json(trades);
    } catch (error) {
      console.error("Get untagged trades error:", error);
      res.status(500).json({ error: "Failed to load untagged trades" });
    }
  });
  
  // Analyze a trade - calculate outcome, hold days, P&L from lot entries
  app.post("/api/sentinel/trades/:id/analyze", requireAuth, async (req: Request, res: Response) => {
    try {
      const tradeId = parseInt(req.params.id as string);
      const trade = await db.select().from(sentinelTrades)
        .where(and(
          eq(sentinelTrades.id, tradeId),
          eq(sentinelTrades.userId, req.session.userId!)
        ))
        .then(rows => rows[0]);
      
      if (!trade) {
        return res.status(404).json({ error: "Trade not found" });
      }
      
      const lotEntries = trade.lotEntries as Array<{
        id: string;
        dateTime: string;
        qty: string;
        buySell: "buy" | "sell";
        price: string;
      }> || [];
      
      // Calculate from lot entries
      const buys = lotEntries.filter(e => e.buySell === "buy");
      const sells = lotEntries.filter(e => e.buySell === "sell");
      
      let holdDays: number | null = null;
      let calculatedPnL = 0;
      let outcome: "win" | "loss" | "breakeven" = "breakeven";
      let avgCostBasis = 0;
      let avgSellPrice = 0;
      let totalBuyQty = 0;
      let totalSellQty = 0;
      
      if (buys.length > 0 && sells.length > 0) {
        // Sort chronologically
        const sortedBuys = [...buys].sort((a, b) => 
          new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime()
        );
        const sortedSells = [...sells].sort((a, b) => 
          new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime()
        );
        
        // Hold days: first buy to last sell
        const firstBuyDate = new Date(sortedBuys[0].dateTime);
        const lastSellDate = new Date(sortedSells[sortedSells.length - 1].dateTime);
        holdDays = Math.ceil((lastSellDate.getTime() - firstBuyDate.getTime()) / (1000 * 60 * 60 * 24));
        
        // Calculate weighted average cost basis
        buys.forEach(buy => {
          const qty = parseFloat(buy.qty) || 0;
          const price = parseFloat(buy.price) || 0;
          totalBuyQty += qty;
          avgCostBasis += qty * price;
        });
        avgCostBasis = totalBuyQty > 0 ? avgCostBasis / totalBuyQty : 0;
        
        // Calculate weighted average sell price
        sells.forEach(sell => {
          const qty = parseFloat(sell.qty) || 0;
          const price = parseFloat(sell.price) || 0;
          totalSellQty += qty;
          avgSellPrice += qty * price;
        });
        avgSellPrice = totalSellQty > 0 ? avgSellPrice / totalSellQty : 0;
        
        // Realized P&L (simplified: using min of buy/sell qty)
        const closedQty = Math.min(totalBuyQty, totalSellQty);
        const isLong = trade.direction === "long";
        if (isLong) {
          calculatedPnL = (avgSellPrice - avgCostBasis) * closedQty;
        } else {
          calculatedPnL = (avgCostBasis - avgSellPrice) * closedQty;
        }
        
        // Determine outcome
        if (calculatedPnL > 5) outcome = "win"; // $5 buffer for fees
        else if (calculatedPnL < -5) outcome = "loss";
        else outcome = "breakeven";
      }
      
      res.json({
        tradeId,
        holdDays,
        calculatedPnL,
        outcome,
        avgCostBasis,
        avgSellPrice,
        totalBuyQty,
        totalSellQty,
        existingSetupType: trade.setupType,
        existingOutcome: trade.outcome,
        isTagged: trade.isTagged
      });
    } catch (error) {
      console.error("Trade analysis error:", error);
      res.status(500).json({ error: "Failed to analyze trade" });
    }
  });
  
  // Get AI setup type suggestion for a trade
  app.post("/api/sentinel/trades/:id/suggest-setup", requireAuth, async (req: Request, res: Response) => {
    try {
      const tradeId = parseInt(req.params.id as string);
      const trade = await db.select().from(sentinelTrades)
        .where(and(
          eq(sentinelTrades.id, tradeId),
          eq(sentinelTrades.userId, req.session.userId!)
        ))
        .then(rows => rows[0]);
      
      if (!trade) {
        return res.status(404).json({ error: "Trade not found" });
      }
      
      // Get trade context for AI analysis
      const lotEntries = trade.lotEntries as Array<any> || [];
      const holdDays = trade.holdDays || 0;
      
      const setupTypes = [
        "breakout", "pullback", "cup_and_handle", "vcp", "high_tight_flag",
        "double_bottom", "ascending_base", "bounce", "momentum", "gap_and_go",
        "earnings_play", "sector_rotation", "swing_trade", "position_trade"
      ];
      
      const prompt = `Analyze this historical trade and suggest the most likely setup type:

TRADE DETAILS:
- Symbol: ${trade.symbol}
- Direction: ${trade.direction}
- Entry Price: $${trade.entryPrice}
- Exit Price: $${trade.exitPrice || "N/A"}
- Hold Time: ${holdDays} days
- P&L: $${trade.actualPnL?.toFixed(2) || "N/A"}
- Outcome: ${trade.outcome || "unknown"}
- Thesis: ${trade.thesis || "none provided"}
- Notes: ${trade.notes || "none"}

AVAILABLE SETUP TYPES:
${setupTypes.map(s => `- ${s}`).join("\n")}

Based on hold time and characteristics:
- 0-1 days: likely "momentum" or "gap_and_go"
- 2-5 days: likely "swing_trade", "breakout", or "bounce"
- 5-20 days: likely "pullback", "vcp", or "cup_and_handle"
- 20+ days: likely "position_trade" or "ascending_base"

Respond in JSON format:
{
  "suggestedSetup": "<setup_type>",
  "confidence": <0-1>,
  "reasoning": "<brief explanation>"
}`;

      // Check for OpenAI configuration
      const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
      const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
      if (!apiKey) {
        // Fallback: use hold time heuristics
        let suggestedSetup = "swing_trade";
        if (holdDays <= 1) suggestedSetup = "momentum";
        else if (holdDays <= 5) suggestedSetup = "breakout";
        else if (holdDays > 20) suggestedSetup = "position_trade";
        
        return res.json({
          suggestedSetup,
          confidence: 0.5,
          reasoning: "Suggestion based on hold time heuristics (AI unavailable)"
        });
      }
      
      const openai = new OpenAI({ apiKey, baseURL });
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 200
      });
      
      const content = response.choices[0].message.content || "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("Invalid AI response format");
      }
      
      const result = JSON.parse(jsonMatch[0]);
      
      // Validate suggested setup is in our list
      if (!setupTypes.includes(result.suggestedSetup)) {
        result.suggestedSetup = "swing_trade";
        result.confidence = 0.5;
      }
      
      res.json(result);
    } catch (error) {
      console.error("Setup suggestion error:", error);
      res.status(500).json({ error: "Failed to get setup suggestion" });
    }
  });
  
  // Tag a trade (set setupType, outcome, calculate holdDays)
  app.post("/api/sentinel/trades/:id/tag", requireAuth, async (req: Request, res: Response) => {
    try {
      const tradeId = parseInt(req.params.id as string);
      const { setupType, outcome, notes } = req.body;
      
      // Verify ownership
      const trade = await db.select().from(sentinelTrades)
        .where(and(
          eq(sentinelTrades.id, tradeId),
          eq(sentinelTrades.userId, req.session.userId!)
        ))
        .then(rows => rows[0]);
      
      if (!trade) {
        return res.status(404).json({ error: "Trade not found" });
      }
      
      // Calculate hold days from lot entries
      const lotEntries = trade.lotEntries as Array<{
        id: string;
        dateTime: string;
        qty: string;
        buySell: "buy" | "sell";
        price: string;
      }> || [];
      
      const buys = lotEntries.filter(e => e.buySell === "buy");
      const sells = lotEntries.filter(e => e.buySell === "sell");
      
      let holdDays: number | null = null;
      if (buys.length > 0 && sells.length > 0) {
        const sortedBuys = [...buys].sort((a, b) => 
          new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime()
        );
        const sortedSells = [...sells].sort((a, b) => 
          new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime()
        );
        const firstBuyDate = new Date(sortedBuys[0].dateTime);
        const lastSellDate = new Date(sortedSells[sortedSells.length - 1].dateTime);
        holdDays = Math.ceil((lastSellDate.getTime() - firstBuyDate.getTime()) / (1000 * 60 * 60 * 24));
      }
      
      // Update trade with tags
      const [updated] = await db.update(sentinelTrades)
        .set({
          setupType: setupType || trade.setupType,
          outcome: outcome || trade.outcome,
          notes: notes !== undefined ? notes : trade.notes,
          holdDays,
          isTagged: true,
          taggedAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(sentinelTrades.id, tradeId))
        .returning();
      
      res.json(updated);
    } catch (error) {
      console.error("Tag trade error:", error);
      res.status(500).json({ error: "Failed to tag trade" });
    }
  });
  
  // Batch analyze trades for tagging stats
  app.get("/api/sentinel/trades/tagging-stats", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      
      // Get counts
      const [totalClosed] = await db.select({ count: sql<number>`count(*)` })
        .from(sentinelTrades)
        .where(and(
          eq(sentinelTrades.userId, userId),
          eq(sentinelTrades.status, "closed")
        ));
      
      const [tagged] = await db.select({ count: sql<number>`count(*)` })
        .from(sentinelTrades)
        .where(and(
          eq(sentinelTrades.userId, userId),
          eq(sentinelTrades.status, "closed"),
          eq(sentinelTrades.isTagged, true)
        ));
      
      const [imported] = await db.select({ count: sql<number>`count(*)` })
        .from(sentinelTrades)
        .where(and(
          eq(sentinelTrades.userId, userId),
          eq(sentinelTrades.status, "closed"),
          eq(sentinelTrades.source, "import")
        ));
      
      res.json({
        totalClosed: Number(totalClosed.count),
        tagged: Number(tagged.count),
        untagged: Number(totalClosed.count) - Number(tagged.count),
        imported: Number(imported.count),
        taggedPercent: totalClosed.count > 0 ? 
          Math.round((Number(tagged.count) / Number(totalClosed.count)) * 100) : 0
      });
    } catch (error) {
      console.error("Tagging stats error:", error);
      res.status(500).json({ error: "Failed to get tagging stats" });
    }
  });

  // AI Batch tagging suggestions - analyze untagged trades and suggest setup types
  app.post("/api/sentinel/trades/batch-tag-suggestions", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      
      // Get untagged closed trades
      const untaggedTrades = await db.select().from(sentinelTrades)
        .where(and(
          eq(sentinelTrades.userId, userId),
          eq(sentinelTrades.status, "closed"),
          or(
            eq(sentinelTrades.isTagged, false),
            isNull(sentinelTrades.isTagged)
          )
        ))
        .orderBy(desc(sentinelTrades.exitDate))
        .limit(50); // Limit to 50 trades for performance
      
      if (untaggedTrades.length === 0) {
        return res.json({ suggestions: [], message: "No untagged trades to analyze" });
      }
      
      // Check for OpenAI API key
      const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
      const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
      
      if (!apiKey) {
        // Fallback: group by symbol and direction only
        const groups = new Map<string, typeof untaggedTrades>();
        untaggedTrades.forEach(trade => {
          const key = `${trade.symbol}_${trade.direction}`;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push(trade);
        });
        
        const suggestions = Array.from(groups.entries())
          .filter(([, trades]) => trades.length >= 2)
          .map(([key, trades]) => {
            const [symbol, direction] = key.split('_');
            return {
              groupKey: key,
              symbol,
              direction,
              tradeIds: trades.map(t => t.id),
              tradeCount: trades.length,
              suggestedSetupType: null,
              confidence: null,
              reasoning: "AI analysis unavailable - grouped by symbol and direction",
              sample: {
                entryPrice: trades[0].entryPrice,
                exitPrice: trades[0].exitPrice,
                entryDate: trades[0].entryDate,
              }
            };
          });
        
        return res.json({ 
          suggestions, 
          message: "Grouped by pattern (AI analysis not available)",
          aiEnabled: false
        });
      }
      
      // Prepare trade summaries for AI analysis
      const tradeSummaries = untaggedTrades.map(trade => {
        const entryPrice = Number(trade.entryPrice) || 0;
        const exitPrice = Number(trade.exitPrice) || entryPrice;
        const pnlPercent = entryPrice > 0 ? ((exitPrice - entryPrice) / entryPrice) * 100 * (trade.direction === 'long' ? 1 : -1) : 0;
        const holdDays = trade.entryDate && trade.exitDate ? 
          Math.ceil((new Date(trade.exitDate).getTime() - new Date(trade.entryDate).getTime()) / (1000 * 60 * 60 * 24)) : null;
        
        return {
          id: trade.id,
          symbol: trade.symbol,
          direction: trade.direction,
          entryPrice: entryPrice.toFixed(2),
          exitPrice: exitPrice.toFixed(2),
          pnlPercent: pnlPercent.toFixed(1),
          outcome: pnlPercent > 0 ? 'win' : 'loss',
          holdDays,
          entryDate: trade.entryDate ? new Date(trade.entryDate).toISOString().split('T')[0] : null,
          notes: trade.notes?.substring(0, 100) || null,
          thesis: trade.thesis?.substring(0, 100) || null,
        };
      });
      
      // Use AI to analyze trades and suggest setup types
      const OpenAI = await import('openai');
      const openai = new OpenAI.default({ apiKey, baseURL });
      
      const setupTypes = [
        "breakout - stock breaks above resistance with volume",
        "pullback - stock pulls back to support after rally",
        "cup_and_handle - classic cup and handle pattern",
        "vcp - volatility contraction pattern",
        "episodic_pivot - earnings or news driven gap up",
        "reclaim - stock reclaims key moving average",
        "high_tight_flag - flag pattern after strong move",
        "low_cheat - shakeout below pivot point",
        "undercut_rally - false breakdown followed by rally",
        "orb - opening range breakout",
        "short_lost_50 - short on stock losing 50 SMA",
        "short_lost_200 - short on stock losing 200 SMA",
        "other - doesn't match any specific pattern"
      ];
      
      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are an expert stock trader analyzing historical trades to identify setup patterns.
            
Given a list of closed trades, group similar trades and suggest the most likely setup type for each group.

Available setup types:
${setupTypes.map(s => `- ${s}`).join('\n')}

Analyze the trades looking for patterns based on:
- Symbol groupings (same stock = likely same strategy)
- Entry/exit characteristics
- Hold duration patterns
- Win/loss patterns
- Any notes or thesis hints

Return a JSON object with a "groups" array. Each group should have:
- tradeIds: array of trade IDs that belong together
- suggestedSetupType: the setup type code (e.g., "breakout", "pullback")
- confidence: "high", "medium", or "low"
- reasoning: brief explanation of why these trades match this setup

Only group trades with 2+ members. Ungrouped trades can be suggested individually if there's strong evidence.`
          },
          {
            role: "user",
            content: `Analyze these ${tradeSummaries.length} trades and suggest setup types:\n\n${JSON.stringify(tradeSummaries, null, 2)}`
          }
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
        max_tokens: 2000,
      });
      
      const responseText = completion.choices[0]?.message?.content || "{}";
      let aiResult: { groups?: Array<{
        tradeIds: number[];
        suggestedSetupType: string;
        confidence: string;
        reasoning: string;
      }> } = {};
      
      try {
        aiResult = JSON.parse(responseText);
      } catch (e) {
        console.error("Failed to parse AI batch tag response:", e);
      }
      
      // Build suggestions from AI groups
      const suggestions = (aiResult.groups || []).map((group, index) => {
        const matchingTrades = untaggedTrades.filter(t => group.tradeIds.includes(t.id));
        if (matchingTrades.length === 0) return null;
        
        const symbols = [...new Set(matchingTrades.map(t => t.symbol))];
        const directions = [...new Set(matchingTrades.map(t => t.direction))];
        
        return {
          groupKey: `ai_group_${index}`,
          symbols,
          symbol: symbols.length === 1 ? symbols[0] : `${symbols.length} symbols`,
          directions,
          direction: directions.length === 1 ? directions[0] : 'mixed',
          tradeIds: matchingTrades.map(t => t.id),
          tradeCount: matchingTrades.length,
          suggestedSetupType: group.suggestedSetupType,
          confidence: group.confidence,
          reasoning: group.reasoning,
          sample: {
            entryPrice: matchingTrades[0].entryPrice,
            exitPrice: matchingTrades[0].exitPrice,
            entryDate: matchingTrades[0].entryDate,
          }
        };
      }).filter(Boolean);
      
      res.json({ 
        suggestions, 
        message: suggestions.length > 0 ? `Found ${suggestions.length} groups with suggested tags` : "No clear patterns found",
        aiEnabled: true,
        analyzedCount: untaggedTrades.length,
      });
    } catch (error) {
      console.error("Batch tag suggestions error:", error);
      res.status(500).json({ error: "Failed to generate batch tag suggestions" });
    }
  });

  // Apply batch tags to multiple trades
  app.post("/api/sentinel/trades/batch-tag", requireAuth, async (req: Request, res: Response) => {
    try {
      const batchTagSchema = z.object({
        tradeIds: z.array(z.number()).min(1, "At least one trade ID required"),
        setupType: z.string().min(1, "Setup type is required"),
        outcome: z.enum(["win", "loss", "breakeven"]).optional(),
      });
      
      const result = batchTagSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ error: result.error.errors[0].message });
      }
      
      const { tradeIds, setupType, outcome } = result.data;
      const userId = req.session.userId!;
      
      // Verify all trades belong to this user
      const trades = await db.select({ id: sentinelTrades.id })
        .from(sentinelTrades)
        .where(and(
          eq(sentinelTrades.userId, userId),
          inArray(sentinelTrades.id, tradeIds)
        ));
      
      if (trades.length !== tradeIds.length) {
        return res.status(400).json({ error: "Some trades not found or not owned by user" });
      }
      
      // Update trades with tags
      const now = new Date();
      let updateData: Record<string, any> = {
        setupType,
        isTagged: true,
        taggedAt: now,
        updatedAt: now,
      };
      
      if (outcome) {
        updateData.outcome = outcome;
      }
      
      await db.update(sentinelTrades)
        .set(updateData)
        .where(and(
          eq(sentinelTrades.userId, userId),
          inArray(sentinelTrades.id, tradeIds)
        ));
      
      res.json({ 
        success: true, 
        updatedCount: tradeIds.length,
        message: `Tagged ${tradeIds.length} trades as ${setupType}` 
      });
    } catch (error) {
      console.error("Batch tag error:", error);
      res.status(500).json({ error: "Failed to batch tag trades" });
    }
  });

  // Closed trades history
  app.get("/api/sentinel/trades/closed", requireAuth, async (req: Request, res: Response) => {
    try {
      const trades = await sentinelModels.getClosedTrades(req.session.userId!);
      res.json(trades);
    } catch (error) {
      console.error("Closed trades error:", error);
      res.status(500).json({ error: "Failed to load closed trades" });
    }
  });

  // Ticker info endpoint for quick lookup
  app.get("/api/sentinel/ticker/:symbol", async (req: Request, res: Response) => {
    const symbolParam = req.params.symbol;
    const symbol = typeof symbolParam === 'string' ? symbolParam.toUpperCase() : '';
    if (!symbol) {
      return res.status(400).json({ error: "Symbol required" });
    }

    try {
      // Dynamic import Yahoo Finance
      const YahooFinanceModule = await import('yahoo-finance2') as any;
      const YahooFinance = YahooFinanceModule.default || YahooFinanceModule;
      let yf: any;
      if (typeof YahooFinance === 'function') {
        yf = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });
      } else if (YahooFinance.default && typeof YahooFinance.default === 'function') {
        yf = new YahooFinance.default({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });
      } else {
        yf = YahooFinance;
      }

      const quote = await yf.quote(symbol);
      
      let sector = quote.sector || 'Unknown';
      let industry = quote.industry || 'Unknown';
      let description = '';
      
      // Try to get detailed info
      try {
        const summary = await yf.quoteSummary(symbol, { modules: ['assetProfile'] });
        if (summary.assetProfile) {
          sector = summary.assetProfile.sector || sector;
          industry = summary.assetProfile.industry || industry;
          description = summary.assetProfile.longBusinessSummary || '';
          // Truncate description to first 2 sentences
          if (description) {
            const sentences = description.match(/[^.!?]+[.!?]+/g) || [];
            description = sentences.slice(0, 2).join(' ').trim();
          }
        }
      } catch (e) {
        // Use basic quote data
      }

      res.json({
        symbol,
        name: quote.shortName || quote.longName || symbol,
        currentPrice: quote.regularMarketPrice,
        previousClose: quote.regularMarketPreviousClose,
        sector,
        industry,
        description
      });
    } catch (error) {
      console.error(`Ticker lookup failed for ${symbol}:`, error);
      res.status(404).json({ error: `Symbol ${symbol} not found` });
    }
  });

  // AI Rule Suggestions Routes
  
  // Get pending suggestions
  app.get("/api/sentinel/suggestions", requireAuth, async (req: Request, res: Response) => {
    try {
      const suggestions = await sentinelModels.getPendingSuggestions();
      res.json(suggestions);
    } catch (error) {
      console.error("Get suggestions error:", error);
      res.status(500).json({ error: "Failed to load suggestions" });
    }
  });

  // Adopt a suggestion (add to user's rules)
  app.post("/api/sentinel/suggestions/:id/adopt", requireAuth, async (req: Request, res: Response) => {
    try {
      const suggestionId = parseInt(req.params.id as string);
      const rule = await sentinelModels.adoptSuggestion(suggestionId, req.session.userId!);
      res.json(rule);
    } catch (error) {
      console.error("Adopt suggestion error:", error);
      res.status(500).json({ error: "Failed to adopt suggestion" });
    }
  });

  // Dismiss a suggestion
  app.post("/api/sentinel/suggestions/:id/dismiss", requireAuth, async (req: Request, res: Response) => {
    try {
      const suggestionId = parseInt(req.params.id as string);
      await sentinelModels.updateSuggestionStatus(suggestionId, 'dismissed');
      res.json({ success: true });
    } catch (error) {
      console.error("Dismiss suggestion error:", error);
      res.status(500).json({ error: "Failed to dismiss suggestion" });
    }
  });

  // Get rule performance stats
  app.get("/api/sentinel/rule-performance", requireAuth, async (req: Request, res: Response) => {
    try {
      const stats = await sentinelModels.getRulePerformanceStats();
      res.json(stats);
    } catch (error) {
      console.error("Rule performance error:", error);
      res.status(500).json({ error: "Failed to load rule performance" });
    }
  });

  // AI-powered rule analysis and suggestion generation
  app.post("/api/sentinel/ai/analyze-rules", requireAuth, async (req: Request, res: Response) => {
    try {
      // Get rule performance data (only rules with enough trades for meaningful analysis)
      const performanceData = await sentinelModels.getHighDataRules(5);
      
      // Need minimum data for analysis
      if (performanceData.length < 3) {
        return res.json({ 
          message: "Not enough data yet. Keep trading to gather rule performance insights. You need at least 3 rules with 5+ trades each.",
          suggestions: []
        });
      }

      // Prepare analysis summary for AI
      const analysisPrompt = `Analyze these trading rule performance statistics and suggest 1-3 new rules:

RULE PERFORMANCE DATA:
${performanceData.map(r => `- ${r.ruleName}: ${r.totalTrades} trades, Win rate when followed: ${((r.winRateWhenFollowed || 0) * 100).toFixed(1)}%, Win rate when not followed: ${((r.winRateWhenNotFollowed || 0) * 100).toFixed(1)}%, Avg P&L followed: $${(r.avgPnLWhenFollowed || 0).toFixed(2)}, Avg P&L not followed: $${(r.avgPnLWhenNotFollowed || 0).toFixed(2)}`).join('\n')}

Based on patterns in this data:
1. Identify rules with significant win rate differences when followed vs not followed
2. Look for rules that show strong P&L improvement when followed
3. Suggest modifications or new rules that could improve outcomes

Return a JSON array of suggested rules with format:
[{
  "name": "Rule name (concise)",
  "description": "Why this rule matters based on the data",
  "category": "entry|exit|stop_loss|position_sizing|ma_structure|base_quality|breakout|market_regime|risk",
  "severity": "warning|critical",
  "isAutoReject": false,
  "ruleCode": "unique_snake_case_code",
  "formula": "Optional formula like 'stop_percent <= 3%'",
  "confidenceScore": 0.7 to 0.95,
  "patternDescription": "What data pattern supports this rule"
}]

Only suggest rules NOT already in the list. Focus on actionable, specific rules.`;

      let openai: OpenAI;
      try {
        openai = new OpenAI();
      } catch (configError) {
        console.error("OpenAI configuration error:", configError);
        return res.status(500).json({ error: "AI service not configured. Please ensure OpenAI API key is set." });
      }

      let completion;
      try {
        completion = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            { role: "system", content: "You are a trading analytics expert. Analyze rule performance data and suggest new rules based on patterns you observe. Return ONLY valid JSON array." },
            { role: "user", content: analysisPrompt }
          ],
          temperature: 0.7,
        });
      } catch (aiError: any) {
        console.error("OpenAI API error:", aiError);
        return res.status(500).json({ error: "AI analysis failed. Please try again later." });
      }

      const responseText = completion.choices[0].message.content || '[]';
      
      // Parse AI response
      let suggestedRules: any[] = [];
      try {
        // Extract JSON from response (handle markdown code blocks)
        const jsonMatch = responseText.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          suggestedRules = JSON.parse(jsonMatch[0]);
        }
      } catch (parseError) {
        console.error("Failed to parse AI response:", parseError);
        return res.json({ message: "AI analysis complete but no valid suggestions generated", suggestions: [] });
      }

      // Store new suggestions (avoid duplicates)
      const newSuggestions = [];
      for (const rule of suggestedRules) {
        if (!rule.ruleCode) continue;
        
        const existing = await sentinelModels.getSuggestionByRuleCode(rule.ruleCode);
        if (!existing) {
          const suggestion = await sentinelModels.createRuleSuggestion({
            name: rule.name || 'Untitled Rule',
            description: rule.description || null,
            category: rule.category || 'general',
            source: 'ai_collective',
            severity: rule.severity || 'warning',
            isAutoReject: rule.isAutoReject || false,
            ruleCode: rule.ruleCode,
            formula: rule.formula || null,
            confidenceScore: rule.confidenceScore || 0.7,
            supportingData: {
              patternDescription: rule.patternDescription || rule.evidence || null,
            },
          });
          newSuggestions.push(suggestion);
        }
      }

      res.json({
        message: `AI analysis complete. ${newSuggestions.length} new suggestion(s) generated.`,
        suggestions: newSuggestions
      });
    } catch (error) {
      console.error("AI rule analysis error:", error);
      res.status(500).json({ error: "Failed to analyze rules" });
    }
  });

  // Market Sentiment endpoints
  app.get("/api/sentinel/sentiment/market", requireAuth, async (req: Request, res: Response) => {
    try {
      const sentiment = await fetchMarketSentiment();
      const cacheAgeMinutes = getSentimentCacheAge();
      res.json({ ...sentiment, cacheAgeMinutes });
    } catch (error) {
      console.error("Market sentiment error:", error);
      res.status(500).json({ error: "Failed to fetch market sentiment" });
    }
  });

  app.get("/api/sentinel/sentiment/sector/:symbol", requireAuth, async (req: Request, res: Response) => {
    try {
      const symbol = req.params.symbol as string;
      const sectorTrend = await fetchSectorSentiment(symbol.toUpperCase());
      if (!sectorTrend) {
        return res.status(404).json({ error: "Sector data not available for this symbol" });
      }
      res.json(sectorTrend);
    } catch (error) {
      console.error("Sector sentiment error:", error);
      res.status(500).json({ error: "Failed to fetch sector sentiment" });
    }
  });

  // === TRADE LABELS ENDPOINTS ===

  // Get all labels (filtered by admin status)
  app.get("/api/sentinel/labels", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const user = await sentinelModels.getUserById(userId);
      const isAdmin = user?.isAdmin ?? false;

      // Admin sees all labels, regular users only see non-admin labels
      let labels;
      if (isAdmin) {
        labels = await db
          .select()
          .from(sentinelTradeLabels)
          .orderBy(sentinelTradeLabels.name);
      } else {
        labels = await db
          .select()
          .from(sentinelTradeLabels)
          .where(eq(sentinelTradeLabels.isAdminOnly, false))
          .orderBy(sentinelTradeLabels.name);
      }

      res.json(labels);
    } catch (error) {
      console.error("Get labels error:", error);
      res.status(500).json({ error: "Failed to fetch labels" });
    }
  });

  // Create a new label
  app.post("/api/sentinel/labels", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const user = await sentinelModels.getUserById(userId);
      const isAdmin = user?.isAdmin ?? false;

      const validatedData = insertSentinelTradeLabelSchema.parse({
        ...req.body,
        createdBy: userId,
        isAdminOnly: req.body.isAdminOnly && isAdmin ? true : false, // Only admins can create admin-only labels
      });

      const [label] = await db
        .insert(sentinelTradeLabels)
        .values(validatedData)
        .returning();

      res.status(201).json(label);
    } catch (error) {
      console.error("Create label error:", error);
      res.status(500).json({ error: "Failed to create label" });
    }
  });

  // Get labels for a specific trade
  app.get("/api/sentinel/trades/:tradeId/labels", requireAuth, async (req: Request, res: Response) => {
    try {
      const tradeId = parseInt(req.params.tradeId as string);
      const userId = req.session.userId!;
      const user = await sentinelModels.getUserById(userId);
      const isAdmin = user?.isAdmin ?? false;

      let labels;
      if (isAdmin) {
        labels = await db
          .select({
            id: sentinelTradeLabels.id,
            name: sentinelTradeLabels.name,
            color: sentinelTradeLabels.color,
            description: sentinelTradeLabels.description,
            isAdminOnly: sentinelTradeLabels.isAdminOnly,
          })
          .from(sentinelTradeToLabels)
          .innerJoin(sentinelTradeLabels, eq(sentinelTradeToLabels.labelId, sentinelTradeLabels.id))
          .where(eq(sentinelTradeToLabels.tradeId, tradeId));
      } else {
        labels = await db
          .select({
            id: sentinelTradeLabels.id,
            name: sentinelTradeLabels.name,
            color: sentinelTradeLabels.color,
            description: sentinelTradeLabels.description,
            isAdminOnly: sentinelTradeLabels.isAdminOnly,
          })
          .from(sentinelTradeToLabels)
          .innerJoin(sentinelTradeLabels, eq(sentinelTradeToLabels.labelId, sentinelTradeLabels.id))
          .where(
            and(
              eq(sentinelTradeToLabels.tradeId, tradeId),
              eq(sentinelTradeLabels.isAdminOnly, false)
            )
          );
      }

      res.json(labels);
    } catch (error) {
      console.error("Get trade labels error:", error);
      res.status(500).json({ error: "Failed to fetch trade labels" });
    }
  });

  // Add labels to a trade
  app.post("/api/sentinel/trades/:tradeId/labels", requireAuth, async (req: Request, res: Response) => {
    try {
      const tradeId = parseInt(req.params.tradeId as string);
      const { labelIds } = req.body as { labelIds: number[] };

      if (!labelIds || !Array.isArray(labelIds)) {
        return res.status(400).json({ error: "labelIds must be an array" });
      }

      // Remove existing labels first, then add new ones
      await db.delete(sentinelTradeToLabels).where(eq(sentinelTradeToLabels.tradeId, tradeId));

      if (labelIds.length > 0) {
        await db.insert(sentinelTradeToLabels).values(
          labelIds.map((labelId) => ({ tradeId, labelId }))
        );
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Update trade labels error:", error);
      res.status(500).json({ error: "Failed to update trade labels" });
    }
  });

  // Get current user's admin status
  app.get("/api/sentinel/me", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const user = await sentinelModels.getUserById(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      res.json({
        id: user.id,
        username: user.username,
        email: user.email,
        isAdmin: user.isAdmin ?? false,
        accountSize: user.accountSize,
      });
    } catch (error) {
      console.error("Get user info error:", error);
      res.status(500).json({ error: "Failed to fetch user info" });
    }
  });

  // === TNN (Trader Neural Network) ROUTES ===

  // Seed TNN data (admin only, one-time setup)
  app.post("/api/sentinel/tnn/seed", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const user = await sentinelModels.getUserById(userId);
      if (!user?.isAdmin) {
        return res.status(403).json({ error: "Admin access required" });
      }

      const result = await tnn.seedTnnData();
      res.json(result);
    } catch (error) {
      console.error("TNN seed error:", error);
      res.status(500).json({ error: "Failed to seed TNN data" });
    }
  });

  // Get all factors (auto-seeds missing factors on first access)
  app.get("/api/sentinel/tnn/factors", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const user = await sentinelModels.getUserById(userId);
      console.log("[TNN Factors] userId:", userId, "isAdmin:", user?.isAdmin);
      if (!user?.isAdmin) {
        return res.status(403).json({ error: "Admin access required" });
      }

      // Auto-seed TNN data if needed (handles missing setup_type factors on production)
      try {
        await tnn.seedTnnData();
      } catch (seedError) {
        console.log("[TNN Factors] Seed check completed or skipped");
      }

      const factorType = req.query.type as string | undefined;
      const factors = await tnn.getFactors(factorType);
      console.log("[TNN Factors] Returning", factors.length, "factors, types:", [...new Set(factors.map(f => f.factorType))]);
      res.json(factors);
    } catch (error) {
      console.error("Get factors error:", error);
      res.status(500).json({ error: "Failed to fetch factors" });
    }
  });

  // Update factor
  app.patch("/api/sentinel/tnn/factors/:factorKey", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const user = await sentinelModels.getUserById(userId);
      if (!user?.isAdmin) {
        return res.status(403).json({ error: "Admin access required" });
      }

      const { factorKey } = req.params;
      const updates = req.body;
      const factor = await tnn.updateFactor(factorKey, updates, user.username, updates.reason);
      res.json(factor);
    } catch (error) {
      console.error("Update factor error:", error);
      res.status(500).json({ error: "Failed to update factor" });
    }
  });

  // Get all modifiers
  app.get("/api/sentinel/tnn/modifiers", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const user = await sentinelModels.getUserById(userId);
      if (!user?.isAdmin) {
        return res.status(403).json({ error: "Admin access required" });
      }

      const factorKey = req.query.factorKey as string | undefined;
      const modifiers = await tnn.getModifiers(factorKey);
      res.json(modifiers);
    } catch (error) {
      console.error("Get modifiers error:", error);
      res.status(500).json({ error: "Failed to fetch modifiers" });
    }
  });

  // Create modifier
  app.post("/api/sentinel/tnn/modifiers", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const user = await sentinelModels.getUserById(userId);
      if (!user?.isAdmin) {
        return res.status(403).json({ error: "Admin access required" });
      }

      const modifier = await tnn.createModifier(req.body, user.username);
      res.json(modifier);
    } catch (error) {
      console.error("Create modifier error:", error);
      res.status(500).json({ error: "Failed to create modifier" });
    }
  });

  // Update modifier
  app.patch("/api/sentinel/tnn/modifiers/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const user = await sentinelModels.getUserById(userId);
      if (!user?.isAdmin) {
        return res.status(403).json({ error: "Admin access required" });
      }

      const id = parseInt(req.params.id);
      const modifier = await tnn.updateModifier(id, req.body, user.username);
      res.json(modifier);
    } catch (error) {
      console.error("Update modifier error:", error);
      res.status(500).json({ error: "Failed to update modifier" });
    }
  });

  // Delete modifier
  app.delete("/api/sentinel/tnn/modifiers/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const user = await sentinelModels.getUserById(userId);
      if (!user?.isAdmin) {
        return res.status(403).json({ error: "Admin access required" });
      }

      const id = parseInt(req.params.id);
      const result = await tnn.deleteModifier(id, user.username);
      res.json(result);
    } catch (error) {
      console.error("Delete modifier error:", error);
      res.status(500).json({ error: "Failed to delete modifier" });
    }
  });

  // Get suggestions
  app.get("/api/sentinel/tnn/suggestions", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const user = await sentinelModels.getUserById(userId);
      if (!user?.isAdmin) {
        return res.status(403).json({ error: "Admin access required" });
      }

      const status = req.query.status as string | undefined;
      const suggestions = await tnn.getSuggestions(status);
      res.json(suggestions);
    } catch (error) {
      console.error("Get suggestions error:", error);
      res.status(500).json({ error: "Failed to fetch suggestions" });
    }
  });

  // Review suggestion (approve/reject)
  app.post("/api/sentinel/tnn/suggestions/:id/review", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const user = await sentinelModels.getUserById(userId);
      if (!user?.isAdmin) {
        return res.status(403).json({ error: "Admin access required" });
      }

      const id = parseInt(req.params.id);
      const { approved, notes } = req.body;
      const suggestion = await tnn.reviewSuggestion(id, approved, userId, notes);
      res.json(suggestion);
    } catch (error) {
      console.error("Review suggestion error:", error);
      res.status(500).json({ error: "Failed to review suggestion" });
    }
  });

  // Get history
  app.get("/api/sentinel/tnn/history", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const user = await sentinelModels.getUserById(userId);
      if (!user?.isAdmin) {
        return res.status(403).json({ error: "Admin access required" });
      }

      const limit = parseInt(req.query.limit as string) || 50;
      const history = await tnn.getHistory(limit);
      res.json(history);
    } catch (error) {
      console.error("Get history error:", error);
      res.status(500).json({ error: "Failed to fetch history" });
    }
  });

  // Get settings
  app.get("/api/sentinel/tnn/settings", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const user = await sentinelModels.getUserById(userId);
      if (!user?.isAdmin) {
        return res.status(403).json({ error: "Admin access required" });
      }

      const settings = await tnn.getSettings();
      res.json(settings);
    } catch (error) {
      console.error("Get settings error:", error);
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  // Update setting
  app.patch("/api/sentinel/tnn/settings/:key", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const user = await sentinelModels.getUserById(userId);
      if (!user?.isAdmin) {
        return res.status(403).json({ error: "Admin access required" });
      }

      const { key } = req.params;
      const { value } = req.body;
      const setting = await tnn.updateSetting(key, value, user.username);
      res.json(setting);
    } catch (error) {
      console.error("Update setting error:", error);
      res.status(500).json({ error: "Failed to update setting" });
    }
  });

  // === TNN LEARNING ROUTES ===

  // Analyze tagged trades and get performance metrics
  app.get("/api/sentinel/tnn/learning/analyze", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const user = await sentinelModels.getUserById(userId);
      
      // Admin can analyze all trades, regular users only see their own
      const analysis = await tnn.analyzeTaggedTrades(user?.isAdmin ? undefined : userId);
      res.json(analysis);
    } catch (error) {
      console.error("TNN learning analysis error:", error);
      res.status(500).json({ error: "Failed to analyze trades for TNN learning" });
    }
  });

  // Get user-specific performance summary
  app.get("/api/sentinel/tnn/learning/performance", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const performance = await tnn.getUserTradePerformance(userId);
      res.json(performance);
    } catch (error) {
      console.error("TNN performance error:", error);
      res.status(500).json({ error: "Failed to get trade performance" });
    }
  });

  // Generate TNN suggestions from tagged trades (admin only for system-wide)
  app.post("/api/sentinel/tnn/learning/generate-suggestions", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const user = await sentinelModels.getUserById(userId);
      
      if (!user?.isAdmin) {
        return res.status(403).json({ error: "Admin access required to generate TNN suggestions" });
      }
      
      const count = await tnn.createLearningBasedSuggestions(userId, true);
      res.json({ message: `Generated ${count} new TNN suggestions based on tagged trades`, count });
    } catch (error) {
      console.error("TNN suggestion generation error:", error);
      res.status(500).json({ error: "Failed to generate TNN suggestions" });
    }
  });

  // === TRADE IMPORT ROUTES ===

  // Preview CSV import (parse without saving)
  app.post("/api/sentinel/import/preview", requireAuth, async (req: Request, res: Response) => {
    try {
      console.log("[Import Preview] Starting preview request");
      const validationResult = importPreviewSchema.safeParse(req.body);
      if (!validationResult.success) {
        console.log("[Import Preview] Validation failed:", validationResult.error.errors);
        return res.status(400).json({ error: validationResult.error.errors[0]?.message || "Invalid request" });
      }
      
      const { csvContent, fileName, brokerId } = validationResult.data;
      console.log(`[Import Preview] Parsing file: ${fileName}, broker: ${brokerId}, content length: ${csvContent.length}`);
      
      const userId = req.session.userId!;
      console.log(`[Import Preview] User ID: ${userId}`);
      const user = await sentinelModels.getUserById(userId);
      console.log(`[Import Preview] User found: ${user?.username || 'not found'}`);
      
      const result = parseCSV(csvContent, fileName || "upload.csv", user?.username || "unknown", brokerId as BrokerId);
      console.log(`[Import Preview] Parse complete: ${result.trades.length} trades, status: ${result.batch.status}`);
      
      res.json({
        batch: result.batch,
        trades: result.trades,
        detectedBroker: detectBroker(csvContent),
      });
    } catch (error) {
      console.error("[Import Preview] Error:", error);
      console.error("[Import Preview] Error stack:", error instanceof Error ? error.stack : "No stack");
      res.status(500).json({ 
        error: "Failed to preview import",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Import trades (save to database) - uses transaction for atomicity
  app.post("/api/sentinel/import/confirm", requireAuth, async (req: Request, res: Response) => {
    try {
      const validationResult = importConfirmSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ error: validationResult.error.errors[0]?.message || "Invalid request" });
      }
      
      const { csvContent, fileName, brokerId, timestampOverride } = validationResult.data;
      
      const userId = req.session.userId!;
      const user = await sentinelModels.getUserById(userId);
      
      const result = parseCSV(csvContent, fileName || "upload.csv", user?.username || "unknown", brokerId as BrokerId);
      
      if (result.batch.status === "FAILED") {
        return res.status(400).json({ error: "Failed to parse CSV", batch: result.batch });
      }
      
      // Detect orphan sells - sells with no prior buy across ALL sources:
      // 1. Current import file
      // 2. Previously imported trades
      // 3. Hand-entered sentinel_trades
      // Only flag as orphan if account doesn't allow short sales
      
      // Get account settings to check if short sales are allowed
      const accountSettings = await db!.select().from(sentinelAccountSettings)
        .where(eq(sentinelAccountSettings.userId, userId));
      
      // Build a lookup for account short sale settings
      const accountShortAllowed = new Map<string, boolean>();
      for (const setting of accountSettings) {
        const key = `${setting.brokerId}:${setting.accountName || ''}`;
        accountShortAllowed.set(key, setting.allowsShortSales);
      }
      
      // Group trades by ticker from current import
      const tradesByTicker: Record<string, typeof result.trades> = {};
      const tickersInImport = new Set<string>();
      for (const trade of result.trades) {
        if (!tradesByTicker[trade.ticker]) {
          tradesByTicker[trade.ticker] = [];
        }
        tradesByTicker[trade.ticker].push(trade);
        tickersInImport.add(trade.ticker);
      }
      
      // Skip orphan detection if no tickers
      let orphanSellsCount = 0;
      const orphanSellTradeIds = new Set<string>();
      
      if (tickersInImport.size > 0) {
        // Fetch existing imported trades for these tickers (from previous imports)
        // Include accountName for per-account filtering
        const existingImportedTrades = await db!.select({
          ticker: sentinelImportedTrades.ticker,
          direction: sentinelImportedTrades.direction,
          quantity: sentinelImportedTrades.quantity,
          tradeDate: sentinelImportedTrades.tradeDate,
          accountName: sentinelImportedTrades.accountName,
          id: sentinelImportedTrades.id, // For stable ordering
        }).from(sentinelImportedTrades)
          .where(and(
            eq(sentinelImportedTrades.userId, userId),
            inArray(sentinelImportedTrades.ticker, Array.from(tickersInImport))
          ))
          .orderBy(sentinelImportedTrades.tradeDate, sentinelImportedTrades.id);
        
        // Fetch hand-entered trades for these tickers
        // Now includes accountName for per-account position tracking
        const existingHandTrades = await db!.select({
          id: sentinelTrades.id,
          symbol: sentinelTrades.symbol,
          direction: sentinelTrades.direction,
          positionSize: sentinelTrades.positionSize,
          entryDate: sentinelTrades.entryDate,
          exitDate: sentinelTrades.exitDate,
          lotEntries: sentinelTrades.lotEntries,
          accountName: sentinelTrades.accountName,
        }).from(sentinelTrades)
          .where(and(
            eq(sentinelTrades.userId, userId),
            inArray(sentinelTrades.symbol, Array.from(tickersInImport))
          ))
          .orderBy(sentinelTrades.entryDate, sentinelTrades.id);
        
        // Process each ticker
        for (const ticker of Object.keys(tradesByTicker)) {
          // Process current import trades grouped by account+ticker
          // Each account's position is tracked separately to avoid cross-account matching
          const currentTrades = tradesByTicker[ticker];
        const currentBrokerId = result.batch.brokerId;
        
        // Group current import trades by account
        const tradesByAccount = new Map<string, typeof currentTrades>();
        for (const t of currentTrades) {
          const accountKey = t.accountName || '__default__';
          if (!tradesByAccount.has(accountKey)) {
            tradesByAccount.set(accountKey, []);
          }
          tradesByAccount.get(accountKey)!.push(t);
        }
        
        // Process each account separately
        for (const [accountKey, accountTrades] of tradesByAccount) {
          // Build unified transaction list with stable IDs
          type UnifiedTrade = { 
            id: string; 
            direction: string; 
            quantity: number; 
            tradeDate: Date; 
            sourcePriority: number; // 1=existing, 2=hand, 3=current (for deterministic sorting)
            isCurrentImport: boolean;
          };
          const allTrades: UnifiedTrade[] = [];
          
          // Add existing imported trades for this ticker AND account (priority 1)
          // Filter by both ticker AND accountName to keep positions separate per account
          const accountNameFilter = accountKey === '__default__' ? null : accountKey;
          for (const t of existingImportedTrades.filter(t => 
            t.ticker === ticker && 
            (t.accountName || null) === accountNameFilter
          )) {
            allTrades.push({
              id: `existing_${t.id}`, // Use DB id for stable ordering
              direction: t.direction,
              quantity: t.quantity,
              tradeDate: new Date(t.tradeDate),
              sourcePriority: 1,
              isCurrentImport: false,
            });
          }
          
          // Add hand-entered trades (priority 2)
          // Use lot entries for accurate FIFO tracking
          // Filter by accountName if available, otherwise include as general baseline
          for (const t of existingHandTrades.filter(t => 
            t.symbol === ticker && 
            (t.accountName || null) === accountNameFilter
          )) {
            // Process lot entries for accurate position tracking
            const lots = t.lotEntries as Array<{ id: string; dateTime: string; qty: string; buySell: 'buy' | 'sell'; price: string }> || [];
            if (lots.length > 0) {
              for (const lot of lots) {
                allTrades.push({
                  id: `hand_lot_${t.id}_${lot.id}`,
                  direction: lot.buySell === 'buy' ? 'BUY' : 'SELL',
                  quantity: parseFloat(lot.qty) || 0,
                  tradeDate: new Date(lot.dateTime),
                  sourcePriority: 2,
                  isCurrentImport: false,
                });
              }
            } else if (t.entryDate && t.positionSize) {
              // Fallback to aggregate position if no lot entries
              // Handle both lowercase and uppercase direction values
              const isLong = t.direction?.toLowerCase() === 'long';
              const entryDirection = isLong ? 'BUY' : 'SELL';
              allTrades.push({
                id: `hand_entry_${t.id}`,
                direction: entryDirection,
                quantity: t.positionSize,
                tradeDate: new Date(t.entryDate),
                sourcePriority: 2,
                isCurrentImport: false,
              });
            }
          }
          
          // Add current import trades for THIS ACCOUNT only (priority 3)
          for (const t of accountTrades) {
            allTrades.push({
              id: t.tradeId,
              direction: t.direction,
              quantity: t.quantity,
              tradeDate: new Date(t.tradeDate),
              sourcePriority: 3,
              isCurrentImport: true,
            });
          }
          
          // Sort by date, then direction (BUYs before SELLs), then by source priority, then by id (stable tie-breaker)
          allTrades.sort((a, b) => {
            const dateDiff = a.tradeDate.getTime() - b.tradeDate.getTime();
            if (dateDiff !== 0) return dateDiff;
            // On same date, process BUYs before SELLs for proper FIFO
            if (a.direction === 'BUY' && b.direction === 'SELL') return -1;
            if (a.direction === 'SELL' && b.direction === 'BUY') return 1;
            const priorityDiff = a.sourcePriority - b.sourcePriority;
            if (priorityDiff !== 0) return priorityDiff;
            return a.id.localeCompare(b.id);
          });
          
          // Check short sale settings for this account
          const tradeAccountKey = `${currentBrokerId}:${accountKey === '__default__' ? '' : accountKey}`;
          const shortSalesAllowed = accountShortAllowed.get(tradeAccountKey) ?? false;
          
          // Calculate running position and identify orphans for this account
          let runningPosition = 0;
          const EPSILON = 0.0001; // Small tolerance for floating point comparison
          
          for (const trade of allTrades) {
            if (trade.direction === 'BUY') {
              runningPosition += trade.quantity;
            } else if (trade.direction === 'SELL') {
              // For current import sells, check if position is sufficient (with epsilon tolerance)
              if (trade.isCurrentImport && runningPosition < trade.quantity - EPSILON && !shortSalesAllowed) {
                orphanSellTradeIds.add(trade.id);
              }
              runningPosition = Math.max(0, runningPosition - trade.quantity);
            }
          }
          }
        }
        
        orphanSellsCount = orphanSellTradeIds.size;
      }
      
      // Use a transaction to ensure atomicity - either all trades are saved or none
      await db.transaction(async (tx) => {
        // Save batch first
        // Generate default import name: "FILE" + last 4 chars of filename (without extension)
        const fileNameWithoutExt = result.batch.fileName.replace(/\.[^/.]+$/, "");
        const last4Chars = fileNameWithoutExt.slice(-4).toUpperCase();
        const defaultImportName = `FILE${last4Chars}`;
        
        await tx.insert(sentinelImportBatches).values({
          batchId: result.batch.batchId,
          userId,
          brokerId: result.batch.brokerId,
          fileName: result.batch.fileName,
          importName: defaultImportName,
          fileType: result.batch.fileType,
          totalTradesFound: result.batch.totalTradesFound,
          totalTradesImported: result.batch.totalTradesImported,
          orphanSellsCount,
          skippedRows: result.batch.skippedRows,
          status: orphanSellsCount > 0 ? "NEEDS_REVIEW" : result.batch.status,
        });
        
        // Batch insert trades in chunks for better performance with large files
        if (result.trades.length > 0) {
          const tradeValues = result.trades.map((trade) => ({
            tradeId: trade.tradeId,
            userId,
            batchId: trade.importBatchId,
            brokerId: trade.brokerId,
            brokerOrderId: trade.brokerOrderId,
            ticker: trade.ticker,
            assetType: trade.assetType,
            direction: trade.direction,
            quantity: trade.quantity,
            price: trade.price,
            totalAmount: trade.totalAmount,
            commission: trade.commission,
            fees: trade.fees,
            netAmount: trade.netAmount,
            tradeDate: trade.tradeDate,
            settlementDate: trade.settlementDate,
            // Apply timestamp override if provided, otherwise use parsed value
            executionTime: timestampOverride || trade.executionTime,
            timestampSource: timestampOverride ? "user_override" : trade.timestampSource,
            isTimeEstimated: timestampOverride ? false : trade.isTimeEstimated,
            accountId: trade.accountId,
            accountName: trade.accountName,
            accountType: trade.accountType,
            status: trade.status,
            isFill: trade.isFill,
            fillGroupKey: trade.fillGroupKey,
            // Mark orphan sells
            isOrphanSell: orphanSellTradeIds.has(trade.tradeId),
            orphanStatus: orphanSellTradeIds.has(trade.tradeId) ? 'pending' : null,
            rawSource: trade.rawSource,
          }));
          
          // Insert in chunks of 200 to prevent database timeouts with large files
          const CHUNK_SIZE = 200;
          for (let i = 0; i < tradeValues.length; i += CHUNK_SIZE) {
            const chunk = tradeValues.slice(i, i + CHUNK_SIZE);
            await tx.insert(sentinelImportedTrades).values(chunk);
          }
        }
      });
      
      res.json({
        success: true,
        batch: result.batch,
        tradesImported: result.trades.length,
        orphanSellsCount,
        needsReview: orphanSellsCount > 0,
      });
    } catch (error) {
      console.error("Import confirm error:", error);
      res.status(500).json({ error: "Failed to import trades" });
    }
  });

  // Get import batches (history)
  app.get("/api/sentinel/import/batches", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const batches = await db.select()
        .from(sentinelImportBatches)
        .where(eq(sentinelImportBatches.userId, userId))
        .orderBy(sentinelImportBatches.createdAt);
      
      // Dynamically calculate pending orphan and duplicate counts for each batch and derive status
      const batchesWithCounts = await Promise.all(
        batches.map(async (batch) => {
          const pendingOrphans = await db!.select({ count: sql<number>`count(*)` })
            .from(sentinelImportedTrades)
            .where(and(
              eq(sentinelImportedTrades.userId, userId),
              eq(sentinelImportedTrades.batchId, batch.batchId),
              eq(sentinelImportedTrades.isOrphanSell, true),
              eq(sentinelImportedTrades.orphanStatus, 'pending')
            ));
          
          const pendingDuplicates = await db!.select({ count: sql<number>`count(*)` })
            .from(sentinelImportedTrades)
            .where(and(
              eq(sentinelImportedTrades.userId, userId),
              eq(sentinelImportedTrades.batchId, batch.batchId),
              eq(sentinelImportedTrades.isDuplicate, true),
              eq(sentinelImportedTrades.duplicateStatus, 'pending')
            ));
          
          const orphanCount = Number(pendingOrphans[0]?.count || 0);
          const duplicatesCount = Number(pendingDuplicates[0]?.count || 0);
          return {
            ...batch,
            orphanSellsCount: orphanCount,
            duplicatesCount: duplicatesCount,
            // Dynamically set status based on orphan count
            status: orphanCount > 0 ? 'NEEDS_REVIEW' : (batch.status === 'NEEDS_REVIEW' ? 'completed' : batch.status),
          };
        })
      );
      
      res.json(batchesWithCounts.reverse());
    } catch (error) {
      console.error("Get batches error:", error);
      res.status(500).json({ error: "Failed to fetch import history" });
    }
  });

  // Get trades from a batch
  app.get("/api/sentinel/import/batches/:batchId/trades", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const batchId = req.params.batchId as string;
      
      const trades = await db!.select()
        .from(sentinelImportedTrades)
        .where(and(
          eq(sentinelImportedTrades.userId, userId),
          eq(sentinelImportedTrades.batchId, batchId)
        ))
        .orderBy(sentinelImportedTrades.tradeDate);
      
      res.json(trades);
    } catch (error) {
      console.error("Get batch trades error:", error);
      res.status(500).json({ error: "Failed to fetch batch trades" });
    }
  });

  // Get all imported trades for user
  app.get("/api/sentinel/import/trades", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const { ticker, startDate, endDate } = req.query;
      
      let query = db.select()
        .from(sentinelImportedTrades)
        .where(eq(sentinelImportedTrades.userId, userId));
      
      const trades = await query.orderBy(sentinelImportedTrades.tradeDate);
      
      let filteredTrades = trades;
      if (ticker) {
        filteredTrades = filteredTrades.filter(t => t.ticker.toUpperCase().includes((ticker as string).toUpperCase()));
      }
      if (startDate) {
        filteredTrades = filteredTrades.filter(t => t.tradeDate >= (startDate as string));
      }
      if (endDate) {
        filteredTrades = filteredTrades.filter(t => t.tradeDate <= (endDate as string));
      }
      
      res.json(filteredTrades.reverse());
    } catch (error) {
      console.error("Get imported trades error:", error);
      res.status(500).json({ error: "Failed to fetch imported trades" });
    }
  });

  // Delete an import batch (and its trades)
  app.delete("/api/sentinel/import/batches/:batchId", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const batchId = req.params.batchId as string;
      
      // Delete trades first
      await db!.delete(sentinelImportedTrades)
        .where(and(
          eq(sentinelImportedTrades.userId, userId),
          eq(sentinelImportedTrades.batchId, batchId)
        ));
      
      // Delete batch
      await db!.delete(sentinelImportBatches)
        .where(and(
          eq(sentinelImportBatches.userId, userId),
          eq(sentinelImportBatches.batchId, batchId)
        ));
      
      res.json({ success: true });
    } catch (error) {
      console.error("Delete batch error:", error);
      res.status(500).json({ error: "Failed to delete import batch" });
    }
  });
  
  // Rename an import batch
  app.patch("/api/sentinel/import/batches/:batchId/rename", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const batchId = req.params.batchId as string;
      const { importName } = req.body;
      
      if (!importName || typeof importName !== 'string' || importName.trim().length === 0) {
        return res.status(400).json({ error: "Import name is required" });
      }
      
      const trimmedName = importName.trim().slice(0, 50); // Max 50 chars
      
      await db!.update(sentinelImportBatches)
        .set({ importName: trimmedName })
        .where(and(
          eq(sentinelImportBatches.userId, userId),
          eq(sentinelImportBatches.batchId, batchId)
        ));
      
      res.json({ success: true, importName: trimmedName });
    } catch (error) {
      console.error("Rename batch error:", error);
      res.status(500).json({ error: "Failed to rename import batch" });
    }
  });

  // Delete ALL imported trades and batches for the current user (with confirmation check)
  app.delete("/api/sentinel/import/all", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const { confirmDelete } = req.body;
      
      // Require explicit confirmation to prevent accidental deletion
      if (confirmDelete !== "DELETE_ALL_TRADES") {
        return res.status(400).json({ 
          error: "Confirmation required",
          message: "Send confirmDelete: 'DELETE_ALL_TRADES' to confirm deletion"
        });
      }
      
      // Use transaction to ensure atomicity and consistent counts
      const result = await db.transaction(async (tx) => {
        // Count records using efficient aggregate before deletion
        const [tradesCountResult] = await tx
          .select({ count: sentinelImportedTrades.id })
          .from(sentinelImportedTrades)
          .where(eq(sentinelImportedTrades.userId, userId))
          .limit(1);
        const [batchesCountResult] = await tx
          .select({ count: sentinelImportBatches.id })
          .from(sentinelImportBatches)
          .where(eq(sentinelImportBatches.userId, userId))
          .limit(1);
        
        // Get actual counts by counting deleted rows
        const deletedTrades = await tx.delete(sentinelImportedTrades)
          .where(eq(sentinelImportedTrades.userId, userId))
          .returning({ id: sentinelImportedTrades.id });
        
        const deletedBatches = await tx.delete(sentinelImportBatches)
          .where(eq(sentinelImportBatches.userId, userId))
          .returning({ id: sentinelImportBatches.id });
        
        return {
          trades: deletedTrades.length,
          batches: deletedBatches.length
        };
      });
      
      // Return response after transaction completes successfully
      res.json({ 
        success: true,
        deleted: result
      });
    } catch (error) {
      console.error("Delete all imports error:", error);
      res.status(500).json({ error: "Failed to delete all imported trades" });
    }
  });

  // Delete ALL Trading Cards and related records for the current user
  app.delete("/api/sentinel/trades/all", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const { confirmDelete } = req.body;
      
      if (confirmDelete !== "DELETE") {
        return res.status(400).json({ 
          error: "Confirmation required",
          message: "Send confirmDelete: 'DELETE' to confirm deletion"
        });
      }
      
      const result = await db.transaction(async (tx) => {
        const userTradeIds = await tx
          .select({ id: sentinelTrades.id })
          .from(sentinelTrades)
          .where(eq(sentinelTrades.userId, userId));
        
        const tradeIds = userTradeIds.map(t => t.id);
        
        if (tradeIds.length === 0) {
          return { trades: 0, evaluations: 0, events: 0, labels: 0, orderLevels: 0 };
        }
        
        const deletedLabels = await tx.delete(sentinelTradeToLabels)
          .where(inArray(sentinelTradeToLabels.tradeId, tradeIds))
          .returning({ tradeId: sentinelTradeToLabels.tradeId });
        
        const deletedEvals = await tx.delete(sentinelEvaluations)
          .where(and(eq(sentinelEvaluations.userId, userId), inArray(sentinelEvaluations.tradeId, tradeIds)))
          .returning({ id: sentinelEvaluations.id });
        
        const deletedEvents = await tx.delete(sentinelEvents)
          .where(and(eq(sentinelEvents.userId, userId), inArray(sentinelEvents.tradeId, tradeIds)))
          .returning({ id: sentinelEvents.id });
        
        const deletedOrders = await tx.delete(sentinelOrderLevels)
          .where(and(eq(sentinelOrderLevels.userId, userId), inArray(sentinelOrderLevels.tradeId, tradeIds)))
          .returning({ id: sentinelOrderLevels.id });
        
        const deletedTrades = await tx.delete(sentinelTrades)
          .where(eq(sentinelTrades.userId, userId))
          .returning({ id: sentinelTrades.id });
        
        return {
          trades: deletedTrades.length,
          evaluations: deletedEvals.length,
          events: deletedEvents.length,
          labels: deletedLabels.length,
          orderLevels: deletedOrders.length
        };
      });
      
      res.json({ success: true, deleted: result });
    } catch (error) {
      console.error("Delete all trading cards error:", error);
      res.status(500).json({ error: "Failed to delete all trading cards" });
    }
  });

  // === Promote Imported Trades to Trading Cards ===
  // This endpoint converts raw imported transactions into position-level trade cards
  app.post("/api/sentinel/import/promote-to-cards", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const { batchId, clean } = req.body; // Optional: promote only specific batch; clean=true to wipe existing import cards first
      
      // Check if import cards already exist (prevent double-promotion unless clean mode)
      const existingImportCards = await db.select({ id: sentinelTrades.id }).from(sentinelTrades)
        .where(and(
          eq(sentinelTrades.userId, userId),
          eq(sentinelTrades.source, 'import')
        ))
        .limit(1);
      
      if (existingImportCards.length > 0 && !clean) {
        return res.status(409).json({ 
          error: "Import cards already exist. Use clean re-promote to rebuild them.",
          hasExistingCards: true
        });
      }
      
      // If clean mode, delete all existing import-source trading cards and related data
      if (clean) {
        await db.transaction(async (tx) => {
          const importCardIdsSubquery = tx.select({ id: sentinelTrades.id }).from(sentinelTrades)
            .where(and(
              eq(sentinelTrades.userId, userId),
              eq(sentinelTrades.source, 'import')
            ));
          
          const importCardIds = await importCardIdsSubquery;
          
          if (importCardIds.length > 0) {
            const ids = importCardIds.map(c => c.id);
            const BATCH_SIZE = 500;
            for (let i = 0; i < ids.length; i += BATCH_SIZE) {
              const batch = ids.slice(i, i + BATCH_SIZE);
              await tx.delete(sentinelTradeToLabels).where(inArray(sentinelTradeToLabels.tradeId, batch));
              await tx.delete(sentinelEvaluations).where(inArray(sentinelEvaluations.tradeId, batch));
              await tx.delete(sentinelEvents).where(inArray(sentinelEvents.tradeId, batch));
              await tx.delete(sentinelOrderLevels).where(inArray(sentinelOrderLevels.tradeId, batch));
            }
            await tx.delete(sentinelTrades).where(and(
              eq(sentinelTrades.userId, userId),
              eq(sentinelTrades.source, 'import')
            ));
          }
        });
      }
      
      // Get all non-orphan imported trades AND resolved orphans (with cost basis)
      let query = db.select().from(sentinelImportedTrades).where(
        and(
          eq(sentinelImportedTrades.userId, userId),
          or(
            eq(sentinelImportedTrades.isOrphanSell, false),
            isNull(sentinelImportedTrades.isOrphanSell),
            eq(sentinelImportedTrades.orphanStatus, 'resolved')
          )
        )
      );
      
      let importedTrades = await query.orderBy(sentinelImportedTrades.tradeDate);
      
      // Filter by batch if specified
      if (batchId) {
        importedTrades = importedTrades.filter(t => t.batchId === batchId);
      }
      
      // Separate resolved orphans from normal trades
      const resolvedOrphans = importedTrades.filter(t => t.isOrphanSell && t.orphanStatus === 'resolved');
      const normalTrades = importedTrades.filter(t => !t.isOrphanSell || t.orphanStatus !== 'resolved');
      
      if (normalTrades.length === 0 && resolvedOrphans.length === 0) {
        return res.json({ success: true, cardsCreated: 0, message: "No trades to promote" });
      }
      
      // Cross-batch orphan fix: Include ALL resolved orphan sells in FIFO matching.
      // During FIFO, if an orphan sell has no matching buy lots, a synthetic buy
      // is injected using the orphan's manual cost basis. This handles:
      // - Cross-batch matches (sell in 2026, buy in 2025): FIFO matches naturally
      // - True orphans (buy before import period): synthetic buy covers the gap
      const allTradesForFIFO = [...normalTrades, ...resolvedOrphans];
      
      // Group trades by ticker and account for position matching
      const positionGroups = new Map<string, typeof importedTrades>();
      for (const trade of allTradesForFIFO) {
        const key = `${trade.ticker}:${trade.accountName || 'default'}`;
        if (!positionGroups.has(key)) {
          positionGroups.set(key, []);
        }
        positionGroups.get(key)!.push(trade);
      }
      
      const cardsToCreate: Array<{
        userId: number;
        symbol: string;
        direction: string;
        entryPrice: number;
        entryDate: Date | null;
        exitPrice?: number;
        exitDate?: Date;
        positionSize: number;
        status: string;
        outcome?: string;
        actualPnL?: number;
        holdDays?: number;
        lotEntries: Array<{ id: string; dateTime: string; qty: string; buySell: "buy" | "sell"; price: string }>;
        source: string;
        importBatchId: string;
        accountName?: string;
        isTagged: boolean;
        hasSyntheticCostBasis?: boolean;
      }> = [];
      
      const syntheticInjections: Array<{
        ticker: string;
        account: string;
        syntheticQty: number;
        syntheticCostBasis: number;
        syntheticOpenDate: string;
        sellTradeId: string;
        sellQty: number;
        sellPrice: number;
      }> = [];
      
      // Process each position group using FIFO matching
      for (const [key, trades] of positionGroups) {
        const [ticker, accountName] = key.split(':');
        
        // Sort by date, then by direction (BUYs before SELLs on same date for proper FIFO)
        trades.sort((a, b) => {
          const dateA = a.tradeDate ? new Date(a.tradeDate).getTime() : 0;
          const dateB = b.tradeDate ? new Date(b.tradeDate).getTime() : 0;
          if (dateA !== dateB) return dateA - dateB;
          // On same date, process BUYs before SELLs
          if (a.direction === 'BUY' && b.direction === 'SELL') return -1;
          if (a.direction === 'SELL' && b.direction === 'BUY') return 1;
          // Same direction, use trade ID for stable ordering
          return a.tradeId.localeCompare(b.tradeId);
        });
        
        // FIFO matching: track open position lots
        const openLots: Array<{ id: string; qty: number; price: number; date: Date; batchId: string }> = [];
        let currentPosition = 0;
        let positionLotEntries: Array<{ id: string; dateTime: string; qty: string; buySell: "buy" | "sell"; price: string }> = [];
        let positionBatchId = trades[0].batchId;
        let firstBuyDate: Date | null = null;
        let totalBuyCost = 0;
        let totalBuyQty = 0;
        let positionUsedSynthetic = false;
        
        for (const trade of trades) {
          const qty = Number(trade.quantity) || 0;
          const price = Number(trade.price) || 0;
          const tradeDate = trade.tradeDate ? new Date(trade.tradeDate) : new Date();
          
          const lotEntry = {
            id: trade.tradeId,
            dateTime: tradeDate.toISOString(),
            qty: String(qty),
            buySell: trade.direction === 'BUY' ? 'buy' as const : 'sell' as const,
            price: String(price),
          };
          
          if (trade.direction === 'BUY') {
            openLots.push({ id: trade.tradeId, qty, price, date: tradeDate, batchId: trade.batchId });
            currentPosition += qty;
            positionLotEntries.push(lotEntry);
            if (!firstBuyDate) firstBuyDate = tradeDate;
            totalBuyCost += qty * price;
            totalBuyQty += qty;
          } else if (trade.direction === 'SELL') {
            // For resolved orphan sells with insufficient open lots,
            // inject a synthetic buy using manual cost basis before matching
            const availableQty = openLots.reduce((sum, l) => sum + l.qty, 0);
            if (availableQty < qty && trade.isOrphanSell && trade.orphanStatus === 'resolved') {
              const shortfall = qty - availableQty;
              const costBasis = trade.manualCostBasis != null ? Number(trade.manualCostBasis) : price;
              const openDate = trade.manualOpenDate ? new Date(trade.manualOpenDate) : tradeDate;
              
              syntheticInjections.push({
                ticker,
                account: accountName,
                syntheticQty: shortfall,
                syntheticCostBasis: costBasis,
                syntheticOpenDate: openDate.toISOString(),
                sellTradeId: trade.tradeId,
                sellQty: qty,
                sellPrice: price,
              });
              
              const syntheticBuyEntry = {
                id: `orphan-buy-${trade.tradeId}`,
                dateTime: openDate.toISOString(),
                qty: String(shortfall),
                buySell: 'buy' as const,
                price: String(costBasis),
              };
              positionLotEntries.push(syntheticBuyEntry);
              openLots.push({ id: `orphan-buy-${trade.tradeId}`, qty: shortfall, price: costBasis, date: openDate, batchId: trade.batchId });
              currentPosition += shortfall;
              if (!firstBuyDate || openDate < firstBuyDate) firstBuyDate = openDate;
              totalBuyCost += shortfall * costBasis;
              totalBuyQty += shortfall;
              positionUsedSynthetic = true;
            }
            
            positionLotEntries.push(lotEntry);
            
            // FIFO matching for sells
            let remainingSell = qty;
            while (remainingSell > 0 && openLots.length > 0) {
              const lot = openLots[0];
              if (lot.qty <= remainingSell) {
                remainingSell -= lot.qty;
                openLots.shift();
              } else {
                lot.qty -= remainingSell;
                remainingSell = 0;
              }
            }
            currentPosition -= qty;
            
            // If position is closed, create a card
            if (currentPosition <= 0 && positionLotEntries.length > 0) {
              const avgEntry = totalBuyQty > 0 ? totalBuyCost / totalBuyQty : price;
              const pnl = (price - avgEntry) * totalBuyQty;
              const holdDays = firstBuyDate ? Math.ceil((tradeDate.getTime() - firstBuyDate.getTime()) / (1000 * 60 * 60 * 24)) : 0;
              
              cardsToCreate.push({
                userId,
                symbol: ticker,
                direction: 'long',
                entryPrice: avgEntry,
                entryDate: firstBuyDate,
                exitPrice: price,
                exitDate: tradeDate,
                positionSize: totalBuyQty,
                status: 'closed',
                outcome: pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'breakeven',
                actualPnL: pnl,
                holdDays,
                lotEntries: positionLotEntries,
                source: 'import',
                importBatchId: positionBatchId,
                accountName: accountName !== 'default' ? accountName : undefined,
                isTagged: false,
                hasSyntheticCostBasis: positionUsedSynthetic,
              });
              
              // Reset for next position
              positionLotEntries = [];
              firstBuyDate = null;
              totalBuyCost = 0;
              totalBuyQty = 0;
              currentPosition = 0;
              positionUsedSynthetic = false;
            }
          }
        }
        
        // Create card for any open position
        if (currentPosition > 0 && positionLotEntries.length > 0) {
          const avgEntry = totalBuyQty > 0 ? totalBuyCost / totalBuyQty : 0;
          cardsToCreate.push({
            userId,
            symbol: ticker,
            direction: 'long',
            entryPrice: avgEntry,
            entryDate: firstBuyDate,
            positionSize: currentPosition,
            status: 'active',
            lotEntries: positionLotEntries,
            source: 'import',
            importBatchId: positionBatchId,
            accountName: accountName !== 'default' ? accountName : undefined,
            isTagged: false,
            hasSyntheticCostBasis: positionUsedSynthetic,
          });
        }
      }
      
      // Merge lot entries into existing cards OR create new ones
      let mergedCount = 0;
      let createdCount = 0;
      let closedCount = 0;
      
      if (cardsToCreate.length > 0) {
        await db.transaction(async (tx) => {
          // Get all existing trading cards for this user (any source)
          const existingCards = await tx.select().from(sentinelTrades)
            .where(eq(sentinelTrades.userId, userId));
          
          // Build a map of existing cards by ticker+account
          const existingCardsMap = new Map<string, typeof existingCards[0]>();
          for (const card of existingCards) {
            const key = `${card.symbol.toUpperCase()}:${card.accountName || 'default'}`;
            // Prefer active cards over closed ones for merging
            if (!existingCardsMap.has(key) || (card.status === 'active' && existingCardsMap.get(key)?.status !== 'active')) {
              existingCardsMap.set(key, card);
            }
          }
          
          for (const newCard of cardsToCreate) {
            const key = `${newCard.symbol.toUpperCase()}:${newCard.accountName || 'default'}`;
            const existingCard = existingCardsMap.get(key);
            
            if (existingCard && existingCard.status === 'active') {
              // MERGE: Append lot entries to existing card
              const existingLots = (existingCard.lotEntries as typeof newCard.lotEntries) || [];
              
              // Filter out lots that already exist (by ID) to avoid duplicates
              const existingLotIds = new Set(existingLots.map(l => l.id));
              const newLots = newCard.lotEntries.filter(l => !existingLotIds.has(l.id));
              
              if (newLots.length > 0) {
                const mergedLots = [...existingLots, ...newLots];
                
                // Sort all lots by date for proper FIFO
                mergedLots.sort((a, b) => {
                  const dateA = new Date(a.dateTime).getTime();
                  const dateB = new Date(b.dateTime).getTime();
                  if (dateA !== dateB) return dateA - dateB;
                  if (a.buySell === 'buy' && b.buySell === 'sell') return -1;
                  if (a.buySell === 'sell' && b.buySell === 'buy') return 1;
                  return 0;
                });
                
                // Recalculate position metrics from merged lots using proper FIFO
                let firstBuyDate: Date | null = null;
                let lastExitDate: Date | null = null;
                let lastExitPrice: number | null = null;
                let realizedPnL = 0;
                let totalBoughtQty = 0;
                let totalBoughtCost = 0;
                const openLots: Array<{ qty: number; price: number; date: Date }> = [];
                
                for (const lot of mergedLots) {
                  const qty = parseFloat(lot.qty) || 0;
                  const price = parseFloat(lot.price) || 0;
                  const lotDate = new Date(lot.dateTime);
                  
                  if (lot.buySell === 'buy') {
                    openLots.push({ qty, price, date: lotDate });
                    totalBoughtQty += qty;
                    totalBoughtCost += qty * price;
                    if (!firstBuyDate) firstBuyDate = lotDate;
                  } else {
                    // FIFO matching for sells
                    let remainingSell = qty;
                    while (remainingSell > 0 && openLots.length > 0) {
                      const openLot = openLots[0];
                      const matchQty = Math.min(openLot.qty, remainingSell);
                      realizedPnL += matchQty * (price - openLot.price);
                      openLot.qty -= matchQty;
                      remainingSell -= matchQty;
                      if (openLot.qty <= 0.0001) openLots.shift();
                    }
                    lastExitDate = lotDate;
                    lastExitPrice = price;
                  }
                }
                
                // Calculate remaining position from REMAINING open lots
                const remainingPosition = openLots.reduce((sum, l) => sum + l.qty, 0);
                const remainingCost = openLots.reduce((sum, l) => sum + (l.qty * l.price), 0);
                // For open positions: cost basis of remaining lots
                // For closed positions: historical weighted average entry price
                const avgCostBasis = remainingPosition > 0 
                  ? remainingCost / remainingPosition 
                  : (totalBoughtQty > 0 ? totalBoughtCost / totalBoughtQty : 0);
                
                // Determine status: if position is near-zero, mark as closed
                const isNearZero = Math.abs(remainingPosition) < 0.01;
                const newStatus = isNearZero ? 'closed' : 'active';
                
                // Update the existing card with merged data
                await tx.update(sentinelTrades)
                  .set({
                    lotEntries: mergedLots,
                    positionSize: isNearZero ? 0 : remainingPosition,
                    entryPrice: avgCostBasis,
                    entryDate: firstBuyDate || existingCard.entryDate,
                    status: newStatus,
                    exitPrice: isNearZero ? lastExitPrice : null,
                    exitDate: isNearZero ? lastExitDate : null,
                    actualPnL: isNearZero ? realizedPnL : null,
                    outcome: isNearZero ? (realizedPnL > 0 ? 'win' : realizedPnL < 0 ? 'loss' : 'breakeven') : null,
                    holdDays: isNearZero && firstBuyDate && lastExitDate 
                      ? Math.ceil((lastExitDate.getTime() - firstBuyDate.getTime()) / (1000 * 60 * 60 * 24)) 
                      : null,
                    updatedAt: new Date(),
                  })
                  .where(eq(sentinelTrades.id, existingCard.id));
                
                mergedCount++;
                if (isNearZero) closedCount++;
              }
            } else {
              // CREATE: No existing active card for this ticker+account
              // Check if the new card should be auto-closed
              const isNearZero = Math.abs(newCard.positionSize) < 0.01;
              if (isNearZero) {
                newCard.status = 'closed';
                closedCount++;
              }
              
              await tx.insert(sentinelTrades).values(newCard);
              createdCount++;
              
              // Add to map so subsequent cards for same ticker+account merge into this one
              const insertedCards = await tx.select().from(sentinelTrades)
                .where(and(
                  eq(sentinelTrades.userId, userId),
                  eq(sentinelTrades.symbol, newCard.symbol),
                  eq(sentinelTrades.accountName, newCard.accountName || null)
                ))
                .orderBy(desc(sentinelTrades.createdAt))
                .limit(1);
              if (insertedCards.length > 0) {
                existingCardsMap.set(key, insertedCards[0]);
              }
            }
          }
        });
      }
      
      const syntheticCards = cardsToCreate.filter(c => c.hasSyntheticCostBasis);
      const realCostBasisCards = cardsToCreate.filter(c => !c.hasSyntheticCostBasis);
      
      const syntheticSummary = {
        totalSyntheticInjections: syntheticInjections.length,
        cardsUsingSyntheticCostBasis: syntheticCards.length,
        cardsUsingRealCostBasis: realCostBasisCards.length,
        syntheticByTicker: syntheticInjections.map(s => ({
          ticker: s.ticker,
          account: s.account !== 'default' ? s.account : undefined,
          syntheticShares: s.syntheticQty,
          costBasis: s.syntheticCostBasis,
          openDate: s.syntheticOpenDate,
          sellShares: s.sellQty,
          sellPrice: s.sellPrice,
        })),
        tickersWithSynthetic: [...new Set(syntheticCards.map(c => c.symbol))],
        tickersWithRealCostBasis: [...new Set(realCostBasisCards.map(c => c.symbol))],
      };
      
      console.log(`[Promote] Summary: ${cardsToCreate.length} cards total, ${syntheticInjections.length} synthetic injections, ${syntheticCards.length} cards used synthetic cost basis`);
      if (syntheticInjections.length > 0) {
        console.log(`[Promote] Synthetic details:`, JSON.stringify(syntheticSummary.syntheticByTicker, null, 2));
      }
      
      res.json({ 
        success: true, 
        cardsMerged: mergedCount,
        cardsCreated: createdCount,
        positionsClosed: closedCount,
        totalProcessed: cardsToCreate.length,
        openPositions: cardsToCreate.filter(c => c.status === 'active').length,
        closedPositions: cardsToCreate.filter(c => c.status === 'closed').length,
        syntheticCostBasisReport: syntheticSummary,
      });
    } catch (error) {
      console.error("Promote to cards error:", error);
      res.status(500).json({ error: "Failed to promote trades to cards" });
    }
  });

  // === Cleanup Duplicate Trading Cards ===
  // This endpoint merges duplicate active trading cards (same ticker+account) into one
  app.post("/api/sentinel/import/cleanup-duplicates", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      
      // Get all active trading cards for this user
      const allCards = await db.select().from(sentinelTrades)
        .where(and(
          eq(sentinelTrades.userId, userId),
          eq(sentinelTrades.status, 'active')
        ))
        .orderBy(sentinelTrades.createdAt);
      
      // Group by ticker+account
      const cardGroups = new Map<string, typeof allCards>();
      for (const card of allCards) {
        const key = `${card.symbol.toUpperCase()}:${card.accountName || 'default'}`;
        if (!cardGroups.has(key)) {
          cardGroups.set(key, []);
        }
        cardGroups.get(key)!.push(card);
      }
      
      let mergedCount = 0;
      let deletedCount = 0;
      let closedCount = 0;
      
      await db.transaction(async (tx) => {
        for (const [key, cards] of cardGroups) {
          if (cards.length <= 1) continue; // No duplicates
          
          // Sort by createdAt to keep the oldest card as the primary
          cards.sort((a, b) => new Date(a.createdAt!).getTime() - new Date(b.createdAt!).getTime());
          const primaryCard = cards[0];
          const duplicateCards = cards.slice(1);
          
          // Merge all lot entries from duplicates into primary
          let mergedLots = (primaryCard.lotEntries as Array<{ id: string; dateTime: string; qty: string; buySell: "buy" | "sell"; price: string }>) || [];
          const existingLotIds = new Set(mergedLots.map(l => l.id));
          
          for (const dupCard of duplicateCards) {
            const dupLots = (dupCard.lotEntries as typeof mergedLots) || [];
            for (const lot of dupLots) {
              if (!existingLotIds.has(lot.id)) {
                mergedLots.push(lot);
                existingLotIds.add(lot.id);
              }
            }
          }
          
          // Sort all lots by date for proper FIFO
          mergedLots.sort((a, b) => {
            const dateA = new Date(a.dateTime).getTime();
            const dateB = new Date(b.dateTime).getTime();
            if (dateA !== dateB) return dateA - dateB;
            if (a.buySell === 'buy' && b.buySell === 'sell') return -1;
            if (a.buySell === 'sell' && b.buySell === 'buy') return 1;
            return 0;
          });
          
          // Recalculate position metrics from merged lots using proper FIFO
          let firstBuyDate: Date | null = null;
          let lastExitDate: Date | null = null;
          let lastExitPrice: number | null = null;
          let realizedPnL = 0;
          let totalBoughtQty = 0;
          let totalBoughtCost = 0;
          const openLots: Array<{ qty: number; price: number; date: Date }> = [];
          
          for (const lot of mergedLots) {
            const qty = parseFloat(lot.qty) || 0;
            const price = parseFloat(lot.price) || 0;
            const lotDate = new Date(lot.dateTime);
            
            if (lot.buySell === 'buy') {
              openLots.push({ qty, price, date: lotDate });
              totalBoughtQty += qty;
              totalBoughtCost += qty * price;
              if (!firstBuyDate) firstBuyDate = lotDate;
            } else {
              // FIFO matching for sells
              let remainingSell = qty;
              while (remainingSell > 0 && openLots.length > 0) {
                const openLot = openLots[0];
                const matchQty = Math.min(openLot.qty, remainingSell);
                realizedPnL += matchQty * (price - openLot.price);
                openLot.qty -= matchQty;
                remainingSell -= matchQty;
                if (openLot.qty <= 0.0001) openLots.shift();
              }
              lastExitDate = lotDate;
              lastExitPrice = price;
            }
          }
          
          // Calculate remaining position from REMAINING open lots
          const remainingPosition = openLots.reduce((sum, l) => sum + l.qty, 0);
          const remainingCost = openLots.reduce((sum, l) => sum + (l.qty * l.price), 0);
          // For open positions: cost basis of remaining lots
          // For closed positions: historical weighted average entry price
          const avgCostBasis = remainingPosition > 0 
            ? remainingCost / remainingPosition 
            : (totalBoughtQty > 0 ? totalBoughtCost / totalBoughtQty : 0);
          
          // Determine status: if position is near-zero, mark as closed
          const isNearZero = Math.abs(remainingPosition) < 0.01;
          const newStatus = isNearZero ? 'closed' : 'active';
          
          // Update the primary card with merged data
          await tx.update(sentinelTrades)
            .set({
              lotEntries: mergedLots,
              positionSize: isNearZero ? 0 : remainingPosition,
              entryPrice: avgCostBasis,
              entryDate: firstBuyDate || primaryCard.entryDate,
              status: newStatus,
              exitPrice: isNearZero ? lastExitPrice : null,
              exitDate: isNearZero ? lastExitDate : null,
              actualPnL: isNearZero ? realizedPnL : null,
              outcome: isNearZero ? (realizedPnL > 0 ? 'win' : realizedPnL < 0 ? 'loss' : 'breakeven') : null,
              holdDays: isNearZero && firstBuyDate && lastExitDate 
                ? Math.ceil((lastExitDate.getTime() - firstBuyDate.getTime()) / (1000 * 60 * 60 * 24)) 
                : null,
              updatedAt: new Date(),
            })
            .where(eq(sentinelTrades.id, primaryCard.id));
          
          // Delete the duplicate cards and their related records
          for (const dupCard of duplicateCards) {
            // Cascade delete related records
            await tx.delete(sentinelTradeToLabels).where(eq(sentinelTradeToLabels.tradeId, dupCard.id));
            await tx.delete(sentinelEvaluations).where(eq(sentinelEvaluations.tradeId, dupCard.id));
            await tx.delete(sentinelEvents).where(eq(sentinelEvents.tradeId, dupCard.id));
            // Delete the duplicate trade card
            await tx.delete(sentinelTrades).where(eq(sentinelTrades.id, dupCard.id));
            deletedCount++;
          }
          
          mergedCount++;
          if (isNearZero) closedCount++;
        }
      });
      
      res.json({
        success: true,
        groupsMerged: mergedCount,
        duplicatesDeleted: deletedCount,
        positionsClosed: closedCount,
      });
    } catch (error) {
      console.error("Cleanup duplicates error:", error);
      res.status(500).json({ error: "Failed to cleanup duplicates" });
    }
  });

  // === Account Settings Endpoints ===
  
  // Get all account settings for the user
  app.get("/api/sentinel/account-settings", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const settings = await db!.select().from(sentinelAccountSettings)
        .where(eq(sentinelAccountSettings.userId, userId))
        .orderBy(sentinelAccountSettings.brokerId, sentinelAccountSettings.accountName);
      res.json(settings);
    } catch (error) {
      console.error("Get account settings error:", error);
      res.status(500).json({ error: "Failed to fetch account settings" });
    }
  });

  // Create new account settings
  app.post("/api/sentinel/account-settings", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const { brokerId, accountName, accountNumber, allowsShortSales, notes } = req.body;
      
      const [setting] = await db!.insert(sentinelAccountSettings).values({
        userId,
        brokerId,
        accountName,
        accountNumber,
        allowsShortSales: allowsShortSales ?? false,
        notes,
      }).returning();
      
      res.status(201).json(setting);
    } catch (error) {
      console.error("Create account settings error:", error);
      res.status(500).json({ error: "Failed to create account settings" });
    }
  });

  // Update account settings
  app.patch("/api/sentinel/account-settings/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const settingsId = parseInt(req.params.id);
      const updates = req.body;
      
      const [updated] = await db!.update(sentinelAccountSettings)
        .set({ ...updates, updatedAt: new Date() })
        .where(and(
          eq(sentinelAccountSettings.id, settingsId),
          eq(sentinelAccountSettings.userId, userId)
        ))
        .returning();
      
      if (!updated) {
        return res.status(404).json({ error: "Account settings not found" });
      }
      
      res.json(updated);
    } catch (error) {
      console.error("Update account settings error:", error);
      res.status(500).json({ error: "Failed to update account settings" });
    }
  });

  // Delete account settings
  app.delete("/api/sentinel/account-settings/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const settingsId = parseInt(req.params.id);
      
      const [deleted] = await db!.delete(sentinelAccountSettings)
        .where(and(
          eq(sentinelAccountSettings.id, settingsId),
          eq(sentinelAccountSettings.userId, userId)
        ))
        .returning();
      
      if (!deleted) {
        return res.status(404).json({ error: "Account settings not found" });
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error("Delete account settings error:", error);
      res.status(500).json({ error: "Failed to delete account settings" });
    }
  });

  // Get orphan sells for a batch (sells with no matching buy)
  app.get("/api/sentinel/import/batches/:batchId/orphans", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const { batchId } = req.params;
      
      const orphans = await db!.select().from(sentinelImportedTrades)
        .where(and(
          eq(sentinelImportedTrades.userId, userId),
          eq(sentinelImportedTrades.batchId, batchId),
          eq(sentinelImportedTrades.isOrphanSell, true)
        ))
        .orderBy(sentinelImportedTrades.tradeDate);
      
      res.json({ orphans });
    } catch (error) {
      console.error("Get orphan sells error:", error);
      res.status(500).json({ error: "Failed to fetch orphan sells" });
    }
  });

  app.get("/api/sentinel/import/all-orphans", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      
      const orphans = await db!.select().from(sentinelImportedTrades)
        .where(and(
          eq(sentinelImportedTrades.userId, userId),
          eq(sentinelImportedTrades.isOrphanSell, true),
          or(
            eq(sentinelImportedTrades.orphanStatus, 'pending'),
            eq(sentinelImportedTrades.orphanStatus, 'muted')
          )
        ))
        .orderBy(sentinelImportedTrades.tradeDate);
      
      const allOrphanRows = await db!.select({ count: sql<number>`count(*)` }).from(sentinelImportedTrades)
        .where(and(
          eq(sentinelImportedTrades.userId, userId),
          eq(sentinelImportedTrades.isOrphanSell, true)
        ));
      const totalOrphans = Number(allOrphanRows[0]?.count || 0);
      const resolvedCount = totalOrphans - orphans.length;
      
      res.json({ orphans, totalOrphans, resolvedCount });
    } catch (error) {
      console.error("Get all orphan sells error:", error);
      res.status(500).json({ error: "Failed to fetch all orphan sells" });
    }
  });

  app.post("/api/sentinel/import/all-orphans/bulk", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const { action } = req.body;
      
      if (action === 'delete_all') {
        await db!.delete(sentinelImportedTrades)
          .where(and(
            eq(sentinelImportedTrades.userId, userId),
            eq(sentinelImportedTrades.isOrphanSell, true),
            eq(sentinelImportedTrades.orphanStatus, 'pending')
          ));
        return res.json({ success: true, action: 'delete_all' });
      }
      
      if (action === 'mute_all') {
        await db!.update(sentinelImportedTrades)
          .set({ orphanStatus: 'muted' })
          .where(and(
            eq(sentinelImportedTrades.userId, userId),
            eq(sentinelImportedTrades.isOrphanSell, true),
            eq(sentinelImportedTrades.orphanStatus, 'pending')
          ));
        return res.json({ success: true, action: 'mute_all' });
      }
      
      if (action === 'resolve_all') {
        const { items } = req.body;
        if (!Array.isArray(items) || items.length === 0) {
          return res.status(400).json({ error: "No items provided for resolve_all" });
        }
        
        let resolvedCount = 0;
        const resolvedTradeIds: string[] = [];
        for (const item of items) {
          const { tradeId, costBasis, openDate, isSyntheticDate } = item;
          if (!tradeId || costBasis == null || !openDate) continue;
          const numericCost = Number(costBasis);
          if (!Number.isFinite(numericCost)) continue;
          
          const [trade] = await db!.select().from(sentinelImportedTrades)
            .where(and(
              eq(sentinelImportedTrades.tradeId, tradeId),
              eq(sentinelImportedTrades.userId, userId),
              eq(sentinelImportedTrades.isOrphanSell, true)
            ))
            .limit(1);
          
          if (trade && (trade.orphanStatus === 'pending' || trade.orphanStatus === 'muted')) {
            await db!.update(sentinelImportedTrades)
              .set({
                orphanStatus: 'resolved',
                manualCostBasis: numericCost,
                manualOpenDate: openDate,
                isSyntheticDate: isSyntheticDate === true,
              })
              .where(and(
                eq(sentinelImportedTrades.tradeId, tradeId),
                eq(sentinelImportedTrades.userId, userId)
              ));
            resolvedCount++;
            resolvedTradeIds.push(tradeId);
          }
        }
        
        return res.json({ success: true, action: 'resolve_all', resolvedCount, resolvedTradeIds });
      }
      
      res.status(400).json({ error: "Invalid action. Use 'delete_all', 'mute_all', or 'resolve_all'" });
    } catch (error) {
      console.error("Bulk all-orphan action error:", error);
      res.status(500).json({ error: "Failed to perform bulk action" });
    }
  });

  // Resolve an orphan sell (add cost basis, delete, or mute)
  app.patch("/api/sentinel/import/trades/:tradeId/resolve-orphan", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const { tradeId } = req.params;
      const { action, costBasis, openDate, isSyntheticDate } = req.body;
      
      // First verify this is actually a pending orphan sell belonging to the user
      const [trade] = await db!.select().from(sentinelImportedTrades)
        .where(and(
          eq(sentinelImportedTrades.tradeId, tradeId),
          eq(sentinelImportedTrades.userId, userId),
          eq(sentinelImportedTrades.isOrphanSell, true)
        ))
        .limit(1);
      
      if (!trade) {
        return res.status(404).json({ error: "Orphan sell not found" });
      }
      
      // For mute/resolve, only allow if status is pending or muted (to allow re-muting or resolving muted items)
      if ((action === 'mute' || action === 'resolve') && trade.orphanStatus !== 'pending' && trade.orphanStatus !== 'muted') {
        return res.status(400).json({ error: "Orphan sell has already been resolved" });
      }
      
      if (action === 'delete') {
        await db!.delete(sentinelImportedTrades)
          .where(and(
            eq(sentinelImportedTrades.tradeId, tradeId),
            eq(sentinelImportedTrades.userId, userId)
          ));
        return res.json({ success: true, action: 'deleted' });
      }
      
      if (action === 'mute') {
        // Toggle mute: if already muted, unmute back to pending; otherwise mute
        const newStatus = trade.orphanStatus === 'muted' ? 'pending' : 'muted';
        const [updated] = await db!.update(sentinelImportedTrades)
          .set({
            orphanStatus: newStatus,
          })
          .where(and(
            eq(sentinelImportedTrades.tradeId, tradeId),
            eq(sentinelImportedTrades.userId, userId)
          ))
          .returning();
        
        return res.json({ success: true, action: newStatus === 'muted' ? 'muted' : 'unmuted', trade: updated });
      }
      
      if (action === 'resolve') {
        const [updated] = await db!.update(sentinelImportedTrades)
          .set({
            orphanStatus: 'resolved',
            manualCostBasis: costBasis,
            manualOpenDate: openDate,
            isSyntheticDate: isSyntheticDate === true,
          })
          .where(and(
            eq(sentinelImportedTrades.tradeId, tradeId),
            eq(sentinelImportedTrades.userId, userId)
          ))
          .returning();
        
        return res.json({ success: true, action: 'resolved', trade: updated });
      }
      
      res.status(400).json({ error: "Invalid action. Use 'delete', 'mute', or 'resolve'" });
    } catch (error) {
      console.error("Resolve orphan error:", error);
      res.status(500).json({ error: "Failed to resolve orphan sell" });
    }
  });

  // Bulk actions for orphan sells (mute all or delete all)
  app.post("/api/sentinel/import/batches/:batchId/orphans/bulk", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const { batchId } = req.params;
      const { action } = req.body;
      
      if (action === 'delete_all') {
        const result = await db!.delete(sentinelImportedTrades)
          .where(and(
            eq(sentinelImportedTrades.batchId, batchId),
            eq(sentinelImportedTrades.userId, userId),
            eq(sentinelImportedTrades.isOrphanSell, true),
            eq(sentinelImportedTrades.orphanStatus, 'pending')
          ));
        
        return res.json({ success: true, action: 'delete_all' });
      }
      
      if (action === 'mute_all') {
        await db!.update(sentinelImportedTrades)
          .set({ orphanStatus: 'muted' })
          .where(and(
            eq(sentinelImportedTrades.batchId, batchId),
            eq(sentinelImportedTrades.userId, userId),
            eq(sentinelImportedTrades.isOrphanSell, true),
            eq(sentinelImportedTrades.orphanStatus, 'pending')
          ));
        
        return res.json({ success: true, action: 'mute_all' });
      }
      
      res.status(400).json({ error: "Invalid action. Use 'delete_all' or 'mute_all'" });
    } catch (error) {
      console.error("Bulk orphan action error:", error);
      res.status(500).json({ error: "Failed to perform bulk action" });
    }
  });

  // Re-detect orphans across all batches
  // This fixes cases where imports were done out of order (e.g., 2026 sells before 2025 buys)
  app.post("/api/sentinel/import/redetect-orphans", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      
      // Get all imported trades for this user
      const allTrades = await db!.select().from(sentinelImportedTrades)
        .where(eq(sentinelImportedTrades.userId, userId))
        .orderBy(sentinelImportedTrades.tradeDate);
      
      if (allTrades.length === 0) {
        return res.json({ success: true, message: "No imported trades to process" });
      }
      
      // Get account settings to check short sale permissions
      const accountSettings = await db!.select().from(sentinelAccountSettings)
        .where(eq(sentinelAccountSettings.userId, userId));
      
      const accountShortAllowed = new Map<string, boolean>();
      for (const setting of accountSettings) {
        const key = `${setting.brokerId}:${setting.accountName || ''}`;
        accountShortAllowed.set(key, setting.allowsShortSales);
      }
      
      // Group trades by ticker + account
      const groupedTrades = new Map<string, typeof allTrades>();
      for (const trade of allTrades) {
        const key = `${trade.ticker}:${trade.accountName || '__default__'}`;
        if (!groupedTrades.has(key)) {
          groupedTrades.set(key, []);
        }
        groupedTrades.get(key)!.push(trade);
      }
      
      // Find true orphans by running FIFO across all trades
      const trueOrphanIds = new Set<string>();
      const noLongerOrphanIds = new Set<string>();
      
      for (const [key, trades] of groupedTrades) {
        // Sort by date, then by direction (BUYs before SELLs on same date for proper FIFO)
        trades.sort((a, b) => {
          const dateA = a.tradeDate ? new Date(a.tradeDate).getTime() : 0;
          const dateB = b.tradeDate ? new Date(b.tradeDate).getTime() : 0;
          if (dateA !== dateB) return dateA - dateB;
          // On same date, process BUYs before SELLs
          if (a.direction === 'BUY' && b.direction === 'SELL') return -1;
          if (a.direction === 'SELL' && b.direction === 'BUY') return 1;
          // Same direction, use trade ID for stable ordering
          return a.tradeId.localeCompare(b.tradeId);
        });
        
        // Check short sale settings for this account
        const [ticker, accountKey] = key.split(':');
        const brokerId = trades[0].brokerId;
        const tradeAccountKey = `${brokerId}:${accountKey === '__default__' ? '' : accountKey}`;
        const shortSalesAllowed = accountShortAllowed.get(tradeAccountKey) ?? false;
        
        let runningPosition = 0;
        const EPSILON = 0.0001; // Small tolerance for floating point comparison
        
        for (const trade of trades) {
          const qty = Number(trade.quantity) || 0;
          
          if (trade.direction === 'BUY') {
            runningPosition += qty;
          } else if (trade.direction === 'SELL') {
            // Check if this sell has sufficient position (with epsilon tolerance)
            if (runningPosition >= qty - EPSILON) {
              // Full coverage - not an orphan
              noLongerOrphanIds.add(trade.tradeId);
              runningPosition = Math.max(0, runningPosition - qty);
            } else if (shortSalesAllowed) {
              // Short sale allowed
              noLongerOrphanIds.add(trade.tradeId);
              runningPosition -= qty;
            } else if (runningPosition > EPSILON) {
              // PARTIAL orphan: we have SOME shares but not enough for entire sell
              // This can still close out remaining position, so NOT a full orphan
              noLongerOrphanIds.add(trade.tradeId);
              runningPosition = 0;
            } else {
              // True orphan - position is already 0 or negative
              trueOrphanIds.add(trade.tradeId);
            }
          }
        }
      }
      
      // Update database: clear orphan status for non-orphans, set for true orphans
      let clearedCount = 0;
      let newOrphanCount = 0;
      
      await db!.transaction(async (tx) => {
        // Clear orphan status for trades that now have matching buys
        if (noLongerOrphanIds.size > 0) {
          const cleared = await tx.update(sentinelImportedTrades)
            .set({ 
              isOrphanSell: false, 
              orphanStatus: null 
            })
            .where(and(
              eq(sentinelImportedTrades.userId, userId),
              inArray(sentinelImportedTrades.tradeId, Array.from(noLongerOrphanIds)),
              eq(sentinelImportedTrades.isOrphanSell, true)
            ))
            .returning();
          clearedCount = cleared.length;
        }
        
        // Mark ALL true orphans as pending (reset any muted/resolved back to pending)
        if (trueOrphanIds.size > 0) {
          const marked = await tx.update(sentinelImportedTrades)
            .set({ 
              isOrphanSell: true, 
              orphanStatus: 'pending' 
            })
            .where(and(
              eq(sentinelImportedTrades.userId, userId),
              inArray(sentinelImportedTrades.tradeId, Array.from(trueOrphanIds))
            ))
            .returning();
          newOrphanCount = marked.length;
        }
        
        // Update batch orphan counts
        const batchIds = new Set<string>();
        for (const trade of allTrades) {
          batchIds.add(trade.batchId);
        }
        
        for (const batchId of batchIds) {
          const pendingCount = await tx.select({ count: sql<number>`count(*)` })
            .from(sentinelImportedTrades)
            .where(and(
              eq(sentinelImportedTrades.batchId, batchId),
              eq(sentinelImportedTrades.isOrphanSell, true),
              eq(sentinelImportedTrades.orphanStatus, 'pending')
            ));
          
          const pendingOrphans = Number(pendingCount[0]?.count || 0);
          await tx.update(sentinelImportBatches)
            .set({ 
              orphanSellsCount: pendingOrphans,
              status: pendingOrphans > 0 ? 'NEEDS_REVIEW' : 'completed'
            })
            .where(eq(sentinelImportBatches.batchId, batchId));
        }
      });
      
      res.json({ 
        success: true, 
        orphansCleared: clearedCount,
        newOrphansFound: newOrphanCount,
        totalTrueOrphans: trueOrphanIds.size
      });
    } catch (error) {
      console.error("Re-detect orphans error:", error);
      res.status(500).json({ error: "Failed to re-detect orphans" });
    }
  });

  // Reset & Re-detect: Delete import-sourced cards, reset orphan statuses, re-run detection
  app.post("/api/sentinel/import/reset-and-redetect", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      
      // Step 1: Delete all trading cards that came from imports
      const deletedCards = await db!.transaction(async (tx) => {
        // Get trade IDs that came from imports
        const importTrades = await tx.select({ id: sentinelTrades.id })
          .from(sentinelTrades)
          .where(and(
            eq(sentinelTrades.userId, userId),
            eq(sentinelTrades.source, 'import')
          ));
        
        const tradeIds = importTrades.map(t => t.id);
        
        if (tradeIds.length > 0) {
          // Delete related records first (cascade)
          await tx.delete(sentinelTradeToLabels)
            .where(inArray(sentinelTradeToLabels.tradeId, tradeIds));
          await tx.delete(sentinelEvaluations)
            .where(inArray(sentinelEvaluations.tradeId, tradeIds));
          await tx.delete(sentinelEvents)
            .where(inArray(sentinelEvents.tradeId, tradeIds));
          
          // Delete the trades
          await tx.delete(sentinelTrades)
            .where(inArray(sentinelTrades.id, tradeIds));
        }
        
        return tradeIds.length;
      });
      
      // Step 2: Reset all orphan statuses to 'pending'
      await db!.update(sentinelImportedTrades)
        .set({ orphanStatus: 'pending' })
        .where(eq(sentinelImportedTrades.userId, userId));
      
      // Step 3: Re-run orphan detection with corrected FIFO logic
      // Get all imported trades for this user
      const allTrades = await db!.select().from(sentinelImportedTrades)
        .where(eq(sentinelImportedTrades.userId, userId));
      
      // Get account settings for short sale checking
      const accountSettings = await db!.select().from(sentinelAccountSettings)
        .where(eq(sentinelAccountSettings.userId, userId));
      const accountShortAllowed = new Map(
        accountSettings.map(s => [`${s.brokerId}:${s.accountName || ''}`, s.allowShortSales || false])
      );
      
      // Group by account (brokerId + accountName)
      const accountGroups = new Map<string, typeof allTrades>();
      for (const trade of allTrades) {
        const accountKey = `${trade.brokerId || 'default'}:${trade.accountName || ''}`;
        if (!accountGroups.has(accountKey)) {
          accountGroups.set(accountKey, []);
        }
        accountGroups.get(accountKey)!.push(trade);
      }
      
      const trueOrphanIds = new Set<string>();
      let clearedCount = 0;
      let newOrphanCount = 0;
      
      for (const [accountKey, accountTrades] of accountGroups) {
        // Group by ticker within this account
        const tickerGroups = new Map<string, typeof accountTrades>();
        for (const trade of accountTrades) {
          const ticker = trade.ticker || 'UNKNOWN';
          if (!tickerGroups.has(ticker)) {
            tickerGroups.set(ticker, []);
          }
          tickerGroups.get(ticker)!.push(trade);
        }
        
        for (const [ticker, trades] of tickerGroups) {
          // Sort by date, then direction (BUYs before SELLs), then ID for stable ordering
          trades.sort((a, b) => {
            const dateA = a.tradeDate ? new Date(a.tradeDate).getTime() : 0;
            const dateB = b.tradeDate ? new Date(b.tradeDate).getTime() : 0;
            if (dateA !== dateB) return dateA - dateB;
            // On same date, process BUYs before SELLs
            if (a.direction === 'BUY' && b.direction === 'SELL') return -1;
            if (a.direction === 'SELL' && b.direction === 'BUY') return 1;
            return a.tradeId.localeCompare(b.tradeId);
          });
          
          // Check short sale settings
          const shortSalesAllowed = accountShortAllowed.get(accountKey) ?? false;
          
          // FIFO position tracking
          let position = 0;
          const EPSILON = 0.0001; // Small tolerance for floating point comparison
          
          for (const trade of trades) {
            const qty = Number(trade.quantity) || 0;
            const wasOrphan = trade.orphanStatus === 'pending' || trade.orphanStatus === 'muted';
            
            if (trade.direction === 'BUY') {
              position += qty;
              // Clear any orphan status on buys
              if (wasOrphan) {
                clearedCount++;
              }
            } else {
              // SELL - use epsilon tolerance for floating point comparison
              if (position >= qty - EPSILON) {
                // Have enough shares to cover entire sell
                position = Math.max(0, position - qty);
                if (wasOrphan) {
                  clearedCount++;
                }
              } else if (shortSalesAllowed && position <= EPSILON) {
                // Short sale allowed
                position -= qty;
                if (wasOrphan) {
                  clearedCount++;
                }
              } else if (position > EPSILON) {
                // PARTIAL orphan: we have SOME shares but not enough for entire sell
                // Match what we can (position goes to 0), excess is orphan portion
                // Don't mark as orphan since it partially closes position
                // The promote-to-cards FIFO logic will handle this correctly
                position = 0;
                if (wasOrphan) {
                  clearedCount++;
                }
              } else {
                // True orphan - position is already 0 or negative, selling with nothing to match
                trueOrphanIds.add(trade.tradeId);
                if (!wasOrphan) {
                  newOrphanCount++;
                }
              }
            }
          }
        }
      }
      
      // Update database: clear all, then mark true orphans
      // First: Clear all orphan flags for this user (both isOrphanSell and orphanStatus)
      await db!.update(sentinelImportedTrades)
        .set({ isOrphanSell: false, orphanStatus: null })
        .where(eq(sentinelImportedTrades.userId, userId));
      
      // Second: Mark true orphans as pending (in batches to avoid query size limits)
      const orphanArray = Array.from(trueOrphanIds);
      const BATCH_SIZE = 100;
      for (let i = 0; i < orphanArray.length; i += BATCH_SIZE) {
        const batch = orphanArray.slice(i, i + BATCH_SIZE);
        await db!.update(sentinelImportedTrades)
          .set({ isOrphanSell: true, orphanStatus: 'pending' })
          .where(and(
            eq(sentinelImportedTrades.userId, userId),
            inArray(sentinelImportedTrades.tradeId, batch)
          ));
      }
      
      // Third: Update batch statuses based on new orphan counts
      const userBatches = await db!.select({ batchId: sentinelImportBatches.batchId })
        .from(sentinelImportBatches)
        .where(eq(sentinelImportBatches.userId, userId));
      
      for (const { batchId } of userBatches) {
        const [orphanCount] = await db!.select({ count: sql<number>`count(*)` })
          .from(sentinelImportedTrades)
          .where(and(
            eq(sentinelImportedTrades.userId, userId),
            eq(sentinelImportedTrades.batchId, batchId),
            eq(sentinelImportedTrades.isOrphanSell, true),
            eq(sentinelImportedTrades.orphanStatus, 'pending')
          ));
        
        const pendingOrphans = Number(orphanCount?.count || 0);
        await db!.update(sentinelImportBatches)
          .set({ 
            status: pendingOrphans > 0 ? 'NEEDS_REVIEW' : 'completed',
            orphanSellsCount: pendingOrphans
          })
          .where(and(
            eq(sentinelImportBatches.userId, userId),
            eq(sentinelImportBatches.batchId, batchId)
          ));
      }
      
      res.json({
        success: true,
        cardsDeleted: deletedCards,
        orphansCleared: clearedCount,
        trueOrphansFound: trueOrphanIds.size
      });
    } catch (error: any) {
      console.error("Reset and re-detect error:", error);
      console.error("Error stack:", error?.stack);
      res.status(500).json({ error: "Failed to reset and re-detect orphans", details: error?.message || String(error) });
    }
  });

  // === DUPLICATE DETECTION ROUTES ===
  
  // Detect duplicates in a batch (trades that match existing Trading Cards or other imports)
  app.post("/api/sentinel/import/batches/:batchId/detect-duplicates", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const batchId = req.params.batchId;
      
      // Get trades from this batch
      const batchTrades = await db!.select().from(sentinelImportedTrades)
        .where(and(
          eq(sentinelImportedTrades.userId, userId),
          eq(sentinelImportedTrades.batchId, batchId)
        ));
      
      if (batchTrades.length === 0) {
        return res.json({ success: true, duplicatesFound: 0, message: "No trades in batch" });
      }
      
      // Get existing Trading Cards for comparison
      const existingCards = await db!.select({
        id: sentinelTrades.id,
        symbol: sentinelTrades.symbol,
        entryDate: sentinelTrades.entryDate,
        entryPrice: sentinelTrades.entryPrice,
        positionSize: sentinelTrades.positionSize,
        lotEntries: sentinelTrades.lotEntries,
        accountName: sentinelTrades.accountName,
      }).from(sentinelTrades)
        .where(eq(sentinelTrades.userId, userId));
      
      // Get other import batches' trades (excluding this batch)
      const otherImportedTrades = await db!.select().from(sentinelImportedTrades)
        .where(and(
          eq(sentinelImportedTrades.userId, userId),
          not(eq(sentinelImportedTrades.batchId, batchId))
        ));
      
      const duplicateTradeIds = new Set<string>();
      const duplicateMatches = new Map<string, { matchType: 'card' | 'import', matchId: number }>();
      
      for (const trade of batchTrades) {
        // Check against existing Trading Cards
        for (const card of existingCards) {
          // Match by: ticker, date, price (within tolerance), quantity
          if (card.symbol.toUpperCase() === trade.ticker.toUpperCase()) {
            // Check lot entries if available
            if (card.lotEntries && Array.isArray(card.lotEntries)) {
              for (const lot of card.lotEntries) {
                const lotDate = lot.dateTime?.split('T')[0] || '';
                const lotPrice = parseFloat(lot.price) || 0;
                const lotQty = parseFloat(lot.qty) || 0;
                const priceMatch = Math.abs(lotPrice - trade.price) < 0.01;
                const qtyMatch = Math.abs(lotQty - trade.quantity) < 0.0001;
                const dateMatch = lotDate === trade.tradeDate;
                
                if (dateMatch && priceMatch && qtyMatch) {
                  duplicateTradeIds.add(trade.tradeId);
                  duplicateMatches.set(trade.tradeId, { matchType: 'card', matchId: card.id });
                  break;
                }
              }
            } else if (card.entryDate) {
              // Match by entry date and price
              const cardDate = new Date(card.entryDate).toISOString().split('T')[0];
              const priceMatch = card.entryPrice && Math.abs(card.entryPrice - trade.price) < 0.01;
              const dateMatch = cardDate === trade.tradeDate;
              
              if (dateMatch && priceMatch) {
                duplicateTradeIds.add(trade.tradeId);
                duplicateMatches.set(trade.tradeId, { matchType: 'card', matchId: card.id });
              }
            }
          }
        }
        
        // Check against other imports if not already matched
        if (!duplicateTradeIds.has(trade.tradeId)) {
          for (const otherTrade of otherImportedTrades) {
            if (otherTrade.ticker.toUpperCase() === trade.ticker.toUpperCase() &&
                otherTrade.tradeDate === trade.tradeDate &&
                Math.abs(otherTrade.price - trade.price) < 0.01 &&
                Math.abs(otherTrade.quantity - trade.quantity) < 0.0001 &&
                otherTrade.direction === trade.direction) {
              duplicateTradeIds.add(trade.tradeId);
              duplicateMatches.set(trade.tradeId, { matchType: 'import', matchId: otherTrade.id });
              break;
            }
          }
        }
      }
      
      // Update trades with duplicate status
      let updatedCount = 0;
      for (const [tradeId, match] of duplicateMatches) {
        await db!.update(sentinelImportedTrades)
          .set({ 
            isDuplicate: true,
            duplicateStatus: 'pending',
            duplicateOfTradeId: match.matchType === 'card' ? match.matchId : null,
            duplicateOfImportId: match.matchType === 'import' ? match.matchId : null,
          })
          .where(eq(sentinelImportedTrades.tradeId, tradeId));
        updatedCount++;
      }
      
      // Update batch duplicate count
      await db!.update(sentinelImportBatches)
        .set({ duplicatesCount: duplicateTradeIds.size })
        .where(eq(sentinelImportBatches.batchId, batchId));
      
      res.json({ 
        success: true, 
        duplicatesFound: duplicateTradeIds.size,
        details: Array.from(duplicateMatches.entries()).map(([tradeId, match]) => ({
          tradeId,
          matchType: match.matchType,
          matchId: match.matchId
        }))
      });
    } catch (error) {
      console.error("Detect duplicates error:", error);
      res.status(500).json({ error: "Failed to detect duplicates" });
    }
  });
  
  // Get duplicates for a batch
  app.get("/api/sentinel/import/batches/:batchId/duplicates", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const batchId = req.params.batchId;
      
      const duplicates = await db!.select().from(sentinelImportedTrades)
        .where(and(
          eq(sentinelImportedTrades.userId, userId),
          eq(sentinelImportedTrades.batchId, batchId),
          eq(sentinelImportedTrades.isDuplicate, true)
        ))
        .orderBy(sentinelImportedTrades.tradeDate);
      
      // For each duplicate, get info about what it matches
      const duplicatesWithMatchInfo = await Promise.all(duplicates.map(async (dup) => {
        let matchInfo = null;
        
        if (dup.duplicateOfTradeId) {
          const [card] = await db!.select({
            id: sentinelTrades.id,
            symbol: sentinelTrades.symbol,
            entryDate: sentinelTrades.entryDate,
            entryPrice: sentinelTrades.entryPrice,
            status: sentinelTrades.status,
          }).from(sentinelTrades)
            .where(eq(sentinelTrades.id, dup.duplicateOfTradeId));
          matchInfo = { type: 'card', card };
        } else if (dup.duplicateOfImportId) {
          const [importTrade] = await db!.select().from(sentinelImportedTrades)
            .where(eq(sentinelImportedTrades.id, dup.duplicateOfImportId));
          matchInfo = { type: 'import', trade: importTrade };
        }
        
        return { ...dup, matchInfo };
      }));
      
      res.json({ duplicates: duplicatesWithMatchInfo });
    } catch (error) {
      console.error("Get duplicates error:", error);
      res.status(500).json({ error: "Failed to fetch duplicates" });
    }
  });
  
  // Resolve a duplicate (delete from import or overwrite existing)
  app.patch("/api/sentinel/import/trades/:tradeId/resolve-duplicate", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const tradeId = req.params.tradeId;
      const { action } = req.body; // 'delete' | 'overwrite'
      
      // Verify this is a duplicate belonging to the user
      const [trade] = await db!.select().from(sentinelImportedTrades)
        .where(and(
          eq(sentinelImportedTrades.tradeId, tradeId),
          eq(sentinelImportedTrades.userId, userId),
          eq(sentinelImportedTrades.isDuplicate, true)
        ));
      
      if (!trade) {
        return res.status(404).json({ error: "Duplicate trade not found" });
      }
      
      if (action === 'delete') {
        // Delete this import row, keeping the existing data
        await db!.delete(sentinelImportedTrades)
          .where(eq(sentinelImportedTrades.tradeId, tradeId));
        
        // Update batch count
        const batchId = trade.batchId;
        const [countResult] = await db!.select({ count: sql<number>`count(*)` })
          .from(sentinelImportedTrades)
          .where(and(
            eq(sentinelImportedTrades.batchId, batchId),
            eq(sentinelImportedTrades.isDuplicate, true),
            eq(sentinelImportedTrades.duplicateStatus, 'pending')
          ));
        
        await db!.update(sentinelImportBatches)
          .set({ duplicatesCount: Number(countResult?.count || 0) })
          .where(eq(sentinelImportBatches.batchId, batchId));
        
        return res.json({ success: true, action: 'deleted' });
      }
      
      if (action === 'overwrite') {
        // If matching a Trading Card, update it with new data
        if (trade.duplicateOfTradeId) {
          const [existingCard] = await db!.select().from(sentinelTrades)
            .where(eq(sentinelTrades.id, trade.duplicateOfTradeId));
          
          if (existingCard) {
            // Update the Trading Card with data from import
            // Merge lot entries if they exist
            let updatedLotEntries = existingCard.lotEntries || [];
            const newLotEntry = {
              id: `import-${trade.tradeId}`,
              dateTime: trade.executionTime || `${trade.tradeDate}T12:00:00`,
              qty: trade.quantity.toString(),
              buySell: trade.direction.toLowerCase() as 'buy' | 'sell',
              price: trade.price.toString(),
            };
            
            // Check if lot entry already exists (to prevent true duplicates)
            const exists = updatedLotEntries.some(
              (le: any) => le.dateTime?.split('T')[0] === trade.tradeDate && 
                          Math.abs(parseFloat(le.price) - trade.price) < 0.01 &&
                          Math.abs(parseFloat(le.qty) - trade.quantity) < 0.0001
            );
            
            if (!exists) {
              updatedLotEntries.push(newLotEntry);
              await db!.update(sentinelTrades)
                .set({ lotEntries: updatedLotEntries, updatedAt: new Date() })
                .where(eq(sentinelTrades.id, trade.duplicateOfTradeId));
            }
          }
        }
        
        // If matching another import, delete the older one
        if (trade.duplicateOfImportId) {
          await db!.delete(sentinelImportedTrades)
            .where(eq(sentinelImportedTrades.id, trade.duplicateOfImportId));
        }
        
        // Mark this trade as resolved
        await db!.update(sentinelImportedTrades)
          .set({ duplicateStatus: 'overwritten' })
          .where(eq(sentinelImportedTrades.tradeId, tradeId));
        
        // Update batch count
        const batchId = trade.batchId;
        const [countResult] = await db!.select({ count: sql<number>`count(*)` })
          .from(sentinelImportedTrades)
          .where(and(
            eq(sentinelImportedTrades.batchId, batchId),
            eq(sentinelImportedTrades.isDuplicate, true),
            eq(sentinelImportedTrades.duplicateStatus, 'pending')
          ));
        
        await db!.update(sentinelImportBatches)
          .set({ duplicatesCount: Number(countResult?.count || 0) })
          .where(eq(sentinelImportBatches.batchId, batchId));
        
        return res.json({ success: true, action: 'overwritten' });
      }
      
      res.status(400).json({ error: "Invalid action. Use 'delete' or 'overwrite'" });
    } catch (error) {
      console.error("Resolve duplicate error:", error);
      res.status(500).json({ error: "Failed to resolve duplicate" });
    }
  });
  
  // Bulk actions for duplicates (delete all or overwrite all)
  app.post("/api/sentinel/import/batches/:batchId/duplicates/bulk", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const batchId = req.params.batchId;
      const { action } = req.body; // 'delete_all' | 'overwrite_all'
      
      const duplicates = await db!.select().from(sentinelImportedTrades)
        .where(and(
          eq(sentinelImportedTrades.userId, userId),
          eq(sentinelImportedTrades.batchId, batchId),
          eq(sentinelImportedTrades.isDuplicate, true),
          eq(sentinelImportedTrades.duplicateStatus, 'pending')
        ));
      
      if (action === 'delete_all') {
        // Delete all pending duplicates from this batch
        await db!.delete(sentinelImportedTrades)
          .where(and(
            eq(sentinelImportedTrades.userId, userId),
            eq(sentinelImportedTrades.batchId, batchId),
            eq(sentinelImportedTrades.isDuplicate, true),
            eq(sentinelImportedTrades.duplicateStatus, 'pending')
          ));
        
        await db!.update(sentinelImportBatches)
          .set({ duplicatesCount: 0 })
          .where(eq(sentinelImportBatches.batchId, batchId));
        
        return res.json({ success: true, action: 'delete_all', count: duplicates.length });
      }
      
      if (action === 'overwrite_all') {
        // Process each duplicate to overwrite existing data
        for (const dup of duplicates) {
          if (dup.duplicateOfTradeId) {
            const [existingCard] = await db!.select().from(sentinelTrades)
              .where(eq(sentinelTrades.id, dup.duplicateOfTradeId));
            
            if (existingCard) {
              let updatedLotEntries = existingCard.lotEntries || [];
              const newLotEntry = {
                id: `import-${dup.tradeId}`,
                dateTime: dup.executionTime || `${dup.tradeDate}T12:00:00`,
                qty: dup.quantity.toString(),
                buySell: dup.direction.toLowerCase() as 'buy' | 'sell',
                price: dup.price.toString(),
              };
              
              const exists = updatedLotEntries.some(
                (le: any) => le.dateTime?.split('T')[0] === dup.tradeDate && 
                            Math.abs(parseFloat(le.price) - dup.price) < 0.01 &&
                            Math.abs(parseFloat(le.qty) - dup.quantity) < 0.0001
              );
              
              if (!exists) {
                updatedLotEntries.push(newLotEntry);
                await db!.update(sentinelTrades)
                  .set({ lotEntries: updatedLotEntries, updatedAt: new Date() })
                  .where(eq(sentinelTrades.id, dup.duplicateOfTradeId));
              }
            }
          }
          
          if (dup.duplicateOfImportId) {
            await db!.delete(sentinelImportedTrades)
              .where(eq(sentinelImportedTrades.id, dup.duplicateOfImportId));
          }
        }
        
        // Mark all as overwritten
        await db!.update(sentinelImportedTrades)
          .set({ duplicateStatus: 'overwritten' })
          .where(and(
            eq(sentinelImportedTrades.userId, userId),
            eq(sentinelImportedTrades.batchId, batchId),
            eq(sentinelImportedTrades.isDuplicate, true)
          ));
        
        await db!.update(sentinelImportBatches)
          .set({ duplicatesCount: 0 })
          .where(eq(sentinelImportBatches.batchId, batchId));
        
        return res.json({ success: true, action: 'overwrite_all', count: duplicates.length });
      }
      
      res.status(400).json({ error: "Invalid action. Use 'delete_all' or 'overwrite_all'" });
    } catch (error) {
      console.error("Bulk duplicate action error:", error);
      res.status(500).json({ error: "Failed to perform bulk action" });
    }
  });

  // === ORDER LEVELS ENDPOINTS ===

  // GET order levels for a trade
  app.get("/api/sentinel/trades/:tradeId/order-levels", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const tradeId = parseInt(req.params.tradeId);
      if (isNaN(tradeId)) return res.status(400).json({ error: "Invalid trade ID" });

      const levels = await db.select().from(sentinelOrderLevels)
        .where(and(
          eq(sentinelOrderLevels.tradeId, tradeId),
          eq(sentinelOrderLevels.userId, userId)
        ))
        .orderBy(sentinelOrderLevels.price);

      res.json(levels);
    } catch (error) {
      console.error("Get order levels error:", error);
      res.status(500).json({ error: "Failed to get order levels" });
    }
  });

  // POST create a new order level
  app.post("/api/sentinel/trades/:tradeId/order-levels", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const tradeId = parseInt(req.params.tradeId);
      if (isNaN(tradeId)) return res.status(400).json({ error: "Invalid trade ID" });

      const schema = z.object({
        levelType: z.enum(["stop", "target"]),
        price: z.number().positive(),
        quantity: z.number().positive().optional(),
        source: z.enum(["manual", "import"]).optional(),
        status: z.enum(["open", "filled", "cancelled"]).optional(),
        orderNumber: z.string().optional(),
        notes: z.string().optional(),
      });

      const data = schema.parse(req.body);

      const [level] = await db.insert(sentinelOrderLevels).values({
        tradeId,
        userId,
        levelType: data.levelType,
        price: data.price,
        quantity: data.quantity,
        source: data.source || "manual",
        status: data.status || "open",
        orderNumber: data.orderNumber,
        notes: data.notes,
      }).returning();

      res.json(level);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation error", details: error.errors });
      }
      console.error("Create order level error:", error);
      res.status(500).json({ error: "Failed to create order level" });
    }
  });

  // PATCH update an order level
  app.patch("/api/sentinel/order-levels/:levelId", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const levelId = parseInt(req.params.levelId);
      if (isNaN(levelId)) return res.status(400).json({ error: "Invalid level ID" });

      const schema = z.object({
        price: z.number().positive().optional(),
        quantity: z.number().positive().optional(),
        status: z.enum(["open", "filled", "cancelled"]).optional(),
        notes: z.string().optional(),
      });

      const data = schema.parse(req.body);

      const [updated] = await db.update(sentinelOrderLevels)
        .set({ ...data, updatedAt: new Date() })
        .where(and(
          eq(sentinelOrderLevels.id, levelId),
          eq(sentinelOrderLevels.userId, userId)
        ))
        .returning();

      if (!updated) return res.status(404).json({ error: "Order level not found" });
      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation error", details: error.errors });
      }
      console.error("Update order level error:", error);
      res.status(500).json({ error: "Failed to update order level" });
    }
  });

  // DELETE an order level
  app.delete("/api/sentinel/order-levels/:levelId", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const levelId = parseInt(req.params.levelId);
      if (isNaN(levelId)) return res.status(400).json({ error: "Invalid level ID" });

      const [deleted] = await db.delete(sentinelOrderLevels)
        .where(and(
          eq(sentinelOrderLevels.id, levelId),
          eq(sentinelOrderLevels.userId, userId)
        ))
        .returning();

      if (!deleted) return res.status(404).json({ error: "Order level not found" });
      res.json({ success: true });
    } catch (error) {
      console.error("Delete order level error:", error);
      res.status(500).json({ error: "Failed to delete order level" });
    }
  });

  // POST bulk import order levels from parsed orders CSV
  app.post("/api/sentinel/order-levels/bulk-import", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;

      const schema = z.object({
        orders: z.array(z.object({
          tradeId: z.number(),
          levelType: z.enum(["stop", "target"]),
          price: z.number().positive(),
          quantity: z.number().positive().optional(),
          orderNumber: z.string().optional(),
        })),
      });

      const { orders } = schema.parse(req.body);

      // Get existing order levels for deduplication
      const existingLevels = await db.select().from(sentinelOrderLevels)
        .where(eq(sentinelOrderLevels.userId, userId));

      const newOrders: typeof orders = [];
      const skippedDuplicates: typeof orders = [];

      for (const order of orders) {
        const isDuplicate = existingLevels.some(existing =>
          existing.tradeId === order.tradeId &&
          existing.levelType === order.levelType &&
          Math.abs(existing.price - order.price) < 0.01 &&
          (!order.quantity || !existing.quantity || Math.abs(existing.quantity - order.quantity) < 0.01)
        );

        if (isDuplicate) {
          skippedDuplicates.push(order);
        } else {
          newOrders.push(order);
        }
      }

      let inserted: any[] = [];
      if (newOrders.length > 0) {
        inserted = await db.insert(sentinelOrderLevels).values(
          newOrders.map(o => ({
            tradeId: o.tradeId,
            userId,
            levelType: o.levelType,
            price: o.price,
            quantity: o.quantity,
            source: "import" as const,
            status: "open" as const,
            orderNumber: o.orderNumber,
          }))
        ).returning();
      }

      res.json({
        imported: inserted.length,
        skippedDuplicates: skippedDuplicates.length,
        total: orders.length,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation error", details: error.errors });
      }
      console.error("Bulk import order levels error:", error);
      res.status(500).json({ error: "Failed to bulk import order levels" });
    }
  });

  // POST parse Fidelity Orders CSV and match to active trades
  app.post("/api/sentinel/order-levels/parse-orders-csv", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;

      const schema = z.object({
        csvContent: z.string(),
        defaultAccountName: z.string().optional(),
      });

      const { csvContent, defaultAccountName } = schema.parse(req.body);

      // Parse the Fidelity Orders CSV
      const lines = csvContent.split('\n').map(l => l.trim()).filter(l => l.length > 0);

      // Find the header line
      let headerIdx = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('Symbol,Action,')) {
          headerIdx = i;
          break;
        }
      }

      if (headerIdx === -1) {
        return res.status(400).json({ error: "Could not find header row in CSV. Expected 'Symbol,Action,...'" });
      }

      const headers = lines[headerIdx].split(',').map(h => h.trim().replace(/"/g, ''));

      // Parse data rows (stop at Disclosure section)
      const skippedOrders: Array<{ symbol: string; status: string; orderType: string; quantity: number; orderNumber: string }> = [];
      const parsedOrders: Array<{
        symbol: string;
        action: string;
        quantity: number;
        orderType: string;
        levelType: 'stop' | 'target';
        price: number;
        status: string;
        account: string;
        accountName: string;
        orderNumber: string;
        tif: string;
      }> = [];

      for (let i = headerIdx + 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith('Disclosure') || line.startsWith('"')) break;

        // Parse CSV row (handle quoted fields)
        const fields = parseCSVRow(line);
        if (fields.length < 10) continue;

        const symbolIdx = headers.indexOf('Symbol');
        const actionIdx = headers.indexOf('Action');
        const amountIdx = headers.indexOf('Amount');
        const orderTypeIdx = headers.indexOf('Order Type');
        const statusIdx = headers.indexOf('Status');
        const accountIdx = headers.indexOf('Account');
        const orderNumberIdx = headers.indexOf('Order Number');
        const tifIdx = headers.indexOf('TIF');

        const symbol = fields[symbolIdx]?.trim();
        const action = fields[actionIdx]?.trim();
        const amount = parseInt(fields[amountIdx]?.trim()) || 0;
        const orderTypeRaw = fields[orderTypeIdx]?.trim() || '';
        const status = fields[statusIdx]?.trim() || '';
        const accountRaw = fields[accountIdx]?.trim() || '';
        const orderNumber = fields[orderNumberIdx]?.trim() || '';
        const tif = fields[tifIdx]?.trim() || '';

        if (!symbol || !action || amount === 0) continue;

        const statusLower = (status || '').toLowerCase().trim();
        const isInactiveOrder = statusLower.includes('cancel') || statusLower.includes('expired') ||
          statusLower.includes('rejected') || statusLower.includes('deleted') ||
          (statusLower.includes('filled') && !statusLower.includes('partially'));
        if (isInactiveOrder) {
          skippedOrders.push({ symbol, status, orderType: orderTypeRaw, quantity: amount, orderNumber });
          continue;
        }

        // Parse order type to extract price and level type
        let levelType: 'stop' | 'target' | null = null;
        let price = 0;

        const orderTypeLower = orderTypeRaw.toLowerCase();
        if (orderTypeLower.includes('stop loss at') || orderTypeLower.includes('stop at')) {
          levelType = 'stop';
          const priceMatch = orderTypeRaw.match(/\$?([\d,]+\.?\d*)/);
          if (priceMatch) price = parseFloat(priceMatch[1].replace(/,/g, ''));
        } else if (orderTypeLower.includes('limit at')) {
          levelType = 'target';
          const priceMatch = orderTypeRaw.match(/\$?([\d,]+\.?\d*)/);
          if (priceMatch) price = parseFloat(priceMatch[1].replace(/,/g, ''));
        } else if (orderTypeLower.includes('trailing stop')) {
          levelType = 'stop';
          const priceMatch = orderTypeRaw.match(/\$?([\d,]+\.?\d*)/);
          if (priceMatch) price = parseFloat(priceMatch[1].replace(/,/g, ''));
        }

        if (!levelType || price <= 0) continue;

        // Extract account name from account string (e.g., "1_BrokerageLink *1094" -> "1094")
        const accountMatch = accountRaw.match(/\*(\w+)/);
        const accountName = accountMatch ? accountMatch[1] : (defaultAccountName || '');

        parsedOrders.push({
          symbol,
          action,
          quantity: amount,
          orderType: orderTypeRaw,
          levelType,
          price,
          status,
          account: accountRaw,
          accountName,
          orderNumber,
          tif,
        });
      }

      // Get user's active trades for matching
      const activeTrades = await db.select().from(sentinelTrades)
        .where(and(
          eq(sentinelTrades.userId, userId),
          eq(sentinelTrades.status, 'active')
        ));

      // Get existing order levels for deduplication
      const existingLevels = await db.select().from(sentinelOrderLevels)
        .where(eq(sentinelOrderLevels.userId, userId));

      // Match orders to trades
      const matched: Array<{
        order: typeof parsedOrders[0];
        trade: typeof activeTrades[0];
        isDuplicate: boolean;
      }> = [];
      const unmatched: typeof parsedOrders = [];
      const hasAccountInfo = parsedOrders.some(o => o.accountName.length > 0);

      for (const order of parsedOrders) {
        // Match by ticker + account (case insensitive)
        let matchedTrade = activeTrades.find(t =>
          t.symbol.toUpperCase() === order.symbol.toUpperCase() &&
          (order.accountName ? t.accountName === order.accountName : true)
        );

        // Fallback: match by ticker only if no account match found
        if (!matchedTrade) {
          matchedTrade = activeTrades.find(t =>
            t.symbol.toUpperCase() === order.symbol.toUpperCase()
          );
        }

        if (matchedTrade) {
          const isDuplicate = existingLevels.some(existing =>
            existing.tradeId === matchedTrade!.id &&
            existing.levelType === order.levelType &&
            Math.abs(existing.price - order.price) < 0.01 &&
            (!order.quantity || !existing.quantity || Math.abs(existing.quantity - order.quantity) < 0.01)
          );

          matched.push({ order, trade: matchedTrade, isDuplicate });
        } else {
          unmatched.push(order);
        }
      }

      res.json({
        parsed: parsedOrders.length,
        matched,
        unmatched,
        hasAccountInfo,
        skipped: skippedOrders.length,
        skippedOrders,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation error", details: error.errors });
      }
      console.error("Parse orders CSV error:", error);
      res.status(500).json({ error: "Failed to parse orders CSV" });
    }
  });

  // ============================================================================
  // PATTERN TRAINING TOOL ROUTES
  // ============================================================================

  app.get("/api/sentinel/pattern-training/chart-data", requireAuth, async (req: Request, res: Response) => {
    try {
      const ticker = String(req.query.ticker || "").toUpperCase();
      const timeframe = String(req.query.timeframe || "daily");
      if (!ticker) return res.status(400).json({ error: "Ticker is required" });

      const data = await fetchChartData(ticker, timeframe);
      if (!data) return res.status(404).json({ error: `No chart data found for ${ticker}` });

      res.json(data);
    } catch (error) {
      console.error("Chart data error:", error);
      res.status(500).json({ error: "Failed to fetch chart data" });
    }
  });

  app.post("/api/sentinel/pattern-training/point-technicals", requireAuth, async (req: Request, res: Response) => {
    try {
      const { ticker, pointDate, timeframe } = req.body;
      if (!ticker || !pointDate) return res.status(400).json({ error: "Ticker and pointDate required" });

      const result = await calculatePointTechnicals(ticker, pointDate, timeframe || "daily");
      if (!result) return res.status(404).json({ error: "Could not calculate technicals" });

      const nearest = findNearestMA(result.technicals, result.ohlcv.close);
      res.json({ ...result, nearestMA: nearest });
    } catch (error) {
      console.error("Point technicals error:", error);
      res.status(500).json({ error: "Failed to calculate technicals" });
    }
  });

  app.post("/api/sentinel/pattern-training/setup-metrics", requireAuth, async (req: Request, res: Response) => {
    try {
      const { ticker, entryDate, stopPrice, targetPrice, entryPrice, avwapAnchors, resistancePrice } = req.body;
      if (!ticker || !entryDate) return res.status(400).json({ error: "Ticker and entryDate required" });

      const [metrics, rsVsSpy] = await Promise.all([
        calculateFullSetupMetrics(ticker, entryDate, stopPrice, targetPrice, entryPrice),
        calculateRSvsSPY(ticker),
      ]);

      metrics.rsVsSpy = rsVsSpy;

      if (avwapAnchors) {
        const avwaps = await calculateAnchoredVWAPValues(ticker, avwapAnchors, entryDate);
        if (avwaps.recentHigh && entryPrice) {
          metrics.avwapRecentHigh = ((entryPrice - avwaps.recentHigh) / avwaps.recentHigh) * 100;
        }
        if (avwaps.recentLow && entryPrice) {
          metrics.avwapRecentLow = ((entryPrice - avwaps.recentLow) / avwaps.recentLow) * 100;
        }
        if (avwaps.ep && entryPrice) {
          metrics.avwapEP = ((entryPrice - avwaps.ep) / avwaps.ep) * 100;
        }
      }

      if (resistancePrice) {
        const { fetchChartData: fc } = await import("./patternTrainingEngine");
        const chartData = await fc(ticker, "daily");
        if (chartData) {
          const bars = chartData.candles.map(c => ({ date: new Date(c.date), open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }));
          metrics.resistanceTouchCount = countResistanceTouches(bars, resistancePrice);
        }
      }

      res.json(metrics);
    } catch (error) {
      console.error("Setup metrics error:", error);
      res.status(500).json({ error: "Failed to calculate setup metrics" });
    }
  });

  app.post("/api/sentinel/pattern-training/setups", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const { ticker, patternType, timeframe, rating, outcome, pnlPercent, daysHeld, notes, tags, entryTactics, calculatedMetrics, chartDateRange } = req.body;

      if (!ticker || !patternType || !timeframe) {
        return res.status(400).json({ error: "Ticker, patternType, and timeframe are required" });
      }

      const [setup] = await db.insert(patternTrainingSetups).values({
        userId,
        ticker: ticker.toUpperCase(),
        patternType,
        timeframe,
        rating: rating || null,
        outcome: outcome || null,
        pnlPercent: pnlPercent || null,
        daysHeld: daysHeld || null,
        notes: notes || null,
        tags: tags || [],
        entryTactics: entryTactics || {},
        calculatedMetrics: calculatedMetrics || {},
        chartDateRange: chartDateRange || null,
        pointsSaved: false,
      }).returning();

      res.json(setup);
    } catch (error) {
      console.error("Create setup error:", error);
      res.status(500).json({ error: "Failed to create setup" });
    }
  });

  app.get("/api/sentinel/pattern-training/setups", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const setups = await db.select().from(patternTrainingSetups)
        .where(eq(patternTrainingSetups.userId, userId))
        .orderBy(desc(patternTrainingSetups.createdAt));

      const setupsWithPoints = await Promise.all(setups.map(async (setup) => {
        const points = await db.select().from(patternTrainingPoints)
          .where(eq(patternTrainingPoints.setupId, setup.id));
        return { ...setup, points };
      }));

      res.json(setupsWithPoints);
    } catch (error) {
      console.error("Get setups error:", error);
      res.status(500).json({ error: "Failed to fetch setups" });
    }
  });

  app.get("/api/sentinel/pattern-training/setups/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const setupId = parseInt(req.params.id);

      const [setup] = await db.select().from(patternTrainingSetups)
        .where(and(eq(patternTrainingSetups.id, setupId), eq(patternTrainingSetups.userId, userId)));

      if (!setup) return res.status(404).json({ error: "Setup not found" });

      const points = await db.select().from(patternTrainingPoints)
        .where(eq(patternTrainingPoints.setupId, setupId));

      res.json({ ...setup, points });
    } catch (error) {
      console.error("Get setup error:", error);
      res.status(500).json({ error: "Failed to fetch setup" });
    }
  });

  app.patch("/api/sentinel/pattern-training/setups/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const setupId = parseInt(req.params.id);

      const [existing] = await db.select().from(patternTrainingSetups)
        .where(and(eq(patternTrainingSetups.id, setupId), eq(patternTrainingSetups.userId, userId)));

      if (!existing) return res.status(404).json({ error: "Setup not found" });

      const updates: any = {};
      const allowedFields = ['patternType', 'timeframe', 'rating', 'outcome', 'pnlPercent', 'daysHeld', 'notes', 'tags', 'entryTactics', 'calculatedMetrics', 'chartDateRange', 'pointsSaved'];
      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          updates[field] = req.body[field];
        }
      }
      updates.updatedAt = new Date();

      const [updated] = await db.update(patternTrainingSetups)
        .set(updates)
        .where(eq(patternTrainingSetups.id, setupId))
        .returning();

      res.json(updated);
    } catch (error) {
      console.error("Update setup error:", error);
      res.status(500).json({ error: "Failed to update setup" });
    }
  });

  app.delete("/api/sentinel/pattern-training/setups/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const setupId = parseInt(req.params.id);

      const [existing] = await db.select().from(patternTrainingSetups)
        .where(and(eq(patternTrainingSetups.id, setupId), eq(patternTrainingSetups.userId, userId)));

      if (!existing) return res.status(404).json({ error: "Setup not found" });

      await db.delete(patternTrainingPoints).where(eq(patternTrainingPoints.setupId, setupId));
      await db.delete(patternTrainingSetups).where(eq(patternTrainingSetups.id, setupId));

      res.json({ success: true });
    } catch (error) {
      console.error("Delete setup error:", error);
      res.status(500).json({ error: "Failed to delete setup" });
    }
  });

  app.post("/api/sentinel/pattern-training/setups/:id/points", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const setupId = parseInt(req.params.id);

      const [setup] = await db.select().from(patternTrainingSetups)
        .where(and(eq(patternTrainingSetups.id, setupId), eq(patternTrainingSetups.userId, userId)));

      if (!setup) return res.status(404).json({ error: "Setup not found" });

      const { points } = req.body;
      if (!Array.isArray(points) || points.length === 0) {
        return res.status(400).json({ error: "Points array is required" });
      }

      await db.delete(patternTrainingPoints).where(eq(patternTrainingPoints.setupId, setupId));

      const insertedPoints = await db.insert(patternTrainingPoints).values(
        points.map((p: any) => ({
          setupId,
          pointRole: p.pointRole,
          price: p.price,
          pointDate: p.pointDate,
          ohlcv: p.ohlcv || null,
          percentFromEntry: p.percentFromEntry || null,
          percentFrom50d: p.percentFrom50d || null,
          percentFrom200d: p.percentFrom200d || null,
          percentFromVwap: p.percentFromVwap || null,
          avwapDistances: p.avwapDistances || null,
          nearestMa: p.nearestMa || null,
          nearestMaDistance: p.nearestMaDistance || null,
          technicalData: p.technicalData || null,
          secondPointPrice: p.secondPointPrice || null,
          secondPointDate: p.secondPointDate || null,
          resistanceTouchCount: p.resistanceTouchCount || null,
        }))
      ).returning();

      await db.update(patternTrainingSetups)
        .set({ pointsSaved: true, updatedAt: new Date() })
        .where(eq(patternTrainingSetups.id, setupId));

      res.json(insertedPoints);
    } catch (error) {
      console.error("Save points error:", error);
      res.status(500).json({ error: "Failed to save points" });
    }
  });

  startMonitoring(60000);
}

// Helper to parse CSV row handling quoted fields with commas
function parseCSVRow(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}
