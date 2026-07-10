// ---------------------------------------------------------------------------
// DiscoveryCard — single discovery in the scanner feed
//
// Compact: headline + direction + time. Hover shows % change & signal context.
// Expanded: narrative + actionable links (tickers → chart, themes → Flow).
// Non-linkable items (MARKET, unknown subjects) render as plain text.
// ---------------------------------------------------------------------------

import { useState, useMemo, useCallback } from "react";
import { cn } from "@/lib/utils";
import { useAdminTheme } from "@/context/SystemSettingsContext";
import {
  ChevronDown,
  ChevronUp,
  TrendingUp,
  TrendingDown,
  Zap,
  AlertTriangle,
  ExternalLink,
  BarChart3,
} from "lucide-react";
import type {
  DiscoveryCard as DiscoveryCardType,
  PipelinePriority,
  PeerVelocityResult,
  RelativeStrengthResult,
  SectorFlowResult,
} from "@shared/scanner-types";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Link, useLocation } from "wouter";

// Known theme IDs — anything in this set is a theme, not a ticker
const THEME_IDS = new Set([
  "SEMIS", "AI_INFRA", "STORAGE", "ENTERPRISE_SOFT", "CYBER", "FIBER_OPTICAL",
  "DATA_CENTER_REITS", "INDUSTRIAL_INFRA", "DEFENSE", "FINANCIAL_CORE",
  "PAYMENTS_FINTECH", "ENERGY", "CONSUMER_DISC", "CONSUMER_STAPLES",
  "HEALTHCARE", "MATERIALS_METALS", "TRANSPORTS", "HOMEBUILDERS", "CRYPTO_EQ",
  "NUCLEAR_URANIUM", "SPACE_FRONTIER", "QUANTUM", "RARE_EARTH",
  "PRECIOUS_METALS", "BIOTECH", "SOLAR", "GAMING_CASINOS", "HOSPITALITY_LEISURE",
  "MARKET",
]);

function isRealTicker(s: string): boolean {
  return !THEME_IDS.has(s) && /^[A-Z]{1,5}$/.test(s);
}

function isThemeId(s: string): boolean {
  return THEME_IDS.has(s) && s !== "MARKET";
}

function priorityBadge(priority: PipelinePriority, cssVars: ReturnType<typeof useAdminTheme>["cssVariables"]) {
  switch (priority) {
    case "urgent":
      return (
        <span
          className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
          style={{ backgroundColor: "rgba(239,68,68,0.2)", color: cssVars.textNegative }}
        >
          <AlertTriangle className="h-2.5 w-2.5" /> urgent
        </span>
      );
    case "low":
      return (
        <span className="inline-flex items-center gap-0.5 rounded bg-slate-700/40 px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-400">
          low
        </span>
      );
    default:
      return null;
  }
}

function directionIcon(direction: string) {
  if (direction === "up") return <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />;
  if (direction === "down") return <TrendingDown className="h-3.5 w-3.5 text-red-400" />;
  return <Zap className="h-3.5 w-3.5 text-amber-400" />;
}

