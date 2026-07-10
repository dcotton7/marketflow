require('dotenv').config();
const pg = require('pg');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const r = await pool.query(`
    SELECT id, signal_type, subject, created_at, price_at_signal, 
           peak_move, worst_drawdown, 
           price_15m, move_15m, price_30m, move_30m, price_1hr, move_1hr,
           outcome_tracked_at
    FROM scanner_discoveries 
    WHERE signal_type = 'lod_bounce' 
    ORDER BY id DESC LIMIT 5
  `);
  console.table(r.rows);
  await pool.end();
}
run().catch(e => { console.error(e.message); process.exit(1); });
