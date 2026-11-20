/**
 * The scanner's gaps for the Leader Shakeout (research/bounce/03-scan-definitions.md, "Can MarketFlow's own scanner
 * express these today?"): RSI down to period 2 (with Wilder's method), a one-day move in ATRs (VLT-6), and a 20-day
 * average dollar volume floor (VOL-6). Made-up bars only.
 */
import assert from "node:assert/strict";
import { INDICATOR_LIBRARY, normalizeResult, type CandleData } from "./indicators";
import { series } from "../setups/fixtures";
import { evaluateLast } from "../setups/leader-shakeout";
import { rsi2Series } from "../setups/daily-math";

const ind = (id: string) => {
  const d = INDICATOR_LIBRARY.find((x) => x.id === id);
  assert.ok(d, id);
  return d!;
};
const run = (id: string, candles: CandleData[], params: Record<string, any>) => normalizeResult(ind(id).evaluate(candles, params));
const newestFirst = (b: { date: string; open: number; high: number; low: number; close: number; volume: number }[]) => [...b].reverse();

/** RS-4 exactly as it was before this change, for the "saved scans behave as before" check. */
function oldRs4(candles: CandleData[], params: Record<string, any>) {
  const skip = params.skipBars ?? 0, period = params.period ?? 14, minRSI = params.minRSI ?? 50, maxRSI = params.maxRSI ?? 80;
  if (candles.length < skip + period + 1) return { pass: false, value: "insufficient data" };
  const c = skip > 0 ? candles.slice(skip) : candles;
  let g = 0, l = 0;
  for (let i = 0; i < period; i++) { const ch = c[i].close - c[i + 1].close; if (ch > 0) g += ch; else l += Math.abs(ch); }
  const rsi = l === 0 ? 100 : 100 - 100 / (1 + g / period / (l / period));
  return { pass: rsi >= minRSI && rsi <= maxRSI, value: rsi.toFixed(1) };
}

