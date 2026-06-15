import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb, initializeDatabase } from "../db";

const USER_ID = 2;

async function main() {
  await initializeDatabase();
  const db = getDb();

  // Clear any existing capital flow events for Schwab
  await db.execute(sql`
    DELETE FROM sentinel_journal_cash_events
    WHERE user_id = ${USER_ID} AND broker_id = 'SCHWAB'
      AND event_kind IN ('starting_equity', 'capital_injection')
  `);

  // Jan 1 2026: Schwab Designated Bene total = $116,383 (user provided)
  await db.execute(sql`
    INSERT INTO sentinel_journal_cash_events
      (user_id, broker_id, event_date, amount, label, event_kind)
    VALUES
      (${USER_ID}, 'SCHWAB', '2026-01-01', ${116383}, 'Designated Bene starting balance', 'starting_equity')
  `);

  // Feb 17 2026: Rollover IRA deposit = $576,225 (user provided: $694,703 - $118,478 Designated Bene)
  await db.execute(sql`
    INSERT INTO sentinel_journal_cash_events
      (user_id, broker_id, event_date, amount, label, event_kind)
    VALUES
      (${USER_ID}, 'SCHWAB', '2026-02-17', ${576225}, 'Rollover IRA transfer', 'capital_injection')
  `);

  console.log("Inserted Schwab capital flow events:");
  console.log("  Jan 1 starting equity: $116,383");
  console.log("  Feb 17 IRA injection:  $576,225");
  console.log("  Total capital base:    $692,608");

  // Verify
  const rows = await db.execute(sql`
    SELECT event_date, amount, label, event_kind
    FROM sentinel_journal_cash_events
    WHERE user_id = ${USER_ID} AND broker_id = 'SCHWAB'
    ORDER BY event_date
  `);
  console.log("\nAll Schwab events:");
  for (const row of rows.rows as any[]) {
    console.log(`  ${row.event_date} | ${row.event_kind} | $${parseFloat(row.amount).toFixed(2)} | ${row.label}`);
  }

  process.exit(0);
}
main();
