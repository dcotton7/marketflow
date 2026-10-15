import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, BellOff, ChevronDown, ChevronRight, Lightbulb, RotateCcw, TrendingDown, TrendingUp, X } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { playAlertChime } from "@/lib/alert-sound";
import { cn } from "@/lib/utils";

type Side = "long" | "short" | "neutral";
type TradeAction = "buy" | "add" | "trim" | "sell" | "short" | "cover" | "stop" | "watch";

interface TickerStat {
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

interface TradeCall {
  seq: number;
  id: string;
  author: string;
  channel?: string;
  source?: "chat" | "toast";
  time: string;
  ts: number;
  text: string;
  tickers: string[];
  action: TradeAction | null;
  side: Side;
}

interface RoomAnalysis {
  windowMin: number | null;
  messages: number;
  activeAuthors: number;
  tickers: TickerStat[];
  tradeCalls: TradeCall[];
  traderMessages: TradeCall[];
}

const WINDOWS: Array<{ id: string; label: string; min: number | null }> = [
  { id: "5", label: "5m", min: 5 },
  { id: "15", label: "15m", min: 15 },
  { id: "30", label: "30m", min: 30 },
  { id: "60", label: "1h", min: 60 },
  { id: "all", label: "Session", min: null },
];

const POLL_MS = 5000;
const FRESH_MS = 3 * 60_000;
const IGNORE_KEY = "mf-discord-ignored-tickers";
const WINDOW_KEY = "mf-discord-window";
const CHIME_KEY = "mf-discord-trade-chime";

const ACTION_STYLE: Record<TradeAction, { label: string; cls: string }> = {
  buy: { label: "BUY", cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40" },
  add: { label: "ADD", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  trim: { label: "TRIM", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  sell: { label: "SELL", cls: "bg-slate-500/20 text-slate-200 border-slate-500/40" },
  stop: { label: "STOPPED", cls: "bg-rose-500/15 text-rose-300 border-rose-500/30" },
  short: { label: "SHORT", cls: "bg-rose-500/20 text-rose-300 border-rose-500/40" },
  cover: { label: "COVER", cls: "bg-sky-500/15 text-sky-300 border-sky-500/30" },
  watch: { label: "WATCH", cls: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30" },
};

function readIgnored(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(IGNORE_KEY) || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-3 pb-1 pt-3">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{children}</span>
      {right && <div className="ml-auto flex items-center gap-1">{right}</div>}
    </div>
  );
}

function TickerChip({ symbol, onClick }: { symbol: string; onClick?: (s: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onClick?.(symbol)}
      className={cn(
        "rounded bg-slate-800 px-1.5 py-px font-mono text-[11px] font-semibold text-slate-100",
        onClick && "hover:bg-cyan-500/20 hover:text-cyan-200",
      )}
    >
      {symbol}
    </button>
  );
}

function LeanBar({ long, short, neutral }: { long: number; short: number; neutral: number }) {
  const total = long + short + neutral || 1;
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
      <div className="bg-emerald-500" style={{ width: `${(long / total) * 100}%` }} />
      <div className="bg-slate-600" style={{ width: `${(neutral / total) * 100}%` }} />
      <div className="bg-rose-500" style={{ width: `${(short / total) * 100}%` }} />
    </div>
  );
}

function TradeCallCard({ call, onSymbol, now }: { call: TradeCall; onSymbol?: (s: string) => void; now: number }) {
  const style = call.action ? ACTION_STYLE[call.action] : null;
  const fresh = now - call.ts < FRESH_MS;
  return (
    <div className={cn("mx-3 mb-1.5 rounded-md border bg-slate-900/60 px-2.5 py-1.5", fresh ? "border-cyan-500/50 shadow-[0_0_0_1px_rgba(6,182,212,0.15)]" : "border-slate-700/60")}>
      <div className="flex flex-wrap items-center gap-1.5">
        {style && <span className={cn("rounded border px-1.5 py-px text-[10px] font-bold tracking-wide", style.cls)}>{style.label}</span>}
        {call.tickers.map((t) => (
          <TickerChip key={t} symbol={t} onClick={onSymbol} />
        ))}
        {call.source === "toast" && <span className="rounded bg-amber-500/15 px-1 py-px text-[9px] font-medium text-amber-300">pop-up</span>}
        <span className="ml-auto whitespace-nowrap text-[10px] text-slate-500">
          {call.author.split(" ")[0]}
          {call.channel && call.channel !== "live-stream-chat" && <span className="text-indigo-300/80"> · #{call.channel}</span>} · {call.time}
        </span>
      </div>
      <div className="mt-1 line-clamp-3 text-xs leading-snug text-slate-300">{call.text}</div>
    </div>
  );
}

/**
 * Right half of the MarketFlow Discord dock: what the room is mentioning / trading, the long-short lean
 * over a window, and trade calls from the watched traders.
 */
export function DiscordRoomIdeas({ traders, onSymbol }: { traders: string[]; onSymbol?: (symbol: string) => void }) {
  const [windowId, setWindowIdRaw] = useState(() => localStorage.getItem(WINDOW_KEY) || "15");
  const [data, setData] = useState<RoomAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ignored, setIgnored] = useState<string[]>(readIgnored);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showAllTrader, setShowAllTrader] = useState(false);
  const [chime, setChimeRaw] = useState(() => localStorage.getItem(CHIME_KEY) !== "0");
  const [now, setNow] = useState(() => Date.now());
  const lastCallSeq = useRef<number | null>(null);

  const win = WINDOWS.find((w) => w.id === windowId) ?? WINDOWS[1];
  const setWindowId = (id: string) => {
    setWindowIdRaw(id);
    localStorage.setItem(WINDOW_KEY, id);
  };
  const setChime = (on: boolean) => {
    setChimeRaw(on);
    localStorage.setItem(CHIME_KEY, on ? "1" : "0");
  };
  const ignore = (symbol: string) => {
    const next = Array.from(new Set([...ignored, symbol]));
    setIgnored(next);
    localStorage.setItem(IGNORE_KEY, JSON.stringify(next));
  };
  const resetIgnored = () => {
    setIgnored([]);
    localStorage.removeItem(IGNORE_KEY);
  };

  const traderKey = traders.join(",");
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const qs = new URLSearchParams({ traders: traderKey });
        if (win.min) qs.set("window", String(win.min));
        const res = await fetch(`/api/discord-stream/analysis?${qs}`, { credentials: "include" });
        if (!res.ok) throw new Error(`${res.status}`);
        const body = (await res.json()) as RoomAnalysis;
        if (!alive) return;
        setData(body);
        setError(null);
        setNow(Date.now());
        const newest = body.tradeCalls[0]?.seq ?? 0;
        if (lastCallSeq.current !== null && newest > lastCallSeq.current && chime) void playAlertChime();
        lastCallSeq.current = Math.max(lastCallSeq.current ?? 0, newest);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Failed to load");
      }
      if (alive) timer = setTimeout(load, POLL_MS);
    };
    load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [win.min, traderKey, chime]);

  const tickers = useMemo(() => (data?.tickers ?? []).filter((t) => !ignored.includes(t.symbol)), [data, ignored]);
  const top = tickers.slice(0, 15);
  const maxMentions = Math.max(1, ...top.map((t) => t.mentions));
  const leanLong = tickers.filter((t) => t.long > t.short).sort((a, b) => b.long - a.long || b.mentions - a.mentions).slice(0, 6);
  const leanShort = tickers.filter((t) => t.short > t.long).sort((a, b) => b.short - a.short || b.mentions - a.mentions).slice(0, 6);
  const todayStart = new Date(now).setHours(0, 0, 0, 0);
  const calls = (showAllTrader ? data?.traderMessages ?? [] : data?.tradeCalls ?? []).filter((c) => c.ts >= todayStart);
  const traderNames = traders.map((t) => t.replace(/^RealSimple/i, "").split(" ")[0]).join(" & ");

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-700/40 px-3 py-1.5">
        <Lightbulb className="h-3.5 w-3.5 text-amber-400" />
        <span className="text-xs font-medium text-slate-200">Room ideas</span>
        <div className="ml-auto flex items-center rounded-md bg-slate-800/70 p-0.5">
          {WINDOWS.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => setWindowId(w.id)}
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-medium",
                w.id === win.id ? "bg-slate-600 text-white" : "text-slate-400 hover:text-slate-200",
              )}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        {error && <div className="mx-3 mt-2 rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-300">Analysis unavailable ({error})</div>}

        <SectionTitle
          right={
            <>
              <button
                type="button"
                onClick={() => setShowAllTrader(!showAllTrader)}
                className="rounded px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              >
                {showAllTrader ? "Trade calls only" : "All their messages"}
              </button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => setChime(!chime)}
                    className={cn("rounded p-1 hover:bg-slate-800", chime ? "text-cyan-300" : "text-slate-500")}
                    data-testid="discord-trade-chime"
                  >
                    {chime ? <Bell className="h-3 w-3" /> : <BellOff className="h-3 w-3" />}
                  </button>
                </TooltipTrigger>
                <TooltipContent>{chime ? "Chime on new trade calls (on)" : "Chime on new trade calls (off)"}</TooltipContent>
              </Tooltip>
            </>
          }
        >
          {traderNames} trade calls · today
        </SectionTitle>
        {calls.length === 0 ? (
          <div className="mx-3 rounded-md border border-dashed border-slate-700/60 px-2.5 py-2 text-[11px] text-slate-500">
            {showAllTrader
              ? `No messages from ${traderNames} captured today.`
              : `No trade calls from ${traderNames} today. A post naming a ticker with a trade word (bought, added, trimmed, sold, closed, short, stopped), or any ticker post in #live-long-ideas / #live-short-ideas, shows here.`}
          </div>
        ) : (
          calls.slice(0, 12).map((c) => <TradeCallCard key={c.id} call={c} onSymbol={onSymbol} now={now} />)
        )}

        <SectionTitle
          right={
            data && (
              <span className="text-[10px] text-slate-500">
                {data.messages} msgs · {data.activeAuthors} people
              </span>
            )
          }
        >
          Most mentioned · {win.min ? `last ${win.label}` : "session"}
        </SectionTitle>
        {top.length === 0 ? (
          <div className="mx-3 rounded-md border border-dashed border-slate-700/60 px-2.5 py-2 text-[11px] text-slate-500">
            {data ? "No tickers mentioned in this window." : "Loading…"}
          </div>
        ) : (
          <div className="mx-3 overflow-hidden rounded-md border border-slate-700/60">
            {top.map((t, i) => {
              const open = expanded === t.symbol;
              const delta = t.mentions - t.prevMentions;
              return (
                <div key={t.symbol} className={cn("border-slate-700/40", i > 0 && "border-t")}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setExpanded(open ? null : t.symbol)}
                    onKeyDown={(e) => e.key === "Enter" && setExpanded(open ? null : t.symbol)}
                    className="group grid cursor-pointer grid-cols-[1rem_3.6rem_1fr_auto] items-center gap-2 px-2 py-1 hover:bg-slate-800/50"
                  >
                    {open ? <ChevronDown className="h-3 w-3 text-slate-500" /> : <ChevronRight className="h-3 w-3 text-slate-500" />}
                    <span
                      className="font-mono text-xs font-semibold text-slate-100 hover:text-cyan-300"
                      onClick={(e) => {
                        if (!onSymbol) return;
                        e.stopPropagation();
                        onSymbol(t.symbol);
                      }}
                    >
                      {t.symbol}
                    </span>
                    <div className="min-w-0">
                      <div className="mb-0.5 h-1 rounded-full bg-cyan-500/70" style={{ width: `${(t.mentions / maxMentions) * 100}%` }} />
                      <LeanBar long={t.long} short={t.short} neutral={t.neutral} />
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] tabular-nums">
                      <span className="font-semibold text-slate-200">{t.mentions}</span>
                      <span className="text-slate-500">{t.authors}p</span>
                      {t.trades > 0 && <span className="rounded bg-amber-500/15 px-1 text-amber-300">{t.trades}t</span>}
                      {win.min && (
                        <span className={cn("w-6 text-right", delta > 0 ? "text-emerald-400" : delta < 0 ? "text-rose-400" : "text-slate-600")}>
                          {t.prevMentions === 0 ? "new" : delta > 0 ? `+${delta}` : delta}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          ignore(t.symbol);
                        }}
                        className="rounded p-0.5 text-slate-600 opacity-0 hover:bg-slate-700 hover:text-slate-300 group-hover:opacity-100"
                        title={`Ignore ${t.symbol}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                  {open && (
                    <div className="space-y-1 bg-slate-950/40 px-3 py-1.5">
                      {t.recent.map((r) => (
                        <div key={r.seq} className="text-[11px] leading-snug">
                          <span className={cn("mr-1 font-semibold", r.side === "long" ? "text-emerald-400" : r.side === "short" ? "text-rose-400" : "text-slate-400")}>
                            {r.author}
                          </span>
                          <span className="text-slate-500">{r.time} </span>
                          <span className="text-slate-300">{r.text}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div className="mx-3 mt-1 flex items-center gap-3 text-[10px] text-slate-500">
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-2 rounded-sm bg-emerald-500" />
            long
          </span>
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-2 rounded-sm bg-rose-500" />
            short
          </span>
          <span>p = people · t = trade posts</span>
          {ignored.length > 0 && (
            <button type="button" onClick={resetIgnored} className="ml-auto flex items-center gap-1 hover:text-slate-300">
              <RotateCcw className="h-3 w-3" />
              {ignored.length} ignored
            </button>
          )}
        </div>

        <div className="mt-1 grid grid-cols-2 gap-2 px-3 pt-2">
          {[
            { title: "Leaning long", list: leanLong, icon: TrendingUp, tone: "text-emerald-400", count: (t: TickerStat) => t.long },
            { title: "Leaning short", list: leanShort, icon: TrendingDown, tone: "text-rose-400", count: (t: TickerStat) => t.short },
          ].map(({ title, list, icon: Icon, tone, count }) => (
            <div key={title} className="rounded-md border border-slate-700/60 bg-slate-900/40">
              <div className={cn("flex items-center gap-1 border-b border-slate-700/40 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider", tone)}>
                <Icon className="h-3 w-3" />
                {title}
              </div>
              {list.length === 0 ? (
                <div className="px-2 py-1.5 text-[11px] text-slate-500">None yet</div>
              ) : (
                list.map((t) => (
                  <div key={t.symbol} className="flex items-center justify-between px-2 py-0.5 text-[11px]">
                    <TickerChip symbol={t.symbol} onClick={onSymbol} />
                    <span className="tabular-nums text-slate-400">
                      <span className={tone}>{count(t)}</span>/{t.mentions}
                    </span>
                  </div>
                ))
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
