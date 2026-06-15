import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb, initializeDatabase } from "../db";

async function main() {
  await initializeDatabase();
  const db = getDb();

  await db.execute(sql`
    UPDATE sentinel_journal_cash_events
    SET amount = ${1058053}, label = 'Fidelity Jan 2 balance (from brokerage)'
    WHERE user_id = 2 AND broker_id = 'FIDELITY' AND event_kind = 'starting_equity'
  `);

  const r = await db.execute(sql`
    SELECT broker_id, event_date, amount::numeric, label, event_kind
    FROM sentinel_journal_cash_events
    WHERE user_id = 2 AND event_kind IN ('starting_equity', 'capital_injection')
    ORDER BY event_date
  `);
  let total = 0;
  console.log("Capital flows:");
  for (const row of r.rows as any[]) {
    const amt = parseFloat(row.amount);
    total += amt;
    console.log(`  ${row.broker_id} | ${row.event_date} | ${row.event_kind} | $${amt.toFixed(2)}`);
  }
  console.log(`Total capital: $${total.toFixed(2)}`);

  const fidelityGain = 1186769 - 1058053;
  console.log(`\nFidelity: $1,186,769 - $1,058,053 = $${fidelityGain.toLocaleString()} gain (${((fidelityGain/1058053)*100).toFixed(2)}%)`);

  process.exit(0);
}
main();
