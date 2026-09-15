import assert from "node:assert/strict";
import {
  formatTickersCsv,
  normalizeTosScreenExtract,
  parseWatchlistTickers,
} from "./tos-screen-extract";

assert.deepEqual(
  parseWatchlistTickers("BE, COIN, EW, SYMBOL, LAST"),
  ["BE", "COIN", "EW"],
  "stop words and tickers",
);

const fromShot = normalizeTosScreenExtract({
  layout: "tos_watchlist",
  positions: [
    { symbol: "BGSAX", avgCost: "-", posQty: "-", lastPrice: 80.49, hasPosition: false },
    { symbol: "BE", avgCost: "$266.45", posQty: "+150", lastPrice: 261.7651, hasPosition: true },
    { symbol: "COIN", avgCost: 181.77, posQty: 250, lastPrice: 179.135, hasPosition: true },
    { symbol: "PLTR", avgCost: "N/A", posQty: 0, lastPrice: 176.43, hasPosition: false },
    { symbol: "SYMBOL", avgCost: 1, posQty: 1, lastPrice: 1, hasPosition: true },
  ],
});

assert.equal(fromShot.model, "tos");
assert.equal(fromShot.reviewOnly, true);
assert.equal(fromShot.layout, "tos_watchlist");
assert.deepEqual(fromShot.tickers, ["BGSAX", "BE", "COIN", "PLTR"]);
assert.equal(fromShot.positions[0].hasPosition, false);
assert.equal(fromShot.positions[0].avgCost, null);
assert.equal(fromShot.positions[1].avgCost, 266.45);
assert.equal(fromShot.positions[1].posQty, 150);
assert.equal(fromShot.positions[3].hasPosition, false);
assert.equal(fromShot.positions[3].posQty, null);
assert.equal(formatTickersCsv(fromShot.tickers), "BGSAX, BE, COIN, PLTR");

const empty = normalizeTosScreenExtract(null);
assert.deepEqual(empty.positions, []);
assert.equal(empty.layout, "unknown");

console.log("tos-screen-extract tests passed");
