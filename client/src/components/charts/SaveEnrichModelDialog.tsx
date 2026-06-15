import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { CHART_VIEWER_DIALOG_POPOVER_Z, CHART_VIEWER_DIALOG_Z } from "@/lib/overlay-z-index";
import {
  CHART_ENRICH_LIFECYCLE_DISPLAY,
  CHART_ENRICH_LIFECYCLE_STAGES,
  CHART_ENRICH_MODEL_SCOPES,
  CHART_ENRICH_MODEL_TIERS,
  CHART_ENRICH_PATTERN_CLEANLINESS,
  CHART_ENRICH_PATTERN_DISPLAY,
  CHART_ENRICH_PATTERN_LABELS,
  type ChartEnrichLifecycleStage,
  type ChartEnrichModelScope,
  type ChartEnrichModelTier,
  type ChartEnrichPatternCleanliness,
  type ChartEnrichPatternLabel,
  type ChartSetupEnrichDossier,
  type ChartSetupEnrichResult,
} from "@shared/chart-setup-enrich";

const SCOPE_LABELS: Record<ChartEnrichModelScope, string> = {
  full_read: "Full setup read",
  lifecycle: "Lifecycle / timing",
  pattern: "Pattern shape",
  invalidation: "Invalidation level",
  visual: "Visual chart look",
};

const SCOPE_HINTS: Record<ChartEnrichModelScope, string> = {
  full_read: "Whole enrich callout — recommendation + posture",
  lifecycle: "When to act — triggering, extended, etc.",
  pattern: "Shape label — U&R, pullback, breakout…",
  invalidation: "Where the setup fails",
  visual: "How the chart looks (candles, MAs, tone)",
};

export interface SaveEnrichModelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  symbol: string;
  enrichResult: ChartSetupEnrichResult | null;
  dossier: ChartSetupEnrichDossier | null;
  enrichRunId: number | null;
  feedbackId: number | null;
  prefillScopes?: ChartEnrichModelScope[];
  prefillLifecycle?: ChartEnrichLifecycleStage | null;
  prefillPattern?: ChartEnrichPatternLabel | null;
  onSave: (payload: {
    tier: ChartEnrichModelTier;
    scopes: ChartEnrichModelScope[];
    patternLabel: ChartEnrichPatternLabel | null;
    patternCleanliness: ChartEnrichPatternCleanliness | null;
    lifecycleStage: ChartEnrichLifecycleStage | null;
    note: string | null;
  }) => Promise<void>;
}

