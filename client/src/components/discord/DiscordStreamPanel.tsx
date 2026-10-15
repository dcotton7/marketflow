import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { ArrowDown, CornerDownRight, Eraser, EyeOff, Film, GripVertical, Image as ImageIcon, Info, Link2, Loader2, MessagesSquare, Paperclip, Play, Search, Square } from "lucide-react";
import { DiscordRoomIdeas } from "@/components/discord/DiscordRoomIdeas";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { localSlotBgStyle, localSlotHeaderStyle } from "@/lib/local-slot-style";
import { cn } from "@/lib/utils";

export interface DiscordReaction {
  emoji: string;
  count: number;
}

export interface DiscordMessage {
  seq: number;
  id: string;
  channel: string;
  server: string;
  author: string;
  tag: string;
  time: string;
  text: string;
  mentions: string[];
  links: string[];
  replyTo: string;
  replyPreview: string;
  reactions: DiscordReaction[];
  media: string[];
  extras: string[];
  edited: boolean;
  initial: boolean;
  label: string;
  capturedAt: string;
  ts: number;
  tickers: string[];
  side: "long" | "short" | "neutral";
  action: string | null;
  source?: "chat" | "toast";
}

interface WatcherStatus {
  window: boolean;
  title: string;
  openChannel: string;
  server: string;
  watching: string;
  channels?: string[];
  capturing?: string;
  listFound: boolean;
  visible: number;
  seen: number;
  toastAccess?: string;
  toasts?: number;
  lastError: string;
  at: string;
}

const MAIN_CHANNEL = "live-stream-chat";

export interface DiscordStreamStatus {
  available: boolean;
  running: boolean;
  channel: string;
  startedAt: string | null;
  killSwitch: boolean;
  watcher: WatcherStatus | null;
  lastExit: { code: number | null; reason: string; at: string } | null;
  buffered: number;
  latestSeq: number;
  maxBuffered: number;
}

const POLL_MS = 1500;
const STICK_PX = 48;
const DEFAULT_TRADERS = ["Nick Drendel", "RealSimpleAriel"];

const AUTHOR_COLORS = [
  "text-sky-400",
  "text-emerald-400",
  "text-amber-400",
  "text-rose-400",
  "text-violet-400",
  "text-teal-400",
  "text-orange-400",
  "text-fuchsia-400",
  "text-lime-400",
  "text-cyan-400",
];

function authorColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return AUTHOR_COLORS[Math.abs(h) % AUTHOR_COLORS.length];
}

async function readError(res: Response): Promise<string> {
  try {
    const j = await res.json();
    return j?.error || `${res.status} ${res.statusText}`;
  } catch {
    return `${res.status} ${res.statusText}`;
  }
}

type Phase = { tone: "live" | "idle" | "warn" | "off"; label: string; hint?: string };

function phaseOf(status: DiscordStreamStatus | null): Phase {
  if (!status) return { tone: "idle", label: "Connecting…" };
  if (!status.available) return { tone: "off", label: "Unavailable", hint: "Discord capture runs only on LOCAL Windows." };
  if (status.killSwitch) return { tone: "off", label: "Kill switch on", hint: "Delete server/bridge/DISCORD_WATCH_OFF.txt to allow capture." };
  if (!status.running) {
    const reason = status.lastExit?.reason && status.lastExit.reason !== "stopped by user" ? status.lastExit.reason : undefined;
    return { tone: "idle", label: "Stopped", hint: reason };
  }
  const w = status.watcher;
  if (!w) return { tone: "idle", label: "Starting…" };
  if (!w.window) return { tone: "warn", label: "Discord not found", hint: "Open the Discord desktop app." };
  const popups = w.toastAccess === "Allowed" ? "" : " Pop-up notifications are not readable on this PC.";
  if (!w.listFound) {
    const watched = (w.channels ?? [w.watching]).map((c) => `#${c}`).join(", ");
    return {
      tone: "warn",
      label: "Pop-ups only",
      hint: `Discord is showing ${w.openChannel ? `#${w.openChannel}` : "another view"}, so only pop-up notifications are being caught. Open one of ${watched} to read the channel itself.${popups}`,
    };
  }
  const hint = w.lastError ? `Last read error: ${w.lastError}` : popups.trim() || undefined;
  return { tone: "live", label: `Capturing #${w.capturing || w.watching}`, hint };
}

const escapeRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function MessageText({ msg, onSymbol }: { msg: DiscordMessage; onSymbol?: (s: string) => void }) {
  if (!msg.text) return null;
  const mentions = msg.mentions.map((m) => `@${m}`).sort((a, b) => b.length - a.length);
  const tickers = msg.tickers ?? [];
  if (mentions.length === 0 && tickers.length === 0) return <span className="whitespace-pre-wrap break-words text-slate-200">{msg.text}</span>;
  const alts = [...mentions.map(escapeRx), ...tickers.map((t) => `\\$?\\b${escapeRx(t)}\\b`)];
  const parts = msg.text.split(new RegExp(`(${alts.join("|")})`, "gi"));
  return (
    <span className="whitespace-pre-wrap break-words text-slate-200">
      {parts.map((p, i) => {
        if (!p) return null;
        if (mentions.includes(p)) {
          return (
            <span key={i} className="rounded bg-indigo-500/20 px-1 text-indigo-300">
              {p}
            </span>
          );
        }
        const sym = p.replace(/^\$/, "").toUpperCase();
        if (tickers.includes(sym)) {
          return (
            <button
              key={i}
              type="button"
              onClick={() => onSymbol?.(sym)}
              className="rounded bg-cyan-500/15 px-0.5 font-semibold text-cyan-300 hover:bg-cyan-500/30"
            >
              {p}
            </button>
          );
        }
        return <span key={i}>{p}</span>;
      })}
    </span>
  );
}

function MediaChip({ kind }: { kind: string }) {
  const Icon = kind === "video" ? Film : kind.startsWith("image") ? ImageIcon : Paperclip;
  return (
    <span className="inline-flex items-center gap-1 rounded border border-slate-700/70 px-1.5 py-px text-[10px] text-slate-400">
      <Icon className="h-3 w-3" />
      {kind}
    </span>
  );
}

