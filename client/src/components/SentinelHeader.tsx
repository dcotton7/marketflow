import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { TrendingUp, TrendingDown, Minus, AlertTriangle, RefreshCw, Zap, ArrowLeftRight, Flame, Snowflake, BookOpen, LayoutDashboard, Settings, Upload, Brain, Crosshair, Lightbulb, Sparkles, BarChart3 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSystemSettings } from "@/context/SystemSettingsContext";
import rubricShieldLogo from "@/assets/images/rubricshield-logo.png";

interface MarketSentiment {
  weekly: {
    state: 1 | 0.5 | -0.5 | -1;
    stateName: "Tailwind" | "Falling Tailwind" | "Slack" | "Headwind";
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
  if (state === "TRENDING") return "bg-rs-green/20 text-rs-green border-rs-green/30";
  if (state === "CHOPPY") return "bg-rs-amber/20 text-rs-amber border-rs-amber/30";
  return "bg-rs-yellow/20 text-rs-yellow border-rs-yellow/30";
}

function TrendIcon({ state }: { state: 1 | 0.5 | -0.5 | -1 | "RISK-ON" | "MIXED" | "RISK-OFF" }) {
  if (state === 1 || state === 0.5 || state === "RISK-ON") {
    return <TrendingUp className="h-3 w-3" />;
  }
  if (state === -1 || state === -0.5 || state === "RISK-OFF") {
    return <TrendingDown className="h-3 w-3" />;
  }
  return <Minus className="h-3 w-3" />;
}

function getTrendColor(state: 1 | 0.5 | -0.5 | -1 | "RISK-ON" | "MIXED" | "RISK-OFF"): string {
  if (state === 1 || state === "RISK-ON") {
    return "bg-rs-green/20 text-rs-green border-rs-green/30";
  }
  if (state === 0.5) {
    return "bg-rs-green/10 text-rs-green/80 border-rs-green/20";
  }
  if (state === -0.5) {
    return "bg-rs-yellow/20 text-rs-yellow border-rs-yellow/30";
  }
  if (state === -1 || state === "RISK-OFF") {
    return "bg-rs-red/20 text-rs-red border-rs-red/30";
  }
  return "bg-rs-yellow/20 text-rs-yellow border-rs-yellow/30";
}

interface SentinelHeaderProps {
  showSentiment?: boolean;
}

export function SentinelHeader({ showSentiment = true }: SentinelHeaderProps) {
  const [location] = useLocation();
  const { cssVariables } = useSystemSettings();
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
  const isTrainingPage = location === "/sentinel/pattern-training";
  const isAdminPage = location.startsWith("/sentinel/admin");
  const isBigIdeaPage = location === "/sentinel/bigidea";
  const isChartsPage = location === "/sentinel/charts";
  const isEvaluatePage = location === "/sentinel/evaluate";

  return (
    <div
      className="flex items-center justify-between gap-4 flex-wrap border-b px-4 py-3"
      style={{ backgroundColor: cssVariables.headerBg }}
    >
      <div className="flex items-center gap-4">
        <Link href="/sentinel">
          <div className="flex items-center gap-2 cursor-pointer hover-elevate rounded-md p-1" data-testid="link-sentinel-home">
            <img 
              src={rubricShieldLogo} 
              alt="RubricShield" 
              className="h-10"
              style={{ opacity: cssVariables.logoOpacity }}
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
              <span className="hidden sm:inline" style={{ fontSize: cssVariables.fontSizeSmall }}>Dashboard</span>
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
              <span className="hidden sm:inline" style={{ fontSize: cssVariables.fontSizeSmall }}>Rubric</span>
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
              <span className="hidden sm:inline" style={{ fontSize: cssVariables.fontSizeSmall }}>Import</span>
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
              <span className="hidden sm:inline" style={{ fontSize: cssVariables.fontSizeSmall }}>Patterns</span>
            </Button>
          </Link>
          <Link href="/sentinel/pattern-training">
            <Button 
              variant={isTrainingPage ? "secondary" : "ghost"} 
              size="sm"
              className="gap-2"
              data-testid="nav-training"
            >
              <Crosshair className="w-4 h-4" />
              <span className="hidden sm:inline" style={{ fontSize: cssVariables.fontSizeSmall }}>Training</span>
            </Button>
          </Link>
          <Link href="/sentinel/bigidea">
            <Button 
              variant={isBigIdeaPage ? "secondary" : "ghost"} 
              size="sm"
              className="gap-2"
              data-testid="nav-bigidea"
            >
              <Lightbulb className="w-4 h-4" />
              <span className="hidden sm:inline" style={{ fontSize: cssVariables.fontSizeSmall }}>Big Idea</span>
            </Button>
          </Link>
          <Link href="/sentinel/charts">
            <Button 
              variant={isChartsPage ? "secondary" : "ghost"} 
              size="sm"
              className="gap-2"
              data-testid="nav-charts"
            >
              <BarChart3 className="w-4 h-4" />
              <span className="hidden sm:inline" style={{ fontSize: cssVariables.fontSizeSmall }}>Charts</span>
            </Button>
          </Link>
          <Link href="/sentinel/evaluate">
            <Button 
              variant={isEvaluatePage ? "secondary" : "ghost"} 
              size="sm"
              className="gap-2"
              data-testid="nav-evaluate"
            >
              <Sparkles className="w-4 h-4" />
              <span className="hidden sm:inline" style={{ fontSize: cssVariables.fontSizeSmall }}>Ivy AI</span>
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
                <span className="hidden sm:inline" style={{ fontSize: cssVariables.fontSizeSmall }}>Admin</span>
              </Button>
            </Link>
          )}
        </nav>
      </div>

