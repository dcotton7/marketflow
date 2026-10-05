/**
 * Per-account login lockout. After MAX_FAILED_LOGINS consecutive failed password attempts the
 * account is locked until cleared from the operator's PC (server/scripts/unlockUser.ts).
 * There is deliberately no web route, admin button, email reset or timeout that unlocks.
 *
 * State is persisted (survives restarts/deploys) as one row per user in the existing key/JSON table
 * sentinel_tier_access_overrides, under config_key "login_lock:user:<id>". The app only reads the
 * "global" key of that table for tier overrides, so these rows never affect tier access.
 *
 * Attempts are counted when they start (reserve), so concurrent guesses cannot exceed the budget:
 * an attempt beyond the budget is refused without checking the password and locks the account.
 */

export const MAX_FAILED_LOGINS = 3;
export const LOGIN_LOCK_KEY_PREFIX = "login_lock:user:";

export type LockState = {
  failedCount: number;
  lockedAt: string | null;
  lastFailAt: string | null;
};

export type LockRow = { userId: number; state: LockState };

export interface LockStore {
  /** Count one attempt; locks when the count exceeds `max`. Returns the state after the update. */
  reserve(userId: number, max: number, nowIso: string): Promise<LockState>;
  /** Record a failed password; locks when failedCount >= `max`. */
  fail(userId: number, max: number, nowIso: string): Promise<LockState>;
  /** Reset the count unless locked. Returns false when the account is locked. */
  succeed(userId: number): Promise<boolean>;
  get(userId: number): Promise<LockState | null>;
  list(): Promise<LockRow[]>;
  /** Remove all lock state for the user. Operator-only (unlock script). */
  clear(userId: number): Promise<boolean>;
}

