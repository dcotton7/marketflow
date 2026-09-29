// ---------------------------------------------------------------------------
// ThemeTabContent — the theme a charted stock belongs to, and who it trades with
//
// Shows the same member readings as the Market Flow workbench, cut down to what
// survives a side panel: symbol, change, RS rank, leader score, accumulation.
// Headers sort the list. The charted ticker stays highlighted.
//
// A stock that is not in any theme still gets one, worked out from its sector
// and industry or, failing that, from a model. That answer is labelled and
// offered rather than stated, with a [+] to make it real.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { ChevronDown, ChevronUp, ExternalLink, Plus, Loader2 } from "lucide-react";
import { EntryGaugeValue } from "@/components/EntryGaugeValue";
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

type ThemeSortKey = "symbol" | "pct" | "vwap" | "ema620" | "rs" | "ldr" | "ad";

function compareMissingLast(
  a: number | null | undefined,
  b: number | null | undefined,
  dir: number
): number {
  const aMissing = a == null || Number.isNaN(a);
  const bMissing = b == null || Number.isNaN(b);
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  return (a - b) * dir;
}

function compareThemeRows(a: TickerMetrics, b: TickerMetrics, key: ThemeSortKey, dir: number): number {
  switch (key) {
    case "symbol":
      return a.symbol.localeCompare(b.symbol) * dir;
    case "pct":
      return compareMissingLast(a.pctChange, b.pctChange, dir);
    case "vwap":
      return compareMissingLast(a.vwapPct, b.vwapPct, dir);
    case "ema620":
      return compareMissingLast(a.ema620Pct, b.ema620Pct, dir);
    case "rs":
      return compareMissingLast(a.rsRank, b.rsRank, dir);
    case "ldr":
      return compareMissingLast(a.leaderScore, b.leaderScore, dir);
    case "ad":
      return compareMissingLast(a.accDistDays, b.accDistDays, dir);
  }
}

function SortTh({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  align = "right",
  title,
  className,
}: {
  label: string;
  sortKey: ThemeSortKey;
  activeKey: ThemeSortKey;
  dir: "asc" | "desc";
  onSort: (key: ThemeSortKey) => void;
  align?: "left" | "right";
  title?: string;
  className?: string;
}) {
  const active = activeKey === sortKey;
  return (
    <th className={cn("py-0.5 font-medium", align === "left" ? "text-left pr-1" : "text-right", className)}>
      <button
        type="button"
        title={title ?? `Sort by ${label}`}
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex items-center gap-0.5 uppercase tracking-wide hover:text-slate-200",
          align === "right" && "ml-auto",
          className
        )}
      >
        {label}
        {active ? (
          dir === "asc" ? <ChevronUp className="h-2.5 w-2.5" /> : <ChevronDown className="h-2.5 w-2.5" />
        ) : null}
      </button>
    </th>
  );
}

/** A one-line reading of the theme itself, above its members. */
function ThemeStat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[0.64em] uppercase tracking-wide text-slate-500">{label}</span>
      <span className={cn("text-[0.8em] font-medium tabular-nums", className ?? "text-slate-200")}>{value}</span>
    </div>
  );
}

