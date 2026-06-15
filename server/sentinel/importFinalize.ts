import { and, eq, inArray, not, sql } from "drizzle-orm";
import {
  schwabRglLotKey,
  schwabRglSellHasPairedBuy,
} from "@shared/import-trade-fingerprint";
import { sentinelImportBatches, sentinelImportedTrades, sentinelTrades } from "@shared/schema";
import { detectOrphanSellIds } from "./importOrphanDetect";
import type { db as dbInstance } from "../db";

type Db = NonNullable<typeof dbInstance>;

type ImportRow = typeof sentinelImportedTrades.$inferSelect;
type CardRow = {
  id: number;
  symbol: string;
  entryDate: Date | null;
  entryPrice: number;
  positionSize: number | null;
  lotEntries: unknown;
  accountName: string | null;
  status: string | null;
};

function lotSideMatches(lot: { buySell?: string }, direction: string): boolean {
  const side = String(lot.buySell || "").toLowerCase();
  return side === direction.toLowerCase();
}

function importMatchesCardLot(
  trade: Pick<ImportRow, "tradeDate" | "price" | "quantity" | "direction">,
  card: CardRow
): boolean {
  const lots = (card.lotEntries as Array<{ dateTime?: string; price?: string; qty?: string; buySell?: string }>) || [];
  for (const lot of lots) {
    if (!lotSideMatches(lot, trade.direction)) continue;
    const lotDate = lot.dateTime?.split("T")[0] || "";
    const lotPrice = parseFloat(String(lot.price).replace(/[$,]/g, "")) || 0;
    const lotQty = parseFloat(String(lot.qty).replace(/,/g, "")) || 0;
    if (
      lotDate === trade.tradeDate &&
      Math.abs(lotPrice - trade.price) < 0.02 &&
      Math.abs(lotQty - trade.quantity) < 0.0001
    ) {
      return true;
    }
  }
  if (!lots.length && card.entryDate && trade.direction === "BUY") {
    const cardDate = new Date(card.entryDate).toISOString().split("T")[0];
    if (
      cardDate === trade.tradeDate &&
      card.entryPrice &&
      Math.abs(card.entryPrice - trade.price) < 0.02
    ) {
      return true;
    }
  }
  return false;
}

export function schwabLotSiblingIds(batchTrades: ImportRow[], trade: ImportRow): string[] {
  const lotKey = schwabRglLotKey(trade.rawSource);
  if (!lotKey || trade.brokerId?.toUpperCase() !== "SCHWAB") return [];
  const pairedDir = trade.direction === "BUY" ? "SELL" : "BUY";
  return batchTrades
    .filter(
      (t) =>
        t.tradeId !== trade.tradeId &&
        t.direction === pairedDir &&
        schwabRglLotKey(t.rawSource) === lotKey
    )
    .map((t) => t.tradeId);
}

function importMatchesOtherImport(a: ImportRow, b: ImportRow): boolean {
  return (
    a.ticker.toUpperCase() === b.ticker.toUpperCase() &&
    a.tradeDate === b.tradeDate &&
    a.direction === b.direction &&
    Math.abs(a.price - b.price) < 0.02 &&
    Math.abs(a.quantity - b.quantity) < 0.0001 &&
    (a.accountName || "") === (b.accountName || "")
  );
}

export async function detectBatchDuplicates(
  db: Db,
  userId: number,
  batchId: string
): Promise<Map<string, { matchType: "card" | "import"; matchId: number }>> {
  const batchTrades = await db
    .select()
    .from(sentinelImportedTrades)
    .where(and(eq(sentinelImportedTrades.userId, userId), eq(sentinelImportedTrades.batchId, batchId)));

  const existingCards = await db
    .select({
      id: sentinelTrades.id,
      symbol: sentinelTrades.symbol,
      entryDate: sentinelTrades.entryDate,
      entryPrice: sentinelTrades.entryPrice,
      positionSize: sentinelTrades.positionSize,
      lotEntries: sentinelTrades.lotEntries,
      accountName: sentinelTrades.accountName,
      status: sentinelTrades.status,
    })
    .from(sentinelTrades)
    .where(eq(sentinelTrades.userId, userId));

  const otherImported = await db
    .select()
    .from(sentinelImportedTrades)
    .where(and(eq(sentinelImportedTrades.userId, userId), not(eq(sentinelImportedTrades.batchId, batchId))));

  const matches = new Map<string, { matchType: "card" | "import"; matchId: number }>();

  for (const trade of batchTrades) {
    for (const card of existingCards) {
      if (card.symbol.toUpperCase() !== trade.ticker.toUpperCase()) continue;
      if (importMatchesCardLot(trade, card)) {
        matches.set(trade.tradeId, { matchType: "card", matchId: card.id });
        break;
      }
    }
    if (matches.has(trade.tradeId)) continue;
    for (const other of otherImported) {
      if (importMatchesOtherImport(trade, other)) {
        matches.set(trade.tradeId, { matchType: "import", matchId: other.id });
        break;
      }
    }
  }

  // Schwab: if buy matches, paired sell in same batch matches same target
  for (const trade of batchTrades) {
    if (trade.direction !== "SELL") continue;
    for (const buy of batchTrades) {
      if (buy.direction !== "BUY") continue;
      const buyMatch = matches.get(buy.tradeId);
      if (!buyMatch) continue;
      if (schwabRglLotKey(buy.rawSource) && schwabRglLotKey(buy.rawSource) === schwabRglLotKey(trade.rawSource)) {
        matches.set(trade.tradeId, buyMatch);
      }
    }
  }

  return matches;
}

