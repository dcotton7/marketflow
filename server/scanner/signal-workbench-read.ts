// ---------------------------------------------------------------------------
// Signals Lab, read-only for Anima: per-horizon grades and the recorded fires.
//
// GET /api/scanner/signal-workbench/grades — every signal type graded at every horizon (15m … 1mo), from the same
//   getEvidenceSnapshot the /signal-workbench page reads, so episodes (first fire per signal type, subject and ET
//   day), hit rate, edge and the thin-sample nulls match the page exactly.
// GET /api/scanner/signal-workbench/events — the recorded fires with their later prices, oldest first, paged.
//
// Both only report. They never change, hide or re-grade a signal. This module is pure (no db) so it tests alone.
// ---------------------------------------------------------------------------

import type { OutcomeWindowKey } from "@shared/scanner-outcome-v3";
import type { EvidenceSnapshot } from "./evidence-service";

/** The page's windows, in order. Keys match the page's window picker and /workbench/hit-rates?window=. */
export const HORIZONS: OutcomeWindowKey[] = ["15m", "30m", "1hr", "4hr", "d1_close", "d2_open", "d2_close", "1w", "1mo"];

/** Column stem per horizon in scanner_discoveries (price_<stem>, move_<stem>). */
export const HORIZON_COLUMNS: Record<OutcomeWindowKey, string> = {
  "15m": "15m",
  "30m": "30m",
  "1hr": "1hr",
  "4hr": "4hr",
  d1_close: "d1_close",
  d2_open: "d2_open",
  d2_close: "d2_close",
  "1w": "1w",
  "1mo": "1mo",
};

export const EVENTS_PAGE_SIZE = 100;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TYPE = /^[A-Za-z0-9_-]{1,32}$/;

