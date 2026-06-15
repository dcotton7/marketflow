import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb, initializeDatabase } from "../db";

async function main() {
  await initializeDatabase();
  const db = getDb();

  // For each date, show BOTH the old pick (max id) and new pick (min id)
  const rows = await db.execute(sql`
    WITH ranked AS (
      SELECT trade_date, id, cash_balance,
             row_number() OVER (PARTITION BY trade_date ORDER BY id ASC) as rn_asc,
             row_number() OVER (PARTITION BY trade_date ORDER BY id DESC) as rn_desc
      FROM sentinel_imported_trades
      WHERE user_id = 2
        AND broker_id = 'FIDELITY'
        AND cash_balance IS NOT NULL
    )
    SELECT
      r1.trade_date,
      r1.cash_balance as eod_cash_correct,
      r2.cash_balance as old_pick_wrong
    FROM ranked r1
    JOIN ranked r2 ON r1.trade_date = r2.trade_date AND r2.rn_desc = 1
    WHERE r1.rn_asc = 1
    ORDER BY r1.trade_date DESC
    LIMIT 15
  `);

  console.log("Fidelity daily cash: FIXED vs OLD (newest 15 days)");
  console.log("Date         | EOD (correct)   | Old pick (wrong) | Difference");
  console.log("-------------|-----------------|------------------|----------");
  for (const r of rows.rows as any[]) {
    const correct = Number(r.eod_cash_correct);
    const wrong = Number(r.old_pick_wrong);
    const diff = correct - wrong;
    console.log(
      `${r.trade_date} | ${correct.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(15)} | ${wrong.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(16)} | ${diff >= 0 ? "+" : ""}${diff.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    );
  }

  process.exit(0);
}
main();