function timeAgo(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  const clock = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  if (mins < 1) return `just now · ${clock}`;
  if (mins < 60) return `${mins}m ago · ${clock}`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m ago · ${clock}`;
}

function sign(n: number): string {
  return n >= 0 ? `+${n.toFixed(2)}` : n.toFixed(2);
}

// Build a tooltip string from the card's context + signal metadata
function buildHoverDetail(card: DiscoveryCardType): string {
  const lines: string[] = [];

  // Subject + % change
  const changePct = (card.context as any)?.relative_strength?.rsVsSpy as number | undefined;
  lines.push(`${card.subject} · ${card.signalType.replace(/_/g, " ")} · ${sign(card.magnitude)}x magnitude`);

  // Direction
  lines.push(`Direction: ${card.direction}`);

  // Peer velocity
  const pv = card.context.peer_velocity as PeerVelocityResult | undefined;
  if (pv && pv.peers.length > 0) {
    const top = pv.peers.slice(0, 3).map((p) => `${p.symbol} ${sign(p.changePct)}%`).join(", ");
    lines.push(`Peers: ${top} · ${pv.verdict}`);
  }

  // RS vs SPY
  const rs = card.context.relative_strength as RelativeStrengthResult | undefined;
  if (rs) {
    lines.push(`RS vs SPY: ${sign(rs.rsVsSpy)}% · ${rs.divergenceType}`);
  }

  // Sector flow
  const sf = card.context.sector_flow as SectorFlowResult | undefined;
  if (sf) {
    lines.push(`Theme flow: ${sign(sf.themeChangePct)}% · A/D ${sf.adRatio.up}/${sf.adRatio.down} · ${sf.volumeProfile}`);
  }

  // Score
  lines.push(`Score: ${card.qualifyScore.toFixed(0)}/100`);

  return lines.join("\n");
}

interface DiscoveryCardProps {
  card: DiscoveryCardType;
  fontSize: number;
  headlineFontSize: number;
  onOpenChart?: (symbol: string) => void;
  onNavigateTheme?: (themeId: string) => void;
  globalExpanded?: boolean;
}

export function DiscoveryCard({
  card,
  fontSize,
  headlineFontSize,
  onOpenChart,
  onNavigateTheme,
  globalExpanded = false,
}: DiscoveryCardProps) {
  const [localExpanded, setLocalExpanded] = useState(false);
  const expanded = globalExpanded || localExpanded;
  const { cssVariables } = useAdminTheme();
  const [, navigate] = useLocation();

  const navigateToTheme = useCallback((themeId: string) => {
    if (onNavigateTheme) {
      onNavigateTheme(themeId);
    } else {
      navigate(`/sentinel/market-condition?theme=${themeId}`);
    }
  }, [navigate, onNavigateTheme]);

  const hoverDetail = useMemo(() => buildHoverDetail(card), [card]);

  // Split tickers into real tickers (chart-linkable) and others
  const { realTickers, themeSubject } = useMemo(() => {
    const real = card.tickers.filter(isRealTicker);
    const theme = card.themeId && isThemeId(card.themeId) ? card.themeId : null;
    return { realTickers: real, themeSubject: theme };
  }, [card.tickers, card.themeId]);

  const borderColor = card.priority === "urgent"
    ? "border-red-500/40"
    : card.direction === "up"
    ? "border-emerald-500/20"
    : card.direction === "down"
    ? "border-red-500/20"
    : "border-slate-700/50";

  return (
    <div
      className={cn(
        "rounded-lg border p-2 transition-colors",
        borderColor
      )}
      style={{
        backgroundColor: cssVariables.mainBg,
        fontSize: `${fontSize}px`,
      }}
      data-testid={`scanner-card-${card.id}`}
    >
      {/* Compact view: hover shows details */}
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className="flex items-start gap-2 cursor-pointer select-none"
            onClick={() => setLocalExpanded(!localExpanded)}
          >
            <div className="mt-0.5 shrink-0">{directionIcon(card.direction)}</div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span
                  className="font-semibold leading-tight"
                  style={{
                    fontSize: `${headlineFontSize}px`,
                    color: cssVariables.textTitle,
                  }}
                >
                  {card.headline}
                </span>
                {priorityBadge(card.priority, cssVariables)}
              </div>

              {/* Pipeline + time */}
              <div className="mt-0.5 flex items-center gap-2">
                <span
                  className="rounded bg-slate-700/50 px-1.5 py-0.5 text-[10px] font-medium"
                  style={{ color: cssVariables.textSmall }}
                >
                  {card.pipelineName}
                </span>
                <span
                  className="text-[10px] tabular-nums"
                  style={{ color: cssVariables.textTiny }}
                >
                  {timeAgo(card.createdAt)}
                </span>
              </div>
            </div>

            {/* Expand toggle */}
            <div className="h-6 w-6 shrink-0 flex items-center justify-center opacity-50">
              {expanded
                ? <ChevronUp className="h-3.5 w-3.5" />
                : <ChevronDown className="h-3.5 w-3.5" />}
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent
          side="left"
          className="max-w-[300px] whitespace-pre-line text-[11px] leading-relaxed"
        >
          {hoverDetail}
        </TooltipContent>
      </Tooltip>

      {/* Expanded: narrative + actionable links */}
      {expanded && (
        <div className="mt-2 space-y-2 border-t border-slate-700/30 pt-2">
          <p
            className="leading-relaxed"
            style={{ color: cssVariables.primaryText, fontSize: `${fontSize}px` }}
          >
            {card.narrative}
          </p>

          {/* News article link */}
          {(card.context as any)?._newsUrl && (
            <a
              href={(card.context as any)._newsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded border border-cyan-700/40 bg-cyan-900/20 px-2 py-1 text-[11px] font-medium transition-colors hover:bg-cyan-800/30 hover:border-cyan-500/40"
              style={{ color: cssVariables.textMarketFlow }}
            >
              <ExternalLink className="h-3 w-3" />
              Read Article ({(card.context as any)?._newsSource ?? "source"})
            </a>
          )}

          {/* Real ticker links (open chart) */}
          {realTickers.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              {realTickers.slice(0, 8).map((ticker) => (
                <Link
                  key={ticker}
                  href={`/sentinel/charts?symbol=${ticker}`}
                  className="inline-flex items-center gap-0.5 rounded border border-slate-600/50 bg-slate-800/50 px-1.5 py-0.5 text-[11px] font-mono font-bold transition-colors hover:bg-cyan-900/30 hover:border-cyan-500/30"
                  style={{ color: cssVariables.textMarketFlow }}
                  onClick={(e) => {
                    if (onOpenChart) {
                      e.preventDefault();
                      onOpenChart(ticker);
                    }
                  }}
                >
                  {ticker}
                  <BarChart3 className="h-2.5 w-2.5 opacity-50" />
                </Link>
              ))}
              {realTickers.length > 8 && (
                <span className="text-[10px] text-slate-500">
                  +{realTickers.length - 8} more
                </span>
              )}
            </div>
          )}

          {/* Theme link — opens Flow tool */}
          {themeSubject && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px]" style={{ color: cssVariables.textTiny }}>
                Theme:
              </span>
              <button
                onClick={() => navigateToTheme(themeSubject!)}
                className="inline-flex items-center gap-0.5 text-[11px] font-medium transition-colors hover:underline cursor-pointer bg-transparent border-0 p-0"
                style={{ color: cssVariables.textMarketFlow }}
              >
                {themeSubject.replace(/_/g, " ")}
                <ExternalLink className="h-2.5 w-2.5 opacity-40" />
              </button>
            </div>
          )}

          {/* Non-linkable subject (e.g., MARKET, or theme-level signals without valid ticker) */}
          {!themeSubject && card.subjectKind !== "ticker" && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px]" style={{ color: cssVariables.textTiny }}>
                Subject:
              </span>
              <span
                className="text-[11px] font-medium"
                style={{ color: cssVariables.textSmall }}
              >
                {card.subject.replace(/_/g, " ")}
              </span>
            </div>
          )}

          {/* Score bar */}
          <div className="flex items-center gap-2">
            <span className="text-[10px]" style={{ color: cssVariables.textTiny }}>
              Score: {card.qualifyScore.toFixed(0)}/100
            </span>
            <div className="h-1.5 w-16 rounded-full bg-slate-700/50 overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(100, card.qualifyScore)}%`,
                  backgroundColor: card.qualifyScore >= 70
                    ? cssVariables.textPositive
                    : card.qualifyScore >= 40
                    ? cssVariables.textWarning
                    : cssVariables.textSmall,
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
