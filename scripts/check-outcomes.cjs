require("dotenv").config();
const pg = require("pg");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  // Check eligible rows
  const eligible = await pool.query(`
    SELECT id, subject, signal_type, price_at_signal, subject_kind, created_at
    FROM scanner_discoveries
    WHERE price_at_signal IS NOT NULL
      AND subject_kind = 'ticker'
      AND price_1hr IS NULL
      AND created_at < NOW() - INTERVAL '1 hour'
    ORDER BY created_at ASC LIMIT 10
  `);
  console.log(`Rows eligible for 1hr outcome: ${eligible.rows.length}`);
  eligible.rows.forEach(r => console.log(`  ${r.id} ${r.subject} (${r.signal_type}) @ $${r.price_at_signal} created ${r.created_at}`));

  // Check total state
  const stats = await pool.query(`
    SELECT 
      count(*) as total,
      count(price_at_signal) as has_price,
      count(price_1hr) as has_1hr,
      min(created_at) as oldest,
      max(created_at) as newest
    FROM scanner_discoveries
  `);
  console.log("\nDB stats:", stats.rows[0]);

  pool.end();
}
main().catch(e => { console.error(e); pool.end(); });
