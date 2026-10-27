import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNamedWatchlistItems, useWatchlists } from "@/hooks/use-watchlist";
import { watchlistQuotesUrl } from "@/lib/watchlist-entry-gauges";
import { postToHost } from "@/lib/embed-host";
import { cn } from "@/lib/utils";

const PICK_KEY = "embed-watchlist-pick";
const REFRESH_MS = 15_000;

interface Quote {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
}

type Sort = "symbol" | "changePercent";

/**
 * /embed/watchlist — a named watchlist with live quotes for an Anima Lab panel. Read-only: pick a list, sort, and
 * click a row to open that ticker's big chart in Anima. Lists are edited in MarketFlow itself.
 */
export default function EmbedWatchlistPage() {
  const { data: lists } = useWatchlists();
  const [picked, setPicked] = useState<number | null>(() => Number(localStorage.getItem(PICK_KEY)) || null);
  const [sort, setSort] = useState<Sort>("changePercent");

  const listId = useMemo(() => {
    if (picked != null && lists?.some((l) => l.id === picked)) return picked;
    return lists?.find((l) => l.isDefault)?.id ?? lists?.[0]?.id ?? null;
  }, [picked, lists]);

  useEffect(() => {
    if (picked != null) localStorage.setItem(PICK_KEY, String(picked));
  }, [picked]);

  useEffect(() => {
    postToHost({ type: "ready", page: "watchlist" });
  }, []);

  const { data: items } = useNamedWatchlistItems(listId);
  const symbols = useMemo(() => (items ?? []).map((i) => i.symbol.trim().toUpperCase()), [items]);

  const { data: quotes, dataUpdatedAt } = useQuery<Quote[]>({
    queryKey: ["embedWatchlistQuotes", symbols.join(",")],
    queryFn: async () => {
      const res = await fetch(watchlistQuotesUrl(symbols, { extended: true }), { credentials: "include" });
      if (!res.ok) return [];
      const raw = (await res.json()) as unknown;
      if (!Array.isArray(raw)) return [];
      return raw.map((r: Record<string, unknown>) => ({
        symbol: String(r.symbol ?? "").toUpperCase(),
        price: Number(r.price ?? r.last ?? 0) || 0,
        change: Number(r.change ?? 0) || 0,
        changePercent: Number(r.changePercent ?? r.change_pct ?? 0) || 0,
      }));
    },
    enabled: symbols.length > 0,
    refetchInterval: REFRESH_MS,
  });

  const rows = useMemo(() => {
    const at = new Map((quotes ?? []).map((q) => [q.symbol, q]));
    const out = symbols.map((s) => at.get(s) ?? { symbol: s, price: 0, change: 0, changePercent: 0 });
    return out.sort((a, b) =>
      sort === "symbol" ? a.symbol.localeCompare(b.symbol) : b.changePercent - a.changePercent,
    );
  }, [symbols, quotes, sort]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-950 text-slate-100">
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-800 px-2 py-1.5 text-xs">
        <select
          value={listId ?? ""}
          onChange={(e) => setPicked(Number(e.target.value) || null)}
          className="h-7 rounded border border-slate-700 bg-slate-900 px-1.5 text-xs"
          data-testid="embed-watchlist-pick"
        >
          {(lists ?? []).map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <span className="flex-1" />
        <span className="text-slate-500">
          {dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ""}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-slate-900 text-slate-400">
            <tr>
              <th className="cursor-pointer px-2 py-1 text-left" onClick={() => setSort("symbol")}>Ticker</th>
              <th className="px-2 py-1 text-right">Price</th>
              <th className="cursor-pointer px-2 py-1 text-right" onClick={() => setSort("changePercent")}>Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.symbol}
                onClick={() => postToHost({ type: "open-big", symbol: r.symbol })}
                className="cursor-pointer border-b border-slate-900 hover:bg-slate-800/60"
              >
                <td className="px-2 py-1 font-mono font-semibold">{r.symbol}</td>
                <td className="px-2 py-1 text-right font-mono">{r.price > 0 ? r.price.toFixed(2) : "—"}</td>
                <td
                  className={cn(
                    "px-2 py-1 text-right font-mono",
                    r.changePercent > 0 ? "text-emerald-400" : r.changePercent < 0 ? "text-rose-400" : "text-slate-400",
                  )}
                >
                  {r.price > 0 ? `${r.changePercent > 0 ? "+" : ""}${r.changePercent.toFixed(2)}%` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {lists && symbols.length === 0 && (
          <div className="p-4 text-center text-xs text-slate-500">This list is empty.</div>
        )}
      </div>
    </div>
  );
}
