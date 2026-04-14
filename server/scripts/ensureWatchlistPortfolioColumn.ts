import { sql } from "drizzle-orm";
import { getDb, initializeDatabase } from "../db";

async function main() {
  await initializeDatabase();
  const db = getDb();
  if (!db) {
    throw new Error("Database not available");
  }
  await db.execute(
    sql`alter table watchlists add column if not exists is_portfolio boolean default false`
  );
  console.log("watchlists.is_portfolio ready");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

