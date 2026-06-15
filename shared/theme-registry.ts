/**
 * Registry of locally themeable UI slots.
 * Key = `${surfaceId}:${regionId}` — shared wherever that region appears (not per-instance).
 *
 * Global theme (Admin → Global tab): Main BG, Secondary BG, semantic text, fonts.
 * Local slots: per-region body/header colors; admin can set for everyone or users set personal overrides.
 */

export type ThemeDefaultSource =
  | "mainBg"
  | "secondaryBg"
  | "secondaryBgSolid"
  | "headerBg"
  | "borderOnSecondary"
  | "textMarketFlow";

export type LocalThemeSlotKind = "body" | "header";

export interface LocalThemeSlotDef {
  /** `${surfaceId}:${regionId}` */
  id: string;
  surfaceId: string;
  regionId: string;
  label: string;
  description: string;
  cssVar: string;
  kind: LocalThemeSlotKind;
  defaultSource: ThemeDefaultSource;
}

function slot(
  regionId: string,
  label: string,
  description: string,
  kind: LocalThemeSlotKind,
  defaultSource: ThemeDefaultSource
): LocalThemeSlotDef {
  const surfaceId = "marketFlow";
  return {
    id: `${surfaceId}:${regionId}`,
    surfaceId,
    regionId,
    label,
    description,
    cssVar: `--local-${surfaceId}-${regionId}-bg`,
    kind,
    defaultSource,
  };
}

export const LOCAL_THEME_SLOTS: LocalThemeSlotDef[] = [
  // Top chrome
  slot(
    "regimeBar",
    "Top menu / regime bar",
    "HeaderBar — Market Flow branding, RAI, benchmarks, session. Shared top strip.",
    "header",
    "headerBg"
  ),
  slot(
    "commandToolbar",
    "Command toolbar",
    "Lens switcher, time slice, view mode, panel visibility row below regime bar.",
    "header",
    "headerBg"
  ),

  // Section sub-headers (panel title bars)
  slot(
    "panelHeader",
    "Section sub-header",
    "Default title bar on workspace panels (Theme tracker, Focused theme, Members, Rotation).",
    "header",
    "headerBg"
  ),
  slot(
    "detailTabBar",
    "Detail tab bar",
    "Tab row inside Focused Theme panel (Actionable, Sub-themes, ETFs, …).",
    "header",
    "headerBg"
  ),

  // Workspace panel bodies
  slot(
    "themeTrackerPanel",
    "Theme tracker panel",
    "Left workspace panel body (heatmap, flow map, race).",
    "body",
    "secondaryBg"
  ),
  slot(
    "focusedThemePanel",
    "Focused theme panel",
    "Right detail panel body (tabs content area).",
    "body",
    "secondaryBg"
  ),
  slot(
    "membersPanel",
    "Members panel",
    "Ticker members table workspace panel body.",
    "body",
    "secondaryBg"
  ),
  slot(
    "rotationTable",
    "Rotation table section",
    "Bottom rotation metrics table panel body (split view).",
    "body",
    "secondaryBg"
  ),

  // Flow map inner section
  slot(
    "flowMapMatrix",
    "Flow map matrix",
    "Pairwise rotation grid background inside theme tracker.",
    "body",
    "secondaryBgSolid"
  ),

  // Floating overlays
  slot(
    "overlayBg",
    "Overlay background",
    "Floating overlay surface (Ticker Review, Theme Charts pop-out chrome). Uses Secondary BG by default.",
    "body",
    "secondaryBg"
  ),
  slot(
    "overlayHeader",
    "Overlay header",
    "Floating overlay title bar / drag handle row.",
    "header",
    "headerBg"
  ),
  slot(
    "overlayChartChrome",
    "Overlay chart frame",
    "Dark rectangle surrounding each mini chart inside floating overlays (Ticker Review).",
    "body",
    "mainBg"
  ),
  slot(
    "overlayResultCard",
    "Overlay result card",
    "Rounded card around each scan result — chart, ticker info, and Setup Info (Ticker Review).",
    "body",
    "secondaryBg"
  ),
];

export function getLocalThemeSlot(slotId: string): LocalThemeSlotDef | undefined {
  return LOCAL_THEME_SLOTS.find((s) => s.id === slotId);
}

export function slotsForSurface(surfaceId: string): LocalThemeSlotDef[] {
  return LOCAL_THEME_SLOTS.filter((s) => s.surfaceId === surfaceId);
}

/** App-wide semantic palette swatches for the color picker */
export const APP_PALETTE_SWATCHES = [
  { key: "primary", label: "Primary text", cssVar: "--admin-primary-text" },
  { key: "positive", label: "Green", cssVar: "--rs-green" },
  { key: "warning", label: "Yellow", cssVar: "--rs-yellow" },
  { key: "caution", label: "Pink", cssVar: "--rs-pink" },
  { key: "negative", label: "Red", cssVar: "--rs-red" },
  { key: "marketFlow", label: "Market Flow", cssVar: "--admin-text-market-flow" },
  { key: "mainBg", label: "Main BG", cssVar: "--admin-main-bg" },
  { key: "secondaryBg", label: "Secondary BG", cssVar: "--admin-secondary-bg-solid" },
  { key: "headerBg", label: "Header BG", cssVar: "--admin-header-bg" },
] as const;
