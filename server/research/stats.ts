import type { EquityPoint } from "./portfolio";

export const MIN_SAMPLE = 30;

export interface CellStats {
  n: number;
  winRate: number | null;
  avgR: number | null;
  expectancyPct: number | null;
  profitFactor: number | null;
  avgWinR: number | null;
  avgLossR: number | null;
  /** Peak-to-trough of cumulative R in exit order. */
  maxDdR: number | null;
  ci95: [number, number] | null;
  tooFew: boolean;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function bootstrapMeanCi(xs: number[], iterations = 1000, seed = 12345): [number, number] | null {
  if (xs.length < 5) return null;
  const rnd = mulberry32(seed);
  const means: number[] = [];
  for (let it = 0; it < iterations; it++) {
    let s = 0;
    for (let k = 0; k < xs.length; k++) s += xs[Math.floor(rnd() * xs.length)];
    means.push(s / xs.length);
  }
  means.sort((a, b) => a - b);
  return [means[Math.floor(0.025 * iterations)], means[Math.floor(0.975 * iterations)]];
}

export function cellStats(trades: { R: number; pct: number; exitDate: string }[]): CellStats {
  const n = trades.length;
  if (!n) return { n, winRate: null, avgR: null, expectancyPct: null, profitFactor: null, avgWinR: null, avgLossR: null, maxDdR: null, ci95: null, tooFew: true };
  const rs = trades.map((t) => t.R);
  const wins = rs.filter((r) => r > 0);
  const losses = rs.filter((r) => r <= 0);
  const sumW = wins.reduce((a, b) => a + b, 0);
  const sumL = losses.reduce((a, b) => a + b, 0);
  let cum = 0;
  let peak = 0;
  let dd = 0;
  for (const t of [...trades].sort((a, b) => a.exitDate.localeCompare(b.exitDate))) {
    cum += t.R;
    peak = Math.max(peak, cum);
    dd = Math.max(dd, peak - cum);
  }
  return {
    n,
    winRate: wins.length / n,
    avgR: rs.reduce((a, b) => a + b, 0) / n,
    expectancyPct: trades.reduce((a, t) => a + t.pct, 0) / n,
    profitFactor: sumL < 0 ? sumW / -sumL : null,
    avgWinR: wins.length ? sumW / wins.length : null,
    avgLossR: losses.length ? sumL / losses.length : null,
    maxDdR: dd,
    ci95: bootstrapMeanCi(rs),
    tooFew: n < MIN_SAMPLE,
  };
}

export interface EquityStats {
  totalReturn: number;
  cagr: number;
  maxDd: number;
  maxDdSessions: number;
  exposure: number;
  sharpe: number | null;
}

export function equityStats(curve: EquityPoint[], start: number): EquityStats {
  const last = curve.length ? curve[curve.length - 1].equity : start;
  let peak = start;
  let peakIdx = -1;
  let maxDd = 0;
  let maxLen = 0;
  const rets: number[] = [];
  let prev = start;
  curve.forEach((p, i) => {
    rets.push(p.equity / prev - 1);
    prev = p.equity;
    if (p.equity >= peak) {
      peak = p.equity;
      peakIdx = i;
    } else {
      maxDd = Math.max(maxDd, 1 - p.equity / peak);
      maxLen = Math.max(maxLen, i - peakIdx);
    }
  });
  const mean = rets.reduce((a, b) => a + b, 0) / Math.max(1, rets.length);
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, rets.length - 1));
  const years = curve.length / 252;
  return {
    totalReturn: last / start - 1,
    cagr: years > 0 ? (last / start) ** (1 / years) - 1 : 0,
    maxDd,
    maxDdSessions: maxLen,
    exposure: curve.length ? curve.filter((p) => p.positions > 0).length / curve.length : 0,
    sharpe: sd > 0 ? (mean / sd) * Math.sqrt(252) : null,
  };
}

export function buyAndHold(closes: { date: string; open: number; close: number }[]): { totalReturn: number; maxDd: number } | null {
  if (closes.length < 2) return null;
  const start = closes[0].open;
  let peak = start;
  let dd = 0;
  for (const c of closes) {
    peak = Math.max(peak, c.close);
    dd = Math.max(dd, 1 - c.close / peak);
  }
  return { totalReturn: closes[closes.length - 1].close / start - 1, maxDd: dd };
}
