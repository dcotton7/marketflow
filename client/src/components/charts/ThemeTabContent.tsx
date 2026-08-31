// ---------------------------------------------------------------------------
// ThemeTabContent — the theme a charted stock belongs to, and who it trades with
//
// Shows the same member readings as the Market Flow workbench, cut down to what
// survives a side panel: symbol, change, RS rank, leader score, accumulation.
// The charted ticker is pinned to the top so it can be read against its peers
// without hunting for it.
//
// A stock that is not in any theme still gets one, worked out from its sector
// and industry or, failing that, from a model. That answer is labelled and
// offered rather than stated, with a [+] to make it real.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { ExternalLink, Plus, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useTickerTheme } from "@/hooks/useTickerTheme";
import { useThemeMembers, type ClusterId, type TickerMetrics } from "@/hooks/useMarketCondition";

function pctClass(v: number | null | undefined): string {
  if (v == null) return "text-slate-500";
  if (v > 0) return "text-green-400";
  if (v < 0) return "text-red-400";
  return "text-slate-400";
}

function fmtPct(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function fmtAccDist(days: number | null | undefined): string {
  if (days == null || days === 0) return "—";
  return days > 0 ? `A:${days}` : `D:${Math.abs(days)}`;
}

/** A one-line reading of the theme itself, above its members. */
function ThemeStat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[9px] uppercase tracking-wide text-slate-500">{label}</span>
      <span className={cn("text-[11px] font-medium tabular-nums", className ?? "text-slate-200")}>{value}</span>
    </div>
  );
}

