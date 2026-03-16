/**
 * Refresh Universe Constituents (Monthly)
 *
 * Downloads S&P 500, Russell 2000, Russell 3000 from GitHub and saves to data/constituents/.
 * Run monthly (e.g. 1st of month) via cron or scheduler.
 *
 * Run with: npx tsx server/scripts/refreshUniverseConstituents.ts
 */

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import {
  DATA_DIR,
  GITHUB_URLS,
  LOCAL_FILES,
  type UniverseId,
} from "../universe/constituents";

async function fetchAndSave(universe: UniverseId): Promise<number> {
  const url = GITHUB_URLS[universe];
  const filePath = LOCAL_FILES[universe];

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${url}`);
  }
  const text = await res.text();

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, "utf-8");

  const lines = text.trim().split(/\r?\n/);
  return Math.max(0, lines.length - 1);
}

async function main() {
  console.log("=".repeat(60));
  console.log("REFRESH UNIVERSE CONSTITUENTS");
  console.log("=".repeat(60));
  console.log(`Data dir: ${DATA_DIR}`);
  console.log("");

  const universes: UniverseId[] = ["sp500", "russell2000", "russell3000"];

  for (const universe of universes) {
    try {
      const count = await fetchAndSave(universe);
      console.log(`  ${universe}: ${count} tickers saved`);
    } catch (err: any) {
      console.error(`  ${universe}: ERROR - ${err.message}`);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("REFRESH COMPLETE");
  console.log("=".repeat(60));
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
