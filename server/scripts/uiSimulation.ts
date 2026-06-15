import "dotenv/config";
import { getDb, initializeDatabase } from "../db";
import { buildTradeJournalPayload } from "../sentinel/tradeJournal";

async function main() {
  await initializeDatabase();
  const db = getDb();
  const p = await buildTradeJournalPayload(db, 2);

  for (const f of ["ALL", "FIDELITY", "SCHWAB"] as const) {
    const rev = p.dailyRevenueByBroker[f];
    let ytdTotal = 0;
    let ytdTrades = 0;
    let ytdDays = 0;
    for (const [dayKey, dayData] of Object.entries(rev)) {
      if (!dayKey.startsWith("2026-")) continue;
      ytdTotal += dayData.total;
      ytdTrades += dayData.tradeCount;
      ytdDays++;
    }

    const cash = p.dailyCashByBroker[f];
    const cashDates = Object.keys(cash).sort();
    const latestDate = cashDates[cashDates.length - 1] ?? "none";
    const latestCash = cash[latestDate] ?? 0;
    const posVal = p.positionsValueByBroker[f] ?? 0;
    const total = latestCash + posVal;
    const snap = p.investedPctSnapshot?.[f];
    const unrealPnl = p.unrealizedPnLByBroker[f] ?? 0;

    console.log(`\n── ${f} (what the UI shows) ──`);
    console.log(`  YTD Realized: $${ytdTotal.toLocaleString("en-US", {minimumFractionDigits: 2})}`);
    console.log(`  YTD Trading days: ${ytdDays}, Trades: ${ytdTrades}`);
    console.log(`  Cash (${latestDate}): $${latestCash.toLocaleString("en-US", {minimumFractionDigits: 2})}`);
    console.log(`  Positions (cost): $${posVal.toLocaleString("en-US", {minimumFractionDigits: 2})} (${p.activePositionCountByBroker[f] ?? 0})`);
    console.log(`  Unrealized P&L: $${unrealPnl.toLocaleString("en-US", {minimumFractionDigits: 2})}`);
    console.log(`  Cash+Pos: $${total.toLocaleString("en-US", {minimumFractionDigits: 2})}`);
    console.log(`  Invested: ${snap?.pct != null ? snap.pct.toFixed(1) + "%" : "—"}`);
  }
  process.exit(0);
}
main();
