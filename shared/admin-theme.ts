/**
 * Canonical admin theme — single source of truth for RubricShield UI colors.
 *
 * Semantic roles:
 * - Main BG: full-page backgrounds (Market Flow, Charts, Big Idea, …)
 * - Secondary BG: overlays, cards, boxes, chart chrome on top of main
 * - Primary text: default reading text (white)
 * - Warning / status text: green, yellow, pink (positive, caution, highlight)
 * - Misc: red (negative), Market Flow purple
 *
 * Legacy DB field names (backgroundColor, overlayColor, …) are preserved for storage.
 */

export interface AdminThemeSettings {
  /** Main BG — page canvas */
  backgroundColor: string;
  /** Secondary BG base color (combined with transparency → secondaryBg) */
  overlayColor: string;
  overlayTransparency: number;
  logoTransparency: number;
  /** Borders / insets on secondary surfaces */
  secondaryOverlayColor: string;
  /** Primary text */
  textColorNormal: string;
  textColorTitle: string;
  textColorHeader: string;
  textColorSection: string;
  textColorSmall: string;
  textColorTiny: string;
  /** Semantic status / misc text */
  textColorPositive: string;
  textColorWarning: string;
  textColorCaution: string;
  textColorNegative: string;
  textColorMarketFlow: string;
  fontSizeTitle: string;
  fontSizeHeader: string;
  fontSizeSection: string;
  fontSizeNormal: string;
  fontSizeSmall: string;
  fontSizeTiny: string;
}

export const DEFAULT_ADMIN_THEME: AdminThemeSettings = {
  backgroundColor: "#0f172a",
  overlayColor: "#1e3a5f",
  overlayTransparency: 75,
  /** Logo watermark opacity 0–100 (higher = more visible) */
  logoTransparency: 88,
  secondaryOverlayColor: "#334155",
  textColorNormal: "#ffffff",
  textColorTitle: "#ffffff",
  textColorHeader: "#ffffff",
  textColorSection: "#ffffff",
  textColorSmall: "#a1a1aa",
  textColorTiny: "#71717a",
  textColorPositive: "#22c55e",
  textColorWarning: "#facc15",
  textColorCaution: "#f472b6",
  textColorNegative: "#ef4444",
  textColorMarketFlow: "#c084fc",
  fontSizeTitle: "1.5rem",
  fontSizeHeader: "1.125rem",
  fontSizeSection: "1rem",
  fontSizeNormal: "0.875rem",
  fontSizeSmall: "0.8125rem",
  fontSizeTiny: "0.75rem",
};

export interface AdminThemeCssVariables {
  /** Main BG */
  mainBg: string;
  /** Secondary BG (overlay cards, floating panels) */
  secondaryBg: string;
  secondaryBgSolid: string;
  headerBg: string;
  borderOnSecondary: string;
  logoOpacity: number;
  /** Secondary surface opacity 0–100 (higher = more opaque) */
  overlayTransparency: number;
  primaryText: string;
  textTitle: string;
  textHeader: string;
  textSection: string;
  textSmall: string;
  textTiny: string;
  textPositive: string;
  textWarning: string;
  textCaution: string;
  textNegative: string;
  textMarketFlow: string;
  fontSizeTitle: string;
  fontSizeHeader: string;
  fontSizeSection: string;
  fontSizeNormal: string;
  fontSizeSmall: string;
  fontSizeTiny: string;
  /** @deprecated use mainBg */
  backgroundColor: string;
  /** @deprecated use secondaryBg */
  overlayBg: string;
  overlayColor: string;
  secondaryOverlayColor: string;
  textColorNormal: string;
  textColorTitle: string;
  textColorHeader: string;
  textColorSection: string;
  textColorSmall: string;
  textColorTiny: string;
}

function buildHexAlpha(hex: string, pct: number): string {
  const clean = hex.replace("#", "");
  const alpha = Math.round(pct * 2.55)
    .toString(16)
    .padStart(2, "0");
  return `#${clean}${alpha}`;
}

