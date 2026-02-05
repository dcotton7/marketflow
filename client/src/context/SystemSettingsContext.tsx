import { createContext, useContext, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

interface SystemSettings {
  overlayColor: string;
  overlayTransparency: number;
  backgroundColor: string;
  logoTransparency: number;
}

const defaultSettings: SystemSettings = {
  overlayColor: "#1e3a5f",
  overlayTransparency: 75,
  backgroundColor: "#0f172a",
  logoTransparency: 6
};

interface SystemSettingsContextType {
  settings: SystemSettings;
  isLoading: boolean;
  cssVariables: {
    overlayBg: string;
    backgroundColor: string;
    logoOpacity: number;
  };
}

const SystemSettingsContext = createContext<SystemSettingsContextType>({
  settings: defaultSettings,
  isLoading: false,
  cssVariables: {
    overlayBg: `${defaultSettings.overlayColor}bf`,
    backgroundColor: defaultSettings.backgroundColor,
    logoOpacity: defaultSettings.logoTransparency / 100,
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
    logoOpacity: currentSettings.logoTransparency / 100,
  };

  return (
    <SystemSettingsContext.Provider value={{ settings: currentSettings, isLoading, cssVariables }}>
      {children}
    </SystemSettingsContext.Provider>
  );
}
