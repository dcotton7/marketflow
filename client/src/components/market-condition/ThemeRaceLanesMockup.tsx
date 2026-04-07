/**
 * Phase 1 UI mockup — Theme acceleration race (split left panel).
 * Interactive chrome only; positions derive from theme acceleration vs peers.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ThemeRow, ThemeId, ThemeTier } from "@/data/mockThemeData";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Car,
  HelpCircle,
  Pause,
  Play,
  RotateCcw,
  SkipForward,
} from "lucide-react";

const MOCK_FRAME_COUNT = 48;

function tierBadgeClass(tier: ThemeTier): string {
  switch (tier) {
    case "Macro":
      return "bg-blue-500/20 text-blue-300";
    case "Structural":
      return "bg-purple-500/20 text-purple-300";
    case "Narrative":
      return "bg-cyan-500/20 text-cyan-300";
  }
}

function trackPositionPct(theme: ThemeRow, themes: ThemeRow[]): number {
  const accels = themes.map((t) => t.acceleration);
  const minA = Math.min(...accels);
  const maxA = Math.max(...accels);
  if (maxA === minA) return 50;
  const p = ((theme.acceleration - minA) / (maxA - minA)) * 100;
  return Math.max(4, Math.min(96, p));
}

export interface ThemeRaceLanesMockupProps {
  themes: ThemeRow[];
  selectedTheme: ThemeId | null;
  onThemeSelect: (id: ThemeId) => void;
  totalThemes: number;
  isFetching?: boolean;
}

export function ThemeRaceLanesMockup({
  themes,
  selectedTheme,
  onThemeSelect,
  totalThemes,
  isFetching = false,
}: ThemeRaceLanesMockupProps) {
  const [range, setRange] = useState("3d");
  const [resolution, setResolution] = useState<"intraday" | "daily">("intraday");
  const [speedSec, setSpeedSec] = useState("5");
  const [frameIndex, setFrameIndex] = useState(MOCK_FRAME_COUNT - 1);
  const [playing, setPlaying] = useState(false);

  const totalFrames = MOCK_FRAME_COUNT;
  const isLiveEdge = frameIndex >= totalFrames - 1;

  useEffect(() => {
    if (!playing) return;
    const ms = Math.max(1, parseInt(speedSec, 10) || 5) * 1000;
    const id = window.setInterval(() => {
      setFrameIndex((i) => {
        if (i >= totalFrames - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, ms);
    return () => window.clearInterval(id);
  }, [playing, speedSec, totalFrames]);

  const leaderId = useMemo(() => {
    if (themes.length === 0) return null;
    let best = themes[0];
    for (const t of themes) {
      if (t.acceleration > best.acceleration) best = t;
    }
    return best.id;
  }, [themes]);

  const rangeLabel =
    range === "1d"
      ? "1 day"
      : range === "3d"
        ? "3 days"
        : range === "1w"
          ? "1 week"
          : range === "1mo"
            ? "1 month"
            : range;
  const subtitle =
    resolution === "intraday"
      ? `Intraday race (15m) · last ${rangeLabel} · Play advances one slot every ${speedSec}s (mock timeline)`
      : `Daily race · last ${rangeLabel} · one trading day per step (mock)`;

  const handleRestart = useCallback(() => {
    setPlaying(false);
    setFrameIndex(0);
  }, []);

  const handleLast = useCallback(() => {
    setPlaying(false);
    setFrameIndex(totalFrames - 1);
  }, [totalFrames]);

  return (
    <div className="flex flex-col h-full min-h-0 text-slate-100">
      {/* Control row 1 */}
      <div className="shrink-0 flex flex-wrap items-center gap-2 px-2 py-2 border-b border-slate-700/40 bg-slate-800/30">
        <div className="flex items-center gap-1 min-w-[120px]">
          <span className="text-[10px] uppercase tracking-wide text-slate-500 whitespace-nowrap">
            Range
          </span>
          <Select value={range} onValueChange={setRange}>
            <SelectTrigger className="h-8 w-[100px] text-xs border-slate-600 bg-slate-900/60">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1d">1 day</SelectItem>
              <SelectItem value="3d">3 days</SelectItem>
              <SelectItem value="1w">1 week</SelectItem>
              <SelectItem value="1mo">1 month</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1 min-w-[120px]">
          <span className="text-[10px] uppercase tracking-wide text-slate-500 whitespace-nowrap">
            Frame
          </span>
          <Select
            value={resolution}
            onValueChange={(v) => setResolution(v as "intraday" | "daily")}
          >
            <SelectTrigger className="h-8 w-[110px] text-xs border-slate-600 bg-slate-900/60">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="intraday">15m</SelectItem>
              <SelectItem value="daily">EOD</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1 min-w-[130px]">
          <span className="text-[10px] uppercase tracking-wide text-slate-500 whitespace-nowrap">
            Speed
          </span>
          <Select value={speedSec} onValueChange={setSpeedSec}>
            <SelectTrigger className="h-8 w-[100px] text-xs border-slate-600 bg-slate-900/60">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="2">2s / frame</SelectItem>
              <SelectItem value="5">5s / frame</SelectItem>
              <SelectItem value="10">10s / frame</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 shrink-0">
              <HelpCircle className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs">
            Mockup: cars position by relative acceleration. Timeline and Play are wired for demo;
            historical frames will load from snapshots in Phase 1.
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Control row 2 */}
      <div className="shrink-0 flex flex-wrap items-center gap-2 px-2 py-2 border-b border-slate-700/40 bg-slate-800/20">
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs border-slate-600 bg-slate-900/40"
          onClick={handleRestart}
        >
          <RotateCcw className="w-3 h-3 mr-1" />
          Restart
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs border-slate-600 bg-slate-900/40"
          onClick={() => setPlaying((p) => !p)}
          disabled={isLiveEdge && !playing}
        >
          {playing ? (
            <>
              <Pause className="w-3 h-3 mr-1" />
              Pause
            </>
          ) : (
            <>
              <Play className="w-3 h-3 mr-1" />
              Play
            </>
          )}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs border-slate-600 bg-slate-900/40"
          onClick={handleLast}
        >
          <SkipForward className="w-3 h-3 mr-1" />
          Last
        </Button>
        <span className="text-[10px] text-slate-500 ml-auto">
          {isFetching ? "Refreshing…" : "Idle"}
        </span>
      </div>

      {/* Subtitle */}
      <div className="shrink-0 px-3 py-1.5 text-[11px] text-slate-400 border-b border-slate-700/30 bg-slate-900/40">
        {subtitle}
      </div>

      {/* Scrubber */}
      <div className="shrink-0 px-3 py-3 space-y-1 border-b border-slate-700/40">
        <div className="flex items-center justify-between text-[10px] text-slate-500">
          <span>
            {resolution === "intraday" ? "Wed 2:30p ET" : "Mar 21"} →{" "}
            {resolution === "intraday" ? "Fri 3:45p ET" : "Mar 27"} (mock ticks)
          </span>
          <span className="font-mono text-amber-400/90">
            Frame {frameIndex + 1}/{totalFrames}
          </span>
        </div>
        <Slider
          value={[frameIndex]}
          min={0}
          max={totalFrames - 1}
          step={1}
          onValueChange={(v) => {
            setFrameIndex(v[0] ?? 0);
            setPlaying(false);
          }}
          className="py-1"
        />
        {isLiveEdge && (
          <div className="flex items-center gap-2 pt-1">
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
              {resolution === "intraday"
                ? "Waiting for next 15m snapshot"
                : "Waiting for next daily close"}
            </span>
          </div>
        )}
      </div>

      {/* Track legend */}
      <div className="shrink-0 flex items-center justify-between px-3 py-1 text-[10px] text-slate-500 border-b border-slate-700/40">
        <span>Cooler / slower</span>
        <span className="text-slate-600">— track —</span>
        <span>Hotter / faster</span>
      </div>

      {/* Lanes */}
      <div className="flex-1 overflow-auto p-2 space-y-1.5 min-h-0">
        {themes.map((theme) => {
          const pos = trackPositionPct(theme, themes);
          const isLeader = theme.id === leaderId;
          const pulseLeader = isLiveEdge && isLeader;

          return (
            <Tooltip key={theme.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => onThemeSelect(theme.id)}
                  className={cn(
                    "w-full text-left rounded-md border transition-colors px-2 py-1.5",
                    "border-slate-700/50 bg-slate-800/40 hover:bg-slate-800/70",
                    selectedTheme === theme.id && "ring-2 ring-cyan-400 border-cyan-500/50"
                  )}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={cn(
                        "text-[9px] px-1 rounded shrink-0",
                        tierBadgeClass(theme.tier)
                      )}
                    >
                      {theme.tier[0]}
                    </span>
                    <Car className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="text-xs font-medium truncate flex-1">{theme.name}</span>
                    <span className="text-[10px] text-slate-500 shrink-0">
                      #{theme.rank}/{totalThemes}
                    </span>
                  </div>
                  <div className="relative h-6 rounded bg-black/35 border border-slate-700/40 overflow-visible">
                    <div
                      className="absolute inset-y-0 left-[8%] right-[8%] flex items-center pointer-events-none"
                      aria-hidden
                    >
                      {[0, 25, 50, 75, 100].map((tick) => (
                        <div
                          key={tick}
                          className="absolute top-0 bottom-0 w-px bg-slate-700/50"
                          style={{ left: `${tick}%` }}
                        />
                      ))}
                    </div>
                    <div
                      className={cn(
                        "absolute top-1/2 -translate-y-1/2 -ml-2 z-10 transition-[left] duration-500 ease-out",
                        pulseLeader && "motion-safe:animate-pulse"
                      )}
                      style={{ left: `${pos}%` }}
                    >
                      <Car
                        className={cn(
                          "w-5 h-5 drop-shadow-md",
                          pulseLeader ? "text-amber-400" : "text-cyan-400"
                        )}
                      />
                    </div>
                  </div>
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-xs text-xs">
                <p className="font-semibold">{theme.name}</p>
                <p className="text-muted-foreground mt-1">
                  Mockup lane — full heatmap tooltip in Phase 1. Accel:{" "}
                  {theme.acceleration.toFixed(2)} · FlowScore {theme.score}
                </p>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
