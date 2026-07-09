// ---------------------------------------------------------------------------
// Session Segment Capture
//
// Captures intraday segment returns (pre, AM, midday, PM, close, full_day)
// at appropriate times during the trading day. Called from the MC refresh loop.
// ---------------------------------------------------------------------------

import { saveSessionSegment } from "./session-patterns";
import type { SessionSegment, SessionSegmentReturn } from "@shared/catalyst-types";

const ET = "America/New_York";

interface SegmentBaseline {
  spyPrice: number;
  qqqPrice: number;
  iwmPrice: number;
  avgThemeScore: number;
  themesUp: number;
  themesDown: number;
}

// Baselines captured at segment boundaries
let openBaseline: SegmentBaseline | null = null;
let middayBaseline: SegmentBaseline | null = null;
let pmBaseline: SegmentBaseline | null = null;

// Track which segments have been saved today
let savedSegmentsToday = new Set<string>();
let currentTradingDate = "";

function getETMinutes(): { minutes: number; date: string; weekday: number } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const m = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    .indexOf(parts.find((p) => p.type === "weekday")?.value ?? "Mon");
  const year = parts.find((p) => p.type === "year")?.value ?? "2026";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";

  return { minutes: h * 60 + m, date: `${year}-${month}-${day}`, weekday };
}

function buildBaseline(
  spyPrice: number,
  qqqPrice: number,
  iwmPrice: number,
  avgThemeScore: number,
  themesUp: number,
  themesDown: number
): SegmentBaseline {
  return { spyPrice, qqqPrice, iwmPrice, avgThemeScore, themesUp, themesDown };
}

function computeReturn(current: number, baseline: number): number {
  if (baseline <= 0) return 0;
  return Math.round(((current - baseline) / baseline) * 10000) / 100;
}

/**
 * Called on each MC snapshot refresh to check if a session segment boundary
 * has been crossed and capture the appropriate data.
 */
export async function captureSessionSegment(data: {
  spyPrice: number;
  qqqPrice: number;
  iwmPrice: number;
  avgThemeScore: number;
  themesUp: number;
  themesDown: number;
}): Promise<void> {
  const { minutes, date, weekday } = getETMinutes();

  if (weekday === 0 || weekday === 6) return;

  // Reset on new trading day
  if (date !== currentTradingDate) {
    currentTradingDate = date;
    openBaseline = null;
    middayBaseline = null;
    pmBaseline = null;
    savedSegmentsToday = new Set();
  }

  const OPEN = 570;     // 9:30
  const MIDDAY = 720;   // 12:00
  const PM_START = 780; // 13:00
  const CLOSE = 960;    // 16:00

  // Capture open baseline (9:30-9:45 window)
  if (minutes >= OPEN && minutes < OPEN + 15 && !openBaseline) {
    openBaseline = buildBaseline(
      data.spyPrice, data.qqqPrice, data.iwmPrice,
      data.avgThemeScore, data.themesUp, data.themesDown
    );
    return;
  }

  if (!openBaseline) return;

  // AM segment: captured around 12:00 (11:45-12:15 window)
  if (minutes >= MIDDAY - 15 && minutes < MIDDAY + 15 && !savedSegmentsToday.has("am")) {
    savedSegmentsToday.add("am");
    middayBaseline = buildBaseline(
      data.spyPrice, data.qqqPrice, data.iwmPrice,
      data.avgThemeScore, data.themesUp, data.themesDown
    );

    const seg: SessionSegmentReturn = {
      date,
      segment: "am",
      spyReturn: computeReturn(data.spyPrice, openBaseline.spyPrice),
      qqqReturn: computeReturn(data.qqqPrice, openBaseline.qqqPrice),
      iwmReturn: computeReturn(data.iwmPrice, openBaseline.iwmPrice),
      avgThemeScore: data.avgThemeScore,
      themesUp: data.themesUp,
      themesDown: data.themesDown,
    };
    await saveSessionSegment(seg);
  }

  // Midday segment: captured around 13:00 (12:45-13:15 window)
  if (
    minutes >= PM_START - 15 && minutes < PM_START + 15 &&
    !savedSegmentsToday.has("midday") &&
    middayBaseline
  ) {
    savedSegmentsToday.add("midday");
    pmBaseline = buildBaseline(
      data.spyPrice, data.qqqPrice, data.iwmPrice,
      data.avgThemeScore, data.themesUp, data.themesDown
    );

    const seg: SessionSegmentReturn = {
      date,
      segment: "midday",
      spyReturn: computeReturn(data.spyPrice, middayBaseline.spyPrice),
      qqqReturn: computeReturn(data.qqqPrice, middayBaseline.qqqPrice),
      iwmReturn: computeReturn(data.iwmPrice, middayBaseline.iwmPrice),
      avgThemeScore: data.avgThemeScore,
      themesUp: data.themesUp,
      themesDown: data.themesDown,
    };
    await saveSessionSegment(seg);
  }

  // PM segment: captured around 16:00 (15:50-16:10 window)
  if (
    minutes >= CLOSE - 10 && minutes < CLOSE + 10 &&
    !savedSegmentsToday.has("pm") &&
    pmBaseline
  ) {
    savedSegmentsToday.add("pm");

    const seg: SessionSegmentReturn = {
      date,
      segment: "pm",
      spyReturn: computeReturn(data.spyPrice, pmBaseline.spyPrice),
      qqqReturn: computeReturn(data.qqqPrice, pmBaseline.qqqPrice),
      iwmReturn: computeReturn(data.iwmPrice, pmBaseline.iwmPrice),
      avgThemeScore: data.avgThemeScore,
      themesUp: data.themesUp,
      themesDown: data.themesDown,
    };
    await saveSessionSegment(seg);
  }

  // Full day segment: captured after close (16:05-16:30 window)
  if (minutes >= CLOSE + 5 && minutes < CLOSE + 30 && !savedSegmentsToday.has("full_day")) {
    savedSegmentsToday.add("full_day");

    const seg: SessionSegmentReturn = {
      date,
      segment: "full_day",
      spyReturn: computeReturn(data.spyPrice, openBaseline.spyPrice),
      qqqReturn: computeReturn(data.qqqPrice, openBaseline.qqqPrice),
      iwmReturn: computeReturn(data.iwmPrice, openBaseline.iwmPrice),
      avgThemeScore: data.avgThemeScore,
      themesUp: data.themesUp,
      themesDown: data.themesDown,
    };
    await saveSessionSegment(seg);
  }
}
