/**
 * AnalysisPanel - MarketFlow AI analysis for a symbol
 * Full 10-module analysis with AI-generated narrative
 */

import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { CacheMeta } from "./CachePrompt";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Loader2,
  ChevronDown,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Target,
  BarChart3,
  Newspaper,
  Calendar,
  DollarSign,
  Users,
  Activity,
  Layers,
  Clock,
  RefreshCw,
  FileDown,
  PanelRightOpen,
  Pin,
  X,
  GripVertical,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAnalysisPopout } from "@/hooks/useAnalysisPopout";
import { useToast } from "@/hooks/use-toast";

const FLOATING_STORAGE_KEY = "analysis-panel-floating";
const DEFAULT_FLOATING = { x: 80, y: 60, w: 520, h: 560, pinned: false };

const API = "/api/marketflow";

async function fetchCacheMeta(symbol: string): Promise<CacheMeta> {
  const res = await fetch(`${API}/${encodeURIComponent(symbol)}/cache-meta`);
  if (!res.ok) throw new Error("Failed to fetch cache meta");
  return res.json();
}

async function fetchCached(symbol: string) {
  const res = await fetch(`${API}/${encodeURIComponent(symbol)}/cached`);
  if (!res.ok) throw new Error("No cached analysis");
  return res.json();
}

