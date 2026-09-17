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

const aliasCost = normalizeTosScreenExtract({
  layout: "tos_positions",
  positions: [{ symbol: "HPE", averageCost: "27.10", posQty: 100 }],
});
assert.equal(aliasCost.positions[0].avgCost, 27.1);

const fidelity = normalizeTosScreenExtract({
  layout: "fidelity_positions",
  positions: [
    { symbol: "CASH", averageCostBasis: 0, quantity: 0 },
    { symbol: "AMD", averageCostBasis: "$92.22", quantity: 100.01, lastPrice: 151.91, hasPosition: true },
    { symbol: "GOOGL", avgCost: "333.33", posQty: 100, last: "$251.09" },
    { symbol: "NVDA", averageCostBasis: 219.07, quantity: "250", lastPrice: "176.88" },
  ],
});
assert.equal(fidelity.model, "fidelity");
assert.equal(fidelity.layout, "fidelity_positions");
assert.deepEqual(fidelity.tickers, ["AMD", "GOOGL", "NVDA"]);
assert.equal(fidelity.positions[0].avgCost, 92.22);
assert.equal(fidelity.positions[0].posQty, 100.01);
assert.equal(fidelity.positions[1].avgCost, 333.33);
assert.equal(fidelity.positions[1].lastPrice, 251.09);
assert.equal(fidelity.positions[2].avgCost, 219.07);

assert.equal(
  normalizeTosScreenExtract({
    positions: [{ symbol: "GD", lastPrice: "$1,516.91" }],
  }).positions[0].lastPrice,
  1516.91,
);

const empty = normalizeTosScreenExtract(null);
assert.deepEqual(empty.positions, []);
assert.equal(empty.layout, "unknown");

console.log("tos-screen-extract tests passed");
