/**
 * Market Leaders v1 parameters.
 * The scorer only reads this object. Controls and AI may change numbers inside the ranges.
 * Point amounts stay fixed so a score is still 0–100.
 */

export const MARKET_LEADERS_SPEC_VERSION = "v1" as const;

export type LeaderPool = "universe" | "sp500" | "russell2000";

export interface MarketLeadersSpec {
  joinScore: number;
  stayScore: number;
  atRiskScore: number;
  gateFailCloses: number;
  smaFast: number;
  smaSlow: number;
  slopeBars: number;
  minDollarVolume: number;
  minClose: number;
  /** Close must be at least this fraction of the lookback high. 0.75 = within 25%. */
  highProximity: number;
  /** Close must be at least this multiple of the lookback low. */
  lowExtension: number;
  lookback: number;
  rsTop: number;
  rsMid: number;
  rsLow: number;
  rsLineWindow: number;
  /** rank/count at or under this earns the top group points. */
  groupTop: number;
  groupMid: number;
  udvrHi: number;
  udvrLo: number;
  udvrBars: number;
  gapPct: number;
  gapVolMultiple: number;
  gapWindow: number;
  /** Within this fraction of the lookback high earns character points. */
  characterHighRoom: number;
  characterSmaBuffer: number;
  volumeBreakMultiple: number;
}

export const V1_SPEC: MarketLeadersSpec = {
  joinScore: 75,
  stayScore: 60,
  atRiskScore: 70,
  gateFailCloses: 3,
  smaFast: 50,
  smaSlow: 200,
  slopeBars: 20,
  minDollarVolume: 20_000_000,
  minClose: 10,
  highProximity: 0.75,
  lowExtension: 1.3,
  lookback: 252,
  rsTop: 90,
  rsMid: 80,
  rsLow: 70,
  rsLineWindow: 10,
  groupTop: 0.25,
  groupMid: 0.5,
  udvrHi: 1.5,
  udvrLo: 1.2,
  udvrBars: 50,
  gapPct: 0.05,
  gapVolMultiple: 2,
  gapWindow: 60,
  characterHighRoom: 0.15,
  characterSmaBuffer: 0.97,
  volumeBreakMultiple: 1.5,
};

const INTEGER_KEYS = new Set<keyof MarketLeadersSpec>([
  "joinScore",
  "stayScore",
  "atRiskScore",
  "gateFailCloses",
  "smaFast",
  "smaSlow",
  "slopeBars",
  "minClose",
  "lookback",
  "rsTop",
  "rsMid",
  "rsLow",
  "rsLineWindow",
  "udvrBars",
  "gapWindow",
]);

