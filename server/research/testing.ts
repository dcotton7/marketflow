import type { IndexCloses } from "./facts";
import type { DailyBar } from "./types";

/** Deterministic synthetic bars for the research tests. */

export function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function tradingDates(start: string, count: number): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T12:00:00Z`);
  while (out.length < count) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** Bars from a list of daily drifts (fraction per day) with seeded noise. */
export function barsFromDrifts(drifts: number[], opts: { start?: string; price?: number; seed?: number; noise?: number; volume?: number } = {}): DailyBar[] {
  const rnd = prng(opts.seed ?? 1);
  const dates = tradingDates(opts.start ?? "2024-12-02", drifts.length);
  let close = opts.price ?? 100;
  const noise = opts.noise ?? 0.01;
  return drifts.map((drift, i) => {
    const open = close * (1 + (rnd() - 0.5) * noise);
    close = Math.max(1, close * (1 + drift + (rnd() - 0.5) * noise * 2));
    const high = Math.max(open, close) * (1 + rnd() * noise);
    const low = Math.min(open, close) * (1 - rnd() * noise);
    return { date: dates[i], open, high, low, close, volume: Math.round((opts.volume ?? 2_000_000) * (0.7 + rnd() * 0.6)) };
  });
}

export function flatBars(n: number, price = 100, start = "2024-12-02"): DailyBar[] {
  return tradingDates(start, n).map((date) => ({ date, open: price, high: price * 1.005, low: price * 0.995, close: price, volume: 1_000_000 }));
}

export function indexFrom(bars: DailyBar[]): IndexCloses {
  const m = new Map(bars.map((b) => [b.date, b.close]));
  return { spy: m, qqq: m };
}

export function segments(...parts: [number, number][]): number[] {
  return parts.flatMap(([days, drift]) => new Array(days).fill(drift));
}
