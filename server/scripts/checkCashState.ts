import "dotenv/config";
import { eq } from "drizzle-orm";
import { getDb, initializeDatabase } from "../db";
import { sentinelJournalCashAnchor, sentinelJournalCashEvents } from "@shared/schema";

async function main() {
  await initializeDatabase();
  const db = getDb();
  const anchors = await db.select().from(sentinelJournalCashAnchor).where(eq(sentinelJournalCashAnchor.userId, 2));
  console.log("Anchors:");
  for (const a of anchors) console.log(`  ${a.brokerId} | date:${a.anchorDate} | cash:${a.anchorCash}`);
  
  const events = await db.select().from(sentinelJournalCashEvents).where(eq(sentinelJournalCashEvents.userId, 2));
  console.log("Events:");
  for (const e of events) console.log(`  ${e.brokerId} | date:${e.eventDate} | amount:${e.amount} | ${e.label}`);
  
  process.exit(0);
}
main();
