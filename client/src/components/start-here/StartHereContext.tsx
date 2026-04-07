import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Layout } from "react-grid-layout/legacy";
import type { CssVariables } from "@/context/SystemSettingsContext";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { StartHereInterval } from "@/components/MiniChart";
import {
  addChartFromWatchlistSymbol,
  appendWidget,
  copyWatchlistAndNewsStorageForDuplicate,
  createDefaultDashboard,
  ensureStartProfilesAndActive,
  forkNewGroupForInstance,
  loadChartsFromList,
  loadDashboard,
  migrateLegacyAuxiliaryKeysForHome,
  newStartProfileId,
  paletteColorAt,
  paletteLabelAt,
  purgeStartWorkspaceStorage,
  remapDashboardIds,
  removeInstance,
  sanitizeLayoutForInstances,
  saveActiveStartId,
  saveDashboard,
  saveStartProfiles,
  setChartInstanceInterval,
  setDefaultChartTemplate,
  setInstanceGroupId,
  type StartHereDashboardV2,
  type StartHereStartProfile,
  type StartHereWidgetType,
} from "./dashboard-persistence";

export type { StartHereWidgetType };

export interface LoadChartsFromListOutcome {
  placed: number;
  skipped: number;
}

interface StartHereContextValue {
  userId: number;
  /** Active workspace id (localStorage–persisted layouts and widget prefs are scoped by this). */
  activeStartId: string;
  startProfiles: StartHereStartProfile[];
  switchStart: (startId: string) => void;
  createStart: (name: string) => void;
  duplicateActiveStart: (name: string) => void;
  renameStart: (startId: string, name: string) => void;
  deleteStart: (startId: string) => boolean;
  dashboard: StartHereDashboardV2;
  setLayout: (layout: Layout) => void;
  setGroupSymbol: (groupId: string, symbol: string) => void;
  setInstanceGroup: (instanceId: string, groupId: string) => void;
  forkNewGroup: (instanceId: string) => void;
  addWidget: (type: StartHereWidgetType) => void;
  removeInstance: (instanceId: string) => void;
  resetDashboard: () => void;
  setDefaultChartTemplate: (instanceId: string | null) => void;
  /** Updated by the grid host via ResizeObserver; caps bulk chart placement to roughly one viewport below existing layout. */
  setGridViewportRowCapacity: (rows: number | undefined) => void;
  loadChartsFromList: (
    symbols: string[],
    opts?: { inheritColorFromGroupId?: string; inheritColorIndex?: number }
  ) => LoadChartsFromListOutcome;
  setChartInterval: (instanceId: string, interval: StartHereInterval) => void;
  /** Adds a chart widget on the grid (below existing layout), sized like the Default chart; symbol + timeframe from that template. */
  addChartFromWatchlist: (
    symbol: string,
    opts?: { inheritColorFromGroupId?: string; inheritColorIndex?: number }
  ) => void;
}

const StartHereContext = createContext<StartHereContextValue | null>(null);

