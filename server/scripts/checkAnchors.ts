import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb, initializeDatabase } from "../db";

async function main() {
  await initializeDatabase();
  const db = getDb();
  const r = await db.execute(sql`SELECT * FROM sentinel_journal_cash_anchor WHERE user_id = 2`);
  console.log("Anchors:");
  for (const row of r.rows) console.log(JSON.stringify(row));
  const e = await db.execute(sql`SELECT * FROM sentinel_journal_cash_events WHERE user_id = 2`);
  console.log("Events:");
  for (const row of e.rows) console.log(JSON.stringify(row));
  process.exit(0);
}
main();