/** Merge partial API/DB payload with defaults (handles legacy rows missing new fields). */
export function normalizeAdminThemeSettings(
  raw: Partial<AdminThemeSettings> | null | undefined
): AdminThemeSettings {
  const base = DEFAULT_ADMIN_THEME;
  if (!raw) return { ...base };
  return {
    backgroundColor: raw.backgroundColor ?? base.backgroundColor,
    overlayColor: raw.overlayColor ?? base.overlayColor,
    overlayTransparency: raw.overlayTransparency ?? base.overlayTransparency,
    logoTransparency: raw.logoTransparency ?? base.logoTransparency,
    secondaryOverlayColor: raw.secondaryOverlayColor ?? base.secondaryOverlayColor,
    textColorNormal: raw.textColorNormal ?? base.textColorNormal,
    textColorTitle: raw.textColorTitle ?? base.textColorTitle,
    textColorHeader: raw.textColorHeader ?? base.textColorHeader,
    textColorSection: raw.textColorSection ?? base.textColorSection,
    textColorSmall: raw.textColorSmall ?? base.textColorSmall,
    textColorTiny: raw.textColorTiny ?? base.textColorTiny,
    textColorPositive: raw.textColorPositive ?? base.textColorPositive,
    textColorWarning: raw.textColorWarning ?? base.textColorWarning,
    textColorCaution: raw.textColorCaution ?? base.textColorCaution,
    textColorNegative: raw.textColorNegative ?? base.textColorNegative,
    textColorMarketFlow: raw.textColorMarketFlow ?? base.textColorMarketFlow,
    fontSizeTitle: raw.fontSizeTitle ?? base.fontSizeTitle,
    fontSizeHeader: raw.fontSizeHeader ?? base.fontSizeHeader,
    fontSizeSection: raw.fontSizeSection ?? base.fontSizeSection,
    fontSizeNormal: raw.fontSizeNormal ?? base.fontSizeNormal,
    fontSizeSmall: raw.fontSizeSmall ?? base.fontSizeSmall,
    fontSizeTiny: raw.fontSizeTiny ?? base.fontSizeTiny,
  };
}

export function buildAdminThemeCssVariables(s: AdminThemeSettings): AdminThemeCssVariables {
  const secondaryBg = buildHexAlpha(s.overlayColor, s.overlayTransparency);
  const headerBg = buildHexAlpha(s.overlayColor, Math.min(s.overlayTransparency + 10, 100));

  return {
    mainBg: s.backgroundColor,
    secondaryBg,
    secondaryBgSolid: s.overlayColor,
    headerBg,
    borderOnSecondary: s.secondaryOverlayColor,
    logoOpacity: s.logoTransparency / 100,
    overlayTransparency: s.overlayTransparency,
    primaryText: s.textColorNormal,
    textTitle: s.textColorTitle,
    textHeader: s.textColorHeader,
    textSection: s.textColorSection,
    textSmall: s.textColorSmall,
    textTiny: s.textColorTiny,
    textPositive: s.textColorPositive,
    textWarning: s.textColorWarning,
    textCaution: s.textColorCaution,
    textNegative: s.textColorNegative,
    textMarketFlow: s.textColorMarketFlow,
    fontSizeTitle: s.fontSizeTitle,
    fontSizeHeader: s.fontSizeHeader,
    fontSizeSection: s.fontSizeSection,
    fontSizeNormal: s.fontSizeNormal,
    fontSizeSmall: s.fontSizeSmall,
    fontSizeTiny: s.fontSizeTiny,
    backgroundColor: s.backgroundColor,
    overlayBg: secondaryBg,
    overlayColor: s.overlayColor,
    secondaryOverlayColor: s.secondaryOverlayColor,
    textColorNormal: s.textColorNormal,
    textColorTitle: s.textColorTitle,
    textColorHeader: s.textColorHeader,
    textColorSection: s.textColorSection,
    textColorSmall: s.textColorSmall,
    textColorTiny: s.textColorTiny,
  };
}

/** CSS custom properties for document :root / sentinel-page shells */
export function adminThemeToCssProperties(
  vars: AdminThemeCssVariables
): Record<string, string> {
  return {
    "--admin-main-bg": vars.mainBg,
    "--admin-secondary-bg": vars.secondaryBg,
    "--admin-secondary-bg-solid": vars.secondaryBgSolid,
    "--admin-header-bg": vars.headerBg,
    "--admin-border-on-secondary": vars.borderOnSecondary,
    "--logo-opacity": String(vars.logoOpacity),
    "--overlay-bg": vars.secondaryBg,
    "--admin-primary-text": vars.primaryText,
    "--admin-text-title": vars.textTitle,
    "--admin-text-header": vars.textHeader,
    "--admin-text-section": vars.textSection,
    "--admin-text-small": vars.textSmall,
    "--admin-text-tiny": vars.textTiny,
    "--rs-green": vars.textPositive,
    "--rs-yellow": vars.textWarning,
    "--rs-amber": vars.textWarning,
    "--rs-red": vars.textNegative,
    "--rs-pink": vars.textCaution,
    "--admin-text-market-flow": vars.textMarketFlow,
    "--font-size-title": vars.fontSizeTitle,
    "--font-size-header": vars.fontSizeHeader,
    "--font-size-section": vars.fontSizeSection,
    "--font-size-normal": vars.fontSizeNormal,
    "--font-size-small": vars.fontSizeSmall,
    "--font-size-tiny": vars.fontSizeTiny,
  };
}

/** Inline style for sentinel-page shells (main BG + CSS custom properties) */
export function adminPageShellStyle(
  vars: AdminThemeCssVariables
): Record<string, string> {
  return {
    ...adminThemeToCssProperties(vars),
    backgroundColor: vars.mainBg,
  };
}
