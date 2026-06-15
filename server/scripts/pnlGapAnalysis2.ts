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
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function parseDollar(s: string): number {
  if (!s) return 0;
  const neg = s.includes("(");
  const cleaned = s.replace(/[\$,()]/g, "");
  const val = Number(cleaned);
  return isNaN(val) ? 0 : neg ? -val : val;
}

async function main() {
  await initializeDatabase();
  const db = getDb();

  const files = [
    { name: "Rollover IRA", path: join(__dirname, "../../data/tos-imports/RollOver_TOS_2026-06-08-AccountStatement.csv") },
    { name: "Designated Bene", path: join(__dirname, "../../data/tos-imports/RollOver_TOS__2026-06-08-AccountStatement.csv") },
  ];

  let tosTotalPnlYtd = 0;
  const tosBySymbol: Record<string, number> = {};

  for (const f of files) {
    const lines = readFileSync(f.path, "utf-8").split("\n");
    let inPnl = false;
    let headerSeen = false;

    for (const line of lines) {
      if (line.startsWith("Profits and Losses")) {
        inPnl = true;
        headerSeen = false;
        continue;
      }
      if (inPnl && line.startsWith("Symbol,Description,P/L Open")) {
        headerSeen = true;
        continue;
      }
      if (inPnl && headerSeen) {
        if (line.trim() === "") break;
        if (line.startsWith("Overall Totals")) {
          const parts = parseCSVLine(line);
          const overallPnlYtd = parseDollar(parts[5] ?? "");
          console.log(`${f.name} Overall P/L YTD: $${overallPnlYtd.toFixed(2)}`);
          tosTotalPnlYtd += overallPnlYtd;
          break;
        }
        const parts = parseCSVLine(line);
        const symbol = parts[0]?.trim();
        if (!symbol) continue;
        const pnlYtd = parseDollar(parts[5] ?? "");
        tosBySymbol[symbol] = (tosBySymbol[symbol] ?? 0) + pnlYtd;
      }
    }
  }

  console.log(`\nCombined TOS P/L YTD: $${tosTotalPnlYtd.toFixed(2)}\n`);

  // Our system totals
  const ourRlzd = await db.execute(sql`
    SELECT symbol, SUM(actual_pnl)::text as pnl
    FROM sentinel_trades WHERE user_id = 2 AND status = 'closed'
    AND account_name ILIKE '%schwab%' AND actual_pnl IS NOT NULL
    GROUP BY symbol
  `);
  const ourBySymbol: Record<string, number> = {};
  for (const r of ourRlzd.rows as any[]) ourBySymbol[r.symbol] = Number(r.pnl);

  const ourUnrlzd = await db.execute(sql`
    SELECT symbol,
           (COALESCE(mark_price, 0) * COALESCE(position_size, 0)
            - entry_price * COALESCE(position_size, 0))::text as unrealized
    FROM sentinel_trades WHERE user_id = 2 AND status = 'active'
    AND account_name ILIKE '%schwab%'
  `);
  const ourUBySymbol: Record<string, number> = {};
  for (const r of ourUnrlzd.rows as any[]) ourUBySymbol[r.symbol] = Number(r.unrealized);

  const nullPnl = await db.execute(sql`
    SELECT symbol, position_size::text, entry_price::text
    FROM sentinel_trades WHERE user_id = 2 AND status = 'closed'
    AND account_name ILIKE '%schwab%' AND actual_pnl IS NULL
  `);
  const nullBySymbol: Record<string, string[]> = {};
  for (const r of nullPnl.rows as any[]) {
    if (!nullBySymbol[r.symbol]) nullBySymbol[r.symbol] = [];
    nullBySymbol[r.symbol].push(`${r.position_size}@$${Number(r.entry_price).toFixed(0)}`);
  }

  // Per-symbol comparison sorted by gap size
  const allSymbols = new Set([...Object.keys(tosBySymbol), ...Object.keys(ourBySymbol), ...Object.keys(ourUBySymbol)]);
  type Row = { sym: string; tos: number; rlzd: number; unrlzd: number; gap: number; nullInfo: string };
  const rows: Row[] = [];
  for (const sym of allSymbols) {
    const tos = tosBySymbol[sym] ?? 0;
    const rlzd = ourBySymbol[sym] ?? 0;
    const unrlzd = ourUBySymbol[sym] ?? 0;
    const gap = tos - rlzd - unrlzd;
    const nullInfo = nullBySymbol[sym]?.join(", ") ?? "";
    rows.push({ sym, tos, rlzd, unrlzd, gap, nullInfo });
  }
  rows.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));

  console.log("=== TOP 25 SYMBOLS BY GAP (TOS P/L YTD vs Our Realized+Unrealized) ===\n");
  console.log("Symbol        | TOS P/L YTD     | Our Rlzd        | Our Unrlzd      | Gap             | Null P/L");
  console.log("-".repeat(110));

  let totTos = 0, totOur = 0;
  for (const r of rows.slice(0, 25)) {
    console.log(
      `${r.sym.padEnd(14)}| ${fmt(r.tos).padEnd(16)}| ${fmt(r.rlzd).padEnd(16)}| ${fmt(r.unrlzd).padEnd(16)}| ${fmt(r.gap).padEnd(16)}| ${r.nullInfo}`
    );
  }
  for (const r of rows) { totTos += r.tos; totOur += r.rlzd + r.unrlzd; }

  console.log("-".repeat(110));
  console.log(
    `${"TOTAL".padEnd(14)}| ${fmt(totTos).padEnd(16)}| ${fmt(Object.values(ourBySymbol).reduce((a,b)=>a+b,0)).padEnd(16)}| ${fmt(Object.values(ourUBySymbol).reduce((a,b)=>a+b,0)).padEnd(16)}| ${fmt(totTos - totOur).padEnd(16)}|`
  );

  // Summary of null-P/L trades
  console.log(`\n=== NULL P/L CLOSED TRADES (missing realized) ===`);
  for (const r of rows) {
    if (r.nullInfo) {
      console.log(`  ${r.sym}: TOS P/L YTD=${fmt(r.tos)}, Our realized=${fmt(r.rlzd)}, NULL lots: ${r.nullInfo}`);
    }
  }

  process.exit(0);
}

function fmt(n: number): string {
  if (n >= 0) return `$${n.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `($${Math.abs(n).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`;
}

main();
