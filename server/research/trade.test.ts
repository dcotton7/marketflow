import assert from "node:assert/strict";
import { DYNAMIC_EXIT, HARD_RULES, type ExitPolicy } from "./exit-policy";
import { computeFacts, type SymbolFacts } from "./facts";
import { stopBelow } from "./setups/helpers";
import type { EntryOrder } from "./setups/types";
import { flatBars, indexFrom } from "./testing";
import { simulateTrade, type TradeInput } from "./trade";
import type { DailyBar, MinuteBar } from "./types";

const N = 90;
const SIG = 70;

function setup(edit?: (bars: DailyBar[]) => void) {
  const bars = flatBars(N);
  edit?.(bars);
  const f = computeFacts(bars, indexFrom(flatBars(N)));
  return f;
}

const noSignals = () => ({ exhaustion: new Array(N).fill(false), wedgeDrop: new Array(N).fill(false), bearishBnb: new Array(N).fill(false) });

function run(f: SymbolFacts, o: Partial<TradeInput> & { stopLevel?: number } = {}) {
  const policy: ExitPolicy = o.policy ?? { ...DYNAMIC_EXIT, armTrailAfterCloseAbove: false };
  const order: EntryOrder = o.order ?? { type: "next_open" };
  return simulateTrade({
    f,
    signalIndex: o.signalIndex ?? SIG,
    order,
    stop: o.stop ?? { ...stopBelow(o.stopLevel ?? 97, 1, 0, "base_low", "base low"), bufferAtr: 0 },
    slipBps: o.slipBps ?? 0,
    policy,
    waitSessions: o.waitSessions ?? 0,
    signals: o.signals ?? noSignals(),
    vixBucketAt: o.vixBucketAt ?? (() => "20-30"),
    minute: o.minute,
    wantMinutes: o.wantMinutes ?? false,
    enforceMaxLoss: o.enforceMaxLoss,
  });
}

const near = (a: number | null | undefined, b: number, eps = 1e-6) => assert.ok(a != null && Math.abs(a - b) < eps, `${a} != ${b}`);

// The stop is the logical level, not entry − 5%: a 3% stop exits at 97 when traded, for −1R.
{
  const f = setup((b) => (b[75] = { ...b[75], low: 96 }));
  const t = run(f);
  assert.equal(t.status, "filled");
  near(t.entry, 100);
  assert.equal(t.exitReason, "stop");
  near(t.pieces[0].price, 97);
  near(t.R, -1);
  near(t.stopDistPct, 0.03);
}

// A logical stop more than 5% below the fill skips the trade; it is never moved up to −5%.
{
  const f = setup((b) => (b[72] = { ...b[72], low: 94.5 }));
  const skip = run(f, { stopLevel: 90 });
  assert.equal(skip.status, "skipped_stop_too_wide");
  assert.equal(skip.pieces.length, 0);
  near(skip.stopPrice, 90);
  near(skip.stopDistPct, 0.1);

  // Variant: wait for a price where the same logical stop is within 5%.
  const wait = run(f, { stopLevel: 90, waitSessions: 5 });
  assert.equal(wait.status, "filled");
  assert.equal(wait.fillIndex, 72);
  assert.equal(wait.limitFill, true);
  near(wait.entry, 90 / (1 - HARD_RULES.maxLossPct));
  assert.ok((wait.stopDistPct as number) <= HARD_RULES.maxLossPct + 1e-9);
  near(wait.stopPrice, 90);

  // Without a pullback in time the wait expires.
  const expired = run(setup(), { stopLevel: 90, waitSessions: 3 });
  assert.equal(expired.status, "wait_expired");

  // "Would have" outcomes for skipped trades simulate the wide stop only when asked.
  const would = run(f, { stopLevel: 90, enforceMaxLoss: false });
  assert.equal(would.status, "filled");
  near(would.stopDistPct, 0.1);
}

// A gap through the stop fills at the open.
{
  const f = setup((b) => (b[75] = { date: b[75].date, open: 95, high: 95.5, low: 94, close: 95, volume: 1e6 }));
  const t = run(f);
  assert.equal(t.exitReason, "stop_gap");
  near(t.pieces[0].price, 95);
  assert.equal(t.gapThroughStop, true);
}

// Slippage on every fill.
{
  const f = setup((b) => (b[75] = { ...b[75], low: 96 }));
  const t = run(f, { slipBps: 10 });
  near(t.entry, 100 * 1.001);
  near(t.pieces[0].price, 97 * 0.999);
}

// Trims: due at a 7× close, fill only on a later session that trades above the prior session's high.
{
  const f = setup((b) => (b[75] = { ...b[75], open: 100, high: 102 }));
  f.extSma50[73] = 8;
  f.extSma50[74] = 8;
  const t = run(f);
  const trims = t.pieces.filter((p) => p.kind === "trim");
  assert.equal(trims.length, 1);
  assert.equal(trims[0].index, 75, "bar 74 does not trade above bar 73's high, so the trim waits");
  near(trims[0].price, 100.5 + 0.01);
  near(trims[0].fraction, DYNAMIC_EXIT.vixTrimTable["20-30"]);
  assert.ok(trims[0].price > (trims[0].priorHigh as number));
  assert.deepEqual(t.trimDues.map((d) => d.index), [73]);
}

