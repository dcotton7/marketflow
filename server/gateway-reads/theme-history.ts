/**
 * Theme, sector and cap-size moves between two instants, and intraday velocity (docs/gateway-reads.md, item 3).
 * Reads only stored history; never calls a vendor.
 *
 * Stored history it reads:
 *   theme_ticks_5m   (migration 028, from 20 Nov 2026): per theme every 5 minutes in market hours: rank, score, median
 *                    day % of members (vs previous close), RS vs SPY, share of members green.
 *   group_ticks_5m   (migration 030, from the deploy of this change): the same for sectors and cap-size buckets, and
 *                    SPY's day %.
 *   historical_bars  daily closes (about 330 calendar days) and theme_membership_daily (from 20 Nov 2026).
 *
 * Two ways to answer a move, and the answer says which:
 *   "member_closes"  both ends are dates: each member's close-to-close % between the two sessions' daily bars; the
 *                    median, the share of members up over the span and the member count are exact. Themes use the
 *                    stored membership of the first session (the earliest stored day when the span starts before
 *                    20 Nov; today's membership when none is stored); sectors and sizes use the tickers table's
 *                    current sector and size bucket.
 *   "stored_ticks"   an end has a time: the stored 5-minute reads. A theme's move is its median day % carried from
 *                    one read to the other: (1 + m_to) / (1 + m_from) within a session; across sessions the first
 *                    session's last read and every session between are chained. This is the move of the theme's
 *                    median, not the median of members' own moves over the span; breadth is the day's share green
 *                    at each end. A trading day with no reads inside the span makes it unanswerable this way.
 * Each end is the nearest stored read (or session) at or before the instant asked, with how far off it is.
 */
import { sql } from "drizzle-orm";
import { getEtClock, getUsEquityMarketSession } from "@shared/usEquityMarketSession";
import { isMarketHoliday } from "@shared/us-market-holidays";
import { median } from "../market-condition/engine/group-ticks";

export type Group = "theme" | "sector" | "size";
export const GROUPS: Group[] = ["theme", "sector", "size"];
export const WINDOWS = [5, 15, 30, 60];
export const MAX_TICK_SPAN_DAYS = 62;
export const MAX_CLOSE_SPAN_DAYS = 400;
const MIN = 60_000;

export interface TickRow { slotAt: Date; marketDate: string; id: string; rank: number; medianPct: number | null; breadthPct: number | null; spyPct: number | null; members: number | null }

export interface HistorySource {
  /** First and last stored read for the group, or null when none is stored. */
  tickRange(g: Group): Promise<{ first: Date; last: Date } | null>;
  slotAtOrBefore(g: Group, t: Date): Promise<Date | null>;
  slotAtOrAfter(g: Group, t: Date): Promise<Date | null>;
  rowsAt(g: Group, slot: Date): Promise<TickRow[]>;
  /** Each session's last read per group, for sessions from `fromDate` (inclusive) to `toDate` (exclusive). */
  sessionLastRows(g: Group, fromDate: string, toDate: string): Promise<TickRow[]>;
  /** SPY's day % at a slot (group_ticks_5m's benchmark row), when stored. */
  spyAt?(slot: Date): Promise<number | null>;
  // daily closes
  barRange(): Promise<{ first: string; last: string } | null>;
  sessionOnOrBefore(date: string): Promise<string | null>;
  members(g: Group, date: string): Promise<{ groups: Map<string, string[]>; asOf: string; note: string | null }>;
  closes(symbols: string[], dates: string[]): Promise<Map<string, Map<string, number>>>;
  /** Rank per group at a session's end (its last read), when stored. */
  ranksOn(g: Group, date: string): Promise<Map<string, number>>;
}

export class Refusal extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) { super(message); }
}

// ---- instants ----------------------------------------------------------------------------------------------------
/** A wall-clock time in New York to the instant. */
export function etToUtc(date: string, minuteOfDay: number): Date {
  const [y, m, d] = date.split("-").map(Number);
  for (const offsetH of [4, 5]) {
    const t = new Date(Date.UTC(y, m - 1, d, 0, minuteOfDay) + offsetH * 3600_000);
    const c = getEtClock(t);
    if (c.dateKey === date && c.minuteOfDay === minuteOfDay) return t;
  }
  return new Date(Date.UTC(y, m - 1, d, 0, minuteOfDay) + 5 * 3600_000);
}

