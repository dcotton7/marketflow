/**
 * Append-only market history for the research harness (Don, 20 Nov: "they are never supposed to delete").
 *
 *  (a) the theme read every 5 minutes in market hours: rank, score, median %, RS vs benchmark, breadth per theme;
 *  (b) one copy a day of which tickers are in which theme;
 *  (c) the regime / risk score (RAI) with its label and components every 15 minutes in market hours.
 *
 * Rows are only ever INSERTed, ON CONFLICT DO NOTHING on the unique key (the slot, or the date), so the interval
 * rule lives in the database: a second refresh in the same slot, or a restart, writes nothing twice. Nothing here
 * (or anywhere) deletes, updates or prunes these tables. Same SQL as migrations/028_market_history.sql, run
 * (CREATE ... IF NOT EXISTS) before the first write.
 */
import { sql } from "drizzle-orm";

export const TICK_MS = 5 * 60_000;
export const REGIME_MS = 15 * 60_000;

export interface ThemeTickRow {
  slotAt: Date;
  marketDate: string;
  themeId: string;
  rank: number;
  score: number;
  medianPct: number | null;
  rsVsBenchmark: number | null;
  breadthPct: number | null;
}
export interface MembershipRow { marketDate: string; themeId: string; symbol: string; isCore: boolean }
export interface RegimeRow {
  slotAt: Date;
  marketDate: string;
  score: number;
  label: string;
  riskMultiplier: number | null;
  components: object;
}

/** Where rows go. Each call inserts the new rows and ignores ones whose key exists; returns how many were new. */
export interface HistoryStore {
  insertThemeTicks(rows: ThemeTickRow[]): Promise<number>;
  insertMembership(rows: MembershipRow[]): Promise<number>;
  insertRegime(row: RegimeRow): Promise<number>;
}

export interface ThemeInput {
  id: string;
  rank: number;
  score: number;
  medianPct?: number | null;
  rsVsBenchmark?: number | null;
  breadthPct?: number | null;
}
export interface RegimeInput { score: number; label: string; riskMultiplier?: number | null; components: object }

