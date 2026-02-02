import type { Express, Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { sentinelModels } from "./models";
import { evaluateTrade } from "./evaluate";
import { startMonitoring } from "./monitor";
import type { EvaluationRequest, TradeUpdate, DashboardData, TradeWithEvaluation, EventWithTrade } from "./types";
import { sentinelTrades } from "@shared/schema";

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
  targetPrice: z.number().positive().optional(),
  targetPriceLevel: z.string().optional(),
  positionSize: z.number().positive().optional(),
  positionSizeUnit: z.enum(["shares", "dollars"]).optional(),
  thesis: z.string().optional(),
  deepEval: z.boolean().optional(),
});

const updateTradeSchema = z.object({
  stopPrice: z.number().positive().optional(),
  targetPrice: z.number().positive().optional(),
  status: z.enum(["considering", "active", "closed"]).optional(),
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
      const request: EvaluationRequest = {
        symbol: data.symbol,
        direction: data.direction,
        entryPrice: data.entryPrice,
        stopPrice: data.stopPrice,
        stopPriceLevel: data.stopPriceLevel,
        targetPrice: data.targetPrice,
        targetPriceLevel: data.targetPriceLevel,
        positionSize: data.positionSize,
        positionSizeUnit: data.positionSizeUnit,
        thesis: data.thesis,
        deepEval: data.deepEval,
      };

      const result = await evaluateTrade(request, req.session.userId!);
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
      const tradeId = parseInt(req.params.tradeId);
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

  app.get("/api/sentinel/dashboard", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;

      const [considering, active, recentEvents] = await Promise.all([
        sentinelModels.getTradesByStatus(userId, "considering"),
        sentinelModels.getTradesByStatus(userId, "active"),
        sentinelModels.getRecentEvents(userId, 20),
      ]);

      const enrichTrades = async (trades: typeof considering): Promise<TradeWithEvaluation[]> => {
        return Promise.all(trades.map(async (trade) => {
          const latestEval = await sentinelModels.getLatestEvaluation(trade.id);
          return {
            ...trade,
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
      const tradeId = parseInt(req.params.tradeId);
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
      const tradeId = parseInt(req.params.tradeId);
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

  startMonitoring(60000);
}