export interface Instant { raw: string; dateOnly: boolean; date: string; at: Date }
/** "YYYY-MM-DD" = that day's close (16:00 New York). A date-time without a zone is New York time. */
export function parseInstant(raw: unknown): Instant | null {
  const s = String(raw ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    if (Number.isNaN(Date.parse(s + "T00:00:00Z"))) return null;
    return { raw: s, dateOnly: true, date: s, at: etToUtc(s, 16 * 60) };
  }
  const local = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(s);
  if (local) {
    const h = Number(local[2]), mi = Number(local[3]);
    if (h > 23 || mi > 59 || Number.isNaN(Date.parse(local[1] + "T00:00:00Z"))) return null;
    const at = etToUtc(local[1], h * 60 + mi);
    return { raw: s, dateOnly: false, date: getEtClock(at).dateKey, at };
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const t = Date.parse(s);
    if (Number.isNaN(t)) return null;
    const at = new Date(t);
    return { raw: s, dateOnly: false, date: getEtClock(at).dateKey, at };
  }
  return null;
}

const isTradingDay = (d: string) => {
  const wd = new Date(d + "T12:00:00Z").getUTCDay();
  return wd >= 1 && wd <= 5 && !isMarketHoliday(d);
};
const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5);
export function tradingDaysBetween(a: string, b: string): string[] {
  const out: string[] = [];
  for (let d = addDays(a, 1); d < b; d = addDays(d, 1)) if (isTradingDay(d)) out.push(d);
  return out;
}
const r2 = (n: number | null) => (n === null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100);
const factor = (pct: number) => 1 + pct / 100;
const etTime = (t: Date) => {
  const c = getEtClock(t);
  return `${c.dateKey} ${String(Math.floor(c.minuteOfDay / 60)).padStart(2, "0")}:${String(c.minuteOfDay % 60).padStart(2, "0")} ET`;
};

/** SPY's day % at a slot: the benchmark row when stored, else from the theme rows (median_pct - rs_vs_benchmark). */
function spyOf(rows: TickRow[]): number | null {
  const xs = rows.map((r) => r.spyPct).filter((x): x is number => x !== null && Number.isFinite(x));
  return xs.length ? Math.round(median(xs) * 100) / 100 : null;
}

export interface MoveRow {
  id: string; name: string;
  movePct: number | null; vsSpyPct: number | null; rankByMove: number | null;
  breadthUpPct: number | null; dayBreadthFrom: number | null; dayBreadthTo: number | null;
  rankFrom: number | null; rankTo: number | null; rankChange: number | null;
  members: number | null; membersMissing?: number; note?: string;
}
export interface MoveAnswer {
  group: Group; method: "member_closes" | "stored_ticks";
  from: { asked: string; resolved: string; offsetMinutes?: number; offsetDays?: number; session: string };
  to: { asked: string; resolved: string; offsetMinutes?: number; offsetDays?: number; session: string };
  spyMovePct: number | null;
  rows: MoveRow[];
  available: { from: string; to: string };
  notes: string[];
}

function rankByMove(rows: MoveRow[]) {
  const ranked = rows.filter((r) => r.movePct !== null).sort((a, b) => b.movePct! - a.movePct!);
  ranked.forEach((r, i) => (r.rankByMove = i + 1));
}

/** The move between two instants. Throws Refusal (with the available range) when the history cannot answer. */
export async function themeMove(src: HistorySource, g: Group, from: Instant, to: Instant, opts: { ids?: Set<string> | null; names?: (id: string) => string; now?: Date } = {}): Promise<MoveAnswer> {
  const now = opts.now ?? new Date();
  const name = opts.names ?? ((id: string) => id);
  if (from.at.getTime() >= to.at.getTime()) throw new Refusal(400, "from must be before to");
  if (to.at.getTime() > now.getTime() + MIN && !(to.dateOnly && to.date === getEtClock(now).dateKey)) throw new Refusal(400, "to is in the future");
  const keep = (id: string) => !opts.ids || opts.ids.has(id.toUpperCase());
  return from.dateOnly && to.dateOnly ? moveFromCloses(src, g, from, to, keep, name) : moveFromTicks(src, g, from, to, keep, name);
}

