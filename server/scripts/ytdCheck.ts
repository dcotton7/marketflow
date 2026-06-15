import "dotenv/config";
import { getDb, initializeDatabase } from "../db";
import { buildTradeJournalPayload } from "../sentinel/tradeJournal";

async function main() {
  await initializeDatabase();
  const db = getDb();
  const p = await buildTradeJournalPayload(db, 2);

  for (const f of ["ALL", "FIDELITY", "SCHWAB"] as const) {
    const rev = p.dailyRevenueByBroker[f];
    let ytdPnl = 0;
    let ytdTrades = 0;
    for (const d of Object.keys(rev)) {
      const r = rev[d];
      if (r && typeof r.realizedPnL === "number") {
        ytdPnl += r.realizedPnL;
        ytdTrades += r.tradeCount;
      }
    }
    const cash = p.dailyCashByBroker[f];
    const dates = Object.keys(cash).sort();
    const latestDate = dates[dates.length - 1] ?? "none";
    const latestCash = cash[latestDate] ?? 0;
    const jan1Cash = cash["2026-01-01"] ?? cash["2026-01-02"] ?? null;
    const posVal = p.positionsValueByBroker[f] ?? 0;

    console.log(`\n${f}:`);
    console.log(`  YTD Realized P&L: $${ytdPnl.toLocaleString("en-US", {minimumFractionDigits: 2})}`);
    console.log(`  YTD Closed trades: ${ytdTrades}`);
    console.log(`  Latest cash (${latestDate}): $${latestCash.toLocaleString("en-US", {minimumFractionDigits: 2})}`);
    console.log(`  Jan 1 cash: ${jan1Cash != null ? "$" + jan1Cash.toLocaleString("en-US", {minimumFractionDigits: 2}) : "none"}`);
    console.log(`  Current positions: $${posVal.toLocaleString("en-US", {minimumFractionDigits: 2})}`);
    console.log(`  Cash+Pos total: $${(latestCash + posVal).toLocaleString("en-US", {minimumFractionDigits: 2})}`);
  }
  process.exit(0);
}
main();
