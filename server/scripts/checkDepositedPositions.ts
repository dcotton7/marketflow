import "dotenv/config";
import { getDb, initializeDatabase } from "../db";
import { sql } from "drizzle-orm";

const DEPOSITED = ["GLW", "LIT", "RGTZ", "VLO"];

async function main() {
  await initializeDatabase();
  const db = getDb();

  console.log("=== Deposited position tickers in sentinel_trades ===\n");
  for (const t of DEPOSITED) {
    const r = await db.execute(sql`
      SELECT symbol, status, entry_date::text, exit_date::text,
             actual_pnl::text, position_size::text, entry_price::text,
             exit_price::text, account_name
      FROM sentinel_trades
      WHERE user_id = 2 AND symbol = ${t}
      ORDER BY entry_date
    `);
    console.log(`${t}: ${r.rows.length} trades`);
    for (const row of r.rows as any[]) {
      console.log(
        `  ${row.status} | ${row.entry_date?.slice(0, 10)} -> ${row.exit_date?.slice(0, 10) ?? "open"} | size: ${row.position_size} | entry: $${row.entry_price} | exit: $${row.exit_price ?? "-"} | P/L: $${row.actual_pnl ?? "-"} | ${row.account_name}`
      );
    }
    console.log();
  }

  console.log("=== Total Schwab closed actual_pnl ===\n");
  const tot = await db.execute(sql`
    SELECT SUM(actual_pnl)::text as total, COUNT(*)::text as cnt
    FROM sentinel_trades
    WHERE user_id = 2 AND status = 'closed'
    AND account_name ILIKE '%schwab%'
  `);
  console.log("Total:", tot.rows[0]);

  console.log("\n=== Top 15 tickers by absolute P/L ===\n");
  const top = await db.execute(sql`
    SELECT symbol, SUM(actual_pnl)::text as pnl, COUNT(*)::text as cnt
    FROM sentinel_trades
    WHERE user_id = 2 AND status = 'closed' AND account_name ILIKE '%schwab%'
    GROUP BY symbol
    ORDER BY ABS(SUM(actual_pnl)) DESC
    LIMIT 15
  `);
  for (const r of top.rows as any[]) {
    console.log(`  ${r.symbol}: $${Number(r.pnl).toFixed(2)} (${r.cnt} trades)`);
  }

  console.log("\n=== Deposited tickers in sentinel_imported_trades ===\n");
  for (const t of DEPOSITED) {
    const r = await db.execute(sql`
      SELECT ticker, direction, trade_date, quantity::text, price::text,
             net_amount::text, broker_id
      FROM sentinel_imported_trades
      WHERE user_id = 2 AND ticker = ${t}
      ORDER BY trade_date
    `);
    console.log(`${t}: ${r.rows.length} imported rows`);
    for (const row of r.rows as any[]) {
      console.log(
        `  ${row.direction} | ${row.trade_date} | qty: ${row.quantity} | price: $${row.price} | net: $${row.net_amount} | ${row.broker_id}`
      );
    }
  }

  console.log("\n=== TOS P/L YTD reference (from CSV) ===");
  console.log("  GLW:  $40,595.87");
  console.log("  LIT:  $32,467.50");
  console.log("  RGTZ: $15,082.52");
  console.log("  VLO:  $58,964.49");
  console.log("  TOTAL: $147,110.38");

  process.exit(0);
}
main();
