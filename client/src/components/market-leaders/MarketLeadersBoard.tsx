import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Crown, LineChart, Loader2, Pin, RotateCcw } from "lucide-react";
import { ScanChartViewer } from "@/components/bigidea/ScanChartViewer";
import { ChartTickerChip } from "@/components/chart/ChartTickerChip";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EntryGaugeValue } from "@/components/EntryGaugeValue";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { marketDateOrNull } from "@shared/market-leaders/dates";
import {
  SPEC_FIELDS,
  V1_SPEC,
  specsEqual,
  type LeaderPool,
  type MarketLeadersSpec,
} from "@shared/market-leaders/spec";
import type { Ema620Cross, EntryGaugeTone } from "@shared/entry-gauge";
import type { LeaderRow, LeaderStatus, SpanRow } from "@shared/market-leaders/rank";

interface Mark {
  symbol: string;
  points: number;
  pinned: boolean;
}

interface GaugeRow extends LeaderRow {
  vwapPct?: number | null;
  vwapTone?: EntryGaugeTone | null;
  ema620Pct?: number | null;
  ema620Cross?: Ema620Cross | null;
  ema620Tone?: EntryGaugeTone | null;
}

interface BookResponse {
  pool: LeaderPool;
  spec: MarketLeadersSpec;
  asOf: string;
  from: string | null;
  mode: "close" | "span";
  live: boolean;
  rows: GaugeRow[];
  left: LeaderRow[];
  span: SpanRow[] | null;
  tracked: LeaderRow[];
  marks: Mark[];
  counts: { onBook: number; atRisk: number; joinedThisWeek: number; droppedThisWeek: number };
  error?: string;
}

const STATUS_WORD: Record<LeaderStatus, string> = {
  on: "On book",
  at_risk: "At risk",
  left: "Left",
};

function shownScore(score: number, points: number): number {
  return score + points;
}

