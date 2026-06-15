import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb, initializeDatabase } from "../db";

async function main() {
  await initializeDatabase();
  const db = getDb();
  await db.execute(sql`ALTER TABLE sentinel_trades ADD COLUMN IF NOT EXISTS mark_price double precision`);
  await db.execute(sql`ALTER TABLE sentinel_trades ADD COLUMN IF NOT EXISTS mark_updated_at timestamp`);
  console.log("Migration applied: mark_price + mark_updated_at columns added");
  process.exit(0);
}
main();
