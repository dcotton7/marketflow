import { db } from "../db";
import { 
  sentinelUsers, sentinelTrades, sentinelEvaluations, sentinelEvents, sentinelWatchlist, sentinelRules,
  sentinelRuleSuggestions, sentinelRulePerformance, sentinelTradeToLabels, sentinelRuleOverrides, sentinelSystemSettings,
  ivyEvalSettings, ivyEvalUsage, ivyEvalHistory,
  askIvySettings,
  watchlists,
  type SentinelUser, type SentinelTrade, type SentinelEvaluation, type SentinelEvent, type SentinelWatchlistItem, type SentinelRule,
  type SentinelRuleSuggestion, type SentinelRulePerformance, type SentinelRuleOverride, type SentinelSystemSettings,
  type IvyEvalSettings, type IvyEvalUsage, type IvyEvalHistory, type InsertIvyEvalHistory,
  type AskIvyOverlaySettings,
  type Watchlist, type InsertWatchlist,
  type InsertSentinelUser, type InsertSentinelTrade, type InsertSentinelEvaluation, type InsertSentinelEvent, type InsertSentinelWatchlistItem, type InsertSentinelRule, type InsertSentinelRuleOverride, type InsertSentinelSystemSettings
} from "@shared/schema";
import { eq, desc, and, asc, or, isNull } from "drizzle-orm";
import { STARTER_RULES } from "./starterRules";

const DEFAULT_ASK_IVY_SETTINGS: AskIvyOverlaySettings = {
  enableMinerviniCheatEntries: true,
  enableEma620Entry: true,
  ema620AllowedTimeframe: "5min_only",
  entryBufferPct: 0.002,

  // Qulmaggie Entry Rules
  enableOrhEntry: true,
  orhTimeframe: "both",
  enableMaSurfEntry: true,
  maSurfMaxDistancePct: 2,

  include21EmaStop: true,
  include50SmaStop: true,
  includeAtrStop: true,
  atrStopMultiple: 1.5,
  stopMaOffsetDollars: 0.1,
  stop21Label: "21 EMA",

  // Qulmaggie Stop Rules
  enforceAtrStopCap: true,
  enforceAdrStopCap: true,

  alwaysInclude8RTarget: true,
  includeSwingHighTargets: true,
  swingHighTargetCount: 8,
  include52wTarget: true,
  includeWeeklyTarget: true,
  include5DayTarget: true,
  include8xAdrTarget: true,
  adr8TargetBreakoutOnly: true,
  warnIfNoChartTargets: true,

  // Target Display / Filtering
  minRrThreshold: 2, // Only show 2:1+ R:R targets
  targetDisplayLimit: 8, // Show up to 8 targets
  prioritizeChartTargets: true, // Chart-based first
  include8xAdrOver50Target: true, // 8x ADR above 50 SMA

  // Risk Warnings
  warn200DsmaBelow: true, // Warn on longs below 200 DSMA

  // Qulmaggie Position Management
  suggestPartialProfits: true,
  partialProfitDays: 4, // 3-5 days, use 4 as middle
  includeTrailMaCloseStop: true,
  trailMaClosePeriod: 10, // 10-day MA trail (faster)

  extendedThresholdAdr: 5,
  profitTakingThresholdAdr: 8,
  showExtendedWarning: true,

  chartPriceScaleSide: "right",
  overlayResizable: false,
};

const ASK_IVY_SETTINGS_CACHE_TTL_MS = 60_000;
let askIvySettingsCache: { value: AskIvyOverlaySettings; fetchedAt: number } | null = null;

