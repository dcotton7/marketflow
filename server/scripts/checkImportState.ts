import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { getDb, initializeDatabase } from "../db";
import { sentinelImportedTrades, sentinelImportBatches, sentinelTrades } from "@shared/schema";

async function main() {
  await initializeDatabase();
  const db = getDb();

  const imports = await db.select({ c: sql<number>`count(*)::int` }).from(sentinelImportedTrades).where(eq(sentinelImportedTrades.userId, 2));
  const cards = await db.select({ c: sql<number>`count(*)::int` }).from(sentinelTrades).where(eq(sentinelTrades.userId, 2));
  const batches = await db.select({
    id: sentinelImportBatches.id,
    fileName: sentinelImportBatches.fileName,
    status: sentinelImportBatches.status,
    totalTradesFound: sentinelImportBatches.totalTradesFound,
    totalTradesImported: sentinelImportBatches.totalTradesImported,
  }).from(sentinelImportBatches).where(eq(sentinelImportBatches.userId, 2));

  console.log("Import rows:", imports[0]?.c);
  console.log("Cards:", cards[0]?.c);
  console.log("Batches:");
  for (const b of batches) {
    console.log(`  ${b.id} | ${b.status} | found:${b.totalTradesFound} imported:${b.totalTradesImported} | ${b.fileName}`);
  }
  process.exit(0);
}
main();
