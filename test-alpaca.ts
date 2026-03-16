import "dotenv/config";

const ALPACA_DATA_URL = "https://data.alpaca.markets";

async function main() {
  const apiKey = process.env.ALPACA_API_KEY;
  const apiSecret = process.env.ALPACA_API_SECRET;
  
  console.log("API Key:", apiKey?.substring(0, 8) + "...");
  
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 400); // Request 400 days to test
  
  console.log("Start date:", startDate.toISOString());
  console.log("End date:", endDate.toISOString());
  
  const params = new URLSearchParams({
    symbols: "AAPL",
    start: startDate.toISOString(),
    end: endDate.toISOString(),
    timeframe: "1Day",
    feed: "sip",
    limit: "10000",
  });
  
  const url = `${ALPACA_DATA_URL}/v2/stocks/bars?${params}`;
  console.log("Fetching:", url.substring(0, 100) + "...");
  
  const resp = await fetch(url, {
    headers: {
      "APCA-API-KEY-ID": apiKey!,
      "APCA-API-SECRET-KEY": apiSecret!,
    },
  });
  
  if (!resp.ok) {
    const text = await resp.text();
    console.error("Error:", resp.status, text);
    return;
  }
  
  const data = await resp.json();
  const bars = data.bars?.AAPL || [];
  
  console.log("Bars returned:", bars.length);
  if (bars.length > 0) {
    console.log("First bar:", bars[0].t);
    console.log("Last bar:", bars[bars.length - 1].t);
  }
  
  console.log("Next page token:", data.next_page_token || "none");
}

main().catch(console.error);
