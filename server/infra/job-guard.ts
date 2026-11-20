/**
 * Guard rails for the heavy data jobs (daily bar job, scan pool refresh, daily summary, backfill):
 *   1. one at a time: an in-process lock, plus a Postgres advisory lock so the backfill script (its own process) and the
 *      service's jobs cannot overlap either. A start that is skipped is logged.
 *   2. a memory guard: above JOB_RSS_LIMIT_MB (default 1300, a setting) a job stops cleanly, logs where it stopped, and
 *      is not restarted until the next day (the guard stays tripped for the rest of the ET day).
 *   3. phase lines with RSS and heap, so the first live run explains itself.
 * Why: on 20 Nov the service's RSS rose by about 1 GB (heap flat) within minutes of the scan pool going live, with a pool
 * refresh and the bar job overlapping; the cause is not yet explained, these make the next run safe and readable.
 */
import { getEtClock } from "@shared/usEquityMarketSession";

export const DEFAULT_RSS_LIMIT_MB = 1300;
/** One key for every heavy data job; session-level, so it dies with the connection. */
export const ADVISORY_KEY = 74_337_101;

export function rssLimitMb(env: NodeJS.ProcessEnv = process.env): number {
  const v = Number(env.JOB_RSS_LIMIT_MB);
  return Number.isFinite(v) && v >= 300 ? v : DEFAULT_RSS_LIMIT_MB;
}

export function memLine(): string {
  const m = process.memoryUsage();
  const mb = (n: number) => Math.round(n / 1048576);
  return `rss ${mb(m.rss)} MB, heap ${mb(m.heapUsed)} MB, external ${mb(m.external)} MB`;
}

/** `[Tag] phase: rss .., heap ..` */
export function logPhase(tag: string, phase: string): void {
  console.log(`[${tag}] ${phase}: ${memLine()}`);
}

let holder: string | null = null;
let heldClient: { query: (q: string, p?: unknown[]) => Promise<any>; release: () => void } | null = null;

export function lockHolder(): string | null {
  return holder;
}

/**
 * Take the job lock or return null (and log the skipped start). `db` is optional; with one, the advisory lock is taken on a
 * dedicated pooled connection (released with the lock). Without a pool the in-process lock alone applies.
 */
export async function tryAcquire(name: string, db?: any): Promise<(() => Promise<void>) | null> {
  if (holder) {
    console.log(`[JobGuard] ${name} not started: ${holder} is running`);
    return null;
  }
  holder = name; // in-process: taken before any await, so two ticks cannot both pass
  let client: typeof heldClient = null;
  try {
    const pool = db?.$client ?? db?.session?.client;
    if (pool && typeof pool.connect === "function") {
      client = await pool.connect();
      const r = await client!.query("SELECT pg_try_advisory_lock($1) AS ok", [ADVISORY_KEY]);
      if (!r.rows?.[0]?.ok) {
        client!.release();
        holder = null;
        console.log(`[JobGuard] ${name} not started: another process holds the data-job lock (a backfill or another instance)`);
        return null;
      }
      heldClient = client;
    }
  } catch (err) {
    // no lock service: keep the in-process lock alone rather than blocking the job
    try { client?.release(); } catch { /* ignore */ }
    client = null;
    heldClient = null;
    console.warn(`[JobGuard] advisory lock unavailable (${String(err).slice(0, 80)}); in-process lock only`);
  }
  return async () => {
    try {
      if (heldClient) {
        await heldClient.query("SELECT pg_advisory_unlock($1)", [ADVISORY_KEY]).catch(() => {});
        heldClient.release();
      }
    } finally {
      heldClient = null;
      holder = null;
    }
  };
}

/** Run `fn` under the lock; returns { skipped: true } when another data job is running. */
export async function withJobLock<T>(name: string, fn: () => Promise<T>, db?: any): Promise<{ skipped: true } | { skipped: false; value: T }> {
  const release = await tryAcquire(name, db);
  if (!release) return { skipped: true };
  try {
    return { skipped: false, value: await fn() };
  } finally {
    await release();
  }
}

let tripped: { day: string; where: string; rssMb: number } | null = null;
const today = () => getEtClock().dateKey;

/** True once a job has stopped on the memory limit today: nothing heavy restarts until tomorrow. */
export function guardTrippedToday(): boolean {
  return !!tripped && tripped.day === today();
}
export function guardState() {
  return tripped;
}

/** Call between batches. True = stop now (and the guard is tripped for the rest of the day). */
export function overLimit(tag: string, where: string, limitMb = rssLimitMb()): boolean {
  const rss = Math.round(process.memoryUsage().rss / 1048576);
  if (rss <= limitMb) return false;
  tripped = { day: today(), where: `${tag}: ${where}`, rssMb: rss };
  console.warn(`[${tag}] STOPPED at ${where}: rss ${rss} MB is over the ${limitMb} MB limit (JOB_RSS_LIMIT_MB); heavy data jobs stay off until tomorrow. ${memLine()}`);
  return true;
}

export function resetGuardForTests(): void {
  tripped = null;
  holder = null;
  heldClient = null;
}
