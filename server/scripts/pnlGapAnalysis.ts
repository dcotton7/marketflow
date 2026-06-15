import "dotenv/config";
import { getDb, initializeDatabase } from "../db";
import { sql } from "drizzle-orm";

async function main() {
  await initializeDatabase();
  const db = getDb();

  console.log("=== P/L GAP ANALYSIS ===\n");

  // 1. Closed trades with NULL actual_pnl
  const nullPnl = await db.execute(sql`
    SELECT symbol, status, entry_date::text, exit_date::text,
           position_size::text, entry_price::text, exit_price::text,
           actual_pnl::text, account_name
    FROM sentinel_trades
    WHERE user_id = 2 AND status = 'closed'
    AND account_name ILIKE '%schwab%'
    AND actual_pnl IS NULL
    ORDER BY entry_date
  `);
  console.log(`Closed Schwab trades with NULL P/L: ${nullPnl.rows.length}`);
  for (const r of nullPnl.rows as any[]) {
    console.log(
      `  ${r.symbol} | ${r.entry_date?.slice(0, 10)} -> ${r.exit_date?.slice(0, 10)} | size: ${r.position_size} | entry: $${r.entry_price} | exit: $${r.exit_price ?? "NULL"} | ${r.account_name}`
    );
  }

  // 2. Closed trades with $0 P/L (suspicious)
  const zeroPnl = await db.execute(sql`
    SELECT COUNT(*)::text as cnt
    FROM sentinel_trades
    WHERE user_id = 2 AND status = 'closed'
    AND account_name ILIKE '%schwab%'
    AND actual_pnl = 0
  `);
  console.log(`\nClosed Schwab trades with $0 P/L: ${(zeroPnl.rows[0] as any).cnt}`);

  // 3. Total realized (non-null)
  const realized = await db.execute(sql`
    SELECT SUM(actual_pnl)::text as total, COUNT(*)::text as cnt
    FROM sentinel_trades
    WHERE user_id = 2 AND status = 'closed'
    AND account_name ILIKE '%schwab%'
    AND actual_pnl IS NOT NULL
  `);
  console.log(`\nTotal Schwab realized (non-null): $${Number((realized.rows[0] as any).total).toFixed(2)} from ${(realized.rows[0] as any).cnt} trades`);

  // 4. Unrealized from active positions
  const unrealized = await db.execute(sql`
    SELECT symbol, position_size::text, entry_price::text,
           mark_price::text, account_name,
           (COALESCE(mark_price, 0) * COALESCE(position_size, 0) 
            - entry_price * COALESCE(position_size, 0))::text as unrealized
    FROM sentinel_trades
    WHERE user_id = 2 AND status = 'active'
    AND account_name ILIKE '%schwab%'
    ORDER BY ABS(COALESCE(mark_price, 0) * COALESCE(position_size, 0) 
            - entry_price * COALESCE(position_size, 0)) DESC
  `);
  let totalUnrealized = 0;
  console.log(`\nActive Schwab positions (${unrealized.rows.length}):`);
  for (const r of unrealized.rows as any[]) {
    const u = Number(r.unrealized);
    totalUnrealized += u;
    console.log(
      `  ${r.symbol} | qty: ${r.position_size} | entry: $${r.entry_price} | mark: $${r.mark_price ?? "NULL"} | unrlzd: $${u.toFixed(2)} | ${r.account_name}`
    );
  }
  console.log(`\nTotal Schwab unrealized: $${totalUnrealized.toFixed(2)}`);

  // 5. Capital flow data
  const flows = await db.execute(sql`
    SELECT event_kind, amount::text, event_date, broker_id, label
    FROM sentinel_journal_cash_events
    WHERE user_id = 2 AND broker_id = 'SCHWAB'
    AND event_kind IN ('starting_equity', 'capital_injection', 'withdrawal')
    ORDER BY event_date
  `);
  let totalCapital = 0;
  console.log("\nSchwab capital flows:");
  for (const r of flows.rows as any[]) {
    const amt = Number(r.amount);
    if (r.event_kind === "withdrawal") totalCapital -= amt;
    else totalCapital += amt;
    console.log(`  ${r.event_kind} | ${r.event_date} | $${amt.toFixed(2)} | ${r.label ?? ""}`);
  }
  console.log(`Total capital: $${totalCapital.toFixed(2)}`);

  // 6. Current equity
  const cash = await db.execute(sql`
    SELECT SUM(CAST(net_amount AS double precision))::text as total_cash
    FROM sentinel_imported_trades
    WHERE user_id = 2 AND ticker = '__TOS_CASH__'
    AND trade_date = (
      SELECT MAX(trade_date) FROM sentinel_imported_trades
      WHERE user_id = 2 AND ticker = '__TOS_CASH__'
    )
  `);
  const cashVal = Number((cash.rows[0] as any).total_cash);
  
  const posVal = await db.execute(sql`
    SELECT SUM(COALESCE(mark_price, entry_price) * COALESCE(position_size, 0))::text as total
    FROM sentinel_trades
    WHERE user_id = 2 AND status = 'active'
    AND account_name ILIKE '%schwab%'
  `);
  const positionsVal = Number((posVal.rows[0] as any).total);
  const currentEquity = cashVal + positionsVal;

  console.log(`\n=== SUMMARY ===`);
  console.log(`Current cash (Schwab): $${cashVal.toFixed(2)}`);
  console.log(`Current positions (Schwab): $${positionsVal.toFixed(2)}`);
  console.log(`Current equity: $${currentEquity.toFixed(2)}`);
  console.log(`Total capital: $${totalCapital.toFixed(2)}`);
  console.log(`Account growth (equity - capital): $${(currentEquity - totalCapital).toFixed(2)}`);
  console.log(`Realized P/L (closed trades): $${Number((realized.rows[0] as any).total).toFixed(2)}`);
  console.log(`Unrealized P/L (active positions): $${totalUnrealized.toFixed(2)}`);
  console.log(`Sum (realized + unrealized): $${(Number((realized.rows[0] as any).total) + totalUnrealized).toFixed(2)}`);
  console.log(`GAP: $${(currentEquity - totalCapital - Number((realized.rows[0] as any).total) - totalUnrealized).toFixed(2)}`);

  // 7. Breakdown: deposited positions that use original cost basis
  console.log(`\n=== DEPOSITED POSITION ANALYSIS ===`);
  console.log(`The IRA deposit included stock/ETF positions at MARKET VALUE.`);
  console.log(`But our realized P/L uses ORIGINAL COST BASIS from the RGL.`);
  console.log(`The difference = embedded pre-existing gain that inflates our "realized" but`);
  console.log(`is already counted in starting capital.\n`);

  const depositedTickers = ["LIT", "RGTZ", "GLW", "VLO", "DFFVX", "DFIVX", "DFLVX", "DSCGX"];
  for (const t of depositedTickers) {
    const trades = await db.execute(sql`
      SELECT symbol, position_size::text, entry_price::text, exit_price::text,
             actual_pnl::text, status, account_name
      FROM sentinel_trades
      WHERE user_id = 2 AND symbol = ${t}
      AND account_name ILIKE '%schwab%rollover%'
      ORDER BY entry_date
    `);
    if (trades.rows.length > 0) {
      for (const r of trades.rows as any[]) {
        console.log(
          `  ${r.symbol} (${r.status}) | qty: ${r.position_size} | cost: $${r.entry_price} | exit/mark: $${r.exit_price ?? "active"} | P/L: $${r.actual_pnl ?? "null"}`
        );
      }
    }
  }

  process.exit(0);
}
main();
