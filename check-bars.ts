import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const result = await pool.query(`
    SELECT symbol, MIN(bar_date) as min_date, MAX(bar_date) as max_date, COUNT(*) as cnt 
    FROM historical_bars 
    WHERE symbol = 'AAPL' 
    GROUP BY symbol
  `);
  console.log("AAPL date range:", result.rows);

  const countResult = await pool.query(`
    SELECT symbol, COUNT(*) as cnt 
    FROM historical_bars 
    GROUP BY symbol 
    HAVING COUNT(*) >= 200 
    LIMIT 10
  `);
  console.log("Symbols with 200+ bars:", countResult.rows);

  await pool.end();
}

main().catch(console.error);
