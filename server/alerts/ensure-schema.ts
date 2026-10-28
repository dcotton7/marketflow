import { sql } from "drizzle-orm";
import { getDb } from "../db";

/**
 * Additive only (nullable columns, a new table), run at boot before routes: shared/schema.ts selects these columns,
 * so they must exist before any watchlist query runs.
 */
const STATEMENTS = [
  sql`alter table sentinel_watchlist add column if not exists shares double precision`,
  sql`alter table sentinel_watchlist add column if not exists entry_date date`,
  sql`create table if not exists position_alerts (
    id serial primary key,
    user_id integer not null,
    watchlist_item_id integer,
    symbol text not null,
    rule text not null,
    level text not null,
    message text not null,
    payload jsonb,
    dedupe_key text not null,
    created_at timestamp default now(),
    constraint position_alerts_dedupe_key_unique unique (dedupe_key)
  )`,
  sql`create index if not exists position_alerts_user_id on position_alerts (user_id, id)`,
];

export async function ensurePositionSchema(): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  for (const statement of STATEMENTS) await db.execute(statement);
  return true;
}
