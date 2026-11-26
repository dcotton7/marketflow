/**
 * What the scanner loads once a session day, before the first pass: the universe, every name's daily context from
 * the stored daily bars (historical_bars, finished sessions only, read in chunks of 200 symbols so at most ~15k rows
 * are in memory at a time), its size bucket and sector, the earnings calendar's next date, the Leader Shakeout hits of
 * the last sessions, and the users' stored daily setups evaluated on the same bars. Reads only; no vendor calls.
 */
import { buildDailyContext, floorReason } from "./daily";
import type { PriorFire } from "./gap";
import { registerUserSetup, clearUserSetups } from "./registry";
import { ROTATION_SYMBOLS } from "./rotation";
import type { ScannerSettings } from "./settings";
import type { TriggerStore, UserSetupRow } from "./store";
import type { DailyWatch } from "./triggers/common";
import type { DailyBar, DailyContext } from "./types";
import { capPerAccount, criteriaFromIdea, USER_SETUP_BUDGET_MS, userSetupPasses, userWatch, validateUserSetup } from "./user-setups";

export interface DayData {
  date: string;
  universe: string[]; // names that pass the floor (plus the rotation ETFs), the scanner's fetch list
  contexts: Map<string, DailyContext>;
  watch: Map<string, DailyWatch[]>;
  earningsAsOf: string | null;
  skipped: Record<string, number>;
  userSetups: { owner: number; key: string; version: number; ok: boolean; reason: string | null; watching: number }[];
  loadedAt: string;
}

export interface ShakeoutHit { symbol: string; date: string; close: number }

export interface Extras {
  capSize: Map<string, string>;
  sector: Map<string, string>;
  /** Next report date per symbol from the newest calendar pull; null map = calendar not available. */
  earnings: Map<string, string> | null;
  earningsAsOf: string | null;
  /** Recent earnings reaction sessions per symbol (earnings/upcoming.ts reactionSessions); null = calendar not fresh. */
  reactions?: Map<string, string[]> | null;
  /** Earlier gap-and-go fires per symbol, from the store. */
  gapFires?: Map<string, PriorFire[]>;
  /** The session day being loaded. */
  today?: string;
}

export interface ChunkAcc {
  contexts: Map<string, DailyContext>;
  watch: Map<string, DailyWatch[]>;
  universe: string[];
  skipped: Record<string, number>;
  watching: Map<string, number>;
  /** Evaluation time per user setup ("owner|key"), and the ones switched off for the day over the budget. */
  spentMs: Map<string, number>;
  overBudget: Set<string>;
}
export const newAcc = (): ChunkAcc => ({ contexts: new Map(), watch: new Map(), universe: [], skipped: {}, watching: new Map(), spentMs: new Map(), overBudget: new Set() });

/** Pure: build the day from bars in hand. Used by the live loader per chunk and by the replay tool at once. */
export function assembleChunk(
  bars: Map<string, DailyBar[]>,
  extras: Extras,
  settings: ScannerSettings,
  userSetups: UserSetupRow[],
  into: ChunkAcc,
): void {
  const bump = (k: string) => (into.skipped[k] = (into.skipped[k] ?? 0) + 1);
  const etfs = new Set(ROTATION_SYMBOLS);
  for (const [sym, list] of bars) {
    const ctx = buildDailyContext(sym, list, {
      capSize: extras.capSize.get(sym) ?? null,
      sector: extras.sector.get(sym) ?? null,
      nextEarnings: extras.earnings?.get(sym) ?? null,
      earningsKnown: extras.earnings !== null,
      earningsReactions: extras.reactions ? extras.reactions.get(sym) ?? [] : null,
      today: extras.today,
      gapFires: extras.gapFires?.get(sym) ?? [],
    }, settings.gapLookback, settings);
    if (!ctx) { bump("too_few_daily_bars"); continue; }
    const why = floorReason(ctx, settings);
    if (why && !etfs.has(sym)) { bump(`floor_${why}`); continue; }
    into.contexts.set(sym, ctx);
    into.universe.push(sym);
    for (const u of userSetups) {
      const k0 = `${u.ownerUserId}|${u.setupKey}`;
      if (into.overBudget.has(k0)) continue;
      const t0 = Date.now();
      const pass = userSetupPasses(u, list);
      const spent = (into.spentMs.get(k0) ?? 0) + (Date.now() - t0);
      into.spentMs.set(k0, spent);
      if (spent > USER_SETUP_BUDGET_MS) into.overBudget.add(k0);
      if (!pass) continue;
      const w = userWatch(u, ctx);
      into.watch.set(sym, [...(into.watch.get(sym) ?? []), w]);
      const k = `${u.ownerUserId}|${u.setupKey}`;
      into.watching.set(k, (into.watching.get(k) ?? 0) + 1);
    }
  }
}

