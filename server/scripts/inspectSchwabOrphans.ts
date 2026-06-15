import "dotenv/config";
import { eq, and, or, isNull } from "drizzle-orm";
import { getDb, initializeDatabase } from "../db";
import { sentinelImportedTrades } from "@shared/schema";

async function main() {
  await initializeDatabase();
  const db = getDb();
  if (!db) {
    console.error("Database unavailable");
    process.exit(1);
  }

  const orphans = await db.select().from(sentinelImportedTrades).where(
    and(
      eq(sentinelImportedTrades.brokerId, "SCHWAB"),
      eq(sentinelImportedTrades.isOrphanSell, true),
      or(eq(sentinelImportedTrades.orphanStatus, "pending"), isNull(sentinelImportedTrades.orphanStatus))
    )
  );

  console.log(`Pending Schwab orphan sells: ${orphans.length}`);

  const byAccount = new Map<string, number>();
  for (const o of orphans) {
    const acct = o.accountName ?? "unknown";
    byAccount.set(acct, (byAccount.get(acct) ?? 0) + 1);
  }
  console.log("By account:", Object.fromEntries(byAccount));

  for (const o of orphans.slice(0, 15)) {
    const matchingBuys = await db
      .select({
        tradeDate: sentinelImportedTrades.tradeDate,
        quantity: sentinelImportedTrades.quantity,
        price: sentinelImportedTrades.price,
        accountName: sentinelImportedTrades.accountName,
      })
      .from(sentinelImportedTrades)
      .where(
        and(
          eq(sentinelImportedTrades.brokerId, "SCHWAB"),
          eq(sentinelImportedTrades.ticker, o.ticker),
          eq(sentinelImportedTrades.direction, "BUY"),
          o.accountName
            ? eq(sentinelImportedTrades.accountName, o.accountName)
            : isNull(sentinelImportedTrades.accountName)
        )
      );

    console.log({
      ticker: o.ticker,
      account: o.accountName,
      sellDate: o.tradeDate,
      qty: o.quantity,
      price: o.price,
      raw: o.rawSource,
      buyCount: matchingBuys.length,
      buys: matchingBuys.slice(0, 3),
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
