import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Layout } from "react-grid-layout/legacy";
import type { CssVariables } from "@/context/SystemSettingsContext";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { StartHereInterval } from "@/components/MiniChart";
import { useStartHereChromeHeaderContext } from "@/components/start-here/StartHereWidgetChrome";
import { useWorkspacePalette } from "@/context/WorkspacePaletteContext";
import {
  addChartFromWatchlistSymbol,
  appendWidget,
  appendLinkedChartTriplet,
  broadcastGroupSymbolToLane,
  chartInstanceIdsForGroup,
  clearChartSymbolOverrideOnInstance,
  copyWatchlistAndNewsStorageForDuplicate,
  createDefaultDashboard,
  DEFAULT_START_ID,
  gatherStartHereExtras,
  hydrateWorkspacesFromServerPayload,
  loadAllWorkspacesFromLocalStorageForMigration,
  unlinkInstanceToPrivateGroup,
  loadChartsFromList,
  loadDashboard,
  migrateLegacyAuxiliaryKeysForHome,
  newStartProfileId,
  groupLinkAccent,
  isLinkLaneGroupId,
  linkLaneGroupId,
  LINK_LANE_COUNT,
  paletteColorAt,
  paletteLabelAt,
  START_HERE_UNLINKED_SELECT_VALUE,
  purgeStartWorkspaceStorage,
  remapDashboardIds,
  removeInstance,
  mergePersistedGridLayout,
  patchResistDefaultFlowFullWidth,
  saveActiveStartId,
  sanitizeDashboard,
  saveDashboard,
  saveStartProfiles,
  setChartInstanceInterval,
  setChartSymbolOverrideOnInstance,
  setDefaultChartTemplate,
  setDefaultFlowTemplate,
  setDefaultWatchlistTemplate,
  setInstanceGroupId,
  startHereWatchlistColumnWidthsStorageKey,
  type StartHereDashboardV2,
  type StartHereStartProfile,
  type StartHereWidgetType,
  type StartHereWorkspacePalette,
} from "./dashboard-persistence";
import {
  deleteStartHereWorkspace,
  fetchStartHereBootstrap,
  patchStartHereActive,
  putStartHereWorkspace,
} from "@/lib/start-here-api";
import {
  serializeWatchlistColumnProfile,
  simpleDefaultProfile,
} from "@/lib/watchlist-column-profile";

export type { StartHereWidgetType };

export interface LoadChartsFromListOutcome {
  placed: number;
  skipped: number;
}

interface StartHereContextValue {
  userId: number;
  /** Active workspace id (layouts sync to Postgres; localStorage mirrors for fast widget reads). */
  activeStartId: string;
  startProfiles: StartHereStartProfile[];
  switchStart: (startId: string) => void;
  createStart: (name: string) => void;
  duplicateActiveStart: (name: string) => void;
  renameStart: (startId: string, name: string) => void;
  deleteStart: (startId: string) => Promise<boolean>;
  dashboard: StartHereDashboardV2;
  /** `trustRgl` while dragging/resizing so width corrections are not overwritten. */
  setLayout: (layout: Layout, options?: { trustRgl?: boolean }) => void;
  setGroupSymbol: (groupId: string, symbol: string) => void;
  setInstanceGroup: (instanceId: string, groupId: string) => void;
  forkNewGroup: (instanceId: string) => void;
  addWidget: (type: StartHereWidgetType) => void;
  addLinkedChartTriplet: () => void;
  removeInstance: (instanceId: string) => void;
  resetDashboard: () => void;
  setDefaultChartTemplate: (instanceId: string | null) => void;
  setDefaultWatchlistTemplate: (instanceId: string | null) => void;
  setDefaultFlowTemplate: (instanceId: string | null) => void;
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
  /**
   * After localStorage-only prefs change (e.g. watchlist column profile), queue a debounced save so
   * `gatherStartHereExtras` is written to the server with the workspace.
   */
  queueWorkspaceRemoteSave: () => void;
  /** Chart tile focus for watchlist row-click targeting (same lane). */
  setFocusedChartInstance: (instanceId: string | null) => void;
  setChartTickerOverride: (instanceId: string, symbol: string) => void;
  clearChartTickerOverride: (instanceId: string) => void;
  broadcastLaneSymbol: (groupId: string, symbol: string) => void;
  chartInstanceIdsForGroup: (groupId: string) => string[];
  /** Admin-configurable link-lane + unlinked colors for Start Here chrome. */
  workspacePalette: StartHereWorkspacePalette;
}

