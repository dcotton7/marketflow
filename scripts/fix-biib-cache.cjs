require("dotenv").config();
const pg = require("pg");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  // Reset BIIB's fetched_at to force re-fetch
  await pool.query(`
    UPDATE tickers 
    SET fetched_at = '2020-01-01', 
        earnings_fetched_at = NULL,
        next_earnings_date = NULL,
        next_earnings_days = NULL
    WHERE symbol = 'BIIB'
  `);
  console.log("BIIB cache reset — will re-fetch on next chart load");
  pool.end();
}
main().catch(e => { console.error(e); pool.end(); });
