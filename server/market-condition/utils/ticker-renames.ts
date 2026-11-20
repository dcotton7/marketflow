/**
 * Ticker renames (Don, 20 Nov 2026: "1) Ok"): the same company under a new symbol. data/ticker-renames.json lists
 * them with the evidence (SEC CIK and CUSIP from FMP's company profile, the key in use; both the old and the new
 * symbol return the same CIK and CUSIP, the old one inactive, the new one active).
 *
 * Applying a rename keeps the history and deletes nothing:
 *   - the old symbol's rows in historical_bars, ticker_slice_memberships, market_cap_history, theme_membership_daily
 *     and ticker_ma are COPIED under the new symbol (rows the new symbol already has are left alone), and a tickers
 *     row is made for the new symbol from the old one's when it has none;
 *   - a dated row in ticker_renames records the change;
 *   - in memory, the new symbol takes the old one's place in any theme list (CLUSTERS);
 *   - the old symbol is also in data/delisted-symbols.json, so the delisted registry then archives its live rows
 *     to *_delisted and removes them, as for any retired ticker. Its bars stay under the old symbol too.
 * Runs inside the registry's start-up, before its purge, so the copy always comes first; a rename that fails to
 * apply keeps its old symbol from being purged on that start.
 */
import fs from "fs/promises";
import path from "path";
import { sql } from "drizzle-orm";
import { CLUSTERS } from "../universe";

export interface Rename { old: string; new: string; cik: string; cusip: string; evidence: string; recordedOn: string }

const FILE = path.resolve(process.cwd(), "data/ticker-renames.json");
/** History tables copied under the new symbol, with the columns that identify a row besides the symbol. */
export const COPY_TABLES: { table: string; key: string[] }[] = [
  { table: "historical_bars", key: ["bar_date"] },
  { table: "ticker_slice_memberships", key: ["theme_id", "subtheme_id"] },
  { table: "market_cap_history", key: ["as_of", "source"] },
  { table: "theme_membership_daily", key: ["market_date", "theme_id"] },
  { table: "ticker_ma", key: [] },
];
export const DDL = `CREATE TABLE IF NOT EXISTS ticker_renames (id SERIAL PRIMARY KEY, old_symbol TEXT NOT NULL, new_symbol TEXT NOT NULL, cik TEXT, cusip TEXT, evidence TEXT, recorded_on DATE NOT NULL, copied JSONB, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE (old_symbol, new_symbol))`;

export async function loadRenames(file = FILE): Promise<Rename[]> {
  try {
    const raw = JSON.parse((await fs.readFile(file, "utf8")).replace(/^﻿/, ""));
    return Array.isArray(raw) ? raw.filter((r) => r?.old && r?.new).map((r) => ({ ...r, old: String(r.old).toUpperCase(), new: String(r.new).toUpperCase() })) : [];
  } catch {
    return [];
  }
}

/** In memory: the new symbol takes the old one's place in every theme list. Returns the themes touched. */
export function applyRenameToClusters(r: Rename, clusters = CLUSTERS): string[] {
  const touched: string[] = [];
  for (const c of clusters) {
    for (const list of [c.core, c.candidates]) {
      const i = list.indexOf(r.old);
      if (i < 0) continue;
      if (list.includes(r.new)) list.splice(i, 1); else list[i] = r.new;
      if (!touched.includes(String(c.id))) touched.push(String(c.id));
    }
  }
  return touched;
}

type Exec = { execute: (q: any) => Promise<any> };
type Tx = Exec & { transaction?: <T>(fn: (tx: Exec) => Promise<T>) => Promise<T> };
const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : r?.rows ?? []);
const affected = (r: any): number => Number(r?.rowCount ?? r?.affectedRows ?? 0);
const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;

async function columns(db: Exec, table: string): Promise<string[]> {
  const r = await db.execute(sql`SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ${table} ORDER BY ordinal_position`);
  return rowsOf(r).map((x) => String(x.column_name));
}

