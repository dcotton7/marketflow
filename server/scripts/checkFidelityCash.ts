import "dotenv/config";
import { eq, sql, and } from "drizzle-orm";
import { getDb, initializeDatabase } from "../db";
import { sentinelImportedTrades } from "@shared/schema";

async function main() {
  await initializeDatabase();
  const db = getDb();

  const summary = await db.execute(sql`
    SELECT broker_id,
           count(*)::int as total_rows,
           count(cash_balance)::int as rows_with_cash,
           min(trade_date) as min_date,
           max(trade_date) as max_date
    FROM sentinel_imported_trades
    WHERE user_id = 2
    GROUP BY broker_id
  `);
  console.log("Import summary:");
  for (const r of summary.rows) {
    console.log(`  ${r.broker_id}: ${r.total_rows} rows, ${r.rows_with_cash} with cash | ${r.min_date} to ${r.max_date}`);
  }

  const cashSample = await db.execute(sql`
    SELECT trade_date, ticker, cash_balance, direction, net_amount
    FROM sentinel_imported_trades
    WHERE user_id = 2 AND broker_id = 'FIDELITY' AND cash_balance IS NOT NULL
    ORDER BY trade_date DESC
    LIMIT 10
  `);
  console.log("\nFidelity cash samples (latest 10):");
  for (const r of cashSample.rows) {
    console.log(`  ${r.trade_date} | ${r.ticker} | cash=$${r.cash_balance} | ${r.direction} | net=$${r.net_amount}`);
  }

  process.exit(0);
}
main();
