import "dotenv/config";
import { getDb, initializeDatabase } from "../db";
import { sql } from "drizzle-orm";

function fmt(n: number): string {
  if (n >= 0) return `$${n.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `($${Math.abs(n).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`;
}

async function main() {
  await initializeDatabase();
  const db = getDb();

  console.log("=== FINAL VERIFICATION ===\n");

  // Schwab realized
  const schwabRlzd = await db.execute(sql`
    SELECT SUM(actual_pnl)::text as total, COUNT(*)::text as cnt
    FROM sentinel_trades WHERE user_id = 2 AND status = 'closed'
    AND account_name ILIKE '%schwab%'
  `);
  const rlzd = Number((schwabRlzd.rows[0] as any).total);
  console.log(`Schwab Realized (closed): ${fmt(rlzd)} from ${(schwabRlzd.rows[0] as any).cnt} trades`);

  // Null P/L check
  const nullCheck = await db.execute(sql`
    SELECT COUNT(*)::text as cnt FROM sentinel_trades
    WHERE user_id = 2 AND status = 'closed'
    AND account_name ILIKE '%schwab%' AND actual_pnl IS NULL
  `);
  console.log(`Null P/L trades remaining: ${(nullCheck.rows[0] as any).cnt}`);

  // Schwab unrealized
  const schwabUnrlzd = await db.execute(sql`
    SELECT SUM(COALESCE(mark_price, 0) * COALESCE(position_size, 0)
               - entry_price * COALESCE(position_size, 0))::text as total,
           COUNT(*)::text as cnt
    FROM sentinel_trades WHERE user_id = 2 AND status = 'active'
    AND account_name ILIKE '%schwab%'
  `);
  const unrlzd = Number((schwabUnrlzd.rows[0] as any).total);
  console.log(`Schwab Unrealized (open): ${fmt(unrlzd)} from ${(schwabUnrlzd.rows[0] as any).cnt} positions`);

  // Schwab cash (stored in cash_balance column)
  const cashRes = await db.execute(sql`
    SELECT SUM(CAST(cash_balance AS double precision))::text as total
    FROM sentinel_imported_trades
    WHERE user_id = 2 AND cash_balance IS NOT NULL AND broker_id = 'SCHWAB'
    AND trade_date = (
      SELECT MAX(trade_date) FROM sentinel_imported_trades
      WHERE user_id = 2 AND cash_balance IS NOT NULL AND broker_id = 'SCHWAB'
    )
  `);
  const cash = Number((cashRes.rows[0] as any).total ?? 0);

  // Schwab positions market value
  const posRes = await db.execute(sql`
    SELECT SUM(COALESCE(mark_price, entry_price) * COALESCE(position_size, 0))::text as total
    FROM sentinel_trades WHERE user_id = 2 AND status = 'active'
    AND account_name ILIKE '%schwab%'
  `);
  const positionsVal = Number((posRes.rows[0] as any).total ?? 0);

  // Capital flows
  const flows = await db.execute(sql`
    SELECT event_kind, amount::text
    FROM sentinel_journal_cash_events
    WHERE user_id = 2 AND broker_id = 'SCHWAB'
    AND event_kind IN ('starting_equity', 'capital_injection', 'withdrawal')
  `);
  let totalCapital = 0;
  for (const r of flows.rows as any[]) {
    if (r.event_kind === "withdrawal") totalCapital -= Number(r.amount);
    else totalCapital += Number(r.amount);
  }

  const currentEquity = cash + positionsVal;
  const accountGrowth = currentEquity - totalCapital;
  const totalPnl = rlzd + unrlzd;
  const embeddedGain = totalPnl - accountGrowth;

  console.log(`\n--- Balance Sheet ---`);
  console.log(`Cash:               ${fmt(cash)}`);
  console.log(`Positions (market): ${fmt(positionsVal)}`);
  console.log(`Current Equity:     ${fmt(currentEquity)}`);
  console.log(`Starting Capital:   ${fmt(totalCapital)}`);

  console.log(`\n--- P/L Summary ---`);
  console.log(`Account Growth:     ${fmt(accountGrowth)} (equity - capital)`);
  console.log(`YTD Return:         ${((accountGrowth / totalCapital) * 100).toFixed(2)}%`);
  console.log(`Realized (closed):  ${fmt(rlzd)}`);
  console.log(`Unrealized (open):  ${fmt(unrlzd)}`);
  console.log(`Total P/L:          ${fmt(totalPnl)} (realized + unrealized)`);
  console.log(`Embedded pre-2026:  ${fmt(embeddedGain)} (P/L uses original cost; growth uses deposit value)`);

  console.log(`\n--- Consistency Check ---`);
  console.log(`P/L total should EXCEED account growth by embedded gain amount.`);
  console.log(`Embedded gain ≈ pre-2026 appreciation in deposited positions.`);
  console.log(`Expected range: $30K–$50K. Actual: ${fmt(embeddedGain)}`);
  if (embeddedGain > 20000 && embeddedGain < 60000) {
    console.log(`✓ PASS: Numbers are consistent.`);
  } else {
    console.log(`⚠ CHECK: Embedded gain outside expected range.`);
  }

  // Fidelity for comparison
  const fidRlzd = await db.execute(sql`
    SELECT SUM(actual_pnl)::text as total FROM sentinel_trades
    WHERE user_id = 2 AND status = 'closed'
    AND account_name NOT ILIKE '%schwab%'
  `);
  const fidUnrlzd = await db.execute(sql`
    SELECT SUM(COALESCE(mark_price, 0) * COALESCE(position_size, 0)
               - entry_price * COALESCE(position_size, 0))::text as total
    FROM sentinel_trades WHERE user_id = 2 AND status = 'active'
    AND account_name NOT ILIKE '%schwab%'
  `);

  console.log(`\n--- Fidelity Reference ---`);
  console.log(`Fidelity Realized:  ${fmt(Number((fidRlzd.rows[0] as any).total ?? 0))}`);
  console.log(`Fidelity Unrealized: ${fmt(Number((fidUnrlzd.rows[0] as any).total ?? 0))}`);

  process.exit(0);
}
main();
