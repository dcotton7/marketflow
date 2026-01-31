import { getDb, isDatabaseAvailable } from "./db";
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
  getWatchlist(): Promise<WatchlistItem[]>;
  addToWatchlist(item: InsertWatchlistItem): Promise<WatchlistItem>;
  removeFromWatchlist(id: number): Promise<void>;
  getSavedScans(): Promise<SavedScan[]>;
  saveScan(scan: InsertScan): Promise<SavedScan>;
  deleteScan(id: number): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  private getDatabase() {
    const db = getDb();
    if (!db) {
      throw new Error("Database not available. Please check DATABASE_URL configuration.");
    }
    return db;
  }

  async getWatchlist(): Promise<WatchlistItem[]> {
    if (!isDatabaseAvailable()) {
      console.warn("Database not available, returning empty watchlist");
      return [];
    }
    try {
      return await this.getDatabase().select().from(watchlistItems);
    } catch (error) {
      console.error("Failed to get watchlist:", error);
      return [];
    }
  }

  async addToWatchlist(item: InsertWatchlistItem): Promise<WatchlistItem> {
    const [newItem] = await this.getDatabase().insert(watchlistItems).values(item).returning();
    return newItem;
  }

  async removeFromWatchlist(id: number): Promise<void> {
    await this.getDatabase().delete(watchlistItems).where(eq(watchlistItems.id, id));
  }

  async getSavedScans(): Promise<SavedScan[]> {
    if (!isDatabaseAvailable()) {
      console.warn("Database not available, returning empty scans");
      return [];
    }
    try {
      return await this.getDatabase().select().from(savedScans);
    } catch (error) {
      console.error("Failed to get saved scans:", error);
      return [];
    }
  }

  async saveScan(scan: InsertScan): Promise<SavedScan> {
    const [newScan] = await this.getDatabase().insert(savedScans).values(scan).returning();
    return newScan;
  }

  async deleteScan(id: number): Promise<void> {
    await this.getDatabase().delete(savedScans).where(eq(savedScans.id, id));
  }
}

export const storage = new DatabaseStorage();
