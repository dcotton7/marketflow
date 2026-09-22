export const DEFAULT_MEASURE_LABEL_SIZE_SCALE = 0.5;
/** Previous hardcoded fill alpha (0.85); default is 20% more transparent. */
export const LEGACY_MEASURE_LABEL_OPACITY = 0.85;
export const DEFAULT_MEASURE_LABEL_OPACITY = 0.65;

export const MIN_MEASURE_LABEL_SIZE_SCALE = 0.25;
export const MAX_MEASURE_LABEL_SIZE_SCALE = 1.5;

const LS_KEY = "chartMeasureLabelPrefs";
export const MEASURE_LABEL_PREFS_EVENT = "sps-measure-label-prefs-changed";

export type MeasureLabelPrefs = {
  sizeScale: number;
  opacity: number;
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
    if (!raw) {
      return { sizeScale: DEFAULT_MEASURE_LABEL_SIZE_SCALE, opacity: DEFAULT_MEASURE_LABEL_OPACITY };
    }
    const parsed = JSON.parse(raw) as Partial<MeasureLabelPrefs>;
    return {
      sizeScale: clampMeasureLabelSizeScale(parsed.sizeScale),
      opacity: clampMeasureLabelOpacity(parsed.opacity),
    };
  } catch {
    return { sizeScale: DEFAULT_MEASURE_LABEL_SIZE_SCALE, opacity: DEFAULT_MEASURE_LABEL_OPACITY };
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
