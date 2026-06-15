import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb, initializeDatabase } from "../db";

async function main() {
  await initializeDatabase();
  const db = getDb();

  // Jan 1 cash from TOS BAL
  const jan1 = await db.execute(sql`
    SELECT account_name, cash_balance::numeric as cash
    FROM sentinel_imported_trades
    WHERE user_id = 2 AND ticker = '__TOS_CASH__' AND trade_date = '2026-01-01'
  `);
  let jan1Cash = 0;
  console.log("Jan 1 Schwab cash:");
  for (const row of jan1.rows as any[]) {
    const c = parseFloat(row.cash);
    jan1Cash += c;
    console.log(`  ${row.account_name}: $${c.toFixed(2)}`);
  }
  console.log(`  Total: $${jan1Cash.toFixed(2)}`);

  // Feb 17 cash (IRA rollover day)
  const feb17 = await db.execute(sql`
    SELECT account_name, cash_balance::numeric as cash
    FROM sentinel_imported_trades
    WHERE user_id = 2 AND ticker = '__TOS_CASH__' AND trade_date = '2026-02-17'
  `);
  let feb17Cash = 0;
  console.log("\nFeb 17 Schwab cash (IRA rollover day):");
  for (const row of feb17.rows as any[]) {
    const c = parseFloat(row.cash);
    feb17Cash += c;
    console.log(`  ${row.account_name}: $${c.toFixed(2)}`);
  }
  console.log(`  Total: $${feb17Cash.toFixed(2)}`);

  // Feb 16 cash (day before rollover)
  const feb16 = await db.execute(sql`
    SELECT account_name, cash_balance::numeric as cash
    FROM sentinel_imported_trades
    WHERE user_id = 2 AND ticker = '__TOS_CASH__' AND trade_date = '2026-02-16'
  `);
  let feb16Cash = 0;
  console.log("\nFeb 16 cash (day before rollover):");
  for (const row of feb16.rows as any[]) {
    const c = parseFloat(row.cash);
    feb16Cash += c;
    console.log(`  ${row.account_name}: $${c.toFixed(2)}`);
  }
  console.log(`  Total: $${feb16Cash.toFixed(2)}`);
  console.log(`  Implied injection: $${(feb17Cash - feb16Cash).toFixed(2)}`);

  // Current
  const current = await db.execute(sql`
    SELECT account_name, cash_balance::numeric as cash
    FROM sentinel_imported_trades
    WHERE user_id = 2 AND ticker = '__TOS_CASH__' AND trade_date = '2026-06-08'
  `);
  let currentCash = 0;
  console.log("\nJun 8 Schwab cash (current):");
  for (const row of current.rows as any[]) {
    const c = parseFloat(row.cash);
    currentCash += c;
    console.log(`  ${row.account_name}: $${c.toFixed(2)}`);
  }
  console.log(`  Total: $${currentCash.toFixed(2)}`);

  // Schwab positions
  const pos = await db.execute(sql`
    SELECT symbol, position_size::numeric as qty, entry_price::numeric as cost,
           mark_price::numeric as mark,
           (position_size * COALESCE(mark_price, entry_price))::numeric(15,2) as market_val
    FROM sentinel_trades
    WHERE user_id = 2 AND status = 'active'
      AND (account_name ILIKE '%schwab%' OR account_name ILIKE '%bene%' OR account_name ILIKE '%rollover%')
  `);
  let posMarket = 0;
  let posCost = 0;
  for (const row of pos.rows as any[]) {
    posMarket += parseFloat(row.market_val);
    posCost += parseFloat(row.qty) * parseFloat(row.cost);
  }

  console.log(`\nPositions: cost=$${posCost.toFixed(2)}, market=$${posMarket.toFixed(2)}, unrealized=$${(posMarket - posCost).toFixed(2)}`);
  console.log(`\nCurrent total: $${(currentCash + posMarket).toFixed(2)}`);

  // Schwab YTD realized
  const ytd = await db.execute(sql`
    SELECT sum(actual_pnl)::numeric as pnl, count(*)::int as cnt
    FROM sentinel_trades
    WHERE user_id = 2 AND status = 'closed'
      AND (account_name ILIKE '%schwab%' OR account_name ILIKE '%bene%' OR account_name ILIKE '%rollover%')
      AND exit_date >= '2026-01-01'
  `);
  const ytdRow = ytd.rows[0] as any;
  console.log(`\nYTD Schwab realized: $${parseFloat(ytdRow.pnl).toFixed(2)} from ${ytdRow.cnt} trades`);

  // First Rollover IRA BAL entry (when did it appear?)
  const firstIra = await db.execute(sql`
    SELECT trade_date, cash_balance::numeric as cash
    FROM sentinel_imported_trades
    WHERE user_id = 2 AND ticker = '__TOS_CASH__' AND account_name = 'Schwab Rollover IRA'
    ORDER BY trade_date ASC LIMIT 3
  `);
  console.log("\nFirst Rollover IRA BAL entries:");
  for (const row of firstIra.rows as any[]) {
    console.log(`  ${(row as any).trade_date}: $${parseFloat((row as any).cash).toFixed(2)}`);
  }

  process.exit(0);
}
main();
