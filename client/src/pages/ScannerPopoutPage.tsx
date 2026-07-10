// ---------------------------------------------------------------------------
// ScannerPopoutPage — standalone scanner window (opened via pop-out button)
//
// This is a full-page view of the DiscoveryFeed that runs in its own browser
// window. It gets its own ScannerProvider (own SSE connection). Ticker/theme
// clicks are forwarded to the main window via BroadcastChannel.
// ---------------------------------------------------------------------------

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { useSystemSettings } from "@/context/SystemSettingsContext";
import { useScanner } from "@/context/ScannerContext";
import {
  Radar, Wifi, WifiOff, ListFilter, Expand, Shrink,
  Beaker, BookOpen, Settings2, X, MonitorDown, FlaskConical,
  Layers, Newspaper, Crosshair, Zap, Globe, Sunrise, Flame, CalendarDays,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DiscoveryCard } from "@/components/scanner/DiscoveryCard";
import { ScannerFontSizeControl } from "@/components/scanner/ScannerFontSizeControl";
import {
  loadScannerFontOffset, saveScannerFontOffset, scannerPx,
} from "@/components/scanner/scanner-font-prefs";
import {
  SCANNER_POPOUT_CHANNEL, SCANNER_POPOUT_STORAGE_KEY,
  type ScannerPopoutMessage,
} from "@/components/scanner/scanner-popout-channel";
import type { ScannerMode, DiscoveryCard as DiscoveryCardType, SignalType } from "@shared/scanner-types";
import { SCANNER_CONFIG_FIELDS, type ScannerConfig, type ConfigFieldMeta } from "@shared/scanner-config";
import type { CatalystRuleDefinition, CatalystEntry, DecayShape } from "@shared/catalyst-types";

// ── Signal type labels (shared with DiscoveryFeed) ───────────────────────────

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

// ── Category filter logic ────────────────────────────────────────────────────

type CategoryFilter = "all" | "theme" | "news" | "setups" | "catalyst" | "premarket";

const CATEGORY_ICONS: Record<CategoryFilter, typeof Globe> = {
  all: Globe, theme: Layers, news: Newspaper, setups: Crosshair, catalyst: Zap, premarket: Sunrise,
};

const THEME_SIGNAL_TYPES: Set<SignalType> = new Set([
  "breadth_shift", "theme_acceleration", "broad_weakness", "broad_strength",
]);
const SETUP_SIGNAL_TYPES: Set<SignalType> = new Set([
  "lod_bounce", "ur_ma_reclaim", "prev_day_high_break", "prev_day_low_break",
  "five_day_high_break", "five_day_low_break",
  "failed_breakout", "hod_fade", "gap_down_continuation",
]);
const MARKET_SIGNAL_TYPES: Set<SignalType> = new Set(["regime_change", "rai_shift"]);
const NEWS_SIGNAL_TYPES: Set<SignalType> = new Set(["news_alert"]);
const PREMARKET_SIGNAL_TYPES: Set<SignalType> = new Set(["gap", "volume_spike", "news_alert"]);

function isPreMarketSession(isoString: string): boolean {
  const d = new Date(isoString);
  const et = new Date(d.toLocaleString("en-US", { timeZone: "America/New_York" }));
  return et.getHours() < 10;
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

// ── Mode metadata ────────────────────────────────────────────────────────────

const MODE_LABELS: Record<ScannerMode, string> = { on: "Active", silent: "Silent", off: "Off" };
const MODE_COLORS: Record<ScannerMode, string> = { on: "text-emerald-400", silent: "text-amber-400", off: "text-slate-500" };

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
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} className="h-3 w-3 accent-cyan-500" />
      </label>
    );
  }
  return (
    <label className="flex items-center justify-between gap-2 py-0.5">
      <span style={{ color: css.textSmall, fontSize: scannerPx("small", fo) }}>{field.label}</span>
      <div className="flex items-center gap-1">
        <input
          type="number" value={Number(value)} min={field.min} max={field.max} step={field.step}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="w-14 h-5 text-right bg-slate-900 border border-slate-700 rounded px-1 tabular-nums"
          style={{ color: css.textTitle, fontSize: scannerPx("small", fo) }}
        />
        {field.unit && <span className="w-8" style={{ color: css.textTiny, fontSize: scannerPx("tiny", fo) }}>{field.unit}</span>}
      </div>
    </label>
  );
}

// ── Main popout page ─────────────────────────────────────────────────────────

