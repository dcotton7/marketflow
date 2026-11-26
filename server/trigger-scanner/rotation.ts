/**
 * The rotation read (Anitir spec 5.c; Don: "if she reads IWM hot, move to midcap"). Code only, from the scanner's own
 * bars for the size and sector ETFs (they are in its fetch list) and their daily closes.
 *   size:    MGK (MEGA), SPY (LARGE), MDY (MID), IWM (SMALL), QQQ; each as % today and over 5 sessions minus SPY's.
 *   "hot":   ahead of SPY by at least hotTodayPct today, or hot5dPct over 5 sessions.
 *            IWM or MDY hot -> leading MID, SMALL ("move to midcap": MID first). MGK or QQQ hot -> MEGA, LARGE.
 *            Both or neither -> no tilt.
 *   sectors: the 11 SPDRs ranked by (today vs SPY) + (5 sessions vs SPY) / 5; the top 3 lead when ahead of SPY.
 */
import type { Rotation } from "./types";

export const SIZE_ETFS = ["SPY", "MGK", "MDY", "IWM", "QQQ"] as const;
export const SECTOR_ETFS = ["XLK", "XLF", "XLE", "XLV", "XLI", "XLY", "XLP", "XLU", "XLB", "XLRE", "XLC"] as const;
export const ROTATION_SYMBOLS: string[] = [...SIZE_ETFS, ...SECTOR_ETFS];

/** Sector names as MarketFlow stores them (tickers.sector, scan_pool.sector from FMP) to their SPDR. */
const SECTOR_WORDS: [RegExp, string][] = [
  [/tech|semiconductor|software/i, "XLK"],
  [/financ|bank|insur/i, "XLF"],
  [/energy|oil|gas/i, "XLE"],
  [/health|pharma|biotech|medical/i, "XLV"],
  [/industrial|aerospace|defense|transport/i, "XLI"],
  [/consumer (cyclical|discretionary)|retail|auto/i, "XLY"],
  [/consumer (defensive|staples)/i, "XLP"],
  [/utilit/i, "XLU"],
  [/material|chemical|mining|metal/i, "XLB"],
  [/real estate|reit/i, "XLRE"],
  [/communication|media|telecom/i, "XLC"],
];
export function sectorEtf(sector: string | null): string | null {
  if (!sector) return null;
  for (const [rx, etf] of SECTOR_WORDS) if (rx.test(sector)) return etf;
  return null;
}

export interface EtfMove { todayPct: number | null; d5Pct: number | null }

export function readRotation(moves: Map<string, EtfMove>, s: { hotTodayPct: number; hot5dPct: number }, asOf: string | null): Rotation {
  const spy = moves.get("SPY");
  const vs = (sym: string) => {
    const m = moves.get(sym);
    const t = m?.todayPct ?? null, d = m?.d5Pct ?? null;
    return {
      todayVsSpy: t !== null && spy?.todayPct != null ? t - spy.todayPct : null,
      d5VsSpy: d !== null && spy?.d5Pct != null ? d - spy.d5Pct : null,
    };
  };
  const size: Rotation["size"] = {};
  for (const e of SIZE_ETFS) if (e !== "SPY") size[e] = vs(e);
  const hot = (e: string) => {
    const x = size[e];
    return !!x && ((x.todayVsSpy ?? -Infinity) >= s.hotTodayPct || (x.d5VsSpy ?? -Infinity) >= s.hot5dPct);
  };
  const smallHot = hot("IWM") || hot("MDY");
  const bigHot = hot("MGK") || hot("QQQ");
  const leadingSize = smallHot && !bigHot ? ["MID", "SMALL"] : bigHot && !smallHot ? ["MEGA", "LARGE"] : [];
  const sectors: Rotation["sectors"] = {};
  for (const e of SECTOR_ETFS) sectors[e] = vs(e);
  const score = (e: string) => (sectors[e].todayVsSpy ?? 0) + (sectors[e].d5VsSpy ?? 0) / 5;
  const leadingSectors = SECTOR_ETFS.filter((e) => sectors[e].todayVsSpy !== null && score(e) > 0)
    .sort((a, b) => score(b) - score(a))
    .slice(0, 3);
  return { asOf, leadingSize, leadingSectors, size, sectors };
}

/** Whether a name's size bucket or sector is leading today. */
export function groupLeading(r: Rotation, capSize: string | null, sector: string | null): boolean {
  if (capSize && r.leadingSize.includes(capSize)) return true;
  const etf = sectorEtf(sector);
  return !!etf && r.leadingSectors.includes(etf);
}