async function moveFromCloses(src: HistorySource, g: Group, from: Instant, to: Instant, keep: (id: string) => boolean, name: (id: string) => string): Promise<MoveAnswer> {
  const range = await src.barRange();
  if (!range) throw new Refusal(404, "no daily bars are stored");
  const available = { from: range.first, to: range.last };
  if (from.date < range.first || to.date < range.first) throw new Refusal(422, `daily closes are stored from ${range.first} to ${range.last}`, { available });
  if (daysBetween(from.date, to.date) > MAX_CLOSE_SPAN_DAYS) throw new Refusal(422, `span longer than ${MAX_CLOSE_SPAN_DAYS} days`, { available });
  const d1 = await src.sessionOnOrBefore(from.date), d2 = await src.sessionOnOrBefore(to.date);
  if (!d1 || !d2) throw new Refusal(422, `no stored session on or before ${!d1 ? from.date : to.date}`, { available });
  if (d1 === d2) throw new Refusal(422, `both dates resolve to the same session (${d1}); ask dates with a session between them, or times`, { available });
  const mem = await src.members(g, d1);
  const groups = [...mem.groups].filter(([id]) => keep(id));
  const syms = [...new Set(["SPY", ...groups.flatMap(([, s]) => s)])];
  const closes = await src.closes(syms, [d1, d2]);
  const pct = (s: string) => {
    const c = closes.get(s);
    const a = c?.get(d1), b = c?.get(d2);
    return a && b && a > 0 ? (b / a - 1) * 100 : null;
  };
  const spy = pct("SPY");
  const [rk1, rk2] = await Promise.all([src.ranksOn(g, d1), src.ranksOn(g, d2)]);
  const rows: MoveRow[] = groups.map(([id, members]) => {
    const moves = members.map(pct).filter((x): x is number => x !== null);
    const m = moves.length ? median(moves) : null;
    const rf = rk1.get(id) ?? null, rt = rk2.get(id) ?? null;
    return {
      id, name: name(id), movePct: r2(m), vsSpyPct: m !== null && spy !== null ? r2(m - spy) : null, rankByMove: null,
      breadthUpPct: moves.length ? r2((moves.filter((x) => x > 0).length / moves.length) * 100) : null, dayBreadthFrom: null, dayBreadthTo: null,
      rankFrom: rf, rankTo: rt, rankChange: rf !== null && rt !== null ? rf - rt : null,
      members: moves.length, membersMissing: members.length - moves.length,
    };
  });
  rankByMove(rows);
  rows.sort((a, b) => (a.rankByMove ?? 1e9) - (b.rankByMove ?? 1e9));
  return {
    group: g, method: "member_closes",
    from: { asked: from.raw, resolved: d1, offsetDays: daysBetween(d1, from.date), session: d1 },
    to: { asked: to.raw, resolved: d2, offsetDays: daysBetween(d2, to.date), session: d2 },
    spyMovePct: r2(spy), rows, available,
    notes: [
      "member_closes: each member's close-to-close % between the two sessions' daily bars; movePct is the median, breadthUpPct the share of members up over the span, members the names with both closes.",
      `members as of ${mem.asOf}${mem.note ? ` (${mem.note})` : ""}`,
      "rankFrom / rankTo: the theme engine's rank at each session's last stored read (null when not stored); rankChange > 0 = climbed. rankByMove ranks the span's move.",
    ],
  };
}

