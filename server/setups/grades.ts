/**
 * Leader Shakeout grades (Don, 20 Nov 2026, after the research showed the liquid and the gapped-down hits did
 * better): every hit is still found and stored from the base rule; each carries two flags and a grade.
 *   liquid = prior 20-day average dollar volume >= liquidDollarVol ($100M)
 *   gapped = opened at least gapAtr (1) ATR below the prior close
 *   A = both, B = one, C = neither.
 * The thresholds are settings (tnn_settings key "setup_grades", JSON), not constants; the raw dollar volume and
 * gap in ATRs are stored on every row, so a retune regrades stored rows at read time without recomputing.
 */
import { sql } from "drizzle-orm";

export interface GradeSettings { liquidDollarVol: number; gapAtr: number }
export const DEFAULT_GRADES: GradeSettings = { liquidDollarVol: 100e6, gapAtr: 1 };
export const SETTINGS_KEY = "setup_grades";
export type Grade = "A" | "B" | "C";

export function flags(dollarVol20Prev: number, gapAtr: number, s: GradeSettings) {
  const liquid = dollarVol20Prev >= s.liquidDollarVol;
  const gapped = gapAtr <= -s.gapAtr;
  const grade: Grade = liquid && gapped ? "A" : liquid || gapped ? "B" : "C";
  return { liquid, gapped, grade };
}

/** Valid settings from a stored JSON value; anything missing or not a positive number keeps its default. */
export function parseSettings(raw: unknown): GradeSettings {
  let o: any = raw;
  if (typeof raw === "string") { try { o = JSON.parse(raw); } catch { o = {}; } }
  const pos = (x: unknown, d: number) => (typeof x === "number" && Number.isFinite(x) && x > 0 ? x : d);
  return { liquidDollarVol: pos(o?.liquidDollarVol, DEFAULT_GRADES.liquidDollarVol), gapAtr: pos(o?.gapAtr, DEFAULT_GRADES.gapAtr) };
}

type Exec = { execute: (q: any) => Promise<any> };
let cache: { at: number; s: GradeSettings } | null = null;
export async function loadGradeSettings(db: Exec | null): Promise<GradeSettings> {
  if (cache && Date.now() - cache.at < 60_000) return cache.s;
  let s = DEFAULT_GRADES;
  if (db) {
    try {
      const r: any = await db.execute(sql`SELECT setting_value FROM tnn_settings WHERE setting_key = ${SETTINGS_KEY} LIMIT 1`);
      const row = (r?.rows ?? r)?.[0];
      if (row) s = parseSettings(row.setting_value);
    } catch { /* defaults */ }
  }
  cache = { at: Date.now(), s };
  return s;
}
export async function saveGradeSettings(db: Exec, s: GradeSettings): Promise<void> {
  await db.execute(sql`INSERT INTO tnn_settings (setting_key, setting_value, description) VALUES (${SETTINGS_KEY}, ${JSON.stringify(s)}, ${"Leader Shakeout grade thresholds (server/setups/grades.ts)"}) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW()`);
  cache = null;
}

/** Which grades a read returns: default A and B; "all" (or a list like "A,C") when asked. */
export function gradesWanted(q: unknown): Grade[] {
  const v = String(q ?? "").toUpperCase();
  if (!v) return ["A", "B"];
  if (v === "ALL") return ["A", "B", "C"];
  const g = v.split(",").map((x) => x.trim()).filter((x): x is Grade => x === "A" || x === "B" || x === "C");
  return g.length ? g : ["A", "B"];
}
const ORDER: Record<Grade, number> = { A: 0, B: 1, C: 2 };
/** Grade A first, then B (then C); newest day first inside a grade, biggest drop first inside a day. */
export function byGrade<T extends { grade: Grade; market_date: string; drop_atr: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => ORDER[a.grade] - ORDER[b.grade] || b.market_date.localeCompare(a.market_date) || b.drop_atr - a.drop_atr);
}
