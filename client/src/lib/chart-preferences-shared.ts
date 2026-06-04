/** Default plot background — matches legacy TradingChart hardcode. */
export const DEFAULT_CHART_BACKGROUND_COLOR = "#0f172a";

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

export function isValidChartBackgroundColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value.trim());
}

/** null/invalid → default. */
export function resolveChartBackgroundColor(value: unknown): string {
  if (value == null || value === "") return DEFAULT_CHART_BACKGROUND_COLOR;
  const s = String(value).trim();
  return isValidChartBackgroundColor(s) ? s : DEFAULT_CHART_BACKGROUND_COLOR;
}

/**
 * Set VITE_MINI_MA_SETTINGS=false to revert Start Here mini charts to legacy hardcoded overlays.
 */
export function isMiniMaSettingsEnabled(): boolean {
  const raw = import.meta.env.VITE_MINI_MA_SETTINGS;
  if (raw === "false" || raw === "0") return false;
  return true;
}
