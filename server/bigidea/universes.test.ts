/** BigIdea universes: the scan pool is offered, the June 2020 Russell 3000 list is kept but labelled stale. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getUniverseTickers } from "./universes";
import { resolveScanUniverse, SCAN_POOL_UNIVERSE } from "./marketflow-universe";

const page = readFileSync(join(import.meta.dirname, "../../client/src/pages/BigIdeaPage.tsx"), "utf8");
const block = page.slice(page.indexOf("const INDEX_OPTIONS = ["), page.indexOf("];", page.indexOf("const INDEX_OPTIONS = [")));
assert.match(block, /value: "scan-pool", label: "Scan pool \(liquid/);
assert.match(block, /value: "russell3000", label: "Russell 3000 \(June 2020 list, stale\)"/);
assert.match(block, /value: "sp500"/);
assert.ok(getUniverseTickers("russell3000").length > 2000, "the Russell 3000 list is still there");

async function main() {
  // no database: the pool is empty, not an error; other universes are unchanged
  assert.deepEqual(await resolveScanUniverse(SCAN_POOL_UNIVERSE, undefined, null), { tickers: [], scanPool: true });
  assert.deepEqual((await resolveScanUniverse(SCAN_POOL_UNIVERSE, ["aapl"], null)).tickers, ["AAPL"], "a watchlist wins");
  assert.equal((await resolveScanUniverse("sp500", undefined, null)).tickers.length, getUniverseTickers("sp500").length);
  console.log("universes: all checks passed");
}
main().catch((e) => { console.error(e); process.exit(1); });
