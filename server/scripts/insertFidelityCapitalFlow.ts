import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb, initializeDatabase } from "../db";

const USER_ID = 2;

async function main() {
  await initializeDatabase();
  const db = getDb();

  // Compute Fidelity starting equity from implied method (safe: no injections, unrealized=0)
  // From server data: total=$1,185,514.05, realized=$120,673.53, unrealized=$0
  const fidelityStart = 1185514.05 - 120673.53;
  console.log(`Fidelity implied starting equity: $${fidelityStart.toFixed(2)}`);

  await db.execute(sql`
    DELETE FROM sentinel_journal_cash_events
    WHERE user_id = ${USER_ID} AND broker_id = 'FIDELITY'
      AND event_kind IN ('starting_equity', 'capital_injection')
  `);

  await db.execute(sql`
    INSERT INTO sentinel_journal_cash_events
      (user_id, broker_id, event_date, amount, label, event_kind)
    VALUES
      (${USER_ID}, 'FIDELITY', '2026-01-01', ${fidelityStart}, 'Fidelity starting balance (computed)', 'starting_equity')
  `);

  console.log(`Inserted Fidelity starting equity: $${fidelityStart.toFixed(2)}`);

  // Verify ALL capital flows
  const rows = await db.execute(sql`
    SELECT broker_id, event_date, amount::numeric, label, event_kind
    FROM sentinel_journal_cash_events
    WHERE user_id = ${USER_ID}
      AND event_kind IN ('starting_equity', 'capital_injection')
    ORDER BY event_date
  `);
  let totalCapital = 0;
  console.log("\nAll capital flows:");
  for (const row of rows.rows as any[]) {
    const amt = parseFloat(row.amount);
    totalCapital += amt;
    console.log(`  ${row.broker_id} | ${row.event_date} | ${row.event_kind} | $${amt.toFixed(2)} | ${row.label}`);
  }
  console.log(`Total capital: $${totalCapital.toFixed(2)}`);

  process.exit(0);
}
main();
