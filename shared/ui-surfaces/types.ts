/**
 * Shared UI surface nomenclature — stable region IDs for MarketFlow, Live Theme Charts, etc.
 * Use in data-ui-region, tests, docs, and agent rules. Display names are user-facing labels.
 */

export type UiRefreshTierId =
  | "themeStream"
  | "memberStream"
  | "themeBox"
  | "chartStream"
  | "snapshotHistory"
  | "benchmarkStrip";

export interface UiRefreshTier {
  id: UiRefreshTierId;
  /** Default interval when admin setting not loaded (ms). */
  defaultIntervalMs: number;
  description: string;
}

export interface UiRegionDef {
  id: string;
  displayName: string;
  /** Parent region id within the same surface. */
  parent?: string;
  refreshTier?: UiRefreshTierId;
  notes?: string;
}

export interface UiSurfaceDef {
  id: string;
  displayName: string;
  route?: string;
  refreshTiers: Record<UiRefreshTierId, UiRefreshTier | undefined>;
  regions: Record<string, UiRegionDef>;
}

/** `marketFlow:themeTrackerPanel` — use on data-ui-region and in tests. */
export function uiRegion(surfaceId: string, regionId: string): string {
  return `${surfaceId}:${regionId}`;
}
