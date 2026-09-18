/** Flow rank at signal: 1 = strongest theme. Lowest-N uses this universe when percentile is missing. */
export const SCANNER_THEME_RANK_UNIVERSE = 26;

export type ThemeRankCut = "all" | "leading" | "lowest";

export function parseThemeRankCut(raw: unknown): ThemeRankCut {
  const v = String(raw ?? "all").toLowerCase();
  if (v === "leading" || v === "lowest") return v;
  return "all";
}

export function parseThemeRankN(raw: unknown, fallback = 5): number {
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(SCANNER_THEME_RANK_UNIVERSE, Math.max(1, Math.floor(n)));
}

export function lowestThemeRankFloor(n: number, universe = SCANNER_THEME_RANK_UNIVERSE): number {
  const k = parseThemeRankN(n, n);
  const t = Math.max(k, universe);
  return t - k + 1;
}

export function lowestThemePercentileCap(n: number, universe = SCANNER_THEME_RANK_UNIVERSE): number {
  const k = parseThemeRankN(n, n);
  const t = Math.max(k, universe);
  return Math.ceil((100 * k) / t);
}

/** Rank at print. Null/0 = unknown — excluded from leading/lowest cuts. */
export function matchesThemeRankCut(
  rank: number | null | undefined,
  percentile: number | null | undefined,
  cut: ThemeRankCut,
  n: number
): boolean {
  if (cut === "all") return true;
  const k = parseThemeRankN(n);
  const r = rank != null && Number.isFinite(rank) && rank >= 1 ? rank : null;
  const p = percentile != null && Number.isFinite(percentile) ? percentile : null;
  if (cut === "leading") return r != null && r <= k;
  if (r != null && r >= lowestThemeRankFloor(k)) return true;
  if (p != null && p > 0 && p <= lowestThemePercentileCap(k)) return true;
  return false;
}