function MessageRow({
  msg,
  showDetails,
  grouped,
  isTrader,
  onSymbol,
}: {
  msg: DiscordMessage;
  showDetails: boolean;
  grouped: boolean;
  isTrader: boolean;
  onSymbol?: (s: string) => void;
}) {
  return (
    <div
      className={cn(
        "group border-l-2 px-3 text-xs leading-relaxed hover:bg-slate-800/40",
        isTrader ? "border-amber-400/70 bg-amber-500/[0.06]" : "border-transparent",
        grouped ? "py-0.5" : "pt-1.5 pb-0.5",
      )}
    >
      {msg.replyTo && (
        <div className="flex min-w-0 items-center gap-1 text-[11px] text-slate-500">
          <CornerDownRight className="h-3 w-3 shrink-0" />
          <span className={cn("shrink-0 font-medium", authorColor(msg.replyTo))}>@{msg.replyTo}</span>
          {msg.replyPreview && <span className="truncate">{msg.replyPreview}</span>}
        </div>
      )}
      {(!grouped || msg.replyTo) && (
        <div className="flex items-baseline gap-1.5">
          <span className={cn("font-semibold", authorColor(msg.author))}>{msg.author || "Unknown"}</span>
          {msg.tag && (
            <span className="rounded bg-slate-800 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-slate-400">{msg.tag}</span>
          )}
          {msg.channel && msg.channel !== MAIN_CHANNEL && (
            <span className="rounded bg-indigo-500/15 px-1 py-px text-[9px] font-medium text-indigo-300">#{msg.channel}</span>
          )}
          {msg.source === "toast" && (
            <span className="rounded bg-amber-500/15 px-1 py-px text-[9px] font-medium text-amber-300">pop-up</span>
          )}
          <span className="font-mono text-[10px] tabular-nums text-slate-500">{msg.time}</span>
        </div>
      )}
      <div>
        <MessageText msg={msg} onSymbol={onSymbol} />
        {msg.edited && <span className="ml-1 text-[10px] text-slate-500">(edited)</span>}
      </div>
      {(msg.media.length > 0 || msg.reactions.length > 0 || msg.links.length > 0) && (
        <div className="mt-0.5 flex flex-wrap items-center gap-1">
          {msg.media.map((m, i) => (
            <MediaChip key={`m${i}`} kind={m} />
          ))}
          {msg.links
            .filter((l) => !msg.text.includes(l))
            .map((l, i) => (
              <span key={`l${i}`} className="inline-flex items-center gap-1 text-[10px] text-sky-400">
                <Link2 className="h-3 w-3" />
                {l}
              </span>
            ))}
          {msg.reactions.map((r, i) => (
            <span key={`r${i}`} className="rounded-full border border-slate-700/70 bg-slate-800/60 px-1.5 py-px text-[10px] text-slate-400">
              :{r.emoji}: {r.count}
            </span>
          ))}
        </div>
      )}
      {msg.extras.length > 0 && <div className="mt-0.5 border-l-2 border-slate-700 pl-2 text-[11px] text-slate-400">{msg.extras.join(" · ")}</div>}
      {showDetails && (
        <div className="mt-1 space-y-0.5 rounded border border-dashed border-slate-700 bg-slate-950/40 px-2 py-1 font-mono text-[10px] leading-snug text-slate-500">
          <div>
            id {msg.id} · #{msg.seq} · captured {new Date(msg.capturedAt).toLocaleTimeString()} · {msg.initial ? "on screen at start" : "live"}
          </div>
          <div className="break-words">raw: {msg.label}</div>
        </div>
      )}
    </div>
  );
}

/**
 * Live #live-stream-chat capture from the Discord desktop app on this PC (read-only, memory only).
 * Docked in the MarketFlow workspace as region `discordStreamPanel`.
 */
