import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb, initializeDatabase } from "../db";

async function main() {
  await initializeDatabase();
  const db = getDb();
  if (!db) {
    console.error("Database unavailable");
    process.exit(1);
  }
  await db.execute(
    sql`ALTER TABLE sentinel_imported_trades ADD COLUMN IF NOT EXISTS cash_balance double precision`
  );
  console.log("cash_balance column ensured on sentinel_imported_trades");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
