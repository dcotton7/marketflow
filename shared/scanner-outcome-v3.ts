// ---------------------------------------------------------------------------
// Scanner Outcome Contract V3 — exact intraday checkpoints + bar-bounded MFE/MAE
//
// Pure helpers only. V2 used live prints for due checkpoints (wrong clock) and
// sparse live MFE/MAE. V3 resolves the closest eligible 5-minute bar at the
// requested horizon and derives excursion from bars within that window.
// ---------------------------------------------------------------------------

export const OUTCOME_CONTRACT_V2 = "v2";
export const OUTCOME_CONTRACT_V3 = "v3";
export type OutcomeContractVersion = typeof OUTCOME_CONTRACT_V2 | typeof OUTCOME_CONTRACT_V3;

export type OutcomeWindowKey =
  | "15m"
  | "30m"
  | "1hr"
  | "4hr"
  | "d1_close"
  | "d2_open"
  | "d2_close"
  | "1w"
  | "1mo";

export const INTRADAY_WINDOWS: ReadonlyArray<{ key: OutcomeWindowKey; offsetMin: number }> = [
  { key: "15m", offsetMin: 15 },
  { key: "30m", offsetMin: 30 },
  { key: "1hr", offsetMin: 60 },
  { key: "4hr", offsetMin: 240 },
];

export type OutcomeBar = {
  t: number;
  o?: number;
  h?: number;
  l?: number;
  c: number;
};

export type SignalDirection = "up" | "down" | "neutral";

/** Signed % move from signal price to a later price. */
export function moveFrom(price: number, signalPrice: number): number {
  if (!Number.isFinite(price) || !Number.isFinite(signalPrice) || signalPrice === 0) {
    return Number.NaN;
  }
  return ((price - signalPrice) / signalPrice) * 100;
}

/** Direction-adjusted edge: positive = favorable for the signal. */
export function directionAdjustedMove(
  movePct: number,
  direction: SignalDirection
): number {
  if (!Number.isFinite(movePct)) return Number.NaN;
  if (direction === "down") return -movePct;
  if (direction === "neutral") return Math.abs(movePct);
  return movePct;
}

/**
 * Closest bar close at/after target within maxSkewMs.
 * Prefer bars at or after the horizon so we never fill with a pre-horizon print.
 */
export function resolveExactCheckpointClose(
  bars: readonly OutcomeBar[],
  targetMs: number,
  maxSkewMs: number = 25 * 60_000
): { price: number; barT: number } | null {
  if (!bars.length) return null;

  let bestAtOrAfter: OutcomeBar | null = null;
  let bestAtOrAfterDiff = Infinity;
  let bestAny: OutcomeBar | null = null;
  let bestAnyDiff = Infinity;

  for (const bar of bars) {
    const diff = Math.abs(bar.t - targetMs);
    if (diff < bestAnyDiff) {
      bestAnyDiff = diff;
      bestAny = bar;
    }
    if (bar.t >= targetMs && bar.t - targetMs < bestAtOrAfterDiff) {
      bestAtOrAfterDiff = bar.t - targetMs;
      bestAtOrAfter = bar;
    }
  }

  if (bestAtOrAfter && bestAtOrAfterDiff <= maxSkewMs) {
    return { price: bestAtOrAfter.c, barT: bestAtOrAfter.t };
  }
  if (bestAny && bestAnyDiff <= maxSkewMs) {
    return { price: bestAny.c, barT: bestAny.t };
  }
  return null;
}

export type HorizonExcursion = {
  /** Favorable peak % (always >= 0 for directional signals). */
  mfe: number;
  /** Adverse trough % (always <= 0 for directional signals). */
  mae: number;
  peakPrice: number | null;
  troughPrice: number | null;
  peakAtMs: number | null;
  troughAtMs: number | null;
  givebackPct: number;
};

/**
 * MFE/MAE from bars inside [signalAt, signalAt + horizonMin].
 * Uses bar high/low when present, otherwise close.
 */
