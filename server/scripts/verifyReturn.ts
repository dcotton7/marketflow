import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb, initializeDatabase } from "../db";
import { computeCapitalFlowReturn, type CapitalFlowEvent } from "@shared/trade-journal-cash-ledger";

async function main() {
  await initializeDatabase();
  const db = getDb();

  // Load capital flows for Schwab
  const flowRows = await db.execute(sql`
    SELECT event_date, amount::numeric, label, event_kind
    FROM sentinel_journal_cash_events
    WHERE user_id = 2 AND broker_id = 'SCHWAB'
      AND event_kind IN ('starting_equity', 'capital_injection', 'withdrawal')
    ORDER BY event_date
  `);
  const flows: CapitalFlowEvent[] = (flowRows.rows as any[]).map((r) => ({
    brokerId: "SCHWAB" as const,
    eventDate: r.event_date,
    amount: parseFloat(r.amount),
    kind: r.event_kind,
    label: r.label,
  }));
  console.log("Capital flows:");
  for (const f of flows) {
    console.log(`  ${f.eventDate} | ${f.kind} | $${f.amount.toFixed(2)} | ${f.label}`);
  }

  // Get current Schwab equity
  const cashResult = await db.execute(sql`
    SELECT SUM(cash_balance::numeric) as total
    FROM sentinel_imported_trades
    WHERE user_id = 2 AND ticker = '__TOS_CASH__' AND trade_date = '2026-06-08'
  `);
  const cash = parseFloat((cashResult.rows[0] as any).total);

  const posResult = await db.execute(sql`
    SELECT SUM(position_size * COALESCE(mark_price, entry_price))::numeric as total
    FROM sentinel_trades
    WHERE user_id = 2 AND status = 'active'
      AND (account_name ILIKE '%schwab%' OR account_name ILIKE '%bene%' OR account_name ILIKE '%rollover%')
  `);
  const posMarket = parseFloat((posResult.rows[0] as any).total);
  const currentEquity = cash + posMarket;

  console.log(`\nCash: $${cash.toFixed(2)}`);
  console.log(`Positions (market): $${posMarket.toFixed(2)}`);
  console.log(`Current equity: $${currentEquity.toFixed(2)}`);

  const totalCapital = flows.reduce((sum, f) => {
    if (f.kind === "starting_equity" || f.kind === "capital_injection") return sum + f.amount;
    if (f.kind === "withdrawal") return sum - f.amount;
    return sum;
  }, 0);
  console.log(`Total capital: $${totalCapital.toFixed(2)}`);
  console.log(`Gain: $${(currentEquity - totalCapital).toFixed(2)}`);

  const returnPct = computeCapitalFlowReturn(currentEquity, flows);
  console.log(`\nYTD Return: ${returnPct != null ? returnPct.toFixed(2) + "%" : "N/A"}`);

  process.exit(0);
}
main();
