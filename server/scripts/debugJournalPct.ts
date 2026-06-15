#!/usr/bin/env tsx
import "dotenv/config";
import { asc, eq } from "drizzle-orm";
import { getDb, initializeDatabase } from "../db";
import { buildTradeJournalPayload } from "../sentinel/tradeJournal";
import { sentinelImportedTrades } from "@shared/schema";
import { cashBalanceFromActivityRawRow } from "@shared/fidelity-csv";
import { buildDailyCashByBroker, buildDailyInvestedPct } from "@shared/trade-journal-invested";

async function main() {
  await initializeDatabase();
  const db = getDb();
  if (!db) {
    console.error("No DB");
    process.exit(1);
  }
  const userId = Number(process.argv[2] || 1);

  const rows = await db
    .select({
      id: sentinelImportedTrades.id,
      brokerId: sentinelImportedTrades.brokerId,
      tradeDate: sentinelImportedTrades.tradeDate,
      accountName: sentinelImportedTrades.accountName,
      rawSource: sentinelImportedTrades.rawSource,
      cashBalance: sentinelImportedTrades.cashBalance,
      direction: sentinelImportedTrades.direction,
      ticker: sentinelImportedTrades.ticker,
    })
    .from(sentinelImportedTrades)
    .where(eq(sentinelImportedTrades.userId, userId))
    .orderBy(asc(sentinelImportedTrades.id));

  console.log("Total import rows:", rows.length);
  const fidelity = rows.filter((r) => r.brokerId?.toUpperCase() === "FIDELITY");
  const schwab = rows.filter((r) => r.brokerId?.toUpperCase() === "SCHWAB");
  console.log("Fidelity rows:", fidelity.length, "Schwab:", schwab.length);

  const withCashCol = fidelity.filter((r) => r.cashBalance != null);
  const withRawCash = fidelity.filter((r) => cashBalanceFromActivityRawRow(r.rawSource) != null);
  console.log("Fidelity with cashBalance col:", withCashCol.length);
  console.log("Fidelity with rawSource cash:", withRawCash.length);

  if (withCashCol.length > 0) {
    const last = withCashCol[withCashCol.length - 1]!;
    console.log("Last fidelity cash row:", {
      date: last.tradeDate,
      cashBalance: last.cashBalance,
      ticker: last.ticker,
      account: last.accountName,
    });
  }

  const cashFromRow = (row: {
    rawSource: string | null;
    cashBalance?: number | null;
  }) => {
    if (row.cashBalance != null && !Number.isNaN(row.cashBalance)) return row.cashBalance;
    return cashBalanceFromActivityRawRow(row.rawSource);
  };

  const importedCash = buildDailyCashByBroker(rows, cashFromRow);
  console.log("\nFidelity cash dates:", Object.keys(importedCash.FIDELITY).length);
  const fidDates = Object.keys(importedCash.FIDELITY).sort();
  if (fidDates.length > 0) {
    console.log("First/last fidelity cash:", fidDates[0], importedCash.FIDELITY[fidDates[0]!], "...", fidDates[fidDates.length - 1], importedCash.FIDELITY[fidDates[fidDates.length - 1]!]);
  }

  const tradeLots = rows.map((r) => ({
    brokerId: r.brokerId,
    tradeDate: r.tradeDate,
    direction: r.direction,
    ticker: r.ticker,
    quantity: 0,
    price: 0,
  }));

  const payload = await buildTradeJournalPayload(db, userId);
  console.log("\nInvested snapshot FIDELITY:", payload.investedPctSnapshot.FIDELITY);
  console.log("Invested snapshot SCHWAB:", payload.investedPctSnapshot.SCHWAB);
  console.log("Fidelity invested pct dates:", Object.keys(payload.dailyInvestedPct.FIDELITY).length);
  console.log("manualCashBrokers:", payload.manualCashBrokers);
  console.log("cashLedger anchors:", payload.cashLedger.anchors);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
