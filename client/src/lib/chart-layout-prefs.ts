/** Persisted resizable chart layout (DualChartGrid v2). Roll back via enabled: false. */

/** Matches CHART_FOOTER_TOTAL_H in ChartInfoFooter (89×2 + 5). */
const FOOTER_MIN_H_PX = 183;

export type ChartLayoutPrefs = {
  /** When false, DualChartGrid uses the legacy fixed layout. */
  enabled: boolean;
  /** Vertical split: charts panel (% of chart+footer area). */
  chartsPanelPct: number;
  /** Vertical split: footer panel (%). */
  footerPanelPct: number;
  /** Horizontal split: daily panel (% of chart row). */
  dailyPanelPct: number;
};

export const CHART_LAYOUT_DEFAULTS: ChartLayoutPrefs = {
  enabled: true,
  chartsPanelPct: 86,
  footerPanelPct: 14,
  dailyPanelPct: 50,
};

const STORAGE_KEY = "chart-layout-prefs-v2";

const BOUNDS = {
  chartsPanelPct: { min: 35, max: 88 },
  footerPanelPct: { min: 12, max: 40 },
  dailyPanelPct: { min: 20, max: 80 },
} as const;

function clampPct(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value * 10) / 10));
}

export function isChartLayoutV2Enabled(): boolean {
  if (typeof window === "undefined") return CHART_LAYOUT_DEFAULTS.enabled;
  try {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("chartLayout");
    if (q === "legacy") return false;
    if (q === "v2") return true;
  } catch {
    /* ignore */
  }
  return loadChartLayoutPrefs().enabled;
}

export function loadChartLayoutPrefs(): ChartLayoutPrefs {
  if (typeof window === "undefined") return { ...CHART_LAYOUT_DEFAULTS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...CHART_LAYOUT_DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<ChartLayoutPrefs>;
    const chartsPanelPct = clampPct(
      parsed.chartsPanelPct ?? CHART_LAYOUT_DEFAULTS.chartsPanelPct,
      BOUNDS.chartsPanelPct.min,
      BOUNDS.chartsPanelPct.max,
      CHART_LAYOUT_DEFAULTS.chartsPanelPct
    );
    const footerPanelPct = clampPct(
      parsed.footerPanelPct ?? CHART_LAYOUT_DEFAULTS.footerPanelPct,
      BOUNDS.footerPanelPct.min,
      BOUNDS.footerPanelPct.max,
      CHART_LAYOUT_DEFAULTS.footerPanelPct
    );
    const dailyPanelPct = clampPct(
      parsed.dailyPanelPct ?? CHART_LAYOUT_DEFAULTS.dailyPanelPct,
      BOUNDS.dailyPanelPct.min,
      BOUNDS.dailyPanelPct.max,
      CHART_LAYOUT_DEFAULTS.dailyPanelPct
    );
    return {
      enabled: parsed.enabled !== false,
      chartsPanelPct,
      footerPanelPct,
      dailyPanelPct,
    };
  } catch {
    return { ...CHART_LAYOUT_DEFAULTS };
  }
}

export function saveChartLayoutPrefs(prefs: ChartLayoutPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore quota */
  }
}

/** Max footer height in px for scroll cap inside resizable panel. */
export function chartFooterMaxHeightPx(containerHeight: number): number {
  if (containerHeight <= 0) return 320;
  return Math.min(320, Math.max(FOOTER_MIN_H_PX, Math.floor(containerHeight * 0.4)));
}