// A pending trim is cancelled when extension falls back below 7 before it fills.
{
  const f = setup((b) => (b[75] = { ...b[75], open: 100, high: 102 }));
  f.extSma50[73] = 8;
  f.extSma50[74] = 5;
  const t = run(f);
  assert.equal(t.pieces.filter((p) => p.kind === "trim").length, 0);
}

// Trims stop at the cap and a trailing piece is always kept.
{
  const f = setup((b) => {
    for (let k = 71; k < N; k++) {
      const px = 100 + (k - 70);
      b[k] = { date: b[k].date, open: px - 0.2, high: px + 0.5, low: px - 0.5, close: px, volume: 1e6 };
    }
  });
  for (let k = 71; k < N; k++) f.extSma50[k] = k % 2 ? 8 : 6;
  for (let k = 71; k < N; k++) f.extSma10[k] = 0;
  const t = run(f, { vixBucketAt: () => ">30" });
  const trimmed = t.pieces.filter((p) => p.kind === "trim").reduce((a, p) => a + p.fraction, 0);
  near(trimmed, DYNAMIC_EXIT.trimCap);
  assert.equal(t.open, true);
  assert.ok(t.pieces.every((p) => p.kind === "trim"));
}

// Trail: very extended above the 10 SMA → 5 SMA; a close below it exits at the next open.
{
  const f = setup();
  f.extSma10[74] = 4;
  f.sma5[74] = 101;
  const t = run(f);
  assert.equal(t.exitReason, "trail_sma5");
  assert.equal(t.exitIndex, 75);
  near(t.pieces[0].price, f.bars[75].open);

  const g = setup();
  g.extSma10[74] = 1;
  g.sma5[74] = 101;
  assert.equal(run(g).open, true, "not extended: the 10 SMA trail holds while close >= 10 SMA");
}

// Trail: large open profit with moderate extension → 20 SMA.
{
  const f = setup((b) => (b[74] = { date: b[74].date, open: 110, high: 116.5, low: 109, close: 116, volume: 1e6 }));
  f.extSma10[74] = 1;
  f.extSma20[74] = 1.5;
  f.sma20[74] = 117;
  f.sma10[74] = 110;
  const t = run(f);
  assert.equal(t.exitReason, "trail_sma20");
  assert.equal(t.exitIndex, 75);
}

// The trail only arms after a close above its MA when the policy says so (counter-trend entries start below it).
{
  const f = setup();
  for (let k = 71; k < N; k++) f.sma10[k] = 101;
  assert.equal(run(f, { policy: DYNAMIC_EXIT }).open, true);
  assert.equal(run(f, { policy: { ...DYNAMIC_EXIT, armTrailAfterCloseAbove: false } }).exitReason, "trail_sma10");
}

// Kell exits: a Wedge Drop at a close exits at the next open.
{
  const f = setup();
  const s = noSignals();
  s.wedgeDrop[76] = true;
  const t = run(f, { signals: s });
  assert.equal(t.exitReason, "wedge_drop");
  assert.equal(t.exitIndex, 77);
}

// Same-day trim and stop: daily bars assume the stop first; minute bars decide the order.
{
  const f = setup((b) => (b[75] = { date: b[75].date, open: 100, high: 102, low: 96, close: 96.5, volume: 1e6 }));
  f.extSma50[74] = 8;
  const daily = run(f);
  assert.equal(daily.pieces.filter((p) => p.kind === "trim").length, 0);
  assert.equal(daily.exitReason, "stop");

  const wants = run(f, { wantMinutes: true });
  assert.deepEqual(wants.minuteNeeds, [f.bars[75].date]);

  const t0 = `${f.bars[75].date}T13:30:00Z`;
  const mins: MinuteBar[] = [
    { t: t0, open: 100, high: 100.4, low: 99.9, close: 100.2, volume: 1e4 },
    { t: t0, open: 100.6, high: 101, low: 100.5, close: 100.9, volume: 1e4 },
    { t: t0, open: 99, high: 99.2, low: 96, close: 96.4, volume: 1e4 },
  ];
  const resolved = run(f, { wantMinutes: true, minute: () => mins });
  const trims = resolved.pieces.filter((p) => p.kind === "trim");
  assert.equal(trims.length, 1);
  near(trims[0].price, 100.6);
  assert.equal(resolved.exitReason, "stop");
  assert.equal(resolved.minuteDaysUsed, 1);
}

// Fills happen only when the trigger was knowable: next-open orders fill at the next open, buy stops on a later bar
// that trades through the stop price, at max(open, stop price).
{
  const f = setup((b) => {
    b[SIG + 1] = { ...b[SIG + 1], open: 100.2 };
    b[SIG + 2] = { ...b[SIG + 2], open: 100.3, high: 101.5 };
  });
  const t = run(f);
  assert.equal(t.fillIndex, SIG + 1);
  near(t.entry, 100.2);

  const notHit = run(f, { order: { type: "buy_stop", price: 101, validSessions: 1 } });
  assert.equal(notHit.status, "no_fill");
  const hit = run(f, { order: { type: "buy_stop", price: 101, validSessions: 2 } });
  assert.equal(hit.fillIndex, SIG + 2);
  near(hit.entry, 101);

  const atEnd = run(f, { signalIndex: N - 1 });
  assert.equal(atEnd.status, "no_fill");
}

console.log("trade.test.ts: ok");
