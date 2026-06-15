import { and, eq, inArray } from "drizzle-orm";
import {
  importTradeFingerprint,
  importTradeFingerprintAliases,
  type ImportTradeFingerprintFields,
} from "@shared/import-trade-fingerprint";
import { sentinelImportedTrades } from "@shared/schema";
import type { db as dbInstance } from "../db";

type Db = NonNullable<typeof dbInstance>;

export type { ImportTradeFingerprintFields };
export { importTradeFingerprint, importTradeFingerprintAliases };

export function filterNewImportTrades<T extends ImportTradeFingerprintFields>(
  incoming: T[],
  existingFingerprints: Set<string>
): { newTrades: T[]; skippedAlreadyImported: number } {
  const seen = new Set(existingFingerprints);
  const newTrades: T[] = [];
  let skippedAlreadyImported = 0;

  for (const trade of incoming) {
    const aliases = importTradeFingerprintAliases(trade);
    if (aliases.some((fp) => seen.has(fp))) {
      skippedAlreadyImported += 1;
      continue;
    }
    for (const fp of aliases) seen.add(fp);
    newTrades.push(trade);
  }

  return { newTrades, skippedAlreadyImported };
}

export async function loadExistingImportFingerprints(
  db: Db,
  userId: number,
  tickers: string[]
): Promise<Set<string>> {
  if (tickers.length === 0) return new Set();

  const rows = await db
    .select({
      brokerId: sentinelImportedTrades.brokerId,
      ticker: sentinelImportedTrades.ticker,
      tradeDate: sentinelImportedTrades.tradeDate,
      direction: sentinelImportedTrades.direction,
      quantity: sentinelImportedTrades.quantity,
      price: sentinelImportedTrades.price,
      totalAmount: sentinelImportedTrades.totalAmount,
      netAmount: sentinelImportedTrades.netAmount,
      accountName: sentinelImportedTrades.accountName,
      rawSource: sentinelImportedTrades.rawSource,
    })
    .from(sentinelImportedTrades)
    .where(
      and(
        eq(sentinelImportedTrades.userId, userId),
        inArray(sentinelImportedTrades.ticker, tickers)
      )
    );

  const fps = new Set<string>();
  for (const row of rows) {
    for (const fp of importTradeFingerprintAliases(row)) {
      fps.add(fp);
    }
  }
  return fps;
}
