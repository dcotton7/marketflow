/**
 * Setup quality score (−100 to +100).
 * Positive = long-setup quality; negative = short-setup quality.
 * Pure client-side math — no network calls.
 */

export interface SetupQualityInputs {
  /** % above/below SMA50 */
  extensionFrom50dPct: number | null | undefined;
  /** % above/below SMA200 */
  extensionFrom200d: number | null | undefined;
  /** Distance from SMA50 in ADR multiples */
  extensionFrom50dAdr: number | null | undefined;
  /** % above/below SMA20 */
  extensionFrom20d: number | null | undefined;
  /** % above today's low */
  pctFromLod: number | null | undefined;
  themeRank: number | null | undefined;
  totalThemes: number | null | undefined;
  /** true = price > last VWAP; false = below; null = unknown */
  overVwap: boolean | null | undefined;
  rsMomentum: number | null | undefined;
  /** ADR as % of price (adr14Pct or adr20Pct) */
  adrPct: number | null | undefined;
}

export interface SetupQualityFactor {
  id: string;
  label: string;
  points: number;
  detail: string;
}

export interface SetupQualityResult {
  /** Clamped to −100…+100 */
  score: number;
  factors: SetupQualityFactor[];
  label: "Long" | "Short" | "Neutral";
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function themePoints(
  rank: number | null | undefined,
  total: number | null | undefined
): { points: number; detail: string } | null {
  if (rank == null || total == null || total <= 0) return null;
  const pctile = rank / total; // 1 = best rank
  // Theme is weighted 2x vs other single factors (plan base was ±15 / ±8)
  if (pctile <= 0.2) return { points: 30, detail: `Theme #${rank}/${total} (top 20%)` };
  if (pctile <= 0.5) return { points: 16, detail: `Theme #${rank}/${total} (top half)` };
  if (pctile <= 0.8) return { points: -16, detail: `Theme #${rank}/${total} (bottom half)` };
  return { points: -30, detail: `Theme #${rank}/${total} (bottom 20%)` };
}

function tightTo50dPoints(adrExt: number | null | undefined): { points: number; detail: string } | null {
  if (adrExt == null || !Number.isFinite(adrExt)) return null;
  // Only reward tightness when ABOVE the 50d (long side); below gets 0 for this factor
  // (the SMA50 binary factor already handles side). When above and extended, squeeze score.
  const abs = Math.abs(adrExt);
  if (adrExt >= 0) {
    if (abs <= 2) return { points: 15, detail: `ADRx50d +${adrExt.toFixed(1)} (tight)` };
    if (abs <= 3.5) return { points: 10, detail: `ADRx50d +${adrExt.toFixed(1)}` };
    if (abs <= 5) return { points: 5, detail: `ADRx50d +${adrExt.toFixed(1)} (stretching)` };
    return { points: 0, detail: `ADRx50d +${adrExt.toFixed(1)} (extended)` };
  }
  // Below 50d: extension hurts long / helps short via zeroing this long-side factor
  if (abs <= 2) return { points: -15, detail: `ADRx50d ${adrExt.toFixed(1)} (just below)` };
  if (abs <= 3.5) return { points: -10, detail: `ADRx50d ${adrExt.toFixed(1)}` };
  if (abs <= 5) return { points: -5, detail: `ADRx50d ${adrExt.toFixed(1)}` };
  return { points: 0, detail: `ADRx50d ${adrExt.toFixed(1)} (deep below)` };
}

function lodPoints(pctFromLod: number | null | undefined): { points: number; detail: string } | null {
  if (pctFromLod == null || !Number.isFinite(pctFromLod)) return null;
  if (pctFromLod < 2) return { points: 10, detail: `${pctFromLod.toFixed(1)}% from LOD` };
  if (pctFromLod < 5) return { points: 5, detail: `${pctFromLod.toFixed(1)}% from LOD` };
  return { points: 0, detail: `${pctFromLod.toFixed(1)}% from LOD (far)` };
}

function adrContainmentPoints(adrPct: number | null | undefined): { points: number; detail: string } | null {
  if (adrPct == null || !Number.isFinite(adrPct)) return null;
  if (adrPct < 4) return { points: 10, detail: `ADR ${adrPct.toFixed(1)}% (tight range)` };
  if (adrPct <= 7) return { points: 5, detail: `ADR ${adrPct.toFixed(1)}%` };
  return { points: 0, detail: `ADR ${adrPct.toFixed(1)}% (wide)` };
}

/**
 * Last non-null VWAP from an indicator series.
 */
export function lastVwap(series: (number | null)[] | undefined | null): number | null {
  if (!series?.length) return null;
  for (let i = series.length - 1; i >= 0; i--) {
    const v = series[i];
    if (v != null && Number.isFinite(v)) return v;
  }
  return null;
}

export function computeSetupQuality(input: SetupQualityInputs): SetupQualityResult {
  const factors: SetupQualityFactor[] = [];

  if (input.extensionFrom50dPct != null && Number.isFinite(input.extensionFrom50dPct)) {
    const above = input.extensionFrom50dPct > 0;
    factors.push({
      id: "sma50",
      label: "SMA50",
      points: above ? 15 : -15,
      detail: above
        ? `+${input.extensionFrom50dPct.toFixed(1)}% above 50d`
        : `${input.extensionFrom50dPct.toFixed(1)}% below 50d`,
    });
  }

  if (input.extensionFrom200d != null && Number.isFinite(input.extensionFrom200d)) {
    const above = input.extensionFrom200d > 0;
    factors.push({
      id: "sma200",
      label: "SMA200",
      points: above ? 15 : -15,
      detail: above
        ? `+${input.extensionFrom200d.toFixed(1)}% above 200d`
        : `${input.extensionFrom200d.toFixed(1)}% below 200d`,
    });
  }

  const tight = tightTo50dPoints(input.extensionFrom50dAdr);
  if (tight) {
    factors.push({ id: "adrx50", label: "ADRx50d", points: tight.points, detail: tight.detail });
  }

  const lod = lodPoints(input.pctFromLod);
  if (lod) {
    factors.push({ id: "lod", label: "% from LOD", points: lod.points, detail: lod.detail });
  }

  const theme = themePoints(input.themeRank, input.totalThemes);
  if (theme) {
    factors.push({ id: "theme", label: "Theme", points: theme.points, detail: theme.detail });
  }

  if (input.overVwap === true) {
    factors.push({ id: "vwap", label: "VWAP", points: 10, detail: "Price above VWAP" });
  } else if (input.overVwap === false) {
    factors.push({ id: "vwap", label: "VWAP", points: -10, detail: "Price below VWAP" });
  }

  if (input.rsMomentum != null && Number.isFinite(input.rsMomentum)) {
    const pos = input.rsMomentum > 0;
    factors.push({
      id: "rs",
      label: "RS",
      points: pos ? 10 : -10,
      detail: pos
        ? `RS +${input.rsMomentum}%`
        : `RS ${input.rsMomentum}%`,
    });
  }

  const adr = adrContainmentPoints(input.adrPct);
  if (adr) {
    factors.push({ id: "adr", label: "ADR", points: adr.points, detail: adr.detail });
  }

  // Special bonuses
  if (
    input.extensionFrom200d != null &&
    Number.isFinite(input.extensionFrom200d) &&
    input.extensionFrom200d < 0 &&
    input.extensionFrom200d >= -3
  ) {
    factors.push({
      id: "just-below-200",
      label: "200d cross",
      points: -5,
      detail: `Just below 200d (${input.extensionFrom200d.toFixed(1)}%)`,
    });
  }

  const justAbove20 =
    input.extensionFrom20d != null &&
    Number.isFinite(input.extensionFrom20d) &&
    input.extensionFrom20d > 0 &&
    input.extensionFrom20d <= 1.5;
  const justAbove50 =
    input.extensionFrom50dPct != null &&
    Number.isFinite(input.extensionFrom50dPct) &&
    input.extensionFrom50dPct > 0 &&
    input.extensionFrom50dPct <= 1.5;
  if (justAbove20 || justAbove50) {
    const which = justAbove50 ? "50d" : "20d";
    const pct = justAbove50 ? input.extensionFrom50dPct! : input.extensionFrom20d!;
    factors.push({
      id: "just-above-ma",
      label: "MA proximity",
      points: 5,
      detail: `Just above ${which} (+${pct.toFixed(1)}%)`,
    });
  }

  const raw = factors.reduce((s, f) => s + f.points, 0);
  const score = Math.round(clamp(raw, -100, 100));
  const label: SetupQualityResult["label"] =
    score >= 15 ? "Long" : score <= -15 ? "Short" : "Neutral";

  return { score, factors, label };
}