async function deleteImportTradeIds(db: Db, userId: number, tradeIds: string[]): Promise<number> {
  if (tradeIds.length === 0) return 0;
  const deleted = await db
    .delete(sentinelImportedTrades)
    .where(
      and(eq(sentinelImportedTrades.userId, userId), inArray(sentinelImportedTrades.tradeId, tradeIds))
    )
    .returning({ tradeId: sentinelImportedTrades.tradeId });
  return deleted.length;
}

export async function autoFinalizeImportBatch(
  db: Db,
  userId: number,
  batchId: string
): Promise<{
  duplicatesRemoved: number;
  orphansRemoved: number;
  orphansRemaining: number;
}> {
  let duplicatesRemoved = 0;
  let orphansRemoved = 0;

  const batchTrades = await db
    .select()
    .from(sentinelImportedTrades)
    .where(and(eq(sentinelImportedTrades.userId, userId), eq(sentinelImportedTrades.batchId, batchId)));

  if (batchTrades.length === 0) {
    return { duplicatesRemoved: 0, orphansRemoved: 0, orphansRemaining: 0 };
  }

  const duplicateMatches = await detectBatchDuplicates(db, userId, batchId);
  const toDelete = new Set<string>();

  const cashTradeIds = new Set(
    batchTrades
      .filter((t) => t.cashBalance != null)
      .map((t) => t.tradeId)
  );

  for (const [tradeId, match] of duplicateMatches) {
    const trade = batchTrades.find((t) => t.tradeId === tradeId);
    if (!trade) continue;
    if (cashTradeIds.has(tradeId)) continue;
    toDelete.add(tradeId);
    for (const sib of schwabLotSiblingIds(batchTrades, trade)) {
      if (!cashTradeIds.has(sib)) toDelete.add(sib);
    }
    if (match.matchType === "import" && trade.direction === "BUY") {
      for (const sib of schwabLotSiblingIds(batchTrades, trade)) {
        if (!cashTradeIds.has(sib)) toDelete.add(sib);
      }
    }
  }

  if (toDelete.size > 0) {
    duplicatesRemoved = await deleteImportTradeIds(db, userId, [...toDelete]);
  }

  await db
    .update(sentinelImportBatches)
    .set({ duplicatesCount: 0 })
    .where(and(eq(sentinelImportBatches.batchId, batchId), eq(sentinelImportBatches.userId, userId)));

  // Refresh batch trades after duplicate cleanup
  const remainingBatch = await db
    .select()
    .from(sentinelImportedTrades)
    .where(and(eq(sentinelImportedTrades.userId, userId), eq(sentinelImportedTrades.batchId, batchId)));

  const allUserTrades = await db
    .select()
    .from(sentinelImportedTrades)
    .where(eq(sentinelImportedTrades.userId, userId));

  const cards = await db
    .select({
      id: sentinelTrades.id,
      symbol: sentinelTrades.symbol,
      entryDate: sentinelTrades.entryDate,
      entryPrice: sentinelTrades.entryPrice,
      positionSize: sentinelTrades.positionSize,
      lotEntries: sentinelTrades.lotEntries,
      accountName: sentinelTrades.accountName,
      status: sentinelTrades.status,
    })
    .from(sentinelTrades)
    .where(eq(sentinelTrades.userId, userId));

  // Global orphan redetect
  const grouped = new Map<string, ImportRow[]>();
  for (const t of allUserTrades) {
    const key = `${t.ticker}:${t.accountName || "__default__"}`;
    const bucket = grouped.get(key) ?? [];
    bucket.push(t);
    grouped.set(key, bucket);
  }

  const trueOrphanIds = new Set<string>();
  for (const [, trades] of grouped) {
    const brokerId = trades[0]?.brokerId;
    const accountKey = `${brokerId}:${trades[0]?.accountName || ""}`;
    const orphanIds = detectOrphanSellIds(
      trades.map((t) => ({
        id: t.tradeId,
        direction: t.direction,
        quantity: t.quantity,
        tradeDate: new Date(t.tradeDate),
        brokerId: t.brokerId,
        rawSource: t.rawSource,
        accountName: t.accountName,
      })),
      false
    );
    for (const id of orphanIds) trueOrphanIds.add(id);
  }

  // Update orphan flags
  for (const t of allUserTrades) {
    const isOrphan = t.direction === "SELL" && trueOrphanIds.has(t.tradeId);
    if (isOrphan !== !!t.isOrphanSell) {
      await db
        .update(sentinelImportedTrades)
        .set({
          isOrphanSell: isOrphan,
          orphanStatus: isOrphan ? "pending" : null,
        })
        .where(eq(sentinelImportedTrades.tradeId, t.tradeId));
    }
  }

  // Index all buys by broker+account for Schwab RGL lot-pair recovery
  const accountBuysByKey = new Map<string, ImportRow[]>();
  for (const t of allUserTrades) {
    if (t.direction !== "BUY") continue;
    const key = `${(t.brokerId || "").toUpperCase()}:${(t.accountName || "").trim().toLowerCase()}`;
    const bucket = accountBuysByKey.get(key) ?? [];
    bucket.push(t);
    accountBuysByKey.set(key, bucket);
  }

  const orphanUnflags = new Set<string>();
  const orphanDeletes = new Set<string>();
  for (const trade of allUserTrades) {
    if (trade.direction !== "SELL" || !trueOrphanIds.has(trade.tradeId)) continue;

    const acctKey = `${(trade.brokerId || "").toUpperCase()}:${(trade.accountName || "").trim().toLowerCase()}`;
    const accountBuys = accountBuysByKey.get(acctKey) ?? [];
    if (schwabRglSellHasPairedBuy(trade, accountBuys)) {
      orphanUnflags.add(trade.tradeId);
      continue;
    }

    for (const card of cards) {
      if (importMatchesCardLot(trade, card)) {
        orphanDeletes.add(trade.tradeId);
        break;
      }
    }
  }

  if (orphanUnflags.size > 0) {
    for (const id of orphanUnflags) {
      await db
        .update(sentinelImportedTrades)
        .set({ isOrphanSell: false, orphanStatus: null })
        .where(eq(sentinelImportedTrades.tradeId, id));
      trueOrphanIds.delete(id);
    }
    orphansRemoved += orphanUnflags.size;
  }

  if (orphanDeletes.size > 0) {
    const deleted = await deleteImportTradeIds(db, userId, [...orphanDeletes]);
    orphansRemoved += deleted;
    for (const id of orphanDeletes) trueOrphanIds.delete(id);
  }

  // Update batch orphan counts
  const [orphanCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(sentinelImportedTrades)
    .where(
      and(
        eq(sentinelImportedTrades.userId, userId),
        eq(sentinelImportedTrades.isOrphanSell, true),
        eq(sentinelImportedTrades.orphanStatus, "pending")
      )
    );

  for (const batchId of new Set(allUserTrades.map((t) => t.batchId))) {
    const [batchOrphans] = await db
      .select({ count: sql<number>`count(*)` })
      .from(sentinelImportedTrades)
      .where(
        and(
          eq(sentinelImportedTrades.userId, userId),
          eq(sentinelImportedTrades.batchId, batchId),
          eq(sentinelImportedTrades.isOrphanSell, true),
          eq(sentinelImportedTrades.orphanStatus, "pending")
        )
      );
    await db
      .update(sentinelImportBatches)
      .set({ orphanSellsCount: Number(batchOrphans?.count || 0) })
      .where(and(eq(sentinelImportBatches.batchId, batchId), eq(sentinelImportBatches.userId, userId)));
  }

  return {
    duplicatesRemoved,
    orphansRemoved,
    orphansRemaining: Number(orphanCount?.count || 0),
  };
}
