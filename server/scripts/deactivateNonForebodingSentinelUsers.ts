#!/usr/bin/env tsx
/**
 * Adds sentinel_users.is_active if missing, sets active only for SENTINEL_ACTIVE_USERNAME
 * (default Foreboding), deactivates all other Sentinel users, and deletes their express sessions.
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import pg from "pg";

function getDatabaseUrl(): string | undefined {
  let databaseUrl = process.env.DATABASE_URL;
  if (
    !databaseUrl ||
    !databaseUrl.includes("postgresql://") ||
    databaseUrl.includes(" ") ||
    !databaseUrl.includes("@")
  ) {
    try {
      const envPath = path.join(process.cwd(), ".env");
      if (fs.existsSync(envPath)) {
        const m = fs.readFileSync(envPath, "utf-8").match(/DATABASE_URL="([^"]+)"/);
        if (m) databaseUrl = m[1];
      }
    } catch {
      /* ignore */
    }
  }
  return databaseUrl;
}

const activeUsername = (process.env.SENTINEL_ACTIVE_USERNAME || "Foreboding").trim();

(async () => {
  const url = getDatabaseUrl();
  if (!url) {
    console.error("No DATABASE_URL");
    process.exit(1);
  }
  if (!activeUsername) {
    console.error("SENTINEL_ACTIVE_USERNAME is empty");
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: url, max: 2 });
  try {
    await pool.query(`
      ALTER TABLE sentinel_users
      ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true
    `);

    await pool.query(
      `UPDATE sentinel_users SET is_active = true WHERE LOWER(username) = LOWER($1)`,
      [activeUsername]
    );

    const deactivated = await pool.query<{ id: number; username: string }>(
      `UPDATE sentinel_users
       SET is_active = false
       WHERE LOWER(username) != LOWER($1)
       RETURNING id, username`,
      [activeUsername]
    );

    console.log("Kept active (username):", activeUsername);
    console.log("Deactivated users:", deactivated.rows);

    const del = await pool.query(
      `DELETE FROM session
       WHERE sess->>'userId' IS NOT NULL
         AND (sess->>'userId')::int IN (SELECT id FROM sentinel_users WHERE is_active = false)`
    );
    console.log("Sessions removed for inactive users:", del.rowCount ?? 0);
  } finally {
    await pool.end();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
