import "dotenv/config";
import { initializeDatabase } from "../db";
import { listIntradaySnapshotSlots } from "../market-condition/engine/theme-snapshots";
import { getMarketDateTime } from "../market-condition/utils/theme-tracker-time";

async function main() {
  await initializeDatabase();
  const date = process.argv[2] || "2026-06-04";
  const slots = await listIntradaySnapshotSlots(date);
  console.log("listIntradaySnapshotSlots", date, "=>", slots.length, "slots");
  if (slots.length) console.log("first", slots[0], "last", slots[slots.length - 1]);
  const { date: today } = getMarketDateTime();
  console.log("ET today", today, "slots", (await listIntradaySnapshotSlots(today)).length);
}

main().catch(console.error);
