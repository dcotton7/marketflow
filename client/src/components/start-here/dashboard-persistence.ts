import type { Layout } from "react-grid-layout/legacy";
import type { StartHereInterval } from "@/components/MiniChart";
import {
  DEFAULT_START_HERE_WORKSPACE_PALETTE,
  normalizeStartHereWorkspacePalette,
  START_HERE_LINK_LANE_COUNT,
  type StartHereWorkspacePalette,
} from "@shared/startHereWorkspacePalette";

export type { StartHereWorkspacePalette };

export const START_HERE_DASHBOARD_VERSION = 4 as const;

/** Fixed link lanes (0–9); each lane is one row in every widget’s link dropdown. */
export const LINK_LANE_COUNT = START_HERE_LINK_LANE_COUNT;

/** Shipped default swatches; prefer `workspacePalette` from API for live UI. */
export const PALETTE = DEFAULT_START_HERE_WORKSPACE_PALETTE.linkLanes;

export const UNLINKED_LABEL = "Unlinked";
export const UNLINKED_ACCENT_COLOR = DEFAULT_START_HERE_WORKSPACE_PALETTE.unlinkedColor;

export function resolveWorkspacePalette(fromServer?: unknown): StartHereWorkspacePalette {
  return normalizeStartHereWorkspacePalette(fromServer);
}

/** Select value when the instance uses a private (non–link-lane) group. */
export const START_HERE_UNLINKED_SELECT_VALUE = "__start_here_unlinked__";

const LINK_LANE_ID_RE = /^sh_lane_([0-9])$/;

export function linkLaneGroupId(index: number): string {
  if (index < 0 || index >= LINK_LANE_COUNT) {
    throw new RangeError(`link lane index out of range: ${index}`);
  }
  return `sh_lane_${index}`;
}

/** Lane index 0–9, or null if `gid` is not a canonical link lane id. */
export function parseLinkLaneIndex(gid: string): number | null {
  const m = LINK_LANE_ID_RE.exec(gid);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (n < 0 || n >= LINK_LANE_COUNT) return null;
  return n;
}

export function isLinkLaneGroupId(gid: string): boolean {
  return parseLinkLaneIndex(gid) != null;
}

/** Merge canonical link-lane groups (always present for dropdowns). */
export function mergeLinkLanesIntoGroups(
  groups: Record<string, StartHereGroupState>
): Record<string, StartHereGroupState> {
  const out = { ...groups };
  for (let i = 0; i < LINK_LANE_COUNT; i++) {
    const id = linkLaneGroupId(i);
    const prev = out[id];
    out[id] = {
      colorIndex: i,
      symbol: prev && typeof prev.symbol === "string" ? prev.symbol : "",
    };
  }
  return out;
}

/**
 * Widget chrome + picker: link lanes always use palette lanes.
 * Private groups are neutral unless they carry a private accentColorIndex.
 * Pass `workspace` from `useWorkspacePalette()` when rendering Start Here so colors match admin settings.
 */
export function groupLinkAccent(
  groupId: string,
  workspace?: StartHereWorkspacePalette,
  groupState?: StartHereGroupState
): {
  accentColor: string;
  accentLabel: string;
} {
  const pal = resolveWorkspacePalette(workspace);
  const lane = parseLinkLaneIndex(groupId);
  if (lane != null) {
    const p = pal.linkLanes[lane]!;
    return { accentColor: p.color, accentLabel: p.label };
  }
  if (
    groupState?.accentColorIndex != null &&
    Number.isFinite(groupState.accentColorIndex) &&
    groupState.accentColorIndex >= 0
  ) {
    const i = Math.floor(groupState.accentColorIndex);
    const p = pal.linkLanes[((i % pal.linkLanes.length) + pal.linkLanes.length) % pal.linkLanes.length]!;
    return { accentColor: p.color, accentLabel: p.label };
  }
  return { accentColor: pal.unlinkedColor, accentLabel: UNLINKED_LABEL };
}

export type StartHereWidgetType = "watchlist" | "chart" | "news" | "flow";

export interface StartHereGroupState {
  colorIndex: number;
  symbol: string;
  /** Optional private color identity for widgets that should look lane-colored without joining a link lane. */
  accentColorIndex?: number | null;
}

export interface StartHereInstanceMeta {
  type: StartHereWidgetType;
  groupId: string;
  /** Chart preview timeframe; only for `type === "chart"`. */
  chartInterval?: StartHereInterval;
  /** When set on a chart, that tile shows this symbol instead of `groups[groupId].symbol`. */
  chartSymbolOverride?: string;
  /** Shared id for chart sets that should move symbols together (e.g. 3 Linked Charts). */
  linkedSetId?: string;
  /** Prevent relinking/unlinking; used by linked chart sets. */
  linkedSetLocked?: boolean;
}

/** Persisted grid cell size for the default Market Flow tile (kept in sync when Default is on). */
export type StartHereFlowGridCells = {
  w: number;
  h: number;
  minW: number;
  minH: number;
};

