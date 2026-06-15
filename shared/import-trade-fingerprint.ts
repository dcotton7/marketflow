/**
 * Broker-aware dedup keys for overlapping imports (Activity re-exports, Schwab RGL lots, etc.)
 */

export type ImportTradeFingerprintFields = {
  brokerId?: string | null;
  ticker: string;
  tradeDate: string;
  direction: string;
  quantity: number;
  price: number;
  totalAmount?: number | null;
  netAmount?: number | null;
  accountName?: string | null;
  rawSource?: string | null;
};

/** Lot identity embedded in Schwab RGL synthetic trade rawSource. */
export function schwabRglLotKey(rawSource: string | null | undefined): string | null {
  if (!rawSource) return null;
  const parts = rawSource.split(",").map((p) => p.trim());
  if (parts.length < 4 || !/^[A-Z0-9.^/-]+$/i.test(parts[0]!)) return null;
  // New: SYMBOL,qty,acquired,sold,cost,proceeds
  if (parts.length >= 6) {
    return parts.slice(0, 6).join(",");
  }
  // Legacy: SYMBOL,qty,acquired,sold
  return parts.slice(0, 4).join(",");
}

function activityStyleFingerprint(trade: ImportTradeFingerprintFields): string {
  const qty = Math.round(trade.quantity * 10000) / 10000;
  const price = Math.round(trade.price * 100) / 100;
  const acct = (trade.accountName || "").trim().toLowerCase();
  return `${trade.ticker.toUpperCase()}|${trade.tradeDate}|${trade.direction}|${qty}|${price}|${acct}`;
}

/** Canonical fingerprint for an incoming trade. */
export function importTradeFingerprint(trade: ImportTradeFingerprintFields): string {
  const broker = (trade.brokerId || "").toUpperCase();
  const acct = (trade.accountName || "").trim().toLowerCase();
  const lotKey = schwabRglLotKey(trade.rawSource);

  if (broker === "SCHWAB" && lotKey) {
    return `SCHWAB_RGL|${acct}|${trade.direction}|${trade.tradeDate}|${lotKey}`;
  }

  return activityStyleFingerprint(trade);
}

/** All fingerprints that should block re-import of the same economic fill. */
export function importTradeFingerprintAliases(trade: ImportTradeFingerprintFields): string[] {
  const canonical = importTradeFingerprint(trade);
  const aliases = new Set<string>([canonical]);

  const lotKey = schwabRglLotKey(trade.rawSource);
  if ((trade.brokerId || "").toUpperCase() === "SCHWAB" && lotKey) {
    // Canonical 6-part lot key only — activity-style and 4-part legacy aliases collide when
    // distinct lots share acquired/close date, qty, and rounded price.
  }

  return [...aliases];
}

/** Schwab RGL sell is covered by a synthetic buy from the same closed lot. */
export function schwabRglSellHasPairedBuy(
  sell: Pick<ImportTradeFingerprintFields, "brokerId" | "direction" | "rawSource" | "accountName">,
  buys: Array<Pick<ImportTradeFingerprintFields, "direction" | "rawSource" | "accountName">>
): boolean {
  if ((sell.brokerId || "").toUpperCase() !== "SCHWAB" || sell.direction !== "SELL") return false;
  const lotKey = schwabRglLotKey(sell.rawSource);
  if (!lotKey) return false;
  const acct = (sell.accountName || "").trim().toLowerCase();
  return buys.some((b) => {
    if (b.direction !== "BUY") return false;
    if ((b.accountName || "").trim().toLowerCase() !== acct) return false;
    const buyLot = schwabRglLotKey(b.rawSource);
    if (!buyLot) return false;
    if (buyLot === lotKey) return true;
    // Legacy buy raw (4 parts) matches sell lot prefix
    return lotKey.startsWith(buyLot);
  });
}
