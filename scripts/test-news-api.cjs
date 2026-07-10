require("dotenv").config();
const FMP_KEY = (process.env.FMP_API_KEY || "").replace(/['"]/g, "").trim();

async function testFmpEndpoints() {
  const endpoints = [
    `https://financialmodelingprep.com/api/v3/stock_news?tickers=AAPL&limit=3&apikey=${FMP_KEY}`,
    `https://financialmodelingprep.com/api/v3/fmp/articles?page=0&size=3&apikey=${FMP_KEY}`,
    `https://financialmodelingprep.com/stable/news?tickers=AAPL&limit=3&apikey=${FMP_KEY}`,
  ];
  for (const url of endpoints) {
    const label = url.split("?")[0].replace(`https://financialmodelingprep.com`, "");
    try {
      const res = await fetch(url);
      const text = await res.text();
      console.log(`${label} => ${res.status}: ${text.slice(0, 200)}`);
    } catch (e) {
      console.log(`${label} => ERROR: ${e.message}`);
    }
    console.log();
  }
}
testFmpEndpoints();
