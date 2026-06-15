import { and, asc, eq } from "drizzle-orm";
import {
  sentinelImportedTrades,
  sentinelJournalCashAnchor,
  sentinelJournalCashEvents,
} from "@shared/schema";
import {
  computeTrackedOpeningCash,
  detectCashDiscrepancy,
  effectiveCashStartDate,
  type CashLedgerAnchor,
  type CashLedgerEvent,
  type CapitalFlowEvent,
  type CapitalFlowKind,
  type TradeCashLot,
} from "@shared/trade-journal-cash-ledger";
import type { db as dbInstance } from "../db";

type Db = NonNullable<typeof dbInstance>;

const CAPITAL_FLOW_KINDS = new Set<string>(["starting_equity", "capital_injection", "withdrawal"]);

export interface JournalCashSetup {
  anchors: Partial<Record<"FIDELITY" | "SCHWAB", CashLedgerAnchor>>;
  events: CashLedgerEvent[];
  capitalFlows: CapitalFlowEvent[];
}

const EMPTY_CASH_SETUP: JournalCashSetup = { anchors: {}, events: [], capitalFlows: [] };

function anchorFromRow(row: {
  brokerId: string;
  anchorDate: string;
  anchorCash: number;
  trackedCash: number | null;
  discrepancyAmount: number | null;
  discrepancyNote: string | null;
}): CashLedgerAnchor {
  const broker = row.brokerId.toUpperCase() as "FIDELITY" | "SCHWAB";
  return {
    brokerId: broker,
    anchorDate: row.anchorDate,
    anchorCash: row.anchorCash,
    effectiveDate: effectiveCashStartDate(row.anchorDate),
    trackedCash: row.trackedCash,
    discrepancyAmount: row.discrepancyAmount,
    discrepancyNote: row.discrepancyNote,
  };
}

export async function loadJournalCashSetup(db: Db, userId: number): Promise<JournalCashSetup> {
  try {
    return await loadJournalCashSetupInner(db, userId);
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === "42P01") return EMPTY_CASH_SETUP;
    throw error;
  }
}

async function loadJournalCashSetupInner(db: Db, userId: number): Promise<JournalCashSetup> {
  const [anchorRows, eventRows] = await Promise.all([
    db
      .select()
      .from(sentinelJournalCashAnchor)
      .where(eq(sentinelJournalCashAnchor.userId, userId)),
    db
      .select()
      .from(sentinelJournalCashEvents)
      .where(eq(sentinelJournalCashEvents.userId, userId))
      .orderBy(asc(sentinelJournalCashEvents.eventDate), asc(sentinelJournalCashEvents.id)),
  ]);

  const anchors: JournalCashSetup["anchors"] = {};
  for (const row of anchorRows) {
    const broker = row.brokerId.toUpperCase();
    if (broker === "FIDELITY" || broker === "SCHWAB") {
      anchors[broker] = anchorFromRow(row);
    }
  }

  const events: CashLedgerEvent[] = [];
  const capitalFlows: CapitalFlowEvent[] = [];

  for (const row of eventRows) {
    const broker = row.brokerId.toUpperCase();
    if (broker !== "FIDELITY" && broker !== "SCHWAB") continue;

    if (CAPITAL_FLOW_KINDS.has(row.eventKind ?? "")) {
      capitalFlows.push({
        brokerId: broker,
        eventDate: row.eventDate,
        amount: row.amount,
        kind: row.eventKind as CapitalFlowKind,
        label: row.label,
      });
    } else {
      const kind = row.eventKind === "reconciliation" ? "reconciliation" : "adjustment";
      events.push({
        id: row.id,
        brokerId: broker,
        eventDate: row.eventDate,
        amount: row.amount,
        label: row.label,
        eventKind: kind,
      });
    }
  }

  return { anchors, events, capitalFlows };
}

