/**
 * Discord room analysis — tickers mentioned, long/short lean, and watched-trader trade calls,
 * computed from the in-memory Discord Watch buffer. Pure text heuristics; nothing stored.
 */

import { getConstituentsSync } from "../universe/constituents";
import { getAllUniverseTickers } from "../market-condition/universe";

export type Side = "long" | "short" | "neutral";

/** Channels where staff post their own entries / exits (Ari: long + short ideas; Nick: his channel). */
export const TRADE_CHANNELS = ["live-long-ideas", "live-short-ideas", "nick-drendel"];
export type TradeAction = "buy" | "add" | "trim" | "sell" | "short" | "cover" | "stop" | "watch";

export interface AnalyzableMessage {
  seq: number;
  id: string;
  author: string;
  channel: string;
  source: "chat" | "toast";
  time: string;
  ts: number;
  text: string;
  replyTo: string;
}

export interface MessageTags {
  tickers: string[];
  side: Side;
  action: TradeAction | null;
}

/** Words that are valid symbols but are ordinary words / trading slang in this room. */
const STOP_UPPER = new Set([
  "A", "I", "AI", "ALL", "AM", "AN", "ANY", "ARE", "AT", "ATH", "ATR", "BE", "BIG", "BUY", "BY", "CAN", "CEO", "CFO", "CPI",
  "DD", "DO", "EMA", "EOD", "EPS", "ETF", "EU", "FOMC", "FOR", "GDP", "GO", "GOOD", "HAS", "HE", "HOD", "HOLD", "IF", "IMO",
  "IN", "IPO", "IS", "IT", "ITS", "JUST", "LOD", "LOL", "LOW", "MA", "ME", "MY", "NEW", "NO", "NOW", "OF", "OK", "ON", "ONE",
  "OR", "OUT", "PM", "PE", "PT", "RE", "RSI", "RS", "SEC", "SMA", "SO", "TA", "THE", "TO", "UK", "UP", "US", "USA", "VWAP",
  "WE", "WSB", "YOU", "YTD", "ATM", "OTM", "ITM", "IV", "DTE", "PR", "QQQS", "EV", "AH", "OG", "FYI", "TBH", "IRL", "LFG",
  "ARE", "BRO", "PLAY", "REAL", "LIVE", "LOVE", "WELL", "NICE", "HOPE", "NEXT", "OPEN", "FAST", "RUN", "SEE", "KEY", "DAY",
  "CASH", "LIFE", "TRUE", "PLUS", "HOME", "CAR", "PAY", "WIN", "FUN", "WAY", "BEST", "EAT", "FIVE", "ROCK", "STAR", "TEN",
  "FREE", "SAFE", "GOLD", "CORE", "MAIN", "BOX", "TECH", "PRO", "FIX", "SAVE", "EDIT", "WOLF", "TREE", "DOOR", "RAIL",
  "POST", "ROLL", "HEAR", "DOG", "CAT", "MAN", "HUGE", "ELSE", "MOVE", "CALM", "COOL", "HOOK", "LUV", "PEAK", "WASH", "AGO",
  "VS", "PDT", "ADD", "AIR", "TV", "PC", "DM", "HR", "BIT", "MOD", "AWAY", "FAT", "OLD", "LEG", "GAP", "FL", "FN",
  "WOW", "HI", "HEY", "OMG", "LMAO", "WTF", "YES", "YEP", "NOPE", "THX", "TY", "GG", "GL", "NICK", "ARI", "PW", "MPLX",
  "AMA", "BTW", "IDK", "NGL", "RIP", "BOOM", "BRB", "DCA", "HODL", "FOMO", "FUD", "ER", "QE", "FED", "PPI", "NFP",
  "CEO", "COO", "CTO", "ATL", "EOW", "EOM", "TBD", "ETA", "MTD", "QTD", "HOLY", "DAMN", "SURE", "LETS", "VERY", "MUCH",
  "MORE", "LESS", "WAIT", "LOOK", "WHAT", "WHEN", "THIS", "THAT", "WITH", "FROM", "BEEN", "HAVE", "WILL", "INTO", "OVER",
]);

