import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb, initializeDatabase } from "../db";

async function main() {
  await initializeDatabase();
  const db = getDb();

  const positions = await db.execute(sql`
    SELECT symbol, entry_price, position_size, entry_date::text, exit_date::text, status,
           lot_entries
    FROM sentinel_trades
    WHERE user_id = 2
      AND (account_name ilike '%bene%' OR account_name ilike '%designated%')
      AND entry_date <= '2026-01-01'
      AND (exit_date IS NULL OR exit_date > '2026-01-01')
    ORDER BY entry_date
  `);

  const symbols = positions.rows.map(r => String(r.symbol));
  console.log("Positions open on Jan 1, 2026:", symbols);

  // Fetch closing prices for Dec 31 / Jan 2 from Alpaca
  for (const r of positions.rows) {
    const sym = String(r.symbol);
    const qty = Number(r.position_size) || 0;
    const costBasis = qty * (Number(r.entry_price) || 0);

    // Check lot_entries for partial sells before Jan 1
    const lots = (r.lot_entries as any[]) || [];
    let totalBought = 0;
    let totalSold = 0;
    for (const lot of lots) {
      const lotDate = String(lot.dateTime || "").slice(0, 10);
      const lotQty = parseFloat(String(lot.qty || "0").replace(/,/g, ""));
      const side = String(lot.buySell || "").toUpperCase();
      if (lotDate <= "2026-01-01") {
        if (side === "BUY") totalBought += lotQty;
        else if (side === "SELL") totalSold += lotQty;
      }
    }
    const heldQty = lots.length > 0 ? (totalBought - totalSold) : qty;

    console.log(`\n${sym}:`);
    console.log(`  Card: qty=${qty}, entry=$${Number(r.entry_price).toFixed(2)}, cost=$${costBasis.toFixed(2)}`);
    console.log(`  Lots before Jan 1: bought=${totalBought}, sold=${totalSold}, held=${heldQty}`);
    console.log(`  Entry: ${String(r.entry_date).slice(0,10)}, Exit: ${String(r.exit_date).slice(0,10)}, Status: ${r.status}`);
  }

  // Try fetching Jan 2 2026 prices via Alpaca
  const ALPACA_KEY = process.env.ALPACA_API_KEY;
  const ALPACA_SECRET = process.env.ALPACA_API_SECRET;
  if (ALPACA_KEY && ALPACA_SECRET) {
    console.log("\n=== Fetching market prices near Jan 1, 2026 ===");
    for (const r of positions.rows) {
      const sym = String(r.symbol);
      const lots = (r.lot_entries as any[]) || [];
      let totalBought = 0, totalSold = 0;
      for (const lot of lots) {
        const lotDate = String(lot.dateTime || "").slice(0, 10);
        const lotQty = parseFloat(String(lot.qty || "0").replace(/,/g, ""));
        const side = String(lot.buySell || "").toUpperCase();
        if (lotDate <= "2026-01-01") {
          if (side === "BUY") totalBought += lotQty;
          else if (side === "SELL") totalSold += lotQty;
        }
      }
      const heldQty = lots.length > 0 ? (totalBought - totalSold) : Number(r.position_size);
      if (heldQty <= 0) { console.log(`${sym}: no shares held on Jan 1`); continue; }

      try {
        const url = `https://data.alpaca.markets/v2/stocks/${sym}/bars?timeframe=1Day&start=2025-12-30&end=2026-01-03&limit=5`;
        const res = await fetch(url, {
          headers: {
            "APCA-API-KEY-ID": ALPACA_KEY,
            "APCA-API-SECRET-KEY": ALPACA_SECRET,
          },
        });
        const data = await res.json() as { bars?: { t: string; c: number }[] };
        const bars = data.bars || [];
        const lastBar = bars[bars.length - 1];
        if (lastBar) {
          const marketVal = heldQty * lastBar.c;
          console.log(`${sym}: ${heldQty} shares × $${lastBar.c.toFixed(2)} (${lastBar.t.slice(0,10)}) = $${marketVal.toFixed(2)}`);
        } else {
          console.log(`${sym}: no bars found`);
        }
      } catch (e) {
        console.log(`${sym}: fetch error`, e);
      }
    }
  } else {
    console.log("\nNo Alpaca keys found — cannot fetch market prices.");
  }

  process.exit(0);
}
main();