async function moveFromTicks(src: HistorySource, g: Group, from: Instant, to: Instant, keep: (id: string) => boolean, name: (id: string) => string): Promise<MoveAnswer> {
  const range = await src.tickRange(g);
  if (!range) throw new Refusal(404, `no 5-minute ${g} history is stored yet`);
  const available = { from: range.first.toISOString(), to: range.last.toISOString() };
  if (from.at < range.first) throw new Refusal(422, `5-minute ${g} reads are stored from ${etTime(range.first)} to ${etTime(range.last)}; ask a later start, or two dates (member closes go back further)`, { available });
  if (to.at.getTime() - from.at.getTime() > MAX_TICK_SPAN_DAYS * 864e5) throw new Refusal(422, `span longer than ${MAX_TICK_SPAN_DAYS} days for 5-minute reads; ask two dates instead`, { available });
  const s1 = await src.slotAtOrBefore(g, from.at), s2 = await src.slotAtOrBefore(g, to.at);
  if (!s1 || !s2) throw new Refusal(422, "no stored read at or before the start", { available });
  if (s1.getTime() === s2.getTime()) throw new Refusal(422, `both ends resolve to the same stored read (${etTime(s1)}): nothing was read between them`, { available, read: s1.toISOString() });
  const [rows1, rows2] = await Promise.all([src.rowsAt(g, s1), src.rowsAt(g, s2)]);
  const d1 = rows1[0]?.marketDate ?? getEtClock(s1).dateKey, d2 = rows2[0]?.marketDate ?? getEtClock(s2).dateKey;
  const mid = d1 === d2 ? [] : await src.sessionLastRows(g, d1, d2);
  const sessionsWithReads = new Set(mid.map((r) => r.marketDate));
  const missing = d1 === d2 ? [] : tradingDaysBetween(d1, d2).filter((d) => !sessionsWithReads.has(d));
  if (missing.length) throw new Refusal(422, `no stored reads on ${missing.join(", ")} inside the span; ask two dates (member closes) instead`, { available, missingSessions: missing });
  const lastBy = new Map<string, Map<string, TickRow>>(); // date -> id -> last row
  for (const r of mid) (lastBy.get(r.marketDate) ?? lastBy.set(r.marketDate, new Map()).get(r.marketDate)!).set(r.id, r);
  const chain = d1 === d2 ? [] : [d1, ...tradingDaysBetween(d1, d2)];
  const notes: string[] = [];
  const shortCloses = chain.filter((d) => {
    const any = lastBy.get(d)?.values().next().value as TickRow | undefined;
    return any && getEtClock(any.slotAt).minuteOfDay < 15 * 60 + 50;
  });
  if (shortCloses.length) notes.push(`the last stored read of ${shortCloses.join(", ")} is before 15:50 ET, so that session's close is the last read, not the close`);
  const dayRows = (d: string) => [...(lastBy.get(d)?.values() ?? [])];
  /** Carry a day % from the first read to the last: within a session, or chained through each session's last read. */
  const carry = (a: number | null, closes: (number | null)[], b: number | null): number | null => {
    if (a === null || b === null || closes.some((c) => c === null)) return null;
    if (d1 === d2) return (factor(b) / factor(a) - 1) * 100;
    const f = closes.reduce((acc: number, c) => acc * factor(c!), 1 / factor(a));
    return (f * factor(b) - 1) * 100;
  };
  const spyAt = async (rows: TickRow[]) => {
    if (!rows.length) return null;
    const stored = src.spyAt ? await src.spyAt(rows[0].slotAt) : null;
    return stored ?? spyOf(rows);
  };
  const spyCloses: (number | null)[] = [];
  for (const d of chain) spyCloses.push(await spyAt(dayRows(d)));
  const spy = carry(await spyAt(rows1), spyCloses, await spyAt(rows2));
  const ids = [...new Set([...rows1, ...rows2].map((r) => r.id))].filter(keep).sort();
  const out: MoveRow[] = ids.map((id) => {
    const one = (rows: TickRow[]) => rows.find((r) => r.id === id) ?? null;
    const a = one(rows1), b = one(rows2);
    const m = carry(a?.medianPct ?? null, chain.map((d) => lastBy.get(d)?.get(id)?.medianPct ?? null), b?.medianPct ?? null);
    return {
      id, name: name(id), movePct: r2(m), vsSpyPct: m !== null && spy !== null ? r2(m - spy) : null, rankByMove: null,
      breadthUpPct: null, dayBreadthFrom: a?.breadthPct ?? null, dayBreadthTo: b?.breadthPct ?? null,
      rankFrom: a?.rank ?? null, rankTo: b?.rank ?? null, rankChange: a && b ? a.rank - b.rank : null,
      members: b?.members ?? null, ...(m === null ? { note: "not read at every point the span needs" } : {}),
    };
  });
  rankByMove(out);
  out.sort((a, b) => (a.rankByMove ?? 1e9) - (b.rankByMove ?? 1e9));
  return {
    group: g, method: "stored_ticks",
    from: { asked: from.raw, resolved: s1.toISOString(), offsetMinutes: Math.round((from.at.getTime() - s1.getTime()) / MIN), session: d1 },
    to: { asked: to.raw, resolved: s2.toISOString(), offsetMinutes: Math.round((to.at.getTime() - s2.getTime()) / MIN), session: d2 },
    spyMovePct: r2(spy), rows: out, available,
    notes: [
      "stored_ticks: movePct carries each group's stored median day % from the first read to the last (chained across sessions); it is the move of the group's median, not the median of its members' own moves. dayBreadthFrom/To = share of members green on the day at each read.",
      "rankChange > 0 = climbed. Each end is the nearest stored read at or before the instant asked (offsetMinutes = how far before).",
      ...notes,
    ],
  };
}

