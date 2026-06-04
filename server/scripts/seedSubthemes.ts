#!/usr/bin/env tsx
import "dotenv/config";
import { and, eq, isNull } from "drizzle-orm";
import { initializeDatabase, db } from "../db";
import { themes, tickers, subthemes, tickerSliceMemberships } from "@shared/schema";

type SubthemeSeed = {
  id: string;
  themeId: string;
  name: string;
  description: string;
  sortOrder: number;
  symbols: string[];
};

const SUBTHEME_SEEDS: SubthemeSeed[] = [
  {
    id: "DEFENSE_DRONES",
    themeId: "DEFENSE",
    name: "Drones",
    description: "Uncrewed systems, autonomy, and drone-defense exposure.",
    sortOrder: 10,
    symbols: ["AVAV", "KTOS", "LHX", "NOC", "RTX"],
  },
  {
    id: "DEFENSE_PRIMES",
    themeId: "DEFENSE",
    name: "Defense Primes",
    description: "Large prime contractors with broad platform exposure.",
    sortOrder: 20,
    symbols: ["LMT", "NOC", "GD", "RTX", "LHX"],
  },
  {
    id: "MATERIALS_CHEMICALS",
    themeId: "MATERIALS_METALS",
    name: "Chemicals",
    description: "Diversified chemical producers and specialty chemicals.",
    sortOrder: 10,
    symbols: ["DD", "DOW", "LIN", "APD", "ECL"],
  },
  {
    id: "MATERIALS_STEEL",
    themeId: "MATERIALS_METALS",
    name: "Steel",
    description: "Integrated steel producers and mini-mills.",
    sortOrder: 20,
    symbols: ["NUE", "STLD", "X", "CLF", "CMC"],
  },
  {
    id: "SEMIS_MEMORY",
    themeId: "SEMIS",
    name: "Memory",
    description: "DRAM/NAND and memory-adjacent names. Chart ETF: DRAM (Roundhill Memory ETF).",
    sortOrder: 10,
    symbols: ["MU", "WDC", "SNDK", "SIMO"],
  },
  {
    id: "SEMIS_FABLESS_AI",
    themeId: "SEMIS",
    name: "Fabless AI",
    description: "AI compute and accelerator-heavy fabless designers.",
    sortOrder: 20,
    symbols: ["NVDA", "AMD", "AVGO", "MRVL", "QCOM"],
  },
];

async function ensureThemeExists(themeId: string) {
  if (!db) return;
  const existing = await db.select({ id: themes.id }).from(themes).where(eq(themes.id, themeId)).limit(1);
  if (existing.length > 0) return;
  await db.insert(themes).values({
    id: themeId,
    name: themeId,
    tier: "Structural",
    updatedAt: new Date(),
  });
}

async function seedSubthemes() {
  if (!db) {
    console.error("[seedSubthemes] Database not available");
    process.exit(1);
  }

  let createdSubthemes = 0;
  let membershipsUpserted = 0;
  let symbolsSkipped = 0;

  for (const seed of SUBTHEME_SEEDS) {
    await ensureThemeExists(seed.themeId);

    await db
      .insert(subthemes)
      .values({
        id: seed.id,
        themeId: seed.themeId,
        name: seed.name,
        description: seed.description,
        sortOrder: seed.sortOrder,
        isActive: true,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: subthemes.id,
        set: {
          themeId: seed.themeId,
          name: seed.name,
          description: seed.description,
          sortOrder: seed.sortOrder,
          isActive: true,
          updatedAt: new Date(),
        },
      });
    createdSubthemes += 1;

    for (let i = 0; i < seed.symbols.length; i += 1) {
      const symbol = seed.symbols[i]!.trim().toUpperCase();
      const tickerExists = await db
        .select({ symbol: tickers.symbol })
        .from(tickers)
        .where(eq(tickers.symbol, symbol))
        .limit(1);

      if (tickerExists.length === 0) {
        symbolsSkipped += 1;
        continue;
      }

      await db
        .insert(tickerSliceMemberships)
        .values({
          symbol,
          themeId: seed.themeId,
          subthemeId: seed.id,
          isAnchor: i === 0,
          isLeaderEligible: i < 3,
          isDefaultVisible: true,
          source: "seed",
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            tickerSliceMemberships.symbol,
            tickerSliceMemberships.themeId,
            tickerSliceMemberships.subthemeId,
          ],
          set: {
            isAnchor: i === 0,
            isLeaderEligible: i < 3,
            isDefaultVisible: true,
            source: "seed",
            updatedAt: new Date(),
          },
        });

      membershipsUpserted += 1;

      await db
        .insert(tickerSliceMemberships)
        .values({
          symbol,
          themeId: seed.themeId,
          subthemeId: null,
          isAnchor: i === 0,
          isLeaderEligible: i < 3,
          isDefaultVisible: true,
          source: "seed",
          updatedAt: new Date(),
        })
        .onConflictDoNothing();
    }
  }

  await db
    .delete(tickerSliceMemberships)
    .where(and(isNull(tickerSliceMemberships.themeId), isNull(tickerSliceMemberships.subthemeId)));

  console.log(`[seedSubthemes] Upserted ${createdSubthemes} subthemes`);
  console.log(`[seedSubthemes] Upserted ${membershipsUpserted} subtheme memberships`);
  if (symbolsSkipped > 0) {
    console.log(`[seedSubthemes] Skipped ${symbolsSkipped} symbols missing from tickers table`);
  }
}

(async () => {
  await initializeDatabase();
  await seedSubthemes();
  process.exit(0);
})();