export function DiscordStreamPanel({
  onHide,
  onSymbol,
  traders = DEFAULT_TRADERS,
  className,
  dataRegion,
}: {
  onHide?: () => void;
  onSymbol?: (symbol: string) => void;
  traders?: string[];
  className?: string;
  dataRegion?: string;
}) {
  const [status, setStatus] = useState<DiscordStreamStatus | null>(null);
  const [messages, setMessages] = useState<DiscordMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const [unseen, setUnseen] = useState(0);

  const lastSeq = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/discord-stream/messages?after=${lastSeq.current}`, { credentials: "include" });
      if (!res.ok) {
        setError(await readError(res));
        return;
      }
      const data = (await res.json()) as { messages: DiscordMessage[]; status: DiscordStreamStatus };
      setError(null);
      setStatus(data.status);
      if (data.status.latestSeq < lastSeq.current) {
        lastSeq.current = 0;
        setMessages([]);
        return;
      }
      if (data.messages.length) {
        lastSeq.current = data.messages[data.messages.length - 1].seq;
        setMessages((prev) => {
          const next = prev.concat(data.messages);
          return next.length > data.status.maxBuffered ? next.slice(-data.status.maxBuffered) : next;
        });
        if (!stuck.current) setUnseen((n) => n + data.messages.length);
      } else if (data.status.buffered === 0 && lastSeq.current > 0) {
        lastSeq.current = 0;
        setMessages([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    }
  }, []);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      await poll();
      if (alive) timer = setTimeout(loop, POLL_MS);
    };
    loop();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [poll]);

  const ordered = useMemo(() => [...messages].sort((a, b) => a.ts - b.ts || a.seq - b.seq), [messages]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return ordered;
    return ordered.filter(
      (m) => m.text.toLowerCase().includes(q) || m.author.toLowerCase().includes(q) || m.mentions.some((x) => x.toLowerCase().includes(q)),
    );
  }, [ordered, filter]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stuck.current) el.scrollTop = el.scrollHeight;
  }, [visible]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
    if (stuck.current) setUnseen(0);
  };

  const jumpToLatest = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    stuck.current = true;
    setUnseen(0);
  };

  const act = async (path: "start" | "stop" | "clear") => {
    setBusy(true);
    try {
      const res = await fetch(`/api/discord-stream/${path}`, { method: "POST", credentials: "include" });
      if (!res.ok) {
        setError(await readError(res));
        return;
      }
      setStatus(await res.json());
      setError(null);
      if (path === "clear") {
        lastSeq.current = 0;
        setMessages([]);
        setUnseen(0);
      }
    } finally {
      setBusy(false);
    }
  };

  const traderSet = traders.map((t) => t.toLowerCase());
  const phase = phaseOf(status);
  const firstLive = ordered.findIndex((m) => !m.initial);
  const server = status?.watcher?.server || messages[messages.length - 1]?.server || "";
  const channel = status?.channel || MAIN_CHANNEL;
  const channelList = (status?.watcher?.channels ?? [channel]).map((c) => `#${c}`).join(", ");
  const dotTone = {
    live: "bg-emerald-500",
    idle: "bg-slate-500",
    warn: "bg-amber-500",
    off: "bg-rose-500",
  }[phase.tone];

  return (
    <div
      className={cn("flex h-full flex-col overflow-hidden rounded-lg border border-slate-700/50", className)}
      style={localSlotBgStyle("marketFlow:discordStreamPanel")}
      data-ui-region={dataRegion}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-700/50 px-3 py-2" style={localSlotHeaderStyle("marketFlow:panelHeader")}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex min-w-0 cursor-help items-center gap-1.5">
              <MessagesSquare className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
              <span className="text-sm font-medium">Discord</span>
              <span className="truncate text-xs text-muted-foreground">
                #{channel}
                {server && ` · ${server}`}
              </span>
              <Info className="h-3 w-3 shrink-0 text-muted-foreground" />
            </div>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <p className="text-xs">
              Reads {channelList} from the Discord app on this PC whenever one of them is open, and catches Discord pop-up notifications from any
              channel. Read-only: never clicks or types in Discord. Kept in memory only (last 5,000 messages); nothing is stored.
            </p>
          </TooltipContent>
        </Tooltip>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {status?.running ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 px-2 text-slate-300 hover:bg-slate-700/60"
              onClick={() => act("stop")}
              disabled={busy}
              data-testid="discord-stop"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3 w-3" />}
              Stop
            </Button>
          ) : (
            <Button
              size="sm"
              className="h-7 gap-1 bg-indigo-600 px-2 text-white hover:bg-indigo-500"
              onClick={() => act("start")}
              disabled={busy || !status?.available || status?.killSwitch}
              data-testid="discord-start"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3 w-3" />}
              Start
            </Button>
          )}
          {onHide && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-slate-300 hover:bg-slate-700/60 hover:text-slate-100" onClick={onHide}>
                  <EyeOff className="mr-1 h-3.5 w-3.5" />
                  Hide
                </Button>
              </TooltipTrigger>
              <TooltipContent>Hide Discord panel (capture keeps running)</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      <PanelGroup direction="horizontal" autoSaveId="mf-discord-split" className="min-h-0 flex-1">
      <Panel id="discord-chat" order={1} defaultSize={50} minSize={25}>
      <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-slate-700/40 px-3 py-1.5">
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className={cn("h-1.5 w-1.5 rounded-full", dotTone, phase.tone === "live" && "animate-pulse")} />
          <span className="font-medium text-slate-200">{phase.label}</span>
          {status && status.buffered > 0 && <span className="text-slate-500">· {status.buffered} captured</span>}
        </div>
        <div className="relative ml-auto min-w-[8rem] flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-500" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter"
            className="h-6 border-slate-700/60 bg-slate-900/60 pl-6 text-[11px]"
            data-testid="discord-filter"
          />
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <label className="flex cursor-pointer items-center gap-1 text-[11px] text-slate-400">
              <Switch checked={showDetails} onCheckedChange={setShowDetails} className="scale-75" data-testid="discord-details" />
              Details
            </label>
          </TooltipTrigger>
          <TooltipContent>Show what was read from Discord for each message</TooltipContent>
        </Tooltip>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 gap-1 px-1.5 text-[11px] text-slate-400 hover:bg-rose-500/15 hover:text-rose-300"
              disabled={busy || messages.length === 0}
              data-testid="discord-clear"
            >
              <Eraser className="h-3.5 w-3.5" />
              Clear
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Clear all captured messages?</AlertDialogTitle>
              <AlertDialogDescription>
                This removes all {messages.length.toLocaleString()} captured messages and the trade calls and mention counts built from them. Messages
                still on screen in Discord are not read again until you press Stop and then Start.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep them</AlertDialogCancel>
              <AlertDialogAction className="bg-rose-600 text-white hover:bg-rose-500" onClick={() => act("clear")}>
                Clear messages
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {(phase.hint || error) && (
        <div
          className={cn(
            "shrink-0 border-b px-3 py-1 text-[11px]",
            error || phase.tone === "off"
              ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
              : phase.tone === "warn"
                ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                : "border-slate-700/40 bg-slate-800/30 text-slate-400",
          )}
        >
          {error || phase.hint}
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto py-1" data-testid="discord-feed">
          {visible.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-xs text-slate-500">
              <MessagesSquare className="h-6 w-6 opacity-40" />
              {messages.length > 0 ? (
                <span>No messages match “{filter}”.</span>
              ) : status?.running ? (
                <span>Waiting for messages from #{channel}…</span>
              ) : (
                <>
                  <span className="text-slate-300">Nothing captured yet.</span>
                  <span className="max-w-[16rem]">Open #{channel} in the Discord app, scroll to the newest message, then press Start.</span>
                </>
              )}
            </div>
          ) : (
            visible.map((m, i) => {
              const prev = visible[i - 1];
              const liveDivider = !filter && firstLive > 0 && m === ordered[firstLive];
              const grouped =
                !!prev && !liveDivider && prev.author === m.author && prev.time === m.time && prev.channel === m.channel && !m.replyTo;
              return (
                <div key={m.id}>
                  {liveDivider && (
                    <div className="my-1.5 flex items-center gap-2 px-3 text-[9px] font-semibold uppercase tracking-wider text-emerald-400/80">
                      <span className="h-px flex-1 bg-emerald-500/30" />
                      Live from here
                      <span className="h-px flex-1 bg-emerald-500/30" />
                    </div>
                  )}
                  <MessageRow
                    msg={m}
                    showDetails={showDetails}
                    grouped={grouped}
                    isTrader={traderSet.some((t) => m.author.toLowerCase().includes(t))}
                    onSymbol={onSymbol}
                  />
                </div>
              );
            })
          )}
        </div>

        {unseen > 0 && (
          <button
            type="button"
            onClick={jumpToLatest}
            className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-indigo-600 px-2.5 py-1 text-[11px] font-medium text-white shadow-lg hover:bg-indigo-500"
          >
            <ArrowDown className="h-3 w-3" />
            {unseen} new
          </button>
        )}
      </div>
      </div>
      </Panel>
      <PanelResizeHandle className="group relative flex w-2 items-center justify-center border-x border-slate-700/40 transition-colors hover:bg-cyan-500/20">
        <div className="absolute h-8 w-1 rounded-full bg-slate-600 transition-colors group-hover:bg-cyan-500" />
        <GripVertical className="absolute h-3 w-3 text-slate-500 group-hover:text-cyan-400" />
      </PanelResizeHandle>
      <Panel id="discord-ideas" order={2} defaultSize={50} minSize={25}>
        <DiscordRoomIdeas traders={traders} onSymbol={onSymbol} />
      </Panel>
      </PanelGroup>
    </div>
  );
}
