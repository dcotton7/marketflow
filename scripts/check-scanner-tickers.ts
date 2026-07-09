import https from "https";
import dotenv from "dotenv";
dotenv.config();

const tickers = ["CSIQ","HUT","FCEL","MTH","IREN","AKAM","WOLF","BE","SPY","QQQ","IWM"];
const url = `https://data.alpaca.markets/v2/stocks/snapshots?symbols=${tickers.join(",")}&feed=sip`;

const req = https.get(url, {
  headers: {
    "APCA-API-KEY-ID": process.env.ALPACA_API_KEY!,
    "APCA-API-SECRET-KEY": process.env.ALPACA_API_SECRET!,
  },
}, (res) => {
  let data = "";
  res.on("data", (chunk) => (data += chunk));
  res.on("end", () => {
    const snaps = JSON.parse(data);
    console.log("Symbol   | Price     | Day Chg%  | From Open% | Prev Close | Volume");
    console.log("---------|-----------|-----------|------------|------------|----------");
    for (const sym of tickers) {
      const s = snaps[sym];
      if (!s) { console.log(`${sym.padEnd(8)} | NO DATA`); continue; }
      const price = s.latestTrade?.p ?? 0;
      const prevClose = s.prevDailyBar?.c ?? 0;
      const todayOpen = s.dailyBar?.o ?? 0;
      const dayChg = prevClose > 0 ? ((price - prevClose) / prevClose * 100) : 0;
      const fromOpen = todayOpen > 0 ? ((price - todayOpen) / todayOpen * 100) : 0;
      const vol = s.dailyBar?.v ?? 0;
      console.log(
        `${sym.padEnd(8)} | $${price.toFixed(2).padStart(7)} | ${dayChg >= 0 ? "+" : ""}${dayChg.toFixed(2).padStart(5)}% | ${fromOpen >= 0 ? "+" : ""}${fromOpen.toFixed(2).padStart(5)}% | $${prevClose.toFixed(2).padStart(7)} | ${vol.toLocaleString()}`
      );
    }
    process.exit(0);
  });
});
req.on("error", (e) => { console.error(e); process.exit(1); });
