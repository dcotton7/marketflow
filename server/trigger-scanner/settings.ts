/**
 * Trigger scanner settings (docs/trigger-scanner.md). Off unless TRIGGER_SCANNER=on: with the flag off no timer
 * starts, no query runs and the routes answer 404. Every threshold is a setting with the default below; the
 * environment can override the few that matter on the live system (TRIGGER_SCANNER_*), the rest are code defaults
 * a later settings row can replace. A changed default gets a new RULE_VERSION so stored rows keep their meaning.
 */

export const RULE_VERSION = "ts-2026-11-26-v2"; // v2: gap_and_go / gap_down_and_go added

export function scannerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.TRIGGER_SCANNER ?? "").trim().toLowerCase() === "on";
}

export type Tier = "bars" | "shortlist";

export interface ScannerSettings {
  /** Universe floor (Anitir spec 2.3 / 5.f): last close and 20-day average dollar volume. */
  minPrice: number;
  minDollarVol: number;
  /** "bars": 5-minute bars for the whole liquid universe. "shortlist": bars only for names the quote tier promotes. */
  tier: Tier;
  shortlistMax: number;
  /** Symbols per multi-symbol bars request. */
  barsBatch: number;
  /** Seconds after a 5-minute boundary before that bar is fetched (Alpaca finalises bars a few seconds late). */
  barSettleSec: number;
  feed: "sip" | "iex";
  /** Opening range: first N minutes (15 = three 5-minute bars). */
  orMinutes: number;
  /** ORB break only counts up to this many minutes after the open. */
  orbUntilMin: number;
  /** Relative volume of the trigger bar vs the time-of-day norm. */
  orbMinRelVol: number;
  /** VWAP reclaim/loss: bars that closed on the other side first. */
  vwapPriorBars: number;
  /** Level touch tolerance, % of the level. */
  touchTolPct: number;
  /** Level hold: earlier today price was at least this far (ADR) on the right side of the level (a pullback to it,
   *  not chop on it). */
  levelApproachAdr: number;
  /** VWAP reclaim/loss: the close must be at least this far (ADR) across VWAP. */
  vwapMinCrossAdr: number;
  /** Failed break: the break must have reached at least this far (ADR) beyond the range. */
  failedBreakMinAdr: number;
  /** LOD/HOD reversal: the day's move from the open to the extreme, in ADR. */
  reversalMinMoveAdr: number;
  /** LOD/HOD reversal: the close must be in the top (bottom) share of the bar's range. */
  reversalCloseShare: number;
  /** New session high/low: bar and cumulative relative volume. */
  newExtremeMinRelVol: number;
  /** Daily setup in range: distance from its entry level in ADR. */
  inRangeAdr: number;
  /** Leader Shakeout hits from this many sessions back are watched. */
  shakeoutLookbackSessions: number;
  /** Stop rule. */
  maxRiskPct: number;
  minStopAdr: number;
  stopBufferAdr: number;
  stopBufferMaxPct: number;
  companyAdr: number;
  /** Gap levels look back this many sessions. */
  gapLookback: number;
  /** Grade. */
  liquidDollarVol: number;
  earningsWithinSessions: number;
  gradeA: number;
  gradeB: number;
  /** Rotation: "hot" when ahead of SPY by this much today, or over 5 sessions. */
  hotTodayPct: number;
  hot5dPct: number;
  /** Gap and go (Don, 26 Nov: "add gap and GO, the GO can happen up to n-number of days after the gap up"). */
  gapFrom: "prior_high" | "prior_close";
  gapMinPct: number;
  gapMinAdr: number;
  gapVolMult: number;
  gapVolDays: number;
  goMaxDays: number;
  goBreakAdr: number;
  goRelVol: number;
  repeatPullbackAdr: number;
  goMaxFires: number;
  earningsWindow: number;
  tightRangeAdr: number;
  tightMinDays: number;
  /** At most this many candidates stored a day; past it they are counted in the run rows, not stored. */
  maxStoredPerDay: number;
  /** User setups (BigIdea criteria), per account. */
  userSetupsMaxPerAccount: number;
  userSetupMaxCriteria: number;
}

export const DEFAULTS: ScannerSettings = {
  minPrice: 6,
  minDollarVol: 30e6,
  tier: "bars",
  shortlistMax: 300,
  barsBatch: 200,
  barSettleSec: 20,
  feed: "sip",
  orMinutes: 15,
  orbUntilMin: 120,
  orbMinRelVol: 1.5,
  vwapPriorBars: 3,
  touchTolPct: 0.15,
  levelApproachAdr: 0.3,
  vwapMinCrossAdr: 0.05,
  failedBreakMinAdr: 0.1,
  reversalMinMoveAdr: 0.5,
  reversalCloseShare: 0.6,
  newExtremeMinRelVol: 1.5,
  inRangeAdr: 0.5,
  shakeoutLookbackSessions: 5,
  maxRiskPct: 5,
  minStopAdr: 0.25,
  stopBufferAdr: 0.1,
  stopBufferMaxPct: 0.2,
  companyAdr: 0.3,
  gapLookback: 60,
  liquidDollarVol: 100e6,
  earningsWithinSessions: 3,
  gradeA: 8,
  gradeB: 5,
  hotTodayPct: 0.75,
  hot5dPct: 2,
  gapFrom: "prior_high",
  gapMinPct: 4,
  gapMinAdr: 1.0,
  gapVolMult: 2.0,
  gapVolDays: 50,
  goMaxDays: 10,
  goBreakAdr: 0.05,
  goRelVol: 1.5,
  repeatPullbackAdr: 1.0,
  goMaxFires: 2,
  earningsWindow: 1,
  tightRangeAdr: 1.5,
  tightMinDays: 2,
  maxStoredPerDay: 5000,
  userSetupsMaxPerAccount: 10,
  userSetupMaxCriteria: 12,
};

const num = (v: unknown, d: number, min = 0) => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) && n > min ? n : d;
};

/** Defaults with the environment's overrides. A bad value keeps the default. */
export function loadSettings(env: NodeJS.ProcessEnv = process.env): ScannerSettings {
  const tier = (env.TRIGGER_SCANNER_TIER ?? "").trim().toLowerCase();
  const feed = (env.TRIGGER_SCANNER_FEED ?? "").trim().toLowerCase();
  return {
    ...DEFAULTS,
    minPrice: num(env.TRIGGER_SCANNER_MIN_PRICE, DEFAULTS.minPrice),
    minDollarVol: num(env.TRIGGER_SCANNER_MIN_DOLLAR_VOL, DEFAULTS.minDollarVol),
    tier: tier === "shortlist" ? "shortlist" : "bars",
    shortlistMax: Math.round(num(env.TRIGGER_SCANNER_SHORTLIST_MAX, DEFAULTS.shortlistMax)),
    gapFrom: (env.TRIGGER_SCANNER_GAP_FROM ?? "").trim().toLowerCase() === "prior_close" ? "prior_close" : "prior_high",
    goMaxDays: Math.round(num(env.TRIGGER_SCANNER_GO_MAX_DAYS, DEFAULTS.goMaxDays)),
    maxStoredPerDay: Math.round(num(env.TRIGGER_SCANNER_MAX_PER_DAY, DEFAULTS.maxStoredPerDay)),
    feed: feed === "iex" ? "iex" : "sip",
  };
}
