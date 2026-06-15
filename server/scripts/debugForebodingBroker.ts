#!/usr/bin/env tsx
import "dotenv/config";
import { eq } from "drizzle-orm";
import { getDb, initializeDatabase } from "../db";
import { buildTradeJournalPayload } from "../sentinel/tradeJournal";
import { sentinelTrades, sentinelImportedTrades } from "@shared/schema";
import {
  buildAccountBrokerMap,
  inferBrokerFromAccountName,
} from "@shared/trade-journal-invested";

async function main() {
  await initializeDatabase();
  const db = getDb();
  if (!db) process.exit(1);
  const userId = 2;

  const trades = await db
    .select({
      id: sentinelTrades.id,
      symbol: sentinelTrades.symbol,
      status: sentinelTrades.status,
      accountName: sentinelTrades.accountName,
      source: sentinelTrades.source,
    })
    .from(sentinelTrades)
    .where(eq(sentinelTrades.userId, userId));

  const imports = await db
    .select({
      accountName: sentinelImportedTrades.accountName,
      brokerId: sentinelImportedTrades.brokerId,
    })
    .from(sentinelImportedTrades)
    .where(eq(sentinelImportedTrades.userId, userId))
    .limit(5);

  const map = buildAccountBrokerMap(imports);
  const accountCounts = new Map<string, number>();
  const brokerCounts = { FIDELITY: 0, SCHWAB: 0, null: 0 };
  for (const t of trades) {
    const acct = t.accountName ?? "(null)";
    accountCounts.set(acct, (accountCounts.get(acct) ?? 0) + 1);
    const b = inferBrokerFromAccountName(t.accountName, map);
    if (b === "FIDELITY") brokerCounts.FIDELITY++;
    else if (b === "SCHWAB") brokerCounts.SCHWAB++;
    else brokerCounts.null++;
  }

  console.log("Import rows:", imports.length, "sample:", imports[0]);
  console.log("Trades by account:", [...accountCounts.entries()].sort((a, b) => b[1] - a[1]));
  console.log("Broker attribution:", brokerCounts);

  const payload = await buildTradeJournalPayload(db, userId);
  console.log("\nPayload broker slices:");
  console.log("  ALL revenue days:", Object.keys(payload.dailyRevenue).length);
  console.log("  FIDELITY revenue days:", Object.keys(payload.dailyRevenueByBroker.FIDELITY).length);
  console.log("  SCHWAB revenue days:", Object.keys(payload.dailyRevenueByBroker.SCHWAB).length);
  console.log("  ALL cash days:", Object.keys(payload.dailyCashByBroker.ALL).length);
  console.log("  FIDELITY cash days:", Object.keys(payload.dailyCashByBroker.FIDELITY).length);
  console.log("  SCHWAB cash days:", Object.keys(payload.dailyCashByBroker.SCHWAB).length);
  console.log("  positions ALL:", payload.positionsValue);
  console.log("  positions FIDELITY:", payload.positionsValueByBroker.FIDELITY);
  console.log("  positions SCHWAB:", payload.positionsValueByBroker.SCHWAB);
  console.log("  anchors:", payload.cashLedger.anchors);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
