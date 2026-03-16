import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { TrendingUp, TrendingDown, Minus, AlertTriangle, RefreshCw, Zap, ArrowLeftRight, Flame, Snowflake, BookOpen, LayoutDashboard, Settings, Upload, Brain, Lightbulb, Sparkles, BarChart3, Layers, Star, Clock } from "lucide-react";
import { useState, useEffect } from "react";
import { WatchlistModal } from "./WatchlistModal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSystemSettings } from "@/context/SystemSettingsContext";
import rubricShieldLogo from "@/assets/images/rubricshield-logo.png";

function MarketTimeDisplay() {
  const [nyTime, setNyTime] = useState<Date | null>(null);
  const [offsetMs, setOffsetMs] = useState<number>(0);
  
  // Fetch actual NYC time from external API on mount
  useEffect(() => {
    const fetchNYCTime = async () => {
      try {
        // Try timeapi.io first
        const res = await fetch("https://timeapi.io/api/Time/current/zone?timeZone=America/New_York");
        const data = await res.json();
        // Returns { year, month, day, hour, minute, seconds, ... }
        const nyDate = new Date(data.year, data.month - 1, data.day, data.hour, data.minute, data.seconds);
        const localTime = new Date();
        setOffsetMs(nyDate.getTime() - localTime.getTime());
        setNyTime(nyDate);
      } catch {
        // Fallback: use system clock 
        setNyTime(new Date());
      }
    };
    fetchNYCTime();
    // Re-sync every 5 minutes
    const syncInterval = setInterval(fetchNYCTime, 5 * 60 * 1000);
    return () => clearInterval(syncInterval);
  }, []);
  
  // Update time every second using the calculated offset
  useEffect(() => {
    const interval = setInterval(() => {
      const correctedTime = new Date(Date.now() + offsetMs);
      setNyTime(correctedTime);
    }, 1000);
    return () => clearInterval(interval);
  }, [offsetMs]);
  
  if (!nyTime) {
    return (
      <div className="flex items-center gap-4 px-4 py-1.5 bg-slate-800/50 rounded-md border border-slate-700/50">
        <span className="text-sm text-slate-400">Loading...</span>
      </div>
    );
  }
  
  // Format as ET
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit", 
    second: "2-digit",
    hour12: true,
  });
  const currentTimeET = formatter.format(nyTime);
  
  // Get numeric hour/min for calculations
  const etParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(nyTime);
  
  const currentHour = parseInt(etParts.find(p => p.type === "hour")?.value || "0", 10);
  const currentMin = parseInt(etParts.find(p => p.type === "minute")?.value || "0", 10);
  const currentMinutesFromMidnight = currentHour * 60 + currentMin;
  
  const marketOpenMinutes = 9 * 60 + 30; // 9:30 AM
  const marketCloseMinutes = 16 * 60; // 4:00 PM
  
  const isMarketHours = currentMinutesFromMidnight >= marketOpenMinutes && currentMinutesFromMidnight < marketCloseMinutes;
  const dayOfWeek = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(nyTime);
  const isWeekday = !["Sat", "Sun"].includes(dayOfWeek);
  const isMarketOpen = isMarketHours && isWeekday;
  
  const openForMinutes = Math.max(0, currentMinutesFromMidnight - marketOpenMinutes);
  const openForHours = Math.floor(openForMinutes / 60);
  const openForMins = openForMinutes % 60;
  
  const closeInMinutes = Math.max(0, marketCloseMinutes - currentMinutesFromMidnight);
  const closeInHours = Math.floor(closeInMinutes / 60);
  const closeInMins = closeInMinutes % 60;
  
  const formatDuration = (h: number, m: number) => `${h}:${m.toString().padStart(2, "0")}`;
  
  return (
    <div className="flex items-center gap-4 px-4 py-1.5 bg-slate-800/50 rounded-md border border-slate-700/50">
      <div className="flex items-center gap-2">
        <Clock className="w-5 h-5 text-slate-400" />
        <span className="text-sm text-slate-400">NY:</span>
        <span className="text-sm font-medium text-white">{currentTimeET}</span>
      </div>
      {isMarketOpen ? (
        <>
          <div className="w-px h-5 bg-slate-600" />
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-400">Open:</span>
            <span className="text-sm font-medium text-green-400">{formatDuration(openForHours, openForMins)}</span>
          </div>
          <div className="w-px h-5 bg-slate-600" />
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-400">Close:</span>
            <span className="text-sm font-medium text-amber-400">{formatDuration(closeInHours, closeInMins)}</span>
          </div>
        </>
      ) : (
        <>
          <div className="w-px h-5 bg-slate-600" />
          <span className="text-sm text-slate-500">Market Closed</span>
        </>
      )}
    </div>
  );
}

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
  rightContent?: React.ReactNode;
}

export function SentinelHeader({ showSentiment = true, rightContent }: SentinelHeaderProps) {
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
  const isAdminPage = location.startsWith("/sentinel/admin");
  const isBigIdeaPage = location === "/sentinel/bigidea";
  const isMarketConditionPage = location === "/sentinel/market-condition";
  const isChartsPage = location === "/sentinel/charts";
  const isEvaluatePage = location === "/sentinel/evaluate";

  const [watchlistModalOpen, setWatchlistModalOpen] = useState(false);

  return (
    <>
    <WatchlistModal open={watchlistModalOpen} onOpenChange={setWatchlistModalOpen} />
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
          <Link href="/sentinel/market-condition">
            <Button 
              variant={isMarketConditionPage ? "secondary" : "ghost"} 
              size="sm"
              className="gap-2"
              data-testid="nav-market-condition"
            >
              <Layers className="w-4 h-4" />
              <span className="hidden sm:inline" style={{ fontSize: cssVariables.fontSizeSmall }}>Flow</span>
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
          <Button 
            variant="ghost" 
            size="sm"
            className="gap-2"
            onClick={() => setWatchlistModalOpen(true)}
            data-testid="nav-watchlists"
          >
            <Star className="w-4 h-4" />
            <span className="hidden sm:inline" style={{ fontSize: cssVariables.fontSizeSmall }}>Watchlists</span>
          </Button>
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
        
        <MarketTimeDisplay />
      </div>

      <div className="flex items-center gap-4">
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
      {rightContent}
      </div>
    </div>
    </>
  );
}

export default SentinelHeader;
