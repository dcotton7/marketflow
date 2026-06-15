import "dotenv/config";
import { eq, and } from "drizzle-orm";
import { getDb, initializeDatabase } from "../db";
import { sentinelImportedTrades } from "@shared/schema";

async function main() {
  await initializeDatabase();
  const db = getDb();
  if (!db) throw new Error("no db");

  const ticker = process.argv[2] || "AAOI";
  const account = process.argv[3] || "Schwab Rollover IRA";

  const rows = await db
    .select()
    .from(sentinelImportedTrades)
    .where(
      and(
        eq(sentinelImportedTrades.brokerId, "SCHWAB"),
        eq(sentinelImportedTrades.ticker, ticker),
        eq(sentinelImportedTrades.accountName, account)
      )
    );

  type T = { id: string; direction: string; quantity: number; tradeDate: Date };
  const all: T[] = rows.map((r) => ({
    id: String(r.id),
    direction: r.direction,
    quantity: r.quantity,
    tradeDate: new Date(r.tradeDate),
  }));

  all.sort((a, b) => {
    const dateDiff = a.tradeDate.getTime() - b.tradeDate.getTime();
    if (dateDiff !== 0) return dateDiff;
    if (a.direction === "BUY" && b.direction === "SELL") return -1;
    if (a.direction === "SELL" && b.direction === "BUY") return 1;
    return a.id.localeCompare(b.id);
  });

  let running = 0;
  let buyTotal = 0;
  let sellTotal = 0;
  const orphans: string[] = [];
  for (const t of all) {
    if (t.direction === "BUY") {
      running += t.quantity;
      buyTotal += t.quantity;
    } else {
      if (running < t.quantity - 0.0001) orphans.push(`${t.id} sell ${t.quantity} on ${t.tradeDate.toISOString().slice(0, 10)} pos=${running}`);
      running = Math.max(0, running - t.quantity);
      sellTotal += t.quantity;
    }
  }

  console.log({ ticker, account, buys: buyTotal, sells: sellTotal, orphanCount: orphans.length });
  console.log(orphans.slice(0, 10));
}

main().catch(console.error);
