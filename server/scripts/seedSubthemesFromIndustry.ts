#!/usr/bin/env tsx
import "dotenv/config";
import { and, asc, eq, gte, isNotNull, isNull } from "drizzle-orm";
import { initializeDatabase, db } from "../db";
import { subthemes, themes, tickers, tickerSliceMemberships } from "@shared/schema";

type ThemeRow = { id: string; name: string };
type TickerRow = {
  symbol: string;
  isCore: boolean | null;
  industry: string | null;
  marketCap: number | null;
};

const MIN_MEMBERS_PER_SUBTHEME = 3;
const MAX_SUBTHEMES_PER_THEME = 4;
const MIN_SUBTHEME_MARKET_CAP = 500_000_000;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function normalizeIndustry(industry: string | null): string {
  const raw = (industry ?? "").trim();
  if (!raw || raw.toLowerCase() === "unknown") return "General";
  return raw.replace(/\s+/g, " ").trim();
}

async function ensureThemeLevelMembership(symbol: string, themeId: string) {
  if (!db) return;
  const existing = await db
    .select({ id: tickerSliceMemberships.id })
    .from(tickerSliceMemberships)
    .where(
      and(
        eq(tickerSliceMemberships.symbol, symbol),
        eq(tickerSliceMemberships.themeId, themeId),
        isNull(tickerSliceMemberships.subthemeId)
      )
    )
    .limit(1);

  if (existing.length > 0) return;

  await db.insert(tickerSliceMemberships).values({
    symbol,
    themeId,
    subthemeId: null,
    isAnchor: false,
    isLeaderEligible: true,
    isDefaultVisible: true,
    source: "industry-seed",
    updatedAt: new Date(),
  });
}

async function seed() {
  if (!db) {
    console.error("[seedSubthemesFromIndustry] Database unavailable");
    process.exit(1);
  }

  const dryRun = process.argv.includes("--dry-run");
  const includeExistingThemes = process.argv.includes("--include-existing");

  const themeRows: ThemeRow[] = await db
    .select({ id: themes.id, name: themes.name })
    .from(themes)
    .orderBy(asc(themes.id));

  let themesProcessed = 0;
  let subthemesUpserted = 0;
  let membershipsUpserted = 0;

  for (const theme of themeRows) {
    const existingCount = await db
      .select({ id: subthemes.id })
      .from(subthemes)
      .where(and(eq(subthemes.themeId, theme.id), eq(subthemes.isActive, true)));

    if (!includeExistingThemes && existingCount.length > 0) {
      continue;
    }

    const members: TickerRow[] = await db
      .select({
        symbol: tickers.symbol,
        isCore: tickers.isCore,
        industry: tickers.industry,
        marketCap: tickers.marketCap,
      })
      .from(tickers)
      .where(
        and(
          eq(tickers.themeId, theme.id),
          isNotNull(tickers.symbol),
          isNotNull(tickers.marketCap),
          gte(tickers.marketCap, MIN_SUBTHEME_MARKET_CAP)
        )
      )
      .orderBy(asc(tickers.symbol));

    if (members.length < MIN_MEMBERS_PER_SUBTHEME) continue;

    const grouped = new Map<string, TickerRow[]>();
    for (const row of members) {
      const bucket = normalizeIndustry(row.industry);
      if (!grouped.has(bucket)) grouped.set(bucket, []);
      grouped.get(bucket)!.push(row);
    }

    const eligible = Array.from(grouped.entries())
      .filter(([, rows]) => rows.length >= MIN_MEMBERS_PER_SUBTHEME)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, MAX_SUBTHEMES_PER_THEME);

    const finalGroups =
      eligible.length > 0
        ? eligible
        : [["General", members]];

    if (finalGroups.length === 0) continue;
    themesProcessed += 1;

    for (let g = 0; g < finalGroups.length; g += 1) {
      const [industryName, rows] = finalGroups[g]!;
      const prettyName = industryName.length > 36 ? `${industryName.slice(0, 33)}...` : industryName;
      const subthemeId = `${theme.id}_${slugify(prettyName) || `group_${g + 1}`}`.slice(0, 63);

      if (!dryRun) {
        await db
          .insert(subthemes)
          .values({
            id: subthemeId,
            themeId: theme.id,
            name: prettyName,
            description: `Auto-seeded from industry grouping (${rows.length} members).`,
            sortOrder: (g + 1) * 10,
            isActive: true,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: subthemes.id,
            set: {
              themeId: theme.id,
              name: prettyName,
              description: `Auto-seeded from industry grouping (${rows.length} members).`,
              sortOrder: (g + 1) * 10,
              isActive: true,
              updatedAt: new Date(),
            },
          });
      }
      subthemesUpserted += 1;

      const ranked = [...rows].sort((a, b) => Number(!!b.isCore) - Number(!!a.isCore));
      for (let i = 0; i < ranked.length; i += 1) {
        const symbol = ranked[i]!.symbol.trim().toUpperCase();
        const isLeaderEligible = i < 5 || !!ranked[i]!.isCore;

        if (!dryRun) {
          await db
            .insert(tickerSliceMemberships)
            .values({
              symbol,
              themeId: theme.id,
              subthemeId,
              isAnchor: i === 0,
              isLeaderEligible,
              isDefaultVisible: true,
              source: "industry-seed",
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
                isLeaderEligible,
                isDefaultVisible: true,
                source: "industry-seed",
                updatedAt: new Date(),
              },
            });

          await ensureThemeLevelMembership(symbol, theme.id);
        }
        membershipsUpserted += 1;
      }
    }
  }

  console.log(
    `[seedSubthemesFromIndustry] ${dryRun ? "Dry run" : "Completed"}: processed ${themesProcessed} themes, upserted ${subthemesUpserted} subthemes, upserted ${membershipsUpserted} memberships`
  );
}

(async () => {
  await initializeDatabase();
  await seed();
  process.exit(0);
})();
