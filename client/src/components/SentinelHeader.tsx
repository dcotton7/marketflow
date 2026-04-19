import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { TrendingUp, TrendingDown, Minus, AlertTriangle, RefreshCw, Zap, ArrowLeftRight, Flame, Snowflake, BookOpen, LayoutDashboard, Settings, Upload, Brain, Lightbulb, Sparkles, BarChart3, Layers, Star, Clock, Bell, House, LogOut, UserRound } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { WatchlistModal } from "./WatchlistModal";
import { AlertCenterDialog } from "@/components/alerts/AlertCenterDialog";
import { useAlerts, useAlertEvents, type AlertDeliveryConfigRecord } from "@/hooks/use-alerts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSystemSettings } from "@/context/SystemSettingsContext";
import { playAlertChime } from "@/lib/alert-sound";
import { SENTINEL_OPEN_WATCHLIST_MANAGER_EVENT } from "@/lib/sentinel-ui-events";
import { useSentinelAuth } from "@/context/SentinelAuthContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function MarketTimeDisplay() {
  // offsetMs corrects local clock drift using authoritative NYC time from API
  const [offsetMs, setOffsetMs] = useState<number>(0);
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const syncNYCTime = async () => {
      try {
        // Fetch UTC time — no DST ambiguity, Intl handles NY conversion
        const res = await fetch("https://timeapi.io/api/Time/current/zone?timeZone=UTC");
        const data = await res.json();
        // dateTime is UTC e.g. "2026-03-17T16:37:00" — append Z to parse as UTC
        const utcDate = new Date(`${data.dateTime}Z`);
        setOffsetMs(utcDate.getTime() - Date.now()); // correct local clock drift
      } catch {
        // If API fails keep existing offset (or 0 = local clock)
      }
    };
    syncNYCTime();
    const syncInterval = setInterval(syncNYCTime, 5 * 60 * 1000); // re-sync every 5 min
    return () => clearInterval(syncInterval);
  }, []);

  // Tick every second using the corrected UTC time
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date(Date.now() + offsetMs)), 1000);
    return () => clearInterval(interval);
  }, [offsetMs]);

  // Format as ET (browser/server UTC → America/New_York handles DST correctly)
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  const currentTimeET = formatter.format(now);

  // Get numeric hour/min for market hours display
  const etParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const currentHour = parseInt(etParts.find(p => p.type === "hour")?.value || "0", 10);
  const currentMin = parseInt(etParts.find(p => p.type === "minute")?.value || "0", 10);
  const currentMinutesFromMidnight = currentHour * 60 + currentMin;
  
  const marketOpenMinutes = 9 * 60 + 30; // 9:30 AM
  const marketCloseMinutes = 16 * 60; // 4:00 PM
  
  const isMarketHoursNow = currentMinutesFromMidnight >= marketOpenMinutes && currentMinutesFromMidnight < marketCloseMinutes;
  const dayOfWeek = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(now);
  const isWeekday = !["Sat", "Sun"].includes(dayOfWeek);
  const isMarketOpen = isMarketHoursNow && isWeekday;
  
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

function supportsInAppSound(deliveryConfig: unknown): boolean {
  if (!deliveryConfig || typeof deliveryConfig !== "object") return false;
  const config = deliveryConfig as AlertDeliveryConfigRecord;
  return config.soundEnabled === true && Array.isArray(config.channels) && config.channels.includes("in_app");
}

