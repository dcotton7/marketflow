/**
 * Append-only tables for the trigger scanner (same pattern as migrations/028_market_history.sql and
 * server/setups/store.ts): rows are only INSERTed, ON CONFLICT DO NOTHING on the unique key, so a restart or a repeat
 * pass writes nothing twice. Nothing here updates, deletes or prunes. The same DDL is in
 * migrations/029_trigger_scanner.sql and runs (CREATE ... IF NOT EXISTS) before the first write or read, and only
 * when TRIGGER_SCANNER=on, so no manual step is needed on deploy and nothing is created while the flag is off.
 *
 *   trigger_candidates   one row per raised candidate (unique dedupe_key = setup on name inside its window + bar time)
 *   trigger_scan_runs    one row per pass (unique pass_at): tier, names scanned, bars, lag, triggers, refusals, pause
 *   trigger_user_setups  a user's setup: the fields a BigIdea idea lacks for this job (side, entry rule, range,
 *                        version, on/off) and either a link to that user's own scanner_ideas row (idea_id; its one
 *                        daily thought's criteria are read at load) or the criteria inline. Versioned: an edit is a new row with version + 1, switching one off is
 *                        a new row with active = false. The newest version per (owner, key) is the one in force.
 * Growth (estimate): candidates 50-300 rows/day at ~3 KB = under 1 MB/day; runs 78 rows/day.
 */
import { sql } from "drizzle-orm";
import type { PriorFire } from "./gap";
import type { Candidate, Side } from "./types";

