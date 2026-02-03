import type { Express, Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import bcrypt from "bcryptjs";
import { z } from "zod";
import OpenAI from "openai";
import { eq, and, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { sentinelModels } from "./models";
import { evaluateTrade } from "./evaluate";
import { generateSuggestions, type SuggestRequest } from "./suggest";
import { startMonitoring } from "./monitor";
import { fetchMarketSentiment, fetchSectorSentiment, getSentimentCacheAge } from "./sentiment";
import type { EvaluationRequest, TradeUpdate, DashboardData, TradeWithEvaluation, EventWithTrade } from "./types";
import { sentinelTrades, sentinelTradeLabels, sentinelTradeToLabels, sentinelUsers, insertSentinelTradeLabelSchema, sentinelImportBatches, sentinelImportedTrades, sentinelAccountSettings } from "@shared/schema";
import * as tnn from "./tnn";
import { parseCSV, detectBroker, type ParseResult, type BrokerId } from "./tradeImport";

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

  // TEMPORARY: Password reset for Mythical user - REMOVE AFTER USE
  app.post("/api/auth/temp-reset-mythical", async (req: Request, res: Response) => {
    try {
      if (!db) {
        return res.status(500).json({ error: "Database not available" });
      }
      const passwordHash = await bcrypt.hash("password", 10);
      const result = await db.update(sentinelUsers)
        .set({ passwordHash })
        .where(eq(sentinelUsers.username, "Mythical"))
        .returning({ id: sentinelUsers.id });
      if (result.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }
      res.json({ success: true, message: "Password reset to 'password'" });
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
      const data = loginSchema.parse(req.body);

      const user = await sentinelModels.getUserByUsername(data.username);
      if (!user) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      const validPassword = await bcrypt.compare(data.password, user.passwordHash);
      if (!validPassword) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

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
  });

  app.post("/api/sentinel/trades", requireAuth, async (req: Request, res: Response) => {
    try {
      const data = createTradeSchema.parse(req.body);
      const userId = req.session.userId!;

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

      const [considering, active, recentEvents] = await Promise.all([
        sentinelModels.getTradesByStatus(userId, "considering"),
        sentinelModels.getTradesByStatus(userId, "active"),
        sentinelModels.getRecentEvents(userId, 20),
      ]);

      const enrichTrades = async (trades: typeof considering): Promise<TradeWithEvaluation[]> => {
        return Promise.all(trades.map(async (trade) => {
          const latestEval = await sentinelModels.getLatestEvaluation(trade.id);
          
          // Fetch labels with proper admin visibility filtering
          let labels;
          if (isAdmin) {
            labels = await db
              .select({
                id: sentinelTradeLabels.id,
                name: sentinelTradeLabels.name,
                color: sentinelTradeLabels.color,
                isAdminOnly: sentinelTradeLabels.isAdminOnly,
              })
              .from(sentinelTradeToLabels)
              .innerJoin(sentinelTradeLabels, eq(sentinelTradeToLabels.labelId, sentinelTradeLabels.id))
              .where(eq(sentinelTradeToLabels.tradeId, trade.id));
          } else {
            labels = await db
              .select({
                id: sentinelTradeLabels.id,
                name: sentinelTradeLabels.name,
                color: sentinelTradeLabels.color,
                isAdminOnly: sentinelTradeLabels.isAdminOnly,
              })
              .from(sentinelTradeToLabels)
              .innerJoin(sentinelTradeLabels, eq(sentinelTradeToLabels.labelId, sentinelTradeLabels.id))
              .where(
                and(
                  eq(sentinelTradeToLabels.tradeId, trade.id),
                  eq(sentinelTradeLabels.isAdminOnly, false)
                )
              );
          }
          
          return {
            ...trade,
            labels,
            latestEvaluation: latestEval ? {
              score: latestEval.score,
              recommendation: latestEval.recommendation,
              riskFlags: latestEval.riskFlags || [],
            } : undefined,
          };
        }));
      };

      const enrichedConsidering = await enrichTrades(considering);
      const enrichedActive = await enrichTrades(active);

      const eventsWithTrades: EventWithTrade[] = await Promise.all(
        recentEvents.map(async (event) => {
          const trade = await sentinelModels.getTrade(event.tradeId);
          return {
            ...event,
            trade: trade ? { symbol: trade.symbol } : undefined,
          };
        })
      );

      const dashboard: DashboardData = {
        considering: enrichedConsidering,
        active: enrichedActive,
        recentEvents: eventsWithTrades,
      };

      res.json(dashboard);
    } catch (error) {
      console.error("Dashboard error:", error);
      res.status(500).json({ error: "Failed to load dashboard" });
    }
  });

  // Get trade sources for filtering (hand entered + import batches)
  app.get("/api/sentinel/trades/sources", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      
      // Get all trades to count by source
      const trades = await db!.select({
        source: sentinelTrades.source,
        importBatchId: sentinelTrades.importBatchId,
      }).from(sentinelTrades).where(eq(sentinelTrades.userId, userId));
      
      // Count hand-entered trades
      const handCount = trades.filter(t => !t.source || t.source === 'hand').length;
      
      // Get unique import batch IDs
      const importBatchIds = [...new Set(trades.filter(t => t.source === 'import' && t.importBatchId).map(t => t.importBatchId))];
      
      // Get batch details from sentinel_import_batches
      const sources: Array<{ id: string; name: string; count: number }> = [];
      
      // Always include "Hand" source
      sources.push({ id: 'hand', name: 'Hand Entered', count: handCount });
      
      // Add import batch sources
      if (importBatchIds.length > 0) {
        const batches = await db!.select({
          batchId: sentinelImportBatches.batchId,
          fileName: sentinelImportBatches.fileName,
          createdAt: sentinelImportBatches.createdAt,
        }).from(sentinelImportBatches).where(
          and(
            eq(sentinelImportBatches.userId, userId),
            inArray(sentinelImportBatches.batchId, importBatchIds.filter((id): id is string => id !== null))
          )
        );
        
        for (const batch of batches) {
          const count = trades.filter(t => t.importBatchId === batch.batchId).length;
          const dateStr = batch.createdAt ? new Date(batch.createdAt).toLocaleDateString() : '';
          sources.push({
            id: batch.batchId,
            name: `${batch.fileName}${dateStr ? ` (${dateStr})` : ''}`,
            count,
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

      const data = ruleSchema.partial().extend({ isActive: z.boolean().optional() }).parse(req.body);
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
        temperature: 0.7,
        max_tokens: 1000,
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
        price: quote.regularMarketPrice,
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

  // Get all factors
  app.get("/api/sentinel/tnn/factors", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const user = await sentinelModels.getUserById(userId);
      if (!user?.isAdmin) {
        return res.status(403).json({ error: "Admin access required" });
      }

      const factorType = req.query.type as string | undefined;
      const factors = await tnn.getFactors(factorType);
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

  // === TRADE IMPORT ROUTES ===

  // Preview CSV import (parse without saving)
  app.post("/api/sentinel/import/preview", requireAuth, async (req: Request, res: Response) => {
    try {
      const validationResult = importPreviewSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ error: validationResult.error.errors[0]?.message || "Invalid request" });
      }
      
      const { csvContent, fileName, brokerId } = validationResult.data;
      
      const userId = req.session.userId!;
      const user = await sentinelModels.getUserById(userId);
      
      const result = parseCSV(csvContent, fileName || "upload.csv", user?.username || "unknown", brokerId as BrokerId);
      
      res.json({
        batch: result.batch,
        trades: result.trades,
        detectedBroker: detectBroker(csvContent),
      });
    } catch (error) {
      console.error("Preview import error:", error);
      res.status(500).json({ error: "Failed to preview import" });
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
        // Note: Hand-entered trades don't have accountName - they're used as a general position baseline
        // This is a known limitation - if user has multi-account positions, hand trades are shared
        const existingHandTrades = await db!.select({
          id: sentinelTrades.id,
          ticker: sentinelTrades.ticker,
          direction: sentinelTrades.direction,
          shares: sentinelTrades.shares,
          entryDate: sentinelTrades.entryDate,
          exitDate: sentinelTrades.exitDate,
          exitShares: sentinelTrades.exitShares,
        }).from(sentinelTrades)
          .where(and(
            eq(sentinelTrades.userId, userId),
            inArray(sentinelTrades.ticker, Array.from(tickersInImport))
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
          // Note: Hand-entered trades use aggregate shares, not lot-level FIFO
          // They're included as a general position baseline (not filtered by account)
          // This is a known limitation - hand trades don't have account tracking
          for (const t of existingHandTrades.filter(t => t.ticker === ticker)) {
            const entryDirection = t.direction === 'LONG' ? 'BUY' : 'SELL';
            if (t.entryDate && t.shares) {
              allTrades.push({
                id: `hand_entry_${t.id}`, // Use DB id for stable ordering
                direction: entryDirection,
                quantity: t.shares,
                tradeDate: new Date(t.entryDate),
                sourcePriority: 2,
                isCurrentImport: false,
              });
            }
            if (t.exitDate && t.exitShares) {
              const exitDirection = t.direction === 'LONG' ? 'SELL' : 'BUY';
              allTrades.push({
                id: `hand_exit_${t.id}`, // Use DB id for stable ordering
                direction: exitDirection,
                quantity: t.exitShares,
                tradeDate: new Date(t.exitDate),
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
          
          // Sort by date, then by source priority, then by id (stable tie-breaker)
          allTrades.sort((a, b) => {
            const dateDiff = a.tradeDate.getTime() - b.tradeDate.getTime();
            if (dateDiff !== 0) return dateDiff;
            const priorityDiff = a.sourcePriority - b.sourcePriority;
            if (priorityDiff !== 0) return priorityDiff;
            return a.id.localeCompare(b.id);
          });
          
          // Check short sale settings for this account
          const tradeAccountKey = `${currentBrokerId}:${accountKey === '__default__' ? '' : accountKey}`;
          const shortSalesAllowed = accountShortAllowed.get(tradeAccountKey) ?? false;
          
          // Calculate running position and identify orphans for this account
          let runningPosition = 0;
          
          for (const trade of allTrades) {
            if (trade.direction === 'BUY') {
              runningPosition += trade.quantity;
            } else if (trade.direction === 'SELL') {
              // For current import sells, check if position is sufficient
              if (trade.isCurrentImport && runningPosition < trade.quantity && !shortSalesAllowed) {
                orphanSellTradeIds.add(trade.id);
              }
              runningPosition -= trade.quantity;
            }
          }
          }
        }
        
        orphanSellsCount = orphanSellTradeIds.size;
      }
      
      // Use a transaction to ensure atomicity - either all trades are saved or none
      await db.transaction(async (tx) => {
        // Save batch first
        await tx.insert(sentinelImportBatches).values({
          batchId: result.batch.batchId,
          userId,
          brokerId: result.batch.brokerId,
          fileName: result.batch.fileName,
          fileType: result.batch.fileType,
          totalTradesFound: result.batch.totalTradesFound,
          totalTradesImported: result.batch.totalTradesImported,
          orphanSellsCount,
          skippedRows: result.batch.skippedRows,
          status: orphanSellsCount > 0 ? "NEEDS_REVIEW" : result.batch.status,
        });
        
        // Batch insert all trades at once for better performance
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
          
          await tx.insert(sentinelImportedTrades).values(tradeValues);
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
      
      res.json(batches.reverse());
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
      
      res.json(orphans);
    } catch (error) {
      console.error("Get orphan sells error:", error);
      res.status(500).json({ error: "Failed to fetch orphan sells" });
    }
  });

  // Resolve an orphan sell (add cost basis or delete)
  app.patch("/api/sentinel/import/trades/:tradeId/resolve-orphan", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const { tradeId } = req.params;
      const { action, costBasis, openDate } = req.body;
      
      if (action === 'delete') {
        await db!.delete(sentinelImportedTrades)
          .where(and(
            eq(sentinelImportedTrades.tradeId, tradeId),
            eq(sentinelImportedTrades.userId, userId)
          ));
        return res.json({ success: true, action: 'deleted' });
      }
      
      if (action === 'resolve') {
        const [updated] = await db!.update(sentinelImportedTrades)
          .set({
            orphanStatus: 'resolved',
            manualCostBasis: costBasis,
            manualOpenDate: openDate,
          })
          .where(and(
            eq(sentinelImportedTrades.tradeId, tradeId),
            eq(sentinelImportedTrades.userId, userId)
          ))
          .returning();
        
        return res.json({ success: true, action: 'resolved', trade: updated });
      }
      
      res.status(400).json({ error: "Invalid action. Use 'delete' or 'resolve'" });
    } catch (error) {
      console.error("Resolve orphan error:", error);
      res.status(500).json({ error: "Failed to resolve orphan sell" });
    }
  });

  startMonitoring(60000);
}