export function StartHereProvider({
  userId,
  children,
}: {
  userId: number;
  children: ReactNode;
}) {
  const boot = useMemo(() => {
    const { profiles, activeStartId: id } = ensureStartProfilesAndActive(userId);
    const d = loadDashboard(userId, id);
    migrateLegacyAuxiliaryKeysForHome(userId, d);
    return { profiles, activeStartId: id, dashboard: d };
  }, [userId]);

  const [startProfiles, setStartProfiles] = useState<StartHereStartProfile[]>(
    () => boot.profiles
  );
  const [activeStartId, setActiveStartId] = useState(() => boot.activeStartId);
  const [dashboard, setDashboard] = useState<StartHereDashboardV2>(() => boot.dashboard);

  const gridViewportRowCapacityRef = useRef<number | undefined>(undefined);
  const setGridViewportRowCapacity = useCallback((rows: number | undefined) => {
    gridViewportRowCapacityRef.current = rows;
  }, []);

  const commit = useCallback(
    (updater: (d: StartHereDashboardV2) => StartHereDashboardV2) => {
      setDashboard((d) => {
        const next = updater(d);
        saveDashboard(userId, activeStartId, next);
        return next;
      });
    },
    [userId, activeStartId]
  );

  const setLayout = useCallback(
    (layout: Layout) =>
      commit((d) => ({
        ...d,
        layout: sanitizeLayoutForInstances(layout, d.instances),
      })),
    [commit]
  );

  const setGroupSymbol = useCallback(
    (groupId: string, symbol: string) =>
      commit((d) => {
        if (!d.groups[groupId]) return d;
        return {
          ...d,
          groups: {
            ...d.groups,
            [groupId]: { ...d.groups[groupId], symbol },
          },
        };
      }),
    [commit]
  );

  const setInstanceGroup = useCallback(
    (instanceId: string, groupId: string) =>
      commit((d) => setInstanceGroupId(d, instanceId, groupId)),
    [commit]
  );

  const forkNewGroup = useCallback(
    (instanceId: string) => commit((d) => forkNewGroupForInstance(d, instanceId)),
    [commit]
  );

  const addWidget = useCallback(
    (type: StartHereWidgetType) => commit((d) => appendWidget(d, type)),
    [commit]
  );

  const removeInstanceFn = useCallback(
    (instanceId: string) => commit((d) => removeInstance(d, instanceId)),
    [commit]
  );

  const resetDashboard = useCallback(() => {
    const fresh = createDefaultDashboard();
    setDashboard(fresh);
    saveDashboard(userId, activeStartId, fresh);
  }, [userId, activeStartId]);

  const switchStart = useCallback(
    (startId: string) => {
      if (startId === activeStartId) return;
      setDashboard((current) => {
        saveDashboard(userId, activeStartId, current);
        const next = loadDashboard(userId, startId);
        return next;
      });
      setActiveStartId(startId);
      saveActiveStartId(userId, startId);
    },
    [userId, activeStartId]
  );

  const createStart = useCallback(
    (name: string) => {
      const id = newStartProfileId();
      const label = name.trim() || "New Start";
      const fresh = createDefaultDashboard();
      saveDashboard(userId, id, fresh);
      setStartProfiles((p) => {
        const next = [...p, { id, name: label }];
        saveStartProfiles(userId, next);
        return next;
      });
      setDashboard((current) => {
        saveDashboard(userId, activeStartId, current);
        return fresh;
      });
      setActiveStartId(id);
      saveActiveStartId(userId, id);
    },
    [userId, activeStartId]
  );

  const duplicateActiveStart = useCallback(
    (name: string) => {
      const id = newStartProfileId();
      const currentName =
        startProfiles.find((p) => p.id === activeStartId)?.name ?? "Start";
      const label = name.trim() || `${currentName} copy`;
      setDashboard((current) => {
        saveDashboard(userId, activeStartId, current);
        const { dashboard: cloned, instanceMap, groupMap } = remapDashboardIds(current);
        saveDashboard(userId, id, cloned);
        copyWatchlistAndNewsStorageForDuplicate(
          userId,
          activeStartId,
          id,
          instanceMap,
          groupMap
        );
        return cloned;
      });
      setStartProfiles((p) => {
        const next = [...p, { id, name: label }];
        saveStartProfiles(userId, next);
        return next;
      });
      setActiveStartId(id);
      saveActiveStartId(userId, id);
    },
    [userId, activeStartId, startProfiles]
  );

  const renameStart = useCallback(
    (startId: string, name: string) => {
      const label = name.trim();
      if (!label) return;
      setStartProfiles((p) => {
        const next = p.map((x) => (x.id === startId ? { ...x, name: label } : x));
        saveStartProfiles(userId, next);
        return next;
      });
    },
    [userId]
  );

  const deleteStart = useCallback(
    (startId: string) => {
      if (startProfiles.length <= 1) return false;
      const dash = loadDashboard(userId, startId);
      purgeStartWorkspaceStorage(userId, startId, dash);
      const nextProfiles = startProfiles.filter((x) => x.id !== startId);
      saveStartProfiles(userId, nextProfiles);
      setStartProfiles(nextProfiles);
      if (startId === activeStartId) {
        const nid = nextProfiles[0]!.id;
        const loaded = loadDashboard(userId, nid);
        setDashboard(loaded);
        setActiveStartId(nid);
        saveActiveStartId(userId, nid);
      }
      return true;
    },
    [userId, startProfiles, activeStartId]
  );

  const setDefaultChartTemplateFn = useCallback(
    (instanceId: string | null) =>
      commit((d) => setDefaultChartTemplate(d, instanceId)),
    [commit]
  );

  const loadChartsFromListFn = useCallback(
    (
      symbols: string[],
      opts?: { inheritColorFromGroupId?: string; inheritColorIndex?: number }
    ) => {
      const cap = gridViewportRowCapacityRef.current;
      let stats: LoadChartsFromListOutcome = { placed: 0, skipped: 0 };
      setDashboard((d) => {
        const result = loadChartsFromList(d, symbols, {
          ...(cap != null && cap > 0 ? { maxAdditionalGridRows: cap } : {}),
          ...(opts?.inheritColorFromGroupId
            ? { inheritColorFromGroupId: opts.inheritColorFromGroupId }
            : {}),
          ...(opts?.inheritColorIndex != null
            ? { inheritColorIndex: opts.inheritColorIndex }
            : {}),
        });
        stats = { placed: result.placed, skipped: result.skipped };
        saveDashboard(userId, activeStartId, result.dashboard);
        return result.dashboard;
      });
      return stats;
    },
    [userId, activeStartId]
  );

  const setChartIntervalFn = useCallback(
    (instanceId: string, interval: StartHereInterval) =>
      commit((d) => setChartInstanceInterval(d, instanceId, interval)),
    [commit]
  );

  const addChartFromWatchlistFn = useCallback(
    (
      symbol: string,
      opts?: { inheritColorFromGroupId?: string; inheritColorIndex?: number }
    ) => commit((d) => addChartFromWatchlistSymbol(d, symbol, opts)),
    [commit]
  );

  const value = useMemo(
    () => ({
      userId,
      activeStartId,
      startProfiles,
      switchStart,
      createStart,
      duplicateActiveStart,
      renameStart,
      deleteStart,
      dashboard,
      setLayout,
      setGroupSymbol,
      setInstanceGroup,
      forkNewGroup,
      addWidget,
      removeInstance: removeInstanceFn,
      resetDashboard,
      setDefaultChartTemplate: setDefaultChartTemplateFn,
      setGridViewportRowCapacity,
      loadChartsFromList: loadChartsFromListFn,
      setChartInterval: setChartIntervalFn,
      addChartFromWatchlist: addChartFromWatchlistFn,
    }),
    [
      userId,
      activeStartId,
      startProfiles,
      switchStart,
      createStart,
      duplicateActiveStart,
      renameStart,
      deleteStart,
      dashboard,
      setLayout,
      setGroupSymbol,
      setInstanceGroup,
      forkNewGroup,
      addWidget,
      removeInstanceFn,
      resetDashboard,
      setDefaultChartTemplateFn,
      setGridViewportRowCapacity,
      loadChartsFromListFn,
      setChartIntervalFn,
      addChartFromWatchlistFn,
    ]
  );

  return (
    <StartHereContext.Provider value={value}>{children}</StartHereContext.Provider>
  );
}

