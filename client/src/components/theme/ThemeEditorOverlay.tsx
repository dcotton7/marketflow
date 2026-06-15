import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Palette } from "lucide-react";
import type { AdminThemeSettings, AdminThemeCssVariables } from "@shared/admin-theme";
import { DEFAULT_ADMIN_THEME } from "@shared/admin-theme";
import {
  getSlotResolvedValue,
  type LocalThemeOverrides,
  type LocalThemeSlotValue,
} from "@shared/local-theme";
import { APP_PALETTE_SWATCHES, getLocalThemeSlot, type ThemeDefaultSource } from "@shared/theme-registry";
import type { ThemeEditorTab } from "@/context/ThemeEditorContext";
import type { ThemeSaveScope } from "@shared/theme-api";

interface ThemeEditorOverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab: ThemeEditorTab;
  activeSlotId: string | null;
  activeSlotLabel?: string;
  activeSlotDescription?: string;
  settings: AdminThemeSettings;
  globalLocalDefaults: LocalThemeOverrides;
  userLocalOverrides: LocalThemeOverrides;
  cssVariables: AdminThemeCssVariables;
  isAdmin: boolean;
  onSaveGlobal: (settings: AdminThemeSettings) => Promise<void>;
  onSaveGlobalLocal: (overrides: LocalThemeOverrides) => Promise<void>;
  onSaveUserLocal: (overrides: LocalThemeOverrides) => Promise<void>;
  isSaving: boolean;
}

const FONT_SIZE_OPTIONS = [
  "0.625rem", "0.75rem", "0.8125rem", "0.875rem", "1rem",
  "1.125rem", "1.25rem", "1.5rem", "1.875rem", "2.25rem",
];