// ---- velocity ----------------------------------------------------------------------------------------------------
export interface VelocityRow {
  id: string; name: string;
  medianPct: number | null; rank: number | null;
  deltaPct: number | null; perHourPct: number | null;
  rankChange: number | null; rankPerHour: number | null;
  prevPerHourPct: number | null; accelerationPerHour: number | null;
  members: number | null;
}
export interface VelocityAnswer {
  group: Group; windowMinutes: number;
  at: string; marketOpen: boolean; session: string;
  end: string; start: string; prevStart: string | null;
  minutes: number; prevMinutes: number | null; partial: boolean;
  rows: VelocityRow[]; up: VelocityRow[]; down: VelocityRow[];
  notes: string[];
}

export async function velocity(src: HistorySource, g: Group, windowMin: number, at: Date, opts: { limit?: number; names?: (id: string) => string; ids?: Set<string> | null } = {}): Promise<VelocityAnswer> {
  if (!WINDOWS.includes(windowMin)) throw new Refusal(400, `window must be one of ${WINDOWS.join(", ")} minutes`);
  const name = opts.names ?? ((id: string) => id);
  const range = await src.tickRange(g);
  if (!range) throw new Refusal(404, `no 5-minute ${g} history is stored yet`);
  const available = { from: range.first.toISOString(), to: range.last.toISOString() };
  if (at < range.first) throw new Refusal(422, `5-minute ${g} reads are stored from ${etTime(range.first)} to ${etTime(range.last)}`, { available });
  const end = await src.slotAtOrBefore(g, at);
  if (!end) throw new Refusal(422, "no stored read at or before that time", { available });
  const session = getEtClock(end).dateKey;
  const marketOpen = getUsEquityMarketSession(at) === "regular" && getEtClock(at).dateKey === session && at.getTime() - end.getTime() <= 15 * MIN;
  // three stored reads: the end, the window's start and the window before's start, all in the end's session
  const first = (await src.slotAtOrAfter(g, etToUtc(session, 9 * 60 + 30)))?.getTime() ?? end.getTime();
  const within = (d: Date | null) => (d && d.getTime() >= first ? d.getTime() : null);
  let start = within(await src.slotAtOrBefore(g, new Date(end.getTime() - windowMin * MIN)));
  const partial = start === null;
  if (start === null) start = first;
  if (start >= end.getTime()) throw new Refusal(422, `only one stored read in the session of ${session} up to ${etTime(end)}: no window to measure`, { available, end: end.toISOString() });
  let prev = partial ? null : within(await src.slotAtOrBefore(g, new Date(start - windowMin * MIN)));
  if (prev === null && !partial && first < start) prev = first;
  const bySlot = new Map<number, TickRow[]>();
  for (const slot of [end.getTime(), start, prev]) if (slot !== null && !bySlot.has(slot)) bySlot.set(slot, await src.rowsAt(g, new Date(slot)));
  const minutes = (end.getTime() - start) / MIN;
  const prevMinutes = prev === null ? null : (start - prev) / MIN;
  const pick = (slot: number | null, id: string) => (slot === null ? null : bySlot.get(slot)?.find((r) => r.id === id) ?? null);
  const ids = [...new Set((bySlot.get(end.getTime()) ?? []).map((r) => r.id))].filter((id) => !opts.ids || opts.ids.has(id.toUpperCase()));
  const pctMove = (a: number | null | undefined, b: number | null | undefined) => (a === null || a === undefined || b === null || b === undefined ? null : (factor(b) / factor(a) - 1) * 100);
  const all: VelocityRow[] = ids.map((id) => {
    const e = pick(end.getTime(), id)!, s = pick(start, id), p = pick(prev, id);
    const delta = pctMove(s?.medianPct, e.medianPct);
    const perHour = delta === null ? null : (delta * 60) / minutes;
    const prevDelta = prevMinutes === null ? null : pctMove(p?.medianPct, s?.medianPct);
    const prevPerHour = prevDelta === null || !prevMinutes ? null : (prevDelta * 60) / prevMinutes;
    const rankChange = s ? s.rank - e.rank : null;
    return {
      id, name: name(id), medianPct: e.medianPct, rank: e.rank,
      deltaPct: r2(delta), perHourPct: r2(perHour),
      rankChange, rankPerHour: rankChange === null ? null : r2((rankChange * 60) / minutes),
      prevPerHourPct: r2(prevPerHour), accelerationPerHour: perHour !== null && prevPerHour !== null ? r2(perHour - prevPerHour) : null,
      members: e.members,
    };
  });
  all.sort((a, b) => Math.abs(b.perHourPct ?? 0) - Math.abs(a.perHourPct ?? 0) || a.id.localeCompare(b.id));
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 50));
  const top = Math.min(5, limit);
  const notes = [
    "deltaPct: change of the group's median day % over the window ((1 + now) / (1 + then) - 1); perHourPct = deltaPct per 60 minutes; accelerationPerHour = this window's perHourPct minus the window before's. rankChange > 0 = climbed.",
    "regular session only (reads are written 9:30-16:00 ET); end/start/prevStart are the stored reads used.",
  ];
  if (!marketOpen) notes.unshift(`market closed at ${etTime(at)}: these are the final windows of the session of ${session} (last read ${etTime(end)})`);
  if (partial) notes.push(`the session's first read is ${etTime(new Date(start))}: this window is ${minutes} minutes, not ${windowMin}`);
  else if (minutes !== windowMin) notes.push(`reads were missing: this window is ${minutes} minutes`);
  return {
    group: g, windowMinutes: windowMin, at: at.toISOString(), marketOpen, session,
    end: end.toISOString(), start: new Date(start).toISOString(), prevStart: prev === null ? null : new Date(prev).toISOString(),
    minutes, prevMinutes, partial,
    rows: all.slice(0, limit),
    up: all.filter((r) => (r.perHourPct ?? 0) > 0).sort((a, b) => b.perHourPct! - a.perHourPct!).slice(0, top),
    down: all.filter((r) => (r.perHourPct ?? 0) < 0).sort((a, b) => a.perHourPct! - b.perHourPct!).slice(0, top),
    notes,
  };
}

