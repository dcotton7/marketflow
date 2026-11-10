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
  | "discord_not_running"
  | "discord_minimized"
  | "wrong_channel_open"
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
  /** Plain-text line for each real cause (banner and phone alert use the same text). Empty when there is none. */
  messages: string[];
  /** What Discord is showing right now, from the watcher's heartbeat (channel and server names only). */
  discord: { running: boolean; minimized: boolean; channel: string; server: string } | null;
  checkedAt: string;
}

/** The channel name as the watcher compares it: no "#", emoji or separators, lower case. */
export function cleanChannel(s: unknown): string {
  return String(s ?? "").replace(/^Messages in /, "").replace(/[^A-Za-z0-9_-]/g, "").toLowerCase();
}

/** Server names keep their spaces; emoji and odd separators go. */
function cleanServer(s: unknown): string {
  return String(s ?? "").replace(/[^\p{L}\p{N} _'&.-]/gu, "").replace(/\s+/g, " ").trim();
}

export function discordProblemText(p: DiscordHealthProblem, d: DiscordHealth["discord"], watching: string): string {
  switch (p) {
    case "wrong_channel_open":
      return `Discord is showing #${d?.channel || "another channel"}${d?.server ? ` (${d.server})` : ""}, not #${watching}`;
    case "discord_minimized": return "Discord is minimized, so the room can't be read";
    case "discord_not_running": return "Discord is not running";
    case "no_new_messages_20m": return "No new messages for 20 minutes";
    case "capture_stopped": return "Discord capture is stopped";
    case "relay_stale": return "The PC has stopped sending Discord messages";
    case "no_source": return "No Discord source is connected";
    case "summary_empty_but_room_active": return "The room summary is empty but the room is active";
  }
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
  status?: { running?: unknown; relayStale?: unknown; watcher?: unknown } | null;
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

  // The watcher's heartbeat says what Discord is showing. Old watchers send no `running`/`minimized`: assume fine.
  const w = (input.status?.watcher ?? null) as Record<string, unknown> | null;
  const watchedList = Array.isArray(w?.channels) ? (w!.channels as unknown[]).map(cleanChannel) : [];
  const watching = cleanChannel(w?.watching) || "live-stream-chat";
  if (watchedList.length === 0 && w) watchedList.push(watching);
  const discord: DiscordHealth["discord"] = w
    ? {
        running: w.running === undefined ? w.window === true : w.running === true,
        minimized: w.minimized === true,
        channel: cleanChannel(w.channelName ?? w.openChannel),
        server: cleanServer(w.server),
      }
    : null;
  const stale = input.source === "relay" && relayStale === true; // heartbeat is old: don't trust the window state
  const windowGone = !!discord && !stale && w!.window === false;
  const cause: DiscordHealthProblem | null =
    !discord || stale ? null
    : !discord.running ? "discord_not_running"
    : discord.minimized || windowGone ? "discord_minimized"
    : discord.channel && !watchedList.includes(discord.channel) ? "wrong_channel_open"
    : null;

  const problems: DiscordHealthProblem[] = [];
  if (input.source === "none") problems.push("no_source");
  if (marketHours && input.source !== "none") {
    if (capturing === false) problems.push("capture_stopped");
    if (relayStale) problems.push("relay_stale");
    if (cause) problems.push(cause); // ranks above no_new_messages_20m
    // A real cause explains the silence; the quiet-room problem is only for when Discord shows the right channel.
    if (!cause && (!last || now - last > 20 * 60_000)) problems.push("no_new_messages_20m");
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
    messages: problems.map((p) => discordProblemText(p, discord, watching)),
    discord,
    checkedAt: new Date(now).toISOString(),
  };
}

/** A summary worth keeping and showing: one that read messages. An empty one (the buffer was empty at that moment,
 *  e.g. just after Live restarted) said "No messages captured" for hours while the room was busy. */
export function keepSummary<T extends { messageCount: number }>(s: T | null | undefined): T | null {
  return s && s.messageCount > 0 ? s : null;
}
