/**
 * Simulates one-pass Schwab RGL import: parse → dedup → orphan detect.
 * Usage: npx tsx server/scripts/testOnePassImport.ts [file1.csv] [file2.csv]
 */
import { readFileSync, existsSync } from "fs";
import { importTradeFingerprintAliases } from "@shared/import-trade-fingerprint";
import { filterNewImportTrades } from "../sentinel/importDedup";
import { parseSchwabRealizedGainLossCSV } from "../sentinel/tradeImport";
import { detectOrphanSellIds } from "../sentinel/importOrphanDetect";

const defaultPaths = [
  "f:/personal projects/trading programming/Trading Files/June 2026/Rollover_IRA_GainLoss_Realized_Details_20260607-184800_06072026.csv",
  "f:/personal projects/trading programming/Trading Files/June 2026/Designated_Bene_Individual_GainLoss_Realized_Details_20260607-205646.csv",
];

const paths = process.argv.slice(2).length > 0 ? process.argv.slice(2) : defaultPaths;
const existingFingerprints = new Set<string>();

let totalParsed = 0;
let totalImported = 0;
let totalSkipped = 0;

type TradeLike = {
  tradeId: string;
  direction: string;
  quantity: number;
  tradeDate: string;
  brokerId: string;
  rawSource: string | null;
  accountName: string | null;
  ticker: string;
};

const allTrades: TradeLike[] = [];

for (const filePath of paths) {
  if (!existsSync(filePath)) {
    console.log(`SKIP (not found): ${filePath}`);
    continue;
  }

  const csv = readFileSync(filePath, "utf8");
  const result = parseSchwabRealizedGainLossCSV(csv, filePath.split(/[/\\]/).pop() || "file.csv", "test");
  const { newTrades, skippedAlreadyImported } = filterNewImportTrades(result.trades, existingFingerprints);

  for (const t of result.trades) {
    for (const fp of importTradeFingerprintAliases(t)) {
      existingFingerprints.add(fp);
    }
  }

  totalParsed += result.trades.length;
  totalImported += newTrades.length;
  totalSkipped += skippedAlreadyImported;

  console.log(`\n${filePath}`);
  console.log(`  account: ${result.batch.accountName || "(unknown)"}`);
  console.log(`  parsed: ${result.trades.length}, new: ${newTrades.length}, skipped: ${skippedAlreadyImported}`);

  for (const t of newTrades) {
    allTrades.push({
      tradeId: t.tradeId,
      direction: t.direction,
      quantity: t.quantity,
      tradeDate: t.tradeDate,
      brokerId: t.brokerId,
      rawSource: t.rawSource,
      accountName: t.accountName,
      ticker: t.ticker,
    });
  }
}

console.log(`\n--- Combined ---`);
console.log(`Total parsed: ${totalParsed}, would import: ${totalImported}, re-import skip: ${totalSkipped}`);

const byAccount = new Map<string, TradeLike[]>();
for (const t of allTrades) {
  const key = `${t.accountName || "__default__"}`;
  const bucket = byAccount.get(key) ?? [];
  bucket.push(t);
  byAccount.set(key, bucket);
}

let totalOrphans = 0;
for (const [account, trades] of byAccount) {
  const orphanIds = detectOrphanSellIds(
    trades.map((t) => ({
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
  console.log(`  ${account}: ${trades.length} trades, orphan sells: ${orphanIds.size}`);
  totalOrphans += orphanIds.size;
}

console.log(`\nOrphan sells (expected 0): ${totalOrphans}`);
process.exit(totalOrphans > 0 ? 1 : 0);