const StartHereContext = createContext<StartHereContextValue | null>(null);

export function StartHereProvider({
  userId,
  children,
}: {
  userId: number;
  children: ReactNode;
}) {
  const { palette: workspacePalette } = useWorkspacePalette();
  const [loadStatus, setLoadStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);

  const [startProfiles, setStartProfiles] = useState<StartHereStartProfile[]>([]);
  const [activeStartId, setActiveStartId] = useState(DEFAULT_START_ID);
  const [dashboard, setDashboard] = useState<StartHereDashboardV2>(() =>
    sanitizeDashboard(createDefaultDashboard())
  );

  const dashboardRef = useRef(dashboard);
  dashboardRef.current = dashboard;
  const startProfilesRef = useRef(startProfiles);
  startProfilesRef.current = startProfiles;
  const activeStartIdRef = useRef(activeStartId);
  activeStartIdRef.current = activeStartId;
  const remoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remoteReadyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadStatus("loading");
      setLoadError(null);
      remoteReadyRef.current = false;
      try {
        const data = await fetchStartHereBootstrap();
        if (cancelled) return;
        if (data.workspaces.length === 0) {
          const migrated = loadAllWorkspacesFromLocalStorageForMigration(userId);
          for (const w of migrated.workspaces) {
            await putStartHereWorkspace({
              workspaceId: w.workspaceId,
              name: w.name,
              dashboard: w.dashboard,
              extras: w.extras as Record<string, unknown>,
            });
          }
          await patchStartHereActive(migrated.activeWorkspaceId);
          hydrateWorkspacesFromServerPayload(
            userId,
            migrated.workspaces.map((x) => ({
              workspaceId: x.workspaceId,
              name: x.name,
              dashboard: x.dashboard,
              extras: x.extras,
            }))
          );
          saveActiveStartId(userId, migrated.activeWorkspaceId);
          setStartProfiles(migrated.profiles);
          setActiveStartId(migrated.activeWorkspaceId);
          const d0 = loadDashboard(userId, migrated.activeWorkspaceId);
          migrateLegacyAuxiliaryKeysForHome(userId, d0);
          setDashboard(d0);
        } else {
          hydrateWorkspacesFromServerPayload(userId, data.workspaces);
          const active =
            data.activeWorkspaceId &&
            data.workspaces.some((w) => w.workspaceId === data.activeWorkspaceId)
              ? data.activeWorkspaceId
              : data.workspaces[0]!.workspaceId;
          saveActiveStartId(userId, active);
          setStartProfiles(data.workspaces.map((w) => ({ id: w.workspaceId, name: w.name })));
          setActiveStartId(active);
          const d1 = loadDashboard(userId, active);
          migrateLegacyAuxiliaryKeysForHome(userId, d1);
          setDashboard(d1);
        }
        remoteReadyRef.current = true;
        setLoadStatus("ready");
      } catch (e) {
        if (cancelled) return;
        console.error(e);
        setLoadError(
          e instanceof Error ? e.message : "Failed to sync Start workspaces from server"
        );
        remoteReadyRef.current = false;
        setLoadStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const flushRemote = useCallback(
    async (dash: StartHereDashboardV2, activeId: string, profiles: StartHereStartProfile[]) => {
      if (!remoteReadyRef.current) return;
      try {
        const name = profiles.find((p) => p.id === activeId)?.name ?? "Start";
        const extras = gatherStartHereExtras(userId, activeId, dash);
        await putStartHereWorkspace({
          workspaceId: activeId,
          name,
          dashboard: sanitizeDashboard(dash),
          extras: extras as unknown as Record<string, unknown>,
        });
      } catch (e) {
        console.error("Remote save Start workspace failed:", e);
      }
    },
    [userId]
  );

  const scheduleRemoteSave = useCallback(() => {
    if (!remoteReadyRef.current) return;
    if (remoteTimerRef.current) clearTimeout(remoteTimerRef.current);
    remoteTimerRef.current = setTimeout(() => {
      remoteTimerRef.current = null;
      void flushRemote(
        dashboardRef.current,
        activeStartIdRef.current,
        startProfilesRef.current
      );
    }, 900);
  }, [flushRemote]);

  const queueWorkspaceRemoteSave = useCallback(() => {
    scheduleRemoteSave();
  }, [scheduleRemoteSave]);

  useEffect(() => {
    return () => {
      if (remoteTimerRef.current) clearTimeout(remoteTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === "hidden" && remoteReadyRef.current) {
        saveDashboard(userId, activeStartIdRef.current, dashboardRef.current);
        void flushRemote(
          dashboardRef.current,
          activeStartIdRef.current,
          startProfilesRef.current
        );
      }
    };
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("pagehide", flush);
    };
  }, [userId, flushRemote]);

  const gridViewportRowCapacityRef = useRef<number | undefined>(undefined);
  const setGridViewportRowCapacity = useCallback((rows: number | undefined) => {
    gridViewportRowCapacityRef.current = rows;
  }, []);

  const commit = useCallback(
    (updater: (d: StartHereDashboardV2) => StartHereDashboardV2) => {
      setDashboard((d) => {
        const next = updater(d);
        saveDashboard(userId, activeStartIdRef.current, next);
        scheduleRemoteSave();
        return next;
      });
    },
    [userId, scheduleRemoteSave]
  );

  const setLayout = useCallback(
    (layout: Layout, options?: { trustRgl?: boolean }) =>
      commit((d) => {
        const L =
          options?.trustRgl === true ? layout : patchResistDefaultFlowFullWidth(d, layout);
        return mergePersistedGridLayout(d, L);
      }),
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

  const setFocusedChartInstance = useCallback(
    (instanceId: string | null) =>
      commit((d) => {
        if (instanceId == null) {
          return { ...d, focusedChartInstanceId: null };
        }
        const m = d.instances[instanceId];
        if (!m || m.type !== "chart") return d;
        return { ...d, focusedChartInstanceId: instanceId };
      }),
    [commit]
  );

  const setChartTickerOverride = useCallback(
    (instanceId: string, symbol: string) =>
      commit((d) => setChartSymbolOverrideOnInstance(d, instanceId, symbol)),
    [commit]
  );

  const clearChartTickerOverride = useCallback(
    (instanceId: string) =>
      commit((d) => clearChartSymbolOverrideOnInstance(d, instanceId)),
    [commit]
  );

  const broadcastLaneSymbol = useCallback(
    (groupId: string, symbol: string) =>
      commit((d) => broadcastGroupSymbolToLane(d, groupId, symbol)),
    [commit]
  );

  const chartInstanceIdsForGroupFn = useCallback(
    (groupId: string) => chartInstanceIdsForGroup(dashboardRef.current, groupId),
    []
  );

  const setInstanceGroup = useCallback(
    (instanceId: string, groupId: string) =>
      commit((d) => setInstanceGroupId(d, instanceId, groupId)),
    [commit]
  );

  const forkNewGroup = useCallback(
    (instanceId: string) => commit((d) => unlinkInstanceToPrivateGroup(d, instanceId)),
    [commit]
  );

  const addWidget = useCallback(
    (type: StartHereWidgetType) => {
      const sid = activeStartIdRef.current;
      setDashboard((d) => {
        const next = appendWidget(d, type);
        const newInstanceId = Object.keys(next.instances).find(
          (id) => !d.instances[id] && next.instances[id]?.type === type
        );
        if (
          type === "watchlist" &&
          newInstanceId &&
          d.defaultWatchlistInstanceId &&
          d.defaultWatchlistInstanceId !== newInstanceId
        ) {
          try {
            const fromK = startHereWatchlistColumnWidthsStorageKey(
              userId,
              sid,
              d.defaultWatchlistInstanceId
            );
            const toK = startHereWatchlistColumnWidthsStorageKey(userId, sid, newInstanceId);
            const v = localStorage.getItem(fromK);
            if (v != null) localStorage.setItem(toK, v);
          } catch {
            /* ignore */
          }
        } else if (type === "watchlist" && newInstanceId && !d.defaultWatchlistInstanceId) {
          try {
            const toK = startHereWatchlistColumnWidthsStorageKey(userId, sid, newInstanceId);
            localStorage.setItem(
              toK,
              serializeWatchlistColumnProfile(simpleDefaultProfile("portal"))
            );
          } catch {
            /* ignore */
          }
        }
        saveDashboard(userId, sid, next);
        scheduleRemoteSave();
        return next;
      });
    },
    [userId, scheduleRemoteSave]
  );

  const addLinkedChartTripletFn = useCallback(() => {
    const sid = activeStartIdRef.current;
    setDashboard((d) => {
      const next = appendLinkedChartTriplet(d);
      saveDashboard(userId, sid, next);
      scheduleRemoteSave();
      return next;
    });
  }, [userId, scheduleRemoteSave]);

  const removeInstanceFn = useCallback(
    (instanceId: string) => commit((d) => removeInstance(d, instanceId)),
    [commit]
  );

  const resetDashboard = useCallback(() => {
    const fresh = sanitizeDashboard(createDefaultDashboard());
    setDashboard(fresh);
    saveDashboard(userId, activeStartIdRef.current, fresh);
    scheduleRemoteSave();
  }, [userId, scheduleRemoteSave]);

  const switchStart = useCallback(
    async (startId: string) => {
      if (startId === activeStartIdRef.current) return;
      if (remoteTimerRef.current) {
        clearTimeout(remoteTimerRef.current);
        remoteTimerRef.current = null;
      }
      const curId = activeStartIdRef.current;
      const currentDash = dashboardRef.current;
      const profs = startProfilesRef.current;
      await flushRemote(currentDash, curId, profs);
      saveDashboard(userId, curId, currentDash);
      const next = loadDashboard(userId, startId);
      setDashboard(next);
      setActiveStartId(startId);
      saveActiveStartId(userId, startId);
      try {
        await patchStartHereActive(startId);
      } catch (e) {
        console.error(e);
      }
    },
    [userId, flushRemote]
  );

  const createStart = useCallback(
    async (name: string) => {
      if (remoteTimerRef.current) {
        clearTimeout(remoteTimerRef.current);
        remoteTimerRef.current = null;
      }
      await flushRemote(
        dashboardRef.current,
        activeStartIdRef.current,
        startProfilesRef.current
      );
      saveDashboard(userId, activeStartIdRef.current, dashboardRef.current);
      const id = newStartProfileId();
      const label = name.trim() || "New Start";
      const fresh = sanitizeDashboard(createDefaultDashboard());
      saveDashboard(userId, id, fresh);
      setStartProfiles((p) => {
        const next = [...p, { id, name: label }];
        saveStartProfiles(userId, next);
        startProfilesRef.current = next;
        return next;
      });
      setActiveStartId(id);
      saveActiveStartId(userId, id);
      activeStartIdRef.current = id;
      setDashboard(fresh);
      try {
        await putStartHereWorkspace({
          workspaceId: id,
          name: label,
          dashboard: fresh,
          extras: {},
        });
        await patchStartHereActive(id);
      } catch (e) {
        console.error(e);
      }
    },
    [userId, flushRemote]
  );

  const duplicateActiveStart = useCallback(
    async (name: string) => {
      if (remoteTimerRef.current) {
        clearTimeout(remoteTimerRef.current);
        remoteTimerRef.current = null;
      }
      const curId = activeStartIdRef.current;
      const current = dashboardRef.current;
      const profs = startProfilesRef.current;
      await flushRemote(current, curId, profs);
      saveDashboard(userId, curId, current);
      const id = newStartProfileId();
      const currentName = profs.find((p) => p.id === curId)?.name ?? "Start";
      const label = name.trim() || `${currentName} copy`;
      const { dashboard: cloned, instanceMap, groupMap } = remapDashboardIds(current);
      saveDashboard(userId, id, cloned);
      copyWatchlistAndNewsStorageForDuplicate(userId, curId, id, instanceMap, groupMap);
      const extras = gatherStartHereExtras(userId, id, cloned);
      setStartProfiles((p) => {
        const next = [...p, { id, name: label }];
        saveStartProfiles(userId, next);
        startProfilesRef.current = next;
        return next;
      });
      setActiveStartId(id);
      saveActiveStartId(userId, id);
      activeStartIdRef.current = id;
      setDashboard(cloned);
      try {
        await putStartHereWorkspace({
          workspaceId: id,
          name: label,
          dashboard: sanitizeDashboard(cloned),
          extras: extras as unknown as Record<string, unknown>,
        });
        await patchStartHereActive(id);
      } catch (e) {
        console.error(e);
      }
    },
    [userId, flushRemote]
  );

  const renameStart = useCallback(
    async (startId: string, name: string) => {
      const label = name.trim();
      if (!label) return;
      setStartProfiles((p) => {
        const next = p.map((x) => (x.id === startId ? { ...x, name: label } : x));
        saveStartProfiles(userId, next);
        startProfilesRef.current = next;
        return next;
      });
      const d = loadDashboard(userId, startId);
      const extras = gatherStartHereExtras(userId, startId, d);
      try {
        await putStartHereWorkspace({
          workspaceId: startId,
          name: label,
          dashboard: sanitizeDashboard(d),
          extras: extras as unknown as Record<string, unknown>,
        });
      } catch (e) {
        console.error(e);
      }
    },
    [userId]
  );

  const deleteStart = useCallback(
    async (startId: string) => {
      if (startProfilesRef.current.length <= 1) return false;
      if (remoteTimerRef.current) {
        clearTimeout(remoteTimerRef.current);
        remoteTimerRef.current = null;
      }
      const curActive = activeStartIdRef.current;
      if (startId === curActive) {
        await flushRemote(dashboardRef.current, curActive, startProfilesRef.current);
      }
      const dash = loadDashboard(userId, startId);
      purgeStartWorkspaceStorage(userId, startId, dash);
      try {
        await deleteStartHereWorkspace(startId);
      } catch (e) {
        console.error(e);
      }
      const nextProfiles = startProfilesRef.current.filter((x) => x.id !== startId);
      saveStartProfiles(userId, nextProfiles);
      setStartProfiles(nextProfiles);
      startProfilesRef.current = nextProfiles;
      if (startId === curActive) {
        const nid = nextProfiles[0]!.id;
        const loaded = loadDashboard(userId, nid);
        setDashboard(loaded);
        setActiveStartId(nid);
        saveActiveStartId(userId, nid);
        activeStartIdRef.current = nid;
        try {
          await patchStartHereActive(nid);
        } catch (e) {
          console.error(e);
        }
      }
      return true;
    },
    [userId, flushRemote]
  );

  const setDefaultChartTemplateFn = useCallback(
    (instanceId: string | null) =>
      commit((d) => setDefaultChartTemplate(d, instanceId)),
    [commit]
  );

  const setDefaultWatchlistTemplateFn = useCallback(
    (instanceId: string | null) =>
      commit((d) => setDefaultWatchlistTemplate(d, instanceId)),
    [commit]
  );

  const setDefaultFlowTemplateFn = useCallback(
    (instanceId: string | null) =>
      commit((d) => setDefaultFlowTemplate(d, instanceId)),
    [commit]
  );

  const loadChartsFromListFn = useCallback(
    (
      symbols: string[],
      opts?: { inheritColorFromGroupId?: string; inheritColorIndex?: number }
    ) => {
      const cap = gridViewportRowCapacityRef.current;
      let stats: LoadChartsFromListOutcome = { placed: 0, skipped: 0 };
      const sid = activeStartIdRef.current;
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
        saveDashboard(userId, sid, result.dashboard);
        scheduleRemoteSave();
        return result.dashboard;
      });
      return stats;
    },
    [userId, scheduleRemoteSave]
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
      addLinkedChartTriplet: addLinkedChartTripletFn,
      removeInstance: removeInstanceFn,
      resetDashboard,
      setDefaultChartTemplate: setDefaultChartTemplateFn,
      setDefaultWatchlistTemplate: setDefaultWatchlistTemplateFn,
      setDefaultFlowTemplate: setDefaultFlowTemplateFn,
      setGridViewportRowCapacity,
      loadChartsFromList: loadChartsFromListFn,
      setChartInterval: setChartIntervalFn,
      addChartFromWatchlist: addChartFromWatchlistFn,
      queueWorkspaceRemoteSave,
      setFocusedChartInstance,
      setChartTickerOverride,
      clearChartTickerOverride,
      broadcastLaneSymbol,
      chartInstanceIdsForGroup: chartInstanceIdsForGroupFn,
      workspacePalette,
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
      addLinkedChartTripletFn,
      removeInstanceFn,
      resetDashboard,
      setDefaultChartTemplateFn,
      setDefaultWatchlistTemplateFn,
      setDefaultFlowTemplateFn,
      setGridViewportRowCapacity,
      loadChartsFromListFn,
      setChartIntervalFn,
      addChartFromWatchlistFn,
      queueWorkspaceRemoteSave,
      setFocusedChartInstance,
      setChartTickerOverride,
      clearChartTickerOverride,
      broadcastLaneSymbol,
      chartInstanceIdsForGroupFn,
      workspacePalette,
    ]
  );

  if (loadStatus === "loading") {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
        Loading saved workspace…
      </div>
    );
  }

  if (loadStatus === "error") {
    const err = loadError ?? "";
    const serverAlreadyMentionsDbPush =
      /db:push/i.test(err) || /database tables are missing/i.test(err);
    /** Browser throws this when no HTTP response (server down, wrong host, CORS, offline). */
    const looksLikeNetworkNoResponse =
      /failed to fetch/i.test(err) ||
      /networkerror/i.test(err) ||
      /load failed/i.test(err) ||
      /network request failed/i.test(err);
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="text-destructive">
          {loadError ?? "Could not load Start workspaces from the database."}
        </p>
        {looksLikeNetworkNoResponse ? (
          <p className="max-w-md text-sm text-muted-foreground">
            No response from the server. Start the backend (e.g.{" "}
            <code className="rounded bg-muted px-1 py-0.5">npm run dev</code>), open the app on the
            same host/port the dev server proxies API requests to, check VPN or firewall, then refresh.
            This message is usually <span className="font-medium">not</span> a database migration issue.
          </p>
        ) : serverAlreadyMentionsDbPush ? (
          <p className="max-w-md text-sm text-muted-foreground">
            If Drizzle asks whether a table is new or renamed, choose{" "}
            <code className="rounded bg-muted px-1 py-0.5">create table</code> for Start Here tables.
            Do not choose rename from pattern training tables.
          </p>
        ) : (
          <p className="max-w-md text-sm text-muted-foreground">
            Run <code className="rounded bg-muted px-1 py-0.5">npm run db:push</code> after pulling,
            ensure <code className="rounded bg-muted px-1 py-0.5">DATABASE_URL</code> is set, then refresh.
          </p>
        )}
      </div>
    );
  }

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
  const { dashboard, setGroupSymbol, workspacePalette } = useStartHere();
  const g = dashboard.groups[groupId];
  const { accentColor, accentLabel } = groupLinkAccent(groupId, workspacePalette, g);
  return {
    symbol: g?.symbol ?? "",
    setSymbol: (s: string) => setGroupSymbol(groupId, s),
    accentColor,
    accentLabel,
  };
}

