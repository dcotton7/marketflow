import { useState, useEffect, useMemo } from "react";

const FLAG_KEY = "layout";
const FLAG_VALUE = "responsive";

function hasResponsiveFlag(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get(FLAG_KEY) === FLAG_VALUE;
  } catch {
    return false;
  }
}

export type BreakpointTier = "xl" | "lg" | "md" | "sm";

function getTier(width: number): BreakpointTier {
  if (width >= 1800) return "xl";
  if (width >= 1440) return "lg";
  if (width >= 1100) return "md";
  return "sm";
}

export interface ResponsiveLayout {
  enabled: boolean;
  width: number;
  tier: BreakpointTier;
  /** Below 1440px — tighter spacing, collapsed nav, hidden header metrics */
  isCompact: boolean;
  /** Below 1100px — single-column heatmap, very tight */
  isNarrow: boolean;
  /** Below 1440px — stack the 3-column panels vertically */
  stackPanels: boolean;
  /** Below 1440px — secondary nav items go into "More" dropdown */
  collapseNav: boolean;
}

export function useResponsiveLayout(): ResponsiveLayout {
  const enabled = useMemo(() => hasResponsiveFlag(), []);
  const [width, setWidth] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 1920
  );

  useEffect(() => {
    if (!enabled) return;
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [enabled]);

  const tier = enabled ? getTier(width) : "xl";

  return {
    enabled,
    width,
    tier,
    isCompact: enabled && (tier === "md" || tier === "sm" || tier === "lg"),
    isNarrow: enabled && tier === "sm",
    stackPanels: enabled && (tier === "md" || tier === "sm" || tier === "lg"),
    collapseNav: enabled && (tier === "md" || tier === "sm" || tier === "lg"),
  };
}
