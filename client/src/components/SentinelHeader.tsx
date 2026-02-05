import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { TrendingUp, TrendingDown, Minus, AlertTriangle, RefreshCw, Zap, ArrowLeftRight, Flame, Snowflake, BookOpen, LayoutDashboard, Settings, Upload, Brain } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import rubricShieldLogo from "@/assets/images/rubricshield-logo.png";

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
  choppiness?: {
    daily: { value: number; state: "CHOPPY" | "MIXED" | "TRENDING" };
    weekly: { value: number; state: "CHOPPY" | "MIXED" | "TRENDING" };
    recommendation: string;
  };
  summary: string;
  updatedAt: string;
  cacheAgeMinutes: number;
}

function getChopColor(state: "CHOPPY" | "MIXED" | "TRENDING"): string {
  if (state === "TRENDING") return "bg-green-500/20 text-green-400 border-green-500/30";
  if (state === "CHOPPY") return "bg-orange-500/20 text-orange-400 border-orange-500/30";
  return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
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
  const [location] = useLocation();
  const { data: sentiment, isLoading } = useQuery<MarketSentiment>({
    queryKey: ["/api/sentinel/sentiment/market"],
    enabled: showSentiment,
    refetchInterval: 30 * 60 * 1000,
    staleTime: 30 * 60 * 1000,
  });

  const { data: userInfo } = useQuery<{ id: number; username: string; isAdmin: boolean }>({
    queryKey: ["/api/sentinel/me"],
  });

  const isRulesPage = location === "/sentinel/rules";
  const isDashboardPage = location === "/sentinel" || location === "/sentinel/dashboard";
  const isImportPage = location === "/sentinel/import";
  const isPatternsPage = location === "/sentinel/patterns";
  const isAdminPage = location.startsWith("/sentinel/admin");

  return (
    <div className="flex items-center justify-between gap-4 flex-wrap border-b px-4 py-3 bg-card">
      <div className="flex items-center gap-4">
        <Link href="/sentinel">
          <div className="flex items-center gap-2 cursor-pointer hover-elevate rounded-md p-1" data-testid="link-sentinel-home">
            <img 
              src={rubricShieldLogo} 
              alt="RubricShield" 
              className="h-10"
              data-testid="img-sentinel-header-logo"
            />
          </div>
        </Link>
        
        <nav className="flex items-center gap-1">
          <Link href="/sentinel/dashboard">
            <Button 
              variant={isDashboardPage ? "secondary" : "ghost"} 
              size="sm"
              className="gap-2"
              data-testid="nav-dashboard"
            >
              <LayoutDashboard className="w-4 h-4" />
              <span className="hidden sm:inline">Dashboard</span>
            </Button>
          </Link>
          <Link href="/sentinel/rules">
            <Button 
              variant={isRulesPage ? "secondary" : "ghost"} 
              size="sm"
              className="gap-2"
              data-testid="nav-rules"
            >
              <BookOpen className="w-4 h-4" />
              <span className="hidden sm:inline">Rubric</span>
            </Button>
          </Link>
          <Link href="/sentinel/import">
            <Button 
              variant={isImportPage ? "secondary" : "ghost"} 
              size="sm"
              className="gap-2"
              data-testid="nav-import"
            >
              <Upload className="w-4 h-4" />
              <span className="hidden sm:inline">Import</span>
            </Button>
          </Link>
          <Link href="/sentinel/patterns">
            <Button 
              variant={isPatternsPage ? "secondary" : "ghost"} 
              size="sm"
              className="gap-2"
              data-testid="nav-patterns"
            >
              <Brain className="w-4 h-4" />
              <span className="hidden sm:inline">Patterns</span>
            </Button>
          </Link>
          {userInfo?.isAdmin && (
            <Link href="/sentinel/admin">
              <Button 
                variant={isAdminPage ? "secondary" : "ghost"} 
                size="sm"
                className="gap-2"
                data-testid="nav-admin"
              >
                <Settings className="w-4 h-4" />
                <span className="hidden sm:inline">Admin</span>
              </Button>
            </Link>
          )}
        </nav>
      </div>

      {showSentiment && (
        <div className="flex items-center gap-4" data-testid="container-market-sentiment">
          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <RefreshCw className="h-4 w-4 animate-spin" />
              <span>Loading sentiment...</span>
            </div>
          ) : sentiment ? (
            <>
              {/* Market Sentiment Header with Fire/Ice icons */}
              <div className="flex items-center gap-2">
                <Flame className="h-5 w-5 text-orange-500" />
                <span className="text-lg font-semibold">Market Sentiment</span>
                <Snowflake className="h-5 w-5 text-blue-400" />
              </div>

              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-muted-foreground">Weekly:</span>
                    <Badge 
                      variant="outline" 
                      className={`text-sm px-3 py-1 ${getTrendColor(sentiment.weekly.state)}`}
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
                    <span className="text-sm font-medium text-muted-foreground">Daily:</span>
                    <Badge 
                      variant="outline" 
                      className={`text-sm px-3 py-1 ${getTrendColor(sentiment.daily.state)}`}
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

              {sentiment.choppiness && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-muted-foreground">Chop:</span>
                      <Badge 
                        variant="outline" 
                        className={`text-sm px-3 py-1 ${getChopColor(sentiment.choppiness.weekly.state)}`}
                        data-testid="badge-choppiness"
                      >
                        {sentiment.choppiness.weekly.state === "CHOPPY" ? (
                          <Zap className="h-4 w-4" />
                        ) : sentiment.choppiness.weekly.state === "TRENDING" ? (
                          <TrendingUp className="h-4 w-4" />
                        ) : (
                          <ArrowLeftRight className="h-4 w-4" />
                        )}
                        <span className="ml-1">{sentiment.choppiness.weekly.state}</span>
                      </Badge>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p className="text-sm font-medium">Choppiness Index (SPY)</p>
                    <div className="mt-1 space-y-1">
                      <p className="text-xs">Daily: {sentiment.choppiness.daily.state} ({sentiment.choppiness.daily.value})</p>
                      <p className="text-xs">Weekly: {sentiment.choppiness.weekly.state} ({sentiment.choppiness.weekly.value})</p>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">{sentiment.choppiness.recommendation}</p>
                  </TooltipContent>
                </Tooltip>
              )}

              <span className="text-xs text-muted-foreground" data-testid="text-sentiment-age">
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
