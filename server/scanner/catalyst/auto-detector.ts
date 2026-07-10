// ---------------------------------------------------------------------------
// Catalyst Auto-Detector
//
// Evaluates scanner signals and news to automatically create catalyst entries
// when conditions match active rules.
// ---------------------------------------------------------------------------

import type { Signal, NewsResult } from "@shared/scanner-types";
import { scoreHeadlineSeverity, type CatalystType, type InitialReaction } from "@shared/catalyst-types";
import {
  createCatalyst,
  getEnabledRules,
  getActiveCatalystsForSubject,
} from "./engine";

/**
 * Check if a signal + its news context should create catalyst entries.
 * Called after each scanner cycle for signals that have news context.
 */
export async function evaluateForCatalysts(
  signal: Signal,
  newsResult: NewsResult | null
): Promise<void> {
  const rules = getEnabledRules();
  if (rules.length === 0) return;

  // Skip if this subject already has 3+ active catalysts (prevent flooding)
  const existing = getActiveCatalystsForSubject(signal.subject);
  if (existing.length >= 3) return;

  // ── Gap detection ───────────────────────────────────────────────────────
  if (signal.type === "gap") {
    const gapPct = Math.abs((signal.meta?.gapPct as number) ?? signal.magnitude);
    const isUp = signal.direction === "up";

    const gapRule = rules.find((r) =>
      r.catalystType === (isUp ? "gap_up" : "gap_down") &&
      gapPct >= r.contraryThresholdPct
    );

    if (gapRule) {
      await createCatalyst({
        subject: signal.subject,
        subjectKind: signal.subjectKind === "ticker" ? "ticker" : "theme",
        catalystType: gapRule.catalystType as CatalystType,
        headline: `${signal.subject} gapped ${isUp ? "up" : "down"} ${gapPct.toFixed(1)}%`,
        source: "system",
        initialReaction: "flat",
        expectedDirection: isUp ? "up" : "down",
        windowDays: gapRule.windowDays,
        decayShape: gapRule.decayShape,
        ruleId: gapRule.id,
      });
    }
  }

  // ── Volume anomaly (big volume, small move, no news) ────────────────────
  if (signal.type === "volume_spike" && signal.magnitude >= 5) {
    const changePct = Math.abs((signal.meta?.changePct as number) ?? 0);
    const hasNews = newsResult && newsResult.headlines.length > 0;

    if (changePct < 1.5 && !hasNews) {
      const volRule = rules.find((r) => r.catalystType === "volume_anomaly");
      if (volRule) {
        await createCatalyst({
          subject: signal.subject,
          subjectKind: "ticker",
          catalystType: "volume_anomaly",
          headline: `${signal.subject} ${signal.magnitude.toFixed(1)}x volume with only ${changePct.toFixed(1)}% move, no news`,
          source: "system",
          initialReaction: "flat",
          expectedDirection: signal.direction === "up" ? "up" : "down",
          windowDays: volRule.windowDays,
          decayShape: volRule.decayShape,
          ruleId: volRule.id,
        });
      }
    }
  }

  // ── News-based catalysts ────────────────────────────────────────────────
  if (newsResult && newsResult.headlines.length > 0) {
    for (const headline of newsResult.headlines) {
      const severity = scoreHeadlineSeverity(headline.headline);

      for (const rule of rules) {
        if (!rule.minNewsSeverity) continue;
        if (severity < rule.minNewsSeverity) continue;

        const matchesKeywords = rule.keywords.length === 0 ||
          rule.keywords.some((kw) => headline.headline.toLowerCase().includes(kw));
        if (!matchesKeywords) continue;

        const changePct = Math.abs((signal.meta?.changePct as number) ?? 0);
        const isContrary = changePct < rule.contraryThresholdPct;

        if (!isContrary && rule.catalystType === "news_keyword") continue;

        let reaction: InitialReaction = "flat";
        if (changePct >= rule.contraryThresholdPct) {
          reaction = signal.direction === "up" ? "positive" : "negative";
        }

        await createCatalyst({
          subject: signal.subject,
          subjectKind: signal.subjectKind === "ticker" ? "ticker" : "theme",
          catalystType: rule.catalystType as CatalystType,
          headline: headline.headline.slice(0, 200),
          source: headline.source,
          initialReaction: reaction,
          expectedDirection: severity >= 8
            ? (signal.direction === "up" ? "up" : "down")
            : "volatile",
          windowDays: rule.windowDays,
          decayShape: rule.decayShape,
          ruleId: rule.id,
        });

        break; // One catalyst per headline per subject
      }
    }
  }
}

/**
 * Auto-create an earnings catalyst when a ticker just reported.
 * Called from the scanner's earnings_reaction signal processing.
 * Only creates if no active earnings_beat/earnings_miss catalyst exists for this ticker.
 */
export async function createEarningsCatalyst(
  symbol: string,
  epsActual: number,
  epsEstimate: number,
  changePct: number
): Promise<void> {
  const existing = getActiveCatalystsForSubject(symbol);
  const hasEarningsCatalyst = existing.some(
    (c) => c.catalystType === "earnings_beat" || c.catalystType === "earnings_miss" || c.catalystType === "earnings_flat"
  );
  if (hasEarningsCatalyst) return;

  const isBeat = epsActual > epsEstimate;
  const isMiss = epsActual < epsEstimate;
  const catalystType: CatalystType = isBeat ? "earnings_beat" : isMiss ? "earnings_miss" : "earnings_flat";
  const surprise = epsActual - epsEstimate;
  const surprisePct = epsEstimate !== 0 ? Math.round((surprise / Math.abs(epsEstimate)) * 100) : 0;

  const direction: "up" | "down" | "volatile" = isBeat ? "up" : isMiss ? "down" : "volatile";
  const reaction: InitialReaction = changePct > 2 ? "positive" : changePct < -2 ? "negative" : "flat";

  await createCatalyst({
    subject: symbol,
    subjectKind: "ticker",
    catalystType,
    headline: `${symbol} ${isBeat ? "beat" : isMiss ? "missed" : "met"} EPS by ${surprise >= 0 ? "+" : ""}$${surprise.toFixed(2)} (${surprisePct >= 0 ? "+" : ""}${surprisePct}%), stock ${changePct >= 0 ? "+" : ""}${changePct.toFixed(1)}%`,
    source: "system",
    initialReaction: reaction,
    expectedDirection: direction,
    windowDays: 5,
    decayShape: "linear",
  });
}

/**
 * Check if an active catalyst should be resolved based on a new signal.
 * Called when a ticker with active catalysts fires a velocity_move or volume_spike.
 */
export async function checkCatalystResolution(
  signal: Signal
): Promise<void> {
  if (signal.subjectKind !== "ticker") return;
  if (signal.type !== "velocity_move" && signal.type !== "volume_spike") return;

  const catalysts = getActiveCatalystsForSubject(signal.subject);
  if (catalysts.length === 0) return;

  const { resolveCatalyst } = await import("./engine");
  const changePct = (signal.meta?.changePct as number) ?? 0;

  for (const c of catalysts) {
    const isExpectedDirection =
      (c.expectedDirection === "up" && changePct > 0) ||
      (c.expectedDirection === "down" && changePct < 0) ||
      c.expectedDirection === "volatile";

    const isSignificant = Math.abs(changePct) >= 2.0;

    if (isExpectedDirection && isSignificant) {
      await resolveCatalyst(c.id, Math.round(changePct * 100) / 100);
    }
  }
}