function Tip({ text, children }: { text: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help">{children}</span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

function bookErrorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : "Could not load the book";
  const body = raw.replace(/^\d+:\s*/, "");
  try {
    const parsed = JSON.parse(body) as { error?: string };
    if (parsed.error) return parsed.error;
  } catch {
    /* the status line is already readable */
  }
  return raw;
}

export function MarketLeadersBoard({ mode }: { mode: "page" | "widget" }) {
  const queryClient = useQueryClient();
  const prefs = useQuery({
    queryKey: ["/api/market-leaders/prefs"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/market-leaders/prefs");
      return (await res.json()) as { pool: LeaderPool; spec: MarketLeadersSpec };
    },
  });

  const [pool, setPool] = useState<LeaderPool>("universe");
  const [spec, setSpec] = useState<MarketLeadersSpec>(V1_SPEC);
  const [savedSpec, setSavedSpec] = useState<MarketLeadersSpec>(V1_SPEC);
  const [asOf, setAsOf] = useState("");
  const [through, setThrough] = useState("");
  const [ready, setReady] = useState(false);
  const [openSymbol, setOpenSymbol] = useState<string | null>(null);
  const [chartOpen, setChartOpen] = useState(false);
  const [chartIndex, setChartIndex] = useState(0);
  const [prompt, setPrompt] = useState("");
  const [note, setNote] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (ready) return;
    if (prefs.data) {
      setPool(prefs.data.pool);
      setSpec(prefs.data.spec);
      setSavedSpec(prefs.data.spec);
      setReady(true);
      return;
    }
    if (prefs.isError) setReady(true);
  }, [prefs.data, prefs.isError, ready]);

  const asOfDate = marketDateOrNull(asOf);
  const throughDate = marketDateOrNull(through);
  const datesSeeded = useRef(false);
  const dateWarning =
    (asOf.trim() !== "" && !asOfDate) || (through.trim() !== "" && !throughDate)
      ? "That date isn’t usable. The book stays on the last good close."
      : null;

  const book = useQuery({
    queryKey: ["/api/market-leaders/book", mode, pool, asOfDate, throughDate, spec],
    enabled: ready,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/market-leaders/book", {
        pool,
        spec,
        asOf: asOfDate,
        through: throughDate,
      });
      return (await res.json()) as BookResponse;
    },
  });

  useEffect(() => {
    if (!book.data || book.isPlaceholderData || book.isFetching || datesSeeded.current) return;
    if (asOf !== "" || through !== "") return;
    datesSeeded.current = true;
    setAsOf(book.data.from ?? book.data.asOf);
    setThrough(book.data.asOf);
  }, [book.data, book.isPlaceholderData, book.isFetching, asOf, through]);

  const savePrefs = useMutation({
    mutationFn: async (next: { pool: LeaderPool; spec: MarketLeadersSpec }) => {
      const res = await apiRequest("PUT", "/api/market-leaders/prefs", next);
      return (await res.json()) as { pool: LeaderPool; spec: MarketLeadersSpec };
    },
    onSuccess: (saved) => {
      setSavedSpec(saved.spec);
      setPool(saved.pool);
      queryClient.invalidateQueries({ queryKey: ["/api/market-leaders/prefs"] });
    },
  });

  const saveMark = useMutation({
    mutationFn: async (mark: Mark) => {
      const res = await apiRequest("POST", "/api/market-leaders/marks", mark);
      return (await res.json()) as Mark;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/market-leaders/book"] });
    },
  });

  const interpret = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/market-leaders/interpret", { prompt, spec });
      return (await res.json()) as { spec: MarketLeadersSpec; note: string; rejected: string[] };
    },
    onSuccess: (result) => {
      setSpec(result.spec);
      setNote(result.rejected.length ? `${result.note} Ignored: ${result.rejected.join(", ")}` : result.note);
      setPrompt("");
    },
  });

  const marks = useMemo(() => new Map((book.data?.marks ?? []).map((mark) => [mark.symbol, mark])), [book.data?.marks]);

  const closeRows = useMemo(() => {
    const data = book.data;
    if (!data) return [];
    const bySymbol = new Map<string, GaugeRow>();
    for (const row of data.rows) bySymbol.set(row.symbol, row);
    for (const row of data.left) if (!bySymbol.has(row.symbol)) bySymbol.set(row.symbol, row);
    for (const row of data.tracked ?? []) if (!bySymbol.has(row.symbol)) bySymbol.set(row.symbol, row);
    for (const mark of data.marks) {
      if (mark.pinned && !bySymbol.has(mark.symbol)) {
        bySymbol.set(mark.symbol, {
          symbol: mark.symbol,
          score: 0,
          status: "left",
          leaveReason: "Not on the book",
          joinedOn: null,
          leftOn: null,
          daysOnBook: 0,
          gates: [],
          points: [],
          themeName: null,
          close: 0,
        });
      }
    }
    return [...bySymbol.values()].sort((a, b) => {
      const aPin = marks.get(a.symbol)?.pinned ? 1 : 0;
      const bPin = marks.get(b.symbol)?.pinned ? 1 : 0;
      if (aPin !== bPin) return bPin - aPin;
      const aShown = shownScore(a.score, marks.get(a.symbol)?.points ?? 0);
      const bShown = shownScore(b.score, marks.get(b.symbol)?.points ?? 0);
      return bShown - aShown;
    });
  }, [book.data, marks]);

  const chartResults = useMemo(() => {
    if (book.data?.mode === "span" && book.data.span) {
      return book.data.span.map((row) => ({
        symbol: row.symbol,
        name: row.symbol,
        price: 0,
        passedPaths: [] as string[],
      }));
    }
    return closeRows.map((row) => ({
      symbol: row.symbol,
      name: row.symbol,
      price: row.close,
      passedPaths: [] as string[],
    }));
  }, [book.data, closeRows]);

  function openChart(symbol: string) {
    const index = chartResults.findIndex((row) => row.symbol === symbol);
    setChartIndex(index < 0 ? 0 : index);
    setChartOpen(true);
  }

  const dirty = ready && !specsEqual(spec, savedSpec);
  const page = mode === "page";

  function setField(key: keyof MarketLeadersSpec, value: number) {
    setSpec((current) => ({ ...current, [key]: value }));
  }

  function markFor(symbol: string): Mark {
    return marks.get(symbol) ?? { symbol, points: 0, pinned: false };
  }

  return (
    <div className={`flex h-full min-h-0 flex-col ${page ? "gap-3 p-4" : "gap-2 p-2"}`}>
      <div className="flex flex-wrap items-center gap-2">
        {page ? (
          <Tip text="Names that pass the current gates and score. Click a symbol for the score lines.">
            <h1 className="text-lg font-semibold">Market Leaders</h1>
          </Tip>
        ) : (
          <Tip text="Open the full Leaders page for dates, scoring knobs, and AI.">
            <Link href="/sentinel/market-leaders" className="text-xs font-medium underline-offset-2 hover:underline">
              Open Leaders
            </Link>
          </Tip>
        )}
        <Tip text="Current scoring spec. Reset v1 restores these original numbers.">
          <span className="text-xs text-muted-foreground">v1</span>
        </Tip>
        {book.data ? (
          <span className="text-xs text-muted-foreground">
            {book.data.mode === "span" ? `${book.data.from} → ${book.data.asOf}` : book.data.asOf}
            {book.data.live ? " · last close" : ""}
          </span>
        ) : null}
        {page ? (
          <>
            <Tip text="Which names are scored. Universe is the full leaders list. S&P 500 and Russell 2000 limit the pool.">
              <select
                className="start-here-no-drag h-8 rounded border bg-background px-2 text-xs"
                value={pool}
                onChange={(event) => setPool(event.target.value as LeaderPool)}
              >
                <option value="universe">Universe</option>
                <option value="sp500">S&P 500</option>
                <option value="russell2000">Russell 2000</option>
              </select>
            </Tip>
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              <Tip text="First session in the window. Leave both dates empty for the latest close.">As of</Tip>
              <Input
                className="start-here-no-drag h-8 w-36 text-xs"
                type="date"
                min="2000-01-01"
                max="2100-12-31"
                value={asOf}
                onChange={(event) => setAsOf(event.target.value)}
              />
            </label>
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              <Tip text="Last session in the window. Set both dates to see who joined and left between them.">Through</Tip>
              <Input
                className="start-here-no-drag h-8 w-36 text-xs"
                type="date"
                min="2000-01-01"
                max="2100-12-31"
                value={through}
                onChange={(event) => setThrough(event.target.value)}
              />
            </label>
            {asOf || through ? (
              <Tip text="Clear both dates and return to the latest close.">
                <Button
                  size="sm"
                  variant="ghost"
                  className="start-here-no-drag h-8"
                  onClick={() => {
                    datesSeeded.current = false;
                    setAsOf("");
                    setThrough("");
                  }}
                >
                  Clear dates
                </Button>
              </Tip>
            ) : null}
          </>
        ) : null}
      </div>

      {page ? (
        <div className="start-here-no-drag flex flex-col gap-2 rounded border p-3">
          <div className="flex flex-wrap items-end gap-3">
            {SPEC_FIELDS.filter((field) => field.group === "main").map((field) => (
              <label key={field.key} className="flex flex-col gap-1 text-xs">
                <Tip text={field.hint}>{field.label}</Tip>
                <Input
                  className="h-8 w-28 text-xs"
                  type="number"
                  step={field.key === "highProximity" ? "0.01" : "1"}
                  value={spec[field.key]}
                  onChange={(event) => setField(field.key, Number(event.target.value))}
                />
              </label>
            ))}
            <Tip text="Save these numbers and the pool. Until you Keep, the table is only a preview.">
              <Button size="sm" disabled={!dirty || savePrefs.isPending} onClick={() => savePrefs.mutate({ pool, spec })}>
                Keep
              </Button>
            </Tip>
            <Tip text="Restore the original v1 numbers and the full universe, then save.">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setSpec(V1_SPEC);
                  setPool("universe");
                  savePrefs.mutate({ pool: "universe", spec: V1_SPEC });
                }}
              >
                <RotateCcw className="mr-1 h-3 w-3" />
                Reset v1
              </Button>
            </Tip>
            <Tip text="Extra scoring knobs: moving averages, RS cutoffs, volume, and character.">
              <Button size="sm" variant="ghost" onClick={() => setShowAdvanced((open) => !open)}>
                {showAdvanced ? "Hide advanced" : "Advanced"}
              </Button>
            </Tip>
          </div>
          {showAdvanced ? (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {SPEC_FIELDS.filter((field) => field.group === "advanced").map((field) => (
                <label key={field.key} className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                  <Tip text={field.hint}>{field.label}</Tip>
                  <Input
                    className="h-7 text-xs"
                    type="number"
                    value={spec[field.key]}
                    onChange={(event) => setField(field.key, Number(event.target.value))}
                  />
                </label>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="h-8 max-w-md text-xs"
              placeholder="Only names within 10% of the high"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && prompt.trim()) interpret.mutate();
              }}
            />
            <Tip text="Turns a plain-English request into the scoring numbers above. Keep still saves them.">
              <Button size="sm" variant="secondary" disabled={!prompt.trim() || interpret.isPending} onClick={() => interpret.mutate()}>
                {interpret.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Apply with AI"}
              </Button>
            </Tip>
            {dirty ? (
              <Tip text="These numbers are not saved yet. Keep writes them. Refreshing the page drops the preview.">
                <span className="text-xs text-amber-500">Preview — Keep to save</span>
              </Tip>
            ) : null}
          </div>
          {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
          {interpret.error ? <p className="text-xs text-red-400">{(interpret.error as Error).message}</p> : null}
        </div>
      ) : null}

      {dateWarning ? <p className="px-2 text-xs text-amber-500">{dateWarning}</p> : null}
      {book.error && book.data ? <p className="px-2 text-xs text-red-400">{bookErrorText(book.error)}</p> : null}
      {book.isLoading || !ready ? (
        <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Building the book from the daily closes…
        </div>
      ) : book.error && !book.data ? (
        <p className="p-2 text-sm text-red-400">{bookErrorText(book.error)}</p>
      ) : book.data?.mode === "span" && book.data.span ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-background">
              <tr className="text-left text-muted-foreground">
                <th className="px-2 py-1"><Tip text="Click the chart icon to open the daily chart.">Symbol</Tip></th>
                <th className="px-2 py-1"><Tip text="Sessions this name spent on the book in the date window.">Days</Tip></th>
                <th className="px-2 py-1"><Tip text="First session it joined the book in this window.">Joined</Tip></th>
                <th className="px-2 py-1"><Tip text="Session it left the book. Blank if it is still on.">Left</Tip></th>
                <th className="px-2 py-1"><Tip text="Why it left, or that it is still on the book.">Why</Tip></th>
                <th className="px-2 py-1"><Tip text="Engine score on the last session in the window.">Score</Tip></th>
              </tr>
            </thead>
            <tbody>
              {book.data.span.map((row) => (
                <tr key={row.symbol} className="border-t">
                  <td className="px-2 py-1 font-medium">
                    <span className="inline-flex items-center">
                      <ChartTickerChip
                        symbol={row.symbol}
                        size="compact"
                        testIdPrefix={`leaders-span-${row.symbol}`}
                      />
                      <ChartIconButton symbol={row.symbol} onOpen={openChart} />
                    </span>
                  </td>
                  <td className="px-2 py-1 tabular-nums">{row.daysInBook}</td>
                  <td className="px-2 py-1">{row.joined ?? "—"}</td>
                  <td className="px-2 py-1">{row.left ?? "—"}</td>
                  <td className="px-2 py-1">{row.why ?? (row.status === "left" ? "Left" : "Still on")}</td>
                  <td className="px-2 py-1 tabular-nums">{row.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          {book.data ? (
            <p className="px-2 pb-1 text-[11px] text-muted-foreground">
              <Tip text="Passing the gates and at or above the stay score.">{book.data.counts.onBook} on book</Tip>
              {" · "}
              <Tip text="Still on the book, but the score is below the at-risk line.">{book.data.counts.atRisk} at risk</Tip>
              {" · "}
              <Tip text="Names that joined in the last five sessions.">{book.data.counts.joinedThisWeek} joined this week</Tip>
              {" · "}
              <Tip text="Names that left in the last five sessions.">{book.data.counts.droppedThisWeek} left this week</Tip>
            </p>
          ) : null}
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-background">
              <tr className="text-left text-muted-foreground">
                <th className="px-2 py-1"><Tip text="Click the name for gates and score lines. Chart icon opens the daily chart.">Symbol</Tip></th>
                <th className="px-2 py-1"><Tip text="Engine score, 0–100, from RS, theme rank, accumulation, and character.">Score</Tip></th>
                <th className="px-2 py-1"><Tip text="Engine score plus your +/− points. Pin does not change this number.">Yours</Tip></th>
                <th className="px-2 py-1"><Tip text="Daily theme assigned to this name on this close.">Theme</Tip></th>
                <th className="px-2 py-1"><Tip text="On book = passing. At risk = still on but score is weak. Left = dropped or not on the book.">Status</Tip></th>
                {book.data?.live ? (
                  <>
                    <th className="px-2 py-1 text-yellow-400"><Tip text="Live distance to VWAP. Hover the number for the entry reading.">VWAP</Tip></th>
                    <th className="px-2 py-1"><Tip text="Live 6/20 EMA relationship. Hover the number for the entry reading.">6/20</Tip></th>
                  </>
                ) : null}
                <th className="px-2 py-1"><Tip text="Consecutive sessions this name has been on the book.">Days</Tip></th>
                <th className="px-2 py-1"><Tip text="Your points (−10 to +10) and pin. Pin keeps the name on this list if it left the book.">Pin</Tip></th>
              </tr>
            </thead>
            <tbody>
              {closeRows.map((row) => {
                const mark = markFor(row.symbol);
                const open = openSymbol === row.symbol;
                return (
                  <Fragment key={row.symbol}>
                    <tr className="border-t">
                      <td className="px-2 py-1 font-medium">
                        <span className="inline-flex items-center">
                          {mark.pinned ? <Pin className="mr-1 h-3 w-3 text-muted-foreground" /> : null}
                          <button
                            type="button"
                            className="start-here-no-drag"
                            onClick={() => setOpenSymbol(open ? null : row.symbol)}
                          >
                            <ChartTickerChip
                              symbol={row.symbol}
                              price={row.close > 0 ? row.close : null}
                              size="compact"
                              testIdPrefix={`leaders-${row.symbol}`}
                            />
                          </button>
                          <ChartIconButton symbol={row.symbol} onOpen={openChart} />
                        </span>
                      </td>
                      <td className="px-2 py-1 tabular-nums">{row.score}</td>
                      <td className="px-2 py-1 tabular-nums">{shownScore(row.score, mark.points)}</td>
                      <td className="px-2 py-1">{row.themeName ?? "—"}</td>
                      <td className="px-2 py-1">{STATUS_WORD[row.status]}</td>
                      {book.data?.live ? (
                        <>
                          <td className="px-2 py-1">
                            <EntryGaugeValue kind="vwap" pct={row.vwapPct} tone={row.vwapTone} />
                          </td>
                          <td className="px-2 py-1">
                            <EntryGaugeValue kind="ema620" pct={row.ema620Pct} tone={row.ema620Tone} cross={row.ema620Cross} />
                          </td>
                        </>
                      ) : null}
                      <td className="px-2 py-1 tabular-nums">{row.daysOnBook || "—"}</td>
                      <td className="px-2 py-1">
                        <span className="start-here-no-drag inline-flex gap-1">
                          <Tip text="Subtract one of your points. Floor is −10.">
                            <button
                              className="rounded border px-1"
                              onClick={() => saveMark.mutate({ ...mark, points: Math.max(-10, mark.points - 1) })}
                            >
                              −
                            </button>
                          </Tip>
                          <Tip text="Your points added to the engine score.">
                            <span className="tabular-nums">{mark.points}</span>
                          </Tip>
                          <Tip text="Add one of your points. Cap is +10.">
                            <button
                              className="rounded border px-1"
                              onClick={() => saveMark.mutate({ ...mark, points: Math.min(10, mark.points + 1) })}
                            >
                              +
                            </button>
                          </Tip>
                          <Tip text={mark.pinned ? "Remove the pin. The name can fall off this list." : "Keep this name on the list even if it left the book."}>
                            <button className="rounded border px-1" onClick={() => saveMark.mutate({ ...mark, pinned: !mark.pinned })}>
                              {mark.pinned ? "Unpin" : "Pin"}
                            </button>
                          </Tip>
                        </span>
                      </td>
                    </tr>
                    {open ? (
                      <tr key={`${row.symbol}-card`} className="border-t bg-muted/30">
                        <td colSpan={book.data?.live ? 9 : 7} className="px-3 py-2">
                          <div className="flex flex-wrap gap-3">
                            <Link className="text-xs underline" href={`/sentinel/charts/${row.symbol}`}>
                              Chart
                            </Link>
                            {row.gates.map((gate) => (
                              <span key={gate.id} className={gate.pass ? "text-green-500" : "text-red-400"}>
                                {gate.pass ? "Pass" : "Fail"} · {gate.label}
                              </span>
                            ))}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-3 text-muted-foreground">
                            {row.points.map((line) => (
                              <span key={line.key}>
                                {line.label} {line.points} · {line.note}
                              </span>
                            ))}
                          </div>
                          {row.leaveReason ? <p className="mt-1">Left: {row.leaveReason}</p> : null}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {closeRows.length === 0 ? <p className="p-3 text-sm text-muted-foreground">No names on the book for this close.</p> : null}
        </div>
      )}
      {page ? null : (
        <p className="px-1 text-[11px] text-muted-foreground">
          <Crown className="mr-1 inline h-3 w-3" />
          Configuration, dates, and AI live on the Leaders page.
        </p>
      )}
      {chartOpen && chartResults.length > 0 ? (
        <ScanChartViewer
          results={chartResults}
          currentIndex={chartIndex}
          open={chartOpen}
          onOpenChange={setChartOpen}
          onIndexChange={setChartIndex}
        />
      ) : null}
    </div>
  );
}

function ChartIconButton({ symbol, onOpen }: { symbol: string; onOpen: (symbol: string) => void }) {
  return (
    <button
      type="button"
      className="start-here-no-drag ml-1 inline-flex text-muted-foreground hover:text-foreground"
      title="Open the daily chart"
      aria-label={`Open chart for ${symbol}`}
      data-testid={`button-leaders-chart-${symbol}`}
      onClick={(event) => {
        event.stopPropagation();
        event.preventDefault();
        onOpen(symbol);
      }}
    >
      <LineChart className="h-3.5 w-3.5" />
    </button>
  );
}
