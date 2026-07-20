/**
 * Backfill historical_bars for symbols session-MA logic currently skips
 * (no_bars / too_few / stale / large_gap), then re-classify.
 *
 * Run: npx tsx server/scripts/backfillMaCoverageGaps.ts
 * Opt: --days=300 --dry-run
 */
import "dotenv/config";
import { and, desc, gte, inArray } from "drizzle-orm";
import { initializeDatabase, getDb } from "../db";
import { historicalBars } from "@shared/schema";
import { getAllUniverseTickers, CLUSTER_IDS } from "../market-condition/universe";
import { getAllThemeTickerSymbols } from "../market-condition/utils/theme-db-loader";
import { MIN_BARS_FOR_SESSION_MA } from "../shared/daily-ma-from-bars";
import { fetchAlpacaIntradayBars } from "../alpaca";
import { sql } from "drizzle-orm";

const MAX_STALE_DAYS = 5;
const LOOKBACK_DAYS_FOR_CLASSIFY = 250;
const BATCH_SIZE = 8;

type Reason = "no_bars" | "too_few_bars" | "stale" | "large_gap" | "ok" | "thin_for_sma200";

function parseDays(): number {
  const arg = process.argv.find((a) => a.startsWith("--days="));
  return arg ? parseInt(arg.split("=")[1]!, 10) || 300 : 300;
}

function isDryRun(): boolean {
  return process.argv.includes("--dry-run");
}

async function classify(universe: string[]) {
  const db = getDb()!;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - LOOKBACK_DAYS_FOR_CLASSIFY - 10);
  const cutoffStr = cutoff.toISOString().split("T")[0]!;

  const byReason: Record<Reason, string[]> = {
    no_bars: [],
    too_few_bars: [],
    stale: [],
    large_gap: [],
    ok: [],
    thin_for_sma200: [],
  };
  const barCounts = new Map<string, number>();

  const CHUNK = 80;
  for (let i = 0; i < universe.length; i += CHUNK) {
    const chunk = universe.slice(i, i + CHUNK);
    const rows = await db
      .select({ symbol: historicalBars.symbol, barDate: historicalBars.barDate })
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
      barCounts.set(symbol, dates.length);
      if (dates.length === 0) {
        byReason.no_bars.push(symbol);
        continue;
      }
      if (dates.length < MIN_BARS_FOR_SESSION_MA) {
        byReason.too_few_bars.push(symbol);
        continue;
      }
      const lastDate = dates[0]!;
      const ageDays = (Date.now() - new Date(lastDate + "T00:00:00Z").getTime()) / 86_400_000;
      if (ageDays > MAX_STALE_DAYS) {
        byReason.stale.push(symbol);
        continue;
      }
      let hasLargeGap = false;
      const slice = dates.slice(0, LOOKBACK_DAYS_FOR_CLASSIFY + 5);
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
        continue;
      }
      byReason.ok.push(symbol);
      if (dates.length < 200) byReason.thin_for_sma200.push(symbol);
    }
  }

  return { byReason, barCounts };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function backfillSymbols(symbols: string[], days: number) {
  const db = getDb()!;
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days - 10);

  let upserted = 0;
  const failed: string[] = [];

  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const batch = symbols.slice(i, i + BATCH_SIZE);
    console.log(`Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(symbols.length / BATCH_SIZE)}: ${batch.join(", ")}`);

    const results = await Promise.allSettled(
      batch.map(async (symbol) => {
        const bars = await fetchAlpacaIntradayBars(symbol, startDate, endDate, "1Day", true);
        return { symbol, bars };
      })
    );

    for (const r of results) {
      if (r.status !== "fulfilled") {
        failed.push("unknown");
        continue;
      }
      const { symbol, bars } = r.value;
      if (!bars.length) {
        console.log(`  ${symbol}: no Alpaca data`);
        failed.push(symbol);
        continue;
      }
      const values = bars.map((bar) => ({
        symbol: symbol.toUpperCase(),
        barDate: new Date(bar.date).toISOString().split("T")[0]!,
        open: bar.open.toString(),
        high: bar.high.toString(),
        low: bar.low.toString(),
        close: bar.close.toString(),
        volume: bar.volume,
        vwap: null as string | null,
      }));
      await db
        .insert(historicalBars)
        .values(values)
        .onConflictDoUpdate({
          target: [historicalBars.symbol, historicalBars.barDate],
          set: {
            open: sql`excluded.open`,
            high: sql`excluded.high`,
            low: sql`excluded.low`,
            close: sql`excluded.close`,
            volume: sql`excluded.volume`,
          },
        });
      upserted += bars.length;
      console.log(`  ${symbol}: ${bars.length} bars`);
    }

    if (i + BATCH_SIZE < symbols.length) await sleep(600);
  }

  return { upserted, failed };
}

async function main() {
  const days = parseDays();
  const dry = isDryRun();
  await initializeDatabase();
  if (!getDb()) {
    console.error("No DB");
    process.exit(1);
  }

  const cluster = getAllUniverseTickers();
  let theme: string[] = [];
  try {
    theme = getAllThemeTickerSymbols(CLUSTER_IDS);
  } catch {
    /* ignore */
  }
  const universe = Array.from(new Set([...cluster, ...theme].map((s) => s.toUpperCase()))).sort();

  console.log(`Universe ${universe.length}. Classifying…`);
  const before = await classify(universe);
  const { byReason } = before;
  console.log("BEFORE:");
  console.log(`  ok=${byReason.ok.length} no_bars=${byReason.no_bars.length} too_few=${byReason.too_few_bars.length} stale=${byReason.stale.length} large_gap=${byReason.large_gap.length}`);
  console.log(`  ok but <200 bars (no sma200): ${byReason.thin_for_sma200.length}`);

  const targets = Array.from(
    new Set([
      ...byReason.no_bars,
      ...byReason.too_few_bars,
      ...byReason.stale,
      ...byReason.large_gap,
      ...byReason.thin_for_sma200,
    ])
  ).sort();

  console.log(`\nBackfill targets: ${targets.length} symbols, ${days} days${dry ? " (dry-run)" : ""}`);
  if (dry) {
    console.log(targets.join(", "));
    process.exit(0);
  }

  const { upserted, failed } = await backfillSymbols(targets, days);
  console.log(`\nUpserted ${upserted} bars. Failed: ${failed.length}${failed.length ? ` (${failed.join(", ")})` : ""}`);

  console.log("\nRe-classifying…");
  const after = await classify(universe);
  console.log("AFTER:");
  console.log(
    `  ok=${after.byReason.ok.length} no_bars=${after.byReason.no_bars.length} too_few=${after.byReason.too_few_bars.length} stale=${after.byReason.stale.length} large_gap=${after.byReason.large_gap.length}`
  );
  console.log(`  ok but <200 bars (no sma200): ${after.byReason.thin_for_sma200.length}`);
  console.log(`  session-MA eligible: ${after.byReason.ok.length}/${universe.length}`);
  console.log(`  sma200-ready (ok & ≥200 bars): ${after.byReason.ok.length - after.byReason.thin_for_sma200.length}/${universe.length}`);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
