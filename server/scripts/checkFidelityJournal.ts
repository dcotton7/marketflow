import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb, initializeDatabase } from "../db";

async function main() {
  await initializeDatabase();
  const db = getDb();

  // Fidelity realized P&L
  const pnl = await db.execute(sql`
    SELECT count(*)::int as trades,
           sum(CASE WHEN actual_pnl > 0 THEN 1 ELSE 0 END)::int as wins,
           sum(CASE WHEN actual_pnl < 0 THEN 1 ELSE 0 END)::int as losses,
           round(sum(actual_pnl)::numeric, 2) as total_pnl,
           round(sum(CASE WHEN actual_pnl > 0 THEN actual_pnl ELSE 0 END)::numeric, 2) as gross_wins,
           round(sum(CASE WHEN actual_pnl < 0 THEN actual_pnl ELSE 0 END)::numeric, 2) as gross_losses
    FROM sentinel_trades
    WHERE user_id = 2
      AND status = 'closed'
      AND (account_name ilike '%activity%' OR account_name ilike '%brokeragelink%')
      AND exit_date >= '2026-01-01'
  `);
  console.log("=== Fidelity YTD Realized P&L ===");
  const r = pnl.rows[0];
  console.log(`Trades: ${r?.trades} (${r?.wins}W / ${r?.losses}L)`);
  console.log(`Gross wins: +$${r?.gross_wins}`);
  console.log(`Gross losses: -$${Math.abs(Number(r?.gross_losses))}`);
  console.log(`Net P&L: $${r?.total_pnl}`);

  // Active positions
  const active = await db.execute(sql`
    SELECT symbol, entry_price, position_size,
           (entry_price * COALESCE(position_size, 0)) as cost_basis
    FROM sentinel_trades
    WHERE user_id = 2
      AND status = 'active'
      AND (account_name ilike '%activity%' OR account_name ilike '%brokeragelink%')
    ORDER BY symbol
  `);
  console.log("\n=== Fidelity Active Positions ===");
  let totalCost = 0;
  for (const p of active.rows) {
    const cb = Number(p.cost_basis) || 0;
    totalCost += cb;
    console.log(`  ${p.symbol}: ${p.position_size} shares @ $${Number(p.entry_price).toFixed(2)} = $${cb.toFixed(2)}`);
  }
  console.log(`Total cost basis: $${totalCost.toFixed(2)}`);

  // Latest cash from imported trades
  const latestCash = await db.execute(sql`
    SELECT trade_date, cash_balance, ticker, direction
    FROM sentinel_imported_trades
    WHERE user_id = 2 AND broker_id = 'FIDELITY' AND cash_balance IS NOT NULL
    ORDER BY trade_date DESC, id DESC
    LIMIT 1
  `);
  console.log("\n=== Latest Fidelity Cash from Import ===");
  console.log(latestCash.rows[0]);

  // Earliest cash
  const earliestCash = await db.execute(sql`
    SELECT trade_date, cash_balance, ticker
    FROM sentinel_imported_trades
    WHERE user_id = 2 AND broker_id = 'FIDELITY' AND cash_balance IS NOT NULL
    ORDER BY trade_date ASC, id ASC
    LIMIT 1
  `);
  console.log("\n=== Earliest Fidelity Cash from Import ===");
  console.log(earliestCash.rows[0]);

  process.exit(0);
}
main();
