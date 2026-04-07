import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ThemeRow, ThemeId, ThemeTier } from "@/data/mockThemeData";
import type { TimeSlice } from "@/data/mockThemeData";
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
import { ThemeMarketTooltipContent } from "@/components/market-condition/ThemeMarketTooltipContent";
import { getThemeRaceIcon } from "@/components/market-condition/themeRaceIcons";
import { HelpCircle, Pause, Play, RotateCcw, SkipForward } from "lucide-react";

export interface RaceFrameThemeSlice {
  rank: number;
  score: number;
  medianPct: number | null;
  rsVsBenchmark: number | null;
  breadthPct: number | null;
}

export interface RaceTimelineFrame {
  at: string;
  label: string;
  themes: Record<string, RaceFrameThemeSlice>;
}

export interface RaceTimelineResponse {
  range: string;
  resolution: "intraday";
  fromBoundary: string;
  interpretation: "trading" | "calendar";
  terminalState: "LIVE" | "AFTER_HOURS" | "PRE_OPEN" | "CLOSED";
  frames: RaceTimelineFrame[];
}

type RaceViewMode = "race" | "impulse";

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

function liveFramesFromThemes(themes: ThemeRow[]): RaceTimelineFrame[] {
  const themesRecord: Record<string, RaceFrameThemeSlice> = {};
  for (const t of themes) {
    themesRecord[t.id] = {
      rank: t.rank,
      score: t.score,
      medianPct: t.medianPct,
      rsVsBenchmark: t.rsVsSpy,
      breadthPct: t.breadthPct,
    };
  }
  return [
    {
      at: new Date().toISOString(),
      label: "Live",
      themes: themesRecord,
    },
  ];
}

function mergeThemeAtFrame(
  base: ThemeRow,
  frame: RaceTimelineFrame | undefined,
  prevFrame: RaceTimelineFrame | undefined
): ThemeRow {
  if (!frame) return base;
  const slice = frame.themes[base.id];
  const prevSlice = prevFrame?.themes[base.id];
  if (!slice) return base;

  const rs = slice.rsVsBenchmark ?? base.rsVsSpy;
  let acceleration = base.acceleration;
  if (prevSlice && slice.rsVsBenchmark != null && prevSlice.rsVsBenchmark != null) {
    acceleration = slice.rsVsBenchmark - prevSlice.rsVsBenchmark;
  } else if (prevSlice && slice.score != null && prevSlice.score != null) {
    acceleration = (slice.score - prevSlice.score) / 10;
  }

  return {
    ...base,
    rank: slice.rank,
    score: slice.score,
    medianPct: slice.medianPct ?? base.medianPct,
    rsVsSpy: rs,
    breadthPct: slice.breadthPct ?? base.breadthPct,
    acceleration,
  };
}

/** Cross-sectional impulse for frame 0; step delta vs previous frame after. */
function laneImpulse(
  base: ThemeRow,
  slice: RaceFrameThemeSlice | undefined,
  prevSlice: RaceFrameThemeSlice | undefined,
  frameIndex: number
): number {
  if (!slice) return base.acceleration;
  const rs = slice.rsVsBenchmark;
  const prevRs = prevSlice?.rsVsBenchmark;
  if (frameIndex > 0 && rs != null && prevRs != null) {
    return rs - prevRs;
  }
  if (frameIndex > 0) {
    const ds = slice.score - (prevSlice?.score ?? slice.score);
    return ds / 10;
  }
  if (rs != null) return rs;
  return slice.score / 20;
}

function trackPositionPct(impulse: number, impulses: number[]): number {
  if (impulses.length === 0) return 50;
  const minA = Math.min(...impulses);
  const maxA = Math.max(...impulses);
  if (maxA === minA) return 50;
  const p = ((impulse - minA) / (maxA - minA)) * 100;
  return Math.max(4, Math.min(96, p));
}

const TRACK_PAD_PCT = 8;
const TRACK_CENTER_PCT = 50;
const RACE_SMOOTHING_ALPHA = 0.52;

function clampTrackPct(pct: number): number {
  return Math.max(TRACK_PAD_PCT, Math.min(100 - TRACK_PAD_PCT, pct));
}

function adaptiveRaceSmoothingAlpha(raw: number, previousSmoothed: number): number {
  const delta = Math.abs(raw - previousSmoothed);
  if (delta <= 1.5) return 0.84;
  if (delta <= 4) return 0.74;
  if (delta <= 8) return 0.62;
  if (delta <= 14) return 0.54;
  return Math.max(0.42, RACE_SMOOTHING_ALPHA - 0.04);
}

