/**
 * Position P/L signs and the panel's column fitting (Anima Lab Full watchlist).
 * Run with: tsx client/src/lib/watchlist-position-columns.test.ts
 */
import assert from "node:assert/strict";
import { fitColumns, positionPl } from "./watchlist-position-columns";
import type { WatchlistColumnEntry } from "./watchlist-column-profile";

const long = positionPl({ direction: "long", shares: 100, entry: 50, price: 55, change: 1.5 });
assert.deepEqual(long, { side: "long", plToday: 150, plOpen: 500, plOpenPct: 10 });

const short = positionPl({ direction: "short", shares: 100, entry: 50, price: 45, change: -2 });
assert.equal(short.side, "short");
assert.equal(short.plToday, 200, "a short gains on a down day");
assert.equal(short.plOpen, 500, "a short gains when the price is under its entry");
assert.equal(short.plOpenPct, 10);

const noShares = positionPl({ direction: null, shares: null, entry: 50, price: 55, change: 1 });
assert.deepEqual(noShares, { side: "long", plToday: null, plOpen: null, plOpenPct: 10 });
assert.equal(positionPl({ shares: 10, entry: null, price: 55, change: 1 }).plOpen, null, "no entry, no P/L open");
assert.equal(positionPl({ shares: 10, entry: 50, price: 0, change: 1 }).plToday, null, "no price, no P/L");

const cols: WatchlistColumnEntry[] = [
  { id: "symbol", width: 88 }, { id: "company", width: 184 }, { id: "changePct", width: 80 },
  { id: "side", width: 56 }, { id: "stop", width: 112 }, { id: "shares", width: 88 }, { id: "plToday", width: 96 },
  { id: "plOpen", width: 112 }, { id: "entryDate", width: 120 }, { id: "actions", width: 48 },
];
const total = cols.reduce((s, c) => s + c.width, 0);
assert.deepEqual(fitColumns(cols, total).hidden, [], "everything fits");
assert.deepEqual(fitColumns(cols, 0).shown, cols, "no width measured yet: show all");

const mid = fitColumns(cols, total - 200);
assert.deepEqual(mid.hidden, ["company", "entryDate"], "company and entry date go first");
assert.deepEqual(mid.shown.map((c) => c.id), ["symbol", "changePct", "side", "stop", "shares", "plToday", "plOpen", "actions"],
  "the rest keep his order");

const tiny = fitColumns(cols, 100);
assert.deepEqual(tiny.shown.map((c) => c.id), ["symbol", "actions"], "ticker and remove always stay");

console.log("watchlist-position-columns: ok");