export interface StartHereDashboardV2 {
  v: typeof START_HERE_DASHBOARD_VERSION;
  layout: Layout;
  instances: Record<string, StartHereInstanceMeta>;
  groups: Record<string, StartHereGroupState>;
  /** Chart instance whose w/h (and timeframe template) define new charts from the watchlist. */
  defaultChartInstanceId?: string | null;
  /** Timeframe for the default template chart; copied onto watchlist-spawned charts. */
  defaultChartInterval?: StartHereInterval;
  /** Watchlist instance used as the column-layout template for other watchlist widgets on this Start. */
  defaultWatchlistInstanceId?: string | null;
  /**
   * Chart tile that receives watchlist row clicks when set (same lane only).
   * Cleared when that instance is removed or is not a chart.
   */
  focusedChartInstanceId?: string | null;
  /** Flow widget whose current grid w/h/min* is copied when adding a new Market Flow tile. */
  defaultFlowInstanceId?: string | null;
  /**
   * Saved Market Flow grid size for new tiles. Synced from the Default tile while it exists; kept after that
   * tile is closed so "Add widget → Market Flow" still matches (see `defaultFlowInstanceId`).
   */
  defaultFlowGridCells?: StartHereFlowGridCells | null;
}

const LEGACY_WIDGET_IDS = ["watchlist", "chart", "news"] as const;

function isStartHereWidgetType(t: unknown): t is StartHereWidgetType {
  return (
    t === "watchlist" ||
    t === "chart" ||
    t === "news" ||
    t === "flow"
  );
}

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

export function watchlistModalColumnWidthsStorageKey(userId: number) {
  return `watchlistManager.columnWidths.${userId}`;
}

/** Last width/height (px) of the Watchlist Manager dialog, per user. */
export function watchlistModalSizeStorageKey(userId: number) {
  return `watchlistManager.modalSize.v1.${userId}`;
}

export function startHereWatchlistColumnWidthsStorageKey(
  userId: number,
  startId: string,
  instanceId: string
) {
  return `startHere.watchlistColWidths.${userId}.${startId}.${instanceId}`;
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
    groupMap[id] = isLinkLaneGroupId(id) ? id : newGroupId();
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
    if (!ng) continue;
    const lane = parseLinkLaneIndex(ng);
    const sym = typeof g.symbol === "string" ? g.symbol : "";
    if (lane != null) {
      groups[ng] = { colorIndex: lane, symbol: sym };
    } else {
      groups[ng] = { ...g, symbol: sym };
    }
  }
  let defaultChartInstanceId = dashboard.defaultChartInstanceId ?? null;
  if (defaultChartInstanceId && instanceMap[defaultChartInstanceId]) {
    defaultChartInstanceId = instanceMap[defaultChartInstanceId];
  } else {
    defaultChartInstanceId = null;
  }
  let defaultWatchlistInstanceId = dashboard.defaultWatchlistInstanceId ?? null;
  if (defaultWatchlistInstanceId && instanceMap[defaultWatchlistInstanceId]) {
    defaultWatchlistInstanceId = instanceMap[defaultWatchlistInstanceId];
  } else {
    defaultWatchlistInstanceId = null;
  }
  let defaultFlowInstanceId = dashboard.defaultFlowInstanceId ?? null;
  if (defaultFlowInstanceId && instanceMap[defaultFlowInstanceId]) {
    defaultFlowInstanceId = instanceMap[defaultFlowInstanceId];
  } else {
    defaultFlowInstanceId = null;
  }
  let focusedChartInstanceId = dashboard.focusedChartInstanceId ?? null;
  if (focusedChartInstanceId && instanceMap[focusedChartInstanceId]) {
    focusedChartInstanceId = instanceMap[focusedChartInstanceId];
  } else {
    focusedChartInstanceId = null;
  }
  const raw: StartHereDashboardV2 = {
    ...dashboard,
    layout,
    instances,
    groups,
    defaultChartInstanceId,
    defaultWatchlistInstanceId,
    focusedChartInstanceId,
    defaultFlowInstanceId,
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
    for (const [oldI, newI] of Object.entries(instanceMap)) {
      const fromK = startHereWatchlistColumnWidthsStorageKey(userId, fromStartId, oldI);
      const toK = startHereWatchlistColumnWidthsStorageKey(userId, toStartId, newI);
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
      localStorage.removeItem(startHereWatchlistColumnWidthsStorageKey(userId, startId, i));
    }
  } catch {
    /* ignore */
  }
}

export function paletteColorAt(colorIndex: number, workspace?: StartHereWorkspacePalette): string {
  const pal = resolveWorkspacePalette(workspace);
  const lanes = pal.linkLanes;
  const i = ((colorIndex % lanes.length) + lanes.length) % lanes.length;
  return lanes[i]!.color;
}

export function paletteLabelAt(colorIndex: number, workspace?: StartHereWorkspacePalette): string {
  const pal = resolveWorkspacePalette(workspace);
  const lanes = pal.linkLanes;
  const i = ((colorIndex % lanes.length) + lanes.length) % lanes.length;
  return lanes[i]!.label;
}

const WIDGET_TEMPLATE: Record<
  StartHereWidgetType,
  { w: number; h: number; minW: number; minH: number }
> = {
  watchlist: { w: 4, h: 14, minW: 2, minH: 5 },
  chart: { w: 4, h: 10, minW: 2, minH: 4 },
  news: { w: 4, h: 14, minW: 2, minH: 5 },
  flow: { w: 12, h: 8, minW: 1, minH: 2 },
};

function isValidFlowGridCells(x: unknown): x is StartHereFlowGridCells {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  for (const k of ["w", "h", "minW", "minH"] as const) {
    const n = o[k];
    if (typeof n !== "number" || !Number.isFinite(n)) return false;
  }
  return true;
}

