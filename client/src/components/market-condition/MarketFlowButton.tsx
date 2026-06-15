// Market Flow Button Component - Consistent branding/navigation button
import { Button } from "@/components/ui/button";
import { Waves, ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";

interface MarketFlowButtonProps {
  /** Show as branding badge (no hover/click) or as navigation button */
  variant?: "branding" | "navigation";
  /** Optional custom className */
  className?: string;
  /** Optional data-testid for testing */
  "data-testid"?: string;
}

/**
 * Consistent Market Flow button/badge used across the app
 * - In Market Flow page header: shows as branding badge
 * - In other pages: shows as navigation button to return to Market Flow
 */
export function MarketFlowButton({ variant = "navigation", className, "data-testid": dataTestId }: MarketFlowButtonProps) {
  const [, navigate] = useLocation();

  if (variant === "branding") {
    return (
      <div
        className={cn(
          "flex items-center gap-2.5 px-3 py-1.5 rounded-lg border border-admin-market-flow bg-admin-market-flow/10",
          className
        )}
        data-testid={dataTestId}
      >
        <Waves className="w-5 h-5 text-admin-market-flow" />
        <span className="text-sm font-bold text-admin-market-flow">Market Flow</span>
      </div>
    );
  }

  return (
    <Button
      size="sm"
      variant="outline"
      className={cn(
        "gap-2 bg-admin-market-flow/10 text-admin-market-flow border-admin-market-flow/50 hover:bg-admin-market-flow/20 hover:text-admin-market-flow",
        className
      )}
      onClick={() => navigate("/sentinel/market-condition")}
      data-testid={dataTestId}
    >
      <ArrowLeft className="h-4 w-4" />
      <Waves className="h-4 w-4" />
      <span className="font-semibold">Market Flow</span>
    </Button>
  );
}
