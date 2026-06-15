import "dotenv/config";
import { getDb, initializeDatabase } from "../db";
import { sql } from "drizzle-orm";

async function main() {
  await initializeDatabase();
  const db = getDb();

  const fidCash = await db.execute(sql`
    SELECT trade_date, cash_balance::text, broker_id
    FROM sentinel_imported_trades
    WHERE user_id = 2 AND cash_balance IS NOT NULL AND broker_id = 'FIDELITY'
    ORDER BY trade_date DESC LIMIT 5
  `);
  console.log("Fidelity cash entries:", fidCash.rows);

  const fidPos = await db.execute(sql`
    SELECT symbol, position_size::text, entry_price::text, mark_price::text, status, account_name
    FROM sentinel_trades
    WHERE user_id = 2 AND status = 'active' AND account_name NOT ILIKE '%schwab%'
  `);
  console.log("\nFidelity active positions:", fidPos.rows);

  const fidRlzd = await db.execute(sql`
    SELECT SUM(actual_pnl)::text as total, COUNT(*)::text as cnt
    FROM sentinel_trades
    WHERE user_id = 2 AND status = 'closed' AND account_name NOT ILIKE '%schwab%'
  `);
  console.log("\nFidelity realized:", fidRlzd.rows[0]);

  // Check today return calculation inputs
  const todayClosed = await db.execute(sql`
    SELECT symbol, actual_pnl::text, exit_date::text
    FROM sentinel_trades
    WHERE user_id = 2 AND status = 'closed'
    AND exit_date::date = '2026-06-08'
    ORDER BY actual_pnl DESC
  `);
  console.log("\nAll trades closed TODAY (Jun 8):", todayClosed.rows);

  process.exit(0);
}
main();
