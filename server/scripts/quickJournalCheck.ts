import "dotenv/config";
import { getDb, initializeDatabase } from "../db";
import { buildTradeJournalPayload } from "../sentinel/tradeJournal";

async function main() {
  await initializeDatabase();
  const db = getDb();
  const p = await buildTradeJournalPayload(db, 2);

  for (const f of ["ALL", "FIDELITY", "SCHWAB"] as const) {
    const cash = p.dailyCashByBroker[f];
    const dates = Object.keys(cash).sort();
    const latest = dates.length > 0 ? dates[dates.length - 1]! : "none";
    const latestCash = cash[latest] ?? 0;
    const snap = p.investedPctSnapshot?.[f];
    const posVal = p.positionsValueByBroker[f] ?? 0;
    const posCost = p.positionsCostBasisByBroker[f] ?? 0;
    const count = p.activePositionCountByBroker[f] ?? 0;

    console.log(`\n${f}:`);
    console.log(`  Latest cash: ${latest} → $${latestCash.toLocaleString("en-US", {minimumFractionDigits: 2})}`);
    console.log(`  Positions: ${count} active, value=$${posVal.toLocaleString("en-US", {minimumFractionDigits: 2})}, cost=$${posCost.toLocaleString("en-US", {minimumFractionDigits: 2})}`);
    console.log(`  Invested: ${snap?.pct != null ? snap.pct.toFixed(1) + "%" : "null"} as of ${snap?.asOfDate ?? "n/a"}`);
    console.log(`  Total (cash+positions): $${(latestCash + posVal).toLocaleString("en-US", {minimumFractionDigits: 2})}`);
  }

  process.exit(0);
}
main();