export const SPEC_FIELDS: {
  key: keyof MarketLeadersSpec;
  min: number;
  max: number;
  label: string;
  hint: string;
  group: "main" | "advanced";
}[] = [
  { key: "joinScore", min: 50, max: 90, label: "Join score", group: "main", hint: "Score a name must reach to join the book." },
  { key: "stayScore", min: 40, max: 80, label: "Stay score", group: "main", hint: "Lowest score that still keeps a name on the book." },
  { key: "gateFailCloses", min: 1, max: 5, label: "Failed closes before drop", group: "main", hint: "How many failed-gate closes in a row drop the name." },
  { key: "highProximity", min: 0.6, max: 0.9, label: "Min fraction of 252-day high", group: "main", hint: "Close must be at least this fraction of the lookback high. 0.75 means within 25% of that high." },
  { key: "atRiskScore", min: 50, max: 85, label: "At-risk score", group: "advanced", hint: "On-book names below this score are marked At risk." },
  { key: "smaFast", min: 10, max: 100, label: "Fast SMA", group: "advanced", hint: "Fast moving average used in the trend gates." },
  { key: "smaSlow", min: 30, max: 250, label: "Slow SMA", group: "advanced", hint: "Slow moving average. The fast SMA must sit above this." },
  { key: "slopeBars", min: 5, max: 60, label: "SMA slope bars", group: "advanced", hint: "The fast SMA must be higher than it was this many bars ago." },
  { key: "minDollarVolume", min: 5_000_000, max: 100_000_000, label: "Min 50-day dollar volume", group: "advanced", hint: "Minimum 50-day average dollar volume to pass the liquidity gate." },
  { key: "minClose", min: 5, max: 50, label: "Min close", group: "advanced", hint: "Minimum closing price to stay in the pool." },
  { key: "lowExtension", min: 1.1, max: 1.6, label: "Min multiple of 252-day low", group: "advanced", hint: "Close must be at least this multiple of the lookback low." },
  { key: "lookback", min: 20, max: 252, label: "High/low lookback", group: "advanced", hint: "How many sessions define the high and low used by the range gates." },
  { key: "rsTop", min: 70, max: 99, label: "RS percentile for 25 pts", group: "advanced", hint: "Relative-strength percentile that earns 25 points." },
  { key: "rsMid", min: 60, max: 95, label: "RS percentile for 18 pts", group: "advanced", hint: "Relative-strength percentile that earns 18 points." },
  { key: "rsLow", min: 50, max: 90, label: "RS percentile for 10 pts", group: "advanced", hint: "Relative-strength percentile that earns 10 points." },
  { key: "rsLineWindow", min: 5, max: 20, label: "RS-line high window", group: "advanced", hint: "The RS-versus-SPY line must make a high inside this many bars for 10 points." },
  { key: "groupTop", min: 0.1, max: 0.4, label: "Theme top fraction", group: "advanced", hint: "Theme rank in this top fraction of the list earns 20 points." },
  { key: "groupMid", min: 0.3, max: 0.7, label: "Theme mid fraction", group: "advanced", hint: "Theme rank in this next fraction earns 10 points." },
  { key: "udvrHi", min: 1, max: 3, label: "Up/down volume for 15 pts", group: "advanced", hint: "Up/down volume ratio that earns 15 accumulation points." },
  { key: "udvrLo", min: 1, max: 2.5, label: "Up/down volume for 8 pts", group: "advanced", hint: "Up/down volume ratio that earns 8 accumulation points." },
  { key: "udvrBars", min: 20, max: 100, label: "Up/down volume bars", group: "advanced", hint: "Sessions used to compute the up/down volume ratio." },
  { key: "gapPct", min: 0.03, max: 0.1, label: "Held gap size", group: "advanced", hint: "Minimum opening gap that can earn held-gap points if it is still held." },
  { key: "gapVolMultiple", min: 1.5, max: 4, label: "Held gap volume multiple", group: "advanced", hint: "Gap-day volume must be at least this multiple of the prior 50-day average." },
  { key: "gapWindow", min: 20, max: 80, label: "Held gap window", group: "advanced", hint: "How far back a held gap can still count." },
  { key: "characterHighRoom", min: 0.05, max: 0.25, label: "Character distance from high", group: "advanced", hint: "Close this close to the lookback high earns character points." },
  { key: "characterSmaBuffer", min: 0.9, max: 1, label: "20-bar low vs 20 SMA", group: "advanced", hint: "The 20-bar low must hold at least this fraction of the 20 SMA for character points." },
  { key: "volumeBreakMultiple", min: 1.2, max: 3, label: "50 SMA volume-break multiple", group: "advanced", hint: "Volume multiple that flags a volume-break when price is under the fast SMA." },
];

const FIELD_BY_KEY = new Map(SPEC_FIELDS.map((field) => [field.key, field]));

export function clampSpec(
  input: unknown,
  base: MarketLeadersSpec = V1_SPEC,
): { spec: MarketLeadersSpec; rejected: string[] } {
  const spec: MarketLeadersSpec = { ...base };
  const rejected: string[] = [];
  if (!input || typeof input !== "object") return { spec, rejected };

  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const field = FIELD_BY_KEY.get(key as keyof MarketLeadersSpec);
    if (!field) {
      rejected.push(key);
      continue;
    }
    const num = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(num)) {
      rejected.push(key);
      continue;
    }
    let next = Math.min(field.max, Math.max(field.min, num));
    if (INTEGER_KEYS.has(field.key)) next = Math.round(next);
    spec[field.key] = next;
  }

  if (spec.stayScore > spec.joinScore) spec.stayScore = spec.joinScore;
  if (spec.atRiskScore > spec.joinScore) spec.atRiskScore = spec.joinScore;
  if (spec.smaFast >= spec.smaSlow) spec.smaFast = Math.max(10, spec.smaSlow - 1);
  if (spec.groupTop > spec.groupMid) spec.groupTop = spec.groupMid;
  if (spec.udvrLo > spec.udvrHi) spec.udvrLo = spec.udvrHi;
  if (spec.rsLow > spec.rsMid) spec.rsLow = spec.rsMid;
  if (spec.rsMid > spec.rsTop) spec.rsMid = spec.rsTop;
  return { spec, rejected };
}

export function specsEqual(a: MarketLeadersSpec, b: MarketLeadersSpec): boolean {
  return (Object.keys(V1_SPEC) as (keyof MarketLeadersSpec)[]).every((key) => a[key] === b[key]);
}
