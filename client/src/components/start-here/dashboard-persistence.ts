import type { Layout } from "react-grid-layout/legacy";
import type { StartHereInterval } from "@/components/MiniChart";

export const START_HERE_DASHBOARD_VERSION = 4 as const;

export const PALETTE = [
  { label: "Emerald", color: "#22c55e" },
  { label: "Sky", color: "#38bdf8" },
  { label: "Violet", color: "#a855f7" },
  { label: "Amber", color: "#f59e0b" },
  { label: "Rose", color: "#f43f5e" },
  { label: "Cyan", color: "#06b6d4" },
] as const;

export type StartHereWidgetType = "watchlist" | "chart" | "news";

export interface StartHereGroupState {
  colorIndex: number;
  symbol: string;
}

export interface StartHereInstanceMeta {
  type: StartHereWidgetType;
  groupId: string;
  /** Chart preview timeframe; only for `type === "chart"`. */
  chartInterval?: StartHereInterval;
}

export interface StartHereDashboardV2 {
  v: typeof START_HERE_DASHBOARD_VERSION;
  layout: Layout;
  instances: Record<string, StartHereInstanceMeta>;
  groups: Record<string, StartHereGroupState>;
  /** Chart instance whose w/h (and timeframe template) define new charts from the watchlist. */
  defaultChartInstanceId?: string | null;
  /** Timeframe for the default template chart; copied onto watchlist-spawned charts. */
  defaultChartInterval?: StartHereInterval;
}

const LEGACY_WIDGET_IDS = ["watchlist", "chart", "news"] as const;

/** Default workspace id after multi-start migration */
export const DEFAULT_START_ID = "home";
export const DEFAULT_START_NAME = "HOME Start";

/** Per–Start workspace dashboard JSON */
export function dashboardStorageKey(userId: number, startId: string) {
  return `startHere.dashboard.${userId}.${startId}`;
}

/** Pre–multi-start key: `startHere.dashboard.${userId}` */
export function legacyUndecoratedDashboardStorageKey(userId: number) {
  return `startHere.dashboard.${userId}`;
}

const startProfilesStorageKey = (userId: number) => `startHere.startProfiles.${userId}`;
const activeStartStorageKey = (userId: number) => `startHere.activeStart.${userId}`;

export interface StartHereStartProfile {
  id: string;
  name: string;
}

export function loadStartProfiles(userId: number): StartHereStartProfile[] {
  try {
    const raw = localStorage.getItem(startProfilesStorageKey(userId));
    if (!raw) return [];
    const p = JSON.parse(raw) as unknown;
    if (!Array.isArray(p)) return [];
    return p.filter(
      (x): x is StartHereStartProfile =>
        !!x &&
        typeof x === "object" &&
        typeof (x as StartHereStartProfile).id === "string" &&
        typeof (x as StartHereStartProfile).name === "string"
    );
  } catch {
    return [];
  }
}

export function saveStartProfiles(userId: number, profiles: StartHereStartProfile[]) {
  try {
    localStorage.setItem(startProfilesStorageKey(userId), JSON.stringify(profiles));
  } catch {
    /* ignore */
  }
}

export function loadActiveStartId(userId: number): string | null {
  try {
    return localStorage.getItem(activeStartStorageKey(userId));
  } catch {
    return null;
  }
}

export function saveActiveStartId(userId: number, startId: string) {
  try {
    localStorage.setItem(activeStartStorageKey(userId), startId);
  } catch {
    /* ignore */
  }
}

export function migrateLegacyUndecoratedDashboard(userId: number): void {
  try {
    const oldK = legacyUndecoratedDashboardStorageKey(userId);
    const newK = dashboardStorageKey(userId, DEFAULT_START_ID);
    const raw = localStorage.getItem(oldK);
    if (!raw) return;
    if (!localStorage.getItem(newK)) {
      localStorage.setItem(newK, raw);
    }
  } catch {
    /* ignore */
  }
}