function rankPositionPct(rank: number, totalThemes: number): number {
  if (totalThemes <= 1) return TRACK_CENTER_PCT;
  const raw = ((totalThemes - rank) / (totalThemes - 1)) * 100;
  return clampTrackPct(raw);
}

function scorePercentilePositionPct(
  themeId: ThemeId,
  frame: RaceTimelineFrame | undefined,
  fallbackRank: number,
  totalThemes: number
): number {
  if (!frame) return rankPositionPct(fallbackRank, totalThemes);
  const slice = frame.themes[themeId];
  if (!slice) return rankPositionPct(fallbackRank, totalThemes);

  const scores = Object.values(frame.themes)
    .map((entry) => entry.score)
    .filter((value): value is number => Number.isFinite(value));

  if (scores.length <= 1) return rankPositionPct(slice.rank ?? fallbackRank, totalThemes);

  let below = 0;
  let equal = 0;
  for (const score of scores) {
    if (score < slice.score) below++;
    else if (score === slice.score) equal++;
  }

  const raw = ((below + Math.max(0, equal - 1) * 0.5) / Math.max(1, scores.length - 1)) * 100;
  return clampTrackPct(raw);
}

function smoothedRacePositionPct(
  theme: ThemeRow,
  frames: RaceTimelineFrame[],
  frameIndex: number,
  totalThemes: number
): number {
  if (frames.length === 0) return rankPositionPct(theme.rank, totalThemes);

  let smoothed: number | null = null;
  for (let i = 0; i <= frameIndex; i++) {
    const raw = scorePercentilePositionPct(theme.id, frames[i], theme.rank, totalThemes);
    if (smoothed == null) {
      smoothed = raw;
      continue;
    }
    const alpha = adaptiveRaceSmoothingAlpha(raw, smoothed);
    smoothed = alpha * raw + (1 - alpha) * smoothed;
  }

  return clampTrackPct(smoothed ?? rankPositionPct(theme.rank, totalThemes));
}

function racePositionStats(
  theme: ThemeRow,
  frames: RaceTimelineFrame[],
  frameIndex: number,
  totalThemes: number
) {
  const fallback = rankPositionPct(theme.rank, totalThemes);
  if (frames.length === 0) {
    return {
      current: fallback,
      previous: fallback,
      max: fallback,
    };
  }

  let smoothed: number | null = null;
  let previous = fallback;
  let current = fallback;
  let maxPct = fallback;

  for (let i = 0; i <= frameIndex; i++) {
    const raw = scorePercentilePositionPct(theme.id, frames[i], theme.rank, totalThemes);
    if (smoothed == null) {
      smoothed = raw;
    } else {
      const alpha = adaptiveRaceSmoothingAlpha(raw, smoothed);
      smoothed = alpha * raw + (1 - alpha) * smoothed;
    }
    const clamped = clampTrackPct(smoothed);
    if (i === frameIndex - 1) previous = clamped;
    if (i === frameIndex) current = clamped;
    maxPct = Math.max(maxPct, clamped);
  }

  if (frameIndex === 0) previous = current;

  return {
    current,
    previous,
    max: clampTrackPct(maxPct),
  };
}

function impulseTrackPositionPct(impulse: number, scale: number): number {
  const safeScale = Math.max(0.05, scale);
  const usableHalf = TRACK_CENTER_PCT - TRACK_PAD_PCT;
  const clamped = Math.max(-safeScale, Math.min(safeScale, impulse));
  return clampTrackPct(TRACK_CENTER_PCT + (clamped / safeScale) * usableHalf);
}

function buildImpulseBarStyle(impulse: number, scale: number, brightness: number): { backgroundImage: string } {
  const safeScale = Math.max(0.05, scale);
  const normalized = Math.min(1, Math.abs(impulse) / safeScale);
  const alphaLo = (0.14 + normalized * 0.14) * brightness;
  const alphaHi = (0.7 + normalized * 0.24) * brightness;

  if (impulse >= 0) {
    return {
      backgroundImage: `linear-gradient(to right, rgba(34,197,94,${alphaLo}) 0%, rgba(34,211,238,${alphaHi}) 100%)`,
    };
  }

  return {
    backgroundImage: `linear-gradient(to right, rgba(248,113,113,${alphaHi}) 0%, rgba(249,115,22,${alphaLo}) 100%)`,
  };
}

