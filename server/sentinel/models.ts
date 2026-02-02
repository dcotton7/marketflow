import { db } from "../db";
import { 
  sentinelUsers, sentinelTrades, sentinelEvaluations, sentinelEvents,
  type SentinelUser, type SentinelTrade, type SentinelEvaluation, type SentinelEvent,
  type InsertSentinelUser, type InsertSentinelTrade, type InsertSentinelEvaluation, type InsertSentinelEvent
} from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";

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
  }
};
