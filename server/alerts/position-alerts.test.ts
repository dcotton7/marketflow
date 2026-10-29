import assert from "node:assert/strict";
import { baseNBreak, emaCrossback, exhaustionExtension, kellSetups, kellStage, wedgeDrop, wedgePop } from "./kell";
import { assessStop, brokenLevels, levelAt, supportLevels, swingLows } from "./levels";
import { evaluatePosition, stopFor, trailPeriod, vixTrimPct, withLivePrice, type DayBar } from "./position-rules";
import { buildSnapshot, materialChange } from "./position-snapshot";
import { parseCboeVix } from "./vix";
import { parseFeedCursor } from "./feed-cursor";

const day = (i: number) => new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
const bar = (i: number, close: number, range = 2, open = close, volume = 1e6): DayBar =>
  ({ date: day(i), open, high: Math.max(open, close) + range / 2, low: Math.min(open, close) - range / 2, close, volume });
const flat = (n: number, px = 100) => Array.from({ length: n }, (_, i) => bar(i, px));
const path = (closes: number[], range = 2) => closes.map((c, i) => bar(i, c, range, i ? closes[i - 1] : c));
const pos = { itemId: 7, symbol: "nvda", entry: 100, shares: 100 };
const mkt = (bars: DayBar[], price: number | null, extra: Partial<{ closeFinal: boolean; vix: number | null; day: string }> = {}) =>
  // "Today" is the last fixture bar's day, so the live price lands on that bar (an older last bar gets a new one).
  ({ bars, price, closeFinal: false, vix: 17, day: bars.length ? bars[bars.length - 1].date : "2026-10-28", ...extra });
const rules = (sigs: { rule: string; level: string }[]) => sigs.map((s) => `${s.rule}:${s.level}`);

// ---- VIX ladder and the stop
assert.deepEqual([14.99, 15, 19.9, 20, 25, 29.9, 30, 80].map((v) => vixTrimPct(v)), [5, 10, 10, 15, 20, 20, 25, 25]);
assert.equal(vixTrimPct(null), null);
assert.deepEqual(stopFor(100, null), { stop: 95, planned: false }, "5% max-loss cap");
assert.deepEqual(stopFor(100, 97), { stop: 97, planned: true }, "a tighter planned stop wins");
assert.deepEqual(stopFor(100, 90), { stop: 95, planned: false }, "never more than 5% below entry");

// Flat at 100 (ATR 2), entry 100: warn at −4% (stop + 1% of entry), breach at −5%.
const base = flat(80);
assert.deepEqual(rules(evaluatePosition(pos, mkt(base, 96.5))).filter((r) => r.startsWith("stop")), []);
assert.ok(rules(evaluatePosition(pos, mkt(base, 96))).includes("stop:warn"));
assert.ok(rules(evaluatePosition(pos, mkt(base, 95))).includes("stop:breach"));
assert.ok(!rules(evaluatePosition(pos, mkt(base, 95))).includes("stop:warn"), "a breach is not also a warn");
const planned = evaluatePosition({ ...pos, stopPlan: 98.9 }, mkt(base, 99.8));
assert.ok(rules(planned).includes("stop:warn"), "warn near the planned stop");
assert.match(planned.find((s) => s.rule === "stop")!.message, /planned stop \$98\.90/);
assert.deepEqual(rules(evaluatePosition(pos, mkt(base, null))).filter((r) => r.startsWith("stop")), [], "live price only");

