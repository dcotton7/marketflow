import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  type AdminThemeSettings,
  type AdminThemeCssVariables,
  DEFAULT_ADMIN_THEME,
  normalizeAdminThemeSettings,
  buildAdminThemeCssVariables,
  adminThemeToCssProperties,
  adminPageShellStyle,
} from "@shared/admin-theme";
import {
  normalizeLocalThemeOverrides,
  buildLocalThemeCssProperties,
  type LocalThemeOverrides,
} from "@shared/local-theme";
import type { ThemeSettingsResponse } from "@shared/theme-api";

export type SystemSettings = AdminThemeSettings;
export type CssVariables = AdminThemeCssVariables;

export const THEME_SETTINGS_QUERY_KEY = ["/api/sentinel/settings/theme"] as const;

interface SystemSettingsContextType {
  settings: AdminThemeSettings;
  isLoading: boolean;
  cssVariables: AdminThemeCssVariables;
  pageShellStyle: Record<string, string>;
  globalLocalDefaults: LocalThemeOverrides;
  userLocalOverrides: LocalThemeOverrides;
  isAdmin: boolean;
}

const defaults = normalizeAdminThemeSettings(DEFAULT_ADMIN_THEME);
const defaultCss = buildAdminThemeCssVariables(defaults);

const SystemSettingsContext = createContext<SystemSettingsContextType>({
  settings: defaults,
  isLoading: false,
  cssVariables: defaultCss,
  pageShellStyle: adminPageShellStyle(defaultCss),
  globalLocalDefaults: {},
  userLocalOverrides: {},
  isAdmin: false,
});

export function useSystemSettings() {
  return useContext(SystemSettingsContext);
}

export function useAdminTheme() {
  const { cssVariables: v, settings, pageShellStyle } = useSystemSettings();
  return {
    settings,
    pageShellStyle,
    mainBg: v.mainBg,
    secondaryBg: v.secondaryBg,
    secondaryBgSolid: v.secondaryBgSolid,
    headerBg: v.headerBg,
    borderOnSecondary: v.borderOnSecondary,
    primaryText: v.primaryText,
    textPositive: v.textPositive,
    textWarning: v.textWarning,
    textCaution: v.textCaution,
    textNegative: v.textNegative,
    textMarketFlow: v.textMarketFlow,
    cssVariables: v,
  };
}

function ThemeInjector({
  vars,
  globalLocalDefaults,
  userLocalOverrides,
}: {
  vars: AdminThemeCssVariables;
  globalLocalDefaults: LocalThemeOverrides;
  userLocalOverrides: LocalThemeOverrides;
}) {
  useEffect(() => {
    const root = document.documentElement;
    const globalProps = adminThemeToCssProperties(vars);
    const localProps = buildLocalThemeCssProperties(
      { globalLocalDefaults, userLocalOverrides },
      vars
    );
    const all = { ...globalProps, ...localProps };
    for (const [key, value] of Object.entries(all)) {
      root.style.setProperty(key, value);
    }
    return () => {
      for (const key of Object.keys(all)) {
        root.style.removeProperty(key);
      }
    };
  }, [vars, globalLocalDefaults, userLocalOverrides]);
  return null;
}

export function SystemSettingsProvider({ children }: { children: ReactNode }) {
  const { data, isLoading } = useQuery<ThemeSettingsResponse>({
    queryKey: [...THEME_SETTINGS_QUERY_KEY],
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
  });

  const settings = useMemo(
    () => normalizeAdminThemeSettings(data?.global),
    [data?.global]
  );
  const globalLocalDefaults = useMemo(
    () => normalizeLocalThemeOverrides(data?.globalLocalDefaults),
    [data?.globalLocalDefaults]
  );
  const userLocalOverrides = useMemo(
    () => normalizeLocalThemeOverrides(data?.userLocalOverrides),
    [data?.userLocalOverrides]
  );
  const cssVariables = buildAdminThemeCssVariables(settings);
  const pageShellStyle = adminPageShellStyle(cssVariables);

  return (
    <SystemSettingsContext.Provider
      value={{
        settings,
        isLoading,
        cssVariables,
        pageShellStyle,
        globalLocalDefaults,
        userLocalOverrides,
        isAdmin: data?.isAdmin ?? false,
      }}
    >
      <ThemeInjector
        vars={cssVariables}
        globalLocalDefaults={globalLocalDefaults}
        userLocalOverrides={userLocalOverrides}
      />
      {children}
    </SystemSettingsContext.Provider>
  );
}
