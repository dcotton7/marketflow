import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FloatingOverlayPanel } from "@/components/FloatingOverlayPanel";
import { useAdminTheme } from "@/context/SystemSettingsContext";
import { useThemeEditorOptional } from "@/context/ThemeEditorContext";
import { FileDown, Loader2, Mail, RefreshCw, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  emailBriefingReport,
  printBriefingAsPdf,
  type ThemeBriefingResponse,
} from "@/lib/theme-briefing-export";
import type { BriefingMode } from "./ThemeBriefingPickerDialog";

const STORAGE_KEY = "theme-briefing-floating";

export type { ThemeBriefingResponse };

async function fetchBriefing(mode: BriefingMode, force = false): Promise<ThemeBriefingResponse> {
  const q = force ? "&force=1" : "";
  const res = await fetch(`/api/market-condition/briefing?mode=${mode}&synthesize=1${q}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Failed to generate briefing");
  }
  return res.json();
}

function formatSessionDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function bodyToText(body: unknown): string {
  if (body == null) return "";
  if (typeof body === "string") return body;
  if (Array.isArray(body)) return body.map((item) => bodyToText(item)).filter(Boolean).join("\n");
  if (typeof body === "object") return JSON.stringify(body, null, 2);
  return String(body);
}

function renderBodyText(body: unknown) {
  return bodyToText(body).split("\n").map((line, i) => {
    const parts = line.split(/\*\*(.*?)\*\*/g);
    return (
      <p key={i} className="text-sm text-slate-300 leading-relaxed mb-2 last:mb-0">
        {parts.map((part, j) =>
          j % 2 === 1 ? (
            <strong key={j} className="text-slate-100 font-medium">
              {part}
            </strong>
          ) : (
            <span key={j}>{part}</span>
          )
        )}
      </p>
    );
  });
}

interface ThemeBriefingPanelProps {
  open: boolean;
  mode: BriefingMode | null;
  onOpenChange: (open: boolean) => void;
  onRefresh?: () => void;
}

export function ThemeBriefingPanel({ open, mode, onOpenChange, onRefresh }: ThemeBriefingPanelProps) {
  const queryClient = useQueryClient();
  const {
    data,
    isLoading,
    isFetching,
    error,
  } = useQuery({
    queryKey: ["market-condition", "briefing", mode],
    queryFn: () => fetchBriefing(mode!, false),
    enabled: open && mode !== null,
    staleTime: 5 * 60_000,
  });

  const [refreshing, setRefreshing] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  const handleSavePdf = (briefing: ThemeBriefingResponse) => {
    if (exportingPdf) return;
    setExportingPdf(true);
    try {
      printBriefingAsPdf(briefing);
    } finally {
      window.setTimeout(() => setExportingPdf(false), 2500);
    }
  };

  const handleRefresh = async () => {
    if (!mode) return;
    setRefreshing(true);
    try {
      const fresh = await fetchBriefing(mode, true);
      queryClient.setQueryData(["market-condition", "briefing", mode], fresh);
      onRefresh?.();
    } finally {
      setRefreshing(false);
    }
  };

  const isBusy = isFetching || refreshing;
  const { secondaryBg, headerBg, borderOnSecondary } = useAdminTheme();
  const themeEditor = useThemeEditorOptional();
  const overlaySurfaceBg = themeEditor?.getSlotColor("marketFlow:overlayBg") ?? secondaryBg;
  const overlayTitleBarBg = themeEditor?.getSlotColor("marketFlow:overlayHeader") ?? headerBg;

  const modeLabel = mode === "pre" ? "Pre-market" : "Post-market";

  return (
    <FloatingOverlayPanel
      open={open && mode !== null}
      onOpenChange={onOpenChange}
      storageKey={STORAGE_KEY}
      defaultState={{ x: 100, y: 72, w: 580, h: 640, pinned: false }}
      surfaceBg={overlaySurfaceBg}
      borderColor={borderOnSecondary}
      titleBarBg={overlayTitleBarBg}
      surfaceSlotId="marketFlow:overlayBg"
      titleBarSlotId="marketFlow:overlayHeader"
      titleBar={
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <Sparkles className="h-4 w-4 text-amber-400 shrink-0" />
          <span className="text-sm font-semibold text-foreground truncate">
            Theme Briefing · {modeLabel}
          </span>
          {data && (
            <span className="text-[10px] text-muted-foreground truncate">
              {formatSessionDate(data.referenceSession)}
            </span>
          )}
          {data && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => handleSavePdf(data)}
                disabled={exportingPdf}
                title="Save as PDF (Print → Save as PDF)"
                data-testid="button-theme-briefing-save-pdf"
              >
                <FileDown className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => emailBriefingReport(data)}
                title="Email briefing to a friend"
                data-testid="button-theme-briefing-email"
              >
                <Mail className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 ml-auto"
            onClick={handleRefresh}
            disabled={isBusy}
            title="Regenerate briefing"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isBusy && "animate-spin")} />
          </Button>
        </div>
      }
    >
      {isLoading && !data ? (
        <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Building theme briefing…</span>
        </div>
      ) : error ? (
        <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded p-3">
          {(error as Error).message}
        </div>
      ) : data ? (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="text-[10px]">
              {data.dataQuality.intradaySlots.available}/{data.dataQuality.intradaySlots.expected} slots
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {data.narrative.source === "llm"
                ? `AI · ${data.synthesisModel ?? "5.1"}`
                : "Rules"}
            </Badge>
            {data.cached && (
              <Badge variant="outline" className="text-[10px] text-cyan-300 border-cyan-500/40">
                Cached
              </Badge>
            )}
            {data.dataQuality.intradaySlots.available === 0 && (
              <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/40">
                No intraday tape
              </Badge>
            )}
          </div>

          {data.dataQuality.warnings.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-1">
              {data.dataQuality.warnings.map((w, i) => (
                <p key={i} className="text-xs text-amber-200/90 leading-relaxed">
                  {w}
                </p>
              ))}
            </div>
          )}

          <div className="rounded-lg border border-slate-700/60 bg-slate-800/30 p-3">
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
              Executive summary
            </h3>
            <p className="text-sm text-slate-200 leading-relaxed">{bodyToText(data.narrative.executiveSummary)}</p>
          </div>

          {data.narrative.sections.map((section) => (
            <div key={section.id} className="rounded-lg border border-slate-700/40 p-3">
              <h3 className="text-xs font-medium uppercase tracking-wider text-cyan-400/90 mb-2">
                {section.title}
              </h3>
              {renderBodyText(section.body)}
            </div>
          ))}

          {data.narrative.watchList.length > 0 && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
              <h3 className="text-xs font-medium uppercase tracking-wider text-amber-400/90 mb-2">
                Watch list
              </h3>
              <ul className="space-y-1.5">
                {data.narrative.watchList.map((w) => (
                  <li key={w.themeId} className="text-sm text-slate-300">
                    <span className="font-medium text-slate-100">{w.themeName}</span>
                    <span className="text-muted-foreground"> — {w.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t border-slate-700/40 pt-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={() => handleSavePdf(data)}
              disabled={exportingPdf}
            >
              <FileDown className="h-3.5 w-3.5" />
              {exportingPdf ? "Preparing…" : "Save as PDF"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={() => emailBriefingReport(data)}
            >
              <Mail className="h-3.5 w-3.5" />
              Email to friend
            </Button>
          </div>

          <p className="text-[10px] text-muted-foreground pt-2">
            {data.cached && data.cachedAt ? (
              <>
                Cached report from {new Date(data.cachedAt).toLocaleString()}
                {" · "}
                Original {new Date(data.generatedAt).toLocaleString()}
              </>
            ) : (
              <>Generated {new Date(data.generatedAt).toLocaleString()}</>
            )}
            {" · "}
            <button
              type="button"
              className="text-cyan-400/90 hover:text-cyan-300 underline-offset-2 hover:underline"
              onClick={handleRefresh}
              disabled={isBusy}
            >
              Refresh report
            </button>
          </p>
        </div>
      ) : null}
    </FloatingOverlayPanel>
  );
}
