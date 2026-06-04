import { Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

export const WATCHLIST_PULLING_MESSAGE = "Pulling Tickers and Price";

/** Shown while watchlist symbols or quote rows are loading (bulk add, refresh, etc.). */
export function WatchlistPullingState({
  progressPct,
  className,
  compact = false,
}: {
  progressPct?: number | null;
  className?: string;
  compact?: boolean;
}) {
  const showBar = progressPct != null && Number.isFinite(progressPct);

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-4 text-center",
        compact ? "py-8" : "py-16",
        className
      )}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden />
      <p className="text-sm font-medium text-muted-foreground">{WATCHLIST_PULLING_MESSAGE}</p>
      {showBar ? (
        <Progress
          value={Math.min(100, Math.max(0, progressPct))}
          className="h-2 w-52 max-w-full"
          aria-label={`Loading progress ${Math.round(progressPct ?? 0)} percent`}
        />
      ) : null}
    </div>
  );
}
