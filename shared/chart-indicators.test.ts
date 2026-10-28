import assert from "node:assert/strict";
import {
  atrMultipleFromMa,
  atrxFrom50,
  calculateAtr,
  calculateEMA,
  calculateSMA,
  calculateSessionVwap,
  chartInfoSnapshot,
} from "./chart-indicators";

// The copies MiniChart.tsx and lib/mini-chart-indicators.ts had before the move, kept as the reference.
function legacySma(data: { close: number }[], period: number): (number | null)[] {
  const sma: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) sma.push(null);
    else sma.push(data.slice(i - period + 1, i + 1).reduce((acc, d) => acc + d.close, 0) / period);
  }
  return sma;
}
function legacyMiniEma(data: { close: number }[], period: number): (number | null)[] {
  const ema: (number | null)[] = [];
  const multiplier = 2 / (period + 1);
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) ema.push(null);
    else if (i === period - 1) ema.push(data.slice(0, period).reduce((acc, d) => acc + d.close, 0) / period);
    else {
      const prevEma = ema[i - 1];
      ema.push(prevEma !== null ? (data[i].close - prevEma) * multiplier + prevEma : null);
    }
  }
  return ema;
}
function legacyLibEma(data: { close: number }[], period: number): (number | null)[] {
  const ema: (number | null)[] = [];
  const k = 2 / (period + 1);
  let prev: number | null = null;
  for (let i = 0; i < data.length; i++) {
    if (prev === null) {
      if (i < period - 1) { ema.push(null); continue; }
      prev = data.slice(i - period + 1, i + 1).reduce((acc, d) => acc + d.close, 0) / period;
      ema.push(prev);
    } else {
      prev = data[i].close * k + prev * (1 - k);
      ema.push(prev);
    }
  }
  return ema;
}
function legacyAtr(data: { high: number; low: number; close: number }[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let trSum = 0;
  const trWindow: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const cur = data[i];
    const prevClose = i > 0 ? data[i - 1].close : cur.close;
    const tr = Math.max(cur.high - cur.low, Math.abs(cur.high - prevClose), Math.abs(cur.low - prevClose));
    trWindow.push(tr);
    trSum += tr;
    if (trWindow.length > period) trSum -= trWindow.shift() ?? 0;
    out.push(trWindow.length === period ? trSum / period : null);
  }
  return out;
}
function legacyMiniVwap(bars: { date: string; high: number; low: number; close: number; volume: number }[]) {
  let cumPv = 0, cumVol = 0;
  let sessionKey: string | null = null;
  const out: (number | null)[] = [];
  for (const bar of bars) {
    const key = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" })
      .format(new Date(bar.date));
    if (key !== sessionKey) { sessionKey = key; cumPv = 0; cumVol = 0; }
    const v = Math.max(Number(bar.volume) || 0, 0);
    cumPv += ((bar.high + bar.low + bar.close) / 3) * v;
    cumVol += v;
    out.push(cumVol > 0 ? cumPv / cumVol : null);
  }
  return out;
}

// Deterministic fixture: 260 daily bars with a trend, swings and gaps; 3 sessions of 5-minute bars.
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const daily: Array<{ date: string; open: number; high: number; low: number; close: number; volume: number }> = [];
let px = 50;
for (let i = 0; i < 260; i++) {
  const open = px * (1 + (rnd() - 0.5) * 0.03);
  const close = open * (1 + (rnd() - 0.45) * 0.05);
  const high = Math.max(open, close) * (1 + rnd() * 0.02);
  const low = Math.min(open, close) * (1 - rnd() * 0.02);
  daily.push({ date: new Date(Date.UTC(2025, 0, 2 + i)).toISOString().slice(0, 10), open, high, low, close, volume: 1e6 * (1 + rnd()) });
  px = close;
}
const intraday: typeof daily = [];
for (let d = 0; d < 3; d++) {
  for (let k = 0; k < 78; k++) {
    const t = Date.UTC(2026, 9, 26 + d, 13, 30) + k * 300_000;
    const open = px, close = px * (1 + (rnd() - 0.5) * 0.004);
    intraday.push({ date: new Date(t).toISOString(), open, close, high: Math.max(open, close) * 1.001,
      low: Math.min(open, close) * 0.999, volume: k === 5 ? 0 : 1e4 * (1 + rnd()) });
    px = close;
  }
}

const near = (a: (number | null)[], b: (number | null)[], tol: number, what: string) => {
  assert.equal(a.length, b.length, what);
  a.forEach((x, i) => {
    const y = b[i];
    if (x === null || y === null) assert.equal(x, y, `${what} [${i}] null`);
    else assert.ok(Math.abs(x - y) <= tol * Math.max(1, Math.abs(y)), `${what} [${i}] ${x} vs ${y}`);
  });
};

for (const p of [5, 10, 20, 50, 200]) assert.deepEqual(calculateSMA(daily, p), legacySma(daily, p), `SMA ${p}`);
for (const p of [6, 10, 20, 21]) {
  assert.deepEqual(calculateEMA(daily, p), legacyMiniEma(daily, p), `EMA ${p} = MiniChart's`);
  near(calculateEMA(daily, p), legacyLibEma(daily, p), 1e-12, `EMA ${p} vs the lib copy (same formula, rearranged)`);
}
assert.deepEqual(calculateAtr(daily, 14), legacyAtr(daily, 14), "ATR14");
assert.deepEqual(calculateSessionVwap(intraday), legacyMiniVwap(intraday), "session VWAP");
assert.equal(calculateSessionVwap([{ date: "2026-10-26T13:30:00Z", high: 1, low: 1, close: 1, volume: 0 }])[0], null);

const last = daily[daily.length - 1].close;
const s50 = legacySma(daily, 50)[259]!;
const atr = legacyAtr(daily, 14)[259]!;
assert.equal(atrxFrom50(last, daily), (last - s50) / atr, "ATRx from 50MA = the chart's formula");
assert.equal(atrMultipleFromMa(last, daily, 50), atrxFrom50(last, daily));
assert.equal(atrxFrom50(last, daily.slice(0, 40)), null, "not enough bars");
assert.equal(atrxFrom50(0, daily), null);
const info = chartInfoSnapshot(last, daily, 40)!;
assert.equal(info.pctFromEntry, ((last - 40) / 40) * 100);
assert.equal(info.pctFrom200Dma, ((last - legacySma(daily, 200)[259]!) / legacySma(daily, 200)[259]!) * 100);
assert.equal(info.adrsFrom50, atrxFrom50(last, daily));

// A hand-checked case: flat 100 with a 2-point range, then a jump to 120.
const flat = Array.from({ length: 60 }, () => ({ high: 101, low: 99, close: 100 }));
assert.equal(atrxFrom50(100, flat), 0);
assert.equal(atrxFrom50(114, flat), 7, "7 ATRs above the 50-day");

console.log("chart indicators ok");
