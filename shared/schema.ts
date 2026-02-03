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

// Session table for connect-pg-simple (express-session)
export const session = pgTable("session", {
  sid: text("sid").primaryKey(),
  sess: jsonb("sess").notNull(),
  expire: timestamp("expire", { precision: 6 }).notNull(),
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
  communityOptIn: boolean("community_opt_in").default(false), // Allow anonymous rule performance sharing
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
  partialPrice: doublePrecision("partial_price"), // Partial profit price (customizable, defaults to 50% to target)
  targetPrice: doublePrecision("target_price"), // First profit trim price
  targetProfitPrice: doublePrecision("target_profit_price"), // Full position exit target
  targetProfitLevel: text("target_profit_level"), // Level type: EXTENDED_8X_50DMA, PREV_HIGH, RR_5X, etc.
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
  lotEntries: jsonb("lot_entries").$type<Array<{
    id: string;
    dateTime: string;
    qty: string;
    buySell: "buy" | "sell";
    price: string;
  }>>(), // Order grid lot entries for FIFO tracking
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
  // New fields for Rules Management system
  ruleType: text("rule_type").default("swing"), // 'swing' | 'intraday' | 'long_term' | 'all'
  directionTags: text("direction_tags").array(), // ['long'] | ['short'] | ['long', 'short']
  strategyTags: text("strategy_tags").array(), // User-defined strategy tags e.g., ['breakout', 'momentum']
  isGlobal: boolean("is_global").default(false), // If true, visible to all users (admin-committed)
  isDeleted: boolean("is_deleted").default(false), // Soft delete - grayed out but restorable
  createdAt: timestamp("created_at").defaultNow(),
});

