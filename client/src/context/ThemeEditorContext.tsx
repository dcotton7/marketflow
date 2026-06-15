import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  THEME_SETTINGS_QUERY_KEY,
  useSystemSettings,
  type SystemSettings,
} from "@/context/SystemSettingsContext";
import {
  getSlotResolvedValue,
  type LocalThemeOverrides,
} from "@shared/local-theme";
import { getLocalThemeSlot } from "@shared/theme-registry";
import { ThemeEditorOverlay } from "@/components/theme/ThemeEditorOverlay";
import type { AdminThemeSettings } from "@shared/admin-theme";

export type ThemeEditorTab = "global" | "local";

interface ThemeEditorContextType {
  openThemeEditor: (opts?: { slotId?: string; tab?: ThemeEditorTab }) => void;
  closeThemeEditor: () => void;
  getSlotColor: (slotId: string) => string;
  isSaving: boolean;
}

const ThemeEditorContext = createContext<ThemeEditorContextType | null>(null);

export function useThemeEditor() {
  const ctx = useContext(ThemeEditorContext);
  if (!ctx) throw new Error("useThemeEditor must be used within ThemeEditorProvider");
  return ctx;
}

export function useThemeEditorOptional() {
  return useContext(ThemeEditorContext);
}

function hexWithOpacity(color: string, opacity: number): string {
  const clean = color.replace("#", "").slice(0, 6);
  const alpha = Math.round(Math.min(100, Math.max(0, opacity)) * 2.55)
    .toString(16)
    .padStart(2, "0");
  return `#${clean}${alpha}`;
}

export function ThemeEditorProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const {
    settings,
    cssVariables,
    globalLocalDefaults,
    userLocalOverrides,
    isAdmin,
  } = useSystemSettings();
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [activeSlotId, setActiveSlotId] = useState<string | null>(null);
  const [initialTab, setInitialTab] = useState<ThemeEditorTab>("global");

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: [...THEME_SETTINGS_QUERY_KEY] });

  const saveGlobalMutation = useMutation({
    mutationFn: async (global: AdminThemeSettings) => {
      const res = await apiRequest("PATCH", "/api/sentinel/settings/theme/global", global);
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Global theme saved", description: "Applies to all users." });
    },
    onError: (e: Error) => {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    },
  });

  const saveGlobalLocalMutation = useMutation({
    mutationFn: async (overrides: LocalThemeOverrides) => {
      const res = await apiRequest("PATCH", "/api/sentinel/settings/theme/global-local", {
        overrides,
      });
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Global local saved", description: "Default for this control — all users unless they override." });
    },
    onError: (e: Error) => {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    },
  });

  const saveUserLocalMutation = useMutation({
    mutationFn: async (overrides: LocalThemeOverrides) => {
      const res = await apiRequest("PATCH", "/api/sentinel/settings/theme/user-local", {
        overrides,
      });
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Your colors saved", description: "Personal override for this control." });
    },
    onError: (e: Error) => {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    },
  });

  const isSaving =
    saveGlobalMutation.isPending ||
    saveGlobalLocalMutation.isPending ||
    saveUserLocalMutation.isPending;

  const openThemeEditor = useCallback(
    (opts?: { slotId?: string; tab?: ThemeEditorTab }) => {
      const slotId = opts?.slotId ?? null;
      let tab: ThemeEditorTab = opts?.tab ?? (slotId ? "local" : "global");
      if (tab === "global" && !isAdmin) tab = "local";
      setActiveSlotId(slotId);
      setInitialTab(tab);
      setOverlayOpen(true);
    },
    [isAdmin]
  );

  const closeThemeEditor = useCallback(() => {
    setOverlayOpen(false);
    setActiveSlotId(null);
  }, []);

  const layers = useMemo(
    () => ({ globalLocalDefaults, userLocalOverrides }),
    [globalLocalDefaults, userLocalOverrides]
  );

  const getSlotColor = useCallback(
    (slotId: string) => {
      const { color, opacity } = getSlotResolvedValue(slotId, layers, cssVariables);
      return hexWithOpacity(color, opacity);
    },
    [layers, cssVariables]
  );

  const ctxValue = useMemo(
    () => ({
      openThemeEditor,
      closeThemeEditor,
      getSlotColor,
      isSaving,
    }),
    [openThemeEditor, closeThemeEditor, getSlotColor, isSaving]
  );

  const activeSlot = activeSlotId ? getLocalThemeSlot(activeSlotId) : undefined;

  return (
    <ThemeEditorContext.Provider value={ctxValue}>
      {children}
      <ThemeEditorOverlay
        open={overlayOpen}
        onOpenChange={(o) => (o ? setOverlayOpen(true) : closeThemeEditor())}
        initialTab={initialTab}
        activeSlotId={activeSlotId}
        activeSlotLabel={activeSlot?.label}
        activeSlotDescription={activeSlot?.description}
        settings={settings}
        globalLocalDefaults={globalLocalDefaults}
        userLocalOverrides={userLocalOverrides}
        cssVariables={cssVariables}
        isAdmin={isAdmin}
        onSaveGlobal={(g) => saveGlobalMutation.mutateAsync(g)}
        onSaveGlobalLocal={(o) => saveGlobalLocalMutation.mutateAsync(o)}
        onSaveUserLocal={(o) => saveUserLocalMutation.mutateAsync(o)}
        isSaving={isSaving}
      />
    </ThemeEditorContext.Provider>
  );
}
