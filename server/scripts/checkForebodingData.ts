#!/usr/bin/env tsx
import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { getDb, initializeDatabase } from "../db";
import {
  sentinelImportedTrades,
  sentinelTrades,
  sentinelJournalCashAnchor,
  sentinelJournalCashEvents,
} from "@shared/schema";

async function main() {
  await initializeDatabase();
  const db = getDb();
  if (!db) {
    console.error("No DB");
    process.exit(1);
  }
  const userId = 2; // Foreboding

  const [imports, trades, anchors, events] = await Promise.all([
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(sentinelImportedTrades)
      .where(eq(sentinelImportedTrades.userId, userId)),
    db
      .select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`count(*) filter (where ${sentinelTrades.status} = 'active')::int`,
        closed: sql<number>`count(*) filter (where ${sentinelTrades.status} = 'closed')::int`,
      })
      .from(sentinelTrades)
      .where(eq(sentinelTrades.userId, userId)),
    db
      .select()
      .from(sentinelJournalCashAnchor)
      .where(eq(sentinelJournalCashAnchor.userId, userId)),
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(sentinelJournalCashEvents)
      .where(eq(sentinelJournalCashEvents.userId, userId)),
  ]);

  const importByBroker = await db
    .select({
      brokerId: sentinelImportedTrades.brokerId,
      c: sql<number>`count(*)::int`,
    })
    .from(sentinelImportedTrades)
    .where(eq(sentinelImportedTrades.userId, userId))
    .groupBy(sentinelImportedTrades.brokerId);

  const tradeAccounts = await db
    .select({
      accountName: sentinelTrades.accountName,
      c: sql<number>`count(*)::int`,
    })
    .from(sentinelTrades)
    .where(eq(sentinelTrades.userId, userId))
    .groupBy(sentinelTrades.accountName);

  console.log("=== Foreboding (user 2) data snapshot ===");
  console.log("Import rows:", imports[0]?.c ?? 0);
  console.log("Import by broker:", importByBroker);
  console.log("Trading cards:", trades[0]);
  console.log("Cards by account:", tradeAccounts);
  console.log("Cash anchors:", anchors);
  console.log("Cash events:", events[0]?.c ?? 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
