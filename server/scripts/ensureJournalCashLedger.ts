import "dotenv/config";
import { readFileSync } from "fs";
import { join } from "path";
import { sql } from "drizzle-orm";
import { getDb, initializeDatabase } from "../db";

async function main() {
  await initializeDatabase();
  const db = getDb();
  if (!db) {
    console.error("Database unavailable");
    process.exit(1);
  }
  for (const file of ["015_journal_cash_ledger.sql", "016_journal_cash_discrepancy.sql"]) {
    const migration = readFileSync(join(process.cwd(), "migrations", file), "utf8");
    await db.execute(sql.raw(migration));
  }
  console.log("Journal cash ledger tables ensured");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