export function ensureStartProfilesAndActive(userId: number): {
  profiles: StartHereStartProfile[];
  activeStartId: string;
} {
  migrateLegacyUndecoratedDashboard(userId);
  let profiles = loadStartProfiles(userId);
  if (profiles.length === 0) {
    profiles = [{ id: DEFAULT_START_ID, name: DEFAULT_START_NAME }];
    saveStartProfiles(userId, profiles);
  }
  let active = loadActiveStartId(userId);
  if (!active || !profiles.some((p) => p.id === active)) {
    active = profiles[0]!.id;
    saveActiveStartId(userId, active);
  }
  return { profiles, activeStartId: active };
}

export function newStartProfileId(): string {
  return `sh_s_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export function legacyLayoutStorageKey(userId: number) {
  return `startHere.layout.${userId}`;
}

export function startHereWatchlistStorageKey(
  userId: number,
  groupId: string,
  startId: string
) {
  return `startHere.watchlistPick.${userId}.${startId}.${groupId}`;
}

/** Keys written before per-Start workspaces */
export function legacyWatchlistStorageKey(userId: number, groupId: string) {
  return `startHere.watchlistPick.${userId}.${groupId}`;
}

export function startHereNewsModeStorageKey(
  userId: number,
  instanceId: string,
  startId: string
) {
  return `startHere.newsMode.${userId}.${startId}.${instanceId}`;
}

export function legacyNewsModeStorageKey(userId: number, instanceId: string) {
  return `startHere.newsMode.${userId}.${instanceId}`;
}

const legacyAuxMigratedFlagKey = (userId: number) =>
  `startHere.legacyAuxMigrated.${userId}`;

/** One-time copy of legacy watchlist/news keys into the HOME workspace */
export function migrateLegacyAuxiliaryKeysForHome(
  userId: number,
  dashboard: StartHereDashboardV2
): void {
  try {
    if (localStorage.getItem(legacyAuxMigratedFlagKey(userId)) === "1") return;
    for (const groupId of Object.keys(dashboard.groups)) {
      const legacy = legacyWatchlistStorageKey(userId, groupId);
      const v = localStorage.getItem(legacy);
      if (v == null) continue;
      const neu = startHereWatchlistStorageKey(userId, groupId, DEFAULT_START_ID);
      if (localStorage.getItem(neu) == null) {
        localStorage.setItem(neu, v);
      }
    }
    for (const instId of Object.keys(dashboard.instances)) {
      const legacy = legacyNewsModeStorageKey(userId, instId);
      const v = localStorage.getItem(legacy);
      if (v == null) continue;
      const neu = startHereNewsModeStorageKey(userId, instId, DEFAULT_START_ID);
      if (localStorage.getItem(neu) == null) {
        localStorage.setItem(neu, v);
      }
    }
    localStorage.setItem(legacyAuxMigratedFlagKey(userId), "1");
  } catch {
    /* ignore */
  }
}

export function remapDashboardIds(dashboard: StartHereDashboardV2): {
  dashboard: StartHereDashboardV2;
  instanceMap: Record<string, string>;
  groupMap: Record<string, string>;
} {
  const instanceMap: Record<string, string> = {};
  for (const id of Object.keys(dashboard.instances)) {
    instanceMap[id] = newInstanceId();
  }
  const groupMap: Record<string, string> = {};
  for (const id of Object.keys(dashboard.groups)) {
    groupMap[id] = newGroupId();
  }
  const layout = dashboard.layout.map((l) => ({
    ...l,
    i: instanceMap[l.i] ?? l.i,
  }));
  const instances: Record<string, StartHereInstanceMeta> = {};
  for (const [oldI, meta] of Object.entries(dashboard.instances)) {
    const newI = instanceMap[oldI];
    const newG = groupMap[meta.groupId];
    if (!newI || !newG) continue;
    if (meta.type === "chart") {
      const ci = isStartHereInterval(meta.chartInterval) ? meta.chartInterval : undefined;
      instances[newI] = {
        type: "chart",
        groupId: newG,
        ...(ci ? { chartInterval: ci } : {}),
      };
    } else {
      instances[newI] = { type: meta.type, groupId: newG };
    }
  }
  const groups: Record<string, StartHereGroupState> = {};
  for (const [oldG, g] of Object.entries(dashboard.groups)) {
    const ng = groupMap[oldG];
    if (ng) groups[ng] = { ...g };
  }
  let defaultChartInstanceId = dashboard.defaultChartInstanceId ?? null;
  if (defaultChartInstanceId && instanceMap[defaultChartInstanceId]) {
    defaultChartInstanceId = instanceMap[defaultChartInstanceId];
  } else {
    defaultChartInstanceId = null;
  }
  const raw: StartHereDashboardV2 = {
    ...dashboard,
    layout,
    instances,
    groups,
    defaultChartInstanceId,
    defaultChartInterval: dashboard.defaultChartInterval ?? "1d",
  };
  const cleaned = sanitizeDashboard(raw);
  return {
    dashboard: cleaned,
    instanceMap,
    groupMap,
  };
}

export function copyWatchlistAndNewsStorageForDuplicate(
  userId: number,
  fromStartId: string,
  toStartId: string,
  instanceMap: Record<string, string>,
  groupMap: Record<string, string>
): void {
  try {
    for (const [oldG, newG] of Object.entries(groupMap)) {
      const fromK = startHereWatchlistStorageKey(userId, oldG, fromStartId);
      const toK = startHereWatchlistStorageKey(userId, newG, toStartId);
      const v = localStorage.getItem(fromK);
      if (v != null) localStorage.setItem(toK, v);
    }
    for (const [oldI, newI] of Object.entries(instanceMap)) {
      const fromK = startHereNewsModeStorageKey(userId, oldI, fromStartId);
      const toK = startHereNewsModeStorageKey(userId, newI, toStartId);
      const v = localStorage.getItem(fromK);
      if (v != null) localStorage.setItem(toK, v);
    }
  } catch {
    /* ignore */
  }
}

export function purgeStartWorkspaceStorage(
  userId: number,
  startId: string,
  dashboard: StartHereDashboardV2
): void {
  try {
    localStorage.removeItem(dashboardStorageKey(userId, startId));
    for (const g of Object.keys(dashboard.groups)) {
      localStorage.removeItem(startHereWatchlistStorageKey(userId, g, startId));
    }
    for (const i of Object.keys(dashboard.instances)) {
      localStorage.removeItem(startHereNewsModeStorageKey(userId, i, startId));
    }
  } catch {
    /* ignore */
  }
}

export function paletteColorAt(colorIndex: number): string {
  return PALETTE[((colorIndex % PALETTE.length) + PALETTE.length) % PALETTE.length].color;
}

export function paletteLabelAt(colorIndex: number): string {
  return PALETTE[((colorIndex % PALETTE.length) + PALETTE.length) % PALETTE.length].label;
}

const WIDGET_TEMPLATE: Record<
  StartHereWidgetType,
  { w: number; h: number; minW: number; minH: number }
> = {
  watchlist: { w: 4, h: 14, minW: 2, minH: 6 },
  chart: { w: 4, h: 10, minW: 2, minH: 5 },
  news: { w: 4, h: 14, minW: 2, minH: 6 },
};

const DEFAULT_LAYOUT_POSITIONS: Record<StartHereWidgetType, { x: number; y: number }> = {
  watchlist: { x: 0, y: 0 },
  chart: { x: 4, y: 0 },
  news: { x: 8, y: 0 },
};

/** Stable ids for factory / reset (one shared group). */
export const DEFAULT_INSTANCE_IDS: Record<StartHereWidgetType, string> = {
  watchlist: "sh_inst_watchlist",
  chart: "sh_inst_chart",
  news: "sh_inst_news",
};

export const DEFAULT_GROUP_ID = "sh_g_default";

function isStartHereInterval(x: unknown): x is StartHereInterval {
  return x === "1d" || x === "5m" || x === "15m";
}

/** Layout cell size (w/h/minW/minH) from the favorited default chart, or chart template fallback. */
export function chartTemplateCellsFromDefault(dashboard: StartHereDashboardV2): {
  w: number;
  h: number;
  minW: number;
  minH: number;
} {
  const fallback = WIDGET_TEMPLATE.chart;
  const defId = dashboard.defaultChartInstanceId;
  if (!defId) {
    return { ...fallback };
  }
  const li = dashboard.layout.find((l) => l.i === defId);
  const meta = dashboard.instances[defId];
  if (!li || meta?.type !== "chart") {
    return { ...fallback };
  }
  const minW = li.minW ?? fallback.minW;
  const minH = li.minH ?? fallback.minH;
  const w = Math.max(minW, Math.min(12, li.w));
  const h = Math.max(minH, li.h);
  return { w, h, minW, minH };
}

export function createDefaultDashboard(): StartHereDashboardV2 {
  const groupId = DEFAULT_GROUP_ID;
  const layout: Layout = (
    ["watchlist", "chart", "news"] as const
  ).map((t) => {
    const pos = DEFAULT_LAYOUT_POSITIONS[t];
    const tm = WIDGET_TEMPLATE[t];
    return {
      i: DEFAULT_INSTANCE_IDS[t],
      x: pos.x,
      y: pos.y,
      ...tm,
    };
  });
  return {
    v: START_HERE_DASHBOARD_VERSION,
    layout,
    instances: {
      [DEFAULT_INSTANCE_IDS.watchlist]: { type: "watchlist", groupId },
      [DEFAULT_INSTANCE_IDS.chart]: { type: "chart", groupId, chartInterval: "1d" },
      [DEFAULT_INSTANCE_IDS.news]: { type: "news", groupId },
    },
    groups: {
      [groupId]: { colorIndex: 0, symbol: "" },
    },
    defaultChartInstanceId: DEFAULT_INSTANCE_IDS.chart,
    defaultChartInterval: "1d",
  };
}

function nextColorIndex(groups: Record<string, StartHereGroupState>): number {
  const max = Object.values(groups).reduce((m, g) => Math.max(m, g.colorIndex), -1);
  return max + 1;
}

const RGL_COLS = 12;

function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
): boolean {
  const colOverlap = a.x < b.x + b.w && b.x < a.x + a.w;
  const rowOverlap = a.y < b.y + b.h && b.y < a.y + a.h;
  return colOverlap && rowOverlap;
}

/** Drop layout cells with no instance, and duplicate `i` (keeps first). */
export function sanitizeLayoutForInstances(
  layout: Layout,
  instances: Record<string, StartHereInstanceMeta>
): Layout {
  const seen = new Set<string>();
  const out: Layout = [];
  for (const l of layout) {
    if (!instances[l.i] || seen.has(l.i)) continue;
    seen.add(l.i);
    out.push(l);
  }
  return out;
}

/**
 * First top-left slot (row-major) where a w×h block fits without overlapping existing items.
 * Reuses holes left after deletes instead of always stacking at max(y+h).
 */
export function findFirstFreeGridPlacement(
  layout: Layout,
  w: number,
  h: number,
  cols: number = RGL_COLS,
  maxBottomExclusive?: number | null
): { x: number; y: number } | null {
  if (w < 1 || h < 1 || w > cols) return null;
  const boxes = layout.map((l) => ({ x: l.x, y: l.y, w: l.w, h: l.h }));
  const maxBottom = boxes.length > 0 ? Math.max(...boxes.map((b) => b.y + b.h)) : 0;
  const scanLimitY = maxBottom + h + 48;

  for (let y = 0; y <= scanLimitY; y++) {
    if (maxBottomExclusive != null && y + h > maxBottomExclusive) {
      return null;
    }
    for (let x = 0; x <= cols - w; x++) {
      const cand = { x, y, w, h };
      if (!boxes.some((b) => rectsOverlap(cand, b))) {
        return { x, y };
      }
    }
  }
  return { x: 0, y: maxBottom };
}

export function newGroupId(): string {
  return `sh_g_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export function newInstanceId(): string {
  return `sh_i_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export function appendWidget(
  dashboard: StartHereDashboardV2,
  type: StartHereWidgetType
): StartHereDashboardV2 {
  const instanceId = newInstanceId();
  const groupId = newGroupId();
  const tm = WIDGET_TEMPLATE[type];
  const pos =
    findFirstFreeGridPlacement(dashboard.layout, tm.w, tm.h) ??
    (() => {
      const maxY = dashboard.layout.reduce((m, l) => Math.max(m, l.y + l.h), 0);
      return { x: 0, y: maxY };
    })();
  const newItem: Layout[number] = {
    i: instanceId,
    x: pos.x,
    y: pos.y,
    ...tm,
  };
  const interval = dashboard.defaultChartInterval ?? "1d";
  const chartMeta: StartHereInstanceMeta =
    type === "chart"
      ? { type: "chart", groupId, chartInterval: interval }
      : { type, groupId };
  return {
    ...dashboard,
    layout: [...dashboard.layout, newItem],
    instances: {
      ...dashboard.instances,
      [instanceId]: chartMeta,
    },
    groups: {
      ...dashboard.groups,
      [groupId]: {
        colorIndex: nextColorIndex(dashboard.groups),
        symbol: "",
      },
    },
  };
}

export function removeInstance(
  dashboard: StartHereDashboardV2,
  instanceId: string
): StartHereDashboardV2 {
  const meta = dashboard.instances[instanceId];
  if (!meta) return dashboard;
  const layout = dashboard.layout.filter((l) => l.i !== instanceId);
  const { [instanceId]: _, ...instances } = dashboard.instances;
  const stillUsesGroup = Object.values(instances).some((m) => m.groupId === meta.groupId);
  let groups = { ...dashboard.groups };
  if (!stillUsesGroup) {
    const { [meta.groupId]: __, ...rest } = groups;
    groups = rest;
  }
  let defaultChartInstanceId = dashboard.defaultChartInstanceId ?? null;
  if (defaultChartInstanceId === instanceId) defaultChartInstanceId = null;
  return { ...dashboard, layout, instances, groups, defaultChartInstanceId };
}

export function setDefaultChartTemplate(
  dashboard: StartHereDashboardV2,
  instanceId: string | null
): StartHereDashboardV2 {
  if (instanceId === null) {
    return { ...dashboard, defaultChartInstanceId: null };
  }
  const meta = dashboard.instances[instanceId];
  if (!meta || meta.type !== "chart") return dashboard;
  const defaultChartInterval =
    meta.chartInterval ?? dashboard.defaultChartInterval ?? "1d";
  return { ...dashboard, defaultChartInstanceId: instanceId, defaultChartInterval };
}

/** When spawning charts from a watchlist widget, pass color so new charts match that watchlist stripe. */
export type StartHereWatchlistSpawnOpts = {
  inheritColorFromGroupId?: string;
  /** Prefer this when set (from live `dashboard.groups[gid].colorIndex` at click time). */
  inheritColorIndex?: number;
};

function resolveSpawnColorIndex(
  dashboard: StartHereDashboardV2,
  groupsForNext: Record<string, StartHereGroupState>,
  opts?: StartHereWatchlistSpawnOpts
): number {
  if (
    opts?.inheritColorIndex != null &&
    Number.isFinite(opts.inheritColorIndex) &&
    opts.inheritColorIndex >= 0
  ) {
    return Math.floor(opts.inheritColorIndex);
  }
  const gid = opts?.inheritColorFromGroupId;
  const src = gid && dashboard.groups[gid] ? dashboard.groups[gid] : null;
  if (src) return src.colorIndex;
  return nextColorIndex(groupsForNext);
}

/** Add one chart widget below existing layout, sized like the default template, symbol + timeframe from defaults. */
export function addChartFromWatchlistSymbol(
  dashboard: StartHereDashboardV2,
  symbolRaw: string,
  opts?: StartHereWatchlistSpawnOpts
): StartHereDashboardV2 {
  const sym = symbolRaw.trim().toUpperCase();
  if (!sym) return dashboard;

  const { w, h, minW, minH } = chartTemplateCellsFromDefault(dashboard);
  const pos =
    findFirstFreeGridPlacement(dashboard.layout, w, h) ??
    (() => {
      const maxY = dashboard.layout.reduce((m, l) => Math.max(m, l.y + l.h), 0);
      return { x: 0, y: maxY };
    })();

  const instanceId = newInstanceId();
  const groupId = newGroupId();
  const chartInterval = dashboard.defaultChartInterval ?? "1d";
  const colorIndex = resolveSpawnColorIndex(dashboard, dashboard.groups, opts);

  return {
    ...dashboard,
    layout: [
      ...dashboard.layout,
      {
        i: instanceId,
        x: pos.x,
        y: pos.y,
        w,
        h,
        minW,
        minH,
      },
    ],
    instances: {
      ...dashboard.instances,
      [instanceId]: { type: "chart", groupId, chartInterval },
    },
    groups: {
      ...dashboard.groups,
      [groupId]: {
        colorIndex,
        symbol: sym,
      },
    },
  };
}

export const START_HERE_MAX_LOAD_CHARTS = 24;

/** Must match Start Here `ReactGridLayout` rowHeight + margins + containerPadding. */
export const START_HERE_RGL_ROW_HEIGHT = 24;
export const START_HERE_RGL_MARGIN: [number, number] = [8, 8];
export const START_HERE_RGL_CONTAINER_PADDING: [number, number] = [4, 4];

/** Approximate number of RGL row units visible in a container of this height (content box). */
export function startHereVisibleGridRowCount(clientHeightPx: number): number {
  const padY = START_HERE_RGL_CONTAINER_PADDING[1];
  const inner = Math.max(0, clientHeightPx - 2 * padY);
  const unit = START_HERE_RGL_ROW_HEIGHT + START_HERE_RGL_MARGIN[1];
  return Math.max(1, Math.floor(inner / unit));
}

export interface LoadChartsFromListResult {
  dashboard: StartHereDashboardV2;
  placed: number;
  skipped: number;
}

export function loadChartsFromList(
  dashboard: StartHereDashboardV2,
  symbolsRaw: string[],
  options?: { maxAdditionalGridRows?: number } & StartHereWatchlistSpawnOpts
): LoadChartsFromListResult {
  const symbols = [
    ...new Set(
      symbolsRaw
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
    ),
  ].slice(0, START_HERE_MAX_LOAD_CHARTS);
  if (!symbols.length) {
    return { dashboard, placed: 0, skipped: 0 };
  }

  const { w, h, minW, minH } = chartTemplateCellsFromDefault(dashboard);
  const chartInterval = dashboard.defaultChartInterval ?? "1d";

  const layoutBottom =
    dashboard.layout.length > 0
      ? Math.max(...dashboard.layout.map((l) => l.y + l.h))
      : 0;

  const maxYExclusive =
    options?.maxAdditionalGridRows != null && options.maxAdditionalGridRows > 0
      ? layoutBottom + options.maxAdditionalGridRows
      : null;

  const layout = [...dashboard.layout];
  const instances = { ...dashboard.instances };
  let groups: Record<string, StartHereGroupState> = { ...dashboard.groups };

  let placed = 0;
  let skipped = 0;

  for (let idx = 0; idx < symbols.length; idx++) {
    const sym = symbols[idx];
    const pos =
      maxYExclusive != null
        ? findFirstFreeGridPlacement(layout, w, h, RGL_COLS, maxYExclusive)
        : findFirstFreeGridPlacement(layout, w, h, RGL_COLS, null);
    if (!pos) {
      skipped = symbols.length - idx;
      break;
    }
    const instanceId = newInstanceId();
    const groupId = newGroupId();
    layout.push({
      i: instanceId,
      x: pos.x,
      y: pos.y,
      w,
      h,
      minW,
      minH,
    });
    instances[instanceId] = { type: "chart", groupId, chartInterval };
    groups[groupId] = {
      colorIndex: resolveSpawnColorIndex(dashboard, groups, options),
      symbol: sym,
    };
    placed += 1;
  }

  return {
    dashboard: {
      ...dashboard,
      layout,
      instances,
      groups,
    },
    placed,
    skipped,
  };
}

export function setChartInstanceInterval(
  dashboard: StartHereDashboardV2,
  instanceId: string,
  interval: StartHereInterval
): StartHereDashboardV2 {
  const meta = dashboard.instances[instanceId];
  if (!meta || meta.type !== "chart") return dashboard;
  const instances = {
    ...dashboard.instances,
    [instanceId]: { ...meta, chartInterval: interval },
  };
  let defaultChartInterval = dashboard.defaultChartInterval ?? "1d";
  if (dashboard.defaultChartInstanceId === instanceId) {
    defaultChartInterval = interval;
  }
  return { ...dashboard, instances, defaultChartInterval };
}

export function setInstanceGroupId(
  dashboard: StartHereDashboardV2,
  instanceId: string,
  newGroupId: string
): StartHereDashboardV2 {
  const meta = dashboard.instances[instanceId];
  if (!meta || !dashboard.groups[newGroupId]) return dashboard;
  const oldGroupId = meta.groupId;
  const instances = {
    ...dashboard.instances,
    [instanceId]: { ...meta, groupId: newGroupId },
  };
  let groups = { ...dashboard.groups };
  const stillUsesOld = Object.values(instances).some((m) => m.groupId === oldGroupId);
  if (!stillUsesOld) {
    const { [oldGroupId]: __, ...rest } = groups;
    groups = rest;
  }
  return { ...dashboard, instances, groups };
}

export function forkNewGroupForInstance(
  dashboard: StartHereDashboardV2,
  instanceId: string
): StartHereDashboardV2 {
  const meta = dashboard.instances[instanceId];
  if (!meta) return dashboard;
  const oldGroupId = meta.groupId;
  const groupId = newGroupId();
  const instances = {
    ...dashboard.instances,
    [instanceId]: { ...meta, groupId },
  };
  let groups: Record<string, StartHereGroupState> = {
    ...dashboard.groups,
    [groupId]: {
      colorIndex: nextColorIndex(dashboard.groups),
      symbol: "",
    },
  };
  const stillUsesOld = Object.values(instances).some((m) => m.groupId === oldGroupId);
  if (!stillUsesOld && oldGroupId !== groupId) {
    const { [oldGroupId]: _removed, ...rest } = groups;
    groups = rest;
  }
  return { ...dashboard, instances, groups };
}

function isLayoutItem(x: unknown): x is Layout[number] {
  return (
    !!x &&
    typeof x === "object" &&
    "i" in x &&
    typeof (x as Layout[number]).i === "string" &&
    "x" in x &&
    "y" in x &&
    "w" in x &&
    "h" in x
  );
}

function migrateLegacyLayout(userId: number): StartHereDashboardV2 | null {
  try {
    const raw = localStorage.getItem(legacyLayoutStorageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const layout = parsed.filter(isLayoutItem).filter((item) =>
      LEGACY_WIDGET_IDS.includes(item.i as (typeof LEGACY_WIDGET_IDS)[number])
    ) as Layout;
    if (!layout.length) return null;
    const groupId = DEFAULT_GROUP_ID;
    const instances: Record<string, StartHereInstanceMeta> = {};
    for (const item of layout) {
      const t = item.i as StartHereWidgetType;
      if (t === "watchlist" || t === "chart" || t === "news") {
        instances[item.i] = { type: t, groupId };
      }
    }
    return {
      v: START_HERE_DASHBOARD_VERSION,
      layout,
      instances,
      groups: { [groupId]: { colorIndex: 0, symbol: "" } },
      defaultChartInstanceId: layout.some((l) => l.i === "chart") ? "chart" : null,
      defaultChartInterval: "1d",
    };
  } catch {
    return null;
  }
}

function sanitizeDashboard(d: StartHereDashboardV2): StartHereDashboardV2 {
  const layout = d.layout.filter((l) => d.instances[l.i]);
  const instanceKeys = new Set(layout.map((l) => l.i));
  const instances: Record<string, StartHereInstanceMeta> = {};
  for (const k of instanceKeys) {
    const m = d.instances[k];
    if (!m || !d.groups[m.groupId]) continue;
    if (m.type === "chart") {
      const ci = isStartHereInterval(m.chartInterval) ? m.chartInterval : undefined;
      instances[k] = { type: "chart", groupId: m.groupId, ...(ci ? { chartInterval: ci } : {}) };
    } else {
      instances[k] = { type: m.type, groupId: m.groupId };
    }
  }
  const usedGroupIds = new Set(Object.values(instances).map((m) => m.groupId));
  const groups: Record<string, StartHereGroupState> = {};
  for (const gid of usedGroupIds) {
    const g = d.groups[gid];
    if (g) groups[gid] = { ...g, symbol: typeof g.symbol === "string" ? g.symbol : "" };
  }
  if (!layout.length || !Object.keys(instances).length) {
    return createDefaultDashboard();
  }
  let defaultChartInstanceId = d.defaultChartInstanceId ?? null;
  if (defaultChartInstanceId != null) {
    const dm = instances[defaultChartInstanceId];
    if (!dm || dm.type !== "chart") defaultChartInstanceId = null;
  }
  let defaultChartInterval: StartHereInterval =
    isStartHereInterval(d.defaultChartInterval) ? d.defaultChartInterval : "1d";
  if (defaultChartInstanceId) {
    const dm = instances[defaultChartInstanceId];
    if (dm?.type === "chart" && isStartHereInterval(dm.chartInterval)) {
      defaultChartInterval = dm.chartInterval;
    }
  }
  return {
    v: START_HERE_DASHBOARD_VERSION,
    layout,
    instances,
    groups,
    defaultChartInstanceId,
    defaultChartInterval,
  };
}

export function loadDashboard(userId: number, startId: string): StartHereDashboardV2 {
  try {
    const raw = localStorage.getItem(dashboardStorageKey(userId, startId));
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object") {
        const rawV = (parsed as { v?: number }).v;
        if (rawV === 2 || rawV === 3 || rawV === START_HERE_DASHBOARD_VERSION) {
          const p = parsed as StartHereDashboardV2 & { defaultChartInterval?: unknown };
          const d = {
            ...p,
            v: START_HERE_DASHBOARD_VERSION,
            defaultChartInstanceId: p.defaultChartInstanceId ?? null,
            defaultChartInterval: isStartHereInterval(p.defaultChartInterval)
              ? p.defaultChartInterval
              : undefined,
          };
          if (Array.isArray(d.layout) && d.instances && d.groups) {
            return sanitizeDashboard(d);
          }
        }
      }
    }
  } catch {
    /* fall through */
  }
  if (startId === DEFAULT_START_ID) {
    const migrated = migrateLegacyLayout(userId);
    if (migrated) {
      const clean = sanitizeDashboard(migrated);
      saveDashboard(userId, startId, clean);
      try {
        localStorage.removeItem(legacyLayoutStorageKey(userId));
      } catch {
        /* ignore */
      }
      return clean;
    }
  }
  return createDefaultDashboard();
}

export function saveDashboard(
  userId: number,
  startId: string,
  dashboard: StartHereDashboardV2
) {
  try {
    localStorage.setItem(
      dashboardStorageKey(userId, startId),
      JSON.stringify(sanitizeDashboard(dashboard))
    );
  } catch {
    /* ignore */
  }
}
