export type FlowMapFontSection = "toolbar" | "snapshot" | "narrative" | "settings" | "matrix";

export type FlowMapFontPrefs = Record<FlowMapFontSection, number>;

export const FLOW_MAP_FONT_DEFAULTS: FlowMapFontPrefs = {
  toolbar: 12,
  snapshot: 11,
  narrative: 11,
  settings: 11,
  matrix: 10,
};

const STORAGE_KEY = "flow-map-font-prefs-v1";
const MIN_PX = 9;
const MAX_PX = 18;

function storageKey(userId: number | undefined): string {
  return userId ? `${STORAGE_KEY}:user-${userId}` : `${STORAGE_KEY}:anon`;
}

function clampPx(n: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_PX, Math.max(MIN_PX, Math.round(n)));
}

export function loadFlowMapFontPrefs(userId?: number): FlowMapFontPrefs {
  if (typeof window === "undefined") return { ...FLOW_MAP_FONT_DEFAULTS };
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return { ...FLOW_MAP_FONT_DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<FlowMapFontPrefs>;
    return {
      toolbar: clampPx(parsed.toolbar ?? FLOW_MAP_FONT_DEFAULTS.toolbar, FLOW_MAP_FONT_DEFAULTS.toolbar),
      snapshot: clampPx(parsed.snapshot ?? FLOW_MAP_FONT_DEFAULTS.snapshot, FLOW_MAP_FONT_DEFAULTS.snapshot),
      narrative: clampPx(parsed.narrative ?? FLOW_MAP_FONT_DEFAULTS.narrative, FLOW_MAP_FONT_DEFAULTS.narrative),
      settings: clampPx(parsed.settings ?? FLOW_MAP_FONT_DEFAULTS.settings, FLOW_MAP_FONT_DEFAULTS.settings),
      matrix: clampPx(parsed.matrix ?? FLOW_MAP_FONT_DEFAULTS.matrix, FLOW_MAP_FONT_DEFAULTS.matrix),
    };
  } catch {
    return { ...FLOW_MAP_FONT_DEFAULTS };
  }
}

export function saveFlowMapFontPrefs(userId: number | undefined, prefs: FlowMapFontPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(prefs));
  } catch {
    /* ignore quota */
  }
}

export function flowMapFontBounds() {
  return { minPx: MIN_PX, maxPx: MAX_PX };
}
