/** Run with: tsx shared/position-paste.test.ts */
import assert from "node:assert/strict";
import { parsePositionPaste, positionPreview } from "./position-paste";

const list = ["AAPL", "MSFT", "NVDA", "BRK.B"];
const want = [
  { symbol: "AAPL", shares: 100, entry: 150.25, status: "ok" },
  { symbol: "MSFT", shares: 50, entry: 300, status: "ok" },
];
const view = (t: string) => parsePositionPaste(t, list).rows.map(({ symbol, shares, entry, status }) => ({ symbol, shares, entry, status }));

// The three separators.
assert.deepEqual(view("AAPL 100 150.25\nMSFT 50 300"), want, "spaces");
assert.deepEqual(view("AAPL\t100\t150.25\nMSFT\t50\t300"), want, "tabs");
assert.deepEqual(view("AAPL,100,150.25\nMSFT, 50, 300"), want, "commas");
assert.deepEqual(view("AAPL 1,000 $150.25")[0], { symbol: "AAPL", shares: 1000, entry: 150.25, status: "ok" }, "thousands comma");

// A header row is ignored (and counted as skipped).
const hdr = parsePositionPaste("Ticker,Shares,Cost\nAAPL,100,150.25", list);
assert.equal(hdr.rows.length, 1);
assert.equal(hdr.skipped, 1);
assert.deepEqual(view("Symbol\tShares\tCost\nAAPL\t100\t150.25"), [want[0]]);

// A ticker not in the list is shown, never saved.
assert.equal(view("TSLA 10 200")[0].status, "not in list");

// A bad number is flagged, not guessed.
assert.equal(view("AAPL abc 150")[0].status, "bad number");
assert.equal(view("AAPL 100 xyz")[0].status, "bad number");
assert.equal(view("AAPL 0 150")[0].status, "bad number");
assert.equal(view("AAPL 100 -5")[0].status, "bad number");
assert.equal(view("AAPL 100 150 9")[0].status, "bad number", "extra column");

// Shares without a cost: shares only. A ticker alone has nothing to save.
assert.deepEqual(view("NVDA 25")[0], { symbol: "NVDA", shares: 25, entry: null, status: "ok" });
assert.equal(view("NVDA")[0].status, "no shares");

// A negative count is a short of that size.
const sh = parsePositionPaste("NVDA -25 900", list).rows[0];
assert.deepEqual([sh.shares, sh.short, sh.status], [25, true, "ok"]);

// A duplicate ticker keeps the first line; a lower-case ticker and BRK B work.
assert.equal(parsePositionPaste("AAPL 1 1\nAAPL 2 2", list).rows.length, 1);
assert.equal(view("aapl 100 150")[0].symbol, "AAPL");
assert.equal(view("BRK B 10 400")[0].symbol, "BRK.B");

// A Schwab-style export with a Cost Basis column: cost per share is basis over quantity.
const schwab = ["Symbol\tDescription\tQuantity\tPrice\tCost Basis", "AAPL\tAPPLE INC\t100\t190\t$15,025.00", "Account Total\t\t\t\t$15,025.00"].join("\n");
assert.deepEqual(view(schwab), [{ symbol: "AAPL", shares: 100, entry: 150.25, status: "ok" }]);

assert.equal(positionPreview(parsePositionPaste("AAPL 100 150\nTSLA 1 1\nMSFT abc 1", list).rows), "1 to save, 1 not in list, 1 bad number");
console.log("position-paste: all passed");
