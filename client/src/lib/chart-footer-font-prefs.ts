export type ChartFooterFontSection = "metrics" | "setup";

export type ChartFooterFontPrefs = Record<ChartFooterFontSection, number>;

export const CHART_FOOTER_FONT_DEFAULTS: ChartFooterFontPrefs = {
  metrics: 23,
  setup: 14,
};

const STORAGE_KEY = "chart-footer-font-prefs-v1";

const BOUNDS: Record<ChartFooterFontSection, { min: number; max: number }> = {
  metrics: { min: 14, max: 36 },
  setup: { min: 10, max: 22 },
};

function storageKey(userId: number | undefined): string {
  return userId ? `${STORAGE_KEY}:user-${userId}` : `${STORAGE_KEY}:anon`;
}

function clampSection(section: ChartFooterFontSection, n: number, fallback: number): number {
  const { min, max } = BOUNDS[section];
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function chartFooterFontBounds(section: ChartFooterFontSection) {
  return BOUNDS[section];
}

export function loadChartFooterFontPrefs(userId?: number): ChartFooterFontPrefs {
  if (typeof window === "undefined") return { ...CHART_FOOTER_FONT_DEFAULTS };
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return { ...CHART_FOOTER_FONT_DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<ChartFooterFontPrefs>;
    return {
      metrics: clampSection(
        "metrics",
        parsed.metrics ?? CHART_FOOTER_FONT_DEFAULTS.metrics,
        CHART_FOOTER_FONT_DEFAULTS.metrics
      ),
      setup: clampSection(
        "setup",
        parsed.setup ?? CHART_FOOTER_FONT_DEFAULTS.setup,
        CHART_FOOTER_FONT_DEFAULTS.setup
      ),
    };
  } catch {
    return { ...CHART_FOOTER_FONT_DEFAULTS };
  }
}

export function saveChartFooterFontPrefs(userId: number | undefined, prefs: ChartFooterFontPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(prefs));
  } catch {
    /* ignore quota */
  }
}
