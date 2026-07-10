require("dotenv").config();
const FMP_KEY = (process.env.FMP_API_KEY || "").replace(/['"]/g, "").trim();
const FINNHUB_KEY = (process.env.FINNHUB_API_KEY || "").replace(/['"]/g, "").trim();

async function main() {
  // Test FMP earnings calendar for BIIB
  console.log("=== FMP Earnings Calendar ===");
  const fmpUrl = `https://financialmodelingprep.com/stable/earning_calendar?symbol=BIIB&apikey=${FMP_KEY}`;
  try {
    const res = await fetch(fmpUrl);
    console.log("Status:", res.status);
    const data = await res.json();
    console.log("Data:", JSON.stringify(data).slice(0, 500));
  } catch (e) {
    console.log("Error:", e.message);
  }

  // Test FMP profile for BIIB
  console.log("\n=== FMP Profile ===");
  const profUrl = `https://financialmodelingprep.com/stable/profile?symbol=BIIB&apikey=${FMP_KEY}`;
  try {
    const res = await fetch(profUrl);
    console.log("Status:", res.status);
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      const p = data[0];
      console.log("Name:", p.companyName);
      console.log("Description:", (p.description || "").slice(0, 150));
      console.log("Sector:", p.sector);
      console.log("Industry:", p.industry);
    } else {
      console.log("Data:", JSON.stringify(data).slice(0, 300));
    }
  } catch (e) {
    console.log("Error:", e.message);
  }

  // Test Finnhub earnings for BIIB
  console.log("\n=== Finnhub Earnings Surprises ===");
  const fhUrl = `https://finnhub.io/api/v1/stock/earnings?symbol=BIIB&token=${FINNHUB_KEY}`;
  try {
    const res = await fetch(fhUrl);
    console.log("Status:", res.status);
    const data = await res.json();
    if (Array.isArray(data)) {
      console.log(`Got ${data.length} quarters`);
      data.slice(0, 3).forEach(q => console.log(`  ${q.period}: actual=${q.actual}, estimate=${q.estimate}`));
    } else {
      console.log("Data:", JSON.stringify(data).slice(0, 300));
    }
  } catch (e) {
    console.log("Error:", e.message);
  }

  // Check DB cache
  console.log("\n=== DB Cache ===");
  const pg = require("pg");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const rows = await pool.query(`
    SELECT symbol, next_earnings_date, next_earnings_days, earnings_time, 
           last_earnings_date, eps_actual, eps_estimate, last_eps_surprise,
           company_description, profile_fetched_at, earnings_fetched_at, fetched_at
    FROM tickers WHERE symbol = 'BIIB'
  `);
  if (rows.rows.length > 0) {
    console.log(rows.rows[0]);
  } else {
    console.log("BIIB not in tickers cache");
  }
  pool.end();
}
main().catch(console.error);
