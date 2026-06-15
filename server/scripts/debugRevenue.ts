import "dotenv/config";
import { eq } from "drizzle-orm";
import { sentinelTrades } from "@shared/schema";
import { brokerCalendarDayKey } from "@shared/trade-calendar-date";
import { getDb, initializeDatabase } from "../db";

async function main() {
  await initializeDatabase();
  const db = getDb();

  const trades = await db
    .select({
      id: sentinelTrades.id,
      symbol: sentinelTrades.symbol,
      status: sentinelTrades.status,
      exitDate: sentinelTrades.exitDate,
      actualPnL: sentinelTrades.actualPnL,
      entryPrice: sentinelTrades.entryPrice,
      exitPrice: sentinelTrades.exitPrice,
      positionSize: sentinelTrades.positionSize,
      direction: sentinelTrades.direction,
      accountName: sentinelTrades.accountName,
    })
    .from(sentinelTrades)
    .where(eq(sentinelTrades.userId, 2));

  const closed = trades.filter((t) => t.status === "closed");
  console.log(`Total trades: ${trades.length}, closed: ${closed.length}`);

  let noExitDate = 0;
  let noPnl = 0;
  let counted = 0;
  let totalRev = 0;

  for (const t of closed) {
    const dayKey = brokerCalendarDayKey(t.exitDate);
    if (!dayKey) { noExitDate++; continue; }

    const pnl = t.actualPnL;
    if (pnl == null || Number.isNaN(pnl)) { noPnl++; continue; }

    counted++;
    totalRev += pnl;
  }

  console.log(`noExitDate: ${noExitDate}, noPnl: ${noPnl}, counted: ${counted}`);
  console.log(`Total revenue: $${totalRev.toFixed(2)}`);

  // Check first 3 closed trades
  for (const t of closed.slice(0, 3)) {
    console.log(`\nTrade ${t.id} ${t.symbol}:`);
    console.log(`  exitDate: ${t.exitDate} (type: ${typeof t.exitDate})`);
    console.log(`  brokerCalendarDayKey: ${brokerCalendarDayKey(t.exitDate)}`);
    console.log(`  actualPnL: ${t.actualPnL} (type: ${typeof t.actualPnL})`);
    console.log(`  exitPrice: ${t.exitPrice} (type: ${typeof t.exitPrice})`);
    console.log(`  positionSize: ${t.positionSize} (type: ${typeof t.positionSize})`);
  }

  process.exit(0);
}
main();