/** Copy one table's rows from the old symbol to the new one; rows the new symbol already has stay as they are. */
async function copyRows(db: Exec, table: string, key: string[], from: string, to: string): Promise<number> {
  const cols = await columns(db, table);
  if (!cols.length) return 0; // the table does not exist (yet): nothing to carry
  const rest = cols.filter((c) => c !== "id" && c !== "symbol");
  const list = ["symbol", ...rest].map(ident).join(", ");
  const sel = [sql`${to}`, ...rest.map((c) => sql.raw(`s.${ident(c)}`))];
  const same = key.filter((k) => cols.includes(k)).map((k) => sql.raw(`d.${ident(k)} IS NOT DISTINCT FROM s.${ident(k)}`));
  const cond = sql.join([sql`d.symbol = ${to}`, ...same], sql` AND `);
  return affected(await db.execute(sql`INSERT INTO ${sql.raw(ident(table))} (${sql.raw(list)}) SELECT ${sql.join(sel, sql`, `)} FROM ${sql.raw(ident(table))} s WHERE s.symbol = ${from} AND NOT EXISTS (SELECT 1 FROM ${sql.raw(ident(table))} d WHERE ${cond})`));
}

/** Apply one rename's database part, once (ticker_renames remembers it). */
export async function applyRenameInDb(db: Tx, r: Rename): Promise<{ applied: boolean; copied?: Record<string, number> }> {
  await db.execute(sql.raw(DDL));
  const done = rowsOf(await db.execute(sql`SELECT 1 FROM ticker_renames WHERE old_symbol = ${r.old} AND new_symbol = ${r.new} LIMIT 1`));
  if (done.length) return { applied: false };
  const run = async (tx: Exec) => {
    const copied: Record<string, number> = {};
    // the company's tickers row under the new symbol, from the old one's, when the new symbol has none
    const tcols = (await columns(tx, "tickers")).filter((c) => c !== "id" && c !== "symbol");
    copied.tickers = affected(await tx.execute(sql`INSERT INTO tickers (symbol, ${sql.raw(tcols.map(ident).join(", "))}) SELECT ${r.new}, ${sql.raw(tcols.map((c) => `t.${ident(c)}`).join(", "))} FROM tickers t WHERE t.symbol = ${r.old} AND NOT EXISTS (SELECT 1 FROM tickers n WHERE n.symbol = ${r.new})`));
    for (const t of COPY_TABLES) copied[t.table] = await copyRows(tx, t.table, t.key, r.old, r.new);
    await tx.execute(sql`INSERT INTO ticker_renames (old_symbol, new_symbol, cik, cusip, evidence, recorded_on, copied) VALUES (${r.old}, ${r.new}, ${r.cik}, ${r.cusip}, ${r.evidence}, ${r.recordedOn}::date, ${JSON.stringify(copied)}::jsonb) ON CONFLICT (old_symbol, new_symbol) DO NOTHING`);
    return copied;
  };
  const copied = db.transaction ? await db.transaction(run) : await run(db);
  return { applied: true, copied };
}

/**
 * Every rename in the file: the in-memory theme lists every start, the database part once. Returns the old
 * symbols that are safe to purge (their rename is recorded); a failed one is logged and left out.
 */
export async function applyTickerRenames(db: Tx | null, renames?: Rename[]): Promise<{ safeToPurge: Set<string>; blocked: string[] }> {
  const list = renames ?? (await loadRenames());
  const safe = new Set<string>(), blocked: string[] = [];
  for (const r of list) {
    applyRenameToClusters(r);
    if (!db) { blocked.push(r.old); continue; }
    try {
      const res = await applyRenameInDb(db, r);
      if (res.applied) console.log(`[TickerRenames] ${r.old} -> ${r.new} recorded; copied ${JSON.stringify(res.copied)}`);
      safe.add(r.old);
    } catch (err) {
      blocked.push(r.old);
      console.warn(`[TickerRenames] ${r.old} -> ${r.new} not applied; ${r.old} is not purged this start:`, err);
    }
  }
  return { safeToPurge: safe, blocked };
}
