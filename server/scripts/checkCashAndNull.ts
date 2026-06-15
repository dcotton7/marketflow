import "dotenv/config";
import { getDb, initializeDatabase } from "../db";
import { sql } from "drizzle-orm";

async function main() {
  await initializeDatabase();
  const db = getDb();

  const cash = await db.execute(sql`
    SELECT trade_date, ticker, net_amount::text, broker_id
    FROM sentinel_imported_trades
    WHERE user_id = 2 AND ticker = '__TOS_CASH__'
    ORDER BY trade_date DESC LIMIT 5
  `);
  console.log("TOS Cash entries:", cash.rows.length, cash.rows);

  const nullTrade = await db.execute(sql`
    SELECT id, symbol, status, position_size::text, entry_price::text, account_name
    FROM sentinel_trades
    WHERE user_id = 2 AND status = 'closed'
    AND account_name ILIKE '%schwab%' AND actual_pnl IS NULL
  `);
  console.log("\nRemaining null P/L:", nullTrade.rows);

  const schwabCash = await db.execute(sql`
    SELECT trade_date, SUM(CAST(cash_balance AS double precision))::text as total
    FROM sentinel_imported_trades
    WHERE user_id = 2 AND cash_balance IS NOT NULL
    AND broker_id = 'SCHWAB'
    GROUP BY trade_date
    ORDER BY trade_date DESC LIMIT 3
  `);
  console.log("\nSchwab cash from cash_balance:", schwabCash.rows);

  process.exit(0);
}
main();
