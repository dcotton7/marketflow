/**
 * Earnings Module
 * Next earnings date, historical surprises, beat rate
 */

import type { ModuleResponse, EarningsData, Signal } from "../types";
import { fetchEarningsCalendar, fetchEarningsSurprises } from "../../../finnhub";

export async function runEarnings(symbol: string): Promise<ModuleResponse<EarningsData>> {
  const start = Date.now();

  const today = new Date();
  const from = today.toISOString().split("T")[0];
  const to = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  const [calendar, surprises] = await Promise.all([
    fetchEarningsCalendar(from, to, symbol).catch(() => ({ earningsCalendar: [] })),
    fetchEarningsSurprises(symbol).catch(() => []),
  ]);

  // Find next earnings for this symbol
  const upcomingEarnings = calendar.earningsCalendar?.find(
    (e) => e.symbol?.toUpperCase() === symbol.toUpperCase()
  );

  let nextEarnings: EarningsData["nextEarnings"] = null;
  let daysUntilEarnings: number | null = null;

  if (upcomingEarnings?.date) {
    const earningsDate = new Date(upcomingEarnings.date);
    daysUntilEarnings = Math.ceil((earningsDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));

    nextEarnings = {
      date: upcomingEarnings.date,
      quarter: upcomingEarnings.quarter ?? 0,
      year: upcomingEarnings.year ?? today.getFullYear(),
      epsEstimate: upcomingEarnings.epsEstimate ?? null,
      revenueEstimate: upcomingEarnings.revenueEstimate ?? null,
    };
  }

  // Process historical surprises
  const recentSurprises: EarningsData["recentSurprises"] = (surprises || [])
    .slice(0, 4)
    .map((s: { period?: string; actual?: number; estimate?: number; surprisePercent?: number }) => ({
      quarter: s.period ?? "",
      epsActual: s.actual ?? 0,
      epsEstimate: s.estimate ?? 0,
      surprisePct: s.surprisePercent ?? 0,
    }));

  // Calculate beat rate
  const beats = recentSurprises.filter((s) => s.epsActual > s.epsEstimate).length;
  const beatRate = recentSurprises.length > 0 ? (beats / recentSurprises.length) * 100 : 0;

  // Implied move placeholder (would need options data)
  const impliedMovePct: number | null = null;

  // Determine signal
  let signal: Signal = "informational";
  const flags: string[] = [];

  if (daysUntilEarnings !== null && daysUntilEarnings <= 14) {
    signal = "warning";
    flags.push("EARNINGS_SOON");
  }

  if (beatRate >= 75) {
    flags.push("STRONG_BEAT_HISTORY");
  } else if (beatRate <= 25 && recentSurprises.length >= 2) {
    flags.push("WEAK_BEAT_HISTORY");
  }

  const confidence = calculateEarningsConfidence(daysUntilEarnings, beatRate, recentSurprises.length);
  const summary = buildEarningsSummary(symbol, nextEarnings, daysUntilEarnings, beatRate, recentSurprises);

  return {
    module_id: "earnings",
    ticker: symbol,
    signal,
    summary,
    confidence,
    flags,
    executionMs: Date.now() - start,
    data: {
      nextEarnings,
      daysUntilEarnings,
      impliedMovePct,
      recentSurprises,
      beatRate,
    },
  };
}

function calculateEarningsConfidence(
  daysUntil: number | null,
  beatRate: number,
  surpriseCount: number
): number {
  let confidence = 50;

  // More historical data = more confidence in beat rate
  if (surpriseCount >= 4) confidence += 15;
  else if (surpriseCount >= 2) confidence += 10;
  else confidence -= 10;

  // Earnings proximity affects confidence
  if (daysUntil !== null && daysUntil <= 7) {
    confidence += 10; // More relevant data
  }

  // Consistent beat/miss history
  if (beatRate >= 75 || beatRate <= 25) {
    confidence += 10;
  }

  return Math.max(0, Math.min(100, confidence));
}

function buildEarningsSummary(
  symbol: string,
  nextEarnings: EarningsData["nextEarnings"],
  daysUntil: number | null,
  beatRate: number,
  surprises: EarningsData["recentSurprises"]
): string {
  const parts: string[] = [];

  if (nextEarnings) {
    parts.push(`Next earnings: ${nextEarnings.date} (Q${nextEarnings.quarter} ${nextEarnings.year}).`);
    if (daysUntil !== null) {
      if (daysUntil <= 0) {
        parts.push("Reporting today or recently.");
      } else if (daysUntil <= 7) {
        parts.push(`Only ${daysUntil} day(s) away — exercise caution.`);
      } else if (daysUntil <= 14) {
        parts.push(`${daysUntil} days away.`);
      }
    }
    if (nextEarnings.epsEstimate) {
      parts.push(`EPS estimate: $${nextEarnings.epsEstimate.toFixed(2)}.`);
    }
  } else {
    parts.push(`No upcoming earnings date found for ${symbol} in the next 90 days.`);
  }

  if (surprises.length > 0) {
    parts.push(`Beat rate: ${beatRate.toFixed(0)}% (${surprises.length} quarters).`);

    const lastSurprise = surprises[0];
    if (lastSurprise) {
      const direction = lastSurprise.surprisePct >= 0 ? "beat" : "miss";
      parts.push(`Last quarter: ${direction} by ${Math.abs(lastSurprise.surprisePct).toFixed(1)}%.`);
    }
  }

  return parts.join(" ");
}
