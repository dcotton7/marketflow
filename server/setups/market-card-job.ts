/**
 * After-close job for the daily market card and watch list (server/setups/market-card.ts). It runs after the
 * Leader Shakeout job and does every session that has a finished Leader Shakeout run (so its bars are in) and no
 * card yet, from CARD_START (when MarketFlow's bars became wide: ~2,500 names from June 2025). One append-only row
 * per (version, date) in market_card_daily, holding the card and the watch list.
 */
import { sql } from "drizzle-orm";
import { volumePrev, RESEARCH_ETFS, type DBar } from "./daily-math";
import { addBreadth, labelDates, type Breadth } from "./market-label";
import { AI_THEMES, buildCard, buildWatch, CARD_VERSION, makeCtx, THEME_ETF, watchSeries, type CardData } from "./market-card";
import { rowsOf } from "./store";

export const CARD_START = "2025-06-02";

export const DDL = [
  `CREATE TABLE IF NOT EXISTS market_card_daily (id SERIAL PRIMARY KEY, version TEXT NOT NULL, market_date TEXT NOT NULL, label TEXT, card JSONB NOT NULL, watch JSONB NOT NULL, source TEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT NOW(), UNIQUE (version, market_date))`,
  `CREATE INDEX IF NOT EXISTS idx_market_card_daily_date ON market_card_daily (market_date)`,
];

type Exec = { execute: (q: any) => Promise<any> };
const affected = (r: any): number => Number(r?.rowCount ?? r?.affectedRows ?? 0);
let ensured = false;
export async function ensureCardTables(db: Exec) { if (ensured) return; for (const s of DDL) await db.execute(sql.raw(s)); ensured = true; }
const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);

export interface CardSource {
  /** Sessions with a finished Leader Shakeout run, oldest first. */
  readySessions(): Promise<string[]>;
  doneDates(): Promise<Set<string>>;
  symbols(): Promise<string[]>;
  bars(symbols: string[], from: string): Promise<Map<string, DBar[]>>;
  etfBars(from: string): Promise<Record<string, DBar[]>>;
  themeMembers(): Record<string, string[]>;
  mfRanks(themes: string[], from: string): Promise<Map<string, number>>; // key theme|date
  setupsOn(date: string): Promise<unknown>;
  mfRegime(date: string): string | null;
  insert(date: string, label: string | null, card: unknown, watch: unknown, source: string): Promise<number>;
  shouldStop?(): boolean;
}

export async function runMarketCard(src: CardSource, opts: { source?: "daily" | "manual"; maxDates?: number } = {}) {
  const ready = (await src.readySessions()).filter((d) => d >= CARD_START);
  const done = await src.doneDates();
  let todo = ready.filter((d) => !done.has(d));
  if (opts.maxDates) todo = todo.slice(-opts.maxDates);
  if (!todo.length) return { dates: 0 };
  const want = new Set(todo);
  const last = ready[ready.length - 1];

  // stocks: breadth (for the label), new highs / lows, theme day medians, and closes of the tracked groups' members
  const members = src.themeMembers();
  const themeOf = new Map<string, string[]>();
  for (const [t, syms] of Object.entries(members)) for (const s of syms) themeOf.set(s, [...(themeOf.get(s) ?? []), t]);
  const keep = new Set([...THEME_ETF.map(([t]) => t), ...AI_THEMES].flatMap((t) => members[t] ?? []));
  const breadth: Breadth = new Map();
  const nh = new Map<string, { nh: number; nl: number; n: number }>();
  const themeRets = new Map<string, number[]>(); // theme|date -> member returns (dates wanted only)
  const stock: CardData["stock"] = new Map();
  const from = addDays(todo[0], -420);
  const syms = (await src.symbols()).filter((s) => !RESEARCH_ETFS.has(s));
  for (let k = 0; k < syms.length; k += 150) {
    if (src.shouldStop?.()) return { stopped: true };
    for (const [sym, b] of await src.bars(syms.slice(k, k + 150), from)) {
      if (b.length < 22) continue;
      const dv = (i: number) => (i >= 21 ? volumePrev(b, i).dollarVol : NaN);
      addBreadth(breadth, b, dv);
      for (let i = 252; i < b.length; i++) {
        if (b[i].close < 6 || !(dv(i) >= 3e7)) continue;
        let hi = -Infinity, lo = Infinity;
        for (let j = i - 251; j < i; j++) { const c = b[j].close; if (c > hi) hi = c; if (c < lo) lo = c; }
        const x = nh.get(b[i].date) ?? { nh: 0, nl: 0, n: 0 };
        x.n++; if (b[i].close > hi) x.nh++; if (b[i].close < lo) x.nl++;
        nh.set(b[i].date, x);
      }
      for (const t of themeOf.get(sym.toUpperCase()) ?? []) {
        for (let i = 1; i < b.length; i++) {
          if (!want.has(b[i].date) || b[i].close < 3) continue;
          const key = `${t}|${b[i].date}`;
          themeRets.set(key, [...(themeRets.get(key) ?? []), b[i].close / b[i - 1].close - 1]);
        }
      }
      if (keep.has(sym.toUpperCase())) stock.set(sym.toUpperCase(), { pos: new Map(b.map((x, i) => [x.date, i])), close: Float64Array.from(b.map((x) => x.close)) });
    }
  }
  const nhnl = new Map([...nh].map(([d, x]) => [d, { nh: x.nh / x.n, nl: x.nl / x.n, n: x.n }]));
  const themeBreadth = new Map<string, { share: number; n: number }>();
  for (const d of todo) {
    const meds = Object.keys(members).map((t) => themeRets.get(`${t}|${d}`) ?? []).filter((a) => a.length).map((a) => { const z = [...a].sort((p, q) => p - q); return z[z.length >> 1]; });
    if (meds.length) themeBreadth.set(d, { share: meds.filter((x) => x > 0).length / meds.length, n: meds.length });
  }
  const etf = await src.etfBars(addDays(todo[0], -800));
  if (!etf.SPY?.length) return { error: "no SPY bars from Alpaca" };
  const labels = labelDates(etf, breadth);
  const ranks = await src.mfRanks([...new Set([...THEME_ETF.map(([t]) => t), "SEMIS"])], addDays(todo[0], -420));
  const data: CardData = { etf, labels, nhnl, members, stock, themeBreadth, mfRank: (t, d) => ranks.get(`${t}|${d}`) ?? NaN };
  const ctx = makeCtx(data);
  const pre = watchSeries(ctx);
  let written = 0, skipped: string[] = [];
  for (const d of todo) {
    if (!ctx.SP.has(d)) { skipped.push(d); continue; }
    const card = buildCard(ctx, d, { setupsToday: await src.setupsOn(d), mfRegime: src.mfRegime(d) });
    if (!card) { skipped.push(d); continue; }
    const watch = buildWatch(ctx, d, pre);
    written += await src.insert(d, card.label, card, watch, (opts.source ?? "daily") === "daily" && d !== last ? "backfill" : opts.source ?? "daily");
  }
  return { dates: todo.length, written, skipped, from: todo[0], to: todo[todo.length - 1] };
}

