import { readFileSync, existsSync } from "fs";
import { importTradeFingerprintAliases } from "@shared/import-trade-fingerprint";
import { filterNewImportTrades } from "../sentinel/importDedup";
import { parseCSV } from "../sentinel/tradeImport";
import { detectOrphanSellIds } from "../sentinel/importOrphanDetect";

type Trade = ReturnType<typeof parseCSV>["trades"][number];

const files: Array<{ path: string; brokerId: "SCHWAB" | "FIDELITY"; label: string }> = [
  {
    path: "e:/Stock-Pattern-Stream/attached_assets/2026_upro_Activity_1_BrokerageLink__1094_1770231252440.csv",
    brokerId: "FIDELITY",
    label: "Fidelity BrokerageLink",
  },
  {
    path: "f:/personal projects/trading programming/Trading Files/June 2026/Rollover_IRA_GainLoss_Realized_Details_20260607-184800_06072026.csv",
    brokerId: "SCHWAB",
    label: "Schwab Rollover",
  },
  {
    path: "f:/personal projects/trading programming/Trading Files/June 2026/Designated_Bene_Individual_GainLoss_Realized_Details_20260607-205646.csv",
    brokerId: "SCHWAB",
    label: "Schwab Designated Bene",
  },
];

const seen = new Set<string>();
const allTrades: Array<Trade & { source: string }> = [];

for (const f of files) {
  if (!existsSync(f.path)) {
    console.log("SKIP missing:", f.path);
    continue;
  }
  const csv = readFileSync(f.path, "utf8");
  const result = parseCSV(csv, f.path.split(/[/\\]/).pop() || "file.csv", "test", f.brokerId);
  const { newTrades, skippedAlreadyImported } = filterNewImportTrades(result.trades, seen);
  for (const t of result.trades) {
    for (const fp of importTradeFingerprintAliases(t)) seen.add(fp);
  }
  for (const t of newTrades) allTrades.push({ ...t, source: f.label });
  console.log(`${f.label}: parsed ${result.trades.length}, new ${newTrades.length}, skipped ${skippedAlreadyImported}`);
}

console.log("\nTotal imported:", allTrades.length);

const byAccount = new Map<string, typeof allTrades>();
for (const t of allTrades) {
  const key = `${t.source}|${t.accountName || "__default__"}`;
  const bucket = byAccount.get(key) ?? [];
  bucket.push(t);
  byAccount.set(key, bucket);
}

let totalOrphans = 0;
for (const [key, trades] of byAccount) {
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
  if (orphanIds.size > 0) {
    console.log(`\n${key}: ${orphanIds.size} orphans`);
    for (const id of orphanIds) {
      const t = trades.find((x) => x.tradeId === id)!;
      console.log(`  ${t.ticker} ${t.tradeDate} ${t.quantity} ${t.direction}`);
    }
  }
  totalOrphans += orphanIds.size;
}
console.log("\nTotal orphans:", totalOrphans);
