#!/usr/bin/env tsx
import { readFileSync } from "fs";
import { cashBalanceFromActivityRawRow } from "@shared/fidelity-csv";
import { buildChainDailyCashForAllBrokers } from "@shared/trade-journal-cash-ledger";
import {
  buildDailyInvestedPct,
  buildDailyPositionValue,
  buildCurrentInvestedPctSnapshot,
  pctInvested,
} from "@shared/trade-journal-invested";
import { parseCSV } from "../sentinel/tradeImport";

const path =
  process.argv[2] ||
  "e:/Stock-Pattern-Stream/attached_assets/2026_Activity_2_DC_Rollover_IRA__4915_1770227927933.csv";

const csv = readFileSync(path, "utf8");
const result = parseCSV(csv, "activity.csv", "test", "FIDELITY");

const importRows = result.trades.map((t, i) => ({
  id: i,
  brokerId: t.brokerId,
  tradeDate: t.tradeDate,
  accountName: t.accountName,
  rawSource: t.rawSource,
  cashBalance: t.cashBalance,
}));

const tradeCashLots = result.trades.map((t) => ({
  brokerId: t.brokerId,
  tradeDate: t.tradeDate,
  direction: t.direction,
  netAmount: t.netAmount ?? 0,
}));

const cashFromRow = (row: {
  rawSource: string | null;
  cashBalance?: number | null;
}) => {
  if (row.cashBalance != null && !Number.isNaN(row.cashBalance)) return row.cashBalance;
  return cashBalanceFromActivityRawRow(row.rawSource);
};

const chain = buildChainDailyCashForAllBrokers(importRows, tradeCashLots, cashFromRow);
const lots = result.trades.map((t) => ({
  brokerId: t.brokerId,
  tradeDate: t.tradeDate,
  direction: t.direction,
  ticker: t.ticker,
  quantity: t.quantity,
  price: t.price,
}));

const dailyPct = buildDailyInvestedPct(lots, {
  ALL: chain.ALL,
  FIDELITY: chain.FIDELITY,
  SCHWAB: chain.SCHWAB,
});

const pos = buildDailyPositionValue(lots, "FIDELITY");
const lastPosDate = Object.keys(pos).sort().pop();
const lastPos = lastPosDate ? pos[lastPosDate]! : 0;
const lastCashDate = Object.keys(chain.FIDELITY).sort().pop();
const lastCash = lastCashDate ? chain.FIDELITY[lastCashDate]! : null;

console.log("Trades:", result.trades.length);
console.log("Chain cash dates:", Object.keys(chain.FIDELITY).length);
console.log("Last cash:", lastCashDate, lastCash);
console.log("Last position cost:", lastPosDate, lastPos);
console.log("pct direct:", pctInvested(lastPos, lastCash));
console.log("snapshot:", buildCurrentInvestedPctSnapshot(lastPos, chain.FIDELITY, dailyPct.FIDELITY));
