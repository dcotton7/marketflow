export type JournalBrokerFilter = "ALL" | "FIDELITY" | "SCHWAB";

export const JOURNAL_BROKER_FILTER_OPTIONS: Array<{ value: JournalBrokerFilter; label: string }> = [
  { value: "ALL", label: "All" },
  { value: "FIDELITY", label: "Fidelity" },
  { value: "SCHWAB", label: "Schwab" },
];

export function normalizeJournalBroker(brokerId: string): "FIDELITY" | "SCHWAB" | null {
  const upper = brokerId.toUpperCase();
  if (upper === "FIDELITY" || upper === "SCHWAB") return upper;
  return null;
}

export interface ImportedTradeLot {
  brokerId: string;
  tradeDate: string;
  direction: string;
  ticker: string;
  quantity: number;
  price: number;
}

export interface CashImportRow {
  id?: number;
  brokerId: string;
  tradeDate: string;
  accountName: string | null;
  rawSource: string | null;
  cashBalance?: number | null;
}

function nextCalendarDay(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function pctInvested(positionValue: number, cash: number | null): number | null {
  if (cash == null || cash < 0) return null;
  const total = positionValue + cash;
  if (total <= 0) return null;
  return (positionValue / total) * 100;
}

/** Map trading account names to broker from imports / settings. */
export function buildAccountBrokerMap(
  rows: Array<{ accountName: string | null; brokerId: string }>
): Map<string, "FIDELITY" | "SCHWAB"> {
  const map = new Map<string, "FIDELITY" | "SCHWAB">();
  for (const row of rows) {
    const broker = normalizeJournalBroker(row.brokerId);
    const acct = row.accountName?.trim();
    if (broker && acct) map.set(acct, broker);
  }
  return map;
}

export function inferBrokerFromAccountName(
  accountName: string | null | undefined,
  accountBrokerMap: Map<string, "FIDELITY" | "SCHWAB">
): "FIDELITY" | "SCHWAB" | null {
  const acct = accountName?.trim();
  if (!acct) return null;
  const mapped = accountBrokerMap.get(acct);
  if (mapped) return mapped;
  const lower = acct.toLowerCase();
  if (lower.includes("schwab")) return "SCHWAB";
  if (
    lower.includes("brokeragelink") ||
    lower.includes("fidelity") ||
    /^activity\s*\d/i.test(acct)
  ) {
    return "FIDELITY";
  }
  if (lower.includes("rollover") || lower.includes("designated bene") || lower.includes("bene individual")) {
    return "SCHWAB";
  }
  return null;
}

/** When a broker filter is active, never fall back to ALL-broker aggregates. */
export function pickJournalBrokerScope<T>(
  filter: JournalBrokerFilter,
  scoped: Partial<Record<JournalBrokerFilter, T>> | undefined,
  allValue: T,
  emptyValue: T
): T {
  if (filter === "ALL") return allValue;
  const v = scoped?.[filter];
  return v !== undefined && v !== null ? v : emptyValue;
}

export interface TradeJournalDayRevenue {
  total: number;
  tradeCount: number;
}

export interface TradeJournalClosedTradeBrokerRow {
  broker?: "FIDELITY" | "SCHWAB" | null;
  accountName?: string | null;
  profitDollars?: number | null;
}

export function resolveTradeRowBroker(
  row: TradeJournalClosedTradeBrokerRow
): "FIDELITY" | "SCHWAB" | null {
  if (row.broker === "FIDELITY" || row.broker === "SCHWAB") return row.broker;
  return inferBrokerFromAccountName(row.accountName, new Map());
}

export function filterClosedTradesByBroker<T extends TradeJournalClosedTradeBrokerRow>(
  byDay: Record<string, T[]>,
  filter: JournalBrokerFilter
): Record<string, T[]> {
  if (filter === "ALL") return byDay;
  const out: Record<string, T[]> = {};
  for (const [day, rows] of Object.entries(byDay)) {
    const filtered = rows.filter((r) => resolveTradeRowBroker(r) === filter);
    if (filtered.length > 0) out[day] = filtered;
  }
  return out;
}

export function dailyRevenueFromClosedTrades(
  byDay: Record<string, Array<{ profitDollars?: number | null }>>
): Record<string, TradeJournalDayRevenue> {
  const out: Record<string, TradeJournalDayRevenue> = {};
  for (const [day, rows] of Object.entries(byDay)) {
    let total = 0;
    let tradeCount = 0;
    for (const row of rows) {
      if (row.profitDollars == null) continue;
      total += row.profitDollars;
      tradeCount += 1;
    }
    if (tradeCount > 0) out[day] = { total, tradeCount };
  }
  return out;
}

/** Scale an ALL-broker total using closed P&L mix when per-broker totals are missing. */
export function scaleBrokerMetricByRevenue(
  allValue: number,
  allRevenue: Record<string, TradeJournalDayRevenue>,
  brokerRevenue: Record<string, TradeJournalDayRevenue>
): number {
  if (allValue === 0) return 0;
  let allAbs = 0;
  let brokerAbs = 0;
  for (const d of Object.values(allRevenue)) allAbs += Math.abs(d.total);
  for (const d of Object.values(brokerRevenue)) brokerAbs += Math.abs(d.total);
  if (allAbs <= 0 || brokerAbs <= 0) return 0;
  return allValue * (brokerAbs / allAbs);
}

export interface BrokerJournalSource {
  dailyRevenue?: Record<string, TradeJournalDayRevenue>;
  dailyRevenueByBroker?: Partial<Record<JournalBrokerFilter, Record<string, TradeJournalDayRevenue>>>;
  dailyCash?: Record<string, number>;
  dailyCashByBroker?: Partial<Record<JournalBrokerFilter, Record<string, number>>>;
  dailyPositionValueByBroker?: Partial<Record<JournalBrokerFilter, Record<string, number>>>;
  investedPctSnapshot?: Partial<Record<JournalBrokerFilter, InvestedPctSnapshot>>;
  closedTradesByDay?: Record<string, TradeJournalClosedTradeBrokerRow[]>;
  closedTradesByDayByBroker?: Partial<
    Record<JournalBrokerFilter, Record<string, TradeJournalClosedTradeBrokerRow[]>>
  >;
  positionsValue?: number;
  positionsValueByBroker?: Partial<Record<JournalBrokerFilter, number>>;
  positionsCostBasis?: number;
  positionsCostBasisByBroker?: Partial<Record<JournalBrokerFilter, number>>;
  unrealizedPnL?: number;
  unrealizedPnLByBroker?: Partial<Record<JournalBrokerFilter, number>>;
  activePositionCount?: number;
  activePositionCountByBroker?: Partial<Record<JournalBrokerFilter, number>>;
  capitalFlowsByBroker?: Partial<Record<JournalBrokerFilter, import("./trade-journal-cash-ledger").CapitalFlowEvent[]>>;
}

export interface BrokerJournalView {
  dailyRevenue: Record<string, TradeJournalDayRevenue>;
  dailyCash: Record<string, number>;
  dailyPosition: Record<string, number>;
  closedTradesByDay: Record<string, TradeJournalClosedTradeBrokerRow[]>;
  positionsValue: number;
  positionsCostBasis: number;
  unrealizedPnL: number;
  activePositionCount: number;
  investedSnapshot: InvestedPctSnapshot | undefined;
  capitalFlows: import("./trade-journal-cash-ledger").CapitalFlowEvent[];
}

export function resolveBrokerJournalView(
  data: BrokerJournalSource | undefined,
  filter: JournalBrokerFilter
): BrokerJournalView {
  const empty: BrokerJournalView = {
    dailyRevenue: {},
    dailyCash: {},
    dailyPosition: {},
    closedTradesByDay: {},
    positionsValue: 0,
    positionsCostBasis: 0,
    unrealizedPnL: 0,
    activePositionCount: 0,
    investedSnapshot: undefined,
    capitalFlows: [],
  };
  if (!data) return empty;

  if (filter === "ALL") {
    return {
      dailyRevenue: data.dailyRevenue ?? {},
      dailyCash: data.dailyCash ?? {},
      dailyPosition: data.dailyPositionValueByBroker?.ALL ?? {},
      closedTradesByDay: data.closedTradesByDay ?? {},
      positionsValue: data.positionsValue ?? 0,
      positionsCostBasis: data.positionsCostBasis ?? 0,
      unrealizedPnL: data.unrealizedPnL ?? 0,
      activePositionCount: data.activePositionCount ?? 0,
      investedSnapshot: data.investedPctSnapshot?.ALL,
      capitalFlows: data.capitalFlowsByBroker?.ALL ?? [],
    };
  }

  const allRevenue = data.dailyRevenue ?? {};
  const allClosed = data.closedTradesByDay ?? {};

  let closedTradesByDay =
    data.closedTradesByDayByBroker?.[filter] &&
    Object.keys(data.closedTradesByDayByBroker[filter]!).length > 0
      ? data.closedTradesByDayByBroker[filter]!
      : filterClosedTradesByBroker(allClosed, filter);

  let dailyRevenue =
    data.dailyRevenueByBroker?.[filter] &&
    Object.keys(data.dailyRevenueByBroker[filter]!).length > 0
      ? data.dailyRevenueByBroker[filter]!
      : dailyRevenueFromClosedTrades(closedTradesByDay);

  if (Object.keys(dailyRevenue).length === 0 && Object.keys(allRevenue).length > 0) {
    dailyRevenue = dailyRevenueFromClosedTrades(closedTradesByDay);
  }

  const dailyCash = pickJournalBrokerScope(
    filter,
    data.dailyCashByBroker,
    data.dailyCash ?? {},
    {}
  );
  const dailyPosition = pickJournalBrokerScope(
    filter,
    data.dailyPositionValueByBroker,
    data.dailyPositionValueByBroker?.ALL ?? {},
    {}
  );

  const pickMetric = (
    byBroker: Partial<Record<JournalBrokerFilter, number>> | undefined,
    allValue: number
  ): number => {
    if (byBroker && Object.prototype.hasOwnProperty.call(byBroker, filter)) {
      return byBroker[filter] ?? 0;
    }
    return scaleBrokerMetricByRevenue(allValue, allRevenue, dailyRevenue);
  };

  return {
    dailyRevenue,
    dailyCash,
    dailyPosition,
    closedTradesByDay,
    positionsValue: pickMetric(data.positionsValueByBroker, data.positionsValue ?? 0),
    positionsCostBasis: pickMetric(data.positionsCostBasisByBroker, data.positionsCostBasis ?? 0),
    unrealizedPnL: pickMetric(data.unrealizedPnLByBroker, data.unrealizedPnL ?? 0),
    activePositionCount: pickMetric(
      data.activePositionCountByBroker,
      data.activePositionCount ?? 0
    ),
    investedSnapshot: data.investedPctSnapshot?.[filter],
    capitalFlows: data.capitalFlowsByBroker?.[filter] ?? [],
  };
}

/** EOD cash per broker per day; ALL sums Fidelity + Schwab cash per date. */
export function buildDailyCashByBroker(
  rows: CashImportRow[],
  cashFromRow: (row: CashImportRow) => number | null
): Record<JournalBrokerFilter, Record<string, number>> {
  const eodByBrokerAccountDay = new Map<string, { cash: number; sortKey: number }>();

  for (const row of rows) {
    const broker = normalizeJournalBroker(row.brokerId);
    if (!broker) continue;
    const cash = cashFromRow(row);
    if (cash == null) continue;
    const account = row.accountName?.trim() || "default";
    const key = `${broker}|${account}|${row.tradeDate}`;
    const sortKey = row.id ?? 0;
    const existing = eodByBrokerAccountDay.get(key);
    if (!existing || sortKey < existing.sortKey) {
      eodByBrokerAccountDay.set(key, { cash, sortKey });
    }
  }

  const fidelity: Record<string, number> = {};
  const schwab: Record<string, number> = {};
  const all: Record<string, number> = {};

  for (const [key, entry] of eodByBrokerAccountDay) {
    const [broker, , date] = key.split("|");
    const cash = entry.cash;
    if (broker === "FIDELITY") fidelity[date!] = (fidelity[date!] ?? 0) + cash;
    if (broker === "SCHWAB") schwab[date!] = (schwab[date!] ?? 0) + cash;
    all[date!] = (all[date!] ?? 0) + cash;
  }

  return { ALL: all, FIDELITY: fidelity, SCHWAB: schwab };
}

function filterTradesForBroker(
  trades: ImportedTradeLot[],
  filter: JournalBrokerFilter
): ImportedTradeLot[] {
  return trades.filter((t) => {
    const broker = normalizeJournalBroker(t.brokerId);
    if (!broker) return false;
    return filter === "ALL" || broker === filter;
  });
}

/** Reconstruct EOD position market value (cost-based) from imported buy/sell history. */
export function buildDailyPositionValue(
  trades: ImportedTradeLot[],
  filter: JournalBrokerFilter
): Record<string, number> {
  const filtered = filterTradesForBroker(trades, filter);
  if (filtered.length === 0) return {};

  const sorted = [...filtered].sort((a, b) => {
    const dateCmp = a.tradeDate.localeCompare(b.tradeDate);
    if (dateCmp !== 0) return dateCmp;
    return a.ticker.localeCompare(b.ticker);
  });

  const startDate = sorted[0]!.tradeDate;
  const endDate = sorted[sorted.length - 1]!.tradeDate;

  const holdings = new Map<string, { qty: number; lastPrice: number }>();
  let tradeIdx = 0;
  const result: Record<string, number> = {};

  const sumHoldings = (): number => {
    let total = 0;
    for (const h of holdings.values()) {
      if (h.qty > 0) total += h.qty * h.lastPrice;
    }
    return total;
  };

  const applyTrade = (trade: ImportedTradeLot) => {
    const ticker = trade.ticker.toUpperCase();
    const holding = holdings.get(ticker) ?? { qty: 0, lastPrice: trade.price };
    if (trade.direction.toUpperCase() === "BUY") {
      holding.qty += trade.quantity;
      holding.lastPrice = trade.price;
    } else if (trade.direction.toUpperCase() === "SELL") {
      holding.qty = Math.max(0, holding.qty - trade.quantity);
      holding.lastPrice = trade.price;
    }
    holdings.set(ticker, holding);
  };

  for (let d = startDate; d <= endDate; d = nextCalendarDay(d)) {
    while (tradeIdx < sorted.length && sorted[tradeIdx]!.tradeDate <= d) {
      applyTrade(sorted[tradeIdx]!);
      tradeIdx++;
    }
    result[d] = sumHoldings();
  }

  return result;
}

function ymdFromDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function dateFromYmd(ymd: string): Date {
  return new Date(`${ymd}T12:00:00Z`);
}

export function subDaysYmd(ymd: string, days: number): string {
  const d = dateFromYmd(ymd);
  d.setUTCDate(d.getUTCDate() - days);
  return ymdFromDate(d);
}

export function cashOnOrBefore(
  dailyCash: Record<string, number>,
  date: string,
  maxLookback = 365
): number | null {
  if (dailyCash[date] != null) return dailyCash[date]!;
  let cursor = date;
  for (let i = 0; i < maxLookback; i++) {
    cursor = subDaysYmd(cursor, 1);
    if (dailyCash[cursor] != null) return dailyCash[cursor]!;
  }
  return null;
}

function positionOnOrBefore(
  positionByDay: Record<string, number>,
  date: string,
  maxLookback = 365
): number {
  if (positionByDay[date] != null) return positionByDay[date]!;
  let cursor = date;
  for (let i = 0; i < maxLookback; i++) {
    cursor = subDaysYmd(cursor, 1);
    if (positionByDay[cursor] != null) return positionByDay[cursor]!;
  }
  return 0;
}

export function buildDailyInvestedPct(
  trades: ImportedTradeLot[],
  dailyCashByBroker: Record<JournalBrokerFilter, Record<string, number>>
): Record<JournalBrokerFilter, Record<string, number>> {
  const out: Record<JournalBrokerFilter, Record<string, number>> = {
    ALL: {},
    FIDELITY: {},
    SCHWAB: {},
  };

  for (const filter of ["ALL", "FIDELITY", "SCHWAB"] as JournalBrokerFilter[]) {
    const positionByDay = buildDailyPositionValue(trades, filter);
    const cashByDay = dailyCashByBroker[filter];
    const dates = [...new Set([...Object.keys(cashByDay), ...Object.keys(positionByDay)])].sort();

    for (const date of dates) {
      const pos = positionOnOrBefore(positionByDay, date);
      const cash = cashOnOrBefore(cashByDay, date);
      const pct = pctInvested(pos, cash);
      if (pct != null) out[filter][date] = pct;
    }
  }

  return out;
}

export interface InvestedPctSnapshot {
  asOfDate: string | null;
  pct: number | null;
  changeFromPriorDay: number | null;
  changeFromWeekStart: number | null;
  changeFromMonthStart: number | null;
}

/** Cash + reconstructed position value on or before a date. */
export function equityOnDate(
  ymd: string,
  dailyCash: Record<string, number>,
  dailyPosition: Record<string, number>
): number | null {
  const cash = cashOnOrBefore(dailyCash, ymd);
  if (cash == null) return null;
  return cash + positionOnOrBefore(dailyPosition, ymd);
}

/** Equity at EOD immediately before a period starts. */
export function periodStartEquity(
  periodStartYmd: string,
  dailyCash: Record<string, number>,
  dailyPosition: Record<string, number>
): number | null {
  return (
    equityOnDate(subDaysYmd(periodStartYmd, 1), dailyCash, dailyPosition) ??
    equityOnDate(periodStartYmd, dailyCash, dailyPosition)
  );
}

/** Realized P&L ÷ start equity (trade-only; not Fidelity Balance return). */
export function computeReturnPct(realized: number, startEquity: number | null): number | null {
  if (startEquity == null || startEquity <= 0) return null;
  return (realized / startEquity) * 100;
}

/** Fidelity-style: (end equity − start equity) ÷ start equity. */
export function computeAccountReturnPct(
  endEquity: number | null,
  startEquity: number | null
): number | null {
  if (endEquity == null || startEquity == null || startEquity <= 0) return null;
  return ((endEquity - startEquity) / startEquity) * 100;
}

export function totalEquity(cash: number | null, positionsValue: number): number | null {
  if (cash == null) return null;
  return cash + positionsValue;
}

/**
 * Beginning equity for a period when historical position market values are unknown.
 * Strips YTD/period realized and current unrealized from today's total — aligns with broker Balance return.
 */
export function impliedPeriodStartEquity(
  endEquity: number,
  realizedInPeriod: number,
  unrealizedNow: number
): number {
  return endEquity - realizedInPeriod - unrealizedNow;
}

/** Scale reconstructed cost-basis positions toward current market value. */
export function equityOnDateMarketScaled(
  ymd: string,
  dailyCash: Record<string, number>,
  dailyPositionCost: Record<string, number>,
  marketToCostRatio: number
): number | null {
  const cash = cashOnOrBefore(dailyCash, ymd);
  if (cash == null) return null;
  const posCost = positionOnOrBefore(dailyPositionCost, ymd);
  return cash + posCost * marketToCostRatio;
}

function startOfWeekYmd(ymd: string): string {
  const d = dateFromYmd(ymd);
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - dow);
  return ymdFromDate(d);
}

