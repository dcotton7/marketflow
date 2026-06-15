import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb, initializeDatabase } from "../db";

async function main() {
  await initializeDatabase();
  const db = getDb();

  const stats = await db.execute(sql`
    SELECT status, count(*)::int as cnt,
           sum(case when actual_pnl is not null then 1 else 0 end)::int as has_pnl,
           sum(case when exit_date is not null then 1 else 0 end)::int as has_exit
    FROM sentinel_trades WHERE user_id = 2
    GROUP BY status
  `);
  console.log("Trade counts by status:");
  for (const row of stats.rows as any[]) console.log(`  ${JSON.stringify(row)}`);

  const sample = await db.execute(sql`
    SELECT id, symbol, status, exit_date::text as exit_date, actual_pnl::numeric as actual_pnl, account_name
    FROM sentinel_trades WHERE user_id = 2 AND status = 'closed'
    ORDER BY exit_date DESC LIMIT 5
  `);
  console.log("\nSample closed trades (recent):");
  for (const row of sample.rows as any[]) console.log(`  ${JSON.stringify(row)}`);

  const ytd = await db.execute(sql`
    SELECT sum(actual_pnl)::numeric as ytd_pnl, count(*)::int as cnt
    FROM sentinel_trades
    WHERE user_id = 2 AND status = 'closed' AND actual_pnl IS NOT NULL
  `);
  console.log("\nYTD from DB directly:");
  for (const row of ytd.rows as any[]) console.log(`  ${JSON.stringify(row)}`);

  process.exit(0);
}
main();