// ---- trim at 7 ATRs over the 50-day, sized by VIX, Exhaustion Extension label
const trim = evaluatePosition(pos, mkt(base, 130)).find((s) => s.rule === "trim")!;
assert.equal(trim.detail.extensionAtr, 7.22, "(130 − SMA50 100.6) / ATR14 4.07, today's bar at the live price");
assert.equal(trim.detail.trimPct, 10);
assert.equal(trim.detail.trimShares, 10);
assert.equal(trim.detail.setup, "exhaustion_extension", "6 ATRs over the 10 EMA as well");
assert.match(trim.message, /Exhaustion Extension/);
assert.equal(evaluatePosition(pos, mkt(base, 128)).find((s) => s.rule === "trim"), undefined, "6.98 is not 7");
const noVix = evaluatePosition(pos, mkt(base, 130, { vix: null })).find((s) => s.rule === "trim")!;
assert.equal(noVix.detail.trimPct, null);
assert.match(noVix.message, /VIX unavailable/);
assert.equal(evaluatePosition(pos, mkt(base, 130, { vix: 31 })).find((s) => s.rule === "trim")!.detail.trimPct, 25);

// ---- trail: which SMA, and only on the daily close
assert.equal(trailPeriod(5, 0), 5);
assert.equal(trailPeriod(2.9, 20), 20);
assert.equal(trailPeriod(3, 20), 10);
assert.equal(trailPeriod(4, 5), 10);
assert.equal(trailPeriod(null, 50), 10);
const up = path(Array.from({ length: 70 }, (_, i) => 100 + i * 0.5));
const dip = [...up.slice(0, -1), bar(69, up[67].close - 2, 2, up[68].close)];
assert.deepEqual(rules(evaluatePosition(pos, mkt(dip, null, { closeFinal: false }))).filter((r) => r.startsWith("trail")), []);
const trail = evaluatePosition(pos, mkt(dip, null, { closeFinal: true })).find((s) => s.rule === "trail")!;
assert.ok(trail, "close under the trailing SMA");
assert.equal(trail.level, `sma${trail.detail.period}`);
assert.ok(Number(trail.detail.close) < Number(trail.detail.sma));

// ---- once per condition per day: the key is stable within a day and new the next day
const a = evaluatePosition(pos, mkt(base, 95)), b = evaluatePosition(pos, mkt(base, 94));
assert.deepEqual(a.map((s) => s.key), b.map((s) => s.key));
assert.ok(a.every((s) => s.key.endsWith(`:${base[base.length - 1].date}`) && s.key.startsWith("pos:7:")));
assert.notDeepEqual(evaluatePosition(pos, mkt(base, 95, { day: "2026-10-29" })).map((s) => s.key), a.map((s) => s.key));

