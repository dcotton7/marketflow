import pg from "pg";

const DATABASE_URL = "postgresql://neondb_owner:npg_d1zsHf7jJRmV@ep-broad-truth-afv67u09-pooler.c-2.us-west-2.aws.neon.tech/neondb?sslmode=require";
const pool = new pg.Pool({ connectionString: DATABASE_URL });

async function main() {
  // Check stock_data_cache
  const sdc = await pool.query(`
    SELECT COUNT(*) as total, COUNT(DISTINCT symbol) as symbols 
    FROM stock_data_cache
  `);
  console.log("stock_data_cache:", sdc.rows[0]);

  // Check historical_bars
  const hb = await pool.query(`
    SELECT COUNT(*) as total, COUNT(DISTINCT symbol) as symbols 
    FROM historical_bars
  `);
  console.log("historical_bars:", hb.rows[0]);

  // Check sample from stock_data_cache
  const sdcSample = await pool.query(`
    SELECT symbol, COUNT(*) as cnt FROM stock_data_cache 
    GROUP BY symbol ORDER BY cnt DESC LIMIT 5
  `);
  console.log("stock_data_cache top symbols:", sdcSample.rows);

  // Check sample from historical_bars
  const hbSample = await pool.query(`
    SELECT symbol, COUNT(*) as cnt FROM historical_bars 
    GROUP BY symbol ORDER BY cnt DESC LIMIT 5
  `);
  console.log("historical_bars top symbols:", hbSample.rows);

  // Check date range of AAPL
  const dateRange = await pool.query(`
    SELECT MIN(bar_date) as oldest, MAX(bar_date) as newest 
    FROM historical_bars WHERE symbol = 'AAPL'
  `);
  console.log("AAPL date range:", dateRange.rows[0]);

  await pool.end();
}

main().catch(console.error);
