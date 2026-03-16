/**
 * Risk Calendar Module
 * Macro economic events (FOMC, CPI, Jobs Report)
 */

import type { ModuleResponse, RiskCalendarData, Signal } from "../types";

// Major economic events schedule (simplified static calendar)
const MAJOR_EVENTS_2024_2025 = [
  // FOMC meetings (Fed interest rate decisions)
  { date: "2024-12-18", event: "FOMC Rate Decision", impact: "high" as const },
  { date: "2025-01-29", event: "FOMC Rate Decision", impact: "high" as const },
  { date: "2025-03-19", event: "FOMC Rate Decision", impact: "high" as const },
  { date: "2025-05-07", event: "FOMC Rate Decision", impact: "high" as const },
  { date: "2025-06-18", event: "FOMC Rate Decision", impact: "high" as const },
  { date: "2025-07-30", event: "FOMC Rate Decision", impact: "high" as const },
  { date: "2025-09-17", event: "FOMC Rate Decision", impact: "high" as const },
  { date: "2025-11-05", event: "FOMC Rate Decision", impact: "high" as const },
  { date: "2025-12-17", event: "FOMC Rate Decision", impact: "high" as const },
  { date: "2026-01-28", event: "FOMC Rate Decision", impact: "high" as const },
  { date: "2026-03-18", event: "FOMC Rate Decision", impact: "high" as const },
  { date: "2026-05-06", event: "FOMC Rate Decision", impact: "high" as const },
  
  // CPI releases (typically mid-month)
  { date: "2024-12-11", event: "CPI Release", impact: "high" as const },
  { date: "2025-01-15", event: "CPI Release", impact: "high" as const },
  { date: "2025-02-12", event: "CPI Release", impact: "high" as const },
  { date: "2025-03-12", event: "CPI Release", impact: "high" as const },
  { date: "2025-04-10", event: "CPI Release", impact: "high" as const },
  { date: "2025-05-13", event: "CPI Release", impact: "high" as const },
  { date: "2025-06-11", event: "CPI Release", impact: "high" as const },
  { date: "2025-07-11", event: "CPI Release", impact: "high" as const },
  { date: "2025-08-13", event: "CPI Release", impact: "high" as const },
  { date: "2025-09-11", event: "CPI Release", impact: "high" as const },
  { date: "2025-10-10", event: "CPI Release", impact: "high" as const },
  { date: "2025-11-13", event: "CPI Release", impact: "high" as const },
  { date: "2025-12-10", event: "CPI Release", impact: "high" as const },
  { date: "2026-01-14", event: "CPI Release", impact: "high" as const },
  { date: "2026-02-11", event: "CPI Release", impact: "high" as const },
  { date: "2026-03-11", event: "CPI Release", impact: "high" as const },
  
  // Jobs Report (first Friday of month)
  { date: "2024-12-06", event: "Jobs Report (NFP)", impact: "high" as const },
  { date: "2025-01-10", event: "Jobs Report (NFP)", impact: "high" as const },
  { date: "2025-02-07", event: "Jobs Report (NFP)", impact: "high" as const },
  { date: "2025-03-07", event: "Jobs Report (NFP)", impact: "high" as const },
  { date: "2025-04-04", event: "Jobs Report (NFP)", impact: "high" as const },
  { date: "2025-05-02", event: "Jobs Report (NFP)", impact: "high" as const },
  { date: "2025-06-06", event: "Jobs Report (NFP)", impact: "high" as const },
  { date: "2025-07-03", event: "Jobs Report (NFP)", impact: "high" as const },
  { date: "2025-08-01", event: "Jobs Report (NFP)", impact: "high" as const },
  { date: "2025-09-05", event: "Jobs Report (NFP)", impact: "high" as const },
  { date: "2025-10-03", event: "Jobs Report (NFP)", impact: "high" as const },
  { date: "2025-11-07", event: "Jobs Report (NFP)", impact: "high" as const },
  { date: "2025-12-05", event: "Jobs Report (NFP)", impact: "high" as const },
  { date: "2026-01-09", event: "Jobs Report (NFP)", impact: "high" as const },
  { date: "2026-02-06", event: "Jobs Report (NFP)", impact: "high" as const },
  { date: "2026-03-06", event: "Jobs Report (NFP)", impact: "high" as const },
];

