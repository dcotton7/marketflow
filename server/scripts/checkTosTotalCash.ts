import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parseTosAccountStatement, tosSchwabAccountName } from "@shared/tos-account-statement";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const files = [
  join(__dirname, "../../data/tos-imports/RollOver_TOS__2026-06-08-AccountStatement.csv"),
  join(__dirname, "../../data/tos-imports/RollOver_TOS_2026-06-08-AccountStatement.csv"),
];

for (const f of files) {
  const data = parseTosAccountStatement(readFileSync(f, "utf-8"));
  const acct = tosSchwabAccountName(data.account.accountName);
  const lastBal = data.dailyCash[data.dailyCash.length - 1];
  console.log(`${acct}:`);
  console.log(`  Latest BAL (start-of-day): ${lastBal?.date} → $${lastBal?.cash.toFixed(2)}`);
  console.log(`  Total Cash (after trades): $${data.totalCash?.toFixed(2) ?? "N/A"}`);
  console.log(`  Equities count: ${data.equities.length}`);
  console.log(`  Others count: ${data.others.length}`);
}
