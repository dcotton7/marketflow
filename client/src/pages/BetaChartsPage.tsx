import { Redirect } from "wouter";

/**
 * Former “Beta Charts” surface is merged into `/sentinel/charts` (ETH, MA RTH/EXT, shared caching).
 * This route remains for bookmarks and old links.
 */
export default function BetaChartsPage() {
  return <Redirect to="/sentinel/charts" />;
}
