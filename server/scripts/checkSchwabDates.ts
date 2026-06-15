import "dotenv/config";
import { eq, sql, and } from "drizzle-orm";
import { getDb, initializeDatabase } from "../db";
import { sentinelTrades } from "@shared/schema";

async function main() {
  await initializeDatabase();
  const db = getDb();
  const rows = await db.execute(sql`
    SELECT account_name,
           min(entry_date)::text as min_date,
           max(entry_date)::text as max_date,
           count(*)::int as cnt
    FROM sentinel_trades
    WHERE user_id = 2
      AND (account_name ilike '%schwab%' OR account_name ilike '%bene%' OR account_name ilike '%rollover%')
    GROUP BY account_name
    ORDER BY account_name
  `);

  for (const r of rows.rows) {
    console.log(`${r.account_name} | ${r.min_date} to ${r.max_date} | ${r.cnt} trades`);
  }
  process.exit(0);
}
main();
