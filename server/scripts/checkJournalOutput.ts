import "dotenv/config";
import { getDb, initializeDatabase } from "../db";
import { buildTradeJournalPayload } from "../sentinel/tradeJournal";

async function main() {
  await initializeDatabase();
  const db = getDb();
  const payload = await buildTradeJournalPayload(db, 2);

  console.log("=== DAILY CASH (latest 5 days) ===");
  for (const filter of ["ALL", "FIDELITY", "SCHWAB"] as const) {
    const cash = payload.dailyCashByBroker[filter];
    const dates = Object.keys(cash).sort().slice(-5);
    console.log(`\n${filter}:`);
    for (const d of dates) {
      console.log(`  ${d}: $${cash[d]!.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
    }
  }

  console.log("\n=== POSITIONS ===");
  console.log(`ALL:      value=$${payload.positionsValue.toLocaleString("en-US", {minimumFractionDigits: 2})}, cost=$${payload.positionsCostBasis.toLocaleString("en-US", {minimumFractionDigits: 2})}`);
  for (const filter of ["ALL", "FIDELITY", "SCHWAB"] as const) {
    console.log(`${filter}: value=$${(payload.positionsValueByBroker[filter] ?? 0).toLocaleString("en-US", {minimumFractionDigits: 2})}, cost=$${(payload.positionsCostBasisByBroker[filter] ?? 0).toLocaleString("en-US", {minimumFractionDigits: 2})}, count=${payload.activePositionCountByBroker[filter] ?? 0}`);
  }

  console.log("\n=== INVESTED PCT SNAPSHOT ===");
  for (const filter of ["ALL", "FIDELITY", "SCHWAB"] as const) {
    const snap = payload.investedPctSnapshot?.[filter];
    if (snap) {
      console.log(`${filter}: ${snap.asOfDate} → ${snap.pct != null ? (snap.pct * 100).toFixed(1) + "%" : "null"}`);
    } else {
      console.log(`${filter}: no snapshot`);
    }
  }

  console.log("\n=== REVENUE (latest 5 days) ===");
  for (const filter of ["ALL", "FIDELITY", "SCHWAB"] as const) {
    const rev = payload.dailyRevenueByBroker[filter];
    const dates = Object.keys(rev).sort().slice(-5);
    console.log(`\n${filter}:`);
    for (const d of dates) {
      const r = rev[d]!;
      console.log(`  ${d}: realized=$${r.realizedPnL.toFixed(2)}, trades=${r.tradeCount}`);
    }
  }

  console.log("\n=== YTD TOTALS ===");
  for (const filter of ["ALL", "FIDELITY", "SCHWAB"] as const) {
    const rev = payload.dailyRevenueByBroker[filter];
    let ytdPnl = 0;
    let ytdTrades = 0;
    for (const d of Object.keys(rev)) {
      ytdPnl += rev[d]!.realizedPnL;
      ytdTrades += rev[d]!.tradeCount;
    }
    console.log(`${filter}: YTD P&L=$${ytdPnl.toLocaleString("en-US", {minimumFractionDigits: 2})}, trades=${ytdTrades}`);
  }

  process.exit(0);
}
main();
