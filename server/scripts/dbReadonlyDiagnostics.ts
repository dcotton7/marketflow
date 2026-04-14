#!/usr/bin/env tsx
/**
 * Read-only: table row counts and watchlist summary. No mutations.
 * Uses same DATABASE_URL resolution as server/db.ts (env + .env file).
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
        const envContent = fs.readFileSync(envPath, "utf-8");
        const match = envContent.match(/DATABASE_URL="([^"]+)"/);
        if (match) databaseUrl = match[1];
      }
    } catch {
      /* ignore */
    }
  }
  return databaseUrl;
}

function redactUrl(u: string): string {
  try {
    const x = new URL(u);
    return `${x.protocol}//${x.hostname}${x.port ? `:${x.port}` : ""}${x.pathname}`;
  } catch {
    return "(could not parse URL)";
  }
}

(async () => {
  const url = getDatabaseUrl();
  if (!url) {
    console.error("No DATABASE_URL (env or .env).");
    process.exit(1);
  }
  console.log("DB host (redacted):", redactUrl(url));

  const pool = new pg.Pool({ connectionString: url, max: 2 });
  try {
    const q = async (label: string, sql: string) => {
      const r = await pool.query(sql);
      console.log(label, r.rows);
    };

    await q("sentinel_users count:", `SELECT count(*)::int AS n FROM sentinel_users`);
    await q("watchlists count:", `SELECT count(*)::int AS n FROM watchlists`);
    await q("sentinel_watchlist rows:", `SELECT count(*)::int AS n FROM sentinel_watchlist`);
    await q("watchlist_items (legacy) rows:", `SELECT count(*)::int AS n FROM watchlist_items`);
    await q("start_here_workspaces:", `SELECT count(*)::int AS n FROM start_here_workspaces`);

    await q(
      "watchlists by user_id (top 15 by list count):",
      `SELECT user_id, count(*)::int AS lists FROM watchlists GROUP BY user_id ORDER BY lists DESC LIMIT 15`
    );
    await q(
      "sentinel_watchlist items by user_id (top 15):",
      `SELECT user_id, count(*)::int AS items FROM sentinel_watchlist GROUP BY user_id ORDER BY items DESC LIMIT 15`
    );
    await q(
      "watchlist names sample (id, user_id, name, is_default):",
      `SELECT id, user_id, name, is_default FROM watchlists ORDER BY id DESC LIMIT 20`
    );
  } finally {
    await pool.end();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
