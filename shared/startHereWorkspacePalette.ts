/** Start Here (Sentinel) link-lane chrome colors — defaults + normalization for admin + API. */

export const START_HERE_LINK_LANE_COUNT = 10 as const;

export interface StartHereLinkLaneSwatch {
  label: string;
  color: string;
}

export interface StartHereWorkspacePalette {
  linkLanes: StartHereLinkLaneSwatch[];
  /** Accent for widgets not on a link lane (“Unlinked”). */
  unlinkedColor: string;
}

export const DEFAULT_START_HERE_WORKSPACE_PALETTE: StartHereWorkspacePalette = {
  linkLanes: [
    { label: "Emerald", color: "#22c55e" },
    { label: "Sky", color: "#38bdf8" },
    { label: "Violet", color: "#a855f7" },
    { label: "Amber", color: "#f59e0b" },
    { label: "Rose", color: "#f43f5e" },
    { label: "Cyan", color: "#06b6d4" },
    { label: "Indigo", color: "#6366f1" },
    { label: "Lime", color: "#84cc16" },
    { label: "Fuchsia", color: "#d946ef" },
    { label: "Orange", color: "#ea580c" },
  ],
  unlinkedColor: "#64748b",
};

const HEX6 = /^#([0-9a-fA-F]{6})$/;

export function isValidHex6(s: string): boolean {
  return typeof s === "string" && HEX6.test(s.trim());
}

function clampLabel(s: string, max = 48): string {
  const t = s.trim().slice(0, max);
  return t || "Lane";
}

/** Merge partial/invalid API data with defaults; always returns exactly N link lanes + unlinked. */
export function normalizeStartHereWorkspacePalette(input: unknown): StartHereWorkspacePalette {
  const base: StartHereWorkspacePalette = {
    linkLanes: DEFAULT_START_HERE_WORKSPACE_PALETTE.linkLanes.map((x) => ({ ...x })),
    unlinkedColor: DEFAULT_START_HERE_WORKSPACE_PALETTE.unlinkedColor,
  };

  if (!input || typeof input !== "object") return base;

  const o = input as Record<string, unknown>;
  if (typeof o.unlinkedColor === "string" && isValidHex6(o.unlinkedColor)) {
    base.unlinkedColor = o.unlinkedColor.trim();
  }

  if (!Array.isArray(o.linkLanes)) return base;

  for (let i = 0; i < START_HERE_LINK_LANE_COUNT; i++) {
    const def = DEFAULT_START_HERE_WORKSPACE_PALETTE.linkLanes[i]!;
    let label = def.label;
    let color = def.color;
    const row = o.linkLanes[i];
    if (row && typeof row === "object") {
      const r = row as Record<string, unknown>;
      if (typeof r.label === "string") label = clampLabel(r.label);
      if (typeof r.color === "string" && isValidHex6(r.color)) color = r.color.trim();
    }
    base.linkLanes[i] = { label, color };
  }

  return base;
}
