import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { CHART_VIEWER_DIALOG_Z } from "@/lib/overlay-z-index";
import type { ChartLoadStep } from "@/hooks/useChartLoadStatus";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Circle, Loader2, X, XCircle } from "lucide-react";

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function StepIcon({ status }: { status: ChartLoadStep["status"] }) {
  if (status === "done") return <CheckCircle2 className="h-4 w-4 shrink-0 text-green-400" />;
  if (status === "active") return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-cyan-400" />;
  if (status === "error") return <XCircle className="h-4 w-4 shrink-0 text-red-400" />;
  return <Circle className="h-4 w-4 shrink-0 text-muted-foreground/50" />;
}

interface ChartLoadStatusDialogProps {
  open: boolean;
  symbol: string;
  steps: ChartLoadStep[];
  activeStep?: ChartLoadStep;
  elapsedMs: number;
  isComplete: boolean;
  title?: string;
  onDismiss?: () => void;
  /** @deprecated Always dismissible when onDismiss is set — kept for call-site compat. */
  showContinue?: boolean;
  /** @deprecated Always dismissible when onDismiss is set — kept for call-site compat. */
  allowDismiss?: boolean;
}

/**
 * Chart load progress as a corner card — no Dialog, no backdrop, no focus trap.
 * Charts and Discovery Scanner stay fully interactive underneath.
 */
export function ChartLoadStatusDialog({
  open,
  symbol,
  steps,
  activeStep,
  elapsedMs,
  isComplete,
  title,
  onDismiss,
}: ChartLoadStatusDialogProps) {
  if (!open || typeof document === "undefined") return null;

  const heading =
    title ??
    (isComplete ? `${symbol} charts ready` : `Loading ${symbol} charts`);

  const hasError = steps.some((s) => s.status === "error");
  const canDismiss = !!onDismiss;

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      aria-label={heading}
      className={cn(
        "pointer-events-auto fixed right-4 top-16 w-[min(100vw-2rem,22rem)] rounded-lg border border-border bg-background/95 p-4 shadow-2xl backdrop-blur-sm",
        CHART_VIEWER_DIALOG_Z
      )}
      data-testid="chart-load-status-card"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0 text-left">
          <p className="text-sm font-semibold leading-snug">{heading}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {isComplete
              ? `Finished in ${formatElapsed(elapsedMs)}`
              : activeStep
                ? `Now: ${activeStep.label}`
                : "Preparing chart workspace…"}
            {!isComplete ? (
              <span className="ml-1.5 tabular-nums">({formatElapsed(elapsedMs)})</span>
            ) : null}
          </p>
          {hasError ? (
            <p className="mt-1 text-xs text-rs-red">
              Chart data failed. Dismiss and keep using the app — retry if bars keep failing.
            </p>
          ) : !isComplete ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Charts and Signals stay usable — dismiss anytime.
            </p>
          ) : null}
        </div>
        {canDismiss ? (
          <button
            type="button"
            className="rounded-sm p-1 opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring"
            onClick={onDismiss}
            aria-label="Dismiss chart load status"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      <ul className="max-h-[min(40vh,280px)] space-y-1 overflow-y-auto pr-1 text-left">
        {steps.map((step) => (
          <li
            key={step.id}
            className={cn(
              "flex items-start gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
              step.status === "active" && "bg-cyan-500/10",
              step.status === "done" && "text-muted-foreground",
              step.status === "error" && "bg-red-500/10"
            )}
          >
            <StepIcon status={step.status} />
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  "leading-snug",
                  step.status === "active" ? "font-medium text-foreground" : "text-foreground/90"
                )}
              >
                {step.label}
              </p>
              {step.detail ? (
                <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{step.detail}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      {canDismiss && !isComplete ? (
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" size="sm" variant="secondary" onClick={onDismiss}>
            {hasError ? "Dismiss" : "Continue to charts"}
          </Button>
        </div>
      ) : null}
    </div>,
    document.body
  );
}
