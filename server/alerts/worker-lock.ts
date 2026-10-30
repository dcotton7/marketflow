import type pg from "pg";
import { getPool } from "../db";

/**
 * One alert worker across every MarketFlow instance on the same database (LOCAL and Live share one). The holder
 * keeps a Postgres session advisory lock on a dedicated connection; if that instance stops or the connection drops,
 * Postgres releases the lock and the next instance to ask takes over within one cycle.
 */
const LOCK_KEY = 74_337_001; // arbitrary, fixed: "position alerts worker"

let client: pg.PoolClient | null = null;

export async function holdsWorkerLock(): Promise<boolean> {
  if (client) return true;
  const pool = getPool();
  if (!pool) return false;
  let c: pg.PoolClient | null = null;
  try {
    c = await pool.connect();
    const r = await c.query("select pg_try_advisory_lock($1) as ok", [LOCK_KEY]);
    if (r.rows[0]?.ok === true) {
      client = c;
      const held = c;
      held.on("error", (err) => {
        // Give the dead connection back to the pool as broken; without this it stays checked out for good,
        // one pool slot lost each time Neon drops it.
        if (client === held) client = null;
        try {
          held.release(err);
        } catch {
          // already released
        }
      });
      console.log("[PositionAlerts] this instance runs the alert worker (advisory lock held)");
      return true;
    }
    c.release();
    return false;
  } catch (error) {
    if (c && c !== client) c.release(true);
    console.warn("[PositionAlerts] could not check the worker lock:", error);
    return false;
  }
}
