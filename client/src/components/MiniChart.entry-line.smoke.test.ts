/**
 * Source-level guard to prevent entry-line regressions across MiniChart branches.
 * Run with: tsx client/src/components/MiniChart.entry-line.smoke.test.ts
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function run(): void {
  const srcPath = resolve(process.cwd(), "client/src/components/MiniChart.tsx");
  const src = readFileSync(srcPath, "utf8");

  // We expect entry-line overlays in all MiniChart render paths.
  const overlayMatches = src.match(/data-testid=\{`mini-chart-entry-line-\$\{symbol\}`\}/g) ?? [];
  assert(
    overlayMatches.length >= 3,
    `Expected >=3 entry-line overlays, found ${overlayMatches.length}`
  );

  // v2.13 folded the intraday Start Here branch into the memoized legacyIntradayBundle,
  // and the daily branch gained a "&& !useMiniMaProfile" guard (the MA-profile path has its own overlay).
  assert(
    src.includes("if (legacyIntradayBundle) {"),
    "Expected intraday Start Here branch to exist"
  );
  assert(
    src.includes("if (movingAverages2150200 && startHereInterval === '1d'"),
    "Expected daily Start Here branch to exist"
  );
  assert(src.includes("<ReferenceLine"), "Expected ReferenceLine usage for entry marker");

  console.log("✅ MiniChart entry-line guard checks passed");
}

run();