export function ThemeEditorOverlay({
  open,
  onOpenChange,
  initialTab,
  activeSlotId,
  activeSlotLabel,
  activeSlotDescription,
  settings,
  globalLocalDefaults,
  userLocalOverrides,
  cssVariables,
  isAdmin,
  onSaveGlobal,
  onSaveGlobalLocal,
  onSaveUserLocal,
  isSaving,
}: ThemeEditorOverlayProps) {
  const [tab, setTab] = useState<ThemeEditorTab>(initialTab);
  const [globalDraft, setGlobalDraft] = useState<AdminThemeSettings>(settings);
  const [localDraft, setLocalDraft] = useState<LocalThemeSlotValue>({ color: "#1e3a5f", opacity: 75 });
  const [localSaveScope, setLocalSaveScope] = useState<ThemeSaveScope>("userLocal");

  useEffect(() => {
    if (open) {
      setTab(initialTab);
      setGlobalDraft(settings);
      setLocalSaveScope(isAdmin ? "globalLocal" : "userLocal");
    }
  }, [open, initialTab, settings, isAdmin]);

  useEffect(() => {
    if (!activeSlotId) return;
    const layers = { globalLocalDefaults, userLocalOverrides };
    const resolved = getSlotResolvedValue(activeSlotId, layers, cssVariables);
    setLocalDraft({ color: resolved.color, opacity: resolved.opacity });
  }, [activeSlotId, globalLocalDefaults, userLocalOverrides, cssVariables, open]);

  const showLocalTab = !!activeSlotId;
  const showGlobalTab = isAdmin;

  const activeSlot = activeSlotId ? getLocalThemeSlot(activeSlotId) : undefined;
  const resolvedSlot = useMemo(() => {
    if (!activeSlotId) return null;
    return getSlotResolvedValue(
      activeSlotId,
      { globalLocalDefaults, userLocalOverrides },
      cssVariables
    );
  }, [activeSlotId, globalLocalDefaults, userLocalOverrides, cssVariables]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Palette className="h-5 w-5" />
            Theme editor
          </DialogTitle>
          <DialogDescription>
            {isAdmin
              ? "Global settings apply to everyone. Local settings apply per control — admins can set defaults for all users."
              : "Use global colors from admin, or set your own local colors per control."}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as ThemeEditorTab)}>
          <TabsList className="w-full justify-start">
            {showGlobalTab && <TabsTrigger value="global">Global</TabsTrigger>}
            {showLocalTab && <TabsTrigger value="local">Local</TabsTrigger>}
          </TabsList>

          {showGlobalTab && (
            <TabsContent value="global" className="space-y-6 mt-4">
              <GlobalThemeFields draft={globalDraft} onChange={setGlobalDraft} />
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setGlobalDraft({ ...DEFAULT_ADMIN_THEME })}>
                  Reset defaults
                </Button>
                <Button disabled={isSaving} onClick={() => onSaveGlobal(globalDraft)}>
                  {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save global"}
                </Button>
              </div>
            </TabsContent>
          )}

          {showLocalTab && activeSlotId && (
            <TabsContent value="local" className="space-y-4 mt-4">
              <div>
                <h3 className="font-semibold">{activeSlotLabel ?? activeSlotId}</h3>
                {activeSlotDescription && (
                  <p className="text-sm text-muted-foreground mt-1">{activeSlotDescription}</p>
                )}
                <p className="text-xs text-muted-foreground mt-2">
                  This control is shared — the same slot appears everywhere this region is used.
                </p>
                {activeSlot && resolvedSlot ? (
                  <LocalInheritanceHint
                    defaultSource={activeSlot.defaultSource}
                    source={resolvedSlot.source}
                    isAdmin={isAdmin}
                    onEditGlobalSecondary={() => setTab("global")}
                  />
                ) : null}
              </div>

              {isAdmin && (
                <div className="flex gap-2 rounded-lg border p-1 bg-muted/40">
                  <Button
                    type="button"
                    size="sm"
                    variant={localSaveScope === "globalLocal" ? "default" : "ghost"}
                    className="flex-1"
                    onClick={() => setLocalSaveScope("globalLocal")}
                  >
                    Save for everyone
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={localSaveScope === "userLocal" ? "default" : "ghost"}
                    className="flex-1"
                    onClick={() => setLocalSaveScope("userLocal")}
                  >
                    Save for me only
                  </Button>
                </div>
              )}

              <LocalSlotFields draft={localDraft} onChange={setLocalDraft} />

              <PaletteSwatches
                cssVariables={cssVariables}
                onPick={(hex) => setLocalDraft((d) => ({ ...d, color: hex }))}
              />

              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={async () => {
                    if (localSaveScope === "globalLocal" && isAdmin) {
                      const next = { ...globalLocalDefaults };
                      delete next[activeSlotId];
                      await onSaveGlobalLocal(next);
                    } else {
                      const next = { ...userLocalOverrides };
                      delete next[activeSlotId];
                      await onSaveUserLocal(next);
                    }
                    onOpenChange(false);
                  }}
                >
                  Reset to global default
                </Button>
                <Button
                  disabled={isSaving}
                  onClick={async () => {
                    if (localSaveScope === "globalLocal" && isAdmin) {
                      await onSaveGlobalLocal({
                        ...globalLocalDefaults,
                        [activeSlotId]: localDraft,
                      });
                    } else {
                      await onSaveUserLocal({
                        ...userLocalOverrides,
                        [activeSlotId]: localDraft,
                      });
                    }
                    onOpenChange(false);
                  }}
                >
                  {isSaving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : localSaveScope === "globalLocal" && isAdmin ? (
                    "Save global local"
                  ) : (
                    "Save my colors"
                  )}
                </Button>
              </div>
            </TabsContent>
          )}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

const PALETTE_RESOLVERS: Record<string, (v: AdminThemeCssVariables) => string> = {
  primary: (v) => v.primaryText,
  positive: (v) => v.textPositive,
  warning: (v) => v.textWarning,
  caution: (v) => v.textCaution,
  negative: (v) => v.textNegative,
  marketFlow: (v) => v.textMarketFlow,
  mainBg: (v) => v.mainBg,
  secondaryBg: (v) => v.secondaryBgSolid,
  headerBg: (v) => v.headerBg,
};

