import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  BREAKDOWN_WATCH_TIER_LABELS,
  breakdownWatchTierClass,
  type BreakdownWatchAssessment,
  type BreakdownWatchTier,
} from "@shared/theme-breakdown-watch";
import { cn } from "@/lib/utils";
import { AlertTriangle } from "lucide-react";

export function BreakdownWatchBadge({
  assessment,
  className,
  size = "sm",
}: {
  assessment: BreakdownWatchAssessment | null | undefined;
  className?: string;
  size?: "sm" | "md";
}) {
  if (!assessment || assessment.tier === "none") return null;

  const label = BREAKDOWN_WATCH_TIER_LABELS[assessment.tier as BreakdownWatchTier];
  const tierClass = breakdownWatchTierClass(assessment.tier);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={cn(
            "gap-1 font-medium",
            size === "sm" ? "h-5 px-1.5 text-[9px]" : "h-6 px-2 text-xs",
            tierClass,
            className
          )}
        >
          <AlertTriangle className={size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3"} />
          {label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs">
        <p className="font-semibold">
          {label} · score {assessment.score}
        </p>
        {assessment.reasons.length > 0 ? (
          <ul className="mt-1 list-inside list-disc text-muted-foreground">
            {assessment.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-muted-foreground">Structural weakness in theme members.</p>
        )}
        <p className="mt-1.5 text-[10px] text-muted-foreground">
          Radar only — not an automatic short signal. Confirm on the ETF chart.
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

export function BreakdownWatchPanel({
  assessment,
  etfAugmented,
}: {
  assessment: BreakdownWatchAssessment | null | undefined;
  /** When Live Theme Charts merges ETF flags client-side. */
  etfAugmented?: boolean;
}) {
  if (!assessment || assessment.tier === "none") {
    return (
      <div className="rounded border border-slate-700/40 bg-slate-900/50 px-3 py-2 text-xs text-muted-foreground">
        No breakdown watch — member structure still mostly intact.
      </div>
    );
  }

  const label = BREAKDOWN_WATCH_TIER_LABELS[assessment.tier];

  return (
    <div className="rounded border border-orange-500/30 bg-orange-500/10 px-3 py-2 space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <BreakdownWatchBadge assessment={assessment} size="md" />
        <span className="text-xs text-muted-foreground">Score {assessment.score}/100</span>
        {etfAugmented ? (
          <span className="text-[10px] text-cyan-300">+ ETF chart flags</span>
        ) : null}
      </div>
      <p className="text-xs text-slate-200">
        {label}: breadth, trend, and RS suggest this theme is losing structural support.
        {assessment.tier === "avoid_long" ? " Favor avoidance over new long exposure." : ""}
      </p>
      {assessment.reasons.length > 0 ? (
        <p className="font-mono text-[10px] text-slate-400">{assessment.reasons.join(" · ")}</p>
      ) : null}
    </div>
  );
}
