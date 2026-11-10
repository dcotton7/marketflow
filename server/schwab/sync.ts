import type { SchwabPosition } from "./rest";
import type { Queryable } from "./store";

/**
 * Schwab positions into one portfolio list, "Schwab positions". The sync never writes to another list and never
 * deletes or changes a row it did not create (schwab_synced_rows records the ones it did). On its own rows it sets
 * only shares, entry and side, so his stop, target and notes stay. A position he already tracks in another
 * portfolio list is left out, so the position alerts don't fire twice.
 */
export const SYNC_LIST_NAME = "Schwab positions";

export interface ListRow {
  id: number;
  symbol: string;
  direction: string | null;
  shares: number | null;
  targetEntry: number | null;
}

export interface SyncPlan {
  inserts: Array<{ symbol: string; direction: "long" | "short"; shares: number; entry: number | null }>;
  updates: Array<{ id: number; direction: "long" | "short"; shares: number; entry: number | null }>;
  deletes: number[];
  /** Positions already in another of his portfolio lists, or a row of his own in this list: untouched. */
  skipped: string[];
}

const side = (d: string | null | undefined) => (String(d ?? "").toLowerCase() === "short" ? "short" : "long");
const key = (symbol: string, d: string | null | undefined) => `${symbol.toUpperCase()}:${side(d)}`;

export function planSync(input: {
  rows: ListRow[]; // the sync list's rows
  syncedIds: Set<number>; // rows the sync created
  otherPortfolioKeys: Set<string>; // "SYM:long" held in his other portfolio lists
  positions: SchwabPosition[];
}): SyncPlan {
  const plan: SyncPlan = { inserts: [], updates: [], deletes: [], skipped: [] };
  const want = new Map(input.positions.map((p) => [key(p.symbol, p.side), p]));
  const seen = new Set<string>();
  for (const row of input.rows) {
    const k = key(row.symbol, row.direction);
    const mine = input.syncedIds.has(row.id);
    const pos = want.get(k);
    if (!mine) {
      if (pos) {
        seen.add(k); // his own row for it: leave it, add nothing
        plan.skipped.push(k);
      }
      continue;
    }
    if (!pos || seen.has(k)) {
      plan.deletes.push(row.id); // closed at Schwab (or a duplicate of the sync's own)
      continue;
    }
    seen.add(k);
    if (row.shares !== pos.shares || row.targetEntry !== pos.averagePrice || side(row.direction) !== pos.side) {
      plan.updates.push({ id: row.id, direction: pos.side, shares: pos.shares, entry: pos.averagePrice });
    }
  }
  for (const [k, pos] of want) {
    if (seen.has(k)) continue;
    if (input.otherPortfolioKeys.has(k)) {
      plan.skipped.push(k);
      continue;
    }
    plan.inserts.push({ symbol: pos.symbol, direction: pos.side, shares: pos.shares, entry: pos.averagePrice });
  }
  return plan;
}

/** Finds (or makes) the sync list, plans, and writes the plan. Returns the list id and the plan. */
export async function runSync(db: Queryable, userId: number, listId: number | null, positions: SchwabPosition[]) {
  let id = listId;
  if (id) {
    const { rows } = await db.query("select id from watchlists where id = $1 and user_id = $2", [id, userId]);
    if (!rows.length) id = null;
  }
  if (!id) {
    const { rows } = await db.query(
      "insert into watchlists (user_id, name, is_default, is_portfolio) values ($1, $2, false, true) returning id",
      [userId, SYNC_LIST_NAME],
    );
    id = Number(rows[0].id);
  }
  const listRows = (await db.query(
    `select id, symbol, direction, shares, target_entry from sentinel_watchlist where user_id = $1 and watchlist_id = $2`,
    [userId, id],
  )).rows.map((r) => ({ id: Number(r.id), symbol: r.symbol, direction: r.direction, shares: r.shares, targetEntry: r.target_entry }));
  const synced = (await db.query("select item_id from schwab_synced_rows where user_id = $1 and watchlist_id = $2", [userId, id]))
    .rows.map((r) => Number(r.item_id));
  const syncedIds = new Set(synced);
  const other = (await db.query(
    `select i.symbol, i.direction from sentinel_watchlist i join watchlists w on w.id = i.watchlist_id
     where i.user_id = $1 and w.is_portfolio = true and w.id <> $2 and coalesce(i.status, 'watching') = 'watching'`,
    [userId, id],
  )).rows.map((r) => key(r.symbol, r.direction));
  const plan = planSync({ rows: listRows, syncedIds, otherPortfolioKeys: new Set(other), positions });

  for (const ins of plan.inserts) {
    const { rows } = await db.query(
      `insert into sentinel_watchlist (user_id, watchlist_id, symbol, direction, target_entry, shares, status)
       values ($1, $2, $3, $4, $5, $6, 'watching') returning id`,
      [userId, id, ins.symbol, ins.direction, ins.entry, ins.shares],
    );
    await db.query("insert into schwab_synced_rows (item_id, user_id, watchlist_id, symbol) values ($1, $2, $3, $4)",
      [Number(rows[0].id), userId, id, ins.symbol]);
  }
  for (const up of plan.updates) {
    await db.query(
      `update sentinel_watchlist set shares = $1, target_entry = $2, direction = $3, updated_at = now()
       where id = $4 and user_id = $5 and id in (select item_id from schwab_synced_rows where user_id = $5)`,
      [up.shares, up.entry, up.direction, up.id, userId],
    );
  }
  if (plan.deletes.length) {
    // Guarded twice: the plan only lists the sync's own rows, and the SQL only deletes rows recorded as synced.
    await db.query(
      `delete from sentinel_watchlist where user_id = $1 and watchlist_id = $2 and id = any($3::int[])
       and id in (select item_id from schwab_synced_rows where user_id = $1)`,
      [userId, id, plan.deletes],
    );
    await db.query("delete from schwab_synced_rows where user_id = $1 and item_id = any($2::int[])", [userId, plan.deletes]);
  }
  // Rows he deleted himself: forget them (the position comes back on the next sync while Schwab still holds it).
  const present = new Set(listRows.map((r) => r.id));
  const gone = synced.filter((s) => !present.has(s));
  if (gone.length) await db.query("delete from schwab_synced_rows where user_id = $1 and item_id = any($2::int[])", [userId, gone]);
  return { listId: id, plan };
}
