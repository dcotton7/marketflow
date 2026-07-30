import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export type BriefingMode = "pre" | "post";

export interface BriefingPreviewItem {
  mode: BriefingMode;
  label: string;
  referenceSession: string;
  description: string;
  recommended: boolean;
}

interface ThemeBriefingPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerate: (mode: BriefingMode) => void;
  generating?: boolean;
}

function formatSessionDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatMarketDateET(d: Date): string {
  const etString = d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [month, day, year] = etString.split(/[/, ]/);
  return `${year}-${month}-${day}`;
}

function subtractTradingDays(anchor: Date, tradingDays: number): Date {
  const d = new Date(anchor);
  d.setUTCHours(0, 0, 0, 0);
  let remaining = tradingDays;
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() - 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) remaining--;
  }
  return d;
}

function getTerminalState(anchor: Date): "PRE_OPEN" | "LIVE" | "AFTER_HOURS" | "CLOSED" {
  const etNow = new Date(anchor.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = etNow.getDay();
  if (day === 0 || day === 6) return "CLOSED";
  const mins = etNow.getHours() * 60 + etNow.getMinutes();
  if (mins < 9 * 60 + 30) return "PRE_OPEN";
  if (mins < 16 * 60) return "LIVE";
  return "AFTER_HOURS";
}

function buildLocalPreview(anchor = new Date()): BriefingPreviewItem[] {
  const todayEt = formatMarketDateET(anchor);
  const prior = formatMarketDateET(subtractTradingDays(anchor, 1));
  const terminalState = getTerminalState(anchor);
  const recommendPost =
    terminalState === "AFTER_HOURS" || terminalState === "CLOSED" || terminalState === "LIVE";
  const recommendPre = terminalState === "PRE_OPEN";

  const fmt = (iso: string) =>
    new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "America/New_York",
    });

  return [
    {
      mode: "post",
      label: "Post-market briefing",
      referenceSession: todayEt,
      description: `Theme flow for ${fmt(todayEt)} — session ranks, rotation, late moves, and catalysts where evidence exists.`,
      recommended: recommendPost && !recommendPre,
    },
    {
      mode: "pre",
      label: "Pre-market briefing",
      referenceSession: prior,
      description: `Live overnight and early-morning theme flow into the open, ranked versus ${fmt(prior)} close; prior-session tape remains supporting context.`,
      recommended: recommendPre,
    },
  ];
}

async function fetchPreview(): Promise<BriefingPreviewItem[]> {
  const res = await fetch("/api/market-condition/briefing/preview");
  if (!res.ok) throw new Error("Failed to load briefing options");
  const data = await res.json();
  return data.preview as BriefingPreviewItem[];
}

export function ThemeBriefingPickerDialog({
  open,
  onOpenChange,
  onGenerate,
  generating = false,
}: ThemeBriefingPickerDialogProps) {
  const localPreview = useMemo(() => buildLocalPreview(), [open]);

  const { data: preview, isFetching, isError, refetch } = useQuery({
    queryKey: ["market-condition", "briefing-preview"],
    queryFn: fetchPreview,
    enabled: open,
    staleTime: 60_000,
    placeholderData: localPreview,
  });

  const options = preview ?? localPreview;
  const post = options.find((p) => p.mode === "post");
  const pre = options.find((p) => p.mode === "pre");
  const cards = [post, pre].filter(Boolean) as BriefingPreviewItem[];

  const handleGenerate = (mode: BriefingMode) => {
    onOpenChange(false);
    onGenerate(mode);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg bg-slate-900 border-slate-700 text-slate-100">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-amber-400" />
            Theme market briefing
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Ivy synthesizes theme flow from MarketFlow snapshots, rotation, and news where evidence exists.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {isFetching && (
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Refreshing session dates…
            </div>
          )}
          {isError && (
            <div className="flex items-center justify-between gap-2 rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200/90">
              <span>Could not refresh dates from server — using local estimate.</span>
              <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => refetch()}>
                Retry
              </Button>
            </div>
          )}
          {cards.map((item) => (
            <div
              key={item.mode}
              className={cn(
                "rounded-lg border p-4 space-y-2",
                item.recommended
                  ? "border-amber-500/40 bg-amber-500/5"
                  : "border-slate-700 bg-slate-800/40"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-sm">{item.label}</span>
                {item.recommended && (
                  <Badge variant="outline" className="text-amber-400 border-amber-500/40 text-[10px]">
                    Recommended
                  </Badge>
                )}
              </div>
              <p className="text-xs text-cyan-400/90">
                Covers: {formatSessionDate(item.referenceSession)}
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">{item.description}</p>
              <Button
                type="button"
                size="sm"
                className="w-full mt-1 gap-1.5"
                variant={item.recommended ? "default" : "secondary"}
                disabled={generating}
                onClick={() => handleGenerate(item.mode)}
              >
                {generating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5 text-amber-300" />
                )}
                Generate {item.mode === "post" ? "post-market" : "pre-market"} report
              </Button>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={generating}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
