#!/usr/bin/env tsx
/**
 * Clear a Sentinel login lockout (3 failed passwords). This is the ONLY way to unlock: the web app
 * has no unlock route, button, email reset or timeout. Run from the operator's PC.
 *
 *   List locked / counting accounts:  npx tsx server/scripts/unlockUser.ts --status
 *   Dry run (default):                npx tsx server/scripts/unlockUser.ts --id=2
 *                                     npx tsx server/scripts/unlockUser.ts --username=<name>
 *   Apply:                            npx tsx server/scripts/unlockUser.ts --id=2 --apply
 *
 * Only removes the lock row (sentinel_tier_access_overrides, config_key login_lock:user:<id>).
 * Does not touch the password, is_active or sessions.
 */
import "dotenv/config";
import { pathToFileURL } from "url";
import pg from "pg";
import { createPgLockStore, isLocked, maskName, MAX_FAILED_LOGINS, type LockState, type LockStore } from "../middleware/loginLockout";

export type UnlockUser = { id: number; username: string; isActive: boolean };

export type UnlockDeps = {
  store: LockStore;
  findUserById(id: number): Promise<UnlockUser | null>;
  findUserByUsername(username: string): Promise<UnlockUser | null>;
  log(line: string): void;
};

export type UnlockArgs = { status?: boolean; id?: number; username?: string; apply?: boolean };

function describe(state: LockState | null): string {
  if (!state) return "unlocked, failed=0";
  return isLocked(state)
    ? `LOCKED since ${state.lockedAt}, attempts=${state.failedCount}, lastFail=${state.lastFailAt ?? "-"}`
    : `unlocked, failed=${state.failedCount}/${MAX_FAILED_LOGINS}, lastFail=${state.lastFailAt ?? "-"}`;
}

export function parseUnlockArgs(argv: string[]): UnlockArgs {
  const val = (name: string) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : undefined;
  };
  const idRaw = val("id");
  const id = idRaw === undefined ? undefined : Number(idRaw);
  if (id !== undefined && !(Number.isInteger(id) && id > 0)) throw new Error(`Invalid --id=${idRaw}`);
  return { status: argv.includes("--status"), id, username: val("username"), apply: argv.includes("--apply") };
}

/** Returns a process exit code. */
export async function runUnlock(args: UnlockArgs, deps: UnlockDeps): Promise<number> {
  const { store, log } = deps;

  if (args.status) {
    const rows = await store.list();
    if (rows.length === 0) {
      log("No locked accounts and no pending failed attempts.");
      return 0;
    }
    for (const row of rows) {
      const u = await deps.findUserById(row.userId);
      const name = u ? `${maskName(u.username)}${u.isActive ? "" : " (disabled)"}` : "(user not found)";
      log(`  id=${row.userId} user=${name} ${describe(row.state)}`);
    }
    return 0;
  }

  if (args.id === undefined && !args.username) {
    log("Pass --status, --id=<id> or --username=<name> (add --apply to unlock).");
    return 2;
  }
  if (args.id !== undefined && args.username) {
    log("Pass either --id or --username, not both.");
    return 2;
  }

  const user = args.id !== undefined ? await deps.findUserById(args.id) : await deps.findUserByUsername(args.username!);
  if (!user) {
    log("User not found.");
    return 1;
  }
  const state = await store.get(user.id);
  log(`${args.apply ? "APPLY" : "DRY RUN (no changes)"}  id=${user.id} user=${maskName(user.username)}${user.isActive ? "" : " (disabled)"}`);
  log(`  now:   ${describe(state)}`);
  if (!state) {
    log("  nothing to clear");
    return 0;
  }
  log("  after: unlocked, failed=0");
  if (!args.apply) {
    log("  re-run with --apply to clear");
    return 0;
  }
  await store.clear(user.id);
  const after = await store.get(user.id);
  log(`  done:  ${describe(after)}`);
  console.warn(`[auth-audit] account unlocked by operator script id=${user.id}`);
  return after ? 1 : 0;
}

async function main(): Promise<void> {
  const args = parseUnlockArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("No DATABASE_URL");
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const toUser = (r: { id: number; username: string; is_active: boolean } | undefined): UnlockUser | null =>
    r ? { id: r.id, username: r.username, isActive: r.is_active } : null;
  try {
    process.exitCode = await runUnlock(args, {
      store: createPgLockStore((text, params) => pool.query(text, params)),
      findUserById: async (id) =>
        toUser((await pool.query(`SELECT id, username, is_active FROM sentinel_users WHERE id = $1`, [id])).rows[0]),
      findUserByUsername: async (username) =>
        toUser((await pool.query(`SELECT id, username, is_active FROM sentinel_users WHERE username = $1`, [username])).rows[0]),
      log: (line) => console.log(line),
    });
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
