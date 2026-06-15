import { readFileSync } from "fs";
import {
  importTradeFingerprint,
  importTradeFingerprintAliases,
  schwabRglLotKey,
} from "@shared/import-trade-fingerprint";
import { filterNewImportTrades } from "../sentinel/importDedup";
import { parseSchwabRealizedGainLossCSV } from "../sentinel/tradeImport";
import { detectOrphanSellIds } from "../sentinel/importOrphanDetect";

const rolloverPath =
  process.argv[2] ||
  "f:/personal projects/trading programming/Trading Files/June 2026/Rollover_IRA_GainLoss_Realized_Details_20260607-184800_06072026.csv";

const csv = readFileSync(rolloverPath, "utf8");
const result = parseSchwabRealizedGainLossCSV(csv, "Rollover_IRA.csv", "test");

const rcat = result.trades.filter((t) => t.ticker === "RCAT");
const rcatBuys = rcat.filter((t) => t.direction === "BUY");
const rcatSells = rcat.filter((t) => t.direction === "SELL");

console.log("RCAT buys", rcatBuys.length, "sells", rcatSells.length);
console.log(
  "RCAT buy fingerprints unique",
  new Set(rcatBuys.map((t) => importTradeFingerprint(t))).size
);

const { newTrades, skippedAlreadyImported } = filterNewImportTrades(result.trades, new Set());
console.log("Fresh import all new:", newTrades.length, "skipped", skippedAlreadyImported);

const secondPass = filterNewImportTrades(result.trades, new Set(result.trades.flatMap((t) => importTradeFingerprintAliases(t))));
console.log("Re-import same file skipped:", secondPass.skippedAlreadyImported, "expected", result.trades.length);

const rcatOrphans = detectOrphanSellIds(
  rcat.map((t) => ({
    id: t.tradeId,
    direction: t.direction,
    quantity: t.quantity,
    tradeDate: new Date(t.tradeDate),
    brokerId: t.brokerId,
    rawSource: t.rawSource,
    accountName: t.accountName,
    isCurrentImport: true,
  })),
  false,
  { onlyFlagCurrentImport: true }
);
console.log("RCAT orphan sells after fix:", rcatOrphans.size, "expected 0");
console.log("Sample lot key:", schwabRglLotKey(rcat[0]?.rawSource));
