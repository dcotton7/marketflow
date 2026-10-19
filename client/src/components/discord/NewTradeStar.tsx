import { Star } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Bright pulsing star shown while Nick / Ari trade calls are waiting to be looked at. Click = mark seen. */
export function NewTradeStar({
  count,
  onClick,
  className,
  side = "bottom",
}: {
  count: number;
  onClick?: () => void;
  className?: string;
  side?: "top" | "bottom" | "left" | "right";
}) {
  if (count <= 0) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClick?.();
          }}
          className={cn("relative inline-flex h-5 w-5 shrink-0 items-center justify-center", className)}
          aria-label={`${count} new trade call${count === 1 ? "" : "s"}`}
          data-testid="discord-new-trade-star"
        >
          <span className="absolute inset-0 animate-ping rounded-full bg-amber-400/40" />
          <Star className="relative h-4 w-4 animate-pulse fill-amber-300 text-amber-200 drop-shadow-[0_0_6px_rgba(252,211,77,0.9)]" />
          {count > 1 && (
            <span className="absolute -right-1.5 -top-1.5 rounded-full bg-amber-400 px-1 text-[9px] font-bold leading-[14px] text-slate-950">
              {count}
            </span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side={side}>
        {count} new trade call{count === 1 ? "" : "s"} from Nick / Ari you have not looked at. Click to mark seen.
      </TooltipContent>
    </Tooltip>
  );
}