export function pgCardSource(db: Exec, base: { bars: CardSource["bars"]; symbols: CardSource["symbols"]; etfBars: CardSource["etfBars"]; themeMembers: CardSource["themeMembers"]; mfRegime: CardSource["mfRegime"]; shouldStop?: () => boolean }): CardSource {
  return {
    ...base,
    async readySessions() {
      const r = await db.execute(sql`SELECT market_date FROM setup_scan_runs WHERE setup = 'leader_shakeout' ORDER BY market_date`);
      return [...new Set(rowsOf(r).map((x) => String(x.market_date)))];
    },
    async doneDates() {
      await ensureCardTables(db);
      return new Set(rowsOf(await db.execute(sql`SELECT market_date FROM market_card_daily WHERE version = ${CARD_VERSION}`)).map((x) => String(x.market_date)));
    },
    async mfRanks(themes, from) {
      const out = new Map<string, number>();
      try {
        const r = await db.execute(sql`SELECT theme_id, market_date, rank, snapshot_type, snapshot_hour FROM theme_snapshots WHERE theme_id IN (${sql.join(themes.map((t) => sql`${t}`), sql`, `)}) AND market_date >= ${from} ORDER BY market_date, snapshot_type DESC, snapshot_hour`);
        // daily_close where present, else the last snapshot of the day (detectors.cjs)
        const daily = new Set<string>();
        for (const x of rowsOf(r)) {
          const k = `${x.theme_id}|${x.market_date}`;
          if (x.snapshot_type === "daily_close") { out.set(k, Number(x.rank)); daily.add(k); } else if (!daily.has(k)) out.set(k, Number(x.rank));
        }
      } catch { /* no snapshots: the rank detector reads n/a */ }
      return out;
    },
    async setupsOn(date) {
      const ls = rowsOf(await db.execute(sql`SELECT symbol, drop_pct, drop_atr, liquid, gapped FROM setup_leader_shakeout WHERE market_date = ${date} ORDER BY drop_atr DESC`).catch(() => ({ rows: [] })));
      const eg = rowsOf(await db.execute(sql`SELECT symbol, gap_pct, gap_atr, date_source FROM setup_earnings_gap_up WHERE market_date = ${date} ORDER BY gap_atr DESC`).catch(() => ({ rows: [] })));
      return { leaderShakeout: ls, earningsGapUp: eg };
    },
    async insert(date, label, card, watch, source) {
      await ensureCardTables(db);
      return affected(await db.execute(sql`INSERT INTO market_card_daily (version, market_date, label, card, watch, source) VALUES (${CARD_VERSION}, ${date}, ${label}, ${JSON.stringify(card)}::jsonb, ${JSON.stringify(watch)}::jsonb, ${source}) ON CONFLICT (version, market_date) DO NOTHING`));
    },
  };
}
