#!/usr/bin/env tsx
/**
 * Add a ticker to a theme in the database (no UI, no re-add needed)
 * Use when a ticker was added via UI but didn't persist (e.g. before persistence was implemented)
 *
 * Usage:
 *   npx tsx server/scripts/addTickerToTheme.ts SOLS MATERIALS_METALS
 *   npx tsx server/scripts/addTickerToTheme.ts <SYMBOL> <THEME_ID>
 */
import "dotenv/config";
import { initializeDatabase, db } from "../db";
import { tickers, themes } from "@shared/schema";
import { eq } from "drizzle-orm";
import { CLUSTERS } from "../market-condition/universe";
import { refreshThemeMembersCache } from "../market-condition/utils/theme-db-loader";

async function addTickerToTheme(symbol: string, themeId: string) {
  if (!db) {
    console.error("Database not available");
    process.exit(1);
  }

  const sym = symbol.trim().toUpperCase();
  const cluster = CLUSTERS.find((c) => c.id === themeId);
  if (!cluster) {
    console.error(`Invalid theme ID: ${themeId}. Use one of: ${CLUSTERS.map((c) => c.id).join(", ")}`);
    process.exit(1);
  }

  console.log(`[AddTickerToTheme] Adding ${sym} to ${themeId} (${cluster.name})...`);

  try {
    // Ensure theme exists
    await db
      .insert(themes)
      .values({
        id: cluster.id,
        name: cluster.name,
        tier: cluster.tier,
        leadersTarget: cluster.leadersTarget,
        notes: cluster.notes,
        etfProxies: cluster.etfProxies,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: themes.id,
        set: { name: cluster.name, tier: cluster.tier, updatedAt: new Date() },
      });

    const existing = await db.select({ symbol: tickers.symbol }).from(tickers).where(eq(tickers.symbol, sym)).limit(1);

    if (existing.length > 0) {
      await db.update(tickers).set({ themeId: themeId, isCore: false }).where(eq(tickers.symbol, sym));
      console.log(`  ✓ Updated ${sym} theme to ${themeId}`);
    } else {
      await db
        .insert(tickers)
        .values({
          symbol: sym,
          sector: "Unknown",
          industry: "Unknown",
          themeId: themeId,
          isCore: false,
          fetchedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: tickers.symbol,
          set: { themeId: themeId, isCore: false },
        });
      console.log(`  ✓ Inserted/updated ${sym} in tickers, assigned to ${themeId}`);
    }

    // Add to runtime CLUSTERS so it shows immediately
    if (!cluster.candidates.includes(sym) && !cluster.core.includes(sym)) {
      cluster.candidates.push(sym);
      console.log(`  ✓ Added ${sym} to in-memory CLUSTERS`);
    }

    await refreshThemeMembersCache();
    console.log(`  ✓ Refreshed theme members cache`);
    console.log(`\n[AddTickerToTheme] Done. ${sym} is now in ${themeId}. Restart the server or refresh the page to see it.`);
  } catch (error) {
    console.error("Failed:", error);
    process.exit(1);
  }
}

(async () => {
  await initializeDatabase();
  const symbol = process.argv[2] || "SOLS";
  const themeId = process.argv[3] || "MATERIALS_METALS";
  await addTickerToTheme(symbol, themeId);
  process.exit(0);
})();
