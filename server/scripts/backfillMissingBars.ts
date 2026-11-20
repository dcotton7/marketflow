#!/usr/bin/env tsx
/**
 * Backfill daily bars for universe names that have none or stopped (about 420 on 20 Nov 2026).
 *
 *   npx tsx server/scripts/backfillMissingBars.ts --dry-run          # counts only: no vendor call, no write
 *   npx tsx server/scripts/backfillMissingBars.ts                    # the real run
 *   npx tsx server/scripts/backfillMissingBars.ts --symbols=AAA,BBB  # just these names
 *
 * Options: --from=2024-06-01  --pace-ms=400 (pause between vendor requests)  --limit=N (first N targets)  --no-ma
 * (DRY_RUN=1 works as --dry-run.) Inserts only, never changes or deletes a bar; safe to run again. Rules and the
 * universe definition: server/data-layer/bar-backfill.ts and bar-universe.ts.
 *
 * Prints one JSON report at the end: the plan, bars inserted, and every ticker the vendor could not serve.
 */
import "dotenv/config";
import { initializeDatabase } from "../db";
import { historicalBars } from "@shared/schema";
import { fetchAlpacaIntradayBars } from "../alpaca";
import { getAllUniverseTickers } from "../market-condition/universe";
import { loadBarUniverse, loadThemeUniverse } from "../data-layer/bar-universe";
import { backfillSymbol, loadBarStats, planBackfill, type SymbolResult } from "../data-layer/bar-backfill";
import { recalculateTickerMAs } from "../data-layer/daily-bar-refresh";

function arg(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const dryRun = flag("dry-run") || process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";
  const from = arg("from") ?? "2024-06-01";
  const paceMs = Math.max(250, parseInt(arg("pace-ms") ?? "400", 10) || 400);
  const limit = arg("limit") ? parseInt(arg("limit")!, 10) : undefined;
  const only = arg("symbols")?.split(",").map((s) => s.trim()).filter(Boolean);

  const db: any = await initializeDatabase();
  if (!db) {
    console.error("Database not available");
    process.exit(1);
  }

  // The universe is the theme universe plus the active scan pool (empty until the pool's first refresh);
  // --theme-only leaves the pool out, for a staged run.
  const themeOnly = flag("theme-only");
  const themeUniverse = await loadThemeUniverse(db, getAllUniverseTickers());
  const universe = await loadBarUniverse(db, getAllUniverseTickers(), { includePool: !themeOnly });
  const stats = await loadBarStats(db);
  const plan = planBackfill(universe, stats, { from, only });
  const targets = limit ? plan.targets.slice(0, limit) : plan.targets;

  const summary = {
    mode: dryRun ? "DRY RUN (nothing fetched, nothing written)" : "LIVE",
    universe: plan.universe,
    ofWhichScanPoolOnly: plan.universe - themeUniverse.length,
    latestStoredSession: plan.latestSession,
    withBarOnLatestSession: plan.withLatest,
    targets: targets.length,
    noBarsAtAll: plan.noBarsAtAll.length,
    stoppedEarlier: plan.stopped.length,
    historyFrom: plan.from,
    vendorRequestsNeeded: targets.length,
    estimatedMinutes: Math.ceil((targets.length * (paceMs + 600)) / 60000),
  };
  console.log(JSON.stringify(summary, null, 1));
  if (dryRun) {
    console.log("targets:", targets.join(","));
    process.exit(0);
  }

  const fromDate = new Date(`${from}T00:00:00Z`);
  const toDate = new Date();
  const insertChunk = async (rows: any[]) => {
    const res = await db.insert(historicalBars).values(rows).onConflictDoNothing().returning({ id: historicalBars.id });
    return res.length;
  };
  const fetchBars = async (symbol: string, f: Date, t: Date) => fetchAlpacaIntradayBars(symbol, f, t, "1Day", true);

  // The vendor call logs several lines per request; silence them for a 400-name run.
  const origLog = console.log;
  const results: SymbolResult[] = [];
  let n = 0;
  for (const sym of targets) {
    console.log = () => {};
    let r: SymbolResult;
    try {
      r = await backfillSymbol(sym, fromDate, toDate, fetchBars, insertChunk);
    } finally {
      console.log = origLog;
    }
    results.push(r);
    n++;
    if (n % 25 === 0) {
      console.log(
        `[backfill] ${n}/${targets.length}  inserted so far ${results.reduce((a, x) => a + x.inserted, 0)}  heap ${Math.round(process.memoryUsage().heapUsed / 1048576)}MB`
      );
    }
    await new Promise((res) => setTimeout(res, paceMs));
  }

  const served = results.filter((r) => !r.unserved);
  if (!flag("no-ma") && served.some((r) => r.inserted > 0)) {
    await recalculateTickerMAs(db, served.filter((r) => r.inserted > 0).map((r) => r.symbol));
  }

  const statsAfter = await loadBarStats(db);
  const universeWithLatest = universe.filter((u) => (statsAfter.get(u)?.max ?? "") >= plan.latestSession).length;
  const report = {
    ...summary,
    barsInserted: results.reduce((a, r) => a + r.inserted, 0),
    tickersServed: served.length,
    tickersNotServed: results.filter((r) => r.unserved).map((r) => ({ symbol: r.symbol, reason: r.unserved })),
    universeTickersWithBarOnLatestSession_afterRun: universeWithLatest,
  };
  console.log(JSON.stringify(report, null, 1));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
