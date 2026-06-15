import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parseTosAccountStatement, tosSchwabAccountName } from "@shared/tos-account-statement";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dir = join(__dirname, "../../data/tos-imports");
let files: string[];
try {
  files = readdirSync(dir)
    .filter((f) => f.endsWith(".csv") && f.toLowerCase().includes("tos"))
    .map((f) => join(dir, f));
} catch {
  console.error(`No files found in ${dir}. Place TOS Account Statement CSVs there.`);
  process.exit(1);
}

if (files.length === 0) {
  console.error(`No TOS CSV files found in ${dir}`);
  process.exit(1);
}

for (const file of files) {
  console.log(`\n${"=".repeat(80)}`);
  console.log(`FILE: ${file.split(/[\\/]/).pop()}`);
  const csv = readFileSync(file, "utf-8");
  const result = parseTosAccountStatement(csv);

  console.log(`Account: ${result.account.accountId} (${result.account.accountName})`);
  console.log(`  Mapped name: ${tosSchwabAccountName(result.account.accountName)}`);
  console.log(`  Range: ${result.account.startDate} → ${result.account.endDate}`);
  console.log(`  Total Cash: $${result.totalCash?.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
  console.log(`  Net Liq: $${result.netLiquidatingValue?.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);

  console.log(`\n  Daily cash entries: ${result.dailyCash.length}`);
  const first = result.dailyCash[0];
  const last = result.dailyCash[result.dailyCash.length - 1];
  if (first) console.log(`    First: ${first.date} → $${first.cash.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
  if (last) console.log(`    Last:  ${last.date} → $${last.cash.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);

  const jan1 = result.dailyCash.find((d) => d.date === "2026-01-01");
  if (jan1) console.log(`    Jan 1:  $${jan1.cash.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);

  const feb17 = result.dailyCash.find((d) => d.date === "2026-02-17");
  if (feb17) console.log(`    Feb 17: $${feb17.cash.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);

  console.log(`\n  Equities: ${result.equities.length}`);
  for (const e of result.equities) {
    console.log(`    ${e.symbol}: ${e.qty} @ $${e.tradePrice.toFixed(2)}, mark $${e.mark.toFixed(2)}, value $${e.markValue.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
  }

  console.log(`\n  Others (mutual funds): ${result.others.length}`);
  for (const o of result.others) {
    console.log(`    ${o.symbol}: ${o.qty} @ $${o.tradePrice.toFixed(2)}, mark $${o.mark.toFixed(2)}, value $${o.markValue.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
  }
}
