import type { DBar } from "./daily-math";

// Made-up daily bars for the setup tests (no market data).
/** Weekday session dates from Mon 5 Jan 2026. */
export function sessions(n: number, start = "2026-01-05"): string[] {
  const out: string[] = [];
  let t = Date.parse(start + "T12:00:00Z");
  while (out.length < n) {
    const wd = new Date(t).getUTCDay();
    if (wd >= 1 && wd <= 5) out.push(new Date(t).toISOString().slice(0, 10));
    t += 864e5;
  }
  return out;
}

export interface Shape {
  scale?: number; // multiplies every price
  rise?: number; // close gain per day over the 20 days before the dips
  dips?: number[]; // the closes' changes on the days just before the drop
  drop?: number; // prev_close - close on the drop day
  half?: number; // high/low distance from the close on the days before the drop
  volume?: number;
  dropVolMult?: number;
  gapAtrs?: number; // open on the drop day = prev_close - gapAtrs x half x 2 (about 1 ATR per unit)
}

/** 18 flat days at 100, then a steady rise, the dips, and the drop day last. */
export function series(s: Shape = {}): DBar[] {
  const { scale = 1, rise = 0.6, dips = [-0.3, -0.3], drop = 5, half = 1, volume = 500_000, dropVolMult = 2.5, gapAtrs = 0 } = s;
  const closes: number[] = [];
  for (let i = 0; i < 18; i++) closes.push(100 + (i % 2 ? 0.2 : -0.2));
  let c = 100;
  for (let i = 0; i < 20; i++) closes.push((c += rise));
  for (const d of dips) closes.push((c += d));
  const n = closes.length + 1;
  const dates = sessions(n);
  const b: DBar[] = closes.map((x, i) => ({ date: dates[i], open: x, high: x + half, low: x - half, close: x, volume }));
  const prev = closes[closes.length - 1];
  const close = prev - drop;
  const open = gapAtrs ? prev - gapAtrs * 2 * half : prev;
  b.push({ date: dates[n - 1], open, high: Math.max(open, prev) + 0.1, low: close - 0.2, close, volume: volume * dropVolMult });
  return b.map((x) => ({ ...x, open: x.open * scale, high: x.high * scale, low: x.low * scale, close: x.close * scale, volume: x.volume / scale }));
}

