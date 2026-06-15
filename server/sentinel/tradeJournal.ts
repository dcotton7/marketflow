import { and, eq, ne, asc } from "drizzle-orm";
import { cashBalanceFromActivityRawRow } from "@shared/fidelity-csv";
import { sentinelAccountSettings, sentinelImportedTrades, sentinelTrades } from "@shared/schema";
import { brokerCalendarDayKey, countMarketDaysHeld } from "@shared/trade-calendar-date";
import {
  buildChainDailyCashForAllBrokers,
  buildSyntheticDailyCashByBroker,
  mergeDailyCashMaps,
  sumDailyCashMaps,
} from "@shared/trade-journal-cash-ledger";
import {
  buildAccountBrokerMap,
  buildCurrentInvestedPctSnapshot,
  buildDailyCashByBroker,
  buildDailyInvestedPct,
  buildDailyPositionValue,
  buildInvestedPctSnapshot,
  inferBrokerFromAccountName,
  type InvestedPctSnapshot,
  type JournalBrokerFilter,
} from "@shared/trade-journal-invested";
import { loadJournalCashSetup, type JournalCashSetup } from "./journalCashLedger";
import { getTickerSnapshot } from "../market-condition/engine/snapshot";
import { buildMarketConditionLabelsForDates } from "./journalMarketCondition";
import type { db as dbInstance } from "../db";

export type { JournalBrokerFilter, InvestedPctSnapshot };

type Db = NonNullable<typeof dbInstance>;

export interface TradeJournalDayRevenue {
  total: number;
  tradeCount: number;
}

export interface TradeJournalClosedTradeRow {
  id: number;
  ticker: string;
  broker: "FIDELITY" | "SCHWAB" | null;
  accountName: string | null;
  /** Total shares in the position (# Shares). */
  positionSize: number;
  /** Total position cost / market value at entry (POS $). */
  positionDollars: number;
  sharesSold: number;
  sharesRemaining: number;
  profitDollars: number | null;
  profitPercent: number | null;
  datePurchased: string | null;
  holdMarketDays: number | null;
  marketConditionOnExit: string | null;
}

export interface TradeJournalPayload {
  dailyRevenue: Record<string, TradeJournalDayRevenue>;
  dailyRevenueByBroker: Record<JournalBrokerFilter, Record<string, TradeJournalDayRevenue>>;
  dailyCash: Record<string, number>;
  dailyCashByBroker: Record<JournalBrokerFilter, Record<string, number>>;
  dailyInvestedPct: Record<JournalBrokerFilter, Record<string, number>>;
  dailyPositionValueByBroker: Record<JournalBrokerFilter, Record<string, number>>;
  investedPctSnapshot: Record<JournalBrokerFilter, InvestedPctSnapshot>;
  closedTradesByDay: Record<string, TradeJournalClosedTradeRow[]>;
  latestCash: number | null;
  latestCashDate: string | null;
  positionsValue: number;
  positionsValueByBroker: Record<JournalBrokerFilter, number>;
  positionsCostBasis: number;
  positionsCostBasisByBroker: Record<JournalBrokerFilter, number>;
  unrealizedPnL: number;
  unrealizedPnLByBroker: Record<JournalBrokerFilter, number>;
  activePositionCount: number;
  activePositionCountByBroker: Record<JournalBrokerFilter, number>;
  closedTradesByDayByBroker: Record<JournalBrokerFilter, Record<string, TradeJournalClosedTradeRow[]>>;
  brokerAccountsByBroker: Record<"FIDELITY" | "SCHWAB", string[]>;
  capitalFlowsByBroker: Record<JournalBrokerFilter, import("@shared/trade-journal-cash-ledger").CapitalFlowEvent[]>;
  skippedNoExit: number;
  skippedNoPnl: number;
  cashLedger: JournalCashSetup;
  manualCashBrokers: Array<"FIDELITY" | "SCHWAB">;
}

type LotEntry = {
  id: string;
  dateTime: string;
  qty: string;
  buySell: "buy" | "sell";
  price: string;
};

