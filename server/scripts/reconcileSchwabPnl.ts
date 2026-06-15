/**
 * Reconcile Schwab realized P/L: compare TOS Account Statement with DB,
 * identify gaps, and optionally apply fixes.
 *
 * Usage:
 *   npx tsx server/scripts/reconcileSchwabPnl.ts          # dry run
 *   npx tsx server/scripts/reconcileSchwabPnl.ts --apply   # apply fixes
 */
import "dotenv/config";
import { getDb, initializeDatabase } from "../db";
import { sql } from "drizzle-orm";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  parseTosAccountStatement,
  combineSchwabAccounts,
  type TosSymbolPnl,
} from "../sentinel/tos-realized-pnl";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TOS_FILES = [
  join(__dirname, "../../data/tos-imports/RollOver_TOS_2026-06-08-AccountStatement.csv"),
  join(__dirname, "../../data/tos-imports/RollOver_TOS__2026-06-08-AccountStatement.csv"),
];

const APPLY = process.argv.includes("--apply");

function fmt(n: number): string {
  if (n >= 0) return `$${n.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `($${Math.abs(n).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`;
}

async function main() {
  await initializeDatabase();
  const db = getDb();

  console.log(APPLY ? "=== APPLYING FIXES ===" : "=== DRY RUN (add --apply to commit) ===");
  console.log();

  // 1. Parse TOS CSVs
  const accounts = TOS_FILES.map((f) => parseTosAccountStatement(f));
  for (const a of accounts) {
    console.log(`Parsed: ${a.accountName} (${a.accountId})`);
    console.log(`  Symbols: ${a.bySymbol.size}, RAD entries: ${a.radEntries.length}`);
    console.log(`  Overall P/L YTD: ${fmt(a.overallPnlYtd)}, Net Liq: ${fmt(a.netLiquidatingValue)}`);
  }

  const combined = combineSchwabAccounts(accounts);
  console.log(`\nCombined true realized: ${fmt(combined.totalTrueRealized)}`);
  console.log(`Combined P/L Open: ${fmt(combined.totalPnlOpen)}`);
  console.log(`Combined true P/L YTD: ${fmt(combined.totalTruePnlYtd)}`);

  // 2. Get DB realized per symbol
  const dbRlzd = await db.execute(sql`
    SELECT symbol, SUM(actual_pnl)::text as pnl, COUNT(*)::text as cnt
    FROM sentinel_trades
    WHERE user_id = 2 AND status = 'closed'
    AND account_name ILIKE '%schwab%'
    AND actual_pnl IS NOT NULL
    GROUP BY symbol
  `);
  const dbBySymbol = new Map<string, { realized: number; count: number }>();
  for (const r of dbRlzd.rows as any[]) {
    dbBySymbol.set(r.symbol, { realized: Number(r.pnl), count: Number(r.cnt) });
  }

  // 3. Get NULL P/L trades
  const nullTrades = await db.execute(sql`
    SELECT id, symbol, position_size::text, entry_price::text, account_name
    FROM sentinel_trades
    WHERE user_id = 2 AND status = 'closed'
    AND account_name ILIKE '%schwab%'
    AND actual_pnl IS NULL
  `);
  const nullBySymbol = new Map<string, { id: number; symbol: string; size: number; entry: number; account: string }[]>();
  for (const r of nullTrades.rows as any[]) {
    const sym = r.symbol as string;
    if (!nullBySymbol.has(sym)) nullBySymbol.set(sym, []);
    nullBySymbol.get(sym)!.push({
      id: r.id,
      symbol: sym,
      size: Number(r.position_size),
      entry: Number(r.entry_price),
      account: r.account_name,
    });
  }

  // 4. Compare and generate fixes
  const allSymbols = new Set([...combined.bySymbol.keys(), ...dbBySymbol.keys()]);
  
  type Fix = {
    symbol: string;
    tosRealized: number;
    dbRealized: number;
    gap: number;
    action: string;
    tradeId?: number;
    newPnl?: number;
  };
  const fixes: Fix[] = [];
  let totalGap = 0;

  console.log("\n=== PER-SYMBOL RECONCILIATION ===\n");
  console.log("Symbol        | TOS Realized    | DB Realized     | Gap             | Action");
  console.log("-".repeat(100));

  const sorted = [...allSymbols].sort((a, b) => {
    const gapA = Math.abs((combined.bySymbol.get(a)?.trueRealized ?? 0) - (dbBySymbol.get(a)?.realized ?? 0));
    const gapB = Math.abs((combined.bySymbol.get(b)?.trueRealized ?? 0) - (dbBySymbol.get(b)?.realized ?? 0));
    return gapB - gapA;
  });

  for (const sym of sorted) {
    const tos = combined.bySymbol.get(sym)?.trueRealized ?? 0;
    const dbInfo = dbBySymbol.get(sym);
    const dbRlzdVal = dbInfo?.realized ?? 0;
    const gap = tos - dbRlzdVal;
    totalGap += gap;

    if (Math.abs(gap) < 1) continue; // skip negligible

    const nullList = nullBySymbol.get(sym) ?? [];
    let action = "";

    if (nullList.length > 0) {
      // We have null-P/L trades we can update
      const pnlPerTrade = gap / nullList.length;
      for (const t of nullList) {
        fixes.push({
          symbol: sym,
          tosRealized: tos,
          dbRealized: dbRlzdVal,
          gap,
          action: `UPDATE trade ${t.id} (${t.size} shares) actual_pnl = ${fmt(pnlPerTrade)}`,
          tradeId: t.id,
          newPnl: pnlPerTrade,
        });
      }
      action = `fix ${nullList.length} null-P/L trade(s)`;
    } else if (dbInfo && dbInfo.count > 0) {
      // Trades exist but P/L is wrong — add adjustment to the last trade
      const lastTrade = await db.execute(sql`
        SELECT id, actual_pnl::text FROM sentinel_trades
        WHERE user_id = 2 AND status = 'closed' AND symbol = ${sym}
        AND account_name ILIKE '%schwab%' AND actual_pnl IS NOT NULL
        ORDER BY exit_date DESC LIMIT 1
      `);
      if (lastTrade.rows.length > 0) {
        const t = lastTrade.rows[0] as any;
        const currentPnl = Number(t.actual_pnl);
        const newPnl = currentPnl + gap;
        fixes.push({
          symbol: sym,
          tosRealized: tos,
          dbRealized: dbRlzdVal,
          gap,
          action: `ADJUST trade ${t.id} actual_pnl ${fmt(currentPnl)} → ${fmt(newPnl)}`,
          tradeId: t.id,
          newPnl,
        });
        action = `adjust last trade P/L`;
      }
    } else {
      // No trades at all — need to insert a synthetic reconciliation trade
      // But SKIP if position is still held (P/L Open ≠ 0); the negative
      // "realized" is a spurious artifact from P/L YTD vs P/L Open baseline
      // differences for pre-existing positions (especially mutual funds).
      const tosPnlOpen = combined.bySymbol.get(sym)?.pnlOpen ?? 0;
      if (Math.abs(tosPnlOpen) > 1) {
        action = `SKIP (still held, P/L Open=${fmt(tosPnlOpen)})`;
      } else {
        action = `INSERT reconciliation trade`;
        fixes.push({
          symbol: sym,
          tosRealized: tos,
          dbRealized: 0,
          gap,
          action: `INSERT reconciliation trade for ${sym} with P/L ${fmt(gap)}`,
        });
      }
    }

    console.log(
      `${sym.padEnd(14)}| ${fmt(tos).padEnd(16)}| ${fmt(dbRlzdVal).padEnd(16)}| ${fmt(gap).padEnd(16)}| ${action}`
    );
  }

  console.log("-".repeat(100));
  console.log(`${"TOTAL GAP".padEnd(14)}| ${" ".padEnd(16)}| ${" ".padEnd(16)}| ${fmt(totalGap).padEnd(16)}|`);

  // 5. Apply fixes
  console.log(`\n=== ${fixes.length} FIXES TO APPLY ===\n`);

  if (!APPLY) {
    for (const f of fixes.slice(0, 20)) {
      console.log(`  ${f.action}`);
    }
    if (fixes.length > 20) console.log(`  ... and ${fixes.length - 20} more`);
    console.log("\nRun with --apply to execute these fixes.");
    process.exit(0);
    return;
  }

  let updated = 0;
  let inserted = 0;

  for (const f of fixes) {
    if (f.tradeId != null && f.newPnl != null) {
      await db.execute(sql`
        UPDATE sentinel_trades
        SET actual_pnl = ${f.newPnl}
        WHERE id = ${f.tradeId}
      `);
      updated++;
      console.log(`  ✓ ${f.action}`);
    } else if (!f.tradeId) {
      // Insert synthetic reconciliation trade
      await db.execute(sql`
        INSERT INTO sentinel_trades (
          user_id, symbol, direction, entry_price, entry_date, exit_price,
          exit_date, position_size, actual_pnl, status, outcome,
          account_name, thesis
        ) VALUES (
          2, ${f.symbol}, 'long', 0, NOW(), 0, NOW(), 0, ${f.gap},
          'closed', ${f.gap >= 0 ? "win" : "loss"},
          'Schwab Rollover IRA', 'TOS reconciliation adjustment'
        )
      `);
      inserted++;
      console.log(`  ✓ ${f.action}`);
    }
  }

  console.log(`\nDone. Updated: ${updated}, Inserted: ${inserted}`);

  // 6. Verify
  const newTotal = await db.execute(sql`
    SELECT SUM(actual_pnl)::text as total
    FROM sentinel_trades
    WHERE user_id = 2 AND status = 'closed'
    AND account_name ILIKE '%schwab%'
  `);
  console.log(`\nNew total Schwab realized: ${fmt(Number((newTotal.rows[0] as any).total))}`);
  console.log(`TOS true realized:         ${fmt(combined.totalTrueRealized)}`);

  process.exit(0);
}

main();
