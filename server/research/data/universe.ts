import * as fs from "fs";
import * as path from "path";
import { cachePath } from "./paths";
import { todayEt } from "./daily-bars";

/**
 * Research universe: S&P 500 (today's list, with each name's date added) plus every Nasdaq-listed common stock (today's
 * Nasdaq symbol directory), plus names from data/delisted-symbols.json added back where Alpaca still serves bars.
 * Point-in-time gaps: S&P names removed before today and Nasdaq names delisted before today are missing (survivorship).
 */

export interface UniverseMember {
  symbol: string;
  sp500: boolean;
  /** S&P 500 date added (YYYY-MM-DD) when known; before it the name is not counted as a member. */
  sp500Added: string | null;
  nasdaq: boolean;
  delistedAddBack: boolean;
  name: string;
}

const NASDAQ_LISTED_URL = "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt";

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') q = !q;
    else if (ch === "," && !q) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parseSp500Csv(text: string): { symbol: string; name: string; added: string | null }[] {
  const lines = text.trim().split(/\r?\n/);
  const cols = parseCsvLine(lines[0]).map((c) => c.toLowerCase());
  const si = cols.indexOf("symbol");
  const ni = cols.indexOf("security");
  const ai = cols.indexOf("date added");
  return lines.slice(1).flatMap((l) => {
    const p = parseCsvLine(l);
    const symbol = (p[si] ?? "").toUpperCase();
    if (!/^[A-Z0-9.]+$/.test(symbol)) return [];
    const added = /^\d{4}-\d{2}-\d{2}/.test(p[ai] ?? "") ? p[ai].slice(0, 10) : null;
    return [{ symbol, name: p[ni] ?? "", added }];
  });
}

const NON_COMMON = /\b(warrants?|units?|rights?|preferred|notes?|debentures?|subordinated|perpetual|etf|etn|fund)\b|%/i;

/** Nasdaq symbol directory rows that are common stock: not ETFs, not test issues, not warrants/units/rights/preferreds/notes. */
export function parseNasdaqListed(text: string): { symbol: string; name: string }[] {
  const lines = text.trim().split(/\r?\n/);
  const cols = lines[0].split("|");
  const idx = (n: string) => cols.indexOf(n);
  const [si, ni, ti, ei] = [idx("Symbol"), idx("Security Name"), idx("Test Issue"), idx("ETF")];
  return lines.slice(1).flatMap((l) => {
    const p = l.split("|");
    if (p.length < cols.length || l.startsWith("File Creation Time")) return [];
    const symbol = p[si].toUpperCase();
    const name = p[ni] ?? "";
    if (p[ti] === "Y" || p[ei] === "Y") return [];
    if (!/^[A-Z]+$/.test(symbol)) return [];
    if (NON_COMMON.test(name)) return [];
    return [{ symbol, name }];
  });
}

async function nasdaqListedText(): Promise<string> {
  const file = cachePath("universe", `nasdaqlisted-${todayEt()}.txt`);
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf-8");
  const res = await fetch(NASDAQ_LISTED_URL);
  if (!res.ok) throw new Error(`Nasdaq symbol directory HTTP ${res.status}`);
  const text = await res.text();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return text;
}

export async function buildUniverse(): Promise<UniverseMember[]> {
  const sp = parseSp500Csv(fs.readFileSync(path.join(process.cwd(), "data", "constituents", "sp500.csv"), "utf-8"));
  const nq = parseNasdaqListed(await nasdaqListedText());
  let delisted: string[] = [];
  try {
    delisted = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "delisted-symbols.json"), "utf-8"));
  } catch {
    delisted = [];
  }
  const by = new Map<string, UniverseMember>();
  for (const s of sp) by.set(s.symbol, { symbol: s.symbol, sp500: true, sp500Added: s.added, nasdaq: false, delistedAddBack: false, name: s.name });
  for (const n of nq) {
    const m = by.get(n.symbol);
    if (m) m.nasdaq = true;
    else by.set(n.symbol, { symbol: n.symbol, sp500: false, sp500Added: null, nasdaq: true, delistedAddBack: false, name: n.name });
  }
  for (const d of delisted) {
    const s = String(d).toUpperCase();
    if (!by.has(s)) by.set(s, { symbol: s, sp500: false, sp500Added: null, nasdaq: false, delistedAddBack: true, name: "" });
  }
  return [...by.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export function isSp500MemberOn(m: UniverseMember, date: string): boolean {
  return m.sp500 && (m.sp500Added == null || m.sp500Added <= date);
}
