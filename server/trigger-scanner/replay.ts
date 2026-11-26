/**
 * Replay a day offline: the scanner's own code on a JSON fixture of daily and 5-minute bars, a pass at every
 * 5-minute close as it would run live, and the pass list printed. No database, no vendor call, no model.
 *
 *   npx tsx server/trigger-scanner/replay.ts [fixture.json] [--grade=A,B|all] [--json]
 *   (npm run trigger:replay -- <args>)
 *
 * Fixture: { date, regime: { label, score, asOf }, symbols: { SYM: { capSize, sector, daily: [{date, open, high,
 * low, close, volume}] (finished sessions, oldest first), bars5m: [{t, o, h, l, c, v}] (the day, regular session) } },
 * leaderShakeout?: [{ symbol, date, close }], userSetups?: [UserSetupRow] }. The default fixture is invented.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { addShakeoutWatch, assembleChunk, newAcc, prepareUserSetups } from "./day-data";
import { readRotation, ROTATION_SYMBOLS, type EtfMove } from "./rotation";
import { Dedupe, runPass } from "./scan";
import { BAR_MS, sessionBars, sessionOpenMs } from "./session";
import { loadSettings } from "./settings";
import type { UserSetupRow } from "./store";
import type { Bar, Candidate, DailyBar, Regime } from "./types";
import { gradesWanted } from "../setups/grades";

interface Fixture {
  date: string;
  regime?: Regime;
  symbols: Record<string, { capSize?: string | null; sector?: string | null; daily: DailyBar[]; bars5m: Bar[] }>;
  leaderShakeout?: { symbol: string; date: string; close: number }[];
  userSetups?: UserSetupRow[];
}

export function replay(fx: Fixture, opts: { env?: NodeJS.ProcessEnv } = {}) {
  const settings = loadSettings(opts.env ?? {});
  const capSize = new Map<string, string>(), sector = new Map<string, string>();
  const daily = new Map<string, DailyBar[]>();
  for (const [sym, s] of Object.entries(fx.symbols)) {
    if (s.capSize) capSize.set(sym, s.capSize);
    if (s.sector) sector.set(sym, s.sector);
    daily.set(sym, s.daily);
  }
  const { runnable, report } = prepareUserSetups(fx.userSetups ?? [], settings);
  const acc = newAcc();
  assembleChunk(daily, { capSize, sector, earnings: null, earningsAsOf: null }, settings, runnable, acc);
  addShakeoutWatch(fx.leaderShakeout ?? [], acc.watch, acc.contexts);
  const day = new Map<string, Bar[]>();
  for (const [sym, s] of Object.entries(fx.symbols)) day.set(sym, sessionBars(fx.date, s.bars5m));
  const regime: Regime = fx.regime ?? { label: null, score: null, asOf: null };
  const dedupe = new Dedupe();
  const evaluated = new Map<string, number>();
  const all: Candidate[] = [];
  const refused: Record<string, number> = {};
  const open = sessionOpenMs(fx.date);
  for (let k = 1; k <= 78; k++) {
    const through = open + k * BAR_MS;
    const book = new Map<string, Bar[]>();
    for (const sym of acc.universe) book.set(sym, (day.get(sym) ?? []).filter((b) => Date.parse(b.t) + BAR_MS <= through));
    const moves = new Map<string, EtfMove>();
    for (const e of ROTATION_SYMBOLS) {
      const c = acc.contexts.get(e), b = book.get(e);
      const last = b?.[b.length - 1]?.c;
      moves.set(e, { todayPct: c && last ? (last / c.prevClose - 1) * 100 : null, d5Pct: c?.close5dAgo && last ? (last / c.close5dAgo - 1) * 100 : null });
    }
    const rotation = readRotation(moves, settings, new Date(through).toISOString());
    const res = runPass({ date: fx.date, contexts: acc.contexts, bars: book, watch: acc.watch, regime, rotation, settings, dedupe, evaluated });
    all.push(...res.candidates);
    for (const [key, n] of Object.entries(res.refused)) refused[key] = (refused[key] ?? 0) + n;
  }
  return { candidates: all, refused, skipped: acc.skipped, universe: acc.universe, userSetups: report, watching: [...acc.watch].map(([s, w]) => `${s}: ${w.map((x) => `${x.setupKey} (${x.setupOwner})`).join(", ")}`) };
}

const etTime = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
const f2 = (x: number | null) => (x === null ? "-" : x.toFixed(2));

function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--")) ?? join(process.cwd(), "server/trigger-scanner/fixtures/replay-2026-11-24.json");
  const grades = gradesWanted(args.find((a) => a.startsWith("--grade="))?.slice(8) ?? "all");
  const fx = JSON.parse(readFileSync(file, "utf8")) as Fixture;
  const r = replay(fx);
  const list = r.candidates.filter((c) => grades.includes(c.grade));
  if (args.includes("--json")) {
    console.log(JSON.stringify({ ...r, candidates: list }, null, 2));
    return;
  }
  console.log(`Replay ${fx.date}: ${r.universe.length} names after the floor (${Object.entries(r.skipped).map(([k, v]) => `${k} ${v}`).join(", ") || "none out"})`);
  console.log(`Regime ${fx.regime?.label ?? "unknown"}. Watching: ${r.watching.join("; ") || "nothing"}`);
  for (const u of r.userSetups) console.log(`User setup ${u.key} (user ${u.owner}, v${u.version}): ${u.ok ? "running" : `off: ${u.reason}`}`);
  console.log(`\nPass list (${list.length} of ${r.candidates.length}, grades ${grades.join(",")}), in trigger order:`);
  console.log("time   symbol side  setup             grade  entry    stop (level @ price)          risk%  ADR   relvol owner");
  for (const c of list) {
    const stop = `${f2(c.stopPrice)} (${c.stopLevel} @ ${f2(c.stopLevelPrice)})`;
    console.log(`${etTime(c.triggerAt)}  ${c.symbol.padEnd(6)} ${c.side.padEnd(5)} ${c.setupKey.padEnd(17)} ${c.grade} ${String(c.gradePoints).padStart(2)}   ${f2(c.entryRef).padStart(7)}  ${stop.padEnd(29)} ${f2(c.riskPct).padStart(5)}  ${f2(c.riskAdr).padStart(4)}  ${f2(c.relVolume).padStart(5)}  ${c.setupOwner}`);
    console.log(`       ${c.why}; grade ${JSON.stringify({ ...c.gradeComponents, notes: undefined })}${c.gradeComponents.notes.length ? " " + c.gradeComponents.notes.join("; ") : ""}`);
  }
  console.log(`\nRefused (no logical stop inside ${loadSettings({}).maxRiskPct}%, or none at all): ${Object.entries(r.refused).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}`);
}

if (process.argv[1] && /replay\.ts$/.test(process.argv[1])) main();
