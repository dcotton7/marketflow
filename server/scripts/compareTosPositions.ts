import "dotenv/config";
import { sql } from "drizzle-orm";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parseTosAccountStatement, tosSchwabAccountName } from "@shared/tos-account-statement";
import { getDb, initializeDatabase } from "../db";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  await initializeDatabase();
  const db = getDb();

  const files = [
    join(__dirname, "../../data/tos-imports/RollOver_TOS__2026-06-08-AccountStatement.csv"),
    join(__dirname, "../../data/tos-imports/RollOver_TOS_2026-06-08-AccountStatement.csv"),
  ];

  const parsed = files.map((f) => {
    const content = readFileSync(f, "utf-8");
    return parseTosAccountStatement(content);
  });

  console.log("=== TOS Positions (what TOS says) ===");
  let tosEquityTotal = 0;
  let tosFundTotal = 0;
  let tosUnrealizedTotal = 0;

  for (const data of parsed) {
    const acct = tosSchwabAccountName(data.account.accountName);
    console.log(`\n${acct}:`);

    if (data.equities.length > 0) {
      console.log("  Equities:");
      for (const eq of data.equities) {
        const cost = eq.tradePrice * eq.qty;
        const unrealized = eq.markValue - cost;
        tosEquityTotal += eq.markValue;
        tosUnrealizedTotal += unrealized;
        console.log(`    ${eq.symbol}: ${eq.qty} shares, cost=$${eq.tradePrice.toFixed(2)}/sh, mark=$${eq.mark.toFixed(2)}/sh, value=$${eq.markValue.toFixed(2)}, unrealized=$${unrealized.toFixed(2)}`);
      }
    }

    if (data.others.length > 0) {
      console.log("  Mutual Funds:");
      for (const f of data.others) {
        const cost = f.tradePrice * f.qty;
        const unrealized = f.markValue - cost;
        tosFundTotal += f.markValue;
        tosUnrealizedTotal += unrealized;
        console.log(`    ${f.symbol}: ${f.qty} shares, cost=$${f.tradePrice.toFixed(2)}/sh, mark=$${f.mark.toFixed(2)}/sh, value=$${f.markValue.toFixed(2)}, unrealized=$${unrealized.toFixed(2)}`);
      }
    }
  }

  console.log(`\nTOS Totals: equities=$${tosEquityTotal.toFixed(2)}, funds=$${tosFundTotal.toFixed(2)}, total unrealized=$${tosUnrealizedTotal.toFixed(2)}`);

  // Compare with DB
  const dbPos = await db.execute(sql`
    SELECT symbol, account_name, position_size::numeric as qty, entry_price::numeric as price
    FROM sentinel_trades
    WHERE user_id = 2 AND status = 'active'
    ORDER BY account_name, symbol
  `);

  let dbTotal = 0;
  console.log("\n=== DB Positions (what we have) ===");
  for (const row of dbPos.rows as any[]) {
    const cost = parseFloat(row.qty) * parseFloat(row.price);
    dbTotal += cost;
    console.log(`  ${row.account_name} | ${row.symbol}: ${row.qty} @ $${parseFloat(row.price).toFixed(4)} = $${cost.toFixed(2)}`);
  }
  console.log(`DB Total cost: $${dbTotal.toFixed(2)}`);

  process.exit(0);
}
main();
