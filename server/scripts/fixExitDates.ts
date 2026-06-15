/**
 * Fix exit_date on reconciled trades that were incorrectly set to "today"
 * by the sync script. Uses TOS CSV transaction history to find actual sell dates.
 */
import "dotenv/config";
import { getDb, initializeDatabase } from "../db";
import { sql } from "drizzle-orm";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === "," && !inQuotes) { result.push(current.trim()); current = ""; }
    else current += ch;
  }
  result.push(current.trim());
  return result;
}

interface SellInfo {
  symbol: string;
  lastSellDate: string;
  totalQtySold: number;
}

function findLastSellDates(filePath: string): Map<string, SellInfo> {
  const lines = readFileSync(filePath, "utf-8").split("\n");
  const sells = new Map<string, SellInfo>();

  for (const line of lines) {
    const parts = parseCSVLine(line);
    if (parts[2] !== "TRD") continue;
    const desc = parts[4] ?? "";
    const sellMatch = desc.match(/SOLD\s+-([\d,.]+)\s+(\S+)\s+@/);
    if (!sellMatch) continue;

    const qty = Number(sellMatch[1]!.replace(/,/g, ""));
    const symbol = sellMatch[2]!;
    const dateStr = parts[0]!; // e.g. "5/28/26"

    // Convert to ISO-ish: M/D/YY → 20YY-MM-DD
    const [m, d, y] = dateStr.split("/");
    const isoDate = `20${y}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`;

    const existing = sells.get(symbol);
    if (!existing || isoDate > existing.lastSellDate) {
      sells.set(symbol, { symbol, lastSellDate: isoDate, totalQtySold: (existing?.totalQtySold ?? 0) + qty });
    } else {
      existing.totalQtySold += qty;
    }
  }
  return sells;
}

async function main() {
  await initializeDatabase();
  const db = getDb();

  const TOS_FILES = [
    join(__dirname, "../../data/tos-imports/RollOver_TOS_2026-06-08-AccountStatement.csv"),
    join(__dirname, "../../data/tos-imports/RollOver_TOS__2026-06-08-AccountStatement.csv"),
  ];

  // Merge sell dates from both CSVs
  const allSells = new Map<string, SellInfo>();
  for (const f of TOS_FILES) {
    const sells = findLastSellDates(f);
    for (const [sym, info] of sells) {
      const existing = allSells.get(sym);
      if (!existing || info.lastSellDate > existing.lastSellDate) {
        allSells.set(sym, info);
      }
    }
  }

  // Find trades with exit_date = today that got P/L from reconciliation
  const today = "2026-06-08";
  const badTrades = await db.execute(sql`
    SELECT id, symbol, exit_date::text, actual_pnl::text, position_size::text, account_name
    FROM sentinel_trades
    WHERE user_id = 2 AND status = 'closed'
    AND account_name ILIKE '%schwab%'
    AND exit_date::date = ${today}::date
    AND actual_pnl IS NOT NULL AND actual_pnl != 0
    ORDER BY ABS(actual_pnl) DESC
  `);

  console.log(`Trades with exit_date = ${today} and non-zero P/L: ${badTrades.rows.length}\n`);

  let fixCount = 0;
  for (const r of badTrades.rows as any[]) {
    const sym = r.symbol as string;
    const sellInfo = allSells.get(sym);

    if (!sellInfo) {
      console.log(`  ${sym} (id=${r.id}): no TOS sell found → skip`);
      continue;
    }

    if (sellInfo.lastSellDate === today) {
      console.log(`  ${sym} (id=${r.id}): last TOS sell IS today → keep`);
      continue;
    }

    const newDate = sellInfo.lastSellDate;
    console.log(`  ${sym} (id=${r.id}): P/L=${r.actual_pnl} exit ${today} → ${newDate}`);

    await db.execute(sql`
      UPDATE sentinel_trades
      SET exit_date = ${newDate}::date
      WHERE id = ${r.id}
    `);
    fixCount++;
  }

  console.log(`\nFixed ${fixCount} exit dates.`);

  // Verify no more huge P/L on today
  const todayPnl = await db.execute(sql`
    SELECT SUM(actual_pnl)::text as total, COUNT(*)::text as cnt
    FROM sentinel_trades
    WHERE user_id = 2 AND status = 'closed'
    AND account_name ILIKE '%schwab%'
    AND exit_date::date = ${today}::date
  `);
  console.log(`\nToday's realized after fix: $${Number((todayPnl.rows[0] as any).total ?? 0).toFixed(2)} from ${(todayPnl.rows[0] as any).cnt} trades`);

  process.exit(0);
}
main();