const DEFAULT_SOURCE_LABELS: Partial<Record<ThemeDefaultSource, string>> = {
  secondaryBg: "global Secondary BG",
  secondaryBgSolid: "global Secondary BG",
  mainBg: "global Main BG",
  headerBg: "global header styling",
};

function LocalInheritanceHint({
  defaultSource,
  source,
  isAdmin,
  onEditGlobalSecondary,
}: {
  defaultSource: ThemeDefaultSource;
  source: "user" | "globalLocal" | "derived";
  isAdmin: boolean;
  onEditGlobalSecondary: () => void;
}) {
  const baseLabel = DEFAULT_SOURCE_LABELS[defaultSource] ?? "global theme";
  const sourceLabel =
    source === "user"
      ? "Your personal override"
      : source === "globalLocal"
        ? "Admin default for everyone"
        : `Inherits ${baseLabel}`;

  const showGlobalLink =
    isAdmin && (defaultSource === "secondaryBg" || defaultSource === "secondaryBgSolid");

  return (
    <div className="mt-3 rounded-lg border border-slate-600/40 bg-slate-900/40 px-3 py-2 text-xs text-muted-foreground space-y-1.5">
      <p>
        <span className="font-medium text-slate-300">Current: </span>
        {sourceLabel}
      </p>
      {source === "derived" && (
        <p>
          Change <span className="text-slate-300">Secondary BG</span> in Global to update all panels and overlays
          at once. Save here only when this control should look different.
        </p>
      )}
      {showGlobalLink && (
        <Button
          type="button"
          variant="link"
          className="h-auto p-0 text-xs text-cyan-400/90"
          onClick={onEditGlobalSecondary}
        >
          Edit global Secondary BG
        </Button>
      )}
    </div>
  );
}

function PaletteSwatches({
  cssVariables,
  onPick,
}: {
  cssVariables: AdminThemeCssVariables;
  onPick: (hex: string) => void;
}) {
  return (
    <div>
      <Label className="text-sm">App palette</Label>
      <div className="flex flex-wrap gap-2 mt-2">
        {APP_PALETTE_SWATCHES.map((s) => (
          <button
            key={s.key}
            type="button"
            title={s.label}
            className="h-8 w-8 rounded border border-white/20"
            style={{ backgroundColor: PALETTE_RESOLVERS[s.key]?.(cssVariables) ?? "#888" }}
            onClick={() => onPick(PALETTE_RESOLVERS[s.key]?.(cssVariables) ?? "#ffffff")}
          />
        ))}
        <input
          type="color"
          className="h-8 w-8 cursor-pointer rounded border p-0"
          onChange={(e) => onPick(e.target.value)}
          title="Custom color"
        />
      </div>
    </div>
  );
}

function LocalSlotFields({
  draft,
  onChange,
}: {
  draft: LocalThemeSlotValue;
  onChange: (v: LocalThemeSlotValue) => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="space-y-2">
        <Label>Color</Label>
        <div className="flex gap-2">
          <input
            type="color"
            value={draft.color}
            onChange={(e) => onChange({ ...draft, color: e.target.value })}
            className="h-10 w-14 rounded border cursor-pointer"
          />
          <Input
            value={draft.color}
            onChange={(e) => onChange({ ...draft, color: e.target.value })}
            className="font-mono"
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Opacity: {draft.opacity}%</Label>
        <p className="text-xs text-muted-foreground">Higher % = more opaque</p>
        <Slider
          value={[draft.opacity]}
          onValueChange={([v]) => onChange({ ...draft, opacity: v })}
          min={0}
          max={100}
          step={5}
        />
      </div>
      <div
        className="md:col-span-2 h-12 rounded-lg border"
        style={{
          backgroundColor: `${draft.color}${Math.round(draft.opacity * 2.55).toString(16).padStart(2, "0")}`,
        }}
      />
    </div>
  );
}

