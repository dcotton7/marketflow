import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { CHART_VIEWER_DIALOG_Z } from "@/lib/overlay-z-index";
import type { ChartLoadStep } from "@/hooks/useChartLoadStatus";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";

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
 * Chart load progress — non-modal so Signals / charts behind stay clickable.
 * Escape, X, and Dismiss always work when onDismiss is provided.
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
  const heading =
    title ??
    (isComplete ? `${symbol} charts ready` : `Loading ${symbol} charts`);

  const hasError = steps.some((s) => s.status === "error");
  const canDismiss = !!onDismiss;

  return (
    <Dialog
      open={open}
      modal={false}
      onOpenChange={(next) => {
        if (!next && canDismiss) onDismiss?.();
      }}
    >
      <DialogContent
        className={cn("max-w-md pointer-events-auto", CHART_VIEWER_DIALOG_Z)}
        // Fade for context only — never capture clicks (that was locking Signals/UI).
        overlayClassName={cn(CHART_VIEWER_DIALOG_Z, "pointer-events-none bg-black/35")}
        onInteractOutside={(e) => {
          // Non-modal: outside interaction must reach charts/Signals — don't treat as dismiss.
          e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (canDismiss) onDismiss?.();
          else e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-left">{heading}</DialogTitle>
          <DialogDescription className="text-left">
            {isComplete
              ? `Finished in ${formatElapsed(elapsedMs)}`
              : activeStep
                ? `Now: ${activeStep.label}`
                : "Preparing chart workspace…"}
            {!isComplete ? (
              <span className="ml-2 tabular-nums text-muted-foreground">({formatElapsed(elapsedMs)})</span>
            ) : null}
            {hasError ? (
              <span className="mt-1 block text-rs-red">
                Chart data failed to load. Dismiss this dialog to keep using the app — try logging in again if bars keep failing.
              </span>
            ) : !isComplete ? (
              <span className="mt-1 block text-muted-foreground">
                Charts and Signals stay usable — dismiss anytime.
              </span>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <ul className="max-h-[min(52vh,360px)] space-y-1 overflow-y-auto pr-1 text-left">
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
                  <p className="text-xs text-muted-foreground leading-snug mt-0.5">{step.detail}</p>
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
      </DialogContent>
    </Dialog>
  );
}