/** Valid symbols that are ordinary words when typed in lowercase ("app", "net", "now"). */
const STOP_LOWER = new Set([
  "all", "app", "are", "net", "now", "see", "can", "has", "was", "job", "out", "one", "two", "big", "new", "old", "low", "day",
  "way", "key", "run", "fun", "win", "pay", "car", "cash", "good", "love", "well", "real", "live", "play", "open", "next",
  "hope", "fast", "life", "true", "plus", "home", "best", "free", "safe", "gold", "core", "main", "tech", "save", "snow",
  "wolf", "tree", "door", "rail", "post", "roll", "hear", "huge", "else", "move", "calm", "cool", "hook", "peak", "wash",
  "nice", "bro", "form", "film", "ever", "once", "bear", "bull", "them", "then", "that", "this", "what", "when", "here",
  "they", "get", "got", "man", "guy", "guys", "sun", "fly", "fat", "hot", "ride", "rise", "told", "info", "near", "most",
  "much", "very", "sell", "buy", "hold", "long", "call", "beat", "miss", "edge", "hit", "top", "tops", "base", "line",
  "five", "rock", "star", "ten", "eat", "box", "pro", "fix", "edit", "dog", "cat", "agree", "lazy", "loop", "wing", "kind",
  "earn", "fund", "stay", "size", "less", "sure", "turn", "full", "flow", "path", "team", "work", "bit", "ago", "air", "arm",
  "ship", "hood", "meta", "gap", "mod", "leg", "pump", "dump", "chop", "trip", "else", "lion", "fold", "sign", "deal", "mind",
  "cake", "beam", "blue", "blob", "ally", "alot", "away", "back", "boom", "cars", "club", "cost", "dish", "else", "fate",
  "feet", "film", "fire", "gain", "game", "glad", "hair", "hall", "jobs", "joke", "lend", "lift", "link", "loan",
  "mark", "meet", "nail", "park", "plan", "play", "rent", "road", "save", "seat", "seed", "shop", "sold", "step", "stop",
  "tell", "tool", "trim", "vast", "wall", "wave", "wear", "wish", "yeah", "cold", "warm", "fast", "slow", "rare", "nuke",
]);

/** Company names people type instead of the symbol. */
const NAME_ALIASES: Record<string, string> = {
  tesla: "TSLA", nvidia: "NVDA", apple: "AAPL", amazon: "AMZN", google: "GOOGL", alphabet: "GOOGL", microsoft: "MSFT",
  netflix: "NFLX", palantir: "PLTR", broadcom: "AVGO", oracle: "ORCL", micron: "MU", intel: "INTC", coinbase: "COIN",
  robinhood: "HOOD", salesforce: "CRM", costco: "COST", walmart: "WMT", boeing: "BA", nike: "NKE", starbucks: "SBUX",
  moderna: "MRNA", pfizer: "PFE", disney: "DIS", uber: "UBER", shopify: "SHOP", snowflake: "SNOW", crowdstrike: "CRWD",
  supermicro: "SMCI", "super micro": "SMCI", qualcomm: "QCOM", meta: "META", facebook: "META", spotify: "SPOT",
  bitcoin: "IBIT", microstrategy: "MSTR", strategy: "MSTR", rocket: "RKLB", rklb: "RKLB",
};

const EXTRA_SYMBOLS = [
  "SPY", "QQQ", "IWM", "DIA", "SMH", "SOXX", "SOXL", "SOXS", "TQQQ", "SQQQ", "TNA", "TZA", "UVXY", "VIX", "XLE", "XLF", "XLK",
  "XLV", "XLP", "XLU", "XLI", "XLB", "XLY", "XLC", "XLRE", "XBI", "IBB", "KRE", "ARKK", "GLD", "SLV", "TLT", "USO", "IBIT",
  "MSTR", "SHOP", "SPOT", "RKLB", "SNOW", "NBIS", "CRWV", "OKLO", "SMR", "IONQ", "RGTI", "QBTS", "ASTS", "SOFI", "AFRM",
  "UPST", "RDDT", "TEM", "HIMS", "APP", "CVNA", "NET", "MDB", "ZS", "TSM", "ASML", "ARM", "BABA", "PDD", "NU", "SE", "MELI",
];

/** Curated: index constituents + MarketFlow universe. Used for lowercase matches. */
let coreSet: Set<string> | null = null;
/** Curated + every active Alpaca symbol. Used for caps / $cashtag matches. */
let fullSet: Set<string> | null = null;
let alpacaLoaded = false;

function addAll(s: Set<string>, list: string[]): void {
  for (const t of list) if (t) s.add(t.toUpperCase().replace(/\./g, "-"));
}

function coreSymbols(): Set<string> {
  if (coreSet) return coreSet;
  const s = new Set<string>();
  addAll(s, getConstituentsSync("russell3000"));
  addAll(s, getConstituentsSync("sp500"));
  addAll(s, getAllUniverseTickers());
  addAll(s, EXTRA_SYMBOLS);
  coreSet = s;
  return s;
}

