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
