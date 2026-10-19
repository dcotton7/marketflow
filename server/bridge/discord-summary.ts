/**
 * AI summary of the Discord room over the last N minutes: ideas the room is converging on, group think,
 * and what Nick / Ari did. On demand only (button); messages leave the PC for OpenAI only on that request.
 */
import OpenAI from "openai";
import { analyze, matchesTrader, TRADE_CHANNELS, type AnalyzableMessage, type MessageTags } from "./discord-analysis";

export const ROOM_SUMMARY_MODEL = "gpt-5.1";
const MAX_PROMPT_CHARS = 60_000;
const MAX_LINE_CHARS = 280;

export interface RoomIdea {
  symbol: string;
  side: "long" | "short" | "mixed";
  conviction: "high" | "medium" | "low";
  who: string[];
  why: string;
}

export interface GroupThink {
  theme: string;
  symbols: string[];
  note: string;
  caution: string;
}

export interface RoomSummary {
  generatedAt: string;
  minutes: number;
  messageCount: number;
  authorCount: number;
  model: string;
  headline: string;
  mood: string;
  ideas: RoomIdea[];
  groupThink: GroupThink[];
  staffMoves: string[];
  watchOuts: string[];
}

const SYSTEM_PROMPT = `You read a live stock-trading Discord room for a busy trader who cannot watch it all day.
Summarize ONLY what is in the messages. Never invent tickers, prices or opinions. Short, plain sentences.

Message lines look like: "10:42 AM Author [tags]: text". Tags:
- STAFF = Nick Drendel or Ari (RealSimpleAriel), the room's lead traders. Their posts in #live-long-ideas, #live-short-ideas or #nick-drendel are their real trades.
- x1.25 = the reader trusts this person more: give their views 25% more weight.
- x0.75 = the reader trusts this person less: give their views 25% less weight.

Room shorthand: a number next to a ticker is a PRICE ("SNDK long 1300" = long at 1300), never a share count. "10%" is position size or risk.
"Trim" / "closed" / "sold" are exits from an existing position, not new shorts. Some symbols are inverse ETFs (e.g. MSTZ, RGTZ): describe them as the room does, do not flip their side.

Return JSON:
{
  "headline": "one sentence: the main thing happening in the room",
  "mood": "one short phrase, e.g. 'cautious, rotating into semis'",
  "ideas": [ { "symbol": "TICKER", "side": "long|short|mixed", "conviction": "high|medium|low", "who": ["names"], "why": "one sentence" } ],
  "groupThink": [ { "theme": "what many people are piling into or agreeing on", "symbols": ["TICKERS"], "note": "how widespread / who", "caution": "one sentence: the risk of the crowd being wrong, or empty" } ],
  "staffMoves": [ "one line per Nick / Ari trade or opinion in the window, with price if given" ],
  "watchOuts": [ "disagreements, fading enthusiasm, warnings from staff, or empty" ]
}
At most 8 ideas, ordered by weighted conviction. At most 4 groupThink items; only include a theme several different people share.
Empty arrays are fine when the room had nothing.`;

function getOpenAI(): OpenAI | null {
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey, baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL });
}

export function aiAvailable(): boolean {
  return Boolean(process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY);
}

type Msg = AnalyzableMessage & MessageTags;