      {showSentiment && (
        <div className="flex items-center gap-4" data-testid="container-market-sentiment">
          {isLoading ? (
            <div className="flex items-center gap-2" style={{ color: cssVariables.textColorSmall, fontSize: cssVariables.fontSizeSmall }}>
              <RefreshCw className="h-4 w-4 animate-spin" />
              <span>Loading sentiment...</span>
            </div>
          ) : sentiment ? (
            <>
              <div className="flex items-center gap-2">
                <Flame className="h-5 w-5 text-rs-amber" />
                <span className="font-semibold" style={{ color: cssVariables.textColorHeader, fontSize: cssVariables.fontSizeHeader }}>Market Sentiment</span>
                <Snowflake className="h-5 w-5 text-blue-400" />
              </div>

              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-2">
                    <span className="font-medium" style={{ color: cssVariables.textColorSmall, fontSize: cssVariables.fontSizeSmall }}>MM Mid-Term Trend:</span>
                    <Badge 
                      variant="outline" 
                      className={`px-3 py-1 ${getTrendColor(sentiment.weekly.state)}`}
                      data-testid="badge-weekly-trend"
                      style={{ fontSize: cssVariables.fontSizeSmall }}
                    >
                      <TrendIcon state={sentiment.weekly.state} />
                      <span className="ml-1">{sentiment.weekly.stateName}</span>
                    </Badge>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p style={{ fontSize: cssVariables.fontSizeNormal }}>SPY price vs 21-day EMA with slope direction</p>
                  <p style={{ color: cssVariables.textColorTiny, fontSize: cssVariables.fontSizeTiny }}>Confidence: {sentiment.weekly.confidence}</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-2">
                    <span className="font-medium" style={{ color: cssVariables.textColorSmall, fontSize: cssVariables.fontSizeSmall }}>Daily:</span>
                    <Badge 
                      variant="outline" 
                      className={`px-3 py-1 ${getTrendColor(sentiment.daily.state)}`}
                      data-testid="badge-daily-basket"
                      style={{ fontSize: cssVariables.fontSizeSmall }}
                    >
                      <TrendIcon state={sentiment.daily.state} />
                      <span className="ml-1">{sentiment.daily.state}</span>
                    </Badge>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p style={{ fontSize: cssVariables.fontSizeNormal }}>Risk Basket: QQQ, IWO, SLY, ARKK, VIX</p>
                  <p style={{ color: cssVariables.textColorTiny, fontSize: cssVariables.fontSizeTiny }}>Confidence: {sentiment.daily.confidence}</p>
                  {sentiment.daily.canaryTags.length > 0 && (
                    <div className="mt-1 flex items-center gap-1 text-rs-yellow" style={{ fontSize: cssVariables.fontSizeTiny }}>
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
                      <span className="font-medium" style={{ color: cssVariables.textColorSmall, fontSize: cssVariables.fontSizeSmall }}>Chop:</span>
                      <Badge 
                        variant="outline" 
                        className={`px-3 py-1 ${getChopColor(sentiment.choppiness.weekly.state)}`}
                        data-testid="badge-choppiness"
                        style={{ fontSize: cssVariables.fontSizeSmall }}
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
                    <p className="font-medium" style={{ fontSize: cssVariables.fontSizeNormal }}>Choppiness Index (SPY)</p>
                    <div className="mt-1 space-y-1">
                      <p style={{ fontSize: cssVariables.fontSizeTiny }}>Daily: {sentiment.choppiness.daily.state} ({sentiment.choppiness.daily.value})</p>
                      <p style={{ fontSize: cssVariables.fontSizeTiny }}>Weekly: {sentiment.choppiness.weekly.state} ({sentiment.choppiness.weekly.value})</p>
                    </div>
                    <p className="mt-2" style={{ color: cssVariables.textColorTiny, fontSize: cssVariables.fontSizeTiny }}>{sentiment.choppiness.recommendation}</p>
                  </TooltipContent>
                </Tooltip>
              )}

              <span style={{ color: cssVariables.textColorTiny, fontSize: cssVariables.fontSizeTiny }} data-testid="text-sentiment-age">
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
