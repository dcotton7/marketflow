/**
 * Quick script to check snapshot data in database
 */
import { getDb } from "../db";
import { themeSnapshots } from "@shared/schema";
import { sql } from "drizzle-orm";

async function checkSnapshots() {
  const db = getDb();
  if (!db) {
    console.error("No database connection");
    process.exit(1);
  }

  try {
    // Count by type and date
    const counts = await db
      .select({
        snapshotType: themeSnapshots.snapshotType,
        marketDate: themeSnapshots.marketDate,
        count: sql<number>`count(*)::int`,
      })
      .from(themeSnapshots)
      .groupBy(themeSnapshots.snapshotType, themeSnapshots.marketDate)
      .orderBy(themeSnapshots.marketDate);

    console.log("\n=== Snapshot Counts by Date ===");
    console.table(counts);

    // Get recent intraday snapshots
    const recentIntraday = await db
      .select({
        marketDate: themeSnapshots.marketDate,
        createdAt: themeSnapshots.createdAt,
        themeId: themeSnapshots.themeId,
      })
      .from(themeSnapshots)
      .where(sql`${themeSnapshots.snapshotType} = 'hourly'`)
      .orderBy(sql`${themeSnapshots.createdAt} DESC`)
      .limit(5);

    console.log("\n=== Recent Intraday Snapshots ===");
    console.table(recentIntraday);

    // Get recent daily snapshots
    const recentDaily = await db
      .select({
        marketDate: themeSnapshots.marketDate,
        themeId: themeSnapshots.themeId,
        score: themeSnapshots.score,
      })
      .from(themeSnapshots)
      .where(sql`${themeSnapshots.snapshotType} = 'daily_close'`)
      .orderBy(sql`${themeSnapshots.marketDate} DESC`)
      .limit(10);

    console.log("\n=== Recent Daily Snapshots ===");
    console.table(recentDaily);

    process.exit(0);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

checkSnapshots();