function buildPrompt(msgs: Msg[], opts: { minutes: number; traders: string[]; weights: Record<string, number> }) {
  const lines: string[] = [];
  for (const m of msgs) {
    const text = m.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const tags: string[] = [];
    if (matchesTrader(m.author, opts.traders)) tags.push("STAFF");
    const w = opts.weights[m.author.toLowerCase()];
    if (w && w !== 1) tags.push(`x${w}`);
    const chan = m.channel && m.channel !== "live-stream-chat" ? ` #${m.channel}` : "";
    lines.push(`${m.time} ${m.author}${tags.length ? ` [${tags.join(",")}]` : ""}${chan}: ${text.slice(0, MAX_LINE_CHARS)}`);
  }
  // Keep the most recent lines when the hour is too long for one prompt.
  let total = 0;
  let start = lines.length;
  while (start > 0 && total + lines[start - 1].length + 1 <= MAX_PROMPT_CHARS) {
    start--;
    total += lines[start].length + 1;
  }
  const kept = lines.slice(start);

  const stats = analyze(msgs, { windowMin: opts.minutes, traders: opts.traders, weights: opts.weights });
  const top = stats.tickers
    .slice(0, 15)
    .map((t) => `${t.symbol}: ${t.mentions} weighted mentions by ${t.authors} people (long ${t.long}, short ${t.short})`)
    .join("\n");
  const calls = stats.tradeCalls
    .filter((c) => c.ts >= Date.now() - opts.minutes * 60_000)
    .map((c) => `${c.time} ${c.author} #${c.channel}: ${c.text}`)
    .join("\n");

  return {
    prompt:
      `Window: last ${opts.minutes} minutes. ${kept.length} messages` +
      (kept.length < lines.length ? ` (oldest ${lines.length - kept.length} dropped for length)` : "") +
      `.\n\nTicker counts (weighted):\n${top || "none"}\n\nDetected staff trade posts (${TRADE_CHANNELS.join(", ")}):\n${calls || "none"}\n\nMessages:\n${kept.join("\n")}`,
    messageCount: kept.length,
  };
}

const asStrings = (v: unknown, max: number) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").slice(0, max) : [];

export async function summarizeRoom(
  all: Msg[],
  opts: { minutes: number; traders: string[]; weights: Record<string, number> },
): Promise<RoomSummary> {
  const openai = getOpenAI();
  if (!openai) throw new Error("OpenAI key not configured");
  const from = Date.now() - opts.minutes * 60_000;
  const msgs = all.filter((m) => m.ts >= from).sort((a, b) => a.ts - b.ts || a.seq - b.seq);
  const base = {
    generatedAt: new Date().toISOString(),
    minutes: opts.minutes,
    messageCount: msgs.length,
    authorCount: new Set(msgs.map((m) => m.author)).size,
    model: ROOM_SUMMARY_MODEL,
  };
  if (msgs.length === 0) {
    return { ...base, headline: "No messages captured in this window.", mood: "", ideas: [], groupThink: [], staffMoves: [], watchOuts: [] };
  }

  const { prompt, messageCount } = buildPrompt(msgs, opts);
  const response = await openai.chat.completions.create({
    model: ROOM_SUMMARY_MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: 2500,
    temperature: 0.3,
  });
  const raw = JSON.parse(response.choices[0]?.message?.content || "{}") as Record<string, unknown>;

  const ideas: RoomIdea[] = (Array.isArray(raw.ideas) ? raw.ideas : []).slice(0, 8).flatMap((i: any) =>
    typeof i?.symbol === "string"
      ? [{
          symbol: i.symbol.toUpperCase().replace(/^\$/, ""),
          side: i.side === "short" || i.side === "mixed" ? i.side : "long",
          conviction: i.conviction === "high" || i.conviction === "low" ? i.conviction : "medium",
          who: asStrings(i.who, 6),
          why: typeof i.why === "string" ? i.why : "",
        }]
      : [],
  );
  const groupThink: GroupThink[] = (Array.isArray(raw.groupThink) ? raw.groupThink : []).slice(0, 4).flatMap((g: any) =>
    typeof g?.theme === "string"
      ? [{
          theme: g.theme,
          symbols: asStrings(g.symbols, 8).map((s) => s.toUpperCase().replace(/^\$/, "")),
          note: typeof g.note === "string" ? g.note : "",
          caution: typeof g.caution === "string" ? g.caution : "",
        }]
      : [],
  );

  return {
    ...base,
    messageCount,
    headline: typeof raw.headline === "string" ? raw.headline : "",
    mood: typeof raw.mood === "string" ? raw.mood : "",
    ideas,
    groupThink,
    staffMoves: asStrings(raw.staffMoves, 10),
    watchOuts: asStrings(raw.watchOuts, 6),
  };
}
