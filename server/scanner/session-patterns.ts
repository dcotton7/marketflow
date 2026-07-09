// ---------------------------------------------------------------------------
// Session Pattern Tracker
//
// Records intraday session segment returns (AM vs PM vs close) and computes
// multi-day patterns like "AM strong / PM fade 6/10 days."
//
// Data source: theme_snapshots hourly rows + benchmark data from MC state.
// Stores aggregated segment stats in session_segment_stats table.
// ---------------------------------------------------------------------------

import { getDb } from "../db";
import { sql } from "drizzle-orm";
import type { SessionSegment, SessionSegmentReturn, SessionPattern } from "@shared/catalyst-types";

// ── Save a segment stat row ─────────────────────────────────────────────────

export async function saveSessionSegment(stat: SessionSegmentReturn): Promise<void> {
  const db = getDb();
  if (!db) return;

  try {
    await db.execute(sql`
      INSERT INTO session_segment_stats
        (market_date, segment, spy_return, qqq_return, iwm_return,
         avg_theme_score, themes_up, themes_down)
      VALUES
        (${stat.date}, ${stat.segment}, ${stat.spyReturn}, ${stat.qqqReturn},
         ${stat.iwmReturn}, ${stat.avgThemeScore}, ${stat.themesUp}, ${stat.themesDown})
      ON CONFLICT (market_date, segment) DO UPDATE SET
        spy_return = EXCLUDED.spy_return,
        qqq_return = EXCLUDED.qqq_return,
        iwm_return = EXCLUDED.iwm_return,
        avg_theme_score = EXCLUDED.avg_theme_score,
        themes_up = EXCLUDED.themes_up,
        themes_down = EXCLUDED.themes_down
    `);
  } catch (err) {
    console.warn("[SessionPatterns] Failed to save segment:", err);
  }
}

// ── Load N days of segment data ─────────────────────────────────────────────

export async function loadRecentSegments(
  days: number = 15
): Promise<SessionSegmentReturn[]> {
  const db = getDb();
  if (!db) return [];

  try {
    const result = await db.execute(sql`
      SELECT market_date, segment, spy_return, qqq_return, iwm_return,
             avg_theme_score, themes_up, themes_down
      FROM session_segment_stats
      ORDER BY market_date DESC, segment
      LIMIT ${days * 6}
    `);

    return ((result as any).rows ?? []).map((r: any) => ({
      date: String(r.market_date).slice(0, 10),
      segment: r.segment as SessionSegment,
      spyReturn: Number(r.spy_return),
      qqqReturn: Number(r.qqq_return),
      iwmReturn: Number(r.iwm_return),
      avgThemeScore: Number(r.avg_theme_score),
      themesUp: Number(r.themes_up),
      themesDown: Number(r.themes_down),
    }));
  } catch (err) {
    console.warn("[SessionPatterns] Failed to load segments:", err);
    return [];
  }
}

// ── Pattern detection ───────────────────────────────────────────────────────

