/**
 * Theme Review naming — one product, two session briefs.
 * Internal API modes stay "pre" | "post"; these are display labels only.
 */

export type ThemeReviewMode = "pre" | "post";

export const THEME_REVIEW_PRODUCT = "Theme Review";

export function themeReviewSessionLabel(mode: ThemeReviewMode): string {
  return mode === "pre" ? "Open Brief" : "Close Brief";
}

export function themeReviewTitle(mode: ThemeReviewMode): string {
  return `${THEME_REVIEW_PRODUCT} · ${themeReviewSessionLabel(mode)}`;
}

export function themeReviewTitleDash(mode: ThemeReviewMode): string {
  return `${THEME_REVIEW_PRODUCT} — ${themeReviewSessionLabel(mode)}`;
}
