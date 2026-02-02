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
  accountSize: doublePrecision("account_size").default(1000000), // Default $1M
  isAdmin: boolean("is_admin").default(false), // Admin users can create/view special labels
  createdAt: timestamp("created_at").defaultNow(),
});

export const sentinelTrades = pgTable("sentinel_trades", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  symbol: text("symbol").notNull(),
  direction: text("direction").notNull(), // 'long' | 'short'
  entryPrice: doublePrecision("entry_price").notNull(),
  entryDate: timestamp("entry_date"), // Lot Date/Time - when position was entered
  stopPrice: doublePrecision("stop_price"),
  targetPrice: doublePrecision("target_price"),
  positionSize: doublePrecision("position_size"),
  thesis: text("thesis"),
  status: text("status").notNull().default("considering"), // 'considering' | 'active' | 'closed'
  // Trade closure fields
  exitPrice: doublePrecision("exit_price"),
  exitDate: timestamp("exit_date"),
  actualPnL: doublePrecision("actual_pnl"),
  outcome: text("outcome"), // 'win' | 'loss' | 'breakeven'
  rulesFollowed: jsonb("rules_followed").$type<Record<string, boolean>>(), // { ruleId: true/false }
  notes: text("notes"),
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

// Watchlist - setups user is monitoring for entry
export const sentinelWatchlist = pgTable("sentinel_watchlist", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  symbol: text("symbol").notNull(),
  targetEntry: doublePrecision("target_entry"), // desired entry price
  stopPlan: doublePrecision("stop_plan"), // planned stop if entered
  targetPlan: doublePrecision("target_plan"), // planned target if entered
  alertPrice: doublePrecision("alert_price"), // price to alert user
  thesis: text("thesis"),
  priority: text("priority").default("medium"), // 'high' | 'medium' | 'low'
  status: text("status").default("watching"), // 'watching' | 'triggered' | 'expired' | 'entered'
  expiresAt: timestamp("expires_at"), // optional expiration
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// User's trading rules/rubric for process evaluation
export const sentinelRules = pgTable("sentinel_rules", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(), // e.g., "Wait for pullback to 21 EMA"
  description: text("description"),
  category: text("category"), // 'entry' | 'exit' | 'sizing' | 'risk' | 'general' | 'auto_reject' | 'profit_taking' | 'stop_loss' | 'ma_structure' | 'base_quality' | 'breakout' | 'position_sizing' | 'market_regime'
  isActive: boolean("is_active").default(true),
  order: integer("order").default(0), // display order
  // Enhanced fields for starter rules system
  source: text("source").default("user"), // 'starter' | 'user' | 'ai_collective' | 'ai_agentic'
  severity: text("severity").default("warning"), // 'auto_reject' | 'critical' | 'warning' | 'info'
  isAutoReject: boolean("is_auto_reject").default(false), // If true, trade fails automatically
  ruleCode: text("rule_code"), // Machine-readable code for programmatic evaluation
  formula: text("formula"), // Optional formula e.g., "Target = 50 SMA × 1.08"
  parentRuleId: integer("parent_rule_id"), // For rules derived from AI learning
  confidenceScore: doublePrecision("confidence_score"), // AI confidence 0-1 for suggested rules
  adoptionCount: integer("adoption_count").default(0), // How many users adopted this rule
  createdAt: timestamp("created_at").defaultNow(),
});

// AI-generated rule suggestions (collective learning)
export const sentinelRuleSuggestions = pgTable("sentinel_rule_suggestions", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category"),
  severity: text("severity").default("warning"),
  isAutoReject: boolean("is_auto_reject").default(false),
  ruleCode: text("rule_code"),
  formula: text("formula"),
  source: text("source").notNull(), // 'ai_collective' | 'ai_agentic'
  confidenceScore: doublePrecision("confidence_score").notNull(), // AI confidence 0-1
  supportingData: jsonb("supporting_data").$type<{
    totalTrades: number;
    winRate: number;
    avgPnL: number;
    sampleSize: number;
    patternDescription: string;
  }>(),
  status: text("status").default("pending"), // 'pending' | 'approved' | 'rejected' | 'expired'
  adoptionCount: integer("adoption_count").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  expiresAt: timestamp("expires_at"),
});

