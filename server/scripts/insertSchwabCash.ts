import "dotenv/config";
import { getDb, initializeDatabase } from "../db";
import { upsertJournalCashAnchor, addJournalCashEvent } from "../sentinel/journalCashLedger";

const USER_ID = 2;

async function main() {
  await initializeDatabase();
  const db = getDb();

  // 1. Set Schwab anchor: Jan 1, 2026 — Designated Bene cash only
  const anchor = await upsertJournalCashAnchor(db, USER_ID, {
    brokerId: "SCHWAB",
    anchorDate: "2026-01-01",
    anchorCash: 12905,
  });
  console.log("Schwab anchor set:", anchor);

  // 2. Add cash event: Feb 17, 2026 — Rollover IRA cash portion of transfer
  const event = await addJournalCashEvent(db, USER_ID, {
    brokerId: "SCHWAB",
    eventDate: "2026-02-17",
    amount: 587834,
    label: "Rollover IRA transfer — cash portion of $694,703 deposit",
    eventKind: "adjustment",
  });
  console.log("Cash event added:", event);

  console.log("\nDone. Schwab cash chain now starts at $12,905 on Jan 1 and adds $587,834 on Feb 17.");
  process.exit(0);
}
main();
