import { createContext, useContext, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSentinelAuth } from "@/context/SentinelAuthContext";
import {
  resolveWorkspacePalette,
  type StartHereWorkspacePalette,
} from "@/components/start-here/dashboard-persistence";

interface WorkspacePaletteContextType {
  /** Normalized palette (always 10 lanes + unlinked); matches admin settings when loaded. */
  palette: StartHereWorkspacePalette;
  isLoading: boolean;
}

const WorkspacePaletteContext = createContext<WorkspacePaletteContextType | null>(null);

export function WorkspacePaletteProvider({ children }: { children: ReactNode }) {
  const { user, isLoading: authLoading } = useSentinelAuth();

  const { data, isLoading: queryLoading } = useQuery<StartHereWorkspacePalette>({
    queryKey: ["/api/sentinel/start-here-workspace-palette"],
    enabled: !authLoading && !!user,
    staleTime: 60_000,
  });

  const palette = resolveWorkspacePalette(data);

  const value: WorkspacePaletteContextType = {
    palette,
    isLoading: authLoading || (!!user && queryLoading && !data),
  };

  return (
    <WorkspacePaletteContext.Provider value={value}>{children}</WorkspacePaletteContext.Provider>
  );
}

export function useWorkspacePalette(): WorkspacePaletteContextType {
  const ctx = useContext(WorkspacePaletteContext);
  if (!ctx) {
    throw new Error("useWorkspacePalette must be used within WorkspacePaletteProvider");
  }
  return ctx;
}
