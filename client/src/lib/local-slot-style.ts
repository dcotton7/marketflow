import { getLocalThemeSlot } from "@shared/theme-registry";
import type { CSSProperties } from "react";

/** Body surface — falls back to admin Secondary BG */
export function localSlotBgStyle(slotId: string, fallback = "var(--admin-secondary-bg)"): CSSProperties {
  const slot = getLocalThemeSlot(slotId);
  if (!slot) return { backgroundColor: fallback };
  return { backgroundColor: `var(${slot.cssVar}, ${fallback})` };
}

/** Header / sub-menu chrome — falls back to admin header BG */
export function localSlotHeaderStyle(slotId: string, fallback = "var(--admin-header-bg)"): CSSProperties {
  const slot = getLocalThemeSlot(slotId);
  if (!slot) return { backgroundColor: fallback };
  return { backgroundColor: `var(${slot.cssVar}, ${fallback})` };
}

/** Main page canvas fallback */
export function localSlotMainStyle(slotId: string): CSSProperties {
  return localSlotBgStyle(slotId, "var(--admin-main-bg)");
}