function buildRaceMovementStyle(score: number, brightness: number): { backgroundImage: string } {
  const tail = scoreToRaceRgb(score);
  const alphaLo = 0.16 * brightness;
  const alphaHi = 0.82 * brightness;
  return {
    backgroundImage: `linear-gradient(to right, rgba(${tail.r},${tail.g},${tail.b},${alphaLo}) 0%, rgba(${tail.r},${tail.g},${tail.b},${alphaHi}) 100%)`,
  };
}

/** Full start/end labels for the scrubber (America/New_York). */
function formatRaceBoundaryLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** RGB tail color aligned with heatmap score bands (ThemeHeatmapGrid getScoreColor). */
function scoreToRaceRgb(score: number): { r: number; g: number; b: number } {
  if (score >= 60) return { r: 34, g: 197, b: 94 }; // green-500
  if (score >= 50) return { r: 234, g: 179, b: 8 }; // yellow-500
  if (score >= 40) return { r: 249, g: 115, b: 22 }; // orange-500
  return { r: 239, g: 68, b: 68 }; // red-500
}

function impulseAtFrameIndex(
  base: ThemeRow,
  frames: RaceTimelineFrame[],
  k: number
): number {
  const f = frames[k];
  if (!f) return base.acceleration;
  const prev = k > 0 ? frames[k - 1] : undefined;
  return laneImpulse(base, f.themes[base.id], prev?.themes[base.id], k);
}

/**
 * RaceColorBar: faded trail left of the car showing historical performance at each snapshot.
 * Colors reflect the theme's actual score at each frame position.
 * Returns { backgroundImage } for inline style.
 */
function buildRaceColorBarStyle(
  theme: ThemeRow,
  frames: RaceTimelineFrame[],
  frameIndex: number,
  scoreForColor: number,
  tailLengthPct: number,
  brightness: number
): { backgroundImage: string } {
  const tail = scoreToRaceRgb(scoreForColor);
  const n = frameIndex + 1;
  const stops: string[] = [];
  
  if (n <= 1 || frames.length <= 1) {
    // First frame or no history: simple gradient based on impulse
    const imp = impulseAtFrameIndex(theme, frames, 0);
    const bias = imp >= 0 ? 1 : imp < 0 ? -1 : 0;
    const r = Math.round(tail.r + bias * 18);
    const g = Math.round(tail.g + bias * 10);
    const b = Math.round(tail.b - bias * 8);
    const a = 0.25 * brightness;
    const a2 = 0.82 * brightness;
    stops.push(`rgba(${r},${g},${b},${a}) 0%`);
    stops.push(`rgba(${tail.r},${tail.g},${tail.b},${a2}) 100%`);
  } else {
    // Multiple frames: show historical snapshot colors with clear transitions
    const denom = Math.max(1, frameIndex);
    const tailStart = Math.max(0, 100 - tailLengthPct);
    
    // Sample fewer points for clearer color segments (every nth frame for performance)
    const sampleStep = Math.max(1, Math.floor(frameIndex / 20)); // Max 20 color stops
    
    for (let k = 0; k <= frameIndex; k += sampleStep) {
      const actualK = Math.min(k, frameIndex); // Don't overshoot
      const t = (actualK / denom) * 100;
      const frame = frames[actualK];
      const slice = frame?.themes[theme.id];
      
      // Use actual score from snapshot for color (fallback to current if missing)
      const frameScore = slice?.score ?? scoreForColor;
      const frameColor = scoreToRaceRgb(frameScore);
      
      const atTail = t >= tailStart;
      
      // Use historical colors throughout, blend with tail color at end
      let r, g, b;
      if (atTail) {
        // Blend historical color with current tail color
        const blendFactor = (t - tailStart) / tailLengthPct;
        r = Math.round(frameColor.r * (1 - blendFactor) + tail.r * blendFactor);
        g = Math.round(frameColor.g * (1 - blendFactor) + tail.g * blendFactor);
        b = Math.round(frameColor.b * (1 - blendFactor) + tail.b * blendFactor);
      } else {
        // Pure historical color
        r = frameColor.r;
        g = frameColor.g;
        b = frameColor.b;
      }
      
      // Alpha increases over time, brightest at current position
      const age = actualK / denom;
      const baseAlpha = atTail 
        ? 0.88 + 0.1 * ((t - tailStart) / tailLengthPct || 0)
        : 0.2 + 0.7 * age; // Increased contrast
      const alpha = baseAlpha * brightness;
      
      stops.push(`rgba(${r},${g},${b},${Math.min(0.98, alpha)}) ${t.toFixed(1)}%`);
    }
    
    // Ensure we have the final frame
    if (frameIndex % sampleStep !== 0) {
      const t = 100;
      stops.push(`rgba(${tail.r},${tail.g},${tail.b},${0.95 * brightness}) ${t}%`);
    }
  }
  return { backgroundImage: `linear-gradient(to right, ${stops.join(", ")})` };
}

