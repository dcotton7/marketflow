#!/usr/bin/env tsx
import "dotenv/config";
import pg from "pg";

(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("No DATABASE_URL");
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  try {
    const r = await pool.query(
      `SELECT id, username, email, is_admin, is_active, tier, created_at
       FROM sentinel_users ORDER BY id`
    );
    console.table(r.rows);
  } finally {
    await pool.end();
  }
})();