// a seeded random walk, newest first
function walk(n: number, seed: number): CandleData[] {
  let x = seed, c = 50;
  const rnd = () => ((x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const out: CandleData[] = [];
  for (let i = 0; i < n; i++) {
    c = Math.max(1, c * (1 + (rnd() - 0.5) * 0.06));
    out.push({ date: `d${i}`, open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 1e6 * (0.5 + rnd()) });
  }
  return out.reverse();
}

// ---- RS-4: saved scans (no method, periods 5-50) give exactly what they gave before -----------------------------
{
  let checked = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const c = walk(120, seed);
    for (const period of [5, 7, 14, 21, 50]) for (const [minRSI, maxRSI] of [[50, 80], [0, 30], [30, 70], [70, 100]]) for (const skipBars of [0, 3]) {
      const p = { period, minRSI, maxRSI, skipBars };
      const a = run("RS-4", c, p), b = oldRs4(c, p);
      assert.equal(a.pass, b.pass, JSON.stringify(p));
      assert.equal(a.data?._diagnostics?.value, b.value, JSON.stringify(p));
      checked++;
    }
  }
  assert.ok(checked > 1000);
  const period = ind("RS-4").params.find((p) => p.name === "period")!;
  assert.equal(period.min, 2, "RSI period can go down to 2");
  assert.equal(period.defaultValue, 14);
  assert.equal(ind("RS-4").params.find((p) => p.name === "method")!.defaultValue, "simple", "the old formula stays the default");
}

// ---- RS-4 period 2, Wilder: the research RSI(2) ------------------------------------------------------------------
{
  const b = series();
  const want = rsi2Series(b)[b.length - 1];
  const r = run("RS-4", newestFirst(b), { period: 2, method: "wilder", minRSI: 0, maxRSI: 5 });
  assert.equal(r.pass, true);
  assert.equal(r.data?._diagnostics?.value, want.toFixed(1));
  assert.equal(run("RS-4", newestFirst(series({ dips: [] })), { period: 2, method: "wilder", minRSI: 0, maxRSI: 5 }).pass, false, "RSI(2) above 5");
  // simple RSI(2) is a different number on the same bars (why the method exists)
  assert.notEqual(run("RS-4", newestFirst(b), { period: 2, minRSI: 0, maxRSI: 100 }).data?._diagnostics?.value, want.toFixed(1));
  assert.equal(run("RS-4", newestFirst(b).slice(0, 15), { period: 2, method: "wilder", minRSI: 0, maxRSI: 100 }).pass, false, "Wilder needs 20+ bars");
}

// ---- VLT-6: one-day move in ATRs ---------------------------------------------------------------------------------
{
  const hit = evaluateLast(series())!;
  const c = newestFirst(series());
  const r = run("VLT-6", c, { atrPeriod: 14, direction: "decline", minAtr: 2 });
  assert.equal(r.pass, true);
  assert.ok(Math.abs(r.data!.moveAtr + hit.dropAtr) < 1e-9, "same ATRs as the Leader Shakeout job (ATR of the 14 bars before)");
  const small = newestFirst(series({ half: 1.6 })); // 1.5 ATR
  assert.equal(run("VLT-6", small, { direction: "decline", minAtr: 2 }).pass, false, "near miss: 1.5 ATR");
  assert.equal(run("VLT-6", small, { direction: "decline", minAtr: 1.5 }).pass, true);
  assert.equal(run("VLT-6", c, { direction: "gain", minAtr: 2 }).pass, false, "a drop is not a gain");
  assert.equal(run("VLT-6", c, { direction: "any", minAtr: 2 }).pass, true);
  assert.equal(run("VLT-6", c, { direction: "decline", minAtr: 2, maxAtr: hit.dropAtr - 0.01 }).pass, false, "above the max");
  assert.equal(run("VLT-6", c.slice(0, 10), { direction: "decline" }).pass, false, "insufficient data");
}

// ---- VOL-6: average dollar volume, prior 20 sessions by default --------------------------------------------------
{
  const hit = evaluateLast(series())!;
  const c = newestFirst(series());
  const r = run("VOL-6", c, { period: 20, minDollarVolM: 30 });
  assert.equal(r.pass, true);
  assert.ok(Math.abs(r.data!.avgDollarVolM * 1e6 - hit.dollarVol20Prev) < 1e-3, "same as the job's prior 20-day dollar volume");
  const thin = newestFirst(series({ volume: 230_000 })); // about $24M
  assert.equal(run("VOL-6", thin, { minDollarVolM: 30 }).pass, false, "near miss: $24M");
  assert.equal(run("VOL-6", thin, { minDollarVolM: 20 }).pass, true);
  // today's 2.5x volume does not lift the prior-window average; with includeToday it does
  const withToday = run("VOL-6", c, { minDollarVolM: 0, includeToday: true }).data!.avgDollarVolM;
  assert.ok(withToday > r.data!.avgDollarVolM);
  assert.equal(run("VOL-6", c, { minDollarVolM: 30, maxDollarVolM: 50 }).pass, false, "above the max");
  assert.equal(run("VOL-6", c, { minDollarVolM: 30, maxDollarVolM: 0 }).pass, true, "0 = no max");
}

// ---- the whole Leader Shakeout as a user-built scan: same verdict as the job on the same bars -----------------------
{
  const scan = (b: ReturnType<typeof series>) => {
    const c = newestFirst(b);
    return [
      c[0].close >= 6,
      run("VOL-6", c, { period: 20, minDollarVolM: 30 }).pass,
      run("VLT-6", c, { atrPeriod: 14, direction: "decline", minAtr: 2 }).pass,
      run("PA-18", c, { startBar: 1, period: 1, changeType: "decline", minChangePct: 4 }).pass,
      run("VOL-1", c, { period: 20, minMultiple: 2 }).pass,
      run("PA-18", c, { startBar: 21, period: 20, changeType: "gain", minChangePct: 10 }).pass,
      run("RS-4", c, { period: 2, method: "wilder", minRSI: 0, maxRSI: 4.999 }).pass,
    ].every(Boolean);
  };
  for (const shape of [{}, { volume: 230_000 }, { half: 1.6 }, { drop: 4.3, half: 0.4 }, { dropVolMult: 1.9 }, { rise: 0.48 }, { dips: [] }]) {
    assert.equal(scan(series(shape)), evaluateLast(series(shape))!.hit, JSON.stringify(shape));
  }
}

// every other indicator is untouched: ids are unique and the two new ones are additions
{
  const ids = INDICATOR_LIBRARY.map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes("VLT-6") && ids.includes("VOL-6"));
}
console.log("scanner setup-indicator tests passed");
