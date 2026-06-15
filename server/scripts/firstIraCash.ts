import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb, initializeDatabase } from "../db";

async function main() {
  await initializeDatabase();
  const db = getDb();
  const r = await db.execute(sql`
    SELECT trade_date, cash_balance::numeric as cash
    FROM sentinel_imported_trades
    WHERE user_id = 2 AND ticker = '__TOS_CASH__'
      AND account_name = 'Schwab Rollover IRA'
      AND cash_balance > 0
    ORDER BY trade_date ASC LIMIT 5
  `);
  console.log("First non-zero Rollover IRA cash:");
  for (const row of r.rows as any[]) {
    console.log(`  ${row.trade_date}: $${parseFloat(row.cash).toFixed(2)}`);
  }
  process.exit(0);
}
main();
