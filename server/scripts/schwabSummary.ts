import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb, initializeDatabase } from "../db";

async function main() {
  await initializeDatabase();
  const db = getDb();

  const pnl = await db.execute(sql`
    SELECT account_name,
           count(*)::int as trades,
           sum(actual_pnl)::numeric as total_pnl,
           sum(CASE WHEN actual_pnl > 0 THEN actual_pnl ELSE 0 END)::numeric as wins,
           sum(CASE WHEN actual_pnl < 0 THEN actual_pnl ELSE 0 END)::numeric as losses
    FROM sentinel_trades
    WHERE user_id = 2
      AND status = 'closed'
      AND account_name IN ('Schwab Rollover IRA', 'Schwab Designated Bene Individual')
    GROUP BY account_name
    ORDER BY account_name
  `);
  console.log("Schwab closed trades P&L by account:");
  for (const r of pnl.rows as any[]) {
    console.log(`  ${r.account_name}: ${r.trades} trades, P&L: $${Number(r.total_pnl).toLocaleString("en-US", {minimumFractionDigits: 2})} (wins: $${Number(r.wins).toLocaleString("en-US", {minimumFractionDigits: 2})}, losses: $${Number(r.losses).toLocaleString("en-US", {minimumFractionDigits: 2})})`);
  }

  const ytd = await db.execute(sql`
    SELECT sum(actual_pnl)::numeric as ytd_pnl, count(*)::int as cnt
    FROM sentinel_trades
    WHERE user_id = 2 AND status = 'closed'
      AND account_name IN ('Schwab Rollover IRA', 'Schwab Designated Bene Individual')
      AND exit_date >= '2026-01-01'
  `);
  const y = ytd.rows[0] as any;
  console.log(`\nSchwab COMBINED YTD realized P&L: $${Number(y.ytd_pnl || 0).toLocaleString("en-US", {minimumFractionDigits: 2})} (${y.cnt} trades)`);

  // Mutual fund symbols
  const mf = await db.execute(sql`
    SELECT symbol, account_name, status, actual_pnl::numeric, entry_date::text, exit_date::text
    FROM sentinel_trades
    WHERE user_id = 2
      AND account_name IN ('Schwab Rollover IRA', 'Schwab Designated Bene Individual')
      AND (length(symbol) = 5 AND symbol LIKE '%X')
    ORDER BY symbol
  `);
  console.log(`\nMutual fund trades (5-char ending in X): ${mf.rows.length}`);
  for (const r of mf.rows as any[]) {
    console.log(`  ${r.symbol} | ${r.account_name} | ${r.status} | P&L: $${Number(r.actual_pnl || 0).toFixed(2)} | ${r.entry_date} → ${r.exit_date || "open"}`);
  }

  // Active positions with cost basis
  const active = await db.execute(sql`
    SELECT symbol, account_name, entry_price::numeric, position_size::int,
           (entry_price * COALESCE(position_size, 0))::numeric as cost_basis
    FROM sentinel_trades
    WHERE user_id = 2 AND status = 'active'
      AND account_name IN ('Schwab Rollover IRA', 'Schwab Designated Bene Individual')
    ORDER BY cost_basis DESC
  `);
  let totalCost = 0;
  console.log(`\nSchwab active positions: ${active.rows.length}`);
  for (const r of active.rows as any[]) {
    const cost = Number(r.cost_basis);
    totalCost += cost;
    console.log(`  ${r.symbol} | ${r.position_size} @ $${Number(r.entry_price).toFixed(2)} = $${cost.toLocaleString("en-US", {minimumFractionDigits: 2})} | ${r.account_name}`);
  }
  console.log(`  TOTAL active cost basis: $${totalCost.toLocaleString("en-US", {minimumFractionDigits: 2})}`);

  // Current DB cash state
  const anchors = await db.execute(sql`
    SELECT broker_id, anchor_date, anchor_cash::numeric
    FROM sentinel_journal_cash_anchor WHERE user_id = 2
  `);
  console.log("\nCash anchors in DB:");
  for (const r of anchors.rows as any[]) {
    console.log(`  ${r.broker_id} | date:${r.anchor_date} | cash:$${Number(r.anchor_cash).toLocaleString("en-US", {minimumFractionDigits: 2})}`);
  }
  const events = await db.execute(sql`
    SELECT broker_id, event_date, amount::numeric, label
    FROM sentinel_journal_cash_events WHERE user_id = 2
  `);
  console.log("Cash events in DB:");
  for (const r of events.rows as any[]) {
    console.log(`  ${r.broker_id} | date:${r.event_date} | amount:$${Number(r.amount).toLocaleString("en-US", {minimumFractionDigits: 2})} | ${r.label}`);
  }

  process.exit(0);
}
main();