async function loadImportTradesForCash(db: Db, userId: number): Promise<TradeCashLot[]> {
  const rows = await db
    .select({
      brokerId: sentinelImportedTrades.brokerId,
      tradeDate: sentinelImportedTrades.tradeDate,
      direction: sentinelImportedTrades.direction,
      netAmount: sentinelImportedTrades.netAmount,
    })
    .from(sentinelImportedTrades)
    .where(eq(sentinelImportedTrades.userId, userId));
  return rows.map((r) => ({
    brokerId: r.brokerId,
    tradeDate: r.tradeDate,
    direction: r.direction,
    netAmount: r.netAmount,
  }));
}

export async function upsertJournalCashAnchor(
  db: Db,
  userId: number,
  anchor: Pick<CashLedgerAnchor, "brokerId" | "anchorDate" | "anchorCash">
): Promise<CashLedgerAnchor> {
  const [existingRows, trades, setup] = await Promise.all([
    db
      .select()
      .from(sentinelJournalCashAnchor)
      .where(
        and(
          eq(sentinelJournalCashAnchor.userId, userId),
          eq(sentinelJournalCashAnchor.brokerId, anchor.brokerId)
        )
      )
      .limit(1),
    loadImportTradesForCash(db, userId),
    loadJournalCashSetupInner(db, userId),
  ]);

  const priorAnchor = existingRows[0] ? anchorFromRow(existingRows[0]) : null;
  const trackedCash =
    priorAnchor != null
      ? computeTrackedOpeningCash(
          anchor.brokerId,
          anchor.anchorDate,
          priorAnchor,
          trades,
          setup.events
        )
      : null;
  const discrepancy = detectCashDiscrepancy(anchor.anchorCash, trackedCash);

  const values = {
    anchorDate: anchor.anchorDate,
    anchorCash: anchor.anchorCash,
    trackedCash,
    discrepancyAmount: discrepancy?.amount ?? null,
    discrepancyNote: discrepancy?.note ?? null,
    updatedAt: new Date(),
  };

  if (existingRows.length > 0) {
    await db
      .update(sentinelJournalCashAnchor)
      .set(values)
      .where(eq(sentinelJournalCashAnchor.id, existingRows[0]!.id));
  } else {
    await db.insert(sentinelJournalCashAnchor).values({
      userId,
      brokerId: anchor.brokerId,
      ...values,
    });
  }

  if (discrepancy) {
    await db.insert(sentinelJournalCashEvents).values({
      userId,
      brokerId: anchor.brokerId,
      eventDate: anchor.anchorDate,
      amount: discrepancy.amount,
      label: discrepancy.note,
      eventKind: "reconciliation",
    });
  }

  return {
    brokerId: anchor.brokerId,
    anchorDate: anchor.anchorDate,
    anchorCash: anchor.anchorCash,
    effectiveDate: effectiveCashStartDate(anchor.anchorDate),
    trackedCash,
    discrepancyAmount: discrepancy?.amount ?? null,
    discrepancyNote: discrepancy?.note ?? null,
  };
}

export async function addJournalCashEvent(
  db: Db,
  userId: number,
  event: Omit<CashLedgerEvent, "id">
): Promise<CashLedgerEvent> {
  const [row] = await db
    .insert(sentinelJournalCashEvents)
    .values({
      userId,
      brokerId: event.brokerId,
      eventDate: event.eventDate,
      amount: event.amount,
      label: event.label ?? null,
      eventKind: event.eventKind ?? "adjustment",
    })
    .returning();
  return {
    id: row!.id,
    brokerId: event.brokerId,
    eventDate: row!.eventDate,
    amount: row!.amount,
    label: row!.label,
    eventKind: row!.eventKind === "reconciliation" ? "reconciliation" : "adjustment",
  };
}

export async function deleteJournalCashEvent(
  db: Db,
  userId: number,
  eventId: number
): Promise<boolean> {
  const [deleted] = await db
    .delete(sentinelJournalCashEvents)
    .where(
      and(
        eq(sentinelJournalCashEvents.id, eventId),
        eq(sentinelJournalCashEvents.userId, userId)
      )
    )
    .returning({ id: sentinelJournalCashEvents.id });
  return !!deleted;
}