export function computeHorizonExcursion(
  bars: readonly OutcomeBar[],
  signalAtMs: number,
  signalPrice: number,
  direction: SignalDirection,
  horizonMin: number,
  currentClose?: number | null
): HorizonExcursion | null {
  if (!Number.isFinite(signalPrice) || signalPrice <= 0) return null;
  const endMs = signalAtMs + horizonMin * 60_000;
  const windowBars = bars.filter((b) => b.t >= signalAtMs && b.t <= endMs + 60_000);
  if (windowBars.length === 0 && (currentClose == null || currentClose <= 0)) return null;

  let mfe = 0;
  let mae = 0;
  let peakPrice: number | null = null;
  let troughPrice: number | null = null;
  let peakAtMs: number | null = null;
  let troughAtMs: number | null = null;

  const consider = (price: number, t: number) => {
    if (!Number.isFinite(price) || price <= 0) return;
    const move = moveFrom(price, signalPrice);
    if (!Number.isFinite(move)) return;

    if (direction === "up") {
      if (move > mfe) {
        mfe = move;
        peakPrice = price;
        peakAtMs = t;
      }
      if (move < mae) {
        mae = move;
        troughPrice = price;
        troughAtMs = t;
      }
    } else if (direction === "down") {
      const fav = -move;
      if (fav > mfe) {
        mfe = fav;
        peakPrice = price;
        peakAtMs = t;
      }
      if (move > 0 && -move < mae) {
        // adverse for short = price up; store as negative MAE
        mae = -move;
        troughPrice = price;
        troughAtMs = t;
      }
    } else {
      const abs = Math.abs(move);
      if (abs > mfe) {
        mfe = abs;
        peakPrice = price;
        peakAtMs = t;
      }
      if (move < mae) {
        mae = move;
        troughPrice = price;
        troughAtMs = t;
      }
    }
  };

  for (const bar of windowBars) {
    if (direction === "up") {
      consider(bar.h ?? bar.c, bar.t);
      consider(bar.l ?? bar.c, bar.t);
    } else if (direction === "down") {
      consider(bar.l ?? bar.c, bar.t);
      consider(bar.h ?? bar.c, bar.t);
    } else {
      consider(bar.h ?? bar.c, bar.t);
      consider(bar.l ?? bar.c, bar.t);
      consider(bar.c, bar.t);
    }
  }

  if (currentClose != null && currentClose > 0) {
    consider(currentClose, Math.min(Date.now(), endMs));
  }

  const lastClose =
    currentClose != null && currentClose > 0
      ? currentClose
      : windowBars.length
        ? windowBars[windowBars.length - 1]!.c
        : null;
  let givebackPct = 0;
  if (lastClose != null && mfe > 0) {
    const lastMove = moveFrom(lastClose, signalPrice);
    const favorableNow =
      direction === "down"
        ? Math.max(-lastMove, 0)
        : direction === "up"
          ? Math.max(lastMove, 0)
          : Math.abs(lastMove);
    givebackPct = Math.max(0, mfe - favorableNow);
  }

  return { mfe, mae, peakPrice, troughPrice, peakAtMs, troughAtMs, givebackPct };
}

/** Empirical Bayes shrink of a rate toward priorMean with strength priorN. */
export function shrinkRate(
  hits: number,
  samples: number,
  priorMean: number = 0.25,
  priorN: number = 20
): number {
  if (samples <= 0) return priorMean;
  return (hits + priorMean * priorN) / (samples + priorN);
}

/** Confidence 0–1 from sample size (asymptotic). */
export function sampleConfidence(n: number, fullAt: number = 80): number {
  if (n <= 0) return 0;
  return Math.min(1, Math.sqrt(n / fullAt));
}

export type EvidenceTier = "strong" | "watch" | "weak" | "unknown";

/**
 * Map direction-adjusted edge + hit rate + confidence into a display tier.
 * Conservative: requires both edge and hit rate with enough samples.
 */
export function classifyEvidenceTier(input: {
  episodes: number;
  hitRate: number | null;
  edgePct: number | null;
  confidence: number;
}): EvidenceTier {
  const { episodes, hitRate, edgePct, confidence } = input;
  if (episodes < 15 || hitRate == null || edgePct == null || confidence < 0.35) {
    return "unknown";
  }
  if (hitRate >= 0.35 && edgePct >= 0.15 && confidence >= 0.55) return "strong";
  if (hitRate >= 0.28 && edgePct >= 0.05) return "watch";
  if (hitRate < 0.2 || edgePct < -0.05) return "weak";
  return "watch";
}

export function isTrustedOutcomeVersion(
  version: string | null | undefined
): version is typeof OUTCOME_CONTRACT_V3 {
  return version === OUTCOME_CONTRACT_V3;
}
