import { fetchGeneralNews, type FinnhubNewsArticle } from "../../finnhub";
import type { CatalystConfidence } from "./types";

export type MacroNewsCategory =
  | "presidential"
  | "geopolitical"
  | "economic"
  | "defense"
  | "general";

export interface CategorizedNewsItem {
  headline: string;
  summary: string;
  category: MacroNewsCategory;
  source: string;
  datetime: number;
  url: string;
  relevanceScore: number;
}

const CATEGORY_KEYWORDS: Record<Exclude<MacroNewsCategory, "general">, RegExp[]> = {
  presidential: [
    /\btrump\b/i,
    /\bbiden\b/i,
    /\bwhite house\b/i,
    /\bpresident\b/i,
    /\bexecutive order\b/i,
    /\btariff/i,
    /\badministration\b/i,
    /\bcongress\b/i,
    /\bsenate\b/i,
    /\bhouse of representatives\b/i,
    /\belection\b/i,
    /\bpolicymaker/i,
  ],
  geopolitical: [
    /\bukraine\b/i,
    /\brussia\b/i,
    /\bchina\b/i,
    /\btaiwan\b/i,
    /\bisrael\b/i,
    /\bgaza\b/i,
    /\biran\b/i,
    /\bnato\b/i,
    /\bwar\b/i,
    /\bconflict\b/i,
    /\binvasion\b/i,
    /\bgeopolit/i,
    /\bmiddle east\b/i,
    /\bnorth korea\b/i,
    /\bsanctions\b/i,
    /\bmissile\b/i,
    /\bceasefire\b/i,
  ],
  economic: [
    /\bfed\b/i,
    /\bfomc\b/i,
    /\binflation\b/i,
    /\bcpi\b/i,
    /\bppi\b/i,
    /\bjobs report\b/i,
    /\bunemployment\b/i,
    /\bnonfarm\b/i,
    /\bgdp\b/i,
    /\brate cut\b/i,
    /\brate hike\b/i,
    /\brecession\b/i,
    /\btreasury\b/i,
    /\byield\b/i,
    /\bearnings\b/i,
    /\bretail sales\b/i,
    /\bpmi\b/i,
    /\binterest rate/i,
    /\bpowell\b/i,
    /\bbeige book\b/i,
    /\bdebt ceiling\b/i,
  ],
  defense: [
    /\bdefense spending\b/i,
    /\bpentagon\b/i,
    /\bmilitary\b/i,
    /\bweapon/i,
    /\bdefence\b/i,
    /\bdefense contract/i,
    /\barmament/i,
    /\braytheon\b/i,
    /\blockheed\b/i,
    /\bnorthrop\b/i,
    /\bdefense sector\b/i,
  ],
};

function scoreText(text: string, patterns: RegExp[]): number {
  let score = 0;
  for (const re of patterns) {
    if (re.test(text)) score += 1;
  }
  return score;
}

export function categorizeArticle(article: FinnhubNewsArticle): CategorizedNewsItem | null {
  const text = `${article.headline} ${article.summary || ""}`;
  if (!article.headline?.trim()) return null;

  const scores: Record<Exclude<MacroNewsCategory, "general">, number> = {
    presidential: scoreText(text, CATEGORY_KEYWORDS.presidential),
    geopolitical: scoreText(text, CATEGORY_KEYWORDS.geopolitical),
    economic: scoreText(text, CATEGORY_KEYWORDS.economic),
    defense: scoreText(text, CATEGORY_KEYWORDS.defense),
  };

  const maxScore = Math.max(...Object.values(scores));
  const category: MacroNewsCategory =
    maxScore === 0
      ? "general"
      : (Object.entries(scores).find(([, s]) => s === maxScore)?.[0] as MacroNewsCategory);

  const relevanceScore =
    maxScore +
    (category === "geopolitical" || category === "economic" ? 1 : 0) +
    (text.match(/\bmarket\b|\bstock\b|\bsp500\b|\bs&p\b/i) ? 1 : 0);

  return {
    headline: article.headline.slice(0, 220),
    summary: (article.summary || "").slice(0, 400),
    category,
    source: article.source || "Finnhub",
    datetime: article.datetime,
    url: article.url || "",
    relevanceScore,
  };
}

export async function fetchCategorizedMacroNews(limit = 24): Promise<CategorizedNewsItem[]> {
  try {
    const raw = await Promise.race([
      fetchGeneralNews(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("macro news timeout")), 12_000)
      ),
    ]).catch(() => [] as Awaited<ReturnType<typeof fetchGeneralNews>>);

    const categorized = raw
      .map(categorizeArticle)
      .filter((x): x is CategorizedNewsItem => x !== null)
      .sort((a, b) => b.relevanceScore - a.relevanceScore || b.datetime - a.datetime);

    const seen = new Set<string>();
    const deduped: CategorizedNewsItem[] = [];
    for (const item of categorized) {
      const key = item.headline.slice(0, 80).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(item);
      if (deduped.length >= limit) break;
    }
    return deduped;
  } catch {
    return [];
  }
}

export function macroNewsByCategory(
  items: CategorizedNewsItem[]
): Record<MacroNewsCategory, CategorizedNewsItem[]> {
  const out: Record<MacroNewsCategory, CategorizedNewsItem[]> = {
    presidential: [],
    geopolitical: [],
    economic: [],
    defense: [],
    general: [],
  };
  for (const item of items) {
    out[item.category].push(item);
  }
  return out;
}

export function macroLinkConfidence(
  marketDirection: string,
  category: MacroNewsCategory
): CatalystConfidence {
  if (marketDirection === "risk_off" && (category === "geopolitical" || category === "defense")) {
    return "medium";
  }
  if (marketDirection === "risk_off" && category === "economic") return "medium";
  if (marketDirection === "risk_on" && category === "economic") return "low";
  if (category === "presidential") return "speculative";
  return "low";
}
