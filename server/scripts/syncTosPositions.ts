import "dotenv/config";
import { sql } from "drizzle-orm";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import {
  parseTosAccountStatement,
  tosSchwabAccountName,
  TosPosition,
} from "@shared/tos-account-statement";
import { getDb, initializeDatabase } from "../db";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const USER_ID = 2;
const TOS_CASH_TICKER = "__TOS_CASH__";

interface DbPosition {
  id: number;
  symbol: string;
  account_name: string;
  position_size: string;
  entry_price: string;
  status: string;
}

async function main() {
  await initializeDatabase();
  const db = getDb();

  const files = [
    join(__dirname, "../../data/tos-imports/RollOver_TOS__2026-06-08-AccountStatement.csv"),
    join(__dirname, "../../data/tos-imports/RollOver_TOS_2026-06-08-AccountStatement.csv"),
  ];

  const parsed = files.map((f) => {
    const content = readFileSync(f, "utf-8");
    return parseTosAccountStatement(content);
  });

  // ── 1. Import daily cash snapshots ──────────────────────────────────
  console.log("── Syncing daily cash ──");
  const { sentinelImportedTrades } = await import("@shared/schema");

  await db.execute(
    sql`DELETE FROM sentinel_imported_trades WHERE user_id = ${USER_ID} AND ticker = ${TOS_CASH_TICKER}`
  );

  for (const data of parsed) {
    const accountName = tosSchwabAccountName(data.account.accountName);
    const batchId = uuidv4();

    const { sentinelImportBatches } = await import("@shared/schema");
    await db.insert(sentinelImportBatches).values({
      batchId,
      userId: USER_ID,
      brokerId: "SCHWAB",
      fileName: "TOS-AccountStatement-sync",
      totalTradesFound: data.dailyCash.length,
      totalTradesImported: data.dailyCash.length,
      status: "COMPLETE",
    });

    const latestDate = data.dailyCash[data.dailyCash.length - 1]?.date;
    const rows = data.dailyCash.map((entry) => ({
      tradeId: uuidv4(),
      userId: USER_ID,
      batchId,
      brokerId: "SCHWAB",
      ticker: TOS_CASH_TICKER,
      assetType: "CASH",
      direction: "BAL",
      quantity: 0,
      price: 0,
      totalAmount: 0,
      netAmount: 0,
      cashBalance:
        entry.date === latestDate && data.totalCash != null
          ? data.totalCash
          : entry.cash,
      tradeDate: entry.date,
      accountName,
      status: "CONFIRMED",
    }));

    const CHUNK = 200;
    for (let i = 0; i < rows.length; i += CHUNK) {
      await db.insert(sentinelImportedTrades).values(rows.slice(i, i + CHUNK));
    }
    console.log(`  ${accountName}: ${rows.length} daily cash entries`);
  }

  // ── 2. Build TOS position map (equities + funds) ───────────────────
  console.log("\n── Syncing positions ──");

  const tosPositions = new Map<string, { acct: string; pos: TosPosition }>();

  for (const data of parsed) {
    const accountName = tosSchwabAccountName(data.account.accountName);
    for (const eq of [...data.equities, ...data.others]) {
      const key = `${accountName}|${eq.symbol.toUpperCase()}`;
      tosPositions.set(key, { acct: accountName, pos: eq });
    }
  }

  // ── 3. Get current DB active Schwab positions ──────────────────────
  const dbActive = await db.execute(sql`
    SELECT id, symbol, account_name, position_size::text as position_size,
           entry_price::text as entry_price, status
    FROM sentinel_trades
    WHERE user_id = ${USER_ID} AND status = 'active'
      AND (account_name ILIKE '%schwab%' OR account_name ILIKE '%bene%'
           OR account_name ILIKE '%rollover%')
  `);
  const dbPositions = dbActive.rows as DbPosition[];

  let closed = 0;
  let updated = 0;
  let inserted = 0;
  let markUpdated = 0;
  let unchanged = 0;

  const matched = new Set<string>();

  // ── 4. For each DB position, check if it's still in TOS ────────────
  for (const dbPos of dbPositions) {
    const key = `${dbPos.account_name}|${dbPos.symbol.toUpperCase()}`;
    const tosMatch = tosPositions.get(key);

    if (!tosMatch) {
      // Position not in TOS → user sold it, close it
      const markPrice = null; // We don't have exit price, leave it null
      await db.execute(sql`
        UPDATE sentinel_trades
        SET status = 'closed',
            exit_date = now(),
            notes = COALESCE(notes, '') || ' [Auto-closed by TOS sync: not in current positions]',
            updated_at = now()
        WHERE id = ${dbPos.id}
      `);
      console.log(`  CLOSED: ${dbPos.symbol} in ${dbPos.account_name} (not in TOS)`);
      closed++;
    } else {
      matched.add(key);
      const dbQty = parseFloat(dbPos.position_size);
      const tosQty = tosMatch.pos.qty;
      const qtyMatch = Math.abs(dbQty - tosQty) < 0.01;

      if (!qtyMatch) {
        await db.execute(sql`
          UPDATE sentinel_trades
          SET position_size = ${tosQty},
              entry_price = ${tosMatch.pos.tradePrice},
              mark_price = ${tosMatch.pos.mark},
              mark_updated_at = now(),
              updated_at = now()
          WHERE id = ${dbPos.id}
        `);
        console.log(`  UPDATED: ${dbPos.symbol} qty ${dbQty} → ${tosQty}, mark=$${tosMatch.pos.mark.toFixed(2)}`);
        updated++;
      } else {
        await db.execute(sql`
          UPDATE sentinel_trades
          SET mark_price = ${tosMatch.pos.mark},
              mark_updated_at = now(),
              entry_price = ${tosMatch.pos.tradePrice},
              updated_at = now()
          WHERE id = ${dbPos.id}
        `);
        markUpdated++;
        unchanged++;
      }
    }
  }

  // ── 5. Insert new positions from TOS that aren't in DB ─────────────
  const { sentinelTrades } = await import("@shared/schema");

  for (const [key, { acct, pos }] of tosPositions) {
    if (matched.has(key)) continue;

    await db.insert(sentinelTrades).values({
      userId: USER_ID,
      symbol: pos.symbol,
      direction: "long",
      entryPrice: pos.tradePrice,
      entryDate: new Date(),
      positionSize: pos.qty,
      status: "active",
      source: "import",
      accountName: acct,
      markPrice: pos.mark,
      markUpdatedAt: new Date(),
      notes: `Imported from TOS Account Statement. Mark: $${pos.mark.toFixed(2)}, Value: $${pos.markValue.toFixed(2)}`,
    });
    console.log(`  INSERTED: ${pos.symbol} in ${acct} (${pos.qty} shares @ $${pos.tradePrice.toFixed(2)}, mark=$${pos.mark.toFixed(2)})`);
    inserted++;
  }

  // ── 6. Remove old Schwab anchors/events ────────────────────────────
  await db.execute(sql`
    DELETE FROM sentinel_journal_cash_anchor
    WHERE user_id = ${USER_ID} AND broker_id = 'SCHWAB'
  `);
  await db.execute(sql`
    DELETE FROM sentinel_journal_cash_events
    WHERE user_id = ${USER_ID} AND broker_id = 'SCHWAB'
  `);

  // ── 7. Summary ─────────────────────────────────────────────────────
  console.log(`\n── Sync Summary ──`);
  console.log(`  Closed (sold): ${closed}`);
  console.log(`  Updated (qty change): ${updated}`);
  console.log(`  Mark updated (existing): ${markUpdated}`);
  console.log(`  Inserted (new): ${inserted}`);

  // ── 8. Verify final state ──────────────────────────────────────────
  const final = await db.execute(sql`
    SELECT symbol, account_name, position_size::numeric as qty,
           entry_price::numeric as cost, mark_price::numeric as mark,
           (position_size * mark_price)::numeric(15,2) as market_value,
           (position_size * (mark_price - entry_price))::numeric(15,2) as unrealized
    FROM sentinel_trades
    WHERE user_id = ${USER_ID} AND status = 'active'
      AND (account_name ILIKE '%schwab%' OR account_name ILIKE '%bene%'
           OR account_name ILIKE '%rollover%')
    ORDER BY account_name, symbol
  `);

  let totalCost = 0;
  let totalMarket = 0;
  let totalUnrealized = 0;
  console.log(`\n── Final Schwab Positions ──`);
  for (const row of final.rows as any[]) {
    const cost = Number(row.qty) * Number(row.cost);
    const market = parseFloat(row.market_value);
    const ur = parseFloat(row.unrealized);
    totalCost += cost;
    totalMarket += market;
    totalUnrealized += ur;
    console.log(`  ${row.account_name} | ${row.symbol}: ${row.qty} @ cost=$${Number(row.cost).toFixed(2)}, mark=$${Number(row.mark).toFixed(2)}, value=$${row.market_value}, unrealized=$${row.unrealized}`);
  }
  console.log(`\n  Total cost: $${totalCost.toFixed(2)}`);
  console.log(`  Total market: $${totalMarket.toFixed(2)}`);
  console.log(`  Total unrealized: $${totalUnrealized.toFixed(2)}`);

  process.exit(0);
}
main();