export function StartHereGroupPicker({
  instanceId,
  cssVariables,
  disabled = false,
}: {
  instanceId: string;
  cssVariables: CssVariables;
  disabled?: boolean;
}) {
  const { dashboard, setInstanceGroup, forkNewGroup, workspacePalette } = useStartHere();
  const chromeHdr = useStartHereChromeHeaderContext();
  const meta = dashboard.instances[instanceId];
  if (!meta) return null;

  const selectValue = isLinkLaneGroupId(meta.groupId)
    ? meta.groupId
    : START_HERE_UNLINKED_SELECT_VALUE;

  return (
    <Select
      value={selectValue}
      disabled={disabled}
      onValueChange={(v) => {
        if (v === START_HERE_UNLINKED_SELECT_VALUE) forkNewGroup(instanceId);
        else setInstanceGroup(instanceId, v);
      }}
    >
      <SelectTrigger
        className={cn(
          "start-here-no-drag h-8 min-w-[119px] max-w-[170px] flex-shrink-0 text-xs",
          chromeHdr?.accentHeader &&
            "!border-current/40 !bg-current/10 hover:!bg-current/18 data-[placeholder]:!text-current/70"
        )}
        style={{
          color: chromeHdr?.fg ?? cssVariables.textColorNormal,
          fontSize: cssVariables.fontSizeSmall,
        }}
        aria-label="Link widget group"
      >
        <SelectValue placeholder="Link" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={START_HERE_UNLINKED_SELECT_VALUE} className="text-xs">
          <span className="flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full border border-white/20"
              style={{ backgroundColor: workspacePalette.unlinkedColor }}
            />
            <span className="truncate">Unlinked</span>
          </span>
        </SelectItem>
        {Array.from({ length: LINK_LANE_COUNT }, (_, i) => (
          <SelectItem key={linkLaneGroupId(i)} value={linkLaneGroupId(i)} className="text-xs">
            <span className="flex items-center gap-2">
              <span
                className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full"
                style={{ backgroundColor: paletteColorAt(i, workspacePalette) }}
              />
              <span className="truncate">{paletteLabelAt(i, workspacePalette)}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
