import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb, initializeDatabase } from "../db";

async function main() {
  await initializeDatabase();
  const db = getDb();

  const summary = await db.execute(sql`
    SELECT account_name,
           count(*)::int as trades,
           sum(CASE WHEN actual_pnl > 0 THEN 1 ELSE 0 END)::int as wins,
           sum(CASE WHEN actual_pnl < 0 THEN 1 ELSE 0 END)::int as losses,
           sum(CASE WHEN actual_pnl = 0 OR actual_pnl IS NULL THEN 1 ELSE 0 END)::int as flat,
           round(sum(actual_pnl)::numeric, 2) as total_pnl,
           round(sum(CASE WHEN actual_pnl > 0 THEN actual_pnl ELSE 0 END)::numeric, 2) as gross_wins,
           round(sum(CASE WHEN actual_pnl < 0 THEN actual_pnl ELSE 0 END)::numeric, 2) as gross_losses
    FROM sentinel_trades
    WHERE user_id = 2
      AND status = 'closed'
      AND (account_name ilike '%schwab%' OR account_name ilike '%bene%' OR account_name ilike '%rollover%')
    GROUP BY account_name
    ORDER BY account_name
  `);

  console.log("=== Schwab Realized P&L by Account ===\n");
  let grandTotal = 0;
  for (const r of summary.rows) {
    const pnl = Number(r.total_pnl) || 0;
    grandTotal += pnl;
    console.log(`${r.account_name}:`);
    console.log(`  Closed trades: ${r.trades} (${r.wins}W / ${r.losses}L / ${r.flat} flat)`);
    console.log(`  Gross wins:   +$${Number(r.gross_wins).toLocaleString()}`);
    console.log(`  Gross losses: -$${Math.abs(Number(r.gross_losses)).toLocaleString()}`);
    console.log(`  Net P&L:      ${pnl >= 0 ? '+' : '-'}$${Math.abs(pnl).toLocaleString()}`);
    console.log();
  }
  console.log(`COMBINED SCHWAB NET P&L: ${grandTotal >= 0 ? '+' : '-'}$${Math.abs(grandTotal).toLocaleString()}`);

  // YTD only (2026)
  const ytd = await db.execute(sql`
    SELECT account_name,
           count(*)::int as trades,
           round(sum(actual_pnl)::numeric, 2) as total_pnl,
           round(sum(CASE WHEN actual_pnl > 0 THEN actual_pnl ELSE 0 END)::numeric, 2) as gross_wins,
           round(sum(CASE WHEN actual_pnl < 0 THEN actual_pnl ELSE 0 END)::numeric, 2) as gross_losses
    FROM sentinel_trades
    WHERE user_id = 2
      AND status = 'closed'
      AND (account_name ilike '%schwab%' OR account_name ilike '%bene%' OR account_name ilike '%rollover%')
      AND exit_date >= '2026-01-01'
    GROUP BY account_name
    ORDER BY account_name
  `);

  console.log("\n=== YTD 2026 Only ===\n");
  let ytdTotal = 0;
  for (const r of ytd.rows) {
    const pnl = Number(r.total_pnl) || 0;
    ytdTotal += pnl;
    console.log(`${r.account_name}: ${r.trades} trades | wins: +$${Number(r.gross_wins).toLocaleString()} | losses: -$${Math.abs(Number(r.gross_losses)).toLocaleString()} | net: ${pnl >= 0 ? '+' : '-'}$${Math.abs(pnl).toLocaleString()}`);
  }
  console.log(`\nCOMBINED SCHWAB YTD NET P&L: ${ytdTotal >= 0 ? '+' : '-'}$${Math.abs(ytdTotal).toLocaleString()}`);

  process.exit(0);
}
main();
