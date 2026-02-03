import type { Express, Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import bcrypt from "bcryptjs";
import { z } from "zod";
import OpenAI from "openai";
import { eq, and } from "drizzle-orm";
import { db } from "../db";
import { sentinelModels } from "./models";
import { evaluateTrade } from "./evaluate";
import { startMonitoring } from "./monitor";
import { fetchMarketSentiment, fetchSectorSentiment, getSentimentCacheAge } from "./sentiment";
import type { EvaluationRequest, TradeUpdate, DashboardData, TradeWithEvaluation, EventWithTrade } from "./types";
import { sentinelTrades, sentinelTradeLabels, sentinelTradeToLabels, sentinelUsers, insertSentinelTradeLabelSchema } from "@shared/schema";

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

  startMonitoring(60000);
}
