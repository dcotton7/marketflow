import { db } from "./db";
import {
  savedScans,
  watchlistItems,
  type InsertScan,
  type InsertWatchlistItem,
  type SavedScan,
  type WatchlistItem,
} from "@shared/schema";
import { eq } from "drizzle-orm";

export interface IStorage {
  // Watchlist
  getWatchlist(): Promise<WatchlistItem[]>;
  addToWatchlist(item: InsertWatchlistItem): Promise<WatchlistItem>;
  removeFromWatchlist(id: number): Promise<void>;

  // Scans
  getSavedScans(): Promise<SavedScan[]>;
  saveScan(scan: InsertScan): Promise<SavedScan>;
  deleteScan(id: number): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  // Watchlist
  async getWatchlist(): Promise<WatchlistItem[]> {
    return await db.select().from(watchlistItems);
  }

  async addToWatchlist(item: InsertWatchlistItem): Promise<WatchlistItem> {
    const [newItem] = await db.insert(watchlistItems).values(item).returning();
    return newItem;
  }

  async removeFromWatchlist(id: number): Promise<void> {
    await db.delete(watchlistItems).where(eq(watchlistItems.id, id));
  }

  // Scans
  async getSavedScans(): Promise<SavedScan[]> {
    return await db.select().from(savedScans);
  }

  async saveScan(scan: InsertScan): Promise<SavedScan> {
    const [newScan] = await db.insert(savedScans).values(scan).returning();
    return newScan;
  }

  async deleteScan(id: number): Promise<void> {
    await db.delete(savedScans).where(eq(savedScans.id, id));
  }
}

export const storage = new DatabaseStorage();