export function addShakeoutWatch(hits: ShakeoutHit[], into: Map<string, DailyWatch[]>, contexts: Map<string, DailyContext>): number {
  const newest = new Map<string, ShakeoutHit>();
  for (const h of hits) if (!newest.has(h.symbol) || newest.get(h.symbol)!.date < h.date) newest.set(h.symbol, h);
  let n = 0;
  for (const h of newest.values()) {
    if (!contexts.has(h.symbol)) continue;
    const w: DailyWatch = { setupKey: "leader_shakeout", setupOwner: "builtin", ownerUserId: null, side: "long", entryName: "shakeout_close", entryLevel: h.close, hitDate: h.date, tested: true };
    into.set(h.symbol, [...(into.get(h.symbol) ?? []), w]);
    n++;
  }
  return n;
}

/** Fill each idea-linked setup's criteria from its idea (owner checked); the ones that cannot be read are reported. */
export function resolveIdeas(rows: UserSetupRow[], ideas: Map<number, any>): { rows: UserSetupRow[]; report: DayData["userSetups"] } {
  const out: UserSetupRow[] = [];
  const report: DayData["userSetups"] = [];
  for (const r of rows) {
    if (r.ideaId === null) { out.push(r); continue; }
    const got = criteriaFromIdea(ideas.get(r.ideaId), r.ownerUserId);
    if ("error" in got) report.push({ owner: r.ownerUserId, key: r.setupKey, version: r.version, ok: false, reason: `idea ${r.ideaId}: ${got.error}`, watching: 0 });
    else out.push({ ...r, criteria: got.criteria });
  }
  return { rows: out, report };
}

/** Validate, cap per account and register the stored user setups; returns the runnable ones and the report rows. */
export function prepareUserSetups(rows: UserSetupRow[], settings: ScannerSettings): { runnable: UserSetupRow[]; report: DayData["userSetups"] } {
  clearUserSetups();
  const report: DayData["userSetups"] = [];
  const valid: UserSetupRow[] = [];
  for (const r of rows) {
    const reason = validateUserSetup(r, settings);
    if (reason) report.push({ owner: r.ownerUserId, key: r.setupKey, version: r.version, ok: false, reason, watching: 0 });
    else valid.push(r);
  }
  const { kept, dropped } = capPerAccount(valid, settings.userSetupsMaxPerAccount);
  for (const r of dropped) report.push({ owner: r.ownerUserId, key: r.setupKey, version: r.version, ok: false, reason: `over ${settings.userSetupsMaxPerAccount} setups for the account`, watching: 0 });
  for (const r of kept) {
    registerUserSetup({ key: r.setupKey, owner: `user:${r.ownerUserId}`, description: r.name, side: r.side, tested: false });
    report.push({ owner: r.ownerUserId, key: r.setupKey, version: r.version, ok: true, reason: null, watching: 0 });
  }
  return { runnable: kept, report };
}

// ---- live loader (Postgres) -------------------------------------------------------------------------------------

type Exec = { execute: (q: any) => Promise<any> };
const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : r?.rows ?? []);

