import { pgTable, text, serial, integer, boolean, timestamp, jsonb, doublePrecision } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// === TABLE DEFINITIONS ===

// Cache stock data to minimize API calls
export const stockDataCache = pgTable("stock_data_cache", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  date: text("date").notNull(), // YYYY-MM-DD
  open: doublePrecision("open").notNull(),
  high: doublePrecision("high").notNull(),
  low: doublePrecision("low").notNull(),
  close: doublePrecision("close").notNull(),
  volume: doublePrecision("volume").notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Saved scans/screens (supports multi-user via userId for future expansion)
export const savedScans = pgTable("saved_scans", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  criteria: jsonb("criteria").notNull(), // Store filter settings
  userId: text("user_id"), // For future multi-user/group support (null = admin/global)
  createdAt: timestamp("created_at").defaultNow(),
});

// Watchlist items
export const watchlistItems = pgTable("watchlist_items", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  addedAt: timestamp("added_at").defaultNow(),
});

// === SCHEMAS ===

export const insertScanSchema = createInsertSchema(savedScans).omit({ id: true, createdAt: true });
export const insertWatchlistSchema = createInsertSchema(watchlistItems).omit({ id: true, addedAt: true });

// === TYPES ===

export type StockData = typeof stockDataCache.$inferSelect;
export type SavedScan = typeof savedScans.$inferSelect;
export type WatchlistItem = typeof watchlistItems.$inferSelect;

export type InsertScan = z.infer<typeof insertScanSchema>;
export type InsertWatchlistItem = z.infer<typeof insertWatchlistSchema>;

// API Data Types
export interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ScanResult {
  symbol: string;
  price: number;
  changePercent: number;
  volume: number;
  matchedPattern?: string;
  sector?: string;
}

export interface ScanCriteria {
  minPrice?: number;
  maxPrice?: number;
  minVolume?: number;
  pattern?: string; // e.g., "Bullish Engulfing", "Doji"
}

// === SENTINEL TABLES ===

export const sentinelUsers = pgTable("sentinel_users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const sentinelTrades = pgTable("sentinel_trades", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  symbol: text("symbol").notNull(),
  direction: text("direction").notNull(), // 'long' | 'short'
  entryPrice: doublePrecision("entry_price").notNull(),
  stopPrice: doublePrecision("stop_price"),
  targetPrice: doublePrecision("target_price"),
  positionSize: doublePrecision("position_size"),
  thesis: text("thesis"),
  status: text("status").notNull().default("considering"), // 'considering' | 'active' | 'closed'
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const sentinelEvaluations = pgTable("sentinel_evaluations", {
  id: serial("id").primaryKey(),
  tradeId: integer("trade_id").notNull(),
  userId: integer("user_id").notNull(),
  model: text("model").notNull(), // 'gpt-5-mini' | 'gpt-5.2'
  promptVersion: text("prompt_version").notNull(),
  score: integer("score").notNull(), // 1-100
  reasoning: text("reasoning").notNull(),
  riskFlags: jsonb("risk_flags").$type<string[]>().default([]),
  recommendation: text("recommendation").notNull(), // 'proceed' | 'caution' | 'avoid'
  isDeepEval: boolean("is_deep_eval").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const sentinelEvents = pgTable("sentinel_events", {
  id: serial("id").primaryKey(),
  tradeId: integer("trade_id").notNull(),
  userId: integer("user_id").notNull(),
  eventType: text("event_type").notNull(), // 'status_change' | 'stop_update' | 'target_update' | 'evaluation' | 'alert'
  oldValue: text("old_value"),
  newValue: text("new_value"),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Sentinel Schemas
export const insertSentinelUserSchema = createInsertSchema(sentinelUsers).omit({ id: true, createdAt: true });
export const insertSentinelTradeSchema = createInsertSchema(sentinelTrades).omit({ id: true, createdAt: true, updatedAt: true });
export const insertSentinelEvaluationSchema = createInsertSchema(sentinelEvaluations).omit({ id: true, createdAt: true });
export const insertSentinelEventSchema = createInsertSchema(sentinelEvents).omit({ id: true, createdAt: true });

// Sentinel Types
export type SentinelUser = typeof sentinelUsers.$inferSelect;
export type SentinelTrade = typeof sentinelTrades.$inferSelect;
export type SentinelEvaluation = typeof sentinelEvaluations.$inferSelect;
export type SentinelEvent = typeof sentinelEvents.$inferSelect;

export type InsertSentinelUser = z.infer<typeof insertSentinelUserSchema>;
export type InsertSentinelTrade = z.infer<typeof insertSentinelTradeSchema>;
export type InsertSentinelEvaluation = z.infer<typeof insertSentinelEvaluationSchema>;
export type InsertSentinelEvent = z.infer<typeof insertSentinelEventSchema>;

// Chat tables for AI integrations
export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