// Track rule performance across all users (anonymized aggregation)
export const sentinelRulePerformance = pgTable("sentinel_rule_performance", {
  id: serial("id").primaryKey(),
  ruleCode: text("rule_code").notNull(), // Normalized rule identifier
  ruleName: text("rule_name").notNull(),
  category: text("category"),
  totalTrades: integer("total_trades").default(0),
  followedCount: integer("followed_count").default(0),
  notFollowedCount: integer("not_followed_count").default(0),
  winRateWhenFollowed: doublePrecision("win_rate_when_followed"),
  winRateWhenNotFollowed: doublePrecision("win_rate_when_not_followed"),
  avgPnLWhenFollowed: doublePrecision("avg_pnl_when_followed"),
  avgPnLWhenNotFollowed: doublePrecision("avg_pnl_when_not_followed"),
  lastUpdated: timestamp("last_updated").defaultNow(),
});

// Trade labels for categorizing/tagging trades (admin-only labels for expert trade logging)
export const sentinelTradeLabels = pgTable("sentinel_trade_labels", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  color: text("color").default("#6366f1"), // Hex color for display
  description: text("description"),
  isAdminOnly: boolean("is_admin_only").default(false), // If true, only admins can see/use
  createdBy: integer("created_by").notNull(), // User who created the label
  createdAt: timestamp("created_at").defaultNow(),
});

// Many-to-many association between trades and labels
export const sentinelTradeToLabels = pgTable("sentinel_trade_to_labels", {
  tradeId: integer("trade_id").notNull(),
  labelId: integer("label_id").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Sentinel Schemas
export const insertSentinelUserSchema = createInsertSchema(sentinelUsers).omit({ id: true, createdAt: true });
export const insertSentinelTradeSchema = createInsertSchema(sentinelTrades).omit({ id: true, createdAt: true, updatedAt: true });
export const insertSentinelEvaluationSchema = createInsertSchema(sentinelEvaluations).omit({ id: true, createdAt: true });
export const insertSentinelEventSchema = createInsertSchema(sentinelEvents).omit({ id: true, createdAt: true });
export const insertSentinelWatchlistSchema = createInsertSchema(sentinelWatchlist).omit({ id: true, createdAt: true, updatedAt: true });
export const insertSentinelRuleSchema = createInsertSchema(sentinelRules).omit({ id: true, createdAt: true });
export const insertSentinelRuleSuggestionSchema = createInsertSchema(sentinelRuleSuggestions).omit({ id: true, createdAt: true });
export const insertSentinelRulePerformanceSchema = createInsertSchema(sentinelRulePerformance).omit({ id: true });
export const insertSentinelTradeLabelSchema = createInsertSchema(sentinelTradeLabels).omit({ id: true, createdAt: true });
export const insertSentinelTradeToLabelsSchema = createInsertSchema(sentinelTradeToLabels).omit({ createdAt: true });

// Sentinel Types
export type SentinelUser = typeof sentinelUsers.$inferSelect;
export type SentinelTrade = typeof sentinelTrades.$inferSelect;
export type SentinelEvaluation = typeof sentinelEvaluations.$inferSelect;
export type SentinelEvent = typeof sentinelEvents.$inferSelect;
export type SentinelWatchlistItem = typeof sentinelWatchlist.$inferSelect;
export type SentinelRule = typeof sentinelRules.$inferSelect;
export type SentinelRuleSuggestion = typeof sentinelRuleSuggestions.$inferSelect;
export type SentinelRulePerformance = typeof sentinelRulePerformance.$inferSelect;
export type SentinelTradeLabel = typeof sentinelTradeLabels.$inferSelect;
export type SentinelTradeToLabel = typeof sentinelTradeToLabels.$inferSelect;

export type InsertSentinelUser = z.infer<typeof insertSentinelUserSchema>;
export type InsertSentinelTrade = z.infer<typeof insertSentinelTradeSchema>;
export type InsertSentinelEvaluation = z.infer<typeof insertSentinelEvaluationSchema>;
export type InsertSentinelEvent = z.infer<typeof insertSentinelEventSchema>;
export type InsertSentinelWatchlistItem = z.infer<typeof insertSentinelWatchlistSchema>;
export type InsertSentinelRule = z.infer<typeof insertSentinelRuleSchema>;
export type InsertSentinelRuleSuggestion = z.infer<typeof insertSentinelRuleSuggestionSchema>;
export type InsertSentinelRulePerformance = z.infer<typeof insertSentinelRulePerformanceSchema>;
export type InsertSentinelTradeLabel = z.infer<typeof insertSentinelTradeLabelSchema>;
export type InsertSentinelTradeToLabel = z.infer<typeof insertSentinelTradeToLabelsSchema>;

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
