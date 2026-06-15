import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb, initializeDatabase } from "../db";

async function main() {
  await initializeDatabase();
  const db = getDb();

  const r = await db.execute(sql`
    SELECT broker_id, direction, count(*)::int as cnt
    FROM sentinel_imported_trades
    WHERE user_id = 2
    GROUP BY broker_id, direction
    ORDER BY broker_id, direction
  `);
  console.log("Imported trade rows by broker+direction:");
  for (const row of r.rows as any[]) {
    console.log(`  ${row.broker_id} | ${row.direction} | ${row.cnt}`);
  }

  // Schwab non-cash rows
  const schwab = await db.execute(sql`
    SELECT count(*)::int as cnt
    FROM sentinel_imported_trades
    WHERE user_id = 2 AND broker_id = 'SCHWAB' AND ticker != '__TOS_CASH__'
  `);
  console.log(`\nSchwab non-cash imported rows: ${(schwab.rows[0] as any).cnt}`);

  process.exit(0);
}
main();
