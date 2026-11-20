/**
 * Stale-ticker guard (20 Nov 2026: Quinn named QRVO in a market alert; its last bar was 2 October).
 *
 * A ticker whose latest daily bar (Alpaca snapshot dailyBar) is more than STALE_SESSIONS trading sessions old is
 * left out of the market-condition snapshot map, which is what theme scores, theme member moves, leaders, the
 * signal scanner and the briefing are all built from. It is NOT removed from the universe: that takes a decision
 * (the delisted registry). It is listed on the admin read GET /api/market-condition/stale-tickers.
 *
 * A ticker with no snapshot at all is not judged here (no date to judge by).
 */
import { fetchAlpacaTradingCalendar } from "../../alpaca";
import { getEtClock } from "@shared/usEquityMarketSession";

export const STALE_SESSIONS = 5;

export interface StaleEntry { symbol: string; lastBarDate: string; sessionsOld: number; seenAt: string }

/** Sessions on or before `today`, oldest first; the cutoff is the session STALE_SESSIONS before the latest one. */
export function staleCutoff(sessions: string[], today: string): string | null {
  const s = sessions.filter((d) => d <= today);
  return s.length > STALE_SESSIONS ? s[s.length - 1 - STALE_SESSIONS] : null;
}

/** Sessions after lastBarDate up to the latest session (0 = a bar on the latest session). */
export function sessionsOld(sessions: string[], today: string, lastBarDate: string): number {
  return sessions.filter((d) => d <= today && d > lastBarDate).length;
}

/** Split a snapshot map: the stale ones (last bar older than the cutoff) come out, the rest pass unchanged. */
export function splitStale<T extends { dailyBarDate?: string; timestamp?: Date }>(
  snaps: Map<string, T>, sessions: string[], today: string,
): { fresh: Map<string, T>; stale: StaleEntry[] } {
  const cutoff = staleCutoff(sessions, today);
  if (!cutoff) return { fresh: snaps, stale: [] };
  const fresh = new Map<string, T>();
  const stale: StaleEntry[] = [];
  const seenAt = new Date().toISOString();
  for (const [sym, s] of snaps) {
    const last = s.dailyBarDate ?? (s.timestamp ? getEtClock(s.timestamp).dateKey : null);
    if (last && last < cutoff) stale.push({ symbol: sym, lastBarDate: last, sessionsOld: sessionsOld(sessions, today, last), seenAt });
    else fresh.set(sym, s);
  }
  return { fresh, stale };
}

// ---- the live guard ---------------------------------------------------------------------------------------------
let calendar: { day: string; sessions: string[] } | null = null;
let current: StaleEntry[] = [];

async function sessionsNow(today: string): Promise<string[]> {
  if (calendar?.day === today) return calendar.sessions;
  const from = new Date(Date.parse(today + "T12:00:00Z") - 40 * 864e5).toISOString().slice(0, 10);
  try {
    const cal = await fetchAlpacaTradingCalendar(from, today);
    const sessions = cal.map((d) => String(d.date)).filter(Boolean).sort();
    if (sessions.length > STALE_SESSIONS) { calendar = { day: today, sessions }; return sessions; }
  } catch { /* fall back to weekdays below */ }
  // weekdays only (a holiday counts as a session: the guard is then at most a day stricter)
  const out: string[] = [];
  for (let t = Date.parse(from + "T12:00:00Z"); t <= Date.parse(today + "T12:00:00Z"); t += 864e5) {
    const wd = new Date(t).getUTCDay();
    if (wd >= 1 && wd <= 5) out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/** Applied to every market-condition refresh. Never throws: on any failure the map passes through unchanged. */
export async function dropStaleSnapshots<T extends { dailyBarDate?: string; timestamp?: Date }>(snaps: Map<string, T>): Promise<Map<string, T>> {
  try {
    const today = getEtClock().dateKey;
    const { fresh, stale } = splitStale(snaps, await sessionsNow(today), today);
    const before = new Set(current.map((x) => x.symbol));
    current = stale.sort((a, b) => a.symbol.localeCompare(b.symbol));
    const added = current.filter((x) => !before.has(x.symbol)).map((x) => x.symbol);
    if (added.length) console.warn(`[StaleGuard] left out (no bar for more than ${STALE_SESSIONS} sessions; needs a look): ${added.join(", ")}`);
    return fresh;
  } catch (err) {
    console.warn("[StaleGuard] check failed; snapshots passed through:", err);
    return snaps;
  }
}

/** Tickers someone has to look at for a reason other than a missing bar (decided by the PM; listed, not acted on). */
export const NEEDS_A_LOOK: { symbol: string; since: string; reason: string }[] = [
  { symbol: "VWAV", since: "2026-11-20", reason: "market cap: the stored value and FMP's differ by more than 100x and neither is confirmed; left unwritten" },
];

export function getStaleTickers(): { rule: string; tickers: StaleEntry[]; needsALook: typeof NEEDS_A_LOOK } {
  return { rule: `no daily bar for more than ${STALE_SESSIONS} trading sessions: left out of leaders, theme moves, scans and briefings; still in the universe until someone decides`, tickers: current, needsALook: NEEDS_A_LOOK };
}
export function setStaleForTests(list: StaleEntry[]) { current = list; }
