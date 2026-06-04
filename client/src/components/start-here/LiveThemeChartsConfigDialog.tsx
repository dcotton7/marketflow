import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMarketCondition, useIntradaySnapshotSlots, type ClusterId } from "@/hooks/useMarketCondition";
import {
  DEFAULT_LIVE_THEME_CHARTS_CONFIG,
  LIVE_THEME_CHARTS_MAX_ROWS,
  LIVE_THEME_CHART_INTERVAL_OPTIONS,
  validateLiveThemeChartsConfig,
  snapshotKeyLabel,
  type LiveThemeChartsConfig,
  type LiveThemeChartsSnapshotKey,
} from "@/lib/live-theme-charts";
import type { StartHereInterval } from "@/components/MiniChart";
import { MOCK_THEMES } from "@/data/mockThemeData";

interface LiveThemeChartsConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: LiveThemeChartsConfig;
  workspaceDefaultInterval?: StartHereInterval;
  onSave: (
    config: LiveThemeChartsConfig,
    options?: { setWorkspaceChartDefault?: boolean }
  ) => void;
}

export function LiveThemeChartsConfigDialog({
  open,
  onOpenChange,
  config,
  workspaceDefaultInterval,
  onSave,
}: LiveThemeChartsConfigDialogProps) {
  const [draft, setDraft] = useState<LiveThemeChartsConfig>(config);
  const [setWorkspaceDefault, setSetWorkspaceDefault] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data } = useMarketCondition({
    enabled: open,
    timeSlice: "TODAY",
    sizeFilter: "ALL",
  });
  const { data: slotsData } = useIntradaySnapshotSlots({ enabled: open });

  const themeOptions = useMemo(() => {
    if (data?.themes?.length) {
      return [...data.themes]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((t) => ({ id: t.id as ClusterId, name: t.name }));
    }
    return MOCK_THEMES.map((t) => ({ id: t.id as ClusterId, name: t.name }));
  }, [data?.themes]);

  const snapshotOptions = useMemo(() => {
    const slots = slotsData?.slots ?? [];
    const base: Array<{ key: LiveThemeChartsSnapshotKey; label: string }> = [
      { key: "live", label: "Live (current)" },
      ...slots.map((s) => ({ key: s.at, label: s.label })),
    ];
    const keys = new Set(base.map((b) => b.key));
    for (const col of [draft.top, draft.bottom, draft.specific]) {
      if (col.snapshotKey !== "live" && !keys.has(col.snapshotKey)) {
        base.push({
          key: col.snapshotKey,
          label: snapshotKeyLabel(col.snapshotKey),
        });
        keys.add(col.snapshotKey);
      }
    }
    return base;
  }, [draft.top.snapshotKey, draft.bottom.snapshotKey, draft.specific.snapshotKey, slotsData?.slots]);

  useEffect(() => {
    if (open) {
      setDraft(config);
      setSetWorkspaceDefault(config.chartInterval === workspaceDefaultInterval);
      setError(null);
    }
  }, [open, config, workspaceDefaultInterval]);

  const toggleSpecificTheme = (id: ClusterId) => {
    setDraft((prev) => {
      const ids = prev.specific.themeIds;
      const has = ids.includes(id);
      const next = has ? ids.filter((x) => x !== id) : [...ids, id].slice(0, LIVE_THEME_CHARTS_MAX_ROWS);
      return { ...prev, specific: { ...prev.specific, themeIds: next } };
    });
  };

  const handleSave = () => {
    const msg = validateLiveThemeChartsConfig(draft);
    if (msg) {
      setError(msg);
      return;
    }
    onSave(draft, { setWorkspaceChartDefault: setWorkspaceDefault });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" data-testid="dialog-live-theme-charts-config">
        <DialogHeader>
          <DialogTitle>Live Theme Charts</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <p className="text-[11px] text-muted-foreground">
            Theme stats compare to stored 15-minute snapshots (9:30 AM ET and every 15 minutes through the session).
            Charts use the same MiniChart component and refresh rules as Start Here.
          </p>

          <div className="rounded-md border border-border/60 p-3 space-y-2">
            <Label className="text-xs font-medium">Chart timeframe</Label>
            <Select
              value={draft.chartInterval}
              onValueChange={(v) =>
                setDraft((p) => ({ ...p, chartInterval: v as StartHereInterval }))
              }
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LIVE_THEME_CHART_INTERVAL_OPTIONS.map((tf) => (
                  <SelectItem key={tf} value={tf} className="text-xs">
                    {tf === "1d" ? "Daily" : tf.replace("m", " min")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox
                checked={setWorkspaceDefault}
                onCheckedChange={(v) => setSetWorkspaceDefault(v === true)}
              />
              Set as workspace default chart timeframe (watchlist spawns, chart preview)
            </label>
          </div>

          <ColumnBlock
            title="Top themes (left)"
            enabled={draft.top.enabled}
            onEnabledChange={(enabled) => setDraft((p) => ({ ...p, top: { ...p.top, enabled } }))}
          >
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Count (max {LIVE_THEME_CHARTS_MAX_ROWS})</Label>
                <Input
                  type="number"
                  min={1}
                  max={LIVE_THEME_CHARTS_MAX_ROWS}
                  value={draft.top.count}
                  onChange={(e) =>
                    setDraft((p) => ({
                      ...p,
                      top: { ...p.top, count: parseInt(e.target.value, 10) || 1 },
                    }))
                  }
                  className="h-8"
                />
              </div>
              <SnapshotSelect
                value={draft.top.snapshotKey}
                options={snapshotOptions}
                onChange={(snapshotKey) => setDraft((p) => ({ ...p, top: { ...p.top, snapshotKey } }))}
              />
            </div>
          </ColumnBlock>

          <ColumnBlock
            title="Bottom themes (center)"
            enabled={draft.bottom.enabled}
            onEnabledChange={(enabled) => setDraft((p) => ({ ...p, bottom: { ...p.bottom, enabled } }))}
          >
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Count (max {LIVE_THEME_CHARTS_MAX_ROWS})</Label>
                <Input
                  type="number"
                  min={1}
                  max={LIVE_THEME_CHARTS_MAX_ROWS}
                  value={draft.bottom.count}
                  onChange={(e) =>
                    setDraft((p) => ({
                      ...p,
                      bottom: { ...p.bottom, count: parseInt(e.target.value, 10) || 1 },
                    }))
                  }
                  className="h-8"
                />
              </div>
              <SnapshotSelect
                value={draft.bottom.snapshotKey}
                options={snapshotOptions}
                onChange={(snapshotKey) => setDraft((p) => ({ ...p, bottom: { ...p.bottom, snapshotKey } }))}
              />
            </div>
          </ColumnBlock>

          <ColumnBlock
            title="Picked themes (right)"
            enabled={draft.specific.enabled}
            onEnabledChange={(enabled) => setDraft((p) => ({ ...p, specific: { ...p.specific, enabled } }))}
          >
            <SnapshotSelect
              value={draft.specific.snapshotKey}
              options={snapshotOptions}
              onChange={(snapshotKey) =>
                setDraft((p) => ({ ...p, specific: { ...p.specific, snapshotKey } }))
              }
            />
            <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded border border-border/60 p-2">
              {themeOptions.map((t) => (
                <label key={t.id} className="flex cursor-pointer items-center gap-2 text-xs">
                  <Checkbox
                    checked={draft.specific.themeIds.includes(t.id)}
                    onCheckedChange={() => toggleSpecificTheme(t.id)}
                  />
                  <span>{t.name}</span>
                </label>
              ))}
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              {draft.specific.themeIds.length} selected (max {LIVE_THEME_CHARTS_MAX_ROWS})
            </p>
          </ColumnBlock>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setDraft({ ...DEFAULT_LIVE_THEME_CHARTS_CONFIG })}
          >
            Reset to defaults
          </Button>

          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} data-testid="button-save-live-theme-charts-config">
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ColumnBlock({
  title,
  enabled,
  onEnabledChange,
  children,
}: {
  title: string;
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  children: ReactNode;
}) {
  return (
    <div className="rounded-md border border-border/60 p-3 space-y-2">
      <label className="flex items-center gap-2 font-medium">
        <Checkbox checked={enabled} onCheckedChange={(v) => onEnabledChange(v === true)} />
        {title}
      </label>
      {enabled ? children : null}
    </div>
  );
}

function SnapshotSelect({
  value,
  options,
  onChange,
}: {
  value: LiveThemeChartsSnapshotKey;
  options: Array<{ key: LiveThemeChartsSnapshotKey; label: string }>;
  onChange: (v: LiveThemeChartsSnapshotKey) => void;
}) {
  return (
    <div>
      <Label className="text-xs">Snapshot baseline</Label>
      <Select value={value} onValueChange={(v) => onChange(v as LiveThemeChartsSnapshotKey)}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder="Live" />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt.key} value={opt.key} className="text-xs">
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
