import "dotenv/config";
import { eq, and, sql } from "drizzle-orm";
import { getDb, initializeDatabase } from "../db";

async function main() {
  await initializeDatabase();
  const db = getDb();

  const rows = await db.execute(sql`
    SELECT trade_date,
           count(*)::int                   as row_count,
           min(id)::int                    as min_id,
           max(id)::int                    as max_id,
           min(cash_balance)::numeric      as min_cash,
           max(cash_balance)::numeric      as max_cash
    FROM sentinel_imported_trades
    WHERE user_id = 2
      AND broker_id = 'FIDELITY'
      AND cash_balance IS NOT NULL
    GROUP BY trade_date
    ORDER BY trade_date DESC
    LIMIT 20
  `);

  console.log("Fidelity cash rows by date (newest 20 days):");
  console.log("Date         | rows | min_id  | max_id  | min_cash      | max_cash");
  for (const r of rows.rows as any[]) {
    console.log(
      `${r.trade_date} | ${String(r.row_count).padStart(4)} | ${String(r.min_id).padStart(7)} | ${String(r.max_id).padStart(7)} | ${String(Number(r.min_cash).toFixed(2)).padStart(13)} | ${String(Number(r.max_cash).toFixed(2)).padStart(13)}`
    );
  }

  // Show which row the current logic picks (highest ID = max_id)
  console.log("\nCurrent logic picks MAX id → shows min_cash (first trade of day, WRONG)");
  console.log("Correct: should pick MIN id → shows max_cash (EOD cash after last trade)");

  // Spot check a specific day
  const spotCheck = await db.execute(sql`
    SELECT id, trade_date, cash_balance, symbol, direction
    FROM sentinel_imported_trades
    WHERE user_id = 2 AND broker_id = 'FIDELITY' AND cash_balance IS NOT NULL
      AND trade_date = (
        SELECT max(trade_date) FROM sentinel_imported_trades
        WHERE user_id = 2 AND broker_id = 'FIDELITY' AND cash_balance IS NOT NULL
      )
    ORDER BY id ASC
    LIMIT 5
  `);
  console.log("\nSpot check (latest date, first 5 rows by ID):");
  for (const r of spotCheck.rows as any[]) {
    console.log(`  id:${r.id} | ${r.trade_date} | cash:${r.cash_balance} | ${r.symbol} ${r.direction}`);
  }

  const spotCheckLast = await db.execute(sql`
    SELECT id, trade_date, cash_balance, symbol, direction
    FROM sentinel_imported_trades
    WHERE user_id = 2 AND broker_id = 'FIDELITY' AND cash_balance IS NOT NULL
      AND trade_date = (
        SELECT max(trade_date) FROM sentinel_imported_trades
        WHERE user_id = 2 AND broker_id = 'FIDELITY' AND cash_balance IS NOT NULL
      )
    ORDER BY id DESC
    LIMIT 5
  `);
  console.log("\nSpot check (latest date, LAST 5 rows by ID):");
  for (const r of spotCheckLast.rows as any[]) {
    console.log(`  id:${r.id} | ${r.trade_date} | cash:${r.cash_balance} | ${r.symbol} ${r.direction}`);
  }

  process.exit(0);
}
main();
