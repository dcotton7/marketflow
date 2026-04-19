/**
 * Product tier → app capabilities (admin UI + future /api/auth/me).
 * Admin flag on user still gates /sentinel/admin and Patterns-style tools.
 */

export const SENTINEL_ACCESS_TIERS = [
  "free",
  "standard",
  "professional",
  "pro_plus",
] as const;

export type SentinelAccessTier = (typeof SENTINEL_ACCESS_TIERS)[number];

export type SentinelFeatureKey =
  | "start"
  | "bigIdea"
  | "flow"
  | "charts"
  | "watchlists"
  | "askIvy"
  | "import"
  | "patterns"
  | "admin";

export interface TierFeatureRow {
  start: boolean;
  bigIdea: boolean;
  flow: boolean;
  charts: boolean;
  watchlists: boolean;
  askIvy: boolean;
  import: boolean;
  patterns: boolean;
  admin: boolean;
  /** null = unlimited */
  maxAlerts: number | null;
}

export const TIER_FEATURE_MATRIX: Record<SentinelAccessTier, TierFeatureRow> = {
  free: {
    start: true,
    bigIdea: false,
    flow: false,
    charts: false,
    watchlists: false,
    askIvy: false,
    import: false,
    patterns: false,
    admin: false,
    maxAlerts: 0,
  },
  standard: {
    start: false,
    bigIdea: false,
    flow: true,
    charts: true,
    watchlists: true,
    askIvy: false,
    import: false,
    patterns: false,
    admin: false,
    maxAlerts: 5,
  },
  professional: {
    start: true,
    bigIdea: false,
    flow: true,
    charts: true,
    watchlists: true,
    askIvy: false,
    import: false,
    patterns: false,
    admin: false,
    maxAlerts: 30,
  },
  pro_plus: {
    start: true,
    bigIdea: true,
    flow: true,
    charts: true,
    watchlists: true,
    askIvy: true,
    import: true,
    patterns: false,
    admin: false,
    maxAlerts: null,
  },
};

const LEGACY_TIER_MAP: Record<string, SentinelAccessTier> = {
  free: "free",
  standard: "standard",
  professional: "professional",
  pro_plus: "pro_plus",
  premium: "professional",
  pro: "pro_plus",
};

export function normalizeSentinelTier(raw: string | null | undefined): SentinelAccessTier {
  const k = (raw || "free").toLowerCase().trim();
  if ((SENTINEL_ACCESS_TIERS as readonly string[]).includes(k)) {
    return k as SentinelAccessTier;
  }
  return LEGACY_TIER_MAP[k] ?? "free";
}

export function tierFeatureRow(tier: SentinelAccessTier): TierFeatureRow {
  return TIER_FEATURE_MATRIX[tier];
}

/** Admin-edited defaults layered on top of `TIER_FEATURE_MATRIX` for each tier. */
export type TierAccessOverrides = Partial<
  Record<SentinelAccessTier, { features: TierFeatureRow; tokensAllowed: number | null }>
>;

export function cloneTierFeatureRow(row: TierFeatureRow): TierFeatureRow {
  return { ...row };
}

/** Feature row for a tier after applying optional admin overrides. */
export function tierFeaturesForRole(
  tier: SentinelAccessTier,
  overrides: TierAccessOverrides | null | undefined
): TierFeatureRow {
  const o = overrides?.[tier]?.features;
  if (o) return cloneTierFeatureRow(o);
  return cloneTierFeatureRow(tierFeatureRow(tier));
}

/** Token cap for tier (`null` = unlimited). */
export function tierTokensForRole(
  tier: SentinelAccessTier,
  overrides: TierAccessOverrides | null | undefined
): number | null {
  const entry = overrides?.[tier];
  if (entry && Object.prototype.hasOwnProperty.call(entry, "tokensAllowed")) {
    return entry.tokensAllowed;
  }
  return tierTokenAllowance(tier).tokensAllowed;
}

export function tierRoleBundleEquals(
  a: TierFeatureRow,
  tokensA: number | null,
  b: TierFeatureRow,
  tokensB: number | null
): boolean {
  for (const k of FEATURE_ORDER) {
    if (a[k] !== b[k]) return false;
  }
  if (a.maxAlerts !== b.maxAlerts) return false;
  if (tokensA !== tokensB) return false;
  return true;
}

/** Token metering placeholder: unlimited for all tiers until billing/metering ships. */
export function tierTokenAllowance(_tier: SentinelAccessTier): {
  tokensAllowed: number | null;
  tokensUsed: number;
} {
  return { tokensAllowed: null, tokensUsed: 0 };
}

export const FEATURE_LABELS: Record<SentinelFeatureKey, string> = {
  start: "Start (workspace)",
  bigIdea: "Big Idea",
  flow: "Flow",
  charts: "Charts",
  watchlists: "Watchlists",
  askIvy: "Ask Ivy",
  import: "Import",
  patterns: "Patterns",
  admin: "Admin",
};

export const FEATURE_ORDER: SentinelFeatureKey[] = [
  "start",
  "bigIdea",
  "flow",
  "charts",
  "watchlists",
  "askIvy",
  "import",
  "patterns",
  "admin",
];

export function effectiveTierCaps(
  tier: SentinelAccessTier,
  isAdmin: boolean,
  overrides?: TierAccessOverrides | null
): {
  features: TierFeatureRow;
  tokensAllowed: number | null;
  tokensUsed: number;
} {
  const tokensUsed = tierTokenAllowance(tier).tokensUsed;
  const tokensAllowed = tierTokensForRole(tier, overrides);
  if (isAdmin) {
    return {
      features: {
        start: true,
        bigIdea: true,
        flow: true,
        charts: true,
        watchlists: true,
        askIvy: true,
        import: true,
        patterns: true,
        admin: true,
        maxAlerts: null,
      },
      tokensAllowed,
      tokensUsed,
    };
  }
  return {
    features: tierFeaturesForRole(tier, overrides),
    tokensAllowed,
    tokensUsed,
  };
}
