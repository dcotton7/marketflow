/**
 * Position P/L signs and the panel's column fitting (Anima Lab Full watchlist).
 * Run with: tsx client/src/lib/watchlist-position-columns.test.ts
 */
import assert from "node:assert/strict";
import { addMissingPositionColumns, entryStopPct, fitColumns, positionPl } from "./watchlist-position-columns";
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

// A short is up when the price is under its entry, and has room while under its stop (which sits above the price).
assert.deepEqual(entryStopPct({ direction: "long", entry: 50, stop: 45, price: 55 }), { entryPct: 10, stopPct: (10 / 45) * 100 });
const sp = entryStopPct({ direction: "short", entry: 50, stop: 55, price: 45 });
assert.equal(sp.entryPct, 10, "short, price 10% under entry: +10%");
assert.ok(Math.abs(sp.stopPct! - (10 / 55) * 100) < 1e-9, "short, price under its stop: positive room");
assert.ok(entryStopPct({ direction: "short", entry: 50, stop: 55, price: 56 }).stopPct! < 0, "short through its stop: negative");
assert.equal(entryStopPct({ direction: "short", entry: 50, price: 55 }).entryPct, -10, "short losing: negative");
assert.deepEqual(entryStopPct({ direction: "short", entry: null, stop: null, price: 55 }), { entryPct: null, stopPct: null });
// 100 sh short at 50, now 55, up $1 today: a loss.
const losing = positionPl({ direction: "Short", shares: 100, entry: 50, price: 55, change: 1 });
assert.equal(losing.plOpen, -500);
assert.equal(losing.plToday, -100);
assert.equal(losing.plOpenPct, -10);

// A column config saved before Side / P/L existed gets them once: Side after % Chg, P/L before the remove button.
const old: WatchlistColumnEntry[] = [
  { id: "symbol", width: 88 }, { id: "changePct", width: 80 }, { id: "entry", width: 112 }, { id: "shares", width: 88 },
  { id: "actions", width: 48 },
];
const caught = addMissingPositionColumns(old, () => 60);
assert.deepEqual(caught.map((c) => c.id), ["symbol", "changePct", "side", "entry", "shares", "plToday", "plOpen", "actions"]);
assert.equal(caught.find((c) => c.id === "side")!.width, 60);
assert.equal(addMissingPositionColumns(caught, () => 60), caught, "nothing missing: unchanged");

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
