import type { PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { WatchlistColumnId, WatchlistColumnEntry } from "@/lib/watchlist-column-profile";
import {
  WATCHLIST_COLUMN_META,
  allowedColumnIds,
  defaultProfile,
  isColumnAllowed,
  normalizeWatchlistColumnEntries,
  simpleDefaultProfile,
  parseWatchlistColumnProfile,
  serializeWatchlistColumnProfile,
  WATCHLIST_REQUIRED_COLUMN_IDS,
  type WatchlistTableVariant,
} from "@/lib/watchlist-column-profile";

export function useWatchlistColumnProfile(
  storageKey: string,
  variant: WatchlistTableVariant,
  options?: { seedFromStorageKey?: string | null }
) {
  const seedFromStorageKey = options?.seedFromStorageKey ?? null;

  const read = useCallback(() => {
    try {
      const primary = localStorage.getItem(storageKey);
      if (primary) return parseWatchlistColumnProfile(primary, variant);
      if (seedFromStorageKey) {
        const seed = localStorage.getItem(seedFromStorageKey);
        if (seed) return parseWatchlistColumnProfile(seed, variant);
      }
    } catch {
      /* ignore */
    }
    return defaultProfile(variant);
  }, [storageKey, variant, seedFromStorageKey]);

  const [columns, setColumns] = useState<WatchlistColumnEntry[]>(() => read());

  useEffect(() => {
    setColumns(read());
  }, [read]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, serializeWatchlistColumnProfile(columns));
    } catch {
      /* ignore */
    }
  }, [storageKey, columns]);

  const snapshotRef = useRef(columns);
  snapshotRef.current = columns;

  const beginResize = useCallback((columnIndex: number, e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const base = [...snapshotRef.current];
    const col = base[columnIndex];
    if (!col) return;
    const meta = WATCHLIST_COLUMN_META[col.id];
    const minW = meta.minWidth;
    const maxW = 560;
    const startW = col.width;

    const onMove = (ev: PointerEvent) => {
      const delta = ev.clientX - startX;
      setColumns(() => {
        const next = [...base];
        const c = next[columnIndex];
        if (!c) return base;
        next[columnIndex] = {
          ...c,
          width: Math.min(maxW, Math.max(minW, startW + delta)),
        };
        return next;
      });
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  }, []);

  const addColumn = useCallback(
    (id: WatchlistColumnId) => {
      if (!isColumnAllowed(id, variant)) return;
      setColumns((prev) => {
        if (prev.some((c) => c.id === id)) return prev;
        const w = WATCHLIST_COLUMN_META[id].defaultWidth;
        const rest = prev.filter((c) => c.id !== "actions");
        const actions = prev.find((c) => c.id === "actions");
        const merged = [...rest, { id, width: w }, ...(actions ? [actions] : [])];
        return normalizeWatchlistColumnEntries(merged, variant);
      });
    },
    [variant]
  );

  const removeColumn = useCallback(
    (id: WatchlistColumnId) => {
      if (WATCHLIST_REQUIRED_COLUMN_IDS.includes(id)) return;
      setColumns((prev) =>
        normalizeWatchlistColumnEntries(
          prev.filter((c) => c.id !== id),
          variant
        )
      );
    },
    [variant]
  );

  const availableToAdd = useCallback((): WatchlistColumnId[] => {
    const have = new Set(columns.map((c) => c.id));
    return allowedColumnIds(variant).filter((id) => !have.has(id));
  }, [columns, variant]);

  const applyColumnPreset = useCallback(
    (preset: "standard" | "simple") => {
      setColumns(preset === "simple" ? simpleDefaultProfile(variant) : defaultProfile(variant));
    },
    [variant]
  );

  return {
    columns,
    setColumns,
    beginResize,
    addColumn,
    removeColumn,
    availableToAdd,
    applyColumnPreset,
  };
}
