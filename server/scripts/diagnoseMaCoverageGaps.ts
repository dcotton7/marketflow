/**
 * One-off: classify universe symbols that session-MA logic would skip.
 * Run: npx tsx server/scripts/diagnoseMaCoverageGaps.ts
 */
import "dotenv/config";
import { and, desc, gte, inArray } from "drizzle-orm";
import { initializeDatabase, getDb } from "../db";
import { historicalBars } from "@shared/schema";
import { getAllUniverseTickers, CLUSTER_IDS } from "../market-condition/universe";
import { getAllThemeTickerSymbols } from "../market-condition/utils/theme-db-loader";
import { MIN_BARS_FOR_SESSION_MA } from "../shared/daily-ma-from-bars";

const MAX_STALE_DAYS = 5;
const DAYS = 250;

type Reason =
  | "no_bars"
  | "too_few_bars"
  | "stale"
  | "large_gap"
  | "ok";

async function main() {
  await initializeDatabase();
  const db = getDb();
  if (!db) {
    console.error("No DB");
    process.exit(1);
  }

  const cluster = getAllUniverseTickers();
  let theme: string[] = [];
  try {
    theme = getAllThemeTickerSymbols(CLUSTER_IDS);
  } catch {
    theme = [];
  }
  const universe = Array.from(new Set([...cluster, ...theme].map((s) => s.toUpperCase()))).sort();
  console.log(`Universe: ${universe.length} (cluster=${cluster.length}, themeExtra≈${universe.length - new Set(cluster.map((s) => s.toUpperCase())).size})`);

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - DAYS - 10);
  const cutoffStr = cutoff.toISOString().split("T")[0];

  const byReason: Record<Reason, string[]> = {
    no_bars: [],
    too_few_bars: [],
    stale: [],
    large_gap: [],
    ok: [],
  };
  const detail: Array<{ symbol: string; reason: Reason; barCount: number; lastDate: string | null; ageDays: number | null }> = [];

  const CHUNK = 80;
  for (let i = 0; i < universe.length; i += CHUNK) {
    const chunk = universe.slice(i, i + CHUNK);
    const rows = await db
      .select({
        symbol: historicalBars.symbol,
        barDate: historicalBars.barDate,
      })
      .from(historicalBars)
      .where(and(inArray(historicalBars.symbol, chunk), gte(historicalBars.barDate, cutoffStr)))
      .orderBy(historicalBars.symbol, desc(historicalBars.barDate));

    const barsBySymbol = new Map<string, string[]>();
    for (const r of rows) {
      const list = barsBySymbol.get(r.symbol) ?? [];
      list.push(r.barDate);
      barsBySymbol.set(r.symbol, list);
    }

    for (const symbol of chunk) {
      const dates = barsBySymbol.get(symbol) ?? [];
      if (dates.length === 0) {
        byReason.no_bars.push(symbol);
        detail.push({ symbol, reason: "no_bars", barCount: 0, lastDate: null, ageDays: null });
        continue;
      }
      if (dates.length < MIN_BARS_FOR_SESSION_MA) {
        byReason.too_few_bars.push(symbol);
        const lastDate = dates[0]!;
        const ageDays = (Date.now() - new Date(lastDate + "T00:00:00Z").getTime()) / 86_400_000;
        detail.push({ symbol, reason: "too_few_bars", barCount: dates.length, lastDate, ageDays: Math.round(ageDays * 10) / 10 });
        continue;
      }

      const lastDate = dates[0]!;
      const ageDays = (Date.now() - new Date(lastDate + "T00:00:00Z").getTime()) / 86_400_000;
      if (ageDays > MAX_STALE_DAYS) {
        byReason.stale.push(symbol);
        detail.push({ symbol, reason: "stale", barCount: dates.length, lastDate, ageDays: Math.round(ageDays * 10) / 10 });
        continue;
      }

      const slice = dates.slice(0, DAYS + 5);
      let hasLargeGap = false;
      for (let j = 0; j < slice.length - 1; j++) {
        const d1 = new Date(slice[j]! + "T00:00:00Z").getTime();
        const d2 = new Date(slice[j + 1]! + "T00:00:00Z").getTime();
        if (d1 - d2 > 7 * 86_400_000) {
          hasLargeGap = true;
          break;
        }
      }
      if (hasLargeGap) {
        byReason.large_gap.push(symbol);
        detail.push({ symbol, reason: "large_gap", barCount: dates.length, lastDate, ageDays: Math.round(ageDays * 10) / 10 });
        continue;
      }

      byReason.ok.push(symbol);
      detail.push({ symbol, reason: "ok", barCount: dates.length, lastDate, ageDays: Math.round(ageDays * 10) / 10 });
    }
  }

  const missing = detail.filter((d) => d.reason !== "ok");
  console.log("\n=== Summary ===");
  console.log(`ok:           ${byReason.ok.length}`);
  console.log(`no_bars:      ${byReason.no_bars.length}`);
  console.log(`too_few_bars: ${byReason.too_few_bars.length} (<${MIN_BARS_FOR_SESSION_MA})`);
  console.log(`stale:        ${byReason.stale.length} (>${MAX_STALE_DAYS}d)`);
  console.log(`large_gap:    ${byReason.large_gap.length}`);
  console.log(`MISSING:      ${missing.length} / ${universe.length}`);

  console.log("\n=== Missing tickers by reason ===");
  for (const reason of ["no_bars", "too_few_bars", "stale", "large_gap"] as Reason[]) {
    const list = detail.filter((d) => d.reason === reason);
    if (!list.length) continue;
    console.log(`\n--- ${reason} (${list.length}) ---`);
    for (const d of list) {
      console.log(
        `${d.symbol.padEnd(8)} bars=${String(d.barCount).padStart(3)} last=${d.lastDate ?? "—"} age=${d.ageDays ?? "—"}d`
      );
    }
  }

}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
