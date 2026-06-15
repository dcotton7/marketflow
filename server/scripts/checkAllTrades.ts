import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb, initializeDatabase } from "../db";

async function main() {
  await initializeDatabase();
  const db = getDb();
  const r = await db.execute(sql`
    SELECT account_name, status, count(*)::int as cnt
    FROM sentinel_trades
    WHERE user_id = 2
    GROUP BY account_name, status
    ORDER BY account_name, status
  `);
  console.log("All trades by account + status:");
  for (const row of r.rows as any[]) {
    console.log(`  ${row.account_name} | ${row.status} | ${row.cnt}`);
  }
  process.exit(0);
}
main();
