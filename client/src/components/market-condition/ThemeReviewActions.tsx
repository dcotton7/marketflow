import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const IVY_ICON_CLASS = "h-6 w-6 shrink-0";

interface ThemeReviewActionsProps {
  onThemeReview: () => void;
  onTickerReview: () => void;
  disabled?: boolean;
}

export function ThemeReviewActions({
  onThemeReview,
  onTickerReview,
  disabled,
}: ThemeReviewActionsProps) {
  return (
    <div className="ml-1 flex items-center gap-0.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            className={cn(
              "h-[42px] gap-2 px-3 text-amber-400/95 hover:bg-amber-500/10 hover:text-amber-300"
            )}
            onClick={(e) => {
              e.stopPropagation();
              onThemeReview();
            }}
            data-testid="button-theme-review"
          >
            <Sparkles className={IVY_ICON_CLASS} style={{ color: "#fbbf24" }} />
            <span className="text-[16.5px] font-medium leading-none">Theme Review</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Open Brief / Close Brief (Ivy)</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            className={cn(
              "h-[42px] gap-2 px-3 text-green-400/95 hover:bg-green-500/10 hover:text-green-300"
            )}
            onClick={(e) => {
              e.stopPropagation();
              onTickerReview();
            }}
            data-testid="button-ticker-review"
          >
            <Sparkles className={IVY_ICON_CLASS} style={{ color: "#86efac" }} />
            <span className="text-[16.5px] font-medium leading-none">Ticker Review</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Scan theme members — criteria badges + watch list</TooltipContent>
      </Tooltip>
    </div>
  );
}
