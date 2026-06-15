import { createPortal } from "react-dom";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Center-screen enrich progress — keeps footer/info box height fixed while steps stream in.
 */
export function EnrichStatusOverlay({
  open,
  symbol,
  statusLog,
  active,
}: {
  open: boolean;
  symbol: string;
  statusLog: string[];
  active: boolean;
}) {
  if (!open || statusLog.length === 0 || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[250] flex items-center justify-center p-4 pointer-events-none"
      aria-live="polite"
      aria-busy={active}
      data-testid="enrich-status-overlay"
    >
      <div
        className="pointer-events-auto w-full max-w-md rounded-lg border border-cyan-500/35 bg-slate-950/95 shadow-2xl shadow-cyan-950/40 backdrop-blur-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-cyan-500/20 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-cyan-400/90">
            AI enrich — {symbol}
          </p>
        </div>
        <div className="max-h-[min(50vh,320px)] overflow-y-auto p-3 space-y-1.5">
          {statusLog.map((line, i) => {
            const isActive = active && i === statusLog.length - 1;
            const isError = line.startsWith("Failed —");
            const isComplete = line.startsWith("Complete —");
            return (
              <p
                key={`${i}-${line.slice(0, 32)}`}
                className={cn(
                  "text-xs leading-snug flex items-start gap-1.5",
                  isError
                    ? "text-destructive"
                    : isActive
                      ? "text-cyan-100"
                      : isComplete
                        ? "text-green-300/95"
                        : "text-slate-400"
                )}
              >
                {isActive ? (
                  <Loader2 className="h-3 w-3 shrink-0 mt-0.5 animate-spin text-cyan-400" />
                ) : isError ? (
                  <span className="shrink-0 mt-0.5 text-destructive">✕</span>
                ) : (
                  <Check className="h-3 w-3 shrink-0 mt-0.5 text-green-500/90" />
                )}
                <span>{line}</span>
              </p>
            );
          })}
        </div>
      </div>
    </div>,
    document.body
  );
}
