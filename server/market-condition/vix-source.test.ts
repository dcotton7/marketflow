import assert from "node:assert/strict";
import { parseVixCloses, parseVixQuote, realVixForScoresEnabled, vixReading, vixTile } from "./vix-source";
import { calculateVolatilityRegime } from "./engine/rai";

// FMP body as served on 20 Nov 2026
const q = parseVixQuote([{ symbol: "^VIX", name: "CBOE Volatility Index", price: 29.99, changePercentage: 5.45007, previousClose: 28.44 }], new Date("2026-11-20T15:00:00Z"));
assert.deepEqual(q, { price: 29.99, changePct: 5.45007, previousClose: 28.44, asOf: "2026-11-20T15:00:00.000Z", source: "Cboe VIX via FMP" });
assert.equal(parseVixQuote([{ price: 0 }]), null);
assert.equal(parseVixQuote([{ price: 450, changePercentage: 1 }]), null, "an implausible level is not a VIX");
assert.equal(parseVixQuote({ "Error Message": "Legacy Endpoint" }), null);
assert.equal(parseVixQuote([]), null);
assert.equal(parseVixQuote([{ price: 20, previousClose: 25 }])!.changePct, -20, "change derived from previous close when absent");

// closes: newest first regardless of input order, too-short series refused
const rows = Array.from({ length: 25 }, (_, i) => ({ symbol: "^VIX", date: `2026-10-${String(i + 1).padStart(2, "0")}`, price: 20 + i }));
const closes = parseVixCloses([...rows].reverse())!;
assert.equal(closes[0], 44);
assert.equal(closes.length, 25);
assert.equal(parseVixCloses(rows.slice(0, 5)), null);

// the setting is off unless asked
assert.equal(realVixForScoresEnabled({}), false);
assert.equal(realVixForScoresEnabled({ REAL_VIX_FOR_SCORES: "0" }), false);
assert.equal(realVixForScoresEnabled({ REAL_VIX_FOR_SCORES: "1" }), true);

// header tile: says which one it is
const proxy = { price: 31.2, changePercent: 7.1 };
assert.deepEqual(vixTile(q, proxy), { symbol: "VIXY", label: "VIX", price: 29.99, changePercent: 5.45, source: "Cboe VIX via FMP", isProxy: false });
const fb = vixTile(null, proxy);
assert.equal(fb.label, "VIXY");
assert.equal(fb.isProxy, true);
assert.equal(fb.price, 31.2);

// regime score: default path unchanged; real VIX only when handed in (same formula)
const snaps: any = new Map([["UVXY", { changePct: 2 }]]);
assert.deepEqual(calculateVolatilityRegime(snaps), { score: 6, detail: "UVXY: +2.00%" }, "default: UVXY, as before");
assert.deepEqual(calculateVolatilityRegime(snaps, null), { score: 6, detail: "UVXY: +2.00%" });
assert.deepEqual(calculateVolatilityRegime(snaps, { changePct: 2 }), { score: 6, detail: "VIX (Cboe): +2.00%" }, "same formula, labelled");

// the gateway's read: the VIX says it is Cboe's delayed quote, with the quote's own time when FMP gives one
const stamped = parseVixQuote([{ symbol: "^VIX", price: 17.2, changePercentage: -3.1, previousClose: 17.75, timestamp: 1795800600 }], new Date("2026-11-26T16:00:00Z"))!;
assert.equal(stamped.quoteTime, new Date(1795800600 * 1000).toISOString(), "FMP's timestamp (seconds) is the quote time");
const reading = vixReading(stamped, { price: 31.2, changePercent: 7.1 });
assert.equal(reading.kind, "VIX");
assert.equal(reading.isFallback, false);
assert.equal(reading.price, 17.2);
assert.equal(reading.quoteTime, stamped.quoteTime);
assert.equal(reading.fetchedAt, "2026-11-26T16:00:00.000Z");
assert.match(reading.delayed!, /about 15 minutes/);
assert.equal(vixReading(q, null).quoteTime, null, "no timestamp in the body: no quote time, the fetch time stays");
const fallback = vixReading(null, { price: 31.2, changePercent: 7.1, asOf: "2026-11-26T16:00:00.000Z" });
assert.equal(fallback.kind, "VIXY_FALLBACK");
assert.equal(fallback.isFallback, true);
assert.match(fallback.label, /NOT the VIX/);
assert.equal(fallback.price, 31.2);
assert.equal(fallback.delayed, null);
assert.equal(vixReading(null, null).price, null, "no proxy either: no number, still labelled the fallback");

console.log("vix-source tests passed");