export function useStartHere() {
  const ctx = useContext(StartHereContext);
  if (!ctx) throw new Error("useStartHere must be used within StartHereProvider");
  return ctx;
}

export function useStartHereGroup(groupId: string) {
  const { dashboard, setGroupSymbol } = useStartHere();
  const g = dashboard.groups[groupId];
  const colorIndex = g?.colorIndex ?? 0;
  return {
    symbol: g?.symbol ?? "",
    setSymbol: (s: string) => setGroupSymbol(groupId, s),
    accentColor: paletteColorAt(colorIndex),
    accentLabel: paletteLabelAt(colorIndex),
  };
}

const NEW_GROUP_VALUE = "__start_here_new_group__";

export function StartHereGroupPicker({
  instanceId,
  cssVariables,
}: {
  instanceId: string;
  cssVariables: CssVariables;
}) {
  const { dashboard, setInstanceGroup, forkNewGroup } = useStartHere();
  const meta = dashboard.instances[instanceId];
  if (!meta) return null;

  const groupEntries = Object.entries(dashboard.groups).sort(([a], [b]) =>
    a.localeCompare(b)
  );

  return (
    <Select
      value={meta.groupId}
      onValueChange={(v) => {
        if (v === NEW_GROUP_VALUE) forkNewGroup(instanceId);
        else setInstanceGroup(instanceId, v);
      }}
    >
      <SelectTrigger
        className="start-here-no-drag h-8 w-[140px] flex-shrink-0 text-xs"
        style={{ color: cssVariables.textColorNormal, fontSize: cssVariables.fontSizeSmall }}
        aria-label="Link widget group"
      >
        <SelectValue placeholder="Group" />
      </SelectTrigger>
      <SelectContent>
        {groupEntries.map(([gid, state]) => (
          <SelectItem key={gid} value={gid} className="text-xs">
            <span className="flex items-center gap-2">
              <span
                className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full"
                style={{ backgroundColor: paletteColorAt(state.colorIndex) }}
              />
              {paletteLabelAt(state.colorIndex)}
            </span>
          </SelectItem>
        ))}
        <SelectItem value={NEW_GROUP_VALUE} className="text-xs">
          New group…
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