export function ThemeTabContent({ symbol }: { symbol: string }) {
  const sym = symbol.toUpperCase();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [justAdded, setJustAdded] = useState(false);
  const [sortKey, setSortKey] = useState<ThemeSortKey>("ldr");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Membership feeds theme scores, breadth and the scanner's theme signals, so
  // changing it is an admin act everywhere else in the app. Same rule here.
  const { data: userInfo } = useQuery<{ id: number; username: string; isAdmin: boolean }>({
    queryKey: ["/api/sentinel/me"],
  });

  const { data: theme, isLoading: themeLoading } = useTickerTheme(sym);
  const themeId = (theme?.themeId ?? null) as ClusterId | null;
  const { data: membersData, isLoading: membersLoading } = useThemeMembers(themeId);

  const isMember = theme?.source === "member";

  const rows = useMemo<TickerMetrics[]>(() => {
    const members = [...(membersData?.members ?? [])];
    const dir = sortDir === "asc" ? 1 : -1;
    members.sort((a, b) => compareThemeRows(a, b, sortKey, dir));
    return members;
  }, [membersData, sortKey, sortDir]);

  const toggleSort = (key: ThemeSortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir(key === "symbol" || key === "rs" ? "asc" : "desc");
  };

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
    return <div className="p-2 text-[0.8em] text-slate-500">Looking up theme…</div>;
  }

  if (!themeId) {
    return (
      <div className="p-2 space-y-1">
        <div className="text-[0.8em] text-slate-400">No theme fits {sym}.</div>
        <div className="text-[0.72em] text-slate-500">
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
            <span className="text-[0.95em] font-semibold text-slate-100 truncate">
              {theme?.themeName ?? themeId}
            </span>
            {theme?.rank != null && (
              <span className="shrink-0 rounded bg-slate-700/50 px-1 py-0.5 text-[0.64em] font-medium text-slate-300">
                #{theme.rank}
                {theme.totalThemes ? ` of ${theme.totalThemes}` : ""}
              </span>
            )}
          </div>
          <div className="text-[0.72em] text-slate-500">
            {membersData?.totalCount ?? rows.length} tickers
          </div>
        </div>
        <Link
          href={`/sentinel/market-condition?theme=${themeId}`}
          className="shrink-0 inline-flex items-center gap-0.5 text-[0.72em] text-cyan-400 hover:text-cyan-300"
          title="Open this theme in Market Flow"
        >
          Flow <ExternalLink className="h-2.5 w-2.5" />
        </Link>
      </div>

      {/* Not a member — say so, and offer to fix it */}
      {!isMember && !justAdded && (
        <div className="flex items-center justify-between gap-2 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-1">
          <div className="min-w-0">
            <div className="text-[0.72em] font-medium text-amber-300">{sym} is not in this theme</div>
            <div className="text-[0.64em] text-amber-200/70 truncate">
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
      <div className="flex flex-wrap gap-x-3 gap-y-1 rounded bg-slate-800/40 px-1.5 py-1">
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
        <div className="p-2 text-[0.8em] text-slate-500">Loading tickers…</div>
      ) : rows.length === 0 ? (
        <div className="p-2 text-[0.8em] text-slate-500">No tickers reporting for this theme.</div>
      ) : (
        <div className="overflow-x-auto">
        <table className="w-max border-separate border-spacing-x-2 text-[0.8em] whitespace-nowrap">
          <thead>
            <tr className="text-[0.72em] uppercase tracking-wide text-slate-500">
              <SortTh label="Symbol" sortKey="symbol" activeKey={sortKey} dir={sortDir} align="left" onSort={toggleSort} />
              <SortTh label="Pct" sortKey="pct" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
              <SortTh
                label="VWAP"
                sortKey="vwap"
                activeKey={sortKey}
                dir={sortDir}
                onSort={toggleSort}
                title="Percent above or below session VWAP"
                className="text-yellow-400"
              />
              <SortTh label="6/20" sortKey="ema620" activeKey={sortKey} dir={sortDir} onSort={toggleSort} title="5-minute 6/20 EMA. × marks a fresh cross." />
              <SortTh label="RS#" sortKey="rs" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
              <SortTh label="Ldr" sortKey="ldr" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
              <SortTh label="A/D" sortKey="ad" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
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
                    <Link
                      href={`/sentinel/charts?symbol=${encodeURIComponent(m.symbol)}`}
                      className={cn(
                        "font-medium hover:underline",
                        isCurrent ? "text-cyan-300" : "text-slate-200 hover:text-cyan-300"
                      )}
                      title={isCurrent ? m.symbol : `Open ${m.symbol}`}
                    >
                      {m.symbol}
                    </Link>
                    {m.isCore && <span className="ml-0.5 text-[0.75em] text-amber-400">★</span>}
                  </td>
                  <td className={cn("py-0.5 text-right tabular-nums", pctClass(m.pctChange))}>
                    {fmtPct(m.pctChange)}
                  </td>
                  <td className="py-0.5 text-right">
                    <EntryGaugeValue kind="vwap" pct={m.vwapPct} tone={m.vwapTone} />
                  </td>
                  <td className="py-0.5 text-right">
                    <EntryGaugeValue
                      kind="ema620"
                      pct={m.ema620Pct}
                      tone={m.ema620Tone}
                      cross={m.ema620Cross}
                    />
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
        </div>
      )}
    </div>
  );
}