/**
 * RGL will not shrink a tile below minW/minH. Persisted layouts often had minW === initial w (e.g. 4),
 * which incorrectly locked width at 4 even though the product template allows 2.
 * Always derive mins from the widget template, capped by the current w/h.
 */
export function computeStartHereLayoutMins(
  w: number,
  h: number,
  type: StartHereWidgetType
): { minW: number; minH: number } {
  const tmpl = WIDGET_TEMPLATE[type];
  const tmplMinW = Math.max(1, Math.min(12, Math.floor(tmpl.minW)));
  const tmplMinH = Math.max(1, Math.floor(tmpl.minH));
  const cw = Math.max(1, Math.min(12, Math.floor(w)));
  const ch = Math.max(1, Math.floor(h));
  return {
    minW: Math.min(cw, tmplMinW),
    minH: Math.min(ch, tmplMinH),
  };
}

function clampFlowGridCells(c: StartHereFlowGridCells): StartHereFlowGridCells {
  const w = Math.max(1, Math.min(12, Math.floor(c.w)));
  const h = Math.max(1, Math.floor(c.h));
  return { w, h, ...computeStartHereLayoutMins(w, h, "flow") };
}

/** RGL snaps released sizes back if minW>w or minH>h — applies to every Start Here widget type. */
function normalizeStartHereLayoutMinBounds(
  layout: Layout,
  instances: Record<string, StartHereInstanceMeta>
): Layout {
  return layout.map((l) => {
    const meta = instances[l.i];
    if (!meta) return l;
    const w = Math.max(1, Math.min(12, Math.floor(Number(l.w) || 1)));
    const h = Math.max(1, Math.floor(Number(l.h) || 1));
    const { minW, minH } = computeStartHereLayoutMins(w, h, meta.type);
    return { ...l, w, h, minW, minH };
  }) as Layout;
}

const DEFAULT_LAYOUT_POSITIONS: Record<StartHereWidgetType, { x: number; y: number }> = {
  watchlist: { x: 0, y: 0 },
  chart: { x: 4, y: 0 },
  news: { x: 8, y: 0 },
  flow: { x: 0, y: 14 },
};

/** Stable ids for factory / reset (one shared group). */
export const DEFAULT_INSTANCE_IDS: Record<StartHereWidgetType, string> = {
  watchlist: "sh_inst_watchlist",
  chart: "sh_inst_chart",
  news: "sh_inst_news",
  flow: "sh_inst_flow",
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
  const w = Math.max(1, Math.min(12, Math.floor(li.w)));
  const h = Math.max(1, Math.floor(li.h));
  return { w, h, ...computeStartHereLayoutMins(w, h, "chart") };
}

/** Grid cell size for new Market Flow tiles: saved template first, else live default instance, else factory. */
export function flowTemplateCellsFromDefault(dashboard: StartHereDashboardV2): {
  w: number;
  h: number;
  minW: number;
  minH: number;
} {
  const fallback = WIDGET_TEMPLATE.flow;
  const cells = dashboard.defaultFlowGridCells;
  if (cells && isValidFlowGridCells(cells)) {
    return clampFlowGridCells(cells);
  }
  const defId = dashboard.defaultFlowInstanceId;
  if (!defId) {
    return { ...fallback };
  }
  const li = dashboard.layout.find((l) => l.i === defId);
  const meta = dashboard.instances[defId];
  if (!li || meta?.type !== "flow") {
    return { ...fallback };
  }
  const w = Math.max(1, Math.min(12, Math.floor(li.w)));
  const h = Math.max(1, Math.floor(li.h));
  return { w, h, ...computeStartHereLayoutMins(w, h, "flow") };
}

export function createDefaultDashboard(): StartHereDashboardV2 {
  const gw = newGroupId();
  const gc = newGroupId();
  const gn = newGroupId();
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
      [DEFAULT_INSTANCE_IDS.watchlist]: { type: "watchlist", groupId: gw },
      [DEFAULT_INSTANCE_IDS.chart]: { type: "chart", groupId: gc, chartInterval: "1d" },
      [DEFAULT_INSTANCE_IDS.news]: { type: "news", groupId: gn },
    },
    groups: {
      [gw]: { colorIndex: 0, symbol: "" },
      [gc]: { colorIndex: 0, symbol: "" },
      [gn]: { colorIndex: 0, symbol: "" },
    },
    defaultChartInstanceId: DEFAULT_INSTANCE_IDS.chart,
    defaultChartInterval: "1d",
    defaultWatchlistInstanceId: null,
    focusedChartInstanceId: null,
    defaultFlowInstanceId: null,
    defaultFlowGridCells: null,
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
  const out: Layout[number][] = [];
  for (const l of layout) {
    if (!instances[l.i] || seen.has(l.i)) continue;
    seen.add(l.i);
    out.push(l);
  }
  return out as Layout;
}

/** When a Default Flow instance is set, sync `defaultFlowGridCells` from its layout row; otherwise leave cells as-is (orphan template). */
export function syncDefaultFlowGridCellsWithLayout(dashboard: StartHereDashboardV2): StartHereDashboardV2 {
  const id = dashboard.defaultFlowInstanceId ?? null;
  if (!id) return dashboard;
  const meta = dashboard.instances[id];
  if (!meta || meta.type !== "flow") {
    return { ...dashboard, defaultFlowGridCells: null };
  }
  const li = dashboard.layout.find((l) => l.i === id);
  if (!li) return { ...dashboard, defaultFlowGridCells: null };
  const fb = WIDGET_TEMPLATE.flow;
  return {
    ...dashboard,
    defaultFlowGridCells: clampFlowGridCells({
      w: li.w,
      h: li.h,
      minW: li.minW ?? fb.minW,
      minH: li.minH ?? fb.minH,
    }),
  };
}

