// Backfill script: Initialize outcome_status for existing scanner discoveries
// so the V2 outcome tracker picks them up on next cycle.

require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function backfill() {
  const client = await pool.connect();
  try {
    // Find rows with price_at_signal but no outcome_status set (or still NULL)
    const countResult = await client.query(`
      SELECT COUNT(*) as total 
      FROM scanner_discoveries 
      WHERE price_at_signal IS NOT NULL 
        AND (outcome_status IS NULL OR outcome_status = '')
    `);
    const total = parseInt(countResult.rows[0].total, 10);
    console.log(`[Backfill] Found ${total} rows needing outcome_status initialization`);

    if (total === 0) {
      console.log("[Backfill] Nothing to do.");
      return;
    }

    // Set outcome_status = 'tracking' for all eligible rows
    const updateResult = await client.query(`
      UPDATE scanner_discoveries 
      SET outcome_status = 'tracking', outcome_failed = FALSE
      WHERE price_at_signal IS NOT NULL 
        AND (outcome_status IS NULL OR outcome_status = '')
    `);
    console.log(`[Backfill] Initialized ${updateResult.rowCount} rows with outcome_status = 'tracking'`);

    // For catalyst signal types, mark them so tracker skips them
    const catalystResult = await client.query(`
      UPDATE scanner_discoveries
      SET outcome_tracked_at = NOW()
      WHERE signal_type IN ('earnings_reaction', 'news_alert')
        AND outcome_tracked_at IS NULL
        AND price_at_signal IS NOT NULL
    `);
    console.log(`[Backfill] Marked ${catalystResult.rowCount} catalyst signals as already tracked (excluded from tracker)`);

    console.log("[Backfill] Done.");
  } catch (err) {
    console.error("[Backfill] Error:", err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

backfill();
