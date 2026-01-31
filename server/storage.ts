import { getDb } from "./db";
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
  private get db() {
    const db = getDb();
    if (!db) {
      throw new Error("Database not available");
    }
    return db;
  }

  // Watchlist
  async getWatchlist(): Promise<WatchlistItem[]> {
    try {
      return await this.db.select().from(watchlistItems);
    } catch (error) {
      console.error("Failed to get watchlist:", error);
      return [];
    }
  }

  async addToWatchlist(item: InsertWatchlistItem): Promise<WatchlistItem> {
    const [newItem] = await this.db.insert(watchlistItems).values(item).returning();
    return newItem;
  }

  async removeFromWatchlist(id: number): Promise<void> {
    await this.db.delete(watchlistItems).where(eq(watchlistItems.id, id));
  }

  // Scans
  async getSavedScans(): Promise<SavedScan[]> {
    try {
      return await this.db.select().from(savedScans);
    } catch (error) {
      console.error("Failed to get saved scans:", error);
      return [];
    }
  }

  async saveScan(scan: InsertScan): Promise<SavedScan> {
    const [newScan] = await this.db.insert(savedScans).values(scan).returning();
    return newScan;
  }

  async deleteScan(id: number): Promise<void> {
    await this.db.delete(savedScans).where(eq(savedScans.id, id));
  }
}

export const storage = new DatabaseStorage();