// ---- Postgres --------------------------------------------------------------------------------------------------
type Exec = { execute: (q: any) => Promise<any> };
const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : r?.rows ?? []);
const n = (x: unknown) => (x === null || x === undefined || !Number.isFinite(Number(x)) ? null : Number(x));

export function pgHistorySource(db: Exec, opts: { themeMembersNow?: () => Promise<Map<string, string[]>> } = {}): HistorySource {
  const themeRow = (x: any): TickRow => ({
    slotAt: new Date(x.slot_at), marketDate: String(x.market_date), id: String(x.theme_id), rank: Number(x.rank), medianPct: n(x.median_pct), breadthPct: n(x.breadth_pct),
    spyPct: n(x.median_pct) !== null && n(x.rs_vs_benchmark) !== null ? n(x.median_pct)! - n(x.rs_vs_benchmark)! : null, members: null,
  });
  const groupRow = (x: any): TickRow => ({
    slotAt: new Date(x.slot_at), marketDate: String(x.market_date), id: String(x.group_id), rank: Number(x.rank), medianPct: n(x.median_pct), breadthPct: n(x.breadth_pct), spyPct: null, members: n(x.members),
  });
  const safe = async <T>(f: () => Promise<T>, fallback: T): Promise<T> => { try { return await f(); } catch { return fallback; } };
  const T_COLS = sql`slot_at, market_date, theme_id, rank, median_pct, breadth_pct, rs_vs_benchmark`;
  const G_COLS = sql`slot_at, market_date, group_id, rank, median_pct, breadth_pct, members`;
  return {
    tickRange: (g) => safe(async () => {
      const r = rowsOf(await (g === "theme"
        ? db.execute(sql`SELECT MIN(slot_at) AS a, MAX(slot_at) AS b FROM theme_ticks_5m`)
        : db.execute(sql`SELECT MIN(slot_at) AS a, MAX(slot_at) AS b FROM group_ticks_5m WHERE kind = ${g}`)))[0];
      return r?.a ? { first: new Date(r.a), last: new Date(r.b) } : null;
    }, null),
    slotAtOrBefore: (g, t) => safe(async () => {
      const r = rowsOf(await (g === "theme"
        ? db.execute(sql`SELECT MAX(slot_at) AS s FROM theme_ticks_5m WHERE slot_at <= ${t.toISOString()}::timestamptz`)
        : db.execute(sql`SELECT MAX(slot_at) AS s FROM group_ticks_5m WHERE kind = ${g} AND slot_at <= ${t.toISOString()}::timestamptz`)))[0];
      return r?.s ? new Date(r.s) : null;
    }, null),
    slotAtOrAfter: (g, t) => safe(async () => {
      const r = rowsOf(await (g === "theme"
        ? db.execute(sql`SELECT MIN(slot_at) AS s FROM theme_ticks_5m WHERE slot_at >= ${t.toISOString()}::timestamptz`)
        : db.execute(sql`SELECT MIN(slot_at) AS s FROM group_ticks_5m WHERE kind = ${g} AND slot_at >= ${t.toISOString()}::timestamptz`)))[0];
      return r?.s ? new Date(r.s) : null;
    }, null),
    async rowsAt(g, slot) {
      const at = slot.toISOString();
      return g === "theme"
        ? rowsOf(await db.execute(sql`SELECT ${T_COLS} FROM theme_ticks_5m WHERE slot_at = ${at}::timestamptz`)).map(themeRow)
        : rowsOf(await db.execute(sql`SELECT ${G_COLS} FROM group_ticks_5m WHERE kind = ${g} AND slot_at = ${at}::timestamptz`)).map(groupRow);
    },
    async sessionLastRows(g, fromDate, toDate) {
      return g === "theme"
        ? rowsOf(await db.execute(sql`SELECT DISTINCT ON (market_date, theme_id) ${T_COLS} FROM theme_ticks_5m WHERE market_date >= ${fromDate} AND market_date < ${toDate} ORDER BY market_date, theme_id, slot_at DESC`)).map(themeRow)
        : rowsOf(await db.execute(sql`SELECT DISTINCT ON (market_date, group_id) ${G_COLS} FROM group_ticks_5m WHERE kind = ${g} AND market_date >= ${fromDate} AND market_date < ${toDate} ORDER BY market_date, group_id, slot_at DESC`)).map(groupRow);
    },
    spyAt: (slot) => safe(async () => {
      const r = rowsOf(await db.execute(sql`SELECT median_pct FROM group_ticks_5m WHERE kind = 'benchmark' AND group_id = 'SPY' AND slot_at = ${slot.toISOString()}::timestamptz`))[0];
      return r ? n(r.median_pct) : null;
    }, null),
    barRange: () => safe(async () => {
      const r = rowsOf(await db.execute(sql`SELECT MIN(bar_date)::text AS a, MAX(bar_date)::text AS b FROM historical_bars WHERE symbol = 'SPY'`))[0];
      return r?.a ? { first: String(r.a).slice(0, 10), last: String(r.b).slice(0, 10) } : null;
    }, null),
    async sessionOnOrBefore(date) {
      const r = rowsOf(await db.execute(sql`SELECT MAX(bar_date)::text AS d FROM historical_bars WHERE symbol = 'SPY' AND bar_date <= ${date}::date`))[0];
      return r?.d ? String(r.d).slice(0, 10) : null;
    },
    async members(g, date) {
      const groups = new Map<string, string[]>();
      const add = (k: string, s: string) => (groups.get(k) ?? groups.set(k, []).get(k)!).push(String(s).toUpperCase());
      if (g === "theme") {
        const day = await safe(async () => {
          const r = rowsOf(await db.execute(sql`SELECT MAX(market_date) AS d FROM theme_membership_daily WHERE market_date <= ${date}`))[0];
          if (r?.d) return { d: String(r.d), note: null as string | null };
          const e = rowsOf(await db.execute(sql`SELECT MIN(market_date) AS d FROM theme_membership_daily`))[0];
          return e?.d ? { d: String(e.d), note: `membership is stored from ${e.d}; earlier membership is not kept` } : null;
        }, null);
        if (day) {
          for (const r of rowsOf(await db.execute(sql`SELECT theme_id, symbol FROM theme_membership_daily WHERE market_date = ${day.d}`))) add(String(r.theme_id), r.symbol);
          return { groups, asOf: day.d, note: day.note };
        }
        for (const [k, v] of (await opts.themeMembersNow?.()) ?? new Map<string, string[]>()) for (const s of v) add(k, s);
        return { groups, asOf: getEtClock().dateKey, note: "no membership is stored yet: today's membership" };
      }
      const col = g === "sector" ? sql`sector` : sql`market_cap_size`;
      for (const r of rowsOf(await db.execute(sql`SELECT symbol, ${col} AS k FROM tickers WHERE ${col} IS NOT NULL AND ${col} <> '' AND ${col} <> 'Unknown'`))) add(String(r.k).trim(), r.symbol);
      return { groups, asOf: getEtClock().dateKey, note: `the tickers table's current ${g === "sector" ? "sector" : "size bucket"}` };
    },
    async closes(symbols, dates) {
      const out = new Map<string, Map<string, number>>();
      if (!symbols.length) return out;
      for (let i = 0; i < symbols.length; i += 2000) {
        const chunk = symbols.slice(i, i + 2000);
        for (const r of rowsOf(await db.execute(sql`SELECT symbol, bar_date::text AS d, close::float8 AS c FROM historical_bars WHERE symbol IN (${sql.join(chunk.map((x) => sql`${x}`), sql`, `)}) AND bar_date IN (${sql.join(dates.map((x) => sql`${x}`), sql`, `)})`))) {
          const s = String(r.symbol).toUpperCase();
          (out.get(s) ?? out.set(s, new Map()).get(s)!).set(String(r.d).slice(0, 10), Number(r.c));
        }
      }
      return out;
    },
    async ranksOn(g, date) {
      const out = new Map<string, number>();
      if (g === "theme") {
        const r = await safe(async () => rowsOf(await db.execute(sql`SELECT DISTINCT ON (theme_id) theme_id AS id, rank FROM theme_ticks_5m WHERE market_date = ${date} ORDER BY theme_id, slot_at DESC`)), [] as any[]);
        if (r.length) { for (const x of r) out.set(String(x.id), Number(x.rank)); return out; }
        // before 20 Nov: the theme engine's daily close snapshot
        for (const x of await safe(async () => rowsOf(await db.execute(sql`SELECT DISTINCT ON (theme_id) theme_id AS id, rank FROM theme_snapshots WHERE snapshot_type = 'daily_close' AND market_date = ${date} ORDER BY theme_id, created_at DESC`)), [] as any[])) out.set(String(x.id), Number(x.rank));
        return out;
      }
      for (const x of await safe(async () => rowsOf(await db.execute(sql`SELECT DISTINCT ON (group_id) group_id AS id, rank FROM group_ticks_5m WHERE kind = ${g} AND market_date = ${date} ORDER BY group_id, slot_at DESC`)), [] as any[])) out.set(String(x.id), Number(x.rank));
      return out;
    },
  };
}
