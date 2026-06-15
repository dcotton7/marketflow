import type { TickerReviewMember } from "../ticker-review-types";
import type { PatternHit, SetupBar } from "./types";
import { sortBarsChronological } from "./bars";
import { detectHvc, detectHvcFromDailyBars } from "./hvc";
import { detectVcp } from "./vcp";
import { detectBreakout } from "./breakout";
import { detectBestUndercutRally } from "./ur";
import { detectGapAndGo } from "./gap-and-go";
import { detectRecentCoilBase, detectLongBase, detectTightConsolidationBase } from "./long-base";
import { detectOrb } from "./orb";

function toHit(result: ReturnType<typeof detectHvc>): PatternHit | null {
  if (!result.detected || !result.criterionId) return null;
  return {
    criterionId: result.criterionId,
    stage: result.stage,
    confidence: result.confidence,
    pattern: result.pattern,
    diagnostics: result.diagnostics,
  };
}

export interface EnrichMemberOptions {
  dailyBars?: SetupBar[];
  intradayBars?: SetupBar[];
}

/** Attach bar-backed pattern hits to a theme member for ticker review scoring. */
export function enrichTickerReviewMember(
  member: TickerReviewMember,
  options: EnrichMemberOptions
): TickerReviewMember {
  const daily = options.dailyBars?.length
    ? sortBarsChronological(options.dailyBars)
    : undefined;
  const intraday = options.intradayBars?.length
    ? sortBarsChronological(options.intradayBars)
    : undefined;

  const hits: PatternHit[] = [];
  let hvcPriorSession = member.hvcPriorSession;
  let lastSessionPct = member.lastSessionPct ?? null;

  if (daily?.length) {
    if (daily.length >= 2) {
      const last = daily[daily.length - 1]!;
      const prev = daily[daily.length - 2]!;
      if (prev.close > 0) {
        lastSessionPct = ((last.close - prev.close) / prev.close) * 100;
      }
    }
    if (hvcPriorSession === undefined) {
      hvcPriorSession = detectHvcFromDailyBars(daily);
    }
    const detectors = [
      detectHvc(daily),
      detectBestUndercutRally(daily),
      detectVcp(daily),
      detectRecentCoilBase(daily),
      detectLongBase(daily),
      detectTightConsolidationBase(daily),
      detectGapAndGo(daily),
      detectBreakout(daily),
    ];
    for (const r of detectors) {
      const h = toHit(r);
      if (h) hits.push(h);
    }
  }

  if (intraday?.length) {
    const orb = detectOrb(intraday);
    const h = toHit(orb);
    if (h) hits.push(h);
  }

  return {
    ...member,
    lastSessionPct,
    hvcPriorSession,
    patternHits: hits.length ? hits : member.patternHits,
  };
}

export function patternHitFor(
  member: TickerReviewMember,
  criterionId: PatternHit["criterionId"]
): PatternHit | undefined {
  return member.patternHits?.find((h) => h.criterionId === criterionId);
}

/** True if enriched pattern supports this optional criterion (any stage except extended-only skip). */
export function optionalFromPattern(
  member: TickerReviewMember,
  criterionId: PatternHit["criterionId"]
): boolean | null {
  const hit = patternHitFor(member, criterionId);
  if (!hit) return null;
  if (hit.stage === "extended" && (criterionId === "O8" || criterionId === "O10")) {
    return false;
  }
  return true;
}