export function ThemeTabContent({ symbol }: { symbol: string }) {
  const sym = symbol.toUpperCase();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [justAdded, setJustAdded] = useState(false);

  // Membership feeds theme scores, breadth and the scanner's theme signals, so
  // changing it is an admin act everywhere else in the app. Same rule here.
  const { data: userInfo } = useQuery<{ id: number; username: string; isAdmin: boolean }>({
    queryKey: ["/api/sentinel/me"],
  });

  const { data: theme, isLoading: themeLoading } = useTickerTheme(sym);
  const themeId = (theme?.themeId ?? null) as ClusterId | null;
  const { data: membersData, isLoading: membersLoading } = useThemeMembers(themeId);

  const isMember = theme?.source === "member";

  // Leader score descending matches Market Flow's default, so the same theme
  // reads the same way in both places. The charted ticker jumps the queue.
  const rows = useMemo<TickerMetrics[]>(() => {
    const members = [...(membersData?.members ?? [])];
    members.sort((a, b) => (b.leaderScore ?? 0) - (a.leaderScore ?? 0));
    const idx = members.findIndex((m) => m.symbol.toUpperCase() === sym);
    if (idx > 0) {
      const [current] = members.splice(idx, 1);
      members.unshift(current);
    }
    return members;
  }, [membersData, sym]);

  const addToTheme = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/market-condition/themes/${themeId}/add-tickers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ tickers: [sym] }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to add ticker" }));
        throw new Error(err.error || "Failed to add ticker");
      }
      return res.json() as Promise<{
        added?: string[];
        skipped?: string[];
        marketCapFiltered?: string[];
        conflicts?: Array<{ ticker: string; existingTheme: string }>;
      }>;
    },
    onSuccess: (result) => {
      // The endpoint answers 200 even when it declines, so say which happened
      // rather than claiming success and leaving the [+] sitting there.
      if (result.added?.includes(sym)) {
        setJustAdded(true);
        toast({ title: `${sym} added to ${theme?.themeName ?? themeId}` });
        void queryClient.invalidateQueries({ queryKey: ["/api/market-condition/ticker-theme", sym] });
        void queryClient.invalidateQueries({ queryKey: ["market-condition", "members", themeId] });
        return;
      }
      const conflict = result.conflicts?.find((c) => c.ticker === sym);
      toast({
        title: `${sym} was not added`,
        description: conflict
          ? `Already assigned to ${conflict.existingTheme}.`
          : result.marketCapFiltered?.includes(sym)
            ? "Filtered out by the theme's market cap floor."
            : "The theme declined it.",
        variant: "destructive",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Could not add ticker", description: error.message, variant: "destructive" });
    },
  });

  if (themeLoading) {
    return <div className="p-2 text-[11px] text-slate-500">Looking up theme…</div>;
  }

  if (!themeId) {
    return (
      <div className="p-2 space-y-1">
        <div className="text-[11px] text-slate-400">No theme fits {sym}.</div>
        <div className="text-[10px] text-slate-500">
          Neither its sector and industry nor the classifier could place it in one of the 26 themes.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Theme identity */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[13px] font-semibold text-slate-100 truncate">
              {theme?.themeName ?? themeId}
            </span>
            {theme?.rank != null && (
              <span className="shrink-0 rounded bg-slate-700/50 px-1 py-0.5 text-[9px] font-medium text-slate-300">
                #{theme.rank}
                {theme.totalThemes ? ` of ${theme.totalThemes}` : ""}
              </span>
            )}
          </div>
          <div className="text-[10px] text-slate-500">
            {membersData?.totalCount ?? rows.length} tickers
          </div>
        </div>
        <Link
          href={`/sentinel/market-condition?theme=${themeId}`}
          className="shrink-0 inline-flex items-center gap-0.5 text-[10px] text-cyan-400 hover:text-cyan-300"
          title="Open this theme in Market Flow"
        >
          Flow <ExternalLink className="h-2.5 w-2.5" />
        </Link>
      </div>

      {/* Not a member — say so, and offer to fix it */}
      {!isMember && !justAdded && (
        <div className="flex items-center justify-between gap-2 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-1">
          <div className="min-w-0">
            <div className="text-[10px] font-medium text-amber-300">{sym} is not in this theme</div>
            <div className="text-[9px] text-amber-200/70 truncate">
              Best fit from {theme?.source === "llm" ? "the classifier" : theme?.basis || "its sector"}
            </div>
          </div>
          {userInfo?.isAdmin && (
            <button
              type="button"
              onClick={() => addToTheme.mutate()}
              disabled={addToTheme.isPending}
              title={`Add ${sym} to ${theme?.themeName ?? themeId}`}
              className="shrink-0 inline-flex h-5 w-5 items-center justify-center rounded bg-green-600/80 text-white hover:bg-green-500 disabled:opacity-50"
              data-testid="theme-tab-add-ticker"
            >
              {addToTheme.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Plus className="h-3 w-3" />
              )}
            </button>
          )}
        </div>
      )}

      {/* Theme readings */}
      <div className="grid grid-cols-4 gap-1.5 rounded bg-slate-800/40 px-1.5 py-1">
        <ThemeStat label="Score" value={theme?.score != null ? theme.score.toFixed(0) : "—"} />
        <ThemeStat
          label="Median"
          value={fmtPct(theme?.medianPct)}
          className={cn("tabular-nums", pctClass(theme?.medianPct))}
        />
        <ThemeStat
          label="Breadth"
          value={theme?.breadthPct != null ? `${theme.breadthPct.toFixed(0)}%` : "—"}
        />
        <ThemeStat
          label="RS"
          value={theme?.rsVsBenchmark != null ? theme.rsVsBenchmark.toFixed(1) : "—"}
          className={cn("tabular-nums", pctClass(theme?.rsVsBenchmark))}
        />
      </div>

      {/* Members */}
      {membersLoading ? (
        <div className="p-2 text-[11px] text-slate-500">Loading tickers…</div>
      ) : rows.length === 0 ? (
        <div className="p-2 text-[11px] text-slate-500">No tickers reporting for this theme.</div>
      ) : (
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-[9px] uppercase tracking-wide text-slate-500">
              <th className="text-left font-medium py-0.5">Symbol</th>
              <th className="text-right font-medium py-0.5">Pct</th>
              <th className="text-right font-medium py-0.5">RS#</th>
              <th className="text-right font-medium py-0.5">Ldr</th>
              <th className="text-right font-medium py-0.5">A/D</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const isCurrent = m.symbol.toUpperCase() === sym;
              return (
                <tr
                  key={m.symbol}
                  className={cn(
                    "border-t border-slate-800/60",
                    isCurrent && "bg-cyan-500/10"
                  )}
                >
                  <td className="py-0.5 text-left">
                    <span
                      className={cn(
                        "font-medium",
                        isCurrent ? "text-cyan-300" : "text-slate-200"
                      )}
                    >
                      {m.symbol}
                    </span>
                    {m.isCore && <span className="ml-0.5 text-[9px] text-amber-400">★</span>}
                  </td>
                  <td className={cn("py-0.5 text-right tabular-nums", pctClass(m.pctChange))}>
                    {fmtPct(m.pctChange)}
                  </td>
                  <td className="py-0.5 text-right tabular-nums text-slate-400">
                    {m.rsRank ?? "—"}
                  </td>
                  <td className="py-0.5 text-right tabular-nums text-slate-300">
                    {m.leaderScore != null ? m.leaderScore.toFixed(0) : "—"}
                  </td>
                  <td
                    className={cn(
                      "py-0.5 text-right tabular-nums",
                      (m.accDistDays ?? 0) > 0
                        ? "text-green-400"
                        : (m.accDistDays ?? 0) < 0
                          ? "text-red-400"
                          : "text-slate-500"
                    )}
                  >
                    {fmtAccDist(m.accDistDays)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
