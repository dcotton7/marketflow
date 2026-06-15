import type { SetupBar } from "./types";
import { emptyResult, hitResult } from "./result-helpers";

function calcEma(values: number[], period: number): number {
  if (values.length < period) return 0;
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < values.length; i++) {
    ema = values[i]! * k + ema * (1 - k);
  }
  return ema;
}

function calcSma(values: number[], period: number): number {
  if (values.length < period) return 0;
  const slice = values.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / slice.length;
}

/** Undercut & rally on chronological daily bars. */
export function detectUndercutAndRally(
  bars: SetupBar[],
  opts?: {
    maPeriod?: number;
    maType?: "sma" | "ema";
    lookback?: number;
    maxUndercutBars?: number;
    minUndercutPct?: number;
  }
) {
  const maPeriod = opts?.maPeriod ?? 21;
  const maType = opts?.maType ?? "ema";
  const lookback = opts?.lookback ?? 10;
  const maxUndercutBars = opts?.maxUndercutBars ?? 5;
  const minUndercutPct = opts?.minUndercutPct ?? 0.5;

  if (bars.length < maPeriod + lookback + 5) return emptyResult("undercut_rally", "O5");

  const closes = bars.map((b) => b.close);
  const currentPrice = closes[closes.length - 1]!;
  const maAt = (endIdx: number): number => {
    const slice = closes.slice(0, endIdx + 1);
    if (slice.length < maPeriod) return 0;
    return maType === "sma" ? calcSma(slice, maPeriod) : calcEma(slice, maPeriod);
  };

  const currentMA = maAt(closes.length - 1);
  if (currentPrice <= currentMA) return emptyResult("undercut_rally", "O5");

  const n = bars.length;
  for (let rallyOffset = 0; rallyOffset < lookback; rallyOffset++) {
    const rallyIdx = n - 1 - rallyOffset;
    const prevIdx = rallyIdx - 1;
    if (prevIdx < maPeriod) continue;

    const rallyMA = maAt(rallyIdx);
    const prevMA = maAt(prevIdx);
    const rallyPrice = bars[rallyIdx]!.close;
    const prevPrice = bars[prevIdx]!.close;

    if (prevPrice > prevMA || rallyPrice <= rallyMA) continue;

    let undercutBar = -1;
    let undercutDepth = 0;
    let barsBelow = 0;
    let undercutLow = Infinity;

    for (let i = prevIdx - 1; i >= Math.max(maPeriod, prevIdx - maxUndercutBars - 3); i--) {
      const barPrice = bars[i]!.close;
      const barMA = maAt(i);
      if (barMA === 0) break;

      if (barPrice < barMA) {
        barsBelow++;
        const depth = ((barMA - barPrice) / barMA) * 100;
        if (depth > undercutDepth) {
          undercutDepth = depth;
          undercutBar = i;
        }
        if (barPrice < undercutLow) undercutLow = barPrice;
      } else if (barsBelow > 0) {
        break;
      }
    }

    if (undercutBar < 0 || barsBelow > maxUndercutBars || undercutDepth < minUndercutPct) continue;

    const daysSinceRally = n - 1 - rallyIdx;
    let stage: "ready" | "triggered" | "extended" = "ready";
    if (daysSinceRally <= 1 && currentPrice > rallyPrice) stage = "triggered";
    if (daysSinceRally <= 1 && currentPrice > rallyPrice * 1.05) stage = "extended";

    const confidence = Math.round((70 + Math.min(15, undercutDepth * 2)) * 100) / 100;
    return hitResult("undercut_rally", "O5", stage, confidence, rallyMA, undercutLow, currentPrice * 1.08, {
      undercutDepthPct: undercutDepth.toFixed(1),
      barsBelow,
      maPeriod,
      maType,
    });
  }

  return emptyResult("undercut_rally", "O5");
}

function maLabel(period: number, maType: "sma" | "ema"): string {
  return `${period} ${maType === "sma" ? "SMA" : "EMA"}`;
}

function hitScore(result: ReturnType<typeof hitResult>): number {
  if (!result.detected) return 0;
  let score = result.confidence;
  if (result.diagnostics?.reclaimOnLastBar) score += 18;
  if (result.diagnostics?.maPeriod === 20 && result.diagnostics?.maType === "sma") score += 8;
  if (result.stage === "triggered") score += 12;
  else if (result.stage === "ready") score += 6;
  return score;
}

/**
 * Short PB: price was above MA, dipped below for 1–N bars, last bar reclaimed — buyable U&R.
 */
