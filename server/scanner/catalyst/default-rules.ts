// ---------------------------------------------------------------------------
// Default Catalyst Rules — seeded on first boot
// ---------------------------------------------------------------------------

import { getDb } from "../../db";
import { sql } from "drizzle-orm";
import type { CatalystRuleDefinition } from "@shared/catalyst-types";

export const DEFAULT_CATALYST_RULES: Omit<CatalystRuleDefinition, "createdAt" | "updatedAt">[] = [
  {
    id: "earnings_contrary",
    name: "Earnings Beat — Contrary Reaction",
    enabled: true,
    catalystType: "earnings_beat",
    description:
      "Stock drops or goes flat after a significant earnings beat. " +
      "Watch for delayed upside as the market digests the numbers.",
    windowDays: 20,
    decayShape: "slow",
    boostMultiplier: 1.5,
    minNewsSeverity: null,
    keywords: ["earnings", "eps", "revenue beat", "guidance raise"],
    contraryThresholdPct: 1.0,
    ownerId: null,
  },
  {
    id: "earnings_miss_hold",
    name: "Earnings Miss — Stock Held",
    enabled: true,
    catalystType: "earnings_miss",
    description:
      "Stock holds flat or goes up after an earnings miss. " +
      "Market may be looking past the miss — watch for continuation.",
    windowDays: 15,
    decayShape: "slow",
    boostMultiplier: 1.2,
    minNewsSeverity: null,
    keywords: ["earnings", "eps miss", "revenue miss", "guidance cut"],
    contraryThresholdPct: 1.0,
    ownerId: null,
  },
  {
    id: "gap_up_watch",
    name: "Gap Up — Continuation Watch",
    enabled: true,
    catalystType: "gap_up",
    description:
      "Stock gapped up >5% at open. Watch for follow-through " +
      "or a pullback-to-support entry over the next 20 days.",
    windowDays: 20,
    decayShape: "slow",
    boostMultiplier: 1.3,
    minNewsSeverity: null,
    keywords: [],
    contraryThresholdPct: 5.0,
    ownerId: null,
  },
  {
    id: "gap_down_bounce",
    name: "Gap Down — Bounce Watch",
    enabled: true,
    catalystType: "gap_down",
    description:
      "Stock gapped down >5%. Watch for mean reversion or " +
      "delayed selling if the gap was on bad fundamentals.",
    windowDays: 15,
    decayShape: "linear",
    boostMultiplier: 1.2,
    minNewsSeverity: null,
    keywords: [],
    contraryThresholdPct: 5.0,
    ownerId: null,
  },
  {
    id: "critical_news",
    name: "Critical News — No Reaction",
    enabled: true,
    catalystType: "news_keyword",
    description:
      "High-severity news (crash, fraud, FDA, sanctions, etc.) but " +
      "stock barely moved. The market hasn't priced it yet.",
    windowDays: 10,
    decayShape: "linear",
    boostMultiplier: 2.0,
    minNewsSeverity: 8,
    keywords: [
      "crash", "fraud", "recall", "fda", "sanctions", "bankruptcy",
      "sec investigation", "acquisition", "merger", "tariff",
    ],
    contraryThresholdPct: 1.5,
    ownerId: null,
  },
  {
    id: "government_policy",
    name: "Government Policy — Theme Catalyst",
    enabled: true,
    catalystType: "government_policy",
    description:
      "Government policy announcement affecting a sector or theme. " +
      "All theme members enter the catalyst queue.",
    windowDays: 15,
    decayShape: "step",
    boostMultiplier: 1.5,
    minNewsSeverity: 7,
    keywords: [
      "government", "policy", "executive order", "infrastructure",
      "subsidy", "investment", "tariff", "sanctions", "regulation",
      "trump", "biden", "congress", "legislation",
    ],
    contraryThresholdPct: 1.0,
    ownerId: null,
  },
  {
    id: "volume_anomaly",
    name: "Volume Anomaly — No News",
    enabled: true,
    catalystType: "volume_anomaly",
    description:
      "Unusual volume (>5x average) with no significant price move and " +
      "no visible news. Possible stealth accumulation/distribution.",
    windowDays: 5,
    decayShape: "fast",
    boostMultiplier: 1.0,
    minNewsSeverity: null,
    keywords: [],
    contraryThresholdPct: 1.0,
    ownerId: null,
  },
  {
    id: "analyst_action",
    name: "Analyst Upgrade/Downgrade — Delayed Move",
    enabled: true,
    catalystType: "analyst_upgrade",
    description:
      "Analyst action with muted initial reaction. Watch for " +
      "institutional repositioning in the following days.",
    windowDays: 7,
    decayShape: "fast",
    boostMultiplier: 1.0,
    minNewsSeverity: 6,
    keywords: ["upgrade", "downgrade", "price target", "initiate", "overweight", "underweight"],
    contraryThresholdPct: 0.5,
    ownerId: null,
  },
  {
    id: "fda_decision",
    name: "FDA Decision — Extended Watch",
    enabled: true,
    catalystType: "fda_decision",
    description:
      "FDA approval or rejection. Biotech/healthcare names often " +
      "see multi-day repositioning after major FDA events.",
    windowDays: 10,
    decayShape: "step",
    boostMultiplier: 1.8,
    minNewsSeverity: 8,
    keywords: ["fda", "approval", "reject", "pdufa", "clinical trial", "phase 3"],
    contraryThresholdPct: 2.0,
    ownerId: null,
  },
  {
    id: "contract_award",
    name: "Major Contract / Partnership",
    enabled: true,
    catalystType: "contract_award",
    description:
      "Significant contract win or strategic partnership. " +
      "Revenue impact may take days to be fully priced.",
    windowDays: 7,
    decayShape: "linear",
    boostMultiplier: 1.2,
    minNewsSeverity: 7,
    keywords: ["contract", "partnership", "deal", "agreement", "award", "selected"],
    contraryThresholdPct: 1.0,
    ownerId: null,
  },
];

export async function seedDefaultCatalystRules(): Promise<void> {
  const db = getDb();
  if (!db) return;

  try {
    for (const rule of DEFAULT_CATALYST_RULES) {
      const keywordsLiteral = `{${rule.keywords.map((k) => `"${k}"`).join(",")}}`;
      await db.execute(sql`
        INSERT INTO catalyst_rules
          (id, name, enabled, catalyst_type, description, window_days,
           decay_shape, boost_multiplier, min_news_severity, keywords,
           contrary_threshold_pct, owner_id)
        VALUES
          (${rule.id}, ${rule.name}, ${rule.enabled}, ${rule.catalystType},
           ${rule.description}, ${rule.windowDays}, ${rule.decayShape},
           ${rule.boostMultiplier}, ${rule.minNewsSeverity ?? null},
           ${keywordsLiteral}::text[],
           ${rule.contraryThresholdPct}, ${rule.ownerId ?? null})
        ON CONFLICT (id) DO NOTHING
      `);
    }
    console.log(`[Catalyst] Seeded ${DEFAULT_CATALYST_RULES.length} default rules`);
  } catch (err) {
    console.warn("[Catalyst] Failed to seed rules (table may not exist):", err);
  }
}
