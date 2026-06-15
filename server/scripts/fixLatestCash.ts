import "dotenv/config";
import { sql } from "drizzle-orm";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parseTosAccountStatement, tosSchwabAccountName } from "@shared/tos-account-statement";
import { getDb, initializeDatabase } from "../db";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const USER_ID = 2;

async function main() {
  await initializeDatabase();
  const db = getDb();

  const files = [
    join(__dirname, "../../data/tos-imports/RollOver_TOS__2026-06-08-AccountStatement.csv"),
    join(__dirname, "../../data/tos-imports/RollOver_TOS_2026-06-08-AccountStatement.csv"),
  ];

  for (const f of files) {
    const data = parseTosAccountStatement(readFileSync(f, "utf-8"));
    const acct = tosSchwabAccountName(data.account.accountName);
    const latestDate = data.dailyCash[data.dailyCash.length - 1]?.date;
    const totalCash = data.totalCash;

    if (!latestDate || totalCash == null) {
      console.log(`${acct}: no totalCash, skipping`);
      continue;
    }

    const result = await db.execute(sql`
      UPDATE sentinel_imported_trades
      SET cash_balance = ${totalCash}
      WHERE user_id = ${USER_ID}
        AND ticker = '__TOS_CASH__'
        AND account_name = ${acct}
        AND trade_date = ${latestDate}
    `);
    console.log(`${acct}: updated ${latestDate} cash from BAL to Total Cash: $${totalCash.toFixed(2)} (${(result as any).rowCount} rows)`);
  }

  // Verify
  const verify = await db.execute(sql`
    SELECT account_name, trade_date, cash_balance::numeric
    FROM sentinel_imported_trades
    WHERE user_id = ${USER_ID} AND ticker = '__TOS_CASH__'
      AND trade_date = '2026-06-08'
    ORDER BY account_name
  `);
  let total = 0;
  for (const row of verify.rows as any[]) {
    const cash = parseFloat(row.cash_balance);
    total += cash;
    console.log(`  ${row.account_name}: $${cash.toFixed(2)}`);
  }
  console.log(`  Combined Jun 8: $${total.toFixed(2)}`);

  process.exit(0);
}
main();
