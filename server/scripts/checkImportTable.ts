import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb, initializeDatabase } from "../db";

async function main() {
  await initializeDatabase();
  const db = getDb();

  const total = await db.execute(sql`SELECT count(*)::int as cnt FROM sentinel_imported_trades`);
  console.log("Total rows in sentinel_imported_trades:", total.rows[0]?.cnt);

  const byUser = await db.execute(sql`
    SELECT user_id, count(*)::int as cnt FROM sentinel_imported_trades GROUP BY user_id
  `);
  console.log("By user:", byUser.rows);

  const cols = await db.execute(sql`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'sentinel_imported_trades' 
    AND column_name IN ('cash_balance', 'batch_id', 'user_id', 'trade_date')
    ORDER BY column_name
  `);
  console.log("Key columns:", cols.rows);

  process.exit(0);
}
main();