export default function ScannerPopoutPage() {
  const { pageShellStyle, cssVariables } = useSystemSettings();
  const { mode, setMode, discoveries, connected, status } = useScanner();
  const channelRef = useRef<BroadcastChannel | null>(null);

  const [fontOffset, setFontOffset] = useState(() => loadScannerFontOffset());
  const [globalExpanded, setGlobalExpanded] = useState(false);
  const [showUrgentOnly, setShowUrgentOnly] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [signalTypeFilter, setSignalTypeFilter] = useState<SignalType | "all">("all");
  const [directionFilter, setDirectionFilter] = useState<"all" | "up" | "down">("all");
  const [adminPanel, setAdminPanel] = useState<"none" | "rules" | "queue" | "config">("none");
  const [catalystRules, setCatalystRules] = useState<CatalystRuleDefinition[]>([]);
  const [catalystQueue, setCatalystQueue] = useState<CatalystEntry[]>([]);
  const [configData, setConfigData] = useState<ScannerConfig | null>(null);
  const [configDirty, setConfigDirty] = useState(false);
  const [rulesSaving, setRulesSaving] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<number | null>(null);
  const [historyMode, setHistoryMode] = useState(false);
  const [historyCards, setHistoryCards] = useState<import("@shared/scanner-types").DiscoveryCard[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const fo = fontOffset;

  // ── Set window title + notify parent on mount ─────────────────────────────
  useEffect(() => {
    document.title = "Scanner";
    const ch = new BroadcastChannel(SCANNER_POPOUT_CHANNEL);
    channelRef.current = ch;

    ch.postMessage({ type: "SCANNER_POPOUT_OPENED" } satisfies ScannerPopoutMessage);

    ch.onmessage = (ev: MessageEvent<ScannerPopoutMessage>) => {
      if (ev.data.type === "SCANNER_DOCK_REQUEST") {
        window.close();
      }
    };

    return () => { ch.close(); channelRef.current = null; };
  }, []);

  // ── Notify parent on unload ───────────────────────────────────────────────
  useEffect(() => {
    const handleUnload = () => {
      try { localStorage.removeItem(SCANNER_POPOUT_STORAGE_KEY); } catch {}
      channelRef.current?.postMessage({ type: "SCANNER_POPOUT_CLOSED" } satisfies ScannerPopoutMessage);
    };
    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  }, []);

  // ── Cross-window navigation helpers ───────────────────────────────────────
  const navigateMain = useCallback((path: string) => {
    channelRef.current?.postMessage({ type: "SCANNER_NAVIGATE", path } satisfies ScannerPopoutMessage);
  }, []);

  const handleOpenChart = useCallback((symbol: string) => {
    navigateMain(`/sentinel/charts?symbol=${symbol}`);
  }, [navigateMain]);

  const handleNavigateTheme = useCallback((themeId: string) => {
    navigateMain(`/sentinel/market-condition?theme=${themeId}`);
  }, [navigateMain]);

  // ── Dock handler (close this window) ──────────────────────────────────────
  const handleDock = useCallback(() => {
    try { localStorage.removeItem(SCANNER_POPOUT_STORAGE_KEY); } catch {}
    channelRef.current?.postMessage({ type: "SCANNER_POPOUT_CLOSED" } satisfies ScannerPopoutMessage);
    window.close();
  }, []);

  // ── Data fetchers ─────────────────────────────────────────────────────────
  const fetchCatalystRules = useCallback(async () => {
    try { const res = await fetch("/api/scanner/catalysts/rules"); if (!res.ok) return; setCatalystRules((await res.json()).rules ?? []); } catch {}
  }, []);
  const fetchCatalystQueue = useCallback(async () => {
    try { const res = await fetch("/api/scanner/catalysts/queue"); if (!res.ok) return; setCatalystQueue((await res.json()).catalysts ?? []); } catch {}
  }, []);
  const fetchConfig = useCallback(async () => {
    try { const res = await fetch("/api/scanner/config"); if (!res.ok) return; const d = await res.json(); setConfigData(d.config); setConfigDirty(false); } catch {}
  }, []);
  const saveConfig = useCallback(async () => {
    if (!configData) return;
    try { const res = await fetch("/api/scanner/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(configData) }); if (res.ok) { const d = await res.json(); setConfigData(d.config); setConfigDirty(false); } } catch {}
  }, [configData]);
  const updateRule = useCallback(async (id: string, updates: Record<string, unknown>) => {
    setRulesSaving(id);
    try { const res = await fetch(`/api/scanner/catalysts/rules/${encodeURIComponent(id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updates) }); if (res.ok) { const d = await res.json(); setCatalystRules((prev) => prev.map((r) => r.id === id ? d.rule : r)); } } catch {}
    setRulesSaving(null);
  }, []);
  const resolveActiveCatalyst = useCallback(async (id: number) => {
    setResolvingId(id);
    try { const res = await fetch(`/api/scanner/catalysts/resolve/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ magnitude: 0 }) }); if (res.ok) { setCatalystQueue((prev) => prev.filter((c) => c.id !== id)); } } catch {}
    setResolvingId(null);
  }, []);

  useEffect(() => {
    if (adminPanel === "rules") fetchCatalystRules();
    if (adminPanel === "queue") fetchCatalystQueue();
    if (adminPanel === "config") fetchConfig();
  }, [adminPanel, fetchCatalystRules, fetchCatalystQueue, fetchConfig]);

  const updateFontOffset = (value: number) => { setFontOffset(value); saveScannerFontOffset(undefined, value); };
  const updateConfigField = (key: string, value: unknown) => { setConfigData((prev) => prev ? { ...prev, [key]: value } : prev); setConfigDirty(true); };

  const fetchTodayHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const res = await fetch(`/api/scanner/history?date=${today}&limit=200`);
      if (res.ok) {
        const data = await res.json();
        setHistoryCards(data.discoveries ?? []);
        setHistoryMode(true);
      }
    } catch { /* ignore */ }
    setHistoryLoading(false);
  }, []);

  const exitHistoryMode = useCallback(() => {
    setHistoryMode(false);
    setHistoryCards([]);
  }, []);

  const cycleMode = () => {
    const order: ScannerMode[] = ["on", "silent", "off"];
    setMode(order[(order.indexOf(mode) + 1) % order.length]!);
  };

  const availableSignalTypes = useMemo(() => {
    const types = new Set<SignalType>();
    for (const d of discoveries) types.add(d.signalType);
    return Array.from(types).sort((a, b) => SIGNAL_TYPE_LABELS[a].localeCompare(SIGNAL_TYPE_LABELS[b]));
  }, [discoveries]);

  const filteredCards = useMemo(() => {
    let cards = historyMode ? historyCards : discoveries;
    if (signalTypeFilter !== "all") cards = cards.filter((d) => d.signalType === signalTypeFilter);
    else if (categoryFilter !== "all") cards = cards.filter((d) => matchesCategory(d, categoryFilter));
    if (directionFilter !== "all") cards = cards.filter((d) => d.direction === directionFilter);
    if (showUrgentOnly) cards = cards.filter((d) => d.priority === "urgent" || (d.qualifyScore ?? 0) >= 80);
    return cards;
  }, [discoveries, historyCards, historyMode, showUrgentOnly, categoryFilter, signalTypeFilter, directionFilter]);

  const configGroups = useMemo(() => {
    const groups = new Map<string, ConfigFieldMeta[]>();
    for (const f of SCANNER_CONFIG_FIELDS) { const list = groups.get(f.group) ?? []; list.push(f); groups.set(f.group, list); }
    return groups;
  }, []);

  return (
    <div className="flex flex-col h-dvh min-h-0 sentinel-page" style={pageShellStyle as React.CSSProperties}>
      {/* Title bar */}
      <div
        className="flex items-center justify-between gap-2 px-3 py-2 shrink-0 border-b"
        style={{ backgroundColor: cssVariables.headerBg, borderColor: cssVariables.borderOnSecondary }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Radar className="h-4 w-4 text-cyan-400 shrink-0" />
          <span className="font-semibold text-sm" style={{ color: cssVariables.textTitle }} title="Pin this window on top: Win+Ctrl+T (requires PowerToys)">Scanner</span>
          <span className={cn("text-[10px] font-bold uppercase", MODE_COLORS[mode])}>{MODE_LABELS[mode]}</span>
          {connected ? <Wifi className="h-3 w-3 text-emerald-400" /> : <WifiOff className="h-3 w-3 text-red-400" />}
          <span className="text-[9px] text-slate-600 hidden sm:inline" title="Pin this window on top: Win+Ctrl+T (requires Windows PowerToys)">📌 Win+Ctrl+T to pin on top</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 h-6 text-xs text-slate-400 hover:text-cyan-400"
          onClick={handleDock}
          title="Dock scanner back into main window"
        >
          <MonitorDown className="h-3.5 w-3.5" />
          Dock
        </Button>
      </div>

      {/* Main content */}
      <div className="flex flex-col flex-1 min-h-0 gap-1.5 p-2">
        {/* Controls bar */}
        <div
          className="flex flex-wrap items-center justify-between gap-1.5 rounded border px-2 py-1.5 shrink-0"
          style={{ borderColor: cssVariables.borderOnSecondary, backgroundColor: "rgba(15,23,42,0.3)" }}
        >
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className={cn("h-6 px-2 text-[10px] font-bold uppercase", MODE_COLORS[mode])} onClick={cycleMode} title="Cycle mode">
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
              variant="ghost" size="icon"
              className={cn("h-6 w-6 transition-colors", historyMode ? "text-cyan-400 bg-cyan-950/30 ring-1 ring-cyan-700/40" : "text-slate-500 hover:text-slate-300")}
              onClick={historyMode ? exitHistoryMode : fetchTodayHistory}
              title={historyMode ? "Back to live feed" : "Show all of today's signals from DB"}
            >
              <CalendarDays className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost" size="icon"
              className={cn("h-6 w-6 transition-colors", showUrgentOnly ? "text-amber-400 bg-amber-950/30 ring-1 ring-amber-700/40" : "text-slate-500 hover:text-slate-300")}
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
        <div className="flex items-center gap-1 shrink-0 px-0.5">
          {(["all", "theme", "news", "setups", "catalyst", "premarket"] as CategoryFilter[]).map((cat) => {
            const Icon = CATEGORY_ICONS[cat];
            const active = categoryFilter === cat;
            return (
              <button
                key={cat} type="button"
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border border-transparent px-2 py-1 capitalize transition-colors",
                  active ? "text-cyan-400 bg-cyan-950/30 border-cyan-800/40" : "text-slate-500 hover:text-slate-300 hover:bg-slate-800/40"
                )}
                style={{ fontSize: scannerPx("small", fo) }}
                onClick={() => { setCategoryFilter(cat); setSignalTypeFilter("all"); }}
              >
                <Icon className="h-3 w-3" />{cat}
              </button>
            );
          })}
        </div>

        {/* Signal type dropdown */}
        {availableSignalTypes.length > 0 && (
          <div className="flex items-center gap-1.5 shrink-0 px-0.5">
            <ListFilter className="h-3 w-3 text-slate-500 shrink-0" />
            <select
              value={signalTypeFilter}
              onChange={(e) => setSignalTypeFilter(e.target.value as SignalType | "all")}
              className="flex-1 h-6 rounded border border-slate-700/60 bg-slate-900/80 px-1.5 text-slate-200 truncate appearance-auto cursor-pointer focus:outline-none focus:ring-1 focus:ring-cyan-700/50"
              style={{ fontSize: scannerPx("small", fo) }}
            >
              <option value="all">All Signals</option>
              {availableSignalTypes.map((st) => <option key={st} value={st}>{SIGNAL_TYPE_LABELS[st]}</option>)}
            </select>
          </div>
        )}

        {/* Direction filter (Long / Short / All) */}
        <div className="flex items-center gap-0.5 shrink-0">
          {(["all", "up", "down"] as const).map((dir) => {
            const active = directionFilter === dir;
            const label = dir === "all" ? "All" : dir === "up" ? "Long" : "Short";
            return (
              <button
                key={dir}
                onClick={() => setDirectionFilter(dir)}
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

        {/* History mode banner */}
        {historyMode && (
          <div className="flex items-center justify-between rounded border px-2 py-1 shrink-0" style={{ borderColor: "rgba(34,211,238,0.3)", backgroundColor: "rgba(34,211,238,0.05)" }}>
            <span style={{ color: cssVariables.textMarketFlow, fontSize: scannerPx("small", fo) }}>
              {historyLoading ? "Loading..." : `Showing all ${historyCards.length} signals from today`}
            </span>
            <Button variant="ghost" size="sm" className="h-5 px-2 text-cyan-400 hover:text-cyan-300" style={{ fontSize: scannerPx("small", fo) }} onClick={exitHistoryMode}>
              Back to Live
            </Button>
          </div>
        )}

        {/* Discovery feed */}
        <div className="flex-1 overflow-y-auto space-y-1.5 min-h-0 pr-1">
          {filteredCards.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 py-8">
              <Radar className="h-8 w-8 text-slate-600" />
              <p style={{ color: cssVariables.textSmall, fontSize: scannerPx("body", fo) }}>
                {mode === "off" ? "Scanner is off" : "No discoveries yet — scanning..."}
              </p>
              {mode !== "off" && status?.lastSignalAt && (
                <p style={{ color: cssVariables.textTiny, fontSize: scannerPx("tiny", fo) }}>
                  Last signal: {new Date(status.lastSignalAt).toLocaleTimeString()}
                </p>
              )}
            </div>
          ) : (
            filteredCards.map((card) => (
              <DiscoveryCard
                key={card.id}
                card={card}
                fontSize={scannerPx("card", fo)}
                headlineFontSize={scannerPx("headline", fo)}
                globalExpanded={globalExpanded}
                onOpenChart={handleOpenChart}
                onNavigateTheme={handleNavigateTheme}
              />
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
                  <Button variant="ghost" size="sm" className="h-5 px-2 text-emerald-400" style={{ fontSize: scannerPx("small", fo) }} onClick={saveConfig}>Save</Button>
                )}
                <Button variant="ghost" size="sm" className="h-5 px-1 text-slate-400" style={{ fontSize: scannerPx("small", fo) }} onClick={() => setAdminPanel("none")}>Close</Button>
              </div>
            </div>

            {adminPanel === "rules" && (
              <div className="space-y-1.5 px-2 pb-2">
                {catalystRules.length === 0 ? (
                  <p style={{ color: cssVariables.textTiny, fontSize: scannerPx("small", fo) }}>No rules loaded</p>
                ) : catalystRules.map((rule) => (
                  <div key={rule.id} className="rounded border px-2 py-1.5 space-y-1" style={{ borderColor: rule.enabled ? "rgba(34,197,94,0.3)" : "rgba(100,116,139,0.3)", backgroundColor: "rgba(15,23,42,0.3)", opacity: rulesSaving === rule.id ? 0.6 : 1 }}>
                    <div className="flex items-center justify-between gap-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className={cn("inline-block w-1.5 h-1.5 rounded-full shrink-0", rule.enabled ? "bg-emerald-400" : "bg-slate-500")} />
                        <span className="font-medium truncate" style={{ color: cssVariables.textTitle, fontSize: scannerPx("card", fo) }}>{rule.name}</span>
                      </div>
                      <label className="flex items-center gap-1 shrink-0 cursor-pointer">
                        <span style={{ color: cssVariables.textTiny, fontSize: scannerPx("tiny", fo) }}>{rule.enabled ? "on" : "off"}</span>
                        <input type="checkbox" checked={rule.enabled} onChange={() => updateRule(rule.id, { enabled: !rule.enabled })} className="h-3 w-3 accent-emerald-500 cursor-pointer" />
                      </label>
                    </div>
                    <div style={{ color: cssVariables.textSmall, fontSize: scannerPx("small", fo) }}>
                      <span className="font-medium" style={{ color: cssVariables.textTiny }}>{rule.catalystType.replace(/_/g, " ")}</span>
                      {rule.keywords.length > 0 && <span className="ml-1.5" style={{ color: cssVariables.textTiny }}>[{rule.keywords.slice(0, 4).join(", ")}{rule.keywords.length > 4 ? ` +${rule.keywords.length - 4}` : ""}]</span>}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <label className="flex items-center gap-1">
                        <span style={{ color: cssVariables.textTiny, fontSize: scannerPx("tiny", fo) }}>Window</span>
                        <input type="number" min={1} max={90} value={rule.windowDays} onChange={(e) => { const v = parseInt(e.target.value, 10); if (v > 0) updateRule(rule.id, { windowDays: v }); }} className="w-10 h-5 text-right bg-slate-900 border border-slate-700 rounded px-1 tabular-nums" style={{ color: cssVariables.textTitle, fontSize: scannerPx("tiny", fo) }} />
                        <span style={{ color: cssVariables.textTiny, fontSize: scannerPx("tiny", fo) }}>d</span>
                      </label>
                      <label className="flex items-center gap-1">
                        <span style={{ color: cssVariables.textTiny, fontSize: scannerPx("tiny", fo) }}>Decay</span>
                        <select value={rule.decayShape} onChange={(e) => updateRule(rule.id, { decayShape: e.target.value as DecayShape })} className="h-5 bg-slate-900 border border-slate-700 rounded px-1" style={{ color: cssVariables.textTitle, fontSize: scannerPx("tiny", fo) }}>
                          <option value="linear">linear</option><option value="slow">slow</option><option value="fast">fast</option><option value="step">step</option>
                        </select>
                      </label>
                      <span className="tabular-nums" style={{ color: cssVariables.textTiny, fontSize: scannerPx("tiny", fo) }}>{rule.boostMultiplier}x boost</span>
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
                    <div key={cat.id} className="rounded border px-2 py-1.5 space-y-1" style={{ borderColor: decayPct > 50 ? "rgba(34,197,94,0.3)" : "rgba(234,179,8,0.3)", backgroundColor: "rgba(15,23,42,0.3)", opacity: resolvingId === cat.id ? 0.5 : 1 }}>
                      <div className="flex items-center justify-between gap-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-bold" style={{ color: cssVariables.textTitle, fontSize: scannerPx("card", fo) }}>{cat.subject}</span>
                          <span className="rounded-sm px-1 py-px uppercase font-bold" style={{ fontSize: scannerPx("tiny", fo), color: cat.subjectKind === "ticker" ? "rgb(96,165,250)" : "rgb(168,85,247)", backgroundColor: cat.subjectKind === "ticker" ? "rgba(96,165,250,0.1)" : "rgba(168,85,247,0.1)" }}>{cat.subjectKind}</span>
                        </div>
                        <button type="button" className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-slate-400 hover:text-red-400 hover:bg-red-950/30 transition-colors shrink-0" style={{ fontSize: scannerPx("tiny", fo) }} title="Resolve" onClick={() => resolveActiveCatalyst(cat.id)} disabled={resolvingId === cat.id}>
                          <X className="h-2.5 w-2.5" /> resolve
                        </button>
                      </div>
                      <div>
                        <span className="font-medium" style={{ color: cssVariables.textTiny, fontSize: scannerPx("tiny", fo) }}>{cat.catalystType.replace(/_/g, " ")}</span>
                        <p className="truncate mt-0.5" style={{ color: cssVariables.textSmall, fontSize: scannerPx("small", fo) }}>{cat.headline}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden" title={`Decay weight: ${decayPct}%`}>
                          <div className={cn("h-full rounded-full transition-all", barColor)} style={{ width: `${decayPct}%` }} />
                        </div>
                        <span className="tabular-nums shrink-0" style={{ color: cssVariables.textTiny, fontSize: scannerPx("tiny", fo) }}>{decayPct}%</span>
                      </div>
                      <div className="flex items-center justify-between" style={{ color: cssVariables.textTiny, fontSize: scannerPx("tiny", fo) }}>
                        <span>{cat.initialReaction} → {cat.expectedDirection}</span>
                        <span className="tabular-nums">{daysRemaining}d left · fired {new Date(cat.firedAt).toLocaleDateString()}</span>
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
                      {fields.map((f) => <ConfigField key={f.key} field={f} value={configData[f.key]} onChange={(v) => updateConfigField(f.key, v)} css={cssVariables} fo={fo} />)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
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
            <Button variant="ghost" size="sm" className="h-5 px-1.5 gap-0.5 text-slate-500 hover:text-purple-400" style={{ fontSize: scannerPx("tiny", fo) }} onClick={() => window.open("/signal-workbench", "signal-workbench", "width=1200,height=900,menubar=no,toolbar=no,location=no,status=no")} title="Signal Workbench (Admin)">
              <FlaskConical className="h-2.5 w-2.5" />Lab
            </Button>
            <Button variant="ghost" size="sm" className={cn("h-5 px-1.5 gap-0.5", adminPanel === "rules" ? "text-cyan-400" : "text-slate-500")} style={{ fontSize: scannerPx("tiny", fo) }} onClick={() => setAdminPanel(adminPanel === "rules" ? "none" : "rules")} title="Catalyst Rules">
              <BookOpen className="h-2.5 w-2.5" />Rules
            </Button>
            <Button variant="ghost" size="sm" className={cn("h-5 px-1.5 gap-0.5", adminPanel === "queue" ? "text-cyan-400" : "text-slate-500")} style={{ fontSize: scannerPx("tiny", fo) }} onClick={() => setAdminPanel(adminPanel === "queue" ? "none" : "queue")} title="Catalyst Queue">
              <Beaker className="h-2.5 w-2.5" />Queue
            </Button>
            <Button variant="ghost" size="sm" className={cn("h-5 px-1.5 gap-0.5", adminPanel === "config" ? "text-cyan-400" : "text-slate-500")} style={{ fontSize: scannerPx("tiny", fo) }} onClick={() => setAdminPanel(adminPanel === "config" ? "none" : "config")} title="Scanner Config">
              <Settings2 className="h-2.5 w-2.5" />Config
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
