import "dotenv/config";
import { getDb, initializeDatabase } from "../db";
import { buildTradeJournalPayload } from "../sentinel/tradeJournal";

async function main() {
  await initializeDatabase();
  const db = getDb();
  const p = await buildTradeJournalPayload(db, 2);

  for (const f of ["ALL", "FIDELITY", "SCHWAB"] as const) {
    const rev = p.dailyRevenueByBroker[f];
    const dates = Object.keys(rev);
    let ytdPnl = 0;
    let ytdTrades = 0;
    for (const d of dates) {
      const r = rev[d]!;
      ytdPnl += r.realizedPnL;
      ytdTrades += r.tradeCount;
    }

    const cash = p.dailyCashByBroker[f];
    const cashDates = Object.keys(cash).sort();
    const latestDate = cashDates[cashDates.length - 1] ?? "none";
    const latestCash = cash[latestDate] ?? 0;
    const posVal = p.positionsValueByBroker[f] ?? 0;
    const snap = p.investedPctSnapshot?.[f];

    console.log(`\n── ${f} ──`);
    console.log(`  Revenue days: ${dates.length}`);
    console.log(`  YTD Realized P&L: $${ytdPnl.toLocaleString("en-US", {minimumFractionDigits: 2})}`);
    console.log(`  YTD Trades: ${ytdTrades}`);
    console.log(`  Cash (${latestDate}): $${latestCash.toLocaleString("en-US", {minimumFractionDigits: 2})}`);
    console.log(`  Positions: $${posVal.toLocaleString("en-US", {minimumFractionDigits: 2})} (${p.activePositionCountByBroker[f] ?? 0} active)`);
    console.log(`  Total: $${(latestCash + posVal).toLocaleString("en-US", {minimumFractionDigits: 2})}`);
    console.log(`  Invested: ${snap?.pct != null ? snap.pct.toFixed(1) + "%" : "null"}`);
  }

  console.log(`\nSkipped: noExit=${p.skippedNoExit}, noPnl=${p.skippedNoPnl}`);
  process.exit(0);
}
main();