function fullSymbols(): Set<string> {
  return fullSet ?? coreSymbols();
}

/** Widen caps matching with every active Alpaca equity/ETF (in memory, once per process). */
export async function loadFullSymbolList(): Promise<number> {
  if (alpacaLoaded) return fullSymbols().size;
  const { fetchAlpacaActiveSymbols } = await import("../alpaca");
  const list = await fetchAlpacaActiveSymbols();
  if (list.length) {
    const s = new Set(coreSymbols());
    addAll(s, list);
    fullSet = s;
    alpacaLoaded = true;
  }
  return fullSymbols().size;
}

const LONG_RX =
  /\b(bought|buying|buy(ing)? (the )?dip|long|longs|calls?|adding|added|add(ed)? (some|more)|starter|starting|entered|entry|in (at|on)|reclaim(s|ed|ing)?|bounc(e|ed|ing)|breakout|breaking out|broke out|ripping|rip|popping|pop|squeez(e|ing)|highs?|hod|green|strong|strength|bullish|love (this|it)|loading|load(ed)? up|holding|send(ing)? it|moon|higher|up \d+%?)\b/i;
const SHORT_RX =
  /\b(sold|selling|sell|short(ed|ing|s)?|puts?|trim(med|ming)?|took (profits?|some off)|out of|exit(ed)?|stopped( out)?|nuked|dump(ed|ing)?|tank(ed|ing)?|breakdown|breaking down|broke down|fail(ed|ing)?|fad(e|ed|ing)|red|weak(ness)?|bearish|lower lows?|lod|gap(ped)? down|lose|losing|lost|below|rolling over|crack(ed|ing)?|puke|flush(ed)?|down \d+%?)\b/i;

const ACTION_RULES: Array<[TradeAction, RegExp]> = [
  ["stop", /\b(stopped( out)?|stop (hit|out)|got stopped)\b/i],
  ["trim", /\b(trim(med|ming)?|took (some )?(profits?|some off)|sold (some|half|a third|1\/3|partial))\b/i],
  ["sell", /\b(sold|selling|exit(ed)?|close[ds]?|closing|out of|cut)\b/i],
  ["cover", /\b(cover(ed|ing)?)\b/i],
  ["short", /\b(short(ed|ing)?|bought puts?|puts on|in puts)\b/i],
  ["add", /\b(add(ed|ing)?|adding to|more)\b/i],
  ["buy", /\b(bought|buying|buy|starter|started|entered|entry|in at|long|calls? on|bought calls?)\b/i],
  ["watch", /\b(watching|on watch|alert|setting up|eyeing|looking at)\b/i],
];

