import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { TrendingUp, TrendingDown, Minus, AlertTriangle, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import sentinelLogo from "@/assets/images/sentinel-logo.png";

interface MarketSentiment {
  weekly: {
    state: 1 | 0 | -1;
    stateName: "Tailwind" | "Neutral" | "Headwind";
    confidence: "strong" | "moderate" | "weak";
  };
  daily: {
    state: "RISK-ON" | "MIXED" | "RISK-OFF";
    confidence: "high" | "medium" | "low";
    canaryTags: string[];
  };
  summary: string;
  updatedAt: string;
  cacheAgeMinutes: number;
}

function TrendIcon({ state }: { state: 1 | 0 | -1 | "RISK-ON" | "MIXED" | "RISK-OFF" }) {
  if (state === 1 || state === "RISK-ON") {
    return <TrendingUp className="h-3 w-3" />;
  }
  if (state === -1 || state === "RISK-OFF") {
    return <TrendingDown className="h-3 w-3" />;
  }
  return <Minus className="h-3 w-3" />;
}

function getTrendColor(state: 1 | 0 | -1 | "RISK-ON" | "MIXED" | "RISK-OFF"): string {
  if (state === 1 || state === "RISK-ON") {
    return "bg-green-500/20 text-green-400 border-green-500/30";
  }
  if (state === -1 || state === "RISK-OFF") {
    return "bg-red-500/20 text-red-400 border-red-500/30";
  }
  return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
}

interface SentinelHeaderProps {
  showSentiment?: boolean;
}

export function SentinelHeader({ showSentiment = true }: SentinelHeaderProps) {
  const { data: sentiment, isLoading } = useQuery<MarketSentiment>({
    queryKey: ["/api/sentinel/sentiment/market"],
    enabled: showSentiment,
    refetchInterval: 30 * 60 * 1000,
    staleTime: 30 * 60 * 1000,
  });

  return (
    <div className="flex items-center justify-between gap-4 flex-wrap">
      <Link href="/sentinel">
        <div className="flex items-center gap-2 cursor-pointer hover-elevate rounded-md p-1" data-testid="link-sentinel-home">
          <img 
            src={sentinelLogo} 
            alt="Sentinel" 
            className="h-8"
            data-testid="img-sentinel-header-logo"
          />
        </div>
      </Link>

      {showSentiment && (
        <div className="flex items-center gap-3" data-testid="container-market-sentiment">
          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-xs">
              <RefreshCw className="h-3 w-3 animate-spin" />
              <span>Loading sentiment...</span>
            </div>
          ) : sentiment ? (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Weekly:</span>
                    <Badge 
                      variant="outline" 
                      className={`text-xs ${getTrendColor(sentiment.weekly.state)}`}
                      data-testid="badge-weekly-trend"
                    >
                      <TrendIcon state={sentiment.weekly.state} />
                      <span className="ml-1">{sentiment.weekly.stateName}</span>
                    </Badge>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-sm">SPY 40-week structure</p>
                  <p className="text-xs text-muted-foreground">Confidence: {sentiment.weekly.confidence}</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Daily:</span>
                    <Badge 
                      variant="outline" 
                      className={`text-xs ${getTrendColor(sentiment.daily.state)}`}
                      data-testid="badge-daily-basket"
                    >
                      <TrendIcon state={sentiment.daily.state} />
                      <span className="ml-1">{sentiment.daily.state}</span>
                    </Badge>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-sm">Risk Basket: QQQ, IWO, SLY, ARKK, VIX</p>
                  <p className="text-xs text-muted-foreground">Confidence: {sentiment.daily.confidence}</p>
                  {sentiment.daily.canaryTags.length > 0 && (
                    <div className="mt-1 flex items-center gap-1 text-yellow-400 text-xs">
                      <AlertTriangle className="h-3 w-3" />
                      <span>{sentiment.daily.canaryTags.join(", ")}</span>
                    </div>
                  )}
                </TooltipContent>
              </Tooltip>

              <span className="text-[10px] text-muted-foreground" data-testid="text-sentiment-age">
                Updated {sentiment.cacheAgeMinutes < 1 ? "just now" : `${sentiment.cacheAgeMinutes}m ago`}
              </span>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default SentinelHeader;
