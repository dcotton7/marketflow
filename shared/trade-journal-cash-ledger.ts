import {
  normalizeJournalBroker,
  type CashImportRow,
  type JournalBrokerFilter,
} from "./trade-journal-invested";

export interface CashLedgerAnchor {
  brokerId: "FIDELITY" | "SCHWAB";
  anchorDate: string;
  anchorCash: number;
}

export interface CashLedgerEvent {
  id?: number;
  brokerId: "FIDELITY" | "SCHWAB";
  eventDate: string;
  amount: number;
  label?: string | null;
}

export type CapitalFlowKind = "starting_equity" | "capital_injection" | "withdrawal";

export interface CapitalFlowEvent {
  brokerId: "FIDELITY" | "SCHWAB";
  eventDate: string;
  amount: number;
  kind: CapitalFlowKind;
  label?: string | null;
}

/**
 * Compute YTD account return using capital flows (starting equity + injections/withdrawals).
 * Uses simple return: (ending - totalCapital) / totalCapital.
 */
export function computeCapitalFlowReturn(
  currentEquity: number,
  flows: CapitalFlowEvent[]
): number | null {
  if (flows.length === 0) return null;
  const startingEquity = flows
    .filter((f) => f.kind === "starting_equity")
    .reduce((sum, f) => sum + f.amount, 0);
  const injections = flows
    .filter((f) => f.kind === "capital_injection")
    .reduce((sum, f) => sum + f.amount, 0);
  const withdrawals = flows
    .filter((f) => f.kind === "withdrawal")
    .reduce((sum, f) => sum + f.amount, 0);
  const totalCapital = startingEquity + injections - withdrawals;
  if (totalCapital <= 0) return null;
  return ((currentEquity - totalCapital) / totalCapital) * 100;
}

export interface TradeCashLot {
  brokerId: string;
  tradeDate: string;
  direction: string;
  netAmount: number;
}

export function nextCalendarDay(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Tagged anchor date D → opening cash applies from start of D+1. */
export function effectiveCashStartDate(anchorDate: string): string {
  return nextCalendarDay(anchorDate);
}

function ymdToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Prefer broker-reported Activity cash; fill gaps from manual ledger. */
export function mergeDailyCashMaps(
  imported: Record<string, number>,
  synthetic: Record<string, number>
): Record<string, number> {
  const dates = new Set([...Object.keys(imported), ...Object.keys(synthetic)]);
  const out: Record<string, number> = {};
  for (const d of [...dates].sort()) {
    if (imported[d] != null) out[d] = imported[d]!;
    else if (synthetic[d] != null) out[d] = synthetic[d]!;
  }
  return out;
}

export function sumDailyCashMaps(
  a: Record<string, number>,
  b: Record<string, number>
): Record<string, number> {
  const dates = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  const out: Record<string, number> = {};
  let lastA: number | null = null;
  let lastB: number | null = null;
  for (const d of dates) {
    if (a[d] != null) lastA = a[d]!;
    if (b[d] != null) lastB = b[d]!;
    if (lastA == null && lastB == null) continue;
    out[d] = (lastA ?? 0) + (lastB ?? 0);
  }
  return out;
}

function buildSyntheticDailyCashForBroker(
  trades: TradeCashLot[],
  broker: "FIDELITY" | "SCHWAB",
  anchor: CashLedgerAnchor | null,
  events: CashLedgerEvent[]
): Record<string, number> {
  if (!anchor || anchor.brokerId !== broker) return {};

  const effectiveStart = effectiveCashStartDate(anchor.anchorDate);
  const brokerTrades = trades
    .filter((t) => normalizeJournalBroker(t.brokerId) === broker)
    .filter((t) => t.tradeDate >= effectiveStart)
    .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));

  const eventsByDate = new Map<string, number>();
  for (const e of events.filter((ev) => ev.brokerId === broker)) {
    eventsByDate.set(e.eventDate, (eventsByDate.get(e.eventDate) ?? 0) + e.amount);
  }

  const tradesByDate = new Map<string, TradeCashLot[]>();
  for (const t of brokerTrades) {
    const bucket = tradesByDate.get(t.tradeDate) ?? [];
    bucket.push(t);
    tradesByDate.set(t.tradeDate, bucket);
  }

  const tradeEnd =
    brokerTrades.length > 0 ? brokerTrades[brokerTrades.length - 1]!.tradeDate : effectiveStart;
  const lastDate = tradeEnd > ymdToday() ? tradeEnd : ymdToday();

  let running = anchor.anchorCash;
  const result: Record<string, number> = {};

  for (let d = effectiveStart; d <= lastDate; d = nextCalendarDay(d)) {
    if (eventsByDate.has(d)) running += eventsByDate.get(d)!;
    for (const t of tradesByDate.get(d) ?? []) {
      const amt = Number(t.netAmount) || 0;
      if (amt !== 0) running += amt;
    }
    result[d] = running;
  }

  return result;
}

/**
 * Rebuild daily cash from trade history: apply netAmount each day, snap to Activity
 * Cash Balance when present (recent rows are often "Processing").
 */
