import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb, initializeDatabase } from "../db";

async function main() {
  await initializeDatabase();
  const db = getDb();

  // Get all Schwab trade cash flows from Jan 1 onward
  // BUY = cash out (negative), SELL = cash in (positive)
  const trades = await db.execute(sql`
    SELECT account_name, direction, 
           sum(CASE WHEN direction = 'long' THEN -(entry_price * COALESCE(position_size, 0)) ELSE 0 END) as buy_cost,
           count(*) FILTER (WHERE direction = 'long') as buy_count
    FROM sentinel_trades
    WHERE user_id = 2
      AND (account_name ilike '%rollover%')
      AND status = 'closed'
    GROUP BY account_name, direction
  `);

  // Better approach: compute net cash impact per trade
  // For closed trades: bought at entry_price, sold at exit_price
  // Net cash impact = (exit_price * position_size) - (entry_price * position_size) + actual_pnl... 
  // Actually simpler: for a round trip, cash out = entry_price * qty, cash in = exit_price * qty
  // For active positions: only cash out

  const rolloverTrades = await db.execute(sql`
    SELECT symbol, status, direction, entry_price, exit_price, position_size,
           entry_date::text, exit_date::text, actual_pnl, lot_entries
    FROM sentinel_trades
    WHERE user_id = 2
      AND (account_name ilike '%rollover%')
    ORDER BY entry_date
  `);

  let cashImpact = 0;
  for (const t of rolloverTrades.rows) {
    const qty = Number(t.position_size) || 0;
    const entryP = Number(t.entry_price) || 0;
    const exitP = Number(t.exit_price) || 0;
    
    // Parse lot_entries for actual cash flows
    const lots = (t.lot_entries as any[]) || [];
    let lotBuyCash = 0, lotSellCash = 0;
    for (const lot of lots) {
      const lotQty = parseFloat(String(lot.qty || "0").replace(/,/g, ""));
      const lotPrice = parseFloat(String(lot.price || "0").replace(/[$,]/g, ""));
      const side = String(lot.buySell || "").toUpperCase();
      if (side === "BUY") lotBuyCash += lotQty * lotPrice;
      else if (side === "SELL") lotSellCash += lotQty * lotPrice;
    }

    if (lots.length > 0) {
      cashImpact += (lotSellCash - lotBuyCash);
    } else if (t.status === "closed") {
      cashImpact += (exitP * qty) - (entryP * qty);
    } else {
      // Active position: only bought, cash went out
      cashImpact -= (entryP * qty);
    }
  }

  console.log("=== Rollover IRA Cash Back-Calculation ===");
  console.log(`Net cash impact of all trades: $${cashImpact.toFixed(2)}`);
  console.log(`Current cash from TOS: $174,715.94`);
  console.log(`Starting cash = Current - trade impact = $${(174715.94 - cashImpact).toFixed(2)}`);
  console.log();

  // Same for Designated Bene
  const desigTrades = await db.execute(sql`
    SELECT symbol, status, direction, entry_price, exit_price, position_size,
           entry_date::text, exit_date::text, actual_pnl, lot_entries
    FROM sentinel_trades
    WHERE user_id = 2
      AND (account_name ilike '%bene%' OR account_name ilike '%designated%')
    ORDER BY entry_date
  `);

  let desigCashImpact = 0;
  for (const t of desigTrades.rows) {
    const qty = Number(t.position_size) || 0;
    const entryP = Number(t.entry_price) || 0;
    const exitP = Number(t.exit_price) || 0;
    
    const lots = (t.lot_entries as any[]) || [];
    let lotBuyCash = 0, lotSellCash = 0;
    for (const lot of lots) {
      const lotQty = parseFloat(String(lot.qty || "0").replace(/,/g, ""));
      const lotPrice = parseFloat(String(lot.price || "0").replace(/[$,]/g, ""));
      const side = String(lot.buySell || "").toUpperCase();
      if (side === "BUY") lotBuyCash += lotQty * lotPrice;
      else if (side === "SELL") lotSellCash += lotQty * lotPrice;
    }

    if (lots.length > 0) {
      desigCashImpact += (lotSellCash - lotBuyCash);
    } else if (t.status === "closed") {
      desigCashImpact += (exitP * qty) - (entryP * qty);
    } else {
      desigCashImpact -= (entryP * qty);
    }
  }

  // We need current Desig Bene cash from TOS too
  // From the ALL ACCOUNTS screenshot: total cash was $109,065
  // But Rollover alone is $174,716... so Desig Bene might have negative or we misread
  console.log("=== Designated Bene Cash Back-Calculation ===");
  console.log(`Net cash impact of all trades: $${desigCashImpact.toFixed(2)}`);
  console.log("(Need current Desig Bene cash from TOS to complete)");
  console.log();

  // Combined: if we know both current cash values
  console.log("=== What anchor should be ===");
  const rolloverStartCash = 174715.94 - cashImpact;
  console.log(`Rollover IRA starting cash (back-calculated): $${rolloverStartCash.toFixed(2)}`);
  console.log(`This is what the Feb 17 cash event should be (instead of $469,356)`);

  process.exit(0);
}
main();
