import * as fs from "fs";
import * as path from "path";
import { cachePath } from "./paths";
import { todayEt } from "./daily-bars";

/**
 * Free public market inputs that Alpaca doesn't carry, no secrets: Cboe VIX and VIX3M daily closes, the 10-year Treasury
 * yield (Treasury's daily par yield curve CSV, FRED DGS10 as fallback) and the Fed funds target upper bound (FRED
 * DFEDTARU). Each source is cached per day; any source that can't be reached is reported and left empty.
 */

export type DailySeries = Map<string, number>;

export interface MacroData {
  vix: DailySeries;
  vix3m: DailySeries;
  dgs10: DailySeries;
  fedUpper: DailySeries;
  sources: Record<string, string>;
  gaps: string[];
}

async function cachedText(name: string, url: string, timeoutMs = 30_000): Promise<string> {
  const file = cachePath("macro", `${name}-${todayEt()}.txt`);
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf-8");
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return text;
}

function mdyToIso(s: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim());
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
}

export function parseCboeHistory(text: string): DailySeries {
  const out: DailySeries = new Map();
  const lines = text.trim().split(/\r?\n/);
  const cols = lines[0].toUpperCase().split(",");
  const ci = cols.indexOf("CLOSE");
  for (const l of lines.slice(1)) {
    const p = l.split(",");
    const d = mdyToIso(p[0]);
    const v = Number(p[ci]);
    if (d && Number.isFinite(v) && v > 0) out.set(d, v);
  }
  return out;
}

export function parseTreasuryCurve(text: string): DailySeries {
  const out: DailySeries = new Map();
  const lines = text.trim().split(/\r?\n/);
  const cols = lines[0].split(",").map((c) => c.replace(/"/g, "").trim());
  const ti = cols.indexOf("10 Yr");
  for (const l of lines.slice(1)) {
    const p = l.split(",").map((c) => c.replace(/"/g, "").trim());
    const d = mdyToIso(p[0]);
    const v = Number(p[ti]);
    if (d && Number.isFinite(v) && p[ti] !== "") out.set(d, v);
  }
  return out;
}

export function parseFredCsv(text: string): DailySeries {
  const out: DailySeries = new Map();
  for (const l of text.trim().split(/\r?\n/).slice(1)) {
    const [d, v] = l.split(",");
    const n = Number(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(n) && v !== ".") out.set(d, n);
  }
  return out;
}

export async function loadMacro(fromYear: number, toYear: number): Promise<MacroData> {
  const data: MacroData = { vix: new Map(), vix3m: new Map(), dgs10: new Map(), fedUpper: new Map(), sources: {}, gaps: [] };
  const tryLoad = async (label: string, fn: () => Promise<DailySeries>, into: DailySeries, source: string) => {
    try {
      const s = await fn();
      for (const [k, v] of s) into.set(k, v);
      if (s.size > 0) data.sources[label] = source;
      return s.size > 0;
    } catch (e) {
      return false;
    }
  };

  if (!(await tryLoad("vix", async () => parseCboeHistory(await cachedText("cboe-vix", "https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv")), data.vix, "Cboe VIX_History.csv"))) {
    if (!(await tryLoad("vix", async () => parseFredCsv(await cachedText("fred-vixcls", "https://fred.stlouisfed.org/graph/fredgraph.csv?id=VIXCLS", 20_000)), data.vix, "FRED VIXCLS")))
      data.gaps.push("VIX unavailable (Cboe and FRED unreachable): VIX buckets are 'unknown' and trims use the unknown-VIX size");
  }
  if (!(await tryLoad("vix3m", async () => parseCboeHistory(await cachedText("cboe-vix3m", "https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX3M_History.csv")), data.vix3m, "Cboe VIX3M_History.csv")))
    data.gaps.push("VIX3M unavailable: term structure unknown");

  let treasuryOk = true;
  for (let y = fromYear; y <= toYear; y++) {
    const url = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${y}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${y}&page&_format=csv`;
    const ok = await tryLoad("dgs10", async () => parseTreasuryCurve(await cachedText(`treasury-curve-${y}`, url, 40_000)), data.dgs10, "US Treasury daily par yield curve (10 Yr)");
    treasuryOk = treasuryOk && ok;
  }
  if (!treasuryOk && !(await tryLoad("dgs10", async () => parseFredCsv(await cachedText("fred-dgs10", "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10", 20_000)), data.dgs10, "FRED DGS10")))
    data.gaps.push("10-year yield incomplete (Treasury and FRED unreachable for some years)");

  if (!(await tryLoad("fedUpper", async () => parseFredCsv(await cachedText("fred-dfedtaru", "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFEDTARU", 20_000)), data.fedUpper, "FRED DFEDTARU")))
    data.gaps.push("Fed funds target unavailable (FRED unreachable): Fed stance is 'unknown'");
  return data;
}

/** Latest value on or before `date` within `maxStaleDays` calendar days (holidays differ between sources). */
export function asOf(series: DailySeries, date: string, maxStaleDays = 6): number | null {
  const d = new Date(`${date}T12:00:00Z`);
  for (let k = 0; k <= maxStaleDays; k++) {
    const key = d.toISOString().slice(0, 10);
    const v = series.get(key);
    if (v != null) return v;
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return null;
}
