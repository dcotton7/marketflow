import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb, initializeDatabase } from "../db";

async function main() {
  await initializeDatabase();
  const db = getDb();

  // Check TOS cash rows per account
  const rows = await db.execute(sql`
    SELECT account_name, count(*)::int as cnt,
           min(cash_balance)::numeric as min_cash,
           max(cash_balance)::numeric as max_cash
    FROM sentinel_imported_trades
    WHERE user_id = 2 AND ticker = '__TOS_CASH__'
    GROUP BY account_name
  `);
  console.log("TOS cash rows in DB:");
  for (const r of rows.rows as any[]) {
    console.log(`  ${r.account_name}: ${r.cnt} rows, cash range $${Number(r.min_cash).toFixed(2)} → $${Number(r.max_cash).toFixed(2)}`);
  }

  // Latest cash per account
  const latest = await db.execute(sql`
    SELECT account_name, trade_date, cash_balance::numeric
    FROM sentinel_imported_trades
    WHERE user_id = 2 AND ticker = '__TOS_CASH__'
      AND trade_date = (
        SELECT max(trade_date) FROM sentinel_imported_trades
        WHERE user_id = 2 AND ticker = '__TOS_CASH__'
      )
    ORDER BY account_name
  `);
  console.log("\nLatest cash per account:");
  let total = 0;
  for (const r of latest.rows as any[]) {
    const cash = Number(r.cash_balance);
    total += cash;
    console.log(`  ${r.account_name}: ${r.trade_date} → $${cash.toLocaleString("en-US", {minimumFractionDigits: 2})}`);
  }
  console.log(`  COMBINED: $${total.toLocaleString("en-US", {minimumFractionDigits: 2})}`);

  // What TOS says the current cash is
  console.log("\nExpected from TOS:");
  console.log("  Rollover IRA current cash: $532,810.02 (start of day) or $184,715.94 (after today's trades)");
  console.log("  Designated Bene current cash: $142,553.68 (start of day) or $124,289.15 (after today's trades)");
  console.log("  Combined start-of-day: $675,363.70");
  console.log("  Combined after today's trades: $309,005.09");

  // Check Jan 1
  const jan1 = await db.execute(sql`
    SELECT account_name, cash_balance::numeric
    FROM sentinel_imported_trades
    WHERE user_id = 2 AND ticker = '__TOS_CASH__' AND trade_date = '2026-01-01'
    ORDER BY account_name
  `);
  console.log("\nJan 1 cash:");
  let jan1Total = 0;
  for (const r of jan1.rows as any[]) {
    const cash = Number(r.cash_balance);
    jan1Total += cash;
    console.log(`  ${r.account_name}: $${cash.toLocaleString("en-US", {minimumFractionDigits: 2})}`);
  }
  console.log(`  COMBINED: $${jan1Total.toLocaleString("en-US", {minimumFractionDigits: 2})}`);

  // Check if anchors/events are still around
  const anchors = await db.execute(sql`
    SELECT * FROM sentinel_journal_cash_anchor WHERE user_id = 2
  `);
  console.log(`\nRemaining anchors: ${anchors.rows.length}`);
  const events = await db.execute(sql`
    SELECT * FROM sentinel_journal_cash_events WHERE user_id = 2
  `);
  console.log(`Remaining events: ${events.rows.length}`);

  // Check what buildDailyCashByBroker would see - ALL imported Schwab rows with cash
  const allSchwabCash = await db.execute(sql`
    SELECT trade_date, account_name, cash_balance::numeric, id
    FROM sentinel_imported_trades
    WHERE user_id = 2 AND broker_id = 'SCHWAB' AND cash_balance IS NOT NULL
    ORDER BY trade_date DESC
    LIMIT 10
  `);
  console.log("\nLatest 10 Schwab imported rows with cash:");
  for (const r of allSchwabCash.rows as any[]) {
    console.log(`  ${r.trade_date} | id:${r.id} | $${Number(r.cash_balance).toLocaleString("en-US", {minimumFractionDigits: 2})} | ${r.account_name}`);
  }

  process.exit(0);
}
main();