export function buildChainDailyCashByBroker(
  importRows: CashImportRow[],
  trades: TradeCashLot[],
  broker: "FIDELITY" | "SCHWAB",
  cashFromRow: (row: CashImportRow) => number | null,
  anchor?: CashLedgerAnchor | null
): Record<string, number> {
  const activityEod = new Map<string, { cash: number; sortKey: number }>();
  for (const row of importRows) {
    if (normalizeJournalBroker(row.brokerId) !== broker) continue;
    const cash = cashFromRow(row);
    if (cash == null) continue;
    const sortKey = row.id ?? 0;
    const prev = activityEod.get(row.tradeDate);
    if (!prev || sortKey < prev.sortKey) {
      activityEod.set(row.tradeDate, { cash, sortKey });
    }
  }

  const brokerTrades = trades
    .filter((t) => normalizeJournalBroker(t.brokerId) === broker)
    .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));

  const tradesByDate = new Map<string, TradeCashLot[]>();
  for (const t of brokerTrades) {
    const bucket = tradesByDate.get(t.tradeDate) ?? [];
    bucket.push(t);
    tradesByDate.set(t.tradeDate, bucket);
  }

  const allDates = [
    ...new Set([...tradesByDate.keys(), ...activityEod.keys()]),
  ].sort();

  if (allDates.length === 0 && !anchor) return {};

  const effectiveStart =
    anchor?.brokerId === broker ? effectiveCashStartDate(anchor.anchorDate) : null;

  let running: number | null =
    anchor?.brokerId === broker ? anchor.anchorCash : null;
  let seeded = running != null;

  const result: Record<string, number> = {};

  for (const date of allDates) {
    if (effectiveStart && date < effectiveStart) {
      const eod = activityEod.get(date);
      if (eod != null) result[date] = eod.cash;
      continue;
    }

    if (!seeded) {
      const eod = activityEod.get(date);
      if (eod == null) continue;
      running = eod.cash;
      seeded = true;
      result[date] = running;
      continue;
    }

    for (const t of tradesByDate.get(date) ?? []) {
      const amt = Number(t.netAmount) || 0;
      if (amt !== 0) running! += amt;
    }

    const eod = activityEod.get(date);
    if (eod != null) running = eod.cash;
    result[date] = running!;
  }

  return result;
}

export function buildChainDailyCashForAllBrokers(
  importRows: CashImportRow[],
  trades: TradeCashLot[],
  cashFromRow: (row: CashImportRow) => number | null,
  anchors?: Partial<Record<"FIDELITY" | "SCHWAB", CashLedgerAnchor>>
): Record<JournalBrokerFilter, Record<string, number>> {
  const fidelity = buildChainDailyCashByBroker(
    importRows,
    trades,
    "FIDELITY",
    cashFromRow,
    anchors?.FIDELITY ?? null
  );
  const schwab = buildChainDailyCashByBroker(
    importRows,
    trades,
    "SCHWAB",
    cashFromRow,
    anchors?.SCHWAB ?? null
  );
  return {
    FIDELITY: fidelity,
    SCHWAB: schwab,
    ALL: sumDailyCashMaps(fidelity, schwab),
  };
}

export function buildSyntheticDailyCashByBroker(
  trades: TradeCashLot[],
  anchors: Partial<Record<"FIDELITY" | "SCHWAB", CashLedgerAnchor>>,
  events: CashLedgerEvent[]
): Record<JournalBrokerFilter, Record<string, number>> {
  const fidelity = buildSyntheticDailyCashForBroker(
    trades,
    "FIDELITY",
    anchors.FIDELITY ?? null,
    events
  );
  const schwab = buildSyntheticDailyCashForBroker(trades, "SCHWAB", anchors.SCHWAB ?? null, events);
  return {
    FIDELITY: fidelity,
    SCHWAB: schwab,
    ALL: sumDailyCashMaps(fidelity, schwab),
  };
}

export function defaultYtdAnchorDate(): string {
  return `${new Date().getFullYear()}-01-01`;
}

/** EOD on tag date from a prior anchor — expected opening cash on the next morning. */
export function computeTrackedOpeningCash(
  broker: "FIDELITY" | "SCHWAB",
  tagDate: string,
  priorAnchor: CashLedgerAnchor,
  trades: TradeCashLot[],
  events: CashLedgerEvent[]
): number | null {
  const priorEffective = effectiveCashStartDate(priorAnchor.anchorDate);
  if (tagDate < priorAnchor.anchorDate) return null;
  const synthetic = buildSyntheticDailyCashForBroker(trades, broker, priorAnchor, events);
  if (tagDate < priorEffective) return priorAnchor.anchorCash;
  return synthetic[tagDate] ?? null;
}

const CASH_EPSILON = 0.01;

export function detectCashDiscrepancy(
  enteredCash: number,
  trackedCash: number | null
): { amount: number; note: string } | null {
  if (trackedCash == null) return null;
  const amount = enteredCash - trackedCash;
  if (Math.abs(amount) <= CASH_EPSILON) return null;
  const fmt = (n: number) =>
    `$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const note =
    amount > 0
      ? `Entered ${fmt(enteredCash)} vs tracked ${fmt(trackedCash)} (+${fmt(amount)} adjustment)`
      : `Entered ${fmt(enteredCash)} vs tracked ${fmt(trackedCash)} (−${fmt(Math.abs(amount))} adjustment)`;
  return { amount, note };
}
