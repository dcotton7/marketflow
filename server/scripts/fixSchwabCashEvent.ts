import "dotenv/config";
import { eq, and, sql } from "drizzle-orm";
import { getDb, initializeDatabase } from "../db";
import { sentinelJournalCashEvents } from "@shared/schema";

async function main() {
  await initializeDatabase();
  const db = getDb();

  // Find the existing Schwab cash event for Feb 17
  const existing = await db.select()
    .from(sentinelJournalCashEvents)
    .where(and(
      eq(sentinelJournalCashEvents.userId, 2),
      eq(sentinelJournalCashEvents.brokerId, "SCHWAB"),
      eq(sentinelJournalCashEvents.eventDate, "2026-02-17")
    ));

  console.log("Existing event:", existing);

  if (existing.length > 0) {
    const updated = await db.update(sentinelJournalCashEvents)
      .set({
        amount: 469356,
        label: "Rollover IRA transfer — cash portion (total $576,224.59 minus ~$106,869 positions)",
      })
      .where(eq(sentinelJournalCashEvents.id, existing[0].id))
      .returning();
    console.log("Updated to:", updated);
  } else {
    console.log("No event found to update!");
  }

  process.exit(0);
}
main();
