import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb, initializeDatabase } from "../db";

async function main() {
  await initializeDatabase();
  const db = getDb();

  // Designated Bene: positions open on Jan 1, 2026
  const desigOpen = await db.execute(sql`
    SELECT symbol, direction, entry_price, position_size, 
           entry_date::text, exit_date::text, status,
           (entry_price * COALESCE(position_size, 0)) as cost_basis
    FROM sentinel_trades
    WHERE user_id = 2
      AND (account_name ilike '%bene%' OR account_name ilike '%designated%')
      AND entry_date <= '2026-01-01'
      AND (exit_date IS NULL OR exit_date > '2026-01-01')
    ORDER BY entry_date
  `);
  
  let desigCostBasis = 0;
  console.log("=== Designated Bene: Open positions on Jan 1, 2026 ===");
  for (const r of desigOpen.rows) {
    const cb = Number(r.cost_basis) || 0;
    desigCostBasis += cb;
    console.log(`  ${r.symbol} | qty:${r.position_size} @ $${Number(r.entry_price).toFixed(2)} | cost:$${cb.toFixed(2)} | entry:${String(r.entry_date).slice(0,10)} | status:${r.status}`);
  }
  console.log(`  TOTAL cost basis: $${desigCostBasis.toFixed(2)}`);
  const desigTotal = 116383;
  const desigCash = desigTotal - desigCostBasis;
  console.log(`  Total value given: $${desigTotal}`);
  console.log(`  Derived cash: $${desigTotal} - $${desigCostBasis.toFixed(2)} = $${desigCash.toFixed(2)}`);
  console.log();

  // Rollover IRA: positions open on Feb 17, 2026
  const rolloverOpen = await db.execute(sql`
    SELECT symbol, direction, entry_price, position_size,
           entry_date::text, exit_date::text, status,
           (entry_price * COALESCE(position_size, 0)) as cost_basis
    FROM sentinel_trades
    WHERE user_id = 2
      AND (account_name ilike '%rollover%')
      AND entry_date <= '2026-02-17'
      AND (exit_date IS NULL OR exit_date > '2026-02-17')
    ORDER BY entry_date
  `);

  let rolloverCostBasis = 0;
  console.log("=== Rollover IRA: Open positions on Feb 17, 2026 ===");
  for (const r of rolloverOpen.rows) {
    const cb = Number(r.cost_basis) || 0;
    rolloverCostBasis += cb;
    console.log(`  ${r.symbol} | qty:${r.position_size} @ $${Number(r.entry_price).toFixed(2)} | cost:$${cb.toFixed(2)} | entry:${String(r.entry_date).slice(0,10)} | exit:${String(r.exit_date).slice(0,10)} | status:${r.status}`);
  }
  console.log(`  TOTAL cost basis: $${rolloverCostBasis.toFixed(2)}`);
  const rolloverTotal = 694703.02;
  const rolloverCash = rolloverTotal - rolloverCostBasis;
  console.log(`  Total value given: $${rolloverTotal}`);
  console.log(`  Derived cash: $${rolloverTotal} - $${rolloverCostBasis.toFixed(2)} = $${rolloverCash.toFixed(2)}`);
  console.log();

  // Also check: what trades happened between Feb 2-16 in Rollover
  // (these used cash BEFORE the Feb 17 deposit)
  const preDepositTrades = await db.execute(sql`
    SELECT symbol, direction, entry_price, position_size, entry_date::text,
           (entry_price * COALESCE(position_size, 0)) as cost_basis
    FROM sentinel_trades
    WHERE user_id = 2
      AND (account_name ilike '%rollover%')
      AND entry_date >= '2026-02-02'
      AND entry_date < '2026-02-17'
    ORDER BY entry_date
  `);
  let preDepositCost = 0;
  console.log("=== Rollover IRA: Trades BEFORE Feb 17 deposit ===");
  for (const r of preDepositTrades.rows) {
    const cb = Number(r.cost_basis) || 0;
    preDepositCost += cb;
    console.log(`  ${r.entry_date?.toString().slice(0,10)} | ${r.direction} ${r.symbol} | qty:${r.position_size} @ $${Number(r.entry_price).toFixed(2)} | cost:$${cb.toFixed(2)}`);
  }
  console.log(`  TOTAL pre-deposit cost: $${preDepositCost.toFixed(2)}`);
  console.log();

  console.log("=== SUMMARY ===");
  console.log(`Designated Bene cash on Jan 1, 2026: ~$${desigCash.toFixed(2)}`);
  console.log(`Rollover IRA cash on Feb 17, 2026:   ~$${rolloverCash.toFixed(2)}`);
  console.log(`Combined Schwab cash anchor (Jan 1): ~$${desigCash.toFixed(2)} (only Desig Bene existed)`);
  console.log();
  console.log("NOTE: These are approximations using cost basis, not market value.");
  console.log("Cost basis ≈ market value for recently-opened positions.");
  console.log("For older positions, market value may differ significantly.");

  process.exit(0);
}
main();