export const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS trigger_candidates (id SERIAL PRIMARY KEY, market_date TEXT NOT NULL, symbol TEXT NOT NULL, side TEXT NOT NULL, setup_key TEXT NOT NULL, setup_owner TEXT NOT NULL DEFAULT 'builtin', owner_user_id INTEGER, variant TEXT NOT NULL, why TEXT NOT NULL, trigger_at TIMESTAMPTZ NOT NULL, bar JSONB NOT NULL, entry_ref DOUBLE PRECISION NOT NULL, stop_level TEXT NOT NULL, stop_level_price DOUBLE PRECISION NOT NULL, stop_price DOUBLE PRECISION NOT NULL, stop_gap JSONB, risk_pct DOUBLE PRECISION NOT NULL, risk_adr DOUBLE PRECISION NOT NULL, adr_pct DOUBLE PRECISION NOT NULL, levels JSONB NOT NULL, rel_volume DOUBLE PRECISION, liquidity JSONB NOT NULL, regime JSONB NOT NULL, cap_size TEXT, sector TEXT, group_leading BOOLEAN NOT NULL, rotation JSONB NOT NULL, grade TEXT NOT NULL, grade_points INTEGER NOT NULL, grade_components JSONB NOT NULL, data_as_of JSONB NOT NULL, facts JSONB NOT NULL, dedupe_key TEXT NOT NULL UNIQUE, rule_version TEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT NOW())`,
  `CREATE INDEX IF NOT EXISTS idx_trigger_candidates_date ON trigger_candidates (market_date, id)`,
  `CREATE TABLE IF NOT EXISTS trigger_scan_runs (id SERIAL PRIMARY KEY, market_date TEXT NOT NULL, pass_at TIMESTAMPTZ NOT NULL UNIQUE, tier TEXT NOT NULL, universe_size INTEGER NOT NULL, symbols_scanned INTEGER NOT NULL, bars_evaluated INTEGER NOT NULL, requests INTEGER NOT NULL, bars_lag_sec INTEGER, triggers INTEGER NOT NULL, candidates INTEGER NOT NULL, deduped INTEGER NOT NULL, refused JSONB NOT NULL DEFAULT '{}'::jsonb, skipped JSONB NOT NULL DEFAULT '{}'::jsonb, paused TEXT, duration_ms INTEGER NOT NULL, rss_mb INTEGER, rule_version TEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT NOW())`,
  `CREATE INDEX IF NOT EXISTS idx_trigger_scan_runs_date ON trigger_scan_runs (market_date, pass_at)`,
  `CREATE TABLE IF NOT EXISTS trigger_user_setups (id SERIAL PRIMARY KEY, owner_user_id INTEGER NOT NULL, setup_key TEXT NOT NULL, version INTEGER NOT NULL, name TEXT NOT NULL, side TEXT NOT NULL, timeframe TEXT NOT NULL DEFAULT 'daily', idea_id INTEGER, criteria JSONB NOT NULL DEFAULT '[]'::jsonb, entry_rule TEXT NOT NULL, range_adr DOUBLE PRECISION, active BOOLEAN NOT NULL DEFAULT TRUE, source TEXT NOT NULL DEFAULT 'manual', created_at TIMESTAMP NOT NULL DEFAULT NOW(), UNIQUE (owner_user_id, setup_key, version))`,
];

export interface RunRow {
  marketDate: string;
  passAt: Date;
  tier: string;
  universeSize: number;
  symbolsScanned: number;
  barsEvaluated: number;
  requests: number;
  barsLagSec: number | null;
  triggers: number;
  candidates: number;
  deduped: number;
  refused: Record<string, number>;
  skipped: Record<string, number>;
  paused: string | null;
  durationMs: number;
  rssMb: number | null;
  ruleVersion: string;
}

export interface UserSetupRow {
  ownerUserId: number;
  setupKey: string;
  version: number;
  name: string;
  side: Side;
  timeframe: "daily";
  /** The owner's BigIdea idea (scanner_ideas.id) whose one daily thought supplies the criteria; null = inline. */
  ideaId: number | null;
  /** BigIdea ScannerCriterion[]: { indicatorId, params: [{ name, value }], inverted, muted }. */
  criteria: any[];
  entryRule: "prev_high" | "prev_low" | "prev_close";
  rangeAdr: number | null;
  active: boolean;
}

export interface CandidateQuery {
  day: string;
  since: number;
  grades: string[];
  side?: Side;
  setup?: string;
  limit: number;
  /** The account reading: built-in candidates plus that account's own setups' candidates only. */
  viewerUserId: number | null;
}

export interface StoredCandidate extends Candidate { id: number }

export interface TriggerStore {
  insertCandidates(rows: Candidate[]): Promise<number>;
  insertRun(row: RunRow): Promise<number>;
  /** Oldest first after the cursor (so paging never skips a row); the route reverses to newest first. */
  listCandidates(q: CandidateQuery): Promise<StoredCandidate[]>;
  /** Today's dedupe bases and trigger times, to re-seed the window after a restart. */
  dedupeSeeds(day: string): Promise<{ dedupeKey: string; triggerAt: string }[]>;
  countsToday(day: string, viewerUserId: number | null): Promise<{ setupKey: string; grade: string; n: number }[]>;
  lastRun(): Promise<RunRow | null>;
  activeUserSetups(): Promise<UserSetupRow[]>;
  /** Gap-and-go fires on market days in [from, before): the repeat rule's input. */
  gapFires(from: string, before: string): Promise<(PriorFire & { symbol: string })[]>;
}

type Exec = { execute: (q: any) => Promise<any> };
const affected = (r: any): number => Number(r?.rowCount ?? r?.affectedRows ?? 0);
const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : r?.rows ?? []);
const j = (v: unknown) => JSON.stringify(v ?? null);
let ensured = false;

export async function ensureTriggerTables(db: Exec): Promise<void> {
  if (ensured) return;
  for (const stmt of DDL) await db.execute(sql.raw(stmt));
  ensured = true;
}

function fromRow(r: any): StoredCandidate {
  return {
    id: Number(r.id),
    marketDate: String(r.market_date),
    symbol: String(r.symbol),
    side: r.side,
    setupKey: String(r.setup_key),
    setupOwner: String(r.setup_owner),
    ownerUserId: r.owner_user_id === null || r.owner_user_id === undefined ? null : Number(r.owner_user_id),
    variant: String(r.variant),
    why: String(r.why),
    triggerAt: new Date(r.trigger_at).toISOString(),
    bar: r.bar,
    entryRef: Number(r.entry_ref),
    stopLevel: r.stop_level,
    stopLevelPrice: Number(r.stop_level_price),
    stopPrice: Number(r.stop_price),
    stopGap: r.stop_gap ?? null,
    riskPct: Number(r.risk_pct),
    riskAdr: Number(r.risk_adr),
    adrPct: Number(r.adr_pct),
    levels: r.levels,
    relVolume: r.rel_volume === null ? null : Number(r.rel_volume),
    liquidity: r.liquidity,
    regime: r.regime,
    capSize: r.cap_size ?? null,
    sector: r.sector ?? null,
    groupLeading: !!r.group_leading,
    rotation: r.rotation,
    grade: r.grade,
    gradePoints: Number(r.grade_points),
    gradeComponents: r.grade_components,
    dataAsOf: r.data_as_of,
    facts: r.facts,
    dedupeKey: String(r.dedupe_key),
    ruleVersion: String(r.rule_version),
  };
}

export function pgTriggerStore(db: Exec): TriggerStore {
  return {
    async insertCandidates(rows) {
      if (!rows.length) return 0;
      await ensureTriggerTables(db);
      let n = 0;
      for (let i = 0; i < rows.length; i += 100) {
        const values = rows.slice(i, i + 100).map(
          (c) => sql`(${c.marketDate}, ${c.symbol}, ${c.side}, ${c.setupKey}, ${c.setupOwner}, ${c.ownerUserId}, ${c.variant}, ${c.why}, ${c.triggerAt}::timestamptz, ${j(c.bar)}::jsonb, ${c.entryRef}, ${c.stopLevel}, ${c.stopLevelPrice}, ${c.stopPrice}, ${j(c.stopGap)}::jsonb, ${c.riskPct}, ${c.riskAdr}, ${c.adrPct}, ${j(c.levels)}::jsonb, ${c.relVolume}, ${j(c.liquidity)}::jsonb, ${j(c.regime)}::jsonb, ${c.capSize}, ${c.sector}, ${c.groupLeading}, ${j(c.rotation)}::jsonb, ${c.grade}, ${c.gradePoints}, ${j(c.gradeComponents)}::jsonb, ${j(c.dataAsOf)}::jsonb, ${j(c.facts)}::jsonb, ${c.dedupeKey}, ${c.ruleVersion})`,
        );
        n += affected(await db.execute(sql`INSERT INTO trigger_candidates (market_date, symbol, side, setup_key, setup_owner, owner_user_id, variant, why, trigger_at, bar, entry_ref, stop_level, stop_level_price, stop_price, stop_gap, risk_pct, risk_adr, adr_pct, levels, rel_volume, liquidity, regime, cap_size, sector, group_leading, rotation, grade, grade_points, grade_components, data_as_of, facts, dedupe_key, rule_version) VALUES ${sql.join(values, sql`, `)} ON CONFLICT (dedupe_key) DO NOTHING`));
      }
      return n;
    },
    async insertRun(r) {
      await ensureTriggerTables(db);
      return affected(await db.execute(sql`INSERT INTO trigger_scan_runs (market_date, pass_at, tier, universe_size, symbols_scanned, bars_evaluated, requests, bars_lag_sec, triggers, candidates, deduped, refused, skipped, paused, duration_ms, rss_mb, rule_version) VALUES (${r.marketDate}, ${r.passAt.toISOString()}::timestamptz, ${r.tier}, ${r.universeSize}, ${r.symbolsScanned}, ${r.barsEvaluated}, ${r.requests}, ${r.barsLagSec}, ${r.triggers}, ${r.candidates}, ${r.deduped}, ${j(r.refused)}::jsonb, ${j(r.skipped)}::jsonb, ${r.paused}, ${r.durationMs}, ${r.rssMb}, ${r.ruleVersion}) ON CONFLICT (pass_at) DO NOTHING`));
    },
    async listCandidates(q) {
      await ensureTriggerTables(db);
      const owner = q.viewerUserId === null ? sql`setup_owner = 'builtin'` : sql`(setup_owner = 'builtin' OR owner_user_id = ${q.viewerUserId})`;
      const side = q.side ? sql` AND side = ${q.side}` : sql``;
      const setup = q.setup ? sql` AND setup_key = ${q.setup}` : sql``;
      const r = await db.execute(sql`SELECT * FROM trigger_candidates WHERE market_date = ${q.day} AND id > ${q.since} AND grade = ANY(${q.grades}) AND ${owner}${side}${setup} ORDER BY id ASC LIMIT ${q.limit}`);
      return rowsOf(r).map(fromRow);
    },
    async dedupeSeeds(day) {
      await ensureTriggerTables(db);
      const r = await db.execute(sql`SELECT dedupe_key, trigger_at FROM trigger_candidates WHERE market_date = ${day}`);
      return rowsOf(r).map((x) => ({ dedupeKey: String(x.dedupe_key), triggerAt: new Date(x.trigger_at).toISOString() }));
    },
    async countsToday(day, viewerUserId) {
      await ensureTriggerTables(db);
      const owner = viewerUserId === null ? sql`setup_owner = 'builtin'` : sql`(setup_owner = 'builtin' OR owner_user_id = ${viewerUserId})`;
      const r = await db.execute(sql`SELECT setup_key, grade, COUNT(*)::int AS n FROM trigger_candidates WHERE market_date = ${day} AND ${owner} GROUP BY setup_key, grade`);
      return rowsOf(r).map((x) => ({ setupKey: String(x.setup_key), grade: String(x.grade), n: Number(x.n) }));
    },
    async lastRun() {
      await ensureTriggerTables(db);
      const r = rowsOf(await db.execute(sql`SELECT * FROM trigger_scan_runs ORDER BY pass_at DESC LIMIT 1`))[0];
      if (!r) return null;
      return {
        marketDate: String(r.market_date), passAt: new Date(r.pass_at), tier: r.tier, universeSize: r.universe_size,
        symbolsScanned: r.symbols_scanned, barsEvaluated: r.bars_evaluated, requests: r.requests, barsLagSec: r.bars_lag_sec,
        triggers: r.triggers, candidates: r.candidates, deduped: r.deduped, refused: r.refused, skipped: r.skipped,
        paused: r.paused, durationMs: r.duration_ms, rssMb: r.rss_mb, ruleVersion: r.rule_version,
      };
    },
    async gapFires(from, before) {
      await ensureTriggerTables(db);
      const r = await db.execute(sql`SELECT symbol, side, market_date, variant, facts->>'gap_date' AS gap_date, facts->>'pivot' AS go_level FROM trigger_candidates WHERE setup_key IN ('gap_and_go', 'gap_down_and_go') AND market_date >= ${from} AND market_date < ${before}`);
      return rowsOf(r).map((x) => ({ symbol: String(x.symbol), side: x.side, marketDate: String(x.market_date), gapDate: String(x.gap_date), goLevel: Number(x.go_level), variant: String(x.variant) }));
    },
    async activeUserSetups() {
      await ensureTriggerTables(db);
      const r = await db.execute(sql`SELECT DISTINCT ON (owner_user_id, setup_key) owner_user_id, setup_key, version, name, side, timeframe, idea_id, criteria, entry_rule, range_adr, active FROM trigger_user_setups ORDER BY owner_user_id, setup_key, version DESC`);
      return rowsOf(r)
        .filter((x) => x.active)
        .map((x) => ({
          ownerUserId: Number(x.owner_user_id), setupKey: String(x.setup_key), version: Number(x.version), name: String(x.name),
          side: x.side, timeframe: "daily" as const, ideaId: x.idea_id === null || x.idea_id === undefined ? null : Number(x.idea_id), criteria: x.criteria ?? [], entryRule: x.entry_rule,
          rangeAdr: x.range_adr === null ? null : Number(x.range_adr), active: true,
        }));
    },
  };
}

/** In-memory store with the same rules (tests and the replay tool). Insert-only, unique keys honoured. */
export function memoryTriggerStore(userSetups: UserSetupRow[] = []): TriggerStore & { candidates: StoredCandidate[]; runs: RunRow[] } {
  const candidates: StoredCandidate[] = [];
  const runs: RunRow[] = [];
  let id = 0;
  const visible = (c: StoredCandidate, viewer: number | null) => c.setupOwner === "builtin" || (viewer !== null && c.ownerUserId === viewer);
  return {
    candidates,
    runs,
    async insertCandidates(rows) {
      let n = 0;
      for (const c of rows) {
        if (candidates.some((x) => x.dedupeKey === c.dedupeKey)) continue;
        candidates.push({ ...c, id: ++id });
        n++;
      }
      return n;
    },
    async insertRun(r) {
      if (runs.some((x) => x.passAt.getTime() === r.passAt.getTime())) return 0;
      runs.push(r);
      return 1;
    },
    async listCandidates(q) {
      return candidates
        .filter((c) => c.marketDate === q.day && c.id > q.since && q.grades.includes(c.grade) && visible(c, q.viewerUserId) && (!q.side || c.side === q.side) && (!q.setup || c.setupKey === q.setup))
        .slice(0, q.limit);
    },
    async dedupeSeeds(day) {
      return candidates.filter((c) => c.marketDate === day).map((c) => ({ dedupeKey: c.dedupeKey, triggerAt: c.triggerAt }));
    },
    async countsToday(day, viewer) {
      const m = new Map<string, number>();
      for (const c of candidates) if (c.marketDate === day && visible(c, viewer)) m.set(`${c.setupKey}|${c.grade}`, (m.get(`${c.setupKey}|${c.grade}`) ?? 0) + 1);
      return [...m].map(([k, n]) => ({ setupKey: k.split("|")[0], grade: k.split("|")[1], n }));
    },
    async lastRun() {
      return runs.length ? [...runs].sort((a, b) => b.passAt.getTime() - a.passAt.getTime())[0] : null;
    },
    async gapFires(from, before) {
      return candidates
        .filter((c) => (c.setupKey === "gap_and_go" || c.setupKey === "gap_down_and_go") && c.marketDate >= from && c.marketDate < before)
        .map((c) => ({ symbol: c.symbol, side: c.side, marketDate: c.marketDate, gapDate: String(c.facts.gap_date), goLevel: Number(c.facts.pivot), variant: c.variant }));
    },
    async activeUserSetups() {
      const newest = new Map<string, UserSetupRow>();
      for (const u of userSetups) {
        const k = `${u.ownerUserId}|${u.setupKey}`;
        if (!newest.has(k) || newest.get(k)!.version < u.version) newest.set(k, u);
      }
      return [...newest.values()].filter((u) => u.active);
    },
  };
}
