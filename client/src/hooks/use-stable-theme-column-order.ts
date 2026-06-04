import { useEffect, useMemo, useRef, useState } from "react";
import type { ThemeRow } from "@/data/mockThemeData";
import {
  LIVE_THEME_REORDER_TRANSITION_MS,
  LIVE_THEME_REORDER_WARNING_SEC,
  type LiveThemeChartsColumnKey,
  type LiveThemeChartsSnapshotKey,
} from "@/lib/live-theme-charts";

export type RankMoveWarning = {
  /** Visual list direction (up = row moving toward top of column). */
  direction: "up" | "down";
  spots: number;
  secondsLeft: number;
};

function sameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * Holds top/bottom column row order stable after theme-box refresh, shows rank-move
 * warnings, then reorders with a slow transition. Picked column uses live order only.
 */
export function useStableThemeColumnOrder(
  columnKey: LiveThemeChartsColumnKey,
  columnThemes: ThemeRow[],
  snapshotKey: LiveThemeChartsSnapshotKey
) {
  const reorderEnabled =
    snapshotKey === "live" && (columnKey === "top" || columnKey === "bottom");

  const [displayIds, setDisplayIds] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<Map<string, RankMoveWarning>>(new Map());
  const [isReordering, setIsReordering] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  const pendingTargetIdsRef = useRef<string[] | null>(null);
  const themesByIdRef = useRef<Map<string, ThemeRow>>(new Map());
  const reorderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const animTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const targetIds = useMemo(() => columnThemes.map((t) => t.id), [columnThemes]);

  useEffect(() => {
    themesByIdRef.current = new Map(columnThemes.map((t) => [t.id, t]));
  }, [columnThemes]);

  useEffect(() => {
    if (!reorderEnabled) {
      setDisplayIds(targetIds);
      setWarnings(new Map());
      setSecondsLeft(null);
      setIsReordering(false);
      pendingTargetIdsRef.current = null;
      return;
    }

    if (displayIds.length === 0) {
      setDisplayIds(targetIds);
      return;
    }

    if (sameOrder(displayIds, targetIds)) {
      return;
    }

    const nextWarnings = new Map<string, RankMoveWarning>();
    for (const id of targetIds) {
      const oldIdx = displayIds.indexOf(id);
      const newIdx = targetIds.indexOf(id);
      if (oldIdx === -1 || newIdx === -1 || oldIdx === newIdx) continue;
      const delta = oldIdx - newIdx;
      nextWarnings.set(id, {
        direction: delta > 0 ? "up" : "down",
        spots: Math.abs(delta),
        secondsLeft: LIVE_THEME_REORDER_WARNING_SEC,
      });
    }

    pendingTargetIdsRef.current = targetIds;
    setWarnings(nextWarnings);
    setSecondsLeft(LIVE_THEME_REORDER_WARNING_SEC);

    if (reorderTimerRef.current) clearTimeout(reorderTimerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);

    countdownRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        const next = prev == null ? LIVE_THEME_REORDER_WARNING_SEC - 1 : prev - 1;
        if (next <= 0) {
          if (countdownRef.current) clearInterval(countdownRef.current);
          return 0;
        }
        setWarnings((current) => {
          const updated = new Map(current);
          for (const [id, w] of updated) {
            updated.set(id, { ...w, secondsLeft: next });
          }
          return updated;
        });
        return next;
      });
    }, 1000);

    reorderTimerRef.current = setTimeout(() => {
      const pending = pendingTargetIdsRef.current;
      if (!pending) return;
      setIsReordering(true);
      setDisplayIds(pending);
      setWarnings(new Map());
      setSecondsLeft(null);
      pendingTargetIdsRef.current = null;
      if (countdownRef.current) clearInterval(countdownRef.current);

      if (animTimerRef.current) clearTimeout(animTimerRef.current);
      animTimerRef.current = setTimeout(() => setIsReordering(false), LIVE_THEME_REORDER_TRANSITION_MS);
    }, LIVE_THEME_REORDER_WARNING_SEC * 1000);
  }, [targetIds, reorderEnabled]); // eslint-disable-line react-hooks/exhaustive-deps -- displayIds intentionally excluded; compare via closure on change

  useEffect(() => {
    return () => {
      if (reorderTimerRef.current) clearTimeout(reorderTimerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
      if (animTimerRef.current) clearTimeout(animTimerRef.current);
    };
  }, []);

  const displayThemes = useMemo(() => {
    if (!reorderEnabled) return columnThemes;
    const ids = displayIds.length > 0 ? displayIds : targetIds;
    const byId = themesByIdRef.current;
    return ids
      .map((id) => byId.get(id))
      .filter((t): t is ThemeRow => t != null);
  }, [columnThemes, displayIds, reorderEnabled, targetIds, warnings, secondsLeft]);

  return {
    displayThemes,
    rankMoveWarnings: warnings,
    isReordering,
    reorderCountdownSec: secondsLeft,
  };
}
