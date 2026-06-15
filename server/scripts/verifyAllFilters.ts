import "dotenv/config";
import { getDb, initializeDatabase } from "../db";
import { buildTradeJournalPayload } from "../sentinel/tradeJournal";
import { resolveBrokerJournalView, type JournalBrokerFilter } from "@shared/trade-journal-invested";
import { computeCapitalFlowReturn } from "@shared/trade-journal-cash-ledger";

const USER_ID = 2;

async function main() {
  await initializeDatabase();
  const db = getDb();
  const payload = await buildTradeJournalPayload(db, USER_ID);

  for (const filter of ["ALL", "FIDELITY", "SCHWAB"] as JournalBrokerFilter[]) {
    const view = resolveBrokerJournalView(payload as any, filter);
    const cashDates = Object.keys(view.dailyCash).sort();
    const latestCashDate = cashDates[cashDates.length - 1];
    const latestCash = latestCashDate ? view.dailyCash[latestCashDate] : null;
    const totalEquity = latestCash != null ? latestCash + view.positionsValue : null;

    let ytdRealized = 0;
    let ytdTrades = 0;
    for (const [key, rev] of Object.entries(view.dailyRevenue)) {
      if (key.startsWith("2026-")) {
        ytdRealized += rev.total;
        ytdTrades += rev.tradeCount;
      }
    }

    console.log(`\n=== ${filter} ===`);
    console.log(`Cash: $${latestCash?.toFixed(2) ?? "N/A"}`);
    console.log(`Positions (market): $${view.positionsValue.toFixed(2)}`);
    console.log(`Positions (cost): $${view.positionsCostBasis.toFixed(2)}`);
    console.log(`Unrealized: $${view.unrealizedPnL.toFixed(2)}`);
    console.log(`Total: $${totalEquity?.toFixed(2) ?? "N/A"}`);
    console.log(`YTD Realized: $${ytdRealized.toFixed(2)} (${ytdTrades} trades)`);
    console.log(`Active positions: ${view.activePositionCount}`);
    console.log(`Daily position entries: ${Object.keys(view.dailyPosition).length}`);

    // Invested %
    console.log(`Invested snapshot: ${view.investedSnapshot?.pct?.toFixed(1) ?? "N/A"}%`);

    // Capital flows
    if (view.capitalFlows.length > 0) {
      console.log(`Capital flows: ${view.capitalFlows.length}`);
      for (const f of view.capitalFlows) {
        console.log(`  ${f.eventDate} | ${f.kind} | $${f.amount.toFixed(2)}`);
      }
      if (totalEquity != null) {
        const cfReturn = computeCapitalFlowReturn(totalEquity, view.capitalFlows);
        console.log(`Capital flow YTD return: ${cfReturn?.toFixed(2) ?? "N/A"}%`);
      }
    } else {
      console.log(`No capital flows — using implied method`);
      if (totalEquity != null) {
        const impliedStart = totalEquity - ytdRealized - view.unrealizedPnL;
        const impliedReturn = ((totalEquity - impliedStart) / impliedStart) * 100;
        console.log(`Implied YTD return: ${impliedReturn.toFixed(2)}%`);
      }
    }
  }

  process.exit(0);
}
main();