export interface ThemeRaceLanesProps {
  themes: ThemeRow[];
  selectedTheme: ThemeId | null;
  onThemeSelect: (id: ThemeId) => void;
  totalThemes: number;
  isFetching?: boolean;
  /** Tooltip copy uses TODAY metrics at the scrubbed frame. */
  tooltipTimeSlice?: TimeSlice;
}

export function ThemeRaceLanes({
  themes,
  selectedTheme,
  onThemeSelect,
  totalThemes,
  isFetching = false,
  tooltipTimeSlice = "TODAY",
}: ThemeRaceLanesProps) {
  const [range, setRange] = useState("5d");
  const [speedSec, setSpeedSec] = useState("2");
  const [viewMode, setViewMode] = useState<RaceViewMode>("race");
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);

  const framesRef = useRef<RaceTimelineFrame[]>([]);

  const { data: raceData, isFetching: raceFetching } = useQuery<RaceTimelineResponse>({
    queryKey: ["/api/market-condition/race-timeline", range],
    queryFn: async () => {
      const p = new URLSearchParams({ range });
      const res = await fetch(`/api/market-condition/race-timeline?${p}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load race timeline");
      return res.json();
    },
    staleTime: 60_000,
    retry: 2,
  });

  const frames = useMemo(() => {
    const f = raceData?.frames;
    if (f && f.length > 0) {
      console.log(`[RaceLanes] Loaded ${f.length} 15-minute frames for ${range}`);
      return f;
    }
    console.log(`[RaceLanes] No snapshots, using live data only (${themes.length} themes)`);
    return liveFramesFromThemes(themes);
  }, [raceData?.frames, themes, range]);

  framesRef.current = frames;

  useEffect(() => {
    setPlaying(false);
    setFrameIndex(Math.max(0, frames.length - 1));
  }, [range, frames.length]);

  const totalFrames = frames.length;
  const safeIndex = Math.min(frameIndex, Math.max(0, totalFrames - 1));
  const currentFrame = frames[safeIndex];
  const prevFrame = safeIndex > 0 ? frames[safeIndex - 1] : undefined;
  const stepDurationMs = Math.max(1, parseInt(speedSec, 10) || 2) * 1000;

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setFrameIndex((i) => {
        const len = framesRef.current.length;
        const max = Math.max(0, len - 1);
        if (i >= max) return i;
        return i + 1;
      });
    }, stepDurationMs);
    return () => window.clearInterval(id);
  }, [playing, stepDurationMs]);

  useEffect(() => {
    if (!playing || totalFrames <= 1) return;
    if (safeIndex >= totalFrames - 1) setPlaying(false);
  }, [playing, safeIndex, totalFrames]);

  const isTerminalFrame = safeIndex >= totalFrames - 1;
  const usingSnapshots = (raceData?.frames?.length ?? 0) > 0;

  const impulses = useMemo(() => {
    return themes.map((t) =>
      laneImpulse(t, currentFrame?.themes[t.id], prevFrame?.themes[t.id], safeIndex)
    );
  }, [themes, currentFrame, prevFrame, safeIndex]);

  const impulseScale = useMemo(() => {
    const magnitudes: number[] = [];
    for (const theme of themes) {
      for (let k = 0; k <= safeIndex; k++) {
        magnitudes.push(Math.abs(impulseAtFrameIndex(theme, frames, k)));
      }
    }
    if (magnitudes.length === 0) return 0.5;
    magnitudes.sort((a, b) => a - b);
    const idx = Math.min(magnitudes.length - 1, Math.floor((magnitudes.length - 1) * 0.9));
    return Math.max(0.15, magnitudes[idx] ?? magnitudes[magnitudes.length - 1] ?? 0.5);
  }, [themes, frames, safeIndex]);

  const mergedRows = useMemo(
    () => themes.map((t) => mergeThemeAtFrame(t, currentFrame, prevFrame)),
    [themes, currentFrame, prevFrame]
  );
  const mergedById = useMemo(() => {
    const m = new Map<ThemeId, ThemeRow>();
    mergedRows.forEach((row) => m.set(row.id, row));
    return m;
  }, [mergedRows]);

  const leaderId = useMemo(() => {
    if (themes.length === 0) return null;
    if (viewMode === "race") {
      let best = mergedRows[0] ?? themes[0];
      for (const row of mergedRows) {
        if (row.rank < best.rank || (row.rank === best.rank && row.score > best.score)) {
          best = row;
        }
      }
      return best.id;
    }
    if (isTerminalFrame) {
      let best = themes[0];
      for (const t of themes) {
        if (t.acceleration > best.acceleration) best = t;
      }
      return best.id;
    }
    let best = themes[0];
    let bestI = laneImpulse(
      best,
      currentFrame?.themes[best.id],
      prevFrame?.themes[best.id],
      safeIndex
    );
    for (let i = 0; i < themes.length; i++) {
      const v = impulses[i] ?? 0;
      if (v > bestI) {
        best = themes[i];
        bestI = v;
      }
    }
    return best.id;
  }, [themes, mergedRows, viewMode, isTerminalFrame, currentFrame, prevFrame, safeIndex, impulses]);

  const rangeLabel =
    range === "1d"
      ? "1 day"
      : range === "2d"
        ? "2 days"
        : range === "3d"
          ? "3 days"
          : range === "4d"
            ? "4 days"
            : range === "5d"
              ? "5 days"
              : range === "2w"
                ? "2 weeks"
                : range === "3w"
                  ? "3 weeks"
                  : range === "1mo"
                    ? "1 month"
                    : range === "3mo"
                      ? "3 months"
                      : range === "6mo"
                        ? "6 months"
                        : range === "1y"
                          ? "1 year"
                          : range;

  const interpretationLabel =
    raceData?.interpretation === "trading" ? "Trading-day window" : "Calendar window";
  const boundaryLabel =
    raceData?.fromBoundary != null
      ? formatRaceBoundaryLabel(raceData.fromBoundary)
      : "—";
  const terminalState = raceData?.terminalState ?? "LIVE";
  const statusLabel =
    terminalState === "LIVE"
      ? "Live"
      : terminalState === "AFTER_HOURS"
        ? "After Hours"
        : terminalState === "PRE_OPEN"
          ? "Before Open"
          : "Closed";
  const statusSummary =
    terminalState === "LIVE"
      ? "Showing the current 15-minute market state."
      : terminalState === "AFTER_HOURS"
        ? "Stopped at the final intraday frame from the regular session."
        : terminalState === "PRE_OPEN"
          ? "Showing the last completed market session until 9:30 AM ET."
          : "Showing the last completed market session.";

  const modeLabel = viewMode === "race" ? "Race" : "Impulse";
  const modeSummary =
    viewMode === "race"
      ? "smoothed leadership progression"
      : "15-minute burst map";
  const subtitle = usingSnapshots
    ? `15-minute intraday ${modeSummary} · default window ${rangeLabel} · ${interpretationLabel} from ${boundaryLabel} · ${speedSec}s per step · ${totalFrames} frames loaded`
    : `No 15-minute snapshot history yet — ${interpretationLabel} starts ${boundaryLabel}. Replay activates once intraday snapshots are saved during market hours.`;

  const canReplay = totalFrames > 1 && safeIndex < totalFrames - 1;
  const playDisabledReason =
    totalFrames <= 1
      ? "Need 15-minute snapshot history to replay"
      : "Press Restart to replay from the first 15-minute frame";

  const handleRestart = useCallback(() => {
    setPlaying(false);
    setFrameIndex(0);
  }, []);

  const handlePlayPause = useCallback(() => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (!canReplay) return;
    setFrameIndex((i) => {
      const max = Math.max(0, framesRef.current.length - 1);
      return i >= max ? i : i + 1;
    });
    setPlaying(true);
  }, [playing, canReplay]);

  const handleLast = useCallback(() => {
    setPlaying(false);
    setFrameIndex(Math.max(0, totalFrames - 1));
  }, [totalFrames]);

  const firstAt = frames[0]?.at;
  const lastAt = frames[totalFrames - 1]?.at;
  const scrubStart =
    firstAt != null ? formatRaceBoundaryLabel(firstAt) : "—";
  const scrubEnd = lastAt != null ? formatRaceBoundaryLabel(lastAt) : "—";

  const scrubTickIndices = useMemo(() => {
    if (totalFrames < 2) return [];
    if (totalFrames === 2) return [0, 1]; // Show start and end for 2 frames
    const maxTicks = 7; // Reduced to fit labels
    const step = Math.max(1, Math.ceil((totalFrames - 1) / maxTicks));
    const out: number[] = [];
    for (let i = 0; i < totalFrames; i += step) out.push(i);
    if (out[out.length - 1] !== totalFrames - 1) out.push(totalFrames - 1);
    return out;
  }, [totalFrames]);

  const formatTickLabel = useCallback((frameAt: string): string => {
    const d = new Date(frameAt);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("en-US", {
      timeZone: "America/New_York",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  }, []);

  const displayFetching = isFetching || raceFetching;

  return (
    <div className="flex flex-col h-full min-h-0 text-slate-100">
      <div className="shrink-0 flex flex-wrap items-center gap-2 px-2 py-2 border-b border-slate-700/40 bg-slate-800/30">
        <div className="flex items-center gap-1 min-w-[120px]">
          <span className="text-[10px] uppercase tracking-wide text-slate-500 whitespace-nowrap">Range</span>
          <Select value={range} onValueChange={setRange}>
            <SelectTrigger className="h-8 w-[100px] text-xs border-slate-600 bg-slate-900/60">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1d">1 day</SelectItem>
              <SelectItem value="2d">2 days</SelectItem>
              <SelectItem value="3d">3 days</SelectItem>
              <SelectItem value="4d">4 days</SelectItem>
              <SelectItem value="5d">5 days</SelectItem>
              <SelectItem value="2w">2 weeks</SelectItem>
              <SelectItem value="3w">3 weeks</SelectItem>
              <SelectItem value="1mo">1 month</SelectItem>
              <SelectItem value="3mo">3 months</SelectItem>
              <SelectItem value="6mo">6 months</SelectItem>
              <SelectItem value="1y">1 year</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1 min-w-[130px]">
          <span className="text-[10px] uppercase tracking-wide text-slate-500 whitespace-nowrap">Speed</span>
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
        <div className="flex items-center gap-1 min-w-[170px]">
          <span className="text-[10px] uppercase tracking-wide text-slate-500 whitespace-nowrap">Mode</span>
          <div className="flex items-center gap-1 rounded-md border border-slate-700/60 bg-slate-900/50 p-1">
            <Button
              type="button"
              variant={viewMode === "race" ? "default" : "ghost"}
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={() => setViewMode("race")}
            >
              Race
            </Button>
            <Button
              type="button"
              variant={viewMode === "impulse" ? "default" : "ghost"}
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={() => setViewMode("impulse")}
            >
              Impulse
            </Button>
          </div>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 shrink-0">
              <HelpCircle className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs">
            {viewMode === "race"
              ? `Race mode smooths each theme's frame percentile so leadership progression reads over time. Icon glow still reflects the current 15-minute burst, but lane position follows the broader move.`
              : `Impulse mode positions lanes by frame-to-frame RS burst, centered on neutral. It is intentionally more reactive so you can see where the latest 15-minute pressure is landing.`}{" "}
            Window uses the same trading-day rules as theme history for short ranges, and the current selection starts at{" "}
            {boundaryLabel}. Each replay step is one stored 15-minute market snapshot.
          </TooltipContent>
        </Tooltip>
      </div>

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
          onClick={handlePlayPause}
          disabled={!playing && !canReplay}
          title={!playing && !canReplay ? playDisabledReason : undefined}
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
        <div className="ml-auto flex items-center gap-2">
          <span
            className={cn(
              "text-[10px] px-2 py-0.5 rounded-full border",
              terminalState === "LIVE" && "bg-green-500/15 text-green-300 border-green-500/30",
              terminalState === "AFTER_HOURS" && "bg-amber-500/15 text-amber-300 border-amber-500/30",
              terminalState === "PRE_OPEN" && "bg-sky-500/15 text-sky-300 border-sky-500/30",
              terminalState === "CLOSED" && "bg-slate-700/40 text-slate-300 border-slate-600/60"
            )}
          >
            {statusLabel}
          </span>
          <span className="text-[10px] text-slate-500">
            {displayFetching ? "Refreshing…" : usingSnapshots ? "15m snapshots" : "Live only"}
          </span>
        </div>
      </div>

      <div className="shrink-0 px-3 py-1.5 text-[11px] text-slate-400 border-b border-slate-700/30 bg-slate-900/40">
        {subtitle}
      </div>

      <div className="shrink-0 px-3 py-1 text-[10px] text-slate-500 border-b border-slate-700/20 bg-slate-900/20">
        {statusSummary}
      </div>

      <div className="shrink-0 px-3 py-3 space-y-1 border-b border-slate-700/40">
        <div className="flex items-center justify-between gap-2 text-[10px] text-slate-500">
          <span className="leading-tight min-w-0">
            <span className="text-slate-400">Start</span>{" "}
            <span className="text-slate-300">{scrubStart}</span>
            <span className="text-slate-600 mx-1">→</span>
            <span className="text-slate-400">End</span>{" "}
            <span className="text-slate-300">{scrubEnd}</span>
          </span>
          <span className="font-mono text-amber-400/90 shrink-0 text-right">
            Frame {safeIndex + 1}/{Math.max(1, totalFrames)}
            {currentFrame?.label ? ` · ${currentFrame.label}` : ""}
          </span>
        </div>
        <div className="relative pt-1 pb-8">
          {totalFrames >= 2 && scrubTickIndices.length > 0 && (
            <div className="relative h-3 mb-0.5 pointer-events-none" aria-hidden>
              {scrubTickIndices.map((fi) => {
                const span = Math.max(1, totalFrames - 1);
                const pct = (fi / span) * 100;
                const frame = frames[fi];
                const tickLabel = frame?.at ? formatTickLabel(frame.at) : "";
                const isFirst = fi === 0;
                const isLast = fi === totalFrames - 1;
                
                return (
                  <div
                    key={fi}
                    className="absolute top-0 -translate-x-1/2"
                    style={{ left: `${pct}%` }}
                  >
                    <div className="w-px h-3 bg-slate-500/60" />
                    {tickLabel && (
                      <div 
                        className={cn(
                          "absolute top-4 text-[9px] text-slate-500 whitespace-nowrap",
                          isFirst && "left-0",
                          isLast && "right-0",
                          !isFirst && !isLast && "-translate-x-1/2"
                        )}
                      >
                        {tickLabel}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <Slider
            value={[safeIndex]}
            min={0}
            max={Math.max(0, totalFrames - 1)}
            step={1}
            onValueChange={(v) => {
              setFrameIndex(v[0] ?? 0);
              setPlaying(false);
            }}
            className="py-1"
          />
        </div>
        {isTerminalFrame && usingSnapshots && (
          <div className="flex items-center gap-2 pt-1">
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
              {terminalState === "LIVE"
                ? "Live edge — next 15-minute snapshot"
                : terminalState === "AFTER_HOURS"
                  ? "After Hours — stopped at market close"
                  : terminalState === "PRE_OPEN"
                    ? "Before Open — showing the last completed market session"
                    : "Closed — showing the last completed market session"}
            </span>
          </div>
        )}
      </div>

      <div className="shrink-0 flex items-center justify-between px-3 py-1 text-[10px] text-slate-500 border-b border-slate-700/40">
        <span>{viewMode === "race" ? "Trailing / lower leadership" : "Cooling / slower"}</span>
        <span className="text-slate-600">{viewMode === "race" ? "— progression —" : "— impulse —"}</span>
        <span>{viewMode === "race" ? "Leading / stronger leadership" : "Hotter / faster"}</span>
      </div>

      <div className="flex-1 overflow-auto p-2 space-y-1.5 min-h-0">
        {themes.map((theme, idx) => {
          const impulse = impulses[idx] ?? theme.acceleration;
          const raceStats = racePositionStats(theme, frames, safeIndex, totalThemes);
          const racePos = raceStats.current;
          const maxRacePos = raceStats.max;
          const prevRacePos = raceStats.previous;
          const pos =
            viewMode === "race"
              ? racePos
              : impulseTrackPositionPct(impulse, impulseScale);
          const isLeader = theme.id === leaderId;
          const pulseLeader =
            isTerminalFrame && terminalState === "LIVE" && isLeader && viewMode === "impulse";
          const merged = mergedById.get(theme.id) ?? theme;
          const RaceIcon = getThemeRaceIcon(theme.id);
          let maxImpMag = 1e-6;
          for (let k = 0; k <= safeIndex; k++) {
            maxImpMag = Math.max(maxImpMag, Math.abs(impulseAtFrameIndex(theme, frames, k)));
          }
          const barBrightness = 0.78 + 0.22 * Math.min(1, Math.abs(impulse) / maxImpMag);

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
                    <span className={cn("text-[9px] px-1 rounded shrink-0", tierBadgeClass(theme.tier))}>
                      {theme.tier[0]}
                    </span>
                    <RaceIcon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="text-xs font-medium truncate flex-1">{theme.name}</span>
                    <span className="text-[10px] text-slate-500 shrink-0">
                      #{merged.rank}/{totalThemes}
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
                      {viewMode === "impulse" && (
                        <div
                          className="absolute top-0 bottom-0 w-px bg-slate-500/70"
                          style={{ left: `${TRACK_CENTER_PCT}%` }}
                        />
                      )}
                    </div>
                    {viewMode === "race" && (
                      <>
                        {maxRacePos > racePos + 0.2 && (
                          <div
                            className="absolute top-1/2 -translate-y-1/2 z-0 h-1.5 rounded-full pointer-events-none"
                            style={{
                              left: `${racePos}%`,
                              width: `${Math.max(1.25, maxRacePos - racePos)}%`,
                              backgroundImage:
                                "linear-gradient(to right, rgba(250, 204, 21, 0.04) 0%, rgba(250, 204, 21, 0.1) 100%)",
                              transitionProperty: "left, width",
                              transitionDuration: `${stepDurationMs}ms`,
                              transitionTimingFunction: "linear",
                            }}
                          />
                        )}
                        <div
                          className="absolute top-1/2 -translate-y-1/2 z-[1] h-px bg-slate-600/50 pointer-events-none"
                          style={{
                            left: `${Math.min(prevRacePos, racePos)}%`,
                            width: `${Math.max(1.5, Math.abs(racePos - prevRacePos))}%`,
                            transitionProperty: "left, width",
                            transitionDuration: `${stepDurationMs}ms`,
                            transitionTimingFunction: "linear",
                          }}
                        />
                        <div
                          className="absolute top-1/2 -translate-y-1/2 -ml-1 z-[2] pointer-events-none"
                          style={{
                            left: `${prevRacePos}%`,
                            transitionProperty: "left",
                            transitionDuration: `${stepDurationMs}ms`,
                            transitionTimingFunction: "linear",
                          }}
                        >
                          <div className="h-2 w-2 rounded-full border border-slate-500/50 bg-slate-800/80" />
                        </div>
                        <div
                          className="BarCurrentLength absolute top-1/2 -translate-y-1/2 z-[1] h-2.5 rounded-sm overflow-hidden pointer-events-none"
                          style={{
                            left: `${Math.max(TRACK_PAD_PCT, racePos - 6)}%`,
                            width: `${Math.min(12, 100 - Math.max(TRACK_PAD_PCT, racePos - 6) - TRACK_PAD_PCT)}%`,
                            minWidth: 8,
                            transitionProperty: "left, width",
                            transitionDuration: `${stepDurationMs}ms`,
                            transitionTimingFunction: "linear",
                          }}
                        >
                          <div
                            className="h-full w-full"
                            style={buildRaceMovementStyle(merged.score, barBrightness)}
                          />
                        </div>
                      </>
                    )}
                    {viewMode === "impulse" && Math.abs(pos - TRACK_CENTER_PCT) > 0.25 && (
                      <div
                        className={cn(
                          "BarCurrentLength absolute top-1/2 -translate-y-1/2 z-[1] h-2.5 overflow-hidden pointer-events-none",
                          viewMode === "impulse" && impulse >= 0 && "rounded-r-sm",
                          viewMode === "impulse" && impulse < 0 && "rounded-l-sm"
                        )}
                        style={{
                          left: `${Math.min(TRACK_CENTER_PCT, pos)}%`,
                          width: `${Math.abs(pos - TRACK_CENTER_PCT)}%`,
                          minWidth: 3,
                        }}
                      >
                        <div
                          className="RaceColorBar h-full w-full"
                          style={
                            buildImpulseBarStyle(impulse, impulseScale, barBrightness)
                          }
                        />
                      </div>
                    )}
                    <div
                      className={cn(
                        "absolute top-1/2 -translate-y-1/2 -ml-2 z-10 transition-[left] ease-linear",
                        pulseLeader && "motion-safe:animate-pulse"
                      )}
                      style={{
                        left: `${pos}%`,
                        transitionDuration: `${stepDurationMs}ms`,
                      }}
                    >
                      <RaceIcon
                        className={cn(
                          "w-5 h-5 drop-shadow-md",
                          pulseLeader ? "text-amber-400" : "text-cyan-400"
                        )}
                      />
                    </div>
                  </div>
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-md">
                <ThemeMarketTooltipContent
                  theme={merged}
                  timeSlice={tooltipTimeSlice}
                  total={totalThemes}
                  displayPct={merged.medianPct}
                  isComp={false}
                />
                <div className="mt-2 border-t border-slate-700/50 pt-2 text-[10px] text-slate-400">
                  <span className="font-medium text-slate-300">{modeLabel}</span>{" "}
                  {viewMode === "race"
                    ? "lane position uses smoothed leadership percentile; pulse still reflects the current 15-minute burst."
                    : "lane position uses the current 15-minute burst relative to neutral."}
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
