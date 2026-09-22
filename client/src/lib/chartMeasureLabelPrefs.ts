export const DEFAULT_MEASURE_LABEL_SIZE_SCALE = 0.5;
/** Previous hardcoded fill alpha (0.85); default is 20% more transparent. */
export const LEGACY_MEASURE_LABEL_OPACITY = 0.85;
export const DEFAULT_MEASURE_LABEL_OPACITY = 0.65;
export const DEFAULT_MEASURE_LABEL_TEXT_UP = "#ffffff";
export const DEFAULT_MEASURE_LABEL_TEXT_DOWN = "#ffffff";
export const DEFAULT_MEASURE_LABEL_BG_UP = "#22c55e";
export const DEFAULT_MEASURE_LABEL_BG_DOWN = "#ef4444";

export const MIN_MEASURE_LABEL_SIZE_SCALE = 0.25;
export const MAX_MEASURE_LABEL_SIZE_SCALE = 1.5;

const LS_KEY = "chartMeasureLabelPrefs";
export const MEASURE_LABEL_PREFS_EVENT = "sps-measure-label-prefs-changed";

export type MeasureLabelPrefs = {
  sizeScale: number;
  opacity: number;
  textUp: string;
  textDown: string;
  bgUp: string;
  bgDown: string;
};

export const DEFAULT_MEASURE_LABEL_PREFS: MeasureLabelPrefs = {
  sizeScale: DEFAULT_MEASURE_LABEL_SIZE_SCALE,
  opacity: DEFAULT_MEASURE_LABEL_OPACITY,
  textUp: DEFAULT_MEASURE_LABEL_TEXT_UP,
  textDown: DEFAULT_MEASURE_LABEL_TEXT_DOWN,
  bgUp: DEFAULT_MEASURE_LABEL_BG_UP,
  bgDown: DEFAULT_MEASURE_LABEL_BG_DOWN,
};

export function clampMeasureLabelSizeScale(value: unknown): number {
  const n = typeof value === "number" ? value : parseFloat(String(value));
  if (!Number.isFinite(n)) return DEFAULT_MEASURE_LABEL_SIZE_SCALE;
  return Math.min(
    MAX_MEASURE_LABEL_SIZE_SCALE,
    Math.max(MIN_MEASURE_LABEL_SIZE_SCALE, Math.round(n * 100) / 100),
  );
}

export function clampMeasureLabelOpacity(value: unknown): number {
  const n = typeof value === "number" ? value : parseFloat(String(value));
  if (!Number.isFinite(n)) return DEFAULT_MEASURE_LABEL_OPACITY;
  return Math.min(1, Math.max(0, Math.round(n * 100) / 100));
}

function normalizeHex6(color: string): string | null {
  const s = color.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) {
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  }
  return null;
}

export function resolveMeasureLabelHex(c: string | undefined, fallback: string): string {
  if (!c || typeof c !== "string") return fallback;
  return normalizeHex6(c) || fallback;
}

export function measureLabelHexToRgba(hex: string, alpha: number, fallback: string): string {
  const h = resolveMeasureLabelHex(hex, fallback);
  const r = parseInt(h.slice(1, 3), 16);
  const g = parseInt(h.slice(3, 5), 16);
  const b = parseInt(h.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${clampMeasureLabelOpacity(alpha)})`;
}

export function measureLabelSizeToPercent(scale: number): number {
  return Math.round(clampMeasureLabelSizeScale(scale) * 100);
}

export function measureLabelSizeFromPercent(percent: unknown): number {
  const n = typeof percent === "number" ? percent : parseInt(String(percent), 10);
  if (!Number.isFinite(n)) return DEFAULT_MEASURE_LABEL_SIZE_SCALE;
  return clampMeasureLabelSizeScale(n / 100);
}

export function measureLabelOpacityToPercent(opacity: number): number {
  return Math.round(clampMeasureLabelOpacity(opacity) * 100);
}

export function measureLabelOpacityFromPercent(percent: unknown): number {
  const n = typeof percent === "number" ? percent : parseInt(String(percent), 10);
  if (!Number.isFinite(n)) return DEFAULT_MEASURE_LABEL_OPACITY;
  return clampMeasureLabelOpacity(n / 100);
}

export function getMeasureLabelPrefs(): MeasureLabelPrefs {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...DEFAULT_MEASURE_LABEL_PREFS };
    const parsed = JSON.parse(raw) as Partial<MeasureLabelPrefs>;
    return {
      sizeScale: clampMeasureLabelSizeScale(parsed.sizeScale),
      opacity: clampMeasureLabelOpacity(parsed.opacity),
      textUp: resolveMeasureLabelHex(parsed.textUp, DEFAULT_MEASURE_LABEL_TEXT_UP),
      textDown: resolveMeasureLabelHex(parsed.textDown, DEFAULT_MEASURE_LABEL_TEXT_DOWN),
      bgUp: resolveMeasureLabelHex(parsed.bgUp, DEFAULT_MEASURE_LABEL_BG_UP),
      bgDown: resolveMeasureLabelHex(parsed.bgDown, DEFAULT_MEASURE_LABEL_BG_DOWN),
    };
  } catch {
    return { ...DEFAULT_MEASURE_LABEL_PREFS };
  }
}

function notifyMeasureLabelPrefsChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(MEASURE_LABEL_PREFS_EVENT));
}

export function setMeasureLabelPrefs(prefs: Partial<MeasureLabelPrefs>): MeasureLabelPrefs {
  const current = getMeasureLabelPrefs();
  const next: MeasureLabelPrefs = {
    sizeScale: clampMeasureLabelSizeScale(
      prefs.sizeScale != null ? prefs.sizeScale : current.sizeScale,
    ),
    opacity: clampMeasureLabelOpacity(prefs.opacity != null ? prefs.opacity : current.opacity),
    textUp: resolveMeasureLabelHex(prefs.textUp ?? current.textUp, DEFAULT_MEASURE_LABEL_TEXT_UP),
    textDown: resolveMeasureLabelHex(prefs.textDown ?? current.textDown, DEFAULT_MEASURE_LABEL_TEXT_DOWN),
    bgUp: resolveMeasureLabelHex(prefs.bgUp ?? current.bgUp, DEFAULT_MEASURE_LABEL_BG_UP),
    bgDown: resolveMeasureLabelHex(prefs.bgDown ?? current.bgDown, DEFAULT_MEASURE_LABEL_BG_DOWN),
  };
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  notifyMeasureLabelPrefsChanged();
  return next;
}

export function resetMeasureLabelPrefs(): void {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
  notifyMeasureLabelPrefsChanged();
}

export function subscribeMeasureLabelPrefs(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(MEASURE_LABEL_PREFS_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(MEASURE_LABEL_PREFS_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
