/**
 * Phase 1: ToS table capture + review. Does not write watchlists or trades.
 * Requires ToS switch on and calibrate locked on Thinkorswim.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useTosSyncSafe } from "@/context/TosSyncContext";
import { useToast } from "@/hooks/use-toast";
import { cropImageToJpeg, type CropRect } from "@/lib/crop-image";
import { canCaptureDisplay, captureDisplayJpeg } from "@/lib/capture-display";
import { formatTickersCsv, parseWatchlistTickers, type TosScreenExtractResult } from "@shared/tos-screen-extract";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, ScanSearch, Upload } from "lucide-react";

type GrabStatus = { extract: boolean };

function formatCell(n: number | null): string {
  if (n == null) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

export function TosScreenReviewDialog({
  open,
  onOpenChange,
  watchlistId,
  watchlistName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  watchlistId: number | null;
  watchlistName: string;
}) {
  const tos = useTosSyncSafe();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [importing, setImporting] = useState(false);
  const modelReady = Boolean(tos?.tosSyncEnabled && tos?.tosCalibrated);
  const fileRef = useRef<HTMLInputElement>(null);
  const imgWrapRef = useRef<HTMLDivElement>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [crop, setCrop] = useState<CropRect | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [result, setResult] = useState<TosScreenExtractResult | null>(null);
  const [tickerCsv, setTickerCsv] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: grabStatus } = useQuery<GrabStatus>({
    queryKey: ["/api/sentinel/screen-grab/status"],
    enabled: open,
    staleTime: 15_000,
  });

  useEffect(() => {
    if (open) void tos?.refreshStatus();
  }, [open, tos]);

  useEffect(() => {
    if (open) return;
    setSourceUrl(null);
    setCrop(null);
    setDragStart(null);
    setResult(null);
    setTickerCsv("");
    setError(null);
    setExtracting(false);
    setCapturing(false);
    setImporting(false);
  }, [open]);

  const loadImage = useCallback((dataUrl: string) => {
    setSourceUrl(dataUrl);
    setCrop(null);
    setResult(null);
    setTickerCsv("");
    setError(null);
  }, []);

  const onFile = async (file: File | undefined) => {
    if (!file || !file.type.startsWith("image/")) {
      toast({ title: "Need an image", description: "Upload a PNG or JPEG of the ToS table.", variant: "destructive" });
      return;
    }
    loadImage(await readFileAsDataUrl(file));
  };

  const captureDesktop = async () => {
    setCapturing(true);
    setError(null);
    try {
      loadImage(await captureDisplayJpeg());
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Desktop snapshot failed";
      setError(msg);
    } finally {
      setCapturing(false);
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = imgWrapRef.current?.getBoundingClientRect();
    if (!box) return;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    setDragStart({ x: e.clientX - box.left, y: e.clientY - box.top });
    setCrop(null);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart) return;
    const box = imgWrapRef.current?.getBoundingClientRect();
    if (!box) return;
    const x = e.clientX - box.left;
    const y = e.clientY - box.top;
    const left = Math.max(0, Math.min(dragStart.x, x));
    const top = Math.max(0, Math.min(dragStart.y, y));
    const right = Math.min(box.width, Math.max(dragStart.x, x));
    const bottom = Math.min(box.height, Math.max(dragStart.y, y));
    setCrop({ x: left, y: top, w: right - left, h: bottom - top });
  };

  const onPointerUp = () => setDragStart(null);

  const extract = async () => {
    if (!sourceUrl) return;
    if (!modelReady) {
      setError("Turn on ToS and calibrate on Thinkorswim before extracting.");
      return;
    }
    const wrap = imgWrapRef.current;
    setExtracting(true);
    setError(null);
    try {
      const imageDataUrl = await cropImageToJpeg(
        sourceUrl,
        crop,
        wrap?.clientWidth ?? 0,
        wrap?.clientHeight ?? 0,
      );
      const res = await apiRequest("POST", "/api/sentinel/screen-grab/extract", {
        model: "tos",
        imageDataUrl,
      });
      const extracted = (await res.json()) as TosScreenExtractResult;
      setResult(extracted);
      setTickerCsv(formatTickersCsv(extracted.tickers));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Extract failed");
    } finally {
      setExtracting(false);
    }
  };

  const importTickers = async () => {
    if (watchlistId == null) {
      toast({ title: "No watchlist open", description: "Select a watchlist in the manager first.", variant: "destructive" });
      return;
    }
    const symbols = parseWatchlistTickers(tickerCsv);
    if (symbols.length === 0) {
      toast({ title: "No tickers", description: "Delete extras in the box, but leave at least one valid symbol.", variant: "destructive" });
      return;
    }
    const costBySymbol = new Map(
      (result?.positions ?? []).map((row) => [row.symbol, row.avgCost] as const),
    );
    setImporting(true);
    try {
      let withEntry = 0;
      for (const symbol of symbols) {
        const avgCost = costBySymbol.get(symbol);
        const targetEntry = avgCost != null && avgCost > 0 ? avgCost : undefined;
        const created = await apiRequest("POST", "/api/sentinel/watchlist", {
          symbol,
          watchlistId,
          priority: "medium",
          ...(targetEntry != null ? { targetEntry } : {}),
        });
        const item = (await created.json()) as { id?: number; targetEntry?: number | null };
        if (targetEntry != null && item.id && item.targetEntry !== targetEntry) {
          await apiRequest("PATCH", `/api/sentinel/watchlist/${item.id}`, { targetEntry });
        }
        if (targetEntry != null) withEntry += 1;
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/sentinel/watchlist"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/sentinel/watchlists"] });
      toast({
        title: `Imported ${symbols.length} to ${watchlistName}`,
        description:
          withEntry > 0
            ? `${withEntry} with ToS avg cost as planned entry.`
            : "No avg cost on those rows — symbols only.",
      });
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Import failed",
        description: err instanceof Error ? err.message : "Could not add tickers",
        variant: "destructive",
      });
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>ToS screen review</DialogTitle>
          <DialogDescription>
            First trained model: Thinkorswim watchlist / positions table. Edit the ticker list, then
            import into the open watchlist. ToS Avg Cost is saved as planned entry so you can monitor
            those positions. Qty is not stored.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
            {modelReady ? (
              <span className="text-emerald-400">ToS on and calibrated — ToS table model is active.</span>
            ) : (
              <span className="text-amber-400">
                Turn on ToS (Charts or Flow) and calibrate on the Thinkorswim symbol box before
                extracting.
              </span>
            )}
            {grabStatus && !grabStatus.extract && (
              <p className="mt-1 text-destructive">Table extract is not configured on this host.</p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
              <Upload className="mr-1 h-4 w-4" />
              Upload screenshot
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!canCaptureDisplay() || capturing}
              onClick={() => void captureDesktop()}
            >
              {capturing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <ScanSearch className="mr-1 h-4 w-4" />}
              Snapshot window
            </Button>
            <span className="text-xs text-muted-foreground">pick Thinkorswim, or paste an image</span>
          </div>

          {sourceUrl && (
            <div className="rounded-md border border-amber-400/60 bg-amber-500/15 px-3 py-2 text-center text-sm font-medium text-amber-200">
              Draw a box around your list of tickers.
            </div>
          )}

          <div
            className="rounded-md border border-dashed border-border p-2"
            tabIndex={0}
            onPaste={(e) => {
              const file = [...e.clipboardData.files].find((f) => f.type.startsWith("image/"));
              if (file) void onFile(file);
            }}
          >
            {sourceUrl ? (
              <div className="relative">
                <div className="flex max-h-[40vh] justify-center overflow-auto">
                <div
                  ref={imgWrapRef}
                  className="relative inline-block cursor-crosshair"
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                >
                  <img
                    src={sourceUrl}
                    alt="ToS capture"
                    className="block max-h-[40vh] max-w-full select-none"
                    draggable={false}
                  />
                  {crop && crop.w > 4 && crop.h > 4 && (
                    <div
                      className="pointer-events-none absolute border-2 border-emerald-400 bg-emerald-400/10"
                      style={{ left: crop.x, top: crop.y, width: crop.w, height: crop.h }}
                    />
                  )}
                </div>
                </div>
                {!(crop && crop.w > 4 && crop.h > 4) && (
                  <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
                    <span className="rounded bg-black/75 px-3 py-1.5 text-sm font-semibold text-amber-200 shadow-lg">
                      Draw a box around your list of tickers
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <p className="py-8 text-center text-xs text-muted-foreground">
                Upload, paste, or snapshot the Thinkorswim window, then draw a box around your list of tickers.
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={!sourceUrl || extracting || !modelReady}
              onClick={() => void extract()}
            >
              {extracting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              Extract ToS table
            </Button>
            {crop ? (
              <Button type="button" size="sm" variant="ghost" onClick={() => setCrop(null)}>
                Clear crop
              </Button>
            ) : (
              <span className="text-sm font-medium text-amber-200">Draw a box around your list of tickers.</span>
            )}
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          {result && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Layout: {result.layout} · {result.tickers.length} symbols ·{" "}
                {result.positions.filter((p) => p.hasPosition).length} with qty · review only
              </p>
              <div className="max-h-[28vh] overflow-auto rounded-md border border-border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-background">
                    <tr className="text-left text-muted-foreground">
                      <th className="px-2 py-1">Symbol</th>
                      <th className="px-2 py-1">Avg Cost</th>
                      <th className="px-2 py-1">Pos Qty</th>
                      <th className="px-2 py-1">Last</th>
                      <th className="px-2 py-1">Position</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.positions.map((row) => (
                      <tr key={row.symbol} className="border-t border-border/60">
                        <td className="px-2 py-1 font-medium">{row.symbol}</td>
                        <td className="px-2 py-1">{formatCell(row.avgCost)}</td>
                        <td className="px-2 py-1">{formatCell(row.posQty)}</td>
                        <td className="px-2 py-1">{formatCell(row.lastPrice)}</td>
                        <td className="px-2 py-1">{row.hasPosition ? "yes" : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <textarea
                className="h-16 w-full rounded-md border border-border bg-background p-2 font-mono text-xs"
                value={tickerCsv}
                onChange={(e) => setTickerCsv(e.target.value)}
                spellCheck={false}
                aria-label="Tickers to import"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={
                    importing ||
                    watchlistId == null ||
                    parseWatchlistTickers(tickerCsv).length === 0
                  }
                  onClick={() => void importTickers()}
                >
                  {importing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                  Import Tickers
                </Button>
                <span className="text-xs text-muted-foreground">
                  {watchlistId == null
                    ? "Open a watchlist first."
                    : `${parseWatchlistTickers(tickerCsv).length} symbols → ${watchlistName}`}
                </span>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
