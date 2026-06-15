import type { AdminThemeCssVariables } from "./admin-theme";
import { LOCAL_THEME_SLOTS, type ThemeDefaultSource } from "./theme-registry";

export interface LocalThemeSlotValue {
  color: string;
  /** 0–100; higher = more opaque */
  opacity: number;
}

export type LocalThemeOverrides = Record<string, LocalThemeSlotValue>;

function hexAlpha(hex: string, opacityPct: number): string {
  const clean = hex.replace("#", "").slice(0, 6);
  const alpha = Math.round(Math.min(100, Math.max(0, opacityPct)) * 2.55)
    .toString(16)
    .padStart(2, "0");
  return `#${clean}${alpha}`;
}

function resolveDefaultColor(source: ThemeDefaultSource, vars: AdminThemeCssVariables): string {
  switch (source) {
    case "mainBg":
      return vars.mainBg;
    case "secondaryBg":
      return vars.secondaryBgSolid;
    case "secondaryBgSolid":
      return vars.secondaryBgSolid;
    case "borderOnSecondary":
      return vars.borderOnSecondary;
    case "headerBg":
      return vars.secondaryBgSolid.slice(0, 7);
    case "textMarketFlow":
      return vars.textMarketFlow;
    default:
      return vars.secondaryBgSolid;
  }
}

export function normalizeLocalThemeOverrides(
  raw: LocalThemeOverrides | null | undefined
): LocalThemeOverrides {
  if (!raw || typeof raw !== "object") return {};
  const out: LocalThemeOverrides = {};
  for (const [key, val] of Object.entries(raw)) {
    if (!val?.color || typeof val.color !== "string") continue;
    const opacity = typeof val.opacity === "number" ? val.opacity : 100;
    out[key] = { color: val.color, opacity };
  }
  return out;
}

export interface LocalThemeLayers {
  userLocalOverrides: LocalThemeOverrides;
  globalLocalDefaults: LocalThemeOverrides;
}

/** User override → admin global local default → derived from global theme */
export function getSlotResolvedValue(
  slotId: string,
  layers: LocalThemeLayers,
  vars: AdminThemeCssVariables
): { color: string; opacity: number; source: "user" | "globalLocal" | "derived" } {
  const slot = LOCAL_THEME_SLOTS.find((s) => s.id === slotId);
  if (!slot) return { color: vars.secondaryBgSolid, opacity: 100, source: "derived" };

  const user = layers.userLocalOverrides[slotId];
  if (user) return { color: user.color, opacity: user.opacity, source: "user" };

  const globalLocal = layers.globalLocalDefaults[slotId];
  if (globalLocal) return { color: globalLocal.color, opacity: globalLocal.opacity, source: "globalLocal" };

  const base = resolveDefaultColor(slot.defaultSource, vars);
  const opacity =
    slot.kind === "body" &&
    (slot.defaultSource === "secondaryBg" || slot.defaultSource === "secondaryBgSolid")
      ? vars.overlayTransparency
      : slot.defaultSource === "headerBg"
        ? Math.min(100, vars.overlayTransparency + 10)
        : 100;
  return {
    color: base.replace(/[^#0-9a-fA-F]/g, "").slice(0, 7),
    opacity,
    source: "derived",
  };
}

export function buildLocalThemeCssProperties(
  layers: LocalThemeLayers,
  vars: AdminThemeCssVariables
): Record<string, string> {
  const props: Record<string, string> = {};
  for (const slot of LOCAL_THEME_SLOTS) {
    const { color, opacity, source } = getSlotResolvedValue(slot.id, layers, vars);
    if (source !== "derived") {
      props[slot.cssVar] = hexAlpha(color, opacity);
    }
  }
  return props;
}