/** ET calendar date, weekday (0 = Sunday) and minutes since midnight for an instant. */
export function etClock(now: Date): { date: string; weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    weekday: wd,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

/** Weekday 9:30-16:00 ET. Holidays are not known here; a closed-day read repeats the last one, which is harmless. */
export function inMarketHours(now: Date): boolean {
  const c = etClock(now);
  return c.weekday >= 1 && c.weekday <= 5 && c.minutes >= 9 * 60 + 30 && c.minutes < 16 * 60;
}

export function slotStart(now: Date, ms: number): Date {
  return new Date(Math.floor(now.getTime() / ms) * ms);
}

const clean = (n: number | null | undefined): number | null =>
  typeof n === "number" && Number.isFinite(n) ? n : null;

// What this process has already written, so a 1-2 minute refresh loop does not re-ask the database or recompute the
// regime inside one slot. Lost on restart; the unique keys make the repeat harmless.
const done = { tick: 0, regime: 0, membership: "" };
export function resetMemoryForTests(): void {
  done.tick = 0;
  done.regime = 0;
  done.membership = "";
}

/**
 * Write whatever this moment calls for. Never throws (a failed write is logged and the next refresh tries again;
 * the unique keys make the retry safe). Returns what was newly written, for the log and the tests.
 */
export async function recordMarketHistory(
  store: HistoryStore,
  themes: ThemeInput[],
  opts: {
    now?: Date;
    regime?: () => Promise<RegimeInput | null>;
    membership?: (themeId: string) => { symbol: string; isCore: boolean }[];
  } = {},
): Promise<{ ticks: number; membership: number; regime: number }> {
  const now = opts.now ?? new Date();
  const out = { ticks: 0, membership: 0, regime: 0 };
  if (!inMarketHours(now) || !themes.length) return out;
  const { date } = etClock(now);
  const tickSlot = slotStart(now, TICK_MS).getTime();
  const regimeSlot = slotStart(now, REGIME_MS).getTime();
  if (done.tick !== tickSlot) try {
    out.ticks = await store.insertThemeTicks(
      themes.map((t) => ({
        slotAt: slotStart(now, TICK_MS),
        marketDate: date,
        themeId: String(t.id),
        rank: t.rank,
        score: t.score,
        medianPct: clean(t.medianPct),
        rsVsBenchmark: clean(t.rsVsBenchmark),
        breadthPct: clean(t.breadthPct),
      })),
    );
    done.tick = tickSlot;
  } catch (err) {
    console.warn("[MarketHistory] theme tick write failed:", err);
  }
  if (done.membership !== date) try {
    if (opts.membership) {
      const rows: MembershipRow[] = [];
      for (const t of themes) {
        for (const m of opts.membership(String(t.id))) {
          rows.push({ marketDate: date, themeId: String(t.id), symbol: m.symbol.toUpperCase(), isCore: !!m.isCore });
        }
      }
      if (rows.length) out.membership = await store.insertMembership(rows);
      if (rows.length) done.membership = date;
    }
  } catch (err) {
    console.warn("[MarketHistory] membership write failed:", err);
  }
  if (done.regime !== regimeSlot) try {
    if (opts.regime) {
      const r = await opts.regime();
      if (r && Number.isFinite(r.score)) {
        out.regime = await store.insertRegime({
          slotAt: slotStart(now, REGIME_MS),
          marketDate: date,
          score: r.score,
          label: r.label,
          riskMultiplier: clean(r.riskMultiplier),
          components: r.components,
        });
        done.regime = regimeSlot;
      }
    }
  } catch (err) {
    console.warn("[MarketHistory] regime write failed:", err);
  }
  return out;
}

// ---- Postgres store (drizzle) ----------------------------------------------------------------------------------

export const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS theme_ticks_5m (id SERIAL PRIMARY KEY, slot_at TIMESTAMPTZ NOT NULL, market_date TEXT NOT NULL, theme_id TEXT NOT NULL, rank INTEGER NOT NULL, score DOUBLE PRECISION NOT NULL, median_pct DOUBLE PRECISION, rs_vs_benchmark DOUBLE PRECISION, breadth_pct DOUBLE PRECISION, created_at TIMESTAMP NOT NULL DEFAULT NOW(), UNIQUE (slot_at, theme_id))`,
  `CREATE INDEX IF NOT EXISTS idx_theme_ticks_5m_date ON theme_ticks_5m (market_date, slot_at)`,
  `CREATE TABLE IF NOT EXISTS theme_membership_daily (id SERIAL PRIMARY KEY, market_date TEXT NOT NULL, theme_id TEXT NOT NULL, symbol TEXT NOT NULL, is_core BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMP NOT NULL DEFAULT NOW(), UNIQUE (market_date, theme_id, symbol))`,
  `CREATE TABLE IF NOT EXISTS regime_history (id SERIAL PRIMARY KEY, slot_at TIMESTAMPTZ NOT NULL UNIQUE, market_date TEXT NOT NULL, score DOUBLE PRECISION NOT NULL, label TEXT NOT NULL, risk_multiplier DOUBLE PRECISION, components JSONB NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT NOW())`,
  `CREATE INDEX IF NOT EXISTS idx_regime_history_date ON regime_history (market_date, slot_at)`,
];

type Exec = { execute: (q: any) => Promise<any> };
const affected = (r: any): number => Number(r?.rowCount ?? r?.rows?.length ?? 0);
let ensured = false;

export function pgHistoryStore(db: Exec): HistoryStore {
  async function ensure() {
    if (ensured) return;
    for (const stmt of DDL) await db.execute(sql.raw(stmt));
    ensured = true;
  }
  return {
    async insertThemeTicks(rows) {
      if (!rows.length) return 0;
      await ensure();
      const values = rows.map(
        (r) => sql`(${r.slotAt.toISOString()}::timestamptz, ${r.marketDate}, ${r.themeId}, ${r.rank}, ${r.score}, ${r.medianPct}, ${r.rsVsBenchmark}, ${r.breadthPct})`,
      );
      return affected(
        await db.execute(
          sql`INSERT INTO theme_ticks_5m (slot_at, market_date, theme_id, rank, score, median_pct, rs_vs_benchmark, breadth_pct) VALUES ${sql.join(values, sql`, `)} ON CONFLICT (slot_at, theme_id) DO NOTHING`,
        ),
      );
    },
    async insertMembership(rows) {
      if (!rows.length) return 0;
      await ensure();
      let n = 0;
      for (let i = 0; i < rows.length; i += 500) {
        const values = rows.slice(i, i + 500).map((r) => sql`(${r.marketDate}, ${r.themeId}, ${r.symbol}, ${r.isCore})`);
        n += affected(
          await db.execute(
            sql`INSERT INTO theme_membership_daily (market_date, theme_id, symbol, is_core) VALUES ${sql.join(values, sql`, `)} ON CONFLICT (market_date, theme_id, symbol) DO NOTHING`,
          ),
        );
      }
      return n;
    },
    async insertRegime(r) {
      await ensure();
      return affected(
        await db.execute(
          sql`INSERT INTO regime_history (slot_at, market_date, score, label, risk_multiplier, components) VALUES (${r.slotAt.toISOString()}::timestamptz, ${r.marketDate}, ${r.score}, ${r.label}, ${r.riskMultiplier}, ${JSON.stringify(r.components)}::jsonb) ON CONFLICT (slot_at) DO NOTHING`,
        ),
      );
    },
  };
}
