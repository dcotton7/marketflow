/**
 * Import TOS Account Statement CSVs for Schwab accounts.
 *
 * Reads all TOS CSV files from data/tos-imports/, parses them, and:
 *  1. Inserts daily cash snapshots into sentinel_imported_trades (replaces anchor/event system)
 *  2. Upserts mutual fund positions into sentinel_trades as active positions
 *  3. Runs reconciliation: compares equities vs our DB positions
 *
 * Usage: npx tsx server/scripts/importTosAccountStatements.ts
 */
import "dotenv/config";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { eq, and, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { getDb, initializeDatabase } from "../db";
import {
  sentinelImportBatches,
  sentinelImportedTrades,
  sentinelTrades,
} from "@shared/schema";
import {
  parseTosAccountStatement,
  tosSchwabAccountName,
  type TosAccountStatement,
  type TosPosition,
} from "@shared/tos-account-statement";

const USER_ID = 2;
const TOS_CASH_TICKER = "__TOS_CASH__";

async function main() {
  await initializeDatabase();
  const db = getDb();

  const dir = join(__dirname, "../../data/tos-imports");
  const csvFiles = readdirSync(dir)
    .filter((f) => f.endsWith(".csv") && f.toLowerCase().includes("tos"))
    .map((f) => ({ name: f, path: join(dir, f) }));

  if (csvFiles.length === 0) {
    console.error(`No TOS CSV files found in ${dir}`);
    process.exit(1);
  }

  const parsed: Array<{ fileName: string; data: TosAccountStatement }> = [];
  for (const file of csvFiles) {
    const csv = readFileSync(file.path, "utf-8");
    const data = parseTosAccountStatement(csv);
    parsed.push({ fileName: file.name, data });
    console.log(`Parsed: ${file.name} → ${data.account.accountName} (${data.dailyCash.length} cash days, ${data.equities.length} equities, ${data.others.length} others)`);
  }

  // ── 1. Import daily cash snapshots ──────────────────────────────────
  console.log("\n── Importing daily cash snapshots ──");

  // Delete any prior TOS cash rows
  const deleted = await db.execute(sql`
    DELETE FROM sentinel_imported_trades
    WHERE user_id = ${USER_ID}
      AND ticker = ${TOS_CASH_TICKER}
  `);
  console.log(`  Cleared ${(deleted as any).rowCount ?? 0} prior TOS cash rows`);

  for (const { fileName, data } of parsed) {
    const accountName = tosSchwabAccountName(data.account.accountName);
    const batchId = uuidv4();

    // Create import batch record
    await db.insert(sentinelImportBatches).values({
      batchId,
      userId: USER_ID,
      brokerId: "SCHWAB",
      fileName,
      importName: `TOS Cash: ${accountName}`,
      fileType: "CSV",
      totalTradesFound: data.dailyCash.length,
      totalTradesImported: data.dailyCash.length,
      status: "COMPLETE",
    });

    // Insert daily cash rows (batch of 200)
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
      cashBalance: entry.cash,
      tradeDate: entry.date,
      accountName,
      status: "CONFIRMED",
    }));

    const CHUNK = 200;
    for (let i = 0; i < rows.length; i += CHUNK) {
      await db.insert(sentinelImportedTrades).values(rows.slice(i, i + CHUNK));
    }
    console.log(`  ${accountName}: inserted ${rows.length} daily cash entries`);
  }

  // ── 2. Upsert mutual fund positions ─────────────────────────────────
  console.log("\n── Importing mutual fund positions ──");

  for (const { data } of parsed) {
    const accountName = tosSchwabAccountName(data.account.accountName);

    for (const fund of data.others) {
      await upsertMutualFundPosition(db, accountName, fund, data.account.endDate);
    }
  }

  // ── 3. Reconciliation ──────────────────────────────────────────────
  console.log("\n── Reconciliation ──");

  for (const { data } of parsed) {
    const accountName = tosSchwabAccountName(data.account.accountName);
    console.log(`\n  ${accountName}:`);

    // Cash check
    const latestCash = data.dailyCash[data.dailyCash.length - 1];
    if (latestCash && data.totalCash != null) {
      console.log(`    TOS latest cash (${latestCash.date}): $${latestCash.cash.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
      console.log(`    TOS total cash today:              $${data.totalCash.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
    }

    // Equities reconciliation
    const dbPositions = await db.execute(sql`
      SELECT symbol, position_size::numeric as qty, entry_price::numeric as price, status
      FROM sentinel_trades
      WHERE user_id = ${USER_ID}
        AND account_name = ${accountName}
        AND status = 'active'
    `);

    const dbMap = new Map<string, { qty: number; price: number }>();
    for (const row of dbPositions.rows as any[]) {
      dbMap.set(row.symbol, { qty: Number(row.qty), price: Number(row.price) });
    }

    const tosEquities = new Map<string, TosPosition>();
    for (const eq of data.equities) tosEquities.set(eq.symbol, eq);
    const tosOthers = new Map<string, TosPosition>();
    for (const o of data.others) tosOthers.set(o.symbol, o);

    const allSymbols = new Set([...dbMap.keys(), ...tosEquities.keys(), ...tosOthers.keys()]);
    let matched = 0;
    let missingInDb = 0;
    let extraInDb = 0;
    let qtyMismatch = 0;

    for (const symbol of [...allSymbols].sort()) {
      const dbPos = dbMap.get(symbol);
      const tosEq = tosEquities.get(symbol);
      const tosOth = tosOthers.get(symbol);
      const tosPos = tosEq ?? tosOth;

      if (tosPos && !dbPos) {
        const section = tosEq ? "equity" : "mutual fund";
        console.log(`    MISSING in DB: ${symbol} (${section}) — TOS: ${tosPos.qty} shares, $${tosPos.markValue.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
        missingInDb++;
      } else if (dbPos && !tosPos) {
        console.log(`    EXTRA in DB:   ${symbol} — DB: ${dbPos.qty} shares @ $${dbPos.price.toFixed(2)}`);
        extraInDb++;
      } else if (dbPos && tosPos) {
        if (Math.abs(dbPos.qty - tosPos.qty) > 0.01) {
          console.log(`    QTY MISMATCH:  ${symbol} — DB: ${dbPos.qty}, TOS: ${tosPos.qty}`);
          qtyMismatch++;
        } else {
          matched++;
        }
      }
    }

    console.log(`    Summary: ${matched} matched, ${missingInDb} missing in DB, ${extraInDb} extra in DB, ${qtyMismatch} qty mismatches`);
  }

  // ── 4. Remove old Schwab anchor/events ──────────────────────────────
  console.log("\n── Cleanup: removing old manual Schwab anchor/events ──");
  const anchorDel = await db.execute(sql`
    DELETE FROM sentinel_journal_cash_anchor
    WHERE user_id = ${USER_ID} AND broker_id = 'SCHWAB'
  `);
  console.log(`  Deleted ${(anchorDel as any).rowCount ?? 0} Schwab anchors`);
  const eventDel = await db.execute(sql`
    DELETE FROM sentinel_journal_cash_events
    WHERE user_id = ${USER_ID} AND broker_id = 'SCHWAB'
  `);
  console.log(`  Deleted ${(eventDel as any).rowCount ?? 0} Schwab events`);

  console.log("\nDone!");
  process.exit(0);
}

async function upsertMutualFundPosition(
  db: ReturnType<typeof getDb>,
  accountName: string,
  fund: TosPosition,
  asOfDate: string
) {
  // Check if position already exists
  const existing = await db.execute(sql`
    SELECT id, position_size::numeric as qty
    FROM sentinel_trades
    WHERE user_id = ${USER_ID}
      AND account_name = ${accountName}
      AND symbol = ${fund.symbol}
      AND status = 'active'
    LIMIT 1
  `);

  const entryDate = new Date(`${asOfDate}T12:00:00Z`);

  if (existing.rows.length > 0) {
    const row = existing.rows[0] as any;
    if (Math.abs(Number(row.qty) - fund.qty) > 0.001) {
      await db.execute(sql`
        UPDATE sentinel_trades
        SET position_size = ${fund.qty},
            entry_price = ${fund.tradePrice},
            updated_at = now()
        WHERE id = ${row.id}
      `);
      console.log(`  Updated: ${fund.symbol} in ${accountName} (${fund.qty} shares @ $${fund.tradePrice.toFixed(2)})`);
    } else {
      console.log(`  Unchanged: ${fund.symbol} in ${accountName}`);
    }
  } else {
    await db.insert(sentinelTrades).values({
      userId: USER_ID,
      symbol: fund.symbol,
      direction: "long",
      entryPrice: fund.tradePrice,
      entryDate,
      positionSize: fund.qty,
      status: "active",
      source: "import",
      accountName,
      notes: `Mutual fund imported from TOS Account Statement. Mark: $${fund.mark.toFixed(2)}, Value: $${fund.markValue.toFixed(2)}`,
    });
    console.log(`  Inserted: ${fund.symbol} in ${accountName} (${fund.qty} shares @ $${fund.tradePrice.toFixed(2)}, value $${fund.markValue.toFixed(2)})`);
  }
}

main();