export async function loadDayFromDb(db: Exec, store: TriggerStore, date: string, settings: ScannerSettings): Promise<DayData> {
  const { sql } = await import("drizzle-orm");
  const { loadBarUniverse } = await import("../data-layer/bar-universe");
  const { getAllUniverseTickers } = await import("../market-condition/universe");
  const { loadCapSizes, bucketOf } = await import("../market-condition/utils/cap-size");
  const { RULE_VERSION: LS_RULE } = await import("../setups/leader-shakeout");

  const all = [...new Set([...(await loadBarUniverse(db, getAllUniverseTickers())), ...ROTATION_SYMBOLS])];
  const capSize = new Map<string, string>(await loadCapSizes(db as any));
  const sector = new Map<string, string>();
  try {
    for (const r of rowsOf(await db.execute(sql`SELECT symbol, sector FROM tickers WHERE sector IS NOT NULL`))) sector.set(String(r.symbol).toUpperCase(), String(r.sector));
    for (const r of rowsOf(await db.execute(sql`SELECT symbol, sector, market_cap FROM scan_pool WHERE active`))) {
      const s = String(r.symbol).toUpperCase();
      if (r.sector && !sector.has(s)) sector.set(s, String(r.sector));
      if (!capSize.has(s) && Number(r.market_cap) > 0) capSize.set(s, bucketOf(Number(r.market_cap)));
    }
  } catch (err) {
    console.warn("[TriggerScanner] sector / pool read failed; sector stays null:", String(err).slice(0, 120));
  }
  let earnings: Map<string, string> | null = null;
  let earningsAsOf: string | null = null;
  try {
    const head = rowsOf(await db.execute(sql`SELECT MAX(fetched_on)::text AS d FROM earnings_estimates_daily`))[0];
    earningsAsOf = head?.d ? String(head.d).slice(0, 10) : null;
    // the calendar counts only when it was pulled in the last week
    if (earningsAsOf && Date.parse(date) - Date.parse(earningsAsOf) <= 7 * 864e5) {
      earnings = new Map();
      for (const r of rowsOf(await db.execute(sql`SELECT symbol, MIN(report_date)::text AS d FROM earnings_estimates_daily WHERE fetched_on = ${earningsAsOf} AND report_date >= ${date} GROUP BY symbol`))) {
        earnings.set(String(r.symbol).toUpperCase(), String(r.d).slice(0, 10));
      }
    }
  } catch {
    earnings = null; // no calendar table yet: "earnings date not checked"
  }

  // user setups that point at their owner's BigIdea idea take that idea's one daily thought's criteria
  const stored = await store.activeUserSetups();
  const ideaIds = [...new Set(stored.map((u) => u.ideaId).filter((x): x is number => x !== null))];
  const ideas = new Map<number, any>();
  if (ideaIds.length) {
    try {
      for (const r of rowsOf(await db.execute(sql`SELECT id, user_id, nodes, edges FROM scanner_ideas WHERE id IN (${sql.join(ideaIds.map((x) => sql`${x}`), sql`, `)})`))) ideas.set(Number(r.id), r);
    } catch { /* each such setup then reports "idea not found" */ }
  }
  const resolved = resolveIdeas(stored, ideas);
  const { runnable, report } = prepareUserSetups(resolved.rows, settings);
  // gap and go: recent earnings reaction sessions (fresh calendar only) and this gap's earlier fires
  let reactions: Map<string, string[]> | null = null;
  if (earnings) {
    try {
      const { reactionSessions } = await import("../earnings/upcoming");
      const { isMarketHoliday } = await import("@shared/us-market-holidays");
      const from = new Date(Date.parse(`${date}T12:00:00Z`) - 45 * 864e5).toISOString().slice(0, 10);
      const sessions: string[] = [];
      for (let d = new Date(`${from}T12:00:00Z`); d.toISOString().slice(0, 10) <= date; d.setUTCDate(d.getUTCDate() + 1)) {
        const k = d.toISOString().slice(0, 10);
        if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && !isMarketHoliday(k)) sessions.push(k);
      }
      const rows = rowsOf(await db.execute(sql`SELECT DISTINCT symbol, report_date::text AS d, hour FROM earnings_estimates_daily WHERE report_date >= ${from} AND report_date <= ${date} AND fetched_on::date < report_date::date + 1`));
      const days = reactionSessions(rows.map((x) => ({ symbol: String(x.symbol).toUpperCase(), reportDate: String(x.d).slice(0, 10), hour: x.hour ?? null, source: "finnhub_calendar" })), sessions);
      reactions = new Map();
      for (const r of days) reactions.set(r.symbol, [...(reactions.get(r.symbol) ?? []), r.session]);
    } catch {
      reactions = null;
    }
  }
  const gapFires = new Map<string, PriorFire[]>();
  try {
    const from = new Date(Date.parse(`${date}T12:00:00Z`) - Math.ceil(settings.goMaxDays * 1.6 + 5) * 864e5).toISOString().slice(0, 10);
    for (const f of await store.gapFires(from, date)) gapFires.set(f.symbol, [...(gapFires.get(f.symbol) ?? []), f]);
  } catch { /* no earlier fires known: each gap may fire as new */ }
  report.push(...resolved.report);
  const sessions = runnable.length ? 260 : 75;
  const cutoff = new Date(Date.parse(`${date}T12:00:00Z`) - Math.ceil(sessions * 1.5) * 864e5).toISOString().slice(0, 10);
  const into = newAcc();
  for (let i = 0; i < all.length; i += 200) {
    const chunk = all.slice(i, i + 200);
    const r = await db.execute(sql`SELECT symbol, bar_date::text AS d, open, high, low, close, volume FROM historical_bars WHERE symbol IN (${sql.join(chunk.map((x) => sql`${x}`), sql`, `)}) AND bar_date >= ${cutoff} AND bar_date < ${date} ORDER BY symbol, bar_date`);
    const bars = new Map<string, DailyBar[]>();
    for (const x of rowsOf(r)) {
      const s = String(x.symbol).toUpperCase();
      const arr = bars.get(s) ?? [];
      arr.push({ date: String(x.d).slice(0, 10), open: Number(x.open), high: Number(x.high), low: Number(x.low), close: Number(x.close), volume: Number(x.volume) });
      bars.set(s, arr);
    }
    for (const s of chunk) if (!bars.has(s)) into.skipped.no_daily_bars = (into.skipped.no_daily_bars ?? 0) + 1;
    assembleChunk(bars, { capSize, sector, earnings, earningsAsOf, reactions, gapFires, today: date }, settings, runnable, into);
  }
  try {
    const from = new Date(Date.parse(`${date}T12:00:00Z`) - Math.ceil(settings.shakeoutLookbackSessions * 1.6) * 864e5).toISOString().slice(0, 10);
    const hits = rowsOf(await db.execute(sql`SELECT symbol, market_date, close FROM setup_leader_shakeout WHERE rule_version = ${LS_RULE} AND market_date >= ${from} AND market_date < ${date}`))
      .map((x) => ({ symbol: String(x.symbol).toUpperCase(), date: String(x.market_date), close: Number(x.close) }));
    addShakeoutWatch(hits, into.watch, into.contexts);
  } catch {
    into.skipped.shakeout_read_failed = 1;
  }
  for (const u of report) {
    u.watching = into.watching.get(`${u.owner}|${u.key}`) ?? 0;
    if (into.overBudget.has(`${u.owner}|${u.key}`)) { u.ok = false; u.reason = `over the ${USER_SETUP_BUDGET_MS} ms evaluation budget; off for today`; }
  }
  return { date, universe: into.universe, contexts: into.contexts, watch: into.watch, earningsAsOf: earnings ? earningsAsOf : null, skipped: into.skipped, userSetups: report, loadedAt: new Date().toISOString() };
}
