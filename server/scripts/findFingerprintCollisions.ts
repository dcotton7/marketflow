import { readFileSync } from "fs";
import { importTradeFingerprintAliases } from "@shared/import-trade-fingerprint";
import { filterNewImportTrades } from "../sentinel/importDedup";
import { parseSchwabRealizedGainLossCSV } from "../sentinel/tradeImport";
import { detectOrphanSellIds } from "../sentinel/importOrphanDetect";

const rolloverPath =
  process.argv[2] ||
  "f:/personal projects/trading programming/Trading Files/June 2026/Rollover_IRA_GainLoss_Realized_Details_20260607-184800_06072026.csv";

const csv = readFileSync(rolloverPath, "utf8");
const result = parseSchwabRealizedGainLossCSV(csv, "file.csv", "test");

const seen = new Map<string, string>();
const collisions: Array<{ fp: string; a: string; b: string }> = [];

for (const t of result.trades) {
  for (const fp of importTradeFingerprintAliases(t)) {
    const prev = seen.get(fp);
    if (prev && prev !== t.tradeId) {
      collisions.push({ fp, a: prev, b: t.tradeId });
    } else if (!prev) {
      seen.set(fp, t.tradeId);
    }
  }
}

console.log("Parsed:", result.trades.length);
console.log("Fingerprint collisions:", collisions.length);
if (collisions.length > 0) {
  console.table(collisions.slice(0, 30));
}

const { newTrades, skippedAlreadyImported } = filterNewImportTrades(result.trades, new Set());
console.log("After dedup: new", newTrades.length, "skipped", skippedAlreadyImported);

const buys = newTrades.filter((t) => t.direction === "BUY");
const sells = newTrades.filter((t) => t.direction === "SELL");
console.log("Buys:", buys.length, "Sells:", sells.length, "delta", sells.length - buys.length);

const orphanIds = detectOrphanSellIds(
  newTrades.map((t) => ({
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
console.log("Orphans:", orphanIds.size);

if (orphanIds.size > 0) {
  for (const id of orphanIds) {
    const t = newTrades.find((x) => x.tradeId === id)!;
    console.log(" ", t.ticker, t.tradeDate, t.quantity, t.rawSource);
  }
}
