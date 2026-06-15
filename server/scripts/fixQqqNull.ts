import "dotenv/config";
import { getDb, initializeDatabase } from "../db";
import { sql } from "drizzle-orm";

async function main() {
  await initializeDatabase();
  const db = getDb();
  await db.execute(sql`UPDATE sentinel_trades SET actual_pnl = 0 WHERE id = 14765`);
  console.log("QQQ trade 14765 P/L set to 0");
  const check = await db.execute(sql`
    SELECT COUNT(*)::text as cnt FROM sentinel_trades
    WHERE user_id = 2 AND status = 'closed'
    AND account_name ILIKE '%schwab%' AND actual_pnl IS NULL
  `);
  console.log("Remaining null P/L:", (check.rows[0] as any).cnt);
  process.exit(0);
}
main();
