import {
  schwabRglLotKey,
  schwabRglSellHasPairedBuy,
  type ImportTradeFingerprintFields,
} from "@shared/import-trade-fingerprint";

export interface OrphanDetectTrade {
  id: string;
  direction: string;
  quantity: number;
  tradeDate: Date;
  brokerId?: string | null;
  rawSource?: string | null;
  accountName?: string | null;
  isCurrentImport?: boolean;
  sourcePriority?: number;
}

const EPSILON = 0.0001;

function sortOrphanTrades(a: OrphanDetectTrade, b: OrphanDetectTrade): number {
  const dateDiff = a.tradeDate.getTime() - b.tradeDate.getTime();
  if (dateDiff !== 0) return dateDiff;
  if (a.direction === "BUY" && b.direction === "SELL") return -1;
  if (a.direction === "SELL" && b.direction === "BUY") return 1;
  const priorityDiff = (a.sourcePriority ?? 0) - (b.sourcePriority ?? 0);
  if (priorityDiff !== 0) return priorityDiff;
  return a.id.localeCompare(b.id);
}

function isSchwabRglTrade(trade: OrphanDetectTrade): boolean {
  return (
    (trade.brokerId || "").toUpperCase() === "SCHWAB" && !!schwabRglLotKey(trade.rawSource)
  );
}

/**
 * FIFO orphan detection for activity-style brokers.
 * Schwab RGL closed lots use paired-buy matching only (not FIFO).
 */
export function detectOrphanSellIds(
  trades: OrphanDetectTrade[],
  shortSalesAllowed: boolean,
  options?: { onlyFlagCurrentImport?: boolean }
): Set<string> {
  const onlyCurrent = options?.onlyFlagCurrentImport ?? false;
  const sorted = [...trades].sort(sortOrphanTrades);
  const buys = sorted.filter((t) => t.direction === "BUY");
  const orphanIds = new Set<string>();
  let runningPosition = 0;

  for (const trade of sorted) {
    const qty = Number(trade.quantity) || 0;
    if (trade.direction === "BUY") {
      runningPosition += qty;
      continue;
    }
    if (trade.direction !== "SELL") continue;

    const shouldEvaluate = !onlyCurrent || trade.isCurrentImport === true;

    if (isSchwabRglTrade(trade)) {
      const pairedBuy = schwabRglSellHasPairedBuy(
        trade as ImportTradeFingerprintFields,
        buys as ImportTradeFingerprintFields[]
      );
      if (shouldEvaluate && !pairedBuy && !shortSalesAllowed) {
        orphanIds.add(trade.id);
      }
      if (pairedBuy) {
        runningPosition += qty;
      } else {
        runningPosition = Math.max(0, runningPosition - qty);
      }
      continue;
    }

    const pairedBuy = schwabRglSellHasPairedBuy(
      trade as ImportTradeFingerprintFields,
      buys as ImportTradeFingerprintFields[]
    );

    if (pairedBuy && runningPosition < qty - EPSILON) {
      runningPosition += qty;
    }

    if (
      shouldEvaluate &&
      runningPosition < qty - EPSILON &&
      !shortSalesAllowed &&
      !pairedBuy
    ) {
      orphanIds.add(trade.id);
    }

    if (shortSalesAllowed && runningPosition < qty - EPSILON) {
      runningPosition -= qty;
    } else {
      runningPosition = Math.max(0, runningPosition - qty);
    }
  }

  return orphanIds;
}
