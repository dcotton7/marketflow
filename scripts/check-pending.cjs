require('dotenv').config();
const pg = require('pg');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  // How many still pending?
  const r = await pool.query(`
    SELECT signal_type, COUNT(*) as pending
    FROM scanner_discoveries 
    WHERE outcome_tracked_at IS NULL
      AND signal_type != 'news_alert'
    GROUP BY signal_type 
    ORDER BY pending DESC
  `);
  console.log("=== STILL PENDING (not tracked) ===");
  console.table(r.rows);

  // Check lod_bounce specifically
  const r2 = await pool.query(`
    SELECT id, subject, created_at, outcome_tracked_at, peak_move
    FROM scanner_discoveries 
    WHERE signal_type = 'lod_bounce'
    ORDER BY id DESC LIMIT 3
  `);
  console.log("\n=== LOD BOUNCE latest ===");
  console.table(r2.rows);

  await pool.end();
}
run().catch(e => { console.error(e.message); process.exit(1); });
