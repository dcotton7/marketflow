/**
 * Theme Review naming — display labels for pre/post briefing modes.
 * Internal API modes stay "pre" | "post".
 */

import type { BriefingMode } from "./types";

export const THEME_REVIEW_PRODUCT = "Theme Review";

export function themeReviewSessionLabel(mode: BriefingMode): string {
  return mode === "pre" ? "Open Brief" : "Close Brief";
}

export function themeReviewTitle(mode: BriefingMode): string {
  return `${THEME_REVIEW_PRODUCT} · ${themeReviewSessionLabel(mode)}`;
}
