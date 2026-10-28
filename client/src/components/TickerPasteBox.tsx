import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePasteToWatchlist } from "@/hooks/use-watchlist";
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
  const bulkAdd = usePasteToWatchlist();
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

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setResult("");
        }}
        placeholder="Paste from Schwab, thinkorswim, a CSV export, or a list (AAPL, MSFT)"
        rows={4}
        className="w-full resize-y rounded border border-slate-600 bg-slate-950 p-1.5 font-mono text-[11px] text-slate-100 placeholder:text-slate-500"
        data-testid="ticker-paste-box"
      />
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
    </div>
  );
}