function startOfMonthYmd(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

function lookupPctOnOrBefore(
  dailyPct: Record<string, number>,
  targetYmd: string,
  maxLookback = 90
): number | null {
  if (dailyPct[targetYmd] != null) return dailyPct[targetYmd]!;
  let cursor = targetYmd;
  for (let i = 0; i < maxLookback; i++) {
    cursor = subDaysYmd(cursor, 1);
    if (dailyPct[cursor] != null) return dailyPct[cursor]!;
  }
  return null;
}

export function buildInvestedPctSnapshot(
  dailyPct: Record<string, number>
): InvestedPctSnapshot {
  const dates = Object.keys(dailyPct).sort();
  if (dates.length === 0) {
    return {
      asOfDate: null,
      pct: null,
      changeFromPriorDay: null,
      changeFromWeekStart: null,
      changeFromMonthStart: null,
    };
  }

  const asOfDate = dates[dates.length - 1]!;
  const pct = dailyPct[asOfDate]!;

  const priorDayYmd = subDaysYmd(asOfDate, 1);
  const priorPct = lookupPctOnOrBefore(dailyPct, priorDayYmd, 7);
  const weekStartPct = lookupPctOnOrBefore(dailyPct, startOfWeekYmd(asOfDate));
  const monthStartPct = lookupPctOnOrBefore(dailyPct, startOfMonthYmd(asOfDate));

  return {
    asOfDate,
    pct,
    changeFromPriorDay: priorPct != null ? pct - priorPct : null,
    changeFromWeekStart: weekStartPct != null ? pct - weekStartPct : null,
    changeFromMonthStart: monthStartPct != null ? pct - monthStartPct : null,
  };
}

/** positions ÷ (positions + cash) — used when historical daily series is empty. */
export function buildCurrentInvestedPctSnapshot(
  positionValue: number,
  dailyCash: Record<string, number>,
  dailyPct?: Record<string, number>
): InvestedPctSnapshot {
  const cashDates = Object.keys(dailyCash).sort();
  const asOfDate = cashDates.length > 0 ? cashDates[cashDates.length - 1]! : null;
  const cash = asOfDate != null ? cashOnOrBefore(dailyCash, asOfDate) : null;
  const livePct = pctInvested(positionValue, cash);

  const hist = buildInvestedPctSnapshot(dailyPct ?? {});

  if (livePct != null) {
    const priorPct = dailyPct
      ? lookupPctOnOrBefore(dailyPct, subDaysYmd(asOfDate!, 1), 7)
      : null;
    return {
      asOfDate,
      pct: livePct,
      changeFromPriorDay: priorPct != null ? livePct - priorPct : null,
      changeFromWeekStart: hist.changeFromWeekStart != null
        ? livePct - (hist.pct! - hist.changeFromWeekStart)
        : null,
      changeFromMonthStart: hist.changeFromMonthStart != null
        ? livePct - (hist.pct! - hist.changeFromMonthStart)
        : null,
    };
  }

  return hist;
}