export async function detectSessionPatterns(
  lookbackDays: number = 10
): Promise<SessionPattern[]> {
  const segments = await loadRecentSegments(lookbackDays);
  if (segments.length === 0) return [];

  const patterns: SessionPattern[] = [];

  // Group by date
  const byDate = new Map<string, Map<SessionSegment, SessionSegmentReturn>>();
  for (const seg of segments) {
    if (!byDate.has(seg.date)) byDate.set(seg.date, new Map());
    byDate.get(seg.date)!.set(seg.segment, seg);
  }

  const dates = [...byDate.keys()].sort().reverse().slice(0, lookbackDays);
  if (dates.length < 3) return [];

  // Pattern: AM Strong / PM Fade
  let amStrongPmFade = 0;
  let amStrongPmFadeMag = 0;
  let lastAmPmFade = "";

  // Pattern: AM Weak / PM Rally
  let amWeakPmRally = 0;
  let amWeakPmRallyMag = 0;
  let lastAmPmRally = "";

  // Pattern: Consistent Direction (all day strong or all day weak)
  let allDayStrong = 0;
  let allDayWeak = 0;

  // Pattern: Midday reversal
  let middayReversal = 0;

  for (const date of dates) {
    const segs = byDate.get(date)!;
    const am = segs.get("am");
    const pm = segs.get("pm");
    const midday = segs.get("midday");

    if (!am || !pm) continue;

    // AM Strong / PM Fade: AM spy positive, PM spy negative
    if (am.spyReturn > 0.15 && pm.spyReturn < -0.1) {
      amStrongPmFade++;
      amStrongPmFadeMag += Math.abs(pm.spyReturn);
      lastAmPmFade = date;
    }

    // AM Weak / PM Rally: AM spy negative, PM spy positive
    if (am.spyReturn < -0.15 && pm.spyReturn > 0.1) {
      amWeakPmRally++;
      amWeakPmRallyMag += pm.spyReturn;
      lastAmPmRally = date;
    }

    // All day strong
    if (am.spyReturn > 0.1 && pm.spyReturn > 0.05) allDayStrong++;

    // All day weak
    if (am.spyReturn < -0.1 && pm.spyReturn < -0.05) allDayWeak++;

    // Midday reversal
    if (midday && am.spyReturn > 0.15 && midday.spyReturn < -0.1) middayReversal++;
    if (midday && am.spyReturn < -0.15 && midday.spyReturn > 0.1) middayReversal++;
  }

  const total = dates.length;

  if (amStrongPmFade >= 3) {
    const freq = amStrongPmFade / total;
    patterns.push({
      pattern: "am_strong_pm_fade",
      description: `Morning pushes have led to afternoon declines ${amStrongPmFade}/${total} recent trading days.`,
      frequency: Math.round(freq * 100) / 100,
      occurrences: amStrongPmFade,
      totalDays: total,
      avgMagnitude: Math.round((amStrongPmFadeMag / amStrongPmFade) * 100) / 100,
      lastOccurrence: lastAmPmFade,
      confidence: freq >= 0.6 ? "high" : freq >= 0.4 ? "medium" : "low",
    });
  }

  if (amWeakPmRally >= 3) {
    const freq = amWeakPmRally / total;
    patterns.push({
      pattern: "am_weak_pm_rally",
      description: `Weak mornings have been followed by afternoon recoveries ${amWeakPmRally}/${total} recent days.`,
      frequency: Math.round(freq * 100) / 100,
      occurrences: amWeakPmRally,
      totalDays: total,
      avgMagnitude: Math.round((amWeakPmRallyMag / amWeakPmRally) * 100) / 100,
      lastOccurrence: lastAmPmRally,
      confidence: freq >= 0.6 ? "high" : freq >= 0.4 ? "medium" : "low",
    });
  }

  if (allDayStrong >= 4) {
    patterns.push({
      pattern: "persistent_strength",
      description: `Market has maintained strength open-to-close ${allDayStrong}/${total} days — dip-buying prevalent.`,
      frequency: Math.round((allDayStrong / total) * 100) / 100,
      occurrences: allDayStrong,
      totalDays: total,
      avgMagnitude: 0,
      lastOccurrence: dates[0] ?? "",
      confidence: allDayStrong / total >= 0.5 ? "high" : "medium",
    });
  }

  if (allDayWeak >= 4) {
    patterns.push({
      pattern: "persistent_weakness",
      description: `Market has sold off open-to-close ${allDayWeak}/${total} days — rallies being sold.`,
      frequency: Math.round((allDayWeak / total) * 100) / 100,
      occurrences: allDayWeak,
      totalDays: total,
      avgMagnitude: 0,
      lastOccurrence: dates[0] ?? "",
      confidence: allDayWeak / total >= 0.5 ? "high" : "medium",
    });
  }

  if (middayReversal >= 3) {
    patterns.push({
      pattern: "midday_reversal",
      description: `Market direction has reversed around midday ${middayReversal}/${total} days — be cautious chasing AM moves.`,
      frequency: Math.round((middayReversal / total) * 100) / 100,
      occurrences: middayReversal,
      totalDays: total,
      avgMagnitude: 0,
      lastOccurrence: dates[0] ?? "",
      confidence: middayReversal / total >= 0.4 ? "medium" : "low",
    });
  }

  return patterns;
}

// ── Add session patterns endpoint to routes ─────────────────────────────────

export async function getSessionPatternsForApi(lookback?: number): Promise<{
  patterns: SessionPattern[];
  segments: SessionSegmentReturn[];
}> {
  const days = lookback ?? 10;
  const [patterns, segments] = await Promise.all([
    detectSessionPatterns(days),
    loadRecentSegments(days),
  ]);
  return { patterns, segments };
}
