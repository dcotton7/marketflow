import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb, initializeDatabase } from "../db";

async function main() {
  await initializeDatabase();
  const db = getDb();

  const earlyTrades = await db.execute(sql`
    SELECT symbol, direction, entry_price, position_size, entry_date::text,
           exit_price, exit_date::text, status, actual_pnl, account_name
    FROM sentinel_trades
    WHERE user_id = 2
      AND (account_name ilike '%rollover%')
      AND entry_date < '2026-03-01'
    ORDER BY entry_date
  `);
  console.log("Rollover IRA trades before Mar 1:");
  for (const r of earlyTrades.rows) {
    console.log(`  ${r.entry_date?.toString().slice(0,10)} | ${r.symbol} | ${r.direction} | qty:${r.position_size} @ $${r.entry_price} | status:${r.status} | exit:${r.exit_date?.toString().slice(0,10) || '-'} @ $${r.exit_price || '-'} | pnl:${r.actual_pnl || '-'}`);
  }

  const desigEarly = await db.execute(sql`
    SELECT symbol, direction, entry_price, position_size, entry_date::text,
           exit_price, exit_date::text, status, actual_pnl, account_name
    FROM sentinel_trades
    WHERE user_id = 2
      AND (account_name ilike '%bene%' OR account_name ilike '%designated%')
      AND entry_date < '2026-02-01'
    ORDER BY entry_date DESC
    LIMIT 15
  `);
  console.log("\nDesignated Bene trades before Feb 1 (last 15):");
  for (const r of desigEarly.rows) {
    console.log(`  ${r.entry_date?.toString().slice(0,10)} | ${r.symbol} | ${r.direction} | qty:${r.position_size} @ $${r.entry_price} | status:${r.status}`);
  }

  process.exit(0);
}
main();
