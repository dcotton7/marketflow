import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { getDb, initializeDatabase } from "../db";

async function main() {
  await initializeDatabase();
  const db = getDb();

  // Schwab realized P&L summary by account
  const pnl = await db.execute(sql`
    SELECT account_name,
           count(*)::int as trades,
           sum(actual_pnl)::numeric as total_pnl,
           sum(CASE WHEN actual_pnl > 0 THEN actual_pnl ELSE 0 END)::numeric as wins,
           sum(CASE WHEN actual_pnl < 0 THEN actual_pnl ELSE 0 END)::numeric as losses
    FROM sentinel_trades
    WHERE user_id = 2
      AND status = 'CLOSED'
      AND (account_name ilike '%schwab%' OR account_name ilike '%bene%' OR account_name ilike '%rollover%')
    GROUP BY account_name
    ORDER BY account_name
  `);
  console.log("Schwab closed trades by account:");
  for (const r of pnl.rows as any[]) {
    console.log(`  ${r.account_name}: ${r.trades} trades, P&L: $${Number(r.total_pnl).toLocaleString("en-US", {minimumFractionDigits: 2})} (wins: $${Number(r.wins).toLocaleString("en-US", {minimumFractionDigits: 2})}, losses: $${Number(r.losses).toLocaleString("en-US", {minimumFractionDigits: 2})})`);
  }

  // Check for mutual fund symbols (typically 5 chars ending in X)
  const mutualFunds = await db.execute(sql`
    SELECT symbol, account_name, direction, status, actual_pnl::numeric as realized_pnl,
           entry_date::text, exit_date::text
    FROM sentinel_trades
    WHERE user_id = 2
      AND (account_name ilike '%schwab%' OR account_name ilike '%bene%' OR account_name ilike '%rollover%')
      AND (length(symbol) = 5 AND symbol LIKE '%X'
           OR symbol IN ('SWPPX','SWISX','SCHD','SCHX','SCHB','SCHF','SCHE','SCHZ','SWTSX'))
    ORDER BY symbol, entry_date
  `);
  console.log(`\nMutual fund / ETF trades found: ${mutualFunds.rows.length}`);
  for (const r of mutualFunds.rows as any[]) {
    console.log(`  ${r.symbol} | ${r.account_name} | ${r.direction} ${r.status} | P&L: $${Number(r.realized_pnl || 0).toLocaleString("en-US", {minimumFractionDigits: 2})} | ${r.entry_date} → ${r.exit_date || "open"}`);
  }

  // Top 10 biggest Schwab gains
  const topGains = await db.execute(sql`
    SELECT symbol, account_name, actual_pnl::numeric as realized_pnl, exit_date::text
    FROM sentinel_trades
    WHERE user_id = 2
      AND status = 'CLOSED'
      AND (account_name ilike '%schwab%' OR account_name ilike '%bene%' OR account_name ilike '%rollover%')
    ORDER BY actual_pnl DESC
    LIMIT 10
  `);
  console.log("\nTop 10 Schwab gains:");
  for (const r of topGains.rows as any[]) {
    console.log(`  ${r.symbol} | $${Number(r.realized_pnl).toLocaleString("en-US", {minimumFractionDigits: 2})} | ${r.exit_date} | ${r.account_name}`);
  }

  // Total Schwab YTD realized
  const ytd = await db.execute(sql`
    SELECT sum(actual_pnl)::numeric as ytd_pnl,
           count(*)::int as trade_count
    FROM sentinel_trades
    WHERE user_id = 2
      AND status = 'CLOSED'
      AND (account_name ilike '%schwab%' OR account_name ilike '%bene%' OR account_name ilike '%rollover%')
      AND exit_date >= '2026-01-01'
  `);
  const ytdRow = ytd.rows[0] as any;
  console.log(`\nSchwab YTD realized P&L: $${Number(ytdRow.ytd_pnl || 0).toLocaleString("en-US", {minimumFractionDigits: 2})} across ${ytdRow.trade_count} closed trades`);

  // Active positions
  const active = await db.execute(sql`
    SELECT symbol, account_name, entry_price::numeric, position_size::int,
           (entry_price * COALESCE(position_size, 0))::numeric as cost_basis
    FROM sentinel_trades
    WHERE user_id = 2
      AND status = 'ACTIVE'
      AND (account_name ilike '%schwab%' OR account_name ilike '%bene%' OR account_name ilike '%rollover%')
    ORDER BY cost_basis DESC
  `);
  console.log(`\nSchwab active positions: ${active.rows.length}`);
  let totalCost = 0;
  for (const r of active.rows as any[]) {
    const cost = Number(r.cost_basis);
    totalCost += cost;
    console.log(`  ${r.symbol} | ${r.position_size} shares @ $${Number(r.entry_price).toFixed(2)} = $${cost.toLocaleString("en-US", {minimumFractionDigits: 2})} | ${r.account_name}`);
  }
  console.log(`  TOTAL cost basis: $${totalCost.toLocaleString("en-US", {minimumFractionDigits: 2})}`);

  process.exit(0);
}
main();
