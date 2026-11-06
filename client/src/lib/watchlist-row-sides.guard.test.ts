/**
 * Source guard: every watchlist view that builds its own rows for WatchlistConfigurableTable signs % Entry / % Stop
 * by side and carries Side + P/L. Before, the manager modal, the Start Here portal and InfoPop computed unsigned
 * percents and no side, so a short showed red when winning, its Side cell read "Long" and the toggle never set Long.
 * Run with: npx tsx client/src/lib/watchlist-row-sides.guard.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const views = [
  "client/src/components/WatchlistModal.tsx",
  "client/src/components/start-here/WatchlistPortalWidget.tsx",
  "client/src/pages/InfoPopPage.tsx",
  "client/src/pages/EmbedWatchlistFullPage.tsx",
];
for (const v of views) {
  const src = readFileSync(resolve(process.cwd(), v), "utf8");
  assert.ok(src.includes("entryStopPct({ direction: item.direction"), `${v}: % Entry / % Stop signed by side`);
  assert.ok(src.includes("...positionPl({ direction: item.direction"), `${v}: rows carry side and P/L`);
  assert.ok(!/\(\(price - entry\) \/ entry\) \* 100/.test(src), `${v}: no unsigned % Entry`);
}
console.log("✅ watchlist row sides guard passed");