function parseLotQty(qty: string): number {
  const n = parseFloat(String(qty).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function parseLotPrice(price: string): number {
  const n = parseFloat(String(price).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function closedTradeRevenue(trade: {
  direction: string;
  entryPrice: number;
  exitPrice: number | null;
  positionSize: number | null;
  actualPnL: number | null;
}): number | null {
  if (trade.actualPnL != null && !Number.isNaN(trade.actualPnL)) {
    return trade.actualPnL;
  }
  if (
    trade.exitPrice != null &&
    trade.positionSize != null &&
    !Number.isNaN(trade.exitPrice) &&
    !Number.isNaN(trade.positionSize)
  ) {
    const mult = trade.direction === "short" ? -1 : 1;
    return (trade.exitPrice - trade.entryPrice) * trade.positionSize * mult;
  }
  return null;
}

function closedTradeRow(
  trade: {
    id: number;
    symbol: string;
    status: string;
    direction: string;
    entryPrice: number;
    entryDate: Date | null;
    exitPrice: number | null;
    exitDate: Date | null;
    positionSize: number | null;
    actualPnL: number | null;
    lotEntries: LotEntry[] | null;
    accountName: string | null;
  },
  exitDayKey: string,
  marketConditionByDate: Record<string, string>,
  broker: "FIDELITY" | "SCHWAB" | null
): TradeJournalClosedTradeRow | null {
  const lots = trade.lotEntries ?? [];
  const buys = lots.filter((l) => l.buySell === "buy");
  const positionSize =
    trade.positionSize != null && trade.positionSize > 0
      ? trade.positionSize
      : buys.reduce((sum, l) => sum + parseLotQty(l.qty), 0);

  const totalSharesSold = lots
    .filter((l) => l.buySell === "sell")
    .reduce((sum, l) => sum + parseLotQty(l.qty), 0);
  let sharesSold = totalSharesSold;
  if (sharesSold <= 0 && trade.exitPrice != null && positionSize > 0) {
    sharesSold = positionSize;
  }

  const firstBuy = [...buys].sort((a, b) => a.dateTime.localeCompare(b.dateTime))[0];
  const datePurchased =
    brokerCalendarDayKey(trade.entryDate) ??
    (firstBuy ? brokerCalendarDayKey(firstBuy.dateTime) : null);

  const holdMarketDays =
    datePurchased && exitDayKey ? countMarketDaysHeld(datePurchased, exitDayKey) : null;

  const buyCost = buys.reduce(
    (sum, l) => sum + parseLotQty(l.qty) * parseLotPrice(l.price),
    0
  );
  const positionDollars =
    buyCost > 0 ? buyCost : positionSize > 0 ? positionSize * trade.entryPrice : 0;

  const profitDollars = closedTradeRevenue(trade);
  const costBasisSold =
    sharesSold > 0 && positionSize > 0
      ? (sharesSold / positionSize) * positionDollars
      : sharesSold > 0
        ? sharesSold * trade.entryPrice
        : 0;
  const profitPercent =
    profitDollars != null && costBasisSold > 0 ? (profitDollars / costBasisSold) * 100 : null;

  return {
    id: trade.id,
    ticker: trade.symbol,
    broker,
    accountName: trade.accountName,
    positionSize,
    positionDollars,
    sharesSold,
    sharesRemaining: 0,
    profitDollars,
    profitPercent,
    datePurchased,
    holdMarketDays,
    marketConditionOnExit: marketConditionByDate[exitDayKey] ?? null,
  };
}

function cashFromImportRow(row: {
  rawSource: string | null;
  cashBalance?: number | null;
}): number | null {
  if (row.cashBalance != null && !Number.isNaN(row.cashBalance)) {
    return row.cashBalance;
  }
  return cashBalanceFromActivityRawRow(row.rawSource);
}

function sumOpenPositionRow(
  trade: {
    symbol: string;
    direction: string;
    entryPrice: number;
    positionSize: number | null;
    markPrice?: number | null;
  },
  totals: { positionsValue: number; positionsCostBasis: number; unrealizedPnL: number }
) {
  const size = trade.positionSize ?? 0;
  if (size <= 0) return;
  const snap = getTickerSnapshot(trade.symbol.toUpperCase());
  const price = snap?.price ?? trade.markPrice ?? trade.entryPrice;
  const marketValue = price * size;
  const costBasis = trade.entryPrice * size;
  const isShort = trade.direction === "short";
  totals.positionsValue += isShort ? -marketValue : marketValue;
  totals.positionsCostBasis += isShort ? -costBasis : costBasis;
  totals.unrealizedPnL += isShort ? costBasis - marketValue : marketValue - costBasis;
}

async function computeOpenPositionsSummary(
  db: Db,
  userId: number
): Promise<{
  positionsValue: number;
  positionsCostBasis: number;
  unrealizedPnL: number;
  activePositionCount: number;
  valueByBroker: Record<"FIDELITY" | "SCHWAB", number>;
  costBasisByBroker: Record<"FIDELITY" | "SCHWAB", number>;
  unrealizedByBroker: Record<"FIDELITY" | "SCHWAB", number>;
  activeCountByBroker: Record<"FIDELITY" | "SCHWAB", number>;
}> {
  const activeTrades = await db
    .select({
      symbol: sentinelTrades.symbol,
      direction: sentinelTrades.direction,
      entryPrice: sentinelTrades.entryPrice,
      positionSize: sentinelTrades.positionSize,
      accountName: sentinelTrades.accountName,
      markPrice: sentinelTrades.markPrice,
    })
    .from(sentinelTrades)
    .where(and(eq(sentinelTrades.userId, userId), eq(sentinelTrades.status, "active")));

  const valueByBroker: Record<"FIDELITY" | "SCHWAB", number> = { FIDELITY: 0, SCHWAB: 0 };
  const costBasisByBroker: Record<"FIDELITY" | "SCHWAB", number> = { FIDELITY: 0, SCHWAB: 0 };
  const unrealizedByBroker: Record<"FIDELITY" | "SCHWAB", number> = { FIDELITY: 0, SCHWAB: 0 };
  const activeCountByBroker: Record<"FIDELITY" | "SCHWAB", number> = { FIDELITY: 0, SCHWAB: 0 };

  if (activeTrades.length === 0) {
    return {
      positionsValue: 0,
      positionsCostBasis: 0,
      unrealizedPnL: 0,
      activePositionCount: 0,
      valueByBroker,
      costBasisByBroker,
      unrealizedByBroker,
      activeCountByBroker,
    };
  }

  const importAccounts = await db
    .select({
      accountName: sentinelImportedTrades.accountName,
      brokerId: sentinelImportedTrades.brokerId,
    })
    .from(sentinelImportedTrades)
    .where(eq(sentinelImportedTrades.userId, userId));

  const settings = await db
    .select({
      accountName: sentinelAccountSettings.accountName,
      brokerId: sentinelAccountSettings.brokerId,
    })
    .from(sentinelAccountSettings)
    .where(eq(sentinelAccountSettings.userId, userId));

  const accountBrokerMap = buildAccountBrokerMap([...importAccounts, ...settings]);

  const totals = { positionsValue: 0, positionsCostBasis: 0, unrealizedPnL: 0 };
  for (const trade of activeTrades) {
    sumOpenPositionRow(trade, totals);
    const broker = inferBrokerFromAccountName(trade.accountName, accountBrokerMap);
    if (broker) {
      const bucket = { positionsValue: 0, positionsCostBasis: 0, unrealizedPnL: 0 };
      sumOpenPositionRow(trade, bucket);
      valueByBroker[broker] += bucket.positionsValue;
      costBasisByBroker[broker] += bucket.positionsCostBasis;
      unrealizedByBroker[broker] += bucket.unrealizedPnL;
      activeCountByBroker[broker] += 1;
    }
  }

  return {
    ...totals,
    activePositionCount: activeTrades.length,
    valueByBroker,
    costBasisByBroker,
    unrealizedByBroker,
    activeCountByBroker,
  };
}

function collectBrokerAccounts(
  accountBrokerMap: Map<string, "FIDELITY" | "SCHWAB">,
  accountNames: Array<string | null | undefined>
): Record<"FIDELITY" | "SCHWAB", string[]> {
  const sets: Record<"FIDELITY" | "SCHWAB", Set<string>> = {
    FIDELITY: new Set(),
    SCHWAB: new Set(),
  };
  for (const raw of accountNames) {
    const broker = inferBrokerFromAccountName(raw, accountBrokerMap);
    const acct = raw?.trim();
    if (broker && acct) sets[broker].add(acct);
  }
  return {
    FIDELITY: [...sets.FIDELITY].sort(),
    SCHWAB: [...sets.SCHWAB].sort(),
  };
}

function addRevenue(
  target: Record<string, TradeJournalDayRevenue>,
  dayKey: string,
  revenue: number
): void {
  const existing = target[dayKey] ?? { total: 0, tradeCount: 0 };
  target[dayKey] = {
    total: existing.total + revenue,
    tradeCount: existing.tradeCount + 1,
  };
}

export async function buildTradeJournalPayload(db: Db, userId: number): Promise<TradeJournalPayload> {
  const [closedTrades, importRows, importTradeLots, positions, journalCashSetup, accountSettings] =
    await Promise.all([
    db
      .select({
        id: sentinelTrades.id,
        symbol: sentinelTrades.symbol,
        status: sentinelTrades.status,
        entryDate: sentinelTrades.entryDate,
        exitDate: sentinelTrades.exitDate,
        direction: sentinelTrades.direction,
        entryPrice: sentinelTrades.entryPrice,
        exitPrice: sentinelTrades.exitPrice,
        positionSize: sentinelTrades.positionSize,
        actualPnL: sentinelTrades.actualPnL,
        lotEntries: sentinelTrades.lotEntries,
        accountName: sentinelTrades.accountName,
      })
      .from(sentinelTrades)
      .where(eq(sentinelTrades.userId, userId)),
    db
      .select({
        id: sentinelImportedTrades.id,
        brokerId: sentinelImportedTrades.brokerId,
        tradeDate: sentinelImportedTrades.tradeDate,
        accountName: sentinelImportedTrades.accountName,
        rawSource: sentinelImportedTrades.rawSource,
        cashBalance: sentinelImportedTrades.cashBalance,
      })
      .from(sentinelImportedTrades)
      .where(eq(sentinelImportedTrades.userId, userId))
      .orderBy(asc(sentinelImportedTrades.id)),
    db
      .select({
        brokerId: sentinelImportedTrades.brokerId,
        tradeDate: sentinelImportedTrades.tradeDate,
        direction: sentinelImportedTrades.direction,
        ticker: sentinelImportedTrades.ticker,
        quantity: sentinelImportedTrades.quantity,
        price: sentinelImportedTrades.price,
        netAmount: sentinelImportedTrades.netAmount,
      })
      .from(sentinelImportedTrades)
      .where(and(
        eq(sentinelImportedTrades.userId, userId),
        ne(sentinelImportedTrades.ticker, "__TOS_CASH__")
      ))
      .orderBy(asc(sentinelImportedTrades.tradeDate)),
    computeOpenPositionsSummary(db, userId),
    loadJournalCashSetup(db, userId),
    db
      .select({
        accountName: sentinelAccountSettings.accountName,
        brokerId: sentinelAccountSettings.brokerId,
      })
      .from(sentinelAccountSettings)
      .where(eq(sentinelAccountSettings.userId, userId)),
  ]);

  const accountBrokerMap = buildAccountBrokerMap([
    ...importRows.map((r) => ({ accountName: r.accountName, brokerId: r.brokerId })),
    ...accountSettings,
  ]);

  const dailyRevenue: Record<string, TradeJournalDayRevenue> = {};
  const dailyRevenueByBroker: Record<JournalBrokerFilter, Record<string, TradeJournalDayRevenue>> = {
    ALL: {},
    FIDELITY: {},
    SCHWAB: {},
  };
  let skippedNoExit = 0;
  let skippedNoPnl = 0;

  for (const trade of closedTrades) {
    if (trade.status !== "closed") continue;
    const dayKey = brokerCalendarDayKey(trade.exitDate);
    if (!dayKey) {
      skippedNoExit += 1;
      continue;
    }
    const revenue = closedTradeRevenue(trade);
    if (revenue == null) {
      skippedNoPnl += 1;
      continue;
    }
    addRevenue(dailyRevenue, dayKey, revenue);
    addRevenue(dailyRevenueByBroker.ALL, dayKey, revenue);

    const broker = inferBrokerFromAccountName(trade.accountName, accountBrokerMap);
    if (broker) addRevenue(dailyRevenueByBroker[broker], dayKey, revenue);
  }

  const importedCashByBroker = buildDailyCashByBroker(importRows, cashFromImportRow);
  const cashLedger = journalCashSetup;

  const capitalFlowsByBroker: Record<JournalBrokerFilter, import("@shared/trade-journal-cash-ledger").CapitalFlowEvent[]> = {
    ALL: [...cashLedger.capitalFlows],
    FIDELITY: cashLedger.capitalFlows.filter((f) => f.brokerId === "FIDELITY"),
    SCHWAB: cashLedger.capitalFlows.filter((f) => f.brokerId === "SCHWAB"),
  };
  const tradeCashLots = importTradeLots.map((t) => ({
    brokerId: t.brokerId,
    tradeDate: t.tradeDate,
    direction: t.direction,
    netAmount: t.netAmount ?? 0,
  }));
  const chainCashByBroker = buildChainDailyCashForAllBrokers(
    importRows,
    tradeCashLots,
    cashFromImportRow,
    cashLedger.anchors
  );
  const syntheticCashByBroker = buildSyntheticDailyCashByBroker(
    tradeCashLots,
    cashLedger.anchors,
    cashLedger.events
  );

  const manualCashBrokers: Array<"FIDELITY" | "SCHWAB"> = [];
  const dailyCashByBroker: Record<JournalBrokerFilter, Record<string, number>> = {
    ALL: {},
    FIDELITY: {},
    SCHWAB: {},
  };
  for (const broker of ["FIDELITY", "SCHWAB"] as const) {
    dailyCashByBroker[broker] = mergeDailyCashMaps(
      mergeDailyCashMaps(importedCashByBroker[broker], chainCashByBroker[broker]),
      syntheticCashByBroker[broker]
    );
    const hasChain = Object.keys(chainCashByBroker[broker]).length > 0;
    const hasImport = Object.keys(importedCashByBroker[broker]).length > 0;
    const hasLedger = Object.keys(syntheticCashByBroker[broker]).length > 0;
    if (hasLedger && !hasImport && !hasChain) manualCashBrokers.push(broker);
  }
  dailyCashByBroker.ALL = sumDailyCashMaps(
    dailyCashByBroker.FIDELITY,
    dailyCashByBroker.SCHWAB
  );

  const dailyCash = dailyCashByBroker.ALL;
  const dailyInvestedPct = buildDailyInvestedPct(importTradeLots, dailyCashByBroker);
  const dailyPositionValueByBroker: Record<JournalBrokerFilter, Record<string, number>> = {
    ALL: buildDailyPositionValue(importTradeLots, "ALL"),
    FIDELITY: buildDailyPositionValue(importTradeLots, "FIDELITY"),
    SCHWAB: buildDailyPositionValue(importTradeLots, "SCHWAB"),
  };
  const investedPctSnapshot: Record<JournalBrokerFilter, InvestedPctSnapshot> = {
    ALL: buildCurrentInvestedPctSnapshot(
      positions.positionsValue,
      dailyCashByBroker.ALL,
      dailyInvestedPct.ALL
    ),
    FIDELITY: buildCurrentInvestedPctSnapshot(
      positions.valueByBroker.FIDELITY,
      dailyCashByBroker.FIDELITY,
      dailyInvestedPct.FIDELITY
    ),
    SCHWAB: buildCurrentInvestedPctSnapshot(
      positions.valueByBroker.SCHWAB,
      dailyCashByBroker.SCHWAB,
      dailyInvestedPct.SCHWAB
    ),
  };
  const cashDates = Object.keys(dailyCash).sort();
  const latestCashDate = cashDates.length > 0 ? cashDates[cashDates.length - 1]! : null;
  const latestCash = latestCashDate != null ? dailyCash[latestCashDate]! : null;

  const exitDatesForCondition = Object.keys(dailyRevenue);
  const marketConditionByDate = await buildMarketConditionLabelsForDates(exitDatesForCondition);

  const closedTradesByDay: Record<string, TradeJournalClosedTradeRow[]> = {};
  const closedTradesByDayByBroker: Record<
    JournalBrokerFilter,
    Record<string, TradeJournalClosedTradeRow[]>
  > = { ALL: {}, FIDELITY: {}, SCHWAB: {} };

  for (const trade of closedTrades) {
    if (trade.status !== "closed") continue;
    const exitDayKey = brokerCalendarDayKey(trade.exitDate);
    if (!exitDayKey) continue;
    const broker = inferBrokerFromAccountName(trade.accountName, accountBrokerMap);
    const row = closedTradeRow(trade, exitDayKey, marketConditionByDate, broker);
    if (!row) continue;
    const bucket = closedTradesByDay[exitDayKey] ?? [];
    bucket.push(row);
    closedTradesByDay[exitDayKey] = bucket;

    if (broker) {
      const brokerBucket = closedTradesByDayByBroker[broker][exitDayKey] ?? [];
      brokerBucket.push(row);
      closedTradesByDayByBroker[broker][exitDayKey] = brokerBucket;
    }
  }
  for (const dayKey of Object.keys(closedTradesByDay)) {
    closedTradesByDay[dayKey]!.sort((a, b) => a.ticker.localeCompare(b.ticker));
  }
  for (const broker of ["FIDELITY", "SCHWAB"] as const) {
    for (const dayKey of Object.keys(closedTradesByDayByBroker[broker])) {
      closedTradesByDayByBroker[broker][dayKey]!.sort((a, b) =>
        a.ticker.localeCompare(b.ticker)
      );
    }
  }
  closedTradesByDayByBroker.ALL = closedTradesByDay;

  const brokerAccountsByBroker = collectBrokerAccounts(accountBrokerMap, [
    ...closedTrades.map((t) => t.accountName),
    ...importRows.map((r) => r.accountName),
  ]);

  const positionsValueByBroker: Record<JournalBrokerFilter, number> = {
    ALL: positions.positionsValue,
    FIDELITY: positions.valueByBroker.FIDELITY,
    SCHWAB: positions.valueByBroker.SCHWAB,
  };
  const positionsCostBasisByBroker: Record<JournalBrokerFilter, number> = {
    ALL: positions.positionsCostBasis,
    FIDELITY: positions.costBasisByBroker.FIDELITY,
    SCHWAB: positions.costBasisByBroker.SCHWAB,
  };
  const unrealizedPnLByBroker: Record<JournalBrokerFilter, number> = {
    ALL: positions.unrealizedPnL,
    FIDELITY: positions.unrealizedByBroker.FIDELITY,
    SCHWAB: positions.unrealizedByBroker.SCHWAB,
  };
  const activePositionCountByBroker: Record<JournalBrokerFilter, number> = {
    ALL: positions.activePositionCount,
    FIDELITY: positions.activeCountByBroker.FIDELITY,
    SCHWAB: positions.activeCountByBroker.SCHWAB,
  };

  return {
    dailyRevenue,
    dailyRevenueByBroker,
    dailyCash,
    dailyCashByBroker,
    dailyInvestedPct,
    dailyPositionValueByBroker,
    investedPctSnapshot,
    closedTradesByDay,
    closedTradesByDayByBroker,
    latestCash,
    latestCashDate,
    positionsValue: positions.positionsValue,
    positionsValueByBroker,
    positionsCostBasis: positions.positionsCostBasis,
    positionsCostBasisByBroker,
    unrealizedPnL: positions.unrealizedPnL,
    unrealizedPnLByBroker,
    activePositionCount: positions.activePositionCount,
    activePositionCountByBroker,
    brokerAccountsByBroker,
    capitalFlowsByBroker,
    skippedNoExit,
    skippedNoPnl,
    cashLedger,
    manualCashBrokers,
  };
}