export async function runRiskCalendar(_symbol: string): Promise<ModuleResponse<RiskCalendarData>> {
  const start = Date.now();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Find upcoming events within 30 days
  const upcomingEvents: RiskCalendarData["events"] = [];

  for (const event of MAJOR_EVENTS_2024_2025) {
    const eventDate = new Date(event.date);
    eventDate.setHours(0, 0, 0, 0);

    const daysAway = Math.ceil((eventDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));

    if (daysAway >= 0 && daysAway <= 30) {
      upcomingEvents.push({
        date: event.date,
        event: event.event,
        impact: event.impact,
        daysAway,
      });
    }
  }

  // Sort by date
  upcomingEvents.sort((a, b) => a.daysAway - b.daysAway);

  const nextMajorEvent = upcomingEvents.length > 0 ? upcomingEvents[0].event : null;
  const daysUntilMajorEvent = upcomingEvents.length > 0 ? upcomingEvents[0].daysAway : null;

  // Determine signal
  let signal: Signal = "informational";
  const flags: string[] = [];

  if (daysUntilMajorEvent !== null && daysUntilMajorEvent <= 2) {
    signal = "warning";
    flags.push("MAJOR_EVENT_IMMINENT");
  } else if (daysUntilMajorEvent !== null && daysUntilMajorEvent <= 7) {
    flags.push("MAJOR_EVENT_THIS_WEEK");
  }

  // Check for FOMC specifically
  const fomcSoon = upcomingEvents.find((e) => e.event.includes("FOMC") && e.daysAway <= 7);
  if (fomcSoon) {
    flags.push("FOMC_THIS_WEEK");
  }

  const confidence = 80; // Calendar data is deterministic
  const summary = buildCalendarSummary(upcomingEvents, nextMajorEvent, daysUntilMajorEvent);

  return {
    module_id: "riskCalendar",
    ticker: _symbol,
    signal,
    summary,
    confidence,
    flags,
    executionMs: Date.now() - start,
    data: {
      events: upcomingEvents.slice(0, 5),
      nextMajorEvent,
      daysUntilMajorEvent,
    },
  };
}

function buildCalendarSummary(
  events: RiskCalendarData["events"],
  nextEvent: string | null,
  daysUntil: number | null
): string {
  if (events.length === 0) {
    return "No major macro events in the next 30 days.";
  }

  const parts: string[] = [];

  if (nextEvent && daysUntil !== null) {
    if (daysUntil === 0) {
      parts.push(`Today: ${nextEvent} — expect volatility.`);
    } else if (daysUntil === 1) {
      parts.push(`Tomorrow: ${nextEvent}.`);
    } else if (daysUntil <= 7) {
      parts.push(`Next event: ${nextEvent} in ${daysUntil} days.`);
    } else {
      parts.push(`Next event: ${nextEvent} on ${events[0].date}.`);
    }
  }

  // Count events by type
  const fomcCount = events.filter((e) => e.event.includes("FOMC")).length;
  const cpiCount = events.filter((e) => e.event.includes("CPI")).length;
  const jobsCount = events.filter((e) => e.event.includes("Jobs")).length;

  const summaryParts: string[] = [];
  if (fomcCount > 0) summaryParts.push(`${fomcCount} FOMC`);
  if (cpiCount > 0) summaryParts.push(`${cpiCount} CPI`);
  if (jobsCount > 0) summaryParts.push(`${jobsCount} NFP`);

  if (summaryParts.length > 0) {
    parts.push(`${events.length} macro events in next 30 days (${summaryParts.join(", ")}).`);
  }

  return parts.join(" ");
}
