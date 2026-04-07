/**
 * Query actual snapshot data from database
 */
import { getDb } from "../db";
import { themeSnapshots } from "@shared/schema";
import { sql, desc, eq } from "drizzle-orm";

async function querySnapshots() {
  const db = getDb();
  if (!db) {
    console.error("No database connection");
    process.exit(1);
  }

  try {
    // Count by type and date
    console.log("\n=== Snapshot Counts ===");
    const counts = await db.execute(sql`
      SELECT 
        snapshot_type,
        market_date,
        COUNT(*)::int as count,
        MIN(created_at) as first_snapshot,
        MAX(created_at) as last_snapshot
      FROM theme_snapshots
      GROUP BY snapshot_type, market_date
      ORDER BY market_date DESC, snapshot_type
      LIMIT 20
    `);
    console.table(counts.rows);

    // Check hourly snapshots specifically
    console.log("\n=== Recent Hourly Snapshot Dates ===");
    const hourly = await db.execute(sql`
      SELECT DISTINCT market_date, COUNT(*)::int as snapshot_count
      FROM theme_snapshots
      WHERE snapshot_type = 'hourly'
      GROUP BY market_date
      ORDER BY market_date DESC
      LIMIT 10
    `);
    console.table(hourly.rows);

    // Sample some hourly data if it exists
    console.log("\n=== Sample Hourly Snapshots (Most Recent) ===");
    const samples = await db
      .select()
      .from(themeSnapshots)
      .where(eq(themeSnapshots.snapshotType, "hourly"))
      .orderBy(desc(themeSnapshots.createdAt))
      .limit(10);
    
    if (samples.length > 0) {
      console.table(samples.map(s => ({
        themeId: s.themeId,
        date: s.marketDate,
        hour: s.snapshotHour,
        score: s.score,
        createdAt: s.createdAt
      })));
    } else {
      console.log("❌ NO HOURLY SNAPSHOTS FOUND");
    }

    process.exit(0);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

querySnapshots();
