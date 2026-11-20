import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNamedWatchlistItems, usePasteToWatchlist } from "@/hooks/use-watchlist";
import { parsePositionPaste, positionPreview } from "@shared/position-paste";
import { parseTickerPaste, pastePreview } from "@shared/ticker-paste";
import { cn } from "@/lib/utils";

/**
 * Paste a Schwab or thinkorswim table, a CSV export or a plain list; shows what it found before adding. In a
 * portfolio list the pasted quantity and cost fill shares and entry.
 */
export function TickerPasteBox({
  watchlistId,
  isPortfolio,
  onDone,
  className,
}: {
  watchlistId: number | null;
  isPortfolio: boolean;
  onDone?: (message: string) => void;
  className?: string;
}) {
  const [text, setText] = useState("");
  const [result, setResult] = useState("");
  // Portfolio lists: "Fill" sets shares and cost on rows already in the list, after showing what was understood.
  const [mode, setMode] = useState<"add" | "fill">("add");
  const bulkAdd = usePasteToWatchlist();
  const { data: items } = useNamedWatchlistItems(isPortfolio ? watchlistId : null);
  const fill = useMemo(
    () => parsePositionPaste(text, (items ?? []).map((i) => i.symbol)),
    [text, items],
  );
  const fillOk = fill.rows.filter((r) => r.status === "ok");
  const current = (sym: string) => (items ?? []).find((i) => i.symbol.trim().toUpperCase() === sym);

  const save = async () => {
    if (!watchlistId || fillOk.length === 0) return;
    try {
      const r = await bulkAdd.mutateAsync({
        watchlistId,
        update: true,
        items: fillOk.map((t) => ({ symbol: t.symbol, shares: t.shares, entry: t.entry, ...(t.short ? { short: true } : {}) })),
      });
      const n = r.updated?.length ?? 0;
      const msg = `Saved shares and cost on ${n} row${n === 1 ? "" : "s"}`;
      setText("");
      setResult(msg);
      onDone?.(msg);
    } catch (e) {
      setResult(e instanceof Error ? e.message : "Failed to save");
    }
  };
  const parsed = useMemo(() => parseTickerPaste(text), [text]);
  const withPositions = isPortfolio && parsed.tickers.some((t) => t.shares != null || t.entry != null);

  const add = async () => {
    if (!watchlistId || parsed.tickers.length === 0) return;
    try {
      const r = await bulkAdd.mutateAsync({
        watchlistId,
        items: parsed.tickers.map((t) => ({
          symbol: t.symbol,
          shares: isPortfolio ? t.shares : null,
          entry: isPortfolio ? t.entry : null,
          ...(isPortfolio && t.short != null ? { short: t.short } : {}),
        })),
      });
      const msg =
        `Added ${r.added.length}` +
        (r.existing.length ? `, ${r.existing.length} already in the list` : "") +
        (r.invalid.length ? `, ${r.invalid.length} refused` : "");
      setText("");
      setResult(msg);
      onDone?.(msg);
    } catch (e) {
      setResult(e instanceof Error ? e.message : "Failed to add tickers");
    }
  };

  const filling = isPortfolio && mode === "fill";
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {isPortfolio && (
        <div className="flex gap-1 text-[11px]" role="tablist">
          {(["add", "fill"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => {
                setMode(m);
                setResult("");
              }}
              className={cn(
                "rounded border px-1.5 py-0.5",
                mode === m ? "border-cyan-600 text-cyan-300" : "border-slate-700 text-slate-400",
              )}
              data-testid={`ticker-paste-mode-${m}`}
            >
              {m === "add" ? "Add tickers" : "Fill shares & cost"}
            </button>
          ))}
        </div>
      )}
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setResult("");
        }}
        placeholder={
          filling
            ? "One per line: TICKER shares cost (cost per share). Tabs, commas or spaces; or a broker export"
            : "Paste from Schwab, thinkorswim, a CSV export, or a list (AAPL, MSFT)"
        }
        onKeyDown={(e) => {
          if (filling && e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void save();
          }
        }}
        rows={4}
        className="w-full resize-y rounded border border-slate-600 bg-slate-950 p-1.5 font-mono text-[11px] text-slate-100 placeholder:text-slate-500"
        data-testid="ticker-paste-box"
      />
      {filling ? (
        <>
          <div className="flex items-center gap-2 text-[11px]">
            <span className="flex-1 text-slate-400" data-testid="ticker-paste-preview">
              {text.trim() ? positionPreview(fill.rows) : result}
            </span>
            <Button size="sm" className="h-7" onClick={save} disabled={!watchlistId || fillOk.length === 0 || bulkAdd.isPending} data-testid="ticker-paste-save">
              {bulkAdd.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Save {fillOk.length || ""}
            </Button>
          </div>
          {text.trim() && fill.rows.length > 0 && (
            <div className="max-h-32 overflow-auto text-[11px]" data-testid="ticker-paste-fill-rows">
              <table className="w-full font-mono">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="font-normal">Ticker</th>
                    <th className="text-right font-normal">Shares</th>
                    <th className="text-right font-normal">Cost</th>
                    <th className="pl-2 font-normal">Understood as</th>
                  </tr>
                </thead>
                <tbody>
                  {fill.rows.map((r) => {
                    const now = current(r.symbol);
                    const changes = [
                      r.status === "ok" && now?.shares != null && now.shares !== r.shares ? `shares ${now.shares} → ${r.shares}` : "",
                      r.status === "ok" && r.entry != null && now?.targetEntry != null && now.targetEntry !== r.entry ? `cost ${now.targetEntry} → ${r.entry}` : "",
                    ].filter(Boolean);
                    return (
                      <tr key={r.symbol} className={r.status === "ok" ? "text-slate-200" : "text-amber-400"}>
                        <td>{r.symbol}</td>
                        <td className="text-right">{r.shares != null ? `${r.short ? "-" : ""}${r.shares}` : "—"}</td>
                        <td className="text-right">{r.entry != null ? r.entry : "—"}</td>
                        <td className="pl-2">
                          {r.status === "ok" ? (changes.length ? `replaces ${changes.join(", ")}` : "ok") : r.status}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <>
      <div className="flex items-center gap-2 text-[11px]">
        <span className="flex-1 text-slate-400" data-testid="ticker-paste-preview">
          {text.trim() ? pastePreview(parsed) + (withPositions ? "; shares and entry filled" : "") : result}
        </span>
        <Button
          size="sm"
          className="h-7"
          onClick={add}
          disabled={!watchlistId || parsed.tickers.length === 0 || bulkAdd.isPending}
        >
          {bulkAdd.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Add {parsed.tickers.length || ""}
        </Button>
      </div>
      {text.trim() && parsed.tickers.length > 0 && (
        <div className="max-h-20 overflow-auto text-[11px] text-slate-300">
          {parsed.tickers.map((t) => (
            <span key={t.symbol} className="mr-2 inline-block font-mono" title={t.option ? `from ${t.option}` : undefined}>
              {t.symbol}
              {t.option ? "*" : ""}
              {isPortfolio && t.shares != null ? ` ×${t.shares}` : ""}
            </span>
          ))}
          {parsed.tickers.some((t) => t.option) && <span className="text-slate-500">* from an option</span>}
        </div>
      )}
        </>
      )}
    </div>
  );
}
