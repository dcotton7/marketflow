import assert from "node:assert/strict";
import { classifyCycle } from "./cycle";
import { computeFacts } from "./facts";
import { ENTRY_SETUPS, SETUPS, setupById } from "./setups";
import type { EntrySetup } from "./setups/types";
import { barsFromDrifts, indexFrom, segments, tradingDates } from "./testing";
import type { DailyBar } from "./types";

function lineBars(closes: number[], vols?: number[], range = 0.5): DailyBar[] {
  const dates = tradingDates("2024-12-02", closes.length);
  return closes.map((c, k) => ({ date: dates[k], open: k ? closes[k - 1] : c, high: Math.max(c, k ? closes[k - 1] : c) + range, low: Math.min(c, k ? closes[k - 1] : c) - range, close: c, volume: vols?.[k] ?? 1_000_000 }));
}

function detectAt(id: string, bars: DailyBar[], i: number) {
  const f = computeFacts(bars, indexFrom(bars));
  const s = setupById(id) as EntrySetup;
  return { sig: s.detect({ f, i, stages: classifyCycle(f) }, s.defaults), f };
}

// Registry: unique ids, every entry setup is parameterized, Weinstein is not a tested setup.
assert.equal(new Set(SETUPS.map((s) => s.id)).size, SETUPS.length);
assert.ok(!SETUPS.some((s) => /weinstein/i.test(s.id)));
for (const s of ENTRY_SETUPS) assert.ok(typeof s.defaults.stopBufferAtr === "number", `${s.id} has a stop buffer param`);

// MA reclaim (20 SMA): 3 closes under a rising 20 SMA, then a close back above on volume. Stop = undercut low − buffer.
{
  const closes = Array.from({ length: 100 }, (_, k) => 100 + 0.4 * k);
  closes.push(133, 133.5, 133.2, 141);
  const vols = closes.map((_, k) => (k === 103 ? 3_000_000 : 1_000_000));
  const bars = lineBars(closes, vols);
  const { sig, f } = detectAt("ma_reclaim_20", bars, 103);
  assert.ok(sig, "ma_reclaim_20 fires");
  assert.equal(sig.stop.basis, "undercut_low");
  const low = Math.min(...bars.slice(100, 104).map((b) => b.low));
  assert.equal(sig.stop.level, low);
  assert.ok(Math.abs(sig.stop.price - (low - 0.1 * (f.atr14[103] as number))) < 1e-9);
  assert.match(sig.stop.reason, /^undercut low \d+\.\d{2} - 0\.1 ATR$/);
  assert.equal(sig.order.type, "next_open");
  assert.equal(detectAt("ma_reclaim_20", bars, 102).sig, null, "no signal before the reclaim close");
}

// Base 'n Break: tight base on the rising EMAs with drying volume, then a close above the base high on volume.
{
  const closes = Array.from({ length: 80 }, (_, k) => 100 + 0.5 * k);
  for (let k = 0; k < 10; k++) closes.push(k % 2 ? 140.6 : 140);
  closes.push(142.5);
  const vols = closes.map((_, k) => (k >= 80 && k < 90 ? 600_000 : k === 90 ? 2_500_000 : 1_000_000));
  const bars = lineBars(closes, vols, 0.3);
  const { sig } = detectAt("kell_base_n_break", bars, 90);
  assert.ok(sig, "base 'n break fires");
  assert.equal(sig.stop.basis, "base_low");
  assert.equal(sig.stop.level, sig.details.baseLow);
  assert.ok(sig.stop.level >= 137 && sig.stop.level <= 140, `stop under the base low (${sig.stop.level})`);
}

// Reversal Extension: deep below the 10/20 EMA, a reversal bar closing above the prior high on volume.
{
  const closes = Array.from({ length: 80 }, () => 200);
  for (let k = 0; k < 30; k++) closes.push(closes[closes.length - 1] * 0.97);
  const last = closes[closes.length - 1];
  closes.push(last * 1.06);
  const vols = closes.map((_, k) => (k === closes.length - 1 ? 4_000_000 : 1_000_000));
  const bars = lineBars(closes, vols, 0.3);
  const i = bars.length - 1;
  const { sig } = detectAt("kell_reversal_extension", bars, i);
  assert.ok(sig, "reversal extension fires");
  assert.equal(sig.order.type, "buy_stop");
  if (sig.order.type === "buy_stop") assert.ok(Math.abs(sig.order.price - (bars[i].high + 0.01)) < 1e-9);
  assert.equal(sig.stop.basis, "reversal_low");
  assert.equal(sig.stop.level, bars[i].low);
}

// Earnings gap / episodic pivot: 8%+ gap on 3×+ volume closing in the upper half; buy stop above the gap-day high.
{
  const closes = Array.from({ length: 80 }, () => 100);
  const bars = lineBars(closes);
  const d = tradingDates("2024-12-02", 81)[80];
  bars.push({ date: d, open: 110, high: 115, low: 109, close: 114, volume: 5_000_000 });
  const { sig } = detectAt("gap_episodic_pivot", bars, 80);
  assert.ok(sig, "gap fires");
  assert.equal(sig.stop.basis, "gap_day_low");
  assert.equal(sig.stop.level, 109);
  const small = bars.map((b, k) => (k === 80 ? { ...b, open: 105 } : b));
  assert.equal(detectAt("gap_episodic_pivot", small, 80).sig, null, "a 5% gap is not an episodic pivot");
}

// Contract for every entry setup on varied synthetic markets: the stop is a structural level below the signal close,
// minus the setup's ATR buffer, with a basis and a reason. Never a percentage of price.
{
  let total = 0;
  const fired = new Set<string>();
  for (let seed = 1; seed <= 12; seed++) {
    const drifts = segments([60, 0], [50, 0.005], [15, 0.015], [30, -0.002], [40, 0.004], [40, -0.006], [25, -0.015], [40, 0], [60, 0.004]);
    const bars = barsFromDrifts(drifts, { seed, noise: 0.015 }).map((b, k) => ({ ...b, volume: b.volume * (k % 17 === 0 ? 3 : 1) }));
    const f = computeFacts(bars, indexFrom(barsFromDrifts(segments([bars.length, 0.0004]), { seed: 99 })));
    const stages = classifyCycle(f);
    for (let i = 2; i < bars.length; i++) {
      for (const s of ENTRY_SETUPS) {
        const sig = s.detect({ f, i, stages }, s.defaults);
        if (!sig) continue;
        total++;
        fired.add(s.id);
        const atr = f.atr14[i] as number;
        assert.ok(sig.stop.price < bars[i].close, `${s.id} stop below the signal close`);
        assert.ok(Math.abs(sig.stop.price - (sig.stop.level - s.defaults.stopBufferAtr * atr)) < 1e-9, `${s.id} stop = level − buffer × ATR`);
        assert.ok(sig.stop.basis.length > 0);
        assert.match(sig.stop.reason, / \d+\.\d{2} - [\d.]+ ATR$/);
        const pctAway = (bars[i].close - sig.stop.price) / bars[i].close;
        assert.ok(Math.abs(pctAway - 0.05) > 1e-9 || sig.stop.level !== bars[i].close * 0.95, `${s.id} stop is not entry − 5%`);
      }
    }
  }
  assert.ok(total > 20, `setups fire on synthetic data (${total})`);
  assert.ok(fired.size >= 5, `several setups fire (${[...fired].join(", ")})`);
}

console.log("setups.test.ts: ok");