export function SentinelHeader({ showSentiment = true, rightContent }: SentinelHeaderProps) {
  const [location, setLocation] = useLocation();
  const { user: authUser, logout } = useSentinelAuth();
  const { cssVariables } = useSystemSettings();
  const { data: sentiment, isLoading } = useQuery<MarketSentiment>({
    queryKey: ["/api/sentinel/sentiment/market"],
    enabled: showSentiment,
    refetchInterval: 30 * 60 * 1000,
    staleTime: 30 * 60 * 1000,
  });

  const { data: alerts } = useAlerts();
  const { data: alertEvents } = useAlertEvents(25);
  const lastSeenAlertEventIdRef = useRef<number | null>(null);

  const isRulesPage = location === "/sentinel/rules";
  const isDashboardPage = location === "/sentinel" || location === "/sentinel/dashboard";
  const isImportPage = location === "/sentinel/import";
  const isPatternsPage = location === "/sentinel/patterns";
  const isAdminPage = location.startsWith("/sentinel/admin");
  const isBigIdeaPage = location === "/sentinel/bigidea";
  const isMarketConditionPage = location === "/sentinel/market-condition";
  const isChartsPage = location === "/sentinel/charts" || location === "/sentinel/beta-charts";
  const isStartHerePage = location === "/sentinel/start-here";
  const isEvaluatePage = location === "/sentinel/evaluate";

  const [watchlistModalOpen, setWatchlistModalOpen] = useState(false);
  const [alertCenterOpen, setAlertCenterOpen] = useState(false);

  useEffect(() => {
    const openWatchlistManager = () => setWatchlistModalOpen(true);
    window.addEventListener(SENTINEL_OPEN_WATCHLIST_MANAGER_EVENT, openWatchlistManager);
    return () => window.removeEventListener(SENTINEL_OPEN_WATCHLIST_MANAGER_EVENT, openWatchlistManager);
  }, []);

  useEffect(() => {
    if (!alertEvents?.length) {
      if (lastSeenAlertEventIdRef.current == null) {
        lastSeenAlertEventIdRef.current = 0;
      }
      return;
    }

    const sortedIds = alertEvents.map((event) => event.id).sort((a, b) => a - b);
    const maxEventId = sortedIds[sortedIds.length - 1];

    if (lastSeenAlertEventIdRef.current == null) {
      lastSeenAlertEventIdRef.current = maxEventId;
      return;
    }

    const newEvents = alertEvents.filter((event) => event.id > (lastSeenAlertEventIdRef.current ?? 0));
    if (newEvents.length === 0) {
      lastSeenAlertEventIdRef.current = Math.max(lastSeenAlertEventIdRef.current, maxEventId);
      return;
    }

    const soundEnabledAlertIds = new Set(
      (alerts ?? [])
        .filter((alert) => supportsInAppSound(alert.deliveryConfig))
        .map((alert) => alert.id)
    );

    if (newEvents.some((event) => soundEnabledAlertIds.has(event.alertId))) {
      void playAlertChime();
    }

    lastSeenAlertEventIdRef.current = Math.max(lastSeenAlertEventIdRef.current, maxEventId);
  }, [alerts, alertEvents]);

  return (
    <>
    <WatchlistModal open={watchlistModalOpen} onOpenChange={setWatchlistModalOpen} />
    <AlertCenterDialog open={alertCenterOpen} onOpenChange={setAlertCenterOpen} />
    <div
      className="flex items-center justify-between gap-4 flex-wrap border-b px-4 py-3"
      style={{ backgroundColor: cssVariables.headerBg }}
    >
      <div className="flex items-center gap-4">
        <Link href="/sentinel">
          <div
            className="flex items-center gap-2 cursor-pointer hover-elevate rounded-md px-0.5 py-0.5"
            data-testid="link-sentinel-home"
          >
            {/* Mark only (structuremap-mark.png) — no glow; as tall as the bar allows */}
            <div
              className="h-16 max-h-[4.25rem] shrink-0 flex items-center justify-center rounded-sm"
              style={{ opacity: cssVariables.logoOpacity }}
              data-testid="img-sentinel-header-logo-wrap"
            >
              <img
                src="/structuremap-mark.png"
                alt="StructureMap"
                className="h-16 w-auto max-h-full object-contain object-left block select-none pointer-events-none"
                draggable={false}
                data-testid="img-sentinel-header-logo"
              />
            </div>
          </div>
        </Link>
        
        <nav className="flex items-center gap-1">
          <Link href="/sentinel/start-here">
            <Button
              variant={isStartHerePage ? "secondary" : "ghost"}
              size="sm"
              className="gap-2"
              data-testid="nav-start-here"
            >
              <House className="w-4 h-4" />
              <span className="hidden sm:inline" style={{ fontSize: cssVariables.fontSizeSmall }}>Start</span>
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
            onClick={() => setAlertCenterOpen(true)}
            data-testid="nav-alerts"
          >
            <Bell className="w-4 h-4" />
            <span className="hidden sm:inline" style={{ fontSize: cssVariables.fontSizeSmall }}>Alerts</span>
          </Button>
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
          {authUser?.isAdmin && (
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
          <Button 
            variant="ghost"
            size="sm"
            className="gap-2 opacity-30 cursor-not-allowed pointer-events-none"
            disabled
            data-testid="nav-dashboard"
          >
            <LayoutDashboard className="w-4 h-4" />
            <span className="hidden sm:inline" style={{ fontSize: cssVariables.fontSizeSmall }}>Dashboard</span>
          </Button>
          <Button 
            variant="ghost"
            size="sm"
            className="gap-2 opacity-30 cursor-not-allowed pointer-events-none"
            disabled
            data-testid="nav-rules"
          >
            <BookOpen className="w-4 h-4" />
            <span className="hidden sm:inline" style={{ fontSize: cssVariables.fontSizeSmall }}>Rubric</span>
          </Button>
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
      {authUser && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2 h-8 border-slate-600/50 bg-slate-900/40"
              data-testid="button-user-menu"
            >
              <UserRound className="h-4 w-4 shrink-0 opacity-80" />
              <span className="max-w-[8rem] truncate text-xs font-medium">{authUser.username}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-0.5">
                <span className="truncate font-medium">{authUser.username}</span>
                <span className="truncate text-xs text-muted-foreground">{authUser.email}</span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/sentinel/settings" className="cursor-pointer">
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="cursor-pointer text-destructive focus:text-destructive"
              onSelect={() => {
                void (async () => {
                  await logout();
                  setLocation("/sentinel/login");
                })();
              }}
              data-testid="menu-sign-out"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <div className="flex items-center gap-1 ml-2 select-none shrink-0">
        <span className="text-xs font-bold font-mono text-amber-400">
          v{__APP_VERSION__}+{__APP_BUILD_SHA__}
        </span>
        <span className="text-xs text-slate-600">·</span>
        {import.meta.env.PROD ? (
          <span className="text-xs font-semibold text-emerald-400 bg-emerald-400/10 border border-emerald-400/30 px-1.5 py-0.5 rounded">
            LIVE
          </span>
        ) : (
          <span className="text-xs font-semibold text-amber-400 bg-amber-400/10 border border-amber-400/30 px-1.5 py-0.5 rounded">
            DEV
          </span>
        )}
      </div>
      </div>
    </div>
    </>
  );
}

export default SentinelHeader;
