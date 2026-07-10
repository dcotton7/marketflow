require("dotenv").config();
const pg = require("pg");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  // Check gap signals - are they all identical?
  const gaps = await pool.query(`
    SELECT id, subject, headline, magnitude, price_at_signal, direction, created_at
    FROM scanner_discoveries 
    WHERE signal_type = 'gap' 
    ORDER BY id DESC LIMIT 15
  `);
  console.log("=== Recent gap signals ===");
  gaps.rows.forEach(r => console.log(`  ${r.id} ${r.subject} dir=${r.direction} mag=${r.magnitude} price=$${r.price_at_signal} hl="${r.headline?.slice(0,60)}"`));

  // Check if headlines are duplicated
  const dupes = await pool.query(`
    SELECT headline, count(*) as cnt 
    FROM scanner_discoveries 
    WHERE signal_type = 'gap' 
    GROUP BY headline 
    ORDER BY cnt DESC LIMIT 5
  `);
  console.log("\n=== Most common gap headlines ===");
  dupes.rows.forEach(r => console.log(`  [${r.cnt}x] "${r.headline?.slice(0,80)}"`));

  // Check distinct magnitudes
  const mags = await pool.query(`
    SELECT magnitude, count(*) as cnt 
    FROM scanner_discoveries 
    WHERE signal_type = 'gap' 
    GROUP BY magnitude 
    ORDER BY cnt DESC LIMIT 10
  `);
  console.log("\n=== Gap magnitude distribution ===");
  mags.rows.forEach(r => console.log(`  ${r.magnitude}: ${r.cnt} signals`));

  pool.end();
}
main().catch(e => { console.error(e); pool.end(); });
