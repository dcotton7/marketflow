import { readFileSync } from "fs";
import { detectSchwabCsvType, parseSchwabRealizedGainLossLots } from "@shared/schwab-csv";
import { parseSchwabRealizedGainLossCSV } from "../sentinel/tradeImport";

const path =
  "f:/personal projects/trading programming/Trading Files/June 2026/Rollover_IRA_GainLoss_Realized_Details_20260607-184800_06072026.csv";

const content = readFileSync(path, "utf8");
console.log("detect:", detectSchwabCsvType(content));
console.log("lots:", parseSchwabRealizedGainLossLots(content).length);

const result = parseSchwabRealizedGainLossCSV(
  content,
  "Rollover_IRA_GainLoss_Realized_Details_20260607-184800_06072026.csv",
  "test"
);
console.log("batch:", {
  status: result.batch.status,
  tradesImported: result.batch.totalTradesImported,
  tradesFound: result.batch.totalTradesFound,
  skipped: result.batch.skippedRows.length,
  reason: result.batch.skippedRows[0]?.reason,
});
console.log(
  "sample:",
  result.trades.slice(0, 4).map((t) => ({
    ticker: t.ticker,
    dir: t.direction,
    qty: t.quantity,
    date: t.tradeDate,
    account: t.accountName,
  }))
);
