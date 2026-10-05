#!/usr/bin/env tsx
/**
 * Reversibly disable Sentinel accounts via the existing sentinel_users.is_active flag
 * (login, /api/auth/me and requireSentinelAuth all reject is_active = false).
 * No schema changes, no deletes of users.
 *
 *   Dry run (default):  npx tsx server/scripts/disableUsers.ts --ids=1,3,4,5 --keep=2
 *   Apply:              npx tsx server/scripts/disableUsers.ts --ids=1,3,4,5 --keep=2 --apply
 *   Also end sessions:  add --end-sessions (only the listed ids' sessions are deleted)
 *   Undo (dry run):     npx tsx server/scripts/disableUsers.ts --undo
 *   Undo (apply):       npx tsx server/scripts/disableUsers.ts --undo --apply
 *
 * --apply writes a before-record to --backup (default server/scripts/.user-disable-backup-<date>.json)
 * and refuses to overwrite an existing backup, so --undo always restores the original values.
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import pg from "pg";

type BackupRow = { id: number; username: string; email: string; isActive: boolean; isAdmin: boolean | null };
type Backup = { createdAt: string; column: "is_active"; rows: BackupRow[] };

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  const eq = hit.indexOf("=");
  return eq === -1 ? "" : hit.slice(eq + 1);
}

function parseIds(raw: string | undefined): number[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}

function mask(value: string): string {
  const [local, domain] = value.split("@");
  const m = (s: string) => (s.length <= 1 ? "*" : `${s[0]}***`);
  return domain ? `${m(local)}@${domain}` : m(value);
}

const apply = process.argv.includes("--apply");
const undo = process.argv.includes("--undo");
const endSessions = process.argv.includes("--end-sessions");
const today = new Date().toISOString().slice(0, 10);
const backupPath = path.resolve(
  arg("backup") || path.join("server", "scripts", `.user-disable-backup-${today}.json`),
);

async function sessionCounts(pool: pg.Pool, ids: number[]): Promise<Map<number, number>> {
  const r = await pool.query<{ uid: number; n: string }>(
    `SELECT (sess->>'userId')::int AS uid, COUNT(*) AS n
       FROM session
      WHERE sess->>'userId' ~ '^[0-9]+$' AND (sess->>'userId')::int = ANY($1) AND expire > NOW()
      GROUP BY 1`,
    [ids],
  );
  return new Map(r.rows.map((row) => [row.uid, Number(row.n)]));
}

async function runDisable(pool: pg.Pool): Promise<void> {
  const ids = parseIds(arg("ids"));
  const keep = parseIds(arg("keep"));
  if (ids.length === 0) throw new Error("--ids=<comma-separated user ids> is required");
  const clash = ids.filter((id) => keep.includes(id));
  if (clash.length) throw new Error(`Refusing: ids ${clash.join(",")} are also in --keep`);

  const users = await pool.query<{ id: number; username: string; email: string; is_active: boolean; is_admin: boolean | null }>(
    `SELECT id, username, email, is_active, is_admin FROM sentinel_users WHERE id = ANY($1) ORDER BY id`,
    [ids],
  );
  const missing = ids.filter((id) => !users.rows.some((u) => u.id === id));
  if (missing.length) throw new Error(`Unknown user ids: ${missing.join(",")}`);
  const sessions = await sessionCounts(pool, ids);

  console.log(apply ? "APPLY" : "DRY RUN (no changes)");
  for (const u of users.rows) {
    console.log(
      `  id=${u.id} user=${mask(u.username)} email=${mask(u.email)} admin=${!!u.is_admin} ` +
        `is_active ${u.is_active} -> false, open sessions=${sessions.get(u.id) ?? 0}` +
        (endSessions ? " (will be ended)" : ""),
    );
  }
  if (!apply) return;

  if (fs.existsSync(backupPath)) {
    throw new Error(`Backup already exists at ${backupPath}; refusing to overwrite the original before-values`);
  }
  const backup: Backup = {
    createdAt: new Date().toISOString(),
    column: "is_active",
    rows: users.rows.map((u) => ({
      id: u.id,
      username: mask(u.username),
      email: mask(u.email),
      isActive: u.is_active,
      isAdmin: u.is_admin,
    })),
  };
  fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
  console.log(`Backup written: ${backupPath}`);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const upd = await client.query(`UPDATE sentinel_users SET is_active = false WHERE id = ANY($1)`, [ids]);
    console.log(`Users updated: ${upd.rowCount}`);
    if (endSessions) {
      const del = await client.query(
        `DELETE FROM session WHERE sess->>'userId' ~ '^[0-9]+$' AND (sess->>'userId')::int = ANY($1)`,
        [ids],
      );
      console.log(`Sessions ended: ${del.rowCount ?? 0}`);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function runUndo(pool: pg.Pool): Promise<void> {
  if (!fs.existsSync(backupPath)) throw new Error(`No backup at ${backupPath} (pass --backup=<file>)`);
  const backup = JSON.parse(fs.readFileSync(backupPath, "utf-8")) as Backup;
  console.log(apply ? `UNDO from ${backupPath}` : `UNDO DRY RUN from ${backupPath} (no changes)`);
  for (const row of backup.rows) console.log(`  id=${row.id} is_active -> ${row.isActive}`);
  if (!apply) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const row of backup.rows) {
      await client.query(`UPDATE sentinel_users SET is_active = $2 WHERE id = $1`, [row.id, row.isActive]);
    }
    await client.query("COMMIT");
    console.log(`Restored ${backup.rows.length} users`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("No DATABASE_URL");
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  try {
    if (undo) await runUndo(pool);
    else await runDisable(pool);
  } finally {
    await pool.end();
  }
})().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