export function SaveEnrichModelDialog({
  open,
  onOpenChange,
  symbol,
  enrichResult,
  dossier,
  enrichRunId,
  feedbackId,
  prefillScopes,
  prefillLifecycle,
  prefillPattern,
  onSave,
}: SaveEnrichModelDialogProps) {
  const [tier, setTier] = useState<ChartEnrichModelTier>("silver");
  const [scopes, setScopes] = useState<ChartEnrichModelScope[]>(["full_read"]);
  const [patternLabel, setPatternLabel] = useState<ChartEnrichPatternLabel>(
    enrichResult?.patternLabel ?? "none_unclear"
  );
  const [patternCleanliness, setPatternCleanliness] = useState<ChartEnrichPatternCleanliness>(
    enrichResult?.patternCleanliness ?? "unclear"
  );
  const [lifecycleStage, setLifecycleStage] = useState<ChartEnrichLifecycleStage>(
    enrichResult?.lifecycleStage ?? "unclear"
  );
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTier("silver");
    setScopes(prefillScopes?.length ? prefillScopes : ["full_read"]);
    setPatternLabel(prefillPattern ?? enrichResult?.patternLabel ?? "none_unclear");
    setPatternCleanliness(enrichResult?.patternCleanliness ?? "unclear");
    setLifecycleStage(prefillLifecycle ?? enrichResult?.lifecycleStage ?? "unclear");
    setNote("");
  }, [open, prefillScopes, prefillLifecycle, prefillPattern, enrichResult]);

  const toggleScope = (scope: ChartEnrichModelScope) => {
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
    );
  };

  const handleSave = async () => {
    if (!scopes.length) return;
    setSaving(true);
    try {
      await onSave({
        tier,
        scopes,
        patternLabel: scopes.includes("pattern") ? patternLabel : null,
        patternCleanliness: scopes.includes("pattern") ? patternCleanliness : null,
        lifecycleStage: scopes.includes("lifecycle") ? lifecycleStage : null,
        note: note.trim() || null,
      });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("max-w-md", CHART_VIEWER_DIALOG_Z)} overlayClassName={CHART_VIEWER_DIALOG_Z}>
        <DialogHeader>
          <DialogTitle>Save as model — {symbol}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div>
            <Label className="text-xs text-muted-foreground">Quality</Label>
            <div className="mt-2 flex flex-wrap gap-2">
              {CHART_ENRICH_MODEL_TIERS.map((t) => (
                <Button
                  key={t}
                  type="button"
                  size="sm"
                  variant={tier === t ? "default" : "outline"}
                  onClick={() => setTier(t)}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </Button>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">What is this a model of?</Label>
            <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
              Check any combination.{" "}
              <span className="text-slate-400">
                Full setup read is not the same as checking all four rows below — it weights the
                whole saved analysis on future matches. Pattern and lifecycle also set which fields
                you can correct in this dialog.
              </span>
            </p>
            <div className="mt-2 space-y-2">
              {CHART_ENRICH_MODEL_SCOPES.map((scope) => (
                <label key={scope} className="flex items-start gap-2 cursor-pointer">
                  <Checkbox
                    className="mt-0.5"
                    checked={scopes.includes(scope)}
                    onCheckedChange={() => toggleScope(scope)}
                  />
                  <span>
                    <span className="block">{SCOPE_LABELS[scope]}</span>
                    <span className="block text-[10px] text-muted-foreground">{SCOPE_HINTS[scope]}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {scopes.includes("pattern") && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Pattern</Label>
                <Select
                  modal={false}
                  value={patternLabel}
                  onValueChange={(v) => setPatternLabel(v as ChartEnrichPatternLabel)}
                >
                  <SelectTrigger className="h-8 mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className={CHART_VIEWER_DIALOG_POPOVER_Z} position="popper">
                    {CHART_ENRICH_PATTERN_LABELS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {CHART_ENRICH_PATTERN_DISPLAY[p]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Cleanliness</Label>
                <Select
                  modal={false}
                  value={patternCleanliness}
                  onValueChange={(v) => setPatternCleanliness(v as ChartEnrichPatternCleanliness)}
                >
                  <SelectTrigger className="h-8 mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className={CHART_VIEWER_DIALOG_POPOVER_Z} position="popper">
                    {CHART_ENRICH_PATTERN_CLEANLINESS.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c.charAt(0).toUpperCase() + c.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {scopes.includes("lifecycle") && (
            <div>
              <Label className="text-xs">Lifecycle stage</Label>
              <Select
                modal={false}
                value={lifecycleStage}
                onValueChange={(v) => setLifecycleStage(v as ChartEnrichLifecycleStage)}
              >
                <SelectTrigger className="h-8 mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className={CHART_VIEWER_DIALOG_POPOVER_Z} position="popper">
                  {CHART_ENRICH_LIFECYCLE_STAGES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {CHART_ENRICH_LIFECYCLE_DISPLAY[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <Label className="text-xs">Optional note</Label>
            <Textarea
              className="mt-1 min-h-[60px] text-sm"
              placeholder="e.g. Multiple undercuts — wait for 50d, not fresh U&R entry"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          {enrichRunId != null && (
            <p className="text-[11px] text-muted-foreground">
              Run #{enrichRunId}
              {feedbackId != null ? ` · feedback #${feedbackId}` : ""}
              {dossier ? ` · ${dossier.dailyBars.length}d bars` : ""}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={!scopes.length || saving} onClick={() => void handleSave()}>
            {saving ? "Saving…" : "Save model"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
