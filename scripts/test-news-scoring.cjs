require("dotenv").config();
const FINNHUB_KEY = (process.env.FINNHUB_API_KEY || "").replace(/['"]/g, "").trim();

const NEWS_SEVERITY_TIERS = {
  10: ["crash", "explosion", "fraud", "recall", "bankruptcy", "sec investigation", "default"],
  9: ["fda reject", "sanctions", "war", "indictment", "delisted"],
  8: ["earnings", "acquisition", "merger", "guidance raise", "guidance cut", "fda approval", "tariff", "layoffs", "revenue beat", "revenue miss", "eps beat", "eps miss"],
  7: ["contract", "partnership", "stock split", "buyback", "government policy", "rate decision"],
  6: ["upgrade", "downgrade", "analyst", "cfo", "ceo", "executive", "overweight", "underweight", "outperform", "underperform"],
  5: ["partnership", "expansion", "new product", "price target", "raises", "lowers", "initiates", "reiterates"],
  4: ["hire", "coo", "board", "share offering", "maintains", "keeps"],
  3: ["conference", "presentation", "filing", "market", "sector", "industry", "trade", "tariff", "regulation"],
  2: ["dividend", "routine"],
  1: ["mention", "coverage"],
};

function scoreHeadlineSeverity(headline) {
  const lower = headline.toLowerCase();
  for (let score = 10; score >= 1; score--) {
    const keywords = NEWS_SEVERITY_TIERS[score];
    if (keywords && keywords.some(kw => lower.includes(kw))) return score;
  }
  return 1;
}

async function main() {
  const symbols = ["AAPL", "TSLA", "NVDA", "MSFT", "AMZN", "META", "GOOGL", "AMD"];
  const d = new Date().toISOString().slice(0, 10);
  let totalHeadlines = 0;
  let scored3plus = 0;
  let scored5plus = 0;
  const examples = [];

  for (const sym of symbols) {
    const url = `https://finnhub.io/api/v1/company-news?symbol=${sym}&from=${d}&to=${d}&token=${FINNHUB_KEY}`;
    const res = await fetch(url);
    if (!res.ok) continue;
    const data = await res.json();
    for (const item of data.slice(0, 10)) {
      const hl = item.headline || "";
      const score = scoreHeadlineSeverity(hl);
      totalHeadlines++;
      if (score >= 3) scored3plus++;
      if (score >= 5) scored5plus++;
      examples.push({ sym, score, hl: hl.slice(0, 100) });
    }
    await new Promise(r => setTimeout(r, 200));
  }

  examples.sort((a, b) => b.score - a.score);
  console.log(`Total headlines: ${totalHeadlines}`);
  console.log(`Would fire (>= 3): ${scored3plus} (${Math.round(scored3plus/totalHeadlines*100)}%)`);
  console.log(`High severity (>= 5): ${scored5plus}`);
  console.log(`\nAll scoring >= 3:`);
  examples.filter(e => e.score >= 3).forEach(e => console.log(`  [${e.score}] ${e.sym}: ${e.hl}`));
}
main();
