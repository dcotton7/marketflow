/**
 * GET /api/health/discord: is the Discord room ideas feature really working? Counts and ages only (no names, tickers or
 * text), so it is public like /api/health and the PC keep-alive can check LOCAL and Live without a login or a token.
 *
 * Don, 9 Nov: "Once again, discord room ideas is not working". The ideas column had 78 messages in 15 minutes while
 * the AI summary said "No messages captured in this window" from a summary run when the buffer was momentarily empty.
 */
import { etDateKey, isMarketHoliday, regularCloseMinute } from "@shared/us-market-holidays";

export type DiscordHealthProblem =
  | "no_source"
  | "capture_stopped"
  | "relay_stale"
  | "no_new_messages_20m"
  | "summary_empty_but_room_active";

export interface DiscordHealth {
  ok: boolean;
  problems: DiscordHealthProblem[];
  source: "local" | "relay" | "none";
  capturing: boolean | null;
  relayStale: boolean | null;
  lastMessageAgeMin: number | null;
  messages15m: number;
  messages60m: number;
  summary: { ageMin: number; messageCount: number; minutes: number } | null;
  marketHours: boolean;
  checkedAt: string;
}

/** Weekday regular session in New York, holidays and early closes included. */
export function isUsMarketHours(at: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  if (get("weekday") === "Sat" || get("weekday") === "Sun") return false;
  const day = etDateKey(at);
  if (isMarketHoliday(day)) return false;
  const minute = Number(get("hour")) * 60 + Number(get("minute"));
  return minute >= 9 * 60 + 30 && minute < regularCloseMinute(day);
}

const mins = (ms: number) => Math.round((ms / 60_000) * 10) / 10;

export function discordHealth(input: {
  source: "local" | "relay" | "none";
  status?: { running?: unknown; relayStale?: unknown } | null;
  messages: { ts: number }[];
  /** The summary GET /api/discord-stream/summary would show. */
  summary?: { generatedAt: string; messageCount: number; minutes: number } | null;
  now?: number;
}): DiscordHealth {
  const now = input.now ?? Date.now();
  const marketHours = isUsMarketHours(new Date(now));
  const capturing = input.status ? input.status.running === true : null;
  const relayStale = input.source === "relay" ? input.status?.relayStale === true : null;
  const last = input.messages.reduce((m, x) => (Number.isFinite(x.ts) && x.ts > m ? x.ts : m), 0);
  const within = (min: number) => input.messages.filter((m) => m.ts >= now - min * 60_000).length;
  const s = input.summary ?? null;
  const summary = s
    ? { ageMin: mins(now - Date.parse(s.generatedAt)), messageCount: s.messageCount, minutes: s.minutes }
    : null;

  const problems: DiscordHealthProblem[] = [];
  if (input.source === "none") problems.push("no_source");
  if (marketHours && input.source !== "none") {
    if (capturing === false) problems.push("capture_stopped");
    if (relayStale) problems.push("relay_stale");
    if (!last || now - last > 20 * 60_000) problems.push("no_new_messages_20m");
  }
  if (summary && summary.messageCount === 0 && within(summary.minutes) > 0) problems.push("summary_empty_but_room_active");

  return {
    ok: problems.length === 0,
    problems,
    source: input.source,
    capturing,
    relayStale,
    lastMessageAgeMin: last ? mins(now - last) : null,
    messages15m: within(15),
    messages60m: within(60),
    summary,
    marketHours,
    checkedAt: new Date(now).toISOString(),
  };
}

/** A summary worth keeping and showing: one that read messages. An empty one (the buffer was empty at that moment,
 *  e.g. just after Live restarted) said "No messages captured" for hours while the room was busy. */
export function keepSummary<T extends { messageCount: number }>(s: T | null | undefined): T | null {
  return s && s.messageCount > 0 ? s : null;
}