async function runAnalysis(symbol: string) {
  const res = await fetch(`${API}/${encodeURIComponent(symbol)}`, {
    method: "POST",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      body && typeof body.error === "string" ? body.error : "Analysis failed";
    const detail = body.detail ? `: ${body.detail}` : "";
    throw new Error(`${msg}${detail}`);
  }
  return body;
}

// Types matching server
interface ModuleResponse {
  module_id: string;
  ticker: string;
  signal: "bullish" | "bearish" | "neutral" | "warning" | "informational";
  summary: string;
  confidence: number;
  data?: Record<string, unknown>;
  flags?: string[];
  executionMs?: number;
}

interface SynthesisOutput {
  company_description: string;
  executive_summary: string;
  conviction_score: number;
  action: "strong_buy" | "buy" | "watch" | "avoid" | "short";
  action_rationale: string;
  key_bullish: string[];
  key_bearish: string[];
  conflicts: string[];
  rubric_autofill: Record<string, unknown>;
  model_used: string;
}

interface AnalysisResult {
  symbol: string;
  moduleResponses: ModuleResponse[];
  synthesis: SynthesisOutput;
  generated_at: string;
  execution_ms: number;
  version: string;
}

interface AnalysisPanelProps {
  symbol: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "sheet" = right slide-over (e.g. popout page). "floating" = draggable/resizable panel in same window. */
  variant?: "sheet" | "floating";
  /** When false, hide the Detach (pop out) button. Only used when variant="sheet". */
  showDetach?: boolean;
}

const MODULE_ICONS: Record<string, React.ReactNode> = {
  marketContext: <Layers className="w-4 h-4" />,
  keyLevels: <Target className="w-4 h-4" />,
  volume: <BarChart3 className="w-4 h-4" />,
  setupDetection: <Activity className="w-4 h-4" />,
  wyckoffStage: <TrendingUp className="w-4 h-4" />,
  news: <Newspaper className="w-4 h-4" />,
  earnings: <Calendar className="w-4 h-4" />,
  riskCalendar: <Clock className="w-4 h-4" />,
  fundFlow: <TrendingUp className="w-4 h-4" />,
  sentiment: <Users className="w-4 h-4" />,
  positionSizing: <DollarSign className="w-4 h-4" />,
};

const MODULE_LABELS: Record<string, string> = {
  marketContext: "Market Context",
  keyLevels: "Key Levels",
  volume: "Volume Analysis",
  setupDetection: "Setup Detection",
  wyckoffStage: "Wyckoff Stage",
  news: "News & Headlines",
  earnings: "Earnings",
  riskCalendar: "Risk Calendar",
  fundFlow: "Fund Flow",
  sentiment: "Analyst Sentiment",
  positionSizing: "Position Sizing",
};

function getSignalColor(signal: string): string {
  switch (signal) {
    case "bullish":
      return "text-green-400 bg-green-500/10 border-green-500/30";
    case "bearish":
      return "text-red-400 bg-red-500/10 border-red-500/30";
    case "warning":
      return "text-yellow-400 bg-yellow-500/10 border-yellow-500/30";
    default:
      return "text-slate-400 bg-slate-500/10 border-slate-500/30";
  }
}

function getActionColor(action: string): string {
  switch (action) {
    case "strong_buy":
      return "bg-green-500 text-white";
    case "buy":
      return "bg-green-400/80 text-white";
    case "watch":
      return "bg-yellow-500 text-black";
    case "avoid":
      return "bg-orange-500 text-white";
    case "short":
      return "bg-red-500 text-white";
    default:
      return "bg-slate-500 text-white";
  }
}

/** Build a minimal HTML document for the analysis report and open print dialog (Save as PDF). */
function printAnalysisAsPdf(result: AnalysisResult): void {
  const { symbol, synthesis, moduleResponses, generated_at } = result;
  const dateStr = new Date(generated_at).toLocaleString();
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const modulesHtml = moduleResponses
    .map(
      (m) =>
        `<section style="margin: 0.75em 0; padding: 0.5em; border: 1px solid #334155; border-radius: 6px;">
          <strong>${escape(m.module_id.replace(/_/g, " "))}</strong> — ${escape(m.summary)}
        </section>`
    )
    .join("");
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Analysis: ${escape(symbol)}</title>
    <style>body{font-family:system-ui,sans-serif;max-width:720px;margin:1.5em auto;padding:0 1em;color:#e2e8f0;background:#0f172a;}
    h1{font-size:1.25rem;} .meta{color:#94a3b8;font-size:0.875rem;margin-bottom:1em;}
    .summary{margin:1em 0;line-height:1.5;} .action{display:inline-block;padding:0.25em 0.5em;border-radius:4px;margin:0.5em 0;}
    ul{margin:0.25em 0;padding-left:1.25em;}</style></head><body>
    <h1>Analysis: ${escape(symbol)}</h1>
    <p class="meta">Last analysis: ${escape(dateStr)}</p>
    ${synthesis.company_description ? `<p class="summary"><em>${escape(synthesis.company_description)}</em></p>` : ""}
    <h2>Executive Summary</h2>
    <p class="summary">${escape(synthesis.executive_summary)}</p>
    <p><strong>Conviction:</strong> ${synthesis.conviction_score} &nbsp; <strong>Action:</strong> <span class="action">${escape(synthesis.action.replace("_", " ").toUpperCase())}</span></p>
    ${synthesis.key_bullish?.length ? `<h3>Bullish</h3><ul>${synthesis.key_bullish.map((b) => `<li>${escape(b)}</li>`).join("")}</ul>` : ""}
    ${synthesis.key_bearish?.length ? `<h3>Bearish</h3><ul>${synthesis.key_bearish.map((b) => `<li>${escape(b)}</li>`).join("")}</ul>` : ""}
    ${synthesis.conflicts?.length ? `<h3>Conflicts</h3><ul>${synthesis.conflicts.map((c) => `<li>${escape(c)}</li>`).join("")}</ul>` : ""}
    <h2>Modules</h2>${modulesHtml}
    </body></html>`;
  const w = window.open("", "_blank");
  if (w) {
    w.document.write(html);
    w.document.close();
    w.focus();
    w.onload = () => {
      w.print();
      w.onafterprint = () => w.close();
    };
  }
}

function ConvictionMeter({ score }: { score: number }) {
  const getColor = () => {
    if (score >= 70) return "bg-green-500";
    if (score >= 50) return "bg-yellow-500";
    if (score >= 30) return "bg-orange-500";
    return "bg-red-500";
  };

  return (
    <div className="flex items-center gap-2">
      <div className="w-24 h-2 bg-slate-700 rounded-full overflow-hidden">
        <div
          className={cn("h-full transition-all", getColor())}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className="text-sm font-mono font-medium">{score}</span>
    </div>
  );
}

function ModuleCard({
  module,
  defaultOpen = false,
}: {
  module: ModuleResponse;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="w-full">
        <div
          className={cn(
            "flex items-center justify-between p-3 rounded-lg border transition-colors",
            getSignalColor(module.signal),
            "hover:bg-opacity-20"
          )}
        >
          <div className="flex items-center gap-3">
            {MODULE_ICONS[module.module_id] || <Activity className="w-4 h-4" />}
            <span className="font-medium text-sm">
              {MODULE_LABELS[module.module_id] || module.module_id}
            </span>
            <Badge variant="outline" className="text-[10px] px-1.5">
              {module.signal}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {module.confidence}%
            </span>
            <ChevronDown
              className={cn(
                "w-4 h-4 transition-transform",
                isOpen && "rotate-180"
              )}
            />
          </div>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-3 py-2 mt-1 bg-slate-800/30 rounded-lg border border-slate-700/30">
          <p className="text-sm text-foreground mb-2">{module.summary}</p>
          {module.flags && module.flags.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {module.flags.map((flag, i) => (
                <Badge key={i} variant="secondary" className="text-[10px]">
                  {flag}
                </Badge>
              ))}
            </div>
          )}
          <ModuleDataView moduleId={module.module_id} data={module.data} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ModuleDataView({
  moduleId,
  data,
}: {
  moduleId: string;
  data?: Record<string, unknown>;
}) {
  if (!data) return null;

  switch (moduleId) {
    case "marketContext":
      return <MarketContextView data={data} />;
    case "keyLevels":
      return <KeyLevelsView data={data} />;
    case "volume":
      return <VolumeView data={data} />;
    case "setupDetection":
      return <SetupView data={data} />;
    case "wyckoffStage":
      return <WyckoffView data={data} />;
    case "sentiment":
      return <SentimentView data={data} />;
    case "earnings":
      return <EarningsView data={data} />;
    case "positionSizing":
      return <PositionSizingView data={data} />;
    default:
      return null;
  }
}

function MarketContextView({ data }: { data: Record<string, unknown> }) {
  const sector = data.sector as string;
  const industry = data.industry as string;
  const regime = data.regime as string;
  const raiScore = data.raiScore as number;
  const sectorRank = data.sectorRank as number;
  const rsVsSpy = data.rsVsSpy as number;
  const themes = (data.themes as Array<{ name: string }>) || [];

  return (
    <div className="text-xs space-y-1.5 mt-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <span className="text-muted-foreground">Sector:</span>{" "}
          <span className="font-medium">{sector}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Industry:</span>{" "}
          <span className="font-medium">{industry}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Sector Rank:</span>{" "}
          <span className="font-medium">#{sectorRank}/11</span>
        </div>
        <div>
          <span className="text-muted-foreground">Regime:</span>{" "}
          <span
            className={cn(
              "font-medium",
              regime === "RISK_ON"
                ? "text-green-400"
                : regime === "RISK_OFF"
                  ? "text-red-400"
                  : ""
            )}
          >
            {regime?.replace("_", " ")}
          </span>
        </div>
        <div>
          <span className="text-muted-foreground">RAI:</span>{" "}
          <span className="font-medium">{raiScore?.toFixed(0)}</span>
        </div>
        <div>
          <span className="text-muted-foreground">RS vs SPY:</span>{" "}
          <span
            className={cn(
              "font-medium",
              rsVsSpy >= 0 ? "text-green-400" : "text-red-400"
            )}
          >
            {rsVsSpy >= 0 ? "+" : ""}
            {rsVsSpy?.toFixed(2)}%
          </span>
        </div>
      </div>
      {themes.length > 0 && (
        <div>
          <span className="text-muted-foreground">Themes:</span>{" "}
          {themes.map((t) => t.name).join(", ")}
        </div>
      )}
    </div>
  );
}

function KeyLevelsView({ data }: { data: Record<string, unknown> }) {
  const levels = (data.levels as Array<{
    price: number;
    label: string;
    distancePct: number;
    significance: string;
  }>) || [];
  const nearestSupport = data.nearestSupport as number;
  const nearestResistance = data.nearestResistance as number;

  return (
    <div className="text-xs space-y-2 mt-2">
      <div className="flex gap-4">
        {nearestSupport && (
          <div>
            <span className="text-muted-foreground">Support:</span>{" "}
            <span className="text-green-400 font-mono">
              ${nearestSupport.toFixed(2)}
            </span>
          </div>
        )}
        {nearestResistance && (
          <div>
            <span className="text-muted-foreground">Resistance:</span>{" "}
            <span className="text-red-400 font-mono">
              ${nearestResistance.toFixed(2)}
            </span>
          </div>
        )}
      </div>
      <div className="max-h-32 overflow-y-auto space-y-1">
        {levels.slice(0, 8).map((l, i) => (
          <div
            key={i}
            className="flex justify-between items-center py-0.5 border-b border-slate-700/30"
          >
            <span className="font-mono">${l.price.toFixed(2)}</span>
            <span className="text-cyan-400">{l.label}</span>
            <span
              className={l.distancePct >= 0 ? "text-green-400" : "text-red-400"}
            >
              {l.distancePct >= 0 ? "+" : ""}
              {l.distancePct.toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function VolumeView({ data }: { data: Record<string, unknown> }) {
  const currentPrice = data.currentPrice as number;
  const changePct = data.changePct as number;
  const rvol = data.rvol as number;
  const volumeTrend = data.volumeTrend as string;
  const dryUpDetected = data.dryUpDetected as boolean;

  return (
    <div className="text-xs space-y-1.5 mt-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <span className="text-muted-foreground">Price:</span>{" "}
          <span className="font-mono font-medium">
            ${currentPrice?.toFixed(2)}
          </span>
        </div>
        <div>
          <span className="text-muted-foreground">Change:</span>{" "}
          <span
            className={cn(
              "font-mono",
              changePct >= 0 ? "text-green-400" : "text-red-400"
            )}
          >
            {changePct >= 0 ? "+" : ""}
            {changePct?.toFixed(2)}%
          </span>
        </div>
        <div>
          <span className="text-muted-foreground">RVOL:</span>{" "}
          <span
            className={cn(
              "font-mono",
              rvol >= 1.5 ? "text-cyan-400" : "text-muted-foreground"
            )}
          >
            {rvol?.toFixed(2)}x
          </span>
        </div>
        <div>
          <span className="text-muted-foreground">Trend:</span>{" "}
          <span
            className={cn(
              volumeTrend === "accumulation"
                ? "text-green-400"
                : volumeTrend === "distribution"
                  ? "text-red-400"
                  : ""
            )}
          >
            {volumeTrend}
          </span>
        </div>
      </div>
      {dryUpDetected && (
        <div className="text-yellow-400">Volume dry-up detected</div>
      )}
    </div>
  );
}

function SetupView({ data }: { data: Record<string, unknown> }) {
  const patterns = (data.patterns as Array<{
    name: string;
    confidence: number;
    stage: string;
    entry: number | null;
    stop: number | null;
    target: number | null;
  }>) || [];
  const primaryPattern = data.primaryPattern as string;

  if (patterns.length === 0) {
    return (
      <div className="text-xs text-muted-foreground mt-2">
        No patterns detected
      </div>
    );
  }

  return (
    <div className="text-xs space-y-2 mt-2">
      {patterns.slice(0, 3).map((p, i) => (
        <div key={i} className="p-2 bg-slate-800/50 rounded border border-slate-700/30">
          <div className="flex justify-between mb-1">
            <span className={cn("font-medium", i === 0 && "text-cyan-400")}>
              {p.name}
            </span>
            <Badge variant="outline" className="text-[10px]">
              {p.stage}
            </Badge>
          </div>
          <div className="text-[10px] text-muted-foreground">
            Confidence: {p.confidence}%
          </div>
          {p.entry && (
            <div className="grid grid-cols-3 gap-2 mt-1 text-[10px]">
              <div>
                Entry: <span className="font-mono">${p.entry.toFixed(2)}</span>
              </div>
              {p.stop && (
                <div>
                  Stop:{" "}
                  <span className="font-mono text-red-400">
                    ${p.stop.toFixed(2)}
                  </span>
                </div>
              )}
              {p.target && (
                <div>
                  Target:{" "}
                  <span className="font-mono text-green-400">
                    ${p.target.toFixed(2)}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function SentimentView({ data }: { data: Record<string, unknown> }) {
  const consensus = data.analystConsensus as {
    strongBuy: number;
    buy: number;
    hold: number;
    sell: number;
    strongSell: number;
    rating: string;
  };
  const priceTarget = data.priceTarget as {
    mean: number;
    high: number;
    low: number;
    upside: number;
  } | null;

  return (
    <div className="text-xs space-y-2 mt-2">
      {consensus && (
        <div className="flex flex-wrap gap-x-3">
          <span className="text-green-500">
            Strong Buy: {consensus.strongBuy}
          </span>
          <span className="text-green-400">Buy: {consensus.buy}</span>
          <span className="text-yellow-400">Hold: {consensus.hold}</span>
          <span className="text-orange-400">Sell: {consensus.sell}</span>
          <span className="text-red-400">
            Strong Sell: {consensus.strongSell}
          </span>
        </div>
      )}
      {priceTarget && (
        <div>
          <span className="text-muted-foreground">Target:</span>{" "}
          <span className="font-mono">${priceTarget.mean.toFixed(2)}</span>
          <span
            className={cn(
              "ml-2",
              priceTarget.upside >= 0 ? "text-green-400" : "text-red-400"
            )}
          >
            ({priceTarget.upside >= 0 ? "+" : ""}
            {priceTarget.upside.toFixed(1)}%)
          </span>
        </div>
      )}
    </div>
  );
}

function EarningsView({ data }: { data: Record<string, unknown> }) {
  const nextEarnings = data.nextEarnings as {
    date: string;
    quarter: number;
    year: number;
  } | null;
  const daysUntil = data.daysUntilEarnings as number | null;
  const beatRate = data.beatRate as number;

  return (
    <div className="text-xs space-y-1.5 mt-2">
      {nextEarnings ? (
        <>
          <div>
            <span className="text-muted-foreground">Next:</span>{" "}
            {nextEarnings.date} (Q{nextEarnings.quarter} {nextEarnings.year})
          </div>
          {daysUntil !== null && (
            <div
              className={cn(daysUntil <= 7 && "text-yellow-400")}
            >
              {daysUntil === 0 ? "Today!" : `${daysUntil} days away`}
            </div>
          )}
        </>
      ) : (
        <div className="text-muted-foreground">No upcoming earnings</div>
      )}
      <div>
        <span className="text-muted-foreground">Beat rate:</span>{" "}
        {beatRate.toFixed(0)}%
      </div>
    </div>
  );
}

function PositionSizingView({ data }: { data: Record<string, unknown> }) {
  const shares = data.suggestedShares as number;
  const dollars = data.suggestedDollars as number;
  const rrRatio = data.rrRatio as number | null;
  const riskPct = data.riskPct as number;

  return (
    <div className="text-xs space-y-1.5 mt-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <span className="text-muted-foreground">Suggested:</span>{" "}
          <span className="font-medium">{shares} shares</span>
        </div>
        <div>
          <span className="text-muted-foreground">Value:</span>{" "}
          <span className="font-mono">${dollars?.toLocaleString()}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Risk:</span>{" "}
          <span className="font-mono">{riskPct}%</span>
        </div>
        {rrRatio !== null && (
          <div>
            <span className="text-muted-foreground">R:R:</span>{" "}
            <span
              className={cn(
                "font-mono",
                rrRatio >= 2 ? "text-green-400" : rrRatio < 1 ? "text-red-400" : ""
              )}
            >
              {rrRatio.toFixed(2)}:1
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function WyckoffView({ data }: { data: Record<string, unknown> }) {
  const stage = data.stage as string;
  const phase = data.phase as string | null;
  const stageLabel = data.stageLabel as string;
  const priorTrend = data.priorTrend as string;
  const priorTrendPct = data.priorTrendPct as number;
  const volumeCharacter = data.volumeCharacter as string;
  const tradingRange = data.tradingRange as {
    high: number;
    low: number;
    widthPct: number;
    daysInRange: number;
  };
  const events = (data.events as Array<{
    type: string;
    date: string;
    price: number;
    description: string;
  }>) || [];
  const breakoutLevel = data.breakoutLevel as number | null;
  const breakdownLevel = data.breakdownLevel as number | null;
  const distanceFromBreakout = data.distanceFromBreakout as number | null;

  const getStageColor = () => {
    switch (stage) {
      case "accumulation":
        return "text-cyan-400";
      case "markup":
        return "text-green-400";
      case "distribution":
        return "text-orange-400";
      case "markdown":
        return "text-red-400";
      default:
        return "text-slate-400";
    }
  };

  const getEventColor = (type: string) => {
    switch (type) {
      case "spring":
      case "test":
      case "sign_of_strength":
      case "breakout":
        return "text-green-400";
      case "upthrust":
      case "sign_of_weakness":
      case "breakdown":
        return "text-red-400";
      default:
        return "text-yellow-400";
    }
  };

  return (
    <div className="text-xs space-y-3 mt-2">
      {/* Stage and Phase */}
      <div className="p-2 bg-slate-800/50 rounded border border-slate-700/30">
        <div className={cn("font-semibold text-sm", getStageColor())}>
          {stageLabel}
        </div>
        <div className="text-muted-foreground mt-1">
          Prior trend: {priorTrend} ({priorTrendPct >= 0 ? "+" : ""}{priorTrendPct?.toFixed(1)}%)
        </div>
        <div className="text-muted-foreground">
          Volume character: <span className={cn(
            volumeCharacter === "accumulation" ? "text-green-400" :
            volumeCharacter === "distribution" ? "text-red-400" : ""
          )}>{volumeCharacter}</span>
        </div>
      </div>

      {/* Trading Range */}
      {tradingRange && tradingRange.high > 0 && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <span className="text-muted-foreground">Range High:</span>{" "}
            <span className="font-mono text-green-400">${tradingRange.high?.toFixed(2)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Range Low:</span>{" "}
            <span className="font-mono text-red-400">${tradingRange.low?.toFixed(2)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Width:</span>{" "}
            <span className="font-mono">{tradingRange.widthPct?.toFixed(1)}%</span>
          </div>
          <div>
            <span className="text-muted-foreground">Days:</span>{" "}
            <span className="font-mono">{tradingRange.daysInRange}</span>
          </div>
        </div>
      )}

      {/* Key Levels */}
      {(breakoutLevel || breakdownLevel) && (
        <div className="flex gap-4">
          {breakoutLevel && distanceFromBreakout !== null && (
            <div>
              <span className="text-muted-foreground">Breakout:</span>{" "}
              <span className="font-mono text-green-400">${breakoutLevel.toFixed(2)}</span>
              <span className="text-muted-foreground ml-1">
                ({distanceFromBreakout >= 0 ? "+" : ""}{distanceFromBreakout.toFixed(1)}%)
              </span>
            </div>
          )}
        </div>
      )}

      {/* Events */}
      {events.length > 0 && (
        <div>
          <div className="text-muted-foreground mb-1">Wyckoff Events:</div>
          <div className="space-y-1">
            {events.slice(0, 3).map((event, i) => (
              <div key={i} className="flex items-start gap-2 text-[10px]">
                <Badge variant="outline" className={cn("text-[9px] px-1", getEventColor(event.type))}>
                  {event.type.replace("_", " ")}
                </Badge>
                <span className="text-muted-foreground">{event.description}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function loadFloatingState(): { x: number; y: number; w: number; h: number; pinned: boolean } {
  try {
    const raw = localStorage.getItem(FLOATING_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.x === "number" && typeof parsed.y === "number" && typeof parsed.w === "number" && typeof parsed.h === "number") {
        const w = Math.max(320, Math.min(typeof window !== "undefined" ? window.innerWidth - 40 : 800, parsed.w));
        const h = Math.max(240, Math.min(typeof window !== "undefined" ? window.innerHeight - 40 : 700, parsed.h));
        const x = Math.max(0, Math.min(typeof window !== "undefined" ? window.innerWidth - w : 80, parsed.x));
        const y = Math.max(0, Math.min(typeof window !== "undefined" ? window.innerHeight - h : 60, parsed.y));
        return { ...DEFAULT_FLOATING, ...parsed, x, y, w, h };
      }
    }
  } catch {}
  return DEFAULT_FLOATING;
}

export function AnalysisPanel({ symbol, open, onOpenChange, showDetach = true, variant = "sheet" }: AnalysisPanelProps) {
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const queryClient = useQueryClient();
  const hasTriggeredLoad = useRef(false);
  const { openAnalysisPopout } = useAnalysisPopout();
  const { toast } = useToast();

  // Floating panel state: position, size, pinned (persisted)
  const [floatState, setFloatState] = useState(loadFloatingState);
  const dragRef = useRef<{ startX: number; startY: number; startLeft: number; startTop: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);

  const persistFloatState = (next: Partial<typeof floatState>) => {
    setFloatState((prev) => {
      const merged = { ...prev, ...next };
      try {
        localStorage.setItem(FLOATING_STORAGE_KEY, JSON.stringify(merged));
      } catch {}
      return merged;
    });
  };

  const { data: meta, isLoading: metaLoading } = useQuery({
    queryKey: ["marketflow", "cache-meta", symbol],
    queryFn: () => fetchCacheMeta(symbol!),
    enabled: open && !!symbol,
  });

  const useCachedMutation = useMutation({
    mutationFn: () => fetchCached(symbol!),
    onSuccess: (data, _vars, ctx) => {
      if (data?.symbol === symbol) setResult(data as AnalysisResult);
    },
  });

  const reRunMutation = useMutation({
    mutationFn: () => runAnalysis(symbol!),
    onSuccess: (data, _vars, ctx) => {
      if (data?.symbol === symbol) {
        setResult(data as AnalysisResult);
        queryClient.invalidateQueries({
          queryKey: ["marketflow", "cache-meta", symbol],
        });
      }
    },
  });

  useEffect(() => {
    if (!open || !symbol) {
      setResult(null);
      hasTriggeredLoad.current = false;
    }
  }, [open, symbol]);

  // Auto-load: if cache valid use it, else re-run (no two-button pane)
  useEffect(() => {
    if (!open || !symbol || metaLoading || meta === undefined || result !== null) return;
    if (hasTriggeredLoad.current) return;
    hasTriggeredLoad.current = true;
    if (meta.exists && meta.generated_at) {
      useCachedMutation.mutate();
    } else {
      reRunMutation.mutate();
    }
  }, [open, symbol, metaLoading, meta, result]);

  const isLoading = metaLoading;
  const loadPending = useCachedMutation.isPending || reRunMutation.isPending;
  const loadError = reRunMutation.isError || useCachedMutation.isError;
  const lastAnalysisLabel = result?.generated_at
    ? new Date(result.generated_at).toLocaleString()
    : "—";

  const handleReload = () => {
    hasTriggeredLoad.current = true; // prevent effect from re-triggering
    reRunMutation.reset();
    useCachedMutation.reset();
    setResult(null);
    reRunMutation.mutate();
  };

  // Drag handlers for floating panel
  const onTitleMouseDown = (e: React.MouseEvent) => {
    if (variant !== "floating" || (e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startLeft: floatState.x,
      startTop: floatState.y,
    };
  };
  useEffect(() => {
    if (variant !== "floating") return;
    const onMove = (e: MouseEvent) => {
      if (resizeRef.current) {
        const dw = e.clientX - resizeRef.current.startX;
        const dh = e.clientY - resizeRef.current.startY;
        const w = Math.max(320, Math.min(window.innerWidth - 40, resizeRef.current.startW + dw));
        const h = Math.max(240, Math.min(window.innerHeight - 40, resizeRef.current.startH + dh));
        setFloatState((prev) => {
          const next = { ...prev, w, h };
          try {
            localStorage.setItem(FLOATING_STORAGE_KEY, JSON.stringify(next));
          } catch {}
          return next;
        });
        return;
      }
      if (!dragRef.current) return;
      const x = Math.max(0, dragRef.current.startLeft + (e.clientX - dragRef.current.startX));
      const y = Math.max(0, dragRef.current.startTop + (e.clientY - dragRef.current.startY));
      setFloatState((prev) => {
        const next = { ...prev, x, y };
        try {
          localStorage.setItem(FLOATING_STORAGE_KEY, JSON.stringify(next));
        } catch {}
        return next;
      });
    };
    const onUp = () => {
      dragRef.current = null;
      resizeRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [variant]);

  const renderBody = () => (
    <>
      {!symbol ? (
        <p className="text-muted-foreground text-sm mt-4">
          Select a ticker to run analysis.
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          {isLoading || (loadPending && !result) ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">
                {isLoading ? "Loading…" : "Running analysis…"}
              </span>
            </div>
          ) : loadError ? (
            <div className="space-y-3">
              <div className="text-sm text-red-400 rounded bg-red-500/10 p-3 border border-red-500/30">
                <AlertTriangle className="w-4 h-4 inline mr-2" />
                {(reRunMutation.error as Error)?.message ??
                  (useCachedMutation.error as Error)?.message ??
                  "Request failed"}
              </div>
              <Button size="sm" variant="secondary" onClick={handleReload} disabled={reRunMutation.isPending}>
                {reRunMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                Retry
              </Button>
            </div>
          ) : result ? (
            <>
              {result.synthesis.company_description && (
                <div className="text-sm text-muted-foreground italic border-l-2 border-slate-600 pl-3">
                  {result.synthesis.company_description}
                </div>
              )}
              <div className="bg-gradient-to-r from-slate-800/50 to-slate-800/30 rounded-lg p-4 border border-slate-700/50">
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  Executive Summary
                </h3>
                <p className="text-sm text-foreground leading-relaxed">
                  {result.synthesis.executive_summary}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-4 p-3 bg-slate-800/30 rounded-lg border border-slate-700/30">
                <div>
                  <span className="text-xs text-muted-foreground block mb-1">Conviction</span>
                  <ConvictionMeter score={result.synthesis.conviction_score} />
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block mb-1">Action</span>
                  <Badge className={cn("text-sm", getActionColor(result.synthesis.action))}>
                    {result.synthesis.action.replace("_", " ").toUpperCase()}
                  </Badge>
                </div>
                {result.synthesis.model_used && (
                  <div className="ml-auto">
                    <span className="text-xs text-muted-foreground">
                      {result.synthesis.model_used === "fallback" ? "Rule-based" : "AI Generated"}
                    </span>
                  </div>
                )}
              </div>
              {(result.synthesis.key_bullish?.length > 0 || result.synthesis.key_bearish?.length > 0) && (
                <div className="grid grid-cols-2 gap-3">
                  {result.synthesis.key_bullish?.length > 0 && (
                    <div className="p-3 bg-green-500/5 rounded-lg border border-green-500/20">
                      <div className="flex items-center gap-1 text-green-400 text-xs font-medium mb-2">
                        <TrendingUp className="w-3 h-3" /> Bullish
                      </div>
                      <ul className="space-y-1 text-xs">
                        {result.synthesis.key_bullish.map((b, i) => (
                          <li key={i} className="text-muted-foreground">• {b}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {result.synthesis.key_bearish?.length > 0 && (
                    <div className="p-3 bg-red-500/5 rounded-lg border border-red-500/20">
                      <div className="flex items-center gap-1 text-red-400 text-xs font-medium mb-2">
                        <TrendingDown className="w-3 h-3" /> Bearish
                      </div>
                      <ul className="space-y-1 text-xs">
                        {result.synthesis.key_bearish.map((b, i) => (
                          <li key={i} className="text-muted-foreground">• {b}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
              {result.synthesis.conflicts?.length > 0 && (
                <div className="p-3 bg-yellow-500/5 rounded-lg border border-yellow-500/20">
                  <div className="flex items-center gap-1 text-yellow-400 text-xs font-medium mb-2">
                    <AlertTriangle className="w-3 h-3" /> Conflicts
                  </div>
                  <ul className="space-y-1 text-xs">
                    {result.synthesis.conflicts.map((c, i) => (
                      <li key={i} className="text-muted-foreground">• {c}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div>
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                  Analysis Modules ({result.moduleResponses.length})
                </h3>
                <div className="space-y-2">
                  {result.moduleResponses.map((m, i) => (
                    <ModuleCard key={m.module_id} module={m} defaultOpen={i < 2} />
                  ))}
                </div>
              </div>
              <div className="text-xs text-muted-foreground border-t border-slate-700/30 pt-3 flex justify-between">
                <span>Generated: {new Date(result.generated_at).toLocaleString()}</span>
                <span>{result.execution_ms}ms • {result.version}</span>
              </div>
            </>
          ) : null}
        </div>
      )}
    </>
  );

  const headerContent = (
    <>
      <div className="flex items-center gap-3 shrink-0 min-w-0">
        <span className="text-foreground font-semibold truncate">
          {symbol ? `Analysis: ${symbol}` : "Analysis"}
        </span>
        {result && (
          <Badge className={cn("text-xs shrink-0", getActionColor(result.synthesis.action))}>
            {result.synthesis.action.replace("_", " ").toUpperCase()}
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0 text-right">
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          Last analysis: {lastAnalysisLabel}
        </span>
        {result && (
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => printAnalysisAsPdf(result)} title="Download as PDF">
            <FileDown className="w-4 h-4" />
          </Button>
        )}
        {variant === "sheet" && showDetach && symbol && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => {
              if (!openAnalysisPopout(symbol)) {
                toast({ title: "Popup blocked", description: "Please allow popups for this site and try again.", variant: "destructive" });
              }
            }}
            title="Detach to separate window"
          >
            <PanelRightOpen className="w-4 h-4" />
          </Button>
        )}
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleReload} disabled={loadPending} title="Re-run analysis">
          <RefreshCw className={cn("w-4 h-4", loadPending && "animate-spin")} />
        </Button>
        {variant === "floating" && (
          <>
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-8 w-8", floatState.pinned && "text-cyan-400")}
              onClick={() => persistFloatState({ pinned: !floatState.pinned })}
              title={floatState.pinned ? "Unpin (can go behind)" : "Pin (stay on top)"}
            >
              <Pin className={cn("w-4 h-4", floatState.pinned && "fill-current")} />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onOpenChange(false)} title="Close">
              <X className="w-4 h-4" />
            </Button>
          </>
        )}
      </div>
    </>
  );

  if (variant === "floating" && open) {
    return (
      <div
        className={cn(
          "flex flex-col rounded-lg border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden",
          floatState.pinned && "ring-2 ring-cyan-500/50"
        )}
        style={{
          position: "fixed",
          left: floatState.x,
          top: floatState.y,
          width: floatState.w,
          height: floatState.h,
          zIndex: floatState.pinned ? 9999 : 1500,
        }}
      >
        <div
          className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-700 bg-slate-800/80 cursor-grab active:cursor-grabbing select-none"
          onMouseDown={onTitleMouseDown}
        >
          <GripVertical className="w-4 h-4 text-slate-500 shrink-0" />
          {headerContent}
        </div>
        <div className="flex-1 overflow-auto p-4 min-h-0 relative">
          {renderBody()}
        </div>
        <div
          className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize border-l border-t border-slate-600 rounded-tl"
          title="Resize"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            resizeRef.current = {
              startX: e.clientX,
              startY: e.clientY,
              startW: floatState.w,
              startH: floatState.h,
            };
          }}
        />
      </div>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl overflow-y-auto bg-slate-900 border-slate-700"
      >
        <SheetHeader className="flex flex-row items-start justify-between gap-4 space-y-0 pr-12">
          <SheetTitle className="text-foreground flex items-center gap-3 shrink-0">
            {symbol ? `Analysis: ${symbol}` : "Analysis"}
            {result && (
              <Badge className={cn("text-xs", getActionColor(result.synthesis.action))}>
                {result.synthesis.action.replace("_", " ").toUpperCase()}
              </Badge>
            )}
          </SheetTitle>
          <div className="flex items-center gap-2 shrink-0 text-right">
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              Last analysis: {lastAnalysisLabel}
            </span>
            {result && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => printAnalysisAsPdf(result)}
                title="Download as PDF"
              >
                <FileDown className="w-4 h-4" />
              </Button>
            )}
            {showDetach && symbol && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => {
                  if (!openAnalysisPopout(symbol)) {
                    toast({
                      title: "Popup blocked",
                      description: "Please allow popups for this site and try again.",
                      variant: "destructive",
                    });
                  }
                }}
                title="Detach to separate window"
              >
                <PanelRightOpen className="w-4 h-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleReload}
              disabled={loadPending}
              title="Re-run analysis"
            >
              <RefreshCw className={cn("w-4 h-4", loadPending && "animate-spin")} />
            </Button>
          </div>
        </SheetHeader>

        {!symbol ? (
          <p className="text-muted-foreground text-sm mt-4">
            Select a ticker to run analysis.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            {isLoading || (loadPending && !result) ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">
                  {isLoading ? "Loading…" : "Running analysis…"}
                </span>
              </div>
            ) : loadError ? (
              <div className="space-y-3">
                <div className="text-sm text-red-400 rounded bg-red-500/10 p-3 border border-red-500/30">
                  <AlertTriangle className="w-4 h-4 inline mr-2" />
                  {(reRunMutation.error as Error)?.message ??
                    (useCachedMutation.error as Error)?.message ??
                    "Request failed"}
                </div>
                <Button size="sm" variant="secondary" onClick={handleReload} disabled={reRunMutation.isPending}>
                  {reRunMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                  Retry
                </Button>
              </div>
            ) : result ? (
              <>
                {/* Company Description */}
                {result.synthesis.company_description && (
                  <div className="text-sm text-muted-foreground italic border-l-2 border-slate-600 pl-3">
                    {result.synthesis.company_description}
                  </div>
                )}

                {/* Executive Summary */}
                <div className="bg-gradient-to-r from-slate-800/50 to-slate-800/30 rounded-lg p-4 border border-slate-700/50">
                  <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                    Executive Summary
                  </h3>
                  <p className="text-sm text-foreground leading-relaxed">
                    {result.synthesis.executive_summary}
                  </p>
                </div>

                {/* Conviction and Action */}
                <div className="flex flex-wrap items-center gap-4 p-3 bg-slate-800/30 rounded-lg border border-slate-700/30">
                  <div>
                    <span className="text-xs text-muted-foreground block mb-1">
                      Conviction
                    </span>
                    <ConvictionMeter score={result.synthesis.conviction_score} />
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block mb-1">
                      Action
                    </span>
                    <Badge
                      className={cn("text-sm", getActionColor(result.synthesis.action))}
                    >
                      {result.synthesis.action.replace("_", " ").toUpperCase()}
                    </Badge>
                  </div>
                  {result.synthesis.model_used && (
                    <div className="ml-auto">
                      <span className="text-xs text-muted-foreground">
                        {result.synthesis.model_used === "fallback"
                          ? "Rule-based"
                          : "AI Generated"}
                      </span>
                    </div>
                  )}
                </div>

                {/* Key Factors */}
                {(result.synthesis.key_bullish.length > 0 ||
                  result.synthesis.key_bearish.length > 0) && (
                  <div className="grid grid-cols-2 gap-3">
                    {result.synthesis.key_bullish.length > 0 && (
                      <div className="p-3 bg-green-500/5 rounded-lg border border-green-500/20">
                        <div className="flex items-center gap-1 text-green-400 text-xs font-medium mb-2">
                          <TrendingUp className="w-3 h-3" />
                          Bullish
                        </div>
                        <ul className="space-y-1 text-xs">
                          {result.synthesis.key_bullish.map((b, i) => (
                            <li key={i} className="text-muted-foreground">
                              • {b}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {result.synthesis.key_bearish.length > 0 && (
                      <div className="p-3 bg-red-500/5 rounded-lg border border-red-500/20">
                        <div className="flex items-center gap-1 text-red-400 text-xs font-medium mb-2">
                          <TrendingDown className="w-3 h-3" />
                          Bearish
                        </div>
                        <ul className="space-y-1 text-xs">
                          {result.synthesis.key_bearish.map((b, i) => (
                            <li key={i} className="text-muted-foreground">
                              • {b}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {/* Conflicts */}
                {result.synthesis.conflicts.length > 0 && (
                  <div className="p-3 bg-yellow-500/5 rounded-lg border border-yellow-500/20">
                    <div className="flex items-center gap-1 text-yellow-400 text-xs font-medium mb-2">
                      <AlertTriangle className="w-3 h-3" />
                      Conflicts
                    </div>
                    <ul className="space-y-1 text-xs">
                      {result.synthesis.conflicts.map((c, i) => (
                        <li key={i} className="text-muted-foreground">
                          • {c}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Module Cards */}
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                    Analysis Modules ({result.moduleResponses.length})
                  </h3>
                  <div className="space-y-2">
                    {result.moduleResponses.map((m, i) => (
                      <ModuleCard key={m.module_id} module={m} defaultOpen={i < 2} />
                    ))}
                  </div>
                </div>

                {/* Metadata */}
                <div className="text-xs text-muted-foreground border-t border-slate-700/30 pt-3 flex justify-between">
                  <span>
                    Generated: {new Date(result.generated_at).toLocaleString()}
                  </span>
                  <span>{result.execution_ms}ms • {result.version}</span>
                </div>
              </>
            ) : null}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
