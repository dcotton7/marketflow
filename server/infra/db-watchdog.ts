/**
 * Database watchdog. Live once sat for minutes with every /api call hanging 20s and then failing with pg's
 * "timeout exceeded when trying to connect", while static pages still loaded; only a restart brought it back.
 * This probes the pool with `select 1` every 15s. After 5 failures in a row, or no good probe for 90s with at least
 * two failures since, it logs the pool's counts and exits with code 1, so Render starts a fresh instance.
 *
 * DB_WATCHDOG=off disables it; =log only logs; =exit exits. Unset means exit in production and log elsewhere, so a
 * local dev server isn't killed out from under you.
 */
import type pg from "pg";

export type WatchdogMode = "off" | "log" | "exit";

export interface WatchdogVerdict {
  dead: boolean;
  fails: number;
  sinceOkMs: number;
}

/** The decision alone, so it can be tested without a database or timers. */
export function createWatchdogState(opts: { maxFails?: number; deadMs?: number; now?: () => number } = {}) {
  const maxFails = opts.maxFails ?? 5;
  const deadMs = opts.deadMs ?? 90_000;
  const now = opts.now ?? Date.now;
  let fails = 0;
  let lastOk = now();
  return {
    record(ok: boolean): WatchdogVerdict {
      const t = now();
      if (ok) {
        fails = 0;
        lastOk = t;
      } else {
        fails += 1;
      }
      const sinceOkMs = t - lastOk;
      return { dead: fails >= maxFails || (fails >= 2 && sinceOkMs >= deadMs), fails, sinceOkMs };
    },
  };
}

export function watchdogMode(env: NodeJS.ProcessEnv = process.env): WatchdogMode {
  const raw = (env.DB_WATCHDOG || "").trim().toLowerCase();
  if (raw === "off" || raw === "log" || raw === "exit") return raw;
  return env.NODE_ENV === "production" ? "exit" : "log";
}

/** `select 1` through the pool, giving up after `ms` even if the socket hangs. */
export async function pingDatabase(pool: pg.Pool | null, ms: number): Promise<{ ok: boolean; ms: number; error?: string }> {
  const start = Date.now();
  if (!pool) return { ok: false, ms: 0, error: "database never connected" };
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      pool.query("select 1"),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`no answer within ${ms}ms`)), ms);
      }),
    ]);
    return { ok: true, ms: Date.now() - start };
  } catch (error) {
    return { ok: false, ms: Date.now() - start, error: error instanceof Error ? error.message : String(error) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function poolCounts(pool: pg.Pool | null): string {
  if (!pool) return "no pool";
  return `total=${pool.totalCount} idle=${pool.idleCount} waiting=${pool.waitingCount}`;
}

export function startDbWatchdog(getPool: () => pg.Pool | null, opts: { everyMs?: number; probeMs?: number } = {}): void {
  const mode = watchdogMode();
  if (mode === "off" || !process.env.DATABASE_URL) {
    console.log(`[DB watchdog] off (${mode === "off" ? "DB_WATCHDOG=off" : "no DATABASE_URL"})`);
    return;
  }
  const everyMs = opts.everyMs ?? 15_000;
  const probeMs = opts.probeMs ?? 25_000;
  const state = createWatchdogState();
  let busy = false;
  console.log(`[DB watchdog] on, mode=${mode}, probe every ${everyMs / 1000}s`);
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const pool = getPool();
      const r = await pingDatabase(pool, probeMs);
      const v = state.record(r.ok);
      if (r.ok) return;
      console.warn(
        `[DB watchdog] probe failed (${v.fails} in a row, last OK ${Math.round(v.sinceOkMs / 1000)}s ago): ${r.error}; pool ${poolCounts(pool)}`,
      );
      if (!v.dead) return;
      if (mode === "exit") {
        console.error(`[DB watchdog] database unreachable through the pool; exiting so the host starts a fresh instance`);
        clearInterval(timer);
        setTimeout(() => process.exit(1), 500);
      } else {
        console.error(`[DB watchdog] database unreachable through the pool; would exit (DB_WATCHDOG=${mode})`);
      }
    } finally {
      busy = false;
    }
  }, everyMs);
  timer.unref();
}
