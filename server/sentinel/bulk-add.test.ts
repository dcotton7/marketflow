import assert from "node:assert/strict";
import {
  BULK_ADD_MAX,
  bulkAddSchema,
  planBulkAdd,
  planRemoveTickers,
  removeTickersSchema,
  watchlistNameTaken,
} from "./bulk-add";
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
assert.deepEqual(
  planBulkAdd(shot, have, { update: true, entryOnly: true }).update,
  [{ symbol: "NVDA", shares: null, entry: 140.5 }],
  "a list that isn't a portfolio takes the entry, never shares",
);
assert.deepEqual(planBulkAdd([{ symbol: "NVDA", shares: 9 }], have, { update: true, entryOnly: true }).update, [],
  "nothing to set without an entry");

assert.deepEqual(planRemoveTickers(["nvda", "ZZZZ", "NVDA", "corp inc", " tsla ", "zzzz"], have), {
  remove: ["NVDA", "TSLA"],
  notFound: ["ZZZZ"],
  invalid: ["corp inc"],
});
assert.ok(removeTickersSchema.safeParse({ watchlistId: 3, symbols: ["NVDA"] }).success);
for (const bad of [{ watchlistId: 3, symbols: [] }, { watchlistId: 3 }, { symbols: ["NVDA"] }]) {
  assert.ok(!removeTickersSchema.safeParse(bad).success, JSON.stringify(bad));
}
const lists = [{ name: "Port Watch" }, { name: "Energy " }];
assert.ok(watchlistNameTaken(" energy", lists));
assert.ok(watchlistNameTaken("PORT WATCH", lists));
assert.ok(!watchlistNameTaken("Energy 2", lists));

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

// A ticker now short in a portfolio list loses its old long shares and entry and is marked short.
{
  const p = planBulkAdd([{ symbol: "TSLA", short: true }, { symbol: "AMD", shares: 10, entry: 90, short: false }, { symbol: "XYZ", short: true, shares: 5 }],
    ["TSLA", "AMD"], { update: true });
  assert.deepEqual(p.update, [
    { symbol: "TSLA", shares: null, entry: null, short: true },
    { symbol: "AMD", shares: 10, entry: 90, short: false },
  ]);
  assert.deepEqual(p.add, [{ symbol: "XYZ", shares: null, entry: null, short: true }]);
  // Outside a portfolio list (entryOnly) a short flag changes nothing on an existing row.
  assert.deepEqual(planBulkAdd([{ symbol: "TSLA", short: true }], ["TSLA"], { update: true, entryOnly: true }).update, []);
  console.log("bulk add shorts ok");
}
