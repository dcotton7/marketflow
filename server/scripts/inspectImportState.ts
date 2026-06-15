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
    const userArg = process.argv[2] || "Mythical";
    const userRes = await pool.query(
      `SELECT id, username FROM sentinel_users WHERE username ILIKE $1 OR id::text = $1 LIMIT 1`,
      [userArg]
    );
    if (userRes.rows.length === 0) {
      console.error("User not found:", userArg);
      process.exit(1);
    }
    const userId = userRes.rows[0].id;
    console.log("User:", userRes.rows[0]);

    const batches = await pool.query(
      `SELECT batch_id, file_name, import_name, broker_id, total_trades_found, total_trades_imported,
              orphan_sells_count, duplicates_count, status, skipped_rows, created_at
       FROM sentinel_import_batches WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
    console.log("\n--- BATCHES ---");
    for (const b of batches.rows) {
      const skipped = Array.isArray(b.skipped_rows) ? b.skipped_rows : [];
      const skipReasons: Record<string, number> = {};
      for (const s of skipped) {
        const r = s.reason || "unknown";
        skipReasons[r] = (skipReasons[r] || 0) + 1;
      }
      console.log({
        file: b.file_name,
        importName: b.import_name,
        imported: b.total_trades_imported,
        found: b.total_trades_found,
        orphans: b.orphan_sells_count,
        duplicates: b.duplicates_count,
        status: b.status,
        at: b.created_at,
        skipReasons,
        skipCount: skipped.length,
      });
    }

    const tradeStats = await pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE is_orphan_sell AND orphan_status = 'pending')::int AS orphan_pending,
         COUNT(*) FILTER (WHERE is_orphan_sell AND orphan_status = 'resolved')::int AS orphan_resolved,
         COUNT(*) FILTER (WHERE is_orphan_sell AND orphan_status = 'muted')::int AS orphan_muted,
         COUNT(*) FILTER (WHERE is_orphan_sell AND orphan_status = 'deleted')::int AS orphan_deleted,
         COUNT(*) FILTER (WHERE is_duplicate AND duplicate_status = 'pending')::int AS dup_pending,
         COUNT(*) FILTER (WHERE is_duplicate AND duplicate_status = 'deleted')::int AS dup_deleted,
         COUNT(*) FILTER (WHERE is_duplicate AND duplicate_status = 'overwritten')::int AS dup_overwritten,
         COUNT(*) FILTER (WHERE promoted_at IS NOT NULL)::int AS promoted,
         COUNT(*) FILTER (WHERE promoted_at IS NULL)::int AS unpromoted,
         COUNT(*) FILTER (WHERE direction = 'BUY')::int AS buys,
         COUNT(*) FILTER (WHERE direction = 'SELL')::int AS sells
       FROM sentinel_imported_trades WHERE user_id = $1`,
      [userId]
    );
    console.log("\n--- IMPORTED TRADES ---");
    console.table(tradeStats.rows);

    const orphanTickers = await pool.query(
      `SELECT ticker, trade_date, quantity, price, orphan_status, manual_cost_basis, account_name
       FROM sentinel_imported_trades
       WHERE user_id = $1 AND is_orphan_sell = true AND orphan_status IN ('pending', 'muted')
       ORDER BY trade_date DESC LIMIT 30`,
      [userId]
    );
    if (orphanTickers.rows.length > 0) {
      console.log("\n--- PENDING/MUTED ORPHANS ---");
      console.table(orphanTickers.rows);
    }

    const dupes = await pool.query(
      `SELECT ticker, trade_date, direction, quantity, duplicate_status, file_name
       FROM sentinel_imported_trades t
       LEFT JOIN sentinel_import_batches b ON b.batch_id = t.batch_id
       WHERE t.user_id = $1 AND t.is_duplicate = true AND t.duplicate_status = 'pending'
       ORDER BY t.trade_date DESC LIMIT 20`,
      [userId]
    );
    if (dupes.rows.length > 0) {
      console.log("\n--- PENDING DUPLICATES ---");
      console.table(dupes.rows);
    }

    const cards = await pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE source = 'import')::int AS from_import,
              COUNT(*) FILTER (WHERE status = 'active')::int AS active,
              COUNT(*) FILTER (WHERE status = 'closed')::int AS closed
       FROM sentinel_trades WHERE user_id = $1`,
      [userId]
    );
    console.log("\n--- TRADING CARDS ---");
    console.table(cards.rows);

    const orders = await pool.query(
      `SELECT COUNT(*)::int AS order_levels FROM sentinel_order_levels WHERE user_id = $1`,
      [userId]
    );
    console.log("\n--- ORDER LEVELS ---");
    console.table(orders.rows);

    const dateRange = await pool.query(
      `SELECT MIN(trade_date) AS earliest, MAX(trade_date) AS latest, COUNT(DISTINCT ticker)::int AS tickers
       FROM sentinel_imported_trades WHERE user_id = $1`,
      [userId]
    );
    console.log("\n--- DATE RANGE ---");
    console.table(dateRange.rows);

    const unpromoted = await pool.query(
      `SELECT ticker, direction, trade_date, quantity, price, is_orphan_sell, orphan_status, batch_id
       FROM sentinel_imported_trades WHERE user_id = $1 AND promoted_at IS NULL ORDER BY trade_date DESC`,
      [userId]
    );
    if (unpromoted.rows.length > 0) {
      console.log("\n--- UNPROMOTED TRADES ---");
      console.table(unpromoted.rows);
    }

    const overlap = await pool.query(
      `SELECT ticker, trade_date, direction, quantity, COUNT(*)::int AS cnt
       FROM sentinel_imported_trades WHERE user_id = $1
       GROUP BY ticker, trade_date, direction, quantity HAVING COUNT(*) > 1
       ORDER BY cnt DESC LIMIT 20`,
      [userId]
    );
    if (overlap.rows.length > 0) {
      console.log("\n--- CROSS-BATCH DUPLICATE ROWS (same ticker/date/qty) ---");
      console.table(overlap.rows);
    }
  } finally {
    await pool.end();
  }
})();
