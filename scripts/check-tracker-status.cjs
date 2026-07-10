require('dotenv').config();
const pg = require('pg');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const r = await pool.query(`
    SELECT signal_type, subject_kind, 
      COUNT(*) as total, 
      COUNT(price_at_signal) as has_price, 
      COUNT(outcome_tracked_at) as tracked, 
      COUNT(peak_move) as has_peak
    FROM scanner_discoveries 
    GROUP BY signal_type, subject_kind 
    ORDER BY total DESC
  `);
  console.table(r.rows);
  await pool.end();
}
run().catch(e => { console.error(e.message); process.exit(1); });
