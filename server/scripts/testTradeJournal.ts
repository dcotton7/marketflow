import "dotenv/config";
import { getDb, initializeDatabase } from "../db";
import { buildTradeJournalPayload } from "../sentinel/tradeJournal";

async function main() {
  await initializeDatabase();
  const db = getDb();
  if (!db) {
    console.error("Database unavailable — check DATABASE_URL in .env");
    process.exit(1);
  }
  const userId = Number(process.argv[2] || 2);
  const payload = await buildTradeJournalPayload(db, userId);
  console.log("OK", {
    revenueDays: Object.keys(payload.dailyRevenue).length,
    cashDays: Object.keys(payload.dailyCash).length,
    active: payload.activePositionCount,
    latestCash: payload.latestCash,
  });
}

main().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
