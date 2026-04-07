import { pgTable, text, serial, integer, boolean, timestamp, jsonb, doublePrecision, varchar, decimal, bigint, date, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import type { AlertDeliveryConfig, AlertEvaluationConfig, AlertRuleGroup, AlertTargetScope } from "./alerts";

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

// Market condition themes - behavioral groups of stocks that trade together
export const themes = pgTable("themes", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  tier: text("tier").notNull(), // 'Macro', 'Structural', 'Narrative'
  leadersTarget: integer("leaders_target").default(5),
  notes: text("notes"),
  etfProxies: jsonb("etf_proxies").$type<Array<{ symbol: string; name: string; proxyType: string }>>(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Master ticker registry with current fundamentals (renamed from fundamentals_cache)
export const tickers = pgTable("tickers", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull().unique(),
  // Theme assignment (ONE theme per ticker)
  themeId: text("theme_id").references(() => themes.id),
  isCore: boolean("is_core").default(false), // Core member vs candidate
  // Basic profile data
  sector: text("sector").notNull(),
  industry: text("industry").notNull(),
  marketCap: doublePrecision("market_cap"),
  marketCapSize: text("market_cap_size"), // MEGA, LARGE, MID, SMALL, MICRO
  companyName: text("company_name"),
  exchange: text("exchange"),
  // Extended fundamentals (from Finnhub)
  pe: doublePrecision("pe"),
  beta: doublePrecision("beta"),
  debtToEquity: doublePrecision("debt_to_equity"),
  preTaxMargin: doublePrecision("pre_tax_margin"),
  analystConsensus: text("analyst_consensus"),
  targetPrice: doublePrecision("target_price"),
  nextEarningsDate: text("next_earnings_date"),
  nextEarningsDays: integer("next_earnings_days"),
  epsCurrentQYoY: text("eps_current_q_yoy"),
  salesGrowth3QYoY: text("sales_growth_3q_yoy"),
  lastEpsSurprise: text("last_eps_surprise"),
  // Market condition metrics
  accDistDays: integer("acc_dist_days").default(0), // Accumulation/Distribution streak (William O'Neal style)
  // Cache metadata
  fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
});

// Backward compatibility alias during migration
export const fundamentalsCache = tickers;

// Historical fundamental snapshots (quarterly earnings-based)
export const fundamentalSnapshots = pgTable("fundamental_snapshots", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull().references(() => tickers.symbol),
  snapshotDate: text("snapshot_date").notNull(), // DATE as text for consistency
  // Market data
  marketCap: doublePrecision("market_cap"),
  marketCapSize: text("market_cap_size"),
  // Fundamentals (from earnings)
  pe: doublePrecision("pe"),
  beta: doublePrecision("beta"),
  debtToEquity: doublePrecision("debt_to_equity"),
  preTaxMargin: doublePrecision("pre_tax_margin"),
  revenue: doublePrecision("revenue"),
  profit: doublePrecision("profit"),
  // Classification
  sector: text("sector"),
  industry: text("industry"),
  themeId: text("theme_id"),
  // Analyst data
  analystConsensus: text("analyst_consensus"),
  targetPrice: doublePrecision("target_price"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Daily A/D change log for debugging (optional)
export const accDistLog = pgTable("acc_dist_log", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull().references(() => tickers.symbol),
  date: text("date").notNull(), // DATE as text
  accDistDays: integer("acc_dist_days").notNull(),
  priceChangePct: doublePrecision("price_change_pct"),
  createdAt: timestamp("created_at").defaultNow(),
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
  accountSize: doublePrecision("account_size").default(100000), // Default $100k
  isAdmin: boolean("is_admin").default(false),
  tier: text("tier").default("free").notNull(), // "free" | "premium" | "pro" | "admin"
  communityOptIn: boolean("community_opt_in").default(false),
  // Risk profile settings for Ivy Stock Eval personalization
  maxAccountRiskPercent: doublePrecision("max_account_risk_percent").default(2), // Default 2%
  avgPositionSize: doublePrecision("avg_position_size"), // Optional, user-defined typical position
  riskProfileCompleted: boolean("risk_profile_completed").default(false), // Track if user has set up profile
  riskProfileSkippedAt: timestamp("risk_profile_skipped_at"), // When user last skipped the setup modal
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
  setupType: text("setup_type"), // Setup pattern: breakout, pullback, cup_and_handle, vcp, etc.
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
  source: text("source").default("hand"), // 'hand' for manual entry, 'import' for CSV imports
  importBatchId: text("import_batch_id"), // UUID of the import batch if source is 'import'
  // AI Learning Tags
  holdDays: integer("hold_days"), // Calculated from lot entries: days between first buy and last sell
  isTagged: boolean("is_tagged").default(false), // Whether user has reviewed and tagged this trade
  taggedAt: timestamp("tagged_at"), // When the trade was tagged
  aiSuggestedSetup: text("ai_suggested_setup"), // AI's suggested setup type
  aiSetupConfidence: doublePrecision("ai_setup_confidence"), // 0-1 confidence score
  // Account info for hand-entered trades
  accountName: text("account_name"), // User's trading account name
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

// Watchlist definitions - users can have multiple named watchlists
export const watchlists = pgTable("watchlists", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  isDefault: boolean("is_default").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// Watchlist items - setups user is monitoring for entry
export const sentinelWatchlist = pgTable("sentinel_watchlist", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  watchlistId: integer("watchlist_id"), // FK to watchlists table (nullable for migration)
  symbol: text("symbol").notNull(),
  direction: text("direction").default("long"), // 'long' | 'short'
  targetEntry: doublePrecision("target_entry"), // desired entry price
  stopPlan: doublePrecision("stop_plan"), // planned stop if entered
  targetPlan: doublePrecision("target_plan"), // planned target if entered
  alertPrice: doublePrecision("alert_price"), // price to alert user
  thesis: text("thesis"),
  priority: text("priority").default("medium"), // 'high' | 'medium' | 'low'
  status: text("status").default("watching"), // 'watching' | 'triggered' | 'expired' | 'entered'
  expiresAt: timestamp("expires_at"), // optional expiration
  // Ivy Stock Eval fields - AI recommendations and analysis
  ivyEvalId: integer("ivy_eval_id"), // Links to ivy_eval_history for post-mortem
  ivyEvalText: text("ivy_eval_text"), // Cached AI evaluation synopsis
  ivyRecommendedEntry: doublePrecision("ivy_recommended_entry"),
  ivyRecommendedStop: doublePrecision("ivy_recommended_stop"),
  ivyRecommendedTarget: doublePrecision("ivy_recommended_target"),
  ivyRiskAssessment: text("ivy_risk_assessment"), // 'low' | 'medium' | 'high'
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
export const insertWatchlistDefSchema = createInsertSchema(watchlists).omit({ id: true, createdAt: true });
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
export type Watchlist = typeof watchlists.$inferSelect;
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
export type InsertWatchlist = z.infer<typeof insertWatchlistDefSchema>;
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

// === TRADE IMPORT TABLES ===

// Asset types for imported trades
export type ImportAssetType = "STOCK" | "ETF" | "MUTUAL_FUND" | "OPTIONS" | "CRYPTO";
export type ImportTradeDirection = "BUY" | "SELL";
export type ImportTimestampSource = "BROKER_PROVIDED" | "ESTIMATED_OPEN" | "ESTIMATED_CLOSE" | "PDF_CONFIRMATION" | "UNKNOWN";
export type ImportTradeStatus = "CONFIRMED" | "PENDING" | "CANCELLED" | "REJECTED";
export type ImportAccountType = "CASH" | "MARGIN" | "IRA" | "ROTH_IRA" | "TAXABLE";
export type ImportBatchStatus = "PROCESSING" | "COMPLETE" | "FAILED";

// Import batches - tracks each file upload
export const sentinelImportBatches = pgTable("sentinel_import_batches", {
  id: serial("id").primaryKey(),
  batchId: text("batch_id").notNull().unique(), // UUID for batch
  userId: integer("user_id").notNull(),
  brokerId: text("broker_id").notNull(), // 'FIDELITY' | 'SCHWAB' | 'ROBINHOOD' etc.
  accountSettingsId: integer("account_settings_id"), // Links to account settings for this import
  fileName: text("file_name").notNull(),
  importName: text("import_name"), // Custom display name, defaults to "FILE" + last 4 chars of fileName
  fileType: text("file_type").notNull().default("CSV"), // 'CSV' | 'PDF' | 'XLSX'
  totalTradesFound: integer("total_trades_found").default(0),
  totalTradesImported: integer("total_trades_imported").default(0),
  orphanSellsCount: integer("orphan_sells_count").default(0), // Sells with no matching buy
  duplicatesCount: integer("duplicates_count").default(0), // Trades that match existing data
  skippedRows: jsonb("skipped_rows").$type<Array<{
    rowIndex: number;
    rawData: string;
    reason: string;
  }>>().default([]),
  status: text("status").notNull().default("PROCESSING"), // 'PROCESSING' | 'COMPLETE' | 'FAILED' | 'NEEDS_REVIEW'
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Imported trades - normalized trade records from any broker
export const sentinelImportedTrades = pgTable("sentinel_imported_trades", {
  id: serial("id").primaryKey(),
  tradeId: text("trade_id").notNull().unique(), // UUID for this trade
  userId: integer("user_id").notNull(),
  batchId: text("batch_id").notNull(), // Links to import batch
  brokerId: text("broker_id").notNull(),
  brokerOrderId: text("broker_order_id"), // Extracted order ID if present
  
  // What was traded
  ticker: text("ticker").notNull(),
  assetType: text("asset_type").notNull().default("STOCK"),
  direction: text("direction").notNull(), // 'BUY' | 'SELL'
  
  // Execution details
  quantity: doublePrecision("quantity").notNull(),
  price: doublePrecision("price").notNull(),
  totalAmount: doublePrecision("total_amount").notNull(),
  commission: doublePrecision("commission").default(0),
  fees: doublePrecision("fees").default(0),
  netAmount: doublePrecision("net_amount").notNull(),
  
  // Timestamps
  tradeDate: text("trade_date").notNull(), // ISO date YYYY-MM-DD
  settlementDate: text("settlement_date"),
  executionTime: text("execution_time"), // Full ISO timestamp
  timestampSource: text("timestamp_source").default("UNKNOWN"),
  isTimeEstimated: boolean("is_time_estimated").default(true),
  
  // Account info
  accountId: text("account_id"),
  accountName: text("account_name"),
  accountType: text("account_type").default("TAXABLE"),
  
  // Status
  status: text("status").notNull().default("CONFIRMED"),
  
  // Fill tracking for partial fills
  isFill: boolean("is_fill").default(false),
  fillGroupKey: text("fill_group_key"), // Groups fills: "{date}_{ticker}_{direction}"
  
  // Orphan sell tracking (sells with no matching buy in dataset)
  isOrphanSell: boolean("is_orphan_sell").default(false),
  orphanStatus: text("orphan_status"), // 'pending' | 'resolved' | 'deleted' | 'muted'
  manualCostBasis: doublePrecision("manual_cost_basis"), // User-entered cost basis for orphan sells
  manualOpenDate: text("manual_open_date"), // User-entered open date for orphan sells
  isSyntheticDate: boolean("is_synthetic_date").default(false), // True when date was auto-generated due to missing info
  
  // Duplicate detection - matches against existing Trading Cards or other imports
  isDuplicate: boolean("is_duplicate").default(false),
  duplicateStatus: text("duplicate_status"), // 'pending' | 'overwritten' | 'deleted'
  duplicateOfTradeId: integer("duplicate_of_trade_id"), // ID of existing sentinelTrades record if duplicate
  duplicateOfImportId: integer("duplicate_of_import_id"), // ID of existing sentinelImportedTrades record if duplicate
  
  // Promotion tracking
  promotedToCardId: integer("promoted_to_card_id"),
  promotedAt: timestamp("promoted_at"),
  
  // Audit trail
  rawSource: text("raw_source"), // Original CSV row
  importedAt: timestamp("imported_at").defaultNow(),
});

// Import Schemas
export const insertSentinelImportBatchSchema = createInsertSchema(sentinelImportBatches).omit({ id: true, createdAt: true });
export const insertSentinelImportedTradeSchema = createInsertSchema(sentinelImportedTrades).omit({ id: true, importedAt: true });

// Import Types
export type SentinelImportBatch = typeof sentinelImportBatches.$inferSelect;
export type SentinelImportedTrade = typeof sentinelImportedTrades.$inferSelect;

export type InsertSentinelImportBatch = z.infer<typeof insertSentinelImportBatchSchema>;
export type InsertSentinelImportedTrade = z.infer<typeof insertSentinelImportedTradeSchema>;

// Broker Account Settings - persisted settings per broker/account combination
export const sentinelAccountSettings = pgTable("sentinel_account_settings", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  brokerId: text("broker_id").notNull(), // 'FIDELITY' | 'SCHWAB' | 'ROBINHOOD' etc.
  accountName: text("account_name").notNull(), // User-defined name like "Fidelity IRA", "401k Brokerage"
  accountNumber: text("account_number"), // Optional masked account number for identification
  allowsShortSales: boolean("allows_short_sales").notNull().default(false), // Default: no shorts (IRA/401k)
  defaultDirection: text("default_direction").default("LONG"), // Default assumption for orphan sells
  notes: text("notes"), // User notes about this account
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertSentinelAccountSettingsSchema = createInsertSchema(sentinelAccountSettings).omit({ id: true, createdAt: true, updatedAt: true });
export type SentinelAccountSettings = typeof sentinelAccountSettings.$inferSelect;
export type InsertSentinelAccountSettings = z.infer<typeof insertSentinelAccountSettingsSchema>;

// System Settings - UI theming and appearance settings per user
export const sentinelSystemSettings = pgTable("sentinel_system_settings", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  overlayColor: text("overlay_color").default("#1e3a5f"),
  overlayTransparency: integer("overlay_transparency").default(75),
  backgroundColor: text("background_color").default("#0f172a"),
  logoTransparency: integer("logo_transparency").default(6),
  secondaryOverlayColor: text("secondary_overlay_color").default("#e8e8e8"),
  textColorTitle: text("text_color_title").default("#ffffff"),
  textColorHeader: text("text_color_header").default("#ffffff"),
  textColorSection: text("text_color_section").default("#ffffff"),
  textColorNormal: text("text_color_normal").default("#ffffff"),
  textColorSmall: text("text_color_small").default("#a1a1aa"),
  textColorTiny: text("text_color_tiny").default("#71717a"),
  fontSizeTitle: text("font_size_title").default("1.5rem"),
  fontSizeHeader: text("font_size_header").default("1.125rem"),
  fontSizeSection: text("font_size_section").default("1rem"),
  fontSizeNormal: text("font_size_normal").default("0.875rem"),
  fontSizeSmall: text("font_size_small").default("0.8125rem"),
  fontSizeTiny: text("font_size_tiny").default("0.75rem"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertSentinelSystemSettingsSchema = createInsertSchema(sentinelSystemSettings).omit({ id: true, createdAt: true, updatedAt: true });
export type SentinelSystemSettings = typeof sentinelSystemSettings.$inferSelect;
export type InsertSentinelSystemSettings = z.infer<typeof insertSentinelSystemSettingsSchema>;

// Order Levels - Multiple stops and profit targets per trade (1-to-many)
export const sentinelOrderLevels = pgTable("sentinel_order_levels", {
  id: serial("id").primaryKey(),
  tradeId: integer("trade_id").notNull(),
  userId: integer("user_id").notNull(),
  levelType: text("level_type").notNull(), // 'stop' | 'target'
  price: doublePrecision("price").notNull(),
  quantity: doublePrecision("quantity"),
  source: text("source").default("manual"), // 'manual' | 'import'
  status: text("status").default("open"), // 'open' | 'filled' | 'cancelled'
  orderNumber: text("order_number"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertSentinelOrderLevelSchema = createInsertSchema(sentinelOrderLevels).omit({ id: true, createdAt: true, updatedAt: true });
export type SentinelOrderLevel = typeof sentinelOrderLevels.$inferSelect;
export type InsertSentinelOrderLevel = z.infer<typeof insertSentinelOrderLevelSchema>;

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

// === PATTERN LEARNING TABLES ===

// Pattern Rules - Formula definitions for pattern detection
export const patternRules = pgTable("pattern_rules", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  patternType: text("pattern_type").notNull(), // 'breakout_pullback', 'cup_and_handle', 'vcp', etc.
  timeframe: text("timeframe").notNull(), // 'intraday', 'daily', 'weekly', 'monthly'
  name: text("name").notNull(), // User-friendly name
  description: text("description"), // Human-readable description
  formula: text("formula"), // Text-based formula definition for AI to interpret
  requiredTechnicals: jsonb("required_technicals").$type<{
    indicators: string[]; // e.g., ['21 EMA', 'VWAP', '50 SMA']
    overlays?: string[]; // e.g., ['Bollinger Bands', 'Keltner Channels']
    volumeRequired?: boolean;
  }>().default({ indicators: [], overlays: [], volumeRequired: true }),
  formulaParams: jsonb("formula_params").$type<{
    breakoutMinPct?: number;
    breakoutMaxPct?: number;
    volumeRatio?: number;
    pullbackMinDepth?: number;
    pullbackMaxDepth?: number;
    maDistance?: number;
    maPeriod?: number;
    maType?: string;
    entryConfirmPct?: number;
    invalidationPct?: number;
    [key: string]: number | string | undefined;
  }>().default({}),
  version: integer("version").default(1),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Pattern Ratings - User feedback on pattern matches
export const patternRatings = pgTable("pattern_ratings", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  ruleId: integer("rule_id").notNull(), // Links to pattern_rules
  ticker: text("ticker").notNull(),
  matchDate: text("match_date").notNull(), // Date the pattern was detected
  rating: integer("rating").notNull(), // 1-4 scale
  feedback: text("feedback"), // English feedback for AI learning
  chartConditions: jsonb("chart_conditions").$type<{
    breakoutPct?: number;
    volumeRatio?: number;
    pullbackDepth?: number;
    maDistance?: number;
    [key: string]: number | string | undefined;
  }>().default({}),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Setup Confidence - Aggregated stats per pattern+timeframe
export const setupConfidence = pgTable("setup_confidence", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  ruleId: integer("rule_id").notNull(), // Links to pattern_rules
  patternsRated: integer("patterns_rated").default(0),
  avgRating: doublePrecision("avg_rating").default(0),
  rating1Count: integer("rating_1_count").default(0), // Useless
  rating2Count: integer("rating_2_count").default(0), // Elements exist
  rating3Count: integer("rating_3_count").default(0), // Formed but past
  rating4Count: integer("rating_4_count").default(0), // Good setup
  tradesTaken: integer("trades_taken").default(0),
  tradesWon: integer("trades_won").default(0),
  winRate: doublePrecision("win_rate").default(0),
  avgReturn: doublePrecision("avg_return").default(0),
  confidenceLevel: text("confidence_level").default("untested"), // 'untested', 'low', 'medium', 'high'
  lastUpdated: timestamp("last_updated").defaultNow(),
});

// Pattern Learning Schemas
export const insertPatternRuleSchema = createInsertSchema(patternRules).omit({ id: true, createdAt: true, updatedAt: true });
export const insertPatternRatingSchema = createInsertSchema(patternRatings).omit({ id: true, createdAt: true });
export const insertSetupConfidenceSchema = createInsertSchema(setupConfidence).omit({ id: true, lastUpdated: true });

// Pattern Learning Types
export type PatternRule = typeof patternRules.$inferSelect;
export type PatternRating = typeof patternRatings.$inferSelect;
export type SetupConfidence = typeof setupConfidence.$inferSelect;

export type InsertPatternRule = z.infer<typeof insertPatternRuleSchema>;
export type InsertPatternRating = z.infer<typeof insertPatternRatingSchema>;
export type InsertSetupConfidence = z.infer<typeof insertSetupConfidenceSchema>;

// Rating labels for UI
export const RATING_LABELS = {
  1: "Useless",
  2: "Elements Exist", 
  3: "Mostly Formed",
  4: "Formed but Past",
  5: "Good Setup"
} as const;

export const RATING_SCORE_RANGES = {
  1: { min: 0, max: 18, midpoint: 9 },
  2: { min: 20, max: 38, midpoint: 29 },
  3: { min: 40, max: 58, midpoint: 49 },
  4: { min: 60, max: 78, midpoint: 69 },
  5: { min: 80, max: 98, midpoint: 89 },
} as const;

export const PATTERN_TYPES = [
  { value: "breakout_pullback", label: "Breakout with Pullback" },
  { value: "cup_and_handle", label: "Cup and Handle" },
  { value: "vcp", label: "Volatility Contraction Pattern" },
  { value: "high_tight_flag", label: "High Tight Flag" },
  { value: "reclaim", label: "MA Reclaim" },
  { value: "weekly_tight", label: "Weekly Tight" },
  { value: "monthly_tight", label: "Monthly Tight" },
  { value: "pullback", label: "Pullback to MA" },
] as const;

export const PATTERN_TIMEFRAMES = [
  { value: "intraday", label: "Intraday" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
] as const;

// ============================================================================
// PATTERN LEARNING V2 - Hierarchical Setup System with 100-Point Scoring
// ============================================================================

// Master Setups - Pattern archetypes (Cup and Handle, VCP, etc.)
export const masterSetups = pgTable("master_setups", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  defaultStages: jsonb("default_stages").$type<string[]>().default([]),
  invalidationRules: jsonb("invalidation_rules").$type<{
    minCupDepthPct?: number;
    maxHandleDepthPct?: number;
    minBaseWeeks?: number;
    minContractions?: number;
    [key: string]: number | undefined;
  }>(),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// Setup Variants - Timeframe-specific versions of master setups
export const setupVariants = pgTable("setup_variants", {
  id: serial("id").primaryKey(),
  masterSetupId: integer("master_setup_id").notNull().references(() => masterSetups.id),
  name: text("name").notNull(),
  timeframe: text("timeframe").notNull(), // D, W, 5, 15, 60
  durationMin: text("duration_min"),
  durationMax: text("duration_max"),
  chartPeriod: text("chart_period"), // 1y, 6mo, 3mo, 5d
  requiredCriteriaIds: integer("required_criteria_ids").array(),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// Formation Stages - Lifecycle stages for each pattern type
export const formationStages = pgTable("formation_stages", {
  id: serial("id").primaryKey(),
  masterSetupId: integer("master_setup_id").notNull().references(() => masterSetups.id),
  stageName: text("stage_name").notNull(),
  stageOrder: integer("stage_order").notNull(),
  stageType: text("stage_type").notNull().default("sequential"), // sequential, parallel, terminal
  isTerminal: boolean("is_terminal").default(false),
  scoreModifier: integer("score_modifier").default(0),
  typicalDurationMin: text("typical_duration_min"),
  typicalDurationMax: text("typical_duration_max"),
  tooLongThreshold: text("too_long_threshold"),
  description: text("description"),
});

// Rating Criteria - Universal and pattern-specific scoring dimensions
export const ratingCriteria = pgTable("rating_criteria", {
  id: serial("id").primaryKey(),
  category: text("category").notNull(), // market_env, relative_strength, volume_quality, technical_structure, pattern_specific
  name: text("name").notNull(),
  description: text("description"),
  maxPoints: integer("max_points").notNull().default(4), // 1-5, flexible per criterion
  isUniversal: boolean("is_universal").default(true),
  masterSetupId: integer("master_setup_id").references(() => masterSetups.id), // null if universal
  createdAt: timestamp("created_at").defaultNow(),
});

// Rating Weights - Context-dependent importance per variant (with user overrides)
export const ratingWeights = pgTable("rating_weights", {
  id: serial("id").primaryKey(),
  setupVariantId: integer("setup_variant_id").notNull().references(() => setupVariants.id),
  criteriaId: integer("criteria_id").notNull().references(() => ratingCriteria.id),
  defaultWeight: doublePrecision("default_weight").default(1.0),
  weight: doublePrecision("weight").default(1.0),
  userId: integer("user_id"), // null = global default
  isDefault: boolean("is_default").default(true),
});

// Rated Examples - Human-rated pattern examples for AI training
export const ratedExamples = pgTable("rated_examples", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  setupVariantId: integer("setup_variant_id").references(() => setupVariants.id),
  ticker: text("ticker").notNull(),
  matchDate: text("match_date").notNull(),
  humanRating: integer("human_rating").notNull(), // 1-5
  aiScore: integer("ai_score"), // 0-100 granular
  formationStageId: integer("formation_stage_id").references(() => formationStages.id),
  criteriaScores: jsonb("criteria_scores").$type<Record<string, number>>().default({}),
  feedback: text("feedback"),
  chartSnapshot: text("chart_snapshot"),
  marketPhase: text("market_phase"), // bull, correction, bear, choppy
  sectorPerformance: text("sector_performance"), // leading, inline, lagging
  stockStage: integer("stock_stage"), // O'Neil stage 1-4
  priorAttemptCount: integer("prior_attempt_count").default(0),
  chartContext: jsonb("chart_context").$type<{
    distanceFrom52wHigh?: number;
    baseDepthPct?: number;
    daysInBase?: number;
    [key: string]: number | undefined;
  }>(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Schema exports for Pattern Learning V2
export const insertMasterSetupSchema = createInsertSchema(masterSetups).omit({ id: true, createdAt: true });
export const insertSetupVariantSchema = createInsertSchema(setupVariants).omit({ id: true, createdAt: true });
export const insertFormationStageSchema = createInsertSchema(formationStages).omit({ id: true });
export const insertRatingCriteriaSchema = createInsertSchema(ratingCriteria).omit({ id: true, createdAt: true });
export const insertRatingWeightSchema = createInsertSchema(ratingWeights).omit({ id: true });
export const insertRatedExampleSchema = createInsertSchema(ratedExamples).omit({ id: true, createdAt: true });

// Type exports for Pattern Learning V2
export type MasterSetup = typeof masterSetups.$inferSelect;
export type SetupVariant = typeof setupVariants.$inferSelect;
export type FormationStage = typeof formationStages.$inferSelect;
export type RatingCriteria = typeof ratingCriteria.$inferSelect;
export type RatingWeight = typeof ratingWeights.$inferSelect;
export type RatedExample = typeof ratedExamples.$inferSelect;

export type InsertMasterSetup = z.infer<typeof insertMasterSetupSchema>;
export type InsertSetupVariant = z.infer<typeof insertSetupVariantSchema>;
export type InsertFormationStage = z.infer<typeof insertFormationStageSchema>;
export type InsertRatingCriteria = z.infer<typeof insertRatingCriteriaSchema>;
export type InsertRatingWeight = z.infer<typeof insertRatingWeightSchema>;
export type InsertRatedExample = z.infer<typeof insertRatedExampleSchema>;

// Master setup names for reference
export const MASTER_SETUP_NAMES = [
  "Cup and Handle",
  "VCP",
  "High Tight Flag",
  "Flat Base",
  "Double Bottom",
  "Bull Flag",
  "Triangle",
  "ORB",
  "Episodic Pivot",
  "Pullback/Reclaim",
  "Gap and Go",
  "Ascending Base",
  "Consolidation Breakout",
  "Failed Breakout",
] as const;

// Rating criteria categories
export const RATING_CATEGORIES = [
  { value: "market_env", label: "Market Environment", maxTotal: 20 },
  { value: "relative_strength", label: "Relative Strength", maxTotal: 20 },
  { value: "volume_quality", label: "Volume Quality", maxTotal: 20 },
  { value: "technical_structure", label: "Technical Structure", maxTotal: 20 },
  { value: "pattern_specific", label: "Pattern Specific", maxTotal: 20 },
] as const;

// Formation stage types
export const STAGE_TYPES = [
  { value: "sequential", label: "Sequential" },
  { value: "parallel", label: "Parallel" },
  { value: "terminal", label: "Terminal" },
] as const;

// Market phase options
export const MARKET_PHASES = [
  { value: "bull", label: "Bull Market" },
  { value: "correction", label: "Correction" },
  { value: "bear", label: "Bear Market" },
  { value: "choppy", label: "Choppy/Sideways" },
] as const;

// Sector performance options
export const SECTOR_PERFORMANCE = [
  { value: "leading", label: "Leading" },
  { value: "inline", label: "In-Line" },
  { value: "lagging", label: "Lagging" },
] as const;

// ============================================================================
// PATTERN TRAINING TOOL - Interactive chart-based setup annotation system
// ============================================================================

export const TRAINING_PATTERN_TYPES = [
  { value: "cup_and_handle", label: "Cup and Handle" },
  { value: "vcp", label: "VCP" },
  { value: "high_tight_flag", label: "High Tight Flag" },
  { value: "flat_base", label: "Flat Base" },
  { value: "double_bottom", label: "Double Bottom" },
  { value: "bull_flag", label: "Bull Flag" },
  { value: "ascending_base", label: "Ascending Base" },
  { value: "consolidation_breakout", label: "Consolidation Breakout" },
  { value: "episodic_pivot", label: "Episodic Pivot" },
  { value: "pullback_reclaim", label: "Pullback/Reclaim" },
  { value: "gap_and_go", label: "Gap and Go" },
  { value: "orb", label: "ORB (Opening Range Breakout)" },
  { value: "other", label: "Other" },
] as const;

export const TRAINING_TIMEFRAMES = [
  { value: "daily", label: "Daily" },
  { value: "5min", label: "5 Min" },
  { value: "15min", label: "15 Min" },
  { value: "30min", label: "30 Min" },
] as const;

export const INTRADAY_LOOKBACK_DAYS: Record<string, number> = {
  "5min": 30,
  "15min": 45,
  "30min": 60,
};

export const TRAINING_POINT_ROLES = [
  { value: "entry", label: "Entry", required: true, multiPoint: true },
  { value: "stop", label: "Stop", required: true, multiPoint: true },
  { value: "target", label: "Target", required: true, multiPoint: true },
  { value: "sell", label: "Sell", required: false, multiPoint: true },
  { value: "support_bounce", label: "Support Bounce", required: false },
  { value: "resistance_test", label: "Resistance Test", required: false, multiClick: 2 },
  { value: "breakout_confirmed", label: "Breakout Confirmed", required: false },
  { value: "breakdown", label: "Breakdown", required: false },
] as const;

export const TRAINING_OUTCOMES = [
  { value: "win", label: "Win" },
  { value: "loss", label: "Loss" },
  { value: "pending", label: "Pending" },
  { value: "scratch", label: "Scratch" },
] as const;

/* ARCHIVED — Pattern Training tables (DB tables still exist, code moved to _archived/pattern-training/)
 * Uncomment to restore. See _archived/pattern-training/ for the full feature code.
 *
 * export const patternTrainingSetups = pgTable("pattern_training_setups", { ... });
 * export const patternTrainingPoints = pgTable("pattern_training_points", { ... });
 * export const patternTrainingEvaluations = pgTable("pattern_training_evaluations", { ... });
 */

// User MA Settings - per-user indicator configuration for charts
export const userMaSettings = pgTable("user_ma_settings", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  rowId: text("row_id").notNull(),
  title: text("title").notNull(),
  maType: text("ma_type").notNull(),
  period: integer("period"),
  color: text("color").notNull().default("#ffffff"),
  lineType: integer("line_type").notNull().default(0),
  isSystem: boolean("is_system").notNull().default(false),
  isVisible: boolean("is_visible").notNull().default(true),
  dailyOn: boolean("daily_on").notNull().default(true),
  fiveMinOn: boolean("five_min_on").notNull().default(true),
  fifteenMinOn: boolean("fifteen_min_on").notNull().default(true),
  thirtyMinOn: boolean("thirty_min_on").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  calcOn: text("calc_on").notNull().default("daily"),
});

export const insertUserMaSettingSchema = createInsertSchema(userMaSettings).omit({ id: true });
export type UserMaSetting = typeof userMaSettings.$inferSelect;
export type InsertUserMaSetting = z.infer<typeof insertUserMaSettingSchema>;

export const userChartPreferences = pgTable("user_chart_preferences", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  defaultBarsOnScreen: integer("default_bars_on_screen").notNull().default(200),
  dataLimitDaily: integer("data_limit_daily").notNull().default(750),
  dataLimit5min: integer("data_limit_5min").notNull().default(63),
  dataLimit15min: integer("data_limit_15min").notNull().default(126),
  dataLimit30min: integer("data_limit_30min").notNull().default(126),
});

export type UserChartPreference = typeof userChartPreferences.$inferSelect;

// Alert subsystem - canonical alert definitions used by charts, Market Flow, watchlists, and scanners
export const userAlerts = pgTable("user_alerts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  sourceClient: text("source_client").notNull(),
  targetScope: jsonb("target_scope").$type<AlertTargetScope>().notNull(),
  ruleTree: jsonb("rule_tree").$type<AlertRuleGroup>().notNull(),
  evaluationConfig: jsonb("evaluation_config").$type<AlertEvaluationConfig>().notNull(),
  deliveryConfig: jsonb("delivery_config").$type<AlertDeliveryConfig>().notNull(),
  expirationAt: timestamp("expiration_at"),
  enabled: boolean("enabled").notNull().default(true),
  isPaused: boolean("is_paused").notNull().default(false),
  lastTriggeredAt: timestamp("last_triggered_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const alertEvents = pgTable("alert_events", {
  id: serial("id").primaryKey(),
  alertId: integer("alert_id").notNull(),
  userId: integer("user_id").notNull(),
  matchedSymbols: text("matched_symbols").array().notNull().default([]),
  matchedCount: integer("matched_count").notNull().default(0),
  summary: text("summary"),
  triggerReason: text("trigger_reason"),
  sourceGroupLabel: text("source_group_label"),
  deliveryMode: text("delivery_mode").notNull(),
  deliveryChannels: text("delivery_channels").array().notNull().default([]),
  createdAt: timestamp("created_at").defaultNow(),
});

export const alertDeliveries = pgTable("alert_deliveries", {
  id: serial("id").primaryKey(),
  alertId: integer("alert_id").notNull(),
  alertEventId: integer("alert_event_id").notNull(),
  channel: text("channel").notNull(),
  status: text("status").notNull().default("pending"),
  batchKey: text("batch_key"),
  providerMessageId: text("provider_message_id"),
  providerStatus: text("provider_status"),
  providerErrorCode: text("provider_error_code"),
  providerPayload: jsonb("provider_payload"),
  errorMessage: text("error_message"),
  attemptedAt: timestamp("attempted_at").defaultNow(),
  deliveredAt: timestamp("delivered_at"),
  providerStatusAt: timestamp("provider_status_at"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const alertSymbolStates = pgTable("alert_symbol_states", {
  id: serial("id").primaryKey(),
  alertId: integer("alert_id").notNull(),
  userId: integer("user_id").notNull(),
  symbol: text("symbol").notNull(),
  status: text("status").notNull().default("idle"), // idle | armed | completed | expired
  nextStageIndex: integer("next_stage_index").notNull().default(0),
  armedAt: timestamp("armed_at"),
  expiresAt: timestamp("expires_at"),
  lastMatchedAt: timestamp("last_matched_at"),
  lastEvaluatedAt: timestamp("last_evaluated_at").defaultNow(),
  statePayload: jsonb("state_payload"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertUserAlertSchema = createInsertSchema(userAlerts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastTriggeredAt: true,
});
export const insertAlertEventSchema = createInsertSchema(alertEvents).omit({
  id: true,
  createdAt: true,
});
export const insertAlertDeliverySchema = createInsertSchema(alertDeliveries).omit({
  id: true,
  attemptedAt: true,
  deliveredAt: true,
  providerStatusAt: true,
  updatedAt: true,
});
export const insertAlertSymbolStateSchema = createInsertSchema(alertSymbolStates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastEvaluatedAt: true,
});

export type UserAlert = typeof userAlerts.$inferSelect;
export type AlertEvent = typeof alertEvents.$inferSelect;
export type AlertDelivery = typeof alertDeliveries.$inferSelect;
export type AlertSymbolState = typeof alertSymbolStates.$inferSelect;

export type InsertUserAlert = z.infer<typeof insertUserAlertSchema>;
export type InsertAlertEvent = z.infer<typeof insertAlertEventSchema>;
export type InsertAlertDelivery = z.infer<typeof insertAlertDeliverySchema>;
export type InsertAlertSymbolState = z.infer<typeof insertAlertSymbolStateSchema>;


// === BIG IDEA SCANNER ===

export const scannerThoughts = pgTable("scanner_thoughts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  description: text("description"),
  aiPrompt: text("ai_prompt"),
  criteria: jsonb("criteria").$type<ScannerCriterion[]>().notNull(),
  timeframe: text("timeframe").notNull().default("daily"),
  score: integer("score").notNull().default(0),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const scannerIdeas = pgTable("scanner_ideas", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  universe: text("universe").notNull().default("sp500"),
  nodes: jsonb("nodes").$type<IdeaNode[]>().notNull(),
  edges: jsonb("edges").$type<IdeaEdge[]>().notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const scannerFavorites = pgTable("scanner_favorites", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  ideaId: integer("idea_id").notNull(),
  symbol: text("symbol").notNull(),
  addedAt: timestamp("added_at").defaultNow(),
});

export interface ScannerCriterionParam {
  name: string;
  label: string;
  type: "number" | "select" | "boolean";
  value: number | string | boolean;
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
  autoLink?: { linkType: string; sourceParam?: string };
  autoLinked?: boolean;
  linkedThoughtId?: string;
}

export interface ScannerCriterion {
  indicatorId: string;
  label: string;
  inverted: boolean;
  muted?: boolean;
  timeframeOverride?: string;
  params: ScannerCriterionParam[];
}

export interface IdeaNode {
  id: string;
  type: "thought" | "results";
  thoughtId?: number;
  thoughtName?: string;
  thoughtCategory?: string;
  thoughtDescription?: string;
  thoughtCriteria?: ScannerCriterion[];
  thoughtTimeframe?: string;
  isNot?: boolean;
  isMuted?: boolean;
  userRenamed?: boolean;
  position: { x: number; y: number };
  passCount?: number;
}

export interface IdeaEdge {
  id: string;
  source: string;
  target: string;
  logicType: "AND" | "OR";
  linkTolerance?: number;
  linkToleranceType?: "bars" | "percent";
}

export const insertScannerThoughtSchema = createInsertSchema(scannerThoughts).omit({ id: true, score: true, lastUsedAt: true, createdAt: true, updatedAt: true });
export const insertScannerIdeaSchema = createInsertSchema(scannerIdeas).omit({ id: true, createdAt: true, updatedAt: true });
export const insertScannerFavoriteSchema = createInsertSchema(scannerFavorites).omit({ id: true, addedAt: true });

export type ScannerThought = typeof scannerThoughts.$inferSelect;
export type ScannerIdea = typeof scannerIdeas.$inferSelect;
export type ScannerFavorite = typeof scannerFavorites.$inferSelect;
export type InsertScannerThought = z.infer<typeof insertScannerThoughtSchema>;
export type InsertScannerIdea = z.infer<typeof insertScannerIdeaSchema>;
export type InsertScannerFavorite = z.infer<typeof insertScannerFavoriteSchema>;

// === SCAN SESSIONS, TUNING & RATINGS ===

export const scanSessions = pgTable("scan_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  ideaId: integer("idea_id"),
  scanConfig: jsonb("scan_config").notNull(),
  resultCount: integer("result_count").notNull(),
  resultSymbols: text("result_symbols").array(),
  funnelData: jsonb("funnel_data"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const scanTuningHistory = pgTable("scan_tuning_history", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  ideaId: integer("idea_id"),
  sessionId: integer("session_id"),
  scanConfig: jsonb("scan_config").notNull(),
  configBefore: jsonb("config_before"),
  funnelData: jsonb("funnel_data").notNull(),
  aiSuggestions: jsonb("ai_suggestions").notNull(),
  acceptedSuggestions: jsonb("accepted_suggestions"),
  skippedSuggestions: jsonb("skipped_suggestions"),
  configAfter: jsonb("config_after"),
  resultCountBefore: integer("result_count_before").notNull(),
  resultCountAfter: integer("result_count_after"),
  retainedUpSymbols: text("retained_up_symbols").array(),
  droppedUpSymbols: text("dropped_up_symbols").array(),
  droppedDownSymbols: text("dropped_down_symbols").array(),
  retainedDownSymbols: text("retained_down_symbols").array(),
  newSymbols: text("new_symbols").array(),
  thoughtsInvolved: text("thoughts_involved").array(),
  outcome: text("outcome"),
  ratingsCount: integer("ratings_count"),
  adminApproved: boolean("admin_approved"),
  userFeedback: text("user_feedback"),
  userFeedbackNote: text("user_feedback_note"),
  marketRegime: jsonb("market_regime"),
  universe: text("universe"),
  archetypeTags: text("archetype_tags").array(),
  tuningDirections: jsonb("tuning_directions"),
  acceptanceRatio: doublePrecision("acceptance_ratio"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const scanChartRatings = pgTable("scan_chart_ratings", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  ideaId: integer("idea_id"),
  sessionId: integer("session_id"),
  symbol: text("symbol").notNull(),
  rating: text("rating").notNull(), // "up" | "down"
  scanConfig: jsonb("scan_config"),
  indicatorSnapshot: jsonb("indicator_snapshot"),
  price: doublePrecision("price"),
  
  // AI Training System fields (Phase 1)
  ratingType: text("rating_type").default("user"), // "user" | "admin" - who made the rating
  sourceSetupId: integer("source_setup_id"),       // FK to bigidea_setups if validating a setup
  trainingMode: boolean("training_mode").default(false), // True if in AI Training Mode
  applyFlag: boolean("apply_flag").default(true),  // Whether to use this rating for learning
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const indicatorLearningSummary = pgTable("indicator_learning_summary", {
  indicatorId: text("indicator_id").primaryKey(),
  indicatorName: text("indicator_name").notNull(),
  totalAccepted: integer("total_accepted").notNull().default(0),
  totalDiscarded: integer("total_discarded").notNull().default(0),
  paramStats: jsonb("param_stats"),
  avgRetentionRate: doublePrecision("avg_retention_rate"),
  avgResultDelta: doublePrecision("avg_result_delta"),
  regimePerformance: jsonb("regime_performance"),
  universePerformance: jsonb("universe_performance"),
  archetypePerformance: jsonb("archetype_performance"),
  avoidParams: jsonb("avoid_params"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Execution statistics for query optimization - tracks actual performance of each indicator
export const indicatorExecutionStats = pgTable("indicator_execution_stats", {
  id: serial("id").primaryKey(),
  indicatorId: text("indicator_id").notNull().unique(),
  indicatorName: text("indicator_name").notNull(),
  category: text("category").notNull(), // "Momentum", "Fundamental", etc.
  avgExecutionTimeMs: doublePrecision("avg_execution_time_ms").notNull().default(10),
  avgPassRate: doublePrecision("avg_pass_rate").notNull().default(0.5),
  totalEvaluations: integer("total_evaluations").notNull().default(0),
  totalPasses: integer("total_passes").notNull().default(0),
  // Performance breakdown by universe
  universeStats: jsonb("universe_stats"), // { "sp500": { passRate: 0.15, avgTimeMs: 5.2 }, ... }
  // Performance breakdown by market regime
  regimeStats: jsonb("regime_stats"), // { "bull": { passRate: 0.18 }, "choppy": { passRate: 0.12 }, ... }
  // Performance breakdown by timeframe
  timeframeStats: jsonb("timeframe_stats"), // { "daily": { passRate: 0.2, avgTimeMs: 15 }, "5min": { ... } }
  // Composite selectivity score (0-1, higher = more restrictive = run earlier)
  selectivityScore: doublePrecision("selectivity_score").notNull().default(0.5),
  // Last 10 execution times for variance tracking
  recentExecutionTimes: jsonb("recent_execution_times"), // [5.2, 4.8, 5.5, ...]
  lastUpdated: timestamp("last_updated").defaultNow().notNull(),
});

// Optimizer display settings - controls what metrics are shown on Big Idea Scanner canvas
export const optimizerDisplaySettings = pgTable("optimizer_display_settings", {
  id: serial("id").primaryKey(),
  // Global settings (apply to all users)
  showOptimizerOverlay: boolean("show_optimizer_overlay").notNull().default(true),
  showOverallImprovement: boolean("show_overall_improvement").notNull().default(true),
  showWeeklyImprovement: boolean("show_weekly_improvement").notNull().default(true),
  showConfidenceLevel: boolean("show_confidence_level").notNull().default(true),
  showScanStats: boolean("show_scan_stats").notNull().default(true),
  showLiveOptimization: boolean("show_live_optimization").notNull().default(true),
  showAchievementBadges: boolean("show_achievement_badges").notNull().default(false),
  // Admin override settings
  adminOverrideEnabled: boolean("admin_override_enabled").notNull().default(false),
  adminShowOverallImprovement: boolean("admin_show_overall_improvement").notNull().default(true),
  adminShowWeeklyImprovement: boolean("admin_show_weekly_improvement").notNull().default(true),
  adminShowConfidenceLevel: boolean("admin_show_confidence_level").notNull().default(true),
  adminShowScanStats: boolean("admin_show_scan_stats").notNull().default(true),
  adminShowLiveOptimization: boolean("admin_show_live_optimization").notNull().default(true),
  adminShowAchievementBadges: boolean("admin_show_achievement_badges").notNull().default(true),
  adminShowDebugInfo: boolean("admin_show_debug_info").notNull().default(true),
  // Display preferences
  overlayPosition: text("overlay_position").notNull().default("bottom-center"), // bottom-center, bottom-right, bottom-left, top-right, top-left
  overlayStyle: text("overlay_style").notNull().default("compact"), // minimal, compact, detailed
  overlayTheme: text("overlay_theme").notNull().default("cyberpunk"), // matrix, cyberpunk, minimal
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type OptimizerDisplaySettings = typeof optimizerDisplaySettings.$inferSelect;

// === ASK IVY (Overlay) RULE SETTINGS ===
// Global (admin-managed) configuration for the Ask Ivy chart overlay suggestion engine.
export interface AskIvyOverlaySettings {
  // Entries
  enableMinerviniCheatEntries: boolean;
  enableEma620Entry: boolean;
  ema620AllowedTimeframe: "5min_only" | "all_intraday";
  entryBufferPct: number; // e.g. 0.002 = +0.2%

  // Qulmaggie Entry Rules
  enableOrhEntry: boolean; // Opening Range High entry
  orhTimeframe: "5min" | "60min" | "both"; // Which ORH to show
  enableMaSurfEntry: boolean; // Entry when price surfing rising 10/20 MA
  maSurfMaxDistancePct: number; // Max % from MA to be "surfing" (e.g. 2%)

  // Stops
  include21EmaStop: boolean;
  include50SmaStop: boolean;
  includeAtrStop: boolean;
  atrStopMultiple: number; // e.g. 1.5
  stopMaOffsetDollars: number; // e.g. 0.10
  stop21Label: string; // UI label (keep accurate)

  // Qulmaggie Stop Rules
  enforceAtrStopCap: boolean; // Warn if stop > 1× ATR
  enforceAdrStopCap: boolean; // Warn if stop > 1× ADR%

  // Targets / Take Profit
  alwaysInclude8RTarget: boolean;
  includeSwingHighTargets: boolean;
  swingHighTargetCount: number; // nearest N
  include52wTarget: boolean;
  includeWeeklyTarget: boolean;
  include5DayTarget: boolean;
  include8xAdrTarget: boolean;
  adr8TargetBreakoutOnly: boolean;
  warnIfNoChartTargets: boolean;

  // Target Display / Filtering
  minRrThreshold: number; // Min R:R to display (e.g. 2 = only show 2:1+)
  targetDisplayLimit: number; // Max targets to show in UI (default 8)
  prioritizeChartTargets: boolean; // Chart-based targets before pure math
  include8xAdrOver50Target: boolean; // 8x ADR above 50 SMA profit-taking rule

  // Risk Warnings
  warn200DsmaBelow: boolean; // Warn on longs below 200 DSMA

  // Qulmaggie Position Management
  suggestPartialProfits: boolean; // Remind to take 1/3-1/2 after N days
  partialProfitDays: number; // Days before suggesting partial (default 3-5)
  includeTrailMaCloseStop: boolean; // Trail on MA close (not intraday breach)
  trailMaClosePeriod: number; // 10 or 20 day MA for trailing

  // Extension / risk
  extendedThresholdAdr: number; // e.g. 5
  profitTakingThresholdAdr: number; // e.g. 8
  showExtendedWarning: boolean;

  // Display / UX
  chartPriceScaleSide: "left" | "right";
  overlayResizable: boolean;
}

export const askIvySettings = pgTable("ask_ivy_settings", {
  id: serial("id").primaryKey(),
  settings: jsonb("settings").$type<AskIvyOverlaySettings>().notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type AskIvySettings = typeof askIvySettings.$inferSelect;

export const thoughtScoreRules = pgTable("thought_score_rules", {
  id: serial("id").primaryKey(),
  ruleKey: text("rule_key").notNull().unique(),
  label: text("label").notNull(),
  description: text("description"),
  scoreValue: integer("score_value").notNull(),
  enabled: boolean("enabled").notNull().default(true),
});

export const thoughtSelectionWeights = pgTable("thought_selection_weights", {
  id: serial("id").primaryKey(),
  strategyKey: text("strategy_key").notNull().unique(),
  label: text("label").notNull(),
  description: text("description"),
  weightPercent: integer("weight_percent").notNull(),
  configN: integer("config_n"),
  enabled: boolean("enabled").notNull().default(true),
});

export type ScanSession = typeof scanSessions.$inferSelect;
export type ScanTuningHistory = typeof scanTuningHistory.$inferSelect;
export type ScanChartRating = typeof scanChartRatings.$inferSelect;
export type IndicatorLearningSummary = typeof indicatorLearningSummary.$inferSelect;
export type ThoughtScoreRule = typeof thoughtScoreRules.$inferSelect;
export type ThoughtSelectionWeight = typeof thoughtSelectionWeights.$inferSelect;

export const chartDrawings = pgTable("chart_drawings", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  ticker: text("ticker").notNull(),
  timeframe: text("timeframe").notNull(),
  toolType: text("tool_type").notNull(),
  points: jsonb("points").notNull(),
  styling: jsonb("styling"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertChartDrawingSchema = createInsertSchema(chartDrawings).omit({ id: true, createdAt: true, updatedAt: true });
export type ChartDrawing = typeof chartDrawings.$inferSelect;
export type InsertChartDrawing = z.infer<typeof insertChartDrawingSchema>;

// === IVY STOCK EVAL TABLES ===

// Admin-configurable limits for Ivy Stock Eval feature per tier
export const ivyEvalSettings = pgTable("ivy_eval_settings", {
  id: serial("id").primaryKey(),
  tierFreeLimit: integer("tier_free_limit").default(5), // evals per month for free users
  tierFreeTrialDays: integer("tier_free_trial_days").default(7), // trial period for new users
  tierPremiumLimit: integer("tier_premium_limit").default(30), // evals per month for premium
  tierProLimit: integer("tier_pro_limit").default(100), // evals per month for pro
  tierProCanBuyMore: boolean("tier_pro_can_buy_more").default(true), // can pro users buy extra evals
  extraEvalPrice: doublePrecision("extra_eval_price").default(0.50), // $ per extra eval
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Per-user monthly usage tracking for Ivy Stock Eval
export const ivyEvalUsage = pgTable("ivy_eval_usage", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  monthYear: text("month_year").notNull(), // "2026-02" format for easy querying
  evalsUsed: integer("evals_used").default(0),
  extraEvalsPurchased: integer("extra_evals_purchased").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// History of all Ivy Stock Evals for ratings, post-mortem analysis, and AI improvement
export const ivyEvalHistory = pgTable("ivy_eval_history", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  symbol: text("symbol").notNull(),
  direction: text("direction").notNull(), // "long" | "short"
  currentPriceAtEval: doublePrecision("current_price_at_eval"), // Price when eval was generated
  // User's selections at time of eval
  selectedEntry: doublePrecision("selected_entry"),
  selectedStop: doublePrecision("selected_stop"),
  selectedTarget: doublePrecision("selected_target"),
  // Ivy's AI recommendations
  recommendedEntry: doublePrecision("recommended_entry"),
  recommendedStop: doublePrecision("recommended_stop"),
  recommendedTarget: doublePrecision("recommended_target"),
  // AI evaluation content
  evaluationText: text("evaluation_text").notNull(),
  riskAssessment: text("risk_assessment"), // "low" | "medium" | "high"
  // User feedback for AI improvement
  userRating: text("user_rating"), // "up" | "down" | null
  ratedAt: timestamp("rated_at"),
  // Technical snapshot for post-mortem agentic analysis
  technicalSnapshot: jsonb("technical_snapshot"), // { sma21, sma50, atr14, etc. }
  // Linking to watchlist if user saved it
  watchlistId: integer("watchlist_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Types for Ivy Stock Eval
export type IvyEvalSettings = typeof ivyEvalSettings.$inferSelect;
export type IvyEvalUsage = typeof ivyEvalUsage.$inferSelect;
export type IvyEvalHistory = typeof ivyEvalHistory.$inferSelect;

export const insertIvyEvalHistorySchema = createInsertSchema(ivyEvalHistory).omit({ id: true, createdAt: true });
export type InsertIvyEvalHistory = z.infer<typeof insertIvyEvalHistorySchema>;

// =============================================================================
// BigIdea AI Training System - Setup Library
// =============================================================================

// Main setup library table - stores trading setup definitions (Qullamaggie Breakout, VCP, etc.)
export const bigideaSetups = pgTable("bigidea_setups", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),                    // "Qullamaggie Breakout"
  slug: text("slug").notNull().unique(),           // "qullamaggie-breakout"
  version: integer("version").notNull().default(1),
  status: text("status").notNull().default("draft"), // "draft" | "active" | "archived"
  
  // Content
  description: text("description"),                 // Methodology description (free-form)
  exampleCharts: jsonb("example_charts"),          // Array of { url, ticker, caption }
  
  // AI-Extracted rules (generated from description, admin-editable)
  extractedRules: jsonb("extracted_rules"),        // { priorMove: "30-100%", baseDuration: "3-8 weeks", ... }
  
  // Ivy AI Integration - Trade plan guidance for this setup type
  ivyEntryStrategy: text("ivy_entry_strategy"),    // "breakout" | "rally_reclaim" | "ma_touch" | "pullback_bounce"
  ivyStopStrategy: text("ivy_stop_strategy"),      // "below_base" | "below_undercut" | "below_ma" | "atr_based"
  ivyTargetStrategy: text("ivy_target_strategy"),  // "swing_high" | "measured_move" | "rr_based" | "extension"
  ivyContextNotes: text("ivy_context_notes"),      // Free-form guidance e.g. "Wait for PB under 21 EMA for U&R entry"
  ivyApproved: boolean("ivy_approved").default(false), // Only approved setups feed Ivy suggestions
  
  // Metadata
  createdBy: integer("created_by"),                // Admin user ID
  previousVersionId: integer("previous_version_id"), // Link to prior version for rollback
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Indicator mappings for setups - defines which indicators + params to use
export const bigideaSetupIndicators = pgTable("bigidea_setup_indicators", {
  id: serial("id").primaryKey(),
  setupId: integer("setup_id").notNull(),          // FK to bigidea_setups
  indicatorId: text("indicator_id").notNull(),     // "PA-12", "FU-01", etc.
  params: jsonb("params"),                         // { minGain: 30, lookbackBars: 60, ... }
  required: boolean("required").notNull().default(true), // Must be included in scan
  weight: doublePrecision("weight").default(1.0),  // Importance 0-1
  notes: text("notes"),                            // Why this indicator for this setup
  createdAt: timestamp("created_at").defaultNow(),
});

// Types for Setup Library
export type BigideaSetup = typeof bigideaSetups.$inferSelect;
export type InsertBigideaSetup = typeof bigideaSetups.$inferInsert;
export type BigideaSetupIndicator = typeof bigideaSetupIndicators.$inferSelect;
export type InsertBigideaSetupIndicator = typeof bigideaSetupIndicators.$inferInsert;

export const insertBigideaSetupSchema = createInsertSchema(bigideaSetups).omit({ id: true, createdAt: true, updatedAt: true });
export const insertBigideaSetupIndicatorSchema = createInsertSchema(bigideaSetupIndicators).omit({ id: true, createdAt: true });

// Ivy Strategy Types - for Trade Plan integration
export const IVY_ENTRY_STRATEGIES = [
  { value: "breakout", label: "Breakout", description: "Entry above resistance/base top" },
  { value: "rally_reclaim", label: "Rally Reclaim (U&R)", description: "Entry on rally back above MA after undercut" },
  { value: "ma_touch", label: "MA Touch", description: "Entry at pullback to moving average" },
  { value: "pullback_bounce", label: "Pullback Bounce", description: "Entry on bounce from support level" },
  { value: "gap_fill", label: "Gap Fill", description: "Entry after gap fills to support" },
] as const;

export const IVY_STOP_STRATEGIES = [
  { value: "below_base", label: "Below Base", description: "Stop below base/consolidation low" },
  { value: "below_undercut", label: "Below Undercut", description: "Stop below the undercut low (U&R)" },
  { value: "below_ma", label: "Below MA", description: "Stop below key moving average" },
  { value: "atr_based", label: "ATR Based", description: "Stop at 1-2x ATR from entry" },
  { value: "prior_day_low", label: "Prior Day Low", description: "Stop below previous day's low" },
] as const;

export const IVY_TARGET_STRATEGIES = [
  { value: "swing_high", label: "Swing High", description: "Target at prior resistance/swing highs" },
  { value: "measured_move", label: "Measured Move", description: "Target = base height projected from breakout" },
  { value: "rr_based", label: "R:R Based", description: "Target at 2:1, 3:1 risk/reward multiples" },
  { value: "extension", label: "Extension", description: "Target at Fibonacci or ADR extension levels" },
  { value: "trailing", label: "Trailing Stop", description: "No fixed target, trail with MA close" },
] as const;

export type IvyEntryStrategy = typeof IVY_ENTRY_STRATEGIES[number]["value"];
export type IvyStopStrategy = typeof IVY_STOP_STRATEGIES[number]["value"];
export type IvyTargetStrategy = typeof IVY_TARGET_STRATEGIES[number]["value"];

// =============================================================================
// BigIdea AI Training System - Extracted Ideas (Phase 2)
// =============================================================================

// Thought definition for extracted Ideas
export interface ExtractedThought {
  id: string;                                        // UUID
  name: string;                                      // "EMA Reclaim"
  description?: string;
  indicators: Array<{
    id: string;                                      // Indicator ID from library
    name: string;                                    // Display name
    params: Record<string, any>;                     // Configured parameters
  }>;
}

// Full Idea structure extracted from documents
export interface ExtractedIdeaData {
  name: string;                                      // "Wedge Pop"
  description: string;                               // Pattern description
  thoughts: ExtractedThought[];                      // 1+ thoughts (AND within, OR between)
  sourceDocument?: string;                           // Which document it came from
  confidence: number;                                // AI confidence 0-100
}

// Stores AI-extracted Ideas from setup documents
export const bigideaExtractedIdeas = pgTable("bigidea_extracted_ideas", {
  id: serial("id").primaryKey(),
  setupId: integer("setup_id").notNull(),            // FK to bigidea_setups
  
  // Idea definition
  name: text("name").notNull(),                      // "Wedge Pop"
  description: text("description"),                  // Pattern description
  thoughts: jsonb("thoughts").$type<ExtractedThought[]>().notNull(), // Array of thoughts
  
  // AI extraction metadata
  confidence: doublePrecision("confidence"),         // AI confidence score 0-100
  sourceDocumentId: integer("source_document_id"),   // FK to uploads
  aiModel: text("ai_model"),                         // Which model extracted this
  aiPromptVersion: text("ai_prompt_version"),        // Prompt version for reproducibility
  
  // Workflow status
  status: text("status").notNull().default("draft"), // "draft" | "validating" | "approved" | "pushed" | "rejected"
  
  // Validation tracking (Training Mode)
  validationSessionId: integer("validation_session_id"), // Links to scan session if validating
  validationStats: jsonb("validation_stats").$type<{
    totalRated: number;
    thumbsUp: number;
    thumbsDown: number;
    hitRate: number;
  }>(),
  
  // Push to scanner tracking
  pushedToIdeaId: integer("pushed_to_idea_id"),      // FK to scanner_ideas if pushed
  pushedAt: timestamp("pushed_at"),
  pushedBy: integer("pushed_by"),                    // User who pushed
  
  // Timestamps
  createdAt: timestamp("created_at").defaultNow(),
  approvedAt: timestamp("approved_at"),
  approvedBy: integer("approved_by"),
});

// Training Mode ratings for extracted Ideas
export const bigideaValidationRatings = pgTable("bigidea_validation_ratings", {
  id: serial("id").primaryKey(),
  extractedIdeaId: integer("extracted_idea_id").notNull(), // FK to bigidea_extracted_ideas
  userId: integer("user_id").notNull(),
  symbol: text("symbol").notNull(),
  rating: text("rating").notNull(),                  // "up" | "down"
  price: doublePrecision("price"),
  indicatorSnapshot: jsonb("indicator_snapshot"),    // What values the indicators had
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Types for Extracted Ideas
export type BigideaExtractedIdea = typeof bigideaExtractedIdeas.$inferSelect;
export type InsertBigideaExtractedIdea = typeof bigideaExtractedIdeas.$inferInsert;
export type BigideaValidationRating = typeof bigideaValidationRatings.$inferSelect;
export type InsertBigideaValidationRating = typeof bigideaValidationRatings.$inferInsert;

export const insertBigideaExtractedIdeaSchema = createInsertSchema(bigideaExtractedIdeas).omit({ id: true, createdAt: true });
export const insertBigideaValidationRatingSchema = createInsertSchema(bigideaValidationRatings).omit({ id: true, createdAt: true });

// =============================================================================
// Custom Indicators System - User-created indicators with DSL logic
// =============================================================================

// User-created custom indicators
export const userIndicators = pgTable("user_indicators", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  
  // Identifier
  customId: text("custom_id").notNull().unique(),
  
  // Definition
  name: text("name").notNull(),
  category: text("category").notNull(),
  description: text("description").notNull(),
  
  // Parameters (JSON array of parameter definitions)
  params: jsonb("params").$type<Array<{
    name: string;
    label: string;
    type: "number" | "select" | "boolean";
    defaultValue: number | string | boolean;
    options?: string[];
    min?: number;
    max?: number;
    step?: number;
  }>>().notNull().default([]),
  
  // Evaluation logic (DSL-based)
  logicType: text("logic_type").notNull().default("rule_based"),
  logicDefinition: jsonb("logic_definition").$type<{
    rules: Array<{
      condition: string;
      operator: string;
      threshold?: number | string;
      lookback?: number;
    }>;
    combineLogic: "AND" | "OR";
  }>().notNull(),
  
  // Data linking (for chaining indicators)
  provides: jsonb("provides").$type<Array<{
    linkType: string;
    paramName: string;
  }>>().default([]),
  consumes: jsonb("consumes").$type<Array<{
    paramName: string;
    dataKey: string;
  }>>().default([]),
  
  // Approval workflow
  isAdminApproved: boolean("is_admin_approved").default(false),
  approvedByAdminId: integer("approved_by_admin_id"),
  approvedAt: timestamp("approved_at"),
  promotedToCoreId: text("promoted_to_core_id"),
  
  // Usage tracking
  timesUsed: integer("times_used").default(0),
  lastUsedAt: timestamp("last_used_at"),
  totalPasses: integer("total_passes").default(0),
  totalEvaluations: integer("total_evaluations").default(0),
  avgPassRate: doublePrecision("avg_pass_rate"),
  
  // Auto-submit tracking
  autoSubmittedAt: timestamp("auto_submitted_at"),
  
  // Metadata
  aiGenerated: boolean("ai_generated").default(true),
  aiModel: text("ai_model"),
  aiPrompt: text("ai_prompt"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Approval queue for custom indicators
export const indicatorApprovalQueue = pgTable("indicator_approval_queue", {
  id: serial("id").primaryKey(),
  indicatorId: integer("indicator_id").notNull(),
  submittedAt: timestamp("submitted_at").defaultNow(),
  reviewNotes: text("review_notes"),
  reviewedAt: timestamp("reviewed_at"),
  reviewedBy: integer("reviewed_by"),
  decision: text("decision"), // 'approved' | 'rejected' | 'needs_revision'
  rejectionReason: text("rejection_reason"),
});

export type UserIndicator = typeof userIndicators.$inferSelect;
export type InsertUserIndicator = typeof userIndicators.$inferInsert;
export type IndicatorApprovalQueue = typeof indicatorApprovalQueue.$inferSelect;
export type InsertIndicatorApprovalQueue = typeof indicatorApprovalQueue.$inferInsert;

export const insertUserIndicatorSchema = createInsertSchema(userIndicators).omit({ id: true, createdAt: true, updatedAt: true });
export const insertIndicatorApprovalQueueSchema = createInsertSchema(indicatorApprovalQueue).omit({ id: true, submittedAt: true });

// =============================================================================
// Modular Upload System - Reusable file storage for PDFs, images, documents
// =============================================================================

export const uploads = pgTable("uploads", {
  id: serial("id").primaryKey(),
  filename: text("filename").notNull(),           // Original filename
  storagePath: text("storage_path").notNull(),    // Path in uploads folder or S3 key
  mimeType: text("mime_type").notNull(),          // "application/pdf", "image/png", etc.
  sizeBytes: integer("size_bytes").notNull(),
  
  // Extracted content (for AI processing)
  extractedText: text("extracted_text"),          // OCR/PDF text extraction
  extractedImages: jsonb("extracted_images"),     // Array of { path, pageNum, caption }
  
  // Processing status
  processingStatus: text("processing_status").default("pending"), // "pending" | "processing" | "completed" | "failed"
  processingError: text("processing_error"),      // Error message if failed
  
  // Metadata
  metadata: jsonb("metadata"),                    // { pageCount, dimensions, etc. }
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Junction table: link uploads to setups (many-to-many)
export const setupUploads = pgTable("setup_uploads", {
  id: serial("id").primaryKey(),
  setupId: integer("setup_id").notNull(),         // FK to bigidea_setups
  uploadId: integer("upload_id").notNull(),       // FK to uploads
  purpose: text("purpose"),                       // "methodology", "example_chart", "reference"
  createdAt: timestamp("created_at").defaultNow(),
});

// Types for Upload System
export type Upload = typeof uploads.$inferSelect;
export type InsertUpload = typeof uploads.$inferInsert;
export type SetupUpload = typeof setupUploads.$inferSelect;
export type InsertSetupUpload = typeof setupUploads.$inferInsert;

export const insertUploadSchema = createInsertSchema(uploads).omit({ id: true, createdAt: true });
export const insertSetupUploadSchema = createInsertSchema(setupUploads).omit({ id: true, createdAt: true });

// =============================================================================
// Theme Rotation Snapshots - Historical data for multi-timeframe comparison
// =============================================================================

export const themeSnapshots = pgTable("theme_snapshots", {
  id: serial("id").primaryKey(),
  themeId: text("theme_id").notNull(),            // ClusterId e.g. "SEMIS", "AI_INFRA"
  
  // Core metrics at snapshot time
  rank: integer("rank").notNull(),                 // 1-25 rank at this time
  score: doublePrecision("score").notNull(),       // ThemeScore 0-100
  medianPct: doublePrecision("median_pct"),        // Median % change
  rsVsBenchmark: doublePrecision("rs_vs_benchmark"), // RS vs SPY
  breadthPct: doublePrecision("breadth_pct"),      // % of members green
  
  // Accumulation/Distribution tracking (William O'Neal style)
  accDistDays: integer("acc_dist_days"),           // Consecutive days: positive=accumulation, negative=distribution
  
  // Snapshot metadata
  snapshotType: text("snapshot_type").notNull(),   // "hourly" | "daily_close"
  marketDate: text("market_date").notNull(),       // YYYY-MM-DD
  snapshotHour: integer("snapshot_hour"),          // 0-23 for hourly snapshots
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Types for Theme Snapshots
export type ThemeSnapshot = typeof themeSnapshots.$inferSelect;
export type InsertThemeSnapshot = typeof themeSnapshots.$inferInsert;

export const insertThemeSnapshotSchema = createInsertSchema(themeSnapshots).omit({ id: true, createdAt: true });

// =============================================================================
// Data Layer - Historical Bars & Moving Averages Cache
// =============================================================================

// Historical daily bars cache - stores 250 days of OHLCV for all universe tickers
export const historicalBars = pgTable("historical_bars", {
  id: serial("id").primaryKey(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  barDate: date("bar_date").notNull(),
  open: decimal("open", { precision: 12, scale: 4 }).notNull(),
  high: decimal("high", { precision: 12, scale: 4 }).notNull(),
  low: decimal("low", { precision: 12, scale: 4 }).notNull(),
  close: decimal("close", { precision: 12, scale: 4 }).notNull(),
  volume: bigint("volume", { mode: "number" }).notNull(),
  vwap: decimal("vwap", { precision: 12, scale: 4 }),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  symbolDateUnique: unique().on(table.symbol, table.barDate),
}));

// Pre-calculated moving averages per ticker - updated nightly
export const tickerMa = pgTable("ticker_ma", {
  id: serial("id").primaryKey(),
  symbol: varchar("symbol", { length: 20 }).notNull().unique(),
  ema10d: decimal("ema_10d", { precision: 12, scale: 4 }),
  ema20d: decimal("ema_20d", { precision: 12, scale: 4 }),
  sma50d: decimal("sma_50d", { precision: 12, scale: 4 }),
  sma200d: decimal("sma_200d", { precision: 12, scale: 4 }),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Types for Data Layer
export type HistoricalBar = typeof historicalBars.$inferSelect;
export type InsertHistoricalBar = typeof historicalBars.$inferInsert;
export type TickerMa = typeof tickerMa.$inferSelect;
export type InsertTickerMa = typeof tickerMa.$inferInsert;

export const insertHistoricalBarSchema = createInsertSchema(historicalBars).omit({ id: true, createdAt: true });
export const insertTickerMaSchema = createInsertSchema(tickerMa).omit({ id: true, updatedAt: true });

// =============================================================================
// MarketFlow AI Analysis Cache - Full analysis payload for 3-day reuse
// =============================================================================

export const marketflowAnalysisCache = pgTable("marketflow_analysis_cache", {
  id: serial("id").primaryKey(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  analysisJson: jsonb("analysis_json").notNull(),   // { moduleResponses, synthesis, ... }
  generatedAt: timestamp("generated_at").defaultNow().notNull(),
  version: text("version").notNull().default("v1"),
  modulesPresent: jsonb("modules_present").$type<string[]>().notNull(), // ["marketContext", "keyLevels", ...]
  ttlDays: integer("ttl_days").notNull().default(3),
  createdBy: integer("created_by"),                // nullable user id when auth is present
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  symbolUnique: unique().on(table.symbol),
}));

export type MarketflowAnalysisCache = typeof marketflowAnalysisCache.$inferSelect;
export type InsertMarketflowAnalysisCache = typeof marketflowAnalysisCache.$inferInsert;
export const insertMarketflowAnalysisCacheSchema = createInsertSchema(marketflowAnalysisCache).omit({ id: true, createdAt: true, generatedAt: true });
