import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useQueries } from "@tanstack/react-query";
import type { ThemeId, ThemeRow, SizeFilter } from "@/data/mockThemeData";
import type { ThemeMetrics } from "@/hooks/useMarketCondition";
import { cn } from "@/lib/utils";
import { getRoutePulseTone } from "@/lib/pulse-scale";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronUp, GripVertical, Info, X } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSentinelAuth } from "@/context/SentinelAuthContext";
import { FlowMapFontSizeControl } from "./FlowMapFontSizeControl";
import { ThemeColorChip } from "@/components/theme/ThemeColorChip";
import { localSlotBgStyle } from "@/lib/local-slot-style";
import {
  loadFlowMapFontPrefs,
  saveFlowMapFontPrefs,
  type FlowMapFontPrefs,
  type FlowMapFontSection,
} from "./flow-map-font-prefs";

type TfKey = "current" | "m15" | "h1" | "h4" | "d1" | "d5" | "d10" | "m1";
type SortKey =
  | "theme"
  | "strength"
  | "perf:current"
  | "perf:m15"
  | "perf:h1"
  | "perf:h4"
  | "perf:d1"
  | "perf:d5"
  | "perf:d10"
  | "perf:m1";

const TIMEFRAMES: Array<{
  key: TfKey;
  label: string;
  apiSlice: "TODAY" | "15M" | "1H" | "4H" | "1D" | "5D" | "10D" | "1M";
}> = [
  { key: "current", label: "NOW", apiSlice: "TODAY" },
  { key: "m15", label: "15m", apiSlice: "15M" },
  { key: "h1", label: "1h", apiSlice: "1H" },
  { key: "h4", label: "4h", apiSlice: "4H" },
  { key: "d1", label: "1d", apiSlice: "1D" },
  { key: "d5", label: "5d", apiSlice: "5D" },
  { key: "d10", label: "10d", apiSlice: "10D" },
  { key: "m1", label: "1Mo", apiSlice: "1M" },
];

/** YYYY-MM-DD in US Eastern — baseline "freshness" must use session calendar, not UTC `toISOString()` dates. */
function etCalendarYmd(isoOrDate: string | Date): string | null {
  const d = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

interface FlowRoute {
  from: ThemeId;
  to: ThemeId;
  score: number;
  rsDelta: number;
  breadthDelta: number;
  volumeDelta: number;
}

export interface FlowMapFocusData {
  focusedTheme: ThemeId | null;
  activeLabel: string;
  baselineLabel: string | null;
  topInflows: Array<{ from: ThemeId; to: ThemeId; score: number }>;
  topOutflows: Array<{ from: ThemeId; to: ThemeId; score: number }>;
  selectedRoute: FlowRoute | null;
}

interface SliceData {
  rows: ThemeRow[];
  lastUpdated: string | null;
  comparisonTime: string | null;
  comparisonUnavailable: string | null;
}

interface HelpOverlayLayout {
  left: number;
  top: number;
  w: number;
  h: number;
}

interface FlowMapPanelProps {
  selectedTheme: ThemeId | null;
  onThemeSelect: (themeId: ThemeId) => void;
  sizeFilter: SizeFilter;
  onFocusDataChange?: (data: FlowMapFocusData) => void;
}

interface HeaderSelection {
  axis: "row" | "col";
  themeId: ThemeId;
}

const FLOW_MAP_HELP_LAYOUT_KEY = "flow-map-help-overlay-layout-v1";
const DEFAULT_HELP_LAYOUT: HelpOverlayLayout = {
  left: 24,
  top: 96,
  w: 820,
  h: 680,
};

const FLOW_MAP_HELP_SECTIONS: Array<{
  title: string;
  paragraphs: string[];
  bullets?: string[];
}> = [
  {
    title: "What Flow Map Shows",
    paragraphs: [
      "Flow Map is a directional theme-to-theme rotation table. It does not simply show whether a theme is up or down on its own. Instead, it shows how one theme is behaving relative to another.",
      "Every matrix cell should be read as Row Theme -> Column Theme. The theme on the left is the source of the comparison. The theme at the top is the destination. The cell asks whether the destination theme is stronger or weaker than the source theme in the current Flow Map context.",
    ],
  },
  {
    title: "How To Read Rows And Columns",
    paragraphs: [
      "The row tells you which theme the comparison starts from. The column tells you which theme the comparison points to. That means direction matters. AI Infra -> Semis is not the same relationship as Semis -> AI Infra.",
      "The matrix is repeatedly answering one question: compared with the row theme, is the column theme gaining or losing relative leadership?",
    ],
  },
  {
    title: "Exactly What The Colors Mean",
    paragraphs: [
      "The color of each cell represents the direction and size of the route score for that specific row-to-column relationship.",
      "Green means the destination theme is stronger than the source theme in that pairwise comparison. Red means the destination theme is weaker than the source theme. A faint cell means the model sees little edge either way or the relationship is relatively balanced.",
      "Color intensity shows conviction. Light green means only a small positive edge for the destination theme. Strong green means a larger positive edge. Light red means only a small negative edge. Strong red means the destination theme is meaningfully weaker than the source theme.",
    ],
    bullets: [
      "Green: destination theme is winning the relative comparison",
      "Red: destination theme is losing the relative comparison",
      "Darker color: stronger relative edge",
      "Fainter color: weaker or more balanced relationship",
    ],
  },
  {
    title: "Exactly What The Numbers Mean",
    paragraphs: [
      "The numbers inside the matrix cells are not percentages. They are Flow Route Scores. They are normalized directional scores from -0.99 to +0.99.",
      "A positive number means the destination theme is stronger than the source theme. A negative number means the destination theme is weaker than the source theme. A value near zero means the model sees little relative edge either way.",
      "Use the magnitude as a confidence guide. A value around +0.05 means only a slight positive edge. A value around +0.25 means a modest but meaningful edge. A value around +0.50 means a clear relative advantage. The same logic applies in reverse for negative values.",
    ],
    bullets: [
      "+0.25: destination theme has a modest positive edge over the source theme",
      "+0.50 or higher: destination theme is clearly winning the relative comparison",
      "-0.25: destination theme is modestly weaker than the source theme",
      "-0.50 or lower: destination theme is clearly losing the relative comparison",
    ],
  },
  {
    title: "What Drives The Route Score",
    paragraphs: [
      "The route score is a weighted blend of four destination-versus-source comparisons: overall theme strength score, rank-change difference, relative strength difference, and breadth difference.",
      "In plain English, the model is asking whether the destination theme is stronger, improving faster, acting better versus the benchmark, and showing broader participation than the source theme.",
    ],
    bullets: [
      "45%: overall strength score difference",
      "20%: rank-change difference",
      "20%: relative-strength difference",
      "15%: breadth difference",
    ],
  },
  {
    title: "What Compare Changes",
    paragraphs: [
      "With Compare off, the matrix shows the route score for the active snapshot. With Compare on, the matrix changes meaning and shows Current Route Score - Active Snapshot Route Score.",
      "In Compare mode, a positive value means that row-to-column relationship is stronger now than it was at the selected baseline. A negative value means that relationship is weaker now than it was at the selected baseline.",
    ],
  },
  {
    title: "What Row Selection Changes",
    paragraphs: [
      "Selecting a row turns that row into a current-flow strip across all destination themes. That lets you focus on where one specific source theme is strongest or weakest right now.",
      "This is useful when you want to answer questions like: where is this theme rotating now, which destinations are strongest for it, and which themes are outranking it right now.",
    ],
  },
];

function clampHelpOverlayLayout(layout: HelpOverlayLayout): HelpOverlayLayout {
  if (typeof window === "undefined") return layout;
  const margin = 16;
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  const minW = Math.min(540, Math.max(420, viewportW - margin * 2));
  const minH = Math.min(360, Math.max(280, viewportH - margin * 2));
  const maxW = Math.max(minW, viewportW - margin * 2);
  const maxH = Math.max(minH, viewportH - margin * 2);
  const w = Math.min(Math.max(layout.w, minW), maxW);
  const h = Math.min(Math.max(layout.h, minH), maxH);
  const left = Math.min(Math.max(layout.left, margin), Math.max(margin, viewportW - w - margin));
  const top = Math.min(Math.max(layout.top, margin), Math.max(margin, viewportH - h - margin));
  return { left, top, w, h };
}

function loadHelpOverlayLayout(): HelpOverlayLayout {
  if (typeof window === "undefined") return DEFAULT_HELP_LAYOUT;
  try {
    const raw = window.localStorage.getItem(FLOW_MAP_HELP_LAYOUT_KEY);
    if (!raw) return clampHelpOverlayLayout(DEFAULT_HELP_LAYOUT);
    const parsed = JSON.parse(raw) as Partial<HelpOverlayLayout>;
    if (
      typeof parsed.left !== "number" ||
      typeof parsed.top !== "number" ||
      typeof parsed.w !== "number" ||
      typeof parsed.h !== "number"
    ) {
      return clampHelpOverlayLayout(DEFAULT_HELP_LAYOUT);
    }
    return clampHelpOverlayLayout({
      left: parsed.left,
      top: parsed.top,
      w: parsed.w,
      h: parsed.h,
    });
  } catch {
    return clampHelpOverlayLayout(DEFAULT_HELP_LAYOUT);
  }
}

function persistHelpOverlayLayout(layout: HelpOverlayLayout) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(FLOW_MAP_HELP_LAYOUT_KEY, JSON.stringify(layout));
}