export const sentinelModels = {
  async createUser(data: InsertSentinelUser): Promise<SentinelUser> {
    const [user] = await db.insert(sentinelUsers).values(data).returning();
    return user;
  },

  async getUserByUsername(username: string): Promise<SentinelUser | undefined> {
    const [user] = await db.select().from(sentinelUsers).where(eq(sentinelUsers.username, username));
    return user;
  },

  async getUserByEmail(email: string): Promise<SentinelUser | undefined> {
    const [user] = await db.select().from(sentinelUsers).where(eq(sentinelUsers.email, email));
    return user;
  },

  async getUserById(id: number): Promise<SentinelUser | undefined> {
    const [user] = await db.select().from(sentinelUsers).where(eq(sentinelUsers.id, id));
    return user;
  },

  async createTrade(data: InsertSentinelTrade): Promise<SentinelTrade> {
    const [trade] = await db.insert(sentinelTrades).values(data).returning();
    return trade;
  },

  async getTrade(id: number): Promise<SentinelTrade | undefined> {
    const [trade] = await db.select().from(sentinelTrades).where(eq(sentinelTrades.id, id));
    return trade;
  },

  async getTradesByUser(userId: number): Promise<SentinelTrade[]> {
    return db.select().from(sentinelTrades)
      .where(eq(sentinelTrades.userId, userId))
      .orderBy(desc(sentinelTrades.createdAt));
  },

  async getTradesByStatus(userId: number, status: string): Promise<SentinelTrade[]> {
    return db.select().from(sentinelTrades)
      .where(and(eq(sentinelTrades.userId, userId), eq(sentinelTrades.status, status)))
      .orderBy(desc(sentinelTrades.createdAt));
  },

  async updateTrade(id: number, data: Partial<SentinelTrade>): Promise<SentinelTrade | undefined> {
    const [trade] = await db.update(sentinelTrades)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(sentinelTrades.id, id))
      .returning();
    return trade;
  },

  async deleteTrade(id: number): Promise<void> {
    await db.delete(sentinelEvaluations).where(eq(sentinelEvaluations.tradeId, id));
    await db.delete(sentinelEvents).where(eq(sentinelEvents.tradeId, id));
    await db.delete(sentinelTradeToLabels).where(eq(sentinelTradeToLabels.tradeId, id));
    await db.delete(sentinelTrades).where(eq(sentinelTrades.id, id));
  },

  async createEvaluation(data: InsertSentinelEvaluation): Promise<SentinelEvaluation> {
    const [evaluation] = await db.insert(sentinelEvaluations).values(data).returning();
    return evaluation;
  },

  async getEvaluationsByTrade(tradeId: number): Promise<SentinelEvaluation[]> {
    return db.select().from(sentinelEvaluations)
      .where(eq(sentinelEvaluations.tradeId, tradeId))
      .orderBy(desc(sentinelEvaluations.createdAt));
  },

  async getLatestEvaluation(tradeId: number): Promise<SentinelEvaluation | undefined> {
    const [evaluation] = await db.select().from(sentinelEvaluations)
      .where(eq(sentinelEvaluations.tradeId, tradeId))
      .orderBy(desc(sentinelEvaluations.createdAt))
      .limit(1);
    return evaluation;
  },

  async createEvent(data: InsertSentinelEvent): Promise<SentinelEvent> {
    const [event] = await db.insert(sentinelEvents).values(data).returning();
    return event;
  },

  async getEventsByTrade(tradeId: number): Promise<SentinelEvent[]> {
    return db.select().from(sentinelEvents)
      .where(eq(sentinelEvents.tradeId, tradeId))
      .orderBy(desc(sentinelEvents.createdAt));
  },

  async getRecentEvents(userId: number, limit: number = 20): Promise<SentinelEvent[]> {
    return db.select().from(sentinelEvents)
      .where(eq(sentinelEvents.userId, userId))
      .orderBy(desc(sentinelEvents.createdAt))
      .limit(limit);
  },

  async getActiveTrades(): Promise<SentinelTrade[]> {
    return db.select().from(sentinelTrades)
      .where(eq(sentinelTrades.status, 'active'))
      .orderBy(desc(sentinelTrades.createdAt));
  },

  // Watchlist definitions (multiple watchlists per user)
  async createWatchlist(data: InsertWatchlist): Promise<Watchlist> {
    const [wl] = await db.insert(watchlists).values(data).returning();
    return wl;
  },

  async getWatchlistsByUser(userId: number): Promise<Watchlist[]> {
    return db.select().from(watchlists)
      .where(eq(watchlists.userId, userId))
      .orderBy(desc(watchlists.isDefault), asc(watchlists.name));
  },

  async getWatchlistById(id: number): Promise<Watchlist | undefined> {
    const [wl] = await db.select().from(watchlists).where(eq(watchlists.id, id));
    return wl;
  },

  async updateWatchlist(id: number, data: Partial<Watchlist>): Promise<Watchlist | undefined> {
    const [wl] = await db.update(watchlists)
      .set(data)
      .where(eq(watchlists.id, id))
      .returning();
    return wl;
  },

  async deleteWatchlist(id: number): Promise<void> {
    await db.delete(watchlists).where(eq(watchlists.id, id));
  },

  async setDefaultWatchlist(userId: number, watchlistId: number): Promise<void> {
    // First, unset any existing default
    await db.update(watchlists)
      .set({ isDefault: false })
      .where(and(eq(watchlists.userId, userId), eq(watchlists.isDefault, true)));
    // Then set the new default
    await db.update(watchlists)
      .set({ isDefault: true })
      .where(and(eq(watchlists.id, watchlistId), eq(watchlists.userId, userId)));
  },

  async getOrCreateDefaultWatchlist(userId: number): Promise<Watchlist> {
    // Try to find existing default
    const [existing] = await db.select().from(watchlists)
      .where(and(eq(watchlists.userId, userId), eq(watchlists.isDefault, true)))
      .limit(1);
    if (existing) return existing;
    
    // Create default watchlist
    const [created] = await db.insert(watchlists)
      .values({ userId, name: 'Default', isDefault: true })
      .returning();
    return created;
  },

  // Watchlist items methods
  async createWatchlistItem(data: InsertSentinelWatchlistItem): Promise<SentinelWatchlistItem> {
    const [item] = await db.insert(sentinelWatchlist).values(data).returning();
    return item;
  },

  async getWatchlistByUser(userId: number, watchlistId?: number): Promise<SentinelWatchlistItem[]> {
    if (watchlistId) {
      return db.select().from(sentinelWatchlist)
        .where(and(
          eq(sentinelWatchlist.userId, userId),
          eq(sentinelWatchlist.watchlistId, watchlistId),
          eq(sentinelWatchlist.status, 'watching')
        ))
        .orderBy(desc(sentinelWatchlist.createdAt));
    }
    // Return all watching items if no watchlistId specified
    return db.select().from(sentinelWatchlist)
      .where(and(eq(sentinelWatchlist.userId, userId), eq(sentinelWatchlist.status, 'watching')))
      .orderBy(desc(sentinelWatchlist.createdAt));
  },

  async getWatchlistItem(id: number): Promise<SentinelWatchlistItem | undefined> {
    const [item] = await db.select().from(sentinelWatchlist).where(eq(sentinelWatchlist.id, id));
    return item;
  },

  async updateWatchlistItem(id: number, data: Partial<SentinelWatchlistItem>): Promise<SentinelWatchlistItem | undefined> {
    const [item] = await db.update(sentinelWatchlist)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(sentinelWatchlist.id, id))
      .returning();
    return item;
  },

  async deleteWatchlistItem(id: number): Promise<void> {
    await db.delete(sentinelWatchlist).where(eq(sentinelWatchlist.id, id));
  },

  async moveWatchlistItems(fromWatchlistId: number, toWatchlistId: number): Promise<void> {
    await db.update(sentinelWatchlist)
      .set({ watchlistId: toWatchlistId })
      .where(eq(sentinelWatchlist.watchlistId, fromWatchlistId));
  },

  // Rules methods
  async createRule(data: InsertSentinelRule): Promise<SentinelRule> {
    const [rule] = await db.insert(sentinelRules).values(data).returning();
    return rule;
  },

  async getRulesByUser(userId: number): Promise<SentinelRule[]> {
    return db.select().from(sentinelRules)
      .where(eq(sentinelRules.userId, userId))
      .orderBy(asc(sentinelRules.order));
  },

  async getActiveRulesByUser(userId: number): Promise<SentinelRule[]> {
    return db.select().from(sentinelRules)
      .where(and(eq(sentinelRules.userId, userId), eq(sentinelRules.isActive, true)))
      .orderBy(asc(sentinelRules.order));
  },

  async updateRule(id: number, data: Partial<SentinelRule>): Promise<SentinelRule | undefined> {
    const [rule] = await db.update(sentinelRules)
      .set(data)
      .where(eq(sentinelRules.id, id))
      .returning();
    return rule;
  },

  async deleteRule(id: number): Promise<void> {
    await db.delete(sentinelRules).where(eq(sentinelRules.id, id));
  },

  // Closed trades for analysis
  async getClosedTrades(userId: number): Promise<SentinelTrade[]> {
    return db.select().from(sentinelTrades)
      .where(and(eq(sentinelTrades.userId, userId), eq(sentinelTrades.status, 'closed')))
      .orderBy(desc(sentinelTrades.exitDate));
  },

  // Seed starter rules for a new user
  async seedStarterRulesForUser(userId: number): Promise<SentinelRule[]> {
    const rules = STARTER_RULES.map(rule => ({
      userId,
      name: rule.name,
      description: rule.description,
      category: rule.category,
      isActive: true,
      order: rule.order,
      source: 'starter' as const,
      severity: rule.severity,
      isAutoReject: rule.isAutoReject,
      ruleCode: rule.ruleCode,
      formula: rule.formula,
      ruleType: rule.ruleType,
      directionTags: rule.directionTags,
    }));

    const insertedRules = await db.insert(sentinelRules).values(rules).returning();
    return insertedRules;
  },

  // Get rules by category
  async getRulesByCategory(userId: number, category: string): Promise<SentinelRule[]> {
    return db.select().from(sentinelRules)
      .where(and(eq(sentinelRules.userId, userId), eq(sentinelRules.category, category)))
      .orderBy(asc(sentinelRules.order));
  },

  // Get auto-reject rules
  async getAutoRejectRules(userId: number): Promise<SentinelRule[]> {
    return db.select().from(sentinelRules)
      .where(and(
        eq(sentinelRules.userId, userId), 
        eq(sentinelRules.isAutoReject, true),
        eq(sentinelRules.isActive, true)
      ))
      .orderBy(asc(sentinelRules.order));
  },

  // Rule suggestions methods
  async getPendingSuggestions(): Promise<SentinelRuleSuggestion[]> {
    return db.select().from(sentinelRuleSuggestions)
      .where(eq(sentinelRuleSuggestions.status, 'pending'))
      .orderBy(desc(sentinelRuleSuggestions.confidenceScore));
  },

  async adoptSuggestion(suggestionId: number, userId: number): Promise<SentinelRule> {
    const [suggestion] = await db.select().from(sentinelRuleSuggestions)
      .where(eq(sentinelRuleSuggestions.id, suggestionId));
    
    if (!suggestion) {
      throw new Error('Suggestion not found');
    }

    // Create rule from suggestion
    const [rule] = await db.insert(sentinelRules).values({
      userId,
      name: suggestion.name,
      description: suggestion.description,
      category: suggestion.category,
      isActive: true,
      order: 100, // Add at end
      source: suggestion.source,
      severity: suggestion.severity,
      isAutoReject: suggestion.isAutoReject,
      ruleCode: suggestion.ruleCode,
      formula: suggestion.formula,
      confidenceScore: suggestion.confidenceScore,
    }).returning();

    // Increment adoption count
    await db.update(sentinelRuleSuggestions)
      .set({ adoptionCount: (suggestion.adoptionCount || 0) + 1 })
      .where(eq(sentinelRuleSuggestions.id, suggestionId));

    return rule;
  },

  // Rule performance tracking
  async updateRulePerformance(
    ruleCode: string, 
    ruleName: string, 
    category: string | null,
    followed: boolean, 
    won: boolean, 
    pnl: number
  ): Promise<void> {
    const [existing] = await db.select().from(sentinelRulePerformance)
      .where(eq(sentinelRulePerformance.ruleCode, ruleCode));

    if (existing) {
      const newFollowed = followed ? (existing.followedCount || 0) + 1 : existing.followedCount || 0;
      const newNotFollowed = !followed ? (existing.notFollowedCount || 0) + 1 : existing.notFollowedCount || 0;
      const newTotal = (existing.totalTrades || 0) + 1;

      // Update win rates (simple running average for now)
      let winRateFollowed = existing.winRateWhenFollowed;
      let winRateNotFollowed = existing.winRateWhenNotFollowed;
      let avgPnLFollowed = existing.avgPnLWhenFollowed;
      let avgPnLNotFollowed = existing.avgPnLWhenNotFollowed;

      if (followed) {
        const prevWins = (existing.winRateWhenFollowed || 0) * (existing.followedCount || 0);
        winRateFollowed = (prevWins + (won ? 1 : 0)) / newFollowed;
        const prevPnL = (existing.avgPnLWhenFollowed || 0) * (existing.followedCount || 0);
        avgPnLFollowed = (prevPnL + pnl) / newFollowed;
      } else {
        const prevWins = (existing.winRateWhenNotFollowed || 0) * (existing.notFollowedCount || 0);
        winRateNotFollowed = (prevWins + (won ? 1 : 0)) / newNotFollowed;
        const prevPnL = (existing.avgPnLWhenNotFollowed || 0) * (existing.notFollowedCount || 0);
        avgPnLNotFollowed = (prevPnL + pnl) / newNotFollowed;
      }

      await db.update(sentinelRulePerformance)
        .set({
          totalTrades: newTotal,
          followedCount: newFollowed,
          notFollowedCount: newNotFollowed,
          winRateWhenFollowed: winRateFollowed,
          winRateWhenNotFollowed: winRateNotFollowed,
          avgPnLWhenFollowed: avgPnLFollowed,
          avgPnLWhenNotFollowed: avgPnLNotFollowed,
          lastUpdated: new Date(),
        })
        .where(eq(sentinelRulePerformance.id, existing.id));
    } else {
      // Create new performance record
      await db.insert(sentinelRulePerformance).values({
        ruleCode,
        ruleName,
        category,
        totalTrades: 1,
        followedCount: followed ? 1 : 0,
        notFollowedCount: followed ? 0 : 1,
        winRateWhenFollowed: followed && won ? 1 : followed ? 0 : null,
        winRateWhenNotFollowed: !followed && won ? 1 : !followed ? 0 : null,
        avgPnLWhenFollowed: followed ? pnl : null,
        avgPnLWhenNotFollowed: !followed ? pnl : null,
      });
    }
  },

  // Get rule performance stats
  async getRulePerformanceStats(): Promise<SentinelRulePerformance[]> {
    return db.select().from(sentinelRulePerformance)
      .orderBy(desc(sentinelRulePerformance.totalTrades));
  },

  // Create a new rule suggestion
  async createRuleSuggestion(data: {
    name: string;
    description: string | null;
    category: string | null;
    source: string;
    severity: string | null;
    isAutoReject: boolean;
    ruleCode: string | null;
    formula: string | null;
    confidenceScore: number;
    supportingData: {
      totalTrades?: number;
      winRate?: number;
      avgPnL?: number;
      sampleSize?: number;
      patternDescription?: string;
    } | null;
  }): Promise<SentinelRuleSuggestion> {
    const [suggestion] = await db.insert(sentinelRuleSuggestions).values({
      ...data,
      status: 'pending',
      adoptionCount: 0,
    }).returning();
    return suggestion;
  },

  // Get suggestion by rule code (to avoid duplicates)
  async getSuggestionByRuleCode(ruleCode: string): Promise<SentinelRuleSuggestion | undefined> {
    const [suggestion] = await db.select().from(sentinelRuleSuggestions)
      .where(eq(sentinelRuleSuggestions.ruleCode, ruleCode));
    return suggestion;
  },

  // Update suggestion status
  async updateSuggestionStatus(id: number, status: string): Promise<void> {
    await db.update(sentinelRuleSuggestions)
      .set({ status })
      .where(eq(sentinelRuleSuggestions.id, id));
  },

  // Get high-performing rules for AI analysis (rules with enough data)
  async getHighDataRules(minTrades: number = 10): Promise<SentinelRulePerformance[]> {
    const allRules = await db.select().from(sentinelRulePerformance);
    return allRules.filter(r => (r.totalTrades || 0) >= minTrades);
  },

  // === RULE OVERRIDES ===
  
  // Get all overrides for a user
  async getRuleOverridesByUser(userId: number): Promise<SentinelRuleOverride[]> {
    return db.select().from(sentinelRuleOverrides)
      .where(eq(sentinelRuleOverrides.userId, userId));
  },

  // Get override for specific rule code
  async getRuleOverride(userId: number, ruleCode: string): Promise<SentinelRuleOverride | undefined> {
    const [override] = await db.select().from(sentinelRuleOverrides)
      .where(and(
        eq(sentinelRuleOverrides.userId, userId),
        eq(sentinelRuleOverrides.ruleCode, ruleCode)
      ));
    return override;
  },

  // Create or update rule override
  async upsertRuleOverride(data: InsertSentinelRuleOverride): Promise<SentinelRuleOverride> {
    const existing = await this.getRuleOverride(data.userId, data.ruleCode);
    if (existing) {
      const [updated] = await db.update(sentinelRuleOverrides)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(sentinelRuleOverrides.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await db.insert(sentinelRuleOverrides).values(data).returning();
    return created;
  },

  // Delete rule override (restore to default)
  async deleteRuleOverride(userId: number, ruleCode: string): Promise<void> {
    await db.delete(sentinelRuleOverrides)
      .where(and(
        eq(sentinelRuleOverrides.userId, userId),
        eq(sentinelRuleOverrides.ruleCode, ruleCode)
      ));
  },

  // Get rules by source type
  async getRulesBySource(userId: number, source: string): Promise<SentinelRule[]> {
    return db.select().from(sentinelRules)
      .where(and(eq(sentinelRules.userId, userId), eq(sentinelRules.source, source)))
      .orderBy(asc(sentinelRules.order));
  },

  // Get global rules (visible to all users) - for community rules tab
  async getGlobalRules(): Promise<SentinelRule[]> {
    return db.select().from(sentinelRules)
      .where(eq(sentinelRules.isGlobal, true))
      .orderBy(asc(sentinelRules.order));
  },

  // Update user community opt-in status
  async updateCommunityOptIn(userId: number, optIn: boolean): Promise<SentinelUser | undefined> {
    const [user] = await db.update(sentinelUsers)
      .set({ communityOptIn: optIn })
      .where(eq(sentinelUsers.id, userId))
      .returning();
    return user;
  },

  // Admin: Make a rule global (visible to all users)
  async setRuleGlobal(ruleId: number, isGlobal: boolean): Promise<SentinelRule | undefined> {
    const [rule] = await db.update(sentinelRules)
      .set({ isGlobal })
      .where(eq(sentinelRules.id, ruleId))
      .returning();
    return rule;
  },

  // System Settings
  async getSystemSettings(userId: number): Promise<SentinelSystemSettings | undefined> {
    const [settings] = await db.select().from(sentinelSystemSettings).where(eq(sentinelSystemSettings.userId, userId));
    return settings;
  },

  async upsertSystemSettings(userId: number, data: Partial<InsertSentinelSystemSettings>): Promise<SentinelSystemSettings> {
    const existing = await this.getSystemSettings(userId);
    if (existing) {
      const [updated] = await db.update(sentinelSystemSettings)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(sentinelSystemSettings.userId, userId))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(sentinelSystemSettings)
        .values({ userId, ...data })
        .returning();
      return created;
    }
  },

  // === IVY STOCK EVAL FUNCTIONS ===

  // Get or create the single settings row
  async getIvyEvalSettings(): Promise<IvyEvalSettings> {
    const [settings] = await db.select().from(ivyEvalSettings).limit(1);
    if (settings) {
      // If existing row has null OR zero values, update with defaults
      // Using || instead of ?? to also replace 0 values
      const needsUpdate = !settings.tierFreeLimit || !settings.tierPremiumLimit || !settings.tierProLimit;
      if (needsUpdate) {
        const [updated] = await db.update(ivyEvalSettings)
          .set({
            tierFreeLimit: settings.tierFreeLimit || 5,
            tierFreeTrialDays: settings.tierFreeTrialDays || 7,
            tierPremiumLimit: settings.tierPremiumLimit || 30,
            tierProLimit: settings.tierProLimit || 100,
            tierProCanBuyMore: settings.tierProCanBuyMore ?? true,
            extraEvalPrice: settings.extraEvalPrice || 0.50,
            updatedAt: new Date(),
          })
          .where(eq(ivyEvalSettings.id, settings.id))
          .returning();
        return updated;
      }
      return settings;
    }
    // Create default settings if none exist with explicit defaults
    const [created] = await db.insert(ivyEvalSettings).values({
      tierFreeLimit: 5,
      tierFreeTrialDays: 7,
      tierPremiumLimit: 30,
      tierProLimit: 100,
      tierProCanBuyMore: true,
      extraEvalPrice: 0.50,
    }).returning();
    return created;
  },

  async updateIvyEvalSettings(data: Partial<IvyEvalSettings>): Promise<IvyEvalSettings> {
    const settings = await this.getIvyEvalSettings();
    const [updated] = await db.update(ivyEvalSettings)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(ivyEvalSettings.id, settings.id))
      .returning();
    return updated;
  },

  // === ASK IVY (OVERLAY) SETTINGS ===
  async getAskIvySettings(): Promise<AskIvyOverlaySettings> {
    const now = Date.now();
    if (askIvySettingsCache && now - askIvySettingsCache.fetchedAt < ASK_IVY_SETTINGS_CACHE_TTL_MS) {
      return askIvySettingsCache.value;
    }

    const [row] = await db.select().from(askIvySettings).limit(1);
    if (!row) {
      const [created] = await db.insert(askIvySettings).values({ settings: DEFAULT_ASK_IVY_SETTINGS }).returning();
      const value = (created?.settings as AskIvyOverlaySettings) || DEFAULT_ASK_IVY_SETTINGS;
      askIvySettingsCache = { value, fetchedAt: now };
      return value;
    }

    const merged: AskIvyOverlaySettings = { ...DEFAULT_ASK_IVY_SETTINGS, ...(row.settings as any) };

    // If schema evolved, persist defaults for missing keys
    if (JSON.stringify(merged) !== JSON.stringify(row.settings || {})) {
      await db.update(askIvySettings)
        .set({ settings: merged, updatedAt: new Date() })
        .where(eq(askIvySettings.id, row.id));
    }

    askIvySettingsCache = { value: merged, fetchedAt: now };
    return merged;
  },

  async updateAskIvySettings(data: Partial<AskIvyOverlaySettings>): Promise<AskIvyOverlaySettings> {
    const current = await this.getAskIvySettings();
    const merged: AskIvyOverlaySettings = { ...current, ...data };

    const [row] = await db.select().from(askIvySettings).limit(1);
    if (!row) {
      await db.insert(askIvySettings).values({ settings: merged });
    } else {
      await db.update(askIvySettings)
        .set({ settings: merged, updatedAt: new Date() })
        .where(eq(askIvySettings.id, row.id));
    }

    askIvySettingsCache = null;
    return merged;
  },

  // Get current month's usage for a user
  async getIvyEvalUsage(userId: number): Promise<IvyEvalUsage | undefined> {
    const monthYear = new Date().toISOString().slice(0, 7); // "2026-02"
    const [usage] = await db.select().from(ivyEvalUsage)
      .where(and(
        eq(ivyEvalUsage.userId, userId),
        eq(ivyEvalUsage.monthYear, monthYear)
      ));
    return usage;
  },

  // Increment usage count for current month
  async incrementIvyEvalUsage(userId: number): Promise<IvyEvalUsage> {
    const monthYear = new Date().toISOString().slice(0, 7);
    const existing = await this.getIvyEvalUsage(userId);
    if (existing) {
      const [updated] = await db.update(ivyEvalUsage)
        .set({ evalsUsed: (existing.evalsUsed || 0) + 1, updatedAt: new Date() })
        .where(eq(ivyEvalUsage.id, existing.id))
        .returning();
      return updated;
    }
    // Create new usage record for this month
    const [created] = await db.insert(ivyEvalUsage)
      .values({ userId, monthYear, evalsUsed: 1 })
      .returning();
    return created;
  },

  // Check if user can use an eval (within their tier limit)
  async canUseIvyEval(userId: number): Promise<{ canUse: boolean; used: number; limit: number; tier: string }> {
    const user = await this.getUserById(userId);
    if (!user) return { canUse: false, used: 0, limit: 0, tier: 'free' };
    
    const settings = await this.getIvyEvalSettings();
    const usage = await this.getIvyEvalUsage(userId);
    const used = usage?.evalsUsed ?? 0;
    const extraPurchased = usage?.extraEvalsPurchased ?? 0;
    
    // Admin has unlimited
    if (user.tier === 'admin' || user.isAdmin) {
      return { canUse: true, used, limit: -1, tier: 'admin' };
    }
    
    // Use || to handle both null and 0 values (fallback to defaults)
    let limit = settings.tierFreeLimit || 5;
    if (user.tier === 'premium') limit = settings.tierPremiumLimit || 30;
    if (user.tier === 'pro') limit = settings.tierProLimit || 100;
    
    const totalLimit = limit + extraPurchased;
    return { canUse: used < totalLimit, used, limit: totalLimit, tier: user.tier || 'free' };
  },

  // Create an eval history record
  async createIvyEvalHistory(data: InsertIvyEvalHistory): Promise<IvyEvalHistory> {
    const [created] = await db.insert(ivyEvalHistory).values(data).returning();
    return created;
  },

  // Get eval history by user (for analytics)
  async getIvyEvalHistoryByUser(userId: number, limit: number = 50): Promise<IvyEvalHistory[]> {
    return db.select().from(ivyEvalHistory)
      .where(eq(ivyEvalHistory.userId, userId))
      .orderBy(desc(ivyEvalHistory.createdAt))
      .limit(limit);
  },

  // Update rating on an eval
  async rateIvyEval(evalId: number, rating: 'up' | 'down'): Promise<IvyEvalHistory | undefined> {
    const [updated] = await db.update(ivyEvalHistory)
      .set({ userRating: rating, ratedAt: new Date() })
      .where(eq(ivyEvalHistory.id, evalId))
      .returning();
    return updated;
  },

  // Update watchlist link on an eval
  async linkIvyEvalToWatchlist(evalId: number, watchlistId: number): Promise<IvyEvalHistory | undefined> {
    const [updated] = await db.update(ivyEvalHistory)
      .set({ watchlistId })
      .where(eq(ivyEvalHistory.id, evalId))
      .returning();
    return updated;
  },

  // === USER RISK PROFILE FUNCTIONS ===

  async updateUserRiskProfile(userId: number, data: {
    accountSize?: number;
    maxAccountRiskPercent?: number;
    avgPositionSize?: number;
    riskProfileCompleted?: boolean;
  }): Promise<SentinelUser | undefined> {
    const [user] = await db.update(sentinelUsers)
      .set(data)
      .where(eq(sentinelUsers.id, userId))
      .returning();
    return user;
  },

  async skipRiskProfileSetup(userId: number): Promise<SentinelUser | undefined> {
    const [user] = await db.update(sentinelUsers)
      .set({ riskProfileSkippedAt: new Date() })
      .where(eq(sentinelUsers.id, userId))
      .returning();
    return user;
  },

  // Update watchlist item with Ivy eval data
  async updateWatchlistWithIvyEval(watchlistId: number, data: {
    ivyEvalId?: number;
    ivyEvalText?: string;
    ivyRecommendedEntry?: number;
    ivyRecommendedStop?: number;
    ivyRecommendedTarget?: number;
    ivyRiskAssessment?: string;
  }): Promise<SentinelWatchlistItem | undefined> {
    const [item] = await db.update(sentinelWatchlist)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(sentinelWatchlist.id, watchlistId))
      .returning();
    return item;
  }
};
