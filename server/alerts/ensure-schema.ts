import { sql } from "drizzle-orm";
import { getDb } from "../db";

/**
 * Additive only (nullable columns, a new table), run at boot before routes: shared/schema.ts selects these columns,
 * so they must exist before any watchlist query runs.
 */
const STATEMENTS = [
  sql`alter table sentinel_watchlist add column if not exists shares double precision`,
  sql`alter table sentinel_watchlist add column if not exists entry_date date`,
];

export async function ensurePositionSchema(): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  for (const statement of STATEMENTS) await db.execute(statement);
  return true;
}