// ---- logical levels
const v = path([110, 108, 106, 104, 102, 100, 102, 104, 106, 108, 110, 109, 110, 111, 112, 113], 1);
assert.deepEqual(swingLows(v).map((s) => s.price), [99.5], "the V's low");
const lv = supportLevels(base, 100.5);
assert.ok(lv.every((l, i) => l.price < 100.5 && (i === 0 || l.price <= lv[i - 1].price)), "under price, nearest first");
const baseLow = lv.find((l) => l.kind === "base_low")!;
assert.equal(baseLow.price, 99);
assert.equal(baseLow.atrBelow, 0.75);
assert.equal(levelAt(98.6, lv, 2)?.kind, "base_low", "just under support counts");
assert.equal(levelAt(97, lv, 2), null);
const none = assessStop({ entry: 100, stopPlan: null, cap: 95, levels: lv, atr: 2 });
assert.deepEqual(none.flags, ["no_planned_stop", "cap_in_empty_space"]);
assert.match(none.note, /base low[^,]*\$99\.00/);
assert.doesNotMatch(none.note, /%/, "never an arbitrary % stop");
const off = assessStop({ entry: 100, stopPlan: 97, cap: 95, levels: lv, atr: 2 });
assert.deepEqual(off.flags, ["planned_stop_not_at_level"]);
assert.match(off.note, /planned stop \$97\.00 isn't at a level; nearby: .*base low[^,]*\$99\.00/);
assert.deepEqual(assessStop({ entry: 100, stopPlan: 98.8, cap: 95, levels: lv, atr: 2 }).flags, [], "stop under the base low");
const loose = assessStop({ entry: 100, stopPlan: 90, cap: 95, levels: lv, atr: 2 });
assert.ok(loose.flags.includes("cap_tighter_than_plan") && loose.flags.includes("cap_in_empty_space"));

// A break of the base low before the cap is a signal of its own.
assert.ok(brokenLevels(base, 98.5, 95).some((l) => l.kind === "base_low"));
assert.deepEqual(brokenLevels(base, 99.5, 95).filter((l) => l.kind === "base_low"), [], "still above it");
const lb = evaluatePosition(pos, mkt(base, 98.5)).filter((s) => s.rule === "level_break");
assert.ok(lb.some((s) => s.level === "base_low"));
assert.equal(evaluatePosition({ ...pos, stopPlan: 99.2 }, mkt(base, 98.5)).filter((s) => s.rule === "level_break").length, 0,
  "levels under the stop are the stop's business");

// ---- Kell checks (EMA 10/20)
assert.ok(exhaustionExtension(withLivePrice(base, 130), 130));
assert.equal(exhaustionExtension(withLivePrice(base, 120), 120), null);
const climb = path(Array.from({ length: 60 }, (_, i) => 100 + i), 1.5);
const e10 = (() => { let e = 0; climb.forEach((b, i) => { e = i < 9 ? 0 : i === 9 ? climb.slice(0, 10).reduce((s, x) => s + x.close, 0) / 10 : (b.close - e) * (2 / 11) + e; }); return e; })();
const touch = [...climb, { date: day(60), open: e10 + 0.3, high: e10 + 3, low: e10 - 0.2, close: e10 + 2.5, volume: 1e6 }];
const cb = emaCrossback(touch, true)!;
assert.equal(cb?.name, "ema_crossback");
assert.equal(cb.detail.ema, 10);
assert.equal(emaCrossback([...climb, { ...touch[60], close: e10 - 1, open: e10 }], true), null, "has to close back up");

const fall = path([...Array.from({ length: 40 }, (_, i) => 140 - i), ...[100, 99.5, 99.8, 99.4, 99.6, 99.5, 99.7, 99.4, 99.6, 99.5]], 3)
  .map((b, i) => (i >= 40 ? { ...b, high: b.close + 0.4, low: b.close - 0.4 } : b));
const popped = [...fall, bar(50, 108, 2, 100)];
assert.equal(wedgePop(popped, true)?.name, "wedge_pop");
assert.equal(wedgePop([...fall, bar(50, 100.2, 2, 99.5)], true), null, "still under the EMAs");

const run = path(Array.from({ length: 60 }, (_, i) => 70 + i * 0.5), 1.5);
const tight = Array.from({ length: 15 }, (_, i) => bar(60 + i, 100 + (i % 3), 2));
const brk = [...run, ...tight, { ...bar(75, 105, 2, 102), volume: 3e6 }];
assert.equal(baseNBreak(brk, true)?.name, "base_n_break");
assert.equal(baseNBreak([...run, ...tight, { ...bar(75, 105, 2, 102), volume: 1e6 }], true), null, "needs volume");
assert.ok(baseNBreak([...run, ...tight, { ...bar(75, 105, 2, 102), volume: 1e6 }], false, 0.4), "volume scaled to the session so far");

const rise = path(Array.from({ length: 40 }, (_, i) => 100 + i), 2);
const stall = [139.9, 140.1, 140.3, 140.5, 140.6].map((c, i) => ({ ...bar(40 + i, c, 1.2, c - 0.2), high: 140.9, low: c - 0.6 }));
const drop = [...rise, ...stall, bar(45, 132, 2, 140.5)];
assert.equal(wedgeDrop(drop, true)?.name, "wedge_drop");
assert.equal(wedgeDrop([...rise, ...stall, bar(45, 140.8, 2, 141)], true), null, "held the EMAs");
assert.equal(kellStage(drop, 132, kellSetups(drop, 132, true)), "wedge_drop");
assert.equal(kellStage(climb, climb[59].close, []), "uptrend");
assert.ok(rules(evaluatePosition({ ...pos, entry: 120 }, mkt(drop, null, { closeFinal: true }))).includes("wedge_drop:exit"));

// ---- the snapshot and what counts as a material change
const snapIn = (bars: DayBar[], price: number | null, extra = {}) => buildSnapshot({
  pos: { ...pos, entryDate: "2026-09-01" }, bars, price,
  quote: price ? { open: bars[bars.length - 1].open, vwap: price - 1, volume: 2e6 } : null,
  spy: { bars: flat(60, 500), price: 495 }, qqq: { bars: flat(60, 400), price: 404 },
  vix: { level: 17, change: 0.5 }, earningsDate: new Date(Date.parse(bars[bars.length - 1].date) + 2 * 86_400_000).toISOString().slice(0, 10),
  closeFinal: false, sessionFraction: 0.5,
  day: bars[bars.length - 1].date, at: "2026-10-28T15:00:00Z", ...extra,
});
const calm = snapIn(base, 101);
assert.equal(calm.extensionAtr, 0.49);
assert.equal(calm.velocity.roc1Atr, 0.5);
assert.equal(calm.relVolume, 4, "2M by mid-session vs 1M a day");
assert.equal(calm.vwap!.above, true);
assert.equal(calm.rs.vsSpyToday, 2, "+1% vs SPY −1%");
assert.equal(calm.rs.vsQqqToday, 0);
assert.equal(calm.earnings!.days, 2);
assert.equal(calm.regime.spy!.aboveSma20, false);
assert.equal(calm.stop.price, 95);
assert.deepEqual(calm.stop.flags, ["no_planned_stop", "cap_in_empty_space"]);
assert.ok(calm.levels.some((l) => l.kinds.includes("vwap")), "VWAP is a level intraday");
const hot = snapIn(base, 130);
assert.ok(hot.signals.some((s) => s.rule === "trim"));
assert.equal(hot.kell.stage, "exhaustion_extension");
assert.ok(hot.velocity.roc1Atr! >= 7);

const same = materialChange(calm, snapIn(base, 101));
assert.equal(same.score, 0);
assert.equal(same.material, false);
assert.equal(same.fingerprint, materialChange(null, calm).fingerprint, "same situation, same fingerprint");
const jump = materialChange(calm, hot);
assert.ok(jump.material && jump.score >= 50, `trim + Kell + velocity: ${jump.score}`);
assert.ok(jump.reasons.some((r) => r.startsWith("new signal trim")));
assert.notEqual(jump.fingerprint, same.fingerprint);
assert.equal(materialChange(hot, snapIn(base, 130.2)).score, 0, "no repeat for the same situation");
const worse = materialChange(hot, snapIn(base, 94.9));
assert.ok(worse.reasons.includes("new signal stop:breach") && worse.score >= 100, "a breach always counts");

// ---- the feed cursor and the VIX read
assert.deepEqual(parseFeedCursor({}), { after: null, eventsAfter: null, limit: 50 });
assert.deepEqual(parseFeedCursor({ after: "12", events_after: "0", limit: "500" }), { after: 12, eventsAfter: 0, limit: 50 });
assert.deepEqual(parseFeedCursor({ after: "x", events_after: "-1", limit: "5" }), { after: null, eventsAfter: null, limit: 5 });
assert.deepEqual(parseCboeVix({ data: { current_price: 17.08, price_change: -0.44 } }), { level: 17.08, change: -0.44 });
assert.equal(parseCboeVix({ data: {} }), null);
assert.equal(parseCboeVix(null), null);

console.log("position alerts ok");

// A daily cache that still ends yesterday: today's live bar is added, yesterday's bar and volume stay as they were.
{
  const lagged = withLivePrice(base, 101, { day: "2099-01-02", open: 100.5, volume: 3e5 });
  assert.equal(lagged.length, base.length + 1);
  assert.deepEqual(lagged[base.length - 1], base[base.length - 1]);
  assert.equal(lagged[base.length].volume, 3e5);
  console.log("stale daily bar ok");
}