/** Apply RGL layout to dashboard and refresh persisted default Flow cells when applicable. */
export function mergePersistedGridLayout(
  dashboard: StartHereDashboardV2,
  layout: Layout
): StartHereDashboardV2 {
  // RGL may mutate the layout array it passes to callbacks; always work on a copy.
  const layoutSnapshot = layout.map((l) => ({ ...l }));
  let nextLayout = sanitizeLayoutForInstances(layoutSnapshot, dashboard.instances);
  nextLayout = normalizeStartHereLayoutMinBounds(nextLayout, dashboard.instances);
  return syncDefaultFlowGridCellsWithLayout({
    ...dashboard,
    layout: nextLayout,
  });
}

/**
 * RGL often fires `onLayoutChange` after mount or width measurement with the default Flow tile at w=12
 * even when persisted state (and `defaultFlowGridCells`) is narrower. While the user is not dragging/resizing,
 * snap that item back to the saved template width.
 */
export function patchResistDefaultFlowFullWidth(
  dashboard: StartHereDashboardV2,
  layout: Layout
): Layout {
  const defId = dashboard.defaultFlowInstanceId;
  const cells = dashboard.defaultFlowGridCells;
  if (!defId || !cells || !isValidFlowGridCells(cells)) return layout;
  const clamped = clampFlowGridCells(cells);
  if (clamped.w >= 12) return layout;
  const nextItem = layout.find((l) => l.i === defId);
  const prevItem = dashboard.layout.find((l) => l.i === defId);
  if (!nextItem || nextItem.w !== 12 || !prevItem) return layout;
  if (prevItem.w !== clamped.w) return layout;
  return layout.map((l) => (l.i === defId ? { ...l, ...clamped } : l)) as Layout;
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

function newLinkedSetId(): string {
  return `sh_ls_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export function appendWidget(
  dashboard: StartHereDashboardV2,
  type: StartHereWidgetType
): StartHereDashboardV2 {
  const instanceId = newInstanceId();
  const groupId = newGroupId();
  const tm =
    type === "flow"
      ? flowTemplateCellsFromDefault(dashboard)
      : type === "chart"
        ? chartTemplateCellsFromDefault(dashboard)
        : WIDGET_TEMPLATE[type];
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
        colorIndex: 0,
        accentColorIndex: null,
        symbol: "",
      },
    },
  };
}

/** Spawn a locked 3-chart linked set (`1d`, `15m`, `5m`) sharing one group symbol. */
export function appendLinkedChartTriplet(
  dashboard: StartHereDashboardV2
): StartHereDashboardV2 {
  const intervals: StartHereInterval[] = ["1d", "15m", "5m"];
  const { w, h, minW, minH } = chartTemplateCellsFromDefault(dashboard);
  const linkedSetId = newLinkedSetId();
  const groupId = newGroupId();
  const tripletColorIndex = nextColorIndex(dashboard.groups);
  const layout: Layout = [...dashboard.layout];
  const instances: Record<string, StartHereInstanceMeta> = { ...dashboard.instances };

  for (const interval of intervals) {
    const pos =
      findFirstFreeGridPlacement(layout, w, h) ??
      (() => {
        const maxY = layout.reduce((m, l) => Math.max(m, l.y + l.h), 0);
        return { x: 0, y: maxY };
      })();
    const instanceId = newInstanceId();
    layout.push({
      i: instanceId,
      x: pos.x,
      y: pos.y,
      w,
      h,
      minW,
      minH,
    });
    instances[instanceId] = {
      type: "chart",
      groupId,
      chartInterval: interval,
      linkedSetId,
      linkedSetLocked: true,
    };
  }

  return {
    ...dashboard,
    layout,
    instances,
    groups: {
      ...dashboard.groups,
      [groupId]: {
        colorIndex: tripletColorIndex,
        accentColorIndex: tripletColorIndex,
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
  if (!stillUsesGroup && !isLinkLaneGroupId(meta.groupId)) {
    const { [meta.groupId]: __, ...rest } = groups;
    groups = rest;
  }
  let defaultChartInstanceId = dashboard.defaultChartInstanceId ?? null;
  if (defaultChartInstanceId === instanceId) defaultChartInstanceId = null;
  let defaultWatchlistInstanceId = dashboard.defaultWatchlistInstanceId ?? null;
  if (defaultWatchlistInstanceId === instanceId) defaultWatchlistInstanceId = null;
  let defaultFlowInstanceId = dashboard.defaultFlowInstanceId ?? null;
  const defaultFlowGridCells = dashboard.defaultFlowGridCells ?? null;
  if (defaultFlowInstanceId === instanceId) {
    defaultFlowInstanceId = null;
    // Keep defaultFlowGridCells so new Market Flow widgets still use the saved size after this tile is removed.
  }
  let focusedChartInstanceId = dashboard.focusedChartInstanceId ?? null;
  if (focusedChartInstanceId === instanceId) focusedChartInstanceId = null;

  return {
    ...dashboard,
    layout,
    instances,
    groups,
    defaultChartInstanceId,
    defaultWatchlistInstanceId,
    focusedChartInstanceId,
    defaultFlowInstanceId,
    defaultFlowGridCells,
  };
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

export function setDefaultWatchlistTemplate(
  dashboard: StartHereDashboardV2,
  instanceId: string | null
): StartHereDashboardV2 {
  if (instanceId === null) {
    return { ...dashboard, defaultWatchlistInstanceId: null };
  }
  const meta = dashboard.instances[instanceId];
  if (!meta || meta.type !== "watchlist") return dashboard;
  return { ...dashboard, defaultWatchlistInstanceId: instanceId };
}

/** Chart instance ids on the same link lane (for watchlist row-click policy). */
export function chartInstanceIdsForGroup(
  dashboard: StartHereDashboardV2,
  groupId: string
): string[] {
  return Object.entries(dashboard.instances)
    .filter(([, m]) => m.type === "chart" && m.groupId === groupId)
    .map(([id]) => id);
}

/** Set lane symbol and drop per-chart overrides so every chart on the lane matches. */
export function broadcastGroupSymbolToLane(
  dashboard: StartHereDashboardV2,
  groupId: string,
  symbol: string
): StartHereDashboardV2 {
  const sym = symbol.trim().toUpperCase();
  const g = dashboard.groups[groupId];
  if (!g) return dashboard;
  const instances: Record<string, StartHereInstanceMeta> = { ...dashboard.instances };
  for (const [id, m] of Object.entries(instances)) {
    if (m.type !== "chart" || m.groupId !== groupId) continue;
    if ("chartSymbolOverride" in m && m.chartSymbolOverride != null) {
      const { chartSymbolOverride: _, ...rest } = m;
      instances[id] = rest;
    }
  }
  return {
    ...dashboard,
    instances,
    groups: {
      ...dashboard.groups,
      [groupId]: { ...g, symbol: sym },
    },
  };
}

export function setChartSymbolOverrideOnInstance(
  dashboard: StartHereDashboardV2,
  instanceId: string,
  symbol: string
): StartHereDashboardV2 {
  const m = dashboard.instances[instanceId];
  if (!m || m.type !== "chart") return dashboard;
  const sym = symbol.trim().toUpperCase();
  if (m.linkedSetLocked) {
    return broadcastGroupSymbolToLane(dashboard, m.groupId, sym);
  }
  return {
    ...dashboard,
    instances: {
      ...dashboard.instances,
      [instanceId]: { ...m, chartSymbolOverride: sym },
    },
  };
}

export function clearChartSymbolOverrideOnInstance(
  dashboard: StartHereDashboardV2,
  instanceId: string
): StartHereDashboardV2 {
  const m = dashboard.instances[instanceId];
  if (!m || m.type !== "chart") return dashboard;
  if (!("chartSymbolOverride" in m) || m.chartSymbolOverride == null) return dashboard;
  const { chartSymbolOverride: _, ...rest } = m;
  return {
    ...dashboard,
    instances: {
      ...dashboard.instances,
      [instanceId]: rest,
    },
  };
}

export function setDefaultFlowTemplate(
  dashboard: StartHereDashboardV2,
  instanceId: string | null
): StartHereDashboardV2 {
  if (instanceId === null) {
    return { ...dashboard, defaultFlowInstanceId: null, defaultFlowGridCells: null };
  }
  const meta = dashboard.instances[instanceId];
  if (!meta || meta.type !== "flow") return dashboard;
  return syncDefaultFlowGridCellsWithLayout({ ...dashboard, defaultFlowInstanceId: instanceId });
}

/** When spawning charts from a watchlist widget, pass color so new charts match that watchlist stripe. */
export type StartHereWatchlistSpawnOpts = {
  /** Join this exact group so new charts inherit both color and link behavior. */
  inheritGroupId?: string;
  inheritColorFromGroupId?: string;
  /** Prefer this when set (from live `dashboard.groups[gid].colorIndex` at click time). */
  inheritColorIndex?: number;
};

function resolveSpawnColorIndex(
  dashboard: StartHereDashboardV2,
  groupsForNext: Record<string, StartHereGroupState>,
  opts?: StartHereWatchlistSpawnOpts
): number | null {
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
  return null;
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
  const chartInterval = dashboard.defaultChartInterval ?? "1d";
  let groups = mergeLinkLanesIntoGroups({ ...dashboard.groups });
  const inheritGroupId =
    opts?.inheritGroupId && groups[opts.inheritGroupId] ? opts.inheritGroupId : null;
  const groupId = inheritGroupId ?? newGroupId();
  const inheritedGroupSymbol = inheritGroupId
    ? (groups[groupId]?.symbol ?? "").trim().toUpperCase()
    : "";
  if (!inheritGroupId) {
    const colorIndex = resolveSpawnColorIndex(dashboard, groups, opts);
    groups[groupId] = {
      colorIndex: colorIndex ?? 0,
      accentColorIndex: colorIndex,
      symbol: sym,
    };
  }

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
      [instanceId]: {
        type: "chart",
        groupId,
        chartInterval,
        ...(inheritGroupId && sym !== inheritedGroupSymbol ? { chartSymbolOverride: sym } : {}),
      },
    },
    groups,
  };
}

export const START_HERE_MAX_LOAD_CHARTS = 24;

/** Must match Start Here `ReactGridLayout` rowHeight + margins + containerPadding. */
export const START_HERE_RGL_ROW_HEIGHT = 22;
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
  const symbols = Array.from(
    new Set(symbolsRaw.map((s) => s.trim().toUpperCase()).filter(Boolean))
  ).slice(0, START_HERE_MAX_LOAD_CHARTS);
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
  let groups: Record<string, StartHereGroupState> = mergeLinkLanesIntoGroups({ ...dashboard.groups });
  const inheritGroupId =
    options?.inheritGroupId && groups[options.inheritGroupId] ? options.inheritGroupId : null;
  const inheritedGroupSymbol = inheritGroupId
    ? (groups[inheritGroupId]?.symbol ?? "").trim().toUpperCase()
    : "";

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
    const groupId = inheritGroupId ?? newGroupId();
    layout.push({
      i: instanceId,
      x: pos.x,
      y: pos.y,
      w,
      h,
      minW,
      minH,
    });
    instances[instanceId] = {
      type: "chart",
      groupId,
      chartInterval,
      ...(inheritGroupId && sym !== inheritedGroupSymbol ? { chartSymbolOverride: sym } : {}),
    };
    if (!inheritGroupId) {
      const colorIndex = resolveSpawnColorIndex(dashboard, groups, options);
      groups[groupId] = {
        colorIndex: colorIndex ?? 0,
        accentColorIndex: colorIndex,
        symbol: sym,
      };
    }
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
  if (!meta) return dashboard;
  if (meta.type === "chart" && meta.linkedSetLocked) return dashboard;
  const merged = mergeLinkLanesIntoGroups({ ...dashboard.groups });
  if (!merged[newGroupId]) return dashboard;
  const oldGroupId = meta.groupId;
  let nextMeta: StartHereInstanceMeta = { ...meta, groupId: newGroupId };
  if (nextMeta.type === "chart" && "chartSymbolOverride" in nextMeta) {
    const { chartSymbolOverride: _, ...rest } = nextMeta;
    nextMeta = rest as StartHereInstanceMeta;
  }
  const instances = {
    ...dashboard.instances,
    [instanceId]: nextMeta,
  };
  let groups = merged;
  const stillUsesOld = Object.values(instances).some((m) => m.groupId === oldGroupId);
  if (!stillUsesOld && !isLinkLaneGroupId(oldGroupId)) {
    const { [oldGroupId]: __, ...rest } = groups;
    groups = mergeLinkLanesIntoGroups(rest);
  }
  return { ...dashboard, instances, groups };
}

/** Move instance to a new private group; keeps current symbol (Unlinked lane). */
export function unlinkInstanceToPrivateGroup(
  dashboard: StartHereDashboardV2,
  instanceId: string
): StartHereDashboardV2 {
  const meta = dashboard.instances[instanceId];
  if (!meta) return dashboard;
  if (meta.type === "chart" && meta.linkedSetLocked) return dashboard;
  const oldGroupId = meta.groupId;
  const oldState = dashboard.groups[oldGroupId];
  const symbol = oldState && typeof oldState.symbol === "string" ? oldState.symbol : "";
  const groupId = newGroupId();
  const instances = {
    ...dashboard.instances,
    [instanceId]: { ...meta, groupId },
  };
  let groups = mergeLinkLanesIntoGroups({ ...dashboard.groups });
  groups[groupId] = { colorIndex: 0, symbol };
  groups[groupId].accentColorIndex = null;
  const stillUsesOld = Object.values(instances).some((m) => m.groupId === oldGroupId);
  if (!stillUsesOld && !isLinkLaneGroupId(oldGroupId)) {
    const { [oldGroupId]: _removed, ...rest } = groups;
    groups = mergeLinkLanesIntoGroups(rest);
  }
  return { ...dashboard, instances, groups };
}

export function forkNewGroupForInstance(
  dashboard: StartHereDashboardV2,
  instanceId: string
): StartHereDashboardV2 {
  return unlinkInstanceToPrivateGroup(dashboard, instanceId);
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
      defaultWatchlistInstanceId: null,
      focusedChartInstanceId: null,
      defaultFlowInstanceId: null,
      defaultFlowGridCells: null,
    };
  } catch {
    return null;
  }
}

function coerceGroupState(raw: unknown): StartHereGroupState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { colorIndex: 0, accentColorIndex: null, symbol: "" };
  }
  const o = raw as Record<string, unknown>;
  const ci = o.colorIndex;
  const colorIndex =
    typeof ci === "number" && Number.isFinite(ci) ? Math.floor(ci) : 0;
  const aci = o.accentColorIndex;
  const accentColorIndex =
    aci == null
      ? null
      : typeof aci === "number" && Number.isFinite(aci)
        ? Math.floor(aci)
        : null;
  const sym = o.symbol;
  const symbol = typeof sym === "string" ? sym : "";
  return { colorIndex, accentColorIndex, symbol };
}

export function sanitizeDashboard(d: StartHereDashboardV2): StartHereDashboardV2 {
  const rawGroups =
    d.groups && typeof d.groups === "object" && !Array.isArray(d.groups)
      ? (d.groups as Record<string, StartHereGroupState>)
      : {};
  let mergedInput = mergeLinkLanesIntoGroups({ ...rawGroups });

  const instancesIn =
    d.instances && typeof d.instances === "object" && !Array.isArray(d.instances)
      ? (d.instances as Record<string, StartHereInstanceMeta>)
      : {};

  let layout = Array.isArray(d.layout)
    ? d.layout.filter((l) => l && typeof l.i === "string" && instancesIn[l.i])
    : [];

  const instanceKeys = new Set(layout.map((l) => l.i));

  /** Instances often reference private `sh_g_*` groups; if `groups` was empty or missing keys, we used to drop every widget and reset the dashboard. */
  for (const k of Array.from(instanceKeys)) {
    const m = instancesIn[k];
    if (!m || typeof m.groupId !== "string" || !m.groupId) continue;
    if (mergedInput[m.groupId] != null) continue;
    mergedInput = {
      ...mergedInput,
      [m.groupId]: coerceGroupState(rawGroups[m.groupId]),
    };
  }

  const instances: Record<string, StartHereInstanceMeta> = {};
  for (const k of Array.from(instanceKeys)) {
    const m = instancesIn[k];
    if (!m || mergedInput[m.groupId] == null) continue;
    if (!isStartHereWidgetType(m.type)) continue;
    if (m.type === "chart") {
      const ci = isStartHereInterval(m.chartInterval) ? m.chartInterval : undefined;
      const rawOv = (m as { chartSymbolOverride?: unknown }).chartSymbolOverride;
      const chartSymbolOverride =
        typeof rawOv === "string" && rawOv.trim() ? rawOv.trim().toUpperCase() : undefined;
      const rawLinkedSetId = (m as { linkedSetId?: unknown }).linkedSetId;
      const linkedSetId =
        typeof rawLinkedSetId === "string" && rawLinkedSetId.trim()
          ? rawLinkedSetId.trim()
          : undefined;
      const rawLinkedLocked = (m as { linkedSetLocked?: unknown }).linkedSetLocked;
      const linkedSetLocked = rawLinkedLocked === true;
      instances[k] = {
        type: "chart",
        groupId: m.groupId,
        ...(ci ? { chartInterval: ci } : {}),
        ...(chartSymbolOverride ? { chartSymbolOverride } : {}),
        ...(linkedSetId ? { linkedSetId } : {}),
        ...(linkedSetLocked ? { linkedSetLocked: true } : {}),
      };
    } else {
      instances[k] = { type: m.type, groupId: m.groupId };
    }
  }

  layout = layout.filter((l) => instances[l.i]);

  const usedGroupIds = new Set(Object.values(instances).map((m) => m.groupId));
  const groups: Record<string, StartHereGroupState> = {};
  for (const gid of Array.from(usedGroupIds)) {
    const g = mergedInput[gid];
    if (g) groups[gid] = { ...g, symbol: typeof g.symbol === "string" ? g.symbol : "" };
  }
  if (!layout.length || !Object.keys(instances).length) {
    return sanitizeDashboard(createDefaultDashboard());
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
  let defaultWatchlistInstanceId = d.defaultWatchlistInstanceId ?? null;
  if (defaultWatchlistInstanceId != null) {
    const wm = instances[defaultWatchlistInstanceId];
    if (!wm || wm.type !== "watchlist") defaultWatchlistInstanceId = null;
  }
  let defaultFlowInstanceId = d.defaultFlowInstanceId ?? null;
  if (defaultFlowInstanceId != null) {
    const fm = instances[defaultFlowInstanceId];
    if (!fm || fm.type !== "flow") defaultFlowInstanceId = null;
  }
  let focusedChartInstanceId = d.focusedChartInstanceId ?? null;
  if (focusedChartInstanceId != null) {
    const fm = instances[focusedChartInstanceId];
    if (!fm || fm.type !== "chart") focusedChartInstanceId = null;
  }

  let defaultFlowGridCells: StartHereFlowGridCells | null = null;
  if (defaultFlowInstanceId != null) {
    const li = layout.find((l) => l.i === defaultFlowInstanceId);
    if (li) {
      const fb = WIDGET_TEMPLATE.flow;
      const fromLi = clampFlowGridCells({
        w: li.w,
        h: li.h,
        minW: li.minW ?? fb.minW,
        minH: li.minH ?? fb.minH,
      });
      const stored = d.defaultFlowGridCells;
      let cells: StartHereFlowGridCells;
      if (isValidFlowGridCells(stored)) {
        const cs = clampFlowGridCells(stored);
        // Never shrink the live tile back to the saved template (that caused resize-to-smaller to "snap back").
        // Only trust `stored` over layout when fixing the classic RGL w=12 glitch with a narrower template.
        if (li.w === 12 && cs.w < 12) {
          cells = cs;
        } else {
          cells = fromLi;
        }
      } else {
        cells = fromLi;
      }
      defaultFlowGridCells = cells;
      layout = layout.map((l) => (l.i === defaultFlowInstanceId ? { ...l, ...cells } : l));
    }
  } else {
    const raw = d.defaultFlowGridCells;
    if (isValidFlowGridCells(raw)) {
      defaultFlowGridCells = clampFlowGridCells(raw);
    }
  }

  layout = normalizeStartHereLayoutMinBounds(layout, instances);
  if (defaultFlowInstanceId != null) {
    const fbFlow = WIDGET_TEMPLATE.flow;
    const liDone = layout.find((l) => l.i === defaultFlowInstanceId);
    if (liDone) {
      defaultFlowGridCells = clampFlowGridCells({
        w: liDone.w,
        h: liDone.h,
        minW: liDone.minW ?? fbFlow.minW,
        minH: liDone.minH ?? fbFlow.minH,
      });
    }
  }

  return {
    v: START_HERE_DASHBOARD_VERSION,
    layout,
    instances,
    groups: mergeLinkLanesIntoGroups(groups),
    defaultChartInstanceId,
    defaultWatchlistInstanceId,
    focusedChartInstanceId,
    defaultFlowInstanceId,
    defaultFlowGridCells,
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
          const parsedFlowCells = p.defaultFlowGridCells;
          const d = {
            ...p,
            v: START_HERE_DASHBOARD_VERSION,
            defaultChartInstanceId: p.defaultChartInstanceId ?? null,
            defaultWatchlistInstanceId:
              (p as StartHereDashboardV2).defaultWatchlistInstanceId ?? null,
            focusedChartInstanceId:
              (p as StartHereDashboardV2).focusedChartInstanceId ?? null,
            defaultFlowInstanceId:
              (p as StartHereDashboardV2).defaultFlowInstanceId ?? null,
            defaultFlowGridCells: isValidFlowGridCells(parsedFlowCells)
              ? clampFlowGridCells(parsedFlowCells)
              : null,
            defaultChartInterval: isStartHereInterval(p.defaultChartInterval)
              ? p.defaultChartInterval
              : undefined,
          };
          if (Array.isArray(d.layout) && d.instances && typeof d.instances === "object") {
            const withGroups: StartHereDashboardV2 = {
              ...d,
              groups:
                d.groups && typeof d.groups === "object" && !Array.isArray(d.groups)
                  ? d.groups
                  : {},
            };
            return sanitizeDashboard(withGroups);
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
  return sanitizeDashboard(createDefaultDashboard());
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

/** Per-workspace prefs mirrored to Postgres `extras` for cross-browser sync. */
export interface StartHereExtrasPersisted {
  watchlistPick?: Record<string, string>;
  newsMode?: Record<string, string>;
  /** Per watchlist widget instance: serialized `WatchlistColumnProfileFile` (v2 JSON: visible columns + widths). */
  watchlistColWidths?: Record<string, string>;
}

export function gatherStartHereExtras(
  userId: number,
  startId: string,
  dashboard: StartHereDashboardV2
): StartHereExtrasPersisted {
  const watchlistPick: Record<string, string> = {};
  for (const gid of Object.keys(dashboard.groups)) {
    try {
      const k = startHereWatchlistStorageKey(userId, startId, gid);
      const v = localStorage.getItem(k);
      if (v != null) watchlistPick[gid] = v;
    } catch {
      /* ignore */
    }
  }
  const newsMode: Record<string, string> = {};
  const watchlistColWidths: Record<string, string> = {};
  for (const iid of Object.keys(dashboard.instances)) {
    try {
      const nm = localStorage.getItem(startHereNewsModeStorageKey(userId, startId, iid));
      if (nm != null) newsMode[iid] = nm;
      const cw = localStorage.getItem(
        startHereWatchlistColumnWidthsStorageKey(userId, startId, iid)
      );
      if (cw != null) watchlistColWidths[iid] = cw;
    } catch {
      /* ignore */
    }
  }
  return { watchlistPick, newsMode, watchlistColWidths };
}

export function applyStartHereExtras(
  userId: number,
  startId: string,
  extras: unknown,
  dashboard: StartHereDashboardV2
): void {
  if (!extras || typeof extras !== "object" || Array.isArray(extras)) return;
  const e = extras as StartHereExtrasPersisted;
  try {
    for (const [gid, v] of Object.entries(e.watchlistPick ?? {})) {
      if (!dashboard.groups[gid] || typeof v !== "string") continue;
      localStorage.setItem(startHereWatchlistStorageKey(userId, startId, gid), v);
    }
    for (const [iid, v] of Object.entries(e.newsMode ?? {})) {
      if (!dashboard.instances[iid] || typeof v !== "string") continue;
      localStorage.setItem(startHereNewsModeStorageKey(userId, startId, iid), v);
    }
    for (const [iid, v] of Object.entries(e.watchlistColWidths ?? {})) {
      if (!dashboard.instances[iid] || typeof v !== "string") continue;
      localStorage.setItem(startHereWatchlistColumnWidthsStorageKey(userId, startId, iid), v);
    }
  } catch {
    /* ignore */
  }
}

/** Write server bootstrap payload into localStorage so existing widgets keep working. */
export function hydrateWorkspacesFromServerPayload(
  userId: number,
  workspaces: Array<{ workspaceId: string; name: string; dashboard: unknown; extras: unknown }>
): StartHereStartProfile[] {
  const profiles: StartHereStartProfile[] = workspaces.map((w) => ({
    id: w.workspaceId,
    name: w.name,
  }));
  saveStartProfiles(userId, profiles);
  for (const w of workspaces) {
    const raw = w.dashboard;
    if (!raw || typeof raw !== "object") continue;
    const d = sanitizeDashboard(raw as StartHereDashboardV2);
    saveDashboard(userId, w.workspaceId, d);
    applyStartHereExtras(userId, w.workspaceId, w.extras, d);
  }
  return profiles;
}

export function loadAllWorkspacesFromLocalStorageForMigration(userId: number): {
  profiles: StartHereStartProfile[];
  activeWorkspaceId: string;
  workspaces: Array<{
    workspaceId: string;
    name: string;
    dashboard: StartHereDashboardV2;
    extras: StartHereExtrasPersisted;
  }>;
} {
  const { profiles, activeStartId } = ensureStartProfilesAndActive(userId);
  const workspaces = profiles.map((p) => {
    const dashboard = loadDashboard(userId, p.id);
    const extras = gatherStartHereExtras(userId, p.id, dashboard);
    return { workspaceId: p.id, name: p.name, dashboard, extras };
  });
  return { profiles, activeWorkspaceId: activeStartId, workspaces };
}