export type Query = (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;

export function lockKey(userId: number): string {
  return `${LOGIN_LOCK_KEY_PREFIX}${userId}`;
}

export function isLocked(state: LockState | null | undefined): boolean {
  return !!state?.lockedAt;
}

function toState(payload: unknown): LockState {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  return {
    failedCount: Number(p.failedCount) || 0,
    lockedAt: typeof p.lockedAt === "string" ? p.lockedAt : null,
    lastFailAt: typeof p.lastFailAt === "string" ? p.lastFailAt : null,
  };
}

const COUNT = `COALESCE((t.payload->>'failedCount')::int, 0)`;

export function createPgLockStore(query: Query): LockStore {
  return {
    async reserve(userId, max, nowIso) {
      const r = await query(
        `INSERT INTO sentinel_tier_access_overrides AS t (config_key, payload, updated_at)
         VALUES ($1, jsonb_build_object('failedCount', 1, 'lockedAt', CASE WHEN 1 > $2 THEN $3::text END, 'lastFailAt', NULL), now())
         ON CONFLICT (config_key) DO UPDATE SET
           payload = jsonb_build_object(
             'failedCount', ${COUNT} + 1,
             'lockedAt', COALESCE(t.payload->>'lockedAt', CASE WHEN ${COUNT} + 1 > $2 THEN $3::text END),
             'lastFailAt', t.payload->>'lastFailAt'),
           updated_at = now()
         RETURNING payload`,
        [lockKey(userId), max, nowIso],
      );
      return toState(r.rows[0]?.payload);
    },
    async fail(userId, max, nowIso) {
      const r = await query(
        `INSERT INTO sentinel_tier_access_overrides AS t (config_key, payload, updated_at)
         VALUES ($1, jsonb_build_object('failedCount', 1, 'lockedAt', CASE WHEN 1 >= $2 THEN $3::text END, 'lastFailAt', $3::text), now())
         ON CONFLICT (config_key) DO UPDATE SET
           payload = jsonb_build_object(
             'failedCount', GREATEST(${COUNT}, 1),
             'lockedAt', COALESCE(t.payload->>'lockedAt', CASE WHEN GREATEST(${COUNT}, 1) >= $2 THEN $3::text END),
             'lastFailAt', $3::text),
           updated_at = now()
         RETURNING payload`,
        [lockKey(userId), max, nowIso],
      );
      return toState(r.rows[0]?.payload);
    },
    async succeed(userId) {
      await query(
        `DELETE FROM sentinel_tier_access_overrides WHERE config_key = $1 AND payload->>'lockedAt' IS NULL`,
        [lockKey(userId)],
      );
      const left = await this.get(userId);
      return !isLocked(left);
    },
    async get(userId) {
      const r = await query(`SELECT payload FROM sentinel_tier_access_overrides WHERE config_key = $1`, [lockKey(userId)]);
      return r.rows[0] ? toState(r.rows[0].payload) : null;
    },
    async list() {
      const r = await query(
        `SELECT config_key, payload FROM sentinel_tier_access_overrides WHERE config_key LIKE $1 ORDER BY config_key`,
        [`${LOGIN_LOCK_KEY_PREFIX}%`],
      );
      return r.rows
        .map((row) => ({ userId: Number(String(row.config_key).slice(LOGIN_LOCK_KEY_PREFIX.length)), state: toState(row.payload) }))
        .filter((row) => Number.isInteger(row.userId) && row.userId > 0);
    },
    async clear(userId) {
      const r = await query(`DELETE FROM sentinel_tier_access_overrides WHERE config_key = $1`, [lockKey(userId)]);
      return (r.rowCount ?? 0) > 0;
    },
  };
}

/** Same semantics as the Postgres store; used by tests. */
export function createMemoryLockStore(): LockStore & { rows: Map<number, LockState> } {
  const rows = new Map<number, LockState>();
  return {
    rows,
    async reserve(userId, max, nowIso) {
      const cur = rows.get(userId) ?? { failedCount: 0, lockedAt: null, lastFailAt: null };
      const failedCount = cur.failedCount + 1;
      const next = { ...cur, failedCount, lockedAt: cur.lockedAt ?? (failedCount > max ? nowIso : null) };
      rows.set(userId, next);
      return { ...next };
    },
    async fail(userId, max, nowIso) {
      const cur = rows.get(userId) ?? { failedCount: 1, lockedAt: null, lastFailAt: null };
      const failedCount = Math.max(cur.failedCount, 1);
      const next = { failedCount, lockedAt: cur.lockedAt ?? (failedCount >= max ? nowIso : null), lastFailAt: nowIso };
      rows.set(userId, next);
      return { ...next };
    },
    async succeed(userId) {
      const cur = rows.get(userId);
      if (cur && cur.lockedAt) return false;
      rows.delete(userId);
      return true;
    },
    async get(userId) {
      const cur = rows.get(userId);
      return cur ? { ...cur } : null;
    },
    async list() {
      return [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([userId, state]) => ({ userId, state: { ...state } }));
    },
    async clear(userId) {
      return rows.delete(userId);
    },
  };
}

export function maskName(value: string): string {
  const [local, domain] = value.split("@");
  const m = (s: string) => (s.length <= 1 ? "*" : `${s[0]}***`);
  return domain ? `${m(local)}@${domain}` : m(value);
}

export type AuditLog = (line: string) => void;
const defaultAudit: AuditLog = (line) => console.warn(`[auth-audit] ${line}`);

export type LockoutUser = { id: number; username: string };

export function createLoginLockout(opts: {
  store: LockStore;
  max?: number;
  now?: () => Date;
  audit?: AuditLog;
}) {
  const max = opts.max ?? MAX_FAILED_LOGINS;
  const now = opts.now ?? (() => new Date());
  const audit = opts.audit ?? defaultAudit;
  const who = (u: LockoutUser) => `user=id:${u.id}(${maskName(u.username)})`;

  return {
    max,
    /** Call before checking the password. When false, refuse without comparing the password. */
    async beginAttempt(user: LockoutUser, ip: string): Promise<boolean> {
      const wasLocked = isLocked(await opts.store.get(user.id));
      const state = await opts.store.reserve(user.id, max, now().toISOString());
      if (isLocked(state)) {
        audit(
          wasLocked
            ? `login refused (account locked) ${who(user)} ip=${ip} attempts=${state.failedCount}`
            : `account LOCKED (attempt beyond ${max}) ${who(user)} ip=${ip} attempts=${state.failedCount}`,
        );
        return false;
      }
      return true;
    },
    async recordFailure(user: LockoutUser, ip: string): Promise<LockState> {
      const state = await opts.store.fail(user.id, max, now().toISOString());
      audit(`login failure ${who(user)} ip=${ip} count=${Math.min(state.failedCount, max)}/${max}`);
      if (isLocked(state) && state.lockedAt === state.lastFailAt) {
        audit(`account LOCKED after ${max} failed attempts ${who(user)} ip=${ip}`);
      }
      return state;
    },
    /** Resets the count. Returns false if the account got locked meanwhile (deny the login). */
    async recordSuccess(user: LockoutUser, ip: string): Promise<boolean> {
      const ok = await opts.store.succeed(user.id);
      if (!ok) audit(`login refused (account locked, correct password) ${who(user)} ip=${ip}`);
      return ok;
    },
  };
}

export type LoginLockout = ReturnType<typeof createLoginLockout>;

/**
 * Password check with lockout. Unknown usernames touch no lock state. Locked accounts are refused
 * without checking the password and look exactly like a wrong password (same result, `burnTime`
 * spends the same bcrypt cost), so neither existence nor lock status nor a correct guess leaks.
 */
export async function checkPasswordWithLockout(args: {
  lockout: LoginLockout;
  user: LockoutUser | null | undefined;
  ip: string;
  verifyPassword: () => Promise<boolean>;
  burnTime: () => Promise<unknown>;
  audit?: AuditLog;
}): Promise<boolean> {
  const { lockout, user, ip } = args;
  if (!user) {
    await args.burnTime();
    (args.audit ?? defaultAudit)(`login failure (unknown username) ip=${ip}`);
    return false;
  }
  if (!(await lockout.beginAttempt(user, ip))) {
    await args.burnTime();
    return false;
  }
  if (!(await args.verifyPassword())) {
    await lockout.recordFailure(user, ip);
    return false;
  }
  return lockout.recordSuccess(user, ip);
}
