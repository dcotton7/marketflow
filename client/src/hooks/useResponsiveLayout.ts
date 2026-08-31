import { useState, useEffect, useCallback } from "react";

const NAV_COLLAPSED_KEY = "nav-collapsed";

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
  /** Below 1200px — tighter spacing, icon-only or collapsed nav */
  isCompact: boolean;
  /** Below 1100px — single-column heatmap, very tight */
  isNarrow: boolean;
  /** Below 1440px — stack the 3-column panels vertically */
  stackPanels: boolean;
  /** Below 1440px — secondary nav items go into "More" dropdown */
  collapseNav: boolean;
  /** Between 1200-1440px — show nav icons only, hide text labels */
  iconOnlyNav: boolean;
  /** True if manually collapsed OR auto-collapsed via breakpoint */
  navCollapsed: boolean;
  /** Toggle manual nav collapse (persists in localStorage) */
  toggleNavCollapse: () => void;
  /** True if user has manually collapsed the nav */
  isManuallyCollapsed: boolean;
}

function getStoredCollapse(): boolean {
  try {
    return localStorage.getItem(NAV_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

export function useResponsiveLayout(): ResponsiveLayout {
  const [width, setWidth] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 1920
  );
  const [isManuallyCollapsed, setIsManuallyCollapsed] = useState(getStoredCollapse);

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const toggleNavCollapse = useCallback(() => {
    setIsManuallyCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(NAV_COLLAPSED_KEY, String(next));
      } catch { /* ignore */ }
      return next;
    });
  }, []);

  const tier = getTier(width);
  const collapseNav = tier === "md" || tier === "sm" || tier === "lg";
  const iconOnlyNav = false; // handled by collapseNav dropdown instead
  const navCollapsed = isManuallyCollapsed || collapseNav;
  const stackPanels = tier === "md" || tier === "sm";

  return {
    enabled: true,
    width,
    tier,
    isCompact: tier === "md" || tier === "sm",
    isNarrow: tier === "sm",
    stackPanels,
    collapseNav,
    iconOnlyNav,
    navCollapsed,
    toggleNavCollapse,
    isManuallyCollapsed,
  };
}