export function extractTickers(text: string): string[] {
  const full = fullSymbols();
  const core = coreSymbols();
  const found = new Set<string>();
  for (const m of text.matchAll(/\$([A-Za-z]{1,5})\b/g)) {
    const t = m[1].toUpperCase();
    if (full.has(t)) found.add(t);
  }
  const stripped = text.replace(/https?:\/\/\S+/g, " ").replace(/@[\w .]+?(?=\s|$)/g, " ");
  for (const m of stripped.matchAll(/(?<![\w$@#])([A-Za-z]{2,5})(?![\w])/g)) {
    const raw = m[1];
    const t = raw.toUpperCase();
    if (STOP_UPPER.has(t)) continue;
    if (raw === t) {
      if (full.has(t)) found.add(t);
      continue;
    }
    // Lowercase / mixed case: 3+ letters, curated list only ("mrna", "Dell").
    if (raw.length >= 3 && core.has(t) && !STOP_LOWER.has(raw.toLowerCase())) found.add(t);
  }
  const lower = stripped.toLowerCase();
  for (const [name, t] of Object.entries(NAME_ALIASES)) {
    if (new RegExp(`\\b${name}\\b`).test(lower)) found.add(t);
  }
  return Array.from(found);
}

export function sideOf(text: string): Side {
  const l = LONG_RX.test(text);
  const s = SHORT_RX.test(text);
  if (l && !s) return "long";
  if (s && !l) return "short";
  return "neutral";
}

export function actionOf(text: string): TradeAction | null {
  for (const [action, rx] of ACTION_RULES) if (rx.test(text)) return action;
  return null;
}

export interface TradeDetails {
  /** Entry / exit price, e.g. 27.93 */
  price: number | null;
  /** Position size or risk, e.g. 10 for "10%" */
  sizePct: number | null;
  /** "26.50", "LOD", "HOD", "PDL"… */
  stop: string | null;
}

const STOP_RX =
  /\bstop(?:\s*loss)?(?:\s*(?:at|@|is|on|under|below|above|:|-|=))?\s*(\$?\d{1,5}(?:\.\d{1,4})?|lod|hod|pdl|pdh|low of (?:the )?day|high of (?:the )?day|(?:yesterday'?s|prior day'?s?) (?:low|high))/i;

/**
 * Price, size and stop from a trade post: "SNDK long 1315.18 10%", "10% Trim MSTZ 3.25",
 * "NVDA 182.40 5% stop LOD". A price is a decimal number, or a whole number written $182 / @ 182 / at 182;
 * clock times and percentages are not prices.
 */
export function tradeDetailsOf(text: string): TradeDetails {
  const clean = text.replace(/\b\d{1,2}:\d{2}\s?(?:[ap]m)?\b/gi, " ");
  const stopM = STOP_RX.exec(clean);
  const stop = stopM ? stopM[1].replace(/^\$/, "").toUpperCase().replace(/^LOW OF (THE )?DAY$/, "LOD").replace(/^HIGH OF (THE )?DAY$/, "HOD") : null;
  const rest = stopM ? clean.replace(stopM[0], " ") : clean;
  const sizeM = /(?<![\d.])(\d{1,3}(?:\.\d+)?)\s?%/.exec(rest);
  let price: number | null = null;
  const priceRx = /(\$|@\s*|\bat\s+)?(?<![\d.])(\d{1,5}(?:\.\d{1,4})?)(?![\d.]|\s?%|\s?[xk]\b|(?:st|nd|rd|th)\b)/gi;
  for (const m of rest.matchAll(priceRx)) {
    const hasDecimal = m[2].includes(".");
    if (!hasDecimal && !m[1]) continue;
    const n = Number(m[2]);
    if (n > 0) {
      price = n;
      break;
    }
  }
  return { price, sizePct: sizeM ? Number(sizeM[1]) : null, stop };
}

const EXIT_ACTIONS = new Set<TradeAction>(["trim", "sell", "stop", "cover"]);

/** A real trade post: ticker + trade action + price. Exits in the trade channels may omit the price ("MU closed"). */
export function isTradeCall(m: { tickers: string[]; action: TradeAction | null; text: string; channel: string }): boolean {
  if (!m.tickers.length || !m.action || !TRADE_ACTIONS.has(m.action)) return false;
  if (tradeDetailsOf(m.text).price != null) return true;
  return TRADE_CHANNELS.includes(m.channel) && EXIT_ACTIONS.has(m.action);
}

export function tagMessage(text: string, channel = ""): MessageTags {
  const tickers = extractTickers(text);
  if (!tickers.length) return { tickers, side: "neutral", action: null };
  let action = actionOf(text);
  // "346.88 3% SNOW" in the long-ideas channel is an entry even without a trade word.
  if (!action || action === "watch") {
    if (channel === "live-long-ideas") action = "buy";
    else if (channel === "live-short-ideas") action = "short";
    else {
      // Price plus size or stop is an entry: "NVDA 182.40 5% stop LOD".
      const d = tradeDetailsOf(text);
      if (d.price != null && (d.sizePct != null || d.stop != null)) {
        // Stop below the entry (LOD / PDL / lower price) = long; above (HOD / PDH / higher price) = short.
        const s = d.stop ?? "";
        const stopNum = Number(s);
        const short =
          /^(HOD|PDH)$|HIGH/.test(s) || (Number.isFinite(stopNum) && s !== "" && stopNum > d.price)
            ? true
            : /^(LOD|PDL)$|LOW/.test(s) || (Number.isFinite(stopNum) && s !== "" && stopNum < d.price)
              ? false
              : sideOf(text) === "short";
        action = short ? "short" : "buy";
      }
    }
  }
  const side: Side = action === "buy" || action === "add" ? "long" : action === "short" ? "short" : sideOf(text);
  return { tickers, side, action };
}

export interface TickerStat {
  symbol: string;
  mentions: number;
  long: number;
  short: number;
  neutral: number;
  trades: number;
  authors: number;
  prevMentions: number;
  lastTs: number;
  recent: Array<{ seq: number; author: string; time: string; text: string; side: Side }>;
}

export interface TradeCall {
  seq: number;
  id: string;
  author: string;
  channel: string;
  source: "chat" | "toast";
  time: string;
  ts: number;
  text: string;
  tickers: string[];
  action: TradeAction | null;
  side: Side;
  price: number | null;
  sizePct: number | null;
  stop: string | null;
}

export interface RoomAnalysis {
  windowMin: number | null;
  from: number;
  to: number;
  messages: number;
  activeAuthors: number;
  tickers: TickerStat[];
  tradeCalls: TradeCall[];
  traderMessages: TradeCall[];
}

const TRADE_ACTIONS = new Set<TradeAction>(["buy", "add", "trim", "sell", "short", "cover", "stop"]);

export function matchesTrader(author: string, traders: string[]): boolean {
  const a = author.toLowerCase();
  return traders.some((t) => t && a.includes(t.toLowerCase()));
}

export function analyze(
  msgs: Array<AnalyzableMessage & MessageTags>,
  opts: {
    windowMin: number | null;
    traders: string[];
    now?: number;
    /** Per-author weight, lower-case name → multiplier (1.25 boosted, 0.75 reduced). */
    weights?: Record<string, number>;
  },
): RoomAnalysis {
  const weightOf = (author: string) => opts.weights?.[author.toLowerCase()] ?? 1;
  const round1 = (n: number) => Math.round(n * 10) / 10;
  const now = opts.now ?? Date.now();
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const from = opts.windowMin ? now - opts.windowMin * 60_000 : midnight.getTime();
  const prevFrom = opts.windowMin ? from - opts.windowMin * 60_000 : 0;
  const inWindow = msgs.filter((m) => m.ts >= from);
  const stats = new Map<string, TickerStat & { authorSet: Set<string> }>();

  for (const m of msgs) {
    if (!m.tickers.length) continue;
    const current = m.ts >= from;
    const previous = opts.windowMin != null && m.ts >= prevFrom && m.ts < from;
    if (!current && !previous) continue;
    const w = weightOf(m.author);
    for (const t of m.tickers) {
      let s = stats.get(t);
      if (!s) {
        s = { symbol: t, mentions: 0, long: 0, short: 0, neutral: 0, trades: 0, authors: 0, prevMentions: 0, lastTs: 0, recent: [], authorSet: new Set() };
        stats.set(t, s);
      }
      if (previous) {
        s.prevMentions += w;
        continue;
      }
      s.mentions += w;
      s[m.side] += w;
      if (isTradeCall(m)) s.trades++;
      s.authorSet.add(m.author);
      s.lastTs = Math.max(s.lastTs, m.ts);
      s.recent.push({ seq: m.seq, author: m.author, time: m.time, text: m.text, side: m.side });
    }
  }

  const tickers = Array.from(stats.values())
    .filter((s) => s.mentions > 0)
    .map(({ authorSet, ...s }) => ({
      ...s,
      mentions: round1(s.mentions),
      long: round1(s.long),
      short: round1(s.short),
      neutral: round1(s.neutral),
      prevMentions: round1(s.prevMentions),
      authors: authorSet.size,
      recent: s.recent.slice(-6).reverse(),
    }))
    .sort((a, b) => b.mentions - a.mentions || b.authors - a.authors || b.lastTs - a.lastTs);

  // Trade calls cover the last 3 trading days (the panel shows exits that far back; entries today only).
  const callsFrom = new Date(midnight);
  for (let days = 1; days < 3; ) {
    callsFrom.setDate(callsFrom.getDate() - 1);
    const dow = callsFrom.getDay();
    if (dow !== 0 && dow !== 6) days++;
  }
  const traderMsgs = msgs
    .filter((m) => m.ts >= callsFrom.getTime())
    .filter((m) => matchesTrader(m.author, opts.traders) || TRADE_CHANNELS.includes(m.channel))
    .sort((a, b) => a.ts - b.ts || a.seq - b.seq);
  const toCall = (m: AnalyzableMessage & MessageTags): TradeCall => ({
    seq: m.seq, id: m.id, author: m.author, channel: m.channel, source: m.source, time: m.time, ts: m.ts, text: m.text,
    tickers: m.tickers, action: m.action, side: m.side, ...tradeDetailsOf(m.text),
  });

  return {
    windowMin: opts.windowMin,
    from,
    to: now,
    messages: inWindow.length,
    activeAuthors: new Set(inWindow.map((m) => m.author)).size,
    tickers,
    tradeCalls: traderMsgs.filter(isTradeCall).map(toCall).reverse().slice(0, 150),
    traderMessages: traderMsgs.filter((m) => m.ts >= midnight.getTime()).map(toCall).reverse().slice(0, 50),
  };
}