function validDay(s: string): boolean {
  if (!DAY.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function first(v: unknown): string | undefined {
  if (Array.isArray(v)) v = v[0];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function daysAgo(now: Date, n: number): string {
  return new Date(now.getTime() - n * 86_400_000).toISOString().slice(0, 10);
}

export type GradesQuery = {
  from: string;
  to: string;
  hitThreshold: number;
  minSamples: number;
  trust: "auto" | "trusted" | "provisional" | "all";
};

/** Same defaults as /workbench/hit-rates (last 30 days, 0.5% hit, 5 samples, trust auto). */
export function parseGradesQuery(q: Record<string, unknown>, now = new Date()): GradesQuery | { error: string } {
  const from = first(q.from) ?? daysAgo(now, 30);
  const to = first(q.to) ?? now.toISOString().slice(0, 10);
  if (!validDay(from) || !validDay(to)) return { error: "from and to are YYYY-MM-DD" };
  if (from > to) return { error: "from is after to" };
  const hitThreshold = first(q.hit_threshold) !== undefined ? Number(first(q.hit_threshold)) : 0.5;
  if (!Number.isFinite(hitThreshold) || hitThreshold < 0 || hitThreshold > 50) return { error: "hit_threshold is a percent, 0 to 50" };
  const minSamples = first(q.min_samples) !== undefined ? Number(first(q.min_samples)) : 5;
  if (!Number.isInteger(minSamples) || minSamples < 1 || minSamples > 1000) return { error: "min_samples is 1 to 1000" };
  const trust = (first(q.trust) ?? "auto") as GradesQuery["trust"];
  if (!["auto", "trusted", "provisional", "all"].includes(trust)) return { error: "trust is auto, trusted, provisional or all" };
  return { from, to, hitThreshold, minSamples, trust };
}

export type HorizonGrade = {
  /** Episodes with an outcome filled at this horizon — the sample size the grade rests on. */
  tracked: number;
  coverage: number;
  /** Share of tracked episodes whose direction-adjusted move ≥ hitThreshold; null when tracked < minSamples. */
  hitRate: number | null;
  hitRateShrunk: number | null;
  /** Average direction-adjusted move in percent (positive = favorable); null when tracked < minSamples. */
  edge: number | null;
  confidence: number;
  tier: string;
};

export type SignalGrades = {
  signalType: string;
  totalFired: number;
  episodes: number;
  horizons: Record<string, HorizonGrade | null>;
};

export type GradesResponse = {
  from: string;
  to: string;
  hitThreshold: number;
  minSamples: number;
  trustUsed: string;
  horizons: OutcomeWindowKey[];
  signalTypes: SignalGrades[];
  qualityWarnings: string[];
  generatedAt: string;
};

/** One row per signal type, its grade at each horizon. Signal types keep the page's order (most fired first). */
export function buildGrades(q: GradesQuery, snapshots: { window: OutcomeWindowKey; snapshot: EvidenceSnapshot }[],
  now = new Date()): GradesResponse {
  const byType = new Map<string, SignalGrades>();
  const warnings: string[] = [];
  for (const { window, snapshot } of snapshots) {
    for (const s of snapshot.signalTypes) {
      let row = byType.get(s.signalType);
      if (!row) {
        row = { signalType: s.signalType, totalFired: s.totalFired, episodes: s.episodes,
          horizons: Object.fromEntries(HORIZONS.map((h) => [h, null])) };
        byType.set(s.signalType, row);
      }
      row.totalFired = Math.max(row.totalFired, s.totalFired);
      row.episodes = Math.max(row.episodes, s.episodes);
      row.horizons[window] = {
        tracked: s.tracked,
        coverage: s.coverage,
        hitRate: s.hitRate,
        hitRateShrunk: s.hitRateShrunk,
        edge: s.avgMove,
        confidence: s.confidence,
        tier: s.tier,
      };
    }
    for (const w of snapshot.qualityWarnings) warnings.push(w);
  }
  const signalTypes = Array.from(byType.values()).sort((a, b) => b.totalFired - a.totalFired);
  return {
    from: q.from,
    to: q.to,
    hitThreshold: q.hitThreshold,
    minSamples: q.minSamples,
    trustUsed: snapshots[0]?.snapshot.trustUsed ?? "provisional",
    horizons: HORIZONS,
    signalTypes,
    qualityWarnings: Array.from(new Set(warnings)).slice(0, 20),
    generatedAt: now.toISOString(),
  };
}

export type EventsQuery = { from: string; to: string; type: string | null; page: number; pageSize: number };

/** from/to default to the last 30 days; type is one signal type or every type; page counts from 1. */
export function parseEventsQuery(q: Record<string, unknown>, now = new Date()): EventsQuery | { error: string } {
  const from = first(q.from) ?? daysAgo(now, 30);
  const to = first(q.to) ?? now.toISOString().slice(0, 10);
  if (!validDay(from) || !validDay(to)) return { error: "from and to are YYYY-MM-DD" };
  if (from > to) return { error: "from is after to" };
  const typeText = first(q.type);
  const type = typeText && typeText.toLowerCase() !== "all" ? typeText : null;
  if (type !== null && !TYPE.test(type)) return { error: "type is a signal type such as gap or volume_spike" };
  const pageText = first(q.page) ?? "1";
  const page = Number(pageText);
  if (!/^\d+$/.test(pageText) || !Number.isInteger(page) || page < 1 || page > 100_000) return { error: "page counts from 1" };
  return { from, to, type, page, pageSize: EVENTS_PAGE_SIZE };
}

export type EventOutcome = {
  price: number | null;
  /** Raw percent move from priceAtSignal. */
  move: number | null;
  /** Direction-adjusted move (short signals flip sign; non-directional take the absolute move). */
  edge: number | null;
};

export type SignalEvent = {
  id: number;
  signalType: string;
  subject: string;
  subjectKind: string;
  direction: string;
  /** First fire of this signal type on this subject that ET day — the fires the grades count. */
  episode: boolean;
  headline: string;
  tickers: string[];
  qualifyScore: number | null;
  createdAt: string;
  sessionAtSignal: string | null;
  regimeAtSignal: string | null;
  priceAtSignal: number | null;
  outcomes: Record<string, EventOutcome>;
  peakMove: number | null;
  worstDrawdown: number | null;
  givebackPct: number | null;
  outcomeStatus: string | null;
  outcomeFailed: boolean | null;
  outcomeContractVersion: string | null;
  outcomeTrackedAt: string | null;
  intradayCompleteAt: string | null;
};

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function iso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function round4(n: number | null): number | null {
  return n === null ? null : Math.round(n * 10_000) / 10_000;
}

/** Same sign rule as the evidence service's move_adj. */
export function adjustedMove(direction: string, move: number | null): number | null {
  if (move === null) return null;
  if (direction === "down") return round4(-move);
  if (direction === "up") return round4(move);
  return round4(Math.abs(move));
}

/** A scanner_discoveries row (snake_case, from db.execute) as Anima reads it. */
export function shapeEvent(r: Record<string, any>): SignalEvent {
  const direction = String(r.direction ?? "");
  const outcomes: Record<string, EventOutcome> = {};
  for (const h of HORIZONS) {
    const stem = HORIZON_COLUMNS[h];
    const move = num(r[`move_${stem}`]);
    outcomes[h] = { price: num(r[`price_${stem}`]), move, edge: adjustedMove(direction, move) };
  }
  return {
    id: Number(r.id),
    signalType: String(r.signal_type),
    subject: String(r.subject ?? ""),
    subjectKind: String(r.subject_kind ?? ""),
    direction,
    episode: typeof r.episode === "boolean" ? r.episode : r.episode === 1 || r.episode === "t",
    headline: String(r.headline ?? ""),
    tickers: Array.isArray(r.tickers) ? r.tickers.map(String) : [],
    qualifyScore: num(r.qualify_score),
    createdAt: iso(r.created_at) ?? "",
    sessionAtSignal: r.session_at_signal ?? null,
    regimeAtSignal: r.regime_at_signal ?? null,
    priceAtSignal: num(r.price_at_signal),
    outcomes,
    peakMove: num(r.peak_move),
    worstDrawdown: num(r.worst_drawdown),
    givebackPct: num(r.giveback_pct),
    outcomeStatus: r.outcome_status ?? null,
    outcomeFailed: typeof r.outcome_failed === "boolean" ? r.outcome_failed : null,
    outcomeContractVersion: r.outcome_contract_version ?? null,
    outcomeTrackedAt: iso(r.outcome_tracked_at),
    intradayCompleteAt: iso(r.intraday_complete_at),
  };
}

export type EventsResponse = {
  from: string;
  to: string;
  type: string | null;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
  events: SignalEvent[];
};

export function buildEventsPage(q: EventsQuery, total: number, rows: Record<string, any>[]): EventsResponse {
  const totalPages = Math.max(1, Math.ceil(total / q.pageSize));
  return {
    from: q.from,
    to: q.to,
    type: q.type,
    page: q.page,
    pageSize: q.pageSize,
    total,
    totalPages,
    hasMore: q.page * q.pageSize < total,
    events: rows.map(shapeEvent),
  };
}
