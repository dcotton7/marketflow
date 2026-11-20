#!/usr/bin/env tsx
/**
 * Refresh market caps and size buckets for every ticker in the tickers table.
 *
 *   DRY_RUN=1 npx tsx server/scripts/refreshMarketCaps.ts   # the plan and counts, nothing written
 *   npx tsx server/scripts/refreshMarketCaps.ts             # appends market_cap_history, updates tickers
 *
 * The same logic runs in the app as POST /api/market-condition/setups/market-caps/refresh?dryRun=1 (admin), which
 * is the way to run it on Render. Rules, boundaries and sources: server/market-condition/utils/market-cap-refresh.ts.
 */
import "dotenv/config";
import { initializeDatabase } from "../db";
import { refreshMarketCaps } from "../market-condition/utils/market-cap-refresh";

const DRY_RUN = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";

async function main() {
  const db = await initializeDatabase();
  if (!db) {
    console.error("Database not available");
    process.exit(1);
  }
  const r = await refreshMarketCaps(db, { dryRun: DRY_RUN });
  console.log(JSON.stringify(r, null, 1));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
