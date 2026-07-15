import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { SetupQualityResult } from "@/lib/setup-quality-score";

const GRADIENT =
  "linear-gradient(90deg, #ef4444 0%, #f97316 18%, #eab308 35%, #f8fafc 50%, #a3e635 65%, #84cc16 82%, #22c55e 100%)";

function scoreToPct(score: number): number {
  // −100 → 0%, 0 → 50%, +100 → 100%
  return ((score + 100) / 200) * 100;
}

function labelClass(label: SetupQualityResult["label"]): string {
  if (label === "Long") return "text-rs-green";
  if (label === "Short") return "text-rs-red";
  return "text-muted-foreground";
}

export function SetupQualityBar({
  result,
  className,
  testId,
}: {
  result: SetupQualityResult;
  className?: string;
  testId?: string;
}) {
  const pct = scoreToPct(result.score);
  const signed =
    result.score > 0 ? `+${result.score}` : `${result.score}`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn("flex min-w-0 items-center gap-2", className)}
          data-testid={testId}
          role="meter"
          aria-valuemin={-100}
          aria-valuemax={100}
          aria-valuenow={result.score}
          aria-label={`Setup quality ${signed} ${result.label}`}
        >
          <div className="relative h-2.5 w-[160px] shrink-0 overflow-visible rounded-full sm:w-[200px]">
            <div
              className="absolute inset-0 rounded-full ring-1 ring-border/60"
              style={{ background: GRADIENT }}
            />
            {/* Center tick */}
            <div
              className="absolute top-0 bottom-0 w-px bg-black/40"
              style={{ left: "50%" }}
              aria-hidden
            />
            {/* Needle */}
            <div
              className="absolute top-1/2 z-10 -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${pct}%` }}
            >
              <div className="h-3.5 w-3.5 rounded-full border-2 border-white bg-slate-900 shadow-md shadow-black/50" />
            </div>
          </div>
          <span
            className={cn(
              "shrink-0 text-[0.95em] font-semibold tabular-nums leading-none",
              labelClass(result.label)
            )}
          >
            {signed} {result.label}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs space-y-1 p-2.5 text-xs">
        <p className="mb-1 font-semibold text-foreground">
          Setup quality · {signed} {result.label}
        </p>
        {result.factors.length === 0 ? (
          <p className="text-muted-foreground">Insufficient metrics</p>
        ) : (
          <ul className="space-y-0.5">
            {result.factors.map((f) => (
              <li key={f.id} className="flex justify-between gap-3">
                <span className="text-muted-foreground">{f.detail}</span>
                <span
                  className={cn(
                    "tabular-nums font-medium",
                    f.points > 0
                      ? "text-rs-green"
                      : f.points < 0
                        ? "text-rs-red"
                        : "text-muted-foreground"
                  )}
                >
                  {f.points > 0 ? `+${f.points}` : f.points}
                </span>
              </li>
            ))}
          </ul>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
