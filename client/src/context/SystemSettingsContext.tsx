import { createContext, useContext, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

interface SystemSettings {
  overlayColor: string;
  overlayTransparency: number;
  backgroundColor: string;
  logoTransparency: number;
  secondaryOverlayColor: string;
  textColorTitle: string;
  textColorHeader: string;
  textColorSection: string;
  textColorNormal: string;
  textColorSmall: string;
  textColorTiny: string;
  fontSizeTitle: string;
  fontSizeHeader: string;
  fontSizeSection: string;
  fontSizeNormal: string;
  fontSizeSmall: string;
  fontSizeTiny: string;
}

const defaultSettings: SystemSettings = {
  overlayColor: "#1e3a5f",
  overlayTransparency: 75,
  backgroundColor: "#0f172a",
  logoTransparency: 12,
  secondaryOverlayColor: "#e8e8e8",
  textColorTitle: "#ffffff",
  textColorHeader: "#ffffff",
  textColorSection: "#ffffff",
  textColorNormal: "#ffffff",
  textColorSmall: "#a1a1aa",
  textColorTiny: "#71717a",
  fontSizeTitle: "1.5rem",
  fontSizeHeader: "1.125rem",
  fontSizeSection: "1rem",
  fontSizeNormal: "0.875rem",
  fontSizeSmall: "0.8125rem",
  fontSizeTiny: "0.75rem",
};

export interface CssVariables {
  overlayBg: string;
  headerBg: string;
  overlayColor: string;
  backgroundColor: string;
  logoOpacity: number;
  secondaryOverlayColor: string;
  textColorTitle: string;
  textColorHeader: string;
  textColorSection: string;
  textColorNormal: string;
  textColorSmall: string;
  textColorTiny: string;
  fontSizeTitle: string;
  fontSizeHeader: string;
  fontSizeSection: string;
  fontSizeNormal: string;
  fontSizeSmall: string;
  fontSizeTiny: string;
}

function buildHexAlpha(hex: string, pct: number): string {
  return `${hex}${Math.round(pct * 2.55).toString(16).padStart(2, '0')}`;
}

function buildCssVariables(s: SystemSettings): CssVariables {
  return {
    overlayBg: buildHexAlpha(s.overlayColor, s.overlayTransparency),
    headerBg: buildHexAlpha(s.overlayColor, Math.min(s.overlayTransparency + 10, 100)),
    overlayColor: s.overlayColor,
    backgroundColor: s.backgroundColor,
    logoOpacity: (100 - s.logoTransparency) / 100,
    secondaryOverlayColor: s.secondaryOverlayColor || defaultSettings.secondaryOverlayColor,
    textColorTitle: s.textColorTitle || defaultSettings.textColorTitle,
    textColorHeader: s.textColorHeader || defaultSettings.textColorHeader,
    textColorSection: s.textColorSection || defaultSettings.textColorSection,
    textColorNormal: s.textColorNormal || defaultSettings.textColorNormal,
    textColorSmall: s.textColorSmall || defaultSettings.textColorSmall,
    textColorTiny: s.textColorTiny || defaultSettings.textColorTiny,
    fontSizeTitle: s.fontSizeTitle || defaultSettings.fontSizeTitle,
    fontSizeHeader: s.fontSizeHeader || defaultSettings.fontSizeHeader,
    fontSizeSection: s.fontSizeSection || defaultSettings.fontSizeSection,
    fontSizeNormal: s.fontSizeNormal || defaultSettings.fontSizeNormal,
    fontSizeSmall: s.fontSizeSmall || defaultSettings.fontSizeSmall,
    fontSizeTiny: s.fontSizeTiny || defaultSettings.fontSizeTiny,
  };
}

interface SystemSettingsContextType {
  settings: SystemSettings;
  isLoading: boolean;
  cssVariables: CssVariables;
}

const SystemSettingsContext = createContext<SystemSettingsContextType>({
  settings: defaultSettings,
  isLoading: false,
  cssVariables: buildCssVariables(defaultSettings),
});

export function useSystemSettings() {
  return useContext(SystemSettingsContext);
}

interface SystemSettingsProviderProps {
  children: ReactNode;
}

export function SystemSettingsProvider({ children }: SystemSettingsProviderProps) {
  const { data: settings, isLoading } = useQuery<SystemSettings>({
    queryKey: ["/api/sentinel/settings/system"],
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
  });

  const currentSettings = settings || defaultSettings;
  const cssVariables = buildCssVariables(currentSettings);

  return (
    <SystemSettingsContext.Provider value={{ settings: currentSettings, isLoading, cssVariables }}>
      {children}
    </SystemSettingsContext.Provider>
  );
}
