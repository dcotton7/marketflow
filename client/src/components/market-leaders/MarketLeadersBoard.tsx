import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Crown, Loader2, Pin, RotateCcw } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EntryGaugeValue } from "@/components/EntryGaugeValue";
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

export function MarketLeadersBoard({ mode }: { mode: "page" | "widget" }) {
  const queryClient = useQueryClient();
  const prefs = useQuery({
    queryKey: ["/api/market-leaders/prefs"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/market-leaders/prefs");
      return (await res.json()) as { pool: LeaderPool; spec: MarketLeadersSpec };
    },
  });

  const [pool, setPool] = useState<LeaderPool>("sp500");
  const [spec, setSpec] = useState<MarketLeadersSpec>(V1_SPEC);
  const [savedSpec, setSavedSpec] = useState<MarketLeadersSpec>(V1_SPEC);
  const [asOf, setAsOf] = useState("");
  const [through, setThrough] = useState("");
  const [ready, setReady] = useState(false);
  const [openSymbol, setOpenSymbol] = useState<string | null>(null);
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

  const book = useQuery({
    queryKey: ["/api/market-leaders/book", mode, pool, asOf, through, spec],
    enabled: ready,
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/market-leaders/book", {
        pool,
        spec,
        asOf: asOf || null,
        through: through || null,
      });
      return (await res.json()) as BookResponse;
    },
  });

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
          <h1 className="text-lg font-semibold">Market Leaders</h1>
        ) : (
          <Link href="/sentinel/market-leaders" className="text-xs font-medium underline-offset-2 hover:underline">
            Open Leaders
          </Link>
        )}
        <span className="text-xs text-muted-foreground">v1</span>
        {book.data ? (
          <span className="text-xs text-muted-foreground">
            {book.data.mode === "span" ? `${book.data.from} → ${book.data.asOf}` : book.data.asOf}
            {book.data.live ? " · last close" : ""}
          </span>
        ) : null}
        {page ? (
          <>
            <select
              className="start-here-no-drag h-8 rounded border bg-background px-2 text-xs"
              value={pool}
              onChange={(event) => setPool(event.target.value as LeaderPool)}
            >
              <option value="sp500">S&P 500</option>
              <option value="russell2000">Russell 2000</option>
            </select>
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              As of
              <Input className="start-here-no-drag h-8 w-36 text-xs" type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} />
            </label>
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              Through
              <Input className="start-here-no-drag h-8 w-36 text-xs" type="date" value={through} onChange={(event) => setThrough(event.target.value)} />
            </label>
          </>
        ) : null}
      </div>

      {page ? (
        <div className="start-here-no-drag flex flex-col gap-2 rounded border p-3">
          <div className="flex flex-wrap items-end gap-3">
            {SPEC_FIELDS.filter((field) => field.group === "main").map((field) => (
              <label key={field.key} className="flex flex-col gap-1 text-xs">
                {field.label}
                <Input
                  className="h-8 w-28 text-xs"
                  type="number"
                  step={field.key === "highProximity" ? "0.01" : "1"}
                  value={spec[field.key]}
                  onChange={(event) => setField(field.key, Number(event.target.value))}
                />
              </label>
            ))}
            <Button size="sm" disabled={!dirty || savePrefs.isPending} onClick={() => savePrefs.mutate({ pool, spec })}>
              Keep
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setSpec(V1_SPEC);
                setPool("sp500");
                savePrefs.mutate({ pool: "sp500", spec: V1_SPEC });
              }}
            >
              <RotateCcw className="mr-1 h-3 w-3" />
              Reset v1
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowAdvanced((open) => !open)}>
              {showAdvanced ? "Hide advanced" : "Advanced"}
            </Button>
          </div>
          {showAdvanced ? (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {SPEC_FIELDS.filter((field) => field.group === "advanced").map((field) => (
                <label key={field.key} className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                  {field.label}
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
            <Button size="sm" variant="secondary" disabled={!prompt.trim() || interpret.isPending} onClick={() => interpret.mutate()}>
              {interpret.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Apply with AI"}
            </Button>
            {dirty ? <span className="text-xs text-amber-500">Preview — Keep to save</span> : null}
          </div>
          {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
          {interpret.error ? <p className="text-xs text-red-400">{(interpret.error as Error).message}</p> : null}
        </div>
      ) : null}

      {book.isLoading || !ready ? (
        <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Building the book from the daily closes…
        </div>
      ) : book.error ? (
        <p className="p-2 text-sm text-red-400">{(book.error as Error).message}</p>
      ) : book.data?.mode === "span" && book.data.span ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-background">
              <tr className="text-left text-muted-foreground">
                <th className="px-2 py-1">Symbol</th>
                <th className="px-2 py-1">Days</th>
                <th className="px-2 py-1">Joined</th>
                <th className="px-2 py-1">Left</th>
                <th className="px-2 py-1">Why</th>
                <th className="px-2 py-1">Score</th>
              </tr>
            </thead>
            <tbody>
              {book.data.span.map((row) => (
                <tr key={row.symbol} className="border-t">
                  <td className="px-2 py-1 font-medium">
                    <Link href={`/sentinel/charts/${row.symbol}`}>{row.symbol}</Link>
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
              {book.data.counts.onBook} on book · {book.data.counts.atRisk} at risk · {book.data.counts.joinedThisWeek} joined this week · {book.data.counts.droppedThisWeek} left this week
            </p>
          ) : null}
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-background">
              <tr className="text-left text-muted-foreground">
                <th className="px-2 py-1">Symbol</th>
                <th className="px-2 py-1">Score</th>
                <th className="px-2 py-1">Yours</th>
                <th className="px-2 py-1">Theme</th>
                <th className="px-2 py-1">Status</th>
                {book.data?.live ? (
                  <>
                    <th className="px-2 py-1 text-yellow-400">VWAP</th>
                    <th className="px-2 py-1">6/20</th>
                  </>
                ) : null}
                <th className="px-2 py-1">Days</th>
                <th className="px-2 py-1"></th>
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
                        <button className="start-here-no-drag" onClick={() => setOpenSymbol(open ? null : row.symbol)}>
                          {mark.pinned ? <Pin className="mr-1 inline h-3 w-3" /> : null}
                          {row.symbol}
                        </button>
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
                          <button
                            className="rounded border px-1"
                            onClick={() => saveMark.mutate({ ...mark, points: Math.max(-10, mark.points - 1) })}
                          >
                            −
                          </button>
                          <span className="tabular-nums">{mark.points}</span>
                          <button
                            className="rounded border px-1"
                            onClick={() => saveMark.mutate({ ...mark, points: Math.min(10, mark.points + 1) })}
                          >
                            +
                          </button>
                          <button className="rounded border px-1" onClick={() => saveMark.mutate({ ...mark, pinned: !mark.pinned })}>
                            {mark.pinned ? "Unpin" : "Pin"}
                          </button>
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
    </div>
  );
}
