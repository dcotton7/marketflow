import type { AdminThemeSettings } from "./admin-theme";
import type { LocalThemeOverrides } from "./local-theme";

/** GET /api/sentinel/settings/theme */
export interface ThemeSettingsResponse {
  global: AdminThemeSettings;
  /** Admin-set local slot defaults — apply to all users unless overridden */
  globalLocalDefaults: LocalThemeOverrides;
  /** Per-user local slot overrides */
  userLocalOverrides: LocalThemeOverrides;
  isAdmin: boolean;
}

export type ThemeSaveScope = "global" | "globalLocal" | "userLocal";