function GlobalThemeFields({
  draft,
  onChange,
}: {
  draft: AdminThemeSettings;
  onChange: (d: AdminThemeSettings) => void;
}) {
  const set = <K extends keyof AdminThemeSettings>(key: K, val: AdminThemeSettings[K]) =>
    onChange({ ...draft, [key]: val });

  return (
    <div className="space-y-6">
      <section>
        <h3 className="font-semibold mb-3">Backgrounds</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Main BG = page canvas. Secondary BG = shared base for panels, overlay windows, and Ticker Review result
          cards — unless a local override is saved on a specific control.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ColorField label="Main BG" value={draft.backgroundColor} onChange={(v) => set("backgroundColor", v)} />
          <ColorField label="Secondary BG" value={draft.overlayColor} onChange={(v) => set("overlayColor", v)} />
          <div className="space-y-2 md:col-span-2">
            <Label>Secondary BG opacity: {draft.overlayTransparency}%</Label>
            <p className="text-xs text-muted-foreground">Higher % = more opaque</p>
            <Slider
              value={[draft.overlayTransparency]}
              onValueChange={([v]) => set("overlayTransparency", v)}
              min={0}
              max={100}
              step={5}
            />
          </div>
          <ColorField
            label="Border on secondary"
            value={draft.secondaryOverlayColor}
            onChange={(v) => set("secondaryOverlayColor", v)}
          />
          <div className="space-y-2">
            <Label>Logo opacity: {draft.logoTransparency}%</Label>
            <p className="text-xs text-muted-foreground">Higher % = more visible</p>
            <Slider
              value={[draft.logoTransparency]}
              onValueChange={([v]) => set("logoTransparency", v)}
              min={0}
              max={100}
              step={1}
            />
          </div>
        </div>
      </section>

      <section>
        <h3 className="font-semibold mb-3">Semantic text colors</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <ColorField label="Primary" value={draft.textColorNormal} onChange={(v) => set("textColorNormal", v)} />
          <ColorField label="Green" value={draft.textColorPositive} onChange={(v) => set("textColorPositive", v)} />
          <ColorField label="Yellow" value={draft.textColorWarning} onChange={(v) => set("textColorWarning", v)} />
          <ColorField label="Pink" value={draft.textColorCaution} onChange={(v) => set("textColorCaution", v)} />
          <ColorField label="Red" value={draft.textColorNegative} onChange={(v) => set("textColorNegative", v)} />
          <ColorField label="Market Flow" value={draft.textColorMarketFlow} onChange={(v) => set("textColorMarketFlow", v)} />
        </div>
      </section>

      <section>
        <h3 className="font-semibold mb-3">Text hierarchy</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {(
            [
              ["Title", "textColorTitle", "fontSizeTitle"],
              ["Header", "textColorHeader", "fontSizeHeader"],
              ["Section", "textColorSection", "fontSizeSection"],
              ["Normal", "textColorNormal", "fontSizeNormal"],
              ["Small", "textColorSmall", "fontSizeSmall"],
              ["Tiny", "textColorTiny", "fontSizeTiny"],
            ] as const
          ).map(([label, colorKey, sizeKey]) => (
            <div key={colorKey} className="flex items-center gap-2">
              <input
                type="color"
                value={draft[colorKey]}
                onChange={(e) => set(colorKey, e.target.value)}
                className="h-8 w-10 rounded border cursor-pointer"
              />
              <span className="text-sm w-16">{label}</span>
              <Select value={draft[sizeKey]} onValueChange={(v) => set(sizeKey, v)}>
                <SelectTrigger className="h-8 text-xs flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FONT_SIZE_OPTIONS.map((sz) => (
                    <SelectItem key={sz} value={sz}>{sz}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-sm">{label}</Label>
      <div className="flex gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 rounded border cursor-pointer"
        />
        <Input value={value} onChange={(e) => onChange(e.target.value)} className="font-mono text-xs" />
      </div>
    </div>
  );
}
