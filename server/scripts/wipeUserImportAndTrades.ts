#!/usr/bin/env tsx
import "dotenv/config";
import pg from "pg";

(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("No DATABASE_URL");
    process.exit(1);
  }
  const username = process.argv[2] || "Mythical";
  const pool = new pg.Pool({ connectionString: url, max: 2 });

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
    console.log("Wiping import + trades for:", userRes.rows[0]);

    await pool.query("BEGIN");

    const tradeIds = await pool.query(
      `SELECT id FROM sentinel_trades WHERE user_id = $1`,
      [userId]
    );
    const ids = tradeIds.rows.map((r: { id: number }) => r.id);

    let orderLevels = 0;
    let evaluations = 0;
    let events = 0;
    let labels = 0;
    let trades = 0;

    if (ids.length > 0) {
      const r1 = await pool.query(
        `DELETE FROM sentinel_order_levels WHERE user_id = $1 RETURNING id`,
        [userId]
      );
      orderLevels = r1.rowCount ?? 0;

      const r2 = await pool.query(
        `DELETE FROM sentinel_evaluations WHERE user_id = $1 RETURNING id`,
        [userId]
      );
      evaluations = r2.rowCount ?? 0;

      const r3 = await pool.query(
        `DELETE FROM sentinel_events WHERE user_id = $1 RETURNING id`,
        [userId]
      );
      events = r3.rowCount ?? 0;

      const r4 = await pool.query(
        `DELETE FROM sentinel_trade_to_labels WHERE trade_id = ANY($1::int[]) RETURNING trade_id`,
        [ids]
      );
      labels = r4.rowCount ?? 0;

      const r5 = await pool.query(
        `DELETE FROM sentinel_trades WHERE user_id = $1 RETURNING id`,
        [userId]
      );
      trades = r5.rowCount ?? 0;
    }

    const r6 = await pool.query(
      `DELETE FROM sentinel_imported_trades WHERE user_id = $1 RETURNING id`,
      [userId]
    );
    const importedTrades = r6.rowCount ?? 0;

    const r7 = await pool.query(
      `DELETE FROM sentinel_import_batches WHERE user_id = $1 RETURNING id`,
      [userId]
    );
    const batches = r7.rowCount ?? 0;

    await pool.query("COMMIT");

    console.log({
      tradingCards: trades,
      orderLevels,
      evaluations,
      events,
      labelLinks: labels,
      importedTrades,
      importBatches: batches,
    });
    console.log("Done — clean slate for", username);
  } catch (err) {
    await pool.query("ROLLBACK").catch(() => {});
    console.error(err);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
