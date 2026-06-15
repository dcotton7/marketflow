import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb, initializeDatabase } from "../db";

async function main() {
  await initializeDatabase();
  const db = getDb();
  const r = await db.execute(sql`
    SELECT symbol, account_name, position_size, entry_price,
           (position_size * entry_price)::numeric(15,2) as notional,
           direction
    FROM sentinel_trades
    WHERE user_id = 2 AND status = 'active'
    ORDER BY account_name, symbol
  `);
  let total = 0;
  let schwabTotal = 0;
  let fidelityTotal = 0;
  for (const row of r.rows as any[]) {
    const n = parseFloat(row.notional);
    total += n;
    const acct = row.account_name ?? "";
    if (acct.toLowerCase().includes("schwab") || acct.toLowerCase().includes("bene") || acct.toLowerCase().includes("rollover")) {
      schwabTotal += n;
    } else {
      fidelityTotal += n;
    }
    console.log(`${acct} | ${row.symbol} | qty=${row.position_size} @ $${parseFloat(row.entry_price).toFixed(4)} = $${row.notional}`);
  }
  console.log(`\nTotal: $${total.toFixed(2)}`);
  console.log(`Schwab: $${schwabTotal.toFixed(2)}`);
  console.log(`Fidelity: $${fidelityTotal.toFixed(2)}`);
  console.log(`Position count: ${r.rows.length}`);
  process.exit(0);
}
main();
