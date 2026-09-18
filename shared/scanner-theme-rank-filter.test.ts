import assert from "node:assert/strict";
import {
  lowestThemePercentileCap,
  lowestThemeRankFloor,
  matchesThemeRankCut,
  parseThemeRankCut,
  parseThemeRankN,
} from "./scanner-theme-rank-filter";

assert.equal(parseThemeRankCut("leading"), "leading");
assert.equal(parseThemeRankCut("lowest"), "lowest");
assert.equal(parseThemeRankCut("nope"), "all");
assert.equal(parseThemeRankN("3"), 3);
assert.equal(parseThemeRankN(0), 1);
assert.equal(parseThemeRankN(99), 26);
assert.equal(lowestThemeRankFloor(5), 22);
assert.equal(lowestThemePercentileCap(5), 20);
assert.equal(matchesThemeRankCut(2, 90, "leading", 5), true);
assert.equal(matchesThemeRankCut(8, 40, "leading", 5), false);
assert.equal(matchesThemeRankCut(null, 99, "leading", 5), false);
assert.equal(matchesThemeRankCut(24, 8, "lowest", 5), true);
assert.equal(matchesThemeRankCut(null, 15, "lowest", 5), true);
assert.equal(matchesThemeRankCut(1, 100, "all", 5), true);
console.log("scanner-theme-rank-filter.test.ts ok");
