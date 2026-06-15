import "dotenv/config";
import { eq, and } from "drizzle-orm";
import { getDb, initializeDatabase } from "../db";
import { sentinelJournalCashEvents } from "@shared/schema";

async function main() {
  await initializeDatabase();
  const db = getDb();

  const existing = await db.select()
    .from(sentinelJournalCashEvents)
    .where(and(
      eq(sentinelJournalCashEvents.userId, 2),
      eq(sentinelJournalCashEvents.brokerId, "SCHWAB"),
      eq(sentinelJournalCashEvents.eventDate, "2026-02-17")
    ));

  if (existing.length > 0) {
    const updated = await db.update(sentinelJournalCashEvents)
      .set({
        amount: 285069,
        label: "Rollover IRA cash portion — back-calculated from TOS current cash $174,716",
      })
      .where(eq(sentinelJournalCashEvents.id, existing[0].id))
      .returning();
    console.log("Updated cash event:", updated);
  }

  process.exit(0);
}
main();
