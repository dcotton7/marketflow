import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, Sparkles, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface RoomIdea {
  symbol: string;
  side: "long" | "short" | "mixed";
  conviction: "high" | "medium" | "low";
  who: string[];
  why: string;
}

interface GroupThink {
  theme: string;
  symbols: string[];
  note: string;
  caution: string;
}

interface RoomSummary {
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

const SIDE_STYLE: Record<RoomIdea["side"], string> = {
  long: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  short: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  mixed: "bg-slate-500/20 text-slate-300 border-slate-500/40",
};

const CONVICTION_DOTS: Record<RoomIdea["conviction"], number> = { high: 3, medium: 2, low: 1 };

function Symbol({ symbol, onClick }: { symbol: string; onClick?: (s: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onClick?.(symbol)}
      className="rounded bg-slate-800 px-1.5 py-px font-mono text-[11px] font-semibold text-slate-100 hover:bg-cyan-500/20 hover:text-cyan-200"
    >
      {symbol}
    </button>
  );
}

/**
 * "AI summary · last hour" in the Discord Room ideas column. Runs only on the button: the last hour of
 * captured messages (with the reader's per-person weights) goes to OpenAI and comes back as ideas / group think.
 */
export function DiscordRoomSummary({ weights, onSymbol }: { weights: Record<string, number>; onSymbol?: (s: string) => void }) {
  const [summary, setSummary] = useState<RoomSummary | null>(null);
  const [aiAvailable, setAiAvailable] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/discord-stream/summary", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { aiAvailable: boolean; summary: RoomSummary | null } | null) => {
        if (!body) return;
        setAiAvailable(body.aiAvailable);
        setSummary(body.summary);
      })
      .catch(() => {});
  }, []);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/discord-stream/summary", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minutes: 60, weights }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `${res.status}`);
      setSummary(body.summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Summary failed");
    } finally {
      setBusy(false);
    }
  };

  const ageMin = summary ? Math.round((Date.now() - Date.parse(summary.generatedAt)) / 60_000) : 0;

  return (
    <div className="mx-3 mt-3 rounded-md border border-violet-500/30 bg-violet-500/[0.05]">
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <Sparkles className="h-3.5 w-3.5 text-violet-300" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-violet-200">AI summary · last hour</span>
        <Button
          size="sm"
          className="ml-auto h-6 gap-1 bg-violet-600 px-2 text-[11px] text-white hover:bg-violet-500"
          onClick={run}
          disabled={busy || !aiAvailable}
          data-testid="discord-summarize"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          {busy ? "Reading the room…" : summary ? "Refresh" : "Summarize last hour"}
        </Button>
      </div>

      {!aiAvailable && <div className="px-2.5 pb-2 text-[11px] text-slate-400">OpenAI key is not configured on this PC.</div>}
      {error && <div className="mx-2.5 mb-2 rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-300">{error}</div>}
      {!summary && !busy && aiAvailable && !error && (
        <div className="px-2.5 pb-2 text-[11px] leading-snug text-slate-500">
          Sends the last hour of captured messages to OpenAI and returns the ideas the room is converging on, group think, and what Nick and Ari did.
          People you weighted count 25% more or less.
        </div>
      )}

      {summary && (
        <div className="space-y-2 border-t border-violet-500/20 px-2.5 py-2">
          {summary.headline && <div className="text-xs font-medium leading-snug text-slate-100">{summary.headline}</div>}
          {summary.mood && <div className="text-[11px] italic text-violet-200/80">Mood: {summary.mood}</div>}

          {summary.ideas.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Ideas</div>
              {summary.ideas.map((i, n) => (
                <div key={`${i.symbol}-${n}`} className="rounded border border-slate-700/60 bg-slate-900/50 px-2 py-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Symbol symbol={i.symbol} onClick={onSymbol} />
                    <span className={cn("rounded border px-1 py-px text-[9px] font-bold uppercase", SIDE_STYLE[i.side])}>{i.side}</span>
                    <span className="flex gap-0.5" title={`${i.conviction} conviction`}>
                      {[0, 1, 2].map((d) => (
                        <span key={d} className={cn("h-1.5 w-1.5 rounded-full", d < CONVICTION_DOTS[i.conviction] ? "bg-violet-300" : "bg-slate-700")} />
                      ))}
                    </span>
                    {i.who.length > 0 && <span className="ml-auto truncate text-[10px] text-slate-500">{i.who.join(", ")}</span>}
                  </div>
                  {i.why && <div className="mt-0.5 text-[11px] leading-snug text-slate-300">{i.why}</div>}
                </div>
              ))}
            </div>
          )}

          {summary.groupThink.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                <Users className="h-3 w-3" /> Group think
              </div>
              {summary.groupThink.map((g, n) => (
                <div key={n} className="rounded border border-amber-500/25 bg-amber-500/[0.05] px-2 py-1">
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="text-[11px] font-medium text-amber-200">{g.theme}</span>
                    {g.symbols.map((s) => (
                      <Symbol key={s} symbol={s} onClick={onSymbol} />
                    ))}
                  </div>
                  {g.note && <div className="mt-0.5 text-[11px] leading-snug text-slate-300">{g.note}</div>}
                  {g.caution && (
                    <div className="mt-0.5 flex gap-1 text-[11px] leading-snug text-amber-300/90">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                      {g.caution}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {summary.staffMoves.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Nick &amp; Ari</div>
              <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-[11px] leading-snug text-slate-300">
                {summary.staffMoves.map((s, n) => (
                  <li key={n}>{s}</li>
                ))}
              </ul>
            </div>
          )}

          {summary.watchOuts.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Watch outs</div>
              <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-[11px] leading-snug text-slate-300">
                {summary.watchOuts.map((s, n) => (
                  <li key={n}>{s}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="text-[10px] text-slate-500">
            {summary.messageCount} messages from {summary.authorCount} people · {summary.model} ·{" "}
            {ageMin < 1 ? "just now" : `${ageMin} min ago`}
          </div>
        </div>
      )}
    </div>
  );
}
