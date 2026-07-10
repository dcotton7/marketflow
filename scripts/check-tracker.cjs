require("dotenv").config();
const pg = require("pg");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  const byType = await pool.query(`
    SELECT signal_type, count(*) as cnt, 
           count(price_15m) as has_15m, count(price_30m) as has_30m, 
           count(price_1hr) as has_1hr, count(peak_move) as has_peak,
           count(outcome_tracked_at) as complete
    FROM scanner_discoveries 
    WHERE subject_kind = 'ticker'
    GROUP BY signal_type ORDER BY cnt DESC
  `);
  console.log("=== Ticker signals by type ===");
  byType.rows.forEach(r => console.log(r));

  const totals = await pool.query(`
    SELECT count(*) as total, 
           count(CASE WHEN subject_kind = 'ticker' THEN 1 END) as tickers,
           count(CASE WHEN subject_kind != 'ticker' THEN 1 END) as non_tickers,
           count(price_at_signal) as has_price,
           count(price_15m) as has_15m,
           count(peak_move) as has_peak,
           count(outcome_tracked_at) as complete
    FROM scanner_discoveries
  `);
  console.log("\n=== Overall ===");
  console.log(totals.rows[0]);

  // Check if tracker is running - look at recently updated rows
  const recent = await pool.query(`
    SELECT id, subject, signal_type, peak_move, outcome_status, 
           price_15m, price_30m, price_1hr
    FROM scanner_discoveries 
    WHERE peak_move IS NOT NULL 
    ORDER BY id DESC LIMIT 5
  `);
  console.log("\n=== Recently tracked (has peak_move) ===");
  recent.rows.forEach(r => console.log(r));

  pool.end();
}
main().catch(e => { console.error(e); pool.end(); });
