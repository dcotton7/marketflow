import assert from "node:assert/strict";
import { BULK_ADD_MAX, bulkAddSchema, planBulkAdd } from "./bulk-add";
import { parseTickerPaste } from "@shared/ticker-paste";

const plan = planBulkAdd(
  [
    { symbol: "nvda", shares: 100, entry: 145 },
    { symbol: "AAPL" },
    { symbol: "NVDA" },
    { symbol: "BRK.B", shares: null },
    { symbol: "CORP INC" },
    { symbol: "TOOLONG" },
  ],
  ["AAPL", " msft "],
);
assert.deepEqual(plan.add, [
  { symbol: "NVDA", shares: 100, entry: 145 },
  { symbol: "BRK.B", shares: null, entry: null },
]);
assert.deepEqual(plan.existing, ["AAPL"]);
assert.deepEqual(plan.invalid, ["CORP INC", "TOOLONG"]);

const pasted = parseTickerPaste("Symbol\tQty\tCost Basis\nNVDA\t100\t$14,500.00\nMSFT\t5\t$2,000.00");
const body = { watchlistId: 3, items: pasted.tickers.map((t) => ({ symbol: t.symbol, shares: t.shares, entry: t.entry })) };
assert.ok(bulkAddSchema.safeParse(body).success, "what the paste box sends");
assert.deepEqual(planBulkAdd(bulkAddSchema.parse(body).items, ["MSFT"]).add, [{ symbol: "NVDA", shares: 100, entry: 145 }]);

const have = ["NVDA", "AAPL", "MSFT", "TSLA"];
const shot = [
  { symbol: "NVDA", shares: 150, entry: 140.5 },
  { symbol: "AAPL" },
  { symbol: "AMD", shares: 20, entry: 160 },
  { symbol: "nvda", shares: 1, entry: 1 },
];
const plain = planBulkAdd(shot, have);
assert.deepEqual(plain.update, [], "no update unless asked");
assert.deepEqual(plain.remove, []);
const upd = planBulkAdd(shot, have, { update: true, remove: ["msft", "NVDA", "ZZZZ", "MSFT"] });
assert.deepEqual(upd.update, [{ symbol: "NVDA", shares: 150, entry: 140.5 }], "the first row wins; AAPL has nothing to set");
assert.deepEqual(upd.add, [{ symbol: "AMD", shares: 20, entry: 160 }]);
assert.deepEqual(upd.existing, ["NVDA", "AAPL"]);
assert.deepEqual(upd.remove, ["MSFT"], "only listed tickers not in the screenshot, once each");
assert.ok(bulkAddSchema.safeParse({ watchlistId: 3, items: shot, update: true, remove: ["MSFT"] }).success);
assert.ok(!bulkAddSchema.safeParse({ watchlistId: 3, items: shot, update: "yes" }).success);

for (const bad of [
  {},
  { watchlistId: 3, items: [] },
  { watchlistId: 0, items: [{ symbol: "A" }] },
  { watchlistId: 3, items: [{ symbol: "A", shares: -1 }] },
  { watchlistId: 3, items: Array.from({ length: BULK_ADD_MAX + 1 }, () => ({ symbol: "A" })) },
]) {
  assert.ok(!bulkAddSchema.safeParse(bad).success, JSON.stringify(bad).slice(0, 60));
}

console.log("bulk add ok");
