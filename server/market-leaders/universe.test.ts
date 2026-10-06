import assert from "node:assert/strict";
import { getLeadersUniverseTickers, LEADERS_THEME_FUNDS } from "./universe";

const tickers = getLeadersUniverseTickers();
const set = new Set(tickers);
assert.equal(set.size, tickers.length);
assert.equal(LEADERS_THEME_FUNDS.length, 49);
for (const symbol of LEADERS_THEME_FUNDS) assert.equal(set.has(symbol), true, symbol);
for (const symbol of ["COIN", "MSTR", "MARA", "NVDA", "IBIT"]) assert.equal(set.has(symbol), true, symbol);
for (const symbol of ["GBTC", "ETHE", "SOXL", "SPY", "QQQ", "TQQQ", "BITI"]) assert.equal(set.has(symbol), false, symbol);
console.log(`leaders universe ${tickers.length}`);
