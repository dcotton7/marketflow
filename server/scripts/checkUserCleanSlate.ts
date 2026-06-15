#!/usr/bin/env tsx
import "dotenv/config";
import pg from "pg";

const username = process.argv[2] || "Mythical";

(async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  try {
    const userRes = await pool.query(
      `SELECT id, username FROM sentinel_users WHERE username ILIKE $1 LIMIT 1`,
      [username]
    );
    if (userRes.rows.length === 0) {
      console.error("User not found:", username);
      process.exit(1);
    }
    const userId = userRes.rows[0].id;
    console.log("User:", userRes.rows[0]);

    const checks: Array<[string, string]> = [
      ["sentinel_import_batches", "user_id"],
      ["sentinel_imported_trades", "user_id"],
      ["sentinel_trades", "user_id"],
      ["sentinel_order_levels", "user_id"],
      ["sentinel_evaluations", "user_id"],
      ["sentinel_events", "user_id"],
      ["sentinel_journal_cash_anchor", "user_id"],
      ["sentinel_journal_cash_events", "user_id"],
      ["sentinel_account_settings", "user_id"],
    ];

    console.log("\n--- RECORD COUNTS ---");
    let allClear = true;
    for (const [table, col] of checks) {
      const r = await pool.query(
        `SELECT COUNT(*)::int AS n FROM ${table} WHERE ${col} = $1`,
        [userId]
      );
      const n = r.rows[0].n;
      if (n > 0) allClear = false;
      console.log(`${table}: ${n}`);
    }

    const promoted = await pool.query(
      `SELECT COUNT(*)::int AS n FROM sentinel_imported_trades WHERE user_id = $1 AND promoted_at IS NOT NULL`,
      [userId]
    );
    console.log(`promoted_import_rows: ${promoted.rows[0].n}`);
    if (promoted.rows[0].n > 0) allClear = false;

    console.log(allClear ? "\n✓ Clean slate — ready for fresh import" : "\n✗ Data remains — run wipe script");
    process.exit(allClear ? 0 : 1);
  } finally {
    await pool.end();
  }
})();
