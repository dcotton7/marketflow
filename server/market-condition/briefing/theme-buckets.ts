import type { ClusterId } from "../universe";

/** Theme groupings for rotation inference — not mutually exclusive for overlays. */
export const THEME_BUCKETS: Record<string, ClusterId[]> = {
  defensive: ["CONSUMER_STAPLES", "HEALTHCARE"],
  growth: ["SEMIS", "AI_INFRA", "ENTERPRISE_SOFT", "CYBER", "QUANTUM", "STORAGE"],
  cyclical: [
    "INDUSTRIAL_INFRA",
    "TRANSPORTS",
    "MATERIALS_METALS",
    "HOMEBUILDERS",
    "ENERGY",
    "HOSPITALITY_LEISURE",
  ],
  risk_off_haven: ["PRECIOUS_METALS", "DEFENSE"],
  speculative: ["CRYPTO_EQ", "BIOTECH", "SOLAR", "NUCLEAR_URANIUM", "SPACE_FRONTIER"],
  rate_sensitive: ["FINANCIAL_CORE", "DATA_CENTER_REITS", "PAYMENTS_FINTECH"],
  consumer: ["CONSUMER_DISC", "GAMING_CASINOS"],
};

export function bucketForTheme(themeId: ClusterId): string[] {
  const buckets: string[] = [];
  for (const [name, ids] of Object.entries(THEME_BUCKETS)) {
    if (ids.includes(themeId)) buckets.push(name);
  }
  return buckets.length ? buckets : ["other"];
}