function InlineInfoTooltip({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            "inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-600/60 bg-slate-800/60 text-slate-300 transition-colors hover:border-cyan-400/60 hover:text-cyan-200",
            className
          )}
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-sm text-pretty text-xs leading-relaxed">
        {children}
      </TooltipContent>
    </Tooltip>
  );
}

function truncateHeadlineLabel(value: string, maxChars = 18): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(1, maxChars - 2))}..`;
}

/** Short label for matrix column/row headers — full name stays in title/tooltip. */
function shortThemeLabel(name: string, compact: boolean): string {
  const max = compact ? 10 : 14;
  if (name.length <= max) return name;
  const slash = name.indexOf(" / ");
  if (slash > 0) {
    const head = name.slice(0, slash).trim();
    if (head.length <= max + 2) return head;
  }
  return truncateHeadlineLabel(name, max);
}

function fixedColStyle(width: number, left?: number): CSSProperties {
  return {
    width,
    minWidth: width,
    maxWidth: width,
    ...(left !== undefined ? { left } : {}),
  };
}

function toThemeRow(theme: ThemeMetrics): ThemeRow {
  return {
    id: theme.id as ThemeId,
    name: theme.name,
    tier: theme.tier,
    medianPct: theme.medianPct,
    score: theme.score,
    baseScore: theme.baseScore,
    breadthPct: theme.breadthPct,
    pctAbove50d: theme.pctAbove50d,
    pctAbove200d: theme.pctAbove200d,
    rsVsSpy: theme.rsVsBenchmark ?? theme.rsVsSpy ?? 0,
    volExp: theme.volExp ?? 1,
    acceleration: theme.acceleration,
    accDistDays: theme.accDistDays ?? 0,
    rank: theme.rank,
    deltaRank: theme.deltaRank,
    percentile: theme.percentile,
    penaltyFactor: theme.penaltyFactor,
    narrowLeadershipMultiplier: theme.narrowLeadershipMultiplier,
    reasonCodes: theme.reasonCodes as ThemeRow["reasonCodes"],
    coreCount: theme.coreCount,
    leaderCount: theme.greenCount,
    top3Contribution: theme.top3Contribution,
    top3Concentration: theme.top3Concentration ?? 0,
    isNarrowLeadership: theme.isNarrowLeadership ?? false,
    trendState: theme.trendState,
    bullCount: theme.bullCount,
    transitionCount: theme.transitionCount,
    bearCount: theme.bearCount,
    etfProxies: theme.etfProxies as ThemeRow["etfProxies"],
    historicalMetrics: theme.historicalMetrics,
  };
}

async function fetchThemeSlice(apiSlice: string, sizeFilter: SizeFilter): Promise<SliceData> {
  const params = new URLSearchParams();
  params.set("timeSlice", apiSlice);
  params.set("sizeFilter", sizeFilter);
  if (apiSlice === "TODAY") {
    // In Flow Map, "Current" should represent movement from today's open.
    params.set("useIntradayBaseline", "true");
  }
  const res = await fetch(`/api/market-condition/themes?${params.toString()}`);
  if (!res.ok) throw new Error(`Failed loading ${apiSlice}`);
  const json = await res.json();
  const list: ThemeMetrics[] = Array.isArray(json?.themes) ? json.themes : [];
  return {
    rows: list.map(toThemeRow),
    lastUpdated: typeof json?.lastUpdated === "string" ? json.lastUpdated : null,
    comparisonTime: typeof json?.comparisonTime === "string" ? json.comparisonTime : null,
    comparisonUnavailable: typeof json?.comparisonUnavailable === "string" ? json.comparisonUnavailable : null,
  };
}

function clamp(v: number, low: number, high: number) {
  return Math.max(low, Math.min(high, v));
}

function computeRouteFromMap(from: ThemeId, to: ThemeId, map: Map<ThemeId, ThemeRow>): FlowRoute {
  const fs = map.get(from);
  const ts = map.get(to);
  if (!fs || !ts) {
    return { from, to, score: 0, rsDelta: 0, breadthDelta: 0, volumeDelta: 0 };
  }

  const rawScore =
    ((ts.score - fs.score) / 100) * 0.45 +
    ((ts.deltaRank - fs.deltaRank) / 20) * 0.2 +
    ((ts.rsVsSpy - fs.rsVsSpy) / 8) * 0.2 +
    ((ts.breadthPct - fs.breadthPct) / 100) * 0.15;

  return {
    from,
    to,
    score: clamp(rawScore, -0.99, 0.99),
    rsDelta: ts.rsVsSpy - fs.rsVsSpy,
    breadthDelta: ts.breadthPct - fs.breadthPct,
    volumeDelta: ts.volExp - fs.volExp,
  };
}

function routeDiff(currentRoute: FlowRoute, baseRoute: FlowRoute): FlowRoute {
  return {
    from: currentRoute.from,
    to: currentRoute.to,
    score: clamp(currentRoute.score - baseRoute.score, -0.99, 0.99),
    rsDelta: currentRoute.rsDelta - baseRoute.rsDelta,
    breadthDelta: currentRoute.breadthDelta - baseRoute.breadthDelta,
    volumeDelta: currentRoute.volumeDelta - baseRoute.volumeDelta,
  };
}

export function FlowMapPanel({
  selectedTheme,
  onThemeSelect,
  sizeFilter,
  onFocusDataChange,
}: FlowMapPanelProps) {
  const { user } = useSentinelAuth();
  const helpPanelRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const flowMapTableScrollRef = useRef<HTMLDivElement | null>(null);
  const initialThemeSelectDoneRef = useRef(false);
  const helpMoveDragRef = useRef<{
    startX: number;
    startY: number;
    startLeft: number;
    startTop: number;
  } | null>(null);
  const helpResizeDragRef = useRef<{
    startX: number;
    startY: number;
    startW: number;
    startH: number;
  } | null>(null);

  const [activeTf, setActiveTf] = useState<TfKey>("current");
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [showPerfCols, setShowPerfCols] = useState(true);
  const isPerfVisible = (tf: TfKey) => tf === "current" || visiblePerfCols.has(tf);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpLayout, setHelpLayout] = useState<HelpOverlayLayout>(() => loadHelpOverlayLayout());

  const [visiblePerfCols, setVisiblePerfCols] = useState<Set<TfKey>>(new Set(TIMEFRAMES.map((tf) => tf.key)));
  const [sortKey, setSortKey] = useState<SortKey>("strength");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [headerSelection, setHeaderSelection] = useState<HeaderSelection | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<{ from: ThemeId; to: ThemeId } | null>(null);
  const [panelSize, setPanelSize] = useState({ w: 1200, h: 800 });
  const [detailsExpanded, setDetailsExpanded] = useState(true);
  const [fontPrefs, setFontPrefs] = useState<FlowMapFontPrefs>(() =>
    loadFlowMapFontPrefs(undefined)
  );

  const isCompact = panelSize.w < 720 || panelSize.h < 520;
  const showDetailCards = detailsExpanded || !isCompact;

  useEffect(() => {
    setFontPrefs(loadFlowMapFontPrefs(user?.id));
  }, [user?.id]);

  const setFontSection = useCallback(
    (section: FlowMapFontSection, px: number) => {
      setFontPrefs((prev) => {
        const next = { ...prev, [section]: px };
        saveFlowMapFontPrefs(user?.id, next);
        return next;
      });
    },
    [user?.id]
  );

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setPanelSize({ w: rect.width, h: rect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (isCompact) setDetailsExpanded(false);
  }, [isCompact]);

  const queries = useQueries({
    queries: TIMEFRAMES.map((tf) => ({
      queryKey: ["flow-map", "themes", tf.apiSlice, sizeFilter],
      queryFn: () => fetchThemeSlice(tf.apiSlice, sizeFilter),
      staleTime: 30_000,
      refetchInterval: tf.key === "current" ? 60_000 : false,
    })),
  });

  const isLoading = queries.some((q) => q.isLoading);
  const dataByTf = useMemo(() => {
    const empty: SliceData = { rows: [], lastUpdated: null, comparisonTime: null, comparisonUnavailable: null };
    const out: Record<TfKey, SliceData> = {
      current: empty,
      m15: empty,
      h1: empty,
      h4: empty,
      d1: empty,
      d5: empty,
      d10: empty,
      m1: empty,
    };
    TIMEFRAMES.forEach((tf, idx) => {
      out[tf.key] = (queries[idx].data ?? empty) as SliceData;
    });
    return out;
  }, [queries]);

  const mapsByTf = useMemo(() => {
    const out = {} as Record<TfKey, Map<ThemeId, ThemeRow>>;
    TIMEFRAMES.forEach((tf) => {
      out[tf.key] = new Map((dataByTf[tf.key]?.rows ?? []).map((r) => [r.id as ThemeId, r]));
    });
    return out;
  }, [dataByTf]);

  const activeRows = dataByTf[activeTf]?.rows ?? [];
  const activeMap = mapsByTf[activeTf];
  const currentMap = mapsByTf.current;

  const themeIds = useMemo<ThemeId[]>(() => activeRows.map((r) => r.id as ThemeId), [activeRows]);

  const tableLayout = useMemo(() => {
    const themeCol = isCompact ? 108 : 168;
    const strengthCol = isCompact ? 44 : 64;
    const nowCol = isCompact ? 48 : 72;
    const perfCol = isCompact ? 40 : 52;
    const matrixCol = isCompact ? 36 : 48;
    const strengthLeft = themeCol;
    const nowLeft = themeCol + strengthCol;
    const perfVisibleCount = showPerfCols
      ? TIMEFRAMES.filter((tf) => tf.key !== "current" && visiblePerfCols.has(tf.key)).length
      : 0;
    const minWidth =
      themeCol + strengthCol + nowCol + perfVisibleCount * perfCol + themeIds.length * matrixCol;
    return {
      themeCol,
      strengthCol,
      nowCol,
      perfCol,
      matrixCol,
      strengthLeft,
      nowLeft,
      minWidth,
      cellPad: isCompact ? "p-0.5" : "p-1",
      headerPad: isCompact ? "px-0.5 py-1" : "px-1 py-1.5",
    };
  }, [isCompact, showPerfCols, visiblePerfCols, themeIds.length]);
  const selectedRow = headerSelection?.axis === "row" ? headerSelection.themeId : null;
  const selectedCol = headerSelection?.axis === "col" ? headerSelection.themeId : null;

  const focusedTheme = useMemo<ThemeId | null>(() => {
    if (selectedRoute && themeIds.includes(selectedRoute.to)) return selectedRoute.to;
    if (selectedRow && themeIds.includes(selectedRow)) return selectedRow;
    if (selectedCol && themeIds.includes(selectedCol)) return selectedCol;
    if (selectedTheme && themeIds.includes(selectedTheme)) return selectedTheme;
    return themeIds[0] ?? null;
  }, [selectedRoute, selectedRow, selectedCol, selectedTheme, themeIds]);

  useEffect(() => {
    if (activeTf === "current" && compareEnabled) {
      setCompareEnabled(false);
    }
  }, [activeTf, compareEnabled]);

  useEffect(() => {
    if (!helpOpen) return;
    const onWindowResize = () => {
      setHelpLayout((prev) => {
        const next = clampHelpOverlayLayout(prev);
        persistHelpOverlayLayout(next);
        return next;
      });
    };
    window.addEventListener("resize", onWindowResize);
    return () => window.removeEventListener("resize", onWindowResize);
  }, [helpOpen]);

  // Only sync parent selection when the user picks a row/column/route — not on load fallback.
  useEffect(() => {
    if (!focusedTheme || focusedTheme === selectedTheme) return;
    const focusFromMatrix = !!(selectedRow || selectedCol || selectedRoute);
    if (!focusFromMatrix) return;
    onThemeSelect(focusedTheme);
    setHeaderSelection({ axis: "row", themeId: focusedTheme });
    setSelectedRoute(null);
  }, [focusedTheme, selectedTheme, selectedRow, selectedCol, selectedRoute, onThemeSelect]);

  const getStrength = (id: ThemeId) => {
    const active = activeMap.get(id)?.score ?? 0;
    if (!compareEnabled || activeTf === "current") return active;
    const current = currentMap.get(id)?.score ?? 0;
    return current - active;
  };

  const getPerf = (id: ThemeId, tf: TfKey) => {
    const intradayOpenCheckpointTfs: TfKey[] = ["m15", "h1", "h4"];
    const tfTheme = mapsByTf[tf].get(id);
    const tfNow = tfTheme?.medianPct ?? 0;
    const tfBase = tfTheme?.historicalMetrics?.medianPct;

    const nowMinusTfBaseline =
      tf === "current" ? Number.NaN : (typeof tfBase === "number" ? tfNow - tfBase : Number.NaN);
    const openNow = currentMap.get(id)?.medianPct ?? Number.NaN;

    // Intraday trend view (compare off): show checkpoint vs open.
    // Example: 15m column = open->15mAgo = open->now - (now->15mAgo).
    const tfPerf =
      tf === "current"
        ? openNow
        : intradayOpenCheckpointTfs.includes(tf)
          ? (Number.isFinite(openNow) && Number.isFinite(nowMinusTfBaseline) ? openNow - nowMinusTfBaseline : Number.NaN)
          : nowMinusTfBaseline;

    if (!compareEnabled || activeTf === "current") return tfPerf;

    const activeTheme = activeMap.get(id);
    const activeNow = activeTheme?.medianPct ?? 0;
    const activeBase = activeTheme?.historicalMetrics?.medianPct;
    const activePerf =
      activeTf === "current" ? activeNow : (typeof activeBase === "number" ? activeNow - activeBase : Number.NaN);
    if (!Number.isFinite(tfPerf) || !Number.isFinite(activePerf)) return Number.NaN;
    return tfPerf - activePerf;
  };

  const getRoute = (from: ThemeId, to: ThemeId): FlowRoute => {
    // Row toggle override: selected rows always show current flow for that row.
    if (selectedRow === from) {
      return computeRouteFromMap(from, to, currentMap);
    }

    const activeRoute = computeRouteFromMap(from, to, activeMap);
    if (!compareEnabled || activeTf === "current") return activeRoute;
    const currentRoute = computeRouteFromMap(from, to, currentMap);
    return routeDiff(currentRoute, activeRoute);
  };

  const allRoutes = useMemo(() => {
    const routes: FlowRoute[] = [];
    for (const from of themeIds) {
      for (const to of themeIds) {
        if (from === to) continue;
        routes.push(getRoute(from, to));
      }
    }
    return routes;
  }, [themeIds, selectedRow, compareEnabled, activeTf, activeMap, currentMap]);

  const topInflows = useMemo(() => {
    if (!focusedTheme) return [];
    return allRoutes.filter((r) => r.to === focusedTheme).sort((a, b) => b.score - a.score).slice(0, 5);
  }, [allRoutes, focusedTheme]);

  const topOutflows = useMemo(() => {
    if (!focusedTheme) return [];
    return allRoutes.filter((r) => r.from === focusedTheme).sort((a, b) => b.score - a.score).slice(0, 5);
  }, [allRoutes, focusedTheme]);

  const selectedRouteDetail = useMemo(() => {
    if (!selectedRoute) return null;
    return getRoute(selectedRoute.from, selectedRoute.to);
  }, [selectedRoute, selectedRow, compareEnabled, activeTf, activeMap, currentMap]);

  useEffect(() => {
    const activeLabel = TIMEFRAMES.find((t) => t.key === activeTf)?.label ?? activeTf;
    onFocusDataChange?.({
      focusedTheme,
      activeLabel: compareEnabled && activeTf !== "current" ? "Current" : activeLabel,
      baselineLabel: compareEnabled && activeTf !== "current" ? activeLabel : null,
      topInflows: topInflows.map((r) => ({ from: r.from, to: r.to, score: r.score })),
      topOutflows: topOutflows.map((r) => ({ from: r.from, to: r.to, score: r.score })),
      selectedRoute: selectedRouteDetail,
    });
  }, [focusedTheme, activeTf, compareEnabled, topInflows, topOutflows, selectedRouteDetail, onFocusDataChange]);

  const orderedThemes = useMemo(() => {
    const arr = [...themeIds];
    arr.sort((a, b) => {
      let av: string | number = 0;
      let bv: string | number = 0;
      if (sortKey === "theme") {
        av = activeMap.get(a)?.name ?? a;
        bv = activeMap.get(b)?.name ?? b;
      } else if (sortKey === "strength") {
        av = getStrength(a);
        bv = getStrength(b);
      } else {
        const tf = sortKey.replace("perf:", "") as TfKey;
        av = getPerf(a, tf);
        bv = getPerf(b, tf);
      }
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const anv = Number.isFinite(av as number) ? (av as number) : Number.NEGATIVE_INFINITY;
      const bnv = Number.isFinite(bv as number) ? (bv as number) : Number.NEGATIVE_INFINITY;
      return sortDir === "asc" ? anv - bnv : bnv - anv;
    });
    return arr;
  }, [themeIds, sortKey, sortDir, activeTf, compareEnabled, selectedRow, activeMap, mapsByTf, currentMap]);

  useEffect(() => {
    if (isLoading) initialThemeSelectDoneRef.current = false;
  }, [isLoading]);

  // Auto-select the top row in the left theme list (first visible row, not API/mock array order).
  useEffect(() => {
    if (isLoading || orderedThemes.length === 0) return;

    const topRow = orderedThemes[0];

    if (!initialThemeSelectDoneRef.current) {
      initialThemeSelectDoneRef.current = true;
      setHeaderSelection({ axis: "row", themeId: topRow });
      setSelectedRoute(null);
      if (selectedTheme !== topRow) onThemeSelect(topRow);
      return;
    }

    const themeInList = !!(selectedTheme && orderedThemes.includes(selectedTheme));
    const rowHighlighted = !!(selectedRow && orderedThemes.includes(selectedRow));

    if (!themeInList) {
      setHeaderSelection({ axis: "row", themeId: topRow });
      setSelectedRoute(null);
      if (selectedTheme !== topRow) onThemeSelect(topRow);
      return;
    }

    if (!rowHighlighted && !selectedRoute && !selectedCol) {
      setHeaderSelection({ axis: "row", themeId: selectedTheme });
    }
  }, [
    isLoading,
    orderedThemes,
    selectedTheme,
    selectedRow,
    selectedRoute,
    selectedCol,
    onThemeSelect,
  ]);

  const focusThemeRowInView = useCallback((themeId: ThemeId) => {
    const root = flowMapTableScrollRef.current;
    if (!root) return;
    const row = root.querySelector(`[data-flow-theme-row="${CSS.escape(themeId)}"]`);
    row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);

  const onFlowMapTableAreaPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (t.closest("button, input, textarea, select, a, [role='button'], label")) return;
    flowMapTableScrollRef.current?.focus({ preventScroll: true });
  }, []);

  const onFlowMapThemeListKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (helpOpen) return;
      const key = e.key;
      if (key !== "ArrowDown" && key !== "ArrowUp" && key !== " ") return;
      if (orderedThemes.length === 0) return;

      let anchor: ThemeId | null = selectedRow ?? focusedTheme;
      if (!anchor || orderedThemes.indexOf(anchor) < 0) {
        anchor = orderedThemes[0] ?? null;
      }
      if (!anchor) return;

      const idx = orderedThemes.indexOf(anchor);
      if (key === "ArrowUp") {
        e.preventDefault();
        const nextIdx = Math.max(0, idx - 1);
        const next = orderedThemes[nextIdx];
        setHeaderSelection({ axis: "row", themeId: next });
        onThemeSelect(next);
        setSelectedRoute(null);
        requestAnimationFrame(() => focusThemeRowInView(next));
        return;
      }

      e.preventDefault();
      const nextIdx = Math.min(orderedThemes.length - 1, idx + 1);
      const next = orderedThemes[nextIdx];
      setHeaderSelection({ axis: "row", themeId: next });
      onThemeSelect(next);
      setSelectedRoute(null);
      requestAnimationFrame(() => focusThemeRowInView(next));
    },
    [helpOpen, orderedThemes, selectedRow, focusedTheme, onThemeSelect, focusThemeRowInView]
  );

  const toggleSort = (next: SortKey) => {
    if (sortKey === next) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(next);
    setSortDir(next === "theme" ? "asc" : "desc");
  };

  const resetTable = () => {
    setActiveTf("current");
    setCompareEnabled(false);
    setShowPerfCols(true);
    setVisiblePerfCols(new Set(TIMEFRAMES.map((tf) => tf.key)));
    setSortKey("strength");
    setSortDir("desc");
    setHeaderSelection(null);
    setSelectedRoute(null);
  };

  const openHelp = () => {
    setHelpLayout((prev) => clampHelpOverlayLayout(prev));
    setHelpOpen(true);
  };

  const closeHelp = () => setHelpOpen(false);

  const onHelpMovePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const el = helpPanelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    helpMoveDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startLeft: rect.left,
      startTop: rect.top,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onHelpMovePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = helpMoveDragRef.current;
    if (!drag) return;
    const dl = e.clientX - drag.startX;
    const dt = e.clientY - drag.startY;
    setHelpLayout((prev) =>
      clampHelpOverlayLayout({
        ...prev,
        left: drag.startLeft + dl,
        top: drag.startTop + dt,
      })
    );
  }, []);

  const endHelpMoveDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!helpMoveDragRef.current) return;
    helpMoveDragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    setHelpLayout((prev) => {
      persistHelpOverlayLayout(prev);
      return prev;
    });
  }, []);

  const onHelpResizePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const el = helpPanelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    helpResizeDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startW: rect.width,
      startH: rect.height,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onHelpResizePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = helpResizeDragRef.current;
    if (!drag) return;
    const dw = e.clientX - drag.startX;
    const dh = e.clientY - drag.startY;
    setHelpLayout((prev) =>
      clampHelpOverlayLayout({
        ...prev,
        w: drag.startW + dw,
        h: drag.startH + dh,
      })
    );
  }, []);

  const endHelpResizeDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!helpResizeDragRef.current) return;
    helpResizeDragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    const el = helpPanelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const next = clampHelpOverlayLayout({
      left: rect.left,
      top: rect.top,
      w: rect.width,
      h: rect.height,
    });
    setHelpLayout(next);
    persistHelpOverlayLayout(next);
  }, []);

  const scoreClass = (v: number) => (v >= 0 ? "text-green-400" : "text-red-400");
  const fmtPct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
  const fmtScore = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;
  const todayEtYmd = etCalendarYmd(new Date()) ?? "";
  const fmtTs = (iso: string | null | undefined) => {
    if (!iso) return "N/A";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "N/A";
    return d.toLocaleString("en-US", {
      month: "numeric",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };
  const nowStamp = new Date().toISOString();
  const getPerfCellTooltip = (themeName: string, tf: TfKey) => {
    const tfLabel = TIMEFRAMES.find((t) => t.key === tf)?.label ?? tf;
    const baseline = dataByTf[tf]?.comparisonTime ?? null;
    const baselineLabel = fmtTs(baseline);
    const activeLabel = TIMEFRAMES.find((t) => t.key === activeTf)?.label ?? activeTf;
    const activeBaseline = dataByTf[activeTf]?.comparisonTime ?? null;
    const activeBaselineLabel = fmtTs(activeBaseline);

    if (!compareEnabled || activeTf === "current") {
      if (tf === "current") {
        return `${themeName} ${tfLabel}\nFormula: Open-anchored current snapshot (intraday baseline)\nAs of: ${fmtTs(nowStamp)}`;
      }
      if (tf === "m15" || tf === "h1" || tf === "h4") {
        return `${themeName} ${tfLabel}\nFormula: OpenCheckpoint (${tfLabel} vs Open)\nMath: medianPct_openToNow(${fmtTs(nowStamp)}) - [medianPct_now(${fmtTs(nowStamp)}) - medianPct_${tfLabel}Baseline(${baselineLabel})]`;
      }
      return `${themeName} ${tfLabel}\nFormula: ValueDiff(Now - Baseline)\nMath: medianPct(${fmtTs(nowStamp)}) - medianPct(${baselineLabel})`;
    }

    return `${themeName} ${tfLabel}\nFormula: ValueDiff((Now - ${tfLabel} baseline) - (Now - ${activeLabel} baseline))\nMath: [medianPct(${fmtTs(nowStamp)}) - medianPct(${baselineLabel})] - [medianPct(${fmtTs(nowStamp)}) - medianPct(${activeBaselineLabel})]`;
  };
  const activeSnapshotUpdated = dataByTf[activeTf]?.lastUpdated ?? null;

  const infoSummary = useMemo(() => {
    const rows = activeRows;
    if (!rows.length) {
      return {
        narrative: "No theme data is available for this snapshot right now.",
        strength: "Unable to determine strongest/weakest themes.",
      };
    }

    const avg = rows.reduce((acc, r) => acc + r.score, 0) / rows.length;
    const regime = avg >= 60 ? "Risk-on tone with broad participation." : avg <= 40 ? "Risk-off tone with defensive pressure." : "Mixed tape with rotation and selective leadership.";
    const strongest = [...rows].sort((a, b) => b.score - a.score)[0];
    const weakest = [...rows].sort((a, b) => a.score - b.score)[0];
    return {
      narrative: regime,
      strength: `Strongest: ${strongest?.name ?? "N/A"} (${Math.round(strongest?.score ?? 0)}). Weakest: ${weakest?.name ?? "N/A"} (${Math.round(weakest?.score ?? 0)}).`,
    };
  }, [activeRows]);

  const infoSettings = useMemo(() => {
    const activeLabel = TIMEFRAMES.find((t) => t.key === activeTf)?.label ?? activeTf;
    return `Active ${activeLabel}, compare ${compareEnabled && activeTf !== "current" ? `Current - ${activeLabel}` : "off"}, row ${selectedRow ? "selected" : "none"}, column ${selectedCol ? "selected" : "none"}, size ${sizeFilter}.`;
  }, [activeTf, compareEnabled, selectedRow, selectedCol, sizeFilter]);

  const narrativeDetail = useMemo(() => {
    if (selectedRouteDetail) {
      const fromName = activeMap.get(selectedRouteDetail.from)?.name ?? selectedRouteDetail.from;
      const toName = activeMap.get(selectedRouteDetail.to)?.name ?? selectedRouteDetail.to;
      const score = selectedRouteDetail.score;
      const absScore = Math.abs(score);
      const arrow = absScore < 0.1 ? "↔" : score > 0 ? "↑" : "↓";
      const toneClass = absScore < 0.1 ? "text-slate-200" : score > 0 ? "text-green-300" : "text-red-300";
      const strengthLabel =
        absScore < 0.1 ? "little" : absScore < 0.3 ? "mild" : absScore < 0.5 ? "meaningful" : "strong";

      if (compareEnabled && activeTf !== "current") {
        const activeLabel = TIMEFRAMES.find((t) => t.key === activeTf)?.label ?? activeTf;
        return {
          arrow,
          fromLabel: fromName,
          toLabel: toName,
          routeLabel: `${fromName} -> ${toName}`,
          scoreLabel: fmtScore(score),
          headlineClass: toneClass,
          body:
            absScore < 0.1
              ? `${toName} and ${fromName} are close to unchanged versus the ${activeLabel} baseline. The model sees little meaningful change in this route.`
              : score > 0
                ? `This route is stronger now than it was at the ${activeLabel} baseline. ${toName} has improved relative to ${fromName} versus that comparison snapshot.`
                : `This route is weaker now than it was at the ${activeLabel} baseline. ${toName} has deteriorated relative to ${fromName} versus that comparison snapshot.`,
          emphasis:
            absScore < 0.1
              ? "Neutral change."
              : `${strengthLabel[0].toUpperCase()}${strengthLabel.slice(1)} ${score > 0 ? "positive" : "negative"} change versus baseline.`,
          metrics: `RSΔ ${selectedRouteDetail.rsDelta >= 0 ? "+" : ""}${selectedRouteDetail.rsDelta.toFixed(2)} | BreadthΔ ${selectedRouteDetail.breadthDelta >= 0 ? "+" : ""}${selectedRouteDetail.breadthDelta.toFixed(1)} | VolΔ ${selectedRouteDetail.volumeDelta >= 0 ? "+" : ""}${selectedRouteDetail.volumeDelta.toFixed(1)}`,
        };
      }

      return {
        arrow,
        fromLabel: fromName,
        toLabel: toName,
        routeLabel: `${fromName} -> ${toName}`,
        scoreLabel: fmtScore(score),
        headlineClass: toneClass,
        body:
          absScore < 0.1
            ? `${toName} and ${fromName} are close to balanced in this pair. The model sees little meaningful edge either way.`
            : score > 0
              ? `${toName} is stronger than ${fromName} in this pair. Rotation favors ${toName} over ${fromName} at the active snapshot.`
              : `${toName} is weaker than ${fromName} in this pair. ${fromName} is relatively leading ${toName} in this route.`,
        emphasis:
          absScore < 0.1
            ? "Neutral relationship."
            : `This is a ${strengthLabel} ${score > 0 ? "positive" : "negative"} edge.`,
        metrics: `RSΔ ${selectedRouteDetail.rsDelta >= 0 ? "+" : ""}${selectedRouteDetail.rsDelta.toFixed(2)} | BreadthΔ ${selectedRouteDetail.breadthDelta >= 0 ? "+" : ""}${selectedRouteDetail.breadthDelta.toFixed(1)} | VolΔ ${selectedRouteDetail.volumeDelta >= 0 ? "+" : ""}${selectedRouteDetail.volumeDelta.toFixed(1)}`,
      };
    }

    if (selectedRow) {
      const preview = activeMap.get(selectedRow)?.name ?? selectedRow;
      return {
        headline: `Focused row: ${preview}`,
        arrow: null,
        fromLabel: null,
        toLabel: null,
        routeLabel: null,
        scoreLabel: null,
        headlineClass: "text-cyan-200",
        body:
          `${preview} now shows current-flow values across every destination theme, so you can see where that source theme is strongest and weakest right now.`,
        emphasis:
          "Click a route cell to turn this into a direct pairwise explanation.",
        metrics: null,
      };
    }

    return null;
  }, [selectedRouteDetail, selectedRow, activeMap, compareEnabled, activeTf]);

  const selectedRouteScore = selectedRouteDetail?.score ?? 0;
  const selectedRouteNeutral = Math.abs(selectedRouteScore) <= 0.05;
  const headlineFromClass = "text-slate-50";
  const headlineToClass = selectedRouteNeutral
    ? "text-amber-200"
    : selectedRouteScore > 0
      ? "text-green-400"
      : "text-red-400";
  const headlineScoreClass = selectedRouteNeutral
    ? "text-amber-300"
    : selectedRouteScore > 0
      ? "text-green-400"
      : "text-red-400";
  /** Glow matches row-vs-column arrow: row down when column leads, row up when row leads */
  const headlineGlow = selectedRouteNeutral
    ? "0 0 14px rgba(252,211,77,0.52)"
    : selectedRouteScore > 0
      ? "0 0 16px rgba(248,113,113,0.45)"
      : "0 0 16px rgba(74,222,128,0.52)";
  const metricValueClass = (v: number) =>
    Math.abs(v) <= 0.05 ? "text-amber-300" : v > 0 ? "text-green-300" : "text-red-300";

  if (isLoading) {
    return <div className="h-full p-3 text-sm text-muted-foreground">Loading flow map snapshots...</div>;
  }

  return (
    <div
      ref={panelRef}
      className="flex h-full min-h-0 flex-col"
      style={localSlotBgStyle("marketFlow:flowMapMatrix")}
      data-ui-region="marketFlow:flowMapMatrix"
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        if (helpOpen) {
          closeHelp();
          return;
        }
        if (selectedRoute) {
          setSelectedRoute(null);
          return;
        }
        if (selectedRow || selectedCol) setHeaderSelection(null);
      }}
      tabIndex={0}
    >
      {helpOpen ? (
        <div className="pointer-events-none fixed inset-0 z-[120]">
          <div
            ref={helpPanelRef}
            className="pointer-events-auto fixed overflow-hidden rounded-xl border border-purple-500/50 bg-slate-950/98 shadow-[0_22px_80px_rgba(0,0,0,0.65)] backdrop-blur"
            style={{
              left: helpLayout.left,
              top: helpLayout.top,
              width: helpLayout.w,
              height: helpLayout.h,
            }}
          >
            <div
              className="flex cursor-move items-center justify-between border-b border-purple-500/40 bg-gradient-to-r from-purple-600/25 via-purple-500/15 to-slate-900 px-4 py-3 select-none"
              onPointerDown={onHelpMovePointerDown}
              onPointerMove={onHelpMovePointerMove}
              onPointerUp={endHelpMoveDrag}
              onPointerCancel={endHelpMoveDrag}
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-purple-400/50 bg-purple-500/20 text-xl font-black text-purple-100 shadow-[0_0_24px_rgba(168,85,247,0.25)]">
                  ?
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-semibold text-purple-100">
                    <GripVertical className="h-4 w-4 text-purple-300/80" />
                    Flow Map Help
                  </div>
                  <div className="text-xs text-purple-200/80">
                    Drag this window by the header. Resize from the lower-right corner.
                  </div>
                </div>
              </div>
              <button
                type="button"
                onPointerDown={(e) => {
                  e.stopPropagation();
                }}
                onClick={closeHelp}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-purple-400/40 bg-slate-900/50 text-purple-100 transition-colors hover:bg-purple-500/20"
                aria-label="Close Flow Map help"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="h-[calc(100%-4rem)] overflow-auto px-5 py-4 text-sm leading-6 text-slate-200">
              <div className="rounded-lg border border-purple-500/25 bg-purple-500/8 px-4 py-3 text-sm text-slate-100">
                Flow Map is a directional theme-to-theme rotation model. Read every matrix cell as{" "}
                <span className="font-semibold text-purple-200">Row Theme -&gt; Column Theme</span>. The row is the source
                of the comparison. The column is the destination.
              </div>

              <div className="mt-4 space-y-4">
                {FLOW_MAP_HELP_SECTIONS.map((section) => (
                  <section key={section.title} className="rounded-lg border border-slate-800 bg-slate-900/70 px-4 py-4">
                    <h3 className="text-base font-semibold text-purple-200">{section.title}</h3>
                    <div className="mt-2 space-y-3">
                      {section.paragraphs.map((paragraph) => (
                        <p key={paragraph}>{paragraph}</p>
                      ))}
                    </div>
                    {section.bullets?.length ? (
                      <ul className="mt-3 list-disc space-y-1 pl-5 text-slate-300">
                        {section.bullets.map((bullet) => (
                          <li key={bullet}>{bullet}</li>
                        ))}
                      </ul>
                    ) : null}
                  </section>
                ))}
              </div>
            </div>

            <div
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize Flow Map help"
              className="absolute bottom-0 right-0 z-[130] h-7 w-7 cursor-nwse-resize touch-none rounded-br-xl opacity-70 transition-opacity hover:opacity-100"
              onPointerDown={onHelpResizePointerDown}
              onPointerMove={onHelpResizePointerMove}
              onPointerUp={endHelpResizeDrag}
              onPointerCancel={endHelpResizeDrag}
            >
              <span
                className="pointer-events-none absolute bottom-1.5 right-1.5 block h-3.5 w-3.5 border-b-2 border-r-2 border-purple-300/90"
                aria-hidden
              />
            </div>
          </div>
        </div>
      ) : null}

      <div
        className={cn(
          "shrink-0 border-b border-slate-700/40 px-2 py-2",
          "max-h-[min(48%,320px)] overflow-x-hidden overflow-y-auto",
          isCompact && "max-h-[min(40%,240px)]"
        )}
      >
        <div className="flex flex-col gap-2">
          {isCompact ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0 text-[10px] text-slate-400">
                {fmtTs(activeSnapshotUpdated)} · {TIMEFRAMES.find((t) => t.key === activeTf)?.label ?? activeTf}
                {compareEnabled ? " · Compare on" : ""}
              </div>
              <button
                type="button"
                onClick={() => setDetailsExpanded((v) => !v)}
                className="inline-flex shrink-0 items-center gap-1 rounded border border-slate-600/60 bg-slate-800/60 px-2 py-1 text-[10px] font-medium text-slate-200 hover:bg-slate-700/60"
              >
                {detailsExpanded ? (
                  <>
                    Hide details
                    <ChevronUp className="h-3 w-3" />
                  </>
                ) : (
                  <>
                    Show details
                    <ChevronDown className="h-3 w-3" />
                  </>
                )}
              </button>
            </div>
          ) : null}

          <div
            className="min-w-0 rounded border border-slate-700/40 bg-slate-900/50 p-2"
            style={{ fontSize: fontPrefs.toolbar }}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-[0.85em] text-muted-foreground">
                Snapshot controls
                <ThemeColorChip slotId="marketFlow:flowMapMatrix" />
              </span>
              <FlowMapFontSizeControl
                section="toolbar"
                value={fontPrefs.toolbar}
                onChange={(px) => setFontSection("toolbar", px)}
              />
            </div>
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={openHelp}
                className={cn(
                  "inline-flex items-center justify-center rounded-md border border-purple-500/50 bg-purple-500/15 font-black text-purple-100 shadow-[0_0_22px_rgba(168,85,247,0.2)] transition-colors hover:bg-purple-500/25",
                  isCompact ? "h-8 w-8 text-base" : "h-10 w-10 text-lg"
                )}
                title="Open Flow Map help"
                aria-label="Open Flow Map help"
              >
                ?
              </button>
              <span className="text-xs text-muted-foreground">Active snapshot:</span>
              <InlineInfoTooltip label="Active snapshot help">
                Choose which snapshot organizes the table. Compare Off shows the active snapshot in its own terms. Compare
                On turns the table into Current minus the selected active snapshot.
              </InlineInfoTooltip>
              {TIMEFRAMES.map((tf) => (
                <button
                  key={tf.key}
                  className={cn(
                    "rounded border px-1.5 py-0.5 text-[10px] sm:px-2 sm:py-1 sm:text-xs",
                    activeTf === tf.key
                      ? "border-cyan-500/50 bg-cyan-500/15 text-cyan-300"
                      : "border-slate-600/50 bg-slate-800/40 text-muted-foreground hover:text-foreground"
                  )}
                  onClick={() => {
                    setActiveTf(tf.key);
                    setSelectedRoute(null);
                  }}
                >
                  {tf.label}
                </button>
              ))}
            </div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={compareEnabled}
                  onChange={(e) => {
                    const next = e.target.checked;
                    // If user enables compare while on NOW, promote to 1D so compare has effect.
                    if (next && activeTf === "current") {
                      setActiveTf("d1");
                    }
                    setCompareEnabled(next);
                  }}
                />
                Compare ({`Current - ${TIMEFRAMES.find((t) => t.key === activeTf)?.label ?? activeTf}`})
              </label>
              <InlineInfoTooltip label="Compare help">
                Compare changes the matrix and left-side values to show how the current market differs from the selected
                active snapshot baseline.
              </InlineInfoTooltip>
              <label className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={showPerfCols}
                  onChange={(e) => setShowPerfCols(e.target.checked)}
                />
                Show timeframe columns
              </label>
              <InlineInfoTooltip label="Visible columns help">
                Hide or show the left-side performance columns. The matrix itself stays visible; this only affects the
                timeframe columns between Strength and the theme-to-theme grid.
              </InlineInfoTooltip>
            </div>
            {showPerfCols && !isCompact && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-muted-foreground">Visible columns:</span>
                <InlineInfoTooltip label="Timeframe columns help">
                  NOW is always visible and anchored to the open. Intraday columns show checkpoint-versus-open behavior,
                  while longer columns show Now minus the historical baseline.
                </InlineInfoTooltip>
                {TIMEFRAMES.map((tf) => (
                  <label key={tf.key} className="inline-flex items-center gap-1 text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={isPerfVisible(tf.key)}
                      disabled={tf.key === "current"}
                      onChange={(e) => {
                        if (tf.key === "current") return;
                        setVisiblePerfCols((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(tf.key);
                          else next.delete(tf.key);
                          return next;
                        });
                      }}
                    />
                    {tf.label}
                  </label>
                ))}
              </div>
            )}
          </div>

          {showDetailCards ? (
          <div className="grid w-full min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <div className="min-w-0 rounded border border-slate-700/60 bg-slate-900/85 p-3" style={{ fontSize: fontPrefs.snapshot }}>
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2 text-xs font-semibold tracking-wide text-slate-200">
                  <span>Snapshot Updated</span>
                  <InlineInfoTooltip label="Snapshot updated help" className="h-4 w-4 text-[10px]">
                    This is the timestamp of the active snapshot currently driving the Flow Map table.
                  </InlineInfoTooltip>
                </div>
                <FlowMapFontSizeControl
                  section="snapshot"
                  value={fontPrefs.snapshot}
                  onChange={(px) => setFontSection("snapshot", px)}
                />
              </div>
              <div className="text-slate-300">{fmtTs(activeSnapshotUpdated)}</div>
              <div className="mt-1 text-[10px] text-slate-400">
                Active: {TIMEFRAMES.find((t) => t.key === activeTf)?.label ?? activeTf}
              </div>
            </div>
            <div
              className="min-w-0 rounded border border-cyan-500/40 bg-gradient-to-b from-cyan-500/10 to-slate-900/90 p-3 shadow-[0_0_0_1px_rgba(34,211,238,0.15)] sm:col-span-2 xl:col-span-1"
              style={{ fontSize: fontPrefs.narrative }}
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2 text-xs font-semibold tracking-wide text-cyan-200">
                  <span>FLOW Map Narrative</span>
                  <InlineInfoTooltip label="Flow Map Narrative help" className="h-4 w-4 text-[10px]">
                    This box summarizes market tone when nothing is selected, and switches to selection-aware guidance when
                    you pick rows or route cells.
                  </InlineInfoTooltip>
                </div>
                <FlowMapFontSizeControl
                  section="narrative"
                  value={fontPrefs.narrative}
                  onChange={(px) => setFontSection("narrative", px)}
                />
              </div>
              {!narrativeDetail ? (
                <>
                  <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-purple-500/40 bg-purple-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-purple-300">
                    <span className="h-2 w-2 rounded-full bg-purple-400 shadow-[0_0_10px_rgba(192,132,252,0.7)]" />
                    Market Read
                  </div>
                  <p className="text-slate-200">{infoSummary.narrative}</p>
                  <p className="mt-1 text-slate-300">{infoSummary.strength}</p>
                </>
              ) : (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 overflow-hidden">
                    {narrativeDetail.arrow && narrativeDetail.fromLabel && narrativeDetail.toLabel && narrativeDetail.scoreLabel ? (
                      <div
                        className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 font-black leading-none"
                        style={{ fontSize: Math.round(fontPrefs.narrative * 1.45), textShadow: headlineGlow }}
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden whitespace-nowrap">
                          <span
                            className={headlineFromClass}
                            title={narrativeDetail.fromLabel}
                            style={{ maxWidth: "min(13ch, 40vw)" }}
                          >
                            <span className="block truncate">{truncateHeadlineLabel(narrativeDetail.fromLabel)}</span>
                          </span>
                          <span
                            className={cn(
                              "inline-flex shrink-0 items-center justify-center rounded-sm border px-0.5 py-0.5",
                              selectedRouteNeutral
                                ? "border-slate-500/50 text-slate-400"
                                : selectedRouteScore > 0
                                  ? "border-red-500/50 text-red-400"
                                  : "border-emerald-500/50 text-emerald-400"
                            )}
                            title={
                              selectedRouteNeutral
                                ? "Roughly balanced between the two themes"
                                : selectedRouteScore > 0
                                  ? "Row theme is down vs column (column leads this pair)"
                                  : "Row theme is up vs column (row leads this pair)"
                            }
                            aria-hidden
                          >
                            {selectedRouteNeutral ? (
                              <ArrowUpDown className="h-[1.05em] w-[1.05em]" strokeWidth={2.75} />
                            ) : selectedRouteScore > 0 ? (
                              <ArrowDown className="h-[1.05em] w-[1.05em]" strokeWidth={2.75} />
                            ) : (
                              <ArrowUp className="h-[1.05em] w-[1.05em]" strokeWidth={2.75} />
                            )}
                          </span>
                          <span
                            className={headlineToClass}
                            title={narrativeDetail.toLabel}
                            style={{ maxWidth: "min(15ch, 45vw)" }}
                          >
                            <span className="block truncate">{truncateHeadlineLabel(narrativeDetail.toLabel)}</span>
                          </span>
                        </div>
                        <span className={cn("shrink-0 pl-1", headlineScoreClass)}>
                          {narrativeDetail.scoreLabel}
                        </span>
                      </div>
                    ) : (
                      <p className={cn("font-semibold", narrativeDetail.headlineClass)}>{narrativeDetail.headline}</p>
                    )}
                  </div>
                  <p className="font-semibold leading-tight text-slate-100" style={{ fontSize: "1.15em" }}>
                    {narrativeDetail.body}
                  </p>
                  <p className="leading-snug text-slate-100" style={{ fontSize: "1.05em" }}>
                    {selectedRouteNeutral ? (
                      <>
                        This is a <span className="font-semibold text-amber-300">neutral</span> edge.
                      </>
                    ) : selectedRouteScore > 0 ? (
                      <>
                        The <span className="font-semibold text-red-300">row theme is down</span> vs the column in
                        this pair (column leads).
                      </>
                    ) : (
                      <>
                        The <span className="font-semibold text-green-300">row theme is up</span> vs the column in
                        this pair (row leads).
                      </>
                    )}
                  </p>
                  {selectedRouteDetail ? (
                    <p className="font-mono text-slate-100" style={{ fontSize: "0.95em" }}>
                      <span className="text-slate-300">RSΔ </span>
                      <span className={metricValueClass(selectedRouteDetail.rsDelta)}>
                        {selectedRouteDetail.rsDelta >= 0 ? "+" : ""}
                        {selectedRouteDetail.rsDelta.toFixed(2)}
                      </span>
                      <span className="px-2 text-slate-500">|</span>
                      <span className="text-slate-300">BreadthΔ </span>
                      <span className={metricValueClass(selectedRouteDetail.breadthDelta)}>
                        {selectedRouteDetail.breadthDelta >= 0 ? "+" : ""}
                        {selectedRouteDetail.breadthDelta.toFixed(1)}
                      </span>
                      <span className="px-2 text-slate-500">|</span>
                      <span className="text-slate-300">VolΔ </span>
                      <span className={metricValueClass(selectedRouteDetail.volumeDelta)}>
                        {selectedRouteDetail.volumeDelta >= 0 ? "+" : ""}
                        {selectedRouteDetail.volumeDelta.toFixed(1)}
                      </span>
                    </p>
                  ) : null}
                </div>
              )}
            </div>

            <div className="min-w-0 rounded border border-slate-700/60 bg-slate-900/85 p-3 sm:col-span-2 xl:col-span-1" style={{ fontSize: fontPrefs.settings }}>
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2 text-xs font-semibold tracking-wide text-slate-200">
                  <span>Current Tool Settings</span>
                  <InlineInfoTooltip label="Current Tool Settings help" className="h-4 w-4 text-[10px]">
                    This box explains why the table looks the way it does right now: active snapshot, compare state,
                    selections, and size filter.
                  </InlineInfoTooltip>
                </div>
                <FlowMapFontSizeControl
                  section="settings"
                  value={fontPrefs.settings}
                  onChange={(px) => setFontSection("settings", px)}
                />
              </div>
              <p className="mt-1 border-t border-slate-700/50 pt-2 leading-relaxed text-slate-300">{infoSettings}</p>
            </div>
          </div>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-700/30 px-2 py-1">
        <span className="text-[10px] text-slate-500">Flow matrix</span>
        <FlowMapFontSizeControl
          section="matrix"
          value={fontPrefs.matrix}
          onChange={(px) => setFontSection("matrix", px)}
        />
      </div>

      <div
        ref={flowMapTableScrollRef}
        tabIndex={0}
        role="region"
        aria-label="Flow Map matrix — use Arrow Down or Space for next theme, Arrow Up for previous"
        className="min-h-[120px] flex-1 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
        onPointerDown={onFlowMapTableAreaPointerDown}
        onKeyDown={onFlowMapThemeListKeyDown}
      >
        <table
          className="w-full border-collapse leading-tight"
          style={{ minWidth: Math.max(tableLayout.minWidth, 480), fontSize: fontPrefs.matrix }}
        >
          <thead className="sticky top-0 z-10 bg-slate-900">
            <tr>
              <th
                className={cn(
                  "sticky left-0 z-30 border border-slate-700/50 bg-slate-900 text-left",
                  tableLayout.headerPad,
                )}
                style={fixedColStyle(tableLayout.themeCol, 0)}
              >
                <div className="flex items-center justify-between gap-1">
                  <button
                    className={cn("cursor-pointer truncate text-left", sortKey === "theme" && "text-cyan-300")}
                    onClick={() => toggleSort("theme")}
                    title="Sort by theme name"
                  >
                    Theme{sortKey === "theme" ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                  </button>
                  <button
                    onClick={resetTable}
                    className="shrink-0 rounded border border-slate-600/50 bg-slate-800/50 px-1 py-0.5 text-[9px] text-slate-300 hover:text-cyan-200"
                    title="Reset entire table to default state"
                  >
                    {isCompact ? "↺" : "Reset"}
                  </button>
                </div>
              </th>
              <th
                className={cn(
                  "sticky z-25 cursor-pointer border border-slate-700/50 bg-slate-900 text-center",
                  tableLayout.headerPad,
                  sortKey === "strength" && "text-cyan-300"
                )}
                style={fixedColStyle(tableLayout.strengthCol, tableLayout.strengthLeft)}
                onClick={() => toggleSort("strength")}
                title="Sort by strength"
              >
                {isCompact ? "Str" : "Strength"}
                {sortKey === "strength" ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
              </th>
              {TIMEFRAMES.filter((tf) => tf.key === "current").map((tf) => {
                  const sk = `perf:${tf.key}` as SortKey;
                  const cTime = dataByTf[tf.key]?.comparisonTime;
                  const cUnavailable = dataByTf[tf.key]?.comparisonUnavailable;
                  const compEtYmd = cTime ? etCalendarYmd(cTime) : null;
                  const isPrevSessionFallback = !!compEtYmd && compEtYmd < todayEtYmd;
                  const headerTitle = cUnavailable
                    ? cUnavailable
                    : cTime
                      ? `${tf.label} baseline: ${new Date(cTime).toLocaleString()}${isPrevSessionFallback ? " (prev session fallback)" : ""}`
                      : `${tf.label} baseline unavailable`;
                  return (
                    <th
                      key={tf.key}
                      className={cn(
                        "sticky z-20 cursor-pointer border border-slate-700/50 bg-slate-900 text-center",
                        tableLayout.headerPad,
                        activeTf === tf.key && "bg-slate-800 text-cyan-300",
                        sortKey === sk && "text-cyan-300",
                        "border-cyan-500/30 text-cyan-200"
                      )}
                      style={fixedColStyle(tableLayout.nowCol, tableLayout.nowLeft)}
                      onClick={() => toggleSort(sk)}
                      title={headerTitle}
                    >
                      {isCompact ? "NOW" : "NOW (Open)"}
                      {sortKey === sk ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                    </th>
                  );
                })}
              {showPerfCols &&
                TIMEFRAMES.filter((tf) => tf.key !== "current" && isPerfVisible(tf.key)).map((tf) => {
                  const sk = `perf:${tf.key}` as SortKey;
                  const cTime = dataByTf[tf.key]?.comparisonTime;
                  const cUnavailable = dataByTf[tf.key]?.comparisonUnavailable;
                  const compEtYmd = cTime ? etCalendarYmd(cTime) : null;
                  const isPrevSessionFallback = !!compEtYmd && compEtYmd < todayEtYmd;
                  const isIntradayCol = tf.key === "m15" || tf.key === "h1" || tf.key === "h4";
                  const showWarn = !!cUnavailable || (isIntradayCol && isPrevSessionFallback);
                  const headerTitle = cUnavailable
                    ? cUnavailable
                    : cTime
                      ? `${tf.label} baseline: ${new Date(cTime).toLocaleString()}${isPrevSessionFallback ? " (prev session fallback)" : ""}`
                      : `${tf.label} baseline unavailable`;
                  return (
                    <th
                      key={tf.key}
                      className={cn(
                        "cursor-pointer border border-slate-700/50 text-center",
                        tableLayout.headerPad,
                        activeTf === tf.key && "bg-cyan-500/10 text-cyan-300",
                        sortKey === sk && "text-cyan-300"
                      )}
                      style={fixedColStyle(tableLayout.perfCol)}
                      onClick={() => toggleSort(sk)}
                      title={headerTitle}
                    >
                      {tf.label}
                      {showWarn ? <span className="text-amber-300" title={headerTitle}>!</span> : null}
                      {sortKey === sk ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                    </th>
                  );
                })}
              {themeIds.map((to) => {
                const fullName = activeMap.get(to)?.name ?? to;
                return (
                <th
                  key={to}
                  className={cn(
                    "cursor-pointer border border-slate-700/50 align-bottom",
                    tableLayout.headerPad,
                    selectedCol === to && "bg-cyan-500/20 text-cyan-300",
                    focusedTheme === to && "ring-1 ring-cyan-400/50"
                  )}
                  style={fixedColStyle(tableLayout.matrixCol)}
                  onClick={() => {
                    const isSame = headerSelection?.axis === "col" && headerSelection.themeId === to;
                    setHeaderSelection(isSame ? null : { axis: "col", themeId: to });
                    if (!isSame) onThemeSelect(to);
                    setSelectedRoute(null);
                  }}
                  title={fullName}
                >
                  <span
                    className={cn(
                      "mx-auto inline-block max-h-16 overflow-hidden font-medium text-slate-300",
                      "[writing-mode:vertical-rl] rotate-180"
                    )}
                  >
                    {shortThemeLabel(fullName, isCompact)}
                  </span>
                </th>
              );
              })}
            </tr>
          </thead>
          <tbody>
            {orderedThemes.map((from) => {
              const rowSelected = selectedRow === from;
              const strength = getStrength(from);
              const name = activeMap.get(from)?.name ?? from;
              return (
                <tr
                  key={from}
                  data-flow-theme-row={from}
                  className={cn("hover:bg-slate-800/30", rowSelected && "bg-cyan-500/8")}
                >
                  <td
                    className={cn(
                      "sticky left-0 z-[20] cursor-pointer border border-slate-700/30 bg-slate-900 font-medium",
                      tableLayout.cellPad,
                      rowSelected && "border-cyan-400/70 bg-slate-800 text-cyan-200"
                    )}
                    style={fixedColStyle(tableLayout.themeCol, 0)}
                    onClick={() => {
                      const isSame = headerSelection?.axis === "row" && headerSelection.themeId === from;
                      setHeaderSelection(isSame ? null : { axis: "row", themeId: from });
                      if (!isSame) onThemeSelect(from);
                      setSelectedRoute(null);
                    }}
                    title={name}
                  >
                    <span className="block truncate">{shortThemeLabel(name, isCompact)}</span>
                  </td>
                  <td
                    className={cn(
                      "sticky z-[15] border border-slate-700/30 bg-slate-900 text-center font-medium",
                      tableLayout.cellPad,
                      scoreClass(strength),
                      rowSelected && "border-cyan-400/70 bg-slate-800"
                    )}
                    style={fixedColStyle(tableLayout.strengthCol, tableLayout.strengthLeft)}
                  >
                    {compareEnabled && activeTf !== "current" ? fmtScore(strength) : Math.round(strength)}
                  </td>
                  {TIMEFRAMES.filter((tf) => tf.key === "current").map((tf) => {
                      const v = getPerf(from, tf.key);
                      const noBaseline = !Number.isFinite(v);
                      return (
                        <td
                          key={`${from}-${tf.key}`}
                          className={cn(
                            "sticky z-[10] border border-slate-700/30 bg-slate-900 text-center",
                            tableLayout.cellPad,
                            noBaseline ? "text-slate-500" : scoreClass(v),
                            activeTf === tf.key && "bg-slate-800",
                            rowSelected && "border-cyan-400/70 bg-slate-800"
                          )}
                          style={fixedColStyle(tableLayout.nowCol, tableLayout.nowLeft)}
                          title={getPerfCellTooltip(name, tf.key)}
                        >
                          {noBaseline ? "NA" : fmtPct(v)}
                        </td>
                      );
                    })}
                  {showPerfCols &&
                    TIMEFRAMES.filter((tf) => tf.key !== "current" && isPerfVisible(tf.key)).map((tf) => {
                      const v = getPerf(from, tf.key);
                      const noBaseline = !Number.isFinite(v);
                      return (
                        <td
                          key={`${from}-${tf.key}`}
                          className={cn(
                            "border border-slate-700/30 text-center",
                            tableLayout.cellPad,
                            noBaseline ? "text-slate-500" : scoreClass(v),
                            activeTf === tf.key && "bg-cyan-500/5",
                            rowSelected && "border-cyan-400/70 bg-cyan-500/20"
                          )}
                          style={fixedColStyle(tableLayout.perfCol)}
                          title={getPerfCellTooltip(name, tf.key)}
                        >
                          {noBaseline ? "NA" : fmtPct(v)}
                        </td>
                      );
                    })}
                  {themeIds.map((to) => {
                    if (from === to) {
                      return (
                        <td
                          key={`${from}-${to}`}
                          className={cn(
                            "border border-slate-700/30 bg-slate-800/30 text-center text-slate-500",
                            tableLayout.cellPad,
                          )}
                          style={fixedColStyle(tableLayout.matrixCol)}
                        >
                          --
                        </td>
                      );
                    }
                    const route = getRoute(from, to);
                    const selected = selectedRoute?.from === from && selectedRoute?.to === to;
                    const tone = getRoutePulseTone(route.score);
                    return (
                      <td
                        key={`${from}-${to}`}
                        className={cn(
                          "cursor-pointer border border-slate-700/30 text-center",
                          tableLayout.cellPad,
                          selected && "ring-2 ring-cyan-400"
                        )}
                        style={{
                          ...fixedColStyle(tableLayout.matrixCol),
                          backgroundColor: tone.bgHex,
                          color: tone.textHex,
                        }}
                        onClick={() => {
                          if (selected) {
                            setSelectedRoute(null);
                          } else {
                            setSelectedRoute({ from, to });
                          }
                        }}
                        title={`${name} -> ${activeMap.get(to)?.name ?? to}`}
                      >
                        {fmtScore(route.score)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function FlowMapFocusBox({
  data,
  emptyState = "flowMap",
}: {
  data: FlowMapFocusData | null;
  /** When not in Flow Map lens, parent passes "otherLens" for a clearer empty message. */
  emptyState?: "flowMap" | "otherLens";
}) {
  if (!data || !data.focusedTheme) {
    return (
      <div className="p-3 text-sm text-muted-foreground">
        {emptyState === "otherLens"
          ? "Route focus is filled in Theme Flow Map. Switch to that lens and pick a theme or matrix cell."
          : "Select a theme in Flow Map to view focus details."}
      </div>
    );
  }
  return (
    <div className="h-full overflow-auto p-3 text-xs">
      <div className="mb-3">
        <div className="text-muted-foreground">Focused Theme</div>
        <div className="text-sm font-semibold text-cyan-300">{data.focusedTheme}</div>
        <div className="mt-1 text-[11px] text-muted-foreground">
          Snapshot: {data.activeLabel}
          {data.baselineLabel ? ` vs ${data.baselineLabel}` : ""}
        </div>
      </div>

      <div className="mb-3 rounded border border-slate-700/40 bg-slate-800/30 p-2">
        <div className="mb-1 font-medium text-slate-300">Top Inflows</div>
        {data.topInflows.length === 0 ? (
          <div className="text-muted-foreground">No inflow routes.</div>
        ) : (
          data.topInflows.map((r) => (
            <div key={`${r.from}-${r.to}`} className="flex items-center justify-between border-b border-slate-700/30 py-1 last:border-b-0">
              <span>
                {r.from} -&gt; {r.to}
              </span>
              <span className={cn("font-medium", r.score >= 0 ? "text-green-400" : "text-red-400")}>
                {r.score >= 0 ? "+" : ""}
                {r.score.toFixed(2)}
              </span>
            </div>
          ))
        )}
      </div>

      <div className="mb-3 rounded border border-slate-700/40 bg-slate-800/30 p-2">
        <div className="mb-1 font-medium text-slate-300">Top Outflows</div>
        {data.topOutflows.length === 0 ? (
          <div className="text-muted-foreground">No outflow routes.</div>
        ) : (
          data.topOutflows.map((r) => (
            <div key={`${r.from}-${r.to}`} className="flex items-center justify-between border-b border-slate-700/30 py-1 last:border-b-0">
              <span>
                {r.from} -&gt; {r.to}
              </span>
              <span className={cn("font-medium", r.score >= 0 ? "text-green-400" : "text-red-400")}>
                {r.score >= 0 ? "+" : ""}
                {r.score.toFixed(2)}
              </span>
            </div>
          ))
        )}
      </div>

      <div className="rounded border border-slate-700/40 bg-slate-800/30 p-2">
        <div className="mb-1 font-medium text-slate-300">Selected Route</div>
        {!data.selectedRoute ? (
          <div className="text-muted-foreground">Click a matrix cell to inspect route drivers.</div>
        ) : (
          <div className="space-y-1">
            <div className="font-medium text-cyan-200">
              {data.selectedRoute.from} -&gt; {data.selectedRoute.to}
            </div>
            <div>
              Score:{" "}
              <span className={cn("font-medium", data.selectedRoute.score >= 0 ? "text-green-400" : "text-red-400")}>
                {data.selectedRoute.score >= 0 ? "+" : ""}
                {data.selectedRoute.score.toFixed(2)}
              </span>
            </div>
            <div className="text-muted-foreground">
              RSΔ {data.selectedRoute.rsDelta >= 0 ? "+" : ""}
              {data.selectedRoute.rsDelta.toFixed(2)} | BreadthΔ {data.selectedRoute.breadthDelta >= 0 ? "+" : ""}
              {data.selectedRoute.breadthDelta.toFixed(1)} | VolΔ {data.selectedRoute.volumeDelta >= 0 ? "+" : ""}
              {data.selectedRoute.volumeDelta.toFixed(1)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
