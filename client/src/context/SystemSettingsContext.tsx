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
};

interface SystemSettingsContextType {
  settings: SystemSettings;
  isLoading: boolean;
  cssVariables: {
    overlayBg: string;
    backgroundColor: string;
    logoOpacity: number;
    secondaryOverlayColor: string;
    textColorTitle: string;
    textColorHeader: string;
    textColorSection: string;
    textColorNormal: string;
    textColorSmall: string;
    textColorTiny: string;
  };
}

const SystemSettingsContext = createContext<SystemSettingsContextType>({
  settings: defaultSettings,
  isLoading: false,
  cssVariables: {
    overlayBg: `${defaultSettings.overlayColor}bf`,
    backgroundColor: defaultSettings.backgroundColor,
    logoOpacity: (100 - defaultSettings.logoTransparency) / 100,
    secondaryOverlayColor: defaultSettings.secondaryOverlayColor,
    textColorTitle: defaultSettings.textColorTitle,
    textColorHeader: defaultSettings.textColorHeader,
    textColorSection: defaultSettings.textColorSection,
    textColorNormal: defaultSettings.textColorNormal,
    textColorSmall: defaultSettings.textColorSmall,
    textColorTiny: defaultSettings.textColorTiny,
  }
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
  
  const cssVariables = {
    overlayBg: `${currentSettings.overlayColor}${Math.round(currentSettings.overlayTransparency * 2.55).toString(16).padStart(2, '0')}`,
    backgroundColor: currentSettings.backgroundColor,
    logoOpacity: (100 - currentSettings.logoTransparency) / 100,
    secondaryOverlayColor: currentSettings.secondaryOverlayColor || defaultSettings.secondaryOverlayColor,
    textColorTitle: currentSettings.textColorTitle || defaultSettings.textColorTitle,
    textColorHeader: currentSettings.textColorHeader || defaultSettings.textColorHeader,
    textColorSection: currentSettings.textColorSection || defaultSettings.textColorSection,
    textColorNormal: currentSettings.textColorNormal || defaultSettings.textColorNormal,
    textColorSmall: currentSettings.textColorSmall || defaultSettings.textColorSmall,
    textColorTiny: currentSettings.textColorTiny || defaultSettings.textColorTiny,
  };

  return (
    <SystemSettingsContext.Provider value={{ settings: currentSettings, isLoading, cssVariables }}>
      {children}
    </SystemSettingsContext.Provider>
  );
}