// User overrides for starter/system rules (allows customization without modifying originals)
export const sentinelRuleOverrides = pgTable("sentinel_rule_overrides", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  ruleCode: text("rule_code").notNull(), // References the starter rule by code
  customName: text("custom_name"), // User's custom name (null = use original)
  customDescription: text("custom_description"), // User's custom description
  customSeverity: text("custom_severity"), // User's preferred severity
  isDisabled: boolean("is_disabled").default(false), // User has disabled this rule
  customFormula: text("custom_formula"), // User's modified formula
  notes: text("notes"), // Personal notes about this rule
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
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
export const insertSentinelRuleOverrideSchema = createInsertSchema(sentinelRuleOverrides).omit({ id: true, createdAt: true, updatedAt: true });
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
export type SentinelRuleOverride = typeof sentinelRuleOverrides.$inferSelect;
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
export type InsertSentinelRuleOverride = z.infer<typeof insertSentinelRuleOverrideSchema>;
export type InsertSentinelRuleSuggestion = z.infer<typeof insertSentinelRuleSuggestionSchema>;
export type InsertSentinelRulePerformance = z.infer<typeof insertSentinelRulePerformanceSchema>;
export type InsertSentinelTradeLabel = z.infer<typeof insertSentinelTradeLabelSchema>;
export type InsertSentinelTradeToLabel = z.infer<typeof insertSentinelTradeToLabelsSchema>;

// === TNN (Trader Neural Network) TABLES ===

// Factor types for the three-layer system
export type TnnFactorType = 'discipline' | 'setup_type';
export type TnnModifierSource = 'manual' | 'ai_suggested' | 'ai_confirmed';
export type TnnSuggestionStatus = 'pending' | 'approved' | 'rejected' | 'expired';

// TNN Factors - Discipline categories and Setup types with weights
export const tnnFactors = pgTable("tnn_factors", {
  id: serial("id").primaryKey(),
  factorType: text("factor_type").notNull(), // 'discipline' | 'setup_type'
  factorKey: text("factor_key").notNull().unique(), // e.g., 'entry', 'pullback', 'breakout'
  factorName: text("factor_name").notNull(), // Display name e.g., "Entry Timing", "Pullback Setup"
  description: text("description"),
  category: text("category"), // For discipline: the rule category; for setup_type: null
  baseWeight: integer("base_weight").notNull().default(50), // Admin-set baseline (0-100)
  aiAdjustedWeight: integer("ai_adjusted_weight").default(50), // Current AI-tuned weight
  autoAdjust: boolean("auto_adjust").default(false), // Allow AI to auto-adjust
  maxMagnitude: integer("max_magnitude"), // Max change per adjustment (null = unlimited)
  maxDrift: integer("max_drift"), // Max deviation from base (null = unlimited)
  sampleSize: integer("sample_size").default(0), // Number of trades used for AI learning
  lastAiUpdate: timestamp("last_ai_update"),
  order: integer("order").default(0), // Display order
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// TNN Modifiers - Contextual weight adjustments (setup × condition)
export const tnnModifiers = pgTable("tnn_modifiers", {
  id: serial("id").primaryKey(),
  factorKey: text("factor_key").notNull(), // The factor being modified
  factorName: text("factor_name").notNull(), // Display name for readability
  whenCondition: text("when_condition").notNull(), // Condition key e.g., 'choppy_market', 'risk_off'
  whenConditionName: text("when_condition_name").notNull(), // Display name
  weightModifier: integer("weight_modifier").notNull(), // +/- adjustment to factor weight
  source: text("source").notNull().default("manual"), // 'manual' | 'ai_suggested' | 'ai_confirmed'
  confidence: doublePrecision("confidence"), // AI confidence score (0-100)
  sampleSize: integer("sample_size").default(0), // Trades supporting this modifier
  winRateImpact: doublePrecision("win_rate_impact"), // Observed win rate change when active
  isActive: boolean("is_active").default(true),
  createdBy: text("created_by"), // 'admin' | 'ai'
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// TNN Suggestions - AI-proposed weight changes awaiting approval
export const tnnSuggestions = pgTable("tnn_suggestions", {
  id: serial("id").primaryKey(),
  suggestionType: text("suggestion_type").notNull(), // 'factor_weight' | 'modifier'
  factorKey: text("factor_key").notNull(), // Target factor
  factorName: text("factor_name").notNull(),
  whenCondition: text("when_condition"), // For modifier suggestions
  whenConditionName: text("when_condition_name"), // For modifier suggestions
  currentValue: integer("current_value").notNull(),
  proposedValue: integer("proposed_value").notNull(),
  confidenceScore: doublePrecision("confidence_score").notNull(), // AI confidence (0-100)
  reasoning: text("reasoning").notNull(), // AI explanation
  supportingData: jsonb("supporting_data").$type<{
    sampleSize: number;
    winRateWithChange: number;
    winRateWithout: number;
    avgPnLImpact: number;
    tradeIds: number[];
  }>(),
  status: text("status").notNull().default("pending"), // 'pending' | 'approved' | 'rejected' | 'expired'
  reviewedBy: integer("reviewed_by"), // Admin who reviewed
  reviewedAt: timestamp("reviewed_at"),
  reviewNotes: text("review_notes"),
  createdAt: timestamp("created_at").defaultNow(),
  expiresAt: timestamp("expires_at"),
});

// TNN History - Audit log of all weight changes
export const tnnHistory = pgTable("tnn_history", {
  id: serial("id").primaryKey(),
  changeType: text("change_type").notNull(), // 'factor_weight' | 'modifier_add' | 'modifier_update' | 'settings'
  factorKey: text("factor_key"),
  factorName: text("factor_name"),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  changedBy: text("changed_by").notNull(), // 'admin' | 'ai' | username
  reason: text("reason"),
  suggestionId: integer("suggestion_id"), // Link to suggestion if AI-driven
  createdAt: timestamp("created_at").defaultNow(),
});

// TNN Settings - Global autonomy and configuration
export const tnnSettings = pgTable("tnn_settings", {
  id: serial("id").primaryKey(),
  settingKey: text("setting_key").notNull().unique(),
  settingValue: text("setting_value").notNull(),
  description: text("description"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// TNN Schemas
export const insertTnnFactorSchema = createInsertSchema(tnnFactors).omit({ id: true, createdAt: true, updatedAt: true });
export const insertTnnModifierSchema = createInsertSchema(tnnModifiers).omit({ id: true, createdAt: true, updatedAt: true });
export const insertTnnSuggestionSchema = createInsertSchema(tnnSuggestions).omit({ id: true, createdAt: true });
export const insertTnnHistorySchema = createInsertSchema(tnnHistory).omit({ id: true, createdAt: true });
export const insertTnnSettingsSchema = createInsertSchema(tnnSettings).omit({ id: true, updatedAt: true });

// TNN Types
export type TnnFactor = typeof tnnFactors.$inferSelect;
export type TnnModifier = typeof tnnModifiers.$inferSelect;
export type TnnSuggestion = typeof tnnSuggestions.$inferSelect;
export type TnnHistory = typeof tnnHistory.$inferSelect;
export type TnnSetting = typeof tnnSettings.$inferSelect;

export type InsertTnnFactor = z.infer<typeof insertTnnFactorSchema>;
export type InsertTnnModifier = z.infer<typeof insertTnnModifierSchema>;
export type InsertTnnSuggestion = z.infer<typeof insertTnnSuggestionSchema>;
export type InsertTnnHistory = z.infer<typeof insertTnnHistorySchema>;
export type InsertTnnSetting = z.infer<typeof insertTnnSettingsSchema>;

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
