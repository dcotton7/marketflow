import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { getDb, initializeDatabase } from "../db";
import { sentinelImportBatches, sentinelImportedTrades } from "@shared/schema";

async function main() {
  await initializeDatabase();
  const db = getDb();

  const batches = await db.execute(sql`
    SELECT id, batch_id, broker_id, file_name, status,
           total_trades_found, total_trades_imported,
           created_at
    FROM sentinel_import_batches
    WHERE user_id = 2
    ORDER BY id
  `);
  console.log("Batches:");
  for (const b of batches.rows) {
    console.log(`  #${b.id} | ${b.status} | found:${b.total_trades_found} imported:${b.total_trades_imported} | ${b.broker_id} | ${b.file_name}`);
  }

  const importCount = await db.execute(sql`
    SELECT count(*)::int as cnt FROM sentinel_imported_trades WHERE user_id = 2
  `);
  console.log("\nImported trade rows:", importCount.rows[0]?.cnt);

  const batchIds = batches.rows.map(b => b.batch_id);
  if (batchIds.length > 0) {
    for (const bid of batchIds) {
      const cnt = await db.execute(sql`
        SELECT count(*)::int as cnt FROM sentinel_imported_trades WHERE batch_id = ${bid}
      `);
      console.log(`  batch ${bid}: ${cnt.rows[0]?.cnt} rows`);
    }
  }

  process.exit(0);
}
main();