export function detectMaUrReclaimOnLastBar(
  bars: SetupBar[],
  maPeriod: number,
  maType: "sma" | "ema",
  opts?: {
    maxUndercutBars?: number;
    minUndercutPct?: number;
  }
) {
  const maxUndercutBars = opts?.maxUndercutBars ?? 6;
  const minUndercutPct = opts?.minUndercutPct ?? 0.08;

  if (bars.length < maPeriod + 8) return emptyResult("undercut_rally", "O5");

  const closes = bars.map((b) => b.close);
  const n = bars.length;
  const last = n - 1;

  const maAt = (endIdx: number): number => {
    const slice = closes.slice(0, endIdx + 1);
    if (slice.length < maPeriod) return 0;
    return maType === "sma" ? calcSma(slice, maPeriod) : calcEma(slice, maPeriod);
  };

  const lastBar = bars[last]!;
  const lastClose = closes[last]!;
  const lastMa = maAt(last);
  if (lastMa === 0 || lastClose <= lastMa * 0.998) return emptyResult("undercut_rally", "O5");

  let barsBelow = 0;
  let undercutDepth = 0;
  let undercutLow = Infinity;
  let undercutStart = -1;

  for (let i = last - 1; i >= Math.max(maPeriod, last - maxUndercutBars - 2); i--) {
    const bar = bars[i]!;
    const barMA = maAt(i);
    if (barMA === 0) break;

    const pierced = bar.low < barMA || bar.close < barMA;
    if (pierced) {
      barsBelow++;
      undercutStart = i;
      const depth = ((barMA - bar.low) / barMA) * 100;
      if (depth > undercutDepth) undercutDepth = depth;
      if (bar.low < undercutLow) undercutLow = bar.low;
    } else if (barsBelow > 0) {
      break;
    }
  }

  if (barsBelow < 1 || barsBelow > maxUndercutBars || undercutDepth < minUndercutPct) {
    return emptyResult("undercut_rally", "O5");
  }

  const beforeIdx = undercutStart - 1;
  if (beforeIdx < maPeriod) return emptyResult("undercut_rally", "O5");
  const beforeMa = maAt(beforeIdx);
  if (beforeMa === 0 || closes[beforeIdx]! < beforeMa * 0.995) return emptyResult("undercut_rally", "O5");

  const confidence = Math.round((72 + Math.min(18, undercutDepth * 2.5) + (barsBelow <= 3 ? 6 : 0)) * 100) / 100;

  return hitResult(
    "undercut_rally",
    "O5",
    "triggered",
    confidence,
    lastMa,
    undercutLow,
    lastClose * 1.06,
    {
      undercutDepthPct: undercutDepth.toFixed(2),
      barsBelow,
      maPeriod,
      maType,
      maLabel: maLabel(maPeriod, maType),
      reclaimOnLastBar: true,
      buyableNow: true,
      anchor: "last_bar_reclaim",
    }
  );
}

/**
 * U&R using the chart's precomputed MA series (e.g. SMA21 shown as 20d on the chart).
 */
export function detectUrFromMaSeries(
  bars: SetupBar[],
  maSeries: (number | null)[],
  label: string
) {
  const n = Math.min(bars.length, maSeries.length);
  if (n < 25) return emptyResult("undercut_rally", "O5");

  const last = bars.length - 1;
  const lastMa = maSeries[last];
  const lastBar = bars[last]!;
  if (lastMa == null || lastMa <= 0 || lastBar.close <= lastMa * 0.998) {
    return emptyResult("undercut_rally", "O5");
  }

  let barsBelow = 0;
  let undercutDepth = 0;
  let undercutLow = Infinity;
  let undercutStart = -1;

  for (let i = last - 1; i >= Math.max(0, last - 7); i--) {
    const ma = maSeries[i];
    if (ma == null || ma <= 0) break;
    const bar = bars[i]!;
    const pierced = bar.low < ma || bar.close < ma;
    if (pierced) {
      barsBelow++;
      undercutStart = i;
      const depth = ((ma - bar.low) / ma) * 100;
      if (depth > undercutDepth) undercutDepth = depth;
      if (bar.low < undercutLow) undercutLow = bar.low;
    } else if (barsBelow > 0) {
      break;
    }
  }

  if (barsBelow < 1 || barsBelow > 6 || undercutDepth < 0.08) {
    return emptyResult("undercut_rally", "O5");
  }

  const beforeIdx = undercutStart - 1;
  if (beforeIdx < 0) return emptyResult("undercut_rally", "O5");
  const beforeMa = maSeries[beforeIdx];
  if (beforeMa == null || bars[beforeIdx]!.close < beforeMa * 0.995) {
    return emptyResult("undercut_rally", "O5");
  }

  const confidence = Math.round((78 + Math.min(16, undercutDepth * 2.5) + (barsBelow <= 3 ? 8 : 0)) * 100) / 100;

  return hitResult(
    "undercut_rally",
    "O5",
    "triggered",
    confidence,
    lastMa,
    undercutLow,
    lastBar.close * 1.06,
    {
      undercutDepthPct: undercutDepth.toFixed(2),
      barsBelow,
      maLabel: label,
      reclaimOnLastBar: true,
      buyableNow: true,
      anchor: "last_bar_reclaim",
      source: "chart_ma_series",
    }
  );
}

/** Try chart SMA21, 20/21/50 computed MAs — prefer fresh last-bar reclaim (e.g. 20d U&R). */
export function detectBestUndercutRally(
  bars: SetupBar[],
  opts?: { sma21Series?: (number | null)[]; sma50Series?: (number | null)[] }
) {
  const configs: { maPeriod: number; maType: "sma" | "ema" }[] = [
    { maPeriod: 20, maType: "sma" },
    { maPeriod: 21, maType: "sma" },
    { maPeriod: 21, maType: "ema" },
    { maPeriod: 50, maType: "sma" },
  ];

  let best: ReturnType<typeof hitResult> | null = null;
  let bestScore = 0;

  const candidates: ReturnType<typeof hitResult>[] = [];

  if (opts?.sma21Series?.length) {
    candidates.push(detectUrFromMaSeries(bars, opts.sma21Series, "20 SMA"));
  }
  if (opts?.sma50Series?.length) {
    candidates.push(detectUrFromMaSeries(bars, opts.sma50Series, "50 SMA"));
  }

  for (const cfg of configs) {
    candidates.push(
      detectMaUrReclaimOnLastBar(bars, cfg.maPeriod, cfg.maType),
      detectUndercutAndRally(bars, {
        maPeriod: cfg.maPeriod,
        maType: cfg.maType,
        lookback: 12,
        maxUndercutBars: 6,
        minUndercutPct: 0.08,
      })
    );
  }

  for (const hit of candidates) {
    let score = hitScore(hit);
    if (hit.diagnostics?.source === "chart_ma_series") score += 22;
    if (score > bestScore) {
      bestScore = score;
      best = hit;
    }
  }

  return best ?? emptyResult("undercut_rally", "O5");
}
