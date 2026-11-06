/**
 * Source guard: the inline Entry/Stop/Shares editor's ✓ and X buttons must not let the input's blur (which saves) run
 * first. Without it, X saved what was typed (clearing the field and pressing X deleted the stop).
 * Run with: npx tsx client/src/components/WatchlistInlinePriceCell.guard.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(process.cwd(), "client/src/components/WatchlistInlinePriceCell.tsx"), "utf8");
for (const id of ["save", "cancel"]) {
  const at = src.indexOf("data-testid={`${testId}-" + id + "`}");
  assert.ok(at > 0, `${id} button exists`);
  const open = src.lastIndexOf("<button", at);
  assert.ok(/onMouseDown=\{\(e\) => e\.preventDefault\(\)\}/.test(src.slice(open, at)), `${id} button keeps focus on mousedown`);
}
console.log("✅ WatchlistInlinePriceCell guard passed");
