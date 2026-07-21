// ---------------------------------------------------------------------------
// DiscoveryFeed — main scanner panel content
// ---------------------------------------------------------------------------

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { useAdminTheme } from "@/context/SystemSettingsContext";
import { useScanner } from "@/context/ScannerContext";
import {
  Radar, Wifi, WifiOff, ListFilter, Expand, Shrink,
  Beaker, BookOpen, Settings2, Check, X, PictureInPicture2, MonitorDown,
  Layers, Newspaper, Crosshair, Zap, Globe, Sunrise, Flame, FlaskConical, CalendarDays,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { FloatingOverlayPanel } from "@/components/FloatingOverlayPanel";
import { SCANNER_OVERLAY_Z } from "@/lib/overlay-z-index";
import { DiscoveryCard } from "./DiscoveryCard";
import { ScannerFontSizeControl } from "./ScannerFontSizeControl";
import {
  loadScannerFontOffset, saveScannerFontOffset, scannerPx,
} from "./scanner-font-prefs";
import type { ScannerMode, DiscoveryCard as DiscoveryCardType, SignalType } from "@shared/scanner-types";
import { SCANNER_CONFIG_FIELDS, type ScannerConfig, type ConfigFieldMeta } from "@shared/scanner-config";
import type { CatalystRuleDefinition, CatalystEntry, DecayShape } from "@shared/catalyst-types";
import { useLocation } from "wouter";
import { SCANNER_POPOUT_CHANNEL, type ScannerPopoutMessage } from "./scanner-popout-channel";

const SCANNER_OVERLAY_STORAGE = "scanner-overlay-position-v1";

const DEFAULT_OVERLAY = {
  x: typeof window !== "undefined" ? Math.max(20, window.innerWidth - 440) : 1200,
  y: 80, w: 420, h: 600, pinned: false,
};

const MODE_LABELS: Record<ScannerMode, string> = { on: "Active", silent: "Silent", off: "Off" };
const MODE_COLORS: Record<ScannerMode, string> = { on: "text-emerald-400", silent: "text-amber-400", off: "text-slate-500" };

// ── Signal type friendly labels ──────────────────────────────────────────────

const SIGNAL_TYPE_LABELS: Record<SignalType, string> = {
  gap: "Gap Up/Down",
  volume_spike: "Volume Surge",
  velocity_move: "Velocity Move",
  adr_blowout: "ADR Blowout",
  breadth_shift: "Breadth Shift",
  theme_acceleration: "Theme Acceleration",
  regime_change: "Regime Change",
  rai_shift: "RAI Shift",
  broad_weakness: "Broad Weakness",
  broad_strength: "Broad Strength",
  news_alert: "News Alert",
  ma_proximity: "MA Proximity",
  ur_ma_reclaim: "MA Reclaim",
  prev_day_high_break: "Prev Day High Break",
  prev_day_low_break: "Prev Day Low Break",
  five_day_high_break: "5-Day High Break",
  five_day_low_break: "5-Day Low Break",
  lod_bounce: "LOD Bounce",
  failed_breakout: "Failed Breakout",
  hod_fade: "HOD Fade",
  gap_down_continuation: "Gap Down Continuation",
  earnings_reaction: "Earnings Reaction",
  theme_earnings_density: "Theme Earnings Density",
  ipo_debut: "IPO Debut",
};

// ── Category filter definitions ──────────────────────────────────────────────

type CategoryFilter = "all" | "theme" | "news" | "setups" | "catalyst" | "premarket";

const CATEGORY_ICONS: Record<CategoryFilter, typeof Globe> = {
  all: Globe, theme: Layers, news: Newspaper, setups: Crosshair, catalyst: Zap, premarket: Sunrise,
};

const THEME_SIGNAL_TYPES: Set<SignalType> = new Set([
  "breadth_shift", "theme_acceleration", "broad_weakness", "broad_strength",
  "theme_earnings_density",
]);
const SETUP_SIGNAL_TYPES: Set<SignalType> = new Set([
  "lod_bounce", "ur_ma_reclaim", "prev_day_high_break", "prev_day_low_break",
  "five_day_high_break", "five_day_low_break",
  "failed_breakout", "hod_fade", "gap_down_continuation",
  "earnings_reaction",
]);
const MARKET_SIGNAL_TYPES: Set<SignalType> = new Set([
  "regime_change", "rai_shift",
]);

const NEWS_SIGNAL_TYPES: Set<SignalType> = new Set(["news_alert"]);

const PREMARKET_SIGNAL_TYPES: Set<SignalType> = new Set(["gap", "volume_spike", "news_alert"]);

/** Signal types to load from DB when a category chip is active (not client-only last-N). */
const CATEGORY_DB_TYPES: Partial<Record<CategoryFilter, SignalType[]>> = {
  theme: [...THEME_SIGNAL_TYPES],
  news: [...NEWS_SIGNAL_TYPES],
  setups: [...SETUP_SIGNAL_TYPES],
  premarket: [...PREMARKET_SIGNAL_TYPES],
};

function isPreMarketSession(isoString: string): boolean {
  const d = new Date(isoString);
  const et = new Date(d.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const h = et.getHours();
  const m = et.getMinutes();
  // Include anything from overnight through 10:00 AM ET (covers gaps detected shortly after open)
  return h < 10;
}

function matchesCategory(card: DiscoveryCardType, cat: CategoryFilter): boolean {
  if (MARKET_SIGNAL_TYPES.has(card.signalType)) return true;
  if (cat === "all") return true;
  if (cat === "theme") return THEME_SIGNAL_TYPES.has(card.signalType);
  if (cat === "setups") return SETUP_SIGNAL_TYPES.has(card.signalType);
  if (cat === "news") return NEWS_SIGNAL_TYPES.has(card.signalType);
  if (cat === "catalyst") return (card.qualifyScore ?? 0) > 70;
  if (cat === "premarket") return PREMARKET_SIGNAL_TYPES.has(card.signalType) && isPreMarketSession(card.createdAt);
  return true;
}

// ── Theme strength + prior-day $ liquidity filters ───────────────────────────

type ThemeStrengthFilter = "all" | "top25" | "top50" | "bottom50";
type LiquidityFilter = "all" | "high" | "mid" | "low";

function cardThemePercentile(card: DiscoveryCardType): number | null {
  const pct = card.themePercentile ?? card.context?.discovery_filters?.themePercentile
    ?? (card.context?.theme_membership as { themePercentile?: number } | undefined)?.themePercentile;
  return pct != null && Number.isFinite(pct) ? pct : null;
}

function cardPriorDayDollarVol(card: DiscoveryCardType): number | null {
  const v = card.priorDayDollarVol ?? card.context?.discovery_filters?.priorDayDollarVol;
  return v != null && Number.isFinite(v) && v > 0 ? v : null;
}

function matchesThemeStrength(card: DiscoveryCardType, filter: ThemeStrengthFilter): boolean {
  if (filter === "all") return true;
  // Market-wide / theme-subject cards aren't ticker-membership rows.
  if (card.subjectKind === "market" || card.subjectKind === "theme") return true;
  const pct = cardThemePercentile(card);
  // Unknown percentile ≠ weak — don't hide (same idea as unknown ADV$).
  if (pct == null) return true;
  if (filter === "top25") return pct >= 75;
  if (filter === "top50") return pct >= 50;
  if (filter === "bottom50") return pct < 50;
  return true;
}

function describeActiveSecondaryFilters(opts: {
  themeStrengthFilter: ThemeStrengthFilter;
  liquidityFilter: LiquidityFilter;
  directionFilter: "all" | "up" | "down";
  showUrgentOnly: boolean;
}): string[] {
  const bits: string[] = [];
  if (opts.themeStrengthFilter === "top25") bits.push("Theme Top 25%");
  else if (opts.themeStrengthFilter === "top50") bits.push("Theme Top 50%");
  else if (opts.themeStrengthFilter === "bottom50") bits.push("Theme Bot 50%");
  if (opts.liquidityFilter === "high") bits.push("Liq $ High");
  else if (opts.liquidityFilter === "mid") bits.push("Liq $ Mid");
  else if (opts.liquidityFilter === "low") bits.push("Liq $ Low");
  if (opts.directionFilter === "up") bits.push("Long only");
  else if (opts.directionFilter === "down") bits.push("Short only");
  if (opts.showUrgentOnly) bits.push("Urgent only");
  return bits;
}

function matchesLiquidity(card: DiscoveryCardType, filter: LiquidityFilter): boolean {
  if (filter === "all") return true;
  const adv = cardPriorDayDollarVol(card);
  // Theme-level / unknown ADV$: don't hide when liquidity filter is on
  if (adv == null) return true;
  if (filter === "high") return adv >= 100_000_000;
  if (filter === "mid") return adv >= 10_000_000 && adv < 100_000_000;
  if (filter === "low") return adv < 10_000_000;
  return true;
}

// ── Config field renderer ────────────────────────────────────────────────────

function ConfigField({ field, value, onChange, css, fo }: {
  field: ConfigFieldMeta;
  value: unknown;
  onChange: (v: unknown) => void;
  css: any;
  fo: number;
}) {
  if (field.type === "boolean") {
    return (
      <label className="flex items-center justify-between gap-2 py-0.5">
        <span style={{ color: css.textSmall, fontSize: scannerPx("small", fo) }}>{field.label}</span>
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
          className="h-3 w-3 accent-cyan-500"
        />
      </label>
    );
  }
  return (
    <label className="flex items-center justify-between gap-2 py-0.5">
      <span style={{ color: css.textSmall, fontSize: scannerPx("small", fo) }}>{field.label}</span>
      <div className="flex items-center gap-1">
        <input
          type="number"
          value={Number(value)}
          min={field.min}
          max={field.max}
          step={field.step}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="w-14 h-5 text-right bg-slate-900 border border-slate-700 rounded px-1 tabular-nums"
          style={{ color: css.textTitle, fontSize: scannerPx("small", fo) }}
        />
        {field.unit && (
          <span className="w-8" style={{ color: css.textTiny, fontSize: scannerPx("tiny", fo) }}>{field.unit}</span>
        )}
      </div>
    </label>
  );
}

// ── Storage keys ─────────────────────────────────────────────────────────────

const SCANNER_POPOUT_STORAGE = "scanner-popout-active";

function isPoppedOut(): boolean {
  try { return localStorage.getItem(SCANNER_POPOUT_STORAGE) === "true"; } catch { return false; }
}

// ── Main component ───────────────────────────────────────────────────────────

export function DiscoveryFeedPanel() {
  const [location, navigate] = useLocation();
  const { panelOpen, setPanelOpen, mode, setMode, discoveries, connected, status } = useScanner();
  const { cssVariables } = useAdminTheme();

  const [fontOffset, setFontOffset] = useState(() => loadScannerFontOffset());
  const [globalExpanded, setGlobalExpanded] = useState(false);
  const [showUrgentOnly, setShowUrgentOnly] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [signalTypeFilter, setSignalTypeFilter] = useState<SignalType | "all">("all");
  const [directionFilter, setDirectionFilter] = useState<"all" | "up" | "down">("all");
  const [themeStrengthFilter, setThemeStrengthFilter] = useState<ThemeStrengthFilter>("all");
  const [liquidityFilter, setLiquidityFilter] = useState<LiquidityFilter>("all");
  const [adminPanel, setAdminPanel] = useState<"none" | "rules" | "queue" | "config">("none");
  const [catalystRules, setCatalystRules] = useState<CatalystRuleDefinition[]>([]);
  const [catalystQueue, setCatalystQueue] = useState<CatalystEntry[]>([]);
  const [configData, setConfigData] = useState<ScannerConfig | null>(null);
  const [configDirty, setConfigDirty] = useState(false);
  const [rulesSaving, setRulesSaving] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<number | null>(null);
  const [poppedOut, setPoppedOut] = useState(() => isPoppedOut());
  const popoutWindowRef = useRef<Window | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const [historyMode, setHistoryMode] = useState(false);
  const [historyCards, setHistoryCards] = useState<DiscoveryCardType[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  /** Server-side type/category query (live last-N is flooded by ma_proximity). */
  const [historySignalType, setHistorySignalType] = useState<SignalType | "all">("all");
  const [historyCategory, setHistoryCategory] = useState<CategoryFilter | null>(null);

  const isOnPopoutRoute = location.startsWith("/scanner-popout") || location.startsWith("/workspace-popout");

  // ── BroadcastChannel: listen for popout close/navigate ────────────────────
  useEffect(() => {
    if (isOnPopoutRoute) return;
    const ch = new BroadcastChannel(SCANNER_POPOUT_CHANNEL);
    channelRef.current = ch;
    ch.onmessage = (ev: MessageEvent<ScannerPopoutMessage>) => {
      if (ev.data.type === "SCANNER_POPOUT_CLOSED") {
        setPoppedOut(false);
        try { localStorage.removeItem(SCANNER_POPOUT_STORAGE); } catch {}
      } else if (ev.data.type === "SCANNER_NAVIGATE") {
        navigate(ev.data.path);
      }
    };
    return () => { ch.close(); channelRef.current = null; };
  }, [isOnPopoutRoute, navigate]);

  const etToday = useCallback(() => {
    return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  }, []);

  const fetchTodayHistory = useCallback(async (signalType: SignalType | "all" = "all") => {
    setHistoryLoading(true);
    try {
      const params = new URLSearchParams({ date: etToday(), limit: "200" });
      if (signalType !== "all") params.set("signal_type", signalType);
      const res = await fetch(`/api/scanner/history?${params}`);
      if (res.ok) {
        const data = await res.json();
        setHistoryCards(data.discoveries ?? []);
        setHistorySignalType(signalType);
        setHistoryCategory(null);
        setHistoryMode(true);
      }
    } catch { /* ignore */ }
    setHistoryLoading(false);
  }, [etToday]);

  const fetchCategoryHistory = useCallback(async (cat: CategoryFilter) => {
    const types = CATEGORY_DB_TYPES[cat];
    if (!types || types.length === 0) {
      await fetchTodayHistory("all");
      return;
    }
    setHistoryLoading(true);
    try {
      const date = etToday();
      const batches = await Promise.all(
        types.map(async (st) => {
          const params = new URLSearchParams({ date, limit: "100", signal_type: st });
          const res = await fetch(`/api/scanner/history?${params}`);
          if (!res.ok) return [] as DiscoveryCardType[];
          const data = await res.json();
          return (data.discoveries ?? []) as DiscoveryCardType[];
        })
      );
      const byId = new Map<number, DiscoveryCardType>();
      for (const batch of batches) {
        for (const card of batch) byId.set(card.id, card);
      }
      const merged = [...byId.values()].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      setHistoryCards(merged);
      setHistorySignalType("all");
      setHistoryCategory(cat);
      setHistoryMode(true);
    } catch { /* ignore */ }
    setHistoryLoading(false);
  }, [etToday, fetchTodayHistory]);

  const exitHistoryMode = useCallback(() => {
    setHistoryMode(false);
    setHistoryCards([]);
    setHistorySignalType("all");
    setHistoryCategory(null);
  }, []);

  // Type filter must hit DB — live feed clears dead LOD cards, and "last 200 today"
  // is flooded by ma_proximity so client-only filter shows empty even when LODs exist.
  useEffect(() => {
    if (signalTypeFilter === "all") {
      if (historyMode && historySignalType !== "all") exitHistoryMode();
      return;
    }
    void fetchTodayHistory(signalTypeFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-fetch on type change
  }, [signalTypeFilter]);

  // Category chips (Theme / Setups / …) must also hit DB — same last-N starvation.
  useEffect(() => {
    if (signalTypeFilter !== "all") return; // type filter owns the query
    if (categoryFilter === "all" || categoryFilter === "catalyst") {
      if (historyMode && historyCategory) exitHistoryMode();
      return;
    }
    void fetchCategoryHistory(categoryFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryFilter, signalTypeFilter]);

  const fetchCatalystRules = useCallback(async () => {
    try {
      const res = await fetch("/api/scanner/catalysts/rules");
      if (!res.ok) return;
      const data = await res.json();
      setCatalystRules(data.rules ?? []);
    } catch { /* ignore */ }
  }, []);

  const fetchCatalystQueue = useCallback(async () => {
    try {
      const res = await fetch("/api/scanner/catalysts/queue");
      if (!res.ok) return;
      const data = await res.json();
      setCatalystQueue(data.catalysts ?? []);
    } catch { /* ignore */ }
  }, []);

  const updateRule = useCallback(async (id: string, updates: Record<string, unknown>) => {
    setRulesSaving(id);
    try {
      const res = await fetch(`/api/scanner/catalysts/rules/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        const data = await res.json();
        setCatalystRules((prev) => prev.map((r) => r.id === id ? data.rule : r));
      }
    } catch { /* ignore */ }
    setRulesSaving(null);
  }, []);

  const resolveActiveCatalyst = useCallback(async (id: number) => {
    setResolvingId(id);
    try {
      const res = await fetch(`/api/scanner/catalysts/resolve/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ magnitude: 0 }),
      });
      if (res.ok) {
        setCatalystQueue((prev) => prev.filter((c) => c.id !== id));
      }
    } catch { /* ignore */ }
    setResolvingId(null);
  }, []);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/scanner/config");
      if (!res.ok) return;
      const data = await res.json();
      setConfigData(data.config);
      setConfigDirty(false);
    } catch { /* ignore */ }
  }, []);

  const saveConfig = useCallback(async () => {
    if (!configData) return;
    try {
      const res = await fetch("/api/scanner/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(configData),
      });
      if (res.ok) {
        const data = await res.json();
        setConfigData(data.config);
        setConfigDirty(false);
      }
    } catch { /* ignore */ }
  }, [configData]);

  useEffect(() => {
    if (adminPanel === "rules") fetchCatalystRules();
    if (adminPanel === "queue") fetchCatalystQueue();
    if (adminPanel === "config") fetchConfig();
  }, [adminPanel, fetchCatalystRules, fetchCatalystQueue, fetchConfig]);

  const updateFontOffset = (value: number) => {
    setFontOffset(value);
    saveScannerFontOffset(undefined, value);
  };

  const fo = fontOffset; // shorthand for all scannerPx calls

  // Always show the full catalog so missing pipelines (e.g. LOD Bounce) are visible —
  // not only types that happen to be in the current in-memory feed.
  const availableSignalTypes = useMemo(() => {
    const present = new Set<SignalType>();
    for (const d of discoveries) present.add(d.signalType);
    if (historyMode) {
      for (const d of historyCards) present.add(d.signalType);
    }
    return (Object.keys(SIGNAL_TYPE_LABELS) as SignalType[]).sort((a, b) => {
      const aPresent = present.has(a) ? 0 : 1;
      const bPresent = present.has(b) ? 0 : 1;
      if (aPresent !== bPresent) return aPresent - bPresent;
      return SIGNAL_TYPE_LABELS[a].localeCompare(SIGNAL_TYPE_LABELS[b]);
    });
  }, [discoveries, historyCards, historyMode]);

  const signalTypeCounts = useMemo(() => {
    const cards = historyMode ? historyCards : discoveries;
    const counts = new Map<SignalType, number>();
    for (const d of cards) {
      counts.set(d.signalType, (counts.get(d.signalType) ?? 0) + 1);
    }
    return counts;
  }, [discoveries, historyCards, historyMode]);

  const baseCards = useMemo(() => {
    if (!historyMode) return discoveries;
    // Keep live stream cards of the active type/category visible on top of DB results.
    const ids = new Set(historyCards.map((c) => c.id));
    const liveExtra = discoveries.filter((d) => {
      if (ids.has(d.id)) return false;
      if (signalTypeFilter !== "all") return d.signalType === signalTypeFilter;
      if (historyCategory) return matchesCategory(d, historyCategory);
      return true;
    });
    return [...liveExtra, ...historyCards];
  }, [historyMode, historyCards, discoveries, signalTypeFilter, historyCategory]);

  const filteredCards = useMemo(() => {
    let cards = baseCards;
    if (signalTypeFilter !== "all") {
      cards = cards.filter((d) => d.signalType === signalTypeFilter);
    } else if (categoryFilter !== "all") {
      cards = cards.filter((d) => matchesCategory(d, categoryFilter));
    }
    if (directionFilter !== "all") cards = cards.filter((d) => d.direction === directionFilter);
    if (themeStrengthFilter !== "all") {
      cards = cards.filter((d) => matchesThemeStrength(d, themeStrengthFilter));
    }
    if (liquidityFilter !== "all") {
      cards = cards.filter((d) => matchesLiquidity(d, liquidityFilter));
    }
    if (showUrgentOnly) cards = cards.filter((d) => d.priority === "urgent" || (d.qualifyScore ?? 0) >= 80);
    return cards;
  }, [
    baseCards,
    showUrgentOnly,
    categoryFilter,
    signalTypeFilter,
    directionFilter,
    themeStrengthFilter,
    liquidityFilter,
  ]);

  const secondaryFilterLabels = useMemo(
    () =>
      describeActiveSecondaryFilters({
        themeStrengthFilter,
        liquidityFilter,
        directionFilter,
        showUrgentOnly,
      }),
    [themeStrengthFilter, liquidityFilter, directionFilter, showUrgentOnly]
  );

  const cycleMode = () => {
    const order: ScannerMode[] = ["on", "silent", "off"];
    const idx = order.indexOf(mode);
    setMode(order[(idx + 1) % order.length]!);
  };

  const updateConfigField = (key: string, value: unknown) => {
    setConfigData((prev) => prev ? { ...prev, [key]: value } : prev);
    setConfigDirty(true);
  };

  // ── Pop-out / Dock handlers ───────────────────────────────────────────────

  const handlePopOut = useCallback(() => {
    const w = window.open(
      "/scanner-popout",
      "scanner-popout",
      "width=420,height=700,menubar=no,toolbar=no,location=no,status=no"
    );
    if (w) {
      popoutWindowRef.current = w;
      setPoppedOut(true);
      try { localStorage.setItem(SCANNER_POPOUT_STORAGE, "true"); } catch {}
    }
  }, []);

  const handleDock = useCallback(() => {
    if (popoutWindowRef.current && !popoutWindowRef.current.closed) {
      popoutWindowRef.current.close();
    }
    channelRef.current?.postMessage({ type: "SCANNER_DOCK_REQUEST" } satisfies ScannerPopoutMessage);
    setPoppedOut(false);
    try { localStorage.removeItem(SCANNER_POPOUT_STORAGE); } catch {}
  }, []);

  // Group config fields
  const configGroups = useMemo(() => {
    const groups = new Map<string, ConfigFieldMeta[]>();
    for (const f of SCANNER_CONFIG_FIELDS) {
      const list = groups.get(f.group) ?? [];
      list.push(f);
      groups.set(f.group, list);
    }
    return groups;
  }, []);

  // Don't render the floating overlay on the popout route itself
  if (isOnPopoutRoute) return null;

  const titleBar = (
    <div className="flex items-center gap-2 min-w-0">
      <Radar className="h-4 w-4 text-cyan-400 shrink-0" />
      <span className="font-semibold truncate" style={{ color: cssVariables.textTitle, fontSize: cssVariables.fontSizeSection }}>
        Discovery Scanner
      </span>
      <span className={cn("text-[10px] font-bold uppercase", MODE_COLORS[mode])}>
        {MODE_LABELS[mode]}
      </span>
      {connected ? <Wifi className="h-3 w-3 text-emerald-400 shrink-0" /> : <WifiOff className="h-3 w-3 text-red-400 shrink-0" />}
      {!poppedOut && (
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 text-slate-400 hover:text-cyan-400 shrink-0 ml-auto"
          onClick={(e) => { e.stopPropagation(); handlePopOut(); }}
          title="Pop out scanner to separate window. Pro tip: once popped out, hit Win+Ctrl+T (requires Windows PowerToys) to pin it above everything — Excel, TOS, whatever."
        >
          <PictureInPicture2 className="h-3 w-3" />
        </Button>
      )}
    </div>
  );

  // If scanner is popped out, show placeholder inside the overlay
  if (poppedOut) {
    return (
      <FloatingOverlayPanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        storageKey={SCANNER_OVERLAY_STORAGE}
        defaultState={DEFAULT_OVERLAY}
        titleBar={titleBar}
        surfaceBg={cssVariables.secondaryBgSolid}
        borderColor={cssVariables.borderOnSecondary}
        titleBarBg={cssVariables.headerBg}
        surfaceSlotId="scanner:panel"
        titleBarSlotId="scanner:titleBar"
        zIndex={SCANNER_OVERLAY_Z}
      >
        <div className="flex flex-col items-center justify-center h-full gap-3 py-12">
          <PictureInPicture2 className="h-8 w-8 text-cyan-400/60" />
          <p className="text-sm" style={{ color: cssVariables.textSmall }}>
            Scanner is in a separate window
          </p>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs border-cyan-700/50 text-cyan-400 hover:bg-cyan-950/30"
            onClick={handleDock}
          >
            <MonitorDown className="h-3.5 w-3.5" />
            Bring Back
          </Button>
        </div>
      </FloatingOverlayPanel>
    );
  }

  return (
    <FloatingOverlayPanel
      open={panelOpen}
      onOpenChange={setPanelOpen}
      storageKey={SCANNER_OVERLAY_STORAGE}
      defaultState={DEFAULT_OVERLAY}
      titleBar={titleBar}
      surfaceBg={cssVariables.secondaryBgSolid}
      borderColor={cssVariables.borderOnSecondary}
      titleBarBg={cssVariables.headerBg}
      surfaceSlotId="scanner:panel"
      titleBarSlotId="scanner:titleBar"
      zIndex={SCANNER_OVERLAY_Z}
    >
      <div className="flex flex-col h-full gap-1.5">
        {/* Status + controls bar */}
        <div
          className="flex flex-wrap items-center justify-between gap-1.5 rounded border px-2 py-1.5 shrink-0"
          style={{ borderColor: cssVariables.borderOnSecondary, backgroundColor: "rgba(15,23,42,0.3)" }}
        >
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className={cn("h-6 px-2 text-[10px] font-bold uppercase", MODE_COLORS[mode])} onClick={cycleMode} title="Cycle mode: On → Silent → Off">
              {MODE_LABELS[mode]}
            </Button>
            {status && (
              <span className="tabular-nums" style={{ color: cssVariables.textTiny, fontSize: scannerPx("tiny", fo) }}>
                {status.universeSize} tickers · {status.activePipelines} pipes · {status.sessionMode.replace(/_/g, " ")}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-6 w-6 transition-colors",
                historyMode
                  ? "text-cyan-400 bg-cyan-950/30 ring-1 ring-cyan-700/40"
                  : "text-slate-500 hover:text-slate-300",
              )}
              onClick={historyMode ? exitHistoryMode : () => void fetchTodayHistory(signalTypeFilter)}
              title={historyMode ? "Back to live feed" : "Show today's signals from DB (respects type filter)"}
            >
              <CalendarDays className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-6 w-6 transition-colors",
                showUrgentOnly
                  ? "text-amber-400 bg-amber-950/30 ring-1 ring-amber-700/40"
                  : "text-slate-500 hover:text-slate-300",
              )}
              onClick={() => setShowUrgentOnly(!showUrgentOnly)}
              title={showUrgentOnly ? "Show all priorities" : "Urgent / high-score only"}
            >
              <Flame className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6 text-slate-500" onClick={() => setGlobalExpanded(!globalExpanded)} title={globalExpanded ? "Collapse all" : "Expand all"}>
              {globalExpanded ? <Shrink className="h-3 w-3" /> : <Expand className="h-3 w-3" />}
            </Button>
            <ScannerFontSizeControl value={fontOffset} onChange={updateFontOffset} />
          </div>
        </div>

        {/* Category filter bar */}
        <div className="flex items-center gap-1 shrink-0 px-0.5" onPointerDown={(e) => e.stopPropagation()}>
          {(["all", "theme", "news", "setups", "catalyst", "premarket"] as CategoryFilter[]).map((cat) => {
            const Icon = CATEGORY_ICONS[cat];
            const active = categoryFilter === cat;
            return (
              <button
                key={cat}
                type="button"
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border border-transparent px-2 py-1 capitalize transition-colors",
                  active
                    ? "text-cyan-400 bg-cyan-950/30 border-cyan-800/40"
                    : "text-slate-500 hover:text-slate-300 hover:bg-slate-800/40"
                )}
                style={{ fontSize: scannerPx("small", fo) }}
                onClick={(e) => {
                  e.stopPropagation();
                  setCategoryFilter(cat);
                  setSignalTypeFilter("all");
                }}
              >
                <Icon className="h-3 w-3" />
                {cat}
              </button>
            );
          })}
        </div>

        {/* Signal type dropdown filter — full catalog (counts show what’s in the feed) */}
        <div className="flex items-center gap-1.5 shrink-0 px-0.5" onPointerDown={(e) => e.stopPropagation()}>
          <ListFilter className="h-3 w-3 text-slate-500 shrink-0" />
          <select
            value={signalTypeFilter}
            onChange={(e) => setSignalTypeFilter(e.target.value as SignalType | "all")}
            className="flex-1 h-6 rounded border border-slate-700/60 bg-slate-900/80 px-1.5 text-slate-200 truncate appearance-auto cursor-pointer focus:outline-none focus:ring-1 focus:ring-cyan-700/50"
            style={{ fontSize: scannerPx("small", fo) }}
          >
              <option value="all">All Signals</option>
              {availableSignalTypes.map((st) => {
                const n = signalTypeCounts.get(st) ?? 0;
                return (
                  <option key={st} value={st}>
                    {SIGNAL_TYPE_LABELS[st]}{n > 0 ? ` (${n})` : ""}
                  </option>
                );
              })}
            </select>
        </div>
        {/* Direction filter (Long / Short / All) */}
        <div className="flex items-center gap-0.5 shrink-0" onPointerDown={(e) => e.stopPropagation()}>
          {(["all", "up", "down"] as const).map((dir) => {
            const active = directionFilter === dir;
            const label = dir === "all" ? "All" : dir === "up" ? "Long" : "Short";
            return (
              <button
                key={dir}
                onClick={(e) => { e.stopPropagation(); setDirectionFilter(dir); }}
                className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                  active
                    ? dir === "up" ? "bg-emerald-800/50 text-emerald-300 border border-emerald-600/50"
                    : dir === "down" ? "bg-red-800/50 text-red-300 border border-red-600/50"
                    : "bg-cyan-800/40 text-cyan-300 border border-cyan-600/50"
                    : "text-slate-400 hover:text-slate-200 border border-transparent"
                }`}
                style={{ fontSize: scannerPx("small", fo) }}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Theme strength (Flow percentile) */}
        <div className="flex items-center gap-1 shrink-0 px-0.5" onPointerDown={(e) => e.stopPropagation()}>
          <span className="text-slate-500 shrink-0 w-10" style={{ fontSize: scannerPx("tiny", fo) }}>Theme</span>
          <div className="flex flex-wrap items-center gap-0.5">
            {([
              ["all", "All"],
              ["top25", "Top 25%"],
              ["top50", "Top 50%"],
              ["bottom50", "Bot 50%"],
            ] as const).map(([id, label]) => {
              const active = themeStrengthFilter === id;
              return (
                <button
                  key={id}
                  type="button"
                  title={
                    id === "top25" ? "Theme Flow percentile ≥ 75"
                      : id === "top50" ? "Theme Flow percentile ≥ 50"
                        : id === "bottom50" ? "Theme Flow percentile < 50"
                          : "Any theme strength"
                  }
                  onClick={(e) => { e.stopPropagation(); setThemeStrengthFilter(id); }}
                  className={cn(
                    "px-1.5 py-0.5 rounded text-xs font-medium transition-colors border",
                    active
                      ? "bg-violet-900/40 text-violet-200 border-violet-600/50"
                      : "text-slate-400 hover:text-slate-200 border-transparent"
                  )}
                  style={{ fontSize: scannerPx("tiny", fo) }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Prior-day dollar volume liquidity */}
        <div className="flex items-center gap-1 shrink-0 px-0.5" onPointerDown={(e) => e.stopPropagation()}>
          <span className="text-slate-500 shrink-0 w-10" style={{ fontSize: scannerPx("tiny", fo) }}>Liq $</span>
          <div className="flex flex-wrap items-center gap-0.5">
            {([
              ["all", "All"],
              ["high", "High"],
              ["mid", "Mid"],
              ["low", "Low"],
            ] as const).map(([id, label]) => {
              const active = liquidityFilter === id;
              return (
                <button
                  key={id}
                  type="button"
                  title={
                    id === "high" ? "Prior-day $ volume ≥ $100M"
                      : id === "mid" ? "Prior-day $ volume $10M–$100M"
                        : id === "low" ? "Prior-day $ volume < $10M"
                          : "Any liquidity"
                  }
                  onClick={(e) => { e.stopPropagation(); setLiquidityFilter(id); }}
                  className={cn(
                    "px-1.5 py-0.5 rounded text-xs font-medium transition-colors border",
                    active
                      ? "bg-amber-900/40 text-amber-200 border-amber-600/50"
                      : "text-slate-400 hover:text-slate-200 border-transparent"
                  )}
                  style={{ fontSize: scannerPx("tiny", fo) }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* DB/history banner — stream stays connected; this is a filtered today view */}
        {historyMode && (
          <div className="flex items-center justify-between rounded border px-2 py-1 shrink-0" style={{ borderColor: "rgba(34,211,238,0.3)", backgroundColor: "rgba(34,211,238,0.05)" }}>
            <span style={{ color: cssVariables.textMarketFlow, fontSize: scannerPx("small", fo) }}>
              {historyLoading
                ? "Loading..."
                : (() => {
                    const label =
                      historySignalType !== "all"
                        ? SIGNAL_TYPE_LABELS[historySignalType]
                        : historyCategory
                          ? `${historyCategory} signals`
                          : "signals";
                    const loaded = baseCards.length;
                    const shown = filteredCards.length;
                    if (shown === loaded) return `${shown} ${label} today`;
                    return `${shown} of ${loaded} ${label} today`;
                  })()}
              {secondaryFilterLabels.length > 0 && filteredCards.length < baseCards.length
                ? ` · hidden by ${secondaryFilterLabels.join(", ")}`
                : ""}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-2 text-cyan-400 hover:text-cyan-300"
              style={{ fontSize: scannerPx("small", fo) }}
              onClick={() => {
                exitHistoryMode();
                setSignalTypeFilter("all");
                setCategoryFilter("all");
              }}
            >
              Clear view
            </Button>
          </div>
        )}

        {/* Discovery feed */}
        <div className="flex-1 overflow-y-auto space-y-1.5 min-h-0 pr-1">
          {filteredCards.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 py-8">
              <Radar className="h-8 w-8 text-slate-600" />
              <p style={{ color: cssVariables.textSmall, fontSize: scannerPx("body", fo) }}>
                {mode === "off"
                  ? "Scanner is off"
                  : baseCards.length > 0 && secondaryFilterLabels.length > 0
                    ? `${baseCards.length} loaded — hidden by ${secondaryFilterLabels.join(", ")}`
                    : signalTypeFilter !== "all" || categoryFilter !== "all"
                      ? "No discoveries for this filter today"
                      : "No discoveries yet — scanning..."}
              </p>
              {mode !== "off" && status?.lastSignalAt && (
                <p style={{ color: cssVariables.textTiny, fontSize: scannerPx("tiny", fo) }}>
                  Last signal:{" "}
                  {new Date(status.lastSignalAt).toLocaleTimeString("en-US", {
                    timeZone: "America/New_York",
                    hour: "numeric",
                    minute: "2-digit",
                    second: "2-digit",
                  })}{" "}
                  ET
                </p>
              )}
              {baseCards.length > 0 && secondaryFilterLabels.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-cyan-400"
                  style={{ fontSize: scannerPx("small", fo) }}
                  onClick={() => {
                    setThemeStrengthFilter("all");
                    setLiquidityFilter("all");
                    setDirectionFilter("all");
                    setShowUrgentOnly(false);
                  }}
                >
                  Reset Theme / Liq / direction filters
                </Button>
              )}
            </div>
          ) : (
            filteredCards.map((card) => (
              <DiscoveryCard key={card.id} card={card} fontSize={scannerPx("card", fo)} headlineFontSize={scannerPx("headline", fo)} globalExpanded={globalExpanded} />
            ))
          )}
        </div>

        {/* Admin sub-panels */}
        {adminPanel !== "none" && (
          <div className="shrink-0 border-t max-h-[250px] overflow-y-auto" style={{ borderColor: cssVariables.borderOnSecondary }}>
            <div className="flex items-center justify-between px-2 py-1">
              <span className="font-bold uppercase" style={{ color: cssVariables.textMarketFlow, fontSize: scannerPx("card", fo) }}>
                {adminPanel === "rules" ? "Catalyst Rules" : adminPanel === "queue" ? "Catalyst Queue" : "Scanner Config"}
              </span>
              <div className="flex items-center gap-1">
                {adminPanel === "config" && configDirty && (
                  <Button variant="ghost" size="sm" className="h-5 px-2 text-emerald-400" style={{ fontSize: scannerPx("small", fo) }} onClick={saveConfig}>
                    Save
                  </Button>
                )}
                <Button variant="ghost" size="sm" className="h-5 px-1 text-slate-400" style={{ fontSize: scannerPx("small", fo) }} onClick={() => setAdminPanel("none")}>
                  Close
                </Button>
              </div>
            </div>

            {adminPanel === "rules" && (
              <div className="space-y-1.5 px-2 pb-2">
                {catalystRules.length === 0 ? (
                  <p style={{ color: cssVariables.textTiny, fontSize: scannerPx("small", fo) }}>No rules loaded</p>
                ) : catalystRules.map((rule) => (
                  <div
                    key={rule.id}
                    className="rounded border px-2 py-1.5 space-y-1"
                    style={{
                      borderColor: rule.enabled ? "rgba(34,197,94,0.3)" : "rgba(100,116,139,0.3)",
                      backgroundColor: "rgba(15,23,42,0.3)",
                      opacity: rulesSaving === rule.id ? 0.6 : 1,
                    }}
                  >
                    {/* Row 1: name + enabled toggle */}
                    <div className="flex items-center justify-between gap-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className={cn("inline-block w-1.5 h-1.5 rounded-full shrink-0", rule.enabled ? "bg-emerald-400" : "bg-slate-500")} />
                        <span className="font-medium truncate" style={{ color: cssVariables.textTitle, fontSize: scannerPx("card", fo) }}>{rule.name}</span>
                      </div>
                      <label className="flex items-center gap-1 shrink-0 cursor-pointer">
                        <span style={{ color: cssVariables.textTiny, fontSize: scannerPx("tiny", fo) }}>
                          {rule.enabled ? "on" : "off"}
                        </span>
                        <input
                          type="checkbox"
                          checked={rule.enabled}
                          onChange={() => updateRule(rule.id, { enabled: !rule.enabled })}
                          className="h-3 w-3 accent-emerald-500 cursor-pointer"
                        />
                      </label>
                    </div>

                    {/* Row 2: event type + keywords */}
                    <div style={{ color: cssVariables.textSmall, fontSize: scannerPx("small", fo) }}>
                      <span className="font-medium" style={{ color: cssVariables.textTiny }}>{rule.catalystType.replace(/_/g, " ")}</span>
                      {rule.keywords.length > 0 && (
                        <span className="ml-1.5" style={{ color: cssVariables.textTiny }}>
                          [{rule.keywords.slice(0, 4).join(", ")}{rule.keywords.length > 4 ? ` +${rule.keywords.length - 4}` : ""}]
                        </span>
                      )}
                    </div>

                    {/* Row 3: editable decay window + shape + boost */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <label className="flex items-center gap-1">
                        <span style={{ color: cssVariables.textTiny, fontSize: scannerPx("tiny", fo) }}>Window</span>
                        <input
                          type="number"
                          min={1}
                          max={90}
                          value={rule.windowDays}
                          onChange={(e) => {
                            const v = parseInt(e.target.value, 10);
                            if (v > 0) updateRule(rule.id, { windowDays: v });
                          }}
                          className="w-10 h-5 text-right bg-slate-900 border border-slate-700 rounded px-1 tabular-nums"
                          style={{ color: cssVariables.textTitle, fontSize: scannerPx("tiny", fo) }}
                        />
                        <span style={{ color: cssVariables.textTiny, fontSize: scannerPx("tiny", fo) }}>d</span>
                      </label>

                      <label className="flex items-center gap-1">
                        <span style={{ color: cssVariables.textTiny, fontSize: scannerPx("tiny", fo) }}>Decay</span>
                        <select
                          value={rule.decayShape}
                          onChange={(e) => updateRule(rule.id, { decayShape: e.target.value as DecayShape })}
                          className="h-5 bg-slate-900 border border-slate-700 rounded px-1"
                          style={{ color: cssVariables.textTitle, fontSize: scannerPx("tiny", fo) }}
                        >
                          <option value="linear">linear</option>
                          <option value="slow">slow</option>
                          <option value="fast">fast</option>
                          <option value="step">step</option>
                        </select>
                      </label>

                      <span className="tabular-nums" style={{ color: cssVariables.textTiny, fontSize: scannerPx("tiny", fo) }}>
                        {rule.boostMultiplier}x boost
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {adminPanel === "queue" && (
              <div className="space-y-1.5 px-2 pb-2">
                {catalystQueue.length === 0 ? (
                  <p style={{ color: cssVariables.textTiny, fontSize: scannerPx("small", fo) }}>No active catalysts</p>
                ) : catalystQueue.map((cat) => {
                  const daysRemaining = Math.max(0, Math.ceil((new Date(cat.expiresAt).getTime() - Date.now()) / 86_400_000));
                  const decayPct = Math.round(Number(cat.decayWeight) * 100);
                  const barColor = decayPct > 60 ? "bg-emerald-500" : decayPct > 30 ? "bg-amber-500" : "bg-red-500";

                  return (
                    <div
                      key={cat.id}
                      className="rounded border px-2 py-1.5 space-y-1"
                      style={{
                        borderColor: decayPct > 50 ? "rgba(34,197,94,0.3)" : "rgba(234,179,8,0.3)",
                        backgroundColor: "rgba(15,23,42,0.3)",
                        opacity: resolvingId === cat.id ? 0.5 : 1,
                      }}
                    >
                      {/* Row 1: subject + resolve button */}
                      <div className="flex items-center justify-between gap-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-bold" style={{ color: cssVariables.textTitle, fontSize: scannerPx("card", fo) }}>{cat.subject}</span>
                          <span
                            className="rounded-sm px-1 py-px uppercase font-bold"
                            style={{
                              fontSize: scannerPx("tiny", fo),
                              color: cat.subjectKind === "ticker" ? "rgb(96,165,250)" : "rgb(168,85,247)",
                              backgroundColor: cat.subjectKind === "ticker" ? "rgba(96,165,250,0.1)" : "rgba(168,85,247,0.1)",
                            }}
                          >
                            {cat.subjectKind}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-slate-400 hover:text-red-400 hover:bg-red-950/30 transition-colors shrink-0"
                          style={{ fontSize: scannerPx("tiny", fo) }}
                          title="Resolve / dismiss this catalyst"
                          onClick={() => resolveActiveCatalyst(cat.id)}
                          disabled={resolvingId === cat.id}
                        >
                          <X className="h-2.5 w-2.5" /> resolve
                        </button>
                      </div>

                      {/* Row 2: event type + headline */}
                      <div>
                        <span className="font-medium" style={{ color: cssVariables.textTiny, fontSize: scannerPx("tiny", fo) }}>
                          {cat.catalystType.replace(/_/g, " ")}
                        </span>
                        <p className="truncate mt-0.5" style={{ color: cssVariables.textSmall, fontSize: scannerPx("small", fo) }}>{cat.headline}</p>
                      </div>

                      {/* Row 3: decay bar + stats */}
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden" title={`Decay weight: ${decayPct}%`}>
                          <div
                            className={cn("h-full rounded-full transition-all", barColor)}
                            style={{ width: `${decayPct}%` }}
                          />
                        </div>
                        <span className="tabular-nums shrink-0" style={{ color: cssVariables.textTiny, fontSize: scannerPx("tiny", fo) }}>
                          {decayPct}%
                        </span>
                      </div>

                      {/* Row 4: meta */}
                      <div className="flex items-center justify-between" style={{ color: cssVariables.textTiny, fontSize: scannerPx("tiny", fo) }}>
                        <span>{cat.initialReaction} → {cat.expectedDirection}</span>
                        <span className="tabular-nums">
                          {daysRemaining}d left · fired {new Date(cat.firedAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {adminPanel === "config" && configData && (
              <div className="px-2 pb-2 space-y-2">
                {Array.from(configGroups.entries()).map(([group, fields]) => (
                  <div key={group}>
                    <div className="font-bold uppercase mb-0.5" style={{ color: cssVariables.textMarketFlow, fontSize: scannerPx("small", fo) }}>{group}</div>
                    <div className="rounded border px-2 py-1 space-y-0.5" style={{ borderColor: "rgba(100,116,139,0.2)", backgroundColor: "rgba(15,23,42,0.3)" }}>
                      {fields.map((f) => (
                        <ConfigField
                          key={f.key}
                          field={f}
                          value={configData[f.key]}
                          onChange={(v) => updateConfigField(f.key, v)}
                          css={cssVariables}
                          fo={fo}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Footer: count + admin links */}
        <div className="flex items-center justify-between shrink-0 border-t pt-1.5" style={{ borderColor: cssVariables.borderOnSecondary }}>
          <div className="flex items-center gap-2">
            <span className="tabular-nums" style={{ color: cssVariables.textTiny, fontSize: scannerPx("tiny", fo) }}>
              {filteredCards.length} discoveries{showUrgentOnly ? " (urgent)" : ""}
            </span>
            <span className="tabular-nums" style={{ color: cssVariables.textTiny, fontSize: scannerPx("tiny", fo) }}>
              {status?.discoveriesToday ?? 0} today
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="h-5 px-1.5 gap-0.5 text-slate-500 hover:text-purple-400" style={{ fontSize: scannerPx("tiny", fo) }} onClick={() => window.open("/signal-workbench", "signal-workbench", "width=1200,height=900,menubar=no,toolbar=no,location=no,status=no")} title="Signals Lab">
              <FlaskConical className="h-2.5 w-2.5" />Signals Lab
            </Button>
            <Button variant="ghost" size="sm" className={cn("h-5 px-1.5 gap-0.5", adminPanel === "rules" ? "text-cyan-400" : "text-slate-500")} style={{ fontSize: scannerPx("tiny", fo) }} onClick={() => setAdminPanel(adminPanel === "rules" ? "none" : "rules")} title="Catalyst Rules (Admin)">
              <BookOpen className="h-2.5 w-2.5" />Rules
            </Button>
            <Button variant="ghost" size="sm" className={cn("h-5 px-1.5 gap-0.5", adminPanel === "queue" ? "text-cyan-400" : "text-slate-500")} style={{ fontSize: scannerPx("tiny", fo) }} onClick={() => setAdminPanel(adminPanel === "queue" ? "none" : "queue")} title="Catalyst Queue (Admin)">
              <Beaker className="h-2.5 w-2.5" />Queue
            </Button>
            <Button variant="ghost" size="sm" className={cn("h-5 px-1.5 gap-0.5", adminPanel === "config" ? "text-cyan-400" : "text-slate-500")} style={{ fontSize: scannerPx("tiny", fo) }} onClick={() => setAdminPanel(adminPanel === "config" ? "none" : "config")} title="Scanner Config (Admin)">
              <Settings2 className="h-2.5 w-2.5" />Config
            </Button>
          </div>
        </div>
      </div>
    </FloatingOverlayPanel>
  );
}
