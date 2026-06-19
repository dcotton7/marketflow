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
  if (width >= 1600) return "xl";
  if (width >= 1280) return "lg";
  if (width >= 960) return "md";
  return "sm";
}

export interface ResponsiveLayout {
  enabled: boolean;
  width: number;
  tier: BreakpointTier;
  isCompact: boolean;
  isNarrow: boolean;
  stackPanels: boolean;
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
    isCompact: enabled && (tier === "md" || tier === "sm"),
    isNarrow: enabled && tier === "sm",
    stackPanels: enabled && (tier === "md" || tier === "sm"),
    collapseNav: enabled && (tier === "md" || tier === "sm"),
  };
}
