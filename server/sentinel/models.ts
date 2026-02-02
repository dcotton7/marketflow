import { db } from "../db";
import { 
  sentinelUsers, sentinelTrades, sentinelEvaluations, sentinelEvents, sentinelWatchlist, sentinelRules,
  sentinelRuleSuggestions, sentinelRulePerformance,
  type SentinelUser, type SentinelTrade, type SentinelEvaluation, type SentinelEvent, type SentinelWatchlistItem, type SentinelRule,
  type SentinelRuleSuggestion, type SentinelRulePerformance,
  type InsertSentinelUser, type InsertSentinelTrade, type InsertSentinelEvaluation, type InsertSentinelEvent, type InsertSentinelWatchlistItem, type InsertSentinelRule
} from "@shared/schema";
import { eq, desc, and, asc } from "drizzle-orm";
import { STARTER_RULES } from "./starterRules";

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

  // Watchlist methods
  async createWatchlistItem(data: InsertSentinelWatchlistItem): Promise<SentinelWatchlistItem> {
    const [item] = await db.insert(sentinelWatchlist).values(data).returning();
    return item;
  },

  async getWatchlistByUser(userId: number): Promise<SentinelWatchlistItem[]> {
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
  }
};
